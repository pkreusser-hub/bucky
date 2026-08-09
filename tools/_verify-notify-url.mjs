import { readFileSync } from "fs";
const src = readFileSync("netlify/functions/notify.mjs","utf8");
const body = src.slice(src.indexOf("function resolveUrl"), src.indexOf("function corsHeaders"));
const DEFAULT_URL="https://amenfarms.netlify.app", ALLOWED_URL_ORIGIN="https://amenfarms.netlify.app";
const resolveUrl = new Function("DEFAULT_URL","ALLOWED_URL_ORIGIN", body + ";return resolveUrl;")(DEFAULT_URL,ALLOWED_URL_ORIGIN);
const ORIGIN = "https://amenfarms.netlify.app";
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
// Must NEVER leave the site.
for (const bad of ["https://evil.com","http://evil.com","//evil.com","javascript:alert(1)",
  "data:text/html,<script>","\\evil.com","https://amenfarms.netlify.app.evil.com/x",
  "index.html\@evil.com","evil.com/index.html"]) {
  const got = resolveUrl(bad);
  const safe = got === DEFAULT_URL || got.startsWith(ORIGIN+"/") || got === ORIGIN;
  let host=""; try { host = new URL(got).host; } catch {}
  ok(safe && host === "amenfarms.netlify.app", `refuses to leave the site: ${JSON.stringify(bad)} -> ${got}`);
}
console.log(`\nresolveUrl: ${pass}/${pass+fail} passed`);
process.exit(fail?1:0);
