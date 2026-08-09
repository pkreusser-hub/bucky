// BUCKY — stock data for the Finance tab: quotes, sparkline/chart series, and a plain-language
// AI explainer. Netlify Function (ESM). POST JSON, secret-gated like every other function here.
//
//   { secret, action:"quote", symbols:[...] }
//     -> { quotes: [{ symbol, ok, price, prevClose, change, changePct, currency,
//                      marketState, name }] }  (ok:false + reason on a per-symbol miss)
//     Feeds the Home dashboard's watchlist card. UNCHANGED — its request/response shape
//     stays exactly as it is.
//
//   { secret, action:"series", symbols:[...], range? }
//     -> { series: [{ symbol, ok, name, currency, price, prevClose,
//                      day:{abs,pct,partial?}, week:{abs,pct,partial?}, month:{abs,pct,partial?},
//                      closes:[{t,c}],   // oldest first, for sparklines/charts
//                      asOf }] }          // ok:false + reason per symbol on a miss, never sinks the batch
//     day/week/month are DERIVED FROM THE CLOSES SERIES ITSELF (latest vs ~1/~5/~21 trading
//     days back), not from Yahoo's own meta fields — that keeps price/prevClose/day/week/month
//     mutually consistent even on a day Yahoo's chart and quote endpoints disagree by a cent.
//     When the series is shorter than the lookback, the OLDEST available close stands in for
//     the missing one rather than inventing a number, flagged `partial:true` on that period.
//     abs/pct are rounded to 2dp. `prevClose` is exactly the close the "day" period was
//     computed against.
//     `range` (OPTIONAL, whitelisted: "day"|"week"|"month"|"year") swaps the upstream Yahoo
//     range+interval for the DETAIL-SHEET CHART's own D/W/M/Y toggle — a "day" view needs
//     intraday bars, a "year" view needs a much longer window than the default. Omitted or
//     unrecognized -> the ORIGINAL, unchanged default (range=3mo&interval=1d), which is what
//     the markets strip / watchlist rows / day-week-month chips all still use. day/week/month
//     are still computed for a ranged call (harmless — periodChangeRaw never throws) but are
//     NOT meant to be read from a ranged response: only a "closes"-shaped chart should ever
//     consume it, since e.g. "day" on 5-minute bars would be "the last 5-minute change," not a
//     real trading-day change.
//
//   { secret, action:"analyze", symbol, name?, day?, week?, month?, price? }
//     -> { ok, symbol, text, citations?, cached?, reason? }
//     A short, plain-language, EDUCATIONAL-ONLY explainer of a symbol's RECENT PRICE
//     MOVEMENT — not what the company does (the reader already knows that), but what
//     actually happened and why, grounded in a live web search.
//
//     PROVIDER: xAI's Agent Tools API (grok, /v1/responses with tools:[{type:"web_search"}])
//     when XAI_API_KEY is set — it is the only one of the two providers here with any live
//     news access, which is the entire reason the old Anthropic-only version of this endpoint
//     could only ever describe the company in general terms: it had nothing else to say.
//     Missing XAI_API_KEY (or a configured-but-fast-failing call) DEGRADES to a plain
//     Anthropic (Haiku) explainer with no search grounding — same house rule as farmgpt.mjs's
//     xAI routes ("a site with no xAI key configured is a working site"). A TIMEOUT is NOT
//     retried on Anthropic (see XAI_TIMEOUT_MS below — by the time it fires, most of the
//     ~10s Netlify budget is already spent) and returns {ok:false, reason:"timeout"} instead.
//     No key at all -> { ok:false, reason:"no-key" }. Any other upstream problem ->
//     { ok:false, reason }. This action NEVER returns an HTTP error status and NEVER throws.
//
//     THE SYSTEM PROMPTS ARE A SAFETY SURFACE, NOT A STYLE CHOICE — this app is used by
//     children. Both ANALYSIS_SYSTEM_XAI and ANALYSIS_SYSTEM_FALLBACK explicitly and
//     repeatedly forbid recommending a trade, giving a price target, forecasting, or writing
//     anything a reader could act on as personalized financial advice. The xAI prompt carries
//     ONE MORE rule the fallback doesn't need: a live web search routinely surfaces analyst
//     price targets and buy/sell/hold ratings, and the model is explicitly told never to repeat
//     a specific target or rating, or frame one as something to act on. See both consts below
//     before touching any of that wording.
//
//     COST CONTROL, two layers: (1) an in-memory, per-warm-instance cache keyed on the exact
//     sanitized request (module scope survives warm Netlify invocations — same trick as
//     cachedGoogleToken in farmgpt.mjs/news.mjs), `cached:true` on a hit; (2) a SHARED daily
//     Firestore cache keyed on (day, symbol) ONLY — so the whole family pays for at most one
//     real analysis call per symbol per day, not one per person per tap, regardless of which
//     device asks or how the numbers drift intraday. Layer 2 is checked only on a layer-1 miss
//     (cheap first, network second) and is written after ANY successful call, xAI or fallback.
//     It fails OPEN in every direction (no FIREBASE_SERVICE_ACCOUNT, a Firestore outage, a bad
//     response) — a caching problem can only ever cost an extra model call, never break a reply.
//
// Why a server proxy (not a direct client fetch like the weather widget): the free, keyless
// quote source (Yahoo Finance's chart endpoint) does NOT send CORS headers, so a browser fetch
// fails. Fetching server-side sidesteps CORS entirely and lets us set a browser-like
// User-Agent (Yahoo rate-limits the default). Zero dependencies + hand-rolled fetch, same
// house convention as calendar.mjs / farmgpt.mjs / notify.mjs / news.mjs / activity.mjs.
//
// Required env: BUCKY_NOTIFY_SECRET (the shared family passphrase — same one the other
// functions use).
// Optional env:
//   XAI_API_KEY              - xAI key (console.x.ai). Without it, analyze degrades straight
//                               to the Anthropic fallback (or {ok:false,reason:"no-key"} if
//                               ANTHROPIC_API_KEY is ALSO unset). quote/series are unaffected.
//   STOCKS_XAI_MODEL          - xAI model id override. Falls back to XAI_MODEL (the shared
//                               farmgpt.mjs env var, in case it's already set for story mode),
//                               then to a SANE, MEASURED-SAFE DEFAULT — see the const below for
//                               why grok-4.5 (farmgpt's own default) is NOT used here.
//   STOCKS_XAI_TIMEOUT_MS     - override the xAI abort timeout (default 8000). Test hook —
//                               production should not need this; it exists so the "a slow
//                               upstream degrades gracefully" path can be exercised on a clock
//                               a test can actually wait out.
//   STOCKS_XAI_BASE_URL       - override for local testing against a fake xAI server (falls
//                               back to XAI_BASE_URL, then https://api.x.ai).
//   ANTHROPIC_API_KEY         - required for the Anthropic fallback path (already set in
//                               production for FarmGPT/News).
//   STOCKS_ANTHROPIC_BASE_URL - override for local testing against a fake Anthropic server
//                               (falls back to ANTHROPIC_BASE_URL).
//   FIREBASE_SERVICE_ACCOUNT  - turns on the shared daily analysis cache (already set for
//                               FarmGPT/News/Activity). Without it, analyze still works —
//                               every request just pays for its own model call.
//   STOCKS_FIRESTORE_BASE / STOCKS_GOOGLE_TOKEN_URL - point the cache's Firestore/token calls
//                               at fakes in tests (activity.mjs's env-var-per-function pattern).
//   STOCKS_BASE_URL            - point Yahoo at a fake server in tests.

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
   action:"series" — sparkline/chart data, and the day/week/month deltas that go with it.
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

