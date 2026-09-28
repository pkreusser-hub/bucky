// BUCKY — the halftime desk for the Scores page's 8-bit view.
//
// 2026-09-28, user: "for half time, since nfl doesnt have marching bands, lets have the view change
// to 4 people around a desk like you would see on a pre-game or post game NFL broadcast, wearing
// suits … going back and forth with chat bubbles analyzing the half. have opus 5.5 write some
// dialogue for each of the 4 people so that the whole thing lasts around a minute, and if you
// revisit the page while its half time it just replays the same dialogue".
//
// Netlify Function (ESM). GET /.netlify/functions/halftime?event=<ESPN event id>
//   -> { ok:true, event, cast:[4 names], lines:[{who:0-3, text}], model }   the script
//   -> { ok:false, pending:true }       being written (the page polls every few seconds)
//   -> { ok:false, reason }             bad-event | not-halftime | upstream | failed | no-store
//   (HTTP 200 always.)
//   &demo=1 (2026-09-28, user: "give me a test link", with no game at halftime to test on): the
//   same, for a FINISHED game's first half, stored apart as sunday_halftime/demo-<event>. The facts
//   are cut at the half: the score after the last Q2 play, and no leaders or team stats (ESPN's are
//   the full game's by then). Only a final gets one, once, so it costs at most one call per game.
//
// ONE SCRIPT PER GAME. The first request at halftime claims Firestore doc sunday_halftime/<event>
// (a create with precondition exists:false, so two phones opening the game together start ONE
// job) and starts halftime-background, which has the 15-minute allowance: an Opus call with
// thinking runs past the ~30s a synchronous function gets on this site (books.mjs found the same).
// The job writes the script into that doc, and every later request, from anyone, returns those
// same lines, so a revisit replays the same dialogue. A failed or stuck job (no script 4 minutes
// after its claim) may be re-claimed, at most 3 tries per game.
//
// WHAT THE MODEL SEES: facts only, built here from ESPN's summary (never from the browser): the
// score, first-half scoring plays, ESPN's leaders and team stats (at halftime both are first-half
// numbers), drive results, and the half's big plays, turnovers and sacks. The prompt forbids
// inventing anything beyond them.
//
// COST GUARD: the page is public, so the server decides everything: a script is written only for
// a real ESPN event that ESPN itself says is at halftime, once per game.
//
// ENV: ANTHROPIC_API_KEY, FIREBASE_SERVICE_ACCOUNT (the Firestore write, as books.mjs),
// BUCKY_NOTIFY_SECRET (this function -> its background twin). Test overrides
// (tools/_verify-halftime.mjs): HALFTIME_ESPN_BASE, HALFTIME_FIRESTORE_BASE,
// HALFTIME_GOOGLE_TOKEN_URL, HALFTIME_BG_URL, ANTHROPIC_BASE_URL.

export const HALFTIME_MODEL = "claude-opus-5-5";
const ESPN = () => process.env.HALFTIME_ESPN_BASE || "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const DOC_BASE = "projects/amen-farms-app/databases/(default)/documents";
const COLL = "sunday_halftime";
const STALE_MS = 4 * 60 * 1000;
const MAX_TRIES = 3;

// The desk. Fixed people, so the show has regulars; the page draws them (suits, faces) in this order.
export const CAST = ["Hal Brandt", "Chuck Varney", "Moose Tillman", "Dot Keene"];
const SYSTEM = `You write the halftime desk segment for a retro, 16-bit style NFL broadcast shown inside a family fantasy football app (the GFFL). Four regulars sit at the desk:
0. ${CAST[0]}, the host: smooth, keeps it moving, opens with the score and closes by sending it back to the second half.
1. ${CAST[1]}, former quarterback: X's and O's, reads coverages and protections, a little folksy.
2. ${CAST[2]}, former linebacker: loud, loves hits, sacks and turnovers, needles Chuck.
3. ${CAST[3]}, the numbers analyst: stats and trends, what the leaders' days mean for fantasy lineups, dry wit.

Write about one minute of back-and-forth: 14 to 18 lines, 150 to 190 words in all, no line over 24 words. The host speaks first and last, and each analyst speaks at least 3 times. They react to each other and disagree a little; each line should sound like its speaker.

Talk about what actually happened in this first half, using only the facts you are given: the score, the scoring plays, the leaders, the big plays and turnovers, the team numbers. Do not invent stats, injuries, quotes, records or storylines that are not in the facts. Name players as the facts do (full name the first time, last name after). Keep it family friendly. Plain spoken sentences only: no emoji, no stage directions, no hashtags, and do not start a line with a speaker's name.`;

