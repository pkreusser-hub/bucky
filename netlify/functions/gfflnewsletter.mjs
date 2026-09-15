// BUCKY — GFFL weekly recap newsletter.
//
// A Netlify scheduled function. After a week is official (a non-void `weekly_<season>_w<N>`
// doc, the same write-once record LG.finalizeWeek persists), this writes a short sports
// column and emails it to league owners who have a family-profile address on file.
//
// WHY A CRON, NOT finalizeWeek: LG.pushWeekRecap already fires a one-line FCM ping from
// whichever client wrote the weekly doc. Perry asked for a polished EMAIL, and EmailJS
// lives on the family mail path (index.html sendEmail / email-template.html), which a
// phone that happens to finalize cannot assume. The cron retries Tue/Wed/Thu 8:00 AM
// Central until the week is finalized and the send is recorded.
//
// WHY NOT A NEW MAIL VENDOR: the house already sends through EmailJS. This function
// calls the same REST /send the browser SDK wraps. EmailJS disables non-browser API
// calls until Account → Security allows them; EMAILJS_PRIVATE_KEY is sent as
// accessToken when present. Rate limit is 1 request/second — sends are serialized.
//
// WHO GETS IT (not a guessed list): family profile docs (`chores_<famKey>`,
// frequency === "profile") that have an email AND match a GFFL team via owner /
// claimedBy (case-insensitive) or the documented choreUser → team map already
// duplicated in index.html / sports.html (dad→1, isaac→12, grandpa→3, mom→5).
// Extra addresses only via GFFL_NEWSLETTER_TO (comma-separated). No address, no send.
//
// VOICE: a deterministic columnist is the default — scheduled functions have a 30s
// cap, and Grok's measured TTFB on league prose has already kissed that. An optional
// Grok/Sonnet hop (same keys farmgpt.mjs already uses) may replace the fallback when
// it returns fast AND passes slopLint + columnUsesFacts. Kids and grandparents read this.
//
// Self-contained, same shape as leaguecron.mjs / chorereminders.mjs: hand-signed JWT,
// Firestore REST, no shared imports. Schedule lives in netlify.toml only.
//
// Required env: FIREBASE_SERVICE_ACCOUNT
// Optional: GFFLNL_FAMILY_KEY (default fam2jan2g), EMAILJS_*, XAI_API_KEY,
//   ANTHROPIC_API_KEY, GFFL_NEWSLETTER_TO, EMAILJS_PRIVATE_KEY
// Test overrides: GFFLNL_TEST_NOW_MS, GFFLNL_FORCE, GFFLNL_FIRESTORE_BASE,
//   GFFLNL_TOKEN_URL, GFFLNL_EMAILJS_URL, GFFLNL_XAI_BASE, GFFLNL_ANTHROPIC_BASE,
//   GFFLNL_SKIP_MODEL, GFFLNL_FORCE_MODEL_TEXT, GFFLNL_NO_THROTTLE

const PROJECT_ID = "amen-farms-app";
const DEFAULT_FAMILY_KEY = "fam2jan2g"; // roomId("amenfarms")
const SEASON = 2026;
const SEASON_WEEKS = 14;

const EMAILJS = {
  publicKey: process.env.EMAILJS_PUBLIC_KEY || "yiqS6j2SLp5sf9BLB",
  serviceId: process.env.EMAILJS_SERVICE_ID || "service_tcdlpci",
  templateId: process.env.EMAILJS_TEMPLATE_ID || "template_rdk52zn",
};

// Documented house map — keep in sync with index.html gfflMyTeamId() and
// sports.html GFFL_TEAM_BY_USER. Default franchise is Battle Kreussers (1).
const PROFILE_TEAM = { dad: 1, isaac: 12, grandpa: 3, mom: 5 };

const DEEP_LINK = "https://goatfantasyleague.com/league.html";
const FROM_NAME = "GFFL Desk";

