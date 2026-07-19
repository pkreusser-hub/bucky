# Gator 3D rebuild v3 — frame-safe. ALL constants below are in the FINAL game frame
# (glTF Y-up, forward=+Z) expressed in Blender coords via game(X,Y,Z) -> blender(X,-Z,Y).
# Ground truth measured from the original GLB by tools/_gator_measure.mjs:
#   wheelbase 0.528 (fwd), track 0.459, tire r 0.156, axle height y=-0.196, floor y=-0.346
import bpy, bmesh, sys, math
from mathutils import Vector, Matrix

def sel_only(o):
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o

SRC_BODY  = "assets/farmkart/gator3d/74f9d95f-76d9-4ff5-b3ca-898c76d716d9-pbr_model.glb"
SRC_WHEEL = "assets/farmkart/gator3d/wheel/f90ef504-1ef0-4800-af5a-0a162a55e3c6-pbr_model.glb"
DST       = "assets/farmkart/farmkart-gator3d.glb"

# final-frame blender coords (x, -z_game, y_game)
# v3.1: axle height/tire size CORRECTED from renders — true tire r=0.20, axle z=-0.146
# (tire bottoms define the floor at -0.346; the first guess of r=0.156 left crown remnants)
AXLES = {   # name: (bx, by, bz)
    "Wheel_FL": (-0.2295, -0.265, -0.146),
    "Wheel_FR": ( 0.2295, -0.265, -0.146),
    "Wheel_BL": (-0.2295,  0.263, -0.146),
    "Wheel_BR": ( 0.2295,  0.263, -0.146),
}
TIRE_R      = 0.200
DEL_R       = 0.235     # face-delete radial reach (y,z plane around axle, axis = blender X)
DEL_HALF_W  = 0.200     # |x - ax| reach
DEL_TOP     = 0.200     # cut cylinder above axle_z + this (protect fender crown)
SWEEP_R     = 0.270     # loose-island sweep radius
WHEEL_DIA   = 0.420     # slightly larger than original 0.40 so it covers any crown remnant
WHEEL_W_MAX = 0.300
STEER_POS   = Vector((0.000, -0.110, 0.205))   # measured ring center (blender-final)
STEER_SPLIT_R = 0.140
BODY_TRIS   = 27000
FLOOR_BZ    = -0.356    # ground line = new wheel bottoms (-0.146 - 0.21)

def log(*a): print("[v3]", *a)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC_BODY)
body = [o for o in bpy.data.objects if o.type == "MESH"][0]
body.name = "GatorBody"
for o in list(bpy.data.objects):
    if o != body and o.type != "MESH":
        # flatten any importer wrapper empties: keep transforms
        pass
sel_only(body)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# ---- bake -90deg about blender Z: original forward +X -> -Y(blender) = +Z(game) ----
# direct mesh-data transform: cannot silently no-op like selection-dependent ops
body.data.transform(Matrix.Rotation(-math.pi/2, 4, "Z"))
body.data.update()
mn = [min(v.co[i] for v in body.data.vertices) for i in range(3)]
mx = [max(v.co[i] for v in body.data.vertices) for i in range(3)]
log("post-rot body bbox min", [round(v,3) for v in mn], "max", [round(v,3) for v in mx])
# sanity: forward axis (blender Y) must now be the LONG horizontal axis
assert (mx[1]-mn[1]) > (mx[0]-mn[0]), "rotation bake wrong: Y not the long axis"

# ---- pre-decimate so color sampling + face loops run on a sane mesh ----
tris0 = sum(len(p.vertices) - 2 for p in body.data.polygons)
m = body.modifiers.new("pre", "DECIMATE"); m.ratio = min(1.0, 150000 / max(tris0, 1))
sel_only(body)
bpy.ops.object.modifier_apply(modifier="pre")
log("pre-decimate", tris0, "->", sum(len(p.vertices)-2 for p in body.data.polygons))

# ---- texture darkness lookup (tires are near-black, body is green — color separates
#      what geometry cannot: the tires tuck under the hood edges) ----
teximg = None
for mat in body.data.materials:
    if not mat or not mat.use_nodes: continue
    for n in mat.node_tree.nodes:
        if n.type == "TEX_IMAGE" and n.image and "Color" in n.image.name:
            teximg = n.image
if teximg is None:
    for n2 in bpy.data.images:
        if "Color" in n2.name: teximg = n2
assert teximg, "no basecolor texture found"
if teximg.size[0] > 1024: teximg.scale(1024, 1024)
import numpy as np
TW, TH = teximg.size
px = np.asarray(teximg.pixels[:], dtype=np.float32).reshape(TH, TW, 4)
def uv_value(uv):
    u = uv.x % 1.0; v = uv.y % 1.0
    p = px[min(TH-1, int(v*TH)), min(TW-1, int(u*TW))]
    return max(p[0], p[1], p[2])

