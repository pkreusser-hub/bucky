'use strict';
/* sd-ffui.js — Sunday's fantasy layer: everything on screen that comes from GFFL.
   sd-fantasy.js is the engine (league data in, points out, no markup). This file turns those
   numbers into the page: it implements the ff* hooks sd-app.js calls (see the hook list at the
   top of sd-app.js), keeps box scores fresh for every game with a GFFL starter in it, pulls
   ESPN's core-API plays for the open game so each play can show who it scored for, and toasts
   the swings in your matchup.

   Needs from sd-app.js (shared global scope): $, esc, store, getJSON, API, S, G, isDark, cdist,
   onColor, logoImg, toast, renderBoard, renderTabBody, renderLastPlay, fmtTime, fmtDay.
   Load order: sd-app.js, sd-features.js, sd-fantasy.js, sd-ffui.js, sd-reenact.js. */

const FFUI = {
  ok: typeof FF !== 'undefined',
  loading: false,
  loaded: false,
  err: null,
  box: new Map(),      // eventId -> {t, state} of the last box-score pull
  core: new Map(),     // eventId -> {busy, t, n, text: Map(playId -> text)}
  prev: new Map(),     // roster key -> points at the last swing check (toast baseline)
  renderTimer: null,
  pollTimer: null,
};
const FF_SLOTS = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'DST', 'K'];
const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events';

/* ───────────── small helpers ───────────── */
const ffPts = (n) => (n == null ? '–' : String(Number((+n).toFixed(2))));
const ffTotal = (n) => (n == null ? '–' : (+n).toFixed(2));
const ffShort = (name) => {
  const s = String(name || '');
  if (/D\/ST$/.test(s)) return s;
  const parts = s.split(' ');
  return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : s;
};
const ffIsStarter = (p) => !['BENCH', 'IR'].includes(p.slot);
const ffTeam = (id) => (FFUI.ok ? FF.teams.get(id) : null);

