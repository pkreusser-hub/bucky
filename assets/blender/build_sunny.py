# Sunny v7 — soft A-pose, thick cube limbs, continuous silhouette, north-star face/colors.
import bpy, math, os
from mathutils import Vector, Euler

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BLEND_OUT = os.path.join(ROOT, "assets", "blender", "sunny.blend")
GLB_OUT = os.path.join(ROOT, "assets", "sunny.glb")
IDLE_OUT = os.path.join(ROOT, "assets", "sunny-idle.glb")
WALK_OUT = os.path.join(ROOT, "assets", "sunny-walk.glb")
SHOTS = os.path.join(ROOT, "shots")
os.makedirs(SHOTS, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 24
scene.frame_start = 1
scene.frame_end = 48


def make_mat(name, rgb, rough=0.88):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    if "Metallic" in bsdf.inputs:
        bsdf.inputs["Metallic"].default_value = 0.0
    if "Emission Strength" in bsdf.inputs:
        bsdf.inputs["Emission Strength"].default_value = 0.0
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.08
    elif "Specular" in bsdf.inputs:
        bsdf.inputs["Specular"].default_value = 0.08
    return m


# North-star saturated (warm peach — pushed so EEVEE doesn't wash gray)
M_SKIN = make_mat("Skin", (1.00, 0.58, 0.38))
M_HAIR = make_mat("Hair", (1.00, 0.26, 0.00), 0.62)
M_SHIRT = make_mat("Shirt", (1.00, 0.78, 0.05), 0.72)
M_OVER = make_mat("Overalls", (0.15, 0.40, 0.98), 0.70)
M_CUFF = make_mat("Cuff", (0.48, 0.70, 1.00), 0.78)
M_STRAP = make_mat("Strap", (0.12, 0.34, 0.92), 0.70)
M_SHOE = make_mat("Shoe", (0.20, 0.10, 0.06), 0.92)
M_EYE = make_mat("Eye", (0.06, 0.04, 0.03), 0.28)
M_BROW = make_mat("Brow", (0.95, 0.28, 0.05), 0.65)
M_MOUTH = make_mat("Mouth", (0.95, 0.34, 0.26), 0.50)
M_POCKET = make_mat("Pocket", (0.12, 0.36, 0.88), 0.70)
M_FRECKLE = make_mat("Freckle", (0.82, 0.40, 0.24), 0.9)
M_BTN = make_mat("Button", (1.00, 0.82, 0.10), 0.45)
M_BG = make_mat("Backdrop", (0.70, 0.88, 0.80), 1.0)
M_FLOOR = make_mat("Floor", (0.76, 0.88, 0.80), 1.0)


def flat(o):
    for p in o.data.polygons:
        p.use_smooth = False


def apply(o):
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def only(o):
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def cube(name, size, loc, mat, bevel=0.016, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.rotation_euler = Euler(rot, "XYZ")
    o.scale = (size[0] * 0.5, size[1] * 0.5, size[2] * 0.5)
    apply(o)
    if bevel > 0:
        m = o.modifiers.new("b", "BEVEL")
        m.width = bevel
        m.segments = 1
        m.limit_method = "ANGLE"
        m.angle_limit = math.radians(32)
        only(o)
        bpy.ops.object.modifier_apply(modifier=m.name)
    flat(o)
    o.data.materials.append(mat)
    return o


def cyl(name, r, depth, loc, mat, verts=8, axis="Z"):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, vertices=verts, location=loc)
    o = bpy.context.active_object
    o.name = name
    if axis == "X":
        o.rotation_euler = (0, math.radians(90), 0)
    elif axis == "Y":
        o.rotation_euler = (math.radians(90), 0, 0)
    apply(o)
    flat(o)
    o.data.materials.append(mat)
    return o


def ico(name, r, loc, mat, subdiv=1, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=r, subdivisions=subdiv, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    apply(o)
    flat(o)
    o.data.materials.append(mat)
    return o


def uvs(name, r, loc, mat, seg=10, rings=7, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=seg, ring_count=rings, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    apply(o)
    flat(o)
    o.data.materials.append(mat)
    return o


def limb_box(name, p0, p1, thick, mat, bevel=0.016, pad=0.08):
    """Thick box along p0→p1, extended by pad both ends — the continuity workhorse."""
    a, b = Vector(p0), Vector(p1)
    d = b - a
    if d.length < 1e-6:
        d = Vector((0, 0, 0.01))
    direction = d.normalized()
    a2 = a - direction * pad
    b2 = b + direction * pad
    mid = (a2 + b2) * 0.5
    length = (b2 - a2).length
    bpy.ops.mesh.primitive_cube_add(size=1, location=mid)
    o = bpy.context.active_object
    o.name = name
    o.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    # Slightly oval cross-section (deeper in Y for front-view thickness)
    o.scale = (thick * 0.52, thick * 0.58, length * 0.5)
    apply(o)
    if bevel > 0:
        m = o.modifiers.new("b", "BEVEL")
        m.width = bevel
        m.segments = 1
        m.limit_method = "ANGLE"
        m.angle_limit = math.radians(32)
        only(o)
        bpy.ops.object.modifier_apply(modifier=m.name)
    flat(o)
    o.data.materials.append(mat)
    return o


def joint_cube(name, loc, size, mat, bevel=0.018):
    """Chunky joint filler (cube, not ico — icos read as floating sausages)."""
    return cube(name, (size, size, size), loc, mat, bevel)


HEAD_Z = 0.84
SHOULDER_Z = 0.58
HIP_Z = 0.30

parts = []


def add(o, bone):
    parts.append((o, bone))
    return o


# ── TORSO — single solid overalls mass (no sausage gaps) ────────────────────
add(cube("Body", (0.42, 0.30, 0.44), (0, 0.02, 0.44), M_OVER, 0.038), "Chest")
add(cube("Hips", (0.44, 0.32, 0.24), (0, 0.02, HIP_Z - 0.01), M_OVER, 0.032), "Hips")
add(cube("Belly", (0.415, 0.295, 0.22), (0, 0.02, 0.36), M_OVER, 0.026), "Spine")
# Crotch bridge so legs never show a gap under torso
add(cube("Crotch", (0.28, 0.26, 0.12), (0, 0.02, 0.22), M_OVER, 0.020), "Hips")

# Yellow shirt — thick collar + chest under straps
add(cube("ShirtChest", (0.40, 0.27, 0.18), (0, 0.03, 0.62), M_SHIRT, 0.020), "Chest")
add(cube("Collar", (0.28, 0.21, 0.09), (0, 0.025, 0.70), M_SHIRT, 0.014), "Chest")

# Straps + buttons + pocket
add(cube("StrapL", (0.078, 0.060, 0.32), (0.10, -0.085, 0.58), M_STRAP, 0.008), "Chest")
add(cube("StrapR", (0.078, 0.060, 0.32), (-0.10, -0.085, 0.58), M_STRAP, 0.008), "Chest")
add(cube("StrapBL", (0.070, 0.055, 0.24), (0.095, 0.125, 0.56), M_STRAP, 0.006), "Chest")
add(cube("StrapBR", (0.070, 0.055, 0.24), (-0.095, 0.125, 0.56), M_STRAP, 0.006), "Chest")
add(cyl("BtnL", 0.030, 0.032, (0.10, -0.118, 0.475), M_BTN, 8, "Y"), "Chest")
add(cyl("BtnR", 0.030, 0.032, (-0.10, -0.118, 0.475), M_BTN, 8, "Y"), "Chest")
add(cube("Pocket", (0.12, 0.045, 0.10), (0, -0.135, 0.455), M_POCKET, 0.008), "Chest")

# ── LEGS — continuous cubes with deep hip/knee/ankle overlaps ───────────────
for side, sx in (("Left", 1), ("Right", -1)):
    hx = sx * 0.105
    hip = (hx, 0.02, HIP_Z)
    knee = (hx, 0.025, 0.14)
    ankle = (hx, 0.02, 0.05)

    add(joint_cube(f"{side}HipBall", hip, 0.20, M_OVER, 0.024), f"{side}UpLeg")
    add(limb_box(f"{side}Thigh", hip, knee, 0.195, M_OVER, 0.022, pad=0.09), f"{side}UpLeg")
    add(joint_cube(f"{side}Knee", knee, 0.185, M_OVER, 0.022), f"{side}UpLeg")
    add(limb_box(f"{side}Shin", knee, ankle, 0.185, M_OVER, 0.020, pad=0.085), f"{side}Leg")
    add(cube(f"{side}Cuff", (0.205, 0.215, 0.095), (hx, 0.02, 0.06), M_CUFF, 0.018), f"{side}Leg")
    add(cube(f"{side}Shoe", (0.19, 0.28, 0.11), (hx, -0.045, 0.032), M_SHOE, 0.024), f"{side}Foot")
    add(cube(f"{side}Toe", (0.16, 0.11, 0.08), (hx, -0.135, 0.034), M_SHOE, 0.016), f"{side}ToeBase")

# ── ARMS — soft A-pose (~35° from body), thick overlapping cubes
for side, sx in (("Left", 1), ("Right", -1)):
    shoulder = (sx * 0.21, 0.02, SHOULDER_Z)
    elbow = (sx * 0.36, 0.04, 0.42)
    wrist = (sx * 0.45, 0.05, 0.30)
    hand_c = (sx * 0.50, 0.06, 0.22)
    thumb_c = (sx * 0.54, 0.00, 0.23)

    # Shoulder digs into torso
    add(joint_cube(f"{side}Shoulder", shoulder, 0.22, M_SKIN, 0.024), f"{side}Arm")
    # Yellow short sleeve planted deep into torso
    sleeve_in = (sx * 0.05, 0.02, SHOULDER_Z - 0.01)
    sleeve_out = (sx * 0.33, 0.03, 0.52)
    add(limb_box(f"{side}Sleeve", sleeve_in, sleeve_out, 0.210, M_SHIRT, 0.024, pad=0.06), f"{side}Arm")
    add(limb_box(f"{side}Upper", shoulder, elbow, 0.195, M_SKIN, 0.020, pad=0.10), f"{side}Arm")
    add(joint_cube(f"{side}Elbow", elbow, 0.19, M_SKIN, 0.022), f"{side}Arm")
    add(limb_box(f"{side}Fore", elbow, wrist, 0.185, M_SKIN, 0.020, pad=0.11), f"{side}ForeArm")
    add(joint_cube(f"{side}Wrist", wrist, 0.18, M_SKIN, 0.020), f"{side}ForeArm")
    # Hand overlaps wrist deeply
    add(limb_box(f"{side}HandBridge", wrist, hand_c, 0.16, M_SKIN, 0.018, pad=0.06), f"{side}Hand")
    add(cube(f"{side}Hand", (0.15, 0.17, 0.14), hand_c, M_SKIN, 0.024), f"{side}Hand")
    add(cube(f"{side}Thumb", (0.06, 0.065, 0.06), thumb_c, M_SKIN, 0.008), f"{side}Hand")

# ── HEAD ────────────────────────────────────────────────────────────────────
add(cyl("Neck", 0.095, 0.11, (0, 0.02, 0.70), M_SKIN, 8), "Head")
add(uvs("Head", 0.205, (0, 0.01, HEAD_Z), M_SKIN, 12, 8, (1.12, 1.02, 1.14)), "Head")
add(ico("EarL", 0.050, (0.205, 0.0, HEAD_Z - 0.01), M_SKIN, 1, (0.48, 0.42, 0.95)), "Head")
add(ico("EarR", 0.050, (-0.205, 0.0, HEAD_Z - 0.01), M_SKIN, 1, (0.48, 0.42, 0.95)), "Head")

# Hair — top hemisphere only; bangs ABOVE eyes so face stays readable
add(uvs("HairDome", 0.220, (0, 0.02, HEAD_Z + 0.08), M_HAIR, 12, 7, (1.12, 1.00, 0.72)), "Head")
add(uvs("HairLobeL", 0.125, (0.09, -0.02, HEAD_Z + 0.14), M_HAIR, 8, 5, (0.95, 0.85, 0.50)), "Head")
add(uvs("HairLobeR", 0.125, (-0.09, -0.02, HEAD_Z + 0.14), M_HAIR, 8, 5, (0.95, 0.85, 0.50)), "Head")
add(cube("BangL", (0.15, 0.10, 0.09), (0.09, -0.175, HEAD_Z + 0.13), M_HAIR, 0.020), "Head")
add(cube("BangR", (0.15, 0.10, 0.09), (-0.09, -0.175, HEAD_Z + 0.13), M_HAIR, 0.020), "Head")
add(uvs("HairBack", 0.185, (0, 0.14, HEAD_Z + 0.02), M_HAIR, 8, 5, (1.14, 0.65, 0.92)), "Head")
for side, sx in (("L", 1), ("R", -1)):
    add(ico(f"Pig{side}", 0.11, (sx * 0.24, 0.06, HEAD_Z - 0.05), M_HAIR, 1, (1.28, 1.15, 1.02)), "Head")
    add(cyl(f"PigC{side}", 0.045, 0.07, (sx * 0.18, 0.04, HEAD_Z + 0.01), M_HAIR, 6, "X"), "Head")

# Face — eyes CLEAR of bangs, proud of face
for side, sx in (("L", 1), ("R", -1)):
    add(cube(f"Eye{side}", (0.042, 0.032, 0.090), (sx * 0.065, -0.215, HEAD_Z + 0.005), M_EYE, 0.006), "Head")
    add(cube(f"Brow{side}", (0.072, 0.022, 0.018), (sx * 0.065, -0.210, HEAD_Z + 0.070), M_BROW, 0.002), "Head")
add(cube("MouthMid", (0.055, 0.016, 0.016), (0, -0.218, HEAD_Z - 0.075), M_MOUTH, 0.002), "Head")
add(cube("MouthL", (0.028, 0.016, 0.016), (0.038, -0.215, HEAD_Z - 0.060), M_MOUTH, 0.002), "Head")
add(cube("MouthR", (0.028, 0.016, 0.016), (-0.038, -0.215, HEAD_Z - 0.060), M_MOUTH, 0.002), "Head")
for i, (fx, fz) in enumerate([(0.105, -0.015), (-0.105, -0.015), (0.125, -0.045), (-0.125, -0.045)]):
    add(cube(f"Fr{i}", (0.018, 0.012, 0.018), (fx, -0.218, HEAD_Z + fz), M_FRECKLE, 0.002), "Head")

# ── Armature ────────────────────────────────────────────────────────────────
arm_data = bpy.data.armatures.new("SunnyRig")
arm_obj = bpy.data.objects.new("Armature", arm_data)
bpy.context.collection.objects.link(arm_obj)
bpy.context.view_layer.objects.active = arm_obj
bpy.ops.object.mode_set(mode="EDIT")
eb = arm_data.edit_bones


def bone(name, head, tail, parent=None):
    b = eb.new(name)
    b.head = Vector(head)
    b.tail = Vector(tail)
    if parent:
        b.parent = eb[parent]
        b.use_connect = False
    return b


bone("Hips", (0, 0.02, HIP_Z - 0.02), (0, 0.02, 0.38))
bone("Spine", (0, 0.02, 0.38), (0, 0.02, 0.48), "Hips")
bone("Chest", (0, 0.02, 0.48), (0, 0.025, 0.64), "Spine")
bone("Head", (0, 0.01, 0.68), (0, 0.01, 1.00), "Chest")
bone("HeadTop", (0, 0.01, 1.00), (0, 0.01, 1.14), "Head")
for side, sx in (("Left", 1), ("Right", -1)):
    bone(f"{side}Arm", (sx * 0.21, 0.02, SHOULDER_Z), (sx * 0.36, 0.04, 0.42), "Chest")
    bone(f"{side}ForeArm", (sx * 0.36, 0.04, 0.42), (sx * 0.46, 0.05, 0.28), f"{side}Arm")
    bone(f"{side}Hand", (sx * 0.45, 0.05, 0.30), (sx * 0.52, 0.06, 0.20), f"{side}ForeArm")
for side, sx in (("Left", 1), ("Right", -1)):
    bone(f"{side}UpLeg", (sx * 0.105, 0.02, HIP_Z), (sx * 0.105, 0.025, 0.14), "Hips")
    bone(f"{side}Leg", (sx * 0.105, 0.025, 0.14), (sx * 0.105, 0.02, 0.05), f"{side}UpLeg")
    bone(f"{side}Foot", (sx * 0.105, 0.02, 0.05), (sx * 0.105, -0.12, 0.03), f"{side}Leg")
    bone(f"{side}ToeBase", (sx * 0.105, -0.12, 0.03), (sx * 0.105, -0.17, 0.03), f"{side}Foot")
bpy.ops.object.mode_set(mode="OBJECT")
arm_obj.show_in_front = True

mesh_objs = []
for obj, bn in parts:
    only(obj)
    vg = obj.vertex_groups.new(name=bn)
    vg.add([v.index for v in obj.data.vertices], 1.0, "REPLACE")
    mesh_objs.append(obj)
bpy.ops.object.select_all(action="DESELECT")
for o in mesh_objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = mesh_objs[0]
bpy.ops.object.join()
body = bpy.context.active_object
body.name = "SunnyBody"
flat(body)
body.parent = arm_obj
am = body.modifiers.new("Armature", "ARMATURE")
am.object = arm_obj
for b in arm_obj.data.bones:
    if b.name not in body.vertex_groups:
        body.vertex_groups.new(name=b.name)


# ── Anims ───────────────────────────────────────────────────────────────────
def ensure_action(name):
    act = bpy.data.actions.get(name) or bpy.data.actions.new(name)
    if not arm_obj.animation_data:
        arm_obj.animation_data_create()
    ad = arm_obj.animation_data
    ad.action = act
    if not act.slots:
        try:
            act.slots.new(id_type="OBJECT", name=arm_obj.name)
        except Exception:
            pass
    if act.slots:
        try:
            ad.action_slot = act.slots[0]
        except Exception:
            pass
    return act


def key_bone(n, f, loc=None, rot=None):
    pb = arm_obj.pose.bones.get(n)
    if not pb:
        return
    pb.rotation_mode = "XYZ"
    if loc is not None:
        pb.location = Vector(loc)
        pb.keyframe_insert("location", frame=f)
    if rot is not None:
        pb.rotation_euler = Euler(rot, "XYZ")
        pb.keyframe_insert("rotation_euler", frame=f)


def clear_pose():
    for pb in arm_obj.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
        pb.scale = (1, 1, 1)


def set_linear(action):
    for layer in getattr(action, "layers", []) or []:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for fc in bag.fcurves:
                    for kp in fc.keyframe_points:
                        kp.interpolation = "LINEAR"
    for fc in getattr(action, "fcurves", []) or []:
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"


def mute_nla(mute=True):
    ad = arm_obj.animation_data
    if not ad:
        return
    if hasattr(ad, "use_nla"):
        ad.use_nla = not mute
    for tr in ad.nla_tracks:
        tr.mute = mute


# Idle — soft breathe; arms barely move from near-T rest
idle = ensure_action("idle")
clear_pose()
for f, breath, sway in [(1, 0, 0), (13, 0.01, 0.018), (25, 0, 0), (37, 0.01, -0.018), (48, 0, 0)]:
    key_bone("Hips", f, loc=(0, 0, breath * 0.10), rot=(0, sway * 0.05, 0))
    key_bone("Chest", f, rot=(breath * 1.0, sway * 0.15, 0))
    key_bone("Head", f, rot=(-breath * 0.3, -sway * 0.25, 0))
    key_bone("LeftArm", f, rot=(0.04 + sway * 0.04, 0.02, 0.06 + breath * 0.05))
    key_bone("RightArm", f, rot=(0.04 - sway * 0.04, -0.02, -0.06 - breath * 0.05))
    key_bone("LeftForeArm", f, rot=(0.08, 0, 0.02))
    key_bone("RightForeArm", f, rot=(0.08, 0, -0.02))
    key_bone("LeftUpLeg", f, rot=(0.015, 0, 0.008))
    key_bone("RightUpLeg", f, rot=(0.015, 0, -0.008))
set_linear(idle)

# Walk — gentle swings; thick overlaps keep silhouette closed
walk = ensure_action("walk")
clear_pose()
for f, hy, hs, lup, lk, rup, rk, la, ra, tw in [
    (1, 0.0, 0.015, 0.28, 0.08, -0.24, 0.35, -0.28, 0.28, 0.06),
    (5, 0.010, 0.0, 0.02, 0.22, 0.02, 0.22, 0.02, -0.02, 0.0),
    (9, 0.0, -0.015, -0.24, 0.35, 0.28, 0.08, 0.28, -0.28, -0.06),
    (13, 0.010, 0.0, 0.02, 0.22, 0.02, 0.22, 0.02, -0.02, 0.0),
    (16, 0.0, 0.015, 0.28, 0.08, -0.24, 0.35, -0.28, 0.28, 0.06),
]:
    key_bone("Hips", f, loc=(0, 0, hy), rot=(0, hs, tw * 0.12))
    key_bone("Chest", f, rot=(0.025, -tw, 0))
    key_bone("Head", f, rot=(-0.02, tw * 0.2, 0))
    key_bone("LeftUpLeg", f, rot=(lup, 0, 0.015))
    key_bone("LeftLeg", f, rot=(lk, 0, 0))
    key_bone("LeftFoot", f, rot=(-0.10 - max(0, lup) * 0.10, 0, 0))
    key_bone("RightUpLeg", f, rot=(rup, 0, -0.015))
    key_bone("RightLeg", f, rot=(rk, 0, 0))
    key_bone("RightFoot", f, rot=(-0.10 - max(0, rup) * 0.10, 0, 0))
    key_bone("LeftArm", f, rot=(0.04 + la * 0.28, 0, 0.08 + la * 0.04))
    key_bone("LeftForeArm", f, rot=(0.15 + abs(la) * 0.05, 0, 0.03))
    key_bone("RightArm", f, rot=(0.04 + ra * 0.28, 0, -0.08 + ra * 0.04))
    key_bone("RightForeArm", f, rot=(0.15 + abs(ra) * 0.05, 0, -0.03))
set_linear(walk)

while arm_obj.animation_data.nla_tracks:
    arm_obj.animation_data.nla_tracks.remove(arm_obj.animation_data.nla_tracks[0])
for act in (idle, walk):
    tr = arm_obj.animation_data.nla_tracks.new()
    tr.name = act.name
    tr.strips.new(act.name, 1, act)
arm_obj.animation_data.action = None
mute_nla(True)
clear_pose()

# Backdrop + lights (warm key so peach reads peach)
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 4.0, 0.55))
bg = bpy.context.active_object
bg.name = "Backdrop"
bg.rotation_euler = (math.radians(90), 0, 0)
bg.data.materials.append(M_BG)
bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0, -0.02))
fl = bpy.context.active_object
fl.name = "Floor"
fl.data.materials.append(M_FLOOR)

