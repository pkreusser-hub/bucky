#!/usr/bin/env node
/**
 * pbpdetail suite — netlify/functions/pbpdetail.mjs (per-play detail for the Scores page's
 * 8-bit replays: nflverse play-by-play + FTN charting, joined to ESPN play ids).
 *
 *   node tools/_verify-pbpdetail.mjs
 *   PBP_FN=/path/to/broken-copy.mjs node tools/_verify-pbpdetail.mjs   (bite-proving runs)
 *
 * Imports the function's default export directly and calls it with real `Request` objects; a
 * local node:http server (started fresh per process, random port) serves fixture files at the
 * same paths the real GitHub release does, and PBP_BASE_URL points the function at it.
 *
 * FIXTURES (tools/fixtures/pbpdetail/) — built by a one-off script in the scratchpad
 * (/tmp/.../scratchpad/nfl/build_fixtures.py, not checked in) from the REAL files downloaded
 * there (pbp26.csv.gz, ftn26.csv, games.csv):
 *   games.csv               — real header + 10 real 2026 rows: the target game (2026_03_ATL_GB,
 *                             event 401872948), its two pbp-file neighbours (2026_03_ARI_SF
 *                             before, 2026_03_BAL_DAL after — both still uncharted by FTN, which
 *                             is what makes BAL_DAL double as the "ftn:false" case), a game
 *                             whose schedule row exists but whose pbp rows are NOT in this
 *                             fixture (2026_01_ARI_LAC, event 401872926 — the not-yet case), and
 *                             six more real rows for bulk.
 *   pbp26.csv.gz             — real header (all 372 columns, untouched) + the FULL real rows of
 *                             those three games (ARI_SF, ATL_GB, BAL_DAL), in the same order the
 *                             real season file has them, so the early-stop logic is exercised
 *                             exactly like production. ONE field is deliberately edited: ATL_GB
 *                             play_id 682's `desc` gained a trailing quoted clause with a real
 *                             comma and an escaped `""` quote (real 2026 data had no
 *                             naturally-occurring escaped quote to borrow) — every other column
 *                             on every row, including play 682's own play_type/shotgun/etc., is
 *                             untouched real data.
 *   ftn_charting_2026.csv   — real header + the real ATL_GB rows (168) + the real rows of one
 *                             other charted game, 2026_01_ARI_LAC (168) — the "one other game"
 *                             the spec asks for, which happens to double as the not-yet game's
 *                             schedule row target (harmless: that request never reaches FTN).
 *
 * Expected values below are hand-computed from those fixture rows, not from the function under
 * test — see the comment next to each one for which row it reads.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXDIR = path.join(__dirname, "fixtures", "pbpdetail");
const FN_PATH = process.env.PBP_FN
  ? path.resolve(process.env.PBP_FN)
  : path.join(__dirname, "..", "netlify", "functions", "pbpdetail.mjs");

let pass = 0, fail = 0;
const failures = [];
const ok = (cond, name) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; failures.push(name); console.log("  ✗ FAIL " + name); }
};
const section = (t) => console.log("\n=== " + t + " ===");

/* ---------------- fixture server ---------------- */
const FLAGS = { games500: false, pbp500: false };
let pbpBytesSent = 0;
let pbpFullLength = 0;
let pbpAborted = false;