// A GFFL team's accent, readable on the current page background. Team colours are the family's
// own picks (Laws Rule is white-first, a couple are near-black), so walk primary → secondary →
// tertiary and take the first that stands off the card surface.
function ffColor(id) {
  const c = ffTeam(id)?.colors || {};
  const bg = isDark() ? '#151b26' : '#ffffff';
  for (const x of [c.primary, c.secondary, c.tertiary]) {
    if (x && /^#[0-9a-f]{6}$/i.test(x) && cdist(x, bg) > 110) return x;
  }
  return isDark() ? '#8a94a7' : '#5b6579';
}
function ffCrest(id, px = 28) {
  const t = ffTeam(id);
  if (!t) return '';
  const col = ffColor(id);
  const img = t.logo ? `<img src="${esc(t.logo)}" alt="" width="${px}" height="${px}" loading="lazy" onerror="this.remove()">` : '';
  // A transparent PNG sits straight on the team colour, uncropped (GFFL's isCutoutLogo rule).
  const cut = /^data:image\/png/i.test(t.logo || '') || /\.png(\?|#|$)/i.test(t.logo || '');
  // The monogram under the picture scales with the crest so a 16px chip crest still fits "KREU".
  const fs = Math.max(6, Math.round(px * 0.34));
  return `<span class="ff-crest${cut ? ' cutout' : ''}" role="img" aria-label="${esc(t.name)}" title="${esc(t.name)}" style="--c:${col};--ci:${onColor(col)};width:${px}px;height:${px}px;font-size:${fs}px"><span aria-hidden="true">${esc((t.abbrev || t.name || '?').slice(0, 4))}</span>${img}</span>`;
}
// Who owns a player, shown as the owner's GFFL crest rather than the team's name (2026-09-27,
// user: "use the gffl logos in place of team names when it shows GFFL starters/benches").
// A bench player keeps a small BN marker beside the crest; your own team's crest gets a ring.
function ffTag(id, bench, px = 24) {
  if (!ffTeam(id)) return '';
  return `<span class="ff-own${id === FF.myTeamId ? ' me' : ''}">${ffCrest(id, px)}${bench ? '<span class="ff-bn">BN</span>' : ''}</span>`;
}
function ffHeadshot(key, ev, nfl) {
  if (String(key).startsWith('dst_')) {
    const t = ev && [ev.home, ev.away].find((x) => FF.slpTeam(x.abbr) === FF.slpTeam(nfl || key.slice(4)));
    return t ? logoImg(t, 32, 'ff-hs logo') : '<span class="ff-hs"></span>';
  }
  if (!/^\d+$/.test(String(key))) return '<span class="ff-hs"></span>';
  return `<img class="ff-hs" src="https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/${key}.png&w=96&h=70" alt="" width="44" height="32" loading="lazy" onerror="this.style.visibility='hidden'">`;
}
// The board's NFL event for a roster player's NFL team, if that team plays this week.
function ffEventFor(nfl) {
  if (!nfl || !S.events) return null;
  const ab = FF.slpTeam(nfl);
  return S.events.find((e) => FF.slpTeam(e.home.abbr) === ab || FF.slpTeam(e.away.abbr) === ab) || null;
}
function ffNflTeam(nfl) {
  const ev = ffEventFor(nfl);
  if (!ev) return null;
  return FF.slpTeam(ev.home.abbr) === FF.slpTeam(nfl) ? ev.home : ev.away;
}
// Which league week the board is showing, in GFFL terms: regular-season NFL week N is league
// week N (the league's Tuesday-to-Tuesday weeks line up with the NFL's). Preseason and the NFL
// postseason have no GFFL games.
function ffBoardWeek() {
  const w = S.week || S.cur;
  if (!w || w.st !== 2) return null;
  return w.wk;
}
// Every GFFL starter (all 8 teams) whose NFL team is in this event.
function ffStartersIn(ev) {
  const out = [];
  if (!FFUI.loaded) return out;
  const abs = [FF.slpTeam(ev.home.abbr), FF.slpTeam(ev.away.abbr)];
  for (const [teamId, players] of FF.rostersByTeamId) {
    for (const p of players) {
      if (!ffIsStarter(p) || !p.team || !abs.includes(FF.slpTeam(p.team))) continue;
      out.push({ ...p, teamId, pts: FF._pointsForKey(p.key) });
    }
  }
  return out;
}
const ffSide = (teamId) => (!FF.myMatchup ? 'other' : teamId === FF.myMatchup.me ? 'me' : teamId === FF.myMatchup.opp ? 'opp' : 'other');

/* ───────────── loading + polling ───────────── */
async function ffLoad(week) {
  if (!FFUI.ok || FFUI.loading) return;
  FFUI.loading = true;
  FFUI.err = null;
  try {
    let teamId;
    try { const q = new URLSearchParams(location.search).get('team'); if (q) teamId = +q; } catch {}
    if (teamId == null) { const t = store.get('team', null); if (t != null) teamId = +t; }
    await FF.load({ week, teamId });
    FFUI.loaded = true;
    FFUI.box.clear();
    FFUI.core.clear();
    FFUI.prev.clear();
    if (S.loaded && ffBoardWeek() === FF.week) FF.ingestBoard(S.events);
    // A game opened straight from a link (#g…) fetched its summary before the league finished
    // loading, and FF.load clears every ingested game anyway: feed the open game in again, or a
    // final game (whose summary never re-polls) would show zeros for good.
    if (G && G.sum?.raw && G.ev) ffOnSummary(G.ev, G.sum.raw);
    ffPollBoxes(true);
  } catch (e) {
    FFUI.err = e;
    console.warn('GFFL load failed', e);
  } finally {
    FFUI.loading = false;
    ffRefresh();
  }
}

// Box scores for every started/finished game that has a GFFL starter in it, so matchup totals
// stay current with no game open. Your matchup's games refresh every 15s, the rest every 45s,
// at most 5 fetches per tick (a site summary is ~500KB). A game is fetched one more time after
// it goes final, then never again. The open game view keeps its own game fresh (ffOnSummary).
async function ffPollBoxes(fill) {
  // The first fill after a load runs even in a background tab, so the numbers are there the
  // moment it's opened; the recurring ticks pause while hidden.
  if (!FFUI.loaded || FFUI.polling || (document.hidden && !fill)) return;
  if (ffBoardWeek() !== FF.week) return;
  FFUI.polling = true;
  try {
    const now = Date.now();
    const due = [];
    for (const ev of S.events || []) {
      if (ev.state === 'pre') continue;
      const starters = ffStartersIn(ev);
      if (!starters.length) continue;
      const b = FFUI.box.get(ev.id);
      if (b && b.state === 'post' && ev.state === 'post') continue;
      if (G && G.id === ev.id) continue;
      const mine = starters.some((p) => ffSide(p.teamId) !== 'other');
      const age = b ? now - b.t : Infinity;
      if (age >= (mine ? 15000 : 45000)) due.push({ ev, mine, age });
    }
    due.sort((a, b) => (b.mine - a.mine) || (b.age - a.age));
    await Promise.all(due.slice(0, fill ? 16 : 5).map(async ({ ev }) => {
      try {
        const d = await getJSON(`${API}/summary?event=${ev.id}`, 15000);
        FF.ingestSummary(ev.id, d);
        FFUI.box.set(ev.id, { t: Date.now(), state: ev.state });
      } catch {}
    }));
  } finally {
    FFUI.polling = false;
  }
}

// ESPN's core-API play feed names every participant by athlete id (passer, receiver, scorer,
// kicker, sackedBy …), which is what lets a play show "+7.4 B. Robinson". The first pull takes
// the whole game; after that only the last page or two, re-reading the newest plays because a
// live play is often rewritten (a review, an added penalty) after it first appears.
async function ffFetchCore(id) {
  let st = FFUI.core.get(id);
  if (!st) { st = { busy: false, t: 0, n: 0, text: new Map() }; FFUI.core.set(id, st); }
  if (st.busy || Date.now() - st.t < 8000) return;
  st.busy = true;
  try {
    const base = `${CORE}/${id}/competitions/${id}/plays`;
    let items = [];
    if (!st.n) {
      const j = await getJSON(`${base}?limit=400`, 20000);
      items = j.items || [];
      for (let pg = 2; pg <= (j.pageCount || 1); pg++) items.push(...((await getJSON(`${base}?limit=400&page=${pg}`, 20000)).items || []));
    } else {
      const size = 25;
      const first = Math.floor(Math.max(0, st.n - 6) / size) + 1;
      const j = await getJSON(`${base}?limit=${size}&page=${first}`, 15000);
      items = j.items || [];
      for (let pg = first + 1; pg <= (j.pageCount || first); pg++) items.push(...((await getJSON(`${base}?limit=${size}&page=${pg}`, 15000)).items || []));
      st.n = Math.max(st.n, (j.count || 0));
    }
    if (!st.n) st.n = items.length;
    for (const it of items) {
      const pid = String(it.id);
      const was = st.text.get(pid);
      if (was != null && was !== it.text) FF.forgetPlay(id, pid);
      st.text.set(pid, it.text);
    }
    st.n = Math.max(st.n, st.text.size);
    FF.ingestPlays(id, items);
  } catch {} finally {
    st.busy = false;
    st.t = Date.now();
  }
}

/* ───────────── swing toasts ───────────── */
// After new box numbers land, any starter in your matchup who gained 3.5+ points since the last
// check gets a toast: "+6.8 B. Robinson" with the matchup score. The first reading of each
// player is the baseline, so opening the app mid-game doesn't replay the whole afternoon.
function ffSwings() {
  if (!FF.myMatchup || ffBoardWeek() !== FF.week) return;
  const me = FF.teamScore(FF.myMatchup.me), opp = FF.teamScore(FF.myMatchup.opp);
  const meT = ffTeam(FF.myMatchup.me), oppT = ffTeam(FF.myMatchup.opp);
  for (const [sc, mine] of [[me, true], [opp, false]]) {
    for (const r of sc.starters) {
      if (r.state === 'pre' || r.state === 'bye') continue;
      // No box score ingested for his game yet: teamScore reads 0, which is "unknown", not a
      // baseline. Recording it made every point of the first box after a load (Thursday's
      // 37.3 for Bijan) toast as a fresh swing.
      if (FF._pointsForKey(r.key) == null) continue;
      const was = FFUI.prev.get(r.key);
      FFUI.prev.set(r.key, r.pts);
      if (was == null || r.pts - was < 3.5) continue;
      const nfl = ffNflTeam(r.nfl);
      if (!nfl) continue;
      const lead = me.pts - opp.pts;
      const status = lead >= 0 ? `You lead ${oppT?.name || 'them'} by ${ffTotal(lead)}` : `You trail ${oppT?.name || 'them'} by ${ffTotal(-lead)}`;
      toast(nfl, `${mine ? '' : `${oppT?.abbrev || 'Opponent'}: `}+${ffPts(r.pts - was)} ${ffShort(r.name)}`, `${meT?.abbrev || 'You'} ${ffTotal(me.pts)} – ${ffTotal(opp.pts)} ${oppT?.abbrev || ''} · ${status}`, ffEventFor(r.nfl)?.id);
    }
  }
}

/* ───────────── re-render on new numbers ───────────── */
function ffRefresh() {
  clearTimeout(FFUI.renderTimer);
  FFUI.renderTimer = setTimeout(() => {
    if (!S.loaded) return;
    ffSwings();
    renderBoard();
    if (G && G.sum && !G.gate) {
      if (G.tab === 'fantasy' || G.tab === 'plays') renderTabBody();
      renderLastPlay(false);
    }
  }, 200);
}
if (FFUI.ok) {
  FF.onChange((w) => {
    if (!w || ['summary', 'plays', 'myTeam', 'proj'].includes(w.type)) ffRefresh();
    if (!w || ['teams', 'myTeam'].includes(w.type)) ffHeaderAvatar();
  });
  FFUI.pollTimer = setInterval(() => ffPollBoxes(false), 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ffPollBoxes(false); });
}

// GFFL's header avatar (desktop): your team's crest, as league.html's header wears it, linking to
// My Team. Hidden until the league says which team is yours.
function ffHeaderAvatar() {
  const a = $('#gh-av');
  if (!a) return;
  const t = FF.myTeamId != null && ffTeam(FF.myTeamId);
  a.hidden = !t;
  a.innerHTML = t ? ffCrest(FF.myTeamId, 32) : '';
  a.setAttribute('aria-label', t ? `My team: ${t.name}` : 'My team');
}

/* ───────────── hooks called by sd-app.js ───────────── */
function ffOnBoard(events) {
  if (!FFUI.ok) return;
  const wk = ffBoardWeek();
  if (wk == null) return;
  if (!FFUI.loaded || FF.week !== wk) { if (!FFUI.loading) ffLoad(wk); return; }
  FF.ingestBoard(events);
  ffPollBoxes(false);
}

function ffOnSummary(ev, raw) {
  if (!FFUI.loaded || !ev || !raw || ffBoardWeek() !== FF.week) return;
  FF.ingestSummary(ev.id, raw);
  FFUI.box.set(ev.id, { t: Date.now(), state: ev.state });
  if (ev.state !== 'pre') ffFetchCore(ev.id);
}

function ffGameWeight(ev) {
  if (!FFUI.loaded || ev.state !== 'in') return 0;
  let w = 0;
  for (const p of ffStartersIn(ev)) w += { me: 10, opp: 7, other: 1 }[ffSide(p.teamId)];
  return w;
}

// Scores board, top: your matchup, live. With no team picked yet, the eight teams to choose from.
function ffBoardHeader() {
  if (!FFUI.ok) return '';
  if (!FFUI.loaded) {
    if (FFUI.err) return `<div class="ffm ffm-note">League scores are unavailable right now.</div>`;
    return ffBoardWeek() == null ? '' : `<div class="ffm ffm-note">Loading GFFL matchups…</div>`;
  }
  if (FF.week !== ffBoardWeek()) return '';
  if (FF.myTeamId == null || !FF.teams.has(FF.myTeamId)) {
    return `<div class="ffm ffm-pick"><div class="ffm-lbl">Which GFFL team is yours?</div><div class="ffm-picks">${[...FF.teams.values()].map((t) => `<button class="ffm-pickb" data-ff-team="${t.id}">${ffCrest(t.id, 22)}<span>${esc(t.name)}</span></button>`).join('')}</div></div>`;
  }
  if (!FF.myMatchup) return `<div class="ffm ffm-note">${esc(ffTeam(FF.myTeamId)?.name || 'Your team')} has no GFFL game in week ${FF.week}.</div>`;
  const { me, opp } = FF.myMatchup;
  const A = FF.teamScore(me), B = FF.teamScore(opp);
  const wp = FF.winProb(me);
  const pct = wp == null ? null : Math.round(wp * 100);
  const live = [...A.starters.map((r) => ({ ...r, side: 'me' })), ...B.starters.map((r) => ({ ...r, side: 'opp' }))].filter((r) => r.state === 'in').sort((a, b) => b.pts - a.pts);
  const left = (sc) => sc.starters.filter((r) => r.state === 'pre').length;
  const team = (id, sc, cls) => {
    const t = ffTeam(id);
    return `<div class="ffm-team ${cls}">${ffCrest(id, 34)}<div class="ffm-tn"><b>${esc(t?.name || '')}</b><small>${esc(t?.ownerFirst || '')}</small></div><div class="ffm-sc"><b>${ffTotal(sc.pts)}</b><small>proj ${ffTotal(sc.proj)}</small></div></div>`;
  };
  const statusBits = [];
  if (live.length) statusBits.push(`<span class="ffm-live">Playing now</span> ${live.slice(0, 5).map((r) => `<span class="ffm-p ${r.side}">${esc(ffShort(r.name))} ${ffPts(r.pts)}</span>`).join('')}`);
  statusBits.push(`<span class="ffm-left">You: ${left(A)} to play · ${esc(ffTeam(opp)?.abbrev || 'Them')}: ${left(B)} to play</span>`);
  // Tapping your matchup opens it in GFFL (Sunday's own Matchups page is gone, 2026-09-27).
  return `<a class="ffm" href="league.html#matchup" aria-label="Your GFFL matchup, week ${FF.week}. Open it in GFFL">
    <div class="ffm-top"><span class="ffm-lbl">GFFL · Week ${FF.week}</span>${pct == null ? '' : `<span class="ffm-wp">${pct}% to win</span>`}</div>
    <div class="ffm-row">${team(me, A, 'me')}<span class="ffm-vs">vs</span>${team(opp, B, 'opp')}</div>
    ${pct == null ? '' : `<div class="ffm-bar" role="img" aria-label="${pct}% win probability"><i style="width:${pct}%;background:${ffColor(me)}"></i><i style="background:${ffColor(opp)}"></i></div>`}
    <div class="ffm-status">${statusBits.join('')}</div>
  </a>`;
}

// One line under each game card: the GFFL starters in this game, yours and your opponent's
// first, with live points once the game is on.
function ffCardExtra(ev) {
  if (!FFUI.loaded || FF.week !== ffBoardWeek()) return '';
  const all = ffStartersIn(ev);
  if (!all.length) return '';
  const rank = { me: 0, opp: 1, other: 2 };
  all.sort((a, b) => rank[ffSide(a.teamId)] - rank[ffSide(b.teamId)] || (b.pts || 0) - (a.pts || 0));
  // Every GFFL starter in the game gets a chip, yours and your opponent's first (2026-09-27,
  // user: "show all GFFL starters instead of having '+2 GFFL'"). The row wraps as needed.
  const chip = (p) => {
    const side = ffSide(p.teamId);
    const val = ev.state === 'pre' ? '' : ` <b>${ffPts(p.pts || 0)}</b>`;
    return `<span class="ffc ${side}" style="--c:${ffColor(p.teamId)}">${ffTag(p.teamId, false, 16)}${esc(ffShort(p.name))}${val}</span>`;
  };
  return `<div class="ff-card">${all.map(chip).join('')}</div>`;
}

// Under each play: the rostered players it scored for. Bench players show muted; players on no
// GFFL roster don't show at all.
function ffPlayExtra(ev, play) {
  if (!FFUI.loaded || !play?.id || FF.week !== ffBoardWeek()) return '';
  const credits = FF.playCredits(ev.id, play.id).filter((c) => c.teamId != null && Math.abs(c.pts) >= 0.05);
  if (!credits.length) return '';
  return `<div class="ff-play">${credits.map((c) => {
    const side = ffSide(c.teamId);
    return `<span class="ffp ${side}${c.starter ? '' : ' bench'}" style="--c:${ffColor(c.teamId)}">${ffTag(c.teamId, !c.starter, 16)}<b>${c.label}</b> ${esc(ffShort(c.name))}</span>`;
  }).join('')}</div>`;
}

// The game view's Fantasy tab: every GFFL player in this game, grouped by what he means to you,
// the plays that moved fantasy points most, and unrostered players having a big day.
function ffTabFantasy(ev) {
  if (!FFUI.ok) return '';
  if (!FFUI.loaded) return `<div class="empty">${FFUI.err ? 'GFFL league data is unavailable right now.' : 'Loading GFFL rosters…'}</div>`;
  if (FF.week !== ffBoardWeek()) return `<div class="empty">GFFL scoring shows for regular-season weeks. Pick a regular-season week to see it.</div>`;
  const inGame = new Set([FF.slpTeam(ev.home.abbr), FF.slpTeam(ev.away.abbr)]);
  const box = FF.gamePlayers(ev.id);
  const byKey = new Map(box.map((r) => [r.key, r]));
  // Everyone rostered on either NFL team, whether or not he has touched the ball yet.
  const rostered = [];
  for (const [teamId, players] of FF.rostersByTeamId) {
    for (const p of players) {
      if (!p.team || !inGame.has(FF.slpTeam(p.team)) || p.slot === 'IR') continue;
      const own = FF.ownerOfAthlete(p.key, { name: p.name, nflAbbr: p.team });
      let r = byKey.get(p.key);
      if (!r && String(p.key).startsWith('slp_')) r = box.find((b) => FF.normName(b.name) === FF.normName(p.name) && FF.slpTeam(b.team) === FF.slpTeam(p.team));
      rostered.push({ key: p.key, name: p.name, pos: p.pos, nfl: p.team, teamId, starter: own ? own.starter : ffIsStarter(p), pts: r ? r.pts : null, line: r ? r.line : '', proj: FF.projFor(p.key) });
    }
  }
  const row = (r) => `<div class="ffr ${ffSide(r.teamId)}${r.starter === false && r.teamId != null ? ' bench' : ''}">
      ${ffHeadshot(r.key, ev, r.nfl)}
      <div class="ffr-m"><div class="ffr-n">${esc(r.name)} <small>${esc([r.pos, r.nfl].filter(Boolean).join(' · '))}</small></div><div class="ffr-l">${esc(r.line || (ev.state === 'pre' ? (r.proj != null ? `Projected ${ffPts(r.proj)}` : 'Not played yet') : 'No stats yet'))}</div></div>
      ${r.teamId != null ? ffTag(r.teamId, !r.starter) : '<span class="ff-tag fa">Free agent</span>'}
      <b class="ffr-p">${ev.state === 'pre' ? '' : ffPts(r.pts ?? 0)}</b>
    </div>`;
  const sortPts = (a, b) => (b.pts ?? -99) - (a.pts ?? -99) || (b.proj ?? 0) - (a.proj ?? 0);
  const groups = [];
  const mm = FF.myMatchup;
  const mine = rostered.filter((r) => mm && r.teamId === mm.me && r.starter).sort(sortPts);
  const theirs = rostered.filter((r) => mm && r.teamId === mm.opp && r.starter).sort(sortPts);
  const others = rostered.filter((r) => r.starter && (!mm || (r.teamId !== mm.me && r.teamId !== mm.opp))).sort(sortPts);
  const bench = rostered.filter((r) => !r.starter).sort(sortPts);
  const sum = (rs) => rs.reduce((s, r) => s + (r.pts || 0), 0);
  if (mine.length) groups.push([`Your starters`, mine, sum(mine)]);
  if (theirs.length) groups.push([`${ffTeam(mm.opp)?.name || 'Opponent'} starters`, theirs, sum(theirs)]);
  if (others.length) groups.push(['Other GFFL starters', others, null]);
  if (bench.length) groups.push(['On GFFL benches', bench, null]);
  const fa = ev.state === 'pre' ? [] : box.filter((r) => r.teamId == null && r.pts >= 6).slice(0, 5).map((r) => ({ ...r, nfl: r.team }));
  if (fa.length) groups.push(['Free agents having a day', fa, null]);

  let html = '';
  if (mm && (mine.length || theirs.length) && ev.state !== 'pre') {
    const a = sum(mine), b = sum(theirs);
    html += `<div class="ff-impact"><span>This game</span><b class="me">${ffTotal(a)}</b><em>you</em><b>${ffTotal(b)}</b><em>${esc(ffTeam(mm.opp)?.abbrev || 'them')}</em><span class="ff-net ${a - b >= 0 ? 'up' : 'down'}">${a - b >= 0 ? '+' : '−'}${ffTotal(Math.abs(a - b))} net</span></div>`;
  }
  // Biggest fantasy plays: every play's rostered credits, summed; top five by size.
  const ledger = FF._playCredits.get(ev.id);
  if (ledger && G?.sum) {
    const pById = new Map(G.sum.flat.map((f) => [f.p.id, f.p]));
    const big = [];
    for (const pid of ledger.keys()) {
      const cs = FF.playCredits(ev.id, pid).filter((c) => c.teamId != null);
      if (!cs.length) continue;
      const tot = cs.reduce((s, c) => s + Math.abs(c.pts), 0);
      const p = pById.get(pid);
      if (p && tot >= 4) big.push({ p, cs, tot });
    }
    big.sort((a, b) => b.tot - a.tot);
    if (big.length) {
      html += `<h4 class="ff-h">Biggest fantasy plays</h4><div class="ff-big">${big.slice(0, 5).map(({ p, cs }) => `<div class="ffb"><div class="ffb-t"><small>${esc(periodLabel(p.period))} ${esc(p.clock || '')}</small>${playHTML(p.text)}</div>${ffPlayExtra(ev, p)}</div>`).join('')}</div>`;
    }
  }
  html += groups.map(([h, rs, tot]) => `<h4 class="ff-h">${esc(h)}${tot != null && ev.state !== 'pre' ? `<span>${ffTotal(tot)}</span>` : ''}</h4><div class="ff-list">${rs.map(row).join('')}</div>`).join('');
  if (!rostered.length && !fa.length) html += '<div class="empty">No GFFL players in this game.</div>';
  return `<div class="ff-tab">${html}</div>`;
}

function ffAfterRender() {}

/* ───────────── clicks ───────────── */
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-ff-team]');
  if (t) {
    e.preventDefault();
    const id = +t.dataset.ffTeam;
    store.set('team', id);
    FFUI.prev.clear();
    FF.setMyTeam(id);
    return;
  }
});
document.addEventListener('change', (e) => {
  if (e.target.id !== 'ff-team-pick' || !FFUI.ok) return;
  const id = e.target.value === '' ? null : +e.target.value;
  store.set('team', id);
  FFUI.prev.clear();
  FF.setMyTeam(id);
});
