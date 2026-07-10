import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import {
  buildGroundMesh,
  sampleHeight,
  setActiveWorld,
  refreshWorldFlags,
  fieldProtected,
  FIELD,
} from "../world/terrain";
import { buildScenery } from "../world/scenery";
import { loadWorldDataSync, LocalWorldStore } from "../world/worldStore";
import { FarmlifeSession } from "../net/session";
import { CloudWorldStore } from "../world/cloudWorldStore";
import {
  emptyWorldData,
  isEmptyWorldData,
  type WorldData,
  type WorldObject,
  type WorldFence,
} from "../world/worldData";
import { buildPropMesh, buildFenceMesh, PROPS, PROP_ORDER } from "../world/props";

// ===========================================================================
// Farm Life — WORLD EDITOR (P1.5b). Dad's tool: direct URL only, not linked
// from the game. Ports the proven Farm Kart editor UX (sculpt heightfield with
// smoothstep brush, sparse paint grid, TransformControls object placement with
// tag labels, terrain-following fence polylines) onto the farmlife TS modules,
// rendering the SAME valley via the shared terrain/scenery so it's WYSIWYG.
// ===========================================================================

const $ = (id: string) => document.getElementById(id)!;
const store = new LocalWorldStore();
// P2: also save the world to Firestore (settings-doc-style: one "world" doc,
// JSON string or "default" — barnyardbistro cloud-layout-sync pattern) so
// every family device sees the same decorated valley. Offline/blocked ->
// localStorage-only save keeps working exactly as before (P1.5b).
const cloudSession = new FarmlifeSession((msg) => toast(msg));
const cloudWorldStore = new CloudWorldStore(cloudSession);
let cloudSaveReady = false;
cloudSession.ready.then((ok) => { cloudSaveReady = ok; });
let world: WorldData = loadWorldDataSync();
setActiveWorld(world);
let dirty = false;

function markDirty(d = true): void {
  dirty = d;
  const el = $("saveState");
  el.textContent = d ? "unsaved changes" : "saved";
  el.className = d ? "unsaved" : "saved";
}

// ---- renderer / scene ------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
$("app").appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#8fc0e8");
scene.add(new THREE.HemisphereLight(new THREE.Color("#dff0ff"), new THREE.Color("#6b8c4a"), 0.9));
const sun = new THREE.DirectionalLight(new THREE.Color("#fff2d6"), 1.1);
sun.position.set(40, 70, 25);
scene.add(sun);
scene.add(new THREE.AmbientLight(0xffffff, 0.2));

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 800);
camera.position.set(0, 70, 90);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.maxPolarAngle = Math.PI * 0.49;
controls.update();

// ---- static reference scenery (house / pond / fences / trees) --------------
scene.add(buildScenery().group);

// ---- ground mesh (rebuildable) ---------------------------------------------
let groundMesh: THREE.Mesh = buildGroundMesh();
scene.add(groundMesh);
function rebuildGround(): void {
  scene.remove(groundMesh);
  groundMesh.geometry.dispose();
  (groundMesh.material as THREE.Material).dispose();
  refreshWorldFlags();
  groundMesh = buildGroundMesh();
  scene.add(groundMesh);
}

// ---- farming-field outline (protection guide + red flash) ------------------
const fieldOutline = (() => {
  const h = FIELD.half + 1.5;
  const corners = [
    [FIELD.cx - h, FIELD.cz - h],
    [FIELD.cx + h, FIELD.cz - h],
    [FIELD.cx + h, FIELD.cz + h],
    [FIELD.cx - h, FIELD.cz + h],
  ];
  const pts: number[] = [];
  for (let i = 0; i <= 4; i++) {
    const [x, z] = corners[i % 4];
    pts.push(x, sampleHeight(x, z) + 0.4, z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x8fd6a0 }));
})();
scene.add(fieldOutline);
let flashUntil = 0;
function flashField(): void {
  flashUntil = performance.now() + 350;
}

