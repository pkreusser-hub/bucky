# _fs_dk_rig.py — FARMSTEAD dwarf+knight look adoption, STEP 2: RIG THE KNIGHT.
#
#   "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" -b \
#       --factory-startup -noaudio -P tools/_fs_dk_rig.py -- <repo> [--limit N] [--armRot D]
#
# WHY THIS EXISTS. The 2026-08-01 look test baked the knight with a RIGID
# geometric hip split and it failed honestly: plate armour has no cloth give, so
# the mail hem separated from the greaves at stride. Sprites remove that
# constraint — a bake photographs a mesh, and a SKINNED mesh deforms. So the
# knight gets a real skin here, by SKELETON TRANSFER from the dwarf: the dwarf
# ships the exact Tripo v1.0-20240301 41-joint biped the shipped villager uses,
# which is a correct reference skeleton in the right naming scheme, and both
# models are T-pose humanoids from the same stylisation family.
#
# THE FIT IS MEASURED, NOT GUESSED (tools/_fs_dk_measure.mjs writes landmarks.json):
#   dwarf  H 0.9049  crotch 0.2149 (23.8%)  armline 0.5618  armHalfSpan 0.4988  legCentre ±0.105
#   knight H 0.9935  crotch 0.2277 (22.9%)  armline 0.5837  armHalfSpan 0.4972  legCentre ±0.106
# Horizontally they are the same character (leg centres and arm spans agree to
# ~1%), so the transfer is a piecewise-linear HEIGHT remap through those three
# landmarks and no horizontal scaling at all. That is why this transfer is
# trustworthy rather than hopeful.
#
# WEIGHT CLEANING. Armour plates want to be near-rigid or they rubber-band, so
# every *Twist* bone and Root are marked non-deform BEFORE auto-weighting (the
# pose code only ever drives Thigh/Upperarm/Forearm anyway) and the result is
# limited to --limit influences per vertex and re-normalised. Judge the outcome
# from the RENDERS this script writes, never from a wireframe.
#
# OUTPUT
#   assets/farmstead/cast/dwarfknight/dwarf-rigged.glb    (0.79 tall, Icosphere dropped)
#   assets/farmstead/cast/dwarfknight/knight-rigged.glb   (0.9985 tall, newly skinned)
#   assets/farmstead/cast/dwarfknight/rig.json            (what was done, measured)
#   assets/farmstead/cast/dwarfknight/_inspect/*.png      (rest / stride / work previews)
import bpy, sys, os, json, math, mathutils
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
REPO = argv[0].replace("\\", "/")
def opt(name, dflt):
    return argv[argv.index("--" + name) + 1] if ("--" + name) in argv else dflt
LIMIT = int(opt("limit", "2"))
ARM_ROT = float(opt("armRot", "72"))          # degrees the T-pose arms swing DOWN
KNIGHT_STRIDE_MUL = float(opt("knightStride", "0.62"))
LEG_SWING = 0.52                               # fs-render pushLegs, verbatim

DK = REPO + "/assets/farmstead/cast/dwarfknight"
INSPECT = DK + "/_inspect"
os.makedirs(INSPECT, exist_ok=True)
LM = json.load(open(DK + "/landmarks.json"))["models"]

DWARF_H = 0.79        # the shipped serf height (FSModels' minifig serf)
KNIGHT_H = 0.9985     # the shipped knight height, incl. plume

TWIST = "Twist"
POSE_BONES = ("L_Thigh", "R_Thigh", "L_Upperarm", "R_Upperarm", "L_Forearm", "R_Forearm")

log = []
def say(*a):
    s = " ".join(str(x) for x in a)
    log.append(s)
    print(s)

# ─────────────────────────────────────────────────────────────── scene setup
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]

dwarf_objs = import_glb(DK + "/src/dwarf.glb")
dwarf_arm = next(o for o in dwarf_objs if o.type == 'ARMATURE')
dwarf_meshes = [o for o in dwarf_objs if o.type == 'MESH']
# the real body is the primitive with the most vertices; the file also carries a
# stray 42-vertex Icosphere (a marketplace leftover)
dwarf_mesh = max(dwarf_meshes, key=lambda o: len(o.data.vertices))
for o in dwarf_meshes:
    if o is not dwarf_mesh:
        say("dropping stray object", o.name, len(o.data.vertices), "verts")
        bpy.data.objects.remove(o, do_unlink=True)