const SCHEMA = {
  type: "object",
  properties: {
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: { who: { type: "integer", enum: [0, 1, 2, 3] }, text: { type: "string" } },
        required: ["who", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["lines"],
  additionalProperties: false,
};

const json = (body, cache) => new Response(JSON.stringify(body), {
  status: 200,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "cache-control": "public, max-age=0, must-revalidate",
    "netlify-cdn-cache-control": cache,
    "netlify-vary": "query=event|demo",
  },
});
const CACHE_DONE = "public, durable, s-maxage=2592000";      // a finished script never changes
const CACHE_WAIT = "public, s-maxage=4";                      // pending: several phones share one poll
const CACHE_NONE = "public, s-maxage=30";

// ESPN says halftime as STATUS_HALFTIME; some feeds sit on "End of 2nd" for a moment first.
export function atHalftime(sum) {
  const st = sum?.header?.competitions?.[0]?.status;
  const t = st?.type || {};
  return t.name === "STATUS_HALFTIME" || (t.state === "in" && Number(st?.period) === 2 && /^end/i.test(t.detail || t.shortDetail || ""));
}

const clip = (s, n) => { s = String(s ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const NOTABLE = /intercept|fumble|sack|touchdown|safety|blocked|field goal/i;
// The first half as facts: everything the desk may talk about.
export function halftimeFacts(sum, demo) {
  const comp = sum?.header?.competitions?.[0] || {};
  const cs = comp.competitors || [];
  const side = (ha) => {
    const c = cs.find((x) => x.homeAway === ha) || {};
    const t = c.team || {};
    return { id: String(t.id || ""), abbr: t.abbreviation || "", name: t.displayName || t.name || "", score: Number(c.score) || 0, record: c.record?.find?.((r) => r.type === "total")?.summary || null };
  };
  const home = side("home"), away = side("away");
  const byId = { [home.id]: home.abbr, [away.id]: away.abbr };
  const facts = { away, home, status: comp.status?.type?.detail || "Halftime" };
  facts.scoring = (sum.scoringPlays || []).filter((p) => Number(p.period?.number) <= 2).map((p) => ({
    q: Number(p.period?.number), clock: p.clock?.displayValue || "", team: p.team?.abbreviation || byId[String(p.team?.id)] || "", play: clip(p.text, 160), score: `${away.abbr} ${p.awayScore} - ${p.homeScore} ${home.abbr}`,
  }));
  facts.leaders = [];
  for (const tl of sum.leaders || []) {
    const abbr = tl.team?.abbreviation || byId[String(tl.team?.id)] || "";
    for (const cat of tl.leaders || []) {
      const top = cat.leaders?.[0];
      if (top?.athlete?.displayName) facts.leaders.push({ team: abbr, stat: cat.displayName || cat.name, player: top.athlete.displayName, line: clip(top.displayValue, 80) });
    }
  }
  const WANT = { totalYards: "total yards", netPassingYards: "passing yards", rushingYards: "rushing yards", firstDowns: "first downs", thirdDownEff: "third downs", turnovers: "turnovers", sacksYardsLost: "sacked (times-yards)", totalPenaltiesYards: "penalties-yards", possessionTime: "time of possession" };
  facts.teamStats = {};
  for (const bt of sum.boxscore?.teams || []) {
    const abbr = bt.team?.abbreviation || byId[String(bt.team?.id)] || "";
    const row = {};
    for (const s of bt.statistics || []) if (WANT[s.name] && !(WANT[s.name] in row)) row[WANT[s.name]] = s.displayValue;
    if (abbr && Object.keys(row).length) facts.teamStats[abbr] = row;
  }
  facts.drives = [];
  facts.notable = [];
  for (const d of sum.drives?.previous || []) {
    const plays = (d.plays || []).filter((p) => Number(p.period?.number) <= 2);
    if (!plays.length) continue;
    const team = d.team?.abbreviation || byId[String(d.team?.id)] || "";
    facts.drives.push({ team, result: d.displayResult || d.result || "", summary: d.description || "" });
    for (const p of plays) {
      const yds = Number(p.statYardage) || 0;
      const txt = `${p.type?.text || ""} ${p.text || ""}`;
      if (Math.abs(yds) >= 20 || (NOTABLE.test(txt) && !/extra point|kickoff|no play/i.test(txt))) {
        facts.notable.push({ q: Number(p.period?.number), clock: p.clock?.displayValue || "", offense: team, play: clip(p.text, 170) });
      }
    }
  }
  facts.notable = facts.notable.slice(-16);
  if (demo) {                                        // a final replayed at its half: the half's score, no full-game numbers
    const last = (sum.drives?.previous || []).flatMap((d) => d.plays || []).filter((p) => Number(p.period?.number) <= 2).at(-1);
    if (last) { away.score = Number(last.awayScore) || 0; home.score = Number(last.homeScore) || 0; }
    facts.leaders = []; facts.teamStats = {}; facts.status = "Halftime";
  }
  return facts;
}

// The model's lines, checked: 8 to 24 of them, a known speaker each, sane lengths, everyone heard.
export function cleanScript(out) {
  const lines = Array.isArray(out?.lines) ? out.lines : [];
  const ok = lines
    .map((l) => ({ who: Number(l?.who), text: clip(String(l?.text || "").replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, ""), 220) }))
    .filter((l) => Number.isInteger(l.who) && l.who >= 0 && l.who <= 3 && l.text.length >= 2);
  if (ok.length < 8 || ok.length > 24) return null;
  if (new Set(ok.map((l) => l.who)).size < 4) return null;
  return ok;
}

/* ── Firestore (service account, as books.mjs) ── */
let tok = null;
const b64u = (x) => (Buffer.isBuffer(x) ? x : Buffer.from(x)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function googleToken() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  if (tok && Date.now() < tok.exp - 60000) return tok.token;
  const sa = JSON.parse(raw);
  const crypto = await import("node:crypto");
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64u(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/datastore", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig = crypto.createSign("RSA-SHA256").update(head + "." + claims).sign(sa.private_key);
  const r = await fetch(process.env.HALFTIME_GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: head + "." + claims + "." + b64u(sig) }),
  });
  if (!r.ok) return null;
  const j = await r.json();
  tok = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return tok.token;
}
const fsRoot = () => process.env.HALFTIME_FIRESTORE_BASE || `https://firestore.googleapis.com/v1/${DOC_BASE}`;
async function readDoc(token, event) {
  const r = await fetch(`${fsRoot()}/${COLL}/${event}`, { headers: { authorization: "Bearer " + token } });
  if (r.status === 404) return { missing: true };
  if (!r.ok) throw new Error("firestore " + r.status);
  const j = await r.json();
  const f = j.fields || {};
  return { status: f.status?.stringValue || "", at: Number(f.at?.integerValue || 0), tries: Number(f.tries?.integerValue || 0), payload: f.payload?.stringValue || "", updateTime: j.updateTime };
}
// One write, with a precondition: {exists:false} to claim a new game, {updateTime} to take over a
// stale claim. A lost race comes back non-2xx and means someone else is writing it.
async function writeDoc(token, event, fields, pre) {
  const w = { update: { name: `${DOC_BASE}/${COLL}/${event}`, fields } };
  if (pre) w.currentDocument = pre;
  const r = await fetch(`${fsRoot()}:commit`, {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ writes: [w] }),
  });
  return r.ok;
}
const S = (v) => ({ stringValue: String(v) }), I = (v) => ({ integerValue: String(Math.round(v)) });