// ---- object + fence groups + gizmo -----------------------------------------
const objectGroup = new THREE.Group();
const labelGroup = new THREE.Group();
const fenceGroup = new THREE.Group();
scene.add(objectGroup, labelGroup, fenceGroup);
const objMeshes: Record<string, THREE.Group> = {};
let selObjId: string | null = null;
let objSeq = 0;
let fenceSeq = 0;

const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.setSize(0.9);
scene.add(gizmo.getHelper());
gizmo.getHelper().visible = false;
gizmo.enabled = false;
gizmo.addEventListener("dragging-changed", (e) => {
  controls.enabled = !e.value;
});
gizmo.addEventListener("objectChange", writeBackSelected);

function terrainHeightAt(x: number, z: number): number {
  return sampleHeight(x, z);
}

// ---- object labels ---------------------------------------------------------
function makeLabel(text: string): THREE.Sprite {
  const cv = document.createElement("canvas");
  cv.width = 256; cv.height = 64;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = "rgba(10,16,24,.82)";
  ctx.fillRect(0, 0, 256, 64);
  ctx.font = "bold 30px system-ui, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = text ? "#ffe27a" : "#9ab";
  ctx.fillText((text || "(untitled)").slice(0, 18), 128, 34);
  const tex = new THREE.CanvasTexture(cv);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  spr.scale.set(8, 2, 1);
  return spr;
}
function positionLabel(lbl: THREE.Sprite, o: WorldObject): void {
  lbl.position.set(o.x, o.y + o.sy / 2 + 1.4, o.z);
}

function rebuildObjects(): void {
  for (const c of [...objectGroup.children]) {
    objectGroup.remove(c);
    c.traverse((m) => {
      const mesh = m as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | undefined;
      if (mat) mat.dispose();
    });
  }
  for (const c of [...labelGroup.children]) {
    labelGroup.remove(c);
    const spr = c as THREE.Sprite;
    if (spr.material) {
      if (spr.material.map) spr.material.map.dispose();
      spr.material.dispose();
    }
  }
  for (const k of Object.keys(objMeshes)) delete objMeshes[k];
  let maxSeq = 0;
  for (const o of world.objects) {
    const m = /(\d+)$/.exec(o.id);
    if (m) maxSeq = Math.max(maxSeq, +m[1]);
    const g = buildPropMesh(o.type, true);
    g.position.set(o.x, o.y, o.z);
    g.scale.set(o.sx, o.sy, o.sz);
    g.rotation.y = o.rotY;
    g.userData.objId = o.id;
    objectGroup.add(g);
    objMeshes[o.id] = g;
    const lbl = makeLabel(o.tag || "");
    positionLabel(lbl, o);
    labelGroup.add(lbl);
    g.userData.label = lbl;
  }
  objSeq = Math.max(objSeq, maxSeq);
  if (selObjId && objMeshes[selObjId]) gizmo.attach(objMeshes[selObjId]);
  else { gizmo.detach(); if (!objMeshes[selObjId!]) selObjId = null; }
  refreshObjList();
}

function writeBackSelected(): void {
  if (!selObjId) return;
  const o = world.objects.find((x) => x.id === selObjId);
  const g = objMeshes[selObjId];
  if (!o || !g) return;
  o.x = +g.position.x.toFixed(2); o.y = +g.position.y.toFixed(2); o.z = +g.position.z.toFixed(2);
  o.sx = +Math.max(0.2, g.scale.x).toFixed(2);
  o.sy = +Math.max(0.2, g.scale.y).toFixed(2);
  o.sz = +Math.max(0.2, g.scale.z).toFixed(2);
  o.rotY = +g.rotation.y.toFixed(3);
  if (g.userData.label) positionLabel(g.userData.label as THREE.Sprite, o);
  markDirty();
}

function selectObject(id: string | null): void {
  selObjId = id;
  if (id && objMeshes[id]) gizmo.attach(objMeshes[id]);
  else gizmo.detach();
  const o = id ? world.objects.find((x) => x.id === id) : null;
  ($("objTag") as HTMLInputElement).value = o ? o.tag || "" : "";
  gizmo.getHelper().visible = mode === "object" && !!id;
  refreshObjList();
}