def uv_tirelike(uv):
    # tire rubber = NEUTRAL (r~g~b) and not bright; body green/yellow = saturated
    u = uv.x % 1.0; v = uv.y % 1.0
    p = px[min(TH-1, int(v*TH)), min(TW-1, int(u*TW))]
    mxc = max(p[0], p[1], p[2]); mnc = min(p[0], p[1], p[2])
    sat = (mxc - mnc) / (mxc + 1e-4)
    return bool(sat < 0.30 and mxc < 0.40)

# ---- sampling sanity probe: known locations must read the expected colors ----
log("teximg:", teximg.name, teximg.size[:], "channels", teximg.channels)
gmask = (px[:,:,1] > 1.3*px[:,:,0]) & (px[:,:,1] > 1.3*px[:,:,2])
log("green fraction of texture:", round(float(gmask.mean()), 3))
_probe_bm = bmesh.new(); _probe_bm.from_mesh(body.data)
_uvlp = _probe_bm.loops.layers.uv.active
probes = { "hood": Vector((0.0, -0.38, -0.02)), "seat": Vector((0.0, 0.12, 0.16)), "tireBL": Vector((-0.23, 0.263, -0.28)) }
for pname, ppos in probes.items():
    bestf, bd = None, 1e9
    for f in _probe_bm.faces:
        d = (f.calc_center_median() - ppos).length
        if d < bd: bd = d; bestf = f
    uv = bestf.loops[0][_uvlp].uv
    u = uv.x % 1.0; vv = uv.y % 1.0
    p = px[min(TH-1, int(vv*TH)), min(TW-1, int(u*TW))]
    log(f"probe {pname}: dist {bd:.3f} uv ({u:.3f},{vv:.3f}) rgb ({p[0]:.3f},{p[1]:.3f},{p[2]:.3f})")
_probe_bm.free()

