/* ============================================================================
   mk64-to-farmkart  —  convert an n64decomp/mk64 course racing line into a
   Farm Kart fk_tracks_v1 track (control points + width + laps + elevation).

   USAGE
     node convert.mjs <course> ["Display Name"] [--laps N] [--out DIR]
     node convert.mjs --survey            # table of all convertible courses
     node convert.mjs --all               # convert every race course

   ENV
     MK64_SRC   path to a cloned n64decomp/mk64 repo (default: ./mk64)

   PIPELINE  parse track_path (the CPU racing line) -> translate start to origin,
     rotate 180° (start heads +Z) -> auto-measure the road width off the mesh and
     scale so the road is FK_WIDTH metres (a course's true size is preserved) ->
     RDP-simplify to ~40 control points carrying real Y -> curvature guard (round
     apexes so the constant-width ribbon can't bowtie) -> validate -> JSON + SVG.
   ========================================================================== */
import fs from 'fs';
import path from 'path';

const MK64_SRC = process.env.MK64_SRC || path.join(process.cwd(), 'mk64');
const FK_WIDTH = 18;                 // Farm Kart road width (metres) — fixed across courses
// MK64 world units are CONSISTENT across every course (same kart, same physics), so ONE fixed
// units->metres scale preserves each course's true relative size AND keeps road width consistent.
// Calibrated from Mario Raceway: its ~200-unit road -> FK_WIDTH 18m -> 0.09. (Per-course mesh
// auto-measure exists via measureRoadWidth() but is noisier; fixed scale is the robust default.)
const FIXED_SCALE = 0.09;
const TARGET_PTS_LO = 34, TARGET_PTS_HI = 52;
const CURV_MARGIN = 1.2;             // min spline radius >= half-width * margin (bowtie guard)

// nice display names for the roster
const NAMES = {
  luigi_raceway:'Luigi Raceway', mario_raceway:'Mario Raceway', moo_moo_farm:'Moo Moo Farm',
  koopa_troopa_beach:'Koopa Troopa Beach', kalimari_desert:'Kalimari Desert', toads_turnpike:"Toad's Turnpike",
  frappe_snowland:'Frappe Snowland', choco_mountain:'Choco Mountain', mario_raceway2:'Mario Raceway',
  royal_raceway:'Royal Raceway', bowsers_castle:"Bowser's Castle", dks_jungle_parkway:"DK's Jungle Parkway",
  yoshi_valley:'Yoshi Valley', banshee_boardwalk:'Banshee Boardwalk', rainbow_road:'Rainbow Road',
  sherbet_land:'Sherbet Land', wario_stadium:'Wario Stadium',
};

// ---- parse the racing line ----------------------------------------------------
function parsePath(course){
  const src = fs.readFileSync(path.join(MK64_SRC, 'courses', course, 'course_data.c'), 'utf8');
  const marker = `d_course_${course}_track_path[] = {`;
  if (!src.includes(marker)) throw new Error(`no track_path in ${course}`);
  const seg = src.split(marker)[1].split('};')[0];
  const re = /\{\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*\d+\s*\}/g;
  const pts=[]; let m;
  while ((m = re.exec(seg))){
    const x=+m[1], y=+m[2], z=+m[3];
    if (x===-32768 || y===-32768 || z===-32768) break;   // { 0x8000,... } sentinel
    pts.push({ x, y, z });
  }
  return pts;
}