// The detail-sheet chart's D/W/M/Y toggle. WHITELISTED: `body.range` is only ever used to
// look up one of these four fixed upstream range+interval pairs — never interpolated into the
// Yahoo URL directly. Absent/unrecognized -> null -> the ORIGINAL default (3mo/1d) below.
//   day:   intraday 5-minute bars over the current/most recent session (~78 points)
//   week:  15-minute bars over 5 trading days (~130 points)
//   month: daily bars over 1 month (~21 points) — same interval as the default, just shorter
//   year:  daily bars over 1 year (~252 points) — plenty of chart detail, still a small payload
const SERIES_RANGE_PRESETS = {
  day: { range: "1d", interval: "5m" },
  week: { range: "5d", interval: "15m" },
  month: { range: "1mo", interval: "1d" },
  year: { range: "1y", interval: "1d" },
};
function seriesRangeParams(key) {
  return Object.prototype.hasOwnProperty.call(SERIES_RANGE_PRESETS, key)
    ? SERIES_RANGE_PRESETS[key] : { range: "3mo", interval: "1d" };
}
// 400 comfortably covers the longest preset (year@1d, ~252 points) with margin — insurance
// against a future range change, same spirit as the original flat "100" it replaces.
const SERIES_CLOSES_CAP = 400;

