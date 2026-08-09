// stocks.mjs server suite — in-process handler vs fake Yahoo / fake xAI / fake Anthropic /
// fake Google-token+Firestore. Nothing here touches any real service.
import http from "node:http";
import crypto from "node:crypto";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ FAIL " + n); } };

const SECRET = "testsecret";
const seen = [];   // symbols the fake upstream was asked for (action:"quote", range=1d&interval=1d)

/* ============================ series fixtures ==============================
   A fake MUST be as strict as the real service (this repo has been burned by permissive
   mocks before), so these mirror Yahoo's real chart shape exactly: timestamp[] running
   parallel to indicators.quote[0].close[] (which can contain nulls), plus a meta block. */
const seenSeries = [];       // symbols the fake upstream was asked for (action:"series", any range)
const seenRangeCalls = [];   // { sym, range, interval } for EVERY /v8/finance/chart request —
                              // this is what proves the D/W/M/Y -> Yahoo range+interval mapping.

// Deterministic, arbitrary anchor — only the RELATIVE order/positions of these timestamps
// matter for the "N trading days back" day/week/month math under test, not real calendar dates.
const DAY_SEC = 86400;
const SERIES_BASE_SEC = 1700000000;
const tsSeq = (n) => Array.from({ length: n }, (_, i) => SERIES_BASE_SEC + i * DAY_SEC);

const SERIES_FIXTURES = {
  // 30 daily closes, c = 100+i — chosen so day/week/month deltas are hand-computable exactly:
  // day (back=1) -> 129 vs 128, week (back=5) -> 129 vs 124, month (back=21) -> 129 vs 108.
  TREND:  { closes: Array.from({ length: 30 }, (_, i) => 100 + i), meta: { symbol: "TREND", currency: "USD", shortName: "Trend Co" } },
  // Only 10 points: shorter than the 21-day month lookback but longer than the 5-day week
  // lookback, so month should come back partial:true while day/week do not.
  SHORTX: { closes: Array.from({ length: 10 }, (_, i) => 200 + i), meta: { symbol: "SHORTX", currency: "USD", shortName: "Short Co" } },
  // Nulls at index 1 and 3 — the alignment-preservation fixture.
  NULLY:  { closes: [10, null, 12, null, 14, 15], meta: { symbol: "NULLY", currency: "USD", shortName: "Nully Co" } },
  // Artificially slow — the parallelism fixture (both delayed the same amount).
  SLOW1:  { closes: [50, 51, 52, 53, 54], meta: { symbol: "SLOW1", currency: "USD", shortName: "Slow One" }, delayMs: 220 },
  SLOW2:  { closes: [60, 61, 62, 63, 64], meta: { symbol: "SLOW2", currency: "USD", shortName: "Slow Two" }, delayMs: 220 },
};

function serveSeriesFixture(sym, res) {
  const fx = SERIES_FIXTURES[sym];
  if (!fx) {
    res.statusCode = 404;
    return res.end(JSON.stringify({ chart: { result: null, error: { code: "Not Found", description: "No data found" } } }));
  }
  const body = JSON.stringify({ chart: { result: [{
    meta: fx.meta, timestamp: tsSeq(fx.closes.length), indicators: { quote: [{ close: fx.closes }] },
  }], error: null } });
  if (fx.delayMs) { setTimeout(() => res.end(body), fx.delayMs); return; }
  res.end(body);
}

// Fake Yahoo chart endpoint: /v8/finance/chart/<SYM>. The ONLY combination fetchQuote ever
// sends is range=1d&interval=1d — every OTHER combination (the original default 3mo/1d, or
// one of the four new D/W/M/Y presets: 1d/5m, 5d/15m, 1mo/1d, 1y/1d) is a "series"-style call.
// That is the real discriminator stocks.mjs's two call sites produce, and this fake routes on
// exactly that rather than hardcoding "range===3mo", so it still tells the two apart correctly
// now that "series" itself can be asked for four more range/interval combinations.
const upstream = http.createServer((req, res) => {
  const m = req.url.match(/\/v8\/finance\/chart\/([^?]+)/);
  const sym = m ? decodeURIComponent(m[1]) : "";
  const rangeM = req.url.match(/[?&]range=([^&]+)/);
  const range = rangeM ? decodeURIComponent(rangeM[1]) : "";
  const intervalM = req.url.match(/[?&]interval=([^&]+)/);
  const interval = intervalM ? decodeURIComponent(intervalM[1]) : "";
  res.setHeader("content-type", "application/json");
  seenRangeCalls.push({ sym, range, interval });

  const isQuoteCall = range === "1d" && interval === "1d";
  if (!isQuoteCall) {
    seenSeries.push(sym);
    if (sym === "NODATA") {
      // Same "meta with no timestamp/quote data" shape the quote suite uses for this symbol —
      // proves EVERY series-style call (default AND every range preset) treats it as no-data.
      return res.end(JSON.stringify({ chart: { result: [{ meta: { symbol: "NODATA", currency: "USD" } }], error: null } }));
    }
    return serveSeriesFixture(sym, res);
  }

  seen.push(sym);
  if (sym === "AAPL") return res.end(JSON.stringify({ chart: { result: [{ meta: {
    symbol: "AAPL", currency: "USD", regularMarketPrice: 214.5, chartPreviousClose: 210.0,
    shortName: "Apple Inc.", marketState: "REGULAR" } }], error: null } }));
  if (sym === "MSFT") return res.end(JSON.stringify({ chart: { result: [{ meta: {
    symbol: "MSFT", currency: "USD", regularMarketPrice: 400.0, chartPreviousClose: 405.0,
    shortName: "Microsoft Corp." } }], error: null } }));
  if (sym === "NODATA") return res.end(JSON.stringify({ chart: { result: [{ meta: { symbol: "NODATA", currency: "USD" } }], error: null } }));
  // unknown ticker
  res.statusCode = 404;
  res.end(JSON.stringify({ chart: { result: null, error: { code: "Not Found", description: "No data found" } } }));
});
await new Promise(r => upstream.listen(0, "127.0.0.1", r));