knight_objs = import_glb(DK + "/src/knight.glb")
knight_mesh = max((o for o in knight_objs if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
knight_mesh.name = "KnightBody"
dwarf_mesh.name = "DwarfBody"
dwarf_arm.name = "DwarfArmature"
say("imported dwarf:", dwarf_mesh.name, len(dwarf_mesh.data.vertices), "verts, armature",
    len(dwarf_arm.data.bones), "bones ·  knight:", knight_mesh.name, len(knight_mesh.data.vertices), "verts")

# the knight node carries a small offset; bake it so the mesh sits on the origin
knight_mesh.data.transform(Matrix.Translation(knight_mesh.location))
knight_mesh.location = (0, 0, 0)

# ───────────────────────────────────────────── the measured piecewise height map
D, K = LM["dwarf"], LM["knight"]
BREAK = [(0.0, 0.0), (D["crotchY"], K["crotchY"]), (D["armY"], K["armY"]), (D["height"], K["height"])]
def remap_z(z):
    """dwarf-space height -> knight-space height, piecewise-linear through the
    three measured landmarks (ground / crotch / arm line / crown)."""
    for i in range(len(BREAK) - 1):
        a, b = BREAK[i], BREAK[i + 1]
        if z <= b[0] or i == len(BREAK) - 2:
            t = (z - a[0]) / (b[0] - a[0])
            return a[1] + t * (b[1] - a[1])
    return z
say("height map breakpoints (dwarf -> knight):", ["%.4f->%.4f" % p for p in BREAK])
say("  segment scales:", ["%.4f" % ((BREAK[i+1][1]-BREAK[i][1])/(BREAK[i+1][0]-BREAK[i][0])) for i in range(3)])

# ───────────────────────────────────────────────────── the transferred armature
bpy.ops.object.select_all(action='DESELECT')
dwarf_arm.select_set(True)
bpy.context.view_layer.objects.active = dwarf_arm
bpy.ops.object.duplicate()
knight_arm = bpy.context.view_layer.objects.active
knight_arm.name = "KnightArmature"
knight_arm.data.name = "KnightSkeleton"

def edit_bones_transform(arm_obj, fn):
    """apply fn(Vector)->Vector to every edit bone head/tail. Direct data edit;
    operators here are selection-dependent and silently no-op headless."""
    bpy.ops.object.select_all(action='DESELECT')
    arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode='EDIT')
    for eb in arm_obj.data.edit_bones:
        h, t, roll = fn(eb.head.copy()), fn(eb.tail.copy()), eb.roll
        eb.head, eb.tail, eb.roll = h, t, roll
    bpy.ops.object.mode_set(mode='OBJECT')

# 1. fit the duplicate to the knight (Blender is Z-up after the glTF import, so
#    glTF height Y is Blender Z)
edit_bones_transform(knight_arm, lambda v: Vector((v.x, v.y, remap_z(v.z))))
# 2. scale BOTH models to their shipped heights. Uniform on the mesh data AND the
#    edit bones keeps the rest pose consistent, so the (already bound) dwarf skin
#    is unaffected and the knight binds at final size.
kD = DWARF_H / D["height"]
kK = KNIGHT_H / K["height"]
dwarf_mesh.data.transform(Matrix.Scale(kD, 4))
edit_bones_transform(dwarf_arm, lambda v: v * kD)
knight_mesh.data.transform(Matrix.Scale(kK, 4))
edit_bones_transform(knight_arm, lambda v: v * kK)
say("scaled dwarf x%.5f -> %.4f tall · knight x%.5f -> %.4f tall" % (kD, DWARF_H, kK, KNIGHT_H))

# 3. only the primary chain deforms. Twist bones and Root add nothing but noise
#    to a heat-map solve, and the pose code never touches them.
ndeform = 0
for b in knight_arm.data.bones:
    if TWIST in b.name or b.name == "Root":
        b.use_deform = False
        ndeform += 1
say("marked %d twist/root bones non-deform before auto-weighting" % ndeform)

# ───────────────────────────────────────────────────────── bind with auto weights
def weight_coverage(mesh_obj):
    """fraction of vertices carrying ANY weight. Bone heat reports its failure as
    a WARNING, not an exception — `parent_set` returns FINISHED and leaves an
    unweighted mesh, which then exports with no skin at all and reads downstream
    as 'the knight just does not animate'. Measure, never assume."""
    n = sum(1 for v in mesh_obj.data.vertices if any(g.weight > 0 for g in v.groups))
    return n / max(1, len(mesh_obj.data.vertices))

# a heat solve wants clean topology; give it the best chance before judging it
bpy.ops.object.select_all(action='DESELECT')
knight_mesh.select_set(True)
bpy.context.view_layer.objects.active = knight_mesh
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=1e-5)
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode='OBJECT')
say("knight mesh cleaned for the solve: %d verts" % len(knight_mesh.data.vertices))