world = bpy.data.worlds.new("W")
scene.world = world
world.use_nodes = True
for n in world.node_tree.nodes:
    if n.type == "BACKGROUND":
        n.inputs["Color"].default_value = (0.70, 0.88, 0.80, 1)
        n.inputs["Strength"].default_value = 0.50

bpy.ops.object.light_add(type="AREA", location=(2.0, -3.5, 3.4))
k = bpy.context.active_object
k.data.energy = 360
k.data.size = 5.5
k.data.color = (1.0, 0.97, 0.92)
k.rotation_euler = (math.radians(52), 0, math.radians(18))
bpy.ops.object.light_add(type="AREA", location=(-2.4, -2.0, 2.5))
f = bpy.context.active_object
f.data.energy = 130
f.data.size = 5.0
f.data.color = (1.0, 0.92, 0.85)
bpy.ops.object.light_add(type="SUN", location=(1, -1, 6))
sun = bpy.context.active_object
sun.data.energy = 0.9
sun.rotation_euler = (math.radians(38), math.radians(8), math.radians(22))

bpy.ops.object.camera_add()
cam = bpy.context.active_object
scene.camera = cam
try:
    scene.render.engine = "BLENDER_EEVEE_NEXT"
except Exception:
    scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 900
scene.render.resolution_y = 1100
scene.render.image_settings.file_format = "PNG"