function resetPbpTracking() {
  pbpBytesSent = 0;
  pbpAborted = false;
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, "http://x");
      if (u.pathname === "/schedules/games.csv") {
        if (FLAGS.games500) { res.writeHead(500); res.end("boom"); return; }
        const buf = fs.readFileSync(path.join(FIXDIR, "games.csv"));
        res.writeHead(200, { "content-type": "text/csv" });
        res.end(buf);
        return;
      }
      if (u.pathname === "/pbp/play_by_play_2026.csv.gz") {
        if (FLAGS.pbp500) { res.writeHead(500); res.end("boom"); return; }
        const buf = fs.readFileSync(path.join(FIXDIR, "pbp26.csv.gz"));
        pbpFullLength = buf.length;
        res.writeHead(200, { "content-type": "application/gzip" });
        let i = 0;
        const CHUNK = 4096;
        let closed = false;
        req.on("close", () => { closed = true; if (i < buf.length) pbpAborted = true; });
        const pump = () => {
          if (closed || res.destroyed) { if (i < buf.length) pbpAborted = true; return; }
          if (i >= buf.length) { res.end(); return; }
          const chunk = buf.subarray(i, Math.min(i + CHUNK, buf.length));
          i += chunk.length;
          pbpBytesSent += chunk.length;
          res.write(chunk, () => setImmediate(pump));
        };
        pump();
        return;
      }
      if (u.pathname === "/ftn_charting/ftn_charting_2026.csv") {
        const buf = fs.readFileSync(path.join(FIXDIR, "ftn_charting_2026.csv"));
        res.writeHead(200, { "content-type": "text/csv" });
        res.end(buf);
        return;
      }
      // Any other season's file (e.g. a not-yet-released season) 404s, same as a real GitHub
      // release with no matching asset.
      res.writeHead(404);
      res.end("not found");
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function main() {
  const server = await startServer();
  const port = server.address().port;
  process.env.PBP_BASE_URL = `http://127.0.0.1:${port}`;

  const mod = await import(pathToFileURL(FN_PATH).href);
  const handler = mod.default;

  function req(qs) {
    return new Request(`http://x/.netlify/functions/pbpdetail${qs}`);
  }
  async function call(qs) {
    resetPbpTracking();
    const res = await handler(req(qs));
    const headers = res.headers;
    const body = await res.json();
    return { status: res.status, headers, body };
  }

  section("Happy path: event 401872948 (2026_03_ATL_GB)");
  {
    const { status, headers, body } = await call("?event=401872948");
    ok(status === 200, "HTTP 200");
    ok(body.ok === true, "ok: true");
    ok(body.game === "2026_03_ATL_GB", `game (${body.game})`);
    ok(body.season === 2026, `season (${body.season})`);
    ok(body.ftn === true, "ftn: true");
    // Fixture: 173 ATL_GB rows total in pbp26.csv.gz, 168 with a non-empty play_type
    // (hand-counted from the real 2026 file: python3 DictReader count, matches the fixture
    // since it carries every ATL_GB row).
    ok(body.n === 168, `n === 168 (${body.n})`);
    ok(Object.keys(body.plays).length === 168, "plays object has 168 keys");

    const p85 = body.plays["40187294885"];
    // pbp26.csv.gz row play_id=85, game_id=2026_03_ATL_GB: qtr=1 time="14:22"
    // desc="(14:22) (Shotgun) 9-M.Penix pass short left to 7-Bi.Robinson to GB 49 for 17 yards..."
    // play_type=pass shotgun=1 qb_dropback=1 pass_length=short pass_location=left air_yards=-6
    // yards_after_catch=23 qb_hit=0 time_of_day=2026-09-25T00:16:45.267Z
    // end_clock_time=2026-09-25T00:16:52.340Z -> 7.073s -> 7.1
    // ftn_charting_2026.csv nflverse_play_id=85: starting_hash=L qb_location=S
    // n_defense_box=6 is_motion=TRUE is_screen_pass=TRUE is_play_action=FALSE
    // n_pass_rushers=4 n_blitzers=0
    ok(!!p85, "play 40187294885 present");
    if (p85) {
      ok(p85.type === "pass", `type pass (${p85.type})`);
      ok(p85.sg === 1, `sg 1 (${p85.sg})`);
      ok(p85.len === "short", `len short (${p85.len})`);
      ok(p85.loc === "left", `loc left (${p85.loc})`);
      ok(p85.air === -6, `air -6 (${p85.air})`);
      ok(p85.yac === 23, `yac 23 (${p85.yac})`);
      ok(p85.hit === 0, `hit 0 (${p85.hit})`);
      ok(p85.clk === "14:22", `clk 14:22 (${p85.clk})`);
      ok(p85.q === 1, `q 1 (${p85.q})`);
      ok(p85.dur === 7.1, `dur 7.1 (${p85.dur})`);
      ok(p85.hash === "L", `hash L (${p85.hash})`);
      ok(p85.qbl === "S", `qbl S (${p85.qbl})`);
      ok(p85.box === 6, `box 6 (${p85.box})`);
      ok(p85.mot === 1, `mot 1 (${p85.mot})`);
      ok(p85.screen === 1, `screen 1 (${p85.screen})`);
      ok(p85.pa === 0, `pa 0 (${p85.pa})`);
      ok(p85.rush === 4, `rush 4 (${p85.rush})`);
      ok(p85.blitz === 0, `blitz 0 (${p85.blitz})`);
    }

    const p682 = body.plays["401872948682"];
    // row play_id=682: air_yards=4 yards_after_catch=0 (a real 0, must survive) time="05:17"
    // desc has our injected comma+escaped-quote clause -> proves the quote-aware parser didn't
    // shift columns: play_type below still reads "pass", not garbage.
    // ftn play_id=682: starting_hash=M qb_location=U n_defense_box=8 is_motion=TRUE
    // is_play_action=TRUE is_qb_out_of_pocket=TRUE n_pass_rushers=5 n_blitzers=1
    ok(!!p682, "play 401872948682 present");
    if (p682) {
      ok(p682.type === "pass", `desc's embedded comma+escaped-quote didn't shift columns: type still pass (${p682.type})`);
      ok(p682.air === 4, `air 4 (${p682.air})`);
      ok(p682.yac === 0, `yac 0, a real 0 survives (not omitted) (${JSON.stringify(p682.yac)})`);
      ok(p682.pa === 1, `pa 1 (${p682.pa})`);
      ok(p682.oop === 1, `oop 1 (${p682.oop})`);
      ok(p682.hash === "M", `hash M (${p682.hash})`);
      ok(p682.qbl === "U", `qbl U (${p682.qbl})`);
      ok(p682.box === 8, `box 8 (${p682.box})`);
      ok(p682.rush === 5, `rush 5 (${p682.rush})`);
      ok(p682.blitz === 1, `blitz 1 (${p682.blitz})`);
      ok(p682.clk === "5:17", `clk strips leading zero: 05:17 -> 5:17 (${p682.clk})`);
    }

    const pFg = body.plays["4018729481661"];
    // row play_id=1661: play_type=field_goal, no pass_length/pass_location/etc.
    ok(!!pFg, "field goal play 4018729481661 present");
    if (pFg) {
      ok(pFg.type === "field_goal", `type field_goal (${pFg.type})`);
      ok(pFg.len === undefined && pFg.loc === undefined && pFg.air === undefined,
        "no pass fields present on a field-goal row");
    }

    // FTN row play_id=40 (the opening kickoff) charts starting_hash "0" and qb_location "0", its
    // placeholder for a kick. Passed through, the client would read "0" as a shotgun snap on the
    // left of no hash at all; only L/M/R and U/S/P go out.
    const pKick = body.plays["40187294840"];
    ok(!!pKick && pKick.type === "kickoff" && pKick.hash === undefined && pKick.qbl === undefined && pKick.box === 0,
      `the kickoff drops FTN's "0" hash and QB-alignment placeholders, keeps its real counts (${JSON.stringify(pKick && { type: pKick.type, hash: pKick.hash, qbl: pKick.qbl, box: pKick.box })})`);

    const keys = Object.keys(body.plays);
    ok(keys.every((k) => k.startsWith("401872948")), "every key starts with 401872948");
    // The neighbour games' plays would carry keys starting with 401872958 (ARI_SF) or
    // 401872960 (BAL_DAL) if leaked.
    ok(!keys.some((k) => k.startsWith("401872958") || k.startsWith("401872960")),
      "no key from either neighbouring game (401872958/401872960) leaked in");

    ok(headers.get("Netlify-CDN-Cache-Control").includes("s-maxage=2592000"),
      `s-maxage=2592000 when ftn true (${headers.get("Netlify-CDN-Cache-Control")})`);
    ok(headers.get("Netlify-Vary") === "query=event", "Netlify-Vary: query=event");
  }

  section("Early stop (streamed pbp, not buffered whole)");
  {
    await call("?event=401872948");
    // Byte-counting on a loopback server is unreliable — localhost is fast enough that the
    // whole 214KB fixture is often already flushed into the kernel's socket buffer before our
    // parser even reaches the break point, regardless of whether destroy() fired promptly. So,
    // per the spec's own fallback, the real assertion is the module's own parse stats: it saw
    // the target game's rows, then stopped BEFORE the gz fixture's 551 total rows (header +
    // ARI_SF(191) + ATL_GB(173) + BAL_DAL(186)) — proof it never parsed BAL_DAL's rows at all.
    console.log(`  (info) server-observed bytes sent: ${pbpBytesSent} of ${pbpFullLength} — informational only, not asserted (see comment)`);
    ok(mod.__stats.sawTarget === true, "module __stats.sawTarget true");
    ok(mod.__stats.stoppedEarly === true, "module __stats.stoppedEarly true");
    ok(mod.__stats.rowsScanned > 0 && mod.__stats.rowsScanned < 551,
      `rowsScanned stopped short of the fixture's 551 total rows (${mod.__stats.rowsScanned})`);
    // Tighter bound: ARI_SF's 191 rows (before the target) + the header + AT MOST ATL_GB's own
    // 173 rows + one BAL_DAL row (the one that told us the game changed) must cover it.
    ok(mod.__stats.rowsScanned <= 1 + 191 + 173 + 1,
      `rowsScanned <= header + ARI_SF + ATL_GB + 1 lookahead row (${mod.__stats.rowsScanned} <= ${1 + 191 + 173 + 1})`);
  }

  section("ftn:false — event whose game has pbp but no FTN rows (401872960, BAL_DAL)");
  {
    const { body, headers } = await call("?event=401872960");
    ok(body.ok === true, "ok true");
    ok(body.ftn === false, "ftn false");
    const anyFtn = Object.values(body.plays).some((p) =>
      "hash" in p || "qbl" in p || "bf" in p || "box" in p || "mot" in p);
    ok(!anyFtn, "no FTN fields on any play");
    ok(headers.get("Netlify-CDN-Cache-Control").includes("s-maxage=3600"),
      `s-maxage=3600 (${headers.get("Netlify-CDN-Cache-Control")})`);
  }

  section("Failure shapes");
  {
    const { status, body } = await call("?event=abc");
    ok(status === 200 && body.ok === false && body.reason === "bad-event", `bad-event (${JSON.stringify(body)})`);
  }
  {
    // Schedule row exists (event 401872926, 2026_01_ARI_LAC) but its pbp rows are NOT in the
    // fixture file.
    const { status, body } = await call("?event=401872926");
    ok(status === 200 && body.ok === false && body.reason === "not-yet", `not-yet (${JSON.stringify(body)})`);
  }
  {
    const { status, body } = await call("?event=999999999");
    ok(status === 200 && body.ok === false && body.reason === "unknown-game", `unknown-game (${JSON.stringify(body)})`);
  }
  {
    FLAGS.games500 = true;
    const { status, body } = await call("?event=401872948");
    FLAGS.games500 = false;
    ok(status === 200 && body.ok === false && body.reason === "upstream", `upstream on games.csv 500 (${JSON.stringify(body)})`);
  }
  {
    // A different upstream leg failing (the schedule row resolves fine, but the pbp file
    // itself 500s) must ALSO come back as upstream, not a raw crash — proves the pbp fetch
    // path is guarded independently of the games.csv one above.
    FLAGS.pbp500 = true;
    const { status, body } = await call("?event=401872948");
    FLAGS.pbp500 = false;
    ok(status === 200 && body.ok === false && body.reason === "upstream", `upstream on pbp gz 500 (${JSON.stringify(body)})`);
  }

  section("Failure-shape cache headers");
  {
    const { headers } = await call("?event=abc");
    ok(headers.get("Netlify-CDN-Cache-Control").includes("s-maxage=60"), "bad-event s-maxage=60");
  }
  {
    const { headers } = await call("?event=401872926");
    ok(headers.get("Netlify-CDN-Cache-Control").includes("s-maxage=600"), "not-yet s-maxage=600");
  }

  server.close();

  console.log(`\npbpdetail: ${pass}/${pass + fail}`);
  if (fail) { console.log("Failures:\n  " + failures.join("\n  ")); process.exit(1); }
}

main().catch((e) => {
  console.error("Suite crashed:", e);
  process.exit(1);
});