function addProp(type: string): void {
  const cx = +controls.target.x.toFixed(2), cz = +controls.target.z.toFixed(2);
  const def = PROPS[type] || PROPS.tree;
  const [sx, sy, sz] = def.size;
  const o: WorldObject = {
    id: `obj_${++objSeq}`, type, tag: "",
    x: cx, y: +(terrainHeightAt(cx, cz) + sy / 2).toFixed(2), z: cz,
    rotY: 0, sx, sy, sz,
  };
  world.objects.push(o);
  rebuildObjects();
  selectObject(o.id);
  setGizmo("translate");
  markDirty();
  toast(`placed ${def.label} — drag to place, name it below`);
}
function duplicateObject(): void {
  const o = selObjId ? world.objects.find((x) => x.id === selObjId) : null;
  if (!o) { toast("select an object first"); return; }
  const c: WorldObject = { ...o, id: `obj_${++objSeq}`, x: o.x + 4, z: o.z + 4 };
  world.objects.push(c);
  rebuildObjects();
  selectObject(c.id);
  markDirty();
}
function deleteObject(): void {
  if (!selObjId) return;
  world.objects = world.objects.filter((x) => x.id !== selObjId);
  gizmo.detach();
  selObjId = null;
  rebuildObjects();
  markDirty();
  toast("deleted object");
}
function setGizmo(m: "translate" | "rotate" | "scale"): void {
  gizmo.setMode(m);
  $("gMove").classList.toggle("on", m === "translate");
  $("gRot").classList.toggle("on", m === "rotate");
  $("gScale").classList.toggle("on", m === "scale");
}
function refreshObjList(): void {
  const box = $("objList");
  box.innerHTML = "";
  if (!world.objects.length) { box.innerHTML = '<div style="color:#8aa;">none — pick a prop, click the ground</div>'; return; }
  for (const o of world.objects) {
    const row = document.createElement("div");
    row.className = "listrow";
    if (o.id === selObjId) row.style.background = "rgba(90,160,255,.25)";
    const nm = document.createElement("span");
    nm.className = "nm";
    nm.style.color = o.tag ? "#ffe27a" : "#9ab";
    nm.textContent = `${PROPS[o.type]?.emoji || "▪"} ${o.tag || o.type}`;
    nm.onclick = () => selectObject(o.id);
    const del = document.createElement("button");
    del.className = "del"; del.textContent = "×";
    del.onclick = () => { selObjId = o.id; deleteObject(); };
    row.append(nm, del);
    box.appendChild(row);
  }
}

// ---- fences ----------------------------------------------------------------
let curFence: WorldFence | null = null;
let fenceDown: { x: number; y: number } | null = null;
function rebuildFences(): void {
  for (const c of [...fenceGroup.children]) {
    fenceGroup.remove(c);
    c.traverse((m) => {
      const mesh = m as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | undefined;
      if (mat) mat.dispose();
    });
  }
  let maxSeq = 0;
  for (const f of world.fences) {
    const m = /(\d+)$/.exec(f.id);
    if (m) maxSeq = Math.max(maxSeq, +m[1]);
    if (f.points.length >= 2) fenceGroup.add(buildFenceMesh(f, terrainHeightAt));
    for (const p of f.points) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe27a }));
      d.position.set(p.x, terrainHeightAt(p.x, p.z) + 0.6, p.z);
      fenceGroup.add(d);
    }
  }
  fenceSeq = Math.max(fenceSeq, maxSeq);
  refreshFenceList();
}
function addFencePoint(x: number, z: number): void {
  if (!curFence) {
    curFence = { id: `fence_${++fenceSeq}`, points: [] };
    world.fences.push(curFence);
  }
  curFence.points.push({ x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 });
  rebuildFences();
  markDirty();
}
function undoFencePoint(): void {
  const f = curFence || world.fences[world.fences.length - 1];
  if (!f || !f.points.length) return;
  f.points.pop();
  if (!f.points.length) { world.fences = world.fences.filter((x) => x !== f); if (curFence === f) curFence = null; }
  rebuildFences();
  markDirty();
}
function finishFence(): void {
  if (curFence && curFence.points.length < 2) world.fences = world.fences.filter((f) => f !== curFence);
  curFence = null;
  rebuildFences();
  toast("fence finished — click to start a new one");
}
function refreshFenceList(): void {
  const box = $("fenceList");
  box.innerHTML = "";
  if (!world.fences.length) { box.innerHTML = '<div style="color:#8aa;">no fences yet</div>'; return; }
  world.fences.forEach((f, i) => {
    const row = document.createElement("div");
    row.className = "listrow";
    const nm = document.createElement("span");
    nm.className = "nm"; nm.style.color = "#d9c8a8";
    nm.textContent = `${f === curFence ? "▶ " : ""}fence ${i + 1} (${f.points.length}pt)`;
    const del = document.createElement("button");
    del.className = "del"; del.textContent = "×";
    del.onclick = () => { world.fences = world.fences.filter((x) => x !== f); if (curFence === f) curFence = null; rebuildFences(); markDirty(); };
    row.append(nm, del);
    box.appendChild(row);
  });
}