/* ============================ fake xAI (/v1/responses) =======================
   action:"analyze"'s PRIMARY path. Records every request body so the "instructions" field
   (xAI's equivalent of a system prompt) can be grepped for the safety language for real, not
   just trusted to be there — same discipline as the pre-existing Anthropic safety check below. */
let xaiMode = "good", xaiCalls = 0, xaiLastBody = null, xaiDelayMs = 0;
const XAI_FAKE_TEXT = "Shares moved after the company reported quarterly results that beat expectations, and trading volume was well above average.[[1]](https://example.com/article)";
const XAI_FAKE_TEXT_STRIPPED = "Shares moved after the company reported quarterly results that beat expectations, and trading volume was well above average.";
const xaiUpstream = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    xaiCalls++;
    let body = null; try { body = JSON.parse(raw); } catch {}
    xaiLastBody = body;
    const respond = () => {
      if (xaiMode === "http500") { res.statusCode = 500; return res.end("{}"); }
      res.setHeader("content-type", "application/json");
      if (xaiMode === "empty") {
        return res.end(JSON.stringify({ output: [{ type: "message", role: "assistant", status: "completed",
          content: [{ type: "output_text", text: "   ", annotations: [] }] }], usage: {} }));
      }
      if (xaiMode === "no-message") {
        // e.g. a response that only ever got as far as a tool call — no "message" item at all.
        return res.end(JSON.stringify({ output: [{ type: "web_search_call" }], usage: {} }));
      }
      // Two annotations share ONE url (marketwatch) and a third points elsewhere (reuters) —
      // proves xaiCitations() de-dupes by URL rather than returning one row per annotation.
      res.end(JSON.stringify({
        output: [
          { type: "web_search_call" },
          { type: "message", role: "assistant", status: "completed", content: [{
            type: "output_text", text: XAI_FAKE_TEXT,
            annotations: [
              { type: "url_citation", url: "https://www.marketwatch.com/story/example", start_index: 10, end_index: 40, title: "1" },
              { type: "url_citation", url: "https://www.marketwatch.com/story/example", start_index: 60, end_index: 90, title: "1" },
              { type: "url_citation", url: "https://www.reuters.com/markets/example", start_index: 100, end_index: 120, title: "2" },
            ],
          }] },
        ],
        usage: { input_tokens: 5000, output_tokens: 220, cost_in_usd_ticks: 150000000 },
      }));
    };
    if (xaiDelayMs) setTimeout(respond, xaiDelayMs); else respond();
  });
});
await new Promise((r) => xaiUpstream.listen(0, "127.0.0.1", r));

/* ============================ fake Anthropic (fallback) ================================
   Used when XAI_API_KEY is missing, OR as the outage retry after a FAST (non-timeout) xAI
   failure. Same request-recording discipline as the xAI fake above. */
let anthMode = "good", anthCalls = 0, anthLastBody = null;
const FAKE_ANALYSIS_TEXT = "This is a plain-language explainer about the company and its recent price moves, written for learning only.";
const anthropicUpstream = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    anthCalls++;
    let body = null; try { body = JSON.parse(raw); } catch {}
    anthLastBody = body;
    if (anthMode === "http500") { res.statusCode = 500; return res.end("{}"); }
    res.setHeader("content-type", "application/json");
    if (anthMode === "empty") {
      return res.end(JSON.stringify({ content: [{ type: "text", text: "   " }], usage: {} }));
    }
    // Leading/trailing whitespace on purpose — analyze must trim it and nothing else.
    res.end(JSON.stringify({ content: [{ type: "text", text: "\n  " + FAKE_ANALYSIS_TEXT + "  \n" }], usage: { input_tokens: 120, output_tokens: 90 } }));
  });
});
await new Promise((r) => anthropicUpstream.listen(0, "127.0.0.1", r));

/* ============================ fake Google token + Firestore (daily cache) =================
   getGoogleAccessToken() never has its JWT signature checked by anything real in this test
   (the fake token endpoint just hands back a fixed token) — a genuine RSA key is still needed
   because Node's crypto.sign() requires a real, parseable private key to sign with at all. */
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const saPem = privateKey.export({ type: "pkcs8", format: "pem" });
let googleTokenCalls = 0, googleTokenOk = true;
const googleTokenSrv = http.createServer((req, res) => {
  let raw = ""; req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    googleTokenCalls++;
    res.setHeader("content-type", "application/json");
    if (!googleTokenOk) { res.statusCode = 500; return res.end("{}"); }
    res.end(JSON.stringify({ access_token: "fake-google-token", expires_in: 3600 }));
  });
});
await new Promise((r) => googleTokenSrv.listen(0, "127.0.0.1", r));

