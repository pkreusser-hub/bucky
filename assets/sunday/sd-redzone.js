'use strict';
/* sd-redzone.js — the RedZone card, top of the desktop sidebar (2026-10-04, user: "add a 'Redzone'
   card to the GFFL scores page thats always at the top right, and rather than follow one game it
   flashes between games similar to the way redzone does, showing plays as they happen and leaning
   towards games in the rezone, and instead of single game stats below its a total feed of all
   fantasy activity for the league").

   Two halves:
   - The director. Every scoreboard poll, each live game's last play is compared with the one seen
     before. A new one is news: the card cuts to the game it happened in once the play on screen has
     had RZ.MIN to be read. Scores, turnovers and red-zone snaps outrank everything else, and a game
     inside the 20 holds the card until its drive ends or something bigger happens elsewhere. With
     no news anywhere for RZ.MAX, the card moves on to the next game worth watching.
   - The league feed. Every play that moved a GFFL player's points, in every game this week, newest
     first. The credits come from the same core-API play engine as the game view's per-play chips
     (FF.playCredits), fetched for each game with a GFFL starter in it, not only the open one.

   Desktop only: the card lives in the game view's sidebar, which exists at 1080px and up, and only
   for the NFL's current week (another week has no live games to follow).

   Needs from sd-app.js (shared global scope): $, esc, S, G, isWide, miniField, logoImg, playLine,
   yardsHTML, statusText, isHalftime, excitement, periodLabel, fmtTime, patchList, setHTML,
   boardPoller. From sd-ffui.js: FFUI, ffFetchCore, ffBoardWeek, ffTag, ffColor, ffShort, ffSide.
   Load order: after sd-ffui.js. */

const RZ = {
  MIN: 7000,        // a play stays on screen at least this long
  HOLD_SCORE: 14000, // a score (or a viewer's own pick) stays this long
  MAX: 30000,       // nothing new anywhere for this long: move on to the next game worth watching
  RZ_MAX: 90000,    // ...unless the game on screen is inside the 20; then it may hold this long
  TIE: 20000,       // equal news elsewhere takes the card once the current game has had this long
  STALE: 45000,     // news this old is no longer news
  seen: new Map(),  // gameId -> last play id seen on the scoreboard
  totals: new Map(), // gameId -> away + home points at the last poll (a score with no scoreValue)
  pending: new Map(), // gameId -> {play, kind, prio, at}: something happened there, not shown yet
  cur: null,        // {gid, play, kind, prio, since, at, manual}
  shown: new Map(), // gameId -> when the card last left it (the rotation favours games not seen lately)
  cuts: 0,          // bumped on every cut, so the stage can play its wipe
  feedTimer: null,
};
// What a play is worth to the director. Higher wins the card.
const RZ_PRIO = { score: 100, turnover: 80, redzone: 60, big: 50, gffl: 35, play: 15, pat: 10, meta: -1 };
const RZ_LABEL = { score: '', turnover: '', redzone: 'Red zone', big: 'Big play', gffl: '', play: '', pat: '', meta: '' };

// Is the board on the NFL's current week? (S.week is set only when the viewer picked another.)
function rzThisWeek() {
  if (!S.cur) return false;
  return !S.week || (S.week.st === S.cur.st && S.week.wk === S.cur.wk);
}
function rzShown() { return !!(G && isWide() && S.loaded && rzThisWeek()); }
function rzActive() { return rzShown() && !document.hidden; }
// Games the card may sit on: live and not at halftime.
const rzOnAir = (ev) => !!ev && ev.state === 'in' && !isHalftime(ev);

// A rostered player named on the play, from the scoreboard's athletesInvolved (ids, no stats).
function rzOwners(ev, lp) {
  if (typeof FF === 'undefined' || !FFUI.loaded || FF.week !== ffBoardWeek()) return [];
  const out = [];
  for (const a of lp?.athletesInvolved || []) {
    const t = a.team?.id === ev.home.id ? ev.home : a.team?.id === ev.away.id ? ev.away : null;
    const own = FF.ownerOfAthlete(a.id, { name: a.fullName || a.displayName, nflAbbr: t?.abbr });
    if (own) out.push({ key: String(a.id), name: own.name || a.displayName || '', teamId: own.teamId, starter: own.starter });
  }
  return out;
}