const FIRESTORE_BASE = () =>
  process.env.GFFLNL_FIRESTORE_BASE ||
  `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const TOKEN_URL = () => process.env.GFFLNL_TOKEN_URL || "https://oauth2.googleapis.com/token";
const EMAILJS_URL = () => process.env.GFFLNL_EMAILJS_URL || "https://api.emailjs.com/api/v1.0/email/send";
const XAI_BASE = () => process.env.GFFLNL_XAI_BASE || "https://api.x.ai";
const ANTHROPIC_BASE = () => process.env.GFFLNL_ANTHROPIC_BASE || "https://api.anthropic.com";

const FCM_SCOPE = "https://www.googleapis.com/auth/datastore";

const TARGET_CENTRAL_MIN = 8 * 60;
const CENTRAL_MATCH_WINDOW = 20;
const SLOT_WEEKDAYS = new Set(["Tue", "Wed", "Thu"]);

// Typical AI-column tells. The fallback writer is written to fail this list, and a
// model hop that trips it is discarded. Applied to family email prose (the no-ai-slop
// skill); the function never ships a sentence that reads like a prompt leftover.
const SLOP_BANNED = [
  /\bdelve\b/i, /\btapestry\b/i, /\bshowcase\b/i, /\bunderscored\b/i, /\bunderscore\b/i,
  /\btestament\b/i, /\bpivotal\b/i, /\bit's not just\b/i, /\bin a world\b/i,
  /\bat the end of the day\b/i, /\blet's dive\b/i, /\bhere's the thing\b/i,
  /\bneedless to say\b/i, /\bit remains to be seen\b/i, /\bwhat a week\b/i,
  /\bweek to remember\b/i, /\bin the books\b/i, /\blast but not least\b/i,
  /\bmoreover\b/i, /\bfurthermore\b/i, /\badditionally\b/i, /\bthrilling\b/i,
  /\bunforgettable\b/i, /\bnestled\b/i, /\bvibrant\b/i, /\bmultifaceted\b/i,
  /\bleverage\b/i, /\brobust\b/i, /\bseamless\b/i, /\bgame-changer\b/i,
  /\bproverbial\b/i, /\bonly time will tell\b/i, /\bpacked a punch\b/i,
  /\bleft it all on the field\b/i, /\bunlock\b/i, /\belevate\b/i, /\bempower\b/i,
  /\blandscape\b/i, /\bjourney\b/i, /\bnot just about\b/i, /\ba reminder that\b/i,
  /\blook no further\b/i, /\bin today's day and age\b/i,
];

const COLUMN_SYSTEM = `You are the weekly columnist for the Goat Fantasy Football League, a private 8-team family league. Kids and grandparents read this. Write like a newspaper sports desk on deadline: specific, dry when the score is ugly, warm when someone earned it. Roast teams, never people.

FACTS ONLY. Every score, name, and record you mention must appear in the JSON. Do not invent players, injuries, weather, or quotes.

SHAPE
- First line: a headline. No # markdown. No quotation marks around the whole line.
- Then 4-8 short paragraphs. Cover EVERY matchup. The closest game and the biggest blowout get the most space; a 40-point loss can be one sentence.
- If awards are in the data, mention them once, grounded in the numbers.
- Close on the standings: who is in first, who is looking up. One or two sentences.
- 180-320 words after the headline.

VOICE — this is the whole job
- Start with the week's actual story (a score, a margin, a name). Never open by announcing that you are recapping, that the week is over, or that it was a week.
- Mix short sentences with longer ones. Do not march in threes.
- Prefer the score in the sentence over adjectives about the score.
- One joke is plenty. If you cannot make it specific to these numbers, skip it.
- Family-friendly. No swearing. No cruelty. No emoji. No hashtags. No tables. No bullet lists.

BANNED
delve, tapestry, landscape, showcase, underscore, pivotal, testament, "it's not just", "in a world", "at the end of the day", "let's dive", "here's the thing", "needless to say", "it remains to be seen", "what a week", "in the books", "last but not least", moreover, furthermore, additionally, thrilling, unforgettable, nestled, vibrant, journey (as metaphor), robust, seamless, game-changer, "only time will tell", "packed a punch", "left it all on the field".
More than two em dashes. Any emoji. Any sentence that could sit on last week's column with the names swapped.`;