def aim(loc, target=(0, 0, 0.52), lens=50):
    cam.location = loc
    cam.data.lens = lens
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()


def render_shot(name, frame, loc, action=None, lens=50, target=(0, 0, 0.52), bind=False):
    ad = arm_obj.animation_data
    mute_nla(True)
    if bind or action is None:
        ad.action = None
        clear_pose()
    else:
        ad.action = action
        if action.slots:
            try:
                ad.action_slot = action.slots[0]
            except Exception:
                pass
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    aim(loc, target, lens)
    scene.render.filepath = os.path.join(SHOTS, name)
    bpy.ops.render.render(write_still=True)
    print("RENDERED", name)


def export_glb(path):
    bg.hide_set(True)
    fl.hide_set(True)
    bpy.ops.object.select_all(action="DESELECT")
    arm_obj.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    mute_nla(False)
    arm_obj.animation_data.action = idle
    if idle.slots:
        try:
            arm_obj.animation_data.action_slot = idle.slots[0]
        except Exception:
            pass
    try:
        bpy.ops.export_scene.gltf(
            filepath=path, export_format="GLB", use_selection=True,
            export_yup=True, export_animations=True, export_skins=True,
            export_animation_mode="ACTIONS",
        )
    except TypeError:
        bpy.ops.export_scene.gltf(
            filepath=path, export_format="GLB", use_selection=True,
            export_yup=True, export_animations=True, export_skins=True,
        )
    bg.hide_set(False)
    fl.hide_set(False)
    print("EXPORTED", path, os.path.getsize(path))