bpy.ops.object.select_all(action='DESELECT')
knight_mesh.select_set(True)
knight_arm.select_set(True)
bpy.context.view_layer.objects.active = knight_arm
bound = "ARMATURE_AUTO"
try:
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
except Exception as e:
    say("!! ARMATURE_AUTO raised (%s)" % e)
cov = weight_coverage(knight_mesh)
say("ARMATURE_AUTO (bone heat) coverage: %.1f%% of vertices weighted" % (cov * 100))

if cov < 0.98:
    # ── FALLBACK: nearest-bone-segment weights, computed here.
    # Bone heat solves a Laplacian over the surface and gives up on this sculpt
    # (a Tripo shell with interior geometry — the same shell-soup class of mesh
    # the Farm Kart gator rebuild hit). What armour wants anyway is NEAR-RIGID
    # plates with a soft band only at the joints, which is exactly what a
    # nearest-segment field with a narrow blend produces — and unlike a heat
    # solve it is deterministic and inspectable.
    say("!! bone heat did not solve this mesh — computing nearest-segment weights instead")
    bpy.ops.object.select_all(action='DESELECT')
    knight_mesh.select_set(True)
    knight_arm.select_set(True)
    bpy.context.view_layer.objects.active = knight_arm
    bpy.ops.object.parent_set(type='ARMATURE_NAME')     # modifier + empty groups
    bound = "nearestSegment"

    BLEND = 0.35            # a vertex this much closer than the runner-up is fully rigid
    LEG_PRIOR = 1.4         # per metre above the crotch, how much leg bones are penalised
    SIDE_PRIOR = 0.9        # per metre on the wrong side of the midline
    crotch_z = K["crotchY"] * kK
    segs = []
    for b in knight_arm.data.bones:
        if not b.use_deform:
            continue
        h, t = b.head_local.copy(), b.tail_local.copy()
        limb = ("Thigh" in b.name or "Calf" in b.name or "Foot" in b.name or "ToeBase" in b.name
                or "Upperarm" in b.name or "Forearm" in b.name or "Hand" in b.name)
        legish = ("Thigh" in b.name or "Calf" in b.name or "Foot" in b.name or "ToeBase" in b.name)
        segs.append({"name": b.name, "h": h, "t": t, "limb": limb, "legish": legish,
                     "side": (1 if h.x > 0.02 else (-1 if h.x < -0.02 else 0))})
    say("weighting against %d deform segments" % len(segs))

    def seg_dist(p, a, b):
        ab = b - a
        L2 = ab.length_squared
        if L2 < 1e-12:
            return (p - a).length
        u = max(0.0, min(1.0, (p - a).dot(ab) / L2))
        return (p - (a + ab * u)).length

    groups = {s["name"]: knight_mesh.vertex_groups.get(s["name"]) for s in segs}
    for s in segs:
        if groups[s["name"]] is None:
            groups[s["name"]] = knight_mesh.vertex_groups.new(name=s["name"])
    for v in knight_mesh.data.vertices:
        p = v.co
        best = []
        for s in segs:
            d = seg_dist(p, s["h"], s["t"])
            # the fauld skirt hangs over the thighs; without this prior a
            # nearest-segment field hands its front panel to the legs and the
            # skirt swings with the stride (the exact tear the rigid split had)
            if s["legish"]:
                d += LEG_PRIOR * max(0.0, p.z - crotch_z)
            if s["limb"] and s["side"] and (p.x * s["side"] < 0):
                d += SIDE_PRIOR * abs(p.x)      # no cross-body bleed
            best.append((d, s["name"]))
        best.sort()
        d1, n1 = best[0]
        d2, n2 = best[1] if len(best) > 1 else best[0]
        if d1 <= 1e-9:
            w1, w2 = 1.0, 0.0
        else:
            tt = min(1.0, max(0.0, (d2 - d1) / (d1 * BLEND)))
            w1 = 0.5 + 0.5 * tt
            w2 = 1.0 - w1
        groups[n1].add([v.index], w1, 'REPLACE')
        if w2 > 0.001 and n2 != n1:
            groups[n2].add([v.index], w2, 'REPLACE')
    cov = weight_coverage(knight_mesh)
    say("nearest-segment coverage: %.1f%%" % (cov * 100))