# ---- ISLAND-LEVEL tire removal: the Tripo mesh is shell soup (1000+ loose parts).
# Decide per ISLAND: neutral-colored shells near an axle = tire hardware -> delete whole;
# saturated (green/yellow) shells = body panels -> keep wherever they are;
# mixed islands (tire welded to fender) -> per-face fallback inside the wheel region only.
sel_only(body)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.separate(type="LOOSE")
bpy.ops.object.mode_set(mode="OBJECT")
parts = [o for o in bpy.data.objects if o.type == "MESH"]
log("island count:", len(parts))
keep = []
del_islands = 0; mixed_islands = 0
for o in parts:
    me = o.data
    n = len(me.vertices)
    cx = sum(v.co.x for v in me.vertices)/n; cy = sum(v.co.y for v in me.vertices)/n; cz = sum(v.co.z for v in me.vertices)/n
    inRegion = any(abs(cx-ax) < 0.24 and math.hypot(cy-ay, cz-az) < 0.26 for (ax,ay,az) in AXLES.values())
    hubCore  = any(abs(cx-ax) < 0.20 and math.hypot(cy-ay, cz-az) < 0.14 for (ax,ay,az) in AXLES.values())
    if not inRegion:
        keep.append(o); continue
    # sample island color
    bmx = bmesh.new(); bmx.from_mesh(me)
    uvx = bmx.loops.layers.uv.active
    faces = bmx.faces[:]
    step = max(1, len(faces)//60)
    samp = faces[::step]
    frac = sum(1 for f in samp if uv_tirelike(f.loops[0][uvx].uv)) / max(1, len(samp))
    if hubCore or frac > 0.60:
        del_islands += 1
        bmx.free()
        bpy.data.objects.remove(o, do_unlink=True)
        continue
    if frac > 0.25:
        # mixed shell: per-face removal inside the wheel volume only
        mixed_islands += 1
        to_del = []
        for f in bmx.faces:
            c = f.calc_center_median()
            near = any(abs(c.x-ax) < DEL_HALF_W + 0.02 and math.hypot(c.y-ay, c.z-az) < DEL_R + 0.012
                       for (ax,ay,az) in AXLES.values())
            if near and uv_tirelike(f.loops[0][uvx].uv): to_del.append(f)
        bmesh.ops.delete(bmx, geom=to_del, context="FACES")
        bmx.to_mesh(me)
    bmx.free()
    keep.append(o)
log("islands deleted:", del_islands, "mixed:", mixed_islands, "kept:", len(keep))
# drop empty leftovers, rejoin
keep = [o for o in keep if len(o.data.vertices) > 0]
bpy.ops.object.select_all(action="DESELECT")
for o in keep: o.select_set(True)
bpy.context.view_layer.objects.active = keep[0]
bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
body.name = "GatorBody"

# ---- SPLIT the original steering wheel into its own node (v1 approach — it worked) ----
# dark-gated: ring+column are black, the cowl beneath is green — keep the cowl on the body
bm = bmesh.new(); bm.from_mesh(body.data)
uvl = bm.loops.layers.uv.active
sel_flags = []
for f in bm.faces:
    inR = (f.calc_center_median() - STEER_POS).length < STEER_SPLIT_R
    sel_flags.append(bool(inR and uv_tirelike(f.loops[0][uvl].uv)))
bm.free()
inR_n = 0; dark_n = 0; vals = []
bm2 = bmesh.new(); bm2.from_mesh(body.data)
uvl2 = bm2.loops.layers.uv.active
for f in bm2.faces:
    if (f.calc_center_median() - STEER_POS).length < STEER_SPLIT_R:
        inR_n += 1; v = uv_value(f.loops[0][uvl2].uv); vals.append(round(v,2))
        if uv_tirelike(f.loops[0][uvl2].uv): dark_n += 1
bm2.free()
vals.sort()
log("steer probe: inSphere", inR_n, "dark", dark_n, "value spread", vals[:5], "...", vals[-5:] if len(vals)>5 else "")
for f, s in zip(body.data.polygons, sel_flags):
    f.select = s
sel_only(body)
bpy.context.tool_settings.mesh_select_mode = (False, False, True)
pre_split = set(bpy.data.objects)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.separate(type="SELECTED")
bpy.ops.object.mode_set(mode="OBJECT")
sw = [o for o in bpy.data.objects if o not in pre_split][0]
sw.name = "SteerWheel"
log("steering wheel split:", len(sw.data.polygons), "faces")
assert len(sw.data.polygons) > 200, "steering split too small — center wrong?"
bpy.context.scene.cursor.location = STEER_POS
sel_only(sw)
bpy.ops.object.origin_set(type="ORIGIN_CURSOR")

# ---- decimate body ----
tris_now = sum(len(p.vertices) - 2 for p in body.data.polygons)
ratio = min(1.0, BODY_TRIS / max(tris_now, 1))
m = body.modifiers.new("dec", "DECIMATE"); m.ratio = ratio
bpy.context.view_layer.objects.active = body
bpy.ops.object.modifier_apply(modifier="dec")
log("body tris", tris_now, "->", sum(len(p.vertices)-2 for p in body.data.polygons), "ratio", round(ratio,4))

# ---- texture: 1024 basecolor only, metallic 0 ----
for img in bpy.data.images:
    if img.size[0] > 1024: img.scale(1024, 1024)
for mat in body.data.materials:
    if not mat or not mat.use_nodes: continue
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if not bsdf: continue
    bsdf.inputs["Metallic"].default_value = 0.0
    for inp in ("Normal", "Roughness"):
        for l in list(bsdf.inputs[inp].links):
            mat.node_tree.links.remove(l)

# ---- clean wheel ----
pre = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=SRC_WHEEL)
wnew = [o for o in bpy.data.objects if o not in pre and o.type == "MESH"]
# join if multi-part
for o in wnew: o.select_set(True)
bpy.context.view_layer.objects.active = wnew[0]
if len(wnew) > 1: bpy.ops.object.join()
wheel = bpy.context.view_layer.objects.active
wheel.name = "WheelProto"
sel_only(wheel)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

def wdims(o):
    xs=[v.co.x for v in o.data.vertices]; ys=[v.co.y for v in o.data.vertices]; zs=[v.co.z for v in o.data.vertices]
    return [max(xs)-min(xs), max(ys)-min(ys), max(zs)-min(zs)], [ (max(xs)+min(xs))/2, (max(ys)+min(ys))/2, (max(zs)+min(zs))/2 ]
dims, ctr = wdims(wheel)
axle_axis = dims.index(min(dims))
log("wheel dims", [round(d,3) for d in dims], "axle axis", "XYZ"[axle_axis])
if axle_axis == 1:   wheel.data.transform(Matrix.Rotation(math.pi/2, 4, "Z"))
elif axle_axis == 2: wheel.data.transform(Matrix.Rotation(math.pi/2, 4, "Y"))
wheel.data.update()
dims, ctr = wdims(wheel)
wheel.data.transform(Matrix.Translation(Vector([-c for c in ctr])))   # center at origin
dims, ctr = wdims(wheel)
s = WHEEL_DIA / max(dims[1], dims[2])
wheel.data.transform(Matrix.Diagonal((s, s, s, 1)))
dims, ctr = wdims(wheel)
if dims[0] > WHEEL_W_MAX:
    wheel.data.transform(Matrix.Diagonal((WHEEL_W_MAX / dims[0], 1, 1, 1)))
