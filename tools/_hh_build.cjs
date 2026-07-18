"use strict";
/* Harvest Hollow content builder — generates the height-seated terrain/waters/paint/tufts/objects
 * block and patches it between the HH_GEN_START / HH_GEN_END markers in assets/farmkart-track.js.
 * Uses the REAL FK_TRACK math (groundHills/sampleHeight) so every prop sits on the ground. The
 * centerline replica (Catmull-Rom, tension 0.5, closed) matched the game's resample byte-for-byte
 * on closure/slope/length, so seating heights are game-accurate. Re-run after tweaking placements. */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const TRACK_JS = path.join(ROOT, "assets/farmkart-track.js");
function loadModule(code){ const win={}; new Function("window","document",code)(win,undefined); return win.FK_TRACK; }
const FK = loadModule(fs.readFileSync(TRACK_JS,"utf8"));

// ---- centerline replica (matches THREE CatmullRomCurve3 'catmullrom' tension .5, closed) ----
const RAW = FK.BUILTIN_TRACKS["harvest-hollow"];
const PTS = RAW.points;
const N = 400;
function catmull(points, N){
  const n=points.length, P=(i)=>points[((i%n)+n)%n], out=[];
  for(let i=0;i<N;i++){ const t=i/N*n, seg=Math.floor(t), u=t-seg, p0=P(seg-1),p1=P(seg),p2=P(seg+1),p3=P(seg+2), u2=u*u,u3=u2*u;
    const comp=(a0,a1,a2,a3)=>{const t1=(a2-a0)*0.5,t2=(a3-a1)*0.5;return (2*a1-2*a2+t1+t2)*u3+(-3*a1+3*a2-2*t1-t2)*u2+t1*u+a1;};
    out.push({x:comp(p0.x,p1.x,p2.x,p3.x),y:comp(p0.y||0,p1.y||0,p2.y||0,p3.y||0),z:comp(p0.z,p1.z,p2.z,p3.z)}); }
  return out;
}
const C = catmull(PTS, N);
const T = []; for(let i=0;i<N;i++){const a=C[(i-1+N)%N],b=C[(i+1)%N];const dx=b.x-a.x,dz=b.z-a.z,h=Math.hypot(dx,dz)||1;T.push({x:dx/h,z:dz/h});}
const arcS=[0]; let acc=0; for(let i=1;i<N;i++){acc+=Math.hypot(C[i].x-C[i-1].x,C[i].z-C[i-1].z);arcS[i]=acc;}
const L = acc + Math.hypot(C[0].x-C[N-1].x,C[0].z-C[N-1].z);
const sampled = { centerPts:C, tangents:T, arcS, trackLen:L, samples:N };
const WIDTH = 18, HALF = 9;
const OPTS0 = { amp:3.4, wave:60, margin:9 };
const groundHills = (x,z)=> FK.groundHills(x,z,OPTS0);
const nearestDist = (x,z)=> FK.nearestOnCenter(sampled,x,z).dist;
const nearestIdx  = (x,z)=>{ let bi=0,bd=1e18; for(let i=0;i<N;i++){const dx=C[i].x-x,dz=C[i].z-z,d=dx*dx+dz*dz;if(d<bd){bd=d;bi=i;}} return bi; };
// sample at arc fraction f -> {x,z, nx,nz(left normal), yaw}
function atFrac(f){ let target=((f%1)+1)%1*L, bi=0; for(let i=0;i<N;i++){ if(arcS[i]>=target){bi=i;break;} bi=i; } const c=C[bi],t=T[bi]; return {x:c.x,z:c.z,nx:-t.z,nz:t.x,tx:t.x,tz:t.z,idx:bi,y:c.y}; }