const FS_STORE = new Map();   // docId ("<day>__<SYMBOL>") -> { fields }
let fsCommits = 0, fsFail = false;
const firestoreSrv = http.createServer((req, res) => {
  let raw = ""; req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (fsFail) { res.statusCode = 503; return res.end(JSON.stringify({ error: "boom" })); }
    const url = req.url.split("?")[0];
    if (url.endsWith(":commit")) {
      fsCommits++;
      let body = null; try { body = JSON.parse(raw); } catch {}
      for (const w of ((body && body.writes) || [])) {
        if (!w.update) continue;
        const id = String(w.update.name || "").split("/").pop();
        const fields = w.update.fields || {};
        // ENFORCE THE REAL GRAMMAR (activity.mjs's own lesson): a fake that accepts a field
        // name production would reject is worse than no fake at all.
        const bad = Object.keys(fields).find((k) => !/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(k));
        if (bad) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ error: { code: 400, status: "INVALID_ARGUMENT", message: `Invalid property path "${bad}"` } }));
        }
        FS_STORE.set(id, { fields });
      }
      return res.end(JSON.stringify({ writeResults: [] }));
    }
    // GET a single doc: .../stocks_analysis/<day>__<SYMBOL>
    const m = url.match(/\/stocks_analysis\/([^/]+)$/);
    if (m) {
      const doc = FS_STORE.get(decodeURIComponent(m[1]));
      if (!doc) { res.statusCode = 404; return res.end(JSON.stringify({ error: { code: 404, message: "not found" } })); }
      return res.end(JSON.stringify({ fields: doc.fields }));
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: { code: 404 } }));
  });
});
await new Promise((r) => firestoreSrv.listen(0, "127.0.0.1", r));

/* ================================== env + import =========================================
   STOCKS_XAI_TIMEOUT_MS is set LOW (400ms) for the WHOLE suite: every "good"/"empty"/etc fake
   response above answers near-instantly, so a short timeout never trips any of the ordinary
   tests — only the dedicated "timeout path" section below deliberately delays past it. */
process.env.BUCKY_NOTIFY_SECRET = SECRET;
process.env.STOCKS_BASE_URL = `http://127.0.0.1:${upstream.address().port}`;
process.env.XAI_API_KEY = "test-xai-key";
process.env.STOCKS_XAI_BASE_URL = `http://127.0.0.1:${xaiUpstream.address().port}`;
process.env.STOCKS_XAI_TIMEOUT_MS = "400";
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
process.env.STOCKS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${anthropicUpstream.address().port}`;
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ client_email: "t@t", private_key: saPem });
process.env.STOCKS_GOOGLE_TOKEN_URL = `http://127.0.0.1:${googleTokenSrv.address().port}/token`;
process.env.STOCKS_FIRESTORE_BASE = `http://127.0.0.1:${firestoreSrv.address().port}/v1/projects/amen-farms-app/databases/(default)/documents`;
delete process.env.XAI_MODEL;   // make sure the "sane default" is really what gets exercised

const handler = (await import(new URL("../netlify/functions/stocks.mjs", import.meta.url))).default;
async function call(body, opts) {
  const req = new Request("http://localhost/.netlify/functions/stocks", {
    method: (opts && opts.method) || "POST",
    headers: { "content-type": "application/json", origin: "https://amenfarms.netlify.app" },
    body: body === undefined ? undefined : JSON.stringify({ secret: SECRET, ...body }),
  });
  const resp = await handler(req);
  let json = null; try { json = JSON.parse(await resp.text()); } catch {}
  return { status: resp.status, json, headers: resp.headers };
}

console.log("— auth + method —");
ok((await call({}, { method: "OPTIONS" })).status === 204, "OPTIONS preflight → 204");
{
  const r = await call({ action: "quote", symbols: ["AAPL"], secret: "wrong" });
  ok(r.status === 401, "wrong family password → 401");
}
{
  const r = await call({ action: "bogus", symbols: ["AAPL"] });
  ok(r.status === 400 && /action/.test(r.json.error), "unknown action → 400");
}

console.log("— quotes —");
{
  const r = await call({ action: "quote", symbols: ["AAPL", "MSFT"] });
  ok(r.status === 200 && r.json.quotes.length === 2, "two symbols → two quotes");
  const a = r.json.quotes.find(q => q.symbol === "AAPL");
  ok(a.ok && a.price === 214.5 && Math.abs(a.change - 4.5) < 1e-9, "AAPL price + change computed vs prev close");
  ok(Math.abs(a.changePct - (4.5 / 210 * 100)) < 1e-9, "AAPL changePct correct");
  ok(a.name === "Apple Inc." && a.currency === "USD", "name + currency passed through");
  const ms = r.json.quotes.find(q => q.symbol === "MSFT");
  ok(ms.ok && ms.change < 0, "MSFT shows a negative change (down day)");
}
{
  const r = await call({ action: "quote", symbols: ["ZZZZ"] });
  ok(r.json.quotes[0].ok === false && r.json.quotes[0].reason === "not-found", "unknown ticker → ok:false not-found (whole request still 200)");
}
{
  const r = await call({ action: "quote", symbols: ["NODATA"] });
  ok(r.json.quotes[0].ok === false, "meta without a price → ok:false");
}
{
  // one good + one bad → good still returns
  const r = await call({ action: "quote", symbols: ["AAPL", "ZZZZ"] });
  ok(r.json.quotes.find(q => q.symbol === "AAPL").ok === true && r.json.quotes.find(q => q.symbol === "ZZZZ").ok === false, "a bad symbol never sinks a good one");
}