const rzIsMeta = (lp) => /timeout|end of|end period|two-minute|coin toss|^end /.test(String(lp?.type?.text || '').toLowerCase());
// Sort one new scoreboard play into the director's buckets. `scored` is the rise in the game's total
// points since the last poll. A score can land between two polls with the last play already moved
// on: recorded 2026-10-04, DAL @ HOU went 7 to 10 while the scoreboard's last play read "Official
// Timeout" (the field goal itself was never the last play on any poll). The rise is the score.
function rzClassify(ev, lp, scored = 0) {
  const t = String(lp?.type?.text || '').toLowerCase();
  const text = String(lp?.text || '');
  if (rzIsMeta(lp) || !lp) return scored >= 2 ? 'score' : 'meta';
  if (/extra point|two-point|2pt|conversion/.test(t)) return 'pat';
  if ((+lp.scoreValue > 0) || /touchdown|field goal good|safety/.test(t) || (scored >= 2 && !/no good|missed|blocked/.test(t))) {
    if (!/nullified|no play/i.test(text)) return 'score';
  }
  if (/interception|fumble recovery \(opp|turnover on downs|blocked|missed field goal|field goal missed/.test(t)) return 'turnover';
  if (ev.sit?.isRedZone) return 'redzone';
  if (Math.abs(+lp.statYardage || 0) >= 20) return 'big';
  if (rzOwners(ev, lp).some((o) => o.starter)) return 'gffl';
  return 'play';
}

// Each scoreboard poll: note every live game's newest play. The first sight of a game is only a
// baseline (opening the page mid-afternoon isn't fourteen games of news at once).
function rzOnBoard(evs, now = Date.now()) {
  for (const ev of evs || []) {
    const total = (ev.away.score || 0) + (ev.home.score || 0);
    const was = RZ.totals.get(ev.id);
    RZ.totals.set(ev.id, total);
    if (ev.state !== 'in') continue;
    const lp = ev.sit?.lastPlay;
    const id = lp?.id != null ? String(lp.id) : null;
    if (!id) continue;
    const prev = RZ.seen.get(ev.id);
    RZ.seen.set(ev.id, id);
    if (prev === undefined || prev === id) {
      // Same play, but the situation behind it may have moved (the red zone starts with the next snap).
      if (RZ.cur?.gid === ev.id && RZ.cur.play?.id === id) RZ.cur.play = lp;
      continue;
    }
    const delta = was != null ? total - was : 0;
    const kind = rzClassify(ev, lp, delta);
    if (kind === 'meta') continue;
    const news = { play: lp, kind, prio: RZ_PRIO[kind], at: now, delta: kind === 'score' ? delta : 0 };
    const big = (k) => k === 'score' || k === 'turnover';
    if (RZ.cur?.gid === ev.id) {
      // The game on screen shows its new play where it is. A score restarts the hold; a lesser play
      // inside the hold doesn't replace it, and the try after a touchdown never does (recorded
      // 2026-10-04: TEN @ BAL's touchdown, then "Extra Point Good" two polls, 31 s, later).
      if (big(RZ.cur.kind) && (kind === 'pat' || now - RZ.cur.since < RZ.HOLD_SCORE) && news.prio < RZ.cur.prio) { RZ.cur.at = now; continue; }
      Object.assign(RZ.cur, { play: lp, kind, prio: news.prio, at: now, delta: news.delta });
      if (kind === 'score') RZ.cur.since = now;
      RZ.pending.delete(ev.id);
    } else {
      // Two unseen plays from one game: the newer one, unless the older was a score or a turnover
      // the newer can't match (the touchdown, not the extra point after it).
      const old = RZ.pending.get(ev.id);
      if (!old || news.prio >= old.prio || !big(old.kind)) RZ.pending.set(ev.id, news);
    }
  }
  rzTick(now);
}

// How hard the game on screen holds the card against news elsewhere.
function rzHold(now) {
  const c = RZ.cur;
  if (!c) return -Infinity;
  const ev = S.byId.get(c.gid);
  if ((c.kind === 'score' || c.manual) && now - c.since < RZ.HOLD_SCORE) return Infinity;
  if (ev?.sit?.isRedZone) return RZ_PRIO.redzone;
  return 0;
}
// The game to fall back to when nothing new is happening: the red zone first, then the game
// the scoreboard already ranks highest (close, late, upset watch, your GFFL players), less the
// longer-ago it was on.
function rzBestGame(now, except) {
  let best = null, bestS = -Infinity;
  for (const ev of S.events || []) {
    if (!rzOnAir(ev) || ev.id === except) continue;
    const s = ev.sit || {};
    const ytg = s.yardLine != null && s.possession ? (s.possession === ev.home.id ? s.yardLine : 100 - s.yardLine) : null;
    let sc = excitement(ev) + (s.isRedZone ? 60 + (ytg != null ? Math.max(0, 20 - ytg) : 0) : 0);
    const last = RZ.shown.get(ev.id);
    if (last != null) sc -= Math.max(0, 40 - (now - last) / 3000);  // just left it: 40 down, back to even after 2 minutes
    if (sc > bestS) { bestS = sc; best = ev; }
  }
  return best;
}
function rzCut(gid, news, now, manual = false) {
  const ev = S.byId.get(gid);
  if (!ev) return;
  if (RZ.cur && RZ.cur.gid !== gid) RZ.shown.set(RZ.cur.gid, now);
  const play = news?.play || ev.sit?.lastPlay || null;
  const kind = news?.kind || (play ? rzClassify(ev, play, false) : 'play');
  RZ.cur = { gid, play, kind: kind === 'meta' ? 'play' : kind, prio: news?.prio ?? 0, since: now, at: news?.at ?? now, manual, delta: news?.delta || 0 };
  RZ.pending.delete(gid);
  RZ.cuts++;
}

// Once a second (and after every poll): stay, or cut.
function rzTick(now = Date.now()) {
  for (const [gid, n] of RZ.pending) if (now - n.at > RZ.STALE || !rzOnAir(S.byId.get(gid))) RZ.pending.delete(gid);
  const c = RZ.cur;
  const curEv = c && S.byId.get(c.gid);
  // A game that just went to halftime or final keeps a score on screen for its hold, then gives way.
  const curOk = curEv && (rzOnAir(curEv) || (c.kind === 'score' && now - c.since < RZ.HOLD_SCORE));
  if (!curOk) {
    let best = null;
    for (const [gid, n] of RZ.pending) if (!best || n.prio > best.n.prio || (n.prio === best.n.prio && n.at > best.n.at)) best = { gid, n };
    if (best) rzCut(best.gid, best.n, now);
    else {
      const ev = rzBestGame(now, null);
      if (ev) rzCut(ev.id, null, now);
      else { if (RZ.cur) RZ.shown.set(RZ.cur.gid, now); RZ.cur = null; }
    }
    return rzRender();
  }
  const dwell = now - c.since;
  if (dwell < RZ.MIN) return rzRender();
  const hold = rzHold(now);
  let best = null;
  for (const [gid, n] of RZ.pending) {
    if (n.prio <= 0) continue;
    if (!best || n.prio > best.n.prio || (n.prio === best.n.prio && n.at > best.n.at)) best = { gid, n };
  }
  if (best && (best.n.prio > hold || (best.n.prio === hold && dwell >= RZ.TIE))) { rzCut(best.gid, best.n, now); return rzRender(); }
  // Nothing new worth a cut. Rotate after a quiet spell, but a game in the red zone keeps the card.
  const quiet = now - Math.max(c.since, c.at);
  const limit = curEv.sit?.isRedZone ? RZ.RZ_MAX : RZ.MAX;
  if (quiet >= limit && !RZ.pending.size) {
    const ev = rzBestGame(now, c.gid);
    if (ev) rzCut(ev.id, null, now);
  } else if (quiet >= limit && best) rzCut(best.gid, best.n, now);
  rzRender();
}

/* ───────────── the league feed ───────────── */
// Core-API plays for every started game with a GFFL starter in it (FFUI already ingests those
// games' box scores, which the D/ST credits need). Live games every tick (ffFetchCore re-reads only
// the last page or two after its first pull, and skips a game it read under 8 s ago); a final is
// read once more after it ends, then never again.
async function rzFeedTick() {
  if (!rzActive() || typeof FF === 'undefined' || !FFUI.loaded || FF.week !== ffBoardWeek()) return;
  const due = [];
  for (const ev of S.events || []) {
    if (ev.state === 'pre' || !FF._gameBox.has(ev.id)) continue;
    const st = FFUI.core.get(ev.id);
    if (st?.final) continue;
    due.push(ev);
  }
  due.sort((a, b) => (a.state === 'in' ? 0 : 1) - (b.state === 'in' ? 0 : 1) || b.date - a.date);
  await Promise.all(due.slice(0, 8).map(async (ev) => {
    const wasPost = ev.state === 'post';
    await ffFetchCore(ev.id);
    const st = FFUI.core.get(ev.id);
    if (st && wasPost && st.t && st.meta?.size) st.final = true;
  }));
  rzRenderFeed();
}

// Every play that scored for a GFFL starter, newest first; a bench player on the same play rides
// along, muted. A play that only moved bench players is left out: those points don't count, and on
// the first live afternoon they were a third of the rows. A play with no wallclock sorts by its id
// (ESPN's ids run in game order) under the plays that have one.
function rzFeedRows() {
  if (typeof FF === 'undefined' || !FFUI.loaded || FF.week !== ffBoardWeek()) return [];
  const rows = [];
  for (const [gid, st] of FFUI.core) {
    if (!st.meta) continue;
    for (const [pid, m] of st.meta) {
      const cs = FF.playCredits(gid, pid).filter((c) => c.teamId != null && Math.abs(c.pts) >= 0.05);
      if (!cs.some((c) => c.starter)) continue;
      rows.push({ gid, pid, t: m.t || 0, per: m.per, clk: m.clk, text: m.text, cs });
    }
  }
  rows.sort((a, b) => b.t - a.t || (b.pid > a.pid ? 1 : b.pid < a.pid ? -1 : 0));
  return rows;
}
const rzChip = (c) => `<span class="ffp ${ffSide(c.teamId)}${c.starter ? '' : ' bench'}" style="--c:${ffColor(c.teamId)}">${ffTag(c.teamId, !c.starter, 16)}<b>${esc(c.label)}</b> ${esc(ffShort(c.name))}</span>`;
function rzFeedRow(r) {
  const ev = S.byId.get(r.gid);
  const game = ev ? `${ev.away.abbr} @ ${ev.home.abbr}` : '';
  const when = r.t ? fmtTime(new Date(r.t)) : '';
  const clock = [r.per ? periodLabel(r.per) : '', r.clk || ''].filter(Boolean).join(' ');
  return `<a class="rzn-row" href="#g${esc(r.gid)}" data-key="${esc(r.gid)}-${esc(r.pid)}">
    <div class="rzn-rm"><span class="rzn-rt">${esc(when)}</span><span>${esc(game)}${clock ? ` · ${esc(clock)}` : ''}</span></div>
    <div class="ff-play rzn-rc">${r.cs.map(rzChip).join('')}</div>
    <div class="rzn-rx">${yardsHTML(esc(playLine({ text: r.text })))}</div>
  </a>`;
}
const RZ_FEED_CAP = 150;
function rzRenderFeed() {
  const box = $('#rzn-feed');
  if (!box || box.closest('[hidden]')) return;
  const rows = rzFeedRows();
  const n = $('#rzn-fn');
  if (n) n.textContent = rows.length ? `${rows.length} play${rows.length === 1 ? '' : 's'}` : '';
  if (!rows.length) {
    const msg = typeof FF === 'undefined' || FFUI.err ? 'League scores are unavailable right now.'
      : !FFUI.loaded ? 'Loading GFFL rosters…'
      : (S.events || []).some((e) => e.state !== 'pre') ? 'Fantasy plays from every game land here as they happen.'
      : 'Nothing yet. Every GFFL point scored this week lands here, newest first.';
    setHTML(box, `<div class="rzn-empty">${esc(msg)}</div>`);
    return;
  }
  if (box.firstElementChild?.classList.contains('rzn-empty')) { box.innerHTML = ''; box._html = null; }
  // Keyed, so a new play slides in on top without repainting (or re-loading the crests of) the rest.
  patchList(box, rows.slice(0, RZ_FEED_CAP).map((r) => ({ key: `${r.gid}-${r.pid}`, html: rzFeedRow(r) })));
}

/* ───────────── the card ───────────── */
function rzMoment(ev, c) {
  const t = String(c.play?.type?.text || '').toLowerCase();
  const tm = c.play?.team?.id === ev.home.id ? ev.home : c.play?.team?.id === ev.away.id ? ev.away : null;
  const by = tm ? ` · ${tm.abbr}` : '';
  if (c.kind === 'score') {
    // The play itself may not say (a timeout already on the scoreboard): the points do.
    if (rzIsMeta(c.play)) return c.delta === 3 ? 'Field goal' : c.delta === 2 ? 'Safety' : c.delta >= 6 ? 'Touchdown' : 'Score';
    return /field goal/.test(t) ? `Field goal${by}` : /safety/.test(t) ? `Safety${by}` : `Touchdown${by}`;
  }
  if (c.kind === 'turnover') return /interception/.test(t) ? `Interception` : /fumble/.test(t) ? 'Fumble lost' : /downs/.test(t) ? 'Turnover on downs' : /block/.test(t) ? 'Blocked' : 'No good';
  if (ev.sit?.isRedZone) return 'Red zone';
  return RZ_LABEL[c.kind] || '';
}
function rzStageHTML(ev, c) {
  const s = ev.sit || {};
  const side = (t) => `<span class="rzn-tm">${logoImg(t, 22, 'logo')}<b>${esc(t.abbr)}</b><span class="rzn-sc">${t.score ?? 0}</span></span>`;
  const dd = s.downDistanceText && s.down > 0 && !isHalftime(ev) ? esc(s.downDistanceText) : '';
  const moment = rzMoment(ev, c);
  // The play's GFFL credits once the core feed has them; before that, the rostered players it names.
  let chips = '';
  if (typeof FF !== 'undefined' && FFUI.loaded && FF.week === ffBoardWeek() && c.play?.id != null) {
    const cs = FF.playCredits(ev.id, String(c.play.id)).filter((x) => x.teamId != null && Math.abs(x.pts) >= 0.05);
    chips = cs.length ? cs.map(rzChip).join('')
      : rzOwners(ev, c.play).map((o) => `<span class="ffp ${ffSide(o.teamId)}${o.starter ? '' : ' bench'}" style="--c:${ffColor(o.teamId)}">${ffTag(o.teamId, !o.starter, 16)}${esc(ffShort(o.name))}</span>`).join('');
  }
  const text = c.play && !rzIsMeta(c.play) ? playLine(c.play) : '';
  return `<a class="rzn-stage${s.isRedZone ? ' in-rz' : ''}${c.kind === 'score' ? ' scored' : ''}" href="#g${esc(ev.id)}" aria-label="${esc(`${ev.away.name} at ${ev.home.name}. Open this game`)}">
    <div class="rzn-bug">${side(ev.away)}${side(ev.home)}<span class="rzn-clk">${esc(statusText(ev))}</span></div>
    ${miniField(ev)}
    <div class="rzn-sit">${moment ? `<span class="rzn-mo k-${c.kind}">${esc(moment)}</span>` : ''}<span class="rzn-dd">${dd}</span></div>
    ${text ? `<div class="rzn-tx">${yardsHTML(esc(text))}</div>` : ''}
    ${chips ? `<div class="ff-play rzn-ff">${chips}</div>` : ''}
  </a>`;
}
function rzChannels() {
  const live = (S.events || []).filter((e) => e.state === 'in').sort((a, b) => a.date - b.date || (a.id > b.id ? 1 : -1));
  return live.map((ev) => {
    const on = RZ.cur?.gid === ev.id, rz = ev.sit?.isRedZone && !isHalftime(ev), news = RZ.pending.has(ev.id);
    return `<button class="rzn-ch${on ? ' on' : ''}${rz ? ' rz' : ''}${news ? ' news' : ''}${isHalftime(ev) ? ' half' : ''}" data-rz-game="${esc(ev.id)}" aria-pressed="${on}" aria-label="${esc(`${ev.away.name} at ${ev.home.name}${rz ? ', in the red zone' : ''}`)}">${esc(ev.away.abbr)} ${ev.away.score ?? 0}<i>·</i>${esc(ev.home.abbr)} ${ev.home.score ?? 0}</button>`;
  }).join('');
}
let rzLastCut = -1;
function rzRender() {
  const el = $('#redzone');
  if (!el) return;
  const on = rzShown();
  if (el.hidden === on) el.hidden = !on;
  if (!on) return;
  if (!el.firstElementChild) {
    el.innerHTML = `<div class="rzn-h"><span class="rzn-logo">Red<b>Zone</b></span><span class="rzn-n" id="rzn-n"></span></div>
      <div class="rzn-screen" id="rzn-screen"></div>
      <div class="rzn-chs" id="rzn-chs" role="group" aria-label="Live games"></div>
      <div class="rzn-fh">League fantasy feed <small id="rzn-fn"></small></div>
      <div class="rzn-feed" id="rzn-feed" aria-live="off"></div>`;
    rzLastCut = -1;
  }
  const live = (S.events || []).filter((e) => e.state === 'in').length;
  $('#rzn-n').textContent = live ? `${live} live` : '';
  const scr = $('#rzn-screen');
  const ev = RZ.cur && S.byId.get(RZ.cur.gid);
  if (ev) setHTML(scr, rzStageHTML(ev, RZ.cur));
  else {
    const next = (S.events || []).filter((e) => e.state === 'pre').sort((a, b) => a.date - b.date)[0];
    setHTML(scr, `<div class="rzn-idle"><b>No games live</b><span>${next ? `Next kickoff: ${esc(next.away.abbr)} @ ${esc(next.home.abbr)}, ${esc(fmtTime(next.date))}` : 'RedZone comes on with the first kickoff.'}</span></div>`);
  }
  if (RZ.cuts !== rzLastCut) {
    // The wipe between games. Not on the card's first paint, so arriving on the page isn't a cut.
    if (rzLastCut !== -1) { scr.classList.remove('cut'); void scr.offsetWidth; scr.classList.add('cut'); }
    rzLastCut = RZ.cuts;
  }
  setHTML($('#rzn-chs'), rzChannels());
  $('#rzn-chs').hidden = live < 2;
  if (rzLastFeed !== el.firstElementChild) { rzLastFeed = el.firstElementChild; rzRenderFeed(); }
}
// The feed repaints when its numbers change (new plays, a box score, rosters, rules), not every tick.
let rzLastFeed = null, rzFeedTimer = 0;
if (typeof FF !== 'undefined') FF.onChange(() => { clearTimeout(rzFeedTimer); rzFeedTimer = setTimeout(rzRenderFeed, 250); });
// Mounted fresh with every game view (openGameView rebuilds the sidebar); the director's state
// carries over, so swapping the big game doesn't reset the card.
function rzMount() {
  rzRender();
  rzFeedTick();
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-rz-game]');
  if (!b) return;
  e.preventDefault();
  rzCut(b.dataset.rzGame, null, Date.now(), true);
  rzRender();
});
setInterval(() => { if (rzActive()) rzTick(Date.now()); }, 1000);
RZ.feedTimer = setInterval(rzFeedTick, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && rzShown()) { rzTick(Date.now()); rzFeedTick(); } });
