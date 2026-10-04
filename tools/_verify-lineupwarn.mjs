#!/usr/bin/env node
/**
 * GFFL lineup warning (netlify/functions/lineupwarn.mjs) — in-process suite, zero real network.
 *
 *   node tools/_verify-lineupwarn.mjs
 *
 * Fake local servers stand in for Google's token endpoint, Firestore (tools/_fakefs.mjs — it
 * refuses what the real service refuses: unmasked PATCH, JS-number integerValue, exists=false
 * over an existing doc -> 409, a wrong-typed query value matching nothing), FCM and ESPN.
 *
 * The fixture is REAL data: tools/fixtures/lineupwarn-w4.json holds the eight week-4 roster docs,
 * the injstate_2026 designations for the rostered keys and ESPN's week-4 scoreboard, all captured
 * read-only on Sunday 2026-10-04 ~12:13Z. In it ESKY (team 2) starts Terry McLaurin (WSH, OUT;
 * WSH@IND kicks off 13:30Z = 8:30 AM CDT) and KRUZ (team 11) starts Jadarian Price (SEA, IR;
 * SEA@LAC kicks off 20:25Z = 3:25 PM CDT). Jalen Coker (CAR, KRUZ) is only Q — not warned.
 *
 * Hand arithmetic used below: a kickoff is warned when 75 <= (kickoff - now) < 105 minutes, so
 *   McLaurin 13:30Z -> ticks in (11:45Z, 12:15Z]   -> the 12:00Z and 12:15Z ticks see him
 *   Price    20:25Z -> ticks in (18:40Z, 19:10Z]   -> 19:00Z sees him
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createStore, handleDoc, runQuery, putDoc, getDocFields, decode } from "./_fakefs.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
let pass = 0, fail = 0;
const failures = [];
const ok = (cond, name) => {
  if (cond) { pass++; console.log("  ok  " + name); } else { fail++; failures.push(name); console.log("  FAIL " + name); }
};
const section = (t) => console.log("\n=== " + t + " ===");

const GOOG = 8951, FS = 8952, FCM = 8953, ESPN = 8954;
const FAM = "famtestlw";
const BASE = "projects/amen-farms-app/databases/(default)/documents";
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "lineupwarn-w4.json"), "utf8"));

/* ------------------------------- fake servers ------------------------------- */
const KEY = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const SA_JSON = JSON.stringify({ client_email: "t@amen-farms-app.iam.gserviceaccount.com", private_key: KEY.privateKey.export({ type: "pkcs8", format: "pem" }) });
const S = { store: createStore(), queries: 0, requests: 0, fcm: [], fcmBehavior: new Map(), fcmDelay: 0, inflight: 0, maxInflight: 0,
  espnStatus: 200, espnBody: null, espnUrls: [], espnUA: [], patchFail: 0 };
