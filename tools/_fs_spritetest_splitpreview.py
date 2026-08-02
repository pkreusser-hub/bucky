# _fs_spritetest_splitpreview.py — FARMSTEAD sprite-test LOOK TEST (exploration
# only). Classifies each model's mesh into legL / legR / body WITHOUT altering
# geometry, paints the three regions distinct colours, and renders so the split
# quality can be judged visually before committing to real part export.
#
#   DWARF  (skinned, Tripo v1.0 biped rig): classify by the vertex's DOMINANT
#          vertex-group (skin weight), same method as villager REPORT.md.
#   KNIGHT (no skin at all): classify geometrically — sign(x) for L/R, a Z
#          cutoff for leg-vs-body. Prints a Z-histogram first so the cutoff is
#          picked from a real gap in the mesh, not guessed.
#
#   "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" -b \
#       --factory-startup -noaudio -P tools/_fs_spritetest_splitpreview.py -- \
#       dwarf  "C:/Users/pkreu/Downloads/cartoon+dwarf+3d+model.glb" \
#       "C:/Users/pkreu/OneDrive/Documents/BUCKY/assets/farmstead/cast/sprites-test/_inspect/dwarf_split"
#   ... or "knight" <src> <outprefix> [zCutoff]
import bpy, bmesh, sys, math, mathutils

argv = sys.argv[sys.argv.index("--") + 1:]
KIND, SRC, OUT_PREFIX = argv[0], argv[1], argv[2]
Z_CUTOFF = float(argv[3]) if len(argv) > 3 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

scene = bpy.context.scene
meshes = [o for o in scene.objects if o.type == 'MESH' and len(o.data.polygons) > 200]
me_obj = meshes[0]
me = me_obj.data
print("using mesh object:", me_obj.name, "polys:", len(me.polygons))

LEG_L = {"L_Thigh", "L_Calf", "L_Foot", "L_ToeBase", "L_ThighTwist01", "L_ThighTwist02",
         "L_CalfTwist01", "L_CalfTwist02"}
LEG_R = {"R_Thigh", "R_Calf", "R_Foot", "R_ToeBase", "R_ThighTwist01", "R_ThighTwist02",
         "R_CalfTwist01", "R_CalfTwist02"}

# world bbox / Z histogram, always useful
mat = me_obj.matrix_world
zs = [ (mat @ v.co).z for v in me.vertices ]
zmin, zmax = min(zs), max(zs)
print("world Z range:", round(zmin, 4), round(zmax, 4))
bins = 40
hist = [0] * bins
for z in zs:
    b = min(bins - 1, int((z - zmin) / (zmax - zmin) * bins))
    hist[b] += 1
print("Z histogram (bottom->top), %d verts:" % len(zs))
for i, c in enumerate(hist):
    zlo = zmin + (zmax - zmin) * i / bins
    print("  z=%6.3f  %s %d" % (zlo, "#" * min(80, c // max(1, max(hist) // 80 or 1)), c))

region = [0] * len(me.vertices)  # 0 body, 1 legL, 2 legR

if KIND == "dwarf":
    dwt = {}  # vidx -> {group_name: weight}
    for v in me.vertices:
        best_g, best_w = None, -1.0
        for ge in v.groups:
            gname = me_obj.vertex_groups[ge.group].name
            if ge.weight > best_w:
                best_w = ge.weight
                best_g = gname
        if best_g in LEG_L:
            region[v.index] = 1
        elif best_g in LEG_R:
            region[v.index] = 2
        else:
            region[v.index] = 0
else:
    # geometric split for the un-skinned knight
    if Z_CUTOFF is None:
        Z_CUTOFF = zmin + (zmax - zmin) * 0.32   # rough guess, override via argv[3] after seeing the histogram
    for v in me.vertices:
        w = mat @ v.co
        if w.z > Z_CUTOFF:
            region[v.index] = 0
        else:
            region[v.index] = 1 if w.x > 0 else 2
    print("using Z_CUTOFF =", Z_CUTOFF)

n0 = region.count(0); n1 = region.count(1); n2 = region.count(2)
print("region counts: body=%d legL=%d legR=%d (total %d)" % (n0, n1, n2, len(region)))

# face-level majority vote -> per-corner vertex colour (Workbench VERTEX display)
col_body = (0.15, 0.85, 0.20, 1.0)
col_l = (0.95, 0.15, 0.15, 1.0)
col_r = (0.15, 0.35, 0.98, 1.0)
vc = me.color_attributes.new(name="split", type='BYTE_COLOR', domain='CORNER')
for poly in me.polygons:
    counts = [0, 0, 0]
    for vi in poly.vertices:
        counts[region[vi]] += 1
    face_region = counts.index(max(counts))
    col = (col_body, col_l, col_r)[face_region]
    for li in poly.loop_indices:
        vc.data[li].color = col

# stash per-face region as a face map too, for a later real-split script to reuse
# (printed as a compact run-length list so it can be pasted/verified quickly)
face_regions = []
for poly in me.polygons:
    counts = [0, 0, 0]
    for vi in poly.vertices:
        counts[region[vi]] += 1
    face_regions.append(counts.index(max(counts)))
print("face region counts: body=%d legL=%d legR=%d" % (
    face_regions.count(0), face_regions.count(1), face_regions.count(2)))

# ---------------------------------------------------------------- render
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'FLAT'
scene.display.shading.color_type = 'VERTEX'
scene.render.resolution_x = 640
scene.render.resolution_y = 800
scene.render.film_transparent = True
scene.world = bpy.data.worlds.new("W")
scene.world.color = (0.10, 0.12, 0.15)

bbmin = [1e9, 1e9, 1e9]; bbmax = [-1e9, -1e9, -1e9]
for v in me.vertices:
    w = mat @ v.co
    for k in range(3):
        bbmin[k] = min(bbmin[k], w[k]); bbmax[k] = max(bbmax[k], w[k])
center = mathutils.Vector(((bbmin[0]+bbmax[0])/2, (bbmin[1]+bbmax[1])/2, (bbmin[2]+bbmax[2])/2))
radius = max(bbmax[k]-bbmin[k] for k in range(3)) * 0.72 + 0.05

cam_data = bpy.data.cameras.new("cam"); cam_data.type = 'ORTHO'; cam_data.ortho_scale = radius * 2.1
cam_obj = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam_obj); scene.camera = cam_obj

def look_at(obj, target, dist, az_deg, el_deg):
    az = math.radians(az_deg); el = math.radians(el_deg)
    dir_v = mathutils.Vector((math.sin(az)*math.cos(el), -math.cos(az)*math.cos(el), math.sin(el)))
    obj.location = target + dir_v * dist
    rot_quat = (target - obj.location).to_track_quat('-Z', 'Y')
    obj.rotation_euler = rot_quat.to_euler()

for name, az, el in [("front", 0, 8), ("threequarter", 40, 14)]:
    look_at(cam_obj, center, 6, az, el)
    scene.render.filepath = OUT_PREFIX + "_" + name + ".png"
    bpy.ops.render.render(write_still=True)
    print("wrote", scene.render.filepath)