// =================== TERRAIN SCULPT (cell 4): ford plateau + pond basin ===================
const CELL = 4;
const tcells = {};
function keep(k,v){ tcells[k] = (tcells[k]===undefined) ? v : (Math.abs(v)>Math.abs(tcells[k])?v:tcells[k]); }
function discTarget(cx,cz,rSolid,rOuter,target){
  const lo=Math.floor((cx-rOuter)/CELL),hi=Math.ceil((cx+rOuter)/CELL),lz=Math.floor((cz-rOuter)/CELL),hz=Math.ceil((cz+rOuter)/CELL);
  for(let i=lo;i<=hi;i++)for(let j=lz;j<=hz;j++){ const x=i*CELL,z=j*CELL,d=Math.hypot(x-cx,z-cz); if(d>rOuter)continue;
    let w=1; if(d>rSolid){ w=1-(d-rSolid)/(rOuter-rSolid); w=w*w*(3-2*w); }
    const gh=groundHills(x,z); keep(i+","+j, (target-gh)*w); }
}
// FORD: solid +0.8 plateau out to r26 (fully rings the ~20u creek), taper to natural by r40.
discTarget(206,-77, 26, 40, 0.8);
// POND: bowl bottom -2.6 easing up to a +0.6 sealing rim, taper past it.
const POND = { x:-70, z:-38 };
(function(){ const rBowl=17, rRim=25;
  const lo=Math.floor((POND.x-rRim)/CELL),hi=Math.ceil((POND.x+rRim)/CELL),lz=Math.floor((POND.z-rRim)/CELL),hz=Math.ceil((POND.z+rRim)/CELL);
  for(let i=lo;i<=hi;i++)for(let j=lz;j<=hz;j++){ const x=i*CELL,z=j*CELL,d=Math.hypot(x-POND.x,z-POND.z); if(d>rRim)continue;
    let target; if(d<rBowl){ const t=d/rBowl; target=-2.6+(0.6-(-2.6))*(t*t); } else { let w=1-(d-rBowl)/(rRim-rBowl); w=w*w*(3-2*w); target=0.6*w; }
    const gh=groundHills(x,z); keep(i+","+j, target-gh); }
})();
const terrain={cell:CELL,cells:{}}; let ntc=0;
for(const k in tcells){ const v=Math.round(tcells[k]*100)/100; if(Math.abs(v)>=0.05){terrain.cells[k]=v;ntc++;} }
const seatOpts = Object.assign({},OPTS0,{field:terrain});
const seat = (x,z)=> FK.sampleHeight(sampled,x,z,WIDTH,seatOpts);      // visible ground (with sculpt)

// =================== WATERS ===================
const waters=[ {id:"hh_ford",x:213,z:-79,y:-0.35}, {id:"hh_pond",x:POND.x,z:POND.z,y:-1.35} ];

// =================== OBJECTS (props) ===================
let oi=0; const objects=[];
function obj(model,x,z,size,rotY,extra){ const sy=(extra&&extra.sy!=null)?extra.sy:size;
  const o={ id:"hh_o"+(++oi), tag:(extra&&extra.tag)||"", type:"glb", x:+x.toFixed(2),
    y:+((extra&&extra.y!=null?extra.y:(seat(x,z)+sy*0.5))).toFixed(2), z:+z.toFixed(2),
    rotY:+(rotY||0).toFixed(3), sx:(extra&&extra.sx!=null)?extra.sx:size, sy:sy, sz:(extra&&extra.sz!=null)?extra.sz:size, color:0, model };
  objects.push(o); return o; }
// RAMP (physics jump) — seat its base on the road approach; alignRampsToTrack sets rotY at load.
objects.push({ id:"hh_ramp", tag:"hay jump", type:"ramp", x:227, y:+(seat(227,-60)+0.85).toFixed(2), z:-60, rotY:0, sx:18, sy:1.7, sz:12, color:0xcaa46a });

// helper: place a line of props along the road between two arc fractions at a lateral offset
function lineAlong(fA,fB,side,off,step,pick,jitter){ jitter=jitter||0;
  let f=fA; const span=((fB-fA)+1)%1 || (fB>fA?fB-fA:1);
  const steps=Math.max(1,Math.round(span*L/step));
  for(let s=0;s<=steps;s++){ const ff=fA+span*(s/steps); const a=atFrac(ff);
    const jx=(Math.sin(s*12.9898)*43758.5453%1); const jo=off+(jx-0.5)*jitter;
    const x=a.x+a.nx*jo*side, z=a.z+a.nz*jo*side;
    if(nearestDist(x,z)<HALF+2) continue;           // never on the road
    pick(x,z,a,s); }
}
// scatter within a disc, off-road, spaced by a simple grid jitter
function scatter(cx,cz,r,count,seed,pick,minRoad){ minRoad=minRoad||HALF+4;
  let placed=0,tries=0; let st=seed||1;
  while(placed<count && tries<count*12){ tries++; st=(st*1103515245+12345)&0x7fffffff; const a=(st/0x7fffffff);
    st=(st*1103515245+12345)&0x7fffffff; const b=(st/0x7fffffff);
    const ang=a*Math.PI*2, rad=Math.sqrt(b)*r, x=cx+Math.cos(ang)*rad, z=cz+Math.sin(ang)*rad;
    if(nearestDist(x,z)<minRoad) continue; pick(x,z); placed++; }
}

