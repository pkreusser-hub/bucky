import { makeProj, worldToMap, worldLenToMap, arrowPoints, type Proj } from "./mapProjection";

// ---------------------------------------------------------------------------
// Farm Map (P7) — live top-down Canvas2D render of the whole valley, drawn
// straight from DATA (never a camera render). North-up: world +X -> canvas
// right, world +Z -> canvas down (farmkart.html #minimap convention).
//
// CACHING: the terrain/pond/field/fences/world-objects/decor layer is mostly
// static within a session, so drawFarmMap renders it into `bg` (an offscreen
// canvas) once and blits it every call via drawImage — only the truly LIVE
// bits (field tile states, animals, players) are redrawn from scratch each
// call. `invalidateBackground()` forces a rebuild (world-editor reconcile).
// ---------------------------------------------------------------------------

export interface MapEmojiDot {
  x: number;
  z: number;
  emoji: string;
}

export interface MapPlayerDot {
  x: number;
  z: number;
  heading: number;
  color: string;
  self: boolean;
  name?: string;
}

/** A free-form plant on the map (dot; gold when ready). */
export interface MapPlantDot {
  x: number;
  z: number;
  ready: boolean;
}
/** A tilled-soil patch (organic circle). */
export interface MapPatchDot {
  x: number;
  z: number;
  r: number;
}

export interface MapFenceLine {
  pts: Array<{ x: number; z: number }>;
}

export interface MapRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface FarmMapSnapshot {
  half: number; // MAP_HALF
  edge: number; // EDGE (valley wall)
  field: { cx: number; cz: number; half: number };
  pond: { cx: number; cz: number; r: number };
  fences: MapFenceLine[];
  objects: MapEmojiDot[]; // world-editor props
  decor: MapEmojiDot[]; // kid-placed decorations
  stations: MapEmojiDot[]; // seed stand / shipping bin / farmhouse
  doors?: MapEmojiDot[]; // enterable-building door markers (🚪)
  plants: MapPlantDot[]; // free-form crops (dots; gold = ready)
  patches?: MapPatchDot[]; // tilled-soil blobs
  animals: MapEmojiDot[];
  players: MapPlayerDot[];
  // husbandry rework: the fenced pasture, its gate, the barn footprint + door
  // state, and how many eggs are waiting on the barn floor.
  pasture?: MapRect;
  gate?: { x: number; z0: number; z1: number };
  barn?: MapRect;
  doorOpen?: boolean;
  eggCount?: number;
}

let bg: HTMLCanvasElement | null = null;
let bgSig = "";

/** Force the next drawFarmMap call to rebuild the cached background layer
 * (call after a world-editor reconcile changes fences/objects/valley shape). */
export function invalidateFarmMapBackground(): void {
  bgSig = "";
}

