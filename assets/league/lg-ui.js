// lg-ui.js — GFFL views: league home, matchup (the heart), team/lineup,
// rules (view/edit/import), claim + gate. Mobile-first; league.html carries
// the styles and the shell markup this module fills.
"use strict";
(function () {
  const LG = window.LG, D = () => LG.data;
  const UI = (LG.ui = {});
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // Up to 2-letter initials for a team-avatar fallback (design system §"Team avatars are
  // initials on colored circles") — used only where a team has no logo on file.
  const initials = (name) => (String(name || "?").trim().split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?");

  UI.view = "league";
  UI.week = null;           // viewed league week
  UI.matchup = null;        // [homeTeamId, awayTeamId]
  UI.lockerTeamId = null;   // viewed locker
  UI._aiRead = null;        // {key, at, busy, error, mults:{name:{mult,why,proj,adj}}} — S5's AI read
  let schedule = null;
  const REACTS = ["🔥", "💀", "😂", "🐐"];
  const IMG_CAP = 80000; // ~80KB dataURL chars (design cap for chat images/logos)

  // ---------------- boot ----------------
  UI.boot = async function () {
    if (!LG.unlocked()) { renderGate(); return; }
    await LG.loadRules();
    await LG.loadTeams();
    schedule = await LG.loadSchedule();
    UI.week = LG.currentWeek() > (LG.rules.seasonWeeks + 3) ? LG.rules.seasonWeeks : LG.currentWeek();
    // Any client past a deadline can carry the league forward — no scheduled
    // function in v1 (plan §6 deviation). Awaited: this only does real work
    // once a deadline/review-window actually passed (a couple of cheap doc
    // reads otherwise), and the alternative — racing UI.show() against a
    // fire-and-forget process — is worse than a few extra ms on boot.
    if (LG.teams.length) {
      await maybeAutoProcessWaivers().catch(() => {});
      await maybeAutoExecuteTrades().catch(() => {});
      // Almost always a fast no-op here (the live engine hasn't polled anything yet at this
      // point in boot, so the finalization guard can't confirm any game is final) — the REAL
      // trigger is d.onUpdate below, once live data actually exists. Kept here too for the same
      // "any client open past a deadline carries the league forward" symmetry as the two calls
      // above, and because it costs nothing when it can't do anything. Same for the bracket
      // (S7): build it once the regular season is fully final, advance it once a playoff week
      // is — wrapped in maybeAdvanceLeague so boot and every live poll run the exact same chain.
      await maybeAdvanceLeague().catch(() => {});
    }
    if (!LG.myTeamId() && LG.teams.length) { renderClaim(); return; }
    startData();
    const h = location.hash;
    const lockerM = /^#locker=(\d+)$/.exec(h);
    if (lockerM) { UI.lockerTeamId = Number(lockerM[1]); UI.show("locker"); return; }
    UI.show(h === "#team" ? "team" : h === "#rules" ? "rules" : h === "#matchup" ? "matchup" : h === "#moves" ? "moves" : h === "#chat" ? "chat" : h === "#bracket" ? "bracket" : "league");
  };

  async function startData() {
    const d = D();
    d.initSleeper();
    // Track every team abbrev that appears in this week's league rosters.
    const abs = new Set();
    for (const t of LG.teams) {
      const ros = await LG.ensureRoster(UI.week, t.id);
      for (const p of ros) if (p.team) abs.add(d.slpTeam(p.team));
    }
    d.trackTeams([...abs]);
    // Pre-game projection snapshot (S5): chained off the SAME initSleeper() promise
    // (memoized — this never triggers a second directory fetch), so it fires once the
    // engine's projections are actually warm rather than racing them.
    d.initSleeper().then(() => { LG.snapshotProjections(UI.week).catch(() => {}); });
    // The real trigger for auto-finalization (+ S7's bracket build/advance): once live data
    // exists (after every poll — idempotent + cheap when there's nothing new to do, same
    // posture as the waiver/trade auto-processing above), any past week missing a weekly doc
    // gets carried forward, and the bracket follows right along.
    d.onUpdate = () => { paintLive(); maybeAdvanceLeague().catch(() => {}); };
    d.start();
  }

  UI.show = function (name) {
    UI.view = name;
    stopChatPoll(); // leaving whatever view had one open — chat/matchup-thread restart their own
    document.querySelectorAll(".bnav button").forEach((b) => b.classList.toggle("on", b.dataset.v === name));
    // Marks which screen main() holds so CSS alone can special-case a view's
    // layout (the desktop multi-column league-home treatment) without any
    // further JS — league.html's own stylesheet reads this attribute.
    if (main()) main().dataset.view = name;
    paintHeader();
    if (name === "league") renderLeague();
    else if (name === "matchup") renderMatchup();
    else if (name === "team") renderTeam();
    else if (name === "moves") renderMoves();
    else if (name === "rules") renderRules();
    else if (name === "chat") renderChat();
    else if (name === "locker") renderLocker();
    else if (name === "bracket") renderBracket();
  };
  // Reachable from anywhere a team name is tapped (standings, matchup header,
  // "My locker" on the team page) — plan §4.7 says lockers need no nav entry
  // of their own.
  UI.openLocker = function (teamId) {
    UI.lockerTeamId = Number(teamId);
    location.hash = "#locker=" + UI.lockerTeamId;
    UI.show("locker");
  };
  // Reachable from the league home's 🏆 Playoffs card (S7) — same no-nav-entry-needed
  // posture as lockers.
  UI.openBracket = function () {
    location.hash = "#bracket";
    UI.show("bracket");
  };
  function wireLockerTaps(root) {
    (root || document).querySelectorAll("[data-locker]").forEach((el) => el.addEventListener("click", (e) => {
      e.stopPropagation();
      UI.openLocker(Number(el.dataset.locker));
    }));
  }
  function main() { return $("#main"); }
  function paintLive() {
    if (UI.view === "matchup") renderMatchup(true);
    else if (UI.view === "league") renderLeague(true);
    else if (UI.view === "team") renderTeam(true);
    paintHealth();
  }
  function paintHealth() {
    const h = D().S.health;
    const el = $("#healthChip");
    if (!el) return;
    el.textContent = h.mode === "dual" ? "● live" : "⚠ " + h.note;
    el.className = "health " + (h.mode === "dual" ? "ok" : h.mode === "none" ? "bad" : "warn");
    el.hidden = false;
  }
  // Desktop-only header chrome (design's top-nav "WEEK 8 · 2026" + team avatar) —
  // hidden by CSS below 1024px, so this is pure decoration on mobile. Reads
  // UI.week/LG.rules/LG.myTeamId, none of which this function ever writes.
  function paintHeader() {
    const meta = $("#hMeta");
    if (!meta || !LG.rules) return;
    meta.hidden = false;
    const wkEl = $("#hWeekYear");
    if (wkEl) wkEl.textContent = UI.week != null ? "Week " + UI.week + (LG.rules.season ? " · " + LG.rules.season : "") : "";
    const av = $("#hAvatar");
    if (!av) return;
    const tid = LG.myTeamId(), T = tid ? LG.teamById(tid) : null;
    if (!T) { av.hidden = true; return; }
    av.hidden = false;
    av.innerHTML = T.logo ? `<img src="${esc(T.logo)}" alt="">` : esc(initials(T.name));
    av.title = T.name || "";
  }

  // ---------------- gate + claim ----------------
  function renderGate() {
    main().innerHTML = `<div class="card center">
      <div class="logo">🐐</div><h1>The GFFL</h1>
      <p class="mut">The Goat Fantasy Football League</p>
      <input id="gatePass" type="password" placeholder="league passphrase" autocomplete="off">
      <button id="gateGo" class="primary">Enter the league</button>
      <p id="gateErr" class="bad" hidden>That's not it.</p></div>`;
    $("#gateGo").addEventListener("click", () => {
      if (LG.tryUnlock($("#gatePass").value)) UI.boot();
      else $("#gateErr").hidden = false;
    });
  }
  function renderClaim() {
    if (main()) main().dataset.view = "claim";
    paintHeader();
    main().innerHTML = `<div class="card">
      <h2>Who are you?</h2><p class="mut">Claim your team — this device remembers.</p>
      <div id="claimList">${LG.teams.map((t) => `
        <button class="teamrow" data-tid="${t.id}">
          ${t.logo ? `<img src="${esc(t.logo)}" alt="">` : "🏈"}
          <span><b>${esc(t.name)}</b><br><small class="mut">${esc(t.owner || "")}${t.claimedBy ? " · claimed by " + esc(t.claimedBy) : ""}</small></span>
        </button>`).join("")}</div></div>`;
    document.querySelectorAll(".teamrow").forEach((b) => b.addEventListener("click", async () => {
      const tid = Number(b.dataset.tid);
      const nm = window.prompt("Your name:", LG.who() || LG.teamById(tid)?.owner || "");
      if (!nm) return;
      LG.setWho(nm); LG.setMyTeamId(tid);
      const t = LG.teamById(tid);
      await LG.saveTeam({ ...t, teamId: tid, claimedBy: nm });
      UI.boot();
    }));
  }

  // ---------------- league home ----------------
  function teamStarters(teamId) {
    return (UI._rosters && UI._rosters[teamId] || []).filter((p) => p.slot !== "BENCH" && p.slot !== "IR");
  }
  function liveTotal(teamId) {
    const d = D();
    return teamStarters(teamId).reduce((s, p) => {
      const row = d.S.players.get(p.key);
      return s + (row && row.pts != null ? row.pts : 0);
    }, 0);
  }
  async function loadWeekRosters() {
    UI._rosters = UI._rosters || {};
    for (const t of LG.teams) UI._rosters[t.id] = await LG.ensureRoster(UI.week, t.id);
  }
  UI.renderLeague = renderLeague;
  // A brand-new league has no teams until the commissioner runs the one-time
  // ESPN import — without this card a fresh device landed on an EMPTY home
  // with nothing to claim and no path forward (live 2026-08-07).
  function renderFirstRun(repaint) {
    if (repaint && $("#firstImport")) return; // never churn the button under a tap
    main().innerHTML = `<div class="card center">
      <div class="logo">🐐</div><h2>Welcome to the GFFL</h2>
      <p class="mut">The league isn't set up yet — the teams, rules and scoring
        all come in from the family's ESPN league in one step.</p>
      <button id="firstImport" class="primary">⬇ Import the league from ESPN</button>
      <p class="mut"><small>Commissioner PIN required. Everyone claims their team right after.</small></p></div>`;
    $("#firstImport").addEventListener("click", async () => {
      if (!(await LG.gateCommish())) return;
      UI.show("rules");
      await importFromEspn();
    });
  }
  // 🏆 Power rankings card (plan §4.9): the LATEST finalized week's snapshot, ordered by rank,
  // with a movement arrow against the PRIOR finalized week's own snapshot for the same team
  // (blank on week 1 — nothing to move against). Renders nothing at all until at least one week
  // is official — a ranking of an unplayed season would be meaningless.
  function powerRankingsHtml(weeklyDocs) {
    const sorted = [...(weeklyDocs || [])].filter((w) => Array.isArray(w.power) && w.power.length).sort((a, b) => b.week - a.week);
    const latest = sorted[0];
    if (!latest) return "";
    const prior = sorted.find((w) => w.week === latest.week - 1);
    const rows = [...latest.power].sort((a, b) => a.rank - b.rank).map((r) => {
      const T = LG.teamById(r.teamId);
      const prevR = prior ? (prior.power.find((p) => p.teamId === r.teamId) || {}).rank : null;
      const move = prevR == null ? '<span class="mut">–</span>'
        : prevR > r.rank ? `<span class="delta up">▲${prevR - r.rank}</span>`
        : prevR < r.rank ? `<span class="delta down">▼${r.rank - prevR}</span>`
        : '<span class="mut">–</span>';
      return `<div class="rowline"><span>#${r.rank} <span class="teamlink" data-locker="${r.teamId}">${logoTd(T)}${esc(T ? T.name : "?")}</span></span>
        <span>${move} <span class="mut small">${r.score}</span></span></div>`;
    }).join("");
    return `<div class="card"><h2>🏆 Power rankings <span class="mut">— through week ${latest.week}</span></h2>${rows}</div>`;
  }
  // 📈 Projection accuracy card (plan §5's scoreboard): our own running miss vs OUR pre-game
  // snapshots. Never rendered as a comparison to ESPN — that data isn't logged (see the S5 plan
  // entry) — and never rendered at all until there's at least one real player-week to report,
  // so the card can never make an unbacked claim.
  function accuracyHtml(acc) {
    if (!acc) return "";
    return `<div class="card"><h2>📈 Projection accuracy</h2>
      <p class="mut small">Our projections: avg miss ${acc.avg} pts/player over ${acc.n} player-week${acc.n === 1 ? "" : "s"}.</p></div>`;
  }
  // 📜 Record book card (plan §4.8): collapsed by default so it doesn't crowd the home page —
  // champions, the biggest single-week score/blowout ever, best season PF, and the all-time
  // standings, all combined from imported ESPN history + this season's own finalized weeks.
  // Empty state (nothing imported, nothing finalized yet) points the commissioner at Rules.
  function recordBookHtml(rb) {
    if (!rb) return "";
    if (!rb.hasData) {
      return `<div class="card"><details class="recordbook"><summary>📜 Record book</summary>
        <p class="mut">No history imported yet.${isCommish() ? " Import it from the Rules page." : ""}</p></details></div>`;
    }
    const champRows = rb.champs.length
      ? rb.champs.map((c) => `<div class="fline">${c.season}: <span class="teamlink" data-locker="${c.teamId}">${esc(c.name)}</span></div>`).join("")
      : '<p class="mut small">No champions on file yet.</p>';
    const hwRow = rb.highestWeek
      ? `<div class="fline"><span class="teamlink" data-locker="${rb.highestWeek.teamId}">${esc(rb.highestWeek.name)}</span> —
          ${LG.fmtPts(rb.highestWeek.pts)} <span class="mut">(wk ${rb.highestWeek.week}, ${rb.highestWeek.season})</span></div>`
      : '<p class="mut small">—</p>';
    const bbRow = rb.biggestBlowout
      ? `<div class="fline"><span class="teamlink" data-locker="${rb.biggestBlowout.homeId}">${esc(rb.biggestBlowout.homeName)}</span>
          ${LG.fmtPts(rb.biggestBlowout.homePts)} — ${LG.fmtPts(rb.biggestBlowout.awayPts)}
          <span class="teamlink" data-locker="${rb.biggestBlowout.awayId}">${esc(rb.biggestBlowout.awayName)}</span>
          <span class="mut">(margin ${LG.fmtPts(rb.biggestBlowout.margin)}, wk ${rb.biggestBlowout.week}, ${rb.biggestBlowout.season})</span></div>`
      : '<p class="mut small">—</p>';
    const pfRow = rb.bestSeasonPF
      ? `<div class="fline"><span class="teamlink" data-locker="${rb.bestSeasonPF.teamId}">${esc(rb.bestSeasonPF.name)}</span> —
          ${LG.fmtPts(rb.bestSeasonPF.pf)} <span class="mut">(${rb.bestSeasonPF.season})</span></div>`
      : '<p class="mut small">—</p>';
    return `<div class="card"><details class="recordbook">
      <summary>📜 Record book</summary>
      <h2 class="small mut">🏆 Champions</h2>${champRows}
      <h2 class="small mut">🔥 Highest single-week score ever</h2>${hwRow}
      <h2 class="small mut">💥 Biggest blowout</h2>${bbRow}
      <h2 class="small mut">📈 Best season, points for</h2>${pfRow}
      <h2 class="small mut">🐐 All-time standings</h2>
      <div class="panner"><table class="tbl">
        <thead><tr><th></th><th>Team</th><th class="num">W</th><th class="num">L</th><th class="num">PF</th><th class="num">🏆</th></tr></thead>
        <tbody>${rb.standings.map((s, i) => `<tr><td class="mut">${i + 1}</td>
            <td><span class="teamlink" data-locker="${s.teamId}">${esc(s.name)}</span></td>
            <td class="num">${s.w}</td><td class="num">${s.l}</td><td class="num">${s.pf.toFixed(1)}</td><td class="num">${s.titles}</td></tr>`).join("")}
        </tbody></table></div>
    </details></div>`;
  }
  // 🏆 Playoffs card (plan §4.10, S7): once the regular season has moved past week
  // seasonWeeks and there's no bracket yet, a prominent build prompt (commissioner-only
  // button, everyone else just sees it's coming); once a bracket exists, a quiet link
  // through to the bracket page — becomes the champion banner once one's crowned.
  function playoffsCardHtml(bracket, week, seasonWeeks, commish) {
    if (!bracket) {
      if (week <= seasonWeeks) return "";
      return `<div class="card"><h2>🏆 Playoffs</h2>
        <p class="mut">The playoff bracket hasn't been built yet.</p>
        ${commish ? '<button id="buildBracketBtn" class="primary">🏆 Build bracket</button>' : ""}</div>`;
    }
    const champTeam = bracket.champion != null ? LG.teamById(bracket.champion) : null;
    return `<div class="card"><h2>🏆 Playoffs</h2>
      ${champTeam ? `<p>🏆 <b>${esc(champTeam.name)}</b> are the ${bracket.season} GFFL Champions!</p>` : '<p class="mut">The bracket is set — best of luck.</p>'}
      <button id="openBracketBtn">${champTeam ? "🏆 View the bracket" : "View the bracket →"}</button></div>`;
  }
  async function renderLeague(repaint) {
    if (!LG.teams.length) { renderFirstRun(repaint); return; }
    if (!repaint) {
      await loadWeekRosters();
      UI._standings = await LG.loadStandings();
      UI._weeklyDoc = await LG.loadWeekly(UI.week);
      UI._allWeekly = await LG.db.list("weekly");
      UI._accuracy = await LG.seasonAccuracy();
      UI._recordBook = await LG.recordBook();
      UI._bracket = await LG.loadBracket();
      // The one source of "what's on this week" — the regular schedule for weeks <=
      // seasonWeeks, the bracket's currently-resolved pairings for a playoff week (S7).
      UI._wkGames = await LG.gamesForWeek(UI.week);
    }
    const st = UI._standings || {};
    const wkGames = UI._wkGames || [];
    const seasonWeeks = LG.rules.seasonWeeks;
    const rows = [...LG.teams].sort((a, b) => {
      const A = st[a.id] || { w: 0, pf: 0 }, B = st[b.id] || { w: 0, pf: 0 };
      return (B.w - A.w) || (B.pf - A.pf);
    });
    const finalizeBtn = (wkGames.length && isCommish() && !UI._weeklyDoc)
      ? `<div class="rowline"><button id="finalizeBtn">✅ Finalize week ${UI.week}</button></div>` : "";
    const noGamesMsg = !schedule ? `No schedule yet${isCommish() ? " — generate one in Rules" : ""}.`
      : UI.week > seasonWeeks ? "See the Playoffs card below." : "No games this week.";
    main().innerHTML = `
      <div class="card">
        <div class="rowline"><h2>Week ${UI.week}</h2><span id="healthChip" class="health" hidden></span></div>
        ${wkGames.length ? `<div class="mugrid">${wkGames.map(([h, a]) => matchupCard(h, a)).join("")}</div>` : `<p class="mut">${noGamesMsg}</p>`}
        ${finalizeBtn}
      </div>
      ${playoffsCardHtml(UI._bracket, UI.week, seasonWeeks, isCommish())}
      ${powerRankingsHtml(UI._allWeekly)}
      ${accuracyHtml(UI._accuracy)}
      <div class="card"><h2>Standings</h2><div class="panner"><table class="tbl">
        <thead><tr><th></th><th>Team</th><th class="num">W</th><th class="num">L</th><th class="num">PF</th><th class="num">PA</th></tr></thead>
        <tbody>${rows.map((t, i) => {
          const s = st[t.id] || { w: 0, l: 0, pf: 0, pa: 0 };
          return `<tr><td class="mut">${i + 1}</td><td><span class="teamlink" data-locker="${t.id}">${logoTd(t)}${esc(t.name)}</span></td>
            <td class="num">${s.w}</td><td class="num">${s.l}</td>
            <td class="num">${s.pf.toFixed(1)}</td><td class="num">${s.pa.toFixed(1)}</td></tr>`;
        }).join("")}</tbody></table></div></div>
      ${recordBookHtml(UI._recordBook)}`;
    document.querySelectorAll("[data-mu]").forEach((el) => el.addEventListener("click", () => {
      UI.matchup = el.dataset.mu.split("-").map(Number);
      UI.show("matchup");
    }));
    $("#finalizeBtn") && $("#finalizeBtn").addEventListener("click", async () => {
      if (!(await LG.gateCommish())) return;
      let r = await LG.finalizeWeek(UI.week);
      if (!r.ok && r.reason === "not-final") {
        const n = (r.pending || []).length;
        const msg = "Not every game is final yet (" + n + " starter" + (n === 1 ? "" : "s") + " still live or unresolved). Finalize anyway?";
        if (!window.confirm(msg)) return;
        r = await LG.finalizeWeek(UI.week, { force: true });
      }
      if (r.ok) {
        toast("Week " + UI.week + " finalized.");
        await LG.advanceBracket().catch(() => {}); // a playoff week just went final — walk the bracket forward right away
        UI._standings = null; UI._bracket = null;
        renderLeague();
      } else toast("Couldn't finalize: " + reasonLabel(r.reason));
    });
    $("#buildBracketBtn") && $("#buildBracketBtn").addEventListener("click", async () => {
      if (!(await LG.gateCommish())) return;
      const r = await LG.buildBracket();
      if (r.ok) { toast("Bracket built."); UI._bracket = null; renderLeague(); }
      else toast("Couldn't build bracket: " + (r.reason === "weeks-not-final" ? "week(s) " + (r.missing || []).join(", ") + " aren't final yet." : reasonLabel(r.reason)));
    });
    $("#openBracketBtn") && $("#openBracketBtn").addEventListener("click", () => UI.openBracket());
    wireLockerTaps();
    paintHealth();
  }
  function logoTd(t) { return t.logo ? `<img class="tlogo" src="${esc(t.logo)}" alt="">` : ""; }
  // 44px initial-circle avatar for the Matchup page header (design: "mine accent bg,
  // opponent #2B2D32"). Falls back to the same `.logo` field logoTd() already reads —
  // deliberately not `.logoData` too, to match logoTd()'s existing precedence exactly
  // rather than introduce a second, inconsistent notion of "the team's picture".
  function avatarHtml(t, mine) {
    const cls = "muavatar" + (mine ? " mine" : "");
    if (t && t.logo) return `<span class="${cls}"><img src="${esc(t.logo)}" alt=""></span>`;
    return `<span class="${cls}">${esc(initials(t && t.name))}</span>`;
  }
  // "All-time series" line (plan §4.8's rivalries) — h2h is from the HOME
  // team's perspective (LG.headToHead(hId, aId)), so aWins is H's wins.
  // Omitted entirely when there's no shared history yet.
  function h2hLine(h2h, H, A) {
    if (!h2h) return "";
    const total = h2h.aWins + h2h.bWins + h2h.ties;
    if (!total) return "";
    const tieSuffix = h2h.ties ? ` (${h2h.ties} tie${h2h.ties === 1 ? "" : "s"})` : "";
    if (h2h.aWins === h2h.bWins) return `<div class="mut small h2hline">All-time series: tied ${h2h.aWins}–${h2h.bWins}${tieSuffix}</div>`;
    const leaderName = h2h.aWins > h2h.bWins ? (H ? H.name : "?") : (A ? A.name : "?");
    const lead = Math.max(h2h.aWins, h2h.bWins), trail = Math.min(h2h.aWins, h2h.bWins);
    return `<div class="mut small h2hline">All-time series: ${esc(leaderName)} leads ${lead}–${trail}${tieSuffix}</div>`;
  }
  // Home-hero extras (design's "MY MATCHUP" card: LIVE badge + win-probability bar) —
  // rendered ONLY for the .mine card, reusing the same d.remaining/d.winProb math the
  // Matchup page already relies on (nothing new computed, just invoked from a second
  // spot) so the hero never disagrees with what the dedicated Matchup page shows.
  function matchupHeroExtra(h, a) {
    const d = D();
    const hKeys = teamStarters(h).map((p) => p.key), aKeys = teamStarters(a).map((p) => p.key);
    const wp = d.winProb(aKeys, hKeys); // away perspective, same convention as the matchup page
    const hRem = d.remaining(hKeys), aRem = d.remaining(aKeys);
    const anyLive = hRem.playing > 0 || aRem.playing > 0;
    const allDone = !anyLive && hRem.left === 0 && aRem.left === 0;
    const badge = anyLive ? '<span class="herobadge live"><span class="dot"></span>Live</span>'
      : allDone ? '<span class="herobadge">Final</span>' : '<span class="herobadge">Upcoming</span>';
    return `<span class="herorow">${badge}<span class="wpbar mini"><span class="wpfillmini" style="width:${Math.round(wp * 100)}%"></span></span></span>`;
  }
  function matchupCard(h, a) {
    const H = LG.teamById(h), A = LG.teamById(a);
    const mine = LG.myTeamId();
    const isMine = h === mine || a === mine;
    return `<button class="mucard ${isMine ? "mine" : ""}" data-mu="${h}-${a}">
      <span class="muteam">${logoTd(A)}${esc(A?.name || "?")}</span>
      <span class="muscore">${LG.fmtPts(liveTotal(a))} — ${LG.fmtPts(liveTotal(h))}</span>
      <span class="muteam right">${esc(H?.name || "?")}${logoTd(H)}</span>
      ${isMine ? matchupHeroExtra(h, a) : ""}</button>`;
  }

  // ---------------- 🏆 playoff bracket (plan §4.10, S7) ----------------
  // #bracket — 3 columns (mobile: stacked, via league.html's .bracketrounds media query),
  // one per playoff week: play-in + a bye list + consolation game A, semis + consolation game
  // B, championship + 3rd place + the Toilet Bowl's consolation game C. Every resolved game is
  // a tappable link into the matchup page (for THAT game's own week — a bracket game's week
  // rides along on data-wk since it's rarely the week you're currently browsing); an unresolved
  // one renders its build-time placeholder label ("Winner of #4/#5") and isn't clickable.
  UI.renderBracket = renderBracket;
  async function renderBracket() {
    const bracket = await LG.loadBracket();
    if (!bracket) {
      main().innerHTML = `<div class="card"><p class="mut">No bracket yet${isCommish() ? " — build it from the League tab once every regular-season week is final." : "."}</p></div>`;
      return;
    }
    const sw = LG.rules.seasonWeeks;
    const weeklyByWeek = {};
    weeklyByWeek[sw + 1] = await LG.loadWeekly(sw + 1);
    weeklyByWeek[sw + 2] = await LG.loadWeekly(sw + 2);
    weeklyByWeek[sw + 3] = await LG.loadWeekly(sw + 3);
    const nm = (id) => (LG.teamById(id) || {}).name || ("Team " + id);
    const champTeam = bracket.champion != null ? LG.teamById(bracket.champion) : null;
    const toiletTeam = bracket.toilet != null ? LG.teamById(bracket.toilet) : null;

    function scoreFor(g) {
      const wd = weeklyByWeek[g.week];
      if (!wd || g.home == null || g.away == null) return null;
      const m = (wd.matchups || []).find((x) => (x.home === g.home && x.away === g.away) || (x.home === g.away && x.away === g.home));
      if (!m) return null;
      return { hp: m.home === g.home ? m.homePts : m.awayPts, ap: m.home === g.home ? m.awayPts : m.homePts };
    }
    function gameHtml(g) {
      const H = g.home != null ? LG.teamById(g.home) : null;
      const A = g.away != null ? LG.teamById(g.away) : null;
      const sc = scoreFor(g);
      const homeWon = !!sc && sc.hp > sc.ap, awayWon = !!sc && sc.ap > sc.hp;
      const homeTxt = H ? esc(H.name) : esc(g.homeLabel || "TBD");
      const awayTxt = A ? esc(A.name) : esc(g.awayLabel || "TBD");
      const clickable = H && A;
      return `<button class="bgame" ${clickable ? `data-mu="${g.home}-${g.away}" data-wk="${g.week}"` : "disabled"}>
        <div class="bside ${homeWon ? "winner" : ""}"><span>${g.seedHome ? "#" + g.seedHome + " " : ""}${homeTxt}</span><span class="mut">${sc ? LG.fmtPts(sc.hp) : ""}</span></div>
        <div class="bside ${awayWon ? "winner" : ""}"><span>${g.seedAway ? "#" + g.seedAway + " " : ""}${awayTxt}</span><span class="mut">${sc ? LG.fmtPts(sc.ap) : ""}</span></div>
      </button>`;
    }
    const byeRows = bracket.seeds.slice(0, bracket.byes).map((tid, i) =>
      `<div class="byerow">#${i + 1} ${esc(nm(tid))} — bye, advances to Round 2</div>`).join("");
    const playIn = bracket.rounds.r1.filter((g) => g.kind === "playin");
    const semis = bracket.rounds.r2.filter((g) => g.kind === "semi");
    const champG = bracket.rounds.r3.find((g) => g.kind === "championship");
    const thirdG = bracket.rounds.r3.find((g) => g.kind === "third");
    const consR1 = bracket.rounds.r1.filter((g) => g.kind === "consolation");
    const consR2 = bracket.rounds.r2.filter((g) => g.kind === "consolation");
    const consR3 = bracket.rounds.r3.filter((g) => g.kind === "consolation");

    main().innerHTML = `
      ${champTeam ? `<div class="champbanner">🏆 ${esc(champTeam.name)} — ${bracket.season} GFFL CHAMPIONS!</div>` : ""}
      ${toiletTeam ? `<div class="toiletbanner">🚽 Toilet Bowl: ${esc(toiletTeam.name)}</div>` : ""}
      <div class="card"><h2>🏆 Playoff bracket</h2>
        <div class="bracketrounds">
          <div class="bracketcol">
            <h2 class="small mut">Week ${sw + 1} — play-in</h2>
            ${byeRows}
            ${playIn.map(gameHtml).join("")}
            <h2 class="small mut">Consolation</h2>
            ${consR1.map(gameHtml).join("") || '<p class="mut small">—</p>'}
          </div>
          <div class="bracketcol">
            <h2 class="small mut">Week ${sw + 2} — semifinals</h2>
            ${semis.map(gameHtml).join("")}
            <h2 class="small mut">Consolation</h2>
            ${consR2.map(gameHtml).join("") || '<p class="mut small">—</p>'}
          </div>
          <div class="bracketcol">
            <h2 class="small mut">Week ${sw + 3} — championship</h2>
            ${champG ? gameHtml(champG) : ""}
            <h2 class="small mut">3rd place</h2>
            ${thirdG ? gameHtml(thirdG) : ""}
            <h2 class="small mut">🚽 Toilet Bowl</h2>
            ${consR3.map(gameHtml).join("") || '<p class="mut small">—</p>'}
          </div>
        </div>
      </div>`;
    document.querySelectorAll("[data-mu]").forEach((el) => el.addEventListener("click", () => {
      const wk = Number(el.dataset.wk);
      if (wk) UI.week = wk;
      UI.matchup = el.dataset.mu.split("-").map(Number);
      UI.show("matchup");
    }));
    paintHealth();
  }

  // ---------------- matchup (the heart) ----------------
  // LG.gamesForWeek, not the raw schedule directly — during a playoff week (S7) that's the
  // bracket's own resolved pairings (a bye seed, or a not-yet-resolved slot, genuinely has no
  // matchup this week, which the "no matchup" fallback below already renders honestly).
  async function myMatchupThisWeek() {
    const mine = LG.myTeamId();
    if (!mine) return null;
    const wk = await LG.gamesForWeek(UI.week);
    return wk.find(([h, a]) => h === mine || a === mine) || wk[0] || null;
  }
  UI.renderMatchup = renderMatchup;
  async function renderMatchup(repaint) {
    if (!UI.matchup) UI.matchup = await myMatchupThisWeek();
    if (!UI.matchup) { main().innerHTML = `<div class="card"><p class="mut">No matchup — schedule missing.</p></div>`; return; }
    if (!repaint) await loadWeekRosters();
    const d = D();
    const [hId, aId] = UI.matchup;
    const muKey = hId + "-" + aId;
    if (!repaint || UI._h2hKey !== muKey) { UI._h2h = await LG.headToHead(hId, aId); UI._h2hKey = muKey; }
    const H = LG.teamById(hId), A = LG.teamById(aId);
    const hs = teamStarters(hId), as_ = teamStarters(aId);
    const hKeys = hs.map((p) => p.key), aKeys = as_.map((p) => p.key);
    const hTot = liveTotal(hId), aTot = liveTotal(aId);
    const wp = d.winProb(aKeys, hKeys); // away perspective, bar shows both
    const hRem = d.remaining(hKeys), aRem = d.remaining(aKeys);
    const projSum = (keys) => keys.reduce((s, k) => s + (d.projFor(k) || 0), 0);
    const hProj = projSum(hKeys), aProj = projSum(aKeys);
    const mine = LG.myTeamId();
    const anyLive = hRem.playing > 0 || aRem.playing > 0;
    const allDone = !anyLive && hRem.left === 0 && aRem.left === 0;
    const liveIndicator = anyLive ? '<div class="mulive"><span class="dot"></span>Live</div>'
      : allDone ? '<div class="mulive done">Final</div>' : "";
    const rows = pairBySlots(as_, hs);
    const feed = d.S.events.filter((e) => e.msg || hKeys.includes(e.key) || aKeys.includes(e.key)).slice(0, 60);
    const threadKey = `w${UI.week}_${hId}-${aId}`;
    main().innerHTML = `
      <div class="card muhead">
        <div class="muhrow">
          <div class="muhteam">${avatarHtml(A, aId === mine)}<b class="teamlink" data-locker="${aId}">${esc(A?.name || "?")}</b><div class="bigpts">${LG.fmtPts(aTot)}</div>
            <div class="mut small">Proj ${LG.fmtPts(aProj)}</div>
            <div class="mut small">${aRem.left} to play · ${aRem.playing} live</div></div>
          <div class="muhmid">
            ${liveIndicator}
            <div class="mut small">Week ${UI.week}</div>
            <div class="wpbar"><div class="wpfill" style="width:${Math.round(wp * 100)}%"></div></div>
            <div class="mut small">${Math.round(wp * 100)}% — ${Math.round((1 - wp) * 100)}%</div>
          </div>
          <div class="muhteam right">${avatarHtml(H, hId === mine)}<b class="teamlink" data-locker="${hId}">${esc(H?.name || "?")}</b><div class="bigpts">${LG.fmtPts(hTot)}</div>
            <div class="mut small">Proj ${LG.fmtPts(hProj)}</div>
            <div class="mut small">${hRem.left} to play · ${hRem.playing} live</div></div>
        </div>
        ${h2hLine(UI._h2h, H, A)}
        <div class="rowline"><span id="healthChip" class="health" hidden></span></div>
      </div>
      <div class="card"><div class="panner"><table class="tbl mutable"><tbody>
        ${rows.map(([pa, slot, ph]) => `<tr>
          <td class="pcell">${playerCell(pa, "left")}</td>
          <td class="slotcell">${esc(slot)}</td>
          <td class="pcell right">${playerCell(ph, "right")}</td></tr>`).join("")}
      </tbody></table></div></div>
      <div class="card"><h2>The feed</h2><div id="mufeed">
        ${feed.length ? feed.map(feedLine).join("") : '<p class="mut">Quiet so far — events land here the moment a starter does anything.</p>'}
      </div></div>
      <div class="card" id="aiReadCard"><h2>✨ AI read</h2>
        <button id="aiReadBtn" ${UI._aiRead && UI._aiRead.busy ? "disabled" : ""}>${UI._aiRead && UI._aiRead.busy ? "Reading the game…" : "✨ Get an AI read"}</button>
        <div id="aiReadOut">${aiReadHtml()}</div>
      </div>
      <div class="card"><h2>🗑️💬 Trash talk</h2>${chatWidgetHtml("muThread")}</div>`;
    $("#aiReadBtn") && $("#aiReadBtn").addEventListener("click", () => askAiRead(hId, aId, hs, as_));
    wireLockerTaps();
    wireChat("muThread", threadKey);
    refreshChatList("muThread", threadKey);
    startChatPoll("muThread", threadKey);
    paintHealth();
  }

  // ---------------- ✨ AI read (S5, plan §4.6's AI adjustment layer) ----------------
  // Button-triggered only — deliberately NOT auto-polling in v1 (preseason has no live data to
  // adjust against, and a matchup page that fires a Grok call every poll tick would spend real
  // money for nothing most of the season). One result is cached 5 minutes per matchup so a
  // second tap on the same matchup doesn't re-spend; a NEW matchup (or the cache going stale)
  // starts fresh. Degrades SILENTLY on any failure — a toast, never a broken card.
  const AI_READ_TTL = 5 * 60 * 1000;
  function aiReadKey(week, h, a) { return `w${week}_${h}-${a}`; }
  function aiReadHtml() {
    const st = UI._aiRead;
    const key = UI.matchup ? aiReadKey(UI.week, UI.matchup[0], UI.matchup[1]) : null;
    if (!st || st.key !== key) return '<p class="mut small">Tap for live adjustments to players still playing, with reasons.</p>';
    if (st.busy) return '<p class="mut small">Reading the game…</p>';
    if (st.error && !st.mults) return `<p class="mut small">${esc(st.error)}</p>`;
    const entries = Object.entries(st.mults || {});
    if (!entries.length) return '<p class="mut small">Nothing has changed enough to adjust right now.</p>';
    return entries.map(([name, m]) => {
      const projTxt = m.proj != null ? LG.fmtPts(m.proj) : "—";
      const adjTxt = m.adj != null ? LG.fmtPts(m.adj) : "—";
      return `<div class="fline">✨ <b>${esc(name)}</b> proj ${projTxt} → <b>${adjTxt}</b>
        <span class="delta ${m.mult >= 1 ? "up" : "down"}">×${m.mult.toFixed(2)}</span><br>
        <small class="mut">${esc(m.why)}</small></div>`;
    }).join("");
  }
  async function askAiRead(hId, aId, hPlayers, aPlayers) {
    const key = aiReadKey(UI.week, hId, aId);
    const cur = UI._aiRead;
    if (cur && cur.busy) return;
    if (cur && cur.key === key && cur.mults && (LG.now() - cur.at) < AI_READ_TTL) return; // fresh cache
    const d = D();
    // Roster data (name/pos/team) is authoritative and ALWAYS present; the live-poll row layers
    // stats/game-state on top when it exists. A player the poll hasn't reached yet (e.g. no stat
    // line has arrived for them this cycle) must still show their real name, not their raw key.
    const buildSide = (players) => players.map((p) => {
      const row = d.S.players.get(p.key);
      const team = (row && row.team) || p.team;
      const g = d.S.games.get(d.slpTeam(team));
      return {
        name: (row && row.name) || p.name, pos: (row && row.pos) || p.pos, team,
        proj: d.projFor(p.key), actual: row && row.pts != null ? row.pts : 0,
        gameState: g ? g.state : "pre", clock: g && g.state === "in" ? `Q${g.period} ${g.clock}` : "",
      };
    });
    const H = LG.teamById(hId), A = LG.teamById(aId);
    const payload = { week: UI.week, teams: [
      { name: H ? H.name : "Home", players: buildSide(hPlayers) },
      { name: A ? A.name : "Away", players: buildSide(aPlayers) },
    ] };
    UI._aiRead = { key, at: 0, busy: true, error: null, mults: null };
    if (UI.view === "matchup") renderMatchup(true);
    try {
      const r = await fetch("/.netlify/functions/farmgpt", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: LG.PASS, mode: "gfflproj", matchup: payload }),
      });
      if (!r.ok) throw new Error("http-" + r.status);
      const reader = r.body.getReader(), dec = new TextDecoder();
      let text = "";
      for (;;) { const c = await reader.read(); if (c.done) break; text += dec.decode(c.value, { stream: true }); }
      const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
      const parsed = JSON.parse(cleaned);
      const byName = {};
      for (const side of payload.teams) for (const p of side.players) byName[p.name] = p;
      const mults = {};
      for (const p of (parsed.players || [])) {
        if (!p || typeof p.name !== "string") continue;
        const src = byName[p.name];
        const mult = Math.max(0.5, Math.min(1.5, Number(p.mult) || 1));
        const proj = src && src.proj != null ? src.proj : null;
        mults[p.name] = {
          mult, why: String(p.why || "").slice(0, 200), proj,
          adj: proj != null ? Math.round(proj * mult * 100) / 100 : null,
        };
      }
      UI._aiRead = { key, at: LG.now(), busy: false, error: null, mults };
    } catch (e) {
      UI._aiRead = { key, at: 0, busy: false, error: "AI read isn't available right now.", mults: null };
      toast("✨ AI read isn't available right now.");
    }
    if (UI.view === "matchup") renderMatchup(true);
  }
  UI.askAiRead = askAiRead;

  function starterSlotList() {
    const r = (LG.rules && LG.rules.roster) || {};
    const out = [];
    for (const name of ["QB", "RB", "WR", "TE", "FLEX", "DST", "K"]) {
      for (let i = 0; i < (r[name] || 0); i++) out.push(name);
    }
    return out;
  }
  function pairBySlots(aList, hList) {
    const slots = starterSlotList();
    const take = (list, slot, taken) => {
      for (const p of list) if (p.slot === slot && !taken.has(p)) { taken.add(p); return p; }
      return null;
    };
    const ta = new Set(), th = new Set();
    return slots.map((s) => [take(aList, s, ta), s, take(hList, s, th)]);
  }
  function playerCell(p, side) {
    if (!p) return '<span class="mut">—</span>';
    const d = D();
    const row = d.S.players.get(p.key);
    const g = d.S.games.get(d.slpTeam(p.team));
    const pts = row && row.pts != null ? row.pts : 0;
    const proj = d.liveProj(p.key);
    const state = !g ? "" : g.state === "in" ? `<span class="live">Q${g.period} ${esc(g.clock)}</span>` : g.state === "post" ? "Final" : esc(shortKick(g));
    // Red zone marks the OFFENSE in the red zone — a D/ST row isn't on the field.
    const rz = g && g.rz && g.state === "in" && p.pos !== "DST" ? " 🔴" : "";
    const conflict = row && row.conflict ? " ⚠" : "";
    const inner = `<b>${esc(p.name)}</b>${rz}${conflict}<br><small class="mut">${esc(p.pos)} · ${esc(p.team)} · ${state}</small>`;
    const nums = `<span class="pts">${LG.fmtPts(pts)}</span><small class="mut">proj ${LG.fmtPts(proj)}</small>`;
    return side === "right" ? `<span class="pwrap right">${nums}<span>${inner}</span></span>` : `<span class="pwrap">${inner}${nums}</span>`;
  }
  function shortKick(g) {
    if (!g.kickoff) return "";
    const dt = new Date(g.kickoff);
    return dt.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
  }
  const STAT_LABEL = {
    pass_yd: "pass yds", pass_td: "pass TD", pass_int: "INT", pass_2pt: "2-pt pass",
    rush_yd: "rush yds", rush_td: "rush TD", rush_2pt: "2-pt rush",
    rec: "catch", rec_yd: "rec yds", rec_td: "rec TD", rec_2pt: "2-pt catch",
    fum_lost: "fumble lost", fg_0_39: "FG", fg_40_49: "FG 40+", fg_50: "FG 50+", fg_miss: "FG miss",
    xp_made: "XP", xp_miss: "XP miss", dst_sack: "sack", dst_int: "INT", dst_fum_rec: "fumble rec",
    dst_td: "defensive TD", dst_safety: "safety", dst_blk: "block", dst_pa: "pts allowed",
  };
  function feedLine(e) {
    const t = new Date(e.t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    if (e.msg) return `<div class="fline sys"><span class="mut">${t}</span> ${esc(e.msg)}</div>`;
    const sign = e.dPts > 0 ? "+" : "";
    const cls = e.dPts > 0 ? "up" : e.dPts < 0 ? "down" : "flat";
    return `<div class="fline"><span class="mut">${t}</span> <b>${esc(e.name)}</b>
      ${esc(STAT_LABEL[e.stat] || e.stat)} ${e.from ?? 0}→${e.to ?? 0}
      <span class="delta ${cls}">${e.dPts ? sign + e.dPts.toFixed(1) : ""}</span></div>`;
  }

  // ---------------- team / lineup ----------------
  function playerLocked(p) {
    const d = D();
    const g = d.S.games.get(d.slpTeam(p.team));
    if (!g) return false;
    if (g.state === "in" || g.state === "post") return true;
    return g.kickoff ? LG.now() >= new Date(g.kickoff).getTime() : false;
  }
  UI.renderTeam = renderTeam;
  async function renderTeam(repaint) {
    const tid = LG.myTeamId();
    const T = LG.teamById(tid);
    if (!T) { main().innerHTML = `<div class="card"><p class="mut">No team claimed.</p></div>`; return; }
    if (!repaint) await loadWeekRosters();
    const ros = (UI._rosters && UI._rosters[tid]) || [];
    const d = D();
    const slots = starterSlotList();
    const taken = new Set();
    const starters = slots.map((s) => {
      for (const p of ros) if (p.slot === s && !taken.has(p)) { taken.add(p); return { slot: s, p }; }
      return { slot: s, p: null };
    });
    const bench = ros.filter((p) => p.slot === "BENCH");
    const ir = ros.filter((p) => p.slot === "IR");
    const irMax = (LG.rules.roster && LG.rules.roster.IR) || 0;
    const rowHtml = (slot, p, idx) => `
      <button class="lrow ${p && playerLocked(p) ? "locked" : ""}" data-slot="${slot}" data-idx="${idx}">
        <span class="slotchip">${slot}</span>
        ${p ? `<span class="lname"><b>${esc(p.name)}</b> <small class="mut">${esc(p.pos)} · ${esc(p.team)}${p ? injChip(p) : ""}</small></span>
               <span class="lpts">${LG.fmtPts((d.S.players.get(p.key) || {}).pts ?? 0)}<small class="mut"> · proj ${LG.fmtPts(d.projFor(p.key))}</small></span>
               ${playerLocked(p) ? '<span class="lock">🔒</span>' : ""}`
            : '<span class="mut">empty</span>'}
      </button>`;
    main().innerHTML = `
      <div class="card teamhead rowline"><span><h2>${logoTd(T)}${esc(T.name)}</h2>
        <p class="mut">Week ${UI.week} lineup — tap a slot to swap. 🔒 = game started.</p></span>
        <button id="myLockerBtn" data-locker="${tid}">🏠 My locker</button></div>
      <div class="card">${starters.map((s, i) => rowHtml(s.slot, s.p, i)).join("")}</div>
      <div class="card"><h2>Bench</h2>${bench.length ? bench.map((p, i) => rowHtml("BENCH", p, i)).join("") : '<p class="mut">Empty bench.</p>'}</div>
      <div class="card"><h2>IR <span class="mut">(${ir.length}/${irMax})</span></h2>
        ${ir.length ? ir.map((p, i) => rowHtml("IR", p, i)).join("") : '<p class="mut">Nobody stashed.</p>'}</div>
      <div id="swapSheet" class="sheet" hidden></div>`;
    document.querySelectorAll(".lrow").forEach((b) => b.addEventListener("click", () => openSwap(b.dataset.slot, Number(b.dataset.idx))));
    wireLockerTaps();
    paintHealth();

    function injChip(p) {
      const row = d.S.players.get(p.key);
      const inj = (row && row.injury) || p.injury || "";
      return inj ? ` <span class="inj">${esc(inj)}</span>` : "";
    }
    function openSwap(slot, idx) {
      const sheet = $("#swapSheet");
      // Who currently occupies the tapped row? (data-idx indexes each list.)
      let cur = null;
      if (slot === "BENCH") cur = bench[idx];
      else if (slot === "IR") cur = ir[idx];
      else cur = (starters[idx] || {}).p || null;
      if (cur && playerLocked(cur)) { toast("🔒 " + cur.name + "'s game already started."); return; }
      let cands;
      if (slot === "IR") cands = ros.filter((p) => p.slot !== "IR" && LG.irEligible((d.S.players.get(p.key) || {}).injury || p.injury) && !playerLocked(p));
      else if (slot === "BENCH") cands = []; // bench taps: move the player somewhere else via their target slot instead
      else cands = ros.filter((p) => p !== cur && (p.slot === "BENCH" || p.slot === "IR") && LG.slotEligible(p.pos, slot) && !playerLocked(p) && (p.slot !== "IR" || true));
      if (slot === "BENCH" && cur) {
        // Tapping a bench player offers the starter slots he can fill + IR.
        const opts = starterSlotList().filter((s) => LG.slotEligible(cur.pos, s));
        const irOk = ir.length < irMax && LG.irEligible((d.S.players.get(cur.key) || {}).injury || cur.injury);
        sheet.innerHTML = `<div class="card"><h2>Move ${esc(cur.name)}</h2>
          ${[...new Set(opts)].map((s) => `<button class="swaprow" data-to="${s}">→ ${s}</button>`).join("")}
          ${irOk ? `<button class="swaprow" data-to="IR">→ IR</button>` : ""}
          <button class="swaprow mut" data-to="">Cancel</button></div>`;
        sheet.hidden = false;
        sheet.querySelectorAll(".swaprow").forEach((b) => b.addEventListener("click", () => {
          sheet.hidden = true;
          if (b.dataset.to) doMove(cur, b.dataset.to);
        }));
        return;
      }
      sheet.innerHTML = `<div class="card"><h2>${slot}: ${cur ? "swap out " + esc(cur.name) : "fill the slot"}</h2>
        ${cands.length ? cands.map((p, i) => `<button class="swaprow" data-ci="${i}">
            <b>${esc(p.name)}</b> <small class="mut">${esc(p.pos)} · ${esc(p.team)} · ${p.slot}${injChip(p)}</small>
            <span class="lpts">proj ${LG.fmtPts(d.projFor(p.key))}</span></button>`).join("")
          : '<p class="mut">Nobody eligible and unlocked.</p>'}
        <button class="swaprow mut" data-ci="">Cancel</button></div>`;
      sheet.hidden = false;
      sheet.querySelectorAll(".swaprow").forEach((b) => b.addEventListener("click", async () => {
        sheet.hidden = true;
        if (b.dataset.ci === "") return;
        const incoming = cands[Number(b.dataset.ci)];
        await swap(cur, incoming, slot);
      }));
    }
    async function doMove(p, toSlot) {
      if (toSlot === "IR" && ir.length >= irMax) { toast("IR is full (" + irMax + ")."); return; }
      if (toSlot !== "IR" && toSlot !== "BENCH") {
        // moving into a starter slot: bump the current occupant to bench
        const occ = starters.filter((s) => s.slot === toSlot).map((s) => s.p).filter(Boolean);
        const room = (LG.rules.roster[toSlot] || 0) - occ.length;
        if (room <= 0) {
          const bumped = occ[occ.length - 1];
          if (playerLocked(bumped)) { toast("🔒 " + bumped.name + " is locked in."); return; }
          bumped.slot = "BENCH";
        }
      }
      p.slot = toSlot;
      await LG.saveRoster(UI.week, tid, ros);
      renderTeam();
    }
    async function swap(outP, inP, slot) {
      if (inP.slot === "IR" && outP == null) { /* leaving IR into a starter slot directly */ }
      inP.slot = slot;
      if (outP) outP.slot = "BENCH";
      await LG.saveRoster(UI.week, tid, ros);
      renderTeam();
    }
  }
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2600);
  }
  UI.toast = toast;

  // ---------------- chat (plan §4.5) — gifs, memes, event posts, threads ----------------
  // One reusable widget (list + composer) drives BOTH the league-wide Chat tab
  // and each matchup's trash-talk thread. Only one instance is ever mounted at
  // a time (main() is a single container; the matchup page mounts its own
  // thread widget alongside the scoreboard, never simultaneously with the
  // full-page Chat tab), so static id-prefixing per instance is enough —
  // idPfx is "chat" for the league channel, "muThread" for a matchup thread.
  UI._chatState = {};
  function chatState(idPfx) {
    return UI._chatState[idPfx] || (UI._chatState[idPfx] = { replyTo: null, pendingImg: null, pendingGif: null });
  }
  function chatWidgetHtml(idPfx) {
    return `
      <div class="chatlist" id="${idPfx}List"></div>
      <div class="chatcompose">
        <div class="chatmeme" id="${idPfx}Meme" hidden></div>
        <div class="chatgifbox" id="${idPfx}GifBox" hidden>
          <input class="chatGifQ" id="${idPfx}GifQ" placeholder="Search GIFs…" autocomplete="off">
          <div class="chatGifGrid" id="${idPfx}GifGrid"></div>
        </div>
        <div class="chatReplyPreview" id="${idPfx}ReplyPreview" hidden></div>
        <div class="chatPending" id="${idPfx}Pending" hidden></div>
        <div class="chatRow">
          <button class="chaticon" id="${idPfx}ImgBtn" type="button" title="Add a photo">📷</button>
          <input type="file" accept="image/*" class="chatFileInput" id="${idPfx}FileInput" hidden>
          <button class="chaticon" id="${idPfx}MemeBtn" type="button" title="Recent images">🖼</button>
          <button class="chaticon" id="${idPfx}GifBtn" type="button" title="Search GIFs">GIF</button>
          <input class="chatText" id="${idPfx}Text" maxlength="500" placeholder="Say something…" autocomplete="off">
          <button class="chatSend primary" id="${idPfx}Send" type="button">Send</button>
        </div>
      </div>`;
  }
  // ≤320px longest side, JPEG q0.72 — the same shape as index.html's photo
  // pickers (goat/work-order), written inline here per house convention (no
  // shared JS module between pages/apps in this repo).
  function resizeImageToDataUrl(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          let w = img.width, h = img.height;
          if (w >= h && w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim; }
          else if (h > w && h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim; }
          const cv = document.createElement("canvas");
          cv.width = w || 1; cv.height = h || 1;
          cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
          resolve(cv.toDataURL("image/jpeg", quality || 0.72));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  // The single gate every image path (file pick, meme-library re-post) runs
  // through — exposed so tests can drive the oversized-refusal path directly
  // without needing a real >320px source image to prove the cap.
  UI.attachImage = function (idPfx, dataUrl) {
    if (!dataUrl || dataUrl.length > IMG_CAP) { toast("That photo is too big — try a smaller one."); return false; }
    const st = chatState(idPfx);
    st.pendingImg = dataUrl; st.pendingGif = null;
    showPendingPreview(idPfx, dataUrl);
    return true;
  };
  function showPendingPreview(idPfx, src) {
    const el = $("#" + idPfx + "Pending");
    if (!el) return;
    el.hidden = false;
    el.innerHTML = `<img src="${esc(src)}"><button class="chatPendingX" type="button">✕</button>`;
    el.querySelector(".chatPendingX").addEventListener("click", () => clearPendingPreview(idPfx));
  }
  function clearPendingPreview(idPfx) {
    const st = chatState(idPfx);
    st.pendingImg = null; st.pendingGif = null;
    const el = $("#" + idPfx + "Pending");
    if (el) { el.hidden = true; el.innerHTML = ""; }
  }
  function setReplyTo(idPfx, m) {
    const st = chatState(idPfx);
    const who = m.sys ? "GFFL" : ((LG.teamById(m.teamId) || {}).name || m.who || "?");
    const snippet = m.text || (m.img ? "[photo]" : m.gif ? "[gif]" : "");
    st.replyTo = { id: m.id, who, text: snippet };
    const el = $("#" + idPfx + "ReplyPreview");
    if (!el) return;
    el.hidden = false;
    el.innerHTML = `<span class="mut small">↩ replying to <b>${esc(who)}</b>: ${esc(snippet.slice(0, 60))}</span> <button class="chatReplyX" type="button">✕</button>`;
    el.querySelector(".chatReplyX").addEventListener("click", () => clearReplyPreview(idPfx));
  }
  function clearReplyPreview(idPfx) {
    chatState(idPfx).replyTo = null;
    const el = $("#" + idPfx + "ReplyPreview");
    if (el) { el.hidden = true; el.innerHTML = ""; }
  }
  // Probed once per page session on the first GIF-button tap (never on load —
  // a blocked/no-key Tenor should never cost a request nobody asked for).
  // Only the literal "gif-not-configured" reason hides the button for good;
  // any other hiccup (network blip, http-500) leaves it retryable.
  UI._gifAvailable = null;
  async function ensureGifAvailability() {
    if (UI._gifAvailable === false) return false;
    if (UI._gifAvailable === true) return true;
    try {
      const r = await lgFn("lg_gif_search", { q: "" });
      if (r && r.ok === false && r.reason === "gif-not-configured") { UI._gifAvailable = false; return false; }
      UI._gifAvailable = true;
      return true;
    } catch (e) { return true; }
  }
  async function runGifSearch(idPfx) {
    const qInp = $("#" + idPfx + "GifQ"), grid = $("#" + idPfx + "GifGrid");
    if (!qInp || !grid) return;
    const q = qInp.value.trim();
    if (q.length < 2) { grid.innerHTML = ""; return; }
    let r;
    try { r = await lgFn("lg_gif_search", { q }); } catch (e) { r = null; }
    if (!$("#" + idPfx + "GifGrid")) return; // widget torn down mid-search
    if (!r || !r.ok) { grid.innerHTML = '<p class="mut small">GIF search isn\'t available right now.</p>'; return; }
    const gifs = r.gifs || [];
    grid.innerHTML = gifs.length
      ? gifs.map((g, i) => `<button class="gifThumb" type="button" data-gi="${i}"><img src="${esc(g.preview)}" loading="lazy" alt=""></button>`).join("")
      : '<p class="mut small">No results.</p>';
    grid.querySelectorAll("[data-gi]").forEach((b) => b.addEventListener("click", () => {
      const g = gifs[Number(b.dataset.gi)];
      const st = chatState(idPfx);
      st.pendingGif = g; st.pendingImg = null;
      const box = $("#" + idPfx + "GifBox");
      if (box) box.hidden = true;
      showPendingPreview(idPfx, g.preview);
    }));
  }
  // Meme library: the most recent distinct images already posted ANYWHERE in
  // chat — the "house classics" picker (plan §4.5).
  async function toggleMemeLibrary(idPfx) {
    const el = $("#" + idPfx + "Meme");
    if (!el) return;
    if (!el.hidden) { el.hidden = true; return; }
    el.innerHTML = '<p class="mut small">Loading…</p>';
    el.hidden = false;
    const imgs = await LG.recentChatImages(12);
    if (!$("#" + idPfx + "Meme")) return;
    el.innerHTML = imgs.length
      ? imgs.map((src, i) => `<button class="memeThumb" type="button" data-mi="${i}"><img src="${esc(src)}" loading="lazy" alt=""></button>`).join("")
      : '<p class="mut small">No images posted yet.</p>';
    el.querySelectorAll("[data-mi]").forEach((b) => b.addEventListener("click", () => {
      UI.attachImage(idPfx, imgs[Number(b.dataset.mi)]);
      el.hidden = true;
    }));
  }
  function openImageOverlay(src) {
    const ov = $("#imgOverlay"), img = $("#imgOverlayImg");
    if (!ov || !img) return;
    img.src = src;
    ov.hidden = false;
  }
  UI.openImageOverlay = openImageOverlay;
  function chatMsgHtml(m, byId, tid) {
    if (m.sys) {
      const when = new Date(m.t).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
      return `<div class="chatRowMsg" data-mid="${esc(m.id || "")}"><div class="chatSys">📣 ${esc(m.text || "")} <span class="mut small">${when}</span></div></div>`;
    }
    const mine = m.teamId === tid;
    const team = LG.teamById(m.teamId);
    const name = esc((team && team.name) || m.who || "?");
    const when = new Date(m.t).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
    const replied = m.replyTo && byId && byId.get && byId.get(m.replyTo);
    const replyBlock = replied
      ? `<div class="chatQuote">↩ ${esc((LG.teamById(replied.teamId) || {}).name || replied.who || "?")}: ${esc((replied.text || (replied.img ? "[photo]" : replied.gif ? "[gif]" : "")).slice(0, 80))}</div>`
      : "";
    const imgSrc = m.img ? m.img : (m.gif ? (m.gif.preview || m.gif.url) : "");
    const imgFull = m.img ? m.img : (m.gif ? m.gif.url : "");
    const canDelete = mine || isCommish();
    return `<div class="chatRowMsg" data-mid="${esc(m.id || "")}">
      <div class="chatBubble ${mine ? "mine" : ""}">
        <div class="chatMeta"><b>${name}</b> <span class="mut small">${when}</span></div>
        ${replyBlock}
        ${m.text ? `<div class="chatText2">${esc(m.text)}</div>` : ""}
        ${imgSrc ? `<img class="chatImg" src="${esc(imgSrc)}" data-full="${esc(imgFull)}" loading="lazy" alt="">` : ""}
        <div class="chatActions">
          ${REACTS.map((e) => `<button class="chatReact" type="button" data-mid="${esc(m.id)}" data-e="${e}">${e}${((m.reactions || {})[e] || []).length ? " " + (m.reactions[e] || []).length : ""}</button>`).join("")}
          <button class="chatReply" type="button" data-mid="${esc(m.id)}" title="Reply">↩</button>
          ${canDelete ? `<button class="chatDel" type="button" data-mid="${esc(m.id)}" title="Delete">🗑</button>` : ""}
        </div>
      </div></div>`;
  }
  function wireChatMsgEvents(idPfx, listEl, thread) {
    listEl.querySelectorAll(".chatReact").forEach((b) => b.addEventListener("click", async () => {
      await LG.toggleReaction(b.dataset.mid, b.dataset.e, LG.myTeamId());
      refreshChatList(idPfx, thread);
    }));
    listEl.querySelectorAll(".chatReply").forEach((b) => b.addEventListener("click", async () => {
      const msgs = await LG.loadChat(thread || null);
      const m = msgs.find((x) => x.id === b.dataset.mid);
      if (m) setReplyTo(idPfx, m);
    }));
    listEl.querySelectorAll(".chatDel").forEach((b) => b.addEventListener("click", async () => {
      const r = await LG.deleteChat(b.dataset.mid, LG.myTeamId(), isCommish());
      if (r.ok) refreshChatList(idPfx, thread); else toast("Couldn't delete that.");
    }));
    listEl.querySelectorAll(".chatImg").forEach((img) => img.addEventListener("click", () => openImageOverlay(img.dataset.full)));
  }
  async function refreshChatList(idPfx, thread) {
    const listEl = $("#" + idPfx + "List");
    if (!listEl) return;
    const msgs = await LG.loadChat(thread || null);
    if (!$("#" + idPfx + "List")) return; // torn down mid-fetch (view switched)
    const wasNearBottom = !listEl.dataset.rendered || (listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight) < 80;
    const last = msgs.slice(-80);
    const byId = new Map(msgs.map((m) => [m.id, m]));
    const tid = LG.myTeamId();
    listEl.innerHTML = last.length ? last.map((m) => chatMsgHtml(m, byId, tid)).join("") : '<p class="mut">No messages yet — say hi!</p>';
    listEl.dataset.rendered = "1";
    wireChatMsgEvents(idPfx, listEl, thread);
    if (wasNearBottom) listEl.scrollTop = listEl.scrollHeight;
  }
  UI.refreshChatList = refreshChatList;
  function wireChat(idPfx, thread) {
    const st = chatState(idPfx);
    st.replyTo = null; st.pendingImg = null; st.pendingGif = null;
    const textEl = $("#" + idPfx + "Text"), sendBtn = $("#" + idPfx + "Send");
    if (!textEl || !sendBtn) return;
    const send = async () => {
      const text = textEl.value.trim();
      const s = chatState(idPfx);
      if (!text && !s.pendingImg && !s.pendingGif) return;
      const payload = { thread: thread || null };
      if (text) payload.text = text;
      if (s.pendingImg) payload.img = s.pendingImg;
      if (s.pendingGif) payload.gif = s.pendingGif;
      if (s.replyTo) payload.replyTo = s.replyTo.id;
      const r = await LG.postChat(payload);
      if (!r || !r.ok) { toast("Couldn't send that."); return; }
      textEl.value = "";
      clearPendingPreview(idPfx);
      clearReplyPreview(idPfx);
      await refreshChatList(idPfx, thread);
    };
    sendBtn.addEventListener("click", send);
    textEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); send(); } });
    const imgBtn = $("#" + idPfx + "ImgBtn"), fileInput = $("#" + idPfx + "FileInput");
    if (imgBtn && fileInput) {
      imgBtn.addEventListener("click", () => fileInput.click());
      fileInput.addEventListener("change", async (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = "";
        if (!file) return;
        try { UI.attachImage(idPfx, await resizeImageToDataUrl(file, 320, 0.72)); }
        catch (err) { toast("Couldn't read that photo."); }
      });
    }
    const memeBtn = $("#" + idPfx + "MemeBtn");
    if (memeBtn) memeBtn.addEventListener("click", () => toggleMemeLibrary(idPfx));
    const gifBtn = $("#" + idPfx + "GifBtn");
    if (gifBtn) {
      if (UI._gifAvailable === false) gifBtn.hidden = true;
      gifBtn.addEventListener("click", async () => {
        const avail = await ensureGifAvailability();
        if (!avail) { gifBtn.hidden = true; return; }
        const box = $("#" + idPfx + "GifBox");
        if (!box) return;
        box.hidden = !box.hidden;
        if (!box.hidden) $("#" + idPfx + "GifQ").focus();
      });
      const qInp = $("#" + idPfx + "GifQ");
      let gifDebounce;
      qInp.addEventListener("input", () => {
        clearTimeout(gifDebounce);
        gifDebounce = setTimeout(() => runGifSearch(idPfx), 300);
      });
    }
  }
  UI._chatTimer = null;
  function startChatPoll(idPfx, thread) {
    if (UI._chatTimer && UI._chatTimer.pfx === idPfx && UI._chatTimer.thread === (thread || null)) return; // already running
    stopChatPoll();
    const h = setInterval(() => refreshChatList(idPfx, thread), 8000);
    UI._chatTimer = { h, pfx: idPfx, thread: thread || null };
  }
  function stopChatPoll() {
    if (UI._chatTimer) { clearInterval(UI._chatTimer.h); UI._chatTimer = null; }
  }
  UI.renderChat = renderChat;
  async function renderChat() {
    main().innerHTML = `<div class="card chatcard"><h2>League chat</h2>${chatWidgetHtml("chat")}</div>`;
    wireChat("chat", null);
    await refreshChatList("chat", null);
    startChatPoll("chat", null);
  }

  // ---------------- moves (waivers, trades, transaction log) ----------------
  UI._tradeGive = new Set();
  UI._tradeGet = new Set();
  function allOwnedKeys() {
    const s = new Set();
    for (const t of LG.teams) for (const p of ((UI._rosters && UI._rosters[t.id]) || [])) s.add(p.key);
    return s;
  }
  function nameOfKey(key) {
    for (const t of LG.teams) {
      const p = ((UI._rosters && UI._rosters[t.id]) || []).find((x) => x.key === key);
      if (p) return p.name;
    }
    return key;
  }
  async function maybeAutoProcessWaivers() {
    if (!LG.teams.length) return;
    const wk = UI.week || LG.currentWeek();
    if (LG.now() < LG.waiverDeadline(wk)) return;
    const doc = await LG.loadClaims(wk);
    if (!doc.processed && (doc.claims || []).length) await LG.processWaivers(wk);
  }
  async function maybeAutoExecuteTrades() {
    if (!LG.teams.length) return;
    const trades = await LG.loadTrades();
    for (const tr of trades) {
      if (tr.status === "accepted" && LG.now() >= (tr.reviewEndsAt || Infinity)) await LG.executeTrade(tr.id);
    }
  }
  // S5: any past week (week < currentWeek()) with no weekly doc yet gets carried forward —
  // idempotent (LG.finalizeWeek's own doc-exists check) and self-limiting (it naturally refuses
  // — "not-final" — until the live engine actually confirms every relevant game is over), so
  // calling this often and from several places (boot, every poll update, every Moves visit) is
  // cheap and safe rather than something that needs its own scheduling. NEVER touches the
  // CURRENT week (week === currentWeek()) — that's what the commissioner's explicit "Finalize"
  // button on the league home is for.
  async function maybeAutoFinalizeWeeks() {
    if (!LG.teams.length) return;
    const cw = LG.currentWeek();
    for (let w = 1; w < cw; w++) {
      const doc = await LG.loadWeekly(w);
      if (doc && doc.kind === "weekly") continue;
      await LG.finalizeWeek(w);
    }
  }
  // S7: once the regular season has moved on past it (currentWeek() > seasonWeeks) and no
  // bracket exists yet, build it. LG.buildBracket() itself refuses (harmlessly) until every
  // regular-season week is actually final, so calling this eagerly/often is safe.
  async function maybeAutoBuildBracket() {
    if (!LG.teams.length) return;
    const sw = (LG.rules || LG.DEFAULT_RULES).seasonWeeks;
    if (LG.currentWeek() <= sw) return;
    if (await LG.loadBracket()) return;
    await LG.buildBracket();
  }
  // S7: fills in whatever the bracket can resolve from finalized playoff weeks — a no-op once
  // a champion is crowned, and a no-op with no bracket built yet.
  async function maybeAutoAdvanceBracket() {
    if (!LG.teams.length) return;
    const bracket = await LG.loadBracket();
    if (!bracket || bracket.champion != null) return;
    await LG.advanceBracket();
  }
  // The one chain boot() and every live poll run: finalize whatever's ready, build the bracket
  // once the regular season is fully final, finalize again (that may have just unlocked a
  // playoff week's own games), advance the bracket a few times so a boot that lands well past
  // the whole postseason (all playoff weeks' data already sitting there final) can walk the
  // bracket all the way to a champion in one pass rather than needing 3 separate visits.
  async function maybeAdvanceLeague() {
    if (!LG.teams.length) return;
    await maybeAutoFinalizeWeeks().catch(() => {});
    await maybeAutoBuildBracket().catch(() => {});
    for (let i = 0; i < 3; i++) {
      await maybeAutoFinalizeWeeks().catch(() => {});
      await maybeAutoAdvanceBracket().catch(() => {});
    }
  }
  UI.maybeAutoProcessWaivers = maybeAutoProcessWaivers;
  UI.maybeAutoExecuteTrades = maybeAutoExecuteTrades;
  UI.maybeAutoFinalizeWeeks = maybeAutoFinalizeWeeks;
  UI.maybeAutoBuildBracket = maybeAutoBuildBracket;
  UI.maybeAutoAdvanceBracket = maybeAutoAdvanceBracket;
  UI.maybeAdvanceLeague = maybeAdvanceLeague;
  const REASON_LABEL = {
    outbid: "outbid by a higher blind bid", "player-taken": "taken by another claim",
    "drop-gone": "your drop player was gone", "insufficient-faab": "not enough FAAB",
    "already-processed": "this week's claims already processed", "drop-not-found": "that player isn't on your roster",
  };
  function reasonLabel(r) { return REASON_LABEL[r] || r; }
  function txSentence(tx) {
    const nm = (id) => (LG.teamById(id) || {}).name || ("Team " + id);
    if (tx.type === "waiver") return `${nm(tx.teamId)} won a waiver claim: added ${tx.detail.addName} ($${tx.detail.bid}), dropped ${tx.detail.dropName || tx.detail.dropKey}.`;
    if (tx.type === "fa_add") return `${nm(tx.teamId)} added ${tx.detail.addName} (free agency).`;
    if (tx.type === "drop") return `${nm(tx.teamId)} dropped ${tx.detail.dropName || tx.detail.dropKey}.`;
    if (tx.type === "trade" && tx.detail.result === "executed")
      return `Trade: ${nm(tx.detail.from)} sent ${(tx.detail.giveNames || tx.detail.give || []).join(", ")} to ${nm(tx.detail.to)} for ${(tx.detail.getNames || tx.detail.get || []).join(", ")}.`;
    if (tx.type === "trade" && tx.detail.result === "vetoed")
      return `Trade between ${nm(tx.detail.from)} and ${nm(tx.detail.to)} was vetoed by the league.`;
    return "Transaction.";
  }
  UI.renderMoves = renderMoves;
  async function renderMoves() {
    const tid = LG.myTeamId();
    const T = LG.teamById(tid);
    await loadWeekRosters();
    await maybeAutoProcessWaivers();
    await maybeAutoExecuteTrades();
    await maybeAutoFinalizeWeeks();
    UI._trades = await LG.loadTrades();
    UI._claims = await LG.loadClaims(UI.week);
    UI._tx = await LG.loadTx();
    if (!T) { main().innerHTML = `<div class="card"><p class="mut">No team claimed.</p></div>`; return; }

    const past = LG.now() >= LG.waiverDeadline(UI.week);
    const myClaims = (UI._claims.claims || []).filter((c) => c.teamId === tid);
    const myTrades = (UI._trades || []).filter((tr) => (tr.from === tid || tr.to === tid) && (tr.status === "offered" || tr.status === "accepted"));
    const reviewTrades = (UI._trades || []).filter((tr) => tr.status === "accepted" && tr.from !== tid && tr.to !== tid);

    const claimRow = (c) => `<div class="rowline"><span>🎯 ${esc(c.addName)} <span class="mut">(${esc(c.addPos)}·${esc(c.addTeam)})</span> ← drop ${esc(c.dropName || c.dropKey)} · $${c.bid}</span>
      <button class="mvcancel" data-cid="${esc(c.id)}">Cancel</button></div>`;
    const tradeRow = (tr) => {
      const mine = tr.from === tid;
      const otherId = mine ? tr.to : tr.from;
      const give = (mine ? tr.give : tr.get).map(nameOfKey).join(", ");
      const get = (mine ? tr.get : tr.give).map(nameOfKey).join(", ");
      let actions = "";
      if (tr.status === "offered") {
        if (tr.to === tid) actions = `<button class="mvaccept" data-tid="${tr.id}">Accept</button> <button class="mvdecline" data-tid="${tr.id}">Decline</button>`;
        else if (tr.from === tid) actions = `<button class="mvcanceltrade" data-tid="${tr.id}">Cancel</button>`;
      } else if (tr.status === "accepted") {
        actions = `<span class="mut small">reviews until ${new Date(tr.reviewEndsAt).toLocaleString()}</span>`;
      }
      return `<div class="rowline"><span>🔁 You give ${esc(give)} → get ${esc(get)} <span class="mut">(${esc((LG.teamById(otherId) || {}).name || "?")}) · ${esc(tr.status)}</span></span>${actions}</div>`;
    };
    const reviewRow = (tr) => {
      const already = (tr.vetoes || []).includes(tid);
      return `<div class="rowline"><span>⚖ ${esc((LG.teamById(tr.from) || {}).name)} ↔ ${esc((LG.teamById(tr.to) || {}).name)}
        <span class="mut">· ${(tr.vetoes || []).length}/${LG.rules.trades.vetoVotes} vetoes</span></span>
        ${already ? '<span class="mut small">voted</span>' : `<button class="mvveto" data-tid="${tr.id}">🚫 Veto</button>`}</div>`;
    };
    const myResultsHtml = (() => {
      if (!UI._claims.processed) return "";
      const claimsById = new Map((UI._claims.claims || []).map((c) => [c.id, c]));
      const mine = (UI._claims.results || []).filter((r) => { const c = claimsById.get(r.id); return c && c.teamId === tid; });
      if (!mine.length) return "";
      return `<h2 class="small mut">Your results — week ${UI._claims.week}</h2><div id="mvResults">` + mine.map((r) => {
        const c = claimsById.get(r.id);
        return `<div class="fline">${r.ok ? "✅ Won " + esc(c.addName) + "!" : "❌ " + esc(c.addName) + ": " + esc(reasonLabel(r.reason))}</div>`;
      }).join("") + "</div>";
    })();

    const others = LG.teams.filter((t) => t.id !== tid);
    const cpId = (UI._tradeCp && others.some((t) => t.id === UI._tradeCp)) ? UI._tradeCp : (others[0] && others[0].id);
    UI._tradeCp = cpId;
    const myRoster = (UI._rosters && UI._rosters[tid]) || [];
    const cpRoster = (UI._rosters && UI._rosters[cpId]) || [];
    const chip = (p, set) => `<button class="swaprow pickchip ${set.has(p.key) ? "picked" : ""}" data-gk="${esc(p.key)}">
        <b>${esc(p.name)}</b> <small class="mut">${esc(p.pos)} · ${esc(p.team)} · ${esc(p.slot)}</small></button>`;

    main().innerHTML = `
      <div class="card"><h2>My pending</h2>
        <h2 class="small mut">Your waiver claims</h2>
        <div id="mvMyClaims">${myClaims.length ? myClaims.map(claimRow).join("") : '<p class="mut">No pending claims.</p>'}</div>
        <h2 class="small mut">Your trades</h2>
        <div id="mvMyTrades">${myTrades.length ? myTrades.map(tradeRow).join("") : '<p class="mut">No pending trades.</p>'}</div>
        ${reviewTrades.length ? `<h2 class="small mut">Trades under review — league vote</h2><div id="mvReviewTrades">${reviewTrades.map(reviewRow).join("")}</div>` : ""}
        ${myResultsHtml}
      </div>
      <div class="card"><h2>Waivers</h2>
        <div class="rowline"><span class="mut small">💰 $<span id="mvFaab">${LG.teamFaab(T)}</span> FAAB remaining</span>
          ${isCommish() ? '<button id="mvProcessNow">⚙ Process now</button>' : ""}</div>
        <p class="mut small">${past ? "Free agency is open — first come, first served." : "Claims process Wed 8:00 AM (" + new Date(LG.waiverDeadline(UI.week)).toLocaleString() + ")."}</p>
        <p class="mut small">Adding/dropping a player isn't locked by kickoff — only your starting lineup is.</p>
        <input id="faSearch" placeholder="Search free agents…" autocomplete="off">
        <div id="faResults"></div>
      </div>
      <div class="card"><h2>Propose a trade</h2>
        <select id="mvTradeTeam">${others.map((t) => `<option value="${t.id}" ${t.id === cpId ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select>
        <h2 class="small mut">You give (up to 3)</h2>
        <div id="mvGive">${myRoster.map((p) => chip(p, UI._tradeGive)).join("") || '<p class="mut">Empty roster.</p>'}</div>
        <h2 class="small mut">You get (up to 3)</h2>
        <div id="mvGet">${cpRoster.map((p) => chip(p, UI._tradeGet)).join("") || '<p class="mut">Nobody on their roster.</p>'}</div>
        <input id="mvTradeNote" placeholder="Note (optional)">
        <button id="mvTradeSend" class="primary">Send offer</button>
      </div>
      <div class="card"><h2>Transaction log</h2><div id="mvLog">
        ${UI._tx.length ? UI._tx.map((tx) => `<div class="fline sys"><span class="mut">${new Date(tx.t).toLocaleString()}</span> ${esc(txSentence(tx))}</div>`).join("") : '<p class="mut">No moves yet.</p>'}
      </div></div>
      <div id="claimSheet" class="sheet" hidden></div>`;

    document.querySelectorAll(".mvcancel").forEach((b) => b.addEventListener("click", async () => {
      await LG.cancelClaim(UI.week, b.dataset.cid, tid);
      renderMoves();
    }));
    document.querySelectorAll(".mvaccept").forEach((b) => b.addEventListener("click", async () => {
      await LG.acceptTrade(b.dataset.tid, tid);
      toast("Trade accepted — review window started.");
      renderMoves();
    }));
    document.querySelectorAll(".mvdecline").forEach((b) => b.addEventListener("click", async () => {
      await LG.declineTrade(b.dataset.tid, tid);
      toast("Trade declined.");
      renderMoves();
    }));
    document.querySelectorAll(".mvcanceltrade").forEach((b) => b.addEventListener("click", async () => {
      await LG.cancelTrade(b.dataset.tid, tid);
      toast("Offer cancelled.");
      renderMoves();
    }));
    document.querySelectorAll(".mvveto").forEach((b) => b.addEventListener("click", async () => {
      await LG.vetoTrade(b.dataset.tid, tid);
      renderMoves();
    }));
    $("#mvProcessNow") && $("#mvProcessNow").addEventListener("click", async () => {
      if (!(await LG.gateCommish())) return;
      await LG.processWaivers(UI.week);
      toast("Waivers processed.");
      renderMoves();
    });

    const faInput = $("#faSearch");
    faInput.addEventListener("input", () => {
      const q = faInput.value.trim();
      const el = $("#faResults");
      if (q.length < 3) { el.innerHTML = ""; return; }
      const list = D().searchFA(q, allOwnedKeys(), 20);
      renderFaResults(list);
    });
    function renderFaResults(list) {
      const el = $("#faResults");
      if (list == null) { el.innerHTML = '<p class="mut">Player search is warming up — try again in a moment.</p>'; return; }
      if (!list.length) { el.innerHTML = '<p class="mut">No matches.</p>'; return; }
      el.innerHTML = list.map((p, i) => `<button class="swaprow" data-fi="${i}">
          <b>${esc(p.name)}</b> <small class="mut">${esc(p.pos)} · ${esc(p.team)}${p.injury ? ' <span class="inj">' + esc(p.injury) + "</span>" : ""}</small></button>`).join("");
      el.querySelectorAll("[data-fi]").forEach((b) => b.addEventListener("click", () => openClaimSheet(list[Number(b.dataset.fi)])));
    }
    function openClaimSheet(fa) {
      const sheet = $("#claimSheet");
      const ros = myRoster;
      let chosen = null;
      sheet.innerHTML = `<div class="card"><h2>${past ? "Add" : "Claim"} ${esc(fa.name)}</h2>
        <p class="mut">${esc(fa.pos)} · ${esc(fa.team)}</p>
        <h2 class="small mut">Drop</h2>
        ${ros.map((p, i) => `<button class="swaprow" data-di="${i}"><b>${esc(p.name)}</b> <small class="mut">${esc(p.pos)} · ${esc(p.team)} · ${esc(p.slot)}</small></button>`).join("")}
        ${!past ? `<input id="claimBid" type="number" min="0" max="${LG.teamFaab(T)}" value="0" placeholder="FAAB bid ($)">` : ""}
        <button id="claimGo" class="primary" disabled>${past ? "Add" : "Submit claim"}</button>
        <button class="swaprow mut" id="claimCancel">Cancel</button></div>`;
      sheet.hidden = false;
      sheet.querySelectorAll("[data-di]").forEach((b) => b.addEventListener("click", () => {
        chosen = ros[Number(b.dataset.di)];
        sheet.querySelectorAll("[data-di]").forEach((x) => x.classList.remove("picked"));
        b.classList.add("picked");
        $("#claimGo").disabled = false;
      }));
      $("#claimCancel").addEventListener("click", () => { sheet.hidden = true; });
      $("#claimGo").addEventListener("click", async () => {
        if (!chosen) return;
        sheet.hidden = true;
        if (past) {
          const r = await LG.faAdd(UI.week, tid, fa, chosen.key);
          if (r.ok) { toast("Added " + fa.name + "."); UI._rosters = null; renderMoves(); }
          else toast("Couldn't add: " + reasonLabel(r.reason));
        } else {
          const raw = Number(($("#claimBid") || {}).value) || 0;
          const bid = Math.max(0, Math.min(LG.teamFaab(T), raw));
          const claim = {
            id: "claim_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
            teamId: tid, addKey: fa.key, addName: fa.name, addPos: fa.pos, addTeam: fa.team,
            dropKey: chosen.key, dropName: chosen.name, bid, t: Date.now(),
          };
          await LG.addClaim(UI.week, claim);
          toast("Claim submitted: " + fa.name + " for $" + bid + ".");
          renderMoves();
        }
      });
    }

    $("#mvTradeTeam").addEventListener("change", (e) => {
      UI._tradeCp = Number(e.target.value);
      UI._tradeGet = new Set();
      renderMoves();
    });
    document.querySelectorAll("#mvGive .pickchip").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.gk;
      if (UI._tradeGive.has(k)) { UI._tradeGive.delete(k); b.classList.remove("picked"); }
      else { if (UI._tradeGive.size >= 3) { toast("Up to 3 players."); return; } UI._tradeGive.add(k); b.classList.add("picked"); }
    }));
    document.querySelectorAll("#mvGet .pickchip").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.gk;
      if (UI._tradeGet.has(k)) { UI._tradeGet.delete(k); b.classList.remove("picked"); }
      else { if (UI._tradeGet.size >= 3) { toast("Up to 3 players."); return; } UI._tradeGet.add(k); b.classList.add("picked"); }
    }));
    $("#mvTradeSend").addEventListener("click", async () => {
      if (!UI._tradeGive.size || !UI._tradeGet.size) { toast("Pick at least one player on each side."); return; }
      const r = await LG.offerTrade(tid, UI._tradeCp, [...UI._tradeGive], [...UI._tradeGet], $("#mvTradeNote").value.trim());
      if (r.ok) { toast("Trade offer sent."); UI._tradeGive = new Set(); UI._tradeGet = new Set(); renderMoves(); }
      else toast("Couldn't send offer: " + reasonLabel(r.reason));
    });
  }

  // ---------------- rules ----------------
  function isCommish() { return LG.commishUnlocked(); }
  UI.renderRules = renderRules;
  async function renderRules() {
    const r = LG.rules;
    const doc = LG.rulesDoc || { v: 0, log: [] };
    const sec = (title, obj, pfx) => `<div class="card"><h2>${title}</h2><div class="panner"><table class="tbl">
      <tbody>${Object.keys(obj).map((k) => `<tr><td>${esc(k)}</td>
        <td class="num"><span class="rv" data-k="${pfx}.${k}">${esc(String(obj[k]))}</span></td></tr>`).join("")}
      </tbody></table></div></div>`;
    main().innerHTML = `
      <div class="card rowline"><h2>League rules <span class="mut">v${doc.v}</span></h2>
        <span>
          <button id="rulesEdit">${isCommish() ? "✏️ Edit" : "🔒 Commissioner"}</button>
          <button id="rulesImport" ${isCommish() ? "" : "hidden"}>⬇ Import from ESPN</button>
          <button id="schedGen" ${isCommish() ? "" : "hidden"}>📅 ${schedule ? "Regenerate" : "Generate"} schedule</button>
          <button id="rostersImport" ${isCommish() ? "" : "hidden"}>👥 Import ESPN rosters</button>
          <button id="historyImport" ${isCommish() ? "" : "hidden"}>📜 Import history</button>
        </span></div>
      <div class="card mut small">${esc(r.name)} · season ${r.season} · ${r.seasonWeeks}-week regular season ·
        FAAB $${r.waivers.budget} · ${r.playoffs.teams}-team playoffs (top ${r.playoffs.byes} get byes, 4v5 play-in) ·
        keepers: max ${r.keepers.max}, cost = last round −${r.keepers.costRoundsEarlier} (floor R${r.keepers.costFloor}),
        ${r.keepers.maxYears} straight years max, waiver pickups cost your last pick ·
        trades: ${r.trades.reviewHours}h review, ${r.trades.vetoVotes} votes veto, deadline wk ${r.trades.deadlineWeek}</div>
      ${sec("Scoring", r.scoring, "scoring")}
      ${sec("Roster", r.roster, "roster")}
      ${sec("Waivers", r.waivers, "waivers")}
      ${sec("Trades", r.trades, "trades")}
      ${sec("Keepers", r.keepers, "keepers")}
      ${sec("Playoffs", r.playoffs, "playoffs")}
      <div class="card"><h2>Change log</h2>${(doc.log || []).slice(-15).reverse().map((e) =>
        `<div class="fline sys"><span class="mut">${new Date(e.t).toLocaleString()}</span> <b>${esc(e.who)}</b><br>
         <small>${e.changes.map(esc).join("<br>")}</small></div>`).join("") || '<p class="mut">No changes yet.</p>'}</div>
      <div id="importOut"></div>`;
    $("#rulesEdit").addEventListener("click", async () => {
      if (!(await LG.gateCommish())) return;
      enterEdit();
    });
    $("#rulesImport") && $("#rulesImport").addEventListener("click", async () => {
      if (!(await LG.gateCommish())) return;
      await importFromEspn();
    });
    $("#schedGen") && $("#schedGen").addEventListener("click", async () => {
      if (!(await LG.gateCommish())) return;
      const weeks = LG.generateSchedule(LG.teams.map((t) => t.id), LG.rules.seasonWeeks);
      await LG.saveSchedule(weeks);
      schedule = weeks;
      toast("Schedule saved: " + weeks.length + " weeks.");
      renderRules();
    });
    $("#rostersImport") && $("#rostersImport").addEventListener("click", async () => {
      if (!(await LG.gateCommish())) return;
      await importRosters();
    });
    $("#historyImport") && $("#historyImport").addEventListener("click", async () => {
      if (!(await LG.gateCommish())) return;
      await importHistory();
    });
    function enterEdit() {
      document.querySelectorAll(".rv").forEach((el) => {
        const v = el.textContent;
        el.innerHTML = `<input class="redit" data-k="${el.dataset.k}" value="${esc(v)}">`;
      });
      $("#rulesEdit").textContent = "💾 Save";
      $("#rulesEdit").replaceWith($("#rulesEdit").cloneNode(true));
      $("#rulesEdit").addEventListener("click", async () => {
        const next = JSON.parse(JSON.stringify(LG.rules));
        document.querySelectorAll(".redit").forEach((inp) => {
          const [g, k] = inp.dataset.k.split(".");
          const raw = inp.value.trim();
          const num = Number(raw);
          next[g][k] = raw !== "" && !isNaN(num) ? num : raw;
        });
        const changes = await LG.saveRules(next, LG.who());
        toast(changes.length ? changes.length + " rule change(s) saved + logged." : "No changes.");
        renderRules();
      });
    }
  }

  // ---------------- lockers (plan §4.7) ----------------
  function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  // Chat messages that mention this team's name or its abbrev — "the wall".
  async function lockerWallMessages(T) {
    const all = await LG.loadAllChat(); // already newest-first
    const nameRe = T.name ? new RegExp(escapeRegex(T.name), "i") : null;
    const abRe = T.abbrev ? new RegExp("(^|[^a-z0-9])" + escapeRegex(T.abbrev) + "([^a-z0-9]|$)", "i") : null;
    return all.filter((m) => !m.sys && m.text && ((nameRe && nameRe.test(m.text)) || (abRe && abRe.test(m.text)))).slice(0, 15);
  }
  // Schedule + results so far — "—" for anything not yet finalized (weekly
  // docs don't exist until S5's finalization; this degrades honestly).
  async function lockerScheduleRows(teamId) {
    if (!schedule) return '<tr><td colspan="3" class="mut">No schedule yet.</td></tr>';
    const weekly = await LG.db.list("weekly");
    return schedule.map((wk, i) => {
      const g = wk.find(([h, a]) => h === teamId || a === teamId);
      if (!g) return `<tr><td>${i + 1}</td><td class="mut">BYE</td><td class="num mut">—</td></tr>`;
      const [h, a] = g;
      const oppId = h === teamId ? a : h;
      const opp = LG.teamById(oppId);
      const wd = weekly.find((w) => w.week === i + 1);
      let result = "—";
      if (wd) {
        const m = (wd.matchups || []).find((mm) => (mm.home === h && mm.away === a) || (mm.home === a && mm.away === h));
        if (m) {
          const mine = h === teamId ? m.homePts : m.awayPts;
          const other = h === teamId ? m.awayPts : m.homePts;
          result = `${mine > other ? "W" : mine < other ? "L" : "T"} ${LG.fmtPts(mine)}-${LG.fmtPts(other)}`;
        }
      }
      return `<tr><td>${i + 1}</td><td>${esc(opp ? opp.name : "?")}</td><td class="num mut">${esc(result)}</td></tr>`;
    }).join("");
  }
  // Rivalries (plan §4.8): this team's all-time head-to-head vs every OTHER
  // current franchise, skipping any pair with zero shared history (nothing
  // to show yet — not the same as "0-0"). Sorted by most wins first.
  async function lockerRivalries(teamId) {
    const rows = [];
    for (const t of LG.teams) {
      if (t.id === teamId) continue;
      const h2h = await LG.headToHead(teamId, t.id);
      if (h2h.aWins + h2h.bWins + h2h.ties === 0) continue;
      rows.push({ id: t.id, name: t.name, w: h2h.aWins, l: h2h.bWins, t: h2h.ties });
    }
    rows.sort((a, b) => (b.w - a.w) || (a.name || "").localeCompare(b.name || ""));
    return rows;
  }
  // Dominant SATURATED colour of a data: image, sampled from a small canvas —
  // one bucket-by-hue pass, mid-lightness pick. Computed ONCE at upload time
  // (never per render — plan §4.7); the upload flow always hands this a
  // data: URL (the just-resized logo), so canvas tainting never applies here.
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0; const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h, s, l };
  }
  function extractPalette(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        try {
          const S = 32;
          const cv = document.createElement("canvas");
          cv.width = S; cv.height = S;
          const ctx = cv.getContext("2d");
          ctx.drawImage(img, 0, 0, S, S);
          const data = ctx.getImageData(0, 0, S, S).data;
          const buckets = new Map(); // 10°-wide hue bucket -> {count,r,g,b}
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] < 128) continue; // transparent
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const { h, s, l } = rgbToHsl(r, g, b);
            if (s < 0.18 || l < 0.12 || l > 0.92) continue; // grayish / near-black / near-white
            const hb = Math.floor(h / 10) % 36;
            const rec = buckets.get(hb) || { count: 0, r: 0, g: 0, b: 0 };
            rec.count++; rec.r += r; rec.g += g; rec.b += b;
            buckets.set(hb, rec);
          }
          if (!buckets.size) { resolve({ primary: null }); return; }
          let best = null;
          for (const rec of buckets.values()) if (!best || rec.count > best.count) best = rec;
          resolve({ primary: `rgb(${Math.round(best.r / best.count)},${Math.round(best.g / best.count)},${Math.round(best.b / best.count)})` });
        } catch (e) { reject(e); }
      };
      img.src = src;
    });
  }
  UI.extractPalette = extractPalette;
  function wireLockerEdit(T) {
    const nameBtn = $("#lockerEditName");
    if (nameBtn) nameBtn.addEventListener("click", async () => {
      const v = window.prompt("Team name:", T.name || "");
      if (v == null) return;
      const name = v.trim().slice(0, 60);
      if (!name) return;
      await LG.saveTeam({ ...T, teamId: T.id, name });
      await LG.loadTeams();
      UI.openLocker(T.id);
    });
    const mottoBtn = $("#lockerEditMotto");
    if (mottoBtn) mottoBtn.addEventListener("click", async () => {
      const v = window.prompt("Team motto (max 80 chars):", T.motto || "");
      if (v == null) return;
      const motto = v.trim().slice(0, 80);
      await LG.saveTeam({ ...T, teamId: T.id, motto });
      await LG.loadTeams();
      UI.openLocker(T.id);
    });
    const logoBtn = $("#lockerEditLogo"), logoInput = $("#lockerLogoInput");
    if (logoBtn && logoInput) {
      logoBtn.addEventListener("click", () => logoInput.click());
      logoInput.addEventListener("change", async (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = "";
        if (!file) return;
        try {
          const dataUrl = await resizeImageToDataUrl(file, 240, 0.82);
          if (dataUrl.length > IMG_CAP) { toast("That logo is too big — try a smaller image."); return; }
          let colors = T.colors;
          try { const p = await extractPalette(dataUrl); if (p && p.primary) colors = { primary: p.primary }; } catch (e2) { /* fall back to existing/no colour */ }
          await LG.saveTeam({ ...T, teamId: T.id, logoData: dataUrl, colors });
          await LG.loadTeams();
          toast("Logo updated.");
          UI.openLocker(T.id);
        } catch (err) { toast("Couldn't read that image."); }
      });
    }
  }
  UI.renderLocker = renderLocker;
  async function renderLocker() {
    const teamId = UI.lockerTeamId;
    const T = LG.teamById(teamId);
    if (!T) { main().innerHTML = `<div class="card"><p class="mut">Team not found.</p></div>`; return; }
    main().innerHTML = `<div class="card mut">Loading locker…</div>`;
    const [standings, tx, wall, scheduleRows, roster, rivalries, recordBook] = await Promise.all([
      LG.loadStandings(), LG.loadTx(), lockerWallMessages(T), lockerScheduleRows(teamId), LG.ensureRoster(UI.week, teamId),
      lockerRivalries(teamId), LG.recordBook(),
    ]);
    // S7: the season's own GFFL playoff trophy lives on the team doc (advanceBracket writes it
    // the moment a champion's crowned — long before any January history import would pick it
    // up), so it's merged in alongside the S6 history banners here rather than waiting a year.
    // Dedupe by season, in case a January import ever re-adds the same season from history.
    const historyBanners = (recordBook.champs || []).filter((c) => c.teamId === teamId);
    const liveBanners = (T.trophies || []).filter((tr) => tr.kind === "champion").map((tr) => ({ season: tr.year, teamId, name: T.name }));
    const bannerSeasons = new Set(historyBanners.map((b) => b.season));
    const banners = [...historyBanners, ...liveBanners.filter((b) => !bannerSeasons.has(b.season))].sort((a, b) => a.season - b.season);
    const st = standings[teamId] || { w: 0, l: 0, t: 0, pf: 0, pa: 0 };
    const rows = [...LG.teams].sort((a, b) => { const A = standings[a.id] || { w: 0, pf: 0 }, B = standings[b.id] || { w: 0, pf: 0 }; return (B.w - A.w) || (B.pf - A.pf); });
    const place = rows.findIndex((t) => t.id === teamId) + 1;
    const isOwner = LG.myTeamId() === teamId;
    const teamTx = tx.filter((t) => t.teamId === teamId || (t.type === "trade" && (t.detail.from === teamId || t.detail.to === teamId)));
    const primary = T.colors && T.colors.primary;
    const logoSrc = T.logoData || T.logo || "";
    main().innerHTML = `
      <div class="lockerhead" style="${primary ? `background:${esc(primary)};` : ""}">
        <div class="lockerhead-inner">
          ${logoSrc ? `<img class="lockerlogo" src="${esc(logoSrc)}" alt="">` : `<div class="lockerlogo lockerlogo-ph">🏈</div>`}
          <div class="lockerid">
            <h1 class="lockername">${esc(T.name)}</h1>
            <p class="lockermotto">${T.motto ? esc(T.motto) : (isOwner ? '<span class="mut">Add a motto →</span>' : "")}</p>
            <p class="lockerrec">#${place} · ${st.w}-${st.l}${st.t ? "-" + st.t : ""} · ${st.pf.toFixed(1)} PF</p>
          </div>
        </div>
        ${isOwner ? `<div class="lockeredit">
          <button id="lockerEditName">✏️ Name</button>
          <button id="lockerEditMotto">✏️ Motto</button>
          <button id="lockerEditLogo">🖼 Logo</button>
          <input type="file" accept="image/*" id="lockerLogoInput" hidden></div>` : ""}
      </div>
      <div class="card"><h2>Roster — week ${UI.week}</h2>${roster.length ? `<div class="panner"><table class="tbl"><tbody>
        ${roster.map((p) => `<tr><td>${esc(p.slot)}</td><td>${esc(p.name)}</td><td class="mut">${esc(p.pos)} · ${esc(p.team)}</td></tr>`).join("")}
      </tbody></table></div>` : '<p class="mut">No roster yet.</p>'}</div>
      <div class="card"><h2>Schedule</h2><div class="panner"><table class="tbl">
        <thead><tr><th>Wk</th><th>Opp</th><th class="num">Result</th></tr></thead>
        <tbody>${scheduleRows}</tbody></table></div></div>
      <div class="card"><h2>Transactions</h2>${teamTx.length ? teamTx.map((t) => `<div class="fline sys"><span class="mut">${new Date(t.t).toLocaleDateString()}</span> ${esc(txSentence(t))}</div>`).join("") : '<p class="mut">No moves yet.</p>'}</div>
      ${banners.length ? `<div class="card"><h2>🏆 Championships</h2>${banners.map((c) => `<div class="fline">🏆 ${c.season}</div>`).join("")}</div>` : ""}
      <div class="card"><h2>Rivalries</h2>${rivalries.length ? `<div class="panner"><table class="tbl">
          <thead><tr><th>Opponent</th><th class="num">W</th><th class="num">L</th><th class="num">T</th></tr></thead>
          <tbody>${rivalries.map((r) => `<tr><td><span class="teamlink" data-locker="${r.id}">${esc(r.name)}</span></td>
            <td class="num">${r.w}</td><td class="num">${r.l}</td><td class="num">${r.t}</td></tr>`).join("")}</tbody></table></div>`
        : '<p class="mut">No history against current opponents yet.</p>'}</div>
      <div class="card"><h2>The wall</h2>${wall.length ? wall.map((m) => chatMsgHtml(m, new Map(), LG.myTeamId())).join("") : "<p class=\"mut\">Nobody's mentioned them yet.</p>"}</div>`;
    document.querySelectorAll(".chatImg").forEach((img) => img.addEventListener("click", () => openImageOverlay(img.dataset.full)));
    wireLockerTaps();
    if (isOwner) wireLockerEdit(T);
    paintHealth();
  }

  async function lgFn(action, extra) {
    const r = await fetch("/.netlify/functions/league", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: LG.PASS, action, ...(extra || {}) }),
    });
    return r.json();
  }
  UI.lgFn = lgFn;
  async function importFromEspn() {
    const out = $("#importOut");
    out.innerHTML = '<div class="card mut">Importing the real league from ESPN…</div>';
    let j;
    try { j = await lgFn("lg_espn_settings"); } catch (e) { j = { ok: false, reason: String(e) }; }
    if (!j.ok) { out.innerHTML = `<div class="card bad">Import failed: ${esc(j.reason || "?")}</div>`; return; }
    const next = JSON.parse(JSON.stringify(LG.rules));
    Object.assign(next.scoring, j.scoring || {});
    // Roster slots from ESPN, but the GFFL decisions stay: 3 IR (user call).
    if (j.slots && Object.keys(j.slots).length) {
      next.roster = { ...j.slots };
      if (next.roster["Bench"] != null) { next.roster.BENCH = next.roster["Bench"]; delete next.roster["Bench"]; }
      next.roster.IR = 3;
    }
    if (j.regularSeasonWeeks) next.seasonWeeks = j.regularSeasonWeeks;
    if (j.trade && j.trade.reviewHours != null) next.trades.reviewHours = j.trade.reviewHours;
    if (j.trade && j.trade.vetoVotesRequired != null) next.trades.vetoVotes = j.trade.vetoVotesRequired;
    const changes = LG.diffRules(LG.rules, next);
    out.innerHTML = `<div class="card"><h2>ESPN import — ${esc(j.leagueName || "")} (${j.season})</h2>
      ${changes.length ? `<small>${changes.map(esc).join("<br>")}</small>` : '<p class="mut">Everything already matches.</p>'}
      ${j.unmapped && j.unmapped.length ? `<p class="warn">⚠ Unmapped scoring items (review): ${esc(JSON.stringify(j.unmapped))}</p>` : '<p class="mut">Every ESPN scoring item mapped cleanly.</p>'}
      <button id="importApply" class="primary">Apply</button></div>`;
    $("#importApply").addEventListener("click", async () => {
      await LG.saveRules(next, LG.who() + " (ESPN import)");
      // Seed/refresh the 8 teams too.
      for (const t of (j.teams || [])) {
        const cur = LG.teamById(t.id) || {};
        await LG.saveTeam({ ...cur, teamId: t.id, name: t.name, abbrev: t.abbrev, logo: t.logo, owner: t.owner });
      }
      await LG.loadTeams();
      toast("Rules + teams imported.");
      // Fresh league: the importer hasn't claimed a team yet — go straight to
      // the claim screen instead of leaving them on the rules page.
      if (!LG.myTeamId()) { UI.boot(); return; }
      renderRules();
    });
  }
  async function importRosters() {
    const out = $("#importOut");
    out.innerHTML = '<div class="card mut">Importing current ESPN rosters…</div>';
    let j;
    try { j = await lgFn("lg_espn_rosters"); } catch (e) { j = { ok: false, reason: String(e) }; }
    if (!j.ok) { out.innerHTML = `<div class="card bad">Import failed: ${esc(j.reason || "?")}</div>`; return; }
    const slots = starterSlotList();
    for (const t of (j.teams || [])) {
      const taken = {};
      const players = (t.players || []).map((p) => {
        let slot = "BENCH";
        const want = p.lineupSlot === "IR" ? "IR" : slots.find((s) => LG.slotEligible(p.pos, s) && (taken[s] = (taken[s] || 0)) < (LG.rules.roster[s] || 0) && ++taken[s]);
        if (p.lineupSlot === "IR") slot = "IR";
        else if (want) slot = want;
        return {
          key: p.pos === "DST" ? "dst_" + D().slpTeam(p.proTeam) : String(p.espnId),
          name: p.name, pos: p.pos, team: p.proTeam, slot, injury: p.injury || "",
        };
      });
      await LG.saveRoster(UI.week, t.id, players);
    }
    UI._rosters = null;
    out.innerHTML = `<div class="card ok">Rosters imported for ${(j.teams || []).length} teams (week ${UI.week}).</div>`;
  }
  // One-time (plus each January — plan §4.8) ESPN history import: walk
  // seasons backward from last year, one action call each, writing
  // `hist_<season>` docs as they land. Stops at the first miss ONCE at
  // least one season has actually imported (a January re-run naturally
  // stops right after the newest already-imported season, since that's
  // the first year it now finds nothing new); before any success, gives
  // up after 3 consecutive misses (an empty/never-existed league, or the
  // real league simply doesn't go back that far) rather than grinding all
  // the way to 2015 on every miss. Re-running always overwrites — the
  // January refresh case.
  async function importHistory() {
    const out = $("#importOut");
    const startYear = ((LG.rules && LG.rules.season) || LG.SEASON) - 1;
    const imported = [];
    let consecFails = 0;
    for (let y = startYear; y >= 2015; y--) {
      out.innerHTML = `<div class="card mut">Importing ${y}…${imported.length ? " (" + imported.length + " season" + (imported.length === 1 ? "" : "s") + " so far)" : ""}</div>`;
      let j;
      try { j = await lgFn("lg_espn_history", { season: y }); } catch (e) { j = { ok: false, reason: String(e) }; }
      if (j.ok) {
        await LG.db.set("hist_" + y, {
          kind: "hist", season: y, leagueName: j.leagueName || "",
          teams: j.teams || [], champion: j.champion || null, matchups: j.matchups || [],
        });
        imported.push(y);
        consecFails = 0;
      } else {
        if (imported.length) break; // stop at the first miss once we've had a success
        consecFails++;
        if (consecFails >= 3) break; // give up after 3 straight misses with nothing found yet
      }
    }
    if (!imported.length) {
      out.innerHTML = '<div class="card bad">No importable seasons found (checked back from ' + startYear + ').</div>';
      return;
    }
    imported.sort((a, b) => a - b);
    const range = imported.length > 1 ? `${imported[0]}–${imported[imported.length - 1]}` : `${imported[0]}`;
    out.innerHTML = `<div class="card ok">Imported ${imported.length} season${imported.length === 1 ? "" : "s"}: ${range}.</div>`;
    UI._recordBook = null; // stale — reload next time the league home renders
  }
})();