console.log("— validation + hardening —");
{
  seen.length = 0;
  const r = await call({ action: "quote", symbols: ["aapl", "AAPL", "MSFT"] });
  ok(r.json.quotes.length === 2, "case-folded duplicates de-duped (aapl == AAPL)");
  ok(!seen.includes("aapl") && seen.includes("AAPL"), "symbols upper-cased before upstream fetch");
}
{
  seen.length = 0;
  const r = await call({ action: "quote", symbols: ["../etc/passwd", "A B C", "BRK-B", "^GSPC", "TOOOOOOOOOOOOLONG"] });
  ok(seen.every(s => /^[A-Z0-9.\-^=]{1,12}$/.test(s)), "path-injection / spaces / over-long tickers rejected before fetch");
  ok(seen.includes("BRK-B") && seen.includes("^GSPC"), "legit punctuated tickers (BRK-B, ^GSPC) allowed");
}
{
  const r = await call({ action: "quote", symbols: [] });
  ok(r.status === 200 && Array.isArray(r.json.quotes) && r.json.quotes.length === 0, "empty list → empty quotes, no upstream calls");
}
{
  const many = Array.from({ length: 40 }, (_, i) => "SYM" + i);
  seen.length = 0;
  await call({ action: "quote", symbols: many });
  ok(seen.length <= 20, "symbol count capped at 20 (" + seen.length + ")");
}
ok((await call({ action: "quote", symbols: ["AAPL"] })).headers.get("Access-Control-Allow-Origin") === "https://amenfarms.netlify.app", "CORS origin echoed for the allowed origin");

console.log("— series —");
{
  const r = await call({ action: "series", symbols: ["TREND"] });
  ok(r.status === 200 && Array.isArray(r.json.series) && r.json.series.length === 1, "series returns one entry per symbol");
  const s = r.json.series[0];
  ok(s.ok === true && s.symbol === "TREND", "TREND series ok");
  ok(s.name === "Trend Co" && s.currency === "USD", "name + currency pass through");
  ok(s.closes.length === 30, "closes array carries the full fixture length");
  ok(s.closes[0].c === 100 && s.closes[29].c === 129, "closes are oldest-first");
  ok(s.price === 129, "price falls back to the newest close when meta has no regularMarketPrice");
  ok(s.prevClose === 128, "prevClose is exactly the close the day period was computed against");
  // Hand-computed against the fixture (c = 100+i for i=0..29, latest = 129):
  //   day   (back=1):  129 vs closes[28]=128 -> abs 1,  pct 1/128*100  = 0.78125    -> 0.78
  //   week  (back=5):  129 vs closes[24]=124 -> abs 5,  pct 5/124*100  = 4.032258…  -> 4.03
  //   month (back=21): 129 vs closes[8]=108  -> abs 21, pct 21/108*100 = 19.444444… -> 19.44
  ok(s.day.abs === 1 && s.day.pct === 0.78 && !s.day.partial, "day change hand-computed exactly (" + JSON.stringify(s.day) + ")");
  ok(s.week.abs === 5 && s.week.pct === 4.03 && !s.week.partial, "week change hand-computed exactly (" + JSON.stringify(s.week) + ")");
  ok(s.month.abs === 21 && s.month.pct === 19.44 && !s.month.partial, "month change hand-computed exactly (" + JSON.stringify(s.month) + ")");
  ok(typeof s.asOf === "number" && s.asOf === s.closes[29].t, "asOf is the newest close's own timestamp");
}
{
  // Nulls at raw index 1 and 3 (closes = [10, null, 12, null, 14, 15]).
  const r = await call({ action: "series", symbols: ["NULLY"] });
  const s = r.json.series[0];
  ok(s.ok === true, "NULLY series ok");
  ok(s.closes.length === 4, "null closes are dropped (6 raw points -> 4 real ones)");
  ok(s.closes.map(p => p.c).join(",") === "10,12,14,15", "surviving closes keep their original order/values");
  const rawTs = tsSeq(6);
  ok(s.closes[0].t === rawTs[0] * 1000, "the first surviving close keeps ITS OWN timestamp (raw index 0)");
  ok(s.closes[1].t === rawTs[2] * 1000, "a null hole does not shift alignment: the '12' close keeps raw-index-2's timestamp, not index 1's");
  ok(s.closes[2].t === rawTs[4] * 1000, "the '14' close keeps raw-index-4's timestamp, not index 2's");
  ok(s.closes[3].t === rawTs[5] * 1000, "the last close keeps raw-index-5's timestamp");
}
{
  // Only 10 points: longer than the 5-day week lookback but shorter than the 21-day month one.
  const r = await call({ action: "series", symbols: ["SHORTX"] });
  const s = r.json.series[0];
  ok(s.ok === true, "SHORTX series ok");
  ok(s.day.abs === 1 && s.day.pct === 0.48 && !s.day.partial, "day change on a short series is still exact, not partial");
  ok(s.week.abs === 5 && s.week.pct === 2.45 && !s.week.partial, "week change on a 10-point series is still exact, not partial");
  ok(s.month.abs === 9 && s.month.pct === 4.5 && s.month.partial === true,
    "a series shorter than the 21-day lookback marks month partial:true (using the oldest close) instead of lying");
}
{
  const r = await call({ action: "series", symbols: ["TREND", "ZZZZ"] });
  const items = r.json.series;
  ok(items.length === 2, "a batch with an unknown symbol still returns an entry for each");
  const good = items.find(x => x.symbol === "TREND");
  const bad = items.find(x => x.symbol === "ZZZZ");
  ok(good && good.ok === true, "the good symbol in the batch is unaffected");
  ok(bad && bad.ok === false && bad.reason === "not-found", "the unknown symbol reports ok:false not-found, never sinking its batch-mate");
}
{
  const r = await call({ action: "series", symbols: ["NODATA"] });
  ok(r.json.series[0].ok === false && r.json.series[0].reason === "no-data",
    "a meta-only response (no timestamp/close data, same fixture the quote suite uses) -> ok:false no-data for series too");
}
{
  seenSeries.length = 0;
  const r = await call({ action: "series", symbols: [] });
  ok(r.status === 200 && Array.isArray(r.json.series) && r.json.series.length === 0 && seenSeries.length === 0,
    "empty symbol list -> empty series, no upstream calls");
}
{
  const many = Array.from({ length: 40 }, (_, i) => "CAP" + i);
  seenSeries.length = 0;
  await call({ action: "series", symbols: many });
  ok(seenSeries.length <= 24, "series symbol count capped at 24 (" + seenSeries.length + ")");
}
{
  seenSeries.length = 0;
  const r = await call({ action: "series", symbols: ["^DJI", "^GSPC", "CL=F"] });
  ok(seenSeries.includes("^DJI") && seenSeries.includes("^GSPC") && seenSeries.includes("CL=F"),
    "index/commodity tickers with ^ and = pass cleanSymbol for series, same as quote");
  ok(r.json.series.length === 3, "all three come back in the response (as ok:false — none are in the fixture set — but never silently dropped)");
}
{
  const t0 = Date.now();
  const r = await call({ action: "series", symbols: ["SLOW1", "SLOW2"] });
  const elapsed = Date.now() - t0;
  ok(r.json.series.length === 2 && r.json.series.every(x => x.ok), "both artificially-slow symbols still return ok");
  // Each fixture is individually delayed 220ms server-side. Fetched SERIALLY that's >=440ms;
  // this threshold sits comfortably below that (proving parallelism) and above one delay.
  ok(elapsed < 400, `slow symbols are fetched in parallel via Promise.all, not serially (elapsed ${elapsed}ms; serial would be >=440ms)`);
}

