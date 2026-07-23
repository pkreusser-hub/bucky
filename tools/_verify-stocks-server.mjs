// stocks.mjs server suite — in-process handler vs a fake Yahoo chart endpoint.
// Nothing here touches the real Yahoo API.
import http from "node:http";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ FAIL " + n); } };

const SECRET = "testsecret";
const seen = [];   // symbols the fake upstream was asked for

// Fake Yahoo chart endpoint: /v8/finance/chart/<SYM>
const upstream = http.createServer((req, res) => {
  const m = req.url.match(/\/v8\/finance\/chart\/([^?]+)/);
  const sym = m ? decodeURIComponent(m[1]) : "";
  seen.push(sym);
  res.setHeader("content-type", "application/json");
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
process.env.BUCKY_NOTIFY_SECRET = SECRET;
process.env.STOCKS_BASE_URL = `http://127.0.0.1:${upstream.address().port}`;

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

console.log(`\n${pass}/${pass + fail} checks passed`);
upstream.close();
process.exit(fail ? 1 : 0);