wheel.data.update()
dims, ctr = wdims(wheel)
assert dims.index(min(dims)) == 0 and abs(max(dims[1],dims[2]) - WHEEL_DIA) < 0.01, f"wheel orient/scale wrong: {dims}"
log("wheel final dims", [round(d,3) for d in wheel.dimensions])
# decimate wheel to ~7k tris
wt = sum(len(p.vertices)-2 for p in wheel.data.polygons)
m = wheel.modifiers.new("dec", "DECIMATE"); m.ratio = min(1.0, 7000 / max(wt,1))
bpy.context.view_layer.objects.active = wheel
bpy.ops.object.modifier_apply(modifier="dec")
log("wheel tris", wt, "->", sum(len(p.vertices)-2 for p in wheel.data.polygons))
# flat materials: tire charcoal / hub vibrant yellow (game accent 0xf2c53d)
wheel.data.materials.clear()
mt = bpy.data.materials.new("GatorTire");  mt.use_nodes = True
mt.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.028, 0.028, 0.033, 1)
mt.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1.0
mh = bpy.data.materials.new("GatorHub");   mh.use_nodes = True
mh.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.890, 0.556, 0.043, 1)
mh.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.6
wheel.data.materials.append(mt); wheel.data.materials.append(mh)
hubR = 0.45 * WHEEL_DIA / 2
for p in wheel.data.polygons:
    c = p.center
    p.material_index = 1 if math.hypot(c.y, c.z) < hubR else 0
# 4 linked copies at axles (shared mesh data = identical geometry)
wheel_objs = []
for name, (ax, ay, az) in AXLES.items():
    w = wheel.copy()          # linked duplicate (shares .data)
    w.name = name
    w.location = (ax, ay, az)
    if ax > 0:
        # right side: real copy with the 180° mirror baked into the DATA (identity node quat)
        w.data = wheel.data.copy()
        w.data.transform(Matrix.Rotation(math.pi, 4, "Z"))
        w.data.update()
    bpy.context.collection.objects.link(w)
    wheel_objs.append(w)
bpy.data.objects.remove(wheel, do_unlink=True)


# ---- assemble hierarchy: body origin at ground-center, children parented ----
bpy.context.scene.cursor.location = (0, 0, FLOOR_BZ)
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True); bpy.context.view_layer.objects.active = body
bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
for o in wheel_objs + [sw]:
    o.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.parent_set(type="OBJECT", keep_transform=True)

# ---- assert (the v1 bug guarantee, color-aware): no TIRELIKE-colored faces left in the
# tire zone. Green fender undersides legitimately interpenetrate the tires (they did in
# the original too — invisible); leftover NEUTRAL rubber fragments are the actual bug.
bad = 0; greenInZone = 0
bmA = bmesh.new(); bmA.from_mesh(body.data)
uvA = bmA.loops.layers.uv.active
for f in bmA.faces:
    c = f.calc_center_median()
    for (ax, ay, az) in AXLES.values():
        if abs(c.x - ax) >= WHEEL_W_MAX/2: continue
        r = math.hypot(c.y - ay, c.z - az)
        if r < TIRE_R * 0.9:
            if uv_tirelike(f.loops[0][uvA].uv): bad += 1
            else: greenInZone += 1
            break
bmA.free()
log("tirelike faces in tire zone:", bad, "| saturated faces in zone (fenders, ok):", greenInZone)
assert bad < 40, f"{bad} tirelike faces still in the tire zone"

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=DST, export_format="GLB", export_yup=True, export_animations=False)
log("EXPORTED", DST)

# ---- workbench renders for eyeball ----
import os
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.render.resolution_x = 900; scene.render.resolution_y = 700
bpy.ops.object.light_add(type="SUN", location=(2,2,4))
cam_data = bpy.data.cameras.new("c"); cam = bpy.data.objects.new("cam", cam_data)
bpy.context.collection.objects.link(cam); scene.camera = cam
SHOTS = "C:/Users/pkreu/AppData/Local/Temp/claude/C--Users-pkreu-OneDrive-Documents-BUCKY/460d3b7d-7fef-4760-9513-9eda1fbc67b4/scratchpad/"
views = { "front34": (1.2, -1.5, 0.7), "rear34": (1.2, 1.5, 0.7), "side": (1.8, 0, 0.25), "top": (0.01, -0.01, 2.2) }
for name, pos in views.items():
    cam.location = pos
    d = (Vector((0, 0, -0.05)) - Vector(pos)).normalized()
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = SHOTS + "gv3_" + name + ".png"
    bpy.ops.render.render(write_still=True)
    log("render", name)