// ---- SCULPT brush ----------------------------------------------------------
const SCULPT = { radius: 7, strength: 0.8, dir: 1 };
function applyBrush(bx: number, bz: number, sign: number): void {
  if (fieldProtected(bx, bz)) { flashField(); return; } // don't sculpt the plot
  const C = world.terrain.cell, cells = world.terrain.cells, R = SCULPT.radius;
  const str = SCULPT.strength * sign;
  const i0 = Math.floor((bx - R) / C), i1 = Math.ceil((bx + R) / C);
  const j0 = Math.floor((bz - R) / C), j1 = Math.ceil((bz + R) / C);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const wx = i * C, wz = j * C;
    if (fieldProtected(wx, wz)) continue; // keep field-edge grid points flat
    const d = Math.hypot(wx - bx, wz - bz);
    if (d > R) continue;
    const t = 1 - d / R, fall = t * t * (3 - 2 * t);
    let v = (cells[`${i},${j}`] || 0) + str * fall;
    v = Math.round(v * 100) / 100;
    if (Math.abs(v) < 0.01) delete cells[`${i},${j}`];
    else cells[`${i},${j}`] = v;
  }
  markDirty();
}
function terrainCellCount(): number { return Object.keys(world.terrain.cells).length; }

// ---- PAINT brush -----------------------------------------------------------
const PALETTE = [
  { name: "grass", hex: 0x7ba659 }, { name: "dark grass", hex: 0x5f8a45 }, { name: "dry", hex: 0xb7b04a },
  { name: "dirt", hex: 0x8a5a34 }, { name: "sand", hex: 0xd9c48a }, { name: "path", hex: 0x9a938a },
  { name: "clay", hex: 0xb3542f }, { name: "stone", hex: 0xbfc3c6 },
];
const PAINT = { radius: 6, color: 0x8a5a34 };
function applyPaint(bx: number, bz: number): void {
  if (fieldProtected(bx, bz)) { flashField(); return; }
  const C = world.paint.cell, cells = world.paint.cells, R = PAINT.radius;
  const i0 = Math.floor((bx - R) / C), i1 = Math.ceil((bx + R) / C);
  const j0 = Math.floor((bz - R) / C), j1 = Math.ceil((bz + R) / C);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const wx = i * C, wz = j * C;
    if (fieldProtected(wx, wz)) continue;
    if (Math.hypot(wx - bx, wz - bz) > R) continue;
    cells[`${i},${j}`] = PAINT.color;
  }
  markDirty();
}
function paintCellCount(): number { return Object.keys(world.paint.cells).length; }

// throttled live ground rebuild during a brush drag
let _lastRebuild = 0, _pend = false;
function liveGround(): void {
  const t = performance.now();
  if (t - _lastRebuild > 110) { _lastRebuild = t; rebuildGround(); }
  else if (!_pend) { _pend = true; setTimeout(() => { _pend = false; _lastRebuild = performance.now(); rebuildGround(); }, 110); }
}

