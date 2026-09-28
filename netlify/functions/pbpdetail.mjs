// BUCKY — per-play detail for one finished NFL game, for the Scores page's 8-bit replays.
//
// Netlify Function (ESM). GET /.netlify/functions/pbpdetail?event=<ESPN event id>
//   -> { ok:true, event, game, season, ftn, n, plays:{ "<espnPlayId>": {...} } }
//   -> { ok:false, reason, detail? }  (HTTP 200 always — see "Failure shapes" below)
//
// SOURCE: nflverse (https://github.com/nflverse/nflverse-data), a free public mirror of NFL
// play-by-play (itself sourced from the NFL's own data feed via the nflfastR project) plus FTN
// Data's charting layer. Three release assets, all public, no auth:
//   schedules/games.csv                          — one row per game; has both the nflverse
//                                                   game_id AND the ESPN event id, so it's the
//                                                   join table.
//   pbp/play_by_play_<season>.csv.gz              — full play-by-play, ALL games in a season,
//                                                   372 columns, gzipped, rows grouped by
//                                                   game_id in game order. Runs ~19MB gz by
//                                                   season end.
//   ftn_charting/ftn_charting_<season>.csv         — FTN's hand-charted columns (shotgun
//                                                   context, hash, pass-rush counts, motion,
//                                                   play-action, screens, RPOs…) keyed by
//                                                   nflverse_game_id + nflverse_play_id. FTN
//                                                   charts games 1-2 days late, so a
//                                                   just-finished game's rows may not exist yet
//                                                   — that's normal, not a failure (see `ftn`
//                                                   below).
//
// WHY A PROXY: these are GitHub release assets — they send no CORS headers, so the browser
// can't fetch them directly. This function is the only way the client reaches them.
//
// THE JOIN: games.csv's `espn` column is the ESPN event id; its `game_id` column ("2026_03_
// ATL_GB") is the nflverse key used by both the pbp and FTN files. Within a game, the ESPN
// play id is `<espn event id><nflverse play_id>` as a plain string concatenation (verified live
// 2026-09-28: event 401872948 + pbp play_id 85 -> ESPN play 40187294885). `q`/`clk` (quarter +
// clock, clock's leading minute zero stripped) ride along on every play so the client can match
// by quarter+clock as a fallback when an id doesn't line up.
//
// STREAMING: the pbp file must NOT be buffered whole — fetch -> Readable.fromWeb -> gunzip -> a
// quote-aware CSV parser that yields whole records as they complete, so multi-MB-by-season-end
// download never sits in memory at once. Rows are grouped by game_id in file order, so once
// we've seen the target game's rows and then hit a DIFFERENT game_id, we stop reading (destroy
// the stream) rather than parse the rest of the season. games.csv (2MB, one row per game) and
// the FTN file (~1MB) are small enough to buffer whole.
//
// CACHING: the pbp file is season-long and doesn't change once a game is final, so a successful
// response is cacheable a long time at Netlify's CDN edge — but FTN often hasn't charted the
// game yet, so an `ftn:false` response is cached only briefly (an hour) so a family member
// checking back later picks up the charting once it lands. Every response also sets a short
// browser-side max-age so a phone re-opening the page doesn't immediately re-hit the edge.
// `Netlify-Vary: query=event` keeps the CDN cache keyed per game (Netlify's edge cache ignores
// query strings by default).
//
// FTN LICENCE: FTN Data is CC-BY-SA 4.0 — the page must show "FTN Data via nflverse" wherever
// any FTN-sourced field (hash/qbl/bf/box/mot/pa/screen/rpo/trick/oop/ta/drop/rush/blitz) is
// used on screen.
//
// ENV OVERRIDE (tools/_verify-pbpdetail.mjs, sports.mjs's SPORTS_NFL_BASE_URL precedent):
// PBP_BASE_URL replaces "https://github.com/nflverse/nflverse-data/releases/download" for all
// three upstream URLs, pointed at a local fixture server in tests.
//
// Failure shapes (HTTP 200, { ok:false, reason, detail? }):
//   bad-event      event isn't /^\d{6,12}$/
//   unknown-game   games.csv has no row with that espn id
//   not-yet        schedule row found, but the pbp file has no rows for that game_id yet
//   upstream       a fetch failed or came back non-200 (detail: short reason)