async function espnSummary(event) {
  const r = await fetch(`${ESPN()}/summary?event=${event}`, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error("espn " + r.status);
  return r.json();
}

/* ── the model ── */
async function writeScript(facts) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { error: "no-key" };
  const body = {
    model: HALFTIME_MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: "user", content: `First-half facts for ${facts.away.name} at ${facts.home.name}:\n${JSON.stringify(facts)}` }],
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    fallbacks: "default",
  };
  const call = (b, beta) => fetch(`${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json", ...(beta ? { "anthropic-beta": "server-side-fallback-2026-07-01" } : {}) },
    body: JSON.stringify(b),
  });
  let r = await call(body, true);
  if (r.status === 400) {                                  // the fallback option refused: ask again without it
    const { fallbacks, ...plain } = body;
    r = await call(plain, false);
  }
  if (!r.ok) return { error: "api-" + r.status };
  const m = await r.json();
  if (m.stop_reason === "refusal") return { error: "refusal" };
  const text = (m.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
  let out;
  try { out = JSON.parse(text); } catch { return { error: "bad-json" }; }
  const lines = cleanScript(out);
  return lines ? { lines, model: m.model || HALFTIME_MODEL } : { error: "bad-script" };
}

// The background job: facts -> script -> the game's doc.
export async function runHalftimeJob(body) {
  if (!body || !process.env.BUCKY_NOTIFY_SECRET || body.secret !== process.env.BUCKY_NOTIFY_SECRET) return;
  const event = String(body.event || "");
  if (!/^\d{6,12}$/.test(event)) return;
  const demo = body.demo === true;
  const token = await googleToken();
  if (!token) return;
  let res;
  try {
    const sum = await espnSummary(event);
    res = await writeScript(halftimeFacts(sum, demo));
  } catch (e) { res = { error: "job" }; }
  const tries = Number(body.tries) || 1;
  const fields = res.lines
    ? { status: S("done"), at: I(Date.now()), tries: I(tries), payload: S(JSON.stringify({ cast: CAST, lines: res.lines, model: res.model })) }
    : { status: S("failed"), at: I(Date.now()), tries: I(tries), payload: S(JSON.stringify({ error: res.error })) };
  try { await writeDoc(token, (demo ? "demo-" : "") + event, fields); } catch { /* the page's poll gives up with the stand-in lines */ }
}

async function startJob(req, event, tries, demo) {
  const url = process.env.HALFTIME_BG_URL || new URL("/.netlify/functions/halftime-background", req.url).href;
  try {
    await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ secret: process.env.BUCKY_NOTIFY_SECRET, event, tries, demo }) });
  } catch { /* the claim goes stale and the next poll retries */ }
}

export default async (req) => {
  const q = new URL(req.url).searchParams, event = q.get("event") || "", demo = q.get("demo") === "1";
  if (!/^\d{6,12}$/.test(event)) return json({ ok: false, reason: "bad-event" }, CACHE_NONE);
  const docId = (demo ? "demo-" : "") + event;
  const token = await googleToken().catch(() => null);
  if (!token) return json({ ok: false, reason: "no-store" }, CACHE_NONE);
  let doc;
  try { doc = await readDoc(token, docId); } catch { return json({ ok: false, reason: "upstream" }, CACHE_NONE); }
  if (doc.status === "done") {
    try { const p = JSON.parse(doc.payload); return json({ ok: true, event, cast: p.cast || CAST, lines: p.lines, model: p.model }, CACHE_DONE); }
    catch { /* a broken doc is re-written below like a failed one */ }
  }
  const stale = !doc.missing && (doc.status !== "pending" || Date.now() - doc.at > STALE_MS);
  if (!doc.missing && !stale) return json({ ok: false, pending: true }, CACHE_WAIT);
  if (!doc.missing && doc.tries >= MAX_TRIES) return json({ ok: false, reason: "failed" }, CACHE_NONE);
  // Nothing written yet (or a dead try): only a game ESPN says is at halftime gets a script.
  let sum;
  try { sum = await espnSummary(event); } catch { return json({ ok: false, reason: "upstream" }, CACHE_NONE); }
  if (demo ? sum?.header?.competitions?.[0]?.status?.type?.state !== "post" : !atHalftime(sum)) return json({ ok: false, reason: demo ? "not-final" : "not-halftime" }, CACHE_NONE);
  const tries = (doc.missing ? 0 : doc.tries) + 1;
  const claimed = await writeDoc(token, docId, { status: S("pending"), at: I(Date.now()), tries: I(tries), payload: S("") },
    doc.missing ? { exists: false } : { updateTime: doc.updateTime }).catch(() => false);
  if (claimed) await startJob(req, event, tries, demo);
  return json({ ok: false, pending: true }, CACHE_WAIT);
};