async function fetchSeries(symbol, rangeKey) {
  const { range, interval } = seriesRangeParams(rangeKey);
  const url = `${STOCKS_BASE_URL}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
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
    closes: closesAll.length > SERIES_CLOSES_CAP ? closesAll.slice(closesAll.length - SERIES_CLOSES_CAP) : closesAll,
    asOf: latest.t,
  };
}

/* ---------------------------------------------------------------------------
   action:"analyze" — xAI (grok, web-search-grounded), degrading to a plain Anthropic
   explainer. THE SYSTEM PROMPTS BELOW ARE A SAFETY SURFACE, NOT A STYLE CHOICE. This is a
   family app and children use it. Neither model may ever recommend a trade, give a price
   target, forecast, or write anything a reader could act on as personalized financial
   advice. Do not loosen this wording without re-reading why it exists.
   --------------------------------------------------------------------------- */

// xAI is OpenAI/Agent-Tools compatible. grok-4.5 (farmgpt.mjs's own default for XAI_MODEL) is
// NOT the default here — MEASURED against the real API with a "do at most one web search"
// instruction, grok-4.5 took 16.1s and 11.5s on two separate runs (its own internal reasoning,
// not the search itself, dominates the time), well past Netlify's ~10s ceiling either way.
// grok-4.20-0309-non-reasoning measured 5.6s and 6.2s on the same prompt shape, comfortably
// inside budget, with MORE precise citations (real start/end indices into a specific relevant
// article, vs grok-4.5's list of generic quote-page URLs with no indices at all). If XAI_MODEL
// ends up set globally (e.g. for story mode) to something slower, it silently applies here too
// unless STOCKS_XAI_MODEL is set explicitly — recommended in production for exactly that reason.
const STOCKS_XAI_MODEL = process.env.STOCKS_XAI_MODEL || process.env.XAI_MODEL || "grok-4.20-0309-non-reasoning";
// MEASURED: a real reply at this shape/length runs 200-260 output tokens; this leaves headroom
// without inviting a rambling answer (max_tokens is a ceiling, billed only for what's produced).
const XAI_MAX_OUTPUT_TOKENS = 420;
// A hard design constraint: Netlify's function timeout is ~10s. This fires well before that,
// so a genuinely slow upstream returns {ok:false,reason:"timeout"} — a graceful, cheap answer —
// rather than the whole function getting killed mid-flight (a hung request / a 502). Overridable
// only for tests (STOCKS_XAI_TIMEOUT_MS): production should never need to touch this.
const XAI_TIMEOUT_MS = Number(process.env.STOCKS_XAI_TIMEOUT_MS) || 8000;
const ANTHROPIC_TIMEOUT_MS = 20000;

const ANALYSIS_MODEL = "claude-haiku-4-5";   // the Anthropic FALLBACK path only
const ANALYSIS_MAX_TOKENS = 380;

// THE PRIMARY PATH (xAI, web-search-grounded). Focused on RECENT MOVEMENT — what happened and
// why, not what the company generally does (the reader already knows that; the old, purely
// numbers-only prompt had no choice but to pad with it).
const ANALYSIS_SYSTEM_XAI = `You write short, plain-language notes about a stock, market index, or commodity symbol's RECENT PRICE MOVEMENT, for a family app used by parents AND children.

You have live web search. Use it to find out what is genuinely being reported about this symbol's recent trading. Do AT MOST ONE web search, then answer immediately with what you found — do not run multiple rounds of searching.

You are given the symbol's name, its current price, and how it has moved over the last day, week, and month. Write about 90-140 words, plain enough for a teenager to follow, covering:
1. What the numbers show — up or down over the day, week, and month, stated plainly.
2. What your search actually found about WHY: real, specific, recent news such as earnings, guidance, a product or leadership change, an economic report, or a sector-wide move. Use only what your search genuinely returned.
3. If your search does not turn up a specific reported reason, say so plainly ("no specific reason is being widely reported for this move") rather than guessing or padding with generic background.

Do NOT describe what the company, index, or commodity generally does or sells — the reader already knows that. Stay focused on what actually happened recently.

STRICT RULES, NEVER BROKEN:
- Never recommend that anyone buy, sell, or hold this stock, in any form, direct or implied.
- Never give a price target, a forecast, or a prediction about what the price will do next.
- Never say or imply this is a "good investment," a "bad investment," or a "buying opportunity," or write anything a reader could act on as personalized financial advice.
- Never suggest position sizing, trade timing, or any other investment strategy.
- Your search results will often be full of analyst price targets, ratings, and "buy/sell/hold" labels. NEVER repeat a specific price target or rating, and never frame one as something the reader should act on. If an analyst call is genuinely part of why the stock moved, you may say plainly that it happened, without repeating the number or endorsing it.
- If you feel yourself drifting toward any of the above, stop and say plainly instead that Bucky does not give investment advice and this is for learning only.
- Never invent news, events, figures, quotes, or sources that did not actually appear in your search results.
- No emoji, no hype, no exclamation points. Calm and plain throughout.
- This is read by a whole family, including children.

Reply with the explainer text only — plain prose paragraphs, no heading, no markdown, no bullet points, and no inline links or citation markers in the text itself (citations are handled separately).`;

// THE FALLBACK PATH (Anthropic, no search access) — UNCHANGED from the original numbers-only
// explainer. It has no way to know what actually moved a symbol, so — unlike the xAI prompt
// above — it still describes what the company/index/commodity IS, which is the only honest,
// non-invented thing it can say. Used only when XAI_API_KEY is missing, or when a
// configured-but-fast-failing xAI call leaves clear time budget for a second attempt.
const ANALYSIS_SYSTEM_FALLBACK = `You write short, educational explainer notes about a stock, market index, or commodity symbol for a family app used by parents AND children.

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
   day's numbers always calls through rather than serving stale commentary. This is LAYER 1 —
   see readDailyCache/writeDailyCache below for the cross-device, whole-day LAYER 2. */
const ANALYZE_CACHE_TTL_MS = 15 * 60 * 1000;
const ANALYZE_CACHE_MAX = 60;
const analyzeCache = new Map();
function analyzeCacheGet(key) {
  const hit = analyzeCache.get(key);
  if (!hit) return null;
  if (hit.exp < Date.now()) { analyzeCache.delete(key); return null; }
  return { text: hit.text, citations: hit.citations || [] };
}
function analyzeCacheSet(key, text, citations) {
  if (analyzeCache.size >= ANALYZE_CACHE_MAX) {
    const oldest = analyzeCache.keys().next().value;
    if (oldest !== undefined) analyzeCache.delete(oldest);
  }
  analyzeCache.set(key, { text, citations: citations || [], exp: Date.now() + ANALYZE_CACHE_TTL_MS });
}

/* ---------------------------------------------------------------------------
   SHARED DAILY CACHE (Firestore) — LAYER 2. One doc per (day, symbol): the whole family pays
   for at most one real analysis call per symbol per day. Same house pattern as news.mjs /
   activity.mjs: hand-signed service-account JWT (notify.mjs technique), Firestore REST, a
   module-scope token cache across warm invocations. Fails OPEN in every direction — a missing
   service account, a Firestore outage, or a malformed response never blocks an analysis, it
   just means this one request pays for its own model call instead of reusing someone else's.
   --------------------------------------------------------------------------- */
const STOCKS_PROJECT_ID = "amen-farms-app";
const STOCKS_FIRESTORE_BASE = process.env.STOCKS_FIRESTORE_BASE ||
  `https://firestore.googleapis.com/v1/projects/${STOCKS_PROJECT_ID}/databases/(default)/documents`;
const STOCKS_GOOGLE_TOKEN_URL = process.env.STOCKS_GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
const ANALYSIS_CACHE_COLLECTION = "stocks_analysis";

let cachedGoogleToken = null;   // { token, exp(ms) } — survives across warm invocations
function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function getGoogleAccessToken() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  if (cachedGoogleToken && Date.now() < cachedGoogleToken.exp - 60000) return cachedGoogleToken.token;
  let sa;
  try { sa = JSON.parse(raw); } catch { return null; }
  const crypto = await import("node:crypto");
  const nowSec = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: nowSec, exp: nowSec + 3600,
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(header + "." + claims);
  const jwt = header + "." + claims + "." + base64url(signer.sign(sa.private_key));
  let resp;
  try {
    resp = await fetch(STOCKS_GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
    });
  } catch { return null; }
  if (!resp.ok) return null;
  const j = await resp.json().catch(() => null);
  if (!j || !j.access_token) return null;
  cachedGoogleToken = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cachedGoogleToken.token;
}