function nowMs() {
  const raw = process.env.GFFLNL_TEST_NOW_MS;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return Date.now();
}

function centralParts(now) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return { weekday: parts.weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function isScheduledSlot(now) {
  if (process.env.GFFLNL_FORCE === "1") return true;
  const { weekday, minutes } = centralParts(now);
  if (!SLOT_WEEKDAYS.has(weekday)) return false;
  let d = Math.abs(minutes - TARGET_CENTRAL_MIN);
  d = Math.min(d, 1440 - d);
  return d <= CENTRAL_MATCH_WINDOW;
}

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function fmtPts(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? (Math.round(x * 100) / 100).toFixed(1) : "—";
}

function weeklyIsVoid(doc) {
  if (!doc || doc.kind !== "weekly") return false;
  const ms = Array.isArray(doc.matchups) ? doc.matchups : [];
  if (!ms.length) return true;
  if (!ms.every((m) => n(m.homePts) === 0 && n(m.awayPts) === 0)) return false;
  const power = Array.isArray(doc.power) ? doc.power : [];
  if (power.length && !power.every((p) => n(p.score) === 0)) return false;
  return true;
}

function decodeValue(v) {
  if (!v || typeof v !== "object") return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return !!v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if (v.mapValue && v.mapValue.fields) return decodeFields(v.mapValue.fields);
  if (v.arrayValue) return (v.arrayValue.values || []).map(decodeValue);
  return null;
}

function decodeFields(fields) {
  const o = {};
  if (!fields || typeof fields !== "object") return o;
  for (const [k, v] of Object.entries(fields)) o[k] = decodeValue(v);
  return o;
}

function encodeValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    if (Number.isInteger(v)) return { integerValue: String(v) };
    return { doubleValue: v };
  }
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  if (typeof v === "object") return { mapValue: { fields: encodeFields(v) } };
  return { stringValue: String(v) };
}

function encodeFields(obj) {
  const fields = {};
  if (!obj || typeof obj !== "object") return fields;
  for (const [k, v] of Object.entries(obj)) fields[k] = encodeValue(v);
  return fields;
}

function teamIdOf(t) {
  const id = t && (t.teamId != null ? t.teamId : t.id);
  return Number(id);
}

function teamNameOf(teams, id) {
  const t = (teams || []).find((x) => teamIdOf(x) === Number(id));
  return (t && t.name) || ("Team " + id);
}

function standingsFromWeeklies(teams, weeklies, throughWeek) {
  const cap = Math.min(n(throughWeek), SEASON_WEEKS);
  const st = {};
  for (const t of teams || []) {
    const id = teamIdOf(t);
    if (!Number.isFinite(id) || id <= 0) continue;
    st[id] = { teamId: id, name: t.name || ("Team " + id), w: 0, l: 0, t: 0, pf: 0, pa: 0 };
  }
  for (const wd of weeklies || []) {
    const w = n(wd && wd.week);
    if (w < 1 || w > cap) continue;
    if (weeklyIsVoid(wd)) continue;
    for (const m of wd.matchups || []) {
      const h = n(m.home), a = n(m.away);
      if (!st[h] || !st[a]) continue;
      const hp = n(m.homePts), ap = n(m.awayPts);
      st[h].pf += hp; st[h].pa += ap;
      st[a].pf += ap; st[a].pa += hp;
      if (hp > ap) { st[h].w++; st[a].l++; }
      else if (ap > hp) { st[a].w++; st[h].l++; }
      else { st[h].t++; st[a].t++; }
    }
  }
  const rows = Object.values(st).sort((A, B) => {
    if (B.w !== A.w) return B.w - A.w;
    if (B.t !== A.t) return B.t - A.t;
    if (B.pf !== A.pf) return B.pf - A.pf;
    return A.teamId - B.teamId;
  });
  rows.forEach((r, i) => { r.place = i + 1; });
  return rows;
}

