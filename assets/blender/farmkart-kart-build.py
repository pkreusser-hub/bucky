# Farm Kart — purpose-built go-kart, generated headlessly.
#   blender --background --python build_kart.py -- <out_basepath>
# Produces <out>.glb + <out>_<view>.png renders.
# Convention: +Y = forward (nose), +Z = up, wheels' axle along X. Wheels are SEPARATE objects
# named WheelFL/FR/RL/RR with origins at their axle centre; SteerWheel is separate; everything
# else joins into KartBody. Materials carry clean names (BodyPaint/Tire/Rim/Seat/Metal/Accent).
import bpy, bmesh, math, sys, os

argv = sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []
OUT = argv[0] if argv else os.path.join(os.path.dirname(__file__), "farmkart-kart")

bpy.ops.wm.read_factory_settings(use_empty=True)

# ---------------- materials ----------------
def mat(name, color, rough=0.5, metal=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (color[0], color[1], color[2], 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m
M_BODY  = mat("BodyPaint", (0.16, 0.52, 0.20), 0.33)          # farm-kart green
M_TIRE  = mat("Tire",      (0.04, 0.04, 0.045), 0.85)         # rubber
M_RIM   = mat("Rim",       (0.96, 0.80, 0.07), 0.35, 0.25)    # yellow rims
M_SEAT  = mat("Seat",      (0.08, 0.08, 0.10), 0.55)          # dark seat
M_METAL = mat("Metal",     (0.62, 0.64, 0.68), 0.30, 0.85)    # roll bar / chrome
M_ACC   = mat("Accent",    (0.10, 0.10, 0.12), 0.45)          # steering / trim
M_LIGHT = mat("Light",     (1.0, 0.93, 0.6), 0.2);            # headlights
M_LIGHT.node_tree.nodes["Principled BSDF"].inputs["Emission Color"].default_value = (1,0.9,0.5,1)
M_LIGHT.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 2.0

def smooth(o, angle=40):
    for p in o.data.polygons: p.use_smooth = True
    try:
        o.data.use_auto_smooth = True; o.data.auto_smooth_angle = math.radians(angle)
    except Exception:
        pass

def apply_mods(o):
    bpy.context.view_layer.objects.active = o
    for m in list(o.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)

def rbox(name, sx, sy, sz, loc, bevel=0.045, seg=3, material=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object; o.name = name
    o.scale = (sx/2, sy/2, sz/2); bpy.ops.object.transform_apply(scale=True)
    b = o.modifiers.new("b", 'BEVEL'); b.width=bevel; b.segments=seg; b.limit_method='ANGLE'; b.angle_limit=math.radians(50)
    apply_mods(o); smooth(o)
    if material: o.data.materials.append(material)
    return o

def cyl(name, r, depth, loc, axis='Z', material=None, verts=28, bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, vertices=verts, location=loc)
    o = bpy.context.active_object; o.name = name
    if axis == 'X': o.rotation_euler = (0, math.radians(90), 0)
    elif axis == 'Y': o.rotation_euler = (math.radians(90), 0, 0)
    bpy.ops.object.transform_apply(rotation=True)
    if bevel>0:
        b=o.modifiers.new("b",'BEVEL'); b.width=bevel; b.segments=3; b.limit_method='ANGLE'; b.angle_limit=math.radians(50); apply_mods(o)
    smooth(o)
    if material: o.data.materials.append(material)
    return o

def _activate(o):
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
def torus(name, R, r, loc, rot, material=None, mj=32, mn=14):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=mj, minor_segments=mn)
    o = bpy.context.active_object; o.name = name
    bpy.context.view_layer.update()
    o.dimensions = (2*(R+r), 2*(R+r), 2*r)                # force size (operator ignores major_radius here)
    o.location = loc; o.rotation_euler = rot
    _activate(o); bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)  # bake with o ACTIVE
    smooth(o)
    if material: o.data.materials.append(material)
    return o

def join(name, objs):
    bpy.ops.object.select_all(action='DESELECT')   # CRITICAL: join() merges ALL selected -> clear first
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    objs[0].name = name
    bpy.ops.object.select_all(action='DESELECT')
    return objs[0]

def set_origin(o, point):
    cur = bpy.context.scene.cursor.location.copy()
    bpy.context.scene.cursor.location = point
    bpy.context.view_layer.objects.active = o; o.select_set(True)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR'); o.select_set(False)
    bpy.context.scene.cursor.location = cur

# ---------------- dimensions ----------------
WB = 1.46      # wheelbase (front-rear)
TR = 1.24      # track (left-right, wheel centres)
WR = 0.295     # wheel radius (smaller so the body reads as the mass, not monster-truck tyres)
WW = 0.24      # wheel width
RIDE = WR      # axle height = wheel radius (wheels sit on ground z=0)

# ---------------- ONE cohesive rounded body + overlapping nose (crisp beveled forms, keep the red) ----
addons = []
# MAIN BODY — a single big rounded mass that dominates the wheels (bottom near floor, top above wheels)
body = rbox("body", 0.98, 1.62, 0.58, (0, -0.04, RIDE+0.06), bevel=0.20, seg=5, material=M_BODY)
addons.append(body)
# NOSE — a rounded wedge that OVERLAPS the body front (no gap) and slopes down to a friendly snout
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.86, RIDE-0.02))
nose = bpy.context.active_object; nose.name="nose"; nose.scale=(0.82/2, 0.86/2, 0.44/2); bpy.ops.object.transform_apply(scale=True)
for v in nose.data.vertices:
    if v.co.y > 0.90:                     # front verts -> down + tucked in
        v.co.z -= 0.15; v.co.x *= 0.60