// ---- FARMHOUSE + yard (right of the home lane; some ahead so it frames the grid on the way up) ----
obj("farm_silo_house", 36, 40, 15, -1.35, {tag:"farmhouse"});
obj("farm_small_barn", 52, 66, 12, -0.9, {tag:"barn"});
obj("farm_barn", 30, 6, 13, -1.4, {tag:"barn"});
obj("tree_fat", 24, 56, 8, 0);
obj("tree_oak", 22, 24, 8.5, 0);
obj("west_haystack", 30, -4, 3.2, 0.3, {tag:"hay"});
obj("surv_box", 26, 14, 2.2, 0.6);

// ---- HOME-LANE FENCES (wooden ranch fence both sides; glb = visual only) ----
lineAlong(0.965, 0.06, +1, 12.5, 7, (x,z)=>obj("farm_fence",x,z,5.2,0));
lineAlong(0.965, 0.06, -1, 12.5, 7, (x,z)=>obj("farm_fence",x,z,5.2,0));

// ---- PASTURE fences (procedural rings) + a few gate/props ----
function ring(cx,cz,r,nseg){ const pts=[]; for(let k=0;k<=nseg;k++){ const a=k/nseg*Math.PI*2; const x=cx+Math.cos(a)*r, z=cz+Math.sin(a)*r; pts.push({x:+x.toFixed(1),z:+z.toFixed(1)}); } return pts; }
const fences=[
  { id:"hh_fence_pn", tag:"pasture", style:"rail", points:ring(95,170,17,14), height:1.6, postGap:6 },
  { id:"hh_fence_ps", tag:"pasture", style:"rail", points:ring(140,80,18,14), height:1.6, postGap:6 },
];

// ---- CROP FIELDS (gold) beside the crop esses (right side ~s 0.36..0.55) ----
const cropModels=["crops_cornStageD","crops_cornStageC","crops_wheatStageB","crops_cornStageD","crop_pumpkin"];
scatter(250,20,26,26,7,(x,z)=>obj(cropModels[(Math.abs(x*7+z)|0)%cropModels.length],x,z,3.4,(x*0.3)%3),HALF+5);
scatter(206,-8,16,14,11,(x,z)=>obj(cropModels[(Math.abs(x*3+z)|0)%cropModels.length],x,z,3.2,(z*0.2)%3),HALF+6);
// a couple of dirt-row + scarecrow accents
obj("crops_dirtRow",252,36,4,0.2); obj("crops_dirtRow",248,4,4,0.5);

// ---- ORCHARD (fruit trees) along the bottom, both sides (~s 0.56..0.70) ----
const orchardTrees=["tree_fat","tree_oak","tree_detailed","tree_default","tree_fat"];
lineAlong(0.565, 0.70, +1, 16, 12, (x,z,a,s)=>obj(orchardTrees[s%orchardTrees.length],x,z,7.5,0));
lineAlong(0.565, 0.70, -1, 16, 12, (x,z,a,s)=>obj(orchardTrees[(s+2)%orchardTrees.length],x,z,7.8,0));
lineAlong(0.575, 0.69, -1, 27, 15, (x,z,a,s)=>obj(orchardTrees[(s+1)%orchardTrees.length],x,z,7,0));

// ---- WINDMILL at the hairpin (inside the turn) ----
obj("farm_tower_windmill", -6, -128, 17, 0.4, {tag:"windmill"});
obj("rock_largeB", -30, -132, 5.5, 0.7); obj("rock_smallA", 6, -132, 4, 1.2);

// ---- BARNYARD: open barn straddling the road + silo + coop + clutter (~s 0.87..0.93) ----
// open barn over the chicane; shifted ~half a bay off the racing line so the mid support post
// clears the driving line (the wide opening still spans the 18u road). Big + tall for camera clearance.
(function(){ const a=atFrac(0.883); const yaw=Math.atan2(a.tx,a.tz); const off=5.5;
  const bx=a.x + a.nx*off, bz=a.z + a.nz*off;
  objects.push({ id:"hh_barn_open", tag:"open barn", type:"glb", model:"farm_open_barn",
    x:+bx.toFixed(2), z:+bz.toFixed(2), y:+(seat(bx,bz)+15).toFixed(2), rotY:+yaw.toFixed(3), sx:30, sy:30, sz:30, color:0 }); })();
obj("farm_silo", -58, -66, 13, 0, {tag:"silo"});
obj("farm_chickencoop", -54, -44, 6, 0.8, {tag:"coop"});
obj("west_haystack", -50, -78, 3, 0.4); obj("surv_barrel", -52, -54, 2.4, 0);
obj("surv_box_large", -49, -50, 2.6, 0.5); obj("surv_box", -47, -46, 2, 1.1);
obj("farm_fence", -52, -36, 5, 0.6); obj("tree_oak", -20, -66, 8, 0);