function buildFacts(weekly, teams, weeklies) {
  const week = n(weekly && weekly.week);
  const games = [];
  for (const m of (weekly && weekly.matchups) || []) {
    const home = n(m.home), away = n(m.away);
    const homePts = n(m.homePts), awayPts = n(m.awayPts);
    const homeName = teamNameOf(teams, home);
    const awayName = teamNameOf(teams, away);
    const tie = homePts === awayPts;
    const homeWon = homePts > awayPts;
    const winner = tie ? null : (homeWon ? homeName : awayName);
    const loser = tie ? null : (homeWon ? awayName : homeName);
    const winPts = tie ? homePts : (homeWon ? homePts : awayPts);
    const losePts = tie ? awayPts : (homeWon ? awayPts : homePts);
    games.push({
      home, away, homePts, awayPts, homeName, awayName,
      winner, loser, winPts, losePts, tie,
      margin: Math.round(Math.abs(homePts - awayPts) * 100) / 100,
    });
  }
  const decided = games.filter((g) => !g.tie);
  const closest = decided.length
    ? decided.reduce((a, b) => (a.margin < b.margin ? a : b))
    : (games[0] || null);
  const blowout = decided.length
    ? decided.reduce((a, b) => (a.margin > b.margin ? a : b))
    : (games[0] || null);
  const awardsIn = (weekly && weekly.awards) || {};
  const awards = {};
  if (awardsIn.topScore && awardsIn.topScore.teamId != null) {
    awards.topScore = {
      teamId: n(awardsIn.topScore.teamId),
      name: teamNameOf(teams, awardsIn.topScore.teamId),
      pts: n(awardsIn.topScore.pts),
    };
  }
  if (awardsIn.bust && awardsIn.bust.name) {
    awards.bust = { name: String(awardsIn.bust.name), shortfall: n(awardsIn.bust.shortfall) };
  }
  if (awardsIn.benchBlunder && awardsIn.benchBlunder.teamId != null) {
    awards.benchBlunder = {
      teamId: n(awardsIn.benchBlunder.teamId),
      name: teamNameOf(teams, awardsIn.benchBlunder.teamId),
      diff: n(awardsIn.benchBlunder.diff),
    };
  }
  return {
    season: SEASON,
    week,
    games,
    closest,
    blowout,
    awards,
    standings: standingsFromWeeklies(teams, weeklies, week),
  };
}

function gameSentence(g) {
  if (!g) return "";
  if (g.tie) {
    return g.homeName + " " + fmtPts(g.homePts) + ", " + g.awayName + " " + fmtPts(g.awayPts)
      + ". The week called it a draw.";
  }
  const score = g.winner + " " + fmtPts(g.winPts) + ", " + g.loser + " " + fmtPts(g.losePts) + ".";
  if (g.margin < 2) return score + " A kick's worth. " + g.winner + " kept it.";
  if (g.margin < 4) return score + " " + g.loser + " had it until they didn't.";
  if (g.margin >= 40) return score + " One side was playing a different sport.";
  if (g.margin >= 25) return score + " " + g.loser + " never found the week.";
  return score;
}

