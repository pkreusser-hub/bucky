#!/usr/bin/env node
// tools/robogoat/build.mjs — build one RoboGoat issue page from its source files.
//
//   node tools/robogoat/build.mjs robogoat/2026/week-3            (one issue)
//   node tools/robogoat/build.mjs --all                           (every issue under robogoat/)
//   node tools/robogoat/build.mjs robogoat/2026/week-3 --check    (exit 1 if index.html is stale)
//
// An issue directory holds:
//   column.md    the column as edited: SUBJECT/KICKER/MASTHEAD/SUBHEAD header lines, then the body
//                ("## Section", "### Game heading", "[IMAGE: board|stars|bench|wp|season]", paragraphs)
//   issue.json   everything that is not prose: teams, scores, records, stars, chart annotations
//   wp.json      (recaps) the charted game's raw wpgraph series, so the build never needs the network
// and the season directory holds season.json: RoboGoat's picks and rankings by week (written by
// hand), and each finished week's bench, scores and top starters (written once by facts.mjs). Output is a static, zero-JS page: index.html.
//
// Number formatting mirrors the original Python builder exactly (round-half-even on the binary
// value), so a rebuild of an already-published issue is byte-identical unless its inputs changed.
"use strict";

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { ROOT } from "./lib.mjs";
import { picksProblems, rankingProblems } from "./analysis.mjs";

