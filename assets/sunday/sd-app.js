'use strict';
/* Sunday: live NFL scoreboard. Ported from Saturday (college football).
   Data: ESPN's public site API (CORS-open). Three feeds:
     scoreboard                  every game this week (polled 15s when live)
     scoreboard/{id}             one game's clock/situation (polled 5s in game view)
     summary?event={id}          drives, plays, box score, win prob (polled 10s)

   ═══════════════ Fantasy hook points (guarded, no-op until sd-fantasy.js defines them) ═══════════════
   ffOnBoard(events)         — after every successful loadBoard normalisation (line ~608).
   ffBoardHeader()           — HTML string rendered into #ff-head, above the first board section
                               (renderBoard, keyed/morph update so it doesn't flicker every poll).
   ffCardExtra(ev)           — HTML appended inside each liveCard(ev) and each listRow(ev).
   ffGameWeight(ev)          — number added into excitement()/featuredScore() so fantasy-relevant
                               games can be favoured for the featured slot.
   ffOnSummary(ev, rawSummary) — after each successful loadSummary fetch (raw ESPN summary JSON).
   ffPlayExtra(ev, play)     — HTML appended to each play row (tabPlays) and the last-play card
                               (renderLastPlay). play.id is the ESPN play id string.
   ffTabFantasy(ev)          — if defined, a "Fantasy" tab is inserted FIRST in TABS and made the
                               default tab; its body is this function's HTML, re-rendered with the
                               other tabs on each summary update.
   (ffRenderMatchupsPage went with the Matchups page, 2026-09-27.)
   ffAfterRender()           — after renderBoard() and after each game-view render.
   Each call site guards with `typeof fn === 'function'`, so the page works with sd-fantasy.js
   absent or 404ing. */

const API = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const CDN = 'https://a.espncdn.com';

// Static team → division map. The NFL scoreboard/summary payloads carry no conference/division
// id on the team object (unlike CFB's conferenceId), so filtering by division needs this table.
const TEAM_DIVISION = {
  BUF: 'afc-east', NE: 'afc-east', NYJ: 'afc-east', MIA: 'afc-east',
  CIN: 'afc-north', BAL: 'afc-north', PIT: 'afc-north', CLE: 'afc-north',
  JAX: 'afc-south', HOU: 'afc-south', IND: 'afc-south', TEN: 'afc-south',
  KC: 'afc-west', LV: 'afc-west', DEN: 'afc-west', LAC: 'afc-west',
  PHI: 'nfc-east', NYG: 'nfc-east', DAL: 'nfc-east', WSH: 'nfc-east',
  MIN: 'nfc-north', DET: 'nfc-north', CHI: 'nfc-north', GB: 'nfc-north',
  CAR: 'nfc-south', NO: 'nfc-south', ATL: 'nfc-south', TB: 'nfc-south',
  SEA: 'nfc-west', SF: 'nfc-west', LAR: 'nfc-west', ARI: 'nfc-west',
};
const DIVISION_LABEL = {
  'afc-east': 'AFC East', 'afc-north': 'AFC North', 'afc-south': 'AFC South', 'afc-west': 'AFC West',
  'nfc-east': 'NFC East', 'nfc-north': 'NFC North', 'nfc-south': 'NFC South', 'nfc-west': 'NFC West',
};

const MAIN_FILTERS = ['all', 'upsets', 'afc', 'nfc'];
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'upsets', label: 'Upsets' },
  { id: 'afc', label: 'AFC' },
  { id: 'nfc', label: 'NFC' },
  { id: 'afc-east', label: 'AFC East' },
  { id: 'afc-north', label: 'AFC North' },
  { id: 'afc-south', label: 'AFC South' },
  { id: 'afc-west', label: 'AFC West' },
  { id: 'nfc-east', label: 'NFC East' },
  { id: 'nfc-north', label: 'NFC North' },
  { id: 'nfc-south', label: 'NFC South' },
  { id: 'nfc-west', label: 'NFC West' },
];

/* ───────────── small utilities ───────────── */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const store = {
  get(k, d) { try { const v = localStorage.getItem('sun.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sun.' + k, JSON.stringify(v)); } catch {} },
};