function writeFallbackColumn(facts) {
  const games = (facts && facts.games) || [];
  const closest = facts.closest;
  const blowout = facts.blowout;
  let lead = closest;
  if (blowout && closest && blowout !== closest && blowout.margin >= 35 && closest.margin > 5) {
    lead = blowout;
  }
  if (!lead && games[0]) lead = games[0];

  let headline = "The week, scored";
  if (lead && lead.tie) {
    headline = lead.homeName + " and " + lead.awayName + " finish level at " + fmtPts(lead.homePts);
  } else if (lead && lead.margin < 3) {
    headline = lead.winner + " holds off " + lead.loser + " by " + fmtPts(lead.margin);
  } else if (lead && lead.margin >= 25) {
    headline = lead.winner + " buries " + lead.loser;
  } else if (lead) {
    headline = lead.winner + " takes " + lead.loser;
  }

  const paras = [];
  if (lead) paras.push(gameSentence(lead));
  const rest = games.filter((g) => g !== lead).sort((a, b) => a.margin - b.margin);
  for (const g of rest) paras.push(gameSentence(g));

  const aw = facts.awards || {};
  const awardBits = [];
  if (aw.topScore) {
    awardBits.push(aw.topScore.name + " hung the high at " + fmtPts(aw.topScore.pts));
  }
  if (aw.bust && aw.bust.name) {
    awardBits.push(aw.bust.name + " was the bust, " + fmtPts(aw.bust.shortfall) + " under the projection that started him");
  }
  if (aw.benchBlunder) {
    awardBits.push(aw.benchBlunder.name + " left " + fmtPts(aw.benchBlunder.diff) + " on the bench");
  }
  if (awardBits.length) paras.push(awardBits.join(". ") + ".");

  const table = facts.standings || [];
  if (table.length) {
    const first = table[0];
    const last = table[table.length - 1];
    const rec = (r) => r.w + "-" + r.l + (r.t ? "-" + r.t : "");
    let line = first.name + " leads at " + rec(first) + " with " + fmtPts(first.pf) + " on the board.";
    if (last && last !== first) {
      line += " " + last.name + " sits " + rec(last) + ".";
    }
    paras.push(line);
  }

  return { headline, body: paras.filter(Boolean).join("\n\n"), source: "fallback" };
}