def export_clip(path, action, frames):
    body.hide_set(True)
    bg.hide_set(True)
    fl.hide_set(True)
    mute_nla(False)
    arm_obj.animation_data.action = action
    if action.slots:
        try:
            arm_obj.animation_data.action_slot = action.slots[0]
        except Exception:
            pass
    for tr in arm_obj.animation_data.nla_tracks:
        tr.mute = tr.name != action.name
    scene.frame_start = 1
    scene.frame_end = frames
    bpy.ops.object.select_all(action="DESELECT")
    arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    try:
        bpy.ops.export_scene.gltf(
            filepath=path, export_format="GLB", use_selection=True,
            export_yup=True, export_animations=True, export_skins=True,
            export_animation_mode="ACTIONS",
        )
    except TypeError:
        bpy.ops.export_scene.gltf(
            filepath=path, export_format="GLB", use_selection=True,
            export_yup=True, export_animations=True, export_skins=True,
        )
    print("EXPORTED meshless", path, os.path.getsize(path))
    body.hide_set(False)
    bg.hide_set(False)
    fl.hide_set(False)
    for tr in arm_obj.animation_data.nla_tracks:
        tr.mute = False


render_shot("sunny-front.png", 1, (0, -3.0, 0.52), bind=True, lens=52)
render_shot("sunny-iso.png", 1, (1.95, -2.3, 0.82), bind=True, lens=48)
render_shot("sunny-side.png", 1, (2.85, 0.0, 0.52), bind=True, lens=52)
render_shot("sunny-idle.png", 13, (1.65, -2.3, 0.72), idle, 48)
render_shot("sunny-walk.png", 1, (1.75, -2.25, 0.68), walk, 48)

bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)
print("SAVED", BLEND_OUT)
export_glb(GLB_OUT)
export_clip(IDLE_OUT, idle, 48)
export_clip(WALK_OUT, walk, 16)

print(
    "STATS verts", len(body.data.vertices),
    "tris~", sum(len(p.vertices) - 2 for p in body.data.polygons),
    "bones", len(arm_obj.data.bones),
)
print("BONES", [b.name for b in arm_obj.data.bones])
print("DONE sunny v9")