bnv=nose.modifiers.new("b",'BEVEL'); bnv.width=0.10; bnv.segments=4; bnv.limit_method='ANGLE'; apply_mods(nose); smooth(nose,55); nose.data.materials.append(M_BODY)
addons.append(nose)
# COCKPIT SEAT recessed into the top-rear of the body (driver sits here, largely covers it)
addons.append(rbox("seatpan", 0.5, 0.46, 0.10, (0, -0.14, RIDE+0.30), bevel=0.05, material=M_SEAT))
back = rbox("seatback", 0.5, 0.13, 0.40, (0, -0.38, RIDE+0.48), bevel=0.06, seg=4, material=M_SEAT)
back.rotation_euler=(math.radians(-15),0,0); bpy.context.view_layer.objects.active=back; bpy.ops.object.transform_apply(rotation=True)
addons.append(back)
# steering column from the dash up to the wheel (short, visibly connected)
addons.append(cyl("col", 0.03, 0.22, (0, 0.28, RIDE+0.34), axis='Y', material=M_ACC, verts=12))
# CHUNKY GREEN CONNECTION — nothing floats: side pods link front↔rear on each side (overlapping the
# body inboard and the wheels outboard), and a fat fender caps each wheel, tying pod → wheel.
for sx in (-1,1):
    # side pod: runs the wheelbase, inner edge into the body, outer edge onto the wheels
    addons.append(rbox("pod%d"%sx, 0.28, WB+0.12, 0.36, (sx*0.53, 0, RIDE+0.02), bevel=0.13, seg=4, material=M_BODY))
    for sy in (-1,1):
        # fender: a fat rounded cap sitting over the top of each wheel, tying pod → wheel
        addons.append(rbox("fend_%d_%d"%(sx,sy), 0.40, 0.60, 0.40, (sx*TR/2, sy*WB/2, RIDE+WR*0.72), bevel=0.17, seg=4, material=M_BODY))
# thin metal skid tucked under the body (subtle underframe)
addons.append(rbox("skid", 0.66, WB*0.86, 0.06, (0, 0, RIDE-WR*0.62), bevel=0.03, material=M_METAL))
KartBody = join("KartBody", addons)

# ---------------- wheels ----------------
def make_wheel(name, cx, cy):
    z = RIDE
    # tire: fat cylinder, heavily rounded edges -> chunky tire
    t = cyl(name+"_t", WR, WW, (cx,cy,z), axis='X', material=M_TIRE, verts=30, bevel=0.10)
    # rim + hub (yellow), slightly inset
    rim = cyl(name+"_r", WR*0.56, WW*1.02, (cx,cy,z), axis='X', material=M_RIM, verts=24)
    hub = cyl(name+"_h", WR*0.16, WW*1.08, (cx,cy,z), axis='X', material=M_METAL, verts=14)
    w = join(name, [t, rim, hub])
    set_origin(w, (cx, cy, z))
    return w
make_wheel("WheelFL", -TR/2,  WB/2)
make_wheel("WheelFR",  TR/2,  WB/2)
make_wheel("WheelRL", -TR/2, -WB/2)
make_wheel("WheelRR",  TR/2, -WB/2)

