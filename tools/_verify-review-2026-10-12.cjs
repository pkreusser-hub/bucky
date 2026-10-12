#!/usr/bin/env node
"use strict";
/**
 * Whole-project review fixes, 2026-10-12 — the ones no existing suite covers.
 *
 *   A. farmgpt.html mdToHtml: money is not math ("$5 and spent $3"), real inline math still is,
 *      a literal "❢N❢" with no stash entry no longer throws (it blanked the research history).
 *   B. games.html lobbyHref: only a plain page name becomes a JOIN link (no javascript: hrefs).
 *   C. books.html coverHtml: a quote in a cover URL can't break out of the src attribute.
 *   D. castlekruzer.html: a hostile #r= room code is shown as text, never run as markup.
 *
 * A-C lift the real function out of the page source by name and run it in node (stubs only for
 * marked / DOMPurify / escapeHtml, which are identity / the page's own escaper), so the check
 * exercises the shipped code, not a copy. D drives the real page in Chrome, Firestore + Playroom
 * blocked.
 */
const fs = require("fs");
const path = require("path");
const net = require("net");
const http = require("http");
const vm = require("vm");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8965;
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const check = (c, m, d) => { if (c) { pass++; console.log("  ok   " + m); } else { fail++; console.log("  FAIL " + m + (d !== undefined ? "  -> " + JSON.stringify(d) : "")); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// Pull `function NAME(...) { ... }` out of a page by brace matching (strings/regex literals in
// these functions don't contain unbalanced braces — checked by the eval succeeding).
function liftFunction(text, name) {
  const at = text.indexOf("function " + name + "(");
  if (at < 0) throw new Error("no function " + name);
  let i = text.indexOf("{", at), depth = 0;
  for (; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(at, i + 1);
  }
  throw new Error("unbalanced " + name);
}

function isOpen(port) {
  return new Promise((res) => { const s = net.createConnection({ port, host: "127.0.0.1" });
    s.once("connect", () => { s.destroy(); res(true); }); s.once("error", () => res(false)); s.setTimeout(800, () => { s.destroy(); res(false); }); });
}
async function waitServer(port, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await isOpen(port)) { try { await new Promise((r, j) => http.get({ host: "127.0.0.1", port, path: "/", timeout: 1000 }, (x) => { x.resume(); r(); }).on("error", j)); return; } catch (_) {} }
    await sleep(200);
  }
  throw new Error("server timeout");
}

(async () => {
  // ---------------- A. FarmGPT mdToHtml ----------------
  console.log("A. farmgpt.html mdToHtml");
  {
    const page = src("farmgpt.html");
    const ctx = { marked: { parse: (t) => t }, DOMPurify: { sanitize: (h) => h } };
    vm.createContext(ctx);
    vm.runInContext(liftFunction(page, "escapeHtml") + "\n" + liftFunction(page, "mdToHtml") + "\nthis.md = mdToHtml;", ctx);
    const md = ctx.md;
    // KaTeX auto-render pairs "$" delimiters within ONE text node. Model that: split the output on
    // tags and look for a text node holding two "$" — that is a formula KaTeX would typeset.
    const pairsInOneNode = (html) => html.split(/<[^>]+>/).some((t) => (t.match(/\$/g) || []).length >= 2);
    const money = md("She had $5 and spent $3 on seeds.");
    check(!pairsInOneNode(money), "money: no text node pairs two $ (KaTeX can't italicise \"5 and spent \")", money);
    check(/<span class="cur">\$<\/span>5/.test(money) && /<span class="cur">\$<\/span>3/.test(money), "money: each currency $ is isolated in its own span", money);
    const math = md("Solve $x+1=3$ for x.");
    check(/\$x\+1=3\$/.test(math) && !/class="cur"/.test(math), "real inline math $x+1=3$ is kept whole for KaTeX", math);
    const disp = md("$$a^2+b^2=c^2$$");
    check(disp.includes("$$a^2+b^2=c^2$$"), "display math survives", disp);
    let threw = null, lit = "";
    try { lit = md("the token ❢7❢ appears in text"); } catch (e) { threw = String(e); }
    check(!threw && lit.includes("❢7❢"), "a literal ❢7❢ with no stash entry stays text instead of throwing", threw || lit);
  }

  // ---------------- B. games.html lobbyHref ----------------
  console.log("B. games.html lobbyHref");
  {
    const ctx = { LOBBY_TEXT: {} };
    vm.createContext(ctx);
    vm.runInContext(liftFunction(src("games.html"), "lobbyHref") + "\nthis.lh = lobbyHref;", ctx);
    check(ctx.lh({ game: "barnyardbistro", roomCode: "AB12" }) === "barnyardbistro.html#r=AB12", "a real game id still links to its page");
    check(ctx.lh({ game: "javascript:alert(1)//", roomCode: "x" }) === null, "a javascript: game field never becomes a link");
    check(ctx.lh({ game: "../../evil", roomCode: "x" }) === null, "a path-like game field never becomes a link");
    check(ctx.lh({ roomCode: "x" }) === null, "a stub doc with no game (heartbeat after delete) is skipped, not undefined.html");
  }

  // ---------------- C. books.html coverHtml ----------------
  console.log("C. books.html coverHtml");
  {
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(liftFunction(src("books.html"), "coverHtml") + "\nthis.ch = coverHtml;", ctx);
    const out = ctx.ch({ cover: 'https://x/y.jpg" onerror="alert(1)' });
    // whole quoted attributes, in order: an escaped quote stays INSIDE src's value
    const attrs = [...out.matchAll(/\s([a-z-]+)="[^"]*"/g)].map((m) => m[1]);
    check(JSON.stringify(attrs) === JSON.stringify(["src", "alt"]), "a quote in a cover URL can't add attributes (only src + alt)", out);
    check(ctx.ch({ cover: "https://covers.openlibrary.org/b/id/1-M.jpg?a=1&b=2" }) === '<img src="https://covers.openlibrary.org/b/id/1-M.jpg?a=1&amp;b=2" alt="">', "a normal cover URL renders intact, its & escaped for the attribute");
  }

  // ---------------- D. Castle Kruzer hostile #r= ----------------
  console.log("D. castlekruzer.html hostile room code");
  let server = null;
  if (!(await isOpen(PORT))) server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1", "-s"], { cwd: ROOT, stdio: "ignore", shell: true, detached: true });
  await waitServer(PORT, 20000);
  const browser = await puppeteer.launch({ channel: "chrome", headless: "new", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (r) => (/playroom|googleapis|firestore|firebase|gstatic/i.test(r.url()) ? r.abort() : r.continue()));
    const payload = encodeURIComponent('<img src=x onerror="window.__pwn=1">');
    await page.goto(BASE + "/castlekruzer.html#r=" + payload, { waitUntil: "load", timeout: 60000 });
    await sleep(2500);
    const r = await page.evaluate(() => {
      const n = document.getElementById("netNote");
      return { pwn: window.__pwn === 1, imgs: n ? n.querySelectorAll("img").length : -1, text: n ? n.textContent : null };
    });
    check(!r.pwn && r.imgs === 0, "the #r= payload never runs and adds no element to the note", r);
    // The note may already have moved on (join attempt fails offline); if it still shows the
    // joining line, the code must be there as literal text.
    check(r.text === null || !/Joining/.test(r.text) || r.text.includes("<img"), "…when the joining line is up, the code shows as literal text", r.text);
  } finally {
    await browser.close();
    if (server) { try { process.kill(-server.pid, "SIGTERM"); } catch (e) {} }
  }

  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
