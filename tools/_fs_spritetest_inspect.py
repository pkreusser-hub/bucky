# _fs_spritetest_inspect.py — FARMSTEAD sprite-test LOOK TEST (exploration only,
# never shipped). Loads a raw downloaded GLB as-is (no changes) and renders
# front/side/three-quarter Workbench stills so the pose/orientation/scale can be
# SEEN before any normalization work, mirroring the villager REPORT.md pipeline.
#
#   "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" -b \
#       --factory-startup -noaudio -P tools/_fs_spritetest_inspect.py -- \
#       "C:/Users/pkreu/Downloads/cartoon+dwarf+3d+model.glb" \
#       assets/farmstead/cast/sprites-test/_inspect/dwarf
import bpy, sys, os, math, mathutils

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT_PREFIX = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

scene = bpy.context.scene
objs = list(scene.objects)
meshes = [o for o in objs if o.type == 'MESH']
armatures = [o for o in objs if o.type == 'ARMATURE']

print("==== %s ====" % SRC)
print("objects: %d  meshes: %d  armatures: %d" % (len(objs), len(meshes), len(armatures)))
for o in objs:
    print("  %-12s %-30s loc=%s rot_euler=%s scale=%s" % (
        o.type, o.name, tuple(round(v, 4) for v in o.location),
        tuple(round(v, 4) for v in o.rotation_euler), tuple(round(v, 4) for v in o.scale)))

for m in meshes:
    tri = 0
    for p in m.data.polygons:
        tri += max(0, len(p.vertices) - 2)
    print("  MESH %s: polys=%d tris~=%d verts=%d vgroups=%s" % (
        m.name, len(m.data.polygons), tri, len(m.data.vertices),
        [g.name for g in m.vertex_groups]))
    # world-space bbox
    mat = m.matrix_world
    bbmin = [1e9, 1e9, 1e9]
    bbmax = [-1e9, -1e9, -1e9]
    for v in m.data.vertices:
        w = mat @ v.co
        for k in range(3):
            bbmin[k] = min(bbmin[k], w[k])
            bbmax[k] = max(bbmax[k], w[k])
    print("  world bbox min=%s max=%s size=%s" % (
        tuple(round(v, 4) for v in bbmin), tuple(round(v, 4) for v in bbmax),
        tuple(round(bbmax[k] - bbmin[k], 4) for k in range(3))))

for a in armatures:
    print("  ARMATURE %s: bones=%d" % (a.name, len(a.data.bones)))
    for b in a.data.bones:
        head_w = a.matrix_world @ b.head_local
        print("    %-20s head_world=%s parent=%s" % (
            b.name, tuple(round(v, 4) for v in head_w), b.parent.name if b.parent else "-"))

# ---------------------------------------------------------------- render setup
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'TEXTURE'
scene.render.resolution_x = 640
scene.render.resolution_y = 800
scene.render.film_transparent = True
scene.world = bpy.data.worlds.new("W")
scene.world.color = (0.10, 0.12, 0.15)

# overall bbox (all mesh objects) to frame the camera
bbmin = [1e9, 1e9, 1e9]
bbmax = [-1e9, -1e9, -1e9]
for m in meshes:
    mat = m.matrix_world
    for v in m.data.vertices:
        w = mat @ v.co
        for k in range(3):
            bbmin[k] = min(bbmin[k], w[k])
            bbmax[k] = max(bbmax[k], w[k])
center = mathutils.Vector(((bbmin[0]+bbmax[0])/2, (bbmin[1]+bbmax[1])/2, (bbmin[2]+bbmax[2])/2))
radius = max(bbmax[k]-bbmin[k] for k in range(3)) * 0.72 + 0.05

sun = bpy.data.lights.new("sun", type='SUN')
sun.energy = 3.0
sun_obj = bpy.data.objects.new("sun", sun)
scene.collection.objects.link(sun_obj)
sun_obj.rotation_euler = (math.radians(55), 0, math.radians(35))

cam_data = bpy.data.cameras.new("cam")
cam_data.type = 'ORTHO'
cam_data.ortho_scale = radius * 2.1
cam_obj = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam_obj)
scene.camera = cam_obj

def look_at(obj, target, dist, az_deg, el_deg):
    az = math.radians(az_deg); el = math.radians(el_deg)
    dir_v = mathutils.Vector((math.sin(az)*math.cos(el), -math.cos(az)*math.cos(el), math.sin(el)))
    obj.location = target + dir_v * dist
    rot_quat = (target - obj.location).to_track_quat('-Z', 'Y')
    obj.rotation_euler = rot_quat.to_euler()

views = [("front", 0, 8), ("side", 90, 8), ("threequarter", 40, 18)]
os.makedirs(os.path.dirname(OUT_PREFIX), exist_ok=True)
for name, az, el in views:
    look_at(cam_obj, center, 6, az, el)
    scene.render.filepath = OUT_PREFIX + "_" + name + ".png"
    bpy.ops.render.render(write_still=True)
    print("wrote", scene.render.filepath)