function buildBackground(size: number, proj: Proj, snap: FarmMapSnapshot): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d")!;

  ctx.fillStyle = "#6f9c52";
  ctx.fillRect(0, 0, size, size);

  // valley wall outline
  const eA = worldToMap(-snap.edge, -snap.edge, proj);
  const eB = worldToMap(snap.edge, snap.edge, proj);
  ctx.strokeStyle = "rgba(30,40,20,.5)";
  ctx.lineWidth = Math.max(2, size * 0.006);
  ctx.strokeRect(eA.mx, eA.my, eB.mx - eA.mx, eB.my - eA.my);

  // pond
  const pc = worldToMap(snap.pond.cx, snap.pond.cz, proj);
  ctx.beginPath();
  ctx.arc(pc.mx, pc.my, worldLenToMap(snap.pond.r, proj), 0, Math.PI * 2);
  ctx.fillStyle = "#4a90c4";
  ctx.fill();
  ctx.strokeStyle = "#2f6f9c";
  ctx.lineWidth = Math.max(1.5, size * 0.003);
  ctx.stroke();

  // starter field footprint — a FAINT outline landmark only. It's grass now
  // (free-form farming happens anywhere), so no dirt fill and no tile grid.
  const fA = worldToMap(snap.field.cx - snap.field.half, snap.field.cz - snap.field.half, proj);
  const fB = worldToMap(snap.field.cx + snap.field.half, snap.field.cz + snap.field.half, proj);
  ctx.strokeStyle = "rgba(74,110,52,.55)";
  ctx.lineWidth = Math.max(1, size * 0.003);
  ctx.strokeRect(fA.mx, fA.my, fB.mx - fA.mx, fB.my - fA.my);

  // pasture fence (rectangle with a gate gap on the west edge) + barn footprint
  if (snap.pasture) {
    const p = snap.pasture;
    const a = worldToMap(p.minX, p.minZ, proj);
    const b = worldToMap(p.maxX, p.maxZ, proj);
    ctx.strokeStyle = "#8a6236";
    ctx.lineWidth = Math.max(2, size * 0.006);
    // draw the 4 edges, leaving the gate gap on the west edge (x = minX)
    const gx = worldToMap(p.minX, p.minZ, proj).mx;
    if (snap.gate) {
      const g0 = worldToMap(p.minX, snap.gate.z0, proj);
      const g1 = worldToMap(p.minX ?? p.minX, snap.gate.z1, proj);
      ctx.beginPath(); ctx.moveTo(b.mx, a.my); ctx.lineTo(b.mx, b.my); // east
      ctx.moveTo(a.mx, a.my); ctx.lineTo(b.mx, a.my); // north (minZ)
      ctx.moveTo(a.mx, b.my); ctx.lineTo(b.mx, b.my); // south (maxZ)
      ctx.moveTo(gx, a.my); ctx.lineTo(gx, g1.my); // west top
      ctx.moveTo(gx, g0.my); ctx.lineTo(gx, b.my); // west bottom
      ctx.stroke();
    } else {
      ctx.strokeRect(a.mx, a.my, b.mx - a.mx, b.my - a.my);
    }
  }
  if (snap.barn) {
    const a = worldToMap(snap.barn.minX, snap.barn.minZ, proj);
    const b = worldToMap(snap.barn.maxX, snap.barn.maxZ, proj);
    ctx.fillStyle = "#b3402f";
    ctx.fillRect(a.mx, a.my, b.mx - a.mx, b.my - a.my);
    ctx.strokeStyle = "#7a2c22";
    ctx.lineWidth = Math.max(1, size * 0.003);
    ctx.strokeRect(a.mx, a.my, b.mx - a.mx, b.my - a.my);
  }

  // fences
  ctx.strokeStyle = "#7a5a3a";
  ctx.lineWidth = Math.max(1.5, size * 0.004);
  for (const f of snap.fences) {
    if (f.pts.length < 2) continue;
    ctx.beginPath();
    f.pts.forEach((p, i) => {
      const m = worldToMap(p.x, p.z, proj);
      if (i === 0) ctx.moveTo(m.mx, m.my);
      else ctx.lineTo(m.mx, m.my);
    });
    ctx.stroke();
  }

  // world-editor placed objects (trees/barns/etc.) — cheap emoji glyphs
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const o of snap.objects) {
    const m = worldToMap(o.x, o.z, proj);
    ctx.font = `${size * 0.04}px system-ui, sans-serif`;
    ctx.fillText(o.emoji, m.mx, m.my);
  }

  return cv;
}