function reset() {
  S.store = createStore(); S.queries = 0; S.requests = 0; S.fcm = []; S.fcmBehavior = new Map(); S.fcmDelay = 0;
  S.inflight = 0; S.maxInflight = 0; S.espnStatus = 200; S.espnBody = FIX.scoreboard; S.espnUrls = []; S.espnUA = []; S.patchFail = 0;
}
function listen(port, handler) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let raw = ""; req.on("data", (c) => { raw += c; });
      req.on("end", () => handler(req, res, raw));
    });
    srv.listen(port, "127.0.0.1", () => resolve(srv));
  });
}
const sendJson = (res, status, obj) => { res.statusCode = status; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(obj)); };
const servers = async () => Promise.all([
  listen(GOOG, (req, res) => sendJson(res, 200, { access_token: "fake", expires_in: 3600 })),
  listen(FS, (req, res, raw) => {
    S.requests++;
    const url = new URL(req.url, "http://x");
    if (req.method === "POST" && url.pathname.endsWith(":runQuery")) {
      S.queries++;
      let q = null; try { q = JSON.parse(raw).structuredQuery; } catch {}
      const r = runQuery(S.store, BASE, q);
      return sendJson(res, r.status, r.body);
    }
    const m = /\/documents\/(.+)$/.exec(url.pathname);
    if (!m) return sendJson(res, 404, {});
    if (req.method === "PATCH" && S.patchFail > 0) { S.patchFail--; return sendJson(res, 503, { error: { status: "UNAVAILABLE" } }); }
    let body = null; try { body = raw ? JSON.parse(raw) : null; } catch {}
    const r = handleDoc(S.store, BASE, req.method, m[1], url.searchParams, body);
    sendJson(res, r.status, r.body);
  }),
  listen(FCM, (req, res, raw) => {
    let body = null; try { body = JSON.parse(raw); } catch {}
    S.fcm.push(body);
    const token = body && body.message && body.message.token;
    const b = S.fcmBehavior.get(token) || { status: 200, body: { name: "m" } };
    S.inflight++; S.maxInflight = Math.max(S.maxInflight, S.inflight);
    setTimeout(() => { S.inflight--; sendJson(res, b.status, b.body); }, S.fcmDelay);
  }),
  listen(ESPN, (req, res) => {
    S.espnUrls.push(req.url); S.espnUA.push(req.headers["user-agent"]);
    sendJson(res, S.espnStatus, S.espnBody || {});
  }),
]);

/* ------------------------------- fixture builders ------------------------------- */
function seedLeague({ week = 4, rosters = FIX.rosters, injstate = FIX.injstate } = {}) {
  for (const [id, d] of Object.entries(rosters)) putDoc(S.store, "gffl_" + FAM, id, d.fields);
  putDoc(S.store, "gffl_" + FAM, "injstate_2026", injstate.fields);
}
let dseq = 0;
function addDevice({ token, team, teamType = "int", mutes, user }) {
  const f = { token: { stringValue: token } };
  if (user) f.user = { stringValue: user };
  if (team != null) f.gfflTeam = teamType === "double" ? { doubleValue: team } : { integerValue: String(team) };
  if (mutes) f.gfflMutes = { arrayValue: mutes.length ? { values: mutes.map((k) => ({ stringValue: k })) } : {} };
  const id = "dev" + (++dseq);
  putDoc(S.store, "pushTokens_" + FAM, id, f);
  return id;
}
const T = (iso) => Date.parse(iso);
const markers = () => [...S.store.docs.keys()].filter((k) => k.startsWith("lineupwarn_sent_" + FAM + "/")).map((k) => k.split("/")[1]).sort();
const fcmTokens = () => S.fcm.map((c) => c.message.token);
const plog = () => { const d = getDocFields(S.store, "pushlog_" + FAM, "2026"); return d ? decode(d.entries) : []; };

let handler = null, mod = null;
async function tick(iso) {
  process.env.LINEUPWARN_TEST_NOW_MS = String(typeof iso === "number" ? iso : T(iso));
  const res = await handler();
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, body };
}

