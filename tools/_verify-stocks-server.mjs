// stocks.mjs server suite — in-process handler vs a fake Yahoo chart endpoint.
// Nothing here touches the real Yahoo API.
import http from "node:http";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ FAIL " + n); } };

const SECRET = "testsecret";
const seen = [];   // symbols the fake upstream was asked for (action:"quote", range=1d)

/* ============================ series fixtures ==============================
   A fake MUST be as strict as the real service (this repo has been burned by permissive
   mocks before), so these mirror Yahoo's real chart shape exactly: timestamp[] running
   parallel to indicators.quote[0].close[] (which can contain nulls), plus a meta block. */
const seenSeries = [];  // symbols the fake upstream was asked for (action:"series", range=3mo)

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
  if (sym === "NODATA") {
    // Same "meta with no timestamp/quote data" shape the quote suite already uses for this
    // symbol — proves action:"series" treats it as no-data too, not just action:"quote".
    return res.end(JSON.stringify({ chart: { result: [{ meta: { symbol: "NODATA", currency: "USD" } }], error: null } }));
  }
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

// Fake Yahoo chart endpoint: /v8/finance/chart/<SYM> — branches on ?range= to serve either
// the 1-day quote fixtures (byte-for-byte the original ones, untouched) or the 3-month
// series fixtures above.
const upstream = http.createServer((req, res) => {
  const m = req.url.match(/\/v8\/finance\/chart\/([^?]+)/);
  const sym = m ? decodeURIComponent(m[1]) : "";
  const rangeM = req.url.match(/[?&]range=([^&]+)/);
  const range = rangeM ? decodeURIComponent(rangeM[1]) : "";
  res.setHeader("content-type", "application/json");

  if (range === "3mo") {
    seenSeries.push(sym);
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

/* ============================ fake Anthropic ================================
   action:"analyze" only. Same shape as news.mjs's suite: an http server that records every
   request body so the SYSTEM PROMPT itself can be grepped for the safety language — the
   point of this fake isn't just "did it call the model", it's "did it call the model with
   the guardrails actually in the request". */
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

process.env.BUCKY_NOTIFY_SECRET = SECRET;
process.env.STOCKS_BASE_URL = `http://127.0.0.1:${upstream.address().port}`;
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
process.env.STOCKS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${anthropicUpstream.address().port}`;

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

console.log("— analyze —");
let analyzeSys = null;
{
  anthCalls = 0; anthMode = "good";
  const r = await call({
    action: "analyze", symbol: "aapl", name: "Apple Inc.", price: 214.5,
    day: { abs: 4.5, pct: 2.14 }, week: { abs: 10, pct: 4.9 }, month: { abs: -3.2, pct: -1.47 },
  });
  ok(r.status === 200, "analyze always answers 200, even on success");
  ok(r.json.ok === true && r.json.symbol === "AAPL", "analyze reports ok + the cleaned/upper-cased symbol");
  ok(r.json.text === FAKE_ANALYSIS_TEXT, "the model's text comes back verbatim, trimmed of only leading/trailing whitespace");
  ok(anthCalls === 1, "one analyze call costs exactly one model call");
  ok(anthLastBody && anthLastBody.model === "claude-haiku-4-5", "analyze is written by Haiku");
  ok(anthLastBody && anthLastBody.max_tokens === 380, "max_tokens is the small, fixed analyze budget (~380)");
  const prompt = (anthLastBody && anthLastBody.messages && anthLastBody.messages[0] && anthLastBody.messages[0].content) || "";
  ok(/Symbol: AAPL/.test(prompt), "the prompt carries the cleaned symbol");
  ok(/Apple Inc\./.test(prompt), "the prompt carries the name");
  ok(/Current price: 214\.5/.test(prompt), "the prompt carries the current price");
  ok(/Day change: \+4\.50 \(\+2\.14%\)/.test(prompt), "the prompt carries the day figure, correctly signed");
  ok(/Month change: -3\.20 \(-1\.47%\)/.test(prompt), "a negative period is formatted with its own sign, not double-negated");
  analyzeSys = anthLastBody.system;
}
{
  anthCalls = 0; anthMode = "good";
  const r = await call({ action: "analyze", symbol: "PARTX", day: { abs: 1, pct: 1, partial: true } });
  ok(r.json.ok === true, "a partial-flagged period is still accepted");
  const prompt = anthLastBody.messages[0].content;
  ok(/partial data/i.test(prompt), "a partial period is flagged in the prompt so the model doesn't treat it as a full period");
}
{
  // THE SAFETY CHECK: grep the REAL outgoing system prompt for the forbidden-recommendation
  // language, not just trust that it's there. This is the one part of this task that must be
  // real, not cosmetic.
  const sys = analyzeSys || "";
  ok(!!sys && sys.length > 100, "captured a real, substantial system prompt sent to the model");
  ok(/never recommend/i.test(sys), "system prompt: explicitly 'never recommend'");
  ok(/\bbuy\b/i.test(sys) && /\bsell\b/i.test(sys) && /\bhold\b/i.test(sys), "system prompt names buy/sell/hold explicitly as the forbidden actions");
  ok(/price target/i.test(sys), "system prompt forbids price targets");
  ok(/forecast/i.test(sys) && /predict/i.test(sys), "system prompt forbids forecasts and predictions");
  ok(/personalized financial advice/i.test(sys), "system prompt names 'personalized financial advice' as the line not to cross");
  ok(/does not give investment advice/i.test(sys), "system prompt gives the model an explicit fallback line to use under pressure");
  ok(/never invent/i.test(sys) && /news/i.test(sys), "system prompt forbids inventing news/facts/figures not given to it");
  ok(/\bchild/i.test(sys) || /teenager/i.test(sys), "system prompt states plainly that this is read by kids, not just adults");
  ok(/no emoji/i.test(sys) && /no hype/i.test(sys), "system prompt asks for a plain, hype-free, non-dramatic tone");
}
{
  anthCalls = 0; anthMode = "good";
  const body = { action: "analyze", symbol: "CACH", name: "Cache Co", price: 50,
    day: { abs: 1, pct: 2 }, week: { abs: 2, pct: 4 }, month: { abs: 3, pct: 6 } };
  const first = await call(body);
  ok(first.json.ok === true && !first.json.cached, "a fresh request is not marked cached");
  ok(anthCalls === 1, "the fresh request reaches the model");
  const second = await call(body);
  ok(second.json.ok === true && second.json.cached === true, "an identical request within the cache window is served from cache");
  ok(second.json.text === first.json.text, "the cached text matches what the model actually said the first time");
  ok(anthCalls === 1, "the cache hit does NOT reach the model a second time");

  const changed = { action: "analyze", symbol: "CACH", name: "Cache Co", price: 50,
    day: { abs: 9, pct: 18 }, week: { abs: 2, pct: 4 }, month: { abs: 3, pct: 6 } };
  const third = await call(changed);
  ok(third.json.ok === true && !third.json.cached, "different numbers for the SAME symbol are not served from the old cache entry");
  ok(anthCalls === 2, "a genuinely different request reaches the model again");
}
{
  const r = await call({ action: "analyze", symbol: "not a valid ticker!!" });
  ok(r.status === 200 && r.json.ok === false && r.json.reason === "bad-symbol", "an unparseable symbol is rejected before ever touching the model");
}
{
  const r = await call({ action: "analyze" });
  ok(r.json.ok === false && r.json.reason === "bad-symbol", "a missing symbol is rejected the same way as a malformed one");
}
{
  anthMode = "empty"; anthCalls = 0;
  const r = await call({ action: "analyze", symbol: "EMPTYX" });
  ok(r.json.ok === false && r.json.reason === "empty", "a model reply that's only whitespace is treated as no answer, not a blank success");
  anthMode = "good";
}
{
  anthMode = "http500"; anthCalls = 0;
  const r = await call({ action: "analyze", symbol: "FAIL5" });
  ok(r.status === 200, "an upstream 500 still answers 200 from OUR function — never propagated as an HTTP error, never a throw");
  ok(r.json.ok === false && /^http-/.test(r.json.reason), "an upstream failure is reported as ok:false with an http- reason");
  ok(anthCalls === 1, "the call really was attempted (this wasn't skipped for some other reason)");
  anthMode = "good";
}
{
  const savedKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  anthCalls = 0;
  const r = await call({ action: "analyze", symbol: "NOKEY" });
  ok(r.status === 200, "no API key still answers 200, never an error status");
  ok(r.json.ok === false && r.json.reason === "no-key", "no API key -> ok:false reason:no-key");
  ok(anthCalls === 0, "no API key means the model is never called at all");
  process.env.ANTHROPIC_API_KEY = savedKey;
}

console.log(`\n${pass}/${pass + fail} checks passed`);
upstream.close();
anthropicUpstream.close();
process.exit(fail ? 1 : 0);
