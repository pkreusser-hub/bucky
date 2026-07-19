"use strict";
/* WAVE-2 THEME PACK content builder — generates height-seated paint/tufts/objects (+ ramps) blocks and
 * patches them between the per-track W2GEN_<id>_START / _END markers in assets/farmkart-track.js.
 * Same machinery/lessons as tools/_w1_build.cjs (real FK_TRACK math so every prop sits on the ground).
 * Re-run after tweaking placements:  node tools/_w2_build.cjs
 *
 *   rainbow-road   -> "Starlight Skyway"        (fully STATIC literal — no generated block; the star/
 *                                                planet/edge-glow decor is a game-side FK_TRACK.buildSkywayDecor group)
 *   choco-mountain -> "Pumpkin Hollow"          (autumn-dusk mountain: leaf paint, dark pines/bare trees,
 *                                                mushrooms/stumps/logs, pumpkin patches, an abandoned camp;
 *                                                the jack-o-lantern LAMPS are game-side buildPumpkinLamps)
 *   wario-stadium  -> "Thunderdome Supercross"  (floodlit night supercross: RAMP jumps + grandstands,
 *                                                banner towers, track-light towers, overhead gantries,
 *                                                pit garages, pylons/barriers, start-gate checker paint)
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const TRACK_JS = path.join(ROOT, "assets/farmkart-track.js");
function loadModule(code){ const win={}; new Function("window","document",code)(win,undefined); return win.FK_TRACK; }
const FK = loadModule(fs.readFileSync(TRACK_JS,"utf8"));

const N = 400, WIDTH = 18, HALF = 9;
const OPTS0 = { amp:3.4, wave:60, margin:9 };

function catmull(points, M){
  const n=points.length, P=(i)=>points[((i%n)+n)%n], out=[];
  for(let i=0;i<M;i++){ const t=i/M*n, seg=Math.floor(t), u=t-seg, p0=P(seg-1),p1=P(seg),p2=P(seg+1),p3=P(seg+2), u2=u*u,u3=u2*u;
    const comp=(a0,a1,a2,a3)=>{const t1=(a2-a0)*0.5,t2=(a3-a1)*0.5;return (2*a1-2*a2+t1+t2)*u3+(-3*a1+3*a2-2*t1-t2)*u2+t1*u+a1;};
    out.push({x:comp(p0.x,p1.x,p2.x,p3.x),y:comp(p0.y||0,p1.y||0,p2.y||0,p3.y||0),z:comp(p0.z,p1.z,p2.z,p3.z)}); }
  return out;
}

function makeKit(id){
  const RAW = FK.BUILTIN_TRACKS[id];
  const C = catmull(RAW.points, N);
  const T=[]; for(let i=0;i<N;i++){const a=C[(i-1+N)%N],b=C[(i+1)%N];const dx=b.x-a.x,dz=b.z-a.z,h=Math.hypot(dx,dz)||1;T.push({x:dx/h,z:dz/h});}
  const arcS=[0]; let acc=0; for(let i=1;i<N;i++){acc+=Math.hypot(C[i].x-C[i-1].x,C[i].z-C[i-1].z);arcS[i]=acc;}
  const L=acc+Math.hypot(C[0].x-C[N-1].x,C[0].z-C[N-1].z);
  const sampled={centerPts:C,tangents:T,arcS,trackLen:L,samples:N};
  const groundHills=(x,z)=>FK.groundHills(x,z,OPTS0);
  const nearestDist=(x,z)=>FK.nearestOnCenter(sampled,x,z).dist;
  function atFrac(f){ let target=((f%1)+1)%1*L, bi=0; for(let i=0;i<N;i++){ if(arcS[i]>=target){bi=i;break;} bi=i; } const c=C[bi],t=T[bi]; return {x:c.x,z:c.z,nx:-t.z,nz:t.x,tx:t.x,tz:t.z,idx:bi,y:c.y}; }

  const CELL=6, tcells={};
  const keep=(k,v)=>{ tcells[k]=(tcells[k]===undefined)?v:(Math.abs(v)>Math.abs(tcells[k])?v:tcells[k]); };
  function discTarget(cx,cz,rSolid,rOuter,target){
    const lo=Math.floor((cx-rOuter)/CELL),hi=Math.ceil((cx+rOuter)/CELL),lz=Math.floor((cz-rOuter)/CELL),hz=Math.ceil((cz+rOuter)/CELL);
    for(let i=lo;i<=hi;i++)for(let j=lz;j<=hz;j++){ const x=i*CELL,z=j*CELL,d=Math.hypot(x-cx,z-cz); if(d>rOuter)continue;
      let w=1; if(d>rSolid){ w=1-(d-rSolid)/(rOuter-rSolid); w=w*w*(3-2*w); }
      keep(i+","+j,(target-groundHills(x,z))*w); }
  }
  function terrain(){ const cells={}; for(const k in tcells){ const v=Math.round(tcells[k]*100)/100; if(Math.abs(v)>=0.05)cells[k]=v; } return {cell:CELL,cells}; }
  const _field=()=>({cell:CELL,cells:(function(){const c={};for(const k in tcells){const v=Math.round(tcells[k]*100)/100;if(Math.abs(v)>=0.05)c[k]=v;}return c;})()});
  const seat=(x,z)=>FK.sampleHeight(sampled,x,z,WIDTH,Object.assign({},OPTS0,{field:_field()}));

  const objects=[]; let oi=0;
  const halfDiag=(sx,sz)=>0.5*Math.hypot(sx,sz);
  const clearOf=(x,z,sx,sz)=> nearestDist(x,z) >= HALF+1.7+halfDiag(sx,sz);
  function obj(model,x,z,size,rotY,extra){ extra=extra||{};
    const sx=extra.sx!=null?extra.sx:size, sz=extra.sz!=null?extra.sz:size, sy=extra.sy!=null?extra.sy:size;
    if(!extra.force && !clearOf(x,z,sx,sz)) return null;
    const y=extra.y!=null?extra.y:(seat(x,z)+sy*0.5);
    const o={ id:id.replace(/[^a-z]/g,'').slice(0,4)+"_o"+(++oi), tag:extra.tag||"", type:extra.type||"glb",
      x:+x.toFixed(2), y:+y.toFixed(2), z:+z.toFixed(2), rotY:+(rotY||0).toFixed(3), sx, sy, sz, color:extra.color!=null?extra.color:0 };
    if((extra.type||"glb")==="glb") o.model=model;
    objects.push(o); return o;
  }
  function lineAlong(fA,fB,side,off,step,pickModel,sizeFn,jitter,rotFn){ jitter=jitter||0; let ci=0;
    const span=(((fB-fA)%1)+1)%1 || 1; const steps=Math.max(1,Math.round(span*L/step));
    for(let s=0;s<=steps;s++){ const ff=fA+span*(s/steps); const a=atFrac(ff);
      const jx=((Math.sin(s*12.9898+fA*7.0)*43758.5453)%1+1)%1; const jo=off+(jx-0.5)*jitter;
      const x=a.x+a.nx*jo*side, z=a.z+a.nz*jo*side;
      const m=pickModel(s,x,z), sz=sizeFn(s,x,z); if(!m) continue;
      const rot=rotFn?rotFn(a,side):((Math.sin(s*7.3+11)*1000)%1)*Math.PI*2;
      obj(m,x,z,sz,rot,{tag:""}); ci++; }
    return ci;
  }
  function scatter(cx,cz,r,count,seed,pickModel,sizeFn,minRoadExtra){ minRoadExtra=minRoadExtra||0;
    let placed=0,tries=0,st=seed||1;
    while(placed<count && tries<count*16){ tries++; st=(st*1103515245+12345)&0x7fffffff; const a=st/0x7fffffff;
      st=(st*1103515245+12345)&0x7fffffff; const b=st/0x7fffffff;
      const ang=a*Math.PI*2, rad=Math.sqrt(b)*r, x=cx+Math.cos(ang)*rad, z=cz+Math.sin(ang)*rad;
      const m=pickModel(placed,x,z), sz=sizeFn(placed,x,z); if(!m) continue;
      if(nearestDist(x,z) < HALF+1.7+halfDiag(sz,sz)+minRoadExtra) continue;
      st=(st*1103515245+12345)&0x7fffffff; const rr=(st/0x7fffffff)*Math.PI*2;
      obj(m,x,z,sz,rr); placed++; }
    return placed;
  }

  const PCELL=6, pcells={};
  function paintDisc(cx,cz,r,color){ const lo=Math.floor((cx-r)/PCELL),hi=Math.ceil((cx+r)/PCELL),lz=Math.floor((cz-r)/PCELL),hz=Math.ceil((cz+r)/PCELL);
    for(let i=lo;i<=hi;i++)for(let j=lz;j<=hz;j++){ const x=i*PCELL,z=j*PCELL; if(Math.hypot(x-cx,z-cz)>r)continue; pcells[i+","+j]=color; } }
  function paintBand(fA,fB,side,off,width,color,step){ step=step||8; const span=(((fB-fA)%1)+1)%1||1; const steps=Math.round(span*L/step);
    for(let s=0;s<=steps;s++){ const a=atFrac(fA+span*(s/steps)); const cx=a.x+a.nx*off*side, cz=a.z+a.nz*off*side; paintDisc(cx,cz,width,color); } }
  // checker paint zone straddling the road across a short arc range (start/finish gate look)
  function paintChecker(fA,fB,c0,c1){ const span=(((fB-fA)%1)+1)%1||1; const steps=Math.round(span*L/3.2);
    for(let s=0;s<=steps;s++){ const a=atFrac(fA+span*(s/steps));
      for(let lane=-1;lane<=1;lane++){ const off=lane*5.5; const cx=a.x+a.nx*off, cz=a.z+a.nz*off;
        const parity=((s+lane+9)%2); paintDisc(cx,cz,3.0, parity?c0:c1); } } }
  const paint=()=>({cell:PCELL,cells:pcells});

  const TCELL=6, tuftCells={};
  function tuftScatter(cx,cz,r,val,seed,dens){ let st=seed||1; const n=Math.round(Math.PI*r*r/(dens||260));
    for(let k=0;k<n;k++){ st=(st*1103515245+12345)&0x7fffffff; const a=st/0x7fffffff; st=(st*1103515245+12345)&0x7fffffff; const b=st/0x7fffffff;
      const x=cx+Math.cos(a*6.283)*Math.sqrt(b)*r, z=cz+Math.sin(a*6.283)*Math.sqrt(b)*r;
      if(nearestDist(x,z)<HALF+3)continue; tuftCells[Math.round(x/TCELL)+","+Math.round(z/TCELL)]=val; } }
  const tufts=()=>({cell:TCELL,cells:tuftCells});

  return { id, RAW, C, T, arcS, L, sampled, groundHills, nearestDist, atFrac, discTarget,
    terrain, seat, objects, obj, lineAlong, scatter, paint, paintDisc, paintBand, paintChecker, tufts, tuftScatter };
}

// =====================================================================================
// PUMPKIN HOLLOW  (choco-mountain) — autumn-spooky mountain dusk
// =====================================================================================
function buildPumpkin(){
  const K=makeKit("choco-mountain");
  // ---- autumn paint: leaf-litter verge both sides + big organic rust/amber/brown patches ----
  K.paintBand(0.0,1.0, +1, 13, 6, 0x7a4a24, 9); K.paintBand(0.0,1.0, -1, 13, 6, 0x7a4a24, 9);   // warm leaf verge
  K.paintDisc(-90, 40, 46, 0x8a5a2a); K.paintDisc(40, -30, 40, 0x9a6a24); K.paintDisc(-120,-100, 50, 0x6e4520);
  K.paintDisc(-30,-150, 46, 0x8a5a2a); K.paintDisc(-160,-70, 40, 0x7a4a24); K.paintDisc(20, 20, 34, 0xa06a2e);
  K.paintDisc(-70,-40, 30, 0x5e3a1c);
  // ---- dark evergreen + bare-tree walls both sides (autumn mountain) ----
  const dkTrees=["tree_cone_dark","tree_pineTallA","tree_pineDefaultA","tree_pineRoundB","tree_default_fall","tree_thin"];
  K.lineAlong(0.0,1.0, +1, 18, 15, (s)=>dkTrees[s%dkTrees.length], (s)=>8+(s%3)*1.5, 6);
  K.lineAlong(0.0,1.0, -1, 18, 15, (s)=>dkTrees[(s+2)%dkTrees.length], (s)=>8+(s%3)*1.5, 6);
  K.lineAlong(0.0,1.0, +1, 32, 20, (s)=> (s%2===0)?dkTrees[(s+1)%dkTrees.length]:null, (s)=>9+(s%3)*1.5, 7);
  K.lineAlong(0.0,1.0, -1, 32, 20, (s)=> (s%2===1)?dkTrees[(s+4)%dkTrees.length]:null, (s)=>9+(s%3)*1.5, 7);
  // ---- forest floor: mushrooms + stumps + logs hugging the verge (small footprints) ----
  const floor=["mushroom_red","mushroom_redGroup","stump_old","stump_oldTall","stump_round","log","log_large","mushroom_tanTall"];
  K.lineAlong(0.0,1.0, +1, 13.5, 11, (s)=> (s%2===0)?floor[s%floor.length]:null, (s)=>2.6+(s%3)*0.4, 3);
  K.lineAlong(0.0,1.0, -1, 13.5, 11, (s)=> (s%2===1)?floor[(s+3)%floor.length]:null, (s)=>2.6+(s%3)*0.4, 3);
  // ---- pumpkin patches (crop_pumpkin) in a few off-road clusters ----
  K.scatter(-90, 40, 26, 9, 3, ()=>"crop_pumpkin", (i)=>1.8+(i%3)*0.5, 2);
  K.scatter(40, -30, 24, 8, 7, ()=>"crop_pumpkin", (i)=>1.8+(i%3)*0.5, 2);
  K.scatter(-120,-100, 26, 8, 11, ()=>"crop_pumpkin", (i)=>1.8+(i%2)*0.6, 2);
  K.scatter(-30,-150, 22, 7, 13, ()=>"crop_pumpkin", (i)=>1.8+(i%3)*0.5, 2);
  // ---- ABANDONED CAMP vignette off the west side (tents + campfire + logs) ----
  (function(){ const a=K.atFrac(0.20); const off=30; const cx=a.x+a.nx*off, cz=a.z+a.nz*off;
    K.obj("surv_tent", cx, cz, 5, 0.4, {tag:"camp"});
    K.obj("tent_smallClosed", cx-8, cz+4, 4, 1.1, {tag:"camp"});
    K.obj("campfire_logs", cx-3, cz-6, 2.2, 0, {tag:"campfire"});
    K.obj("log", cx+5, cz-4, 3, 0.6, {tag:""}); K.obj("stump_round", cx-9, cz-3, 2.4, 0);
  })();
  // ---- scattered woodland detail across the infield/outer ----
  K.scatter(-70,-40, 55, 12, 17, (i)=>["tree_pineRoundA","stump_oldTall","rock_largeB","mushroom_redGroup","log_stack"][i%5], (i)=>4+(i%3), 3);
  K.scatter(30, 10, 45, 10, 19, (i)=>["tree_cone_dark","tree_default_fall","rock_largeA","stump_old"][i%4], (i)=>6+(i%3), 3);
  // ---- tufts: sparse dry grass ----
  K.tuftScatter(-90,40,44,1,5,600); K.tuftScatter(40,-30,40,1,9,650); K.tuftScatter(-120,-100,46,1,13,650);
  K.tuftScatter(-30,-150,40,1,17,700);
  return K;
}

// =====================================================================================
// THUNDERDOME SUPERCROSS  (wario-stadium) — floodlit night dirt supercross stadium
// =====================================================================================
function buildThunder(){
  const K=makeKit("wario-stadium");
  const yaw=(a)=>Math.atan2(a.tx,a.tz);            // heading (matches trackDirectionAt/ramps)
  // ---- RAMP JUMPS on flat straights (type:ramp -> collision + launch; rotY set by alignRampsToTrack) ----
  for(const f of [0.074, 0.205, 0.394, 0.613]){ const a=K.atFrac(f); const roadY=K.seat(a.x,a.z);
    K.obj(null, a.x, a.z, 0, yaw(a), {type:"ramp", tag:"jump", sx:18, sy:2.2, sz:14, y:+(roadY+1.1).toFixed(2), color:0x8a6a4a, force:true}); }
  // ---- OVERHEAD GANTRIES straddling the road on ISOLATED straights (wide sx -> corners clear the road
  // even where it curves back; tall -> beam overhead). Fracs chosen so all 4 corners stay >half+1.5. ----
  for(const f of [0.07, 0.62]){ const a=K.atFrac(f); const gy=K.seat(a.x,a.z);
    K.obj("race_overhead", a.x, a.z, 0, yaw(a), {tag:"gantry", sx:24, sy:9, sz:3.2, y:+(gy+4.5).toFixed(2), force:true}); }
  // ---- GRANDSTANDS ringing OUTSIDE the walls, facing the track (front toward road) ----
  const stands=["race_grandStand","race_grandStandCovered","race_grandStandAwning","race_grandStandRound","race_grandStandCoveredRound"];
  // face-inward rotation: model front at rotY=0 faces +Z; point +Z toward the road = inward normal dir
  const faceIn=(a,side)=>Math.atan2(-a.nx*side, -a.nz*side);
  K.lineAlong(0.02,0.12, +1, 30, 24, (s)=>stands[s%stands.length], ()=>13, 3, faceIn);   // home straight
  K.lineAlong(0.34,0.44, -1, 30, 24, (s)=>stands[(s+2)%stands.length], ()=>13, 3, faceIn); // top straight
  K.lineAlong(0.60,0.70, +1, 30, 26, (s)=>stands[(s+1)%stands.length], ()=>13, 3, faceIn); // back straight
  K.lineAlong(0.14,0.22, -1, 30, 26, (s)=>stands[(s+3)%stands.length], ()=>13, 3, faceIn);
  // ---- TRACK-LIGHT TOWERS at the corners (bright emissive heads via the model) ----
  const lightSpots=[[0.16,-1],[0.28,+1],[0.44,-1],[0.56,+1],[0.72,-1],[0.86,+1],[0.06,-1]];
  for(const [f,side] of lightSpots){ const a=K.atFrac(f); const off=24; const x=a.x+a.nx*off*side, z=a.z+a.nz*off*side;
    K.obj("race_lightPostLarge", x, z, 11, faceIn(a,side)); }
  // ---- BANNER TOWERS + billboards for stadium dressing ----
  const banners=["race_bannerTowerRed","race_bannerTowerGreen","race_billboard","race_billboardDouble_exclusive","race_flagCheckers"];
  K.lineAlong(0.0,1.0, +1, 22, 60, (s)=>banners[s%banners.length], (s)=>7+(s%2)*2, 4, faceIn);
  K.lineAlong(0.0,1.0, -1, 22, 66, (s)=>banners[(s+2)%banners.length], (s)=>7+(s%2)*2, 4, faceIn);
  // ---- PIT GARAGES / OFFICE cluster near the start ----
  (function(){ const a=K.atFrac(0.955); const off=27; const cx=a.x+a.nx*off, cz=a.z+a.nz*off; const r=faceIn(a,1);
    K.obj("race_pitsGarage", cx, cz, 10, r, {tag:"pits"}); K.obj("race_pitsGarageClosed", cx-16, cz+2, 10, r);
    K.obj("race_pitsOffice", cx+16, cz-2, 9, r); K.obj("race_radarEquipment", cx+2, cz-9, 4, r);
  })();
  // ---- PYLONS + BARRIERS as edge dressing (small footprints hugging the verge) ----
  const edge=["race_pylon","race_barrierRed","race_barrierWhite","race_pylon","race_barrierWall","race_pylon"];
  K.lineAlong(0.0,1.0, +1, 12.5, 16, (s)=>edge[s%edge.length], (s)=>2.2+(s%2)*0.6, 1.5, faceIn);
  K.lineAlong(0.0,1.0, -1, 12.5, 18, (s)=>edge[(s+3)%edge.length], (s)=>2.2+(s%2)*0.6, 1.5, faceIn);
  // ---- START-GATE checker paint across the grid + dirt paint verge ----
  K.paintChecker(0.965, 0.02, 0x101012, 0xe8e8ec);
  K.paintBand(0.0,1.0, +1, 12, 5, 0x7a5c3c, 9); K.paintBand(0.0,1.0, -1, 12, 5, 0x7a5c3c, 9); // groomed dirt verge
  K.paintDisc(120,60,60,0x6e5232); K.paintDisc(180,-90,55,0x76583a); K.paintDisc(60,120,50,0x6e5232);
  return K;
}

// =====================================================================================
// ASSEMBLE + PATCH
// =====================================================================================
function j(o){ return JSON.stringify(o); }
function blockFor(K, withTufts){
  const lines=[];
  lines.push("      terrain:"+j(K.terrain())+",");
  lines.push("      paint:"+j(K.paint())+",");
  if(withTufts) lines.push("      tufts:"+j(K.tufts())+",");
  lines.push("      objects:"+j(K.objects));
  return "\n      /* generated by tools/_w2_build.cjs — do not hand-edit; re-run the builder */\n"+lines.join("\n")+"\n      ";
}
function patch(src, tag, block){
  const START="/* W2GEN_"+tag+"_START", END="/* W2GEN_"+tag+"_END */";
  const si=src.indexOf(START), ei=src.indexOf(END);
  if(si<0||ei<0){ console.error("markers not found for",tag); process.exit(1); }
  const startLineEnd=src.indexOf("\n",si)+1;
  return src.slice(0,startLineEnd)+block+src.slice(ei);
}

const pumpkin=buildPumpkin();
const thunder=buildThunder();

let src=fs.readFileSync(TRACK_JS,"utf8");
src=patch(src,"choco", blockFor(pumpkin, true));
src=patch(src,"wario", blockFor(thunder, false));
fs.writeFileSync(TRACK_JS,src);

function stat(name,K){ const t=K.terrain(); console.log("  "+name+": terrain "+Object.keys(t.cells).length+" cells, objects "+K.objects.length+" (glb "+K.objects.filter(o=>o.type==='glb').length+", ramp "+K.objects.filter(o=>o.type==='ramp').length+"), paint "+Object.keys(K.paint().cells).length); }
console.log("patched wave-2 theme pack:");
stat("Pumpkin Hollow (choco)", pumpkin);
stat("Thunderdome Supercross (wario)", thunder);
