import { readFileSync } from "fs";
const src = readFileSync("netlify/functions/notify.mjs","utf8");
const body = src.slice(src.indexOf("function resolveUrl"), src.indexOf("function corsHeaders"));
const DEFAULT_URL="https://amenfarms.netlify.app", ALLOWED_URL_ORIGIN="https://amenfarms.netlify.app";
// S4 (2026-08-10): the allowlist is a SET now — the league installs as its own app on its own
// domain, and a push whose tap target is forced back to the family origin opens the WRONG app.
// Injected here the same way ALLOWED_URL_ORIGIN always was, so the extraction above still works.
const ALLOWED_URL_ORIGINS = new Set([ALLOWED_URL_ORIGIN,"https://goatfantasyleague.com","https://www.goatfantasyleague.com"]);
const resolveUrl = new Function("DEFAULT_URL","ALLOWED_URL_ORIGIN","ALLOWED_URL_ORIGINS", body + ";return resolveUrl;")(DEFAULT_URL,ALLOWED_URL_ORIGIN,ALLOWED_URL_ORIGINS);
const ORIGIN = "https://amenfarms.netlify.app";
const LEAGUE = "https://goatfantasyleague.com";
let pass=0, fail=0;
const ok=(c,n)=>{ c?(pass++,console.log("  ok  "+n)):(fail++,console.log("  FAIL "+n)); };
// Real call sites must now deep-link.
for (const [u,want] of [
  ["index.html#calendar", ORIGIN+"/index.html#calendar"],
  ["index.html#farmbank", ORIGIN+"/index.html#farmbank"],
  ["index.html#workorders", ORIGIN+"/index.html#workorders"],
  ["games.html", ORIGIN+"/games.html"],
  ["farmgpt.html?ask=hi", ORIGIN+"/farmgpt.html?ask=hi"],
]) ok(resolveUrl(u)===want, `deep-links ${u}`);
// Previously-working shapes unchanged.
ok(resolveUrl("/index.html#x")===ORIGIN+"/index.html#x", "absolute path still works");
ok(resolveUrl(ORIGIN+"/x")===ORIGIN+"/x", "same-origin absolute URL still works");
ok(resolveUrl("")===DEFAULT_URL && resolveUrl(null)===DEFAULT_URL, "empty/null -> site root");

// ---- S4: the league's own origin, so a league push opens the INSTALLED league app ----
for (const [u,why] of [
  [LEAGUE+"/league.html#moves", "trade + waiver deep link"],
  [LEAGUE+"/league.html#chat", "chat @mention deep link"],
  [LEAGUE+"/league.html", "the week recap's league home"],
  ["https://www.goatfantasyleague.com/league.html#moves", "the www alias too"],
]) ok(resolveUrl(u)===u, `passes the league through untouched: ${why}`);
// A relative path is still resolved against the FAMILY origin — every relative call site is
// index.html's, and the league always sends absolute. This is the branch that would silently
// re-point league links at the farm app if it were ever "helpfully" widened.
ok(resolveUrl("league.html#moves")===ORIGIN+"/league.html#moves",
   "a BARE-RELATIVE path still resolves against the family origin (index.html's call sites)");

// Must NEVER leave the allowlist — the widening added origins, not a looser comparison.
const HOSTS = new Set(["amenfarms.netlify.app","goatfantasyleague.com","www.goatfantasyleague.com"]);
for (const bad of ["https://evil.com","http://evil.com","//evil.com","javascript:alert(1)",
  "data:text/html,<script>","\\evil.com","https://amenfarms.netlify.app.evil.com/x",
  "index.html\@evil.com","evil.com/index.html",
  // S4's own lookalikes — the exact shape a string-prefix allowlist would wave through.
  "https://goatfantasyleague.com.evil.com/x","https://goatfantasyleague.com.attacker.io/league.html",
  "https://evil-goatfantasyleague.com/x","http://goatfantasyleague.com/x",
  "https://goatfantasyleague.co/x","//goatfantasyleague.com/x"]) {
  const got = resolveUrl(bad);
  const safe = got === DEFAULT_URL || got.startsWith(ORIGIN+"/") || got === ORIGIN;
  let host=""; try { host = new URL(got).host; } catch {}
  ok(safe && HOSTS.has(host), `refuses to leave the allowlist: ${JSON.stringify(bad)} -> ${got}`);
}
// ...and the source really does compare a PARSED ORIGIN against the set, not a prefix.
ok(/ALLOWED_URL_ORIGINS\.has\(new URL\(url\)\.origin\)/.test(src),
   "the check is ALLOWED_URL_ORIGINS.has(new URL(url).origin) — parsed, never startsWith");
ok(src.includes('"https://goatfantasyleague.com"') && src.includes('"https://www.goatfantasyleague.com"'),
   "both league origins are in the shipped set");

// ---- S4: audience selection (the league's own targeting) ----
// getDeviceTokens filters the two LEAGUE selectors in code rather than by a fieldFilter (a
// number's Firestore value TYPE is chosen by whatever wrote it, and a mismatched filter returns
// zero rows silently). Exercised here against real Firestore REST row shapes.
const gdBody = src.slice(src.indexOf("async function getDeviceTokens"), src.indexOf("async function deleteTokenDoc"));
const rows = [
  { document: { name: "p/d/pushTokens_fam/a", fields: { token: { stringValue: "TA" }, user: { stringValue: "Isaac" }, gfflTeam: { integerValue: "1" } } } },
  { document: { name: "p/d/pushTokens_fam/b", fields: { token: { stringValue: "TB" }, user: { stringValue: "Mom" }, gfflTeam: { doubleValue: 2 } } } },
  { document: { name: "p/d/pushTokens_fam/c", fields: { token: { stringValue: "TC" }, user: { stringValue: "Dad" } } } }, // family only
  { document: {} }, // query metadata row
];
const FIRESTORE_BASE = "https://fake";
const getDeviceTokens = new Function("FIRESTORE_BASE","fetch", gdBody + ";return getDeviceTokens;")(
  FIRESTORE_BASE,
  async () => ({ ok: true, json: async () => rows })
);
const toks = async (sel) => (await getDeviceTokens("tok","fam",sel)).map((r) => r.token).sort();
const eq = (a,b) => JSON.stringify(a)===JSON.stringify(b);
ok(eq(await toks({ gfflTeam: 1 }), ["TA"]), "gfflTeam:1 selects only that owner's device");
ok(eq(await toks({ gfflTeam: 2 }), ["TB"]), "…and a doubleValue-written team id matches too (the type trap)");
ok(eq(await toks({ gfflTeam: 3 }), []), "a team with no device on file gets nobody, not everybody");
ok(eq(await toks({ gfflAll: true }), ["TA","TB"]),
   "gfflAll selects every LEAGUE device — and NOT the family-only one, which never opted in");
ok(eq(await toks({ gfflAll: true, excludeTeam: 1 }), ["TB"]), "excludeTeam drops the sending client's own team");
ok(eq(await toks({ user: "Dad" }), ["TA","TB","TC"]),
   "a family send filters SERVER-side (this fake returns every row), so it is unfiltered here — the family path is untouched");

console.log(`\nresolveUrl + audience: ${pass}/${pass+fail} passed`);
process.exit(fail?1:0);