# ---------------- steering wheel (separate, turns in game) — built like the wheels (robust) ----------
SWC = (0, 0.34, RIDE+0.42)   # steering-wheel centre (just above/behind the column top)
# a ring: outer disc minus an inner bore (boolean), + a hub; all via the working cyl helper
outer = cyl("sw_o", 0.135, 0.035, SWC, axis='Z', material=M_ACC, verts=26)
bore  = cyl("sw_i", 0.088, 0.06,  SWC, axis='Z', verts=26)
_activate(outer); bmod = outer.modifiers.new("cut",'BOOLEAN'); bmod.operation='DIFFERENCE'; bmod.object=bore; bmod.solver='EXACT'
bpy.ops.object.modifier_apply(modifier=bmod.name); bpy.data.objects.remove(bore, do_unlink=True)
outer.data.materials.clear(); outer.data.materials.append(M_ACC)
hub  = cyl("sw_h", 0.03, 0.05, SWC, axis='Z', material=M_ACC, verts=10)
spoke = rbox("sw_s", 0.20, 0.032, 0.032, SWC, bevel=0.01, material=M_ACC)      # one crossbar spoke
SteerWheel = join("SteerWheel", [outer, hub, spoke])
set_origin(SteerWheel, SWC)   # origin at SWC FIRST so the tilt rotates in place (not around world origin)
_activate(SteerWheel); SteerWheel.rotation_euler=(math.radians(62),0,0); bpy.ops.object.transform_apply(rotation=True)

# ---------------- studio render setup ----------------
sc = bpy.context.scene
# ground
bpy.ops.mesh.primitive_plane_add(size=20, location=(0,0,0))
gp = bpy.context.active_object; gp.name="GroundPlane"; gpm = mat("ground",(0.82,0.83,0.85),0.9); gp.data.materials.append(gpm)
# lights
def area(loc, energy, size=6):
    bpy.ops.object.light_add(type='AREA', location=loc); L=bpy.context.active_object; L.data.energy=energy; L.data.size=size
    return L
key=area((3,-4,6), 900); key.rotation_euler=(math.radians(40),0,math.radians(35))
fill=area((-4,-2,4), 350, 8)
rim=area((-2,5,4), 550, 6)
world = bpy.data.worlds.new("w"); sc.world=world; world.use_nodes=True
world.node_tree.nodes["Background"].inputs[0].default_value=(0.85,0.88,0.93,1)
world.node_tree.nodes["Background"].inputs[1].default_value=0.6
sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
sc.render.film_transparent=False
sc.render.resolution_x=720; sc.render.resolution_y=540
try: sc.eevee.use_raytracing=True
except Exception: pass

bpy.ops.object.camera_add(); cam=bpy.context.active_object; sc.camera=cam
cam.data.lens=55
import mathutils
def look(cam, frm, to=(0,0,0.45)):
    d=mathutils.Vector(to)-mathutils.Vector(frm); cam.location=frm
    cam.rotation_euler=d.to_track_quat('-Z','Y').to_euler()
VIEWS = {"iso":(3.0,-3.4,2.2), "side":(0.05,-4.6,1.1), "front":(0.2,4.6,1.4), "top":(0.01,-0.2,6.0)}
for name,frm in VIEWS.items():
    look(cam, frm); sc.render.filepath = OUT+"_"+name+".png"; bpy.ops.render.render(write_still=True)
# DEBUG: report each exported mesh's world bounding-box centre + size
for o in bpy.data.objects:
    if o.type=='MESH' and o.name!="GroundPlane":
        bb=[o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
        xs=[v.x for v in bb]; ys=[v.y for v in bb]; zs=[v.z for v in bb]
        print("DBG %-10s center=(%.2f,%.2f,%.2f) size=(%.2f,%.2f,%.2f)" % (o.name,
              (min(xs)+max(xs))/2,(min(ys)+max(ys))/2,(min(zs)+max(zs))/2, max(xs)-min(xs),max(ys)-min(ys),max(zs)-min(zs)))

# ---------------- export GLB (wheels/steer stay separate objects) ----------------
# hide render helpers from export
for o in (gp,): o.select_set(False)
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.data.objects:
    if o.type=='MESH' and o.name != "GroundPlane": o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT+".glb", export_format='GLB', use_selection=True,
                          export_apply=True, export_yup=True)
names=[o.name for o in bpy.data.objects if o.type=='MESH']
print("KART_BUILD_OK objects=%s glb=%s" % (names, os.path.exists(OUT+".glb")))
