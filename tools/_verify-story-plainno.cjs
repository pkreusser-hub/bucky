#!/usr/bin/env node
"use strict";
/**
 * Story Time's plain no, on the PAGE (2026-10-09).
 *
 *   node tools/_verify-story-plainno.cjs
 *
 * The server half (the app's own check, the narrator's marker, the AI service's decline, the
 * counters, the Story Log, the daily allowance) is in tools/_verify-story-reminder.mjs. This suite
 * drives the real farmgpt.html in headless Chrome with the function mocked by request
 * interception, and checks what the reader sees and what the story keeps:
 *   - a refused turn is never kept in the story, never shown as a scene, and never repaired;
 *   - the note is on screen (geometry, not attributes) and the previous scene's choices are back;
 *   - the marker line is never drawn, not even for a moment while the reply streams in;
 *   - the reader's day count does not move, and the next ordinary turn works.
 * Nothing here reaches a real service: the CDN, Firebase and every other host are blocked.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8891;
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ FAIL " + name); } };
const section = (t) => console.log("\n=== " + t + " ===");

const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = decodeURIComponent(req.url.split("?")[0]);
      const file = path.join(ROOT, p === "/" ? "index.html" : p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end("not found"); }
      res.setHeader("content-type", MIME[path.extname(file)] || "application/octet-stream");
      res.setHeader("cache-control", "no-store");
      res.end(fs.readFileSync(file));
    });
    srv.listen(PORT, "127.0.0.1", () => resolve(srv));
  });
}

// marked.setOptions runs at page-script top level; an unstubbed CDN takes the page script down.
const CDN_STUB = `
  window.marked = { setOptions(){}, parse:(s)=>String(s) };
  window.DOMPurify = { sanitize:(s)=>String(s) };
  window.katex = {}; window.renderMathInElement = function(){};
`;

async function mockedPage(browser, reply) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e && e.message || e)));
  const sent = [];
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (/cdn\.jsdelivr\.net/.test(url)) return req.respond({ status: 200, contentType: "text/javascript", body: CDN_STUB });
    if (/\/assets\/storytime\/universes\//.test(url)) return req.respond({ status: 404, contentType: "text/plain", body: "none" });
    if (/functions\/farmgpt/.test(url)) {
      let body = {};
      try { body = JSON.parse(req.postData() || "{}"); } catch {}
      sent.push(body);
      const r = reply(body, sent.length) || {};
      return req.respond({ status: 200, contentType: r.json ? "application/json" : "text/plain; charset=utf-8",
        body: r.json ? JSON.stringify(r.json) : String(r.body == null ? "" : r.body) });
    }
    if (/googleapis|firestore|firebase|gstatic/.test(url)) return req.abort();
    if (url.startsWith(BASE)) return req.continue();
    return req.abort();
  });
  // Every text node the story scroll ever holds, recorded as it appears, so "the marker was never
  // drawn" is a statement about the whole run and not about the last frame.
  await page.evaluateOnNewDocument(() => {
    window.__seen = [];
    document.addEventListener("DOMContentLoaded", () => {
      const sc = document.getElementById("storyScroll");
      if (!sc) return;
      new MutationObserver(() => {
        for (const el of sc.querySelectorAll(".chapter")) window.__seen.push(el.textContent);
      }).observe(sc, { childList: true, subtree: true, characterData: true });
    });
  });
  await page.goto(BASE + "/farmgpt.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction("!!window.__STORY__", { timeout: 15000 });
  return { page, sent, errors };
}

const SCENE_OK = "The lamps guttered.\n\n===CHOICES===\n1. Ask about the ferry.\n2. Walk to the water.\n3. Light your lantern.";
const SCENE_NEXT = "The ferry bell rang twice.\n\n===CHOICES===\n1. Board.\n2. Wait.\n3. Turn back.";
const seedStory = `(() => {
  const s = { id: "t1", title: "Marrowmere", created: 1, done: false, chapter: 1, sceneSeq: 1,
    messages: [{ role: "user", content: "A cosy mystery on a foggy harbour." },
               { role: "assistant", content: ${JSON.stringify(SCENE_OK)} }] };
  localStorage.setItem("farmgpt_stories_v1", JSON.stringify([s]));
  localStorage.setItem("choreUser", "Eleanor");
  window.__STORY__.setStory(s);
  window.__STORY__.showView("story");   // setStory only swaps the object; the reading view is shown here
  return true;
})()`;
// RESTAGED 2026-10-09 (same day): one generic message for every refusal, Dad's wording request.
const GENERIC = "Story Time can't write that part because of its content rules. Try a different idea: pick one of the choices or type what should happen next.";
const APP_NO = GENERIC;
// The narrator's own sentence after the marker is for Dad's log; the page shows GENERIC instead.
const MODEL_NO = "===NOT WRITTEN===\nThis asks for a graphic, bloody wound described in detail.";

const settle = (page) => page.waitForFunction("!window.__STORY__.busyNow", { timeout: 20000 }).then(() => new Promise((r) => setTimeout(r, 300)));
const readState = (page) => page.evaluate(() => {
  const S = window.__STORY__, s = S.story;
  const notes = [...document.querySelectorAll("#storyScroll .storyRefusal")];
  const note = notes[notes.length - 1];
  let inkW = 0;
  if (note && note.firstChild) { const r = document.createRange(); r.selectNodeContents(note); inkW = r.getBoundingClientRect().width; }
  const saved = JSON.parse(localStorage.getItem("farmgpt_stories_v1") || "[]")[0];
  return {
    msgs: s.messages.length,
    lastRole: s.messages[s.messages.length - 1].role,
    chapters: document.querySelectorAll("#storyScroll .chapter").length,
    chapterText: [...document.querySelectorAll("#storyScroll .chapter")].map((e) => e.textContent).join("\n"),
    notes: notes.length,
    noteText: note ? note.textContent : "",
    noteShown: !!note && note.offsetParent !== null && note.getBoundingClientRect().height > 0,
    noteInk: inkW,
    btns: [...document.querySelectorAll("#choiceBtns .choiceBtn")].map((b) => b.textContent.trim()),
    savedMsgs: saved ? saved.messages.length : -1,
    seen: window.__seen.slice(),
    count: S.storyCountState(),
  };
});

async function sectionAppNo(browser) {
  section("A — the app's own plain no (JSON from the server)");
  const { page, sent, errors } = await mockedPage(browser, (body, n) => {
    if (body.mode !== "story") return { body: "" };
    if (n === 1) return { json: { refused: true, kind: "restraint", message: APP_NO } };
    return { body: SCENE_NEXT };
  });
  await page.evaluate(() => { document.getElementById("cardStory").click(); });   // opens Story Time (its setup view)
  await page.evaluate(seedStory);                                                 // …then the story, in the reading view
  const before = await page.evaluate(() => JSON.stringify(window.__STORY__.storyCountState()));
  const ch0 = await page.evaluate(() => document.querySelectorAll("#storyScroll .chapter").length);
  await page.evaluate(() => window.__STORY__.takeTurn("They chain my wrists to the bottom of the tank", { writeIn: true }));
  await settle(page);
  let st = await readState(page);
  ok(st.msgs === 2 && st.lastRole === "assistant", "the refused turn is not kept: the story is back to its last scene");
  ok(st.savedMsgs === 2, "…and the saved copy agrees");
  ok(st.chapters === ch0 && !/content rules/.test(st.chapterText), "no scene was added, and the answer is not drawn as story text");
  ok(st.notes === 1 && st.noteText === APP_NO, "the note shows the server's message, word for word");
  ok(st.noteShown && st.noteInk > 100, "…and it is on screen: laid out, with ink in it (a Range, not the box)");
  ok(st.btns.length === 3 && st.btns[0].includes("Ask about the ferry"), "the previous scene's three choices are back to tap");
  ok(JSON.stringify(st.count) === before, "the reader's day count did not move");
  ok(sent.filter((b) => b.repair === true).length === 0, "nothing was sent for repair");
  // PLAINNO_SHOT=<file.png> saves what the reader sees, for review (never written into the repo).
  if (process.env.PLAINNO_SHOT) await page.screenshot({ path: process.env.PLAINNO_SHOT });
  await page.evaluate(() => window.__STORY__.takeTurn("Walk to the water."));
  await settle(page);
  st = await readState(page);
  ok(st.msgs === 4 && st.chapters === ch0 + 1 && /ferry bell rang twice/.test(st.chapterText), "the next ordinary turn writes its scene as usual");
  ok(sent.filter((b) => b.mode === "story").length === 2 && sent[1].messages.every((m) => !/chain my wrists/.test(JSON.stringify(m.content))),
    "…and the refused ask is not in what that turn sends");
  ok(errors.length === 0, "no page errors (app's plain no)");
  await page.close();
}

async function sectionModelNo(browser) {
  section("B — the narrator's own plain no (the marker, streamed)");
  const { page, sent, errors } = await mockedPage(browser, (body, n) => {
    if (body.mode !== "story") return { body: "" };
    if (n === 1) return { body: MODEL_NO };
    return { body: SCENE_NEXT };
  });
  await page.evaluate(() => { document.getElementById("cardStory").click(); });   // opens Story Time (its setup view)
  await page.evaluate(seedStory);                                                 // …then the story, in the reading view
  const before = await page.evaluate(() => JSON.stringify(window.__STORY__.storyCountState()));
  const ch0 = await page.evaluate(() => document.querySelectorAll("#storyScroll .chapter").length);
  await page.evaluate(() => window.__STORY__.takeTurn("Describe every wound in the battle", { writeIn: true }));
  await settle(page);
  const st = await readState(page);
  ok(st.msgs === 2 && st.savedMsgs === 2, "the refused turn is not kept in the story, or in the saved copy");
  ok(st.chapters === ch0, "no scene element is left behind");
  ok(!st.seen.some((t) => /NOT WRITTEN|graphic, bloody/.test(t)), "the marker and the answer were never drawn as story text, not even mid-stream");
  ok(st.notes === 1 && st.noteText === GENERIC, "the note shows the one generic message, not the narrator's sentence (that is for Dad's log)");
  ok(st.noteShown, "…on screen");
  ok(sent.filter((b) => b.repair === true).length === 0, "a reply with no choices that is a plain no is NOT sent for repair");
  ok(st.btns.length === 3, "the previous choices are back");
  ok(JSON.stringify(st.count) === before, "the reader's day count did not move");
  ok(errors.length === 0, "no page errors (narrator's plain no)");
  await page.close();

  // A marker with nothing after it still says something to the reader.
  const p2 = await mockedPage(browser, (body) => body.mode === "story" ? { body: "===NOT WRITTEN===\n" } : { body: "" });
  await p2.page.evaluate(() => { document.getElementById("cardStory").click(); });
  await p2.page.evaluate(seedStory);
  await p2.page.evaluate(() => window.__STORY__.takeTurn("2"));
  await settle(p2.page);
  const st2 = await readState(p2.page);
  ok(st2.noteText === GENERIC, "a bare marker gets the same generic message");
  ok(p2.errors.length === 0, "no page errors (bare marker)");
  await p2.page.close();
}

(async () => {
  const srv = await serve();
  const browser = await puppeteer.launch({ channel: "chrome", headless: "new", args: ["--no-sandbox"] });
  try {
    await sectionAppNo(browser);
    await sectionModelNo(browser);
  } catch (err) { fail++; console.log("\n✗ ERROR: " + (err && err.stack || err)); }
  await browser.close();
  srv.close();
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
})();