// ===========================================================================
// Modes + toolbar wiring
// ===========================================================================
type Mode = "select" | "sculpt" | "paint" | "object" | "fence";
let mode: Mode = "select";
function setMode(m: Mode): void {
  mode = m;
  for (const [id, mm] of [["mSculpt", "sculpt"], ["mPaint", "paint"], ["mObject", "object"], ["mFence", "fence"]] as const) {
    $(id).classList.toggle("on", mode === mm);
  }
  $("sculptTools").classList.toggle("hidden", m !== "sculpt");
  $("paintTools").classList.toggle("hidden", m !== "paint");
  $("objTools").classList.toggle("hidden", m !== "object");
  $("fenceTools").classList.toggle("hidden", m !== "fence");
  if (m === "sculpt") $("scCells").textContent = String(terrainCellCount());
  if (m === "paint") $("pCells").textContent = String(paintCellCount());
  if (m === "fence") refreshFenceList();
  gizmo.enabled = m === "object";
  gizmo.getHelper().visible = m === "object" && !!selObjId;
  $("hint").textContent =
    m === "sculpt" ? "drag the GRASS to raise · hold Shift to lower · the field stays flat"
    : m === "paint" ? "pick a color, drag the GRASS to paint (dirt, sand, path…)"
    : m === "object" ? "pick a prop then click ground · click a prop to select · G/R/S · Del"
    : m === "fence" ? "click the ground to drop fence posts · Finish to start a new run · drag = orbit"
    : "drag to orbit · scroll to zoom";
}
$("mSculpt").onclick = () => setMode("sculpt");
$("mPaint").onclick = () => setMode("paint");
$("mObject").onclick = () => setMode("object");
$("mFence").onclick = () => setMode("fence");

$("scRaise").onclick = () => { SCULPT.dir = 1; $("scRaise").classList.add("on"); $("scLower").classList.remove("on"); };
$("scLower").onclick = () => { SCULPT.dir = -1; $("scLower").classList.add("on"); $("scRaise").classList.remove("on"); };
($("scRad") as HTMLInputElement).oninput = (e) => { SCULPT.radius = +(e.target as HTMLInputElement).value; $("scRadV").textContent = String(SCULPT.radius); };
($("scStr") as HTMLInputElement).oninput = (e) => { SCULPT.strength = +(e.target as HTMLInputElement).value; $("scStrV").textContent = SCULPT.strength.toFixed(1); };
$("scReset").onclick = () => { world.terrain.cells = {}; rebuildGround(); $("scCells").textContent = "0"; markDirty(); toast("terrain cleared"); };

(function buildSwatches() {
  const box = $("swatches");
  PALETTE.forEach((p) => {
    const s = document.createElement("button");
    s.title = p.name;
    s.style.background = "#" + p.hex.toString(16).padStart(6, "0");
    s.style.border = "2px solid " + (p.hex === PAINT.color ? "#fff" : "rgba(255,255,255,.25)");
    s.onclick = () => {
      PAINT.color = p.hex;
      [...box.children].forEach((c) => ((c as HTMLElement).style.borderColor = "rgba(255,255,255,.25)"));
      s.style.borderColor = "#fff";
    };
    box.appendChild(s);
  });
})();
($("pRad") as HTMLInputElement).oninput = (e) => { PAINT.radius = +(e.target as HTMLInputElement).value; $("pRadV").textContent = String(PAINT.radius); };
$("pReset").onclick = () => { world.paint.cells = {}; rebuildGround(); $("pCells").textContent = "0"; markDirty(); toast("paint cleared"); };

(function buildPalettePicker() {
  const box = $("palettePicker");
  for (const type of PROP_ORDER) {
    const def = PROPS[type];
    const b = document.createElement("button");
    b.textContent = `${def.emoji} ${def.label}`;
    b.title = def.label;
    b.onclick = () => addProp(type);
    box.appendChild(b);
  }
})();

