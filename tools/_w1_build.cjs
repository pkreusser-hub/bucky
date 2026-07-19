"use strict";
/* WAVE-1 THEME PACK content builder — generates height-seated terrain/waters/paint/tufts/objects
 * blocks and patches them between the per-track W1GEN_<id>_START / _END markers in
 * assets/farmkart-track.js. Uses the REAL FK_TRACK math (groundHills/sampleHeight) so every prop
 * sits on the ground. One centerline replica per track (Catmull-Rom tension .5, closed) matches the
 * game's resample. Re-run after tweaking placements:  node tools/_w1_build.cjs
 *
 *   kalimari-desert -> "Dust Devil Gulch"   (red-rock desert, mesas, cacti, steam train)
 *   koopa-troopa-beach -> "Seashell Shores" (tropical cove, seaLevel ocean + beaches, palms, crabs)
 *   dks-jungle-parkway -> "Croc Creek Canopy" (jungle river gorge, dense trees, turtles, creek)
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const TRACK_JS = path.join(ROOT, "assets/farmkart-track.js");
function loadModule(code){ const win={}; new Function("window","document",code)(win,undefined); return win.FK_TRACK; }
const FK = loadModule(fs.readFileSync(TRACK_JS,"utf8"));

const N = 400, WIDTH = 18, HALF = 9;
const OPTS0 = { amp:3.4, wave:60, margin:9 };

// ---- centerline replica (matches THREE CatmullRomCurve3 'catmullrom' tension .5, closed) ----
function catmull(points, M){
  const n=points.length, P=(i)=>points[((i%n)+n)%n], out=[];
  for(let i=0;i<M;i++){ const t=i/M*n, seg=Math.floor(t), u=t-seg, p0=P(seg-1),p1=P(seg),p2=P(seg+1),p3=P(seg+2), u2=u*u,u3=u2*u;
    const comp=(a0,a1,a2,a3)=>{const t1=(a2-a0)*0.5,t2=(a3-a1)*0.5;return (2*a1-2*a2+t1+t2)*u3+(-3*a1+3*a2-2*t1-t2)*u2+t1*u+a1;};
    out.push({x:comp(p0.x,p1.x,p2.x,p3.x),y:comp(p0.y||0,p1.y||0,p2.y||0,p3.y||0),z:comp(p0.z,p1.z,p2.z,p3.z)}); }
  return out;
}

// ---- build a per-track toolkit bound to that track's sampled geometry + terrain field ----
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

  // ---- terrain sculpt ----
  const CELL=6, tcells={};
  const keep=(k,v)=>{ tcells[k]=(tcells[k]===undefined)?v:(Math.abs(v)>Math.abs(tcells[k])?v:tcells[k]); };
  // raise/lower a smooth disc toward an ABSOLUTE target height (delta = target - naturalGround).
  // mode 'force' OVERWRITES prior cells (last-wins) — needed for islets raised back out of a
  // radialProfile sea floor (keep()'s max-abs rule would let the big negative sea delta win).
  function discTarget(cx,cz,rSolid,rOuter,target,mode){
    const lo=Math.floor((cx-rOuter)/CELL),hi=Math.ceil((cx+rOuter)/CELL),lz=Math.floor((cz-rOuter)/CELL),hz=Math.ceil((cz+rOuter)/CELL);
    for(let i=lo;i<=hi;i++)for(let j=lz;j<=hz;j++){ const x=i*CELL,z=j*CELL,d=Math.hypot(x-cx,z-cz); if(d>rOuter)continue;
      let w=1; if(d>rSolid){ w=1-(d-rSolid)/(rOuter-rSolid); w=w*w*(3-2*w); }
      const v=(target-groundHills(x,z))*w;
      if(mode==='force'){ if(Math.abs(v)>=0.03) tcells[i+","+j]=v; } else keep(i+","+j,v); }
  }
  // radial shoreline: for every cell, target = profileFn(distToCenterline). Used for the beach island ring.
  function radialProfile(profileFn){
    // bound to the track bbox + margin
    let minx=1e9,maxx=-1e9,minz=1e9,maxz=-1e9; for(const p of C){minx=Math.min(minx,p.x);maxx=Math.max(maxx,p.x);minz=Math.min(minz,p.z);maxz=Math.max(maxz,p.z);}
    const PAD=48;
    const lo=Math.floor((minx-PAD)/CELL),hi=Math.ceil((maxx+PAD)/CELL),lz=Math.floor((minz-PAD)/CELL),hz=Math.ceil((maxz+PAD)/CELL);
    for(let i=lo;i<=hi;i++)for(let j=lz;j<=hz;j++){ const x=i*CELL,z=j*CELL,d=nearestDist(x,z);
      const tgt=profileFn(d,x,z); if(tgt===null)continue; const delta=tgt-groundHills(x,z);
      if(Math.abs(delta)>=0.05) keep(i+","+j,delta); }
  }
  function terrain(){ const cells={}; for(const k in tcells){ const v=Math.round(tcells[k]*100)/100; if(Math.abs(v)>=0.05)cells[k]=v; } return {cell:CELL,cells}; }
  const _field=()=>({cell:CELL,cells:(function(){const c={};for(const k in tcells){const v=Math.round(tcells[k]*100)/100;if(Math.abs(v)>=0.05)c[k]=v;}return c;})()});
  const seat=(x,z)=>FK.sampleHeight(sampled,x,z,WIDTH,Object.assign({},OPTS0,{field:_field()}));
  // pure terrain height (no road skirt) at a point — for water-edge props on the bank/bed
  const groundAt=(x,z)=>groundHills(x,z);

  // ---- objects ----
  const objects=[]; let oi=0;
  const halfDiag=(sx,sz)=>0.5*Math.hypot(sx,sz);
  const clearOf=(x,z,sx,sz)=> nearestDist(x,z) >= HALF+1.6+halfDiag(sx,sz);
  // place a glb prop, base seated on ground. Skips if it would intrude on the road (corner clearance).
  function obj(model,x,z,size,rotY,extra){ extra=extra||{};
    const sx=extra.sx!=null?extra.sx:size, sz=extra.sz!=null?extra.sz:size, sy=extra.sy!=null?extra.sy:size;
    if(!extra.force && !clearOf(x,z,sx,sz)) return null;
    const y=extra.y!=null?extra.y:(seat(x,z)+sy*0.5);
    const o={ id:id.replace(/[^a-z]/g,'').slice(0,4)+"_o"+(++oi), tag:extra.tag||"", type:"glb",
      x:+x.toFixed(2), y:+y.toFixed(2), z:+z.toFixed(2), rotY:+(rotY||0).toFixed(3), sx, sy, sz, color:0, model };
    objects.push(o); return o;
  }
  // line of props along the road between arc fractions at a lateral offset (offset is to the FIELD side).
  function lineAlong(fA,fB,side,off,step,pickModel,sizeFn,jitter){ jitter=jitter||0; let ci=0;
    const span=(((fB-fA)%1)+1)%1 || 1; const steps=Math.max(1,Math.round(span*L/step));
    for(let s=0;s<=steps;s++){ const ff=fA+span*(s/steps); const a=atFrac(ff);
      const jx=((Math.sin(s*12.9898+fA*7.0)*43758.5453)%1+1)%1; const jo=off+(jx-0.5)*jitter;
      const x=a.x+a.nx*jo*side, z=a.z+a.nz*jo*side;
      const m=pickModel(s,x,z), sz=sizeFn(s,x,z); if(!m) continue;
      const rot=((Math.sin(s*7.3+11)*1000)%1)*Math.PI*2;
      obj(m,x,z,sz,rot,{tag:""}); ci++; }
    return ci;
  }
  // scatter within a disc, off-road, deterministic jitter
  function scatter(cx,cz,r,count,seed,pickModel,sizeFn,minRoadExtra){ minRoadExtra=minRoadExtra||0;
    let placed=0,tries=0,st=seed||1;
    while(placed<count && tries<count*16){ tries++; st=(st*1103515245+12345)&0x7fffffff; const a=st/0x7fffffff;
      st=(st*1103515245+12345)&0x7fffffff; const b=st/0x7fffffff;
      const ang=a*Math.PI*2, rad=Math.sqrt(b)*r, x=cx+Math.cos(ang)*rad, z=cz+Math.sin(ang)*rad;
      const m=pickModel(placed,x,z), sz=sizeFn(placed,x,z); if(!m) continue;
      if(nearestDist(x,z) < HALF+1.6+halfDiag(sz,sz)+minRoadExtra) continue;
      st=(st*1103515245+12345)&0x7fffffff; const rr=(st/0x7fffffff)*Math.PI*2;
      obj(m,x,z,sz,rr); placed++; }
    return placed;
  }

  // ---- paint ----
  const PCELL=6, pcells={};
  function paintDisc(cx,cz,r,color){ const lo=Math.floor((cx-r)/PCELL),hi=Math.ceil((cx+r)/PCELL),lz=Math.floor((cz-r)/PCELL),hz=Math.ceil((cz+r)/PCELL);
    for(let i=lo;i<=hi;i++)for(let j=lz;j<=hz;j++){ const x=i*PCELL,z=j*PCELL; if(Math.hypot(x-cx,z-cz)>r)continue; pcells[i+","+j]=color; } }
  function paintBand(fA,fB,side,off,width,color,step){ step=step||8; const span=(((fB-fA)%1)+1)%1||1; const steps=Math.round(span*L/step);
    for(let s=0;s<=steps;s++){ const a=atFrac(fA+span*(s/steps)); const cx=a.x+a.nx*off*side, cz=a.z+a.nz*off*side; paintDisc(cx,cz,width,color); } }
  const paint=()=>({cell:PCELL,cells:pcells});

  // ---- tufts ----
  const TCELL=6, tuftCells={};
  function tuftScatter(cx,cz,r,val,seed,dens){ let st=seed||1; const n=Math.round(Math.PI*r*r/(dens||260));
    for(let k=0;k<n;k++){ st=(st*1103515245+12345)&0x7fffffff; const a=st/0x7fffffff; st=(st*1103515245+12345)&0x7fffffff; const b=st/0x7fffffff;
      const x=cx+Math.cos(a*6.283)*Math.sqrt(b)*r, z=cz+Math.sin(a*6.283)*Math.sqrt(b)*r;
      if(nearestDist(x,z)<HALF+3)continue; tuftCells[Math.round(x/TCELL)+","+Math.round(z/TCELL)]=val; } }
  const tufts=()=>({cell:TCELL,cells:tuftCells});

  return { id, RAW, C, T, arcS, L, sampled, groundHills, nearestDist, atFrac, discTarget, radialProfile,
    terrain, seat, groundAt, objects, obj, lineAlong, scatter, paint, paintDisc, paintBand, tufts, tuftScatter };
}

// =====================================================================================
// DESERT — Dust Devil Gulch
// =====================================================================================
function buildDesert(){
  const K=makeKit("kalimari-desert");
  // ---- terrain: low mesas/ridges OUTSIDE a couple of sections (subtle, don't wall the whole lap) ----
  K.discTarget(300,-150, 16, 46, 7.5);   // east ridge above the fast descent (a canyon wall)
  K.discTarget(312,-255, 18, 48, 8.5);   // east ridge lower
  K.discTarget(152,-135, 14, 40, 6.0);   // infield butte the road curves around
  K.discTarget(-38, 55,  14, 42, 5.0);   // west ridge framing the home straight (gulch mouth)
  K.discTarget(120,175,  16, 44, 5.5);   // low mesa north of the top sweeper
  // ---- big organic paint patches: sun-baked sand + red rock + dry crack. Sand tones warmed +
  // darkened (reviewer fix: the old 0xc9a86a sand read the same value as the 0xc2a36b road — the
  // lower frame was one undifferentiated pale field; road is now deeper 0xa8845a, sand shifted warm). ----
  K.paintDisc(120,60,70,0xc59a5c); K.paintDisc(200,-160,80,0xb98f5a); K.paintDisc(120,-220,70,0xc59a5c);
  K.paintDisc(300,-200,55,0xa8623c); K.paintDisc(300,-150,40,0xb5714a); K.paintDisc(152,-135,34,0xa8623c);
  K.paintDisc(-38,55,34,0xb5714a); K.paintDisc(60,-260,45,0xb98f5a); K.paintDisc(240,-60,50,0xc59a5c);
  // near-road verge: a warm red-tan band both sides so the darker road ribbon pops off the ground
  K.paintBand(0.0,1.0, +1, 13, 6, 0xbb8250, 9); K.paintBand(0.0,1.0, -1, 13, 6, 0xbb8250, 9);
  // ---- props ----
  // little western town cluster right of the home straight / start
  K.obj("west_saloon", -34, 30, 12, 1.4, {tag:"saloon"});
  K.obj("west_well", -28, 8, 4, 0, {tag:""}); K.obj("west_windmill", -46, 70, 9, 0.5);
  K.obj("west_hut", -40, 100, 7, -0.6); K.obj("west_sign", -20, 45, 3, 0.9);
  K.obj("west_barrel", -24, 20, 2.2, 0); K.obj("west_barrel", -22, 24, 2.2, 0.7);
  // cliffs clustered on the mesas
  const cliffs=["cliff_large_rock","cliff_block_rock","cliff_corner_rock","cliff_cornerLarge_rock","cliff_diagonal_rock","cliff_half_rock"];
  K.scatter(300,-150,34,10,3,(i)=>cliffs[i%cliffs.length],()=>13+((Math.random()*0)|0)+ (0), 0);
  K.scatter(312,-255,36,12,7,(i)=>cliffs[(i+2)%cliffs.length],(i)=>12+(i%3)*2, 0);
  K.scatter(152,-135,26,7,11,(i)=>cliffs[(i+1)%cliffs.length],()=>11, 0);
  K.scatter(-38,55,28,6,5,(i)=>cliffs[(i+3)%cliffs.length],()=>11, 0);
  K.scatter(120,175,30,8,17,(i)=>cliffs[(i+4)%cliffs.length],(i)=>11+(i%2)*2, 0);
  // scattered boulders across the infield/outer
  const rocks=["rock_largeA","rock_largeB","rock_largeC","rock_largeD","rock_tallA","rock_tallB","rock_tallD","stone_largeA","stone_largeB"];
  K.scatter(180,-100,70,18,23,(i)=>rocks[i%rocks.length],(i)=>5+(i%4),3);
  K.scatter(120,-230,60,14,29,(i)=>rocks[(i+3)%rocks.length],(i)=>4.5+(i%3),3);
  K.scatter(90,80,50,10,31,(i)=>rocks[(i+5)%rocks.length],(i)=>5+(i%3),3);
  K.scatter(250,-250,40,8,37,(i)=>rocks[(i+2)%rocks.length],(i)=>5+(i%3),3);
  // cacti dotted along both sides of the lap (sparse)
  const cacti=["west_cactus_tall","west_cactus_short","west_cactus_prickly","west_cactus2","west_cactus_barrel"];
  K.lineAlong(0.02,0.98, +1, 20, 34, (s)=> (s%2===0)?cacti[s%cacti.length]:null, (s)=>4.5+(s%3), 8);
  K.lineAlong(0.02,0.98, -1, 20, 40, (s)=> (s%3===0)?cacti[(s+1)%cacti.length]:null, (s)=>4.5+(s%3), 8);
  // dry brush: stumps + logs + skulls scattered lightly
  K.scatter(150,-40,90,16,41,(i)=>["stump_old","stump_oldTall","log","west_skull","west_cactus_barrel"][i%5],(i)=>2.6+(i%3),2);
  // EDGE DRESSING on the open straights (reviewer fix: the empty lower-frame needed grounding
  // detail): sparse small rocks/brush/skulls hugging the verge at legal clearance (off 14, small
  // footprints so the corner rule half+1.5 still holds).
  const verge=["rock_smallA","west_skull","west_cactus_barrel","rock_smallB","stump_old","west_barrel","rock_smallD","west_cactus_short"];
  for(const [fA,fB] of [[0.0,0.10],[0.30,0.42],[0.56,0.64],[0.80,0.95]]){
    K.lineAlong(fA,fB, +1, 14, 20, (s)=>verge[s%verge.length], (s)=>2.4+(s%3)*0.4, 2);
    K.lineAlong(fA,fB, -1, 14, 24, (s)=>verge[(s+3)%verge.length], (s)=>2.4+(s%3)*0.4, 2);
  }
  // steam-train dressing beside the loop (static rail cars in the yard, well off the road)
  K.obj("west_railcar", 140, -180, 5, 0.0, {tag:""}); K.obj("west_railcar", 168, -172, 5, 0.1);
  // ---- tufts: sparse dry grass ----
  K.tuftScatter(120,60,60,1,5,900); K.tuftScatter(180,-140,80,1,9,900); K.tuftScatter(120,-230,60,1,13,1000);
  K.tuftScatter(60,-100,50,1,17,1000);
  return K;
}

// =====================================================================================
// BEACH — Seashell Shores  (seaLevel:-0.45 supplies the water; sculpt the shoreline)
// =====================================================================================
function buildBeach(){
  const K=makeKit("koopa-troopa-beach");
  // ISLAND SHORELINE (v2, reviewer fix: the sea must READ from the racing line): a LOW flat beach
  // strip right off the road (+0.05 — the road edge sits a touch above it), then a short slope into
  // the sea so the waterline sits ~19u from the centerline (~10u off the road edge) all lap long.
  // The old +0.6 berm at d24 hid the water from kart eye height almost everywhere (LOS cleared it
  // only past ~52u). With the 0.05 strip the open sea is unoccluded from ~22u out. The sea plane
  // (-0.45) does the flooding — no flood-fill runaway to contain; road y >= -0.41 stays dry.
  K.radialProfile((d)=>{
    if(d<=10) return null;                // road core + inner skirt — untouched
    if(d<=15) return 0.05;                // low dry beach strip (road edge sits slightly above it)
    if(d<=28){ const t=(d-15)/13, s=t*t*(3-2*t); return 0.05+(-2.4-0.05)*s; }  // short slope into the sea
    return -2.4;                          // shallow sea floor out to the map edge (bounded by radialProfile PAD)
  });
  // a few infield palm islets: raise small discs back above the sea. 'force' mode OVERWRITES the
  // radialProfile sea-floor cells (keep()'s max-abs rule would keep the bigger negative sea delta
  // and silently drown the islets).
  K.discTarget(70,-120, 8, 22, 1.4, 'force'); K.discTarget(20,-180, 7, 20, 1.2, 'force'); K.discTarget(-20,-70, 7, 18, 1.0, 'force');
  // ---- paint: pale dry-sand strip + wet-sand waterline ----
  K.paintBand(0.0,1.0, +1, 12, 6, 0xdcca92, 9); K.paintBand(0.0,1.0, -1, 12, 6, 0xdcca92, 9);
  K.paintBand(0.0,1.0, +1, 18, 6, 0xc9b478, 10); K.paintBand(0.0,1.0, -1, 18, 6, 0xc9b478, 10);
  // ---- props ----
  const palms=["tree_palm","tree_palmBend","tree_palmDetailedShort","jgl_palm","jgl_palm_tall","jgl_palm_short","jgl_palm_slim"];
  // leaning palm clusters along both shores
  K.lineAlong(0.0,1.0, +1, 17, 20, (s)=> (s%2===0)?palms[s%palms.length]:null, (s)=>8+(s%3)*1.5, 4);
  K.lineAlong(0.0,1.0, -1, 17, 22, (s)=> (s%2===1)?palms[(s+2)%palms.length]:null, (s)=>8+(s%3)*1.5, 4);
  // palm islets
  K.scatter(70,-120,14,4,3,(i)=>palms[i%palms.length],(i)=>8+(i%2)*2,0);
  K.scatter(20,-180,12,3,7,(i)=>palms[(i+1)%palms.length],()=>8,0);
  K.scatter(-20,-70,10,3,11,(i)=>palms[(i+3)%palms.length],()=>8,0);
  // beach parasols/tents + driftwood + shore rocks (on the dry strip — off 22 is open sea now)
  K.lineAlong(0.05,0.95, +1, 15.5, 55, (s)=> ["surv_tent","tent_smallOpen","surv_tent_canvas"][s%3], (s)=>4+(s%2), 1.5);
  K.scatter(90,60,45,12,17,(i)=>["log","log_large","rock_smallA","rock_smallB","stone_smallA"][i%5],(i)=>3+(i%3),2);
  K.scatter(60,-200,40,10,23,(i)=>["log","rock_smallB","rock_largeA","stone_smallB"][i%4],(i)=>3.5+(i%3),2);
  K.scatter(0,-40,40,9,29,(i)=>["log_large","rock_smallA","platform_beach"][i%3],(i)=>4+(i%2),2);
  // ---- tufts: dune grass dense on the land berm ----
  K.tuftScatter(90,60,45,2,5,180); K.tuftScatter(60,-200,45,2,9,180); K.tuftScatter(0,-40,45,2,13,200);
  K.tuftScatter(120,-100,55,1,17,240);
  return K;
}

// =====================================================================================
// JUNGLE — Croc Creek Canopy  (seaLevel:-15.5 fills a creek sculpted beside the gorge road)
// =====================================================================================
function buildJungle(){
  const K=makeKit("dks-jungle-parkway");
  // CREEK: a channel sculpted alongside the gorge road (where road y < -6), dropping below the -15.5 sea
  // so the river runs BESIDE the racing line, never over it (on-road height == the road y, well above -15.5).
  // Follow the gorge frac range at a lateral offset; carve soft discs down to -17.5.
  // Channel INNER edge must clear the road skirt (half+margin = 18u) so the drivable road edge is never
  // carved away — otherwise a kart drifting wide drops off the edge into the pit. Center at offset ~34,
  // rOuter 14 -> inner edge at offset 20 (past the 18u skirt); the creek reads ~11u off the road edge.
  (function(){ const fA=0.66, fB=0.93; const span=(((fB-fA)%1)+1)%1; const steps=Math.round(span*K.L/8);
    for(let s=0;s<=steps;s++){ const a=K.atFrac(fA+span*(s/steps)); if(a.y>-6) continue;   // only the deep gorge
      const off=34 + 4*Math.sin(s*0.6);   // meander a touch
      const cx=a.x+a.nx*off, cz=a.z+a.nz*off;
      K.discTarget(cx,cz, 7, 14, -17.5); }
  })();
  // ---- paint: deep jungle greens + a brown creek bed ----
  K.paintBand(0.0,1.0, +1, 16, 14, 0x2f4a1e, 9); K.paintBand(0.0,1.0, -1, 16, 14, 0x2f4a1e, 9);
  K.paintBand(0.0,1.0, +1, 34, 12, 0x28401a, 11); K.paintBand(0.0,1.0, -1, 34, 12, 0x28401a, 11);
  K.paintDisc(90,20,40,0x3a5a24); K.paintDisc(-120,120,50,0x3a5a24); K.paintDisc(-40,200,45,0x28401a);
  // ---- props: dense tree walls both sides ----
  const bigTrees=["tree_default","tree_detailed","tree_fat","tree_tall","tree_thin","jgl_palm_tall","tree_oak"];
  const midTrees=["jgl_palm","jgl_palm_short","tree_small","jgl_bamboo_a","jgl_bamboo_b"];
  // two staggered rows of tall trees each side = a canopy wall
  K.lineAlong(0.0,1.0, +1, 17, 12, (s)=>bigTrees[s%bigTrees.length], (s)=>8+(s%3), 5);
  K.lineAlong(0.0,1.0, -1, 17, 12, (s)=>bigTrees[(s+3)%bigTrees.length], (s)=>8+(s%3), 5);
  K.lineAlong(0.0,1.0, +1, 30, 15, (s)=>bigTrees[(s+1)%bigTrees.length], (s)=>9+(s%3), 6);
  K.lineAlong(0.0,1.0, -1, 30, 15, (s)=>bigTrees[(s+5)%bigTrees.length], (s)=>9+(s%3), 6);
  // understory bushes/ferns/bamboo hugging the verge (small footprint so they stay off-road)
  K.lineAlong(0.0,1.0, +1, 13.5, 9, (s)=> (s%2===0)?["jgl_bush_large","jgl_bush_broad","jgl_fern","jgl_plant_tall"][s%4]:null, ()=>3, 3);
  K.lineAlong(0.0,1.0, -1, 13.5, 9, (s)=> (s%2===1)?["jgl_fern","jgl_bush_broad","jgl_vines","jgl_plant_tall"][s%4]:null, ()=>3, 3);
  // GORGE-SLOPE understory (reviewer polish): ferns/bushes ON the gorge walls through the deep
  // section (mid-slope off 16.5 + upper slope off 22), not just the rims — deepens the ravine read.
  K.lineAlong(0.66,0.93, +1, 16.5, 8, (s)=>["jgl_fern","jgl_bush_broad","jgl_bush_large","jgl_plant_tall"][s%4], ()=>2.8, 2);
  K.lineAlong(0.66,0.93, -1, 16.5, 8, (s)=>["jgl_bush_broad","jgl_fern","jgl_plant_tall","jgl_bush_large"][s%4], ()=>2.8, 2);
  K.lineAlong(0.66,0.93, +1, 22, 10, (s)=>["jgl_bush_large","jgl_fern","jgl_bamboo_a","jgl_bush_broad"][s%4], ()=>3.4, 4);
  K.lineAlong(0.66,0.93, -1, 22, 10, (s)=>["jgl_fern","jgl_bush_large","jgl_bamboo_b","jgl_plant_tall"][s%4], ()=>3.4, 4);
  // ruins + idols scattered in the jungle
  K.scatter(-120,140,40,8,3,(i)=>["jgl_ruin_column","jgl_ruin_arch","jgl_idol","rock_largeB","stone_tallA"][i%5],(i)=>5+(i%3),3);
  K.scatter(90,120,45,10,7,(i)=>["tree_fat","tree_detailed","jgl_bush_large","rock_largeA"][i%4],(i)=>7+(i%3),3);
  K.scatter(-90,60,45,10,11,(i)=>["tree_tall","tree_default","jgl_palm_tall","jgl_bush_broad"][i%4],(i)=>7+(i%3),3);
  // ---- creek dressing: rocks + a waterfall + a footbridge over the creek (seated on the bank) ----
  (function(){ const a=K.atFrac(0.80); const off=34; const cx=a.x+a.nx*off, cz=a.z+a.nz*off;
    // bridge prop across the creek beside the road (seated on the bank so it never floats)
    K.obj("bridge_wood", cx, cz, 12, Math.atan2(a.tx,a.tz)+Math.PI/2, {tag:"creek bridge", force:true, sx:12, sy:5, sz:8});
    K.obj("jgl_waterfall", a.x+a.nx*46, a.z+a.nz*46, 10, 0, {tag:"waterfall"});
    for(let k=0;k<8;k++){ const b=K.atFrac(0.68+0.22*(k/7)); const ox=30+(k%3)*5; const rx=b.x+b.nx*ox, rz=b.z+b.nz*ox;
      K.obj("jgl_river_rocks", rx, rz, 3+(k%2), (k*0.7)%3); }
  })();
  // ---- tufts: dense jungle groundcover ----
  K.tuftScatter(-100,120,55,2,5,170); K.tuftScatter(90,120,55,2,9,170); K.tuftScatter(-40,200,45,2,13,180);
  K.tuftScatter(80,-40,45,2,17,190); K.tuftScatter(-140,110,40,2,21,200);
  // creek water body seed (flood-fill would run away here — seaLevel handles it — but expose nothing)
  return K;
}

// =====================================================================================
// ASSEMBLE + PATCH
// =====================================================================================
function j(o){ return JSON.stringify(o); }
function blockFor(K, withWaters){
  const lines=[];
  lines.push("      terrain:"+j(K.terrain())+",");
  if(withWaters) lines.push("      waters:"+j(withWaters)+",");
  lines.push("      paint:"+j(K.paint())+",");
  lines.push("      tufts:"+j(K.tufts())+",");
  lines.push("      objects:"+j(K.objects));
  return "\n      /* generated by tools/_w1_build.cjs — do not hand-edit; re-run the builder */\n"+lines.join("\n")+"\n      ";
}
function patch(src, tag, block){
  const START="/* W1GEN_"+tag+"_START", END="/* W1GEN_"+tag+"_END */";
  const si=src.indexOf(START), ei=src.indexOf(END);
  if(si<0||ei<0){ console.error("markers not found for",tag); process.exit(1); }
  const startLineEnd=src.indexOf("\n",si)+1;
  return src.slice(0,startLineEnd)+block+src.slice(ei);
}

const desert=buildDesert();
const beach=buildBeach();
const jungle=buildJungle();

let src=fs.readFileSync(TRACK_JS,"utf8");
src=patch(src,"kalimari", blockFor(desert,null));
src=patch(src,"koopa", blockFor(beach,null));
src=patch(src,"dks", blockFor(jungle,null));
fs.writeFileSync(TRACK_JS,src);

function stat(name,K){ const t=K.terrain(); console.log("  "+name+": terrain "+Object.keys(t.cells).length+" cells, objects "+K.objects.length+", paint "+Object.keys(K.paint().cells).length+", tufts "+Object.keys(K.tufts().cells).length); }
console.log("patched wave-1 theme pack:");
stat("Dust Devil Gulch (desert)", desert);
stat("Seashell Shores (beach)", beach);
stat("Croc Creek Canopy (jungle)", jungle);
