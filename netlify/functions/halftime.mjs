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
//   &kind=post (2026-09-28, user: "ok now we need a post game version and this can be about 2
//   minutes long, can differentiate the commentators a bit with more personality"): the postgame
//   desk for a FINAL, about two minutes on the whole game, stored as sunday_halftime/post-<event>.
//   One call per final, the first time anyone opens it.
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
// sunday_desk2 (2026-09-28): the new cast and the replays. Scripts stored under the old collection
// (sunday_halftime) had Chuck and Dot in them and no replays, so every game's script is written anew.
const COLL = "sunday_desk2";
const STALE_MS = 4 * 60 * 1000;
const MAX_TRIES = 3;
const RETRY_MS = 3600e3;

// The desk. Fixed people, so the show has regulars; the page draws them (suits, faces) in this order.
// (2026-09-28, user: "replace Dot Keene with RoboGoat, and chuck varney with Force Ghost John Madden".)
export const CAST = ["Hal Brandt", "Force Ghost John Madden", "Moose Tillman", "RoboGoat"];
// Who they are, for both shows (2026-09-28: "differentiate the commentators a bit with more
// personality"). The ghost is an affectionate tribute: the late coach and broadcaster's joy for the
// game, never words that would embarrass him.
const PEOPLE = `Four regulars sit at the desk, each with their own voice:
0. ${CAST[0]}, the host: a silver-haired pro, smooth as a late-night radio DJ. He loves a groan-worthy pun, keeps the peace when the other two go at it, and hands off to people by name.
1. ${CAST[1]}: the late, great coach and broadcaster, back as a glowing blue Force ghost who drifts in over the desk. Booming, big-hearted joy for the game: a "Boom!" now and then, loves the big guys up front, mud, hard-nosed running and simple truths about football, loves drawing on the telestrator, and makes the odd warm joke about being a ghost. An affectionate tribute: keep him kind, never mean or crude.
2. ${CAST[2]}, former linebacker: loud and all energy, lives for hits, sacks and takeaways, calls a big play "grown-man football", and needles RoboGoat's numbers every chance he gets.
3. ${CAST[3]}: the GFFL's robot goat (the league is the G.O.A.T. league), the numbers and fantasy analyst. Precise and deadpan, settles arguments with a stat from the facts, makes the odd beep or whirr of computing and the rare bleat, likes a goat pun, talks straight to fantasy managers about who helped or hurt their lineups, and gets in one dry zinger at the humans.
Give each of them their own rhythm and habits, but never repeat the same catchphrase twice. They react to each other, tease and disagree a little; every line should sound like only its speaker could have said it.`;
// The replays (2026-09-28, user: "2-3 replays where an analyst brings up a specific play and it shows
// that replay along with the commentary words overlaid on top"). Each scoring and notable play in the
// facts carries its ESPN id; a line's `replay` names the play shown while it is spoken.
const TAPE = (n) => `Go to the tape ${n === 2 ? "twice" : "three times"}, as a real desk does: an analyst calls up a specific play from the facts (each scoring and notable play has an "id"), and the page cuts to a replay of it. For each replay, the line that calls for it and the one or two lines after it are spoken over the replay, so they describe what we are watching, telestrator style; give those lines the play's id in "replay". Use different plays, spread through the show. Every other line has "replay": "".`;
const RULES = `Use only the facts you are given: the score, the scoring plays, the leaders, the big plays and turnovers, the drives, the team numbers. Do not invent stats, injuries, quotes, records or storylines that are not in the facts. Name players as the facts do (full name the first time, last name after). Keep it family friendly. Plain spoken sentences only: no emoji, no stage directions, no hashtags, and do not start a line with a speaker's name.`;
const SHOW = {
  half: `You write the halftime desk segment for a retro, 16-bit style NFL broadcast shown inside a family fantasy football app (the GFFL). ${PEOPLE}

Write about one minute of back-and-forth on this game's FIRST HALF: 14 to 18 lines, 150 to 190 words in all, no line over 24 words. The host opens with the score and closes by sending it back to the second half; each analyst speaks at least 3 times.

${TAPE(2)}

${RULES}`,
  post: `You write the postgame desk segment for a retro, 16-bit style NFL broadcast shown inside a family fantasy football app (the GFFL). ${PEOPLE}

Write about two minutes of back-and-forth on this FINISHED game: 26 to 32 lines, 300 to 370 words in all, no line over 26 words. The host opens with the final score and signs the show off at the end; each analyst speaks at least 6 times. Cover how the game was won and lost, the turning point, the player of the game, a play each analyst loved, and the fantasy fallout for the leaders. Give it some shape: a first take, an argument, a verdict.

${TAPE(3)}

${RULES}`,
};

