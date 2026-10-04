'use strict';
/* sd-redzone.js — RedZone (2026-10-04, user: "add a 'Redzone' card to the GFFL scores page thats
   always at the top right, and rather than follow one game it flashes between games similar to the
   way redzone does, showing plays as they happen and leaning towards games in the rezone, and instead
   of single game stats below its a total feed of all fantasy activity for the league").

   RedZone is its own entry, like a game (same day, user: "the redzone shouldn't appear on every games
   screen, its like its own game that appears in the top scroll bar"): first in the phone's strip of
   games and at the top of the desktop sidebar, at `#redzone`. Picking it opens the game view on
   whatever RedZone is showing; the big 8-bit view and the hero follow it from game to game, and below
   the field, in place of one game's tabs, are the live games as channels and the league fantasy feed.
   A game picked from the strip, the sidebar or the feed is an ordinary game view, with no RedZone.

   Two halves:
   - The director. Every scoreboard poll, each live game's last play is compared with the one seen
     before. A new one is news: the card cuts to the game it happened in once the play on screen has
     had RZ.MIN to be read. Scores, turnovers and red-zone snaps outrank everything else, and a game
     inside the 20 holds the card until its drive ends or something bigger happens elsewhere. With
     no news anywhere for RZ.MAX, the card moves on to the next game worth watching.
   - The league feed. Every play that moved a GFFL player's points, in every game this week, newest
     first. The credits come from the same core-API play engine as the game view's per-play chips
     (FF.playCredits), fetched for each game with a GFFL starter in it, not only the open one.

   Phone and desktop alike (2026-10-04: "Also need it to be on mobile"). Only for the NFL's current
   week (another week has no live games to follow).

   Needs from sd-app.js (shared global scope): $, esc, S, G, playLine, yardsHTML, isHalftime,
   excitement, periodLabel, fmtTime, patchList, setHTML, openGameView, renderSide, renderStrip,
   defaultGameId, route. From sd-ffui.js: FFUI, ffFetchCore, ffBoardWeek, ffTag, ffColor, ffShort, ffSide.
   Load order: after sd-ffui.js. */

const RZ = {
  MIN: 7000,        // a play stays on screen at least this long
  HOLD_SCORE: 8000, // a score stays this long; then its game is between drives and the card moves on
  HOLD_PICK: 14000, // a game the viewer tapped stays this long
  MAX: 30000,       // nothing new anywhere for this long: move on to the next game worth watching
  RZ_MAX: 90000,    // ...unless the game on screen is inside the 20; then it may hold this long
  TIE: 20000,       // equal news elsewhere takes the card once the current game has had this long
  STAGE_MAX: 25000, // the longest a cut waits for the big 8-bit view to finish the play it's showing
  STALE: 45000,     // news this old is no longer news
  seen: new Map(),  // gameId -> last play id seen on the scoreboard
  seenIds: new Map(), // gameId -> every play id that game's scoreboard has ever shown (news only once)
  played: new Set(), // "gameId|playId" of every play the 8-bit view has shown in RedZone
  totals: new Map(), // gameId -> away + home points at the last poll (a score with no scoreValue)
  pending: new Map(), // gameId -> {play, kind, prio, at}: something happened there, not shown yet
  cur: null,        // {gid, play, kind, prio, since, at, manual}
  shown: new Map(), // gameId -> when the card last left it (the rotation favours games not seen lately)
  dead: new Set(),  // games between drives: a score, a try, a kickoff, a punt or a turnover was their last play
  lastNews: new Map(), // gameId -> when it last had a real snap (the rotation goes where the action is)
  feedTimer: null,
};
// What a play is worth to the director. Higher wins the card.
// A kickoff, punt or try ('dead') is shown when it happens in the game on screen but never pulls the
// card to its game.
const RZ_PRIO = { score: 100, turnover: 80, redzone: 60, big: 50, gffl: 35, play: 15, pat: 0, dead: 0, meta: -1 };
const RZ_LABEL = { score: '', turnover: '', redzone: 'Red zone', big: 'Big play', gffl: '', play: '', pat: '', dead: '', meta: '' };

