#!/usr/bin/env node
/**
 * RoboGoat read log (netlify/functions/rgread.mjs): in-process suite, zero real network.
 *
 *   node tools/_verify-rgread.mjs
 *
 * Fake local servers stand in for Google's token endpoint and Firestore (tools/_fakefs.mjs: it
 * refuses unmasked PATCH, a JS-number integerValue and exists=false over an existing doc, as the
 * real service does). The beacon is an <img> on a script-free page, so the reader can only come
 * from the Referer; every case below is a Referer a real browser would send for that path.
 */
import http from "node:http";
import crypto from "node:crypto";
import { createStore, handleDoc, decode } from "./_fakefs.mjs";

let pass = 0, fail = 0;
const failures = [];
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; failures.push(name); console.log("  FAIL " + name + (extra ? "  -> " + extra : "")); }
};
const section = (t) => console.log("\n=== " + t + " ===");

const GOOG = 8961, FS = 8962;
const FAM = "famtestrg";
const BASE = "projects/amen-farms-app/databases/(default)/documents";
const KEY = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ client_email: "t@amen-farms-app.iam.gserviceaccount.com", private_key: KEY.privateKey.export({ type: "pkcs8", format: "pem" }) });
process.env.RGREAD_FIRESTORE_BASE = `http://127.0.0.1:${FS}/v1/${BASE}`;
process.env.RGREAD_TOKEN_URL = `http://127.0.0.1:${GOOG}/token`;
process.env.RGREAD_FAMILY_KEY = FAM;
process.env.RGREAD_TEST_NOW_MS = String(Date.parse("2026-10-11T14:05:00Z"));

const S = { store: createStore(), fsFail: 0, tokenCalls: 0 };
const listen = (port, handler) => new Promise((resolve) => {
  const srv = http.createServer((req, res) => { let raw = ""; req.on("data", (c) => { raw += c; }); req.on("end", () => handler(req, res, raw)); });
  srv.listen(port, "127.0.0.1", () => resolve(srv));
});
const sendJson = (res, status, obj) => { res.statusCode = status; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(obj)); };
const servers = await Promise.all([
  listen(GOOG, (req, res) => { S.tokenCalls++; sendJson(res, 200, { access_token: "fake", expires_in: 3600 }); }),
  listen(FS, (req, res, raw) => {
    const url = new URL(req.url, "http://x");
    const m = /\/documents\/(.+)$/.exec(url.pathname);
    if (!m) return sendJson(res, 404, {});
    if (S.fsFail > 0) { S.fsFail--; return sendJson(res, 503, { error: { status: "UNAVAILABLE" } }); }
    let body = null; try { body = raw ? JSON.parse(raw) : null; } catch {}
    const r = handleDoc(S.store, BASE, req.method, m[1], url.searchParams, body);
    sendJson(res, r.status, r.body);
  }),
]);

const fn = await import("../netlify/functions/rgread.mjs");
const { parseRead, readFields } = fn;
const handler = fn.default;

const SITE = "https://goatfantasyleague.com";
const BEACON = (i) => `${SITE}/.netlify/functions/rgread?i=${i}`;
const PAGE = (issue, q = "") => `${SITE}/robogoat/${issue}/${q}`;
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
const W5 = "2026/week-5-preview";
const reads = () => [...S.store.docs.entries()].filter(([k]) => k.startsWith(`gffl_${FAM}/rgread_`))
  .map(([k, d]) => ({ id: k.split("/")[1], ...Object.fromEntries(Object.entries(d.fields).map(([f, v]) => [f, decode(v)])), raw: d.fields }));
const req = (url, { referer, ua = IPHONE, method = "GET" } = {}) =>
  new Request(url, { method, headers: { ...(referer ? { referer } : {}), "user-agent": ua } });