const SCHEMA = {
  type: "object",
  properties: {
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: { who: { type: "integer", enum: [0, 1, 2, 3] }, text: { type: "string" }, replay: { type: "string" } },
        required: ["who", "text", "replay"],
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
    "netlify-vary": "query=event|demo|kind",
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
// The first half as facts (or, for the postgame desk, the whole game): everything the desk may talk
// about. `mode`: true / "demo" (a final cut at its half), "post" (the whole final), else the half.
export function halftimeFacts(sum, mode) {
  const demo = mode === true || mode === "demo", maxQ = mode === "post" ? 99 : 2;
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
  facts.scoring = (sum.scoringPlays || []).filter((p) => Number(p.period?.number) <= maxQ).map((p) => ({
    id: String(p.id || ""), q: Number(p.period?.number), clock: p.clock?.displayValue || "", team: p.team?.abbreviation || byId[String(p.team?.id)] || "", play: clip(p.text, 160), score: `${away.abbr} ${p.awayScore} - ${p.homeScore} ${home.abbr}`,
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
    const plays = (d.plays || []).filter((p) => Number(p.period?.number) <= maxQ);
    if (!plays.length) continue;
    const team = d.team?.abbreviation || byId[String(d.team?.id)] || "";
    facts.drives.push({ team, result: d.displayResult || d.result || "", summary: d.description || "" });
    for (const p of plays) {
      const yds = Number(p.statYardage) || 0;
      const txt = `${p.type?.text || ""} ${p.text || ""}`;
      if (Math.abs(yds) >= 20 || (NOTABLE.test(txt) && !/extra point|kickoff|no play/i.test(txt))) {
        facts.notable.push({ id: String(p.id || ""), q: Number(p.period?.number), clock: p.clock?.displayValue || "", offense: team, play: clip(p.text, 170) });
      }
    }
  }
  facts.notable = facts.notable.slice(maxQ > 2 ? -28 : -16);
  if (demo) {                                        // a final replayed at its half: the half's score, no full-game numbers
    const last = (sum.drives?.previous || []).flatMap((d) => d.plays || []).filter((p) => Number(p.period?.number) <= 2).at(-1);
    if (last) { away.score = Number(last.awayScore) || 0; home.score = Number(last.homeScore) || 0; }
    facts.leaders = []; facts.teamStats = {}; facts.status = "Halftime";
  }
  return facts;
}

// The model's lines, checked: 8 to 24 of them (16 to 40 for the postgame show), a known speaker
// each, sane lengths, everyone heard.
// A line's replay is kept only if it names a play in the facts (`plays`, a Set of ids), at most three
// replays a show, each over three lines at most; any other replay is dropped, the line kept.
export function cleanScript(out, post, plays) {
  const lines = Array.isArray(out?.lines) ? out.lines : [];
  const ok = lines
    .map((l) => ({ who: Number(l?.who), text: clip(String(l?.text || "").replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, ""), 220), replay: String(l?.replay || "").trim() }))
    .filter((l) => Number.isInteger(l.who) && l.who >= 0 && l.who <= 3 && l.text.length >= 2);
  if (post ? ok.length < 16 || ok.length > 40 : ok.length < 8 || ok.length > 24) return null;
  if (new Set(ok.map((l) => l.who)).size < 4) return null;
  let segs = 0, run = 0;
  ok.forEach((l, i) => {
    if (!l.replay || !plays?.has(l.replay)) { l.replay = ""; run = 0; return; }
    const cont = i > 0 && ok[i - 1].replay === l.replay;
    if (!cont) { segs++; run = 0; }
    run++;
    if (segs > 3 || run > 3) l.replay = "";
  });
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
async function writeScript(facts, post) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { error: "no-key" };
  const body = {
    model: HALFTIME_MODEL,
    max_tokens: 16000,
    system: post ? SHOW.post : SHOW.half,
    messages: [{ role: "user", content: `${post ? "Final" : "First-half"} facts for ${facts.away.name} at ${facts.home.name}:\n${JSON.stringify(facts)}` }],
    // Low effort (2026-09-28, user: "lets go back to the script generating when the first person opens
    // the game … the hope is that opus 5.5 low is quick"): measured on one postgame script, low
    // skipped thinking (1,444 output tokens against medium's ~3-4k), so it writes in a fraction of
    // the time, at about 5 cents instead of 10. The trial's one slip (five field goals for four)
    // is the price; the prompt's facts-only rules stand.
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    fallbacks: "default",
    // Streamed (2026-09-28): three of the week's postgame calls threw every try. A long answer sent
    // whole sends no headers until Opus finishes thinking, and Node's fetch gives up after 5 minutes
    // without headers; a stream starts at once and keeps sending.
    stream: true,
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
  const m = readStream(await r.text());
  if (m.error) return { error: "api-" + m.error };
  if (m.stop_reason === "refusal") return { error: "refusal" };
  if (m.stop_reason === "max_tokens") return { error: "max-tokens" };
  let out;
  try { out = JSON.parse(m.text); } catch { return { error: "bad-json" }; }
  const lines = cleanScript(out, post, new Set([...facts.scoring, ...facts.notable].map((p) => p.id).filter(Boolean)));
  return lines ? { lines, model: m.model || HALFTIME_MODEL, usage: m.usage } : { error: "bad-script" };
}
// The Messages API's event stream, folded back into one message: the model, the text blocks' text,
// the stop reason, the token counts (input from message_start, output from message_delta), or the
// stream's own error event.
export function readStream(raw) {
  const m = { model: null, text: "", stop_reason: null, usage: {}, error: null };
  for (const block of String(raw).split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
    if (!data) continue;
    let e;
    try { e = JSON.parse(data); } catch { continue; }
    if (e.type === "message_start") { m.model = e.message?.model || null; Object.assign(m.usage, e.message?.usage || {}); }
    else if (e.type === "content_block_delta" && e.delta?.type === "text_delta") m.text += e.delta.text || "";
    else if (e.type === "message_delta") { if (e.delta?.stop_reason) m.stop_reason = e.delta.stop_reason; Object.assign(m.usage, e.usage || {}); }
    else if (e.type === "error") m.error = e.error?.type || "stream";
  }
  return m;
}

// The background job: facts -> script -> the game's doc.
export async function runHalftimeJob(body) {
  if (!body || !process.env.BUCKY_NOTIFY_SECRET || body.secret !== process.env.BUCKY_NOTIFY_SECRET) return;
  const event = String(body.event || "");
  if (!/^\d{6,12}$/.test(event)) return;
  const demo = body.demo === true, post = body.kind === "post";
  const token = await googleToken();
  if (!token) return;
  let res;
  try {
    const sum = await espnSummary(event);
    res = await writeScript(halftimeFacts(sum, post ? "post" : demo), post);
  } catch (e) { res = { error: "job: " + String(e?.cause?.code || e?.message || e).slice(0, 80) }; }
  const tries = Number(body.tries) || 1;
  const ms = Number(body.at) > 0 ? Date.now() - Number(body.at) : null;      // how long it took, claim to script
  const fields = res.lines
    ? { status: S("done"), at: I(Date.now()), tries: I(tries), payload: S(JSON.stringify({ cast: CAST, lines: res.lines, model: res.model, usage: res.usage || null, ms })) }
    : { status: S("failed"), at: I(Date.now()), tries: I(tries), payload: S(JSON.stringify({ error: res.error })) };
  try { await writeDoc(token, (post ? "post-" : demo ? "demo-" : "") + event, fields); } catch { /* the page's poll gives up with the stand-in lines */ }
}

async function startJob(url, event, tries, demo, kind, at) {
  try {
    await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ secret: process.env.BUCKY_NOTIFY_SECRET, event, tries, demo, kind, at }) });
  } catch { /* the claim goes stale and the next poll retries */ }
}