function stocksDay() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}
function dailyCacheDocId(symbol) { return `${stocksDay()}__${symbol}`; }
// Field names are plain identifiers throughout ([a-zA-Z_][a-zA-Z_0-9]*) — the exact grammar
// Firestore enforces on a property path; a leading-digit name here would 400 the whole write,
// which is precisely how activity.mjs's first version silently lost 12 hours of data.
const sv = (s) => ({ stringValue: String(s == null ? "" : s).slice(0, 24000) });

async function readDailyCache(symbol) {
  try {
    const token = await getGoogleAccessToken();
    if (!token) return null;
    const r = await fetch(`${STOCKS_FIRESTORE_BASE}/${ANALYSIS_CACHE_COLLECTION}/${dailyCacheDocId(symbol)}`,
      { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) return null;   // includes a plain 404 (nothing cached yet today) — never an error
    const j = await r.json().catch(() => null);
    const f = j && j.fields;
    const text = f && f.text && f.text.stringValue;
    if (!text) return null;
    let citations = [];
    try { citations = JSON.parse((f.citations && f.citations.stringValue) || "[]"); } catch { /* keep [] */ }
    return { text, citations: Array.isArray(citations) ? citations : [] };
  } catch { return null; }
}
async function writeDailyCache(symbol, rec) {
  try {
    const token = await getGoogleAccessToken();
    if (!token) return false;
    const name = `projects/${STOCKS_PROJECT_ID}/databases/(default)/documents/${ANALYSIS_CACHE_COLLECTION}/${dailyCacheDocId(symbol)}`;
    const r = await fetch(`${STOCKS_FIRESTORE_BASE}:commit`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        writes: [{ update: { name, fields: {
          text: sv(rec.text),
          citations: sv(JSON.stringify(rec.citations || [])),
          provider: sv(rec.provider || ""),
          model: sv(rec.model || ""),
          day: sv(stocksDay()),
          symbol: sv(symbol),
          createdAt: sv(new Date().toISOString()),
        } } }],
      }),
    });
    return r.ok;
  } catch { return false; }
}