// ---------------------------------------------------------------- formatting
/** Python's f"{x:.{d}f}": correctly rounded, ties to even on the exact binary value. */
export function fx(x, d) {
  x = Number(x);
  const s = x.toFixed(Math.min(100, d + 30));
  const dot = s.indexOf(".");
  const tail = s.slice(dot + 1 + d);
  if (/^50*$/.test(tail)) {
    const base = s.slice(0, dot + 1 + d).replace(/\.$/, "");
    if (Number(base.slice(-1)) % 2 === 0) return base === "-0" ? "0" : base;
  }
  return x.toFixed(d);
}
const f1 = (x) => fx(x, 1);
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };
export const esc = (s) => String(s).replace(/[&<>]/g, (c) => ESC[c]);
export const attr = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
/** Escaped prose: curly quotes, and scores/records (35-27, 2-1) never split at the hyphen. */
export function typo(s) {
  let t = esc(s);
  t = t.replace(/(^|[\s(\[])"/g, (m, a) => a + "\u201c");
  t = t.replaceAll('"', "\u201d").replaceAll("'", "\u2019");
  return t.replace(/\b(\d+-\d+)\b/g, '<span class="nw">$1</span>');
}
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export function longDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DAYS[dt.getUTCDay()]}, ${MONTHS[m - 1]} ${d}, ${y}`;
}
/** Minutes east of UTC for America/Chicago at instant t (CDT -300, CST -360). */
function chicagoOffsetMin(t) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", timeZoneName: "shortOffset" }).formatToParts(new Date(t));
  const m = /GMT([+-]\d+)(?::(\d+))?/.exec(p.find((x) => x.type === "timeZoneName").value);
  return m ? Number(m[1]) * 60 + Math.sign(Number(m[1])) * Number(m[2] || 0) : 0;
}
/** UTC ms of Chicago midnight at the start of the Chicago day containing t. */
function chicagoMidnight(t) {
  const off = chicagoOffsetMin(t) * 60e3;
  const local = t + off;
  return local - (((local % 864e5) + 864e5) % 864e5) - off;
}

// ---------------------------------------------------------------- the page
export function buildIssue(dir) {
  const D = resolve(ROOT, dir);
  const issue = JSON.parse(readFileSync(join(D, "issue.json"), "utf8"));
  const md = readFileSync(join(D, "column.md"), "utf8");
  const wpData = existsSync(join(D, "wp.json")) ? JSON.parse(readFileSync(join(D, "wp.json"), "utf8")) : {};
  const seasonFile = join(D, "..", "season.json");
  const season = existsSync(seasonFile) ? JSON.parse(readFileSync(seasonFile, "utf8")) : {};
  const W = issue.week, RECAP = issue.type === "recap";
  // The hand-written picks columns must agree with the scores: season.json's pick results, this
  // issue's picksWeek / picksRecord / picks. Weeks are paired from season.json (facts.mjs keeps the
  // pairings) or, for an older week, from that week's recap issue.json.
  const pairings = (w) => {
    const sw = season.weeks && season.weeks[String(w)];
    if (sw && sw.games) return sw.games;
    const f = join(D, "..", `week-${w}`, "issue.json");
    return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).games.map((g) => ({ away: g.away, home: g.home })) : null;
  };
  const pp = picksProblems(season, issue, pairings);
  if (pp.length) throw new Error(`${dir}: picks do not agree with the scores:\n  ` + pp.join("\n  "));
  const rootRel = relative(D, join(ROOT, "robogoat")).split("\\").join("/") || ".";

  const TEAMS = issue.teams; // id -> { name, owner, color, short }
  const tm = (id) => TEAMS[String(id)];
  const BYNAME = Object.fromEntries(Object.entries(TEAMS).map(([id, t]) => [t.name, Number(id)]));
  const REC = issue.records; // id -> "2-1"
  const LOGO = (tid) => `${rootRel}/logos/team-${tid}.jpg`;
  const logo = (tid, cls = "lg") => `<img class="${cls}" src="${LOGO(tid)}" alt="" width="40" height="40">`;
  // A tied game has no winner (it used to count as a home win).
  const WON = new Set((issue.games || []).filter((g) => g.awayPts != null && g.awayPts !== g.homePts).map((g) => (g.awayPts > g.homePts ? g.away : g.home)));
  const HEAD = "https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/{}.png&w=280&h=203";
  // Two decimals only where one decimal would print a tie between different numbers.
  const showVals = (vals) => {
    const shown = vals.map(f1);
    return vals.map((v, i) => (shown.some((s, j) => j !== i && s === shown[i] && vals[j] !== v) ? fx(v, 2) : shown[i]));
  };

  // ---------------- graphics
  function board() {
    let cards = "";
    for (const g of issue.games) {
      const row = (t, p, win) => {
        const { name, owner, color } = tm(t);
        const score = p == null ? "" : `<div class="ts">${f1(p)}</div>`;
        return `<div class="tr${win ? " win" : ""}" style="--tc:${color}">${logo(t)}` +
          `<div class="tn"><b>${esc(name)}</b><span>${owner} · <span class="nw">${REC[t]}</span></span></div>${score}</div>`;
      };
      const done = g.awayPts != null;
      cards += `<div class="game">${row(g.away, g.awayPts, done && g.awayPts > g.homePts)}${row(g.home, g.homePts, done && g.homePts > g.awayPts)}<p class="gn">${typo(g.note)}</p></div>`;
    }
    const side = RECAP
      ? `${issue.window}<br><b>RoboGoat picks: <span class="nw">${issue.picksWeek}</span></b>`
      : `${issue.window}<br><b>Picks record: <span class="nw">${issue.picksRecord}</span></b>`;
    return `<section class="board${RECAP ? "" : " pre"}" aria-label="Week ${W} ${RECAP ? "final scores" : "matchups"}"><div class="bhead"><div><span class="kick">Week ${W}</span>` +
      `<span class="final">${RECAP ? "Final" : "Preview"}</span></div><div class="bside">${side}</div></div>` +
      `<div class="games">${cards}</div></section>`;
  }

  function stars() {
    const S = issue.stars;
    const cards = S.items.map((s) =>
      `<figure class="star"><div class="ph"><img src="${attr(HEAD.replace("{}", s.key))}" alt="${attr(s.name)}" width="280" height="203" loading="lazy"></div>` +
      `<figcaption><span class="num">${s.pts}</span><b>${esc(s.name)}</b><span class="ln">${esc(s.line)}</span>` +
      `<span class="tm">${tm(s.team).owner}, ${WON.has(s.team) ? "won" : "lost"}</span></figcaption></figure>`).join("");
    return `<section class="panel"><span class="kick">${typo(S.kick)}</span><h3>${typo(S.title)}</h3>` +
      `<div class="stars">${cards}</div></section>`;
  }

  function standings() {
    let rows = "";
    issue.standings.forEach((s, i) => {
      const { name, owner } = tm(s.team);
      rows += `<tr${i === 4 ? " class=split" : ""}><td class="tt">${logo(s.team, "lg sm")}<span><b>${esc(name)}</b><small>${owner}</small></span></td>` +
        `<td class="c">${REC[s.team]}</td><td class="r">${f1(s.pf)}</td></tr>`;
    });
    return `<table class="stand"><thead><tr><th>Team</th><th class="c">W-L</th><th class="r">Points</th></tr></thead>` +
      `<tbody>${rows}</tbody></table>`;
  }

  function bench() {
    const mx = 50.0;
    const B = issue.bench;
    const vals = showVals(B.map((b) => b.left));
    let rows = "";
    B.forEach((b, i) => {
      const { short, owner } = tm(b.team);
      rows += `<div class="brow"><div class="bl">${short} <small>${owner}, ${WON.has(b.team) ? "won" : "lost"}</small></div>` +
        `<div class="bt"><span class="bar" style="width:calc((100% - 52px) * ${fx(b.left / mx, 4)})"></span><span class="bv">${vals[i]}</span></div></div>`;
    });
    return `<section class="panel"><span class="kick">Week ${W}</span><h3>Points left on the bench</h3>` +
      `<p class="dek">Best possible lineup, minus the lineup each team started.</p><div class="bench">${rows}</div>` +
      `<p class="src">Lineups from GFFL; points from the week’s final stat lines.</p></section>`;
  }

  function wpsvg(spec, cls, Wd, H, L, R, T, B, fs) {
    const g = spec.game; // { home, away }
    const raw = wpData[`m_${g.home}_${g.away}`];
    const forHome = spec.team === g.home; // wpgraph p is the AWAY team's chance
    const s = raw.map((x) => ({ t: x.t, p: forHome ? 1 - x.p : x.p }));
    const t0 = Date.parse(spec.t0), t1 = Date.parse(spec.t1);
    const X = (t) => L + (t - t0) / (t1 - t0) * (R - L);
    const Y = (p) => B - p * (B - T);
    const out = [];
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      const dash = p === 0.5 ? ' stroke-dasharray="5 4"' : "";
      out.push(`<line x1="${L}" x2="${R}" y1="${f1(Y(p))}" y2="${f1(Y(p))}" class="${p === 0.5 ? "mid" : "grid"}"${dash}/>` +
        `<text x="${L - 8}" y="${f1(Y(p) + 5)}" text-anchor="end">${Math.trunc(p * 100)}%</text>`);
    }
    const ctmid = chicagoMidnight(t0);
    const nDays = Math.round((chicagoMidnight(t1) - ctmid) / 864e5) + 1;
    for (let i = 0; i < nDays; i++) {
      const noon = ctmid + i * 864e5 + 12 * 3600e3;
      out.push(`<text x="${f1(X(noon))}" y="${B + 24}" text-anchor="middle">${DAYS[new Date(noon).getUTCDay()].slice(0, 3)}</text>`);
      const m = ctmid + (i + 1) * 864e5;
      if (m < t1) out.push(`<line x1="${f1(X(m))}" x2="${f1(X(m))}" y1="${B}" y2="${B + 6}" class="axis"/>`);
    }
    out.push(`<line x1="${L}" x2="${R}" y1="${B}" y2="${B}" class="axis"/>`);
    const segs = [], gaps = [];
    let cur = [];
    s.forEach((q, i) => {
      if (i && q.t - s[i - 1].t > 3 * 3600e3) { segs.push(cur); gaps.push([s[i - 1], q]); cur = []; }
      cur.push(q);
    });
    segs.push(cur);
    for (const [a, b] of gaps) out.push(`<line x1="${f1(X(a.t))}" y1="${f1(Y(a.p))}" x2="${f1(X(b.t))}" y2="${f1(Y(b.p))}" class="gap"/>`);
    for (const sg of segs) {
      if (sg.length > 1) out.push(`<path d="${sg.map((q, j) => (j ? "L" : "M") + `${f1(X(q.t))} ${f1(Y(q.p))}`).join(" ")}" class="ln"/>`);
    }
    // Annotations, in order. "at": "first" | "last" | "low-after:<ISO>" | { t: ISO, p }.
    for (const a of spec.annotations) {
      let pt;
      if (a.at === "first") pt = s[0];
      else if (a.at === "last") pt = s[s.length - 1];
      else if (typeof a.at === "string" && a.at.startsWith("low-after:")) {
        const after = Date.parse(a.at.slice(10));
        pt = s.filter((q) => q.t > after).reduce((m, q) => (q.p < m.p ? q : m));
      } else pt = { t: Date.parse(a.at.t), p: a.at.p };
      let svg = a.dot ? `<circle cx="${f1(X(pt.t))}" cy="${f1(Y(pt.p))}" r="5.5" class="dot"/>` : "";
      for (const l of a.labels) {
        const x = X(pt.t) + (l.dx || 0), y = Y(pt.p) + (l.dy || 0) + (l.dyFs || 0) * (fs + 1);
        svg += `<text x="${f1(x)}" y="${f1(y)}"${l.anchor ? ` text-anchor="${l.anchor}"` : ""}${l.cls ? ` class="${l.cls}"` : ""}>${esc(l.text)}</text>`;
      }
      out.push(svg);
    }
    return `<svg class="wp ${cls}" style="font-size:${fs}px" viewBox="0 0 ${Wd} ${H}" role="img" aria-label="${attr(spec.aria)}">${out.join("")}</svg>`;
  }

  function wpchart() {
    const spec = issue.wp;
    const svg = wpsvg(spec, "wp-lg", 600, 300, 58, 586, 18, 246, 16) + wpsvg(spec, "wp-sm", 360, 300, 50, 350, 16, 250, 14);
    return `<section class="panel"><span class="kick">${typo(spec.kick)}</span><h3>${typo(spec.title)}</h3>` +
      `<p class="dek">GFFL’s live win probability. Dashed where GFFL recorded no readings.</p>${svg}</section>`;
  }

  // Season so far: bench left by week (stacked), season highs, RoboGoat's picks by week — cut at
  // this issue's own last finished week, so a later week landing in season.json never changes
  // an already-published page.
  function seasonPanel() {
    const S = season;
    const through = RECAP ? W : W - 1;
    const wk = Array.from({ length: through }, (_, i) => (S.weeks || {})[String(i + 1)]);
    if (!through || wk.some((x) => !x)) throw new Error(`season.json lacks weeks 1..${through}; run facts.mjs --season-file`);
    const ids = Object.keys(TEAMS).map(Number);
    const rows = ids.map((t) => {
      const byWeek = wk.map((x) => x.bench[String(t)] || 0);
      return { team: t, byWeek, left: Math.round(byWeek.reduce((a, v) => a + v, 0) * 100) / 100 };
    }).sort((a, b) => b.left - a.left);
    const max = Math.max(...rows.map((r) => r.left));
    const scale = Math.ceil(max / 25) * 25;
    const vals = showVals(rows.map((r) => r.left));
    const earlier = through === 2 ? "Week 1" : through === 3 ? "Weeks 1 and 2" : `Weeks 1 to ${through - 1}`;
    const legend = (through > 1 ? `<span><i class="wab"></i>${earlier}</span>` : "") +
      `<span><i class="wn"></i>Week ${through}</span>`;
    const bars = rows.map((r, i) => {
      const { short, owner } = tm(r.team);
      const segs = r.byWeek.map((v, k) => (v > 0 ? `<i class="${k === through - 1 ? "wn" : k % 2 ? "wb" : "wa"}" style="flex:${fx(v, 2)} 1 0"></i>` : "")).join("");
      return `<div class="brow"><div class="bl">${short} <small>${owner}</small></div>` +
        `<div class="bt"><span class="bar stk" style="width:calc((100% - 52px) * ${fx(r.left / scale, 4)})">${segs}</span><span class="bv">${vals[i]}</span></div></div>`;
    }).join("");
    const teamHi = wk.flatMap((x, k) => Object.entries(x.scores).map(([t, pts]) => ({ team: Number(t), week: k + 1, pts })))
      .sort((a, b) => b.pts - a.pts || a.week - b.week).slice(0, 3);
    const playerHi = wk.flatMap((x, k) => x.top.map((p) => ({ ...p, week: k + 1 })))
      .sort((a, b) => b.pts - a.pts || a.week - b.week).slice(0, 3);
    const hiTeam = teamHi.map((h) =>
      `<li><span class="hv">${f1(h.pts)}</span><span>${esc(tm(h.team).short)} <small>${tm(h.team).owner}, Week ${h.week}</small></span></li>`).join("");
    const hiPlayer = playerHi.map((h) =>
      `<li><span class="hv">${f1(h.pts)}</span><span>${esc(h.name)} <small>${tm(h.team).owner}, Week ${h.week}</small></span></li>`).join("");
    let pw = 0, pl = 0;
    // A preview also lists its own week's picks, still open (rings with no result yet), as it was
    // published. facts.mjs grades those picks in season.json once the week is played; the preview
    // must not change when that happens, any more than an older recap changes when a new week lands.
    const picks = Object.keys(S.picks || {}).map(Number).sort((a, b) => a - b).filter((w) => w <= through || (!RECAP && w === W)).map((w) => {
      const asPublished = !RECAP && w === W;
      const list = S.picks[String(w)].map((p) => (asPublished ? { ...p, result: "" } : p));
      const wn = list.filter((p) => p.result === "W").length, ln = list.filter((p) => p.result === "L").length;
      pw += wn; pl += ln;
      const marks = list.map((p) => `<i class="pk ${p.result === "W" ? "hit" : p.result === "L" ? "miss" : "open"}" title="${attr(tm(p.team).owner)}"></i>`).join("");
      const open = list.every((p) => p.result !== "W" && p.result !== "L");
      return `<li${open ? ' class="open"' : ""}><b>Week ${w}</b><span class="pks">${marks}</span><span class="nw">${open ? "this week" : `${wn}-${ln}`}</span></li>`;
    }).join("");
    return `<section class="panel season"><span class="kick">Season so far</span><h3>Through Week ${through}</h3>` +
      `<h4>Points left on the bench</h4><p class="dek">Every week’s best possible lineup, minus the lineup each team started, added up.</p>` +
      `<div class="legend">${legend}</div><div class="bench">${bars}</div>` +
      `<div class="highs"><div><h4>Top team scores</h4><ol class="hi">${hiTeam}</ol></div>` +
      `<div><h4>Top starters</h4><ol class="hi">${hiPlayer}</ol></div></div>` +
      `<h4>RoboGoat’s picks</h4><p class="dek">One mark per pick: filled if it won, a red ring if it lost${RECAP ? "" : ", a grey ring until it is played"}.</p><ul class="picks">${picks}<li class="tot"><b>Season</b><span class="pks"></span><span class="nw">${pw}-${pl}</span></li></ul>` +
      `<p class="src">Team scores are GFFL’s final totals. Bench and starter points are from each week’s final stat lines, scored by league rules.</p></section>`;
  }

  const GRAPHICS = { board, stars, bench, wp: wpchart, season: seasonPanel };

  // ---------------- column text
  const header = {}, body = [];
  for (const line of md.split(/\r?\n/)) {
    const m = /^(SUBJECT|KICKER|MASTHEAD|SUBHEAD):\s*(.*)$/.exec(line);
    if (m && !body.some((l) => l.trim())) header[m[1]] = m[2].trim();
    else body.push(line);
  }
  const blocks = [], buf = [];
  const flush = () => { if (buf.length) { blocks.push(["p", buf.join("\n").trim()]); buf.length = 0; } };
  for (const line of body) {
    const s = line.trimEnd();
    if (!s.trim()) { flush(); continue; }
    if (s.startsWith("### ")) { flush(); blocks.push(["h3", s.slice(4).trim()]); continue; }
    if (s.startsWith("## ")) { flush(); blocks.push(["h2", s.slice(3).trim()]); continue; }
    const m = /^\[IMAGE:\s*(\w+)/.exec(s);
    if (m) { flush(); blocks.push(["img", m[1]]); continue; }
    buf.push(s);
  }
  flush();

  const gameHead = (text) => {
    const ids = Object.entries(BYNAME).filter(([name]) => text.includes(name)).map(([, id]) => id);
    ids.sort((a, b) => text.indexOf(tm(a).name) - text.indexOf(tm(b).name));
    return `<h3 class="gh"><span class="gl">${ids.map((t) => logo(t, "lg hl")).join("")}</span><span>${typo(text)}</span></h3>`;
  };
  // Rank movement against RoboGoat's previous ranking (season.json rankings[week - 1]).
  const prevRank = (season.rankings || {})[String(W - 1)] || null;
  const mv = (t, rk) => {
    if (!prevRank || !prevRank.includes(t)) return "";
    const d = prevRank.indexOf(t) + 1 - rk;
    if (!d) return `<span class="mv eq" aria-label="same as last week">–</span>`;
    const up = d > 0;
    return `<span class="mv ${up ? "up" : "dn"}" aria-label="${up ? "up" : "down"} ${Math.abs(d)} from last week">` +
      `<svg viewBox="0 0 10 8" width="10" height="8" aria-hidden="true"><path d="${up ? "M5 0L10 8H0Z" : "M0 0H10L5 8Z"}"/></svg>${Math.abs(d)}</span>`;
  };

  const out = [];
  let sec = "", open = false;
  for (const [kind, text] of blocks) {
    if (kind === "h2") {
      if (open) out.push("</section>");
      sec = text.toLowerCase();
      const slug = sec.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      out.push(`<section class="sec" id="${slug}"><h2 class="label">${esc(text)}</h2>`);
      open = true;
      if (sec.startsWith("the board")) out.push(standings());
      continue;
    }
    if (kind === "h3") { out.push(gameHead(text)); continue; }
    if (kind === "img") {
      if (!GRAPHICS[text]) throw new Error(`column.md: unknown [IMAGE: ${text}]`);
      out.push(GRAPHICS[text]());
      continue;
    }
    const lines = text.split("\n").filter((l) => l.trim());
    if (sec.includes("power rankings")) {
      const rp = rankingProblems(lines, (season.rankings || {})[String(W)] || null, REC,
        BYNAME, Object.fromEntries(Object.keys(TEAMS).map((t) => [t, tm(t).owner])));
      if (rp.length) throw new Error(`${dir}: ` + rp.join("; "));
      let items = "";
      for (const l of lines) {
        const m = /^(\d+)\.\s*(.+?) \((\w+), (\d-\d)\)\.\s*(.*)$/.exec(l);
        if (!m || !(m[2] in BYNAME)) throw new Error(`power rankings line does not parse: ${l}`);
        const t = BYNAME[m[2]];
        items += `<li><span class="rk">${m[1]}${mv(t, Number(m[1]))}</span>${logo(t, "lg sm")}<div><b>${esc(m[2])}</b> ` +
          `<small>${m[3]}, <span class="nw">${m[4]}</span></small><p>${typo(m[5])}</p></div></li>`;
      }
      out.push(`<ol class="ranks">${items}</ol>`);
    } else if (sec.includes("injury desk")) {
      const items = lines.map((l) => {
        const m = /^(.+?) \((\w+)\):\s*(.*)$/.exec(l);
        if (!m) throw new Error(`injury desk line does not parse: ${l}`);
        return `<li><b>${typo(m[1])}</b> <small>(${esc(m[2])})</small>: ${typo(m[3])}</li>`;
      }).join("");
      out.push(`<ul class="inj">${items}</ul>`);
    } else if (sec.includes("awards") && lines.length >= 2) {
      out.push(`<div class="award"><b>${esc(lines[0])}</b><p>${typo(lines.slice(1).join(" "))}</p></div>`);
    } else if (RECAP && sec.startsWith(`week ${W + 1}`) && lines.length > 1) {
      let items = "";
      for (const l of lines) {
        const m = /^(.+?) at (.+?)\. (.*)$/.exec(l);
        if (!m || !(m[1] in BYNAME) || !(m[2] in BYNAME)) throw new Error(`next-week line does not parse: ${l}`);
        const a = BYNAME[m[1]], h = BYNAME[m[2]];
        items += `<li><span class="gl">${logo(a, "lg sm")}${logo(h, "lg sm")}</span><div><b>${esc(m[1])} at ${esc(m[2])}</b>` +
          `<p>${typo(m[3])}</p></div></li>`;
      }
      out.push(`<ul class="next">${items}</ul>`);
    } else if (lines.length === 1 && lines[0] === "RoboGoat") {
      out.push('<p class="sig">RoboGoat</p>');
    } else if (lines.every((l) => /^\w+, \d+:\d\d [ap]\.m\.: "/.test(l))) {
      out.push(lines.map((l) => `<blockquote>${typo(l)}</blockquote>`).join(""));
    } else {
      out.push(`<p>${typo(lines.join(" "))}</p>`);
    }
  }
  if (open) out.push("</section>");

  const sub = header.SUBHEAD.split("·").slice(1).join("·").trim();
  const kindLabel = RECAP ? "Recap" : "Preview";
  const TITLE = issue.title || `RoboGoat · GFFL Week ${W} ${kindLabel}`;
  const css = readFileSync(join(ROOT, "tools/robogoat/page.css"), "utf8");
  // Canonical address, from the issue's share image (…/robogoat/2026/week-3/share.png).
  const pageUrl = String(issue.share).replace(/share\.png$/, "");
  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(TITLE)}</title>
<meta name="description" content="${attr(issue.description)}">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#013369">
<meta property="og:type" content="article">
<meta property="og:site_name" content="RoboGoat · GFFL">
<meta property="og:url" content="${attr(pageUrl)}">
<meta property="og:title" content="${attr(TITLE)}">
<meta property="og:description" content="${attr(issue.description)}">
<meta property="og:image" content="${issue.share}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/icons/gffl-192.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Inter:wght@400;600;700&family=Source+Serif+4:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet">
<style>
${css}</style>
</head>
<body>
<div class="wrap">
<header class="mast">
<div class="mt">
<div class="league">${esc(header.KICKER)}</div>
<div class="name">${esc(header.MASTHEAD)}</div>
<div class="col">RoboGoat · Week ${W} ${kindLabel}</div>
<div class="date">${longDate(issue.published)}</div>
</div>
<img class="robogoat" src="${rootRel}/robogoat.png" alt="RoboGoat" width="228" height="278">
</header>
<div class="hed"><h1>${typo(sub)}</h1></div>
<main>
${out.join("\n")}
</main>
<footer>${issue.footerLinks === false ? "" : `<a href="${rootRel}/">Every RoboGoat column</a> · `}The Goat Fantasy Football League · <a href="https://goatfantasyleague.com/">goatfantasyleague.com</a></footer>
</div>
</body>
</html>
`;
  return { page, header, issue };
}

/** Every issue directory under robogoat/<season>/ (a directory holding issue.json). */
export function listIssues() {
  const base = join(ROOT, "robogoat");
  const dirs = [];
  for (const s of readdirSync(base)) {
    if (!/^\d{4}$/.test(s)) continue;
    for (const d of readdirSync(join(base, s))) {
      const p = join(base, s, d);
      if (statSync(p).isDirectory() && existsSync(join(p, "issue.json"))) dirs.push(relative(ROOT, p).split("\\").join("/"));
    }
  }
  return dirs.sort();
}

// ---------------------------------------------------------------- CLI
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const argv = process.argv.slice(2);
  const CHECK = argv.includes("--check");
  const dirs = argv.includes("--all") ? listIssues() : argv.filter((a) => !a.startsWith("--"));
  if (!dirs.length) { console.error("usage: build.mjs <issue-dir>... | --all [--check]"); process.exit(2); }
  let stale = 0;
  for (const d of dirs) {
    const { page } = buildIssue(d);
    const file = join(ROOT, d, "index.html");
    const cur = existsSync(file) ? readFileSync(file, "utf8") : "";
    if (CHECK) { if (cur !== page) { stale++; console.log(`STALE ${d}/index.html`); } else console.log(`ok    ${d}/index.html`); }
    else { writeFileSync(file, page); console.log(`wrote ${d}/index.html (${Buffer.byteLength(page)} bytes)`); }
  }
  if (stale) process.exit(1);
}