// Is the board on the NFL's current week? (S.week is set only when the viewer picked another.)
function rzThisWeek() {
  if (!S.cur) return false;
  return !S.week || (S.week.st === S.cur.st && S.week.wk === S.cur.wk);
}
// In RedZone: the page is at #redzone, for this week. Everything RedZone does to the page (the card
// under the field, the big view following, the 5 s poll, the feed's fetches) happens only here. The
// director itself keeps listening to every poll, so RedZone opens on a game that's happening.
const rzMode = () => location.hash === '#redzone';
function rzShown() { return !!(G && S.loaded && rzMode() && rzThisWeek()); }
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

// Inside the 20 for real. ESPN leaves isRedZone set after the drive is over: recorded 2026-10-04,
// DAL @ HOU still read red zone through 95 s of TV timeout after its field goal, until the kickoff,
// and the card sat on a game with nothing happening (user: "as soon as a field goal is kicked that
// game should no longer be the redzone feature, it should bounce around to games with activity").
// A game whose last play ended a drive is not in the red zone, whatever the flag says.
const rzInRZ = (ev) => !!(ev?.sit?.isRedZone && !RZ.dead.has(ev.id) && !isHalftime(ev));
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
  if (/kickoff|punt|touchback|fair catch/.test(t) && !(+lp.scoreValue > 0) && !/touchdown|fumble|interception|blocked|safety/.test(t)) return 'dead';
  if ((+lp.scoreValue > 0) || /touchdown|field goal good|safety/.test(t) || (scored >= 2 && !/no good|missed|blocked/.test(t))) {
    if (!/nullified|no play/i.test(text)) return 'score';
  }
  if (/interception|fumble recovery \(opp|turnover on downs|blocked|missed field goal|field goal missed/.test(t)) return 'turnover';
  if (rzInRZ(ev)) return 'redzone';
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
    // A play is news once. ESPN's scoreboard can step back to a play it showed before (the touchdown
    // again after its try's odd id), and a play the 8-bit view already ran in RedZone is not news either
    // (2026-10-04, user: "its sometimes bouncing back to plays its already shown, need logic not to show
    // the same play twice").
    let ids = RZ.seenIds.get(ev.id);
    if (!ids) { ids = new Set(); RZ.seenIds.set(ev.id, ids); }
    const again = ids.has(id) || rzPlayed(ev.id, id);
    ids.add(id);
    if (prev === undefined || prev === id || again) {
      // Same play, but the situation behind it may have moved (the red zone starts with the next snap).
      if (RZ.cur?.gid === ev.id && RZ.cur.play?.id === id) RZ.cur.play = lp;
      continue;
    }
    const delta = was != null ? total - was : 0;
    // Drive state first: a score, try, kickoff, punt or turnover ends the drive; the next snap from
    // scrimmage starts one. (A score behind a timeout ends it too.)
    const ends = (k) => k === 'score' || k === 'pat' || k === 'dead' || k === 'turnover';
    if (rzIsMeta(lp) && delta >= 2) RZ.dead.add(ev.id);
    else if (!rzIsMeta(lp)) {
      const k0 = /kickoff|punt|extra point|two-point|conversion|touchdown|field goal good|safety|interception|fumble recovery \(opp|turnover on downs|missed field goal|field goal missed|blocked/i.test(String(lp.type?.text || '')) || +lp.scoreValue > 0 || delta >= 2;
      if (k0) RZ.dead.add(ev.id); else RZ.dead.delete(ev.id);
    }
    const kind = rzClassify(ev, lp, delta);
    if (kind === 'meta') continue;
    if (!ends(kind)) RZ.lastNews.set(ev.id, now);
    const news = { play: lp, kind, prio: RZ_PRIO[kind], at: now, delta: kind === 'score' ? delta : 0 };
    const big = (k) => k === 'score' || k === 'turnover';
    if (RZ.cur?.gid === ev.id) {
      // The game on screen shows its new play where it is. A score restarts the hold; a lesser play
      // inside the hold doesn't replace it, and the try after a touchdown never does (recorded
      // 2026-10-04: TEN @ BAL's touchdown, then "Extra Point Good" two polls, 31 s, later).
      if (big(RZ.cur.kind) && (kind === 'pat' || kind === 'dead' || now - RZ.cur.since < RZ.HOLD_SCORE) && news.prio < RZ.cur.prio) continue;
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
  if (c.manual && now - c.since < RZ.HOLD_PICK) return Infinity;
  if (c.kind === 'score' && now - c.since < RZ.HOLD_SCORE) return Infinity;
  if (rzInRZ(ev)) return RZ_PRIO.redzone;
  return 0;
}
// The game to go to when no play is waiting: the red zone first, then a game that just ran a snap,
// then the game the scoreboard already ranks highest (close, late, upset watch, your GFFL players),
// less the more recently it was on. A game between drives is last.
function rzBestGame(now, except) {
  let best = null, bestS = -Infinity;
  for (const ev of S.events || []) {
    if (!rzOnAir(ev) || ev.id === except) continue;
    const s = ev.sit || {};
    const ytg = s.yardLine != null && s.possession ? (s.possession === ev.home.id ? s.yardLine : 100 - s.yardLine) : null;
    let sc = excitement(ev) + (rzInRZ(ev) ? 60 + (ytg != null ? Math.max(0, 20 - ytg) : 0) : 0);
    const act = RZ.lastNews.get(ev.id);
    if (act != null && now - act < 20000) sc += 30;
    if (RZ.dead.has(ev.id)) sc -= 80;
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
  rzFollow(gid);
}

// What the 8-bit view has shown in RedZone (sd-reenact.js marks each play it stages there). Arriving
// back at a game, a play in here is put up as it ended, not run again.
const rzPlayed = (gid, pid) => pid != null && RZ.played.has(`${gid}|${pid}`);
function rzMarkPlayed(gid, pid) { if (pid != null && rzFollowing()) RZ.played.add(`${gid}|${pid}`); }

/* ───────────── the big view follows ───────────── */
// 2026-10-04, user: "the card on the top right is changing to new plays and games but not the 8 bit
// field view, which should also be changing. also on redzone view we dont have to start with teams in
// huddles, can go straight to the play". In RedZone every cut opens that game in the game view (the
// hash stays #redzone); sd-reenact.js starts each play set at the line while rzFollowing().
const rzFollowing = () => rzActive();
function rzFollow(gid) {
  if (!rzFollowing() || !G || G.id === gid) return;
  // After the poll or tick that cut has finished (loadBoard is still mid-render when rzOnBoard cuts).
  setTimeout(() => {
    if (!rzFollowing() || !G || G.id === gid || RZ.cur?.gid !== gid) return;
    // The swap rebuilds the game view and puts it back at the top; whoever is scrolled down reading the
    // feed (a phone, mostly) stays where they were.
    const v = $('#game-view'), y = v ? v.scrollTop : 0;
    openGameView(gid);
    if (v && y) { v.scrollTop = y; requestAnimationFrame(() => { v.scrollTop = y; }); }
    // The cut: a red bar sweeps across the field as the new game comes up.
    const st = document.querySelector('#game-view .stadium');
    if (st) { st.classList.remove('rz-cut'); void st.offsetWidth; st.classList.add('rz-cut'); }
  }, 0);
}
// Into RedZone (sd-app.js's route() and ensureGame() call this for #redzone): the game view opens on
// the game RedZone is on, or the best one going, or with nothing live, the Scores tab's default game.
// False when it can't (not loaded yet, or another week is picked), and the caller lands normally.
function rzEnter() {
  if (!S.loaded || !rzThisWeek()) return false;
  if (!RZ.cur || !rzOnAir(S.byId.get(RZ.cur.gid))) rzTick(Date.now());
  const gid = RZ.cur?.gid || defaultGameId(S.events);
  if (!gid) return false;
  openGameView(gid);
  rzRender(); renderSide(); renderStrip();
  rzFeedTick();
  return true;
}
// The entries that open RedZone: the phone strip's first item, and the top of the desktop sidebar.
function rzEntryInfo() {
  const live = (S.events || []).filter((e) => e.state === 'in');
  const rz = live.filter(rzInRZ).length;
  return { live: live.length, rz, sub: live.length ? `${live.length} live${rz ? ` · ${rz} in the red zone` : ''}` : 'No games live' };
}
function rzStripItem() {
  if (!S.loaded || !rzThisWeek()) return '';
  const on = rzMode(), i = rzEntryInfo();
  return `<a class="gs-it gs-rz${on ? ' current' : ''}${i.live ? ' live' : ''}" href="#redzone"${on ? ' aria-current="page"' : ''} aria-label="RedZone: ${esc(i.sub)}"><span class="rzn-logo">Red<b>Zone</b></span><small>${esc(i.live ? `${i.live} live` : 'Off air')}</small></a>`;
}
function rzRenderEntry() {
  const a = $('#rzn-entry');
  if (!a) return;
  const on = !!(S.loaded && rzThisWeek());
  a.hidden = !on;
  if (!on) return;
  const i = rzEntryInfo(), cur = rzMode();
  a.classList.toggle('current', cur);
  if (cur) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  setHTML(a, `<span class="rzn-logo">Red<b>Zone</b></span><span class="rzn-es">${esc(i.sub)}</span><span class="rzn-eg">${cur ? 'Watching' : 'Every game, as it happens'}</span>`);
}
// The big stage is still busy with the game the card is on: it hasn't staged a play there yet (the
// game view is loading its summary), or the play is still running up to its result. A cut waits for
// it, so the big view isn't yanked away mid-play, but never longer than RZ.STAGE_MAX.
function rzStageBusy(now) {
  const c = RZ.cur;
  if (!c || !rzFollowing() || G?.id !== c.gid || typeof SIDE === 'undefined' || now - c.since >= RZ.STAGE_MAX) return false;
  if (SIDE.gameId !== c.gid || !SIDE.sc) return true;
  return !!(SIDE.running && SIDE.resultAt != null && SIDE.t < SIDE.resultAt + 1.5);
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
  if (dwell < RZ.MIN || rzStageBusy(now)) return rzRender();
  const hold = rzHold(now);
  let best = null;
  for (const [gid, n] of RZ.pending) {
    if (n.prio <= 0) continue;
    if (!best || n.prio > best.n.prio || (n.prio === best.n.prio && n.at > best.n.at)) best = { gid, n };
  }
  if (best && (best.n.prio > hold || (best.n.prio === hold && dwell >= RZ.TIE))) { rzCut(best.gid, best.n, now); return rzRender(); }
  // The drive on screen is over (its score has had its 8 s, or a punt, kickoff or turnover): go
  // where the action is now, without waiting for a quiet spell. Unless the viewer picked this game.
  if (RZ.dead.has(c.gid) && hold !== Infinity) {
    const ev = rzBestGame(now, c.gid);
    if (ev && !RZ.dead.has(ev.id)) { rzCut(ev.id, null, now); return rzRender(); }
  }
  // Nothing new worth a cut. Rotate after a quiet spell, but a game in the red zone keeps the card.
  const quiet = now - Math.max(c.since, c.at);
  const limit = rzInRZ(curEv) ? RZ.RZ_MAX : RZ.MAX;
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
  if (rzInRZ(ev)) return 'Red zone';
  return RZ_LABEL[c.kind] || '';
}
function rzChannels() {
  const live = (S.events || []).filter((e) => e.state === 'in').sort((a, b) => a.date - b.date || (a.id > b.id ? 1 : -1));
  return live.map((ev) => {
    const on = RZ.cur?.gid === ev.id, rz = rzInRZ(ev), news = RZ.pending.has(ev.id);
    return `<button class="rzn-ch${on ? ' on' : ''}${rz ? ' rz' : ''}${news ? ' news' : ''}${isHalftime(ev) ? ' half' : ''}" data-rz-game="${esc(ev.id)}" aria-pressed="${on}" aria-label="${esc(`${ev.away.name} at ${ev.home.name}${rz ? ', in the red zone' : ''}`)}">${esc(ev.away.abbr)} ${ev.away.score ?? 0}<i>·</i>${esc(ev.home.abbr)} ${ev.home.score ?? 0}</button>`;
  }).join('');
}
function rzRender() {
  rzRenderEntry();
  const el = $('#redzone'), gv = $('#game-view');
  if (!el) return;
  const on = rzShown();
  if (el.hidden === on) el.hidden = !on;
  gv?.classList.toggle('rz-mode', on);
  if (!on) return;
  if (!el.firstElementChild) {
    el.innerHTML = `<div class="rzn-h"><span class="rzn-logo">Red<b>Zone</b></span><span class="rzn-n" id="rzn-n"></span></div>
      <div class="rzn-now" id="rzn-now"></div>
      <div class="rzn-chs" id="rzn-chs" role="group" aria-label="Live games"></div>
      <div class="rzn-fh">League fantasy feed <small id="rzn-fn"></small></div>
      <div class="rzn-feed" id="rzn-feed" aria-live="off"></div>`;
  }
  const live = (S.events || []).filter((e) => e.state === 'in').length;
  $('#rzn-n').textContent = live ? `${live} live` : '';
  // Why the field is on this game: the moment RedZone cut for (or, with nothing live, the next kickoff).
  const ev = RZ.cur && S.byId.get(RZ.cur.gid);
  let now = '';
  if (ev && rzOnAir(ev)) {
    const m = rzMoment(ev, RZ.cur);
    now = `${m ? `<span class="rzn-mo k-${esc(RZ.cur.kind)}">${esc(m)}</span>` : ''}<span>On now: ${esc(ev.away.abbr)} @ ${esc(ev.home.abbr)}</span>`;
  } else if (!live) {
    const next = (S.events || []).filter((e) => e.state === 'pre').sort((a, b) => a.date - b.date)[0];
    now = `<span>No games live.${next ? ` Next kickoff: ${esc(next.away.abbr)} @ ${esc(next.home.abbr)}, ${esc(fmtTime(next.date))}` : ''}</span>`;
  }
  setHTML($('#rzn-now'), now);
  setHTML($('#rzn-chs'), rzChannels());
  $('#rzn-chs').hidden = live < 2;
  if (rzLastFeed !== el.firstElementChild) { rzLastFeed = el.firstElementChild; rzRenderFeed(); }
}
// The feed repaints when its numbers change (new plays, a box score, rosters, rules), not every tick.
let rzLastFeed = null, rzFeedTimer = 0;
if (typeof FF !== 'undefined') FF.onChange(() => { clearTimeout(rzFeedTimer); rzFeedTimer = setTimeout(rzRenderFeed, 250); });
// Mounted fresh with every game view (openGameView rebuilds it); the director's state carries over,
// so a cut doesn't reset the card.
function rzMount() {
  rzRender();
  if (rzShown()) rzFeedTick();
}

// The RedZone entries (the phone strip, the desktop sidebar): into RedZone without stacking history,
// as a tap on a game in those lists does.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href="#redzone"]');
  if (!a || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  if (rzMode()) return;
  history.replaceState(history.state, '', '#redzone');
  route();
});
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