// Make sure a script exists or is being written: serve the stored one, or claim the doc and start the
// background job, on the first viewer's request (the scheduled sweep that pre-wrote scripts, deskcron,
// was taken out 2026-09-28, user: "rather than pre generating the scripts, lets go back to the script
// generating when the first person opens the game … That way we save cost if nobody watches them").
// -> { done: payload } |
// { pending: true } | { reason }.
async function ensureScript(token, event, mode, bgUrl) {
  const post = mode === "post", demo = mode === "demo";
  const docId = (post ? "post-" : demo ? "demo-" : "") + event;
  let doc;
  try { doc = await readDoc(token, docId); } catch { return { reason: "upstream" }; }
  if (doc.status === "done") {
    try { return { done: JSON.parse(doc.payload) }; }
    catch { /* a broken doc is re-written below like a failed one */ }
  }
  const stale = !doc.missing && (doc.status !== "pending" || Date.now() - doc.at > STALE_MS);
  if (!doc.missing && !stale) return { pending: true, since: doc.at };
  // Three tries, then a rest: a game whose tries all failed may try again after an hour (so a fix
  // reaches it), still at most three calls an hour.
  const rested = !doc.missing && doc.tries >= MAX_TRIES && Date.now() - doc.at > RETRY_MS;
  if (!doc.missing && doc.tries >= MAX_TRIES && !rested) { let detail = null; try { detail = JSON.parse(doc.payload).error || null; } catch {} return { reason: "failed", detail }; }
  // Nothing written yet (or a dead try): only a game ESPN says is at halftime gets a script (a final,
  // for the postgame desk and the demo).
  let sum;
  try { sum = await espnSummary(event); } catch { return { reason: "upstream" }; }
  const final = sum?.header?.competitions?.[0]?.status?.type?.state === "post";
  if (post || demo ? !final : !atHalftime(sum)) return { reason: post || demo ? "not-final" : "not-halftime" };
  const tries = (doc.missing || rested ? 0 : doc.tries) + 1;
  const at = Date.now();
  const claimed = await writeDoc(token, docId, { status: S("pending"), at: I(at), tries: I(tries), payload: S("") },
    doc.missing ? { exists: false } : { updateTime: doc.updateTime }).catch(() => false);
  if (claimed) await startJob(bgUrl, event, tries, demo, post ? "post" : "half", at);
  return { pending: true, since: at };
}

export default async (req) => {
  const q = new URL(req.url).searchParams, event = q.get("event") || "", post = q.get("kind") === "post", demo = !post && q.get("demo") === "1";
  if (!/^\d{6,12}$/.test(event)) return json({ ok: false, reason: "bad-event" }, CACHE_NONE);
  const token = await googleToken().catch(() => null);
  if (!token) return json({ ok: false, reason: "no-store" }, CACHE_NONE);
  const bgUrl = process.env.HALFTIME_BG_URL || new URL("/.netlify/functions/halftime-background", req.url).href;
  const r = await ensureScript(token, event, post ? "post" : demo ? "demo" : "half", bgUrl);
  if (r.done) return json({ ok: true, event, cast: r.done.cast || CAST, lines: r.done.lines, model: r.done.model, usage: r.done.usage || null, ms: r.done.ms ?? null }, CACHE_DONE);
  // `since`: when the first viewer's request started the job, so every viewer's countdown agrees.
  if (r.pending) return json({ ok: false, pending: true, since: r.since || null }, CACHE_WAIT);
  return json({ ok: false, reason: r.reason, ...(r.detail ? { detail: r.detail } : {}) }, CACHE_NONE);   // (why the last try failed)
};