/** Draw one full frame of the Farm Map into `ctx` (size x size square). */
export function drawFarmMap(ctx: CanvasRenderingContext2D, size: number, snap: FarmMapSnapshot, tSec: number): void {
  const proj = makeProj(size, snap.half, size * 0.03);
  const sig = JSON.stringify({ size, half: snap.half, edge: snap.edge, field: snap.field, pond: snap.pond, fences: snap.fences, objects: snap.objects, pasture: snap.pasture, barn: snap.barn, gate: snap.gate });
  if (!bg || bgSig !== sig) {
    bg = buildBackground(size, proj, snap);
    bgSig = sig;
  }
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(bg, 0, 0);

  // tilled-soil patches (organic blobs, live)
  if (snap.patches) {
    ctx.fillStyle = "rgba(120,84,52,.85)";
    for (const p of snap.patches) {
      const c = worldToMap(p.x, p.z, proj);
      ctx.beginPath();
      ctx.arc(c.mx, c.my, Math.max(1, worldLenToMap(p.r, proj)), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // free-form plants — dots, gold pulse when ready (live)
  const dotR = Math.max(1.5, size * 0.006);
  for (const p of snap.plants) {
    const c = worldToMap(p.x, p.z, proj);
    if (p.ready) {
      ctx.globalAlpha = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(tSec * 4));
      ctx.fillStyle = "#ffd35a";
    } else {
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#5f8a45";
    }
    ctx.beginPath();
    ctx.arc(c.mx, c.my, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const drawEmoji = (dot: MapEmojiDot, fontPx: number) => {
    const m = worldToMap(dot.x, dot.z, proj);
    ctx.font = `${fontPx}px system-ui, sans-serif`;
    ctx.fillText(dot.emoji, m.mx, m.my);
  };
  for (const d of snap.decor) drawEmoji(d, size * 0.032);
  for (const s of snap.stations) drawEmoji(s, size * 0.05);
  for (const a of snap.animals) drawEmoji(a, size * 0.038);
  // enterable-building door markers
  if (snap.doors) for (const d of snap.doors) drawEmoji(d, size * 0.03);

  // barn door state + eggs waiting (live) — a small marker at the door + a count
  if (snap.barn) {
    const doorX = (snap.barn.minX + snap.barn.maxX) / 2;
    const m = worldToMap(doorX, snap.barn.minZ, proj);
    ctx.beginPath();
    ctx.arc(m.mx, m.my, size * 0.012, 0, Math.PI * 2);
    ctx.fillStyle = snap.doorOpen ? "#7bd67b" : "#c96a5a";
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.5)";
    ctx.lineWidth = 1;
    ctx.stroke();
    if (snap.eggCount && snap.eggCount > 0) {
      const bc = worldToMap((snap.barn.minX + snap.barn.maxX) / 2, (snap.barn.minZ + snap.barn.maxZ) / 2, proj);
      ctx.font = `${size * 0.03}px system-ui, sans-serif`;
      ctx.fillStyle = "#fff";
      ctx.fillText(`🥚${snap.eggCount}`, bc.mx, bc.my);
    }
  }

  // players: remotes first, self drawn last (on top)
  for (const p of snap.players) {
    if (p.self) continue;
    const m = worldToMap(p.x, p.z, proj);
    ctx.beginPath();
    ctx.arc(m.mx, m.my, size * 0.017, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.55)";
    ctx.lineWidth = Math.max(1, size * 0.003);
    ctx.stroke();
    if (p.name) {
      ctx.font = `bold ${size * 0.026}px system-ui, sans-serif`;
      ctx.fillStyle = "#1a2410";
      ctx.fillText(p.name, m.mx, m.my - size * 0.03);
    }
  }
  const self = snap.players.find((p) => p.self);
  if (self) {
    const m = worldToMap(self.x, self.z, proj);
    const pts = arrowPoints(m.mx, m.my, self.heading, size * 0.028, size * 0.036);
    ctx.beginPath();
    ctx.moveTo(pts.tip.x, pts.tip.y);
    ctx.lineTo(pts.left.x, pts.left.y);
    ctx.lineTo(pts.right.x, pts.right.y);
    ctx.closePath();
    ctx.fillStyle = self.color;
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = Math.max(1.5, size * 0.005);
    ctx.stroke();
    // white "you are here" ring
    ctx.beginPath();
    ctx.arc(m.mx, m.my, size * 0.024, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,.9)";
    ctx.lineWidth = Math.max(1.5, size * 0.004);
    ctx.stroke();
  }
}