section("parseRead: who read which issue, from the Referer");
const pr = (ref, ua = IPHONE, i = W5) => parseRead(BEACON(i), ref, ua);
ok(JSON.stringify(pr(PAGE(W5, "?r=app5"))) === JSON.stringify({ issue: W5, via: "app", team: 5 }), "the GFFL card's ?r=app5 on the issue's own page -> app, team 5");
ok(JSON.stringify(pr(PAGE(W5, "?r=push12"))) === JSON.stringify({ issue: W5, via: "push", team: 12 }), "a push link's ?r=push12 -> push, team 12");
ok(JSON.stringify(pr(`https://www.goatfantasyleague.com/robogoat/${W5}/?r=push3`)) === JSON.stringify({ issue: W5, via: "push", team: 3 }), "the www host counts too");
ok(JSON.stringify(pr(`https://amenfarms.netlify.app/robogoat/${W5}/?r=app1`)) === JSON.stringify({ issue: W5, via: "app", team: 1 }), "the netlify.app host (same site) counts too");
ok(JSON.stringify(pr(PAGE(W5))) === JSON.stringify({ issue: W5, via: "direct", team: null }), "the email link (no tag) -> direct, no team");
ok(JSON.stringify(pr("")) === JSON.stringify({ issue: W5, via: "direct", team: null }), "no Referer at all -> direct, no team");
ok(JSON.stringify(pr(PAGE("2026/week-4", "?r=app5"))) === JSON.stringify({ issue: W5, via: "direct", team: null }),
  "a tag on ANOTHER issue's URL says nothing about this one -> direct");
ok(JSON.stringify(pr(`https://example.com/robogoat/${W5}/?r=app5`)) === JSON.stringify({ issue: W5, via: "direct", team: null }), "a tag on a foreign host -> direct");
ok(pr(PAGE(W5, "?r=app0")).team === null && pr(PAGE(W5, "?r=app21")).team === null && pr(PAGE(W5, "?r=app5x")).team === null,
  "team out of range or a malformed tag -> no team");
ok(pr(PAGE(W5, "?r=email5")).via === "direct", "an unknown channel name -> direct");
ok(pr(PAGE(W5), IPHONE, "2026/week-5-preview/").issue === W5, "a trailing slash on i is normalised");
ok(pr(PAGE(W5), IPHONE, "") === null && pr(PAGE(W5), IPHONE, "../secret") === null && pr(PAGE(W5), IPHONE, "2026/week-5-preview/../x") === null
  && pr(PAGE(W5), IPHONE, "2026/archive") === null, "a missing or malformed issue path is not logged at all");
ok(pr(PAGE(W5), "facebookexternalhit/1.1") === null && pr(PAGE(W5), "Slackbot-LinkExpanding 1.0") === null
  && pr(PAGE(W5), "Mozilla/5.0 (compatible; Googlebot/2.1)") === null, "link-preview and crawler user agents are not logged");
ok(pr(PAGE(W5, "?r=app5"), ANDROID) !== null, "a real Android Chrome is logged");

section("readFields: the shape Firestore accepts");
const f5 = readFields({ issue: W5, via: "app", team: 5 }, 1791727500000);
ok(f5.team.integerValue === "5" && f5.t.integerValue === "1791727500000", "team and t are integerValue decimal STRINGS");
ok("nullValue" in readFields({ issue: W5, via: "direct", team: null }, 1).team, "no team is an explicit nullValue");

section("handler: one masked create per read, always a pixel back");
let r = await handler(req(BEACON(W5), { referer: PAGE(W5, "?r=app5") }));
let got = reads();
ok(r.status === 200 && r.headers.get("content-type") === "image/gif" && /no-store/.test(r.headers.get("cache-control") || ""), "answers 200 image/gif, no-store");
const px = Buffer.from(await r.arrayBuffer());
ok(px.slice(0, 6).toString() === "GIF89a" && px.readUInt16LE(6) === 1 && px.readUInt16LE(8) === 1 && px[px.length - 1] === 0x3b,
  "the body is a GIF89a, 1x1 (logical screen 1 by 1), with the trailer byte");
ok(got.length === 1 && got[0].kind === "rgread" && got[0].issue === W5 && got[0].via === "app" && got[0].team === 5
  && got[0].t === Number(process.env.RGREAD_TEST_NOW_MS), "one rgread doc: issue, via app, team 5, t", JSON.stringify(got.map(({ raw, ...x }) => x)));
const w = S.store.writes.at(-1);
ok(w && w.exists === "false" && ["kind", "issue", "via", "team", "t"].every((f) => w.mask.includes(f)), "written as a masked create (exists=false)");
ok(/^rgread_\d+_[a-z0-9]{1,6}$/.test(got[0].id), "doc id rgread_<t>_<random>");

await handler(req(BEACON(W5), { referer: PAGE(W5, "?r=app5") }));
ok(reads().length === 2, "a second read in the same millisecond is a second doc, not an overwrite");
await handler(req(BEACON(W5), { referer: PAGE(W5) }));
got = reads();
ok(got.length === 3 && got.filter((x) => x.via === "direct" && x.team === null).length === 1, "an untagged read is logged as direct with team null");