async function main() {
  process.env.LINEUPWARN_FAMILY_KEY = FAM;
  process.env.LINEUPWARN_FIRESTORE_BASE = `http://127.0.0.1:${FS}/v1/${BASE}`;
  process.env.LINEUPWARN_TOKEN_URL = `http://127.0.0.1:${GOOG}/token`;
  process.env.LINEUPWARN_FCM_BASE = `http://127.0.0.1:${FCM}`;
  process.env.LINEUPWARN_ESPN_BASE = `http://127.0.0.1:${ESPN}`;
  process.env.LINEUPWARN_FETCH_TIMEOUT_MS = "400";
  process.env.FIREBASE_SERVICE_ACCOUNT = SA_JSON;
  const srvs = await servers();
  mod = await import("file://" + path.join(ROOT, "netlify", "functions", "lineupwarn.mjs").replace(/\\/g, "/"));
  handler = mod.default;
  ok(typeof handler === "function", "lineupwarn.mjs exports a default handler");

  section("0. netlify.toml declares the schedule");
  const toml = fs.readFileSync(path.join(ROOT, "netlify.toml"), "utf8");
  ok(/\[functions\."lineupwarn"\][^\[]*schedule\s*=\s*"\*\/15 11-23,0,1 \* \* \*"/.test(toml),
    'netlify.toml schedules lineupwarn at "*/15 11-23,0,1 * * *" (UTC 11:00-01:59 = Central 06:00-20:59 CDT / 05:00-19:59 CST)');
  // The cron must reach every real slot in BOTH DST states: the 75-105 minute window puts the
  // warning tick at (kickoff - 90m). Latest slot in the data: Mon 7:15 PM Central (01:15Z CDT, or
  // 01:15Z... 7:15 PM CST = 01:15Z next day) -> warn at 23:45Z; earliest: the 8:30 AM Central London
  // game -> warn at 7:00 AM Central = 12:00Z (CDT) / 13:00Z (CST). All inside 11:00-01:59Z.
  const inBand = (h) => h >= 11 || h <= 1;
  ok([12, 13, 17, 19, 21, 23, 0, 1].every(inBand) && !inBand(5) && !inBand(10), "the cron's UTC hours cover those warning ticks and exclude the small hours");

  /* ============ A. the real week-4 Sunday: who gets warned, and what it says ============ */
  section("A. real week-4 data: McLaurin (ESKY, OUT) and Price (KRUZ, IR)");
  reset(); seedLeague();
  const dEsky = addDevice({ token: "TOK_ESKY", team: 2 });
  const dEsky2 = addDevice({ token: "TOK_ESKY_MUTED", team: 2, mutes: ["lineup"] });
  const dKruz = addDevice({ token: "TOK_KRUZ", team: 11, teamType: "double" });
  const dKreu = addDevice({ token: "TOK_KREU", team: 1 });
  const dFam = addDevice({ token: "TOK_FAMILY", user: "Dad" });

  const a0 = await tick("2026-10-04T11:44:59Z"); // 75+... 13:30-11:44:59 = 105:01 -> outside
  ok(a0.body.skipped === true && a0.body.reason === "no-kickoff-in-window", `A0: 105 min 1 s before kickoff is outside the window (${a0.body.reason})`);
  ok(S.requests === 0 && S.queries === 0, "A0: …and a tick with nothing in window touched Firestore zero times (one scoreboard fetch only)");
  ok(S.espnUrls.length === 1 && /week=4&seasontype=2&dates=2026/.test(S.espnUrls[0]) && S.espnUA[0] === "curl/8.6.0",
    `A0: the scoreboard asked for week 4, regular season, 2026, with the curl UA ESPN's edge allows (${S.espnUrls[0]})`);

  const a1 = await tick("2026-10-04T12:00:00Z");
  ok(a1.status === 200 && a1.body.sent === 1 && a1.body.warned === 1, `A1: the 12:00Z tick warns once (${JSON.stringify(a1.body)})`);
  ok(JSON.stringify(fcmTokens()) === JSON.stringify(["TOK_ESKY"]), `A1: ONLY team 2's un-muted device was pushed — not the muted one, not other teams, not the family-only device (${fcmTokens()})`);
  const m1 = S.fcm[0].message;
  ok(m1.data.body === "Terry McLaurin is Out and in your lineup. Kickoff 8:30 AM.", `A1: exact wording (${m1.data.body})`);
  ok(m1.data.title === "GFFL lineup" && m1.data.url === "https://goatfantasyleague.com/league.html#matchup" && m1.data.tag === "gffl-lineup-3121422",
    "A1: title, league deep link and a per-player tray tag (several warnings in one slot stack instead of replacing each other)");
  ok(m1.webpush.headers.Urgency === "high", "A1: urgent delivery");
  ok(markers().join() === "2026_w4_t2_3121422", `A1: one marker, id season_week_team_playerKey (${markers()})`);
  const mk = getDocFields(S.store, "lineupwarn_sent_" + FAM, "2026_w4_t2_3121422");
  ok(decode(mk.week) === 4 && decode(mk.team) === 2 && decode(mk.at) === T("2026-10-04T12:00:00Z"), "A1: marker carries week 4, team 2 and the tick instant as integers");
  ok(S.store.writes.some((w) => w.coll === "lineupwarn_sent_" + FAM && w.exists === "false" && w.mask.join() === "at,week,team"),
    "A1: the marker was a masked PATCH with currentDocument.exists=false");
  ok(plog().length === 1 && plog()[0].kind === "lineup" && plog()[0].team === 2, `A1: the push log has {kind:"lineup", team:2} (${JSON.stringify(plog())})`);

  const a2 = await tick("2026-10-04T12:15:00Z"); // 13:30-12:15 = 75 min exactly -> still in window
  ok(a2.body.already === 1 && a2.body.sent === 0 && S.fcm.length === 1, `A2: the next tick (75 min out, inside the window) finds the marker and sends nothing more (${JSON.stringify(a2.body)})`);
  const a3 = await tick("2026-10-04T12:15:01Z"); // 74:59 -> outside
  ok(a3.body.reason === "no-kickoff-in-window", "A3: 74 min 59 s out is outside the window");

  const a4 = await tick("2026-10-04T19:00:00Z"); // SEA@LAC 20:25Z
  ok(a4.body.sent === 1 && fcmTokens().slice(1).join() === "TOK_KRUZ", `A4: the 19:00Z tick warns KRUZ's device (doubleValue gfflTeam 11 read as 11) (${JSON.stringify(a4.body)})`);
  ok(S.fcm[1].message.data.body === "Jadarian Price is on IR and in your lineup. Kickoff 3:25 PM.", `A4: IR wording (${S.fcm[1].message.data.body})`);
  ok(!S.fcm.some((c) => /Coker/.test(c.message.data.body)), "A4: Jalen Coker (Q) is not warned — Questionable is noise");
  ok(markers().length === 2 && plog().length === 2, "A4: two markers, two push-log entries");
  ok(!!getDocFields(S.store, "pushTokens_" + FAM, dEsky) && !!getDocFields(S.store, "pushTokens_" + FAM, dKreu), "A4: no token doc was pruned (all deliveries succeeded)");

  // Pure candidate finder against the real slate/rosters: nothing for a player not in a window game.
  const slateOf = (sb) => ({ events: sb.events.map((e) => ({ ms: Date.parse(e.date), teams: e.competitions[0].competitors.map((c) => c.team.abbreviation), pre: e.status.type.state === "pre" })),
    playing: new Set(sb.events.flatMap((e) => e.competitions[0].competitors.map((c) => c.team.abbreviation))), complete: true });
  const rostersOf = () => Object.entries(FIX.rosters).map(([id, d]) => ({ teamId: Number(/_t(\d+)$/.exec(id)[1]),
    players: d.fields.players.arrayValue.values.map((v) => { const m = v.mapValue.fields; const g = (k) => (m[k] && m[k].stringValue) || ""; return { key: g("key"), name: g("name"), slot: g("slot"), team: g("team"), injury: g("injury") }; }) }));
  const injOf = FIX.injstate.fields;
  const allDay = mod.findCandidates(T("2026-10-04T12:00:00Z"), slateOf(FIX.scoreboard), rostersOf(), injOf);
  ok(allDay.length === 1 && allDay[0].name === "Terry McLaurin" && allDay[0].teamId === 2 && allDay[0].desig === "OUT",
    `A5: at 12:00Z the finder returns exactly McLaurin (${allDay.map((c) => c.name)})`);
  const pm = mod.findCandidates(T("2026-10-04T22:50:00Z"), slateOf(FIX.scoreboard), rostersOf(), injOf);
  ok(pm.length === 0, `A5: at 22:50Z (CAR@DET in window) no starter is Out/IR/D — Coker is only Q (${pm.map((c) => c.name)})`);

  /* ============================ B. bench, IR slot, healthy ============================ */
  section("B. only STARTERS, only unavailable designations");
  reset(); seedLeague(); addDevice({ token: "TOK_ESKY", team: 2 });
  // Move McLaurin to the bench: hand-edit the roster doc's slot.
  {
    const f = JSON.parse(JSON.stringify(FIX.rosters.roster_2026_w4_t2.fields));
    for (const v of f.players.arrayValue.values) if (v.mapValue.fields.key.stringValue === "3121422") v.mapValue.fields.slot = { stringValue: "BENCH" };
    S.store.docs.get("gffl_" + FAM + "/roster_2026_w4_t2").fields = f;
  }
  const b1 = await tick("2026-10-04T12:00:00Z");
  ok(b1.body.candidates === 0 && S.fcm.length === 0, `B1: McLaurin on the BENCH is not warned (${JSON.stringify(b1.body)})`);
  // Designations: D warns, Q / NA / COV / "" do not; each wording.
  const roster = (slot, key, name, team) => ({ mapValue: { fields: { slot: { stringValue: slot }, key: { stringValue: key }, name: { stringValue: name }, team: { stringValue: team }, pos: { stringValue: "WR" } } } });
  reset();
  putDoc(S.store, "gffl_" + FAM, "roster_2026_w4_t2", { kind: { stringValue: "roster" }, week: { integerValue: "4" }, teamId: { integerValue: "2" },
    players: { arrayValue: { values: [roster("WR", "k1", "Dee Doubtful", "WSH"), roster("WR", "k2", "Quinn Q", "WSH"), roster("WR", "k3", "Nate NA", "WSH"),
      roster("WR", "k4", "Sam Sus", "WSH"), roster("WR", "k5", "Pat Pup", "WSH"), roster("IR", "k6", "Ira Slot", "WSH"), roster("WR", "k7", "Hal Healthy", "WSH")] } } });
  putDoc(S.store, "gffl_" + FAM, "injstate_2026", { kind: { stringValue: "injstate" }, p_k1: { stringValue: "D" }, p_k2: { stringValue: "Q" }, p_k3: { stringValue: "NA" },
    p_k4: { stringValue: "SUS" }, p_k5: { stringValue: "PUP" }, p_k6: { stringValue: "OUT" }, p_k7: { stringValue: "" } });
  addDevice({ token: "TOK_ESKY", team: 2 });
  const b2 = await tick("2026-10-04T12:00:00Z");
  const bodies = S.fcm.map((c) => c.message.data.body).sort();
  ok(JSON.stringify(bodies) === JSON.stringify([
    "Dee Doubtful is Doubtful and in your lineup. Kickoff 8:30 AM.",
    "Pat Pup is on PUP and in your lineup. Kickoff 8:30 AM.",
    "Sam Sus is suspended and in your lineup. Kickoff 8:30 AM."]), `B2: D, PUP and SUS warn; Q, NA, healthy, and an OUT man in an IR slot do not (${JSON.stringify(bodies)})`);
  ok(b2.body.warned === 3 && markers().length === 3, "B2: one marker per player — three players, three markers");

  /* ================================ C. byes ================================ */
  section("C. a starter on a bye");
  reset(); seedLeague(); addDevice({ token: "TOK_KREU", team: 1 });
  // Team 1 starts Bijan Robinson (ATL). Remove NO@ATL from the slate -> ATL is on a bye.
  const sbBye = JSON.parse(JSON.stringify(FIX.scoreboard));
  sbBye.events = sbBye.events.filter((e) => !e.competitions[0].competitors.some((c) => c.team.abbreviation === "ATL"));
  S.espnBody = sbBye;
  const c1 = await tick("2026-10-04T12:00:00Z");
  const kreuBodies = S.fcm.map((c) => c.message.data.body);
  ok(kreuBodies.includes("Bijan Robinson is on a bye and in your lineup."), `C1: ATL absent from a 15-game slate -> a bye warning with no kickoff (${JSON.stringify(kreuBodies)})`);
  ok(S.fcm.every((c) => c.message.token === "TOK_KREU"), "C1: only team 1's device was pushed");
  // The same slate cut to 5 games must NOT mint byes for everyone.
  reset(); seedLeague(); addDevice({ token: "TOK_KREU", team: 1 });
  const sbShort = JSON.parse(JSON.stringify(FIX.scoreboard));
  sbShort.events = sbShort.events.slice(0, 5);
  S.espnBody = sbShort;
  const c2 = await tick("2026-10-04T12:00:00Z");
  ok(S.fcm.length === 0, `C2: a 5-event scoreboard is not trusted for byes (${JSON.stringify(c2.body)})`);

  /* ============== D. Central time across the 2026-11-01 DST change ============== */
  section("D. DST: same wall-clock kickoff on both sides of 2026-11-01, and the week boundary");
  const synthetic = (week, kickoffIso, extraEvents = 7) => {
    const events = [{ id: "e1", date: kickoffIso, status: { type: { state: "pre" } }, competitions: [{ competitors: [{ team: { abbreviation: "WSH" } }, { team: { abbreviation: "IND" } }] }] }];
    const filler = ["BUF", "NE", "CHI", "NYJ", "CIN", "JAX", "NYG", "ARI", "PHI", "LAR", "TB", "GB", "BAL", "TEN", "HOU", "DAL"];
    for (let i = 0; i < extraEvents; i++) events.push({ id: "f" + i, date: "2026-12-31T00:00Z", status: { type: { state: "pre" } },
      competitions: [{ competitors: [{ team: { abbreviation: filler[2 * i] } }, { team: { abbreviation: filler[2 * i + 1] } }] }] });
    return { season: { year: 2026 }, week: { number: week }, events };
  };
  const seedWeek = (week) => {
    putDoc(S.store, "gffl_" + FAM, `roster_2026_w${week}_t2`, { kind: { stringValue: "roster" }, week: { integerValue: String(week) }, teamId: { integerValue: "2" },
      players: { arrayValue: { values: [roster("WR", "3121422", "Terry McLaurin", "WSH")] } } });
    putDoc(S.store, "gffl_" + FAM, "injstate_2026", { kind: { stringValue: "injstate" }, p_3121422: { stringValue: "OUT" } });
  };
  // Week 7 (Tue Oct 20 - Mon Oct 26), Sunday Oct 25, CDT: 12:00 PM Central = 17:00Z. Warn tick 15:30Z.
  reset(); seedWeek(7); addDevice({ token: "TOK_ESKY", team: 2 }); S.espnBody = synthetic(7, "2026-10-25T17:00Z");
  const d1 = await tick("2026-10-25T15:30:00Z");
  ok(d1.body.sent === 1 && S.fcm[0].message.data.body === "Terry McLaurin is Out and in your lineup. Kickoff 12:00 PM.", `D1: Oct 25 17:00Z is 12:00 PM CDT (${S.fcm[0] && S.fcm[0].message.data.body})`);
  ok(/week=7&/.test(S.espnUrls[0]), "D1: Oct 25 is league week 7");
  // Week 8 (Tue Oct 27 - Mon Nov 2), Sunday Nov 1 — the fall-back day. 12:00 PM Central = 18:00Z (CST). Warn tick 16:30Z.
  reset(); seedWeek(8); addDevice({ token: "TOK_ESKY", team: 2 }); S.espnBody = synthetic(8, "2026-11-01T18:00Z");
  const d2 = await tick("2026-11-01T16:30:00Z");
  ok(d2.body.sent === 1 && S.fcm[0].message.data.body === "Terry McLaurin is Out and in your lineup. Kickoff 12:00 PM.", `D2: Nov 1 18:00Z is 12:00 PM CST — the SAME wall time one UTC hour later (${S.fcm[0] && S.fcm[0].message.data.body})`);
  ok(/week=8&/.test(S.espnUrls[0]), "D2: Nov 1 is league week 8");
  // An 8:30 AM Central London slot on Nov 1 itself (14:30Z CST): the warning tick is 13:00Z.
  reset(); seedWeek(8); addDevice({ token: "TOK_ESKY", team: 2 }); S.espnBody = synthetic(8, "2026-11-01T14:30Z");
  const d3 = await tick("2026-11-01T13:00:00Z");
  ok(d3.body.sent === 1 && /Kickoff 8:30 AM\.$/.test(S.fcm[0].message.data.body), `D3: 14:30Z on Nov 1 is 8:30 AM CST (${S.fcm[0] && S.fcm[0].message.data.body})`);
  // Week boundary: week 9 starts Tue Nov 3 05:00 CST = 11:00Z (CDT would put it at 10:00Z).
  reset(); seedWeek(8); S.espnBody = synthetic(8, "2026-11-03T13:00Z");
  await tick("2026-11-03T10:59:59Z");
  ok(/week=8&/.test(S.espnUrls[0]), "D4: 10:59:59Z on Tue Nov 3 (04:59 CST) is still week 8 — an -05:00 assumption would already say 9");
  await tick("2026-11-03T11:00:00Z");
  ok(/week=9&/.test(S.espnUrls[1]), "D4: 11:00:00Z (05:00 CST) is week 9");
  // Monday night Nov 2 7:15 PM CST = 01:15Z Nov 3 belongs to week 8; its warning tick 23:45Z Nov 2.
  reset(); seedWeek(8); addDevice({ token: "TOK_ESKY", team: 2 }); S.espnBody = synthetic(8, "2026-11-03T01:15Z");
  const d5 = await tick("2026-11-02T23:45:00Z");
  ok(d5.body.week === 8 && d5.body.sent === 1 && /Kickoff 7:15 PM\.$/.test(S.fcm[0].message.data.body), `D5: Monday night's slot stays in week 8 and reads 7:15 PM (${S.fcm[0] && S.fcm[0].message.data.body})`);
  ok(mod.messageFor({ name: "X", desig: "OUT", kickoff: T("2026-10-04T13:30:00Z"), bye: false }).includes("8:30 AM"), "D6: messageFor renders a plain ASCII-space time (no narrow no-break space)");
  ok(!/[  ]/.test(mod.messageFor({ name: "X", desig: "OUT", kickoff: T("2026-10-04T13:30:00Z"), bye: false })), "D6: …verified by code point");

  /* ===================== E. failure handling and fixture strictness ===================== */
  section("E. failures: no devices, dead tokens, FCM down, marker errors, feed down, season end");
  reset(); seedLeague();
  const e1 = await tick("2026-10-04T12:00:00Z");
  ok(e1.body.sent === 0 && markers().length === 0, "E1: a team with no devices burns no marker");
  reset(); seedLeague(); const dDead = addDevice({ token: "TOK_DEAD", team: 2 });
  S.fcmBehavior.set("TOK_DEAD", { status: 404, body: { error: { status: "UNREGISTERED" } } });
  const e2 = await tick("2026-10-04T12:00:00Z");
  ok(e2.body.sent === 0 && e2.body.pruned === 1 && getDocFields(S.store, "pushTokens_" + FAM, dDead) === null, "E2: an unregistered token's doc is pruned");
  ok(markers().length === 0, "E2: …and with nobody reached the marker is released so a later tick can retry");
  reset(); seedLeague(); addDevice({ token: "TOK_500", team: 2 });
  S.fcmBehavior.set("TOK_500", { status: 500, body: { error: { status: "INTERNAL" } } });
  await tick("2026-10-04T12:00:00Z");
  ok(markers().length === 0 && plog().length === 0, "E3: an FCM 500 reaches nobody: marker released, nothing logged");
  S.fcmBehavior.clear();
  const e3b = await tick("2026-10-04T12:15:00Z");
  ok(e3b.body.sent === 1 && markers().length === 1, "E3: the next tick delivers and re-claims the marker");
  reset(); seedLeague(); addDevice({ token: "TOK_ESKY", team: 2 }); S.patchFail = 1;
  const e4 = await tick("2026-10-04T12:00:00Z");
  ok(e4.body.sent === 0 && S.fcm.length === 0, `E4: a 503 on the marker write sends nothing (fail closed) (${JSON.stringify(e4.body)})`);
  const e4b = await tick("2026-10-04T12:15:00Z");
  ok(e4b.body.sent === 1, "E4: …and the next tick, with Firestore healthy again, sends");
  reset(); seedLeague(); addDevice({ token: "TOK_ESKY", team: 2 }); S.espnStatus = 500;
  const e5 = await tick("2026-10-04T12:00:00Z");
  ok(e5.status === 200 && e5.body.reason === "scoreboard-unavailable" && S.fcm.length === 0 && S.requests === 0, "E5: ESPN down -> a quiet skip, no Firestore, no sends");
  // Season end: week 18 with seasonWeeks 14 (+3 playoff weeks = 17) is over.
  reset(); addDevice({ token: "TOK_ESKY", team: 2 });
  putDoc(S.store, "gffl_" + FAM, "settings", { kind: { stringValue: "settings" }, rules: { mapValue: { fields: { seasonWeeks: { integerValue: "14" } } } } });
  seedWeek(18); S.espnBody = synthetic(18, "2027-01-10T18:00Z");
  const e6 = await tick("2027-01-10T16:30:00Z");
  ok(e6.body.reason === "after-season" && S.fcm.length === 0, `E6: week 18 is past seasonWeeks 14 + 3 playoff weeks (${e6.body.reason})`);
  // …but a league with seasonWeeks 15 plays week 18.
  reset(); addDevice({ token: "TOK_ESKY", team: 2 });
  putDoc(S.store, "gffl_" + FAM, "settings", { kind: { stringValue: "settings" }, rules: { mapValue: { fields: { seasonWeeks: { integerValue: "15" } } } } });
  seedWeek(18); S.espnBody = synthetic(18, "2027-01-10T18:00Z");
  const e7 = await tick("2027-01-10T16:30:00Z");
  ok(e7.body.sent === 1, "E7: seasonWeeks 15 -> week 18 is a scoring week and is warned");
  // Before the season.
  reset(); const e8 = await tick("2026-09-01T12:00:00Z");
  ok(e8.body.reason === "before-season", "E8: before week 1 starts nothing runs");
  // Missing service account.
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT; delete process.env.FIREBASE_SERVICE_ACCOUNT;
  const e9 = await tick("2026-10-04T12:00:00Z");
  ok(e9.status === 500 && /FIREBASE_SERVICE_ACCOUNT/.test(e9.body.reason), "E9: no service account -> 500 naming the env var");
  process.env.FIREBASE_SERVICE_ACCOUNT = sa;

  /* ===================== F. parallel, bounded, many devices on a team ===================== */
  section("F. several devices on the team are all reached, in parallel, once each");
  reset(); seedLeague();
  for (let i = 0; i < 12; i++) addDevice({ token: "TOK_F" + i, team: 2 });
  addDevice({ token: "TOK_F0", team: 2 }); // a second doc sharing a token: one push, not two
  S.fcmDelay = 120;
  const f0 = Date.now();
  const f1 = await tick("2026-10-04T12:00:00Z");
  const fMs = Date.now() - f0;
  ok(f1.body.sent === 12 && S.fcm.length === 12, `F1: 12 distinct tokens -> 12 pushes (the shared token deduped) — got ${f1.body.sent}/${S.fcm.length}`);
  ok(S.maxInflight > 1 && S.maxInflight <= 8, `F1: sends overlapped but never beyond 8 at once (max ${S.maxInflight})`);
  ok(fMs < 1200, `F1: 12 sends x 120 ms took ${fMs} ms, not ~1440 ms serially`);
  ok(plog().length === 12 && plog().every((e) => e.team === 2 && e.kind === "lineup"), "F1: twelve push-log entries, all team 2 / lineup");

  for (const s of srvs) s.close();
  console.log(`\nlineupwarn: ${pass}/${pass + fail} passed`);
  if (fail) { console.log("\nFailures:"); for (const f of failures) console.log("  - " + f); }
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
