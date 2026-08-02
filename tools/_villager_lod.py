# FARMSTEAD — re-cut the villager's LOD from the shipped vertex-coloured GLBs.
#
#   "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" -b \
#       --factory-startup -noaudio -P tools/_villager_lod.py -- \
#       assets/farmstead/cast/villager/villager-body-vc.glb \
#       assets/farmstead/cast/villager/villager-body-lo-vc.glb 0.25
#
# Shipped cut: body 0.25 (6000 -> 1498), legs 0.34 (800 -> 271/270).
#
# Notes worth keeping:
#  - The collapse is done in THREE steps, not one. A single jump to a quarter
#    shreds the silhouette (the shoulders and the boot toes go first); three
#    gentle passes keep it. Same lesson the generation pass recorded when it
#    tried to reach 2000 in one go.
#  - Vertex colours ride along for free: glTF COLOR_0 imports as a CORNER-domain
#    BYTE_COLOR attribute which the decimate modifier interpolates, and
#    export_vertex_color='ACTIVE' writes it back out. Round-trip measured on the
#    body: mean COLOR_0 0.6898,0.4861,0.3333 -> 0.6875,0.4844,0.3308. No re-bake
#    from the source texture is needed, so this does NOT need the 100 MB
#    _blend/villager_split_fullres.blend (that is only for going back ABOVE 6000).
import bpy, sys, os
argv = sys.argv[sys.argv.index("--") + 1:]
SRC, DST, RATIO = argv[0], argv[1], float(argv[2])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in objs:
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    tri0 = len(o.data.polygons)
    steps = 3
    per = RATIO ** (1.0 / steps)
    for i in range(steps):
        m = o.modifiers.new(name="dec%d" % i, type='DECIMATE')
        m.decimate_type = 'COLLAPSE'
        m.ratio = per
        m.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=m.name)
    print("  %s: %d -> %d tris; colors=%s" % (o.name, tri0, len(o.data.polygons),
          [(a.name, a.domain, a.data_type) for a in o.data.color_attributes]))
    o.select_set(False)
for o in objs:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', export_materials='EXPORT',
                          export_normals=True, export_vertex_color='ACTIVE',
                          export_all_vertex_colors=False, export_apply=False, export_yup=True)
print("wrote", DST, os.path.getsize(DST))