/* ---------------------------------------------------------------------------
   The two providers.
   --------------------------------------------------------------------------- */

// The model sometimes emits inline citation markers despite being asked not to — observed
// live as both "[[1]](https://...)" and "[1](https://...)" — because the Agent Tools API's
// own citation formatting seems to override that instruction some of the time. Stripped
// server-side rather than trusted to the prompt: the UI renders this as plain text, and a raw
// markdown link would show up literally. Real citations still reach the UI, just from the
// structured `annotations` array below, never parsed out of the prose.
function stripCitationMarkers(text) {
  return String(text || "")
    .replace(/\[\[\d+\]\]\(https?:\/\/[^\s)]+\)/g, "")
    .replace(/\[\d+\]\(https?:\/\/[^\s)]+\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .trim();
}
// Up to 5 unique source URLs, each with a plain hostname for display (the API's own
// annotation "title" is not a real article title — for the non-reasoning model it was just
// the footnote index ("1"); for the reasoning model it was the URL itself).
function xaiCitations(msgItem) {
  const out = [];
  const seen = new Set();
  const blocks = (msgItem && Array.isArray(msgItem.content)) ? msgItem.content : [];
  for (const b of blocks) {
    for (const a of (Array.isArray(b && b.annotations) ? b.annotations : [])) {
      if (!a || a.type !== "url_citation" || typeof a.url !== "string") continue;
      if (seen.has(a.url)) continue;
      seen.add(a.url);
      let host = "";
      try { host = new URL(a.url).hostname.replace(/^www\./, ""); } catch { /* keep "" */ }
      out.push({ url: a.url, host });
      if (out.length >= 5) break;
    }
    if (out.length >= 5) break;
  }
  return out;
}