# clean: cap influences so a plate cannot rubber-band between four bones
bpy.ops.object.select_all(action='DESELECT')
knight_mesh.select_set(True)
bpy.context.view_layer.objects.active = knight_mesh
bpy.ops.object.vertex_group_limit_total(limit=LIMIT)
bpy.ops.object.vertex_group_clean(group_select_mode='ALL', limit=0.02)
bpy.ops.object.vertex_group_normalize_all(lock_active=False)

# ── RIGID PLATES. A pauldron is a steel cap, not a sleeve: with two influences
# the heat solve blends its lower half into the upper arm, and dropping the arm
# 72° out of the T-pose then stretches it into a drooping flap (seen in the
# first render pass — this is the "armour rubber-bands" failure the brief warns
# about). Vertices a bone already OWNS keep it outright.
RIGID = ("Clavicle", "Head")
locked = 0
for v in knight_mesh.data.vertices:
    gs = sorted(v.groups, key=lambda g: -g.weight)
    if not gs:
        continue
    dom = knight_mesh.vertex_groups[gs[0].group].name
    if not any(r in dom for r in RIGID):
        continue
    for g in list(v.groups):
        knight_mesh.vertex_groups[g.group].remove([v.index])
    knight_mesh.vertex_groups[dom].add([v.index], 1.0, 'REPLACE')
    locked += 1
say("locked %d vertices rigid to %s (plates must not rubber-band)" % (locked, "/".join(RIGID)))
say("bound knight with", bound, "· weights limited to %d influences/vertex, cleaned at 0.02, renormalised" % LIMIT)
if weight_coverage(knight_mesh) < 0.999:
    say("!! WARNING: knight still only %.1f%% weighted after cleaning" % (weight_coverage(knight_mesh) * 100))

# what actually got weight, and how concentrated it is
infl = {}
maxw_sum = 0.0
for v in knight_mesh.data.vertices:
    gs = sorted(v.groups, key=lambda g: -g.weight)
    if not gs:
        continue
    n = knight_mesh.vertex_groups[gs[0].group].name
    infl[n] = infl.get(n, 0) + 1
    maxw_sum += gs[0].weight
say("dominant-bone histogram:", json.dumps(dict(sorted(infl.items(), key=lambda kv: -kv[1]))))
say("mean dominant weight %.3f (1.0 = fully rigid per bone)" % (maxw_sum / max(1, len(knight_mesh.data.vertices))))

# ───────────────────────────────────────────────────────────────────── posing
def axis_local(arm_obj, bone_name, axis_arm):
    """`matrix_basis` acts in the bone's own REST frame, so an armature-space
    axis has to be pulled back through matrix_local before it can be used."""
    b = arm_obj.data.bones[bone_name]
    return b.matrix_local.to_3x3().inverted() @ axis_arm

def apply_pose(arm_obj, stride, brace=0.0, arm_swing=0.0, arm_down=ARM_ROT):
    """the game's own pose maths (fs-render pushLegs) on bones instead of rigid
    parts: hips rotate ±stride·LEG_SWING about the model's X axis, plus the fixed
    rest-shape arm drop and (walk only) an arm counter-swing off the same scalar."""
    bpy.ops.object.select_all(action='DESELECT')
    arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode='POSE')
    X = Vector((1, 0, 0))
    Z = Vector((0, 0, 1))                   # Blender Z-up: the model's "down the side" axis
    for pb in arm_obj.pose.bones:
        pb.matrix_basis = Matrix()
    def rot(name, axis_arm, ang):
        if name not in arm_obj.pose.bones:
            return
        a = axis_local(arm_obj, name, axis_arm)
        arm_obj.pose.bones[name].matrix_basis = Matrix.Rotation(ang, 4, a)
    for side, s in (("L", -1), ("R", 1)):
        rot(side + "_Thigh", X, stride * LEG_SWING * s + brace * 0.22 * (-s))
        # arms: T-pose -> down the sides is a rotation about the model's fore-aft
        # (Blender Y) axis; sign mirrors per side
        ay = Vector((0, 1, 0))
        rot(side + "_Upperarm", ay, math.radians(arm_down) * (1 if side == "L" else -1))
    # counter-swing: arms follow the SAME sin(phase) the legs do, opposite sign
    if arm_swing:
        for side, s in (("L", -1), ("R", 1)):
            pb = arm_obj.pose.bones.get(side + "_Upperarm")
            if not pb:
                continue
            a1 = axis_local(arm_obj, side + "_Upperarm", Vector((0, 1, 0)))
            a2 = axis_local(arm_obj, side + "_Upperarm", Vector((1, 0, 0)))
            pb.matrix_basis = (Matrix.Rotation(math.radians(arm_down) * (1 if side == "L" else -1), 4, a1)
                               @ Matrix.Rotation(-arm_swing * s, 4, a2))
    bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode='OBJECT')

