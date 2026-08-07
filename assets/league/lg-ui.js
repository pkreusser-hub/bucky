// lg-ui.js — GFFL views: league home, matchup (the heart), team/lineup,
// rules (view/edit/import), claim + gate. Mobile-first; league.html carries
// the styles and the shell markup this module fills.
"use strict";
(function () {
  const LG = window.LG, D = () => LG.data;
  const UI = (LG.ui = {});
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  UI.view = "league";
  UI.week = null;           // viewed league week
  UI.matchup = null;        // [homeTeamId, awayTeamId]
  let schedule = null;

  // ---------------- boot ----------------
  UI.boot = async function () {
    if (!LG.unlocked()) { renderGate(); return; }
    await LG.loadRules();
    await LG.loadTeams();
    schedule = await LG.loadSchedule();
    UI.week = LG.currentWeek() > (LG.rules.seasonWeeks + 3) ? LG.rules.seasonWeeks : LG.currentWeek();
    if (!LG.myTeamId() && LG.teams.length) { renderClaim(); return; }
    startData();
    UI.show(location.hash === "#team" ? "team" : location.hash === "#rules" ? "rules" : location.hash === "#matchup" ? "matchup" : "league");
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
    d.onUpdate = () => { paintLive(); };
    d.start();
  }

  UI.show = function (name) {
    UI.view = name;
    document.querySelectorAll(".bnav button").forEach((b) => b.classList.toggle("on", b.dataset.v === name));
    if (name === "league") renderLeague();
    else if (name === "matchup") renderMatchup();
    else if (name === "team") renderTeam();
    else if (name === "rules") renderRules();
  };
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
  async function loadStandings() {
    const weekly = await LG.db.list("weekly");
    const st = {};
    for (const t of LG.teams) st[t.id] = { w: 0, l: 0, t: 0, pf: 0, pa: 0 };
    for (const wd of weekly) {
      for (const m of (wd.matchups || [])) {
        const [h, a] = [m.home, m.away];
        if (!st[h] || !st[a]) continue;
        st[h].pf += m.homePts; st[h].pa += m.awayPts;
        st[a].pf += m.awayPts; st[a].pa += m.homePts;
        if (m.homePts > m.awayPts) { st[h].w++; st[a].l++; }
        else if (m.awayPts > m.homePts) { st[a].w++; st[h].l++; }
        else { st[h].t++; st[a].t++; }
      }
    }
    return st;
  }
  UI.renderLeague = renderLeague;
  async function renderLeague(repaint) {
    if (!repaint) {
      await loadWeekRosters();
      UI._standings = await loadStandings();
    }
    const st = UI._standings || {};
    const wkGames = schedule ? (schedule[UI.week - 1] || []) : [];
    const rows = [...LG.teams].sort((a, b) => {
      const A = st[a.id] || { w: 0, pf: 0 }, B = st[b.id] || { w: 0, pf: 0 };
      return (B.w - A.w) || (B.pf - A.pf);
    });
    main().innerHTML = `
      <div class="card">
        <div class="rowline"><h2>Week ${UI.week}</h2><span id="healthChip" class="health" hidden></span></div>
        ${schedule ? wkGames.map(([h, a]) => matchupCard(h, a)).join("") :
          `<p class="mut">No schedule yet${isCommish() ? " — generate one in Rules" : ""}.</p>`}
      </div>
      <div class="card"><h2>Standings</h2><div class="panner"><table class="tbl">
        <thead><tr><th></th><th>Team</th><th class="num">W</th><th class="num">L</th><th class="num">PF</th><th class="num">PA</th></tr></thead>
        <tbody>${rows.map((t, i) => {
          const s = st[t.id] || { w: 0, l: 0, pf: 0, pa: 0 };
          return `<tr><td class="mut">${i + 1}</td><td>${logoTd(t)}${esc(t.name)}</td>
            <td class="num">${s.w}</td><td class="num">${s.l}</td>
            <td class="num">${s.pf.toFixed(1)}</td><td class="num">${s.pa.toFixed(1)}</td></tr>`;
        }).join("")}</tbody></table></div></div>`;
    document.querySelectorAll("[data-mu]").forEach((el) => el.addEventListener("click", () => {
      UI.matchup = el.dataset.mu.split("-").map(Number);
      UI.show("matchup");
    }));
    paintHealth();
  }
  function logoTd(t) { return t.logo ? `<img class="tlogo" src="${esc(t.logo)}" alt="">` : ""; }
  function matchupCard(h, a) {
    const H = LG.teamById(h), A = LG.teamById(a);
    const mine = LG.myTeamId();
    return `<button class="mucard ${h === mine || a === mine ? "mine" : ""}" data-mu="${h}-${a}">
      <span class="muteam">${logoTd(A)}${esc(A?.name || "?")}</span>
      <span class="muscore">${LG.fmtPts(liveTotal(a))} — ${LG.fmtPts(liveTotal(h))}</span>
      <span class="muteam right">${esc(H?.name || "?")}${logoTd(H)}</span></button>`;
  }

  // ---------------- matchup (the heart) ----------------
  function myMatchupThisWeek() {
    const mine = LG.myTeamId();
    if (!schedule || !mine) return null;
    const wk = schedule[UI.week - 1] || [];
    return wk.find(([h, a]) => h === mine || a === mine) || wk[0] || null;
  }
  UI.renderMatchup = renderMatchup;
  async function renderMatchup(repaint) {
    if (!UI.matchup) UI.matchup = myMatchupThisWeek();
    if (!UI.matchup) { main().innerHTML = `<div class="card"><p class="mut">No matchup — schedule missing.</p></div>`; return; }
    if (!repaint) await loadWeekRosters();
    const d = D();
    const [hId, aId] = UI.matchup;
    const H = LG.teamById(hId), A = LG.teamById(aId);
    const hs = teamStarters(hId), as_ = teamStarters(aId);
    const hKeys = hs.map((p) => p.key), aKeys = as_.map((p) => p.key);
    const hTot = liveTotal(hId), aTot = liveTotal(aId);
    const wp = d.winProb(aKeys, hKeys); // away perspective, bar shows both
    const hRem = d.remaining(hKeys), aRem = d.remaining(aKeys);
    const rows = pairBySlots(as_, hs);
    const feed = d.S.events.filter((e) => e.msg || hKeys.includes(e.key) || aKeys.includes(e.key)).slice(0, 60);
    main().innerHTML = `
      <div class="card muhead">
        <div class="muhrow">
          <div class="muhteam">${logoTd(A)}<b>${esc(A?.name || "?")}</b><div class="bigpts">${LG.fmtPts(aTot)}</div>
            <div class="mut small">${aRem.left} to play · ${aRem.playing} live</div></div>
          <div class="muhmid">
            <div class="mut small">Week ${UI.week}</div>
            <div class="wpbar"><div class="wpfill" style="width:${Math.round(wp * 100)}%"></div></div>
            <div class="mut small">${Math.round(wp * 100)}% — ${Math.round((1 - wp) * 100)}%</div>
          </div>
          <div class="muhteam right"><b>${esc(H?.name || "?")}</b>${logoTd(H)}<div class="bigpts">${LG.fmtPts(hTot)}</div>
            <div class="mut small">${hRem.left} to play · ${hRem.playing} live</div></div>
        </div>
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
      </div></div>`;
    paintHealth();
  }
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
      <div class="card teamhead"><h2>${logoTd(T)}${esc(T.name)}</h2>
        <p class="mut">Week ${UI.week} lineup — tap a slot to swap. 🔒 = game started.</p></div>
      <div class="card">${starters.map((s, i) => rowHtml(s.slot, s.p, i)).join("")}</div>
      <div class="card"><h2>Bench</h2>${bench.length ? bench.map((p, i) => rowHtml("BENCH", p, i)).join("") : '<p class="mut">Empty bench.</p>'}</div>
      <div class="card"><h2>IR <span class="mut">(${ir.length}/${irMax})</span></h2>
        ${ir.length ? ir.map((p, i) => rowHtml("IR", p, i)).join("") : '<p class="mut">Nobody stashed.</p>'}</div>
      <div id="swapSheet" class="sheet" hidden></div>`;
    document.querySelectorAll(".lrow").forEach((b) => b.addEventListener("click", () => openSwap(b.dataset.slot, Number(b.dataset.idx))));
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
})();
