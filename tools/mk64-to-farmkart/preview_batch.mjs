import fs from 'fs';
import { convert, crClosed } from './convert.mjs';

const CANDIDATES = ['moo_moo_farm','luigi_raceway','kalimari_desert','koopa_troopa_beach',
  'frappe_snowland','choco_mountain','royal_raceway','sherbet_land'];

function ribbonSVG(stats, track, W=440){
  const pts = track.points, hw = track.width/2;
  const ribbon = crClosed(pts, 20);
  const minX=Math.min(...ribbon.map(p=>p.x)), maxX=Math.max(...ribbon.map(p=>p.x));
  const minZ=Math.min(...ribbon.map(p=>p.z)), maxZ=Math.max(...ribbon.map(p=>p.z));
  const pad=24, sx=maxX-minX, sz=maxZ-minZ, s=(W-2*pad)/Math.max(sx,sz);
  const H=Math.round(sz*s+2*pad)+26;
  const X=v=>pad+(v-minX)*s, Y=v=>pad+(v-minZ)*s;
  const L=[],R=[];
  for (let i=0;i<ribbon.length;i++){ const a=ribbon[i], b=ribbon[(i+1)%ribbon.length];
    let tx=b.x-a.x, tz=b.z-a.z; const tl=Math.hypot(tx,tz)||1; tx/=tl; tz/=tl; const nx=-tz, nz=tx;
    L.push({x:a.x+nx*hw,z:a.z+nz*hw}); R.push({x:a.x-nx*hw,z:a.z-nz*hw}); }
  const p=(pp)=>pp.map((q,i)=>(i?'L':'M')+X(q.x).toFixed(1)+' '+Y(q.z).toFixed(1)).join(' ');
  const road=p(L)+' '+R.slice().reverse().map(q=>'L'+X(q.x).toFixed(1)+' '+Y(q.z).toFixed(1)).join(' ')+' Z';
  const center=ribbon.map((q,i)=>(i?'L':'M')+X(q.x).toFixed(1)+' '+Y(q.z).toFixed(1)).join(' ')+' Z';
  const start=pts[0];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#7cae52"/>
<path d="${road}" fill="#3a3f45" fill-rule="evenodd" stroke="#dfe4ea" stroke-width="1.5"/>
<path d="${center}" fill="none" stroke="#ffd84a" stroke-width="1.2" stroke-dasharray="3 3"/>
<circle cx="${X(start.x).toFixed(1)}" cy="${Y(start.z).toFixed(1)}" r="5" fill="#fff" stroke="#111" stroke-width="2"/>
<text x="8" y="${H-8}" font-family="sans-serif" font-size="13" font-weight="bold" fill="#1c2a12">${track.name} — lap ${stats.lapLen}m · ${stats.ctrlPts}pts · elev ${stats.elevMin}..${stats.elevMax}m · cross ${stats.crossings}</text>
</svg>`;
}

let cards='';
for (const c of CANDIDATES){
  try{ const { track, stats } = convert(c); cards += `<div style="display:inline-block;margin:6px">${ribbonSVG(stats,track)}</div>`; }
  catch(e){ cards += `<div>${c}: ${e.message}</div>`; }
}
fs.writeFileSync('preview_grid.html', `<!doctype html><body style="margin:0;background:#2b2b2b;font-family:sans-serif">${cards}</body>`);
console.log('wrote preview_grid.html for', CANDIDATES.length, 'courses');