async function getJSON(url, ms = 12000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal, cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

function htmlToNode(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// Keyed reconcile: only touches children whose html changed, keeps order.
function patchList(container, items) {
  const existing = new Map();
  for (const n of container.children) existing.set(n.dataset.key, n);
  let prev = null;
  for (const it of items) {
    let node = existing.get(it.key);
    if (node) {
      existing.delete(it.key);
      if (node._html !== it.html) {
        const nn = htmlToNode(it.html);
        nn._html = it.html;
        carryBall(node, nn);
        node.replaceWith(nn);
        node = nn;
      }
    } else {
      node = htmlToNode(it.html);
      node._html = it.html;
    }
    const ref = prev ? prev.nextSibling : container.firstChild;
    if (node !== ref) container.insertBefore(node, ref);
    prev = node;
  }
  existing.forEach((n) => n.remove());
}
// When a card is re-rendered, slide its ball (and direction arrow) from the old spot to the new one.
function carryBall(oldN, newN) {
  for (const sel of ['.mini .ball', '.mini .dir']) {
    const ob = oldN.querySelector(sel), nb = newN.querySelector(sel);
    if (!ob || !nb || ob.style.left === nb.style.left) continue;
    const target = nb.style.left;
    nb.style.transition = 'none';
    nb.style.left = ob.style.left;
    requestAnimationFrame(() => requestAnimationFrame(() => { nb.style.transition = ''; nb.style.left = target; }));
  }
}

/* ───────────── colour ───────────── */
function hex(c, fb = '#555555') {
  if (!c) return fb;
  c = String(c).replace('#', '');
  return /^[0-9a-f]{6}$/i.test(c) ? '#' + c.toLowerCase() : fb;
}
function rgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function lum(h) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const [r, g, b] = rgb(h);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function mixHex(a, b, t) {
  const A = rgb(a), B = rgb(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
const onColor = (h) => (lum(h) > 0.42 ? '#111111' : '#ffffff');
const cdist = (a, b) => { const A = rgb(a), B = rgb(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
// Colour that reads on both turf and either theme: lift near-black, sink near-white.
function vivid(h) {
  let c = h;
  // Exact team colours everywhere; only pure black and near-white are nudged so a bar stays visible.
  for (let i = 0; i < 8 && lum(c) < 0.012; i++) c = mixHex(c, '#ffffff', 0.12);
  if (lum(c) > 0.85) c = mixHex(c, '#000000', 0.28);
  return c;
}
// Every team's own end zones, researched 2026-09-28 (user: "do some research on endzone styles for
// each team, and the endzones should always reflect the home team, not be different on either
// side"). Both end zones wear the HOME team's paint, as at a real stadium: [the one on the right of
// the field views, the one on the left]; many teams put the nickname at one end and the city at the
// other. Fill, pattern (a diagonal hatch stands in for Cincinnati's tiger stripes), lettering and
// its outline, and whether the logo is painted beside the word. Sources and confidence per team:
// docs/sunday.md (2026-09-28 entry). Solid on fill and words: BAL BUF CIN DEN GB LV MIN NE PHI PIT
// SEA; the rest are broadcast recollection (MetLife and SoFi repaint per home team, so NYG/NYJ and
// LAR/LAC each keep their own).
const EZ = {
  ARI: { fill: '#97233F', words: ['CARDINALS', 'ARIZONA'], ink: '#FFFFFF', edge: '#000000' },
  ATL: { fill: '#000000', words: ['FALCONS', 'ATLANTA'], ink: '#FFFFFF', edge: '#A71930' },
  BAL: { fill: '#000000', words: ['RAVENS', 'BALTIMORE'], ink: '#FFFFFF', edge: null },
  BUF: { fill: '#00338D', words: ['BILLS', 'BUFFALO'], ink: '#FFFFFF', edge: '#C60C30' },
  CAR: { fill: '#101820', words: ['PANTHERS', 'CAROLINA'], ink: '#0085CA', edge: '#BFC0BF' },
  CHI: { fill: '#0B162A', words: ['BEARS', 'CHICAGO'], ink: '#C83803', edge: '#FFFFFF' },
  CIN: { fill: '#000000', pattern: '#FB4F14', words: ['BENGALS', 'CINCINNATI'], ink: '#FB4F14', edge: '#FFFFFF' },
  CLE: { fill: '#311D00', words: ['BROWNS', 'CLEVELAND'], ink: '#FF3C00', edge: '#FFFFFF' },
  DAL: { fill: '#003594', words: ['COWBOYS', 'DALLAS'], ink: '#FFFFFF', edge: '#869397', logo: true },
  DEN: { fill: '#002244', words: ['BRONCOS', 'BRONCOS'], ink: '#FB4F14', edge: '#FFFFFF', logo: true },
  DET: { fill: '#0076B6', words: ['LIONS', 'DETROIT'], ink: '#FFFFFF', edge: '#B0B7BC' },
  GB: { fill: '#203731', words: ['PACKERS', 'PACKERS'], ink: '#FFB612', edge: '#FFFFFF' },
  HOU: { fill: '#03202F', words: ['TEXANS', 'HOUSTON'], ink: '#FFFFFF', edge: '#A71930' },
  IND: { fill: '#002C5F', words: ['COLTS', 'INDIANAPOLIS'], ink: '#FFFFFF', edge: null, logo: true },
  JAX: { fill: '#101820', words: ['JAGUARS', 'JACKSONVILLE'], ink: '#006778', edge: '#D7A22A' },
  KC: { fill: '#E31837', words: ['CHIEFS', 'CHIEFS'], ink: '#FFFFFF', edge: '#FFB81C', logo: true },
  LV: { fill: '#000000', words: ['RAIDERS', 'LAS VEGAS'], ink: '#A5ACAF', edge: '#FFFFFF', logo: true },
  LAC: { fill: '#002A5E', words: ['CHARGERS', 'CHARGERS'], ink: '#0080C6', edge: '#FFC20E', logo: true },
  LAR: { fill: '#003594', words: ['RAMS', 'RAMS'], ink: '#FFFFFF', edge: '#FFA300', logo: true },
  MIA: { fill: '#008E97', words: ['DOLPHINS', 'MIAMI'], ink: '#FFFFFF', edge: '#FC4C02', logo: true },
  MIN: { fill: '#4F2683', words: ['VIKINGS', 'VIKINGS'], ink: '#FFFFFF', edge: '#FFC62F' },
  NE: { fill: '#002244', words: ['PATRIOTS', 'PATRIOTS'], ink: '#FFFFFF', edge: '#C60C30', logo: true },
  NO: { fill: '#101820', words: ['SAINTS', 'NEW ORLEANS'], ink: '#D3BC8D', edge: '#FFFFFF', logo: true },
  NYG: { fill: '#0B2265', words: ['GIANTS', 'NEW YORK'], ink: '#FFFFFF', edge: '#A71930', logo: true },
  NYJ: { fill: '#125740', words: ['JETS', 'NEW YORK'], ink: '#FFFFFF', edge: '#000000', logo: true },
  PHI: { fill: '#004C54', words: ['EAGLES', 'EAGLES'], ink: '#FFFFFF', edge: '#A5ACAF', logo: true },
  PIT: { fill: '#101820', words: ['STEELERS', 'PITTSBURGH'], ink: '#FFB612', edge: '#FFFFFF' },
  SF: { fill: '#AA0000', words: ['49ERS', '49ERS'], ink: '#FFFFFF', edge: '#B3995D', logo: true },
  SEA: { fill: '#002244', words: ['SEAHAWKS', 'SEAHAWKS'], ink: '#FFFFFF', edge: '#69BE28', logo: true },
  TB: { fill: '#D50A0A', words: ['BUCCANEERS', 'TAMPA BAY'], ink: '#FFFFFF', edge: '#34302B' },
  TEN: { fill: '#4B92DB', words: ['TITANS', 'TENNESSEE'], ink: '#FFFFFF', edge: '#0C2340', logo: true },
  WSH: { fill: '#5A1414', words: ['COMMANDERS', 'WASHINGTON'], ink: '#FFB612', edge: '#FFFFFF' },
};
// The home team's end-zone paint; a team not in the table gets its own colour and name, both ends.
function ezStyle(home) {
  const e = EZ[String(home?.abbr || '').toUpperCase()];
  if (e) return e;
  const fill = teamInk(home), word = String(home?.name || home?.abbr || '').toUpperCase();
  return { fill, words: [word, word], ink: onColor(fill), edge: null };
}
// Two teams in similar colours (red vs red) get the away side's alternate.
const chroma = (h) => { const c = rgb(h); return Math.max(...c) - Math.min(...c); };
// A team's everyday colour. Only a neutral black/charcoal primary (Iowa's #231f20) gives way to
// the secondary; a dark but real colour like Michigan navy stays.
function teamInk(t) {
  const L = lum(t.color), La = lum(t.alt);
  return L < 0.03 && chroma(t.color) < 40 && La > 0.05 && La < 0.7 ? t.alt : t.color;
}
// Used for end zones, win-% bars, stat bars and the header, so a team is one colour on every screen.
// Every team has two core colours: when the primaries clash, the team whose secondary stands out
// best switches to it (never to white, which disappears on the day theme).
function pair(away, home) {
  let hRaw = teamInk(home), aRaw = teamInk(away);
  let h = vivid(hRaw);
  let a = vivid(aRaw);
  if (cdist(a, h) < 110) {
    const usable = (raw) => lum(raw) < 0.8;
    const other = (t, cur) => (teamInk(t) === t.alt ? t.color : t.alt);   // the core colour not already in use
    const opts = [
      { side: 'a', raw: other(away, a), vs: h },
      { side: 'h', raw: other(home, h), vs: a },
    ].filter((o) => usable(o.raw)).map((o) => ({ ...o, col: vivid(o.raw), score: cdist(vivid(o.raw), o.vs) + chroma(o.raw) * 0.5 }))
      .filter((o) => cdist(o.col, o.vs) >= 90)
      .sort((x, y) => y.score - x.score);
    if (opts[0]) { if (opts[0].side === 'a') { a = opts[0].col; aRaw = opts[0].raw; } else { h = opts[0].col; hRaw = opts[0].raw; } }
  }
  return { a, h, aRaw, hRaw };
}
// The away team's share of a bar: always its solid team colour.
const awayFill = (pc) => pc.a;

/* ───────────── theme ───────────── */
function isDark() { return document.documentElement.dataset.theme === 'dark'; }
function applyTheme() {
  const t = store.get('theme', null) || 'dark';   // night is the default look here, same as the league site
  document.documentElement.dataset.theme = t;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    m.content = t ? (t === 'dark' ? '#0c1017' : '#ffffff') : (m.media.includes('light') ? '#ffffff' : '#0c1017');
  });
}

/* ───────────── images ───────────── */
// NFL logos are keyed by abbreviation, not team id: https://a.espncdn.com/i/teamlogos/nfl/500/{abbr}.png
// (500-dark exists too, verified with curl). A team's own `logo` URL from the payload is preferred
// when present; otherwise the abbreviation-keyed path is built directly.
function logoURL(t, px = 40, dark = isDark()) {
  const abbr = (t?.abbr || '').toLowerCase();
  if (t?.logo && !dark) return cdnImg(t.logo, px * 2, px * 2);
  if (!abbr) return '';
  return `${CDN}/combiner/i?img=/i/teamlogos/nfl/500${dark ? '-dark' : ''}/${abbr}.png&w=${px * 2}&h=${px * 2}`;
}
function logoImg(t, px = 30, cls = 'logo', dark) {
  const d = dark ?? isDark();
  return `<img class="${cls}" src="${logoURL(t, px, d)}" data-fb="${d ? logoURL(t, px, false) : ''}" data-abbr="${esc(t.abbr)}" data-color="${t.color}" alt="" width="${px}" height="${px}" loading="lazy" decoding="async">`;
}
function cdnImg(href, w, h) {
  try {
    const u = new URL(href);
    if (u.host === 'a.espncdn.com') return `${CDN}/combiner/i?img=${u.pathname}&w=${w}&h=${h}`;
  } catch {}
  return href;
}
// Broken logo → light variant → coloured monogram. Broken headshot → hidden.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  if (img.dataset.fb) { const fb = img.dataset.fb; img.dataset.fb = ''; img.src = fb; return; }
  if (img.dataset.abbr) {
    const s = document.createElement('span');
    s.className = img.className + ' logo-fb';
    s.style.background = img.dataset.color || '#555';
    s.style.color = onColor(img.dataset.color || '#555555');
    s.textContent = img.dataset.abbr;
    img.replaceWith(s);
  } else img.style.visibility = 'hidden';
}, true);

/* ───────────── formatting ───────────── */
// ESPN prefixes play text with the clock "(09:58)" and leaves "()" behind; the UI shows the clock itself.
// NFL replay reversals: "The Replay Official reviewed the fumble ruling, and the play was
// REVERSED.(Shotgun) J.Love pass incomplete..." — the corrected call follows immediately after
// "REVERSED." with no separating space. Keep only the text after the reversal (the true result).
const cleanText = (t) => String(t || '').replace(/^\(\d{1,2}:\d{2}\)\s*/, '').replace(/,?\s*clock \d{1,2}:\d{2}/gi, '').replace(/,?\s*(End Of Play\.|The previous play is under|\(Original Play:)[\s\S]*$/i, '').replace(/^[\s\S]*\bREVERSED\.\s*/i, '').replace(/\s*\(\)/g, '').replace(/^\((.*)\)$/, '$1').replace(/\s{2,}/g, ' ').trim();
// The play text people read: "Shotgun #28 M.Fuller rush right for 3 yards gain to the ALA21 (#0 Y.Pierre)"
// becomes "Fuller rush right for 3 yards gain to the ALA 21". Formation words, jersey numbers, first
// initials and the tacklers/holders in parentheses go. The animator still reads the full text.
const briefText = (raw) => cleanText(raw)
  .replace(/\s\(\d{1,2}:\d{2}\)\s[\s\S]*$/, '')                                  // later snaps glued onto a scoring play
  .replace(/^(?:No Huddle[- ]?)?(?:Shotgun|Pistol|Under Center|Wildcat)\s*/i, '')
  .replace(/\s*\((?:[^()]*#\d[^()]*|H:[^()]*|[A-Z][\w.'’-]+(?: [A-Z][\w.'’-]+)*(?:[;,] ?[A-Z][\w.'’-]+(?: [A-Z][\w.'’-]+)*)*)\)/g, '')
  .replace(/(?:#\d{1,2}\s*)?\b(?:[A-Z][a-z]?\.\s?)+(?=[A-Z][A-Za-z'’-]{1,})/g, '')  // "#28 M.Fuller" → "Fuller"
  .replace(/#\d{1,2}\s+(?=[A-Z])/g, '')                                          // "#28 Marcus Fuller" → "Marcus Fuller"
  .replace(/\b([A-Z][A-Z&]{1,4})(\d{1,2})\b/g, '$1 $2')                          // "ALA21" → "ALA 21"
  .replace(/(PENALTY [A-Z&]{2,5} [A-Za-z' /-]+?) (\d+ yards? (?:from|enforced))/g, '$1, $2')
  .replace(/\b([A-Z&]{2,5} \d{1,2}) (?=[A-Z][A-Za-z'’-]+(?: III| II| IV)? return)/g, '$1, ')   // "...to the UGA 16, White-Helton return"
  .replace(/(TOUCHDOWN|1ST DOWN)\s+(?=[A-Z][a-z])/g, '$1. ')                                   // "...TOUCHDOWN. Woodring kick attempt good"
  .replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').trim();
// Yardage in bold ("3 yards gain", "56 yards"); losses in bold red. Takes already-escaped text.
const yardsHTML = (s) => s
  .replace(/(?<![\w-])(loss of )?(-?\d+) (yards?|yds?)( (?:gain|loss))?\b/gi, (m, lossOf, n, u, gl) =>
    `<strong class="yds${lossOf || +n < 0 || /loss/i.test(gl || '') ? ' neg' : ''}">${m}</strong>`)
  .replace(/\bno gain\b/gi, '<strong class="yds">$&</strong>');
const playHTML = (raw) => yardsHTML(esc(briefText(raw)));
// Short fragments like "R. Armstrong KICK" read better with the play type in front.
const playLine = (lp) => {
  const t = briefText(lp?.text), ty = lp?.type?.text || '';
  return t && t.length < 40 && ty && !t.toLowerCase().includes(ty.toLowerCase()) ? `${ty}: ${t}` : t;
};
const TV_SHORT = { 'CBS': 'CBS', 'FOX': 'FOX', 'NBC': 'NBC', 'ESPN': 'ESPN', 'ESPN2': 'ESPN2', 'ABC': 'ABC', 'NFL Network': 'NFLN', 'NFLN': 'NFLN', 'Prime Video': 'Prime', 'Amazon Prime Video': 'Prime', 'Netflix': 'Netflix', 'Peacock': 'Peacock' };
const tvShort = (tv) => { if (!tv) return ''; const first = tv.split(' / ')[0]; return TV_SHORT[tv] || TV_SHORT[first] || first; };
// One cleaned-up drive description: drop "0:00" elapsed and "from X 0" placeholders.
const driveDesc = (dr) => {
  const d = String(dr.desc || '').replace(/,\s*0:00$/, '');
  return [/^0 plays/.test(d) ? 'New drive' : d, dr.startText && !/ 0$/.test(dr.startText) ? `from ${dr.startText}` : ''].filter(Boolean).join(' · ');
};
const periodLabel = (n) => (n <= 4 ? `Q${n}` : n === 5 ? 'OT' : `${n - 4}OT`);
const ordinal = (n) => (n > 4 ? (n === 5 ? 'OT' : `${n - 4}OT`) : ['', '1st', '2nd', '3rd', '4th'][n] || '');
const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDay = (d) => d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
function statusText(ev) {
  if (ev.state === 'pre') return ev.timeValid ? fmtTime(ev.date) : 'TBD';
  if (ev.name === 'STATUS_HALFTIME') return 'Halftime';
  if (ev.state === 'in') return (ev.detail || '').replace(' - ', ' · ');
  return ev.detail || 'Final';
}
function ydBadge(y, kind) {
  if (kind === 'incomplete') return '<span class="yd zero">INC</span>';
  if (kind === 'kickoff' || kind === 'punt' || kind === 'fg' || kind === 'meta') return '';
  if (y == null || isNaN(y)) return '';
  const c = y > 0 ? 'pos' : y < 0 ? 'neg' : 'zero';
  return `<span class="yd ${c}">${y > 0 ? '+' : ''}${y}</span>`;
}
const penBadge = (n) => (n ? `<span class="yd pen">PEN ${n > 0 ? '+' : ''}${n}</span>` : '');
const ICON = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  play: '<svg viewBox="0 0 12 12"><path d="M2 1l9 5-9 5z"/></svg>',
  pause: '<svg viewBox="0 0 12 12"><path d="M2 1h3v10H2zM7 1h3v10H7z"/></svg>',
  prev: '<svg viewBox="0 0 12 12"><path d="M2 1h2v10H2zM11 1v10L4.5 6z"/></svg>',
  next: '<svg viewBox="0 0 12 12"><path d="M8 1h2v10H8zM1 1v10l6.5-5z"/></svg>',
  caret: '<svg class="caret" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5L6 8l3.5-3.5"/></svg>',
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  warn: '<svg class="warn" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l10 18H2z" fill="currentColor"/><path d="M12 10v5M12 17.5v.5" stroke="#1a1400" stroke-width="2.2" stroke-linecap="round"/></svg>',
  heroBall: '<svg viewBox="0 0 28 18" aria-label="Has the ball"><ellipse cx="14" cy="9" rx="13" ry="8" fill="#8a4a22" stroke="#fff" stroke-width="1.8"/><path d="M9 9h10M11 6.8v4.4M14 6.8v4.4M17 6.8v4.4" stroke="#fff" stroke-width="1.5"/></svg>',
  ball: '<svg class="poss" viewBox="0 0 28 18" aria-label="Has the ball"><ellipse cx="14" cy="9" rx="13" ry="8" fill="#8a4a22" stroke="currentColor" stroke-width="1.5"/><path d="M9 9h10M11 7v4M14 7v4M17 7v4" stroke="#fff" stroke-width="1.3"/></svg>',
};

/* ───────────── normalisation ───────────── */
function normTeam(c) {
  const t = c.team || {};
  const recs = c.records || c.record || [];
  // NFL: shortDisplayName is the nickname ("Packers"); location+name is used on the team page.
  return {
    id: t.id,
    abbr: t.abbreviation || '',
    name: t.shortDisplayName || t.location || t.name || '',
    loc: t.location || t.shortDisplayName || '',
    mascot: t.name || '',
    full: t.displayName || '',
    color: hex(t.color, '#555555'),
    alt: hex(t.alternateColor, '#999999'),
    logo: t.logo || t.logos?.find((l) => (l.rel || []).includes('full') && !(l.rel || []).includes('dark'))?.href || '',
    record: (Array.isArray(recs) ? recs : []).find((r) => r.type === 'total')?.summary || '',
    score: c.score != null && c.score !== '' ? +c.score : null,
    lines: (c.linescores || []).map((l) => l.displayValue ?? l.value),
    conf: TEAM_DIVISION[t.abbreviation] || null,
    winner: !!c.winner,
    poss: !!c.possession,
  };
}
function normEvent(e) {
  const c = e.competitions[0];
  const H = c.competitors.find((x) => x.homeAway === 'home');
  const A = c.competitors.find((x) => x.homeAway === 'away');
  const st = e.status || c.status;
  const odds = c.odds?.[0];
  return {
    id: e.id,
    date: new Date(e.date),
    timeValid: c.timeValid !== false,
    state: st.type.state,
    name: st.type.name,
    detail: st.type.shortDetail || st.type.detail,
    clock: st.displayClock,
    period: st.period,
    home: normTeam(H),
    away: normTeam(A),
    sit: c.situation || null,
    tv: (c.broadcasts?.[0]?.names || []).join(' / ') || c.broadcast || '',
    odds: odds ? { details: odds.details, ou: odds.overUnder } : null,
    line: odds ? lineFrom(odds, normTeam(H), normTeam(A)) : null,
    venue: c.venue?.fullName || '',
    city: [c.venue?.address?.city, c.venue?.address?.state].filter(Boolean).join(', '),
    neutral: c.neutralSite,
    note: c.notes?.[0]?.headline || '',
  };
}
function playKind(p) {
  const t = (p.type?.text || '').toLowerCase();
  const x = (p.text || '').toLowerCase();
  const id = +(p.type?.id || 0);
  if ([2, 21, 65, 66, 70, 75].includes(id) || /timeout|end of|end period|coin toss|two-minute|official/.test(t)) return 'meta';
  if (/kickoff/.test(t)) return 'kickoff';
  if (/punt/.test(t)) return 'punt';
  if (/field goal|extra point|two-point|2pt|pat/.test(t)) return 'fg';
  if (/sack/.test(t)) return 'sack';
  if (/penalty/.test(t)) return 'penalty';
  if (/incomplet/.test(t)) return 'incomplete';
  if (/pass|interception|reception/.test(t)) return 'pass';
  if (/rush|run/.test(t)) return 'run';
  if (/pass/.test(x)) return /incomplete/.test(x) ? 'incomplete' : 'pass';
  if (/punt/.test(x)) return 'punt';
  if (/kickoff/.test(x)) return 'kickoff';
  return 'run';
}
// Field spots as yards from the HOME goal line (0..100). The spot text ("TENN 27")
// is authoritative; ESPN's yardLine uses the same home-goal scale and has matched it
// on every play checked. yardsToEndzone is sometimes wrong (a Tennessee sack at its
// own 27 came back as 27 to go), so it is only a last resort.
function posH(pt, homeId, homeAbbr) {
  if (!pt) return null;
  const txt = pt.possessionText;
  if (txt === '50') return 50;
  const m = /^(\S+) (\d+)$/.exec(txt || '');
  if (m && homeAbbr) return m[1] === homeAbbr ? +m[2] : 100 - +m[2];
  if (pt.yardLine != null) return pt.yardLine;
  const tid = pt.team?.id;
  if (pt.yardsToEndzone != null && tid) return tid === homeId ? 100 - pt.yardsToEndzone : pt.yardsToEndzone;
  return null;
}
function normPlay(p, homeId, driveTeam, homeAbbr) {
  const st = p.start || {}, en = p.end || {};
  const kind = playKind(p);
  const tt = p.type?.text || '';
  const offId = st.team?.id || driveTeam;
  let eH = posH(en, homeId, homeAbbr);
  if (p.scoringPlay && /touchdown/i.test(tt) && !/defens|return|interception|fumble/i.test(tt)) eH = offId === homeId ? 100 : 0;
  const turnover = !!p.isTurnover || /interception|fumble recovery \(opp|blocked/i.test(tt);
  // "30-yard catch + 15-yard facemask": statYardage is the play itself, the end spot includes
  // the enforcement. The gap between the two is the penalty, drawn as its own segment.
  let penYards = 0;
  const sH = posH(st, homeId, homeAbbr);
  if (['run', 'pass', 'sack'].includes(kind) && /penalty/i.test(p.text || '') && !p.scoringPlay && !turnover
      && p.statYardage != null && sH != null && eH != null && (!en.team?.id || en.team.id === offId)) {
    const gained = (eH - sH) * (offId === homeId ? 1 : -1);
    const diff = Math.round(gained - p.statYardage);
    if (diff !== 0 && Math.abs(diff) <= 50) penYards = diff;
  }
  return {
    id: p.id,
    kind,
    typeText: tt,
    text: p.text || '',
    period: p.period?.number || 0,
    clock: p.clock?.displayValue || '',
    away: p.awayScore,
    home: p.homeScore,
    scoring: !!p.scoringPlay,
    scoringType: p.scoringType?.displayName || '',
    yards: p.statYardage,
    sH,
    eH,
    penYards,
    offId,
    endTeam: en.team?.id,
    sDD: st.shortDownDistanceText || '',
    sPos: st.possessionText || '',
    down: st.down,
    dist: st.distance,
    endDown: en.down,
    endDist: en.distance,
    endDD: en.downDistanceText || '',
    turnover,
    penalty: !!p.isPenalty,
    parts: p.participants || [],
  };
}
// The scoreboard's last play is only ahead of the play-by-play when it's a later play of this game.
// ESPN play ids are the event id plus a running sequence number; the scoreboard sometimes keeps
// reporting a stale play under an odd id (an extra point as "-89089900") after the drives have moved on.
function quickIsNewer(id, sum, evId) {
  if (id == null || !sum) return id != null;
  const s = String(id), ev = String(evId);
  if (sum.byId.has(s)) return false;
  if (!sum.byId.size) return true;
  if (!/^\d+$/.test(s) || !s.startsWith(ev)) return false;
  let max = 0n;
  for (const k of sum.byId.keys()) if (/^\d+$/.test(k) && k.startsWith(ev) && BigInt(k) > max) max = BigInt(k);
  return BigInt(s) > max;
}
function quickPlay(ev) {
  const lp = ev?.sit?.lastPlay;
  if (!lp?.id || !lp.start || !lp.end) return null;
  const raw = {
    id: lp.id, type: lp.type, text: lp.text, statYardage: lp.statYardage, scoringPlay: lp.scoreValue > 0,
    start: { yardLine: lp.start.yardLine, team: lp.start.team }, end: { yardLine: lp.end.yardLine, team: lp.end.team },
    period: { number: ev.period }, clock: { displayValue: ev.clock }, awayScore: ev.away.score, homeScore: ev.home.score,
  };
  const p = normPlay(raw, ev.home.id, lp.team?.id, ev.home.abbr);
  p.provisional = true;
  return p;
}
// ESPN keeps a finished drive as "current" until the next snap (a touchdown stays current
// through the extra point and kickoff), so a drive with a result is over even if it's current.
const driveDone = (dr) => !!dr.isScore || (!!(dr.displayResult || dr.result) && !/^end of/i.test(dr.displayResult || dr.result));
function normSummary(d, ev) {
  const comp = d.header?.competitions?.[0];
  const hc = comp?.competitors?.find((c) => c.homeAway === 'home');
  const homeId = hc?.team?.id || ev?.home.id;
  const homeAbbr = hc?.team?.abbreviation || ev?.home.abbr;
  const state = comp?.status?.type?.state || ev?.state;
  const prev = d.drives?.previous || [];
  const cur = d.drives?.current;
  const raw = [...prev];
  if (cur && !raw.some((x) => x.id === cur.id)) raw.push(cur);
  const drives = raw.map((dr) => ({
    id: dr.id,
    teamId: dr.team?.id,
    desc: dr.description || '',
    result: dr.displayResult || dr.result || '',
    isScore: !!dr.isScore,
    yards: dr.yards,
    elapsed: dr.timeElapsed?.displayValue,
    startText: dr.start?.text || '',
    plays: (dr.plays || []).map((p) => normPlay(p, homeId, dr.team?.id, homeAbbr)),
    live: state === 'in' && cur && dr.id === cur.id && !driveDone(dr),
  })).filter((dr) => dr.plays.length);
  const flat = [];
  drives.forEach((dr, di) => dr.plays.forEach((p, pi) => { if (p.kind !== 'meta' || p.scoring) flat.push({ p, di, pi }); }));
  const byId = new Map();
  drives.forEach((dr) => dr.plays.forEach((p) => byId.set(p.id, p)));
  return { raw: d, homeId, drives, flat, byId, wp: d.winprobability || [] };
}

/* ───────────── app state ───────────── */
const S = {
  firstLoadAt: 0,
  linesReady: false,
  featuredId: null,
  events: [],
  byId: new Map(),
  calendar: [],
  cur: null,          // {st, wk} ESPN's current week
  week: null,         // {st, wk} when the viewer picked another week
  // The filter chips are gone (2026-09-27): the board always shows every game. A division
  // filter saved by an earlier visit must not keep hiding games with no way to clear it.
  filter: 'all',
  loaded: false,
  error: null,
  updated: 0,
  prevScores: new Map(),
};
let G = null; // open game

/* ───────────── pregame lines + upset detection ───────────── */
// ESPN drops the betting line from the scoreboard at kickoff, so lines are cached while
// games are upcoming, and pulled once from a game's summary when we never saw it pregame.
function lineFrom(o, home, away) {
  if (!o) return null;
  let spread = Math.abs(parseFloat(o.spread));
  const m = String(o.details || '').match(/^(\S+)\s+-(\d+(?:\.\d+)?)/);
  if (isNaN(spread) && m) spread = +m[2];
  let fav = o.homeTeamOdds?.favorite ? 'home' : o.awayTeamOdds?.favorite ? 'away' : null;
  if (!fav && m && home && away) fav = m[1] === home.abbr ? 'home' : m[1] === away.abbr ? 'away' : null;
  return { fav, spread: isNaN(spread) ? 0 : spread, details: o.details || '', t: Date.now() };
}
S.lines = new Map(Object.entries(store.get('lines', {})));
S.lineTried = new Set();
S.prevUpset = new Map();
function saveLines() {
  const cutoff = Date.now() - 30 * 864e5, o = {};
  for (const [k, v] of S.lines) if (v.t > cutoff) o[k] = v;
  store.set('lines', o);
}
async function fetchMissingLines() {
  const need = S.events.filter((e) => e.state !== 'pre' && !S.lines.has(e.id) && !S.lineTried.has(e.id));
  if (!need.length) { if (!S.linesReady) { S.linesReady = true; renderBoard(); } return; }
  need.forEach((e) => S.lineTried.add(e.id));
  let got = 0;
  const work = async () => {
    for (let ev; (ev = need.shift());) {
      try {
        const d = await getJSON(`${API}/summary?event=${ev.id}`);
        const ln = lineFrom(d.pickcenter?.[0], ev.home, ev.away);
        if (ln) { S.lines.set(ev.id, ln); got++; }
      } catch {}
    }
  };
  await Promise.all([work(), work(), work()]);
  if (got) saveLines();
  S.linesReady = true;
  renderBoard();
}
const fmtSpread = (n) => String(n).replace(/\.0$/, '');
// Favorite = the betting favorite by 6.5+ points (no rank fallback in the NFL — every game has
// a line). "Big" upset = the favorite was laying 9.5+.
function upsetInfo(ev) {
  if (!ev || ev.state === 'pre') return null;
  const { home: h, away: a } = ev;
  const line = S.lines.get(ev.id);
  let fav = null;
  if (line && line.fav && line.spread >= 6.5) fav = line.fav;
  if (!fav) return null;
  const F = fav === 'home' ? h : a, D = fav === 'home' ? a : h;
  const spread = line.spread;
  const margin = (D.score || 0) - (F.score || 0);
  const p = ev.sit?.lastPlay?.probability?.homeWinPercentage;
  const dogWP = p == null ? null : fav === 'home' ? 1 - p : p;
  const big = spread >= 9.5;
  const favText = `${F.abbr} favored by ${fmtSpread(spread)}`;
  const base = { F, D, favText, spread, big, dogWP, margin };
  if (ev.state === 'post') return margin > 0 ? { ...base, level: 'upset', state: `${D.abbr} won by ${margin}` } : null;
  // Q1: only a watch, and only if the underdog leads by more than a touchdown.
  // Q2: watch only. Alerts start in the 3rd quarter.
  const period = ev.period || 1;
  let level = null;
  if (period <= 1) level = margin > 7 ? 'watch' : null;
  else if (period === 2) level = margin >= 0 || (dogWP != null && dogWP >= 0.35) ? 'watch' : null;
  else {
    if (margin > 0 || (dogWP != null && dogWP >= 0.4)) level = 'alert';
    else if (margin >= -3 || (dogWP != null && dogWP >= 0.25 && big)) level = 'watch';
  }
  if (!level) return null;
  const state = margin > 0 ? `${D.abbr} leads by ${margin}` : margin === 0 ? 'Tied' : `${D.abbr} within ${-margin}`;
  return { ...base, level, state };
}
function upsetTag(u) {
  if (!u) return '';
  if (u.level === 'alert') return `<span class="tag upset">${ICON.warn}Upset alert</span>`;
  if (u.level === 'watch') return `<span class="tag upset watch">${ICON.eye}Upset watch</span>`;
  return '<span class="tag upset">Upset</span>';
}
function upsetLine(u) {
  if (!u) return '';
  return `<div class="upset-line"><b>${esc(u.favText)}</b><span>${esc(u.state)}</span></div>`;
}

/* ───────────── pollers ───────────── */
function makePoller(fn, nextMs) {
  let t = null, running = false, stopped = true, fails = 0;
  const p = {
    onSchedule: null,
    async tick() {
      clearTimeout(t);
      if (stopped || running) return;
      running = true;
      let ok = true;
      try { await fn(); fails = 0; } catch (e) { ok = false; fails++; console.warn(e); }
      running = false;
      if (stopped) return;
      const ms = ok ? nextMs() : Math.min(60000, 4000 * 2 ** (fails - 1));
      if (ms != null) { t = setTimeout(() => p.tick(), ms); p.onSchedule?.(ms, ok); }
    },
    start() { if (!stopped) return; stopped = false; p.tick(); },
    stop() { stopped = true; clearTimeout(t); },
    now() { if (!stopped) p.tick(); },
    get active() { return !stopped; },
  };
  return p;
}

/* ───────────── scoreboard ───────────── */
async function loadBoard() {
  const sync = $('#sync');
  sync.classList.add('busy');
  try {
    const q = S.week ? `?seasontype=${S.week.st}&week=${S.week.wk}` : '';
    const d = await getJSON(`${API}/scoreboard${q}`);
    if (!S.week) S.cur = { st: +d.season?.type, wk: +d.week?.number };
    const cal = d.leagues?.[0]?.calendar;
    if (Array.isArray(cal) && cal.length && typeof cal[0] === 'object') {
      // NFL calendar groups Preseason/Regular Season/Postseason/Off Season. Off Season never has
      // real weeks to pick; Preseason drops out of the picker once the regular season has begun.
      const regularStarted = cal.some((c) => /regular season/i.test(c.label) && (c.entries || []).some((e) => new Date(e.startDate) <= new Date()));
      S.calendar = cal.filter((c) => !/off season/i.test(c.label) && !(regularStarted && /preseason/i.test(c.label)))
        .flatMap((c) => (c.entries || []).map((e) => ({ st: +c.value, wk: +e.value, label: e.label, detail: e.detail, start: new Date(e.startDate), end: new Date(e.endDate), group: c.label })));
    }
    const evs = (d.events || []).map(normEvent);
    let newLines = false;
    for (const e of evs) {
      if (e.state !== 'pre' || e.line?.fav == null) continue;
      const o = S.lines.get(e.id);
      if (!o || o.details !== e.line.details) { S.lines.set(e.id, e.line); newLines = true; }
    }
    if (newLines) saveLines();
    S.events = evs;
    S.byId = new Map(evs.map((e) => [e.id, e]));
    if (typeof ffOnBoard === 'function') ffOnBoard(evs);
    S.error = null;
    S.updated = Date.now();
    if (!S.loaded) { S.firstLoadAt = Date.now(); setTimeout(() => { if (!S.linesReady) renderBoard(); }, 4100); }
    S.loaded = true;
    renderBoard();
    fetchMissingLines();
    fillPossession();
    ensureGame();
  } catch (e) {
    S.error = e;
    if (!S.loaded) renderBoard(); else renderStatus();
    throw e;
  } finally {
    sync.classList.remove('busy');
  }
}
const boardPoller = makePoller(loadBoard, () => {
  const live = S.events.some((e) => e.state === 'in');
  if (live) return 15000;
  const soon = S.events.some((e) => e.state === 'pre' && e.date - Date.now() < 20 * 60000);
  return soon ? 30000 : 120000;
});
boardPoller.onSchedule = (ms, ok) => {
  const prog = $('#sync-prog');
  prog.style.transition = 'none';
  prog.style.strokeDashoffset = '94.25';
  prog.getBoundingClientRect();
  prog.style.transition = `stroke-dashoffset ${ms}ms linear`;
  prog.style.strokeDashoffset = '0';
  $('#sync').classList.toggle('err', !ok);
};

function filterEvents(evs, f) {
  if (f === 'all') return evs;
  if (f === 'upsets') return evs.filter((e) => upsetInfo(e));
  if (f === 'afc' || f === 'nfc') return evs.filter((e) => (e.home.conf || '').startsWith(f) || (e.away.conf || '').startsWith(f));
  return evs.filter((e) => e.home.conf === f || e.away.conf === f);
}
function excitement(ev) {
  const d = Math.abs((ev.home.score || 0) - (ev.away.score || 0));
  const p = Math.min(ev.period || 1, 5);
  let s = p * 8 + Math.max(0, 28 - d) * 1.2;
  if (p >= 4 && d <= 8) s += 25;
  if (ev.sit?.isRedZone) s += 6;
  const u = upsetInfo(ev);
  if (u) s += (u.level === 'alert' ? 18 : 8) + (u.big ? 8 : 0);
  if (typeof ffGameWeight === 'function') s += ffGameWeight(ev) || 0;
  return s;
}

// Closeness (weighted toward late in the game), a betting line worth watching, and fantasy
// relevance. A blowout never qualifies. An upset alert is only a small tiebreaker.
function featuredScore(ev) {
  const m = Math.abs((ev.home.score || 0) - (ev.away.score || 0));
  const p = Math.min(ev.period || 1, 5);
  if (m >= 24 || (p >= 3 && m >= 17) || (p >= 4 && m >= 12)) return -Infinity;
  let s = (Math.max(0, 17 - m) / 17) * (12 + p * 6);
  if (upsetInfo(ev)?.level === 'alert') s += 8;
  if (typeof ffGameWeight === 'function') s += ffGameWeight(ev) || 0;
  return s;
}
function renderChips() {
  if (!$('#chips')) return; // no filter row on the page any more (see S.filter)
  const counts = {};
  for (const f of FILTERS) {
    const list = filterEvents(S.events, f.id);
    counts[f.id] = { n: list.length, live: list.some((e) => e.state === 'in') };
  }
  const chip = (f) => `<button class="chip" data-f="${f.id}" aria-pressed="${S.filter === f.id}">${counts[f.id].live ? '<span class="live-dot" aria-hidden="true"></span>' : ''}${esc(f.label)}${S.loaded ? ` <span class="ct">${counts[f.id].n}</span>` : ''}</button>`;
  const conf = FILTERS.find((f) => f.id === S.filter && !MAIN_FILTERS.includes(f.id));
  const anyConfLive = FILTERS.some((f) => !MAIN_FILTERS.includes(f.id) && counts[f.id].live);
  $('#chips').innerHTML = FILTERS.filter((f) => MAIN_FILTERS.includes(f.id)).map(chip).join('')
    + `<button class="chip conf" data-conf aria-haspopup="dialog" aria-pressed="${!!conf}">${(conf ? counts[conf.id].live : anyConfLive) ? '<span class="live-dot" aria-hidden="true"></span>' : ''}${esc(conf ? conf.label : 'Division')}${conf && S.loaded ? ` <span class="ct">${counts[conf.id].n}</span>` : ''}${ICON.caret}</button>`;
  // A saved filter far down the row ("Sun Belt") should be in view on launch.
  if (S.loaded && !S.chipsScrolled) { S.chipsScrolled = true; requestAnimationFrame(() => $('#chips [aria-pressed="true"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' })); }
}

function renderWeekLabel() {
  const w = S.week || S.cur;
  const e = w && S.calendar.find((c) => c.st === w.st && c.wk === w.wk);
  const i = e ? S.calendar.indexOf(e) : -1;
  for (const pre of ['', 'gv-', 'gh-']) {                    // the board's header, the game view's, GFFL's (desktop)
    const lab = $(`#${pre}week-label`);
    if (!lab) continue;
    lab.innerHTML = `${esc(e ? e.label.replace('Week ', 'Wk ') : 'Week')}${ICON.caret}`;
    lab.setAttribute('aria-label', `${e ? e.label : 'Week'}. Choose a week`);
    $(`#${pre}week-prev`).disabled = i <= 0;
    $(`#${pre}week-next`).disabled = i < 0 || i >= S.calendar.length - 1;
  }
}

function renderStatus() {
  const el = $('#status-line');
  if (!S.loaded && !S.error) { el.innerHTML = 'Loading this week’s games…'; return; }
  const evs = filterEvents(S.events, S.filter);
  const live = evs.filter((e) => e.state === 'in').length;
  const pre = evs.filter((e) => e.state === 'pre').length;
  const post = evs.filter((e) => e.state === 'post').length;
  const ago = S.updated ? Math.round((Date.now() - S.updated) / 1000) : null;
  const parts = [];
  if (live) parts.push(`<b>${live} live</b>`);
  if (pre) parts.push(`${pre} upcoming`);
  if (post) parts.push(`${post} final`);
  let right = ago == null ? '' : ago < 5 ? 'Updated just now' : ago < 90 ? `Updated ${ago}s ago` : `Updated ${Math.round(ago / 60)}m ago`;
  if (S.error) right = S.loaded ? `<span class="err">Can’t reach ESPN. Retrying…</span>` : '';
  el.innerHTML = `<span>${parts.join(' · ') || (S.loaded ? '0 games' : '')}</span><span style="margin-left:auto">${right}</span>`;
  $('#sync').classList.toggle('live', S.events.some((e) => e.state === 'in'));
}
setInterval(() => { if (!document.hidden) renderStatus(); }, 1000);

function miniField(ev, withLabels = true) {
  const { home: h, away: a } = ev;
  const s = ev.sit || {};
  const pct = (X) => `${(X / 120) * 100}%`;
  const pc = pair(a, h);
  let out = `<div class="ez l" style="background:${pc.aRaw};color:${onColor(pc.aRaw)}" aria-hidden="true">${withLabels ? esc(a.abbr.slice(0, 4)) : ''}</div><div class="ez r" style="background:${pc.hRaw};color:${onColor(pc.hRaw)}" aria-hidden="true">${withLabels ? esc(h.abbr.slice(0, 4)) : ''}</div>`;
  for (let y = 10; y <= 90; y += 10) out += `<div class="yl" style="left:${pct(10 + y)}"></div>`;
  const pid = possessionOf(ev);
  if (pid && s.yardLine != null && s.yardLine > 0 && s.yardLine < 100) {
    const X = 110 - s.yardLine;
    const offHome = pid === h.id;
    const dir = offHome ? -1 : 1;
    if (s.isRedZone) out += `<div class="rz" style="left:${pct(offHome ? 10 : 90)};width:${pct(20)}"></div>`;
    if (s.down > 0) {
      out += `<div class="ln los" style="left:${pct(X)}"></div>`;
      const fd = X + dir * (s.distance || 0);
      if (s.distance && fd > 10 && fd < 110) out += `<div class="ln fd" style="left:${pct(fd)}"></div>`;
    }
    const off = offHome ? h : a;
    out += `<div class="dir ${offHome ? 'l' : 'r'}" style="left:${pct(X)}" aria-hidden="true"></div><div class="ball" style="left:${pct(X)}" aria-hidden="true"></div><span class="sr">${esc(off.abbr)} ball${s.possessionText ? ' at ' + esc(s.possessionText) : ''}, driving toward the ${esc((offHome ? a : h).abbr)} end zone</span>`;
  }
  return `<div class="mini">${out}</div>`;
}
/* Who has the ball. ESPN leaves situation.possession empty during kickoffs, PATs,
   timeouts and quarter breaks, so fall back to the last play, then to the last team
   we saw with the ball. Nobody has it at halftime. */
S.poss = new Map();
const isHalftime = (ev) => ev.name === 'STATUS_HALFTIME' || (ev.period === 2 && /^end/i.test(ev.detail || ''));
const otherTeam = (ev, id) => (id === ev.home.id ? ev.away.id : ev.home.id);
function possessionOf(ev) {
  if (!ev || ev.state !== 'in') return null;
  if (isHalftime(ev)) { S.poss.delete(ev.id); return null; }
  const s = ev.sit || {};
  let p = s.possession || null;
  const lp = s.lastPlay;
  if (!p && lp?.team?.id) {
    const t = (lp.type?.text || '').toLowerCase();
    const tid = lp.team.id;
    if (/timeout|end of|end period|official|two-minute|coin toss/.test(t)) p = null;
    else if (/safety/.test(t)) p = tid;                                  // offense that gave up the safety free-kicks
    else if (lp.scoreValue > 0 || /touchdown|field goal good|extra point|two-point/.test(t)) p = tid; // scorer kicks off next
    else if (/kickoff|punt/.test(t)) p = otherTeam(ev, tid);             // ball goes to the return team
    else if (/interception|fumble recovery \(opp|missed|blocked|downs/.test(t)) p = otherTeam(ev, tid);
    else p = tid;
  }
  p = p || S.poss.get(ev.id) || null;
  if (p) S.poss.set(ev.id, p);
  return p;
}
// Opened mid-timeout with nothing remembered yet: read the play-by-play once.
S.possTried = new Map();
async function fillPossession() {
  const now = Date.now();
  const need = S.events.filter((e) => e.state === 'in' && !isHalftime(e) && !possessionOf(e) && !(now - (S.possTried.get(e.id) || 0) < 60000));
  if (!need.length) return;
  let got = 0;
  await Promise.all(need.slice(0, 6).map(async (ev) => {
    S.possTried.set(ev.id, now);
    try {
      const sum = normSummary(await getJSON(`${API}/summary?event=${ev.id}`), ev);
      const last = sum.flat.filter((f) => f.p.kind !== 'meta').pop()?.p;
      const q = last && (last.endTeam || last.offId);
      if (q && !possessionOf(ev)) { S.poss.set(ev.id, q); got++; }
    } catch {}
  }));
  if (got) renderBoard();
}
function wpInfo(ev) {
  const p = ev.sit?.lastPlay?.probability?.homeWinPercentage;
  if (p == null) return null;
  return { home: p, fav: p >= 0.5 ? ev.home : ev.away, pct: Math.round(Math.max(p, 1 - p) * 100) };
}
function teamRow(ev, t, side) {
  const s = ev.sit || {};
  const poss = possessionOf(ev) === t.id;
  const other = side === 'h' ? ev.away : ev.home;
  const lose = ev.state === 'post' && t.score != null && other.score != null && t.score < other.score;
  return `<div class="trow${lose ? ' lose' : ''}">${logoImg(t, 30)}<div class="tname"><span class="nm">${esc(t.name)}</span><span class="rec">${esc(t.record)}</span></div><div class="score-wrap">${poss ? ICON.ball : ''}<div class="score" data-sc="${ev.id}-${side}">${t.score ?? ''}</div></div></div>`;
}
function liveCard(ev, featured = false) {
  const s = ev.sit || {};
  const wp = wpInfo(ev);
  const pc = pair(ev.away, ev.home);
  const { h } = pc;
  const u = upsetInfo(ev);
  const half = isHalftime(ev);
  const dd = s.downDistanceText && s.down > 0 && !half ? `<span class="dd">${esc(s.downDistanceText)}</span>` : '';
  const lpType = (s.lastPlay?.type?.text || '').toLowerCase();
  const lpTeam = s.lastPlay?.team?.id === ev.home.id ? ev.home : s.lastPlay?.team?.id === ev.away.id ? ev.away : null;
  const moment = /touchdown/.test(lpType) ? 'Touchdown' : /field goal good/.test(lpType) ? 'Field goal' : /safety/.test(lpType) ? 'Safety'
    : /interception/.test(lpType) ? 'Interception' : /fumble recovery \(opp/.test(lpType) ? 'Fumble lost' : /extra point good/.test(lpType) ? 'Extra point good' : '';
  const between = half ? 'Halftime' : moment ? `<b class="moment">${moment}${lpTeam ? ' · ' + esc(lpTeam.abbr) : ''}</b>` : /timeout/.test(lpType) ? 'Timeout' : /kickoff/.test(lpType) || s.down === -1 ? 'Kickoff' : /end/.test(lpType) ? 'Between quarters' : 'Between plays';
  const aw = wp ? Math.round((1 - wp.home) * 100) : null;
  const wprow = wp ? `<div class="wprow" aria-label="Win probability"><span class="${aw >= 50 ? 'fav' : ''}">${esc(ev.away.abbr)} ${aw}%</span><div class="wpbar"><i style="width:${aw}%;background:${awayFill(pc)}"></i><i style="width:${100 - aw}%;background:${h}"></i></div><span class="${aw < 50 ? 'fav' : ''}">${100 - aw}% ${esc(ev.home.abbr)}</span></div>` : '';
  const lp = playLine(s.lastPlay);
  const ffx = typeof ffCardExtra === 'function' ? ffCardExtra(ev) || '' : '';
  return `<a class="card${u?.level === 'alert' ? ' upset-alert' : ''}${featured ? ' featured' : ''}" href="#g${ev.id}" data-key="${featured ? 'hero-' : ''}${ev.id}">
    <div class="card-head is-live"><span class="clock">${esc(statusText(ev))}</span>${upsetTag(u)}${s.isRedZone && !half ? '<span class="tag rz">Red zone</span>' : ''}${featured ? '' : `<span class="tv">${esc(tvShort(ev.tv))}</span>`}</div>
    <div class="teams">${teamRow(ev, ev.away, 'a')}${teamRow(ev, ev.home, 'h')}</div>
    ${miniField(ev)}
    <div class="sit">${dd || `<span class="quiet">${between}</span>`}</div>
    ${wprow}
    ${upsetLine(u)}
    ${lp ? `<div class="lastplay-line">${yardsHTML(esc(lp))}</div>` : ''}
    ${ffx}
  </a>`;
}
function listRow(ev, slotted = false) {
  const { away: A, home: H } = ev;
  const post = ev.state === 'post';
  const u = post ? upsetInfo(ev) : null;
  const t = (x, o) => {
    const lose = post && x.score != null && o.score != null && x.score < o.score;
    return `<div class="t${lose ? ' lose' : ''}">${logoImg(x, 22)}<span class="nm">${esc(x.name)}${u && u.D === x ? `<span class="upset-badge" title="${esc(u.favText)}">Upset</span>` : ''}</span><span class="sc">${post ? x.score ?? '' : ''}</span></div>`;
  };
  const tv = esc(tvShort(ev.tv));
  let when;
  if (post) when = `${ev.detail && ev.detail !== 'Final' ? esc(ev.detail.replace('Final/', 'F/')) : 'Final'}<small>${tv}</small>`;
  else if (slotted) when = tv || '<span style="color:var(--faint)">TV TBA</span>';
  else when = `${esc(statusText(ev))}<small>${tv || '&nbsp;'}</small>`;
  const right = !post && ev.odds?.details ? `<div class="odds"><b>${esc(ev.odds.details)}</b>${ev.odds.ou ? `O/U ${ev.odds.ou}` : ''}</div>` : '';
  const ffx = typeof ffCardExtra === 'function' ? ffCardExtra(ev) || '' : '';
  return `<a class="lrow${post || !right ? ' fin' : ''}" href="#g${ev.id}" data-key="${ev.id}"><div class="when">${when}</div><div class="mt">${t(A, H)}${t(H, A)}</div>${right}${ffx}</a>`;
}
// Finals: day headers. Upcoming: day headers, then one header per kickoff time.
function groupedRows(evs, slots = false) {
  const out = [];
  const days = new Set(evs.map((e) => dayKey(e.date)));
  let lastDay = null, lastSlot = null;
  for (const ev of evs) {
    const k = dayKey(ev.date);
    if (days.size > 1 && k !== lastDay) { out.push({ key: 'd' + k, html: `<div class="day-h" data-key="d${k}">${esc(fmtDay(ev.date))}</div>` }); lastDay = k; lastSlot = null; }
    if (slots) {
      const sk = ev.timeValid ? `${k}-${ev.date.getHours()}-${ev.date.getMinutes()}` : k + '-tba';
      if (sk !== lastSlot) {
        const n = evs.filter((e) => (e.timeValid ? `${dayKey(e.date)}-${e.date.getHours()}-${e.date.getMinutes()}` : dayKey(e.date) + '-tba') === sk).length;
        out.push({ key: 's' + sk, html: `<div class="slot-h" data-key="s${sk}">${ev.timeValid ? esc(fmtTime(ev.date)) : 'Time TBA'}<small>${n} game${n === 1 ? '' : 's'}</small></div>` });
        lastSlot = sk;
      }
    }
    out.push({ key: ev.id, html: listRow(ev, slots) });
  }
  return out;
}

function buildSections(evs, sidebar = false) {
  const live = evs.filter((e) => e.state === 'in').sort((x, y) => excitement(y) - excitement(x));
  const pre = evs.filter((e) => e.state === 'pre').sort((x, y) => x.date - y.date);
  const post = evs.filter((e) => e.state === 'post').sort((x, y) => y.date - x.date);
  const sections = [];
  // Featured game waits for betting lines (they decide upsets), then only switches when
  // another game is clearly better, so it doesn't jump around.
  const featReady = S.linesReady || Date.now() - S.firstLoadAt > 4000;
  if (live.length && !featReady) {
    const sk = '<div class="skel-card" aria-hidden="true"><i class="hd"></i><i class="row"></i><i class="row"></i><i class="fld"></i></div>';
    sections.push({ key: 'wait', cls: 'grid two', title: 'Live', live: true, count: live.length, items: [0, 1].map((i) => ({ key: 'sk' + i, html: sk.replace('<div class="skel-card"', `<div class="skel-card" data-key="sk${i}"`) })) });
    live.length = 0;
  }
  const cands = live.filter((e) => featuredScore(e) > -Infinity).sort((x, y) => featuredScore(y) - featuredScore(x));
  if (sidebar) {
    const f = live.find((e) => e.id === S.featuredId);
    if (f) { live.splice(live.indexOf(f), 1); sections.push({ key: 'hero', cls: 'grid', title: 'Best game on now', feat: true, items: [{ key: 'hero-' + f.id, html: liveCard(f, true) }] }); }
  } else if (live.length >= 3 && cands.length) {
    let top = cands[0];
    const cur = cands.find((e) => e.id === S.featuredId);
    if (cur && featuredScore(top) - featuredScore(cur) < 12) top = cur;
    S.featuredId = top.id;
    live.splice(live.indexOf(top), 1);
    sections.push({ key: 'hero', cls: 'grid', title: 'Best game on now', feat: true, items: [{ key: 'hero-' + top.id, html: liveCard(top, true) }] });
  } else if (featReady && !sidebar) S.featuredId = null;
  const ups = live.filter((e) => upsetInfo(e));
  if (ups.length) {
    const rank = (e) => (upsetInfo(e).level === 'alert' ? 1 : 0);
    ups.sort((x, y) => rank(y) - rank(x) || excitement(y) - excitement(x));
    const featUpset = S.featuredId && upsetInfo(S.byId.get(S.featuredId)) && sections.some((x) => x.feat) ? 1 : 0;
    sections.push({ key: 'upsets', title: 'Upset watch', upset: true, count: `${ups.length + featUpset} live`, cls: 'grid two', items: ups.map((e) => ({ key: e.id, html: liveCard(e) })) });
    for (const e of ups) live.splice(live.indexOf(e), 1);
  }
  if (live.length) sections.push({ key: 'live', title: 'Live', live: true, count: live.length, cls: 'grid two', items: live.map((e) => ({ key: e.id, html: liveCard(e) })) });
  if (pre.length) sections.push({ key: 'pre', title: 'Upcoming', count: pre.length, cls: 'list', items: groupedRows(pre, true) });
  if (post.length) sections.push({ key: 'post', title: 'Final', count: post.length, cls: 'list', items: groupedRows(post) });
  return sections;
}
function applySections(root, sections) {
  if (root.querySelector(':scope > .empty, :scope > .skel, :scope > .grid')) root.innerHTML = '';
  const existing = new Map([...root.children].map((n) => [n.dataset.key, n]));
  let prev = null;
  for (const sec of sections) {
    let el = existing.get(sec.key);
    existing.delete(sec.key);
    if (!el) {
      el = document.createElement('section');
      el.className = 'sec';
      el.dataset.key = sec.key;
      el.innerHTML = `<div class="sec-h"></div><div></div>`;
    }
    const h = el.firstElementChild;
    h.className = 'sec-h' + (sec.live ? ' live' : '') + (sec.upset ? ' upset' : '') + (sec.feat ? ' feat' : '');
    h.hidden = !sec.title;
    h.innerHTML = `${esc(sec.title)} <span class="ct">${esc(sec.count ?? '')}</span>`;
    const body = el.lastElementChild;
    body.className = sec.cls;
    patchList(body, sec.items);
    const ref = prev ? prev.nextSibling : root.firstChild;
    if (el !== ref) root.insertBefore(el, ref);
    prev = el;
  }
  existing.forEach((n) => n.remove());
}
const isWide = () => matchMedia('(min-width: 1080px)').matches;
// Desktop game view: the scoreboard, same order as the main page, beside the detail.
function renderSide() {
  const list = $('#gv-side-list');
  if (!list || !G || !S.loaded) return;
  const f = FILTERS.find((x) => x.id === S.filter);
  $('#gv-side-f').textContent = f ? f.label : 'All';
  const sections = buildSections(filterEvents(S.events, S.filter).filter((e) => e.id !== G.id), true);
  if (!sections.length) { list.innerHTML = '<div class="empty" style="padding:24px 8px"><p>No other games in this filter.</p></div>'; return; }
  applySections(list, sections);
  list.querySelectorAll('[data-key]').forEach((n) => {
    const href = n.getAttribute('href');
    if (href) n.classList.toggle('current', href === '#g' + G.id);
  });
}

// Phones: this week's games in a row under the game view's header, the open one lit. Tapping one
// swaps it in, as the desktop sidebar does. Live games first, then upcoming, then the finals, latest
// first (the scoreboard's own order).
function stripOrder(evs) {
  const live = evs.filter((e) => e.state === 'in').sort((a, b) => excitement(b) - excitement(a));
  const pre = evs.filter((e) => e.state === 'pre').sort((a, b) => a.date - b.date);
  const post = evs.filter((e) => e.state === 'post').sort((a, b) => b.date - a.date);
  return [...live, ...pre, ...post];
}
function renderStrip() {
  const el = $('#g-strip');
  if (!el || !G) return;
  const evs = stripOrder(S.events);
  el.hidden = evs.length < 2;
  const side = (t, sc) => `<span class="gs-t">${logoImg(t, 16, 'logo')}<span>${esc(t.abbr)}</span><b>${sc ?? ''}</b></span>`;
  setHTML(el, evs.map((e) => `<a class="gs-it${e.id === G.id ? ' current' : ''}${e.state === 'in' ? ' live' : ''}" href="#g${e.id}"${e.id === G.id ? ' aria-current="page"' : ''}>${side(e.away, e.state === 'pre' ? '' : e.away.score)}${side(e.home, e.state === 'pre' ? '' : e.home.score)}<small>${esc(e.state === 'pre' ? `${fmtDay(e.date).split(',')[0].slice(0, 3)} ${fmtTime(e.date)}` : statusText(e))}</small></a>`).join(''));
  const cur = el.querySelector('.current');
  if (cur && el.dataset.placed !== G.id) { el.scrollLeft = cur.offsetLeft - (el.clientWidth - cur.offsetWidth) / 2; el.dataset.placed = G.id; }
}
// The game the Scores tab opens on (2026-09-28, user: "just have it only be the detail page, we no
// longer need this page"): the most exciting live game (your GFFL players and teams count most),
// else a game kicking off within three hours, else the latest final, else the next game up.
function defaultGameId(evs) {
  if (!evs.length) return null;
  const live = evs.filter((e) => e.state === 'in').sort((a, b) => excitement(b) - excitement(a));
  if (live.length) return live[0].id;
  const pre = evs.filter((e) => e.state === 'pre').sort((a, b) => a.date - b.date);
  if (pre.length && pre[0].date - Date.now() < 3 * 3600e3) return pre[0].id;
  const post = evs.filter((e) => e.state === 'post').sort((a, b) => b.date - a.date);
  if (post.length) return post[0].id;
  return (pre[0] || evs[0]).id;
}
// With no game (or team) asked for, open the default one. After the viewer picks another week, the
// open game gives way to that week's default.
function ensureGame() {
  if (!S.loaded || /^#t\d+$/.test(location.hash)) return;
  const g = location.hash.match(/^#g(\d+)$/);
  if (g && !(S.weekPicked && !S.byId.has(g[1]))) return;
  S.weekPicked = false;
  const id = defaultGameId(S.events);
  document.body.classList.toggle('no-games', !id);
  if (!id) { if (G) closeGameView(true); return; }
  history.replaceState(null, '', location.pathname + location.search + '#g' + id);
  route();
}

function renderBoard() {
  renderChips();
  renderWeekLabel();
  renderStatus();
  if (typeof ffBoardHeader === 'function') setHTML($('#ff-head'), ffBoardHeader() || '');
  const board = $('#board');
  if (!S.loaded) {
    if (S.error) {
      board.innerHTML = `<div class="empty"><h3>Can’t reach ESPN</h3><p>Scores will load as soon as the connection is back.</p><button class="btn" data-retry>Try again</button></div>`;
      return;
    }
    const sk = '<div class="skel-card" aria-hidden="true"><i class="hd"></i><i class="row"></i><i class="row"></i><i class="fld"></i></div>';
    board.innerHTML = `<div class="grid two">${sk}${sk}${sk}${sk}</div>`;
    return;
  }
  const sections = buildSections(filterEvents(S.events, S.filter));
  if (!sections.length) {
    board.innerHTML = `<div class="empty"><h3>No games here</h3><p>Nothing in this filter for the selected week.</p><button class="btn ghost" data-goto="all">Show all games</button></div>`;
  } else applySections(board, sections);
  if (G) { renderSide(); renderStrip(); }
  if (typeof afterBoard === 'function') afterBoard();
  if (typeof ffAfterRender === 'function') ffAfterRender();

  // Score changes since last poll: flash the score that moved.
  const first = S.prevScores.size === 0;
  // Upset toasts only compare states computed with betting lines loaded; the first such pass is the baseline.
  const upsetBaseline = S.linesReady && !S.upsetPrimed;
  if (S.linesReady) S.upsetPrimed = true;
  for (const ev of S.events) {
    const u = upsetInfo(ev);
    const lvl = u?.level || null;
    const was = S.prevUpset.get(ev.id);
    if (!S.linesReady || upsetBaseline) { S.prevUpset.set(ev.id, lvl); continue; }
    if (was !== undefined && lvl !== was && u && u.big && (!G || G.id !== ev.id)) {
      const fav = u.F.name;
      if (lvl === 'alert' && was !== 'alert') toast(u.D, 'Upset alert', `${u.D.name} ${u.D.score ?? 0}, ${fav} ${u.F.score ?? 0} · ${statusText(ev)}`, ev.id);
      if (lvl === 'upset') toast(u.D, 'Upset!', `${u.D.name} beat ${fav} ${u.D.score}–${u.F.score}`, ev.id);
    }
    S.prevUpset.set(ev.id, lvl);
  }
  for (const ev of S.events) {
    for (const side of ['a', 'h']) {
      const t = side === 'a' ? ev.away : ev.home;
      const k = `${ev.id}-${side}`;
      const old = S.prevScores.get(k);
      if (!first && old != null && t.score != null && t.score > old) {
        document.querySelectorAll(`[data-sc="${k}"]`).forEach((n) => { n.classList.remove('bump'); void n.offsetWidth; n.classList.add('bump'); });
      }
      if (t.score != null) S.prevScores.set(k, t.score);
    }
  }
}

/* ───────────── toasts + big moments ───────────── */
function toast(team, title, text, gameId) {
  const box = $('#toasts');
  while (box.children.length >= 2) box.firstElementChild.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  const tc = teamInk(team);
  el.style.background = tc;
  el.style.color = onColor(tc);
  el.innerHTML = `${logoImg(team, 34, 'logo', true)}<button class="tbody" style="text-align:left;color:inherit"><b>${esc(title)}</b><span>${esc(text)}</span></button><button class="x" aria-label="Dismiss">×</button>`;
  const bye = () => { el.classList.add('out'); setTimeout(() => el.remove(), 300); };
  el.querySelector('.tbody').onclick = () => { el.remove(); if (gameId) location.hash = 'g' + gameId; };
  el.querySelector('.x').onclick = bye;
  let y0 = null;
  el.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchmove', (e) => { if (y0 != null && y0 - e.touches[0].clientY > 24) { y0 = null; bye(); } }, { passive: true });
  box.appendChild(el);
  navigator.vibrate?.([30, 50, 30]);
  setTimeout(bye, 5200);
}
let celebrateTimer = null;
function celebrate(team, word, sub) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { toast(team, word, sub || ''); return; }
  const c = $('#celebrate');
  const col = team.color;
  const tc = teamInk(team);
  c.innerHTML = `<div class="sweep" style="background:${tc}"></div>
    <div class="word" style="color:${onColor(tc)}">${logoImg(team, 96, 'logo', onColor(tc) === '#ffffff')}<b>${esc(word)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div>`;
  c.hidden = false;
  navigator.vibrate?.([60, 60, 120]);
  clearTimeout(celebrateTimer);
  celebrateTimer = setTimeout(() => { c.hidden = true; }, 2800);
}
$('#celebrate').addEventListener('click', () => { $('#celebrate').hidden = true; });
function bigMoment(p, sum, ev) {
  const team = (id) => (id === ev.home.id ? ev.home : ev.away);
  const tt = p.typeText.toLowerCase();
  if (p.scoring) {
    // Which side's score went up on this play?
    const prev = prevScoreFor(sum, p);
    const t = p.home > prev.home ? ev.home : p.away > prev.away ? ev.away : team(p.offId);
    const word = /touchdown/.test(tt) ? 'Touchdown' : /field goal/.test(tt) ? 'Field goal' : /safety/.test(tt) ? 'Safety' : /two-point|2pt/.test(tt) ? 'Two points' : null;
    if (word) celebrate(t, word, `${ev.away.abbr} ${p.away} – ${ev.home.abbr} ${p.home}`);
    return;
  }
  if (p.turnover) {
    const def = team(p.offId === ev.home.id ? ev.away.id : ev.home.id);
    const word = /interception/.test(tt) ? 'Picked off' : /fumble/.test(tt) ? 'Fumble' : /downs/.test(tt) ? 'Stopped' : 'Turnover';
    celebrate(def, word, `${def.name} ball`);
  }
}
function prevScoreFor(sum, p) {
  let last = { home: 0, away: 0 };
  for (const f of sum.flat) { if (f.p === p) break; if (f.p.home != null) last = { home: f.p.home, away: f.p.away }; }
  return last;
}

/* ───────────── game view ───────────── */
// 'fantasy' is first so that, when sd-fantasy.js defines ffTabFantasy, it becomes the default tab.
const TABS = [
  ['fantasy', 'Fantasy'], ['plays', 'Plays'], ['scoring', 'Scoring'], ['stats', 'Stats'], ['players', 'Players'], ['moments', 'Moments'], ['info', 'Info'],
];

function openGameView(id) {
  if (G && G.id === id) return;
  const swapping = !!G;
  const sideScroll = $('.gv-side')?.scrollTop || 0;
  if (G) closeGameView(true, true);
  const ev0 = S.byId.get(id) || null;
  G = {
    id, ev: ev0, sum: null, tab: null, side: 'away', expanded: new Set(), viewDrive: null,
    cursor: null, playing: false, speed: 1, seen: null, hold: null, celebrated: new Set(), lastRenderKey: '', animId: null, wake: null,
  };
  // The scoreboard keeps polling: it feeds the game strip (phones) and the sidebar (desktop).
  boardPoller.start();
  const v = $('#game-view');
  v.classList.remove('closing');
  v.classList.add('swap');                                   // the detail is the page: no slide-in over a board
  v.hidden = false;
  v.scrollTop = 0;
  document.body.classList.add('game-open');
  v.innerHTML = `<div class="gv-wrap"><div class="gv-main">
    <header class="g-top" id="g-top"><div class="g-top-row">
      <div class="gv-week"><button class="icon-btn" id="gv-week-prev" data-gvweek="-1" aria-label="Previous week">${$('#week-prev')?.innerHTML || ''}</button><button class="week-label" id="gv-week-label" data-gvweek="pick" aria-haspopup="dialog">Week</button><button class="icon-btn" id="gv-week-next" data-gvweek="1" aria-label="Next week">${$('#week-next')?.innerHTML || ''}</button></div>
      <div class="g-mini" id="g-mini"></div>
      <button class="icon-btn gv-set" id="gv-settings" aria-label="Settings" aria-haspopup="dialog">${$('#settings-btn')?.innerHTML || ''}</button>
    </div><nav class="g-strip" id="g-strip" aria-label="This week's games"></nav></header>
    <div class="g-body">
      <div class="g-hero" id="g-hero"><div class="skel" style="height:150px;background:transparent;border:0"></div></div>
      <section class="field-sec"><div class="stadium">
        <div class="field-cap" id="f-cap"></div>
        <div class="field-3d"><svg id="field" class="field-svg" viewBox="0 0 1200 533" role="img" aria-label="Field view of the current drive"></svg></div>
        <div class="big-tecmo" id="big-tecmo" hidden><div class="sl-stage bt-stage"><canvas id="bt-cv"></canvas><div class="ra-banner" id="bt-banner"></div></div><div class="sl-tx bt-tx" id="bt-tx"></div><div class="bt-rp" id="bt-rp" role="group" aria-label="8-bit replay" hidden></div></div>
        <div class="drive-sum" id="f-sum"></div>
        <div class="replay" id="replay" hidden>
          <button class="sq" id="rp-prev" aria-label="Previous play">${ICON.prev}</button>
          <button id="rp-play" aria-label="Play or pause the replay">${ICON.play}<span>Play</span></button>
          <button class="sq" id="rp-next" aria-label="Next play">${ICON.next}</button>
          <input type="range" id="rp-range" min="0" max="0" value="0" aria-label="Scrub through plays">
          <button id="rp-speed" aria-label="Replay speed">1×</button>
          <span class="rp-lbl" id="rp-lbl"></span>
        </div>
      </div></section>
      <div class="lp" id="lp" hidden></div>
      <div class="wp-strip" id="wp-strip" hidden></div>
      <nav class="tabs" id="tabs" role="tablist" aria-label="Game details"></nav>
      <div class="tab-body" id="tab-body" role="tabpanel" tabindex="-1"></div>
    </div></div>
    <aside class="gv-side" aria-label="Other games"><div class="side-live" id="side-live" hidden role="button" tabindex="0" aria-label="Open the play animation"><div class="sl-h"><span class="sl-tag" id="sl-tag">Live</span><span id="sl-meta"></span></div><div class="sl-stage"><canvas id="sl-cv"></canvas><div class="ra-banner sl-banner" id="sl-banner"></div></div><div class="sl-tx" id="sl-tx"></div></div><div class="gv-side-h">Scores <span id="gv-side-f"></span></div><div class="gv-side-list" id="gv-side-list"></div></aside></div>`;
  renderSide();
  renderStrip();
  renderWeekLabel();
  if (sideScroll) $('.gv-side').scrollTop = sideScroll;
  const top = $('#g-top');
  const io = new IntersectionObserver(([e]) => top.classList.toggle('scrolled', !e.isIntersecting), { root: v, threshold: 0, rootMargin: '-60px 0px 0px 0px' });
  io.observe($('#g-hero'));
  G.io = io;
  $('#rp-play').onclick = toggleReplay;
  $('#rp-range').oninput = (e) => { stopReplay(); setCursor(+e.target.value); };
  $('#rp-prev').onclick = () => { stopReplay(); setCursor((G.cursor ?? G.sum.flat.length - 1) - 1); };
  $('#rp-next').onclick = () => { stopReplay(); setCursor((G.cursor ?? -1) + 1); };
  $('#rp-speed').onclick = () => { G.speed = G.speed === 2 ? 1 : 2; $('#rp-speed').textContent = G.speed + '×'; };
  if (ev0) { renderHero(); drawFieldStatic(); }
  // Every 2 s in a live game (2026-09-28; it was 5): ESPN caches this per-game feed for 1 s, and the
  // 8-bit view animates from its latest play, so the page sees a new play 1.5 s sooner on average.
  G.evPoller = makePoller(loadGameEvent, () => (G?.ev?.state === 'in' ? 2000 : G?.ev?.state === 'pre' ? 60000 : null));
  G.sumPoller = makePoller(loadSummary, () => (G?.ev?.state === 'in' ? 10000 : G?.ev?.state === 'pre' ? 120000 : null));
  G.evPoller.start();
  G.sumPoller.start();
  requestWake();
}
function closeGameView(immediate, swapping) {
  if (!G) return;
  G.evPoller?.stop();
  G.sumPoller?.stop();
  G.io?.disconnect();
  stopReplay();
  releaseWake();
  G = null;
  const v = $('#game-view');
  if (typeof T === 'undefined' || !T) document.body.classList.remove('game-open');
  if (immediate) { v.hidden = true; v.innerHTML = ''; }
  else {
    v.classList.add('closing');
    setTimeout(() => { if (!G) { v.hidden = true; v.innerHTML = ''; v.classList.remove('closing'); } }, 240);
  }
  if (swapping) return;
  boardPoller.start();
  // Put keyboard focus back on the card that opened the game.
  const k = S.lastCardKey;
  if (k) requestAnimationFrame(() => document.querySelector(`#board [data-key="${k}"]`)?.focus({ preventScroll: true }));
}
let cameFromBoard = false;
document.addEventListener('click', (e) => { const a = e.target.closest('#board a[href^="#g"]'); if (a) S.lastCardKey = a.dataset.key; }, true);
// Sidebar games swap into the detail without stacking history, so Back still returns to the scoreboard.
document.addEventListener('click', (e) => {
  const a = e.target.closest('.gv-side a[href^="#g"], .g-strip a[href^="#g"]');
  if (!a || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  history.replaceState(history.state, '', a.getAttribute('href'));
  route();
});
function goBack() {
  if (cameFromBoard) history.back();
  else { history.replaceState(null, '', location.pathname + location.search); route(); }
}
function route() {
  const h = location.hash;
  const g = h.match(/^#g(\d+)$/), t = h.match(/^#t(\d+)$/);
  if (g) { openGameView(g[1]); return; }
  if (G) closeGameView(false);
  if (t) { openTeamView(t[1]); return; }
  if (T) closeTeamView();
  // The Matchups and Standings pages are gone (2026-09-27); an old #matchups / #standings link
  // lands on the board with its hash cleared.
  if (h === '#matchups' || h.startsWith('#standings')) history.replaceState(null, '', location.pathname + location.search);
  showTab('scores');
  ensureGame();                                        // the Scores tab is the game detail; the board is only a loading screen
}

/* The 8-bit view goes first. While it's on screen, a new play shows up there before anywhere
   else: the score, last play, field, win probability and play list hold until the animation
   reaches the play's result, then all change together. */
const latestRealId = () => { const l = typeof raPlays === 'function' ? raPlays().filter((p) => !p.pat) : []; return l.length ? String(l[l.length - 1].id) : null; };
function gateCheck() {
  if (!G) return;
  // Hold the score for the 8-bit view only while someone can actually watch it: the field on screen
  // and the page in front. Scrolled down to the plays, or in another app, the page just updates.
  const live = typeof sideLiveOn === 'function' && sideLiveOn() && !document.hidden && tecmoOnScreen();
  const id = latestRealId();
  if (!live) { if (G.gate) gateOpen(); G.shownId = id; return; }
  if (G.shownId == null) { G.shownId = id; return; }                   // on arrival, show what's already happened
  if (id && id !== G.shownId) {
    if (!G.gate) G.gate = { id, at: Date.now(), old: null, moment: null };
    else G.gate.id = id;
  }
  // Never hold long: 15 s, down from 45 (2026-09-28, user: "I keep having to refresh to see latest
  // play"). A score held behind a slow animation reads as a page that stopped updating.
  if (G.gate && Date.now() - G.gate.at > 15000) gateOpen();
}
function tecmoOnScreen() {
  const cv = typeof sideTarget === 'function' ? sideTarget().cv : null;
  if (!cv) return false;
  const r = cv.getBoundingClientRect();
  return r.width > 0 && r.bottom > 0 && r.top < innerHeight;
}
function gateOpen() {
  const g = G?.gate;
  if (!G) return;
  G.gate = null;
  G.shownId = latestRealId();
  renderHero(g?.old || undefined);
  if (G.cursor == null) renderFieldView(true);
  updateReplayBar();
  renderLastPlay(true);
  renderWPStrip();
  G.lastRenderKey = null;
  renderTabBody();
  if (g?.moment && G.cursor == null) celebrateOnce(g.moment);
}
// Called by the 8-bit view when a play's result appears (a whistle, a "Touchdown" banner).
function gameGateRelease(id) {
  if (!G?.gate) return;
  const l = raPlays();
  const want = l.findIndex((p) => String(p.id) === String(G.gate.id)), got = l.findIndex((p) => String(p.id) === String(id));
  if (got >= want || want < 0) gateOpen();
}
async function loadGameEvent() {
  const id = G.id;
  const d = await getJSON(`${API}/scoreboard/${id}`);
  if (!G || G.id !== id) return;
  const ev = normEvent(d);
  const old = G.ev;
  G.ev = ev;
  S.byId.set(id, ev);
  const idx = S.events.findIndex((e) => e.id === id);
  if (idx >= 0) S.events[idx] = ev;
  if (!G.fieldBuilt) drawFieldStatic();
  if (!G.sum) { renderHero(old); return; }
  const qid = ev.sit?.lastPlay?.id;
  const fresh = !!qid && qid !== G.quickId && !!G.quickId;
  G.quickId = qid || G.quickId;
  const q = quickPlay(ev);
  const scoreMoved = old && (old.home.score !== ev.home.score || old.away.score !== ev.away.score);
  let moment = null, heroOld = old;
  if (scoreMoved && !(fresh && q?.scoring) && !scoreExplained(ev, q) && !G.hold) G.hold = { away: old.away.score, home: old.home.score, t: Date.now() };
  if (fresh && q && (q.scoring || q.turnover)) {
    moment = q;
    if (q.scoring && G.hold) { heroOld = { away: { score: G.hold.away }, home: { score: G.hold.home } }; G.hold = null; }
  }
  if (G.hold && scoreExplained(ev, q)) { heroOld = { away: { score: G.hold.away }, home: { score: G.hold.home } }; G.hold = null; }
  gateCheck();
  if (G.gate) {                                                          // the 8-bit view shows it first
    G.gate.old ||= G.hold ? null : heroOld;
    if (moment) G.gate.moment = moment;
  } else {
    renderHero(G.hold ? null : heroOld);
    if (G.cursor == null) renderFieldView(fresh);
    renderLastPlay(fresh);
    renderWPStrip();
    if (moment && G.cursor == null) celebrateOnce(moment);
  }
  if (typeof sideUpdate === 'function') sideUpdate();
  // A play we haven't seen yet, a score change, or the same play with new text (ESPN rewrites a play once
  // a replay review is over; the 8-bit view then stages the ruling): pull the full summary now.
  const edited = !!qid && qid === old?.sit?.lastPlay?.id && ev.sit.lastPlay.text !== old.sit.lastPlay.text;
  if ((qid && quickIsNewer(qid, G.sum, G.id)) || edited || scoreMoved || G.hold || (old && old.state !== ev.state)) G.sumPoller.now();
}
// A score change the page can already account for: the scoreboard's latest play is a scoring play, or
// the summary's last scoring play carries this very score. (2026-09-28, PHI @ CHI: ESPN put the
// touchdown up as the scoreboard's latest play a poll before it moved the score, so the score moved
// with no *new* play; the page held the old score for its full 25 s, and the family saw it change about
// 30 s after the 8-bit touchdown.) The hold is for a score that arrives before its play does.
function scoreExplained(ev, q) {
  if (!ev) return false;
  if (q?.scoring) return true;
  const last = G?.sum?.flat.map((f) => f.p).filter((p) => p.scoring && p.kind !== 'meta').pop();
  return !!last && +last.away === +ev.away.score && +last.home === +ev.home.score;
}
function celebrateOnce(p) {
  if (!p || G.celebrated.has(p.id)) return;
  G.celebrated.add(p.id);
  bigMoment(p, G.sum, G.ev);
}
async function loadSummary() {
  const id = G.id;
  const d = await getJSON(`${API}/summary?event=${id}`);
  if (!G || G.id !== id) return;
  if (!G.ev && d.header) {
    G.ev = normEvent({ ...d.header, date: d.header.competitions[0].date, status: d.header.competitions[0].status });
    renderHero();
    drawFieldStatic();
  }
  if (!S.lines.has(id) && d.pickcenter?.[0] && G.ev) {
    const ln = lineFrom(d.pickcenter[0], G.ev.home, G.ev.away);
    if (ln) { S.lines.set(id, ln); saveLines(); renderHero(); }
  }
  const sum = normSummary(d, G.ev);
  const prev = G.sum;
  G.sum = sum;
  if (typeof ffOnSummary === 'function') ffOnSummary(G.ev, d);
  // New plays since the last pull → animate + celebrate the newest big moment.
  let fresh = [];
  if (G.seen) fresh = sum.flat.filter((f) => !G.seen.has(f.p.id)).map((f) => f.p);
  G.seen = new Set(sum.flat.map((f) => f.p.id));
  if (!G.tab) {
    G.tab = typeof ffTabFantasy === 'function' ? 'fantasy' : G.ev?.state === 'pre' ? 'info' : 'plays';
    renderTabs();
  }
  const isNew = fresh.length > 0 || !prev;
  const moment = [...fresh].reverse().find((p) => p.scoring || p.turnover);
  let held = null;
  if (G.hold && (fresh.some((p) => p.scoring) || scoreExplained(G.ev, quickPlay(G.ev)) || Date.now() - G.hold.t > 25000)) {
    held = { away: { score: G.hold.away }, home: { score: G.hold.home } };
    G.hold = null;
  }
  gateCheck();
  if (G.gate) {                                                          // the 8-bit view shows it first
    if (held) G.gate.old ||= held;
    if (moment && prev) G.gate.moment = moment;
  } else {
    if (held) renderHero(held);
    if (G.cursor == null) renderFieldView(isNew);
    updateReplayBar();
    renderLastPlay(isNew && !!prev);
    renderWPStrip();
    const key = `${sum.flat.length}|${sum.wp.length}|${JSON.stringify(d.boxscore?.teams?.map((t) => t.statistics?.map((s) => s.displayValue)) || '')}|${G.ev?.state}`;
    if (key !== G.lastRenderKey) { G.lastRenderKey = key; renderTabBody(); }
    if (moment && G.cursor == null && prev) celebrateOnce(moment);
  }
  if (fresh.length && typeof reenactFresh === 'function') reenactFresh(fresh);
  if (typeof sideUpdate === 'function') sideUpdate();
}

/* hero */
function gamePossession(at) {
  const ev = G.ev;
  if (at) return at.kind === 'meta' ? null : at.endTeam || at.offId;
  if (!ev || ev.state !== 'in' || isHalftime(ev)) return null;
  const p = possessionOf(ev);
  if (p) return p;
  const last = G.sum?.flat.filter((f) => f.p.kind !== 'meta').pop()?.p;
  if (!last) return null;
  const q = last.endTeam || last.offId;
  if (q) S.poss.set(ev.id, q);
  return q;
}
function renderHero(old) {
  const ev = G.ev;
  if (!ev) return;
  const { away: A, home: H } = ev;
  const at = G.cursor != null && G.sum ? G.sum.flat[G.cursor]?.p : null;
  const aScore = at ? at.away : G.hold ? G.hold.away : A.score;
  const hScore = at ? at.home : G.hold ? G.hold.home : H.score;
  const s = ev.sit || {};
  const live = ev.state === 'in';
  const pc = pair(A, H);
  // Solid, exact team colours split on the diagonal; each side's text is dark or white to suit its colour.
  const bg = `linear-gradient(100deg, ${pc.aRaw} 0 50%, ${pc.hRaw} 50% 100%)`;
  const ink = (c) => (lum(c) > 0.42 ? 'dark' : 'light');
  const to = (n) => `<span class="to" aria-label="${n} timeouts left"><b>TO</b>${[0, 1, 2].map((i) => `<i class="${i < n ? '' : 'used'}"></i>`).join('')}</span>`;
  const pid = gamePossession(at);
  const team = (t, side) => {
    const poss = pid === t.id;
    const tos = side === 'a' ? s.awayTimeouts : s.homeTimeouts;
    const showTO = live && tos != null && !at && !isHalftime(ev);
    const tone = ink(side === 'a' ? pc.aRaw : pc.hRaw);
    return `<div class="gt ${side} on-${tone}"><div class="lgw"><a href="#t${t.id}" class="lg-link" aria-label="${esc(t.name)} team page">${logoImg(t, 60, 'lg', tone === 'light')}</a></div>
      <div class="nm" data-abbr="${esc(t.abbr)}">${esc(t.name)}</div>
      <div class="meta"><span>${esc(t.record)}</span></div>
      ${live && !at ? (showTO ? to(tos) : '<span class="to" aria-hidden="true" style="visibility:hidden"><b>TO</b><i></i><i></i><i></i></span>') : ''}
    </div>`;
  };
  let mid;
  if (ev.state === 'pre') {
    const d = ev.date;
    mid = `<div class="kick">${ev.timeValid ? esc(fmtTime(d)) : 'TBD'}<small>${esc(d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }))}${ev.tv ? ' · ' + esc(ev.tv) : ''}</small></div>`;
  } else {
    const lead = (aScore || 0) - (hScore || 0);
    const final = ev.state === 'post' && !at;
    const clock = at ? `${periodLabel(at.period)} ${at.clock} · Replay` : statusText(ev);
    const pop = pid && pid !== G.lastPid ? ' pop' : '';
    G.lastPid = pid;
    mid = `<div class="scores"><span class="hp${pid === A.id ? ' on' + pop : ''}">${ICON.heroBall}</span><span class="on-${ink(pc.aRaw)} ${final && lead < 0 ? 'lose' : ''}" id="gs-a">${aScore ?? 0}</span><span class="dash">–</span><span class="on-${ink(pc.hRaw)} ${final && lead > 0 ? 'lose' : ''}" id="gs-h">${hScore ?? 0}</span><span class="hp${pid === H.id ? ' on' + pop : ''}">${ICON.heroBall}</span></div>
      <div class="clock ${live && !at ? 'live' : ''}">${esc(clock)}</div>`;
  }
  const u = at ? null : upsetInfo(ev);
  const ub = u ? `<div class="gh-upset ${u.level}">${u.level === 'watch' ? ICON.eye : ICON.warn}<b>${u.level === 'alert' ? 'Upset alert' : u.level === 'watch' ? 'Upset watch' : 'Upset'}</b><span>${esc(u.favText)} · ${esc(u.state)}</span></div>` : '';
  const heroChanged = setHTML($('#g-hero'), `<div class="bg" style="background:${bg}"></div><div class="g-hero-in">${team(A, 'a')}<div class="gs">${mid}</div>${team(H, 'h')}</div>${ub}`);
  $('#g-mini').innerHTML = `${logoImg(A, 22, 'logo')}<span>${aScore ?? ''}</span><span class="clk${ev.state === 'pre' ? ' pre' : ''}">${esc(ev.state === 'pre' ? fmtTime(ev.date) : at ? 'Replay' : statusText(ev))}</span><span>${hScore ?? ''}</span>${logoImg(H, 22, 'logo')}`;
  // Full school name when it fits the column, abbreviation when it doesn't.
  if (heroChanged) fitHeroNames();
  if (old && !at && !G.hold) {
    if (old.away.score != null && A.score > old.away.score) bumpEl('#gs-a');
    if (old.home.score != null && H.score > old.home.score) bumpEl('#gs-h');
  }
}
// Full school names unless one would need a third line or can't fit a single word; then abbreviate both sides.
function fitHeroNames() {
  const hero = $('#g-hero');
  const nms = [...document.querySelectorAll('#g-hero .gt .nm')];
  if (!hero || !nms.length) return;
  hero.classList.remove('two-line');
  nms.forEach((n) => { n.textContent = n.dataset.full || n.textContent; n.dataset.full = n.textContent; });
  const lines = (n) => { const r = document.createRange(); r.selectNodeContents(n); return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size; };
  const tooBig = nms.some((n) => lines(n) > 2 || n.scrollWidth > n.clientWidth + 1);
  if (tooBig) nms.forEach((n) => { n.textContent = n.dataset.abbr; });
  hero.classList.toggle('two-line', !tooBig && nms.some((n) => lines(n) > 1));
}
window.addEventListener('resize', () => { if (G) { fitHeroNames(); renderSide(); if (isWide()) boardPoller.start(); } });
document.fonts?.ready.then(() => { if (G) fitHeroNames(); });
function bumpEl(sel) { const n = $(sel); if (n) { n.classList.remove('bump'); void n.offsetWidth; n.classList.add('bump'); } }

document.addEventListener('click', (e) => {
  if (G && e.target.closest('.rp-start')) {
    // On the big 8-bit view, Replay starts at once (2026-09-28, user: "it should immediately default
    // to either start of the game if the game is over, or current drive if the game is ongoing"; it
    // used to ask Game start / This drive first). The drive row under it jumps anywhere.
    if ($('.stadium')?.classList.contains('tecmo') && typeof tecmoRpStart === 'function') tecmoRpStart(G.ev?.state === 'post' ? 'game' : 'drive');
    else toggleReplay();
    return;
  }
});

/* ───────────── the field ───────────── */
const FX = (H) => (110 - H) * 10;   // yards-from-home-goal → svg x
function drawFieldStatic() {
  const ev = G?.ev;
  const svg = $('#field');
  if (!ev || !svg) return;
  G.fieldBuilt = true;
  const { away: A, home: H } = ev;
  const W = 1200, Ht = 533;
  let s = `<defs>
    <pattern id="ezp" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="9" height="26" fill="${ezStyle(H).pattern || 'transparent'}" fill-opacity="0.85"/></pattern>
    <linearGradient id="turfsheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.10"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.18"/></linearGradient>
    <radialGradient id="ballglow"><stop offset="0" stop-color="#fff" stop-opacity="0.9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  </defs>`;
  for (let i = 0; i < 20; i++) s += `<rect x="${100 + i * 50}" y="0" width="50" height="${Ht}" fill="${i % 2 ? '#2d8045' : '#28743e'}"/>`;
  const pc = pair(A, H);
  // Both end zones in the home team's paint (2026-09-28: they used to be one team's each).
  const Z = ezStyle(H);
  const ez = (label, x, rot) => {
    const fs = Math.min(76, 470 / Math.max(3, label.length * 0.56));
    const logo = Z.logo && label.length <= 9;
    const half = label.length * fs * 0.33 + 44;                // half the word's run, plus a gap: the logos go either side
    const lg = logo ? [-1, 1].map((d) => `<image href="${esc(logoURL(H, 120, false))}" x="${-30 + d * half}" y="-30" width="60" height="60" opacity="0.95"/>`).join('') : '';
    return `<rect x="${x}" y="0" width="100" height="${Ht}" fill="${Z.fill}"/>${Z.pattern ? `<rect x="${x}" y="0" width="100" height="${Ht}" fill="url(#ezp)"/>` : ''}
      <g transform="translate(${x + 50} ${Ht / 2}) rotate(${rot})">${lg}<text text-anchor="middle" dominant-baseline="central" font-size="${fs}" font-weight="900" letter-spacing="4" fill="${Z.ink}"${Z.edge ? ` stroke="${Z.edge}" stroke-width="${Math.max(2, fs / 14).toFixed(1)}" paint-order="stroke"` : ''}>${esc(label)}</text></g>`;
  };
  s += ez(Z.words[1], 0, -90) + ez(Z.words[0], 1100, 90);
  for (let y = 0; y <= 100; y += 5) {
    const x = 100 + y * 10;
    s += `<line x1="${x}" y1="0" x2="${x}" y2="${Ht}" stroke="#fff" stroke-opacity="${y % 10 ? 0.5 : 0.85}" stroke-width="${y === 0 || y === 100 ? 6 : 2.5}"/>`;
  }
  let hm = '';
  for (let y = 1; y < 100; y++) {
    if (y % 5 === 0) continue;
    const x = 100 + y * 10;
    hm += `M${x} 2V14M${x} 519V531M${x} 228.8V242.8M${x} 290.2V304.2`;
  }
  s += `<path d="${hm}" stroke="#fff" stroke-opacity="0.55" stroke-width="2"/>`;
  for (let y = 10; y <= 90; y += 10) {
    const n = y <= 50 ? y : 100 - y;
    const x = 100 + y * 10;
    const tens = String(n)[0], ones = String(n)[1];
    const arrow = y === 50 ? '' : y < 50 ? `<path d="M${x - 52} 452l-12 7 12 7z" fill="#fff" fill-opacity="0.8"/>` : `<path d="M${x + 52} 452l12 7-12 7z" fill="#fff" fill-opacity="0.8"/>`;
    s += `<g fill="#fff" fill-opacity="0.85" font-size="58" font-weight="800">
      <text x="${x - 6}" y="480" text-anchor="end">${tens}</text><text x="${x + 6}" y="480" text-anchor="start">${ones}</text>${arrow}
      <g transform="rotate(180 ${x} 70)" fill-opacity="0.4"><text x="${x - 6}" y="92" text-anchor="end">${tens}</text><text x="${x + 6}" y="92" text-anchor="start">${ones}</text></g></g>`;
  }
  s += `<image id="f-logo" href="${logoURL(H, 90, false)}" x="540" y="206" width="120" height="120" opacity="0.55"/>`;
  s += `<rect x="0" y="0" width="${W}" height="${Ht}" fill="url(#turfsheen)"/>`;
  s += `<rect x="2" y="2" width="${W - 4}" height="${Ht - 4}" fill="none" stroke="#fff" stroke-width="5" stroke-opacity="0.9"/>`;
  s += `<g id="f-ov"></g>`;
  svg.innerHTML = s;
}

function fieldState() {
  const sum = G.sum, ev = G.ev;
  const drives = sum?.drives || [];
  if (G.cursor != null && sum) {
    const f = sum.flat[G.cursor];
    if (!f) return null;
    const dr = drives[f.di];
    const plays = dr.plays.slice(0, f.pi + 1).filter((p) => p.kind !== 'meta');
    const nx = sum.flat[G.cursor + 1];
    const sameDrive = nx && nx.di === f.di;
    return {
      drive: dr, plays, losH: f.p.eH, off: f.p.endTeam || f.p.offId,
      down: sameDrive ? nx.p.down : null, dist: sameDrive ? nx.p.dist : null,
      dd: sameDrive && nx.p.sDD ? `${nx.p.sDD} at ${nx.p.sPos}` : '',
      live: false, anim: f.p.id,
    };
  }
  if (!drives.length) return { drive: null, plays: [], live: false };
  const di = G.viewDrive != null && drives[G.viewDrive] ? G.viewDrive : drives.length - 1;
  let dr = drives[di];
  let plays = dr.plays.filter((p) => p.kind !== 'meta');
  const latest = di === drives.length - 1;
  let live = ev?.state === 'in' && latest && !isHalftime(ev);
  const sit = ev?.sit;
  const q = live ? quickPlay(ev) : null;
  if (q && q.kind !== 'meta' && quickIsNewer(q.id, sum, ev.id)) {
    const prevP = plays[plays.length - 1];
    if (!q.offId || q.offId === dr.teamId) {
      if (prevP && prevP.endTeam === q.offId) { q.down = prevP.endDown; q.sDD = prevP.endDD.split(' at ')[0] || ''; }
      plays = [...plays, q];
    } else {
      dr = { ...dr, id: 'q' + q.id, teamId: q.offId, desc: '', result: '', plays: [q] };
      plays = [q];
    }
  }
  const lp = plays[plays.length - 1];
  const sitLive = live && sit && sit.possession && sit.yardLine != null && sit.down > 0;
  if (live && !sitLive && driveDone(dr)) live = false;
  const st = { drive: dr, plays, live, anim: lp?.id };
  if (live && sit && sit.possession && sit.yardLine != null && sit.down > 0) {
    Object.assign(st, { losH: sit.yardLine, off: sit.possession, down: sit.down, dist: sit.distance, dd: sit.downDistanceText, rz: sit.isRedZone });
  } else if (lp) {
    Object.assign(st, { losH: lp.eH, off: lp.endTeam || lp.offId, down: live ? lp.endDown : null, dist: live ? lp.endDist : null, dd: live ? lp.endDD : '' });
  }
  return st;
}

function renderFieldView(animate) {
  const ov = $('#f-ov');
  if (!ov || !G.ev) return;
  const ev = G.ev;
  const { a: ca, h: ch } = pair(ev.away, ev.home);
  const col = (tid) => (tid === ev.home.id ? ch : ca);
  const st = fieldState();
  const cap = $('#f-cap');
  const sumEl = $('#f-sum');
  const stadium = $('.stadium');
  stadium?.classList.toggle('pre', ev.state === 'pre');
  $('#f-logo')?.setAttribute('opacity', st?.plays?.length ? '0.22' : '0.55');
  if (!st || !st.drive) {
    ov.innerHTML = '';
    const ln = S.lines.get(ev.id);
    cap.innerHTML = ev.state === 'pre'
      ? `<span class="dd">${ln?.details ? esc(ln.details) : 'Pregame'}</span><span class="spot">${ev.odds?.ou ? 'O/U ' + esc(ev.odds.ou) + ' · ' : ''}${esc(ev.venue)}</span>`
      : `<span class="dd">${esc(statusText(ev))}</span>`;
    sumEl.innerHTML = '';
    return;
  }
  const dr = st.drive;
  const drTeam = dr.teamId === ev.home.id ? ev.home : ev.away;
  let plays = st.plays;
  let hidden = 0;
  // Keep text readable on a phone: the SVG renders at ~0.3x there, so sizes are set in
  // screen pixels (k = px per field unit) and fewer, taller lanes are used.
  const k = Math.max(0.2, ($('#field')?.clientWidth || 360) / 1200);
  const narrow = k < 0.5;
  const MAX = narrow ? 5 : 8;
  if (plays.length > MAX) { hidden = plays.length - MAX; plays = plays.slice(-MAX); }
  const n = Math.max(plays.length, 1);
  const bandTop = 104, bandBot = 440;            // clear of both rows of yard numbers
  const laneH = Math.min(narrow ? 80 : 62, (bandBot - bandTop) / n);
  const top = bandTop + ((bandBot - bandTop) - laneH * n) / 2;
  const FS = Math.max(12 / k, Math.min(34, laneH / 1.7));     // pill text ≥ 12px on screen
  const DOWN_R = Math.max(8 / k, Math.min(15, laneH / 3.2));   // down marker ≥ 16px across
  const DOWN_FS = Math.max(10 / k, Math.min(20, laneH / 2.6));
  let g = '';

  // Red zone tint + line of scrimmage + line to gain
  const offHome = st.off === ev.home.id;
  const dir = offHome ? -1 : 1;
  const losX = st.losH != null ? FX(st.losH) : null;
  const inRZ = st.rz ?? (st.losH != null && (offHome ? st.losH >= 80 : st.losH <= 20));
  if (st.live && inRZ) g += `<rect x="${offHome ? 100 : 900}" y="0" width="200" height="533" fill="#ff3b3b" fill-opacity="0.32"/><rect x="${offHome ? 97 : 1097}" y="0" width="6" height="533" fill="#ff3b3b"/>`;
  const showLines = losX != null && st.down > 0;
  if (showLines) {
    g += `<rect x="${losX - 3}" y="0" width="6" height="533" fill="#4aa3ff" opacity="0.95"/>`;
    if (st.dist) {
      const fdX = losX + dir * st.dist * 10;
      if (fdX > 100 && fdX < 1100) g += `<rect x="${fdX - 3}" y="0" width="6" height="533" fill="#ffd21f" opacity="0.95"/>`;
    }
  }

  // Drive chart: one lane per play, oldest at the far sideline, newest nearest you.
  let lastPath = null;
  plays.forEach((p, i) => {
    const y = top + laneH * (i + 0.5);
    const sx = p.sH != null ? FX(p.sH) : null;
    let ex = p.eH != null ? FX(p.eH) : sx;
    if (sx == null) return;
    const pdir = p.offId === ev.home.id ? -1 : 1;
    let c = col(p.offId);
    let d, dash = '', label = '', endMark = '';
    const lift = (h) => `M${sx} ${y} Q${(sx + ex) / 2} ${y - (Math.abs(ex - sx) < 1 ? 0 : Math.min(h, (y - 16) * 2))} ${ex} ${y}`;
    switch (p.kind) {
      case 'pass': d = lift(clamp(Math.abs(ex - sx) * 0.45, 28, laneH * 1.6)); break;
      case 'incomplete': ex = sx + pdir * 120; d = lift(clamp(40, 28, laneH * 1.4)); dash = '10 12'; label = 'INC'; endMark = 'x'; break;
      case 'kickoff': case 'punt': d = lift(Math.min(150, laneH * 2.4)); break;
      case 'fg': {
        ex = pdir > 0 ? 1100 : 100;
        d = lift(Math.min(150, laneH * 2.4));
        const good = /good/i.test(p.typeText) || p.scoring;
        c = good ? c : '#ff5a5a';
        label = /extra point/i.test(p.typeText) ? (good ? 'PAT' : 'NO PAT') : good ? 'FG ✓' : 'NO GOOD';
        break;
      }
      case 'penalty': d = `M${sx} ${y} L${ex} ${y}`; c = '#ffd21f'; dash = '4 10'; label = 'FLAG'; break;
      default: d = `M${sx} ${y} L${ex} ${y}`;
    }
    if (p.turnover) c = '#ff5a5a';
    if (!label) {
      if (p.scoring && /touchdown/i.test(p.typeText)) label = 'TD';
      else if (p.kind === 'kickoff') label = 'KICK';
      else if (p.kind === 'punt') label = 'PUNT';
      else if (p.turnover) label = /interception/i.test(p.typeText) ? 'INT' : 'TO';
      else if (p.yards != null) label = (p.yards > 0 ? '+' : '') + p.yards;
    }
    const isLast = i === plays.length - 1;
    const sw = Math.max(5, Math.min(9, laneH / 7));
    const fs = FS;
    // Split: the play to where it ended, then the flag's yards on top.
    let pen = '';
    if (p.penYards && p.yards != null && p.eH != null) {
      const endX = ex;
      const mx = FX(p.sH + (p.offId === ev.home.id ? 1 : -1) * p.yards);
      d = p.kind === 'pass' ? `M${sx} ${y} Q${(sx + mx) / 2} ${y - Math.min(clamp(Math.abs(mx - sx) * 0.45, 28, laneH * 1.6), (y - 16) * 2)} ${mx} ${y}` : `M${sx} ${y} L${mx} ${y}`;
      const pd = `M${mx} ${y} L${endX} ${y}`;
      const ptxt = `PEN ${p.penYards > 0 ? '+' : ''}${p.penYards}`;
      pen = `<path d="${pd}" class="play-path" stroke="#fff" stroke-opacity="0.85" stroke-width="${sw + 5}"/>
        <path d="${pd}" class="play-path${isLast ? ' last' : ''}" stroke="#ffd21f" stroke-width="${sw}" stroke-dasharray="6 9"/>
        <circle cx="${mx}" cy="${y}" r="${sw * 0.8}" fill="${c}" stroke="#fff" stroke-width="3"/>
        ${pill(mx, y - fs * 1.2, label, 'middle', fs * 0.9)}
        ${pill(endX + (endX >= mx ? 1 : -1) * 34, y, ptxt, endX >= mx ? 'start' : 'end', fs)}`;
      label = '';
      ex = endX;
    }
    g += `<g class="pl" data-last="${isLast}">
      <path d="${d}" class="play-path" stroke="#fff" stroke-opacity="0.85" stroke-width="${sw + 5}" ${dash ? `stroke-dasharray="${dash}"` : ''}/>
      <path d="${d}" class="play-path${isLast ? ' last' : ''}" stroke="${c}" stroke-width="${sw}" ${dash ? `stroke-dasharray="${dash}"` : ''}/>
      ${pen}
      <circle cx="${sx}" cy="${y}" r="${DOWN_R}" fill="#0c1a12" stroke="#fff" stroke-width="${Math.max(3, 1.5 / k)}"/>
      ${p.down > 0 ? `<text x="${sx}" y="${y + 1}" text-anchor="middle" dominant-baseline="central" font-size="${DOWN_FS}" font-weight="800" fill="#fff">${p.down}</text>` : ''}
      ${endMark === 'x' ? `<path d="M${ex - 10} ${y - 10}l20 20M${ex + 10} ${y - 10}l-20 20" stroke="#fff" stroke-width="5" stroke-linecap="round"/>` : Math.abs(ex - sx) < DOWN_R * 2 ? '' : `<circle cx="${ex}" cy="${y}" r="${sw * 0.9}" fill="${pen ? '#ffd21f' : c}" stroke="#fff" stroke-width="3"/>`}
      ${label ? pill(ex + (ex >= sx ? 1 : -1) * 34, y, label, ex >= sx ? 'start' : 'end', fs) : ''}
    </g>`;
    if (isLast) lastPath = { d, sx, ex, y };
  });


  // Ball at the current spot
  const ballX = losX ?? lastPath?.ex;
  const ballY = lastPath ? lastPath.y : 266;
  if (ballX != null) {
    g += `<g id="f-ball" transform="translate(${ballX} ${ballY})">
      ${st.live ? `<circle class="ball-glow" r="34" fill="url(#ballglow)"/>` : ''}
      <ellipse rx="20" ry="12.5" fill="#8a4a22" stroke="#fff" stroke-width="3"/>
      <path d="M-8 0h16M-5 -3.5v7M0 -3.5v7M5 -3.5v7" stroke="#fff" stroke-width="2.2"/></g>`;
  }
  ov.innerHTML = g;

  // Caption
  const offTeam = st.off === ev.home.id ? ev.home : st.off === ev.away.id ? ev.away : drTeam;
  if (st.live && st.dd) cap.innerHTML = `<span class="dd">${esc(st.dd.split(' at ')[0])}</span><span class="spot">${esc(offTeam.abbr)} ball${st.dd.includes(' at ') ? ' · ' + esc(st.dd.split(' at ')[1]) : ''}</span>${G.sum?.flat.length > 1 ? `<button class="ret rp-start">${ICON.play}Replay</button>` : ''}`;
  else if (G.cursor != null) cap.innerHTML = `<span class="dd">${st.dd ? 'Next: ' + esc(st.dd.split(' at ')[0]) : 'Replay'}</span><span class="spot">${esc(drTeam.abbr)} drive</span><button class="ret" id="f-live">${G.ev.state === 'in' ? 'Back to live' : 'Exit replay'}</button>`;
  else if (G.viewDrive != null && G.viewDrive !== G.sum.drives.length - 1) cap.innerHTML = `<span class="dd">${esc(dr.result || 'Drive')}</span><span class="spot">${esc(drTeam.abbr)} drive</span><button class="ret" id="f-live">${G.ev.state === 'in' ? 'Back to live' : 'Latest drive'}</button>`;
  else if (isHalftime(G.ev)) cap.innerHTML = `<span class="dd">Halftime</span><span class="spot">Last: ${esc(drTeam.abbr)} ${esc(dr.result || '')}</span>${G.sum?.flat.length > 1 ? `<button class="ret rp-start">${ICON.play}Replay</button>` : ''}`;
  else cap.innerHTML = `<span class="dd">${esc(st.live ? statusText(G.ev) : G.ev.state === 'post' ? statusText(G.ev) : dr.result || statusText(G.ev))}</span><span class="spot">${esc(drTeam.abbr)} ${st.live ? 'driving' : 'drive'}</span>${G.sum?.flat.length > 1 ? `<button class="ret rp-start">${ICON.play}Replay</button>` : ''}`;
  if (G.ev.state !== 'pre' && typeof fieldViewToggle === 'function') cap.insertAdjacentHTML('beforeend', fieldViewToggle());
  const back = $('#f-live');
  if (back) back.onclick = () => { stopReplay(); G.cursor = null; G.viewDrive = null; renderHero(); renderFieldView(true); renderLastPlay(); updateReplayBar(); renderTabBody(); };

  sumEl.innerHTML = `${logoImg(drTeam, 18, 'logo')}<span><b>${esc(drTeam.abbr)}</b> ${esc(driveDesc(dr))}</span>
    ${showLines ? '<span class="legend"><span><i style="background:#4aa3ff"></i>Scrimmage</span><span><i style="background:#ffd21f"></i>To gain</span></span>' : ''}`;

  if (animate && lastPath && st.anim && st.anim !== G.animatedId) { G.animatedId = st.anim; animateLast(); }
  else if (st.anim) G.animatedId = G.animatedId || st.anim;
}
function pill(x, y, text, anchor, fs) {
  const w = text.length * fs * 0.56 + fs * 0.8;
  const h = fs * 1.25;
  // Keep every label on the field of play, off the end zones.
  const rx = clamp(anchor === 'start' ? x : anchor === 'middle' ? x - w / 2 : x - w, 106, 1094 - w);
  return `<g><rect x="${rx}" y="${y - h / 2}" width="${w}" height="${h}" rx="${h / 2}" fill="#0b1510" fill-opacity="0.82"/>
    <text x="${rx + w / 2}" y="${y + 1}" text-anchor="middle" dominant-baseline="central" font-size="${fs}" font-weight="800" fill="#fff">${esc(text)}</text></g>`;
}
function animateLast() {
  const paths = [...document.querySelectorAll('#f-ov .play-path.last')];
  const ball = $('#f-ball');
  if (!paths.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const segs = paths.map((p) => ({ els: [p, p.previousElementSibling], p, len: p.getTotalLength(), dash: p.getAttribute('stroke-dasharray') }));
  const total = segs.reduce((a, g) => a + g.len, 0);
  segs.forEach((g) => g.els.forEach((el) => { el.style.strokeDasharray = `${g.len}`; el.style.strokeDashoffset = `${g.len}`; }));
  const t0 = performance.now(), dur = clamp(total * 1.6, 500, 1300) + (segs.length > 1 ? 500 : 0);
  const id = (G.animId = Math.random());
  const endT = ball?.getAttribute('transform');
  const step = (now) => {
    if (!G || G.animId !== id || !paths[0].isConnected) return;
    const t = clamp((now - t0) / dur, 0, 1);
    let dist = (1 - Math.pow(1 - t, 3)) * total;
    for (const g of segs) {
      const d = clamp(dist, 0, g.len);
      g.els.forEach((el) => { el.style.strokeDashoffset = `${g.len - d}`; });
      if (ball && dist > 0 && dist <= g.len + 0.01) { const pt = g.p.getPointAtLength(d); ball.setAttribute('transform', `translate(${pt.x} ${pt.y})`); }
      dist -= g.len;
    }
    if (t < 1) requestAnimationFrame(step);
    else {
      segs.forEach((g) => g.els.forEach((el, k) => { el.style.strokeDasharray = k === 0 ? g.dash || '' : el.getAttribute('stroke-dasharray') || ''; el.style.strokeDashoffset = ''; }));
      if (ball && endT) ball.setAttribute('transform', endT);
    }
  };
  requestAnimationFrame(step);
}

/* DOM updates that don't flicker */
// Rewrite an element only when its markup actually changed.
function setHTML(el, html) {
  if (!el || el._html === html) return false;
  el._html = html;
  el.innerHTML = html;
  return true;
}
// Rewrite a list, keeping every top-level child whose markup is unchanged (their images stay loaded)
// and swapping in only the new or changed ones.
function morphHTML(el, html) {
  if (!el || el._html === html) return;
  el._html = html;
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const pool = new Map();
  for (const n of el.childNodes) { const k = n.outerHTML ?? n.textContent; if (!pool.has(k)) pool.set(k, []); pool.get(k).push(n); }
  el.replaceChildren(...[...tmp.childNodes].map((n) => pool.get(n.outerHTML ?? n.textContent)?.shift() || n));
}

// A timeout logged right after a score is the TV break, not one a team called.
const isTimeout = (p) => /timeout/i.test(`${p?.typeText || p?.type?.text || ''} ${p?.text || ''}`);
const afterScore = (prev) => !!prev && (!!prev.scoring || /extra point|two[- ]point|conversion|kick attempt/i.test(`${prev.typeText || ''} ${prev.text || ''}`));
const isTVTimeout = (p, prev) => isTimeout(p) && afterScore(prev);

/* last play card */
const watchBtn = (id, kind) => (kind === 'meta' ? '' : `<button class="lp-watch" data-anim="${esc(id)}" aria-label="Watch this play animated">${ICON.play}Watch</button>`);
function renderLastPlay(flash) {
  const el = $('#lp');
  if (!el || !G.ev) return;
  const ev = G.ev;
  let p = null;
  if (G.cursor != null && G.sum) p = G.sum.flat[G.cursor]?.p;
  else if (G.sum) p = G.sum.flat[G.sum.flat.length - 1]?.p || null;
  const sl = ev.sit?.lastPlay;
  G.athByPlay ||= new Map();
  // The scoreboard can be a play ahead of the play-by-play. Both versions of a play render through
  // the same template, so when the play-by-play catches up the card doesn't jump.
  let v;
  if (G.cursor == null && sl?.text && (!p || quickIsNewer(sl.id, G.sum, ev.id))) {
    const q = quickPlay(ev) || { kind: playKind(sl), yards: sl.statYardage, penYards: 0 };
    const kind = playKind(sl);
    const prevP = G.sum?.flat.filter((f) => f.p.kind !== 'meta').pop()?.p;
    const same = prevP && prevP.endTeam === (sl.team?.id || q.offId);
    const ath = ['fg', 'kickoff', 'punt'].includes(kind) ? null : sl.athletesInvolved?.[0];
    if (ath) G.athByPlay.set(String(sl.id), ath);
    const tv = isTVTimeout(sl, G.sum?.flat[G.sum.flat.length - 1]?.p);
    v = { id: sl.id, kind, text: tv ? 'TV timeout' : sl.text, typeText: tv ? 'TV timeout' : sl.type?.text || '', period: ev.period, clock: '', sDD: same ? prevP.endDD : '', yards: sl.statYardage, penYards: q.penYards,
      team: sl.team?.id === ev.home.id ? ev.home : ev.away, ath, label: 'Last play' };
  } else if (p) {
    const isKick = ['fg', 'kickoff', 'punt'].includes(p.kind);
    const part = isKick ? p.parts.find((x) => /kicker|punter/i.test(x.type || '')) : p.parts.find((x) => x.athlete?.headshot?.href) || p.parts[0];
    v = { id: p.id, kind: p.kind, text: p.text, typeText: p.typeText, period: p.period, clock: p.clock, sDD: p.sDD ? `${p.sDD}${p.sPos ? ' at ' + p.sPos : ''}` : '', yards: p.yards, penYards: p.penYards,
      team: p.offId === ev.home.id ? ev.home : ev.away, ath: part?.athlete || G.athByPlay.get(String(p.id)),
      label: G.cursor != null ? 'Replay' : ev.state === 'post' ? 'Final play' : 'Last play' };
  }
  if (!v) { el.hidden = true; return; }
  el.hidden = false;
  const a = v.ath;
  const shot = a && (a.headshot?.href || (typeof a.headshot === 'string' ? a.headshot : ''));
  const pos = a ? (typeof a.position === 'string' ? a.position : a.position?.abbreviation || '') : '';
  const html = `<div class="lp-side">${shot ? `<img class="hs" src="${cdnImg(shot, 104, 76)}" alt="">` : logoImg(v.team, 52, 'hs logo-only')}${watchBtn(v.id, v.kind)}</div>
    <div><div class="k"><span>${v.label}</span><span>${periodLabel(v.period)}${v.clock ? ' ' + esc(v.clock) : ''}</span>${v.sDD ? `<span>${esc(v.sDD)}</span>` : `<span>${esc(v.typeText)}</span>`}${/two[- ]point/i.test(v.text + v.typeText) ? '' : ydBadge(v.yards, v.kind)}${penBadge(v.penYards)}</div>
    <div class="tx">${playHTML(v.text)}</div>
    ${a ? `<div class="who">${esc(a.shortName || a.displayName)}${pos ? ' · ' + esc(pos) : ''}${a.jersey ? ' #' + esc(a.jersey) : ''}</div>` : ''}
    ${typeof ffPlayExtra === 'function' ? ffPlayExtra(ev, v) || '' : ''}</div>`;
  if (setHTML(el, html)) clampLastPlay(el);
  if (flash && String(v.id) !== String(G.flashedId)) { el.classList.remove('fresh'); void el.offsetWidth; el.classList.add('fresh'); }
  G.flashedId = v.id;
}
// Long play text is clamped to three lines; a More button opens the rest.
function clampLastPlay(el) {
  const tx = el.querySelector('.tx');
  if (!tx || tx.scrollHeight <= tx.clientHeight + 2) return;
  const b = document.createElement('button');
  b.className = 'more';
  b.textContent = 'More';
  b.onclick = () => { const open = tx.classList.toggle('open'); b.textContent = open ? 'Less' : 'More'; };
  tx.after(b);
}

function currentWP() {
  const sum = G.sum;
  if (G.cursor != null && sum) {
    const id = sum.flat[G.cursor]?.p.id;
    const w = sum.wp.find((x) => x.playId === id);
    if (w) return w.homeWinPercentage;
  }
  const s = G.ev?.sit?.lastPlay?.probability?.homeWinPercentage;
  if (s != null && G.ev.state === 'in') return s;
  const last = sum?.wp?.[sum.wp.length - 1];
  return last ? last.homeWinPercentage : null;
}
function renderWPStrip() {
  const el = $('#wp-strip');
  if (!el) return;
  const p = currentWP();
  if (p == null || G.ev.state === 'pre') { el.hidden = true; return; }
  const pc = pair(G.ev.away, G.ev.home);
  const { h } = pc;
  el.hidden = false;
  if (G.ev.state === 'post' && G.cursor == null && G.sum?.wp?.length) {
    // A finished game is 100–0; the interesting number is how close the winner came to losing.
    const homeWon = (G.ev.home.score || 0) > (G.ev.away.score || 0);
    const w = homeWon ? G.ev.home : G.ev.away;
    const low = Math.min(...G.sum.wp.map((x) => (homeWon ? x.homeWinPercentage : 1 - x.homeWinPercentage)));
    const pct = Math.round(low * 100);
    setHTML(el, `<div class="lbl">Win probability</div><div class="note">${pct < 50 ? `<b>${esc(w.name)}</b> came back to win after dropping to <b>${pct}%</b>.` : `<b>${esc(w.name)}</b>’s chance to win never fell below <b>${pct}%</b>.`}</div>`);
    return;
  }
  const aw = Math.round((1 - p) * 100);
  setHTML(el, `<div class="lbl">Win probability</div><div class="row"><span>${esc(G.ev.away.abbr)} ${aw}%</span><div class="bar"><i style="width:${aw}%;background:${awayFill(pc)}"></i><i style="width:${100 - aw}%;background:${h}"></i></div><span>${100 - aw}% ${esc(G.ev.home.abbr)}</span></div>`);
}

/* replay */
function updateReplayBar() {
  const bar = $('#replay');
  if (!bar || !G.sum) return;
  const n = G.sum.flat.length;
  bar.hidden = n < 2 || (G.cursor == null && !G.playing);
  const r = $('#rp-range');
  r.max = String(n - 1);
  const i = G.cursor ?? n - 1;
  r.value = String(i);
  const p = G.sum.flat[i]?.p;
  $('#rp-lbl').textContent = p ? `${periodLabel(p.period)} ${p.clock}` : '';
  $('#rp-play').innerHTML = G.playing ? `${ICON.pause}<span>Pause</span>` : `${ICON.play}<span>Play</span>`;
  $('#rp-prev').disabled = i <= 0;
  $('#rp-next').disabled = i >= n - 1;
}
function setCursor(i) {
  if (!G?.sum) return;
  const n = G.sum.flat.length;
  G.cursor = clamp(i, 0, n - 1);
  G.viewDrive = null;
  renderHero();
  renderFieldView(true);
  renderLastPlay(true);
  renderWPStrip();
  updateReplayBar();
  // The Plays list follows along: open the drive being replayed.
  if (G.tab === 'plays') {
    const dr = G.sum.drives[G.sum.flat[G.cursor].di];
    G.replayOpened = G.replayOpened || new Set();
    for (const id of G.replayOpened) if (id !== dr?.id) { G.expanded.delete(id); G.replayOpened.delete(id); }
    if (dr && !G.expanded.has(dr.id)) { G.expanded.add(dr.id); G.replayOpened.add(dr.id); }
    clearTimeout(G.tabT);
    G.tabT = setTimeout(() => {
      renderTabBody();
      // Follow along only if the list is what the viewer is looking at (tabs stuck to the top).
      if ($('#tabs').getBoundingClientRect().top < 120) $('#tab-body .drive.viewing')?.scrollIntoView({ block: 'nearest' });
    }, 250);
  }
}
function toggleReplay() {
  if (G.playing) { stopReplay(); updateReplayBar(); return; }
  const n = G.sum.flat.length;
  if (G.cursor == null || G.cursor >= n - 1) setCursor(0);
  G.playing = true;
  updateReplayBar();
  const step = () => {
    if (!G || !G.playing) return;
    const next = G.cursor + 1;
    if (next >= G.sum.flat.length) {
      stopReplay();
      if (G.ev.state === 'in') { G.cursor = null; renderHero(); renderFieldView(true); renderLastPlay(); renderWPStrip(); }
      updateReplayBar();
      return;
    }
    setCursor(next);
    const p = G.sum.flat[next].p;
    if (p.scoring && /touchdown/i.test(p.typeText)) {
      const prev = prevScoreFor(G.sum, p);
      celebrate(p.home > prev.home ? G.ev.home : G.ev.away, 'Touchdown', `${G.ev.away.abbr} ${p.away} – ${G.ev.home.abbr} ${p.home}`);
      G.replayTimer = setTimeout(step, 3000 / G.speed);
    } else G.replayTimer = setTimeout(step, 1300 / G.speed);
  };
  G.replayTimer = setTimeout(step, 1300 / G.speed);
}
function stopReplay() {
  if (!G) return;
  G.playing = false;
  clearTimeout(G.replayTimer);
}

/* tabs */
function renderTabs() {
  const avail = TABS.filter(([k]) => {
    if (k === 'fantasy') return typeof ffTabFantasy === 'function';
    if (G.ev?.state === 'pre') return k === 'info';
    if (k === 'moments') return (G.sum?.wp?.length || 0) > 1 || (G.sum?.raw.videos || []).length > 0;
    return true;
  });
  if (!avail.some(([k]) => k === G.tab)) G.tab = avail[0][0];
  const el = $('#tabs');
  el.hidden = avail.length < 2;
  el.innerHTML = avail.map(([k, l]) => `<button class="tab" role="tab" id="tab-${k}" data-tab="${k}" aria-controls="tab-body" aria-selected="${G.tab === k}" tabindex="${G.tab === k ? 0 : -1}">${l}</button>`).join('');
  $('#tab-body')?.setAttribute('aria-labelledby', 'tab-' + G.tab);
  const pick = (b) => {
    G.tab = b.dataset.tab;
    renderTabBody();
    const nb = $(`#tab-${G.tab}`);
    nb?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    return nb;
  };
  el.onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) pick(b); };
  el.onkeydown = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const tabs = [...el.querySelectorAll('.tab')];
    const i = tabs.findIndex((t) => t.dataset.tab === G.tab);
    const nb = pick(tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]);
    nb?.focus();
    e.preventDefault();
  };
}
function renderTabBody() {
  const el = $('#tab-body');
  if (!el || !G.sum) return;
  renderTabs();
  const fn = { fantasy: () => (typeof ffTabFantasy === 'function' ? ffTabFantasy(G.ev) : ''), plays: tabPlays, scoring: tabScoring, stats: tabStats, players: tabPlayers, moments: tabMoments, info: tabInfo }[G.tab] || tabInfo;
  morphHTML(el, fn());
  if (typeof ffAfterRender === 'function') ffAfterRender();
}

function tabPlays() {
  const { drives } = G.sum;
  const ev = G.ev;
  if (!drives.length) return '<div class="empty">No plays yet.</div>';
  const last = drives.length - 1;
  if (!G.expanded.size && !G._autoExpanded) { G.expanded.add(drives[last].id); G._autoExpanded = true; }
  const allRaw = drives.flatMap((d) => d.plays);
  const prevOf = new Map(allRaw.map((p, i) => [p.id, allRaw[i - 1]]));
  return [...drives].map((dr, di) => ({ dr, di })).reverse().map(({ dr, di }) => {
    const t = dr.teamId === ev.home.id ? ev.home : ev.away;
    const lastP = [...dr.plays].reverse().find((p) => p.home != null);
    const open = G.expanded.has(dr.id);
    const res = dr.live ? 'Driving' : ev.state === 'post' && di === last && (!dr.result || /end of (quarter|half|game)/i.test(dr.result)) ? 'Final' : dr.result || '—';
    const resCls = dr.isScore ? 'scored' : /interception|fumble|downs|turnover/i.test(res) ? 'to' : '';
    const cursorDi = G.cursor != null ? G.sum.flat[G.cursor]?.di : null;
    const viewing = cursorDi != null ? cursorDi === di : G.viewDrive === di || (G.viewDrive == null && di === last);
    const plays = open ? [...dr.plays].reverse().map((p) => {
      const cls = p.kind === 'meta' ? 'meta-play' : p.scoring ? 'scoring' : p.turnover ? 'turnover' : '';
      const tv = isTVTimeout(p, prevOf.get(p.id));
      return `<div class="play ${cls}"><div class="pd">${p.kind === 'meta' ? '' : esc(p.sDD || '')}<small>${periodLabel(p.period)} ${esc(p.clock)}</small></div>
        <div class="pt"><b>${esc(tv ? 'TV timeout' : p.typeText)}</b>${tv ? 'Commercial break after the score' : playHTML(p.text)}</div><div class="ydc">${p.kind === 'meta' ? '' : ydBadge(p.yards, p.kind) + penBadge(p.penYards) + `<button class="pl-anim" data-anim="${esc(p.id)}" aria-label="Watch this play animated">${ICON.play}</button>`}</div>${typeof ffPlayExtra === 'function' ? ffPlayExtra(ev, p) || '' : ''}</div>`;
    }).join('') : '';
    return `<div class="drive${dr.live ? ' cur' : ''}${viewing && open ? ' viewing' : ''}">
      <button class="drive-h" data-drive="${esc(dr.id)}" aria-expanded="${open}">
        ${logoImg(t, 26)}
        <div><div class="res ${resCls}">${esc(res)}</div><div class="ds">${esc(t.abbr)} · ${esc(driveDesc(dr))}</div></div>
        <div class="sc">${lastP ? `${lastP.away}–${lastP.home}` : ''}<small>${esc(periodLabel(dr.plays[0].period))} ${esc(dr.plays[0].clock)}</small></div>
      </button>
      ${open ? `<div class="drive-plays">${plays}</div><button class="drive-more" data-show="${di}">Show this drive on the field</button>` : ''}
    </div>`;
  }).join('');
}
document.addEventListener('click', (e) => {
  if (!G) return;
  const h = e.target.closest('[data-drive]');
  if (h) {
    const id = h.dataset.drive;
    if (G.expanded.has(id)) G.expanded.delete(id); else G.expanded.add(id);
    renderTabBody();
    return;
  }
  const s = e.target.closest('[data-show]');
  if (s) {
    stopReplay();
    G.cursor = null;
    G.viewDrive = +s.dataset.show;
    renderHero();
    renderFieldView(true);
    renderLastPlay();
    renderWPStrip();
    updateReplayBar();
    renderTabBody();
    $('.field-sec').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#game-view').scrollBy({ top: -60 });
  }
});

function linescoreHTML(ev) {
  const { away: A, home: H } = ev;
  if (!A.lines.length && !H.lines.length) return '';
  const n = Math.max(4, A.lines.length, H.lines.length);
  return `<div class="box ls-box"><table class="linescore"><thead><tr><th></th>${Array.from({ length: n }, (_, i) => `<th>${i < 4 ? i + 1 : periodLabel(i + 1)}</th>`).join('')}<th>T</th></tr></thead><tbody>
    ${[A, H].map((t) => `<tr><td><span class="tn">${logoImg(t, 18)}${esc(t.abbr)}</span></td>${Array.from({ length: n }, (_, i) => `<td>${t.lines[i] ?? (ev.state === 'post' ? '' : '–')}</td>`).join('')}<td class="t">${t.score ?? ''}</td></tr>`).join('')}
  </tbody></table></div>`;
}
function tabScoring() {
  const ev = G.ev;
  const sps = G.sum.raw.scoringPlays || [];
  if (!sps.length) return linescoreHTML(ev) + '<div class="empty">No scoring yet.</div>';
  let out = '', per = null;
  for (const sp of sps) {
    const pn = sp.period?.number;
    if (pn !== per) { out += `<div class="box-t">${pn <= 4 ? ordinal(pn) + ' quarter' : periodLabel(pn)}</div>`; per = pn; }
    const t = sp.team?.id === ev.home.id ? ev.home : ev.away;
    out += `<div class="sp">${logoImg(t, 26)}<div class="t"><b>${esc(sp.type?.text || sp.scoringType?.displayName || '')} · ${esc(sp.clock?.displayValue || '')}</b>${playHTML(sp.text)}</div><div class="s">${sp.awayScore}–${sp.homeScore}</div></div>`;
  }
  return `${linescoreHTML(ev)}<div class="box scsum" style="padding-bottom:8px">${out}</div>`;
}

const LOWER_BETTER = new Set(['turnovers', 'fumblesLost', 'interceptions', 'totalPenaltiesYards']);
function statNum(name, dv) {
  if (dv == null) return null;
  dv = String(dv).trim();
  if (name === 'possessionTime') { const [m, s] = dv.split(':'); return +m * 60 + +s; }
  if (/Eff$/.test(name)) { const [a, b] = dv.split('-').map(Number); return b ? a / b : 0; }
  if (name === 'completionAttempts') { const [a, b] = dv.split('/').map(Number); return b ? a / b : 0; }
  if (name === 'totalPenaltiesYards') return +dv.split('-')[1] || 0;
  const n = parseFloat(dv);
  return isNaN(n) ? null : n;
}
function tabStats() {
  const ev = G.ev;
  const teams = G.sum.raw.boxscore?.teams || [];
  const A = teams.find((t) => t.homeAway === 'away') || teams[0];
  const H = teams.find((t) => t.homeAway === 'home') || teams[1];
  if (!A?.statistics?.length || !H?.statistics?.length) return '<div class="empty">Team stats appear after kickoff.</div>';
  const pcs = pair(ev.away, ev.home);
  const ch = pcs.h, ca = awayFill(pcs);
  const hm = new Map(H.statistics.map((s) => [s.name, s]));
  const rows = A.statistics.map((sa) => {
    const sh = hm.get(sa.name);
    if (!sh) return '';
    const va = statNum(sa.name, sa.displayValue), vh = statNum(sa.name, sh.displayValue);
    let wa = 0, wh = 0, lead = 0;
    if (va != null && vh != null && va + vh > 0) {
      const tot = Math.max(va, vh);
      wa = (va / tot) * 100; wh = (vh / tot) * 100;
      lead = va === vh ? 0 : (va > vh) !== LOWER_BETTER.has(sa.name) ? -1 : 1;
    }
    return `<div class="srow"><div class="v"><span class="a ${lead > 0 ? 'dim' : ''}">${esc(sa.displayValue)}</span><span class="l">${esc(sa.label)}</span><span class="h ${lead < 0 ? 'dim' : ''}">${esc(sh.displayValue)}</span></div>
      <div class="bars"><div><i style="width:${wa}%;background:${ca}"></i></div><div><i style="width:${wh}%;background:${ch}"></i></div></div></div>`;
  }).join('');
  return `<div class="box"><div class="stat-head" style="padding-top:12px">
    <div>${logoImg(ev.away, 26)}${esc(ev.away.abbr)}</div><div>${esc(ev.home.abbr)}${logoImg(ev.home, 26)}</div></div>${rows}</div>`;
}
function tabPlayers() {
  const ev = G.ev;
  const players = G.sum.raw.boxscore?.players || [];
  if (!players.length) return '<div class="empty">Player stats appear after kickoff.</div>';
  const side = G.side === 'home' ? ev.home : ev.away;
  const blk = players.find((p) => p.team?.id === side.id) || players[0];
  const seg = `<div class="seg" role="group">${[ev.away, ev.home].map((t, i) => `<button data-side="${i ? 'home' : 'away'}" aria-pressed="${t.id === side.id}">${logoImg(t, 18)}${esc(t.abbr)}</button>`).join('')}</div>`;
  const cats = (blk.statistics || []).filter((c) => c.athletes?.length).map((c) => {
    const head = `<tr><th>${esc((c.text || c.name).replace(side.name + ' ', '').replace(side.loc + ' ', ''))}</th>${c.labels.map((l) => `<th>${esc(l)}</th>`).join('')}</tr>`;
    const ath = c.athletes.filter((a) => a.athlete && !String(a.athlete.id || '').startsWith('-') && !/^team$/i.test((a.athlete.displayName || a.athlete.shortName || '').trim()));
    if (!ath.length) return '';
    const body = ath.map((a) => `<tr><td><span class="pn">${a.athlete.headshot?.href ? `<img src="${cdnImg(a.athlete.headshot.href, 56, 42)}" alt="" loading="lazy">` : ''}<span>${esc(a.athlete.shortName || a.athlete.displayName || '')}${a.athlete.jersey ? ` <small>#${esc(a.athlete.jersey)}</small>` : ''}</span></span></td>${a.stats.map((s) => `<td>${esc(s)}</td>`).join('')}</tr>`).join('');
    const tot = c.totals?.length ? `<tr class="tot"><td><span class="pn">Team total</span></td>${c.totals.map((s) => `<td>${esc(s)}</td>`).join('')}</tr>` : '';
    return `<div class="pcat"><div class="tscroll"><table class="ptable"><thead>${head}</thead><tbody>${body}${tot}</tbody></table></div></div>`;
  }).join('');
  return seg + cats;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-side]');
  if (!b || !G) return;
  G.side = b.dataset.side;
  renderTabBody();
});

function tabWP(moms = []) {
  const ev = G.ev, sum = G.sum;
  const wp = sum.wp;
  if (wp.length < 2) return '<div class="empty">Win probability appears once the game is underway.</div>';
  const { a: ca, h: ch } = pair(ev.away, ev.home);
  const W = 600, H = 220, mid = H / 2;
  const n = wp.length;
  const X = (i) => (i / (n - 1)) * W;
  const Y = (p) => (1 - p) * H;
  let line = '';
  wp.forEach((w, i) => { line += `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(w.homeWinPercentage).toFixed(1)}`; });
  const area = `${line}L${W} ${mid}L0 ${mid}Z`;
  // Quarter breaks + scoring moments
  let marks = '', per = null, dots = '';
  wp.forEach((w, i) => {
    const p = sum.byId.get(w.playId);
    if (!p) return;
    if (per != null && p.period !== per && p.period) marks += `<line x1="${X(i)}" x2="${X(i)}" y1="0" y2="${H}" stroke="currentColor" stroke-opacity="0.18" stroke-dasharray="3 4"/><text x="${X(i)}" y="${H + 24}" text-anchor="middle" font-size="24">${periodLabel(p.period)}</text>`;
    if (p.period) per = p.period;
    if (p.scoring) {
      const prev = prevScoreFor(sum, p);
      const c = p.home > prev.home ? ch : ca;
      dots += `<circle cx="${X(i)}" cy="${Y(w.homeWinPercentage)}" r="4" fill="${c}" stroke="var(--surface)" stroke-width="2"/>`;
    }
  });
  const lastP = wp[n - 1].homeWinPercentage;
  const cur = currentWP() ?? lastP;
  const curI = G.cursor != null ? Math.max(0, wp.findIndex((w) => w.playId === sum.flat[G.cursor]?.p.id)) : n - 1;
  const aw = Math.round((1 - cur) * 100);
  return `<div class="wpc">
    <div class="now"><div>${logoImg(ev.away, 28)}${aw}%<small>${esc(ev.away.abbr)}</small></div><div><small>${esc(ev.home.abbr)}</small>${100 - aw}%${logoImg(ev.home, 28)}</div></div>
    <svg viewBox="-4 -34 ${W + 8} ${H + 72}" style="color:var(--ink)" role="img" aria-label="Win probability over the game">
      <defs><clipPath id="wtop"><rect x="-4" y="0" width="${W + 8}" height="${mid}"/></clipPath><clipPath id="wbot"><rect x="-4" y="${mid}" width="${W + 8}" height="${mid}"/></clipPath></defs>
      <rect x="0" y="0" width="${W}" height="${H}" fill="currentColor" fill-opacity="0.03" rx="4"/>
      <path d="${area}" fill="${ch}" fill-opacity="0.45" clip-path="url(#wtop)"/>
      <path d="${area}" fill="${ca}" fill-opacity="0.45" clip-path="url(#wbot)"/>
      <line x1="0" x2="${W}" y1="${mid}" y2="${mid}" stroke="currentColor" stroke-opacity="0.35" stroke-dasharray="2 4"/>
      ${marks}
      <path d="${line}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
      ${dots}
      ${moms.map((m, k) => { const i = wp.findIndex((w) => w.playId === m.p.id); return i < 0 ? '' : `<g><circle cx="${X(i)}" cy="${Y(wp[i].homeWinPercentage)}" r="13" style="fill:var(--ink)"/><text x="${X(i)}" y="${Y(wp[i].homeWinPercentage) + 1}" text-anchor="middle" dominant-baseline="central" font-size="16" style="fill:var(--surface);font-weight:800">${k + 1}</text></g>`; }).join('')}
      <circle cx="${X(curI)}" cy="${Y(wp[curI].homeWinPercentage)}" r="6" fill="var(--pylon)" stroke="var(--surface)" stroke-width="2.5"/>
      <text x="0" y="-10" font-size="24">${esc(ev.home.abbr)} 100%</text>
      <text x="0" y="${H + 24}" font-size="24">Kickoff</text>
      <text x="${W}" y="${H + 24}" text-anchor="end" font-size="24">${ev.state === 'post' ? 'Final' : 'Now'}</text>
      <text x="6" y="${H - 10}" font-size="24">${esc(ev.away.abbr)} 100%</text>
      <text x="6" y="${mid - 8}" font-size="22" fill-opacity="0.75">50%</text>
    </svg>
    <div class="cap">Above the middle line ${esc(ev.home.name)} is favored, below it ${esc(ev.away.name)}. Dots mark scores.</div>
  </div>`;
}
function tabInfo() {
  const ev = G.ev;
  const d = G.sum.raw;
  const gi = d.gameInfo || {};
  const v = gi.venue || {};
  const w = gi.weather;
  const img = v.images?.find((i) => (i.rel || []).includes('day'))?.href;
  const kv = (k, val) => (val ? `<div class="kv"><span>${esc(k)}</span><span>${esc(val)}</span></div>` : '');
  const pc = d.pickcenter?.[0];
  let pred = '';
  const pr = d.predictor;
  if (pr?.homeTeam?.gameProjection && pr?.awayTeam?.gameProjection) {
    pred = `<div class="box-t">ESPN matchup predictor</div><div class="pred">
      <div>${logoImg(ev.away, 30)}<b>${Math.round(+pr.awayTeam.gameProjection)}%</b><small>${esc(ev.away.name)} win chance</small></div>
      <div>${logoImg(ev.home, 30)}<b>${Math.round(+pr.homeTeam.gameProjection)}%</b><small>${esc(ev.home.name)} win chance</small></div></div>`;
  }
  let leaders = '';
  if (ev.state === 'pre' && d.leaders?.length) {
    leaders = `<div class="box-t">Season leaders</div><div class="box">` + d.leaders.map((tl) => {
      const t = tl.team?.id === ev.home.id ? ev.home : ev.away;
      return (tl.leaders || []).map((cat) => {
        const l = cat.leaders?.[0];
        if (!l) return '';
        return `<div class="kv"><span>${esc(t.abbr)} · ${esc(cat.displayName)}</span><span>${esc(l.athlete?.shortName || l.athlete?.displayName || '')} <small style="color:var(--muted);font-weight:500">${esc(l.displayValue)}</small></span></div>`;
      }).join('');
    }).join('') + `</div>`;
  }
  const bc = ev.tv || (d.broadcasts || []).map((b) => b.media?.shortName).filter(Boolean).join(', ');
  return `${pred}
    ${img ? `<img class="venue-img" src="${cdnImg(img, 900, 450)}" alt="${esc(v.fullName || '')}" loading="lazy">` : ''}
    <div class="box">
      ${kv('Stadium', v.fullName || ev.venue)}
      ${kv('Location', [v.address?.city, v.address?.state].filter(Boolean).join(', ') || ev.city)}
      ${kv('Surface', v.grass === true ? 'Grass' : v.grass === false ? 'Artificial turf' : '')}
      ${kv('Kickoff', ev.timeValid ? ev.date.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'TBD')}
      ${kv('TV', bc)}
      ${w ? kv('Weather', [w.temperature != null ? `${w.temperature}°F` : '', w.displayValue || (w.conditionId && isNaN(+w.conditionId) ? w.conditionId : ''), w.gust ? `gusts ${w.gust} mph` : ''].filter(Boolean).join(', ')) : ''}
      ${kv('Attendance', gi.attendance ? gi.attendance.toLocaleString() : '')}
      ${pc ? kv('Line', `${pc.details || ''}${pc.overUnder ? ` · O/U ${pc.overUnder}` : ''}`) : ev.odds?.details ? kv('Line', `${ev.odds.details}${ev.odds.ou ? ` · O/U ${ev.odds.ou}` : ''}`) : ''}
      ${ev.note ? kv('Note', ev.note) : ''}
    </div>${leaders}`;
}

/* keep the screen on while watching a live game */
async function requestWake() {
  try { if (G && 'wakeLock' in navigator && !document.hidden) G.wake = await navigator.wakeLock.request('screen'); } catch {}
}
function releaseWake() { try { G?.wake?.release(); } catch {} }

/* ───────────── week picker ───────────── */
function pickWeek(w) {
  S.weekPicked = true;
  const isCur = S.cur && w.st === S.cur.st && w.wk === S.cur.wk;
  S.week = isCur ? null : { st: w.st, wk: w.wk };
  S.loaded = false;
  S.prevScores.clear();
  renderBoard();
  boardPoller.stop();
  boardPoller.start();
}
function stepWeek(d) {
  const w = S.week || S.cur;
  const i = S.calendar.findIndex((c) => c.st === w?.st && c.wk === w?.wk);
  const n = S.calendar[i + d];
  if (n) pickWeek(n);
}
function openWeekSheet() {
  if (!S.calendar.length) return;
  const sh = $('#week-sheet');
  const w = S.week || S.cur;
  let group = null, html = '';
  for (const c of S.calendar) {
    if (c.group !== group) { html += `<h5>${esc(c.group)}</h5>`; group = c.group; }
    const isSel = w && c.st === w.st && c.wk === w.wk;
    const isCur = S.cur && c.st === S.cur.st && c.wk === S.cur.wk;
    html += `<button class="wk" data-st="${c.st}" data-wk="${c.wk}" aria-current="${isSel}"><span>${esc(c.label)}${isCur ? '<span class="cur">This week</span>' : ''}</span><small>${esc(c.detail || '')}</small></button>`;
  }
  sh.innerHTML = `<div class="sheet-in" role="dialog" aria-modal="true" aria-labelledby="wk-title"><div class="sheet-hd"><h4 id="wk-title">Choose week</h4><button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div>${html}</div>`;
  sh.hidden = false;
  const curB = sh.querySelector('[aria-current="true"]');
  curB?.scrollIntoView({ block: 'center' });
  (curB || sh.querySelector('[data-close]')).focus({ preventScroll: true });
  S.sheetReturn = $('#week-label');
  S.sheetReturnSel = '#week-label';
}
$('#week-sheet').addEventListener('click', (e) => {
  const b = e.target.closest('.wk');
  const sh = $('#week-sheet');
  const cf = e.target.closest('[data-pick-f]');
  if (cf) { S.sheetReturn = null; setFilter(cf.dataset.pickF); closeWeekSheet('#chips [data-conf]'); return; }
  if (b) { pickWeek({ st: +b.dataset.st, wk: +b.dataset.wk }); closeWeekSheet(); }
  else if (e.target === sh || e.target.closest('[data-close]')) closeWeekSheet();
});
function closeWeekSheet(sel) {
  $('#week-sheet').hidden = true;
  const back = sel ? $(sel) : S.sheetReturn && S.sheetReturn.isConnected ? S.sheetReturn : $(S.sheetReturnSel || '#week-label');
  back?.focus({ preventScroll: true });
  S.sheetReturn = null;
}
// Keep Tab inside the open sheet.
$('#week-sheet').addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const f = [...$('#week-sheet').querySelectorAll('button')];
  const i = f.indexOf(document.activeElement);
  if (e.shiftKey && i <= 0) { f[f.length - 1].focus(); e.preventDefault(); }
  else if (!e.shiftKey && i === f.length - 1) { f[0].focus(); e.preventDefault(); }
});

/* ───────────── wiring ───────────── */
function openConfSheet() {
  const sh = $('#week-sheet');
  const rows = FILTERS.filter((f) => !MAIN_FILTERS.includes(f.id)).map((f) => {
    const list = filterEvents(S.events, f.id);
    const live = list.filter((e) => e.state === 'in').length;
    return `<button class="wk" data-pick-f="${f.id}" aria-current="${S.filter === f.id}"><span>${esc(f.label)}${live ? `<span class="cur">${live} live</span>` : ''}</span><small>${list.length} game${list.length === 1 ? '' : 's'}</small></button>`;
  }).join('');
  sh.innerHTML = `<div class="sheet-in" role="dialog" aria-modal="true" aria-labelledby="sh-title"><div class="sheet-hd"><h4 id="sh-title">Division</h4><button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div>${rows}</div>`;
  sh.hidden = false;
  S.sheetReturn = $('#chips [data-conf]');
  S.sheetReturnSel = '#chips [data-conf]';
  (sh.querySelector('[aria-current="true"]') || sh.querySelector('[data-close]')).focus({ preventScroll: true });
}
function setFilter(f) {
  S.filter = f;
  store.set('filter', f);
  renderBoard();
  const b = $(`#chips [data-f="${f}"]`) || $('#chips [data-conf]');
  b?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
}
$('#chips')?.addEventListener('click', (e) => {
  if (e.target.closest('[data-conf]')) { openConfSheet(); return; }
  const b = e.target.closest('[data-f]');
  if (!b) return;
  S.filter = b.dataset.f;
  store.set('filter', S.filter);
  renderBoard();
  b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
});
$('#sync').addEventListener('click', () => boardPoller.now());
$('#board').addEventListener('click', (e) => {
  if (e.target.closest('[data-retry]')) { S.error = null; renderBoard(); boardPoller.stop(); boardPoller.start(); return; }
  const g = e.target.closest('[data-goto]');
  if (g) { S.filter = g.dataset.goto; store.set('filter', S.filter); renderBoard(); ($(`#chips [data-f="${S.filter}"]`) || $('#chips [data-conf]'))?.scrollIntoView({ inline: 'center', block: 'nearest' }); }
});
$('#week-prev').addEventListener('click', () => stepWeek(-1));
// The game view's own week buttons and settings (the board's header is hidden under it).
document.addEventListener('click', (e) => {
  const w = e.target.closest('[data-gvweek]');
  if (w) { if (w.dataset.gvweek === 'pick') { openWeekSheet(); S.sheetReturn = w; S.sheetReturnSel = '#' + w.id; } else stepWeek(+w.dataset.gvweek); return; }
  const set = e.target.closest('#gv-settings, #gh-settings');
  if (set && typeof openSettings === 'function') { openSettings(); S.sheetReturn = set; S.sheetReturnSel = '#' + set.id; }
});
$('#week-next').addEventListener('click', () => stepWeek(1));
$('#week-label').addEventListener('click', openWeekSheet);
window.addEventListener('hashchange', () => { cameFromBoard = true; route(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    boardPoller.stop();
    G?.evPoller.stop();
    G?.sumPoller.stop();
  } else {
    // Back in front: show where the game is now rather than replaying what was missed.
    if (G) { if (G.gate) gateOpen(); if (typeof sideArrive === 'function') sideArrive(); G.evPoller.start(); G.sumPoller.start(); requestWake(); } else boardPoller.start();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('#week-sheet').hidden) closeWeekSheet();
    else if (T) goBack();                               // (a game has nowhere to go back to: it is the page)
  }
});

applyTheme();
renderBoard();
boardPoller.start();
// route() runs at the end of features.js, which defines the pages and team view.
// No service worker: Sunday has no push alerts and no offline cache (see docs/tooling.md house rules).
