// BUCKY — stock data for the Finance tab: quotes, sparkline series, and a plain-language AI
// explainer. Netlify Function (ESM). POST JSON, secret-gated like every other function here.
//
//   { secret, action:"quote", symbols:[...] }
//     -> { quotes: [{ symbol, ok, price, prevClose, change, changePct, currency,
//                      marketState, name }] }  (ok:false + reason on a per-symbol miss)
//     Feeds the Home dashboard's watchlist card. UNCHANGED by the 2026-08 Finance-tab work
//     below — its request/response shape must stay exactly as it is.
//
//   { secret, action:"series", symbols:[...] }
//     -> { series: [{ symbol, ok, name, currency, price, prevClose,
//                      day:{abs,pct,partial?}, week:{abs,pct,partial?}, month:{abs,pct,partial?},
//                      closes:[{t,c}],   // ~3 months of daily closes, oldest first, for sparklines
//                      asOf }] }          // ok:false + reason per symbol on a miss, never sinks the batch
//     day/week/month are DERIVED FROM THE CLOSES SERIES ITSELF (latest vs ~1/~5/~21 trading
//     days back), not from Yahoo's own meta fields — that keeps price/prevClose/day/week/month
//     mutually consistent even on a day Yahoo's chart and quote endpoints disagree by a cent.
//     When the series is shorter than the lookback, the OLDEST available close stands in for
//     the missing one rather than inventing a number, flagged `partial:true` on that period.
//     abs/pct are rounded to 2dp. `prevClose` is exactly the close the "day" period was
//     computed against.
//
//   { secret, action:"analyze", symbol, name?, day?, week?, month?, price? }
//     -> { ok, symbol, text, cached?, reason? }
//     ONE small Anthropic (Haiku) call that writes a short, plain-language, EDUCATIONAL-ONLY
//     explainer for the symbol: what the company/index/commodity is, what the given numbers
//     show, and general factual context for why things like it move. THE SYSTEM PROMPT IS A
//     SAFETY SURFACE, NOT A STYLE CHOICE — this app is used by children, and the model is
//     explicitly and repeatedly forbidden from recommending a trade, giving a price target,
//     forecasting, or writing anything a reader could act on as personalized financial
//     advice. See ANALYSIS_SYSTEM below before touching any of that wording. No key ->
//     { ok:false, reason:"no-key" }; any upstream problem -> { ok:false, reason } — this
//     action NEVER returns an HTTP error status and NEVER throws. Identical requests within
//     ~15 minutes share one model call from an in-memory cache (module scope survives warm
//     Netlify invocations — the same trick as cachedGoogleToken in farmgpt.mjs/news.mjs);
//     `cached:true` marks a cache hit.
//
// Why a server proxy (not a direct client fetch like the weather widget): the free,
// keyless quote source (Yahoo Finance's chart endpoint) does NOT send CORS headers, so a
// browser fetch fails. Fetching server-side sidesteps CORS entirely and lets us set a
// browser-like User-Agent (Yahoo rate-limits the default). Zero dependencies + hand-rolled
// fetch, same house convention as calendar.mjs / farmgpt.mjs / notify.mjs / news.mjs.
//
// Required env: BUCKY_NOTIFY_SECRET (the shared family passphrase — same one the other
// functions use). ANTHROPIC_API_KEY is required only for action:"analyze" (already set in
// production for FarmGPT/News; without it analyze degrades to {ok:false,reason:"no-key"} and
// quote/series are unaffected). Optional: STOCKS_BASE_URL to point Yahoo at a fake server in
// tests; STOCKS_ANTHROPIC_BASE_URL (falls back to ANTHROPIC_BASE_URL) to point analyze at a
// fake server in tests.

const ALLOWED_ORIGINS = new Set([
  "https://amenfarms.netlify.app",
  "http://localhost:8080",
  "http://localhost:3000",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:3000",
]);