console.log("— series: D/W/M/Y range presets (the detail-sheet chart) —");
{
  seenRangeCalls.length = 0;
  await call({ action: "series", symbols: ["TREND"] });
  const last = seenRangeCalls[seenRangeCalls.length - 1];
  ok(last.range === "3mo" && last.interval === "1d", `no "range" in the request body -> the ORIGINAL, unchanged default upstream call (3mo/1d), got ${last.range}/${last.interval}`);
}
const RANGE_UPSTREAM = { day: ["1d", "5m"], week: ["5d", "15m"], month: ["1mo", "1d"], year: ["1y", "1d"] };
for (const [key, [wantRange, wantInterval]] of Object.entries(RANGE_UPSTREAM)) {
  seenRangeCalls.length = 0;
  const r = await call({ action: "series", symbols: ["TREND"], range: key });
  const last = seenRangeCalls[seenRangeCalls.length - 1];
  ok(last.range === wantRange && last.interval === wantInterval,
    `range:"${key}" maps to the whitelisted upstream range=${wantRange}&interval=${wantInterval} (got ${last.range}/${last.interval})`);
  ok(r.json.series[0].ok === true && Array.isArray(r.json.series[0].closes), `range:"${key}" still returns a normal series entry with closes[]`);
}
{
  // Never interpolated into the URL unchecked: an unrecognized/malicious value is silently
  // ignored (falls through to the default), never reaches the upstream request.
  seenRangeCalls.length = 0;
  await call({ action: "series", symbols: ["TREND"], range: "../../etc/passwd" });
  const last = seenRangeCalls[seenRangeCalls.length - 1];
  ok(last.range === "3mo" && last.interval === "1d", "an unrecognized range value falls back to the default (3mo/1d) rather than being passed through");
}
{
  seenRangeCalls.length = 0;
  await call({ action: "series", symbols: ["TREND"], range: { $ne: null } });
  const last = seenRangeCalls[seenRangeCalls.length - 1];
  ok(last.range === "3mo" && last.interval === "1d", "a non-string range value (object) is also rejected, not stringified into the URL");
}
{
  const r = await call({ action: "series", symbols: ["NODATA"], range: "day" });
  ok(r.json.series[0].ok === false && r.json.series[0].reason === "no-data",
    "a range-preset call degrades the same honest way as the default when there's no data (no-data, never a crash)");
}