// ---- POND dressing (dock + cattails + a canoe) ----
(function(){ const px=POND.x, pz=POND.z;
  obj("path_wood", px+13, pz+4, 6, 0.2, {tag:"dock", y: -1.35 + 0.15});   // dock at water level
  obj("canoe", px+2, pz-2, 5, 1.1, {tag:"canoe", y:-1.15});
  scatter(px,pz,20,10,3,(x,z)=>obj("grass_large",x,z,2.6,0), 2);          // cattails ring (near water ok)
  obj("tree_default", px-16, pz+12, 8, 0); obj("rock_largeA", px+14, pz-14, 5, 0.4);
})();

// ---- a few scattered rocks + trees to fill the infield edges ----
obj("rock_largeC", 150, 40, 6, 0.3); obj("tree_fat", 120, 30, 8, 0);
obj("rock_smallB", 60, 60, 4, 1.0); obj("tree_oak", 30, -40, 8, 0);

// =================== PAINT (gold crop patches + barnyard dirt + worn verge) ===================
const PCELL=6; const pcells={};
function paintDisc(cx,cz,r,color){ const lo=Math.floor((cx-r)/PCELL),hi=Math.ceil((cx+r)/PCELL),lz=Math.floor((cz-r)/PCELL),hz=Math.ceil((cz+r)/PCELL);
  for(let i=lo;i<=hi;i++)for(let j=lz;j<=hz;j++){ const x=i*PCELL,z=j*PCELL; if(Math.hypot(x-cx,z-cz)>r)continue; pcells[i+","+j]=color; } }
// gold crop patches beside the crop esses
paintDisc(250,20,28,0xcaa63e); paintDisc(206,-8,18,0xc19a3a); paintDisc(252,60,16,0xcaa63e);
// dirt around the barnyard
paintDisc(-45,-58,26,0x8a6a45); paintDisc(-40,-40,16,0x7d5f3d);
// worn dirt verge along the ford + windmill hill
paintDisc(206,-77,20,0x9c7d54); paintDisc(-16,-122,18,0x8a6a45);
const paint={cell:PCELL,cells:pcells};

// =================== TUFTS (grass density) ===================
const TCELL=6; const tuftCells={};
function tuftScatter(cx,cz,r,val,seed){ let st=seed||1;
  const area=Math.PI*r*r, n=Math.round(area/220);
  for(let k=0;k<n;k++){ st=(st*1103515245+12345)&0x7fffffff; const a=st/0x7fffffff; st=(st*1103515245+12345)&0x7fffffff; const b=st/0x7fffffff;
    const x=cx+Math.cos(a*6.283)*Math.sqrt(b)*r, z=cz+Math.sin(a*6.283)*Math.sqrt(b)*r;
    if(nearestDist(x,z)<HALF+3) continue; tuftCells[Math.round(x/TCELL)+","+Math.round(z/TCELL)]=val; } }
tuftScatter(95,170,20,2,5); tuftScatter(140,80,22,2,9);       // pasture grass (tall)
tuftScatter(100,-98,40,1,13); tuftScatter(-16,-100,30,1,17);  // orchard + windmill hill
tuftScatter(120,20,60,1,21);                                   // infield meadow
const tufts={cell:TCELL,cells:tuftCells};

// =================== ASSEMBLE + PATCH ===================
function j(o){ return JSON.stringify(o); }
const lines=[];
lines.push("      terrain:"+j(terrain)+",");
lines.push("      waters:"+j(waters)+",");
lines.push("      paint:"+j(paint)+",");
lines.push("      tufts:"+j(tufts)+",");
lines.push("      fences:"+j(fences)+",");
lines.push("      objects:"+j(objects));
const block = "\n      /* generated by tools/_hh_build.cjs — do not hand-edit; re-run the builder */\n"+lines.join("\n")+"\n      ";

let src=fs.readFileSync(TRACK_JS,"utf8");
const START="/* HH_GEN_START", END="/* HH_GEN_END */";
const si=src.indexOf(START), ei=src.indexOf(END);
if(si<0||ei<0){ console.error("markers not found"); process.exit(1); }
const startLineEnd=src.indexOf("\n",si)+1;   // keep the START comment line
src=src.slice(0,startLineEnd)+block+src.slice(ei);
fs.writeFileSync(TRACK_JS,src);
console.log("patched. terrain cells:",ntc,"objects:",objects.length,"paint cells:",Object.keys(pcells).length,"tuft cells:",Object.keys(tuftCells).length,"fences:",fences.length);