$("gMove").onclick = () => setGizmo("translate");
$("gRot").onclick = () => setGizmo("rotate");
$("gScale").onclick = () => setGizmo("scale");
$("dupObj").onclick = duplicateObject;
$("delObj").onclick = deleteObject;
($("objTag") as HTMLInputElement).oninput = (e) => {
  if (!selObjId) return;
  const o = world.objects.find((x) => x.id === selObjId);
  if (!o) return;
  o.tag = (e.target as HTMLInputElement).value.slice(0, 60);
  const g = objMeshes[selObjId];
  if (g && g.userData.label) {
    labelGroup.remove(g.userData.label as THREE.Sprite);
    const l = makeLabel(o.tag);
    positionLabel(l, o);
    labelGroup.add(l);
    g.userData.label = l;
  }
  refreshObjList();
  markDirty();
};
$("fUndo").onclick = undoFencePoint;
$("fFinish").onclick = finishFence;

$("saveBtn").onclick = () => {
  store.save(world);
  markDirty(false);
  if (cloudSaveReady) {
    cloudWorldStore.save(world);
    toast("saved to ALL devices — the family farm will pick it up live");
  } else {
    toast("saved to this browser only — cloud sync unavailable (offline?)");
  }
};
$("revertBtn").onclick = () => { world = loadWorldDataSync(); setActiveWorld(world); selObjId = null; curFence = null; rebuildAll(); markDirty(false); toast("reverted to last save"); };
$("clearBtn").onclick = () => { world = emptyWorldData(); setActiveWorld(world); selObjId = null; curFence = null; rebuildAll(); markDirty(); toast("cleared — Save to make it stick"); };

function rebuildAll(): void {
  rebuildGround();
  rebuildObjects();
  rebuildFences();
}

// ---- raycasting / pointer --------------------------------------------------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function setNdc(e: PointerEvent): void {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
}
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function pickGround(): THREE.Vector3 | null {
  const hits = raycaster.intersectObject(groundMesh, false);
  if (hits.length) return hits[0].point;
  const hit = new THREE.Vector3();
  return raycaster.ray.intersectPlane(groundPlane, hit) ? hit : null;
}
let sculpting = false, painting = false;

renderer.domElement.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  if (mode === "object") {
    if (gizmo.axis) return; // gizmo handle owns the drag
    setNdc(e);
    const hits = raycaster.intersectObjects(objectGroup.children, true);
    if (hits.length) {
      let g: THREE.Object3D | null = hits[0].object;
      while (g && g.userData.objId === undefined) g = g.parent;
      if (g) { selectObject(g.userData.objId as string); controls.enabled = false; }
    }
    return;
  }
  if (mode === "sculpt") {
    setNdc(e); const h = pickGround();
    if (h) { sculpting = true; controls.enabled = false; applyBrush(h.x, h.z, e.shiftKey ? -1 : SCULPT.dir); liveGround(); }
    return;
  }
  if (mode === "paint") {
    setNdc(e); const h = pickGround();
    if (h) { painting = true; controls.enabled = false; applyPaint(h.x, h.z); liveGround(); }
    return;
  }
  if (mode === "fence") { fenceDown = { x: e.clientX, y: e.clientY }; return; }
}, true);

renderer.domElement.addEventListener("pointermove", (e) => {
  if (sculpting) { setNdc(e); const h = pickGround(); if (h) { applyBrush(h.x, h.z, e.shiftKey ? -1 : SCULPT.dir); liveGround(); } }
  else if (painting) { setNdc(e); const h = pickGround(); if (h) { applyPaint(h.x, h.z); liveGround(); } }
});

function endDrag(): void {
  if (sculpting) { sculpting = false; rebuildGround(); $("scCells").textContent = String(terrainCellCount()); }
  if (painting) { painting = false; rebuildGround(); $("pCells").textContent = String(paintCellCount()); }
  controls.enabled = true;
}
renderer.domElement.addEventListener("pointerup", (e) => {
  if (mode === "fence" && fenceDown) {
    const moved = Math.hypot(e.clientX - fenceDown.x, e.clientY - fenceDown.y);
    fenceDown = null;
    if (moved < 6) { setNdc(e); const h = pickGround(); if (h) addFencePoint(h.x, h.z); }
  }
  endDrag();
}, true);
renderer.domElement.addEventListener("pointerleave", endDrag);