# ────────────────────────────────────────────────────────────────── previews
def setup_render(w=560, h=700):
    scene.render.engine = 'BLENDER_WORKBENCH'          # headless EEVEE fails here
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.film_transparent = False
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'TEXTURE'
    scene.display.shading.show_shadows = False
    scene.world = bpy.data.worlds.new("W") if not scene.world else scene.world
    scene.world.color = (1, 1, 1)

def place_cam(target, dist, pitch_deg, yaw_deg):
    cam = bpy.data.objects.get("PreviewCam")
    if not cam:
        cam = bpy.data.objects.new("PreviewCam", bpy.data.cameras.new("PreviewCam"))
        scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = dist
    p, y = math.radians(pitch_deg), math.radians(yaw_deg)
    d = Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))
    cam.location = Vector(target) + d * 6
    cam.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()

def render_to(path):
    scene.render.filepath = os.path.abspath(path)      # ALWAYS absolute — a relative
    bpy.ops.render.render(write_still=True)            # path resolves against C:\ headless

def only(objs):
    for o in bpy.data.objects:
        o.hide_render = o not in objs

setup_render()
shots = []
CASES = [
    ("rest", 0.0, 0.0, 0.0),
    ("strideA", 1.0, 0.0, 0.30),
    ("strideB", -1.0, 0.0, -0.30),
    ("work", 0.0, 1.0, 0.0),
]
for name, arm_obj, mesh_obj, h, smul in (("dwarf", dwarf_arm, dwarf_mesh, DWARF_H, 1.0),
                                         ("knight", knight_arm, knight_mesh, KNIGHT_H, KNIGHT_STRIDE_MUL)):
    only([arm_obj, mesh_obj])
    arm_obj.hide_render = True                          # bones must not print over the mesh
    for case, stride, brace, swing in CASES:
        apply_pose(arm_obj, stride * smul, brace, swing * smul)
        for view, yaw in (("front", 0), ("side", 90)):
            place_cam((0, 0, h * 0.5), h * 1.35, 52, yaw)
            f = "%s/%s_%s_%s.png" % (INSPECT, name, case, view)
            render_to(f)
            shots.append(os.path.relpath(f, REPO).replace("\\", "/"))
    apply_pose(arm_obj, 0, 0, 0)

# ───────────────────────────────────────────────────────────────────── export
def export(objs, path):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
        o.hide_render = False
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(
        filepath=os.path.abspath(path), export_format='GLB', use_selection=True,
        export_skins=True, export_animations=False, export_apply=False,
        export_yup=True, export_materials='EXPORT',
    )
    say("wrote", os.path.relpath(path, REPO).replace("\\", "/"),
        "%.1f KB" % (os.path.getsize(path) / 1024.0))

export([dwarf_arm, dwarf_mesh], DK + "/dwarf-rigged.glb")
export([knight_arm, knight_mesh], DK + "/knight-rigged.glb")

json.dump({
    "generated": __import__("datetime").datetime.utcnow().isoformat()[:19] + "Z",
    "method": "skeleton transfer: the dwarf's Tripo v1.0-20240301 41-joint biped, "
              "piecewise-height-fitted to the knight's measured landmarks, bound with " + bound,
    "heightMapBreakpoints": BREAK,
    "segmentScales": [(BREAK[i + 1][1] - BREAK[i][1]) / (BREAK[i + 1][0] - BREAK[i][0]) for i in range(3)],
    "horizontalScale": 1.0,
    "dwarf": {"targetHeight": DWARF_H, "scale": kD, "skin": "source (already bound)"},
    "knight": {"targetHeight": KNIGHT_H, "scale": kK, "bind": bound,
               "limitInfluences": LIMIT, "nonDeformBones": ndeform,
               "meanDominantWeight": maxw_sum / max(1, len(knight_mesh.data.vertices)),
               "dominantBoneHistogram": dict(sorted(infl.items(), key=lambda kv: -kv[1]))},
    "armRotDeg": ARM_ROT, "knightStrideMul": KNIGHT_STRIDE_MUL, "legSwing": LEG_SWING,
    "poseBones": list(POSE_BONES),
    "shots": shots, "log": log,
}, open(DK + "/rig.json", "w"), indent=2)
print("wrote " + DK + "/rig.json")