// Yahoo's public chart endpoint returns current price + previous close with no auth. The
// batch /v7/finance/quote endpoint now requires a crumb+cookie, so we fetch per symbol.
const STOCKS_BASE_URL = process.env.STOCKS_BASE_URL || "https://query1.finance.yahoo.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const MAX_SYMBOLS = 20;
const MAX_SERIES_SYMBOLS = 24;  // action:"series" — sparkline batches may run a little larger than quote batches

function corsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://amenfarms.netlify.app";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
}
function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers });
}

// Tickers only: letters, digits, and the few punctuation marks Yahoo uses (BRK-B, ^GSPC,
// BZ=F, RDS.A). Anything else is rejected before it can be interpolated into the URL path.
function cleanSymbol(s) {
  const up = String(s == null ? "" : s).trim().toUpperCase();
  return /^[A-Z0-9.\-^=]{1,12}$/.test(up) ? up : null;
}

async function fetchQuote(symbol) {
  const url = `${STOCKS_BASE_URL}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
  let r;
  try {
    r = await fetch(url, { headers: { "User-Agent": UA, accept: "application/json" } });
  } catch (e) {
    return { symbol, ok: false, reason: "unreachable" };
  }
  if (!r.ok) return { symbol, ok: false, reason: r.status === 404 ? "not-found" : "http-" + r.status };
  let j;
  try { j = await r.json(); } catch { return { symbol, ok: false, reason: "bad-json" }; }
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  const meta = res && res.meta;
  if (!meta || typeof meta.regularMarketPrice !== "number") {
    // Yahoo reports unknown tickers as chart.error
    return { symbol, ok: false, reason: (j && j.chart && j.chart.error && j.chart.error.code) ? "not-found" : "no-data" };
  }
  const price = meta.regularMarketPrice;
  // Prefer the true prior-session close; fall back through the fields Yahoo may send.
  const prevClose = typeof meta.chartPreviousClose === "number" ? meta.chartPreviousClose
    : typeof meta.previousClose === "number" ? meta.previousClose : price;
  const change = price - prevClose;
  const changePct = prevClose ? (change / prevClose) * 100 : 0;
  return {
    symbol: meta.symbol || symbol,
    ok: true,
    price,
    prevClose,
    change,
    changePct,
    currency: meta.currency || "USD",
    marketState: meta.marketState || "",
    name: meta.shortName || meta.longName || "",
  };
}

/* ---------------------------------------------------------------------------
   action:"series" — sparkline data, and the day/week/month deltas that go with it.
   --------------------------------------------------------------------------- */
function round2(n) { return Math.round(n * 100) / 100; }

/* The change between the newest close and the close `back` trading days earlier. When the
   series is shorter than that, the OLDEST available close stands in rather than inventing a
   number, flagged partial:true. `base` (the close value actually used) rides along on the
   raw result so the caller can reuse the SAME number as `prevClose` for the day period —
   see the "Deliberately NOT meta.chartPreviousClose" comment in fetchSeries below. */
function periodChangeRaw(closes, back) {
  const latest = closes[closes.length - 1].c;
  let idx = closes.length - 1 - back;
  let partial = false;
  if (idx < 0) { idx = 0; partial = true; }
  const base = closes[idx].c;
  if (typeof base !== "number" || base === 0) return { abs: 0, pct: 0, base, partial: true };
  const out = { abs: round2(latest - base), pct: round2((latest - base) / base * 100), base };
  if (partial) out.partial = true;
  return out;
}
function periodOut(raw) {
  const out = { abs: raw.abs, pct: raw.pct };
  if (raw.partial) out.partial = true;
  return out;
}

async function fetchSeries(symbol) {
  const url = `${STOCKS_BASE_URL}/v8/finance/chart/${encodeURIComponent(symbol)}?range=3mo&interval=1d`;
  let r;
  try {
    r = await fetch(url, { headers: { "User-Agent": UA, accept: "application/json" } });
  } catch (e) {
    return { symbol, ok: false, reason: "unreachable" };
  }
  if (!r.ok) return { symbol, ok: false, reason: r.status === 404 ? "not-found" : "http-" + r.status };
  let j;
  try { j = await r.json(); } catch { return { symbol, ok: false, reason: "bad-json" }; }
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  const meta = res && res.meta;
  if (!res || !meta) {
    // Yahoo reports unknown tickers as chart.error
    return { symbol, ok: false, reason: (j && j.chart && j.chart.error && j.chart.error.code) ? "not-found" : "no-data" };
  }

  const timestamps = Array.isArray(res.timestamp) ? res.timestamp : [];
  const quoteArr = res.indicators && Array.isArray(res.indicators.quote) ? res.indicators.quote[0] : null;
  const rawCloses = quoteArr && Array.isArray(quoteArr.close) ? quoteArr.close : [];

  // Pair each timestamp with its OWN close, dropping any index whose close is null/NaN —
  // WITHOUT shifting the alignment of what survives: a hole in the middle of the array must
  // never pull a later timestamp onto an earlier close (a naive filter-then-zip would do
  // exactly that).
  const n = Math.min(timestamps.length, rawCloses.length);
  const closesAll = [];
  for (let i = 0; i < n; i++) {
    const c = rawCloses[i];
    if (typeof c === "number" && Number.isFinite(c) && typeof timestamps[i] === "number") {
      closesAll.push({ t: timestamps[i] * 1000, c });
    }
  }
  if (!closesAll.length) return { symbol, ok: false, reason: "no-data" };

  const latest = closesAll[closesAll.length - 1];
  const dayRaw = periodChangeRaw(closesAll, 1);
  const weekRaw = periodChangeRaw(closesAll, 5);
  const monthRaw = periodChangeRaw(closesAll, 21);

  const price = typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice : latest.c;
  // Deliberately NOT meta.chartPreviousClose: this is the exact close the "day" period was
  // computed against, so price/prevClose/day always reconcile with each other and with what
  // the sparkline shows, even on a day Yahoo's chart and quote numbers disagree by a cent.
  const prevClose = dayRaw.base;

  return {
    symbol: meta.symbol || symbol,
    ok: true,
    name: meta.shortName || meta.longName || "",
    currency: meta.currency || "USD",
    price,
    prevClose,
    day: periodOut(dayRaw),
    week: periodOut(weekRaw),
    month: periodOut(monthRaw),
    // ~63 trading days in 3 months — the cap is just insurance against a future range change.
    closes: closesAll.length > 100 ? closesAll.slice(closesAll.length - 100) : closesAll,
    asOf: latest.t,
  };
}

/* ---------------------------------------------------------------------------
   action:"analyze" — one small, tightly-fenced Anthropic call per symbol.

   THE SYSTEM PROMPT BELOW IS A SAFETY SURFACE, NOT A STYLE CHOICE. This is a family app and
   children use it. The model is given ONLY the numbers in the request (no live news access)
   and must stay descriptive and educational: what the symbol is, what the numbers show, and
   general factual context for why things like it move — never a recommendation, a price
   target, a forecast, or anything a reader could act on as personalized financial advice.
   Do not loosen this wording without re-reading why it exists.
   --------------------------------------------------------------------------- */
const ANALYSIS_MODEL = "claude-haiku-4-5";
const ANALYSIS_MAX_TOKENS = 380;
const ANALYSIS_SYSTEM = `You write short, educational explainer notes about a stock, market index, or commodity symbol for a family app used by parents AND children.

You are given only a handful of numbers about ONE symbol — its name, its current price, and how it has moved over the last day, week, and month — and nothing else. You have no live news access, no headlines, no analyst reports, no earnings figures, and no information beyond what is in this message.

Write about 90-130 words, plain enough for a teenager to follow, covering:
1. What the company, index, or commodity actually IS and does, described in ordinary language, not jargon.
2. What the supplied numbers show: whether it is up or down over the day, week, and month, said plainly.
3. General, textbook-level context for why a symbol LIKE THIS can move (its sector, earnings season, interest rates, oil supply, and so on) — WITHOUT ever claiming to know why THIS symbol moved on THIS day. If the reason for a move is not knowable from the numbers you were given, say so plainly instead of guessing.

STRICT RULES, NEVER BROKEN:
- Never recommend that anyone buy, sell, or hold this stock, in any form, direct or implied.
- Never give a price target, a forecast, or a prediction about what the price will do next.
- Never say or imply this is a "good investment," a "bad investment," or a "buying opportunity," or write anything a reader could act on as personalized financial advice.
- Never suggest position sizing, trade timing, or any other investment strategy.
- If you feel yourself drifting toward any of the above, stop and say plainly instead that Bucky does not give investment advice and this is for learning only.
- Never invent news, events, earnings figures, executive statements, or any fact not given to you in this message.
- No emoji, no hype, no exclamation points. Calm and plain throughout.

Reply with the explainer text only — plain prose paragraphs, no heading, no markdown, no bullet points.`;

function numOrNull(n) { return typeof n === "number" && Number.isFinite(n) ? n : null; }
function periodOrNull(p) {
  if (!p || typeof p !== "object") return null;
  const abs = numOrNull(p.abs);
  const pct = numOrNull(p.pct);
  if (abs === null && pct === null) return null;
  const out = { abs, pct };
  if (p.partial) out.partial = true;
  return out;
}
// Trims and type-checks whatever the client sent into a small, stable shape — both because
// it becomes the cache key (see below) and because none of it is trusted before it lands in
// a model prompt.
function sanitizeAnalyzeInput(body, symbol) {
  return {
    symbol,
    name: typeof body.name === "string" ? body.name.trim().slice(0, 80) : "",
    price: numOrNull(body.price),
    day: periodOrNull(body.day),
    week: periodOrNull(body.week),
    month: periodOrNull(body.month),
  };
}
function fmtSigned(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const s = n.toFixed(2);
  return n > 0 ? "+" + s : s;
}
function fmtPeriod(label, p) {
  if (!p) return null;
  const abs = fmtSigned(p.abs);
  const pct = fmtSigned(p.pct);
  if (abs === null && pct === null) return null;
  const bits = [];
  if (abs !== null) bits.push(abs);
  if (pct !== null) bits.push(`(${pct}%)`);
  return `${label}: ${bits.join(" ")}${p.partial ? " — partial data, shorter history than usual" : ""}`;
}
function buildAnalyzePrompt(input) {
  const lines = [`Symbol: ${input.symbol}`];
  if (input.name) lines.push(`Name: ${input.name}`);
  if (typeof input.price === "number") lines.push(`Current price: ${input.price}`);
  for (const l of [fmtPeriod("Day change", input.day), fmtPeriod("Week change", input.week), fmtPeriod("Month change", input.month)]) {
    if (l) lines.push(l);
  }
  return `Write the explainer for this symbol using only the numbers below. Do not use any other numbers or facts.\n\n${lines.join("\n")}`;
}

/* In-memory, per-warm-instance cache (the same trick as cachedGoogleToken in farmgpt.mjs /
   news.mjs): a Netlify function's module scope survives across warm invocations, so two
   people opening the same symbol's card within a few minutes of each other share ONE model
   call instead of paying for it twice. Keyed on the exact sanitized inputs, so a different
   day's numbers always calls through rather than serving stale commentary. */
const ANALYZE_CACHE_TTL_MS = 15 * 60 * 1000;
const ANALYZE_CACHE_MAX = 60;
const analyzeCache = new Map();
function analyzeCacheGet(key) {
  const hit = analyzeCache.get(key);
  if (!hit) return null;
  if (hit.exp < Date.now()) { analyzeCache.delete(key); return null; }
  return hit.text;
}
function analyzeCacheSet(key, text) {
  if (analyzeCache.size >= ANALYZE_CACHE_MAX) {
    const oldest = analyzeCache.keys().next().value;
    if (oldest !== undefined) analyzeCache.delete(oldest);
  }
  analyzeCache.set(key, { text, exp: Date.now() + ANALYZE_CACHE_TTL_MS });
}

async function analyzeSymbol(body) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, reason: "no-key" };

  const symbol = cleanSymbol(body && body.symbol);
  if (!symbol) return { ok: false, reason: "bad-symbol" };

  const input = sanitizeAnalyzeInput(body || {}, symbol);
  const cacheKey = JSON.stringify(input);
  const cached = analyzeCacheGet(cacheKey);
  if (cached) return { ok: true, symbol, text: cached, cached: true };

  const apiBase = process.env.STOCKS_ANTHROPIC_BASE_URL || process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let r;
  try {
    r = await fetch(`${apiBase}/v1/messages`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: ANALYSIS_MODEL,
        max_tokens: ANALYSIS_MAX_TOKENS,
        system: ANALYSIS_SYSTEM,
        messages: [{ role: "user", content: buildAnalyzePrompt(input) }],
      }),
    });
  } catch (e) {
    return { ok: false, symbol, reason: (e && e.name === "AbortError") ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
  if (!r.ok) return { ok: false, symbol, reason: "http-" + r.status };

  let j;
  try { j = await r.json(); } catch { return { ok: false, symbol, reason: "bad-json" }; }
  const text = (Array.isArray(j.content) ? j.content : [])
    .filter((b) => b && b.type === "text").map((b) => b.text).join("").trim();
  if (!text) return { ok: false, symbol, reason: "empty" };

  analyzeCacheSet(cacheKey, text);
  return { ok: true, symbol, text };
}

export default async (req) => {
  const origin = req.headers.get("origin") || "";
  const headers = corsHeaders(origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return json({ error: "POST only" }, 405, headers);

  const familySecret = process.env.BUCKY_NOTIFY_SECRET;
  if (!familySecret) return json({ error: "Server misconfigured: BUCKY_NOTIFY_SECRET is not set" }, 500, headers);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400, headers); }
  if (!body || body.secret !== familySecret) return json({ error: "Wrong family password" }, 401, headers);

  // ---- action:"quote" — UNCHANGED: same checks, same order, same shape. ----
  if (body.action === "quote") {
    // De-dupe + validate; drop bad tickers rather than failing the whole request.
    const seen = new Set();
    const symbols = [];
    for (const raw of (Array.isArray(body.symbols) ? body.symbols : [])) {
      const s = cleanSymbol(raw);
      if (s && !seen.has(s)) { seen.add(s); symbols.push(s); }
      if (symbols.length >= MAX_SYMBOLS) break;
    }
    if (!symbols.length) return json({ quotes: [] }, 200, headers);

    const quotes = await Promise.all(symbols.map(fetchQuote));
    return json({ quotes }, 200, headers);
  }

  // ---- action:"series" — sparkline + day/week/month deltas, same de-dupe/validate shape. ----
  if (body.action === "series") {
    const seen = new Set();
    const symbols = [];
    for (const raw of (Array.isArray(body.symbols) ? body.symbols : [])) {
      const s = cleanSymbol(raw);
      if (s && !seen.has(s)) { seen.add(s); symbols.push(s); }
      if (symbols.length >= MAX_SERIES_SYMBOLS) break;
    }
    if (!symbols.length) return json({ series: [] }, 200, headers);

    const series = await Promise.all(symbols.map(fetchSeries));
    return json({ series }, 200, headers);
  }

  // ---- action:"analyze" — one symbol, one small model call. Always 200; see analyzeSymbol. ----
  if (body.action === "analyze") {
    const result = await analyzeSymbol(body);
    return json(result, 200, headers);
  }

  return json({ error: 'action must be "quote", "series", or "analyze"' }, 400, headers);
};

export const config = {
  path: "/.netlify/functions/stocks",
};