// ---- ITEM BOXES: MK64 course_data has item_box_spawns ({{x,y,z},{group}}) in the SAME coords
// as the racing line, clustered by group. Farm Kart places a ROW of boxes across the track width at
// each itemRows lap-fraction, so we transform each box to Farm Kart coords, project it onto the
// centerline, and average per group -> one authentic itemRows fraction per real box cluster.
function parseItemBoxes(course){
  const src = fs.readFileSync(path.join(MK64_SRC, 'courses', course, 'course_data.c'), 'utf8');
  const marker = `d_course_${course}_item_box_spawns[] = {`;
  if (!src.includes(marker)) return [];
  const seg = src.split(marker)[1].split('};')[0];
  const re = /\{\s*\{\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\}\s*,\s*\{\s*(\d+)\s*\}/g;
  const out=[]; let m;
  while ((m = re.exec(seg))){ const x=+m[1]; if (x===-32768) break; out.push({ x, y:+m[2], z:+m[3], grp:+m[4] }); }
  return out;
}
function deriveItemRows(course, rawP0, scale, points){
  const boxes = parseItemBoxes(course);
  if (!boxes.length) return [0.15, 0.45, 0.75];   // fallback (every MK64 race course has them though)
  const C = crClosed(points, 20), N = C.length;
  const arc=[0]; let tot=0;
  for (let i=1;i<N;i++){ tot += Math.hypot(C[i].x-C[i-1].x, C[i].z-C[i-1].z); arc.push(tot); }
  tot += Math.hypot(C[0].x-C[N-1].x, C[0].z-C[N-1].z);
  const frac = (x,z)=>{ let bi=0,bd=1e18; for (let i=0;i<N;i++){ const d=(x-C[i].x)**2+(z-C[i].z)**2; if(d<bd){bd=d;bi=i;} } return arc[bi]/tot; };
  const byGrp={};
  for (const b of boxes){                          // same transform as the track: -(p-p0)*scale, rot180
    const fx=-(b.x-rawP0.x)*scale, fz=-(b.z-rawP0.z)*scale;
    (byGrp[b.grp] = byGrp[b.grp] || []).push(frac(fx,fz));
  }
  const rows = Object.values(byGrp)
    .map(fs => fs.reduce((a,c)=>a+c,0)/fs.length)
    .map(f => Math.round(f*100)/100)
    .filter(f => f>=0 && f<=1)
    .sort((a,b)=>a-b);
  // de-dup rows that collapse to the same fraction (a cluster straddling the start line, etc.)
  const uniq=[]; for (const f of rows){ if (!uniq.length || Math.abs(f-uniq[uniq.length-1])>0.02) uniq.push(f); }
  return uniq.length ? uniq : [0.15,0.45,0.75];
}

// ---- parse the mesh verts (for the road-width auto-measure) -------------------
function parseVerts(course){
  const txt = fs.readFileSync(path.join(MK64_SRC, 'courses', course, 'course_vertices.inc.c'), 'utf8');
  const re = /\{\s*\{\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\}/g;
  const v=[]; let m; while ((m=re.exec(txt))) v.push({ x:+m[1], y:+m[2], z:+m[3] });
  return v;
}

// road width = robust low percentile of the perpendicular road extent measured at
// path points (corners/crossings only INFLATE apparent width, so a low percentile
// reflects the true straight-road width). Returns metres-per-unit scale target.
function measureRoadWidth(course){
  const P = parsePath(course), V = parseVerts(course);
  const widths=[];
  for (let i=0;i<P.length;i+=Math.max(1,Math.floor(P.length/70))){
    const a=P[i], b=P[(i+1)%P.length];
    let tx=b.x-a.x, tz=b.z-a.z; const tl=Math.hypot(tx,tz)||1; tx/=tl; tz/=tl;
    const nx=-tz, nz=tx;
    const projs=[];
    for (const vv of V){
      const dx=vv.x-a.x, dz=vv.z-a.z;
      if (Math.abs(dx*tx+dz*tz) > 55) continue;         // near this cross-section
      const perp = dx*nx+dz*nz;
      if (Math.abs(perp) > 160) continue;               // ignore the far side of the track
      if (Math.abs(vv.y-a.y) > 20) continue;            // road level
      projs.push(perp);
    }
    if (projs.length<4) continue;
    projs.sort((p,q)=>p-q);
    widths.push(projs[Math.floor(projs.length*0.95)] - projs[Math.floor(projs.length*0.05)]);
  }
  widths.sort((a,b)=>a-b);
  return widths.length ? widths[Math.floor(widths.length*0.35)] : 200;   // p35
}

// ---- transform ----------------------------------------------------------------
function transform(P, scale){
  const p0=P[0];
  return P.map(p=>({ x:-(p.x-p0.x)*scale, z:-(p.z-p0.z)*scale, y:(p.y-p0.y)*scale }));
}

// ---- RDP (XZ, carry Y) --------------------------------------------------------
function rdp(pts, eps){
  const keep=new Array(pts.length).fill(false);
  keep[0]=keep[pts.length-1]=true;
  const st=[[0,pts.length-1]];
  while (st.length){
    const [i0,i1]=st.pop(); let maxD=-1, idx=-1;
    const a=pts[i0], b=pts[i1], abx=b.x-a.x, abz=b.z-a.z, abl=Math.hypot(abx,abz)||1;
    for (let i=i0+1;i<i1;i++){ const px=pts[i].x-a.x, pz=pts[i].z-a.z; const d=Math.abs(px*abz-pz*abx)/abl; if (d>maxD){maxD=d;idx=i;} }
    if (maxD>eps){ keep[idx]=true; st.push([i0,idx],[idx,i1]); }
  }
  return pts.filter((_,i)=>keep[i]);
}
function simplify(pts){
  let lo=0.1, hi=60, best=pts;
  for (let it=0;it<50;it++){
    const eps=(lo+hi)/2, out=rdp(pts,eps);
    if (out.length>TARGET_PTS_HI) lo=eps; else if (out.length<TARGET_PTS_LO) hi=eps; else return { pts:out, eps };
    best=out;
  }
  return { pts:best, eps:(lo+hi)/2 };
}

// ---- Catmull-Rom (THREE 'catmullrom', tension .5) — matches the game exactly ---
function crClosed(points, spp=16, tension=0.5){
  const n=points.length, out=[];
  const cp=(x0,x1,x2,x3,t)=>{ const t0=tension*(x2-x0), t1=tension*(x3-x1);
    const c0=x1,c1=t0,c2=-3*x1+3*x2-2*t0-t1,c3=2*x1-2*x2+t0+t1; return ((c3*t+c2)*t+c1)*t+c0; };
  for (let i=0;i<n;i++){ const p0=points[(i-1+n)%n],p1=points[i],p2=points[(i+1)%n],p3=points[(i+2)%n];
    for (let s=0;s<spp;s++){ const t=s/spp; out.push({ x:cp(p0.x,p1.x,p2.x,p3.x,t), y:cp(p0.y,p1.y,p2.y,p3.y,t), z:cp(p0.z,p1.z,p2.z,p3.z,t) }); } }
  return out;
}
function splineRadii(points, spp=24){
  const C=crClosed(points,spp), n=C.length, m=points.length;
  const perSeg=new Array(m).fill(Infinity); let minR=Infinity;
  for (let j=0;j<n;j++){ const a=C[(j-1+n)%n],b=C[j],c=C[(j+1)%n];
    const ab=Math.hypot(b.x-a.x,b.z-a.z),bc=Math.hypot(c.x-b.x,c.z-b.z),ca=Math.hypot(a.x-c.x,a.z-c.z);
    const area=Math.abs((b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x))/2;
    const R=area>1e-9?(ab*bc*ca)/(4*area):Infinity; const seg=Math.floor(j/spp)%m;
    if (R<perSeg[seg]) perSeg[seg]=R; if (R<minR) minR=R; }
  return { minR, perSeg };
}
function limitCurvature(points, halfWidth, margin=CURV_MARGIN, maxIter=600, lambda=0.30){
  const limit=halfWidth*margin; let pts=points.map(p=>({...p}));
  const before=splineRadii(pts).minR; let it=0;
  for (;it<maxIter;it++){
    const { minR, perSeg }=splineRadii(pts); const m=pts.length;
    if (minR>=limit) break;
    const np=pts.map(p=>({...p}));
    for (let i=0;i<m;i++){ if (!(perSeg[i]<limit || perSeg[(i-1+m)%m]<limit)) continue;
      const a=pts[(i-1+m)%m], b=pts[(i+1)%m];
      np[i].x=pts[i].x*(1-lambda)+(a.x+b.x)/2*lambda;
      np[i].z=pts[i].z*(1-lambda)+(a.z+b.z)/2*lambda;
      np[i].y=pts[i].y*(1-lambda)+(a.y+b.y)/2*lambda; }
    pts=np;
  }
  return { pts, iters:it, before, after:splineRadii(pts).minR };
}

// ---- bridge synthesis: MK64's racing-line Y is flat across some over/under crossings (the bridge
// height lives in collision data the path doesn't sample), so a self-crossing renders as a flat X
// (two coincident ribbons z-fighting). Detect flat crossings and raise ONE branch into a smooth
// hump so it clears the other — a real over/under. XZ is untouched (curvature guard stays valid).
function _segX(a,b,c,d){ const den=(b.x-a.x)*(d.z-c.z)-(b.z-a.z)*(d.x-c.x); if(Math.abs(den)<1e-9)return null;
  const t=((c.x-a.x)*(d.z-c.z)-(c.z-a.z)*(d.x-c.x))/den, u=((c.x-a.x)*(b.z-a.z)-(c.z-a.z)*(b.x-a.x))/den;
  if(t>1e-6&&t<1-1e-6&&u>1e-6&&u<1-1e-6) return {x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,yA:a.y+(b.y-a.y)*t,yC:c.y+(d.y-c.y)*u}; return null; }
function detectCrossings(points, spp=20){
  const C=crClosed(points,spp), n=C.length, m=points.length, found=[];
  for(let i=0;i<n;i++){ for(let j=i+2;j<n;j++){ if(i===0&&j===n-1)continue;
    const r=_segX(C[i],C[(i+1)%n],C[j],C[(j+1)%n]);
    if(r) found.push({ x:r.x, z:r.z, yA:r.yA, yC:r.yC, ci:Math.floor(i/spp)%m, cj:Math.floor(j/spp)%m }); } }
  const uniq=[]; for(const f of found){ if(!uniq.some(u=>Math.hypot(u.x-f.x,u.z-f.z)<8)) uniq.push(f); }
  return uniq;
}
function synthesizeBridges(points, halfWidth, clearance=8, win=2){
  const m=points.length, pts=points.map(p=>({...p})), bridged=[];
  for(const cr of detectCrossings(pts)){
    if(Math.abs(cr.yA-cr.yC) >= clearance*0.7) continue;              // already a real over/under
    const avgY=ctr=>{ let s=0; for(let k=-2;k<=2;k++) s+=pts[(ctr+k+m)%m].y; return s/5; };
    const over = avgY(cr.ci) >= avgY(cr.cj) ? cr.ci : cr.cj;          // raise whichever branch already sits higher
    // the crossing lies in the OVER branch's control segment [over, over+1]; lift that pair to full
    // clearance and taper the neighbours by control-INDEX (guarantees clearance regardless of point
    // spacing), giving a drivable humpback approach on each side.
    for(let d=-win-1; d<=win+2; d++){
      const bd = d<=0 ? -d : d-1;                                     // over & over+1 -> 0, then grow outward
      if(bd>win) continue;
      const k=(over+d+m)%m;
      pts[k].y += clearance * 0.5*(1+Math.cos(Math.PI*bd/(win+1)));   // cosine index taper, peak on the bracket
    }
    bridged.push({ x:Math.round(cr.x), z:Math.round(cr.z) });
  }
  return { pts, bridged };
}
const round1=v=>Math.round(v*10)/10;

// ---- validate (ported from FK_TRACK.validate) --------------------------------
function validate(track){
  const warnings=[], notes=[]; const pts=track.points, n=pts.length, hw=(track.width||18)/2;
  if (n<8) warnings.push(`only ${n} points`);
  let minR=Infinity;
  for (let i=0;i<n;i++){ const a=pts[(i-1+n)%n],b=pts[i],c=pts[(i+1)%n];
    const A=Math.hypot(b.x-a.x,b.z-a.z),B=Math.hypot(c.x-b.x,c.z-b.z),C=Math.hypot(c.x-a.x,c.z-a.z);
    const area=Math.abs((b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x))/2; const R=area>1e-6?(A*B*C)/(4*area):Infinity;
    if (R<minR)minR=R; }
  let minSpace=Infinity;
  for (let i=0;i<n;i++){ const a=pts[i],b=pts[(i+1)%n]; minSpace=Math.min(minSpace,Math.hypot(b.x-a.x,b.z-a.z)); }
  function segInt(p1,p2,p3,p4){ const d=(p2.x-p1.x)*(p4.z-p3.z)-(p2.z-p1.z)*(p4.x-p3.x); if(Math.abs(d)<1e-9)return false;
    const t=((p3.x-p1.x)*(p4.z-p3.z)-(p3.z-p1.z)*(p4.x-p3.x))/d, u=((p3.x-p1.x)*(p2.z-p1.z)-(p3.z-p1.z)*(p2.x-p1.x))/d;
    return t>1e-6&&t<1-1e-6&&u>1e-6&&u<1-1e-6; }
  let crossings=0;
  for (let i=0;i<n;i++){ const a1=pts[i],a2=pts[(i+1)%n];
    for (let j=i+1;j<n;j++){ if(j===i||(j+1)%n===i||j===(i+1)%n)continue; if(segInt(a1,a2,pts[j],pts[(j+1)%n]))crossings++; } }
  if (minSpace<Math.max(2,hw*0.6)) warnings.push(`tight spacing ${minSpace.toFixed(1)}`);
  return { ok:warnings.length===0, warnings, crossings, ctrlMinR:minR };
}

// ---- convert one course -------------------------------------------------------
function convert(course, opts={}){
  const raw = parsePath(course);
  const scale = opts.scale || (opts.measure ? FK_WIDTH/measureRoadWidth(course) : FIXED_SCALE);
  const world = transform(raw, scale);
  let { pts:simp, eps } = simplify(world);
  if (simp.length>8){ const a=simp[0], b=simp[simp.length-1];
    if (Math.hypot(a.x-b.x,a.z-b.z) < Math.max(2,FK_WIDTH*0.6)) simp.pop(); }
  const guard = limitCurvature(simp, FK_WIDTH/2);
  // raise a branch over any FLAT self-crossing so it renders as an over/under, not a z-fighting X.
  // (opts.bridge===false skips it.) Runs AFTER the curvature guard so the hump isn't smoothed away.
  const bridge = opts.bridge===false ? { pts:guard.pts, bridged:[] } : synthesizeBridges(guard.pts, FK_WIDTH/2);
  const points = bridge.pts.map(p=>({ x:round1(p.x), z:round1(p.z), y:round1(p.y) }));
  const id = opts.id || course.replace(/_/g,'-');
  const name = opts.name || NAMES[course] || course;
  const itemRows = deriveItemRows(course, raw[0], scale, points);   // authentic MK64 item-box rows
  const track = { v:1, name, width:FK_WIDTH, laps:opts.laps||3, gridSide:'left', itemRows, points };

  const ribbon = crClosed(points, 20);
  let len=0; for (let i=0;i<ribbon.length;i++){ const a=ribbon[i], b=ribbon[(i+1)%ribbon.length]; len+=Math.hypot(b.x-a.x,b.z-a.z); }
  const xs=points.map(p=>p.x), zs=points.map(p=>p.z), ys=points.map(p=>p.y);
  const v = validate(track);
  const stats = { course, id, name, rawPts:raw.length, scale:+scale.toFixed(4),
    ctrlPts:points.length, lapLen:Math.round(len),
    spanX:Math.round(Math.max(...xs)-Math.min(...xs)), spanZ:Math.round(Math.max(...zs)-Math.min(...zs)),
    elevMin:+Math.min(...ys).toFixed(1), elevMax:+Math.max(...ys).toFixed(1),
    minRadius:+splineRadii(points).minR.toFixed(1), guardFrom:+guard.before.toFixed(1), guardIters:guard.iters,
    crossings:v.crossings, bridgesSynth:bridge.bridged.length, itemRows, valid:v.ok, warnings:v.warnings, world };
  return { track, stats };
}

export { convert, parsePath, measureRoadWidth, crClosed, splineRadii };

// ---- CLI ----------------------------------------------------------------------
const argv = process.argv.slice(2);
if (argv.length){
  const ALL = fs.readdirSync(path.join(MK64_SRC,'courses'))
    .filter(c=>{ try{ return fs.readFileSync(path.join(MK64_SRC,'courses',c,'course_data.c'),'utf8').includes(`d_course_${c}_track_path[] = {`);}catch{return false;} });
  if (argv[0]==='--survey' || argv[0]==='--all'){
    const rows=[];
    for (const c of ALL){ try{ rows.push(convert(c).stats); }catch(e){ rows.push({course:c, err:e.message}); } }
    for (const r of rows){
      if (r.err){ console.log(r.course.padEnd(20), 'ERR', r.err); continue; }
      console.log(`${r.course.padEnd(20)} pts ${String(r.ctrlPts).padStart(3)}  lap ${String(r.lapLen).padStart(4)}m  ${String(r.spanX).padStart(4)}x${String(r.spanZ).toString().padEnd(4)}m  elev ${String(r.elevMin).padStart(6)}..${String(r.elevMax).padStart(5)}  minR ${String(r.minRadius).padStart(4)} (from ${String(r.guardFrom).padStart(4)}, ${r.guardIters}it)  cross ${r.crossings}  ${r.valid?'ok':'WARN '+r.warnings.join(',')}`);
    }
    if (argv[0]==='--all'){
      const out=argv.includes('--out')?argv[argv.indexOf('--out')+1]:'.';
      const map={}; for (const c of ALL){ try{ const {track}=convert(c); map[track.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')]=track; }catch{} }
      fs.writeFileSync(path.join(out,'builtin_tracks.json'), JSON.stringify(map,null,2));
      console.log('\nwrote builtin_tracks.json ('+Object.keys(map).length+' tracks)');
    }
  } else {
    const course=argv[0];
    const name = argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined;
    const laps = argv.includes('--laps') ? +argv[argv.indexOf('--laps')+1] : 3;
    const out  = argv.includes('--out') ? argv[argv.indexOf('--out')+1] : '.';
    const { track, stats } = convert(course, { name, laps });
    console.log(JSON.stringify(stats, (k,v)=>k==='world'?undefined:v, 2));
    fs.writeFileSync(path.join(out, `${stats.id}.fktrack.json`), JSON.stringify(track));
    console.log('wrote', `${stats.id}.fktrack.json`);
  }
}
