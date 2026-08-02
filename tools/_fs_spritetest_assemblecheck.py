# _fs_spritetest_assemblecheck.py — FARMSTEAD sprite-test LOOK TEST (exploration
# only). Loads the split body/legL/legR GLBs produced by
# tools/_fs_spritetest_splitparts.mjs, re-assembles them at the measured hip
# offsets (same rig shape sprite-impostor.js's IMP.makeRig uses), and renders
# REST + a WIDE swing pose so a gap/overlap at the hip seam is visible before
# any of this goes near the real bake harness.
#
#   "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" -b \
#     --factory-startup -noaudio -P tools/_fs_spritetest_assemblecheck.py -- \
#     assets/farmstead/cast/sprites-test/parts/dwarf \
#     assets/farmstead/cast/sprites-test/_inspect/dwarf_assemble \
#     0.1468053389870262 0.36250045715017265 -0.034241346410198124 \
#     -0.1476892437079832 0.37430463597295455 0.003755292459933269
import bpy, sys, math, mathutils

argv = sys.argv[sys.argv.index("--") + 1:]
PART_PREFIX, OUT_PREFIX = argv[0], argv[1]
hipL = [float(v) for v in argv[2:5]]
hipR = [float(v) for v in argv[5:8]]
SWING = float(argv[8]) if len(argv) > 8 else 0.55   # LEG_SWING is 0.52 in production

bpy.ops.wm.read_factory_settings(use_empty=True)

def gy2b(v):  # glTF Y-up (x,y,z) -> Blender Z-up (x,-z,y), matches the importer
    return (v[0], -v[2], v[1])

def imp(path, name):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    after = set(bpy.context.scene.objects) - before
    meshes = [o for o in after if o.type == 'MESH']
    o = meshes[0]
    o.name = name
    return o

body = imp(PART_PREFIX + "-body.glb", "body")
legL = imp(PART_PREFIX + "-legL.glb", "legL")
legR = imp(PART_PREFIX + "-legR.glb", "legR")

pivL = bpy.data.objects.new("hipL", None); bpy.context.scene.collection.objects.link(pivL)
pivR = bpy.data.objects.new("hipR", None); bpy.context.scene.collection.objects.link(pivR)
pivL.location = gy2b(hipL)
pivR.location = gy2b(hipR)
legL.parent = pivL
legR.parent = pivR

def swing(rad_l, rad_r):
    # pushLegs rotates about the hip's LOCAL X in glTF space (lateral axis) ->
    # Blender X after the y-up->z-up remap keeps the same axis label
    pivL.rotation_euler = (rad_l, 0, 0)
    pivR.rotation_euler = (rad_r, 0, 0)

scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'TEXTURE'
scene.render.resolution_x = 640
scene.render.resolution_y = 800
scene.render.film_transparent = True
scene.world = bpy.data.worlds.new("W")
scene.world.color = (0.10, 0.12, 0.15)

def bbox_all():
    bbmin = [1e9, 1e9, 1e9]; bbmax = [-1e9, -1e9, -1e9]
    for o in (body, legL, legR):
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            for k in range(3):
                bbmin[k] = min(bbmin[k], w[k]); bbmax[k] = max(bbmax[k], w[k])
    return bbmin, bbmax

bbmin, bbmax = bbox_all()
center = mathutils.Vector(((bbmin[0]+bbmax[0])/2, (bbmin[1]+bbmax[1])/2, (bbmin[2]+bbmax[2])/2))
radius = max(bbmax[k]-bbmin[k] for k in range(3)) * 0.7 + 0.05

cam_data = bpy.data.cameras.new("cam"); cam_data.type = 'ORTHO'; cam_data.ortho_scale = radius * 2.1
cam_obj = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam_obj); scene.camera = cam_obj

def look_at(obj, target, dist, az_deg, el_deg):
    az = math.radians(az_deg); el = math.radians(el_deg)
    dir_v = mathutils.Vector((math.sin(az)*math.cos(el), -math.cos(az)*math.cos(el), math.sin(el)))
    obj.location = target + dir_v * dist
    rot_quat = (target - obj.location).to_track_quat('-Z', 'Y')
    obj.rotation_euler = rot_quat.to_euler()

look_at(cam_obj, center, 6, 35, 10)

swing(0, 0)
scene.render.filepath = OUT_PREFIX + "_rest.png"
bpy.ops.render.render(write_still=True)
print("wrote", scene.render.filepath)

swing(SWING, -SWING)
scene.render.filepath = OUT_PREFIX + "_swingA.png"
bpy.ops.render.render(write_still=True)
print("wrote", scene.render.filepath)

swing(-SWING, SWING)
scene.render.filepath = OUT_PREFIX + "_swingB.png"
bpy.ops.render.render(write_still=True)
print("wrote", scene.render.filepath)