window.addEventListener("keydown", (e) => {
  if (mode !== "object") return;
  const k = e.key.toLowerCase();
  if (k === "g") setGizmo("translate");
  else if (k === "r") setGizmo("rotate");
  else if (k === "s") setGizmo("scale");
  else if (e.key === "Delete" || e.key === "Backspace") deleteObject();
});

// ---- toast -----------------------------------------------------------------
let toastTimer = 0;
function toast(msg: string): void {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("show"), 2200);
}

// ---- resize + loop ---------------------------------------------------------
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function loop(): void {
  controls.update();
  const flashing = performance.now() < flashUntil;
  (fieldOutline.material as THREE.LineBasicMaterial).color.setHex(flashing ? 0xff5a4a : 0x8fd6a0);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

// ---- boot ------------------------------------------------------------------
rebuildObjects();
rebuildFences();
setMode("sculpt");
markDirty(false);
loop();

// ---- debug / test hook -----------------------------------------------------
(window as unknown as { __FLED__: Record<string, unknown> }).__FLED__ = {
  world: () => world,
  isEmpty: () => isEmptyWorldData(world),
  setMode: (m: Mode) => setMode(m),
  sculptAt: (x: number, z: number, sign: number) => { applyBrush(x, z, sign); rebuildGround(); return terrainCellCount(); },
  paintAt: (x: number, z: number, hex?: number) => { if (hex != null) PAINT.color = hex; applyPaint(x, z); rebuildGround(); return paintCellCount(); },
  terrainCells: () => terrainCellCount(),
  paintCells: () => paintCellCount(),
  heightAt: (x: number, z: number) => terrainHeightAt(x, z),
  groundColorAt: (x: number, z: number) => {
    const geo = groundMesh.geometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const col = geo.attributes.color as THREE.BufferAttribute | undefined;
    if (!col) return null;
    let bi = 0, bd = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const d = (pos.getX(i) - x) ** 2 + (pos.getZ(i) - z) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    return [col.getX(bi), col.getY(bi), col.getZ(bi)];
  },
  addProp: (type: string) => { addProp(type); return selObjId; },
  selectObject: (id: string | null) => selectObject(id),
  selected: () => selObjId,
  transformSelected: (pos?: [number, number, number], scl?: [number, number, number], rotY?: number) => {
    const g = selObjId ? objMeshes[selObjId] : null;
    if (!g) return;
    if (pos) g.position.set(pos[0], pos[1], pos[2]);
    if (scl) g.scale.set(scl[0], scl[1], scl[2]);
    if (rotY != null) g.rotation.y = rotY;
    writeBackSelected();
  },
  tagSelected: (t: string) => {
    if (!selObjId) return;
    const o = world.objects.find((x) => x.id === selObjId);
    if (!o) return;
    o.tag = t;
    const inp = $("objTag") as HTMLInputElement;
    inp.value = t;
    inp.dispatchEvent(new Event("input"));
  },
  objects: () => world.objects.map((o) => ({ id: o.id, type: o.type, tag: o.tag, x: o.x, y: o.y, z: o.z })),
  addFencePoint: (x: number, z: number) => { setMode("fence"); addFencePoint(x, z); },
  finishFence: () => finishFence(),
  fences: () => world.fences.map((f) => ({ id: f.id, points: f.points.length })),
  fenceMeshCount: () => fenceGroup.children.length,
  save: async () => { store.save(world); if (cloudSaveReady) await cloudWorldStore.save(world); markDirty(false); },
  clearAll: () => { world = emptyWorldData(); setActiveWorld(world); selObjId = null; curFence = null; rebuildAll(); markDirty(); },
  isDirty: () => dirty,
  cloudReady: () => cloudSession.ready,
  isCloudSaveReady: () => cloudSaveReady,
};
