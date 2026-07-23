// BUCKY — stock quotes for the dashboard watchlist.
//
// Netlify Function (ESM). POST JSON: { secret, action:"quote", symbols:[...] }
//   -> { quotes: [{ symbol, ok, price, prevClose, change, changePct, currency,
//                    marketState, name }] }  (ok:false + reason on a per-symbol miss)
//
// Why a server proxy (not a direct client fetch like the weather widget): the free,
// keyless quote source (Yahoo Finance's chart endpoint) does NOT send CORS headers, so a
// browser fetch fails. Fetching server-side sidesteps CORS entirely and lets us set a
// browser-like User-Agent (Yahoo rate-limits the default). Zero dependencies + hand-rolled
// fetch, same house convention as calendar.mjs / farmgpt.mjs / notify.mjs. No API key and
// no new env var: only the existing family password is required.
//
// Required env: BUCKY_NOTIFY_SECRET (the shared family passphrase — same one the other
// functions use). Optional: STOCKS_BASE_URL to point the upstream at a fake server in tests.

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

  if (body.action !== "quote") return json({ error: 'action must be "quote"' }, 400, headers);

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
};

export const config = {
  path: "/.netlify/functions/stocks",
};