async function callXai(input, apiKey) {
  const base = process.env.STOCKS_XAI_BASE_URL || process.env.XAI_BASE_URL || "https://api.x.ai";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), XAI_TIMEOUT_MS);
  let r;
  try {
    r = await fetch(`${base}/v1/responses`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: STOCKS_XAI_MODEL,
        tools: [{ type: "web_search" }],
        max_output_tokens: XAI_MAX_OUTPUT_TOKENS,
        instructions: ANALYSIS_SYSTEM_XAI,
        input: buildAnalyzePrompt(input),
      }),
    });
  } catch (e) {
    return { ok: false, reason: (e && e.name === "AbortError") ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
  if (!r.ok) return { ok: false, reason: "http-" + r.status };
  let j;
  try { j = await r.json(); } catch { return { ok: false, reason: "bad-json" }; }
  const msg = (Array.isArray(j.output) ? j.output : []).find((o) => o && o.type === "message");
  const blocks = (msg && Array.isArray(msg.content)) ? msg.content : [];
  const text = stripCitationMarkers(blocks
    .filter((b) => b && (b.type === "output_text" || b.type === "text"))
    .map((b) => b.text || "").join(""));
  if (!text) return { ok: false, reason: "empty" };
  return { ok: true, text, citations: xaiCitations(msg), model: STOCKS_XAI_MODEL, provider: "xai" };
}

async function callAnthropic(input, apiKey) {
  const apiBase = process.env.STOCKS_ANTHROPIC_BASE_URL || process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ANTHROPIC_TIMEOUT_MS);
  let r;
  try {
    r = await fetch(`${apiBase}/v1/messages`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: ANALYSIS_MODEL,
        max_tokens: ANALYSIS_MAX_TOKENS,
        system: ANALYSIS_SYSTEM_FALLBACK,
        messages: [{ role: "user", content: buildAnalyzePrompt(input) }],
      }),
    });
  } catch (e) {
    return { ok: false, reason: (e && e.name === "AbortError") ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
  if (!r.ok) return { ok: false, reason: "http-" + r.status };
  let j;
  try { j = await r.json(); } catch { return { ok: false, reason: "bad-json" }; }
  const text = (Array.isArray(j.content) ? j.content : [])
    .filter((b) => b && b.type === "text").map((b) => b.text).join("").trim();
  if (!text) return { ok: false, reason: "empty" };
  return { ok: true, text, citations: [], model: ANALYSIS_MODEL, provider: "anthropic" };
}

async function analyzeSymbol(body) {
  const symbol = cleanSymbol(body && body.symbol);
  if (!symbol) return { ok: false, reason: "bad-symbol" };

  const input = sanitizeAnalyzeInput(body || {}, symbol);
  const cacheKey = JSON.stringify(input);

  // LAYER 1 — exact-input, per-warm-instance, free.
  const warm = analyzeCacheGet(cacheKey);
  if (warm) return { ok: true, symbol, text: warm.text, citations: warm.citations, cached: true };

  // LAYER 2 — (day, symbol), shared across the whole family/every device, one Firestore GET.
  // Checked BEFORE the key-existence check below on purpose: a cache entry written earlier
  // today should still serve even if a key were removed since, and it costs nothing to try.
  const daily = await readDailyCache(symbol);
  if (daily) {
    analyzeCacheSet(cacheKey, daily.text, daily.citations);
    return { ok: true, symbol, text: daily.text, citations: daily.citations, cached: true };
  }

  const xaiKey = process.env.XAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!xaiKey && !anthropicKey) return { ok: false, reason: "no-key" };

  let result;
  if (xaiKey) {
    result = await callXai(input, xaiKey);
    // Retried on Anthropic only when xAI failed FAST (bad key, network error, an upstream
    // error status) — there is clearly time budget left. A TIMEOUT means ~all of the ~10s
    // Netlify budget is already spent reaching it, so retrying risks a hard kill instead of a
    // graceful answer; return it as-is (see XAI_TIMEOUT_MS above).
    if (!result.ok && result.reason !== "timeout" && anthropicKey) {
      result = await callAnthropic(input, anthropicKey);
    }
  } else {
    result = await callAnthropic(input, anthropicKey);
  }

  if (!result.ok) return { ok: false, symbol, reason: result.reason };

  analyzeCacheSet(cacheKey, result.text, result.citations);
  await writeDailyCache(symbol, { text: result.text, citations: result.citations, provider: result.provider, model: result.model });
  return { ok: true, symbol, text: result.text, citations: result.citations || [] };
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

  // ---- action:"series" — sparkline/chart + day/week/month deltas. `range` is optional and
  // whitelisted (see SERIES_RANGE_PRESETS); anything else falls through to the original
  // default (3mo/1d), so every existing caller is byte-identical to before. ----
  if (body.action === "series") {
    const seen = new Set();
    const symbols = [];
    for (const raw of (Array.isArray(body.symbols) ? body.symbols : [])) {
      const s = cleanSymbol(raw);
      if (s && !seen.has(s)) { seen.add(s); symbols.push(s); }
      if (symbols.length >= MAX_SERIES_SYMBOLS) break;
    }
    if (!symbols.length) return json({ series: [] }, 200, headers);

    const rangeKey = Object.prototype.hasOwnProperty.call(SERIES_RANGE_PRESETS, body.range) ? body.range : null;
    const series = await Promise.all(symbols.map((s) => fetchSeries(s, rangeKey)));
    return json({ series }, 200, headers);
  }

  // ---- action:"analyze" — one symbol, xAI (grounded) or Anthropic (fallback). Always 200;
  // see analyzeSymbol. ----
  if (body.action === "analyze") {
    const result = await analyzeSymbol(body);
    return json(result, 200, headers);
  }

  return json({ error: 'action must be "quote", "series", or "analyze"' }, 400, headers);
};

export const config = {
  path: "/.netlify/functions/stocks",
};