function slopLint(text) {
  const raw = String(text || "");
  const reasons = [];
  for (const re of SLOP_BANNED) {
    if (re.test(raw)) reasons.push("banned:" + re.source);
  }
  const dashes = raw.split("—").length - 1;
  if (dashes > 2) reasons.push("em-dashes:" + dashes);
  if (/[\u{1F300}-\u{1FAFF}]/u.test(raw)) reasons.push("emoji");
  if (/^#+\s/m.test(raw)) reasons.push("heading");
  return { ok: reasons.length === 0, reasons };
}

function columnUsesFacts(text, facts) {
  const raw = String(text || "");
  const missing = [];
  for (const g of (facts && facts.games) || []) {
    if (!raw.includes(g.homeName)) missing.push("name:" + g.homeName);
    if (!raw.includes(g.awayName)) missing.push("name:" + g.awayName);
    if (!raw.includes(fmtPts(g.homePts))) missing.push("pts:" + fmtPts(g.homePts));
    if (!raw.includes(fmtPts(g.awayPts))) missing.push("pts:" + fmtPts(g.awayPts));
  }
  return { ok: missing.length === 0, missing };
}

function pickWeekToSend(weeklies, sentWeeks) {
  const sent = new Set((sentWeeks || []).map((w) => n(w)));
  const open = (weeklies || [])
    .filter((wd) => wd && wd.kind === "weekly" && !weeklyIsVoid(wd) && n(wd.week) >= 1)
    .map((wd) => n(wd.week))
    .filter((w) => !sent.has(w));
  if (!open.length) return null;
  return Math.min(...open);
}

function normName(s) {
  return String(s || "").trim().toLowerCase();
}

function pickRecipients(profiles, teams, extraTo) {
  const byEmail = new Map();
  const teamIds = new Set((teams || []).map(teamIdOf).filter((id) => id > 0));
  const handles = [];
  for (const t of teams || []) {
    const id = teamIdOf(t);
    if (!id) continue;
    for (const h of [t.owner, t.claimedBy]) {
      const k = normName(h);
      if (k) handles.push({ key: k, teamId: id });
    }
  }
  for (const p of profiles || []) {
    if (String((p && p.frequency) || "") !== "profile") continue;
    const name = p && p.name;
    const email = String((p && p.email) || "").trim();
    if (!name || !email || !email.includes("@")) continue;
    const key = normName(name);
    let hit = handles.find((h) => h.key === key);
    if (!hit && PROFILE_TEAM[key] && teamIds.has(PROFILE_TEAM[key])) {
      hit = { key, teamId: PROFILE_TEAM[key] };
    }
    if (!hit) continue;
    if (!byEmail.has(email.toLowerCase())) {
      byEmail.set(email.toLowerCase(), { name: String(name), email, teamId: hit.teamId });
    }
  }
  for (const raw of String(extraTo || "").split(",")) {
    const email = raw.trim();
    if (!email || !email.includes("@")) continue;
    if (!byEmail.has(email.toLowerCase())) {
      byEmail.set(email.toLowerCase(), { name: email.split("@")[0], email, teamId: null });
    }
  }
  return [...byEmail.values()];
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineFmt(s) {
  const esc = escapeHtml(s);
  return esc.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function toEmailHtml(column, facts) {
  const body = String((column && column.body) || "");
  const paras = body.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  let html = "";
  if (column && column.headline) {
    html += `<p style="font-size:18px;font-weight:800;color:#15233f;margin:0 0 14px;">${inlineFmt(column.headline)}</p>`;
  }
  for (const p of paras) {
    html += `<p style="font-size:15px;line-height:1.55;color:#15233f;margin:0 0 12px;">${inlineFmt(p)}</p>`;
  }
  const rows = ((facts && facts.games) || []).map((g) => {
    const left = escapeHtml(g.awayName) + " " + escapeHtml(fmtPts(g.awayPts));
    const right = escapeHtml(fmtPts(g.homePts)) + " " + escapeHtml(g.homeName);
    return `<tr>
      <td style="padding:6px 0;font-size:14px;color:#15233f;border-bottom:1px solid #d7e0f0;">${left}</td>
      <td style="padding:6px 0;font-size:14px;color:#15233f;border-bottom:1px solid #d7e0f0;text-align:right;">${right}</td>
    </tr>`;
  }).join("");
  if (rows) {
    html += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;border-top:1px solid #d7e0f0;">${rows}</table>`;
  }
  return html;
}

function buildCtaBlock() {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;">
    <tr><td style="background:#ba303e;border-radius:10px;">
      <a href="${escapeHtml(DEEP_LINK)}" style="display:inline-block;padding:14px 24px;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;">Open the league</a>
    </td></tr>
  </table>`;
}

function buildEmailParams(to, column, facts) {
  const first = String((column && column.body) || "").split(/\n\n+/)[0] || "";
  const week = facts && facts.week;
  return {
    to_email: to.email,
    to_name: to.name,
    from_name: FROM_NAME,
    subject: "GFFL Week " + week + ": " + (column && column.headline ? column.headline : "the recap"),
    message: first,
    details_block: toEmailHtml(column, facts),
    cta_block: buildCtaBlock(),
    progress_block: "",
    photo_block: "",
    task: "",
    due: "",
    value: "",
    description: "",
  };
}

function parseColumnText(text) {
  const raw = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return null;
  const lines = raw.split("\n");
  const headline = lines[0].replace(/^\*\*|\*\*$/g, "").trim();
  const body = lines.slice(1).join("\n").trim();
  if (!headline || !body) return null;
  return { headline, body, source: "model" };
}

async function callColumnModel(facts) {
  if (process.env.GFFLNL_SKIP_MODEL === "1") return { ok: false, reason: "skipped" };
  if (process.env.GFFLNL_FORCE_MODEL_TEXT) {
    return { ok: true, text: process.env.GFFLNL_FORCE_MODEL_TEXT };
  }
  const user = "WEEK " + facts.week + " RESULTS (JSON):\n" + JSON.stringify({
    week: facts.week,
    games: facts.games,
    awards: facts.awards,
    standings: facts.standings,
  }) + "\n\nTASK: Write this week's column.";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    if (process.env.XAI_API_KEY) {
      const resp = await fetch(XAI_BASE() + "/v1/chat/completions", {
        method: "POST",
        signal: ctrl.signal,
        headers: { authorization: "Bearer " + process.env.XAI_API_KEY, "content-type": "application/json" },
        body: JSON.stringify({
          model: process.env.XAI_MODEL || "grok-4.5",
          messages: [
            { role: "system", content: COLUMN_SYSTEM },
            { role: "user", content: user },
          ],
          max_tokens: 800,
          temperature: 0.4,
          stream: false,
        }),
      });
      const j = await resp.json().catch(() => null);
      const text = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (resp.ok && text) return { ok: true, text: String(text) };
      return { ok: false, reason: "xai-" + resp.status };
    }
    if (process.env.ANTHROPIC_API_KEY) {
      const resp = await fetch(ANTHROPIC_BASE() + "/v1/messages", {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
          max_tokens: 800,
          system: COLUMN_SYSTEM,
          messages: [{ role: "user", content: user }],
        }),
      });
      const j = await resp.json().catch(() => null);
      const text = j && Array.isArray(j.content) ? j.content.map((c) => c && c.text).filter(Boolean).join("") : "";
      if (resp.ok && text) return { ok: true, text };
      return { ok: false, reason: "anthropic-" + resp.status };
    }
    return { ok: false, reason: "no-model-key" };
  } catch (err) {
    return { ok: false, reason: String((err && err.message) || err) };
  } finally {
    clearTimeout(timer);
  }
}

async function chooseColumn(facts) {
  const fallback = writeFallbackColumn(facts);
  const model = await callColumnModel(facts);
  if (!model.ok || !model.text) return fallback;
  const parsed = parseColumnText(model.text);
  if (!parsed) return fallback;
  const slop = slopLint(parsed.headline + "\n" + parsed.body);
  const grounded = columnUsesFacts(parsed.headline + "\n" + parsed.body, facts);
  if (!slop.ok || !grounded.ok) return fallback;
  return parsed;
}

function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getGoogleAccessToken(serviceAccount) {
  const crypto = await import("node:crypto");
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: serviceAccount.client_email,
    scope: FCM_SCOPE,
    aud: TOKEN_URL(),
    iat: nowSec,
    exp: nowSec + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${base64url(signer.sign(serviceAccount.private_key))}`;
  const resp = await fetch(TOKEN_URL(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const data = await resp.json();
  if (!resp.ok || !data.access_token) {
    throw new Error("OAuth token exchange failed: " + resp.status + " " + JSON.stringify(data));
  }
  return data.access_token;
}

async function runQuery(accessToken, collectionId) {
  const resp = await fetch(FIRESTORE_BASE() + ":runQuery", {
    method: "POST",
    headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId }] } }),
  });
  const rows = await resp.json();
  if (!resp.ok) throw new Error("Firestore query failed: " + resp.status + " " + JSON.stringify(rows));
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row.document) continue;
    const fields = decodeFields(row.document.fields || {});
    const id = String(row.document.name || "").split("/").pop();
    out.push({ id, ...fields });
  }
  return out;
}