const before = reads().length;
r = await handler(req(BEACON(W5), { referer: PAGE(W5), ua: "facebookexternalhit/1.1" }));
ok(r.status === 200 && reads().length === before, "a preview bot gets the pixel and no log");
r = await handler(req(BEACON("nope"), { referer: PAGE(W5) }));
ok(r.status === 200 && reads().length === before, "a bad issue path gets the pixel and no log");
r = await handler(req(BEACON(W5), { referer: PAGE(W5), method: "HEAD" }));
ok(r.status === 200 && reads().length === before, "HEAD gets the pixel and no log");
r = await handler(new Request(BEACON(W5), { method: "POST", body: "x" }));
ok(r.status === 200 && reads().length === before, "POST gets the pixel and no log");

S.fsFail = 1;
r = await handler(req(BEACON(W5), { referer: PAGE(W5, "?r=push3") }));
ok(r.status === 200 && r.headers.get("content-type") === "image/gif" && reads().length === before, "Firestore refusing (503): still the pixel, nothing written, no throw");

const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
delete process.env.FIREBASE_SERVICE_ACCOUNT;
r = await handler(req(BEACON(W5), { referer: PAGE(W5, "?r=push3") }));
ok(r.status === 200 && reads().length === before, "no service account: the pixel, no write");
process.env.FIREBASE_SERVICE_ACCOUNT = sa;

const tokensBefore = S.tokenCalls;
await handler(req(BEACON(W5), { referer: PAGE(W5, "?r=push3") }));
await handler(req(BEACON(W5), { referer: PAGE(W5, "?r=push4") }));
ok(S.tokenCalls === tokensBefore, "a warm function reuses its access token");

section("reads.mjs: the report, from the docs the handler just wrote");
// Round trip: the summary is computed from what the fake Firestore holds after the handler runs
// above, decoded the way Firestore REST returns it, so the writer and the report agree on shape.
const { summarize, render } = await import("./robogoat/reads.mjs");
const TEAMS = { 1: { owner: "Perry" }, 3: { owner: "Joe" }, 4: { owner: "Tom" }, 5: { owner: "Sandy" }, 11: { owner: "Calvin" } };
const logged = reads().map(({ issue, via, team, t }) => ({ issue, via, team, t }));
// Hand count of what the handler cases above logged for W5: app5 x2, direct x1, push3 x1, push4 x1.
const [s5, s4] = summarize(logged.concat([{ issue: "2026/week-4", via: "push", team: 11, t: 5 }]), [
  { path: W5 + "/", week: 5, type: "preview", teams: TEAMS },
  { path: "2026/week-4/", week: 4, type: "recap", teams: TEAMS },
]);
ok(s5.total === 5 && s5.untagged === 1, "Week 5: 5 reads, 1 untagged", JSON.stringify(s5));
ok(JSON.stringify(s5.readers.map((r) => [r.owner, r.count, r.via.join("+")])) === JSON.stringify([["Sandy", 2, "app"], ["Joe", 1, "push"], ["Tom", 1, "push"]]),
  "Week 5 readers: Sandy twice from the app, Joe and Tom from the push", JSON.stringify(s5.readers));
ok(JSON.stringify(s5.notYet) === JSON.stringify(["Perry", "Calvin"]), "…and Perry and Calvin not seen", JSON.stringify(s5.notYet));
ok(s4.total === 1 && s4.readers.length === 1 && s4.readers[0].owner === "Calvin" && s4.untagged === 0,
  "a read of another issue lands on that issue only", JSON.stringify(s4));
const [empty] = summarize([], [{ path: "2026/week-6-preview/", week: 6, type: "preview", teams: TEAMS }]);
ok(empty.total === 0 && empty.readers.length === 0 && empty.notYet.length === 5, "an issue with no reads is still listed, everyone not seen");
const txt = render([s5]).replace(/\s+/g, " ");
ok(/Week 5 preview \(2026\/week-5-preview\): 5 reads/.test(txt) && /Sandy \(app, 2 times, first Sun, Oct 11, 9:05/.test(txt)
  && /Not seen: Perry, Calvin/.test(txt) && /Untagged \(email link, archive, forwarded\): 1/.test(txt),
  "the text report names owners, channel, count and the first read in Chicago time (14:05Z = 9:05 AM CDT)", txt);

for (const s of servers) s.close();
console.log(`\nrgread: ${pass}/${pass + fail}${fail ? "  FAILED: " + failures.join(" | ") : ""}`);
process.exit(fail ? 1 : 0);