import { Readable } from "node:stream";
import zlib from "node:zlib";
import { StringDecoder } from "node:string_decoder";

const BASE = process.env.PBP_BASE_URL || "https://github.com/nflverse/nflverse-data/releases/download";
const FETCH_TIMEOUT_MS = Number(process.env.PBP_FETCH_TIMEOUT_MS) || 9000;

// Small mutable module-level stats bag, exported ONLY so the test suite can assert the
// streaming parser actually stopped early (rows scanned, whether it stopped before the file
// ended) without needing to instrument the real network stack. Never read by the handler
// itself.
export const __stats = { rowsScanned: 0, stoppedEarly: false, sawTarget: false };

// ---------------- quote-aware, streaming-friendly CSV parser ----------------
// Feed it string chunks (from a stream, or the whole text at once) and it yields complete
// records as arrays of fields as soon as each one closes — a comma or newline INSIDE a quoted
// field never splits early, "" inside a quoted field is an escaped literal quote, and state
// carries correctly across chunk boundaries (a field, or an open quote, can span two feed()
// calls). This is the one parser both the streamed pbp file and the buffered games.csv/FTN
// files go through — one implementation, no second copy to drift out of sync.
// Speed matters: by the end of a season the file is ~200 MB of text and the last game sits at the
// bottom of it, all inside a 10 s function. So the parser jumps from one delimiter to the next
// (a sticky regex over , " \n \r outside quotes, indexOf('"') inside them) and copies runs with
// slice(), rather than walking character by character: 2025's Super Bowl, the worst case, went
// from 3.5 s to ~1 s locally. A quote that ends one chunk is held until the next chunk says whether
// it was an escaped "" or the closing quote.
const CSV_DELIM = /[",\n\r]/g;
class CsvParser {
  constructor() {
    this.field = "";
    this.record = [];
    this.inQuotes = false;
    this.quoteAtEnd = false;
  }
  // Returns an array of any records completed by this chunk (usually 0 or many).
  feed(str) {
    const out = [];
    const n = str.length;
    let i = 0;
    if (this.quoteAtEnd) {
      this.quoteAtEnd = false;
      if (str[0] === '"') { this.field += '"'; i = 1; } else this.inQuotes = false;
    }
    while (i < n) {
      if (this.inQuotes) {
        const j = str.indexOf('"', i);
        if (j < 0) { this.field += str.slice(i); break; }
        this.field += str.slice(i, j);
        if (j + 1 >= n) { this.quoteAtEnd = true; break; }
        if (str[j + 1] === '"') { this.field += '"'; i = j + 2; }
        else { this.inQuotes = false; i = j + 1; }
        continue;
      }
      CSV_DELIM.lastIndex = i;
      const m = CSV_DELIM.exec(str);
      if (!m) { this.field += str.slice(i); break; }
      const j = m.index;
      if (j > i) this.field += str.slice(i, j);
      const c = str[j];
      if (c === '"') this.inQuotes = true;
      else if (c === ",") { this.record.push(this.field); this.field = ""; }
      else if (c === "\n") { this.record.push(this.field); this.field = ""; out.push(this.record); this.record = []; }
      // "\r": ignored — the paired "\n" ends the record
      i = j + 1;
    }
    return out;
  }
  // Call once after the last feed(): returns the trailing record if the input didn't end
  // with a newline, or null if there was nothing pending.
  end() {
    this.quoteAtEnd = false;
    if (this.field.length === 0 && this.record.length === 0) return null;
    this.record.push(this.field);
    const r = this.record;
    this.record = [];
    this.field = "";
    return r;
  }
}

function indexMap(header) {
  const m = {};
  for (let i = 0; i < header.length; i++) m[header[i]] = i;
  return m;
}
function col(row, idx, name) {
  const i = idx[name];
  if (i == null) return "";
  const v = row[i];
  return v == null || v === "NA" ? "" : v;                  // nflverse writes some missing values as NA
}
// A missing/empty numeric column stays ABSENT (undefined), never coerced to 0 — CLAUDE.md's
// `x || 0` / `x ?? 0` trap: a real 0 (e.g. yards_after_catch on a play with none) must survive.
function numOrUndef(v) {
  if (v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function strOrUndef(v) {
  return v ? v : undefined;
}
function boolFlag(v) {
  if (v === "TRUE") return 1;
  if (v === "FALSE") return 0;
  return undefined;
}

async function timedFetch(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------- schedule (games.csv) ----------------

async function findScheduleRow(event) {
  let r, text;
  try {
    r = await timedFetch(`${BASE}/schedules/games.csv`);
    if (!r.ok) return { err: "http-" + r.status };
    text = await r.text();
  } catch (e) {
    return { err: e && e.name === "AbortError" ? "timeout" : "unreachable" };
  }
  const p = new CsvParser();
  const rows = p.feed(text);
  const last = p.end();
  if (last) rows.push(last);
  if (!rows.length) return { err: "empty" };
  const idx = indexMap(rows[0]);
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (col(row, idx, "espn") === event) {
      return { row: { gameId: col(row, idx, "game_id"), season: Number(col(row, idx, "season")) } };
    }
  }
  return { row: null };
}

// ---------------- play fields from one pbp row ----------------

function buildPlayFromPbp(row, idx) {
  const play = {};
  const qtr = numOrUndef(col(row, idx, "qtr"));
  if (qtr !== undefined) play.q = qtr;
  const time = col(row, idx, "time");
  if (time) play.clk = time.replace(/^0(\d:)/, "$1");
  play.type = col(row, idx, "play_type");

  const sg = numOrUndef(col(row, idx, "shotgun")); if (sg !== undefined) play.sg = sg;
  const nh = numOrUndef(col(row, idx, "no_huddle")); if (nh !== undefined) play.nh = nh;
  const db = numOrUndef(col(row, idx, "qb_dropback")); if (db !== undefined) play.db = db;
  const scr = numOrUndef(col(row, idx, "qb_scramble")); if (scr !== undefined) play.scr = scr;

  const len = strOrUndef(col(row, idx, "pass_length")); if (len) play.len = len;
  const loc = strOrUndef(col(row, idx, "pass_location")); if (loc) play.loc = loc;
  const air = numOrUndef(col(row, idx, "air_yards")); if (air !== undefined) play.air = air;
  const yac = numOrUndef(col(row, idx, "yards_after_catch")); if (yac !== undefined) play.yac = yac;

  const rloc = strOrUndef(col(row, idx, "run_location")); if (rloc) play.rloc = rloc;
  const gap = strOrUndef(col(row, idx, "run_gap")); if (gap) play.gap = gap;

  const hit = numOrUndef(col(row, idx, "qb_hit")); if (hit !== undefined) play.hit = hit;
  const hitBy = strOrUndef(col(row, idx, "qb_hit_1_player_name")); if (hitBy) play.hitBy = hitBy;
  const pd = strOrUndef(col(row, idx, "pass_defense_1_player_name")); if (pd) play.pd = pd;

  const tod = col(row, idx, "time_of_day");
  const ect = col(row, idx, "end_clock_time");
  if (tod && ect) {
    const t0 = Date.parse(tod), t1 = Date.parse(ect);
    if (Number.isFinite(t0) && Number.isFinite(t1)) {
      const dur = Math.round(((t1 - t0) / 1000) * 10) / 10;
      if (dur > 0 && dur < 30) play.dur = dur;
    }
  }
  return play;
}

function ftnAugment(play, row, idx) {
  // FTN writes "0" for the hash and QB alignment of a kick; only real values go out.
  const hash = col(row, idx, "starting_hash"); if (/^[LMR]$/.test(hash)) play.hash = hash;
  const qbl = col(row, idx, "qb_location"); if (/^[USP]$/.test(qbl)) play.qbl = qbl;
  const bf = numOrUndef(col(row, idx, "n_offense_backfield")); if (bf !== undefined) play.bf = bf;
  const box = numOrUndef(col(row, idx, "n_defense_box")); if (box !== undefined) play.box = box;
  const mot = boolFlag(col(row, idx, "is_motion")); if (mot !== undefined) play.mot = mot;
  const pa = boolFlag(col(row, idx, "is_play_action")); if (pa !== undefined) play.pa = pa;
  const screen = boolFlag(col(row, idx, "is_screen_pass")); if (screen !== undefined) play.screen = screen;
  const rpo = boolFlag(col(row, idx, "is_rpo")); if (rpo !== undefined) play.rpo = rpo;
  const trick = boolFlag(col(row, idx, "is_trick_play")); if (trick !== undefined) play.trick = trick;
  const oop = boolFlag(col(row, idx, "is_qb_out_of_pocket")); if (oop !== undefined) play.oop = oop;
  const ta = boolFlag(col(row, idx, "is_throw_away")); if (ta !== undefined) play.ta = ta;
  const drop = boolFlag(col(row, idx, "is_drop")); if (drop !== undefined) play.drop = drop;
  const rush = numOrUndef(col(row, idx, "n_pass_rushers")); if (rush !== undefined) play.rush = rush;
  const blitz = numOrUndef(col(row, idx, "n_blitzers")); if (blitz !== undefined) play.blitz = blitz;
}

// ---------------- streamed pbp read ----------------

async function streamPbp(season, gameId) {
  const url = `${BASE}/pbp/play_by_play_${season}.csv.gz`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let r;
  try {
    r = await fetch(url, { signal: ctrl.signal });
  } catch (e) {
    clearTimeout(timer);
    return { err: e && e.name === "AbortError" ? "timeout" : "unreachable" };
  }
  if (!r.ok) { clearTimeout(timer); return { err: "http-" + r.status }; }
  if (!r.body) { clearTimeout(timer); return { err: "no-body" }; }

  const nodeReadable = Readable.fromWeb(r.body);
  const gunzip = zlib.createGunzip();
  nodeReadable.pipe(gunzip);
  // If the source errors after we've already stopped reading, don't let it crash the process.
  nodeReadable.on("error", () => {});
  gunzip.on("error", () => {});

  const decoder = new StringDecoder("utf8");
  const parser = new CsvParser();
  let header = null, idx = null;
  let sawTarget = false, stoppedEarly = false, rowsScanned = 0;
  const playsByNflId = new Map();

  function handleRecord(row) {
    rowsScanned++;
    if (!header) { header = row; idx = indexMap(header); return true; }
    const gid = col(row, idx, "game_id");
    if (gid !== gameId) {
      if (sawTarget) { stoppedEarly = true; return false; } // stop: past the game's block
      return true; // haven't reached the game's block yet
    }
    sawTarget = true;
    const playType = col(row, idx, "play_type");
    if (playType) {
      const playId = col(row, idx, "play_id");
      playsByNflId.set(playId, buildPlayFromPbp(row, idx));
    }
    return true;
  }

  // Other games' rows are skipped without being split into fields: the text is cut into whole
  // records (a newline outside quotes ends one; the quote count says whether we're inside), and only
  // a record whose game_id column reads the target game — or the header — goes through the parser.
  // Splitting all ~49,000 rows of a season into 372 fields each was most of the run time (2025's
  // Super Bowl, last in its file: 2.7 s → under a second locally).
  let carry = "", quotes = 0, scanFrom = 0;
  const gidAt = (rec) => {                                   // the game_id field, if it's unquoted
    let from = 0;
    for (let k = 0; k < idx.game_id; k++) { from = rec.indexOf(",", from) + 1; if (!from) return null; }
    const to = rec.indexOf(",", from);
    const v = rec.slice(from, to < 0 ? rec.length : to);
    return v.includes('"') ? null : v;
  };
  const takeRecord = (rec) => {
    if (header) {
      const gid = gidAt(rec);
      if (gid != null && gid !== gameId) { rowsScanned++; if (sawTarget) { stoppedEarly = true; return false; } return true; }
    }
    for (const r of parser.feed(rec + "\n")) if (!handleRecord(r)) return false;
    return true;
  };
  const pump = (text, final) => {
    carry += text;
    let start = 0;
    for (;;) {
      const nl = carry.indexOf("\n", scanFrom);
      const q = carry.indexOf('"', scanFrom);
      if (q >= 0 && (nl < 0 || q < nl)) { quotes++; scanFrom = q + 1; continue; }
      if (nl < 0) break;
      scanFrom = nl + 1;
      if (quotes % 2) continue;                              // a newline inside quotes
      const rec = carry.slice(start, nl).replace(/\r$/, "");
      start = nl + 1; quotes = 0;
      if (!takeRecord(rec)) return false;
    }
    carry = carry.slice(start); scanFrom -= start;
    if (final && carry.length) { const rec = carry; carry = ""; return takeRecord(rec); }
    return true;
  };
  try {
    for await (const chunk of gunzip) {
      if (!pump(decoder.write(chunk), false)) break;
    }
    if (!stoppedEarly) pump(decoder.end(), true);
    if (!stoppedEarly) { const last = parser.end(); if (last) handleRecord(last); }
  } catch (e) {
    clearTimeout(timer);
    gunzip.destroy(); nodeReadable.destroy();
    return { err: "stream-error" };
  }
  clearTimeout(timer);
  // Stop pulling more bytes off the wire — this is what makes "stop reading" real rather than
  // just "stop parsing"; without it we'd have already downloaded the whole season file by the
  // time a `break` above fires on a game near the file's start.
  gunzip.destroy();
  nodeReadable.destroy();
  ctrl.abort();

  __stats.rowsScanned = rowsScanned;
  __stats.stoppedEarly = stoppedEarly;
  __stats.sawTarget = sawTarget;

  return { found: sawTarget, playsByNflId };
}

// ---------------- FTN charting ----------------

async function fetchFtn(season, gameId) {
  let r;
  try {
    r = await timedFetch(`${BASE}/ftn_charting/ftn_charting_${season}.csv`);
  } catch {
    return null;
  }
  if (!r.ok) return null; // FTN not out yet for this season/game — normal, not a failure
  let text;
  try { text = await r.text(); } catch { return null; }
  const p = new CsvParser();
  const rows = p.feed(text);
  const last = p.end();
  if (last) rows.push(last);
  if (!rows.length) return null;
  const idx = indexMap(rows[0]);
  const map = new Map();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (col(row, idx, "nflverse_game_id") === gameId) {
      map.set(col(row, idx, "nflverse_play_id"), row);
    }
  }
  return { map, idx };
}

// ---------------- response ----------------

function respond(obj, ttl) {
  const headers = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "Cache-Control": "public, max-age=300",
    "Netlify-CDN-Cache-Control": `public, durable, s-maxage=${ttl}, stale-while-revalidate=${ttl}`,
    "Netlify-Vary": "query=event",
  };
  return new Response(JSON.stringify(obj), { status: 200, headers });
}

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS" },
    });
  }

  let event;
  try {
    event = (new URL(req.url).searchParams.get("event") || "").trim();
  } catch {
    event = "";
  }
  if (!/^\d{6,12}$/.test(event)) return respond({ ok: false, reason: "bad-event" }, 60);

  const sched = await findScheduleRow(event);
  if (sched.err) return respond({ ok: false, reason: "upstream", detail: sched.err }, 60);
  if (!sched.row) return respond({ ok: false, reason: "unknown-game" }, 60);
  const { gameId, season } = sched.row;

  const pbp = await streamPbp(season, gameId);
  if (pbp.err) return respond({ ok: false, reason: "upstream", detail: pbp.err }, 60);
  if (!pbp.found) return respond({ ok: false, reason: "not-yet" }, 600);

  const ftn = await fetchFtn(season, gameId);
  let ftnCount = 0;
  if (ftn) {
    for (const [nflId, play] of pbp.playsByNflId) {
      const row = ftn.map.get(nflId);
      if (row) { ftnAugment(play, row, ftn.idx); ftnCount++; }
    }
  }
  const hasFtn = ftnCount > 0;

  const plays = {};
  for (const [nflId, play] of pbp.playsByNflId) plays[event + nflId] = play;

  return respond(
    { ok: true, event, game: gameId, season, ftn: hasFtn, n: Object.keys(plays).length, plays },
    hasFtn ? 2592000 : 3600
  );
};