async function writeSent(accessToken, familyKey, rec) {
  const base = `projects/${PROJECT_ID}/databases/(default)/documents`;
  const id = rec.season + "_w" + rec.week;
  const resp = await fetch(FIRESTORE_BASE() + ":commit", {
    method: "POST",
    headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
    body: JSON.stringify({
      writes: [{
        currentDocument: { exists: false },
        update: {
          name: `${base}/gffl_nl_${familyKey}/${id}`,
          fields: encodeFields({
            kind: "newsletter",
            season: rec.season,
            week: rec.week,
            headline: String(rec.headline || "").slice(0, 200),
            text: String(rec.text || "").slice(0, 20000),
            source: String(rec.source || "fallback"),
            sent: rec.sent | 0,
            recipients: (rec.recipients || []).slice(0, 24),
            at: Date.now(),
          }),
        },
      }],
    }),
  });
  if (resp.status === 409 || resp.status === 400) return { ok: false, reason: "already-sent" };
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    return { ok: false, reason: "write-failed:" + resp.status + " " + t.slice(0, 160) };
  }
  return { ok: true };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendOneEmail(params) {
  const payload = {
    service_id: EMAILJS.serviceId,
    template_id: EMAILJS.templateId,
    user_id: EMAILJS.publicKey,
    template_params: params,
  };
  if (process.env.EMAILJS_PRIVATE_KEY) payload.accessToken = process.env.EMAILJS_PRIVATE_KEY;
  const resp = await fetch(EMAILJS_URL(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await resp.text().catch(() => "");
  return { ok: resp.ok, status: resp.status, detail: String(text).slice(0, 160) };
}

export default async () => {
  const now = new Date(nowMs());
  if (!isScheduledSlot(now)) {
    return new Response(JSON.stringify({ sent: 0, skipped: true, reason: "not-a-scheduled-slot" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  const familyKey = process.env.GFFLNL_FAMILY_KEY || DEFAULT_FAMILY_KEY;
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    return new Response(JSON.stringify({ sent: 0, skipped: true, reason: "FIREBASE_SERVICE_ACCOUNT not set" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch {
    return new Response(JSON.stringify({ sent: 0, skipped: true, reason: "FIREBASE_SERVICE_ACCOUNT is not valid JSON" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const accessToken = await getGoogleAccessToken(serviceAccount);
    const [leagueDocs, choreDocs, sentDocs] = await Promise.all([
      runQuery(accessToken, "gffl_" + familyKey),
      runQuery(accessToken, "chores_" + familyKey),
      runQuery(accessToken, "gffl_nl_" + familyKey),
    ]);

    const teams = leagueDocs.filter((d) => d.kind === "team");
    const weeklies = leagueDocs.filter((d) => d.kind === "weekly");
    const sentWeeks = sentDocs.filter((d) => d.kind === "newsletter").map((d) => n(d.week));
    const week = pickWeekToSend(weeklies, sentWeeks);
    if (!week) {
      const anyReal = weeklies.some((wd) => !weeklyIsVoid(wd) && n(wd.week) >= 1);
      return new Response(JSON.stringify({
        sent: 0, skipped: true, reason: anyReal ? "all-sent" : "no-finalized-week",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    const weekly = weeklies.find((wd) => n(wd.week) === week && !weeklyIsVoid(wd));
    const profiles = choreDocs.filter((d) => String(d.frequency || "") === "profile");
    const recipients = pickRecipients(profiles, teams, process.env.GFFL_NEWSLETTER_TO);
    if (!recipients.length) {
      return new Response(JSON.stringify({ sent: 0, skipped: true, reason: "no-recipients", week }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    const facts = buildFacts(weekly, teams, weeklies);
    const column = await chooseColumn(facts);
    const throttle = process.env.GFFLNL_NO_THROTTLE === "1" || !!process.env.GFFLNL_TEST_NOW_MS ? 0 : 1100;

    let sent = 0;
    const failed = [];
    for (let i = 0; i < recipients.length; i++) {
      if (i && throttle) await sleep(throttle);
      const params = buildEmailParams(recipients[i], column, facts);
      let result;
      try { result = await sendOneEmail(params); }
      catch (e) { result = { ok: false, status: 0, detail: String((e && e.message) || e) }; }
      if (result.ok) sent += 1;
      else failed.push({ email: recipients[i].email, status: result.status, detail: result.detail });
    }

    if (sent > 0) {
      await writeSent(accessToken, familyKey, {
        season: SEASON,
        week,
        headline: column.headline,
        text: column.headline + "\n\n" + column.body,
        source: column.source,
        sent,
        recipients: recipients.map((r) => r.email),
      });
    }

    return new Response(JSON.stringify({
      sent,
      skipped: false,
      reason: sent ? null : "send-failed",
      week,
      recipients: recipients.length,
      failed: failed.length,
      source: column.source,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({
      sent: 0, skipped: false, reason: String((err && err.message) || err),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};

export {
  COLUMN_SYSTEM,
  PROFILE_TEAM,
  SLOP_BANNED,
  buildCtaBlock,
  buildEmailParams,
  buildFacts,
  chooseColumn,
  columnUsesFacts,
  decodeFields,
  encodeFields,
  fmtPts,
  isScheduledSlot,
  n,
  pickRecipients,
  pickWeekToSend,
  slopLint,
  standingsFromWeeklies,
  toEmailHtml,
  weeklyIsVoid,
  writeFallbackColumn,
};