console.log("— analyze: xAI primary path (both keys configured, xAI succeeding) —");
let xaiInstructions = null;
{
  xaiCalls = 0; anthCalls = 0; xaiMode = "good";
  const r = await call({
    action: "analyze", symbol: "primary", name: "Primary Co.", price: 214.5,
    day: { abs: 4.5, pct: 2.14 }, week: { abs: 10, pct: 4.9 }, month: { abs: -3.2, pct: -1.47 },
  });
  ok(r.status === 200, "analyze always answers 200, even on success");
  ok(r.json.ok === true && r.json.symbol === "PRIMARY", "analyze reports ok + the cleaned/upper-cased symbol");
  ok(xaiCalls === 1 && anthCalls === 0, "the xAI path is PRIMARY: one xAI call, zero Anthropic calls, for a fresh symbol");
  ok(r.json.text === XAI_FAKE_TEXT_STRIPPED, "the model's text comes back citation-marker-stripped (not verbatim — see the marker-stripping check below)");
  ok(!/\[\[/.test(r.json.text) && !/\(https?:\/\//.test(r.json.text), "no raw markdown citation marker ([[N]](url)) leaks into the displayed text");
  ok(xaiLastBody && xaiLastBody.model === "grok-4.20-0309-non-reasoning", "xAI is called on the measured-safe default model (grok-4.5 measured 11.5-16s, over the ~10s Netlify ceiling)");
  ok(xaiLastBody && xaiLastBody.max_output_tokens === 420, "max_output_tokens is the small, fixed xAI analyze budget (420)");
  ok(xaiLastBody && Array.isArray(xaiLastBody.tools) && xaiLastBody.tools.length === 1 && xaiLastBody.tools[0].type === "web_search",
    "the request carries the web_search tool (this is the whole point of the xAI path)");
  const prompt = (xaiLastBody && xaiLastBody.input) || "";
  ok(typeof prompt === "string" && prompt.length > 10, "the xAI 'input' field carries the prompt as a plain string");
  ok(/Symbol: PRIMARY/.test(prompt), "the prompt carries the cleaned symbol");
  ok(/Primary Co\./.test(prompt), "the prompt carries the name");
  ok(/Current price: 214\.5/.test(prompt), "the prompt carries the current price");
  ok(/Day change: \+4\.50 \(\+2\.14%\)/.test(prompt), "the prompt carries the day figure, correctly signed");
  ok(/Month change: -3\.20 \(-1\.47%\)/.test(prompt), "a negative period is formatted with its own sign, not double-negated");
  xaiInstructions = xaiLastBody.instructions;

  // Citations: 3 annotations, 2 sharing one URL -> exactly 2 unique, de-duped, hostname-only.
  ok(Array.isArray(r.json.citations) && r.json.citations.length === 2, `citations are de-duped by URL (got ${r.json.citations && r.json.citations.length})`);
  ok(r.json.citations[0].url === "https://www.marketwatch.com/story/example" && r.json.citations[0].host === "marketwatch.com",
    "the first citation's host is derived from its URL (marketwatch.com), not the API's own 'title' (which was just a footnote index)");
  ok(r.json.citations[1].host === "reuters.com", "the second, distinct citation survives too");
}
{
  xaiCalls = 0; anthCalls = 0; xaiMode = "good";
  const r = await call({ action: "analyze", symbol: "partial1", day: { abs: 1, pct: 1, partial: true } });
  ok(r.json.ok === true, "a partial-flagged period is still accepted");
  const prompt = xaiLastBody.input;
  ok(/partial data/i.test(prompt), "a partial period is flagged in the xAI prompt too, so the model doesn't treat it as a full period");
}
{
  // THE SAFETY CHECK: grep the REAL outgoing xAI "instructions" field for the
  // forbidden-recommendation language, not just trust that it's there.
  const sys = xaiInstructions || "";
  ok(!!sys && sys.length > 100, "captured a real, substantial xAI instructions field");
  ok(/never recommend/i.test(sys), "xAI prompt: explicitly 'never recommend'");
  ok(/\bbuy\b/i.test(sys) && /\bsell\b/i.test(sys) && /\bhold\b/i.test(sys), "xAI prompt names buy/sell/hold explicitly as the forbidden actions");
  ok(/price target/i.test(sys), "xAI prompt forbids price targets");
  ok(/forecast/i.test(sys) && /predict/i.test(sys), "xAI prompt forbids forecasts and predictions");
  ok(/personalized financial advice/i.test(sys), "xAI prompt names 'personalized financial advice' as the line not to cross");
  ok(/does not give investment advice/i.test(sys), "xAI prompt gives the model an explicit fallback line to use under pressure");
  ok(/never invent/i.test(sys) && /news/i.test(sys), "xAI prompt forbids inventing news/facts/figures/sources not actually found by search");
  ok(/\bchild/i.test(sys) || /teenager/i.test(sys), "xAI prompt states plainly that this is read by kids, not just adults");
  ok(/no emoji/i.test(sys) && /no hype/i.test(sys), "xAI prompt asks for a plain, hype-free, non-dramatic tone");
  // The NEW risk that live search introduces, handled explicitly per the task spec:
  ok(/analyst/i.test(sys) && /rating/i.test(sys) && /price target/i.test(sys),
    "xAI prompt explicitly names the NEW risk — search results carrying analyst ratings/price targets — and forbids relaying them as advice");
  ok(!/actually IS and does/i.test(sys), "xAI prompt does NOT carry the fallback prompt's affirmative 'describe what the company IS and does' instruction");
}
{
  // Isolate LAYER 1 (in-memory, exact-input) from LAYER 2 (Firestore, day+symbol only) for
  // this specific test by disabling the service account — layer 2's OWN behavior (a
  // different-numbers-same-symbol-same-day request DOES hit the shared cache, on purpose) is
  // covered by the dedicated "SHARED DAILY CACHE" section below; this one is about layer 1
  // alone, so it must not be muddied by layer 2 also being active.
  const savedSA = process.env.FIREBASE_SERVICE_ACCOUNT;
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  xaiCalls = 0; anthCalls = 0; xaiMode = "good";
  const body = { action: "analyze", symbol: "mcache", name: "Cache Co", price: 50,
    day: { abs: 1, pct: 2 }, week: { abs: 2, pct: 4 }, month: { abs: 3, pct: 6 } };
  const first = await call(body);
  ok(first.json.ok === true && !first.json.cached, "a fresh request is not marked cached");
  ok(xaiCalls === 1, "the fresh request reaches xAI");
  const second = await call(body);
  ok(second.json.ok === true && second.json.cached === true, "an identical request within the in-memory (layer-1) cache window is served from cache");
  ok(second.json.text === first.json.text, "the cached text matches what the model actually said the first time");
  ok(JSON.stringify(second.json.citations) === JSON.stringify(first.json.citations), "citations are cached alongside the text, not lost");
  ok(xaiCalls === 1, "the layer-1 cache hit does NOT reach xAI a second time");

  const changed = { action: "analyze", symbol: "mcache", name: "Cache Co", price: 50,
    day: { abs: 9, pct: 18 }, week: { abs: 2, pct: 4 }, month: { abs: 3, pct: 6 } };
  const third = await call(changed);
  ok(third.json.ok === true && !third.json.cached, "different numbers for the SAME symbol, with layer 2 disabled, are NOT served from the layer-1 cache");
  ok(xaiCalls === 2, "…and a genuinely different request reaches xAI again (layer 1 alone is exact-input scoped)");
  process.env.FIREBASE_SERVICE_ACCOUNT = savedSA;
}
{
  const r = await call({ action: "analyze", symbol: "not a valid ticker!!" });
  ok(r.status === 200 && r.json.ok === false && r.json.reason === "bad-symbol", "an unparseable symbol is rejected before ever touching either model");
}
{
  const r = await call({ action: "analyze" });
  ok(r.json.ok === false && r.json.reason === "bad-symbol", "a missing symbol is rejected the same way as a malformed one");
}

console.log("— analyze: xAI fails FAST (both keys present) -> retried on Anthropic —");
{
  xaiCalls = 0; anthCalls = 0; xaiMode = "empty";
  const r = await call({ action: "analyze", symbol: "emptyfb" });
  ok(r.json.ok === true, "an xAI reply that's only whitespace is treated as no answer, and retried rather than surfaced as a failure");
  ok(xaiCalls === 1 && anthCalls === 1, "exactly one xAI attempt AND one Anthropic retry (fast failure -> clear time budget left)");
  ok(r.json.text === FAKE_ANALYSIS_TEXT, "the retry's Anthropic text comes back verbatim, trimmed");
  ok(!Array.isArray(r.json.citations) || r.json.citations.length === 0, "the Anthropic fallback never fabricates citations (it has no search access)");
  xaiMode = "good";
}
{
  xaiCalls = 0; anthCalls = 0; xaiMode = "http500";
  const r = await call({ action: "analyze", symbol: "fail500fb" });
  ok(r.json.ok === true, "an xAI 500 is retried on Anthropic rather than surfaced as a failure");
  ok(xaiCalls === 1 && anthCalls === 1, "one xAI attempt, one Anthropic retry");
  xaiMode = "good";
}
{
  xaiCalls = 0; anthCalls = 0; xaiMode = "no-message";
  const r = await call({ action: "analyze", symbol: "nomsgfb" });
  ok(r.json.ok === true, "an xAI reply with no message item at all (e.g. tool-call-only) is treated as empty and retried");
  ok(xaiCalls === 1 && anthCalls === 1, "one xAI attempt, one Anthropic retry");
  xaiMode = "good";
}
{
  // both providers down: the retry itself fails too -> a real ok:false, never a throw/hang.
  xaiCalls = 0; anthCalls = 0; xaiMode = "http500"; anthMode = "http500";
  const r = await call({ action: "analyze", symbol: "bothdownfb" });
  ok(r.status === 200, "even when BOTH providers fail, the function still answers 200");
  ok(r.json.ok === false && /^http-/.test(r.json.reason), "…with an honest ok:false + reason, not a throw");
  ok(xaiCalls === 1 && anthCalls === 1, "both were genuinely attempted, not skipped");
  xaiMode = "good"; anthMode = "good";
}

console.log("— analyze: xAI TIMES OUT -> graceful ok:false, NOT retried —");
{
  xaiCalls = 0; anthCalls = 0; xaiMode = "good"; xaiDelayMs = 900;   // > STOCKS_XAI_TIMEOUT_MS (400)
  const t0 = Date.now();
  const r = await call({ action: "analyze", symbol: "timeout1" });
  const elapsed = Date.now() - t0;
  ok(r.status === 200, "a slow xAI upstream still answers 200 from OUR function — never a hung request, never a 502");
  ok(r.json.ok === false && r.json.reason === "timeout", `a slow upstream is aborted and reported as ok:false reason:"timeout" (got ${JSON.stringify(r.json)})`);
  ok(elapsed < 800, `the abort actually fired around the configured timeout (${elapsed}ms), not after waiting out the full 900ms delay`);
  ok(xaiCalls === 1, "xAI really was called (this wasn't skipped for some other reason)");
  ok(anthCalls === 0, "a TIMEOUT is deliberately NOT retried on Anthropic — by the time it fires, ~all the ~10s Netlify budget is already spent, so retrying would risk a hard kill instead of a graceful answer");
  xaiDelayMs = 0;
}

console.log("— analyze: missing XAI_API_KEY -> straight to the Anthropic fallback path —");
{
  const savedXai = process.env.XAI_API_KEY;
  delete process.env.XAI_API_KEY;
  xaiCalls = 0; anthCalls = 0;
  const r = await call({ action: "analyze", symbol: "nokeyfb", name: "No Key Co", price: 10,
    day: { abs: 1, pct: 1 }, week: { abs: 1, pct: 1 }, month: { abs: 1, pct: 1 } });
  ok(r.status === 200 && r.json.ok === true, "no XAI_API_KEY at all -> the request still succeeds");
  ok(xaiCalls === 0, "xAI is never even attempted when its key is missing (not attempted-then-failed)");
  ok(anthCalls === 1, "…and the EXISTING Anthropic path is used instead, exactly once");
  ok(anthLastBody && anthLastBody.model === "claude-haiku-4-5", "the fallback is written by Haiku");
  ok(anthLastBody && anthLastBody.max_tokens === 380, "…at the original, unchanged max_tokens budget (380)");
  const fbSys = anthLastBody.system || "";
  ok(/never recommend/i.test(fbSys) && /price target/i.test(fbSys) && /personalized financial advice/i.test(fbSys),
    "the fallback prompt keeps the full original safety language");
  ok(/what the company.*(is|does)/i.test(fbSys), "…and — UNLIKE the xAI prompt — still asks the model to describe what the company/index/commodity generally IS, since without search access that's the only honest thing left to say");
  process.env.XAI_API_KEY = savedXai;
}
{
  const savedXai = process.env.XAI_API_KEY, savedAnt = process.env.ANTHROPIC_API_KEY;
  delete process.env.XAI_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  xaiCalls = 0; anthCalls = 0;
  const r = await call({ action: "analyze", symbol: "nokeyx" });
  ok(r.status === 200, "no API key at all still answers 200, never an error status");
  ok(r.json.ok === false && r.json.reason === "no-key", "neither key configured -> ok:false reason:no-key");
  ok(xaiCalls === 0 && anthCalls === 0, "neither model is ever called at all");
  process.env.XAI_API_KEY = savedXai; process.env.ANTHROPIC_API_KEY = savedAnt;
}

console.log("— analyze: the SHARED DAILY CACHE (Firestore, one call per symbol per day, family-wide) —");
{
  xaiCalls = 0; anthCalls = 0; xaiMode = "good";
  const first = await call({ action: "analyze", symbol: "daily1", price: 100, day: { abs: 1, pct: 1 } });
  ok(first.json.ok === true && !first.json.cached, "the first request for a fresh (day, symbol) pair is not cached, and reaches the model");
  ok(xaiCalls === 1, "…exactly once");
  ok(fsCommits >= 1, "…and the successful analysis is written to the shared Firestore cache");

  // A DIFFERENT request — different exact numbers, so the layer-1 (exact-input) in-memory
  // cache CANNOT be what serves this — same symbol, same day. Only the layer-2 Firestore
  // cache (keyed on day+symbol alone) can explain a hit here.
  xaiCalls = 0; anthCalls = 0;
  const second = await call({ action: "analyze", symbol: "daily1", price: 137.42, day: { abs: 9.9, pct: 7.7 } });
  ok(second.json.ok === true && second.json.cached === true, "a SECOND, numerically-DIFFERENT request for the same symbol the same day is served from the shared daily cache");
  ok(second.json.text === first.json.text, "…with the exact text the first request actually got");
  ok(xaiCalls === 0 && anthCalls === 0, "…and neither provider is called again — this is the whole cost-control point");
}
{
  // A different symbol, same day: not cached — proves the cache is scoped per symbol.
  xaiCalls = 0; anthCalls = 0; xaiMode = "good";
  const r = await call({ action: "analyze", symbol: "daily2", price: 5 });
  ok(r.json.ok === true && !r.json.cached, "a DIFFERENT symbol on the same day is NOT served from daily1's cache entry");
  ok(xaiCalls === 1, "…and does reach the model, exactly once");
}
{
  // No service account at all -> the daily cache silently no-ops (fails open); the feature
  // keeps working, it just can't share the cost across requests.
  const savedSA = process.env.FIREBASE_SERVICE_ACCOUNT;
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  xaiCalls = 0; anthCalls = 0; xaiMode = "good";
  await call({ action: "analyze", symbol: "nofskey", price: 1, day: { abs: 1, pct: 1 } });
  const r2 = await call({ action: "analyze", symbol: "nofskey", price: 2, day: { abs: 2, pct: 2 } });
  ok(r2.json.ok === true && !r2.json.cached, "with no FIREBASE_SERVICE_ACCOUNT, a second same-day/same-symbol (but different-numbers) request is NOT served from any cache");
  ok(xaiCalls === 2, "…both requests genuinely reached the model — the cache fails OPEN, never breaks the feature");
  process.env.FIREBASE_SERVICE_ACCOUNT = savedSA;
}
{
  // Firestore itself erroring (not just absent) is handled the same way — fails open.
  fsFail = true;
  xaiCalls = 0; anthCalls = 0; xaiMode = "good";
  const r = await call({ action: "analyze", symbol: "fsdown", price: 1, day: { abs: 1, pct: 1 } });
  ok(r.status === 200 && r.json.ok === true, "a Firestore outage never breaks an analysis — still answers 200/ok:true");
  ok(xaiCalls === 1, "…the model is still called normally");
  fsFail = false;
}

console.log(`\n${pass}/${pass + fail} checks passed`);
upstream.close();
xaiUpstream.close();
anthropicUpstream.close();
googleTokenSrv.close();
firestoreSrv.close();
process.exit(fail ? 1 : 0);
