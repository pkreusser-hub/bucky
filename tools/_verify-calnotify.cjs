#!/usr/bin/env node
"use strict";
/**
 * BUCKY Calendar "Notify" suite — the Plan-area event sheet's notify-family-members feature.
 *
 *   node tools/_verify-calnotify.cjs [--shots]
 *
 * Drives the REAL page in Chrome at 390x844 (+ a small desktop pass), with:
 *   - the calendar Netlify function ROUTE-MOCKED (an in-memory fake Google-Calendar-shaped
 *     store, since this suite never touches netlify/functions/* or the real Google API),
 *   - the EmailJS dynamic import (`https://esm.sh/@emailjs/browser@4`) replaced by a stub
 *     module that records every send() call on window.__EMAILS__ (and can be told to throw
 *     for one recipient, to prove a bad send never blocks the others),
 *   - `/push-client.js` replaced by a stub that records every BuckyPush.notify() call on
 *     window.__PUSHES__.
 *
 * FIREBASE IS BLOCKED THROUGHOUT (googleapis / firestore / firebase / gstatic). Not optional
 * hygiene: an unblocked headless run against index.html has twice duplicated the live family
 * herd, and blocking Firebase is also what forces the app onto its local backend — which is
 * exactly what this suite wants (deterministic, per-context, no network).
 *
 * Section G is the one that actually catches a cross-device regression: since Firestore stays
 * blocked, it can't drive a real shared connection, so it uses window.__NOTIFY__ (a small
 * production test hook — see index.html) to fake the "cloud connected" branch on TWO separate
 * `browser.createBrowserContext()` pages (their own localStorage, standing in for two separate
 * phones) and hand a doc captured off one device to the other through the exact same
 * applyInviteDocs() code a live onSnapshot listener runs. Sections A-F, by contrast, all run a
 * single shared context and only ever exercise the LOCAL-INBOX FALLBACK path (what
 * writeCloudNotif() does when notifsCol/notifsFs aren't connected) — that fallback is real and
 * worth covering, but it was never the cross-device mechanism, and passing there previously hid
 * the fact that the cloud path didn't exist yet.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const WANT_SHOTS = process.argv.includes("--shots");
const PORT = 8917;
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const failures = [];
const ok = (cond, name) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; failures.push(name); console.log("  ✗ FAIL " + name); }
};
const section = (t) => console.log("\n=== " + t + " ===");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================ the family roster ============================ */
// Seeded directly into the local backend's buckyData1 array (frequency:"profile" docs —
// same shape saveFamilyMember() writes). Grandma has NO email on file, on purpose: she is
// what proves the "in-app only" note and the email-skip-without-erroring behavior.
const ROSTER = [
  { id: "prof_mom",     frequency: "profile", name: "Mom",     email: "mom@example.com",     order: 1 },
  { id: "prof_isaac",   frequency: "profile", name: "Isaac",   email: "isaac@example.com",   order: 2 },
  { id: "prof_eleanor", frequency: "profile", name: "Eleanor", email: "eleanor@example.com", order: 3 },
  { id: "prof_grandma", frequency: "profile", name: "Grandma", email: "",                    order: 4 },
];

/* ====================== mocked calendar Netlify function ==================== */
// Shaped like the real netlify/functions/calendar.mjs (never touched or imported here): a
// create/update always echoes back {id,title,start,end,allDay,notes,seriesId}; list returns
// everything (this suite doesn't exercise the month/week/day time-range filtering, only the
// event sheet + its notifications), matching the real function's documented response shape.
function makeCalMock(){
  const state = { seq: 0, store: [], statusCalls: 0, listCalls: 0, createCalls: 0, updateCalls: 0 };
  state.handle = (bodyRaw) => {
    let b = null; try { b = JSON.parse(bodyRaw || "{}"); } catch {}
    const action = b && b.action;
    if (action === "status"){
      state.statusCalls++;
      return { configured: true, saEmail: "test-sa@example.com", hasServiceAccount: true, hasCalendarId: true };
    }
    if (action === "list"){
      state.listCalls++;
      return { events: state.store.slice() };
    }
    if (action === "get"){
      const id = b.event && b.event.id;
      const found = state.store.find((e) => e.id === id);
      return found ? { event: found } : { error: "not-found" };
    }
    if (action === "create"){
      state.createCalls++;
      const ev = b.event || {};
      const allDay = !!ev.allDay;
      const rec = {
        id: "mock" + (++state.seq),
        title: ev.title || "",
        start: allDay ? (ev.startDate || "") : (ev.start || ""),
        end: allDay ? (ev.endDate || ev.startDate || "") : (ev.end || ""),
        allDay,
        notes: ev.notes || "",
        seriesId: null,   // a fresh create is always the series MASTER — never has its own seriesId
      };
      state.store.push(rec);
      return { event: rec };
    }
    if (action === "update"){
      state.updateCalls++;
      const ev = b.event || {};
      const found = state.store.find((e) => e.id === ev.id);
      if (!found) return { error: "Missing event id" };
      const allDay = !!ev.allDay;
      found.title = ev.title || "";
      found.start = allDay ? (ev.startDate || found.start) : (ev.start || "");
      found.end = allDay ? (ev.endDate || found.end) : (ev.end || "");
      found.allDay = allDay;
      found.notes = ev.notes || "";
      return { event: found };
    }
    if (action === "delete"){
      const id = b.event && b.event.id;
      state.store = state.store.filter((e) => e.id !== id);
      return { ok: true };
    }
    return { error: "bad action" };
  };
  return state;
}

/* ============================ stub modules =============================== */
// send() reads window.__EMAIL_FAIL_FOR__ LIVE (at call time, not at module-load time) so a
// test can arm/disarm the failure between saves without re-importing anything — the browser
// module cache means only the FIRST sendEmail() call in a page ever actually hits this
// network stub; every later call resolves the cached module instantly.
const EMAILJS_STUB = `
window.__EMAILS__ = window.__EMAILS__ || [];
async function send(serviceId, templateId, params, opts){
  const failName = window.__EMAIL_FAIL_FOR__;
  if (failName && params && (params.to_email === failName || params.to_name === failName)) {
    throw new Error("stub failure for " + failName);
  }
  window.__EMAILS__.push({ serviceId, templateId, params, opts, at: Date.now() });
  return { status: 200, text: "OK" };
}
export default { send };
export { send };
`;

const PUSH_STUB = `
window.__PUSHES__ = window.__PUSHES__ || [];
window.BuckyPush = {
  isSupported: function(){ return true; },
  status: function(){ return { supported:true, permission:"granted", enabled:false, user:null, familyKey:null }; },
  enable: function(){ return Promise.resolve({}); },
  disable: function(){ return Promise.resolve(true); },
  notify: function(secret, familyKey, targetUser, title, body, url){
    window.__PUSHES__.push({ secret, familyKey, targetUser, title, body, url, at: Date.now() });
    return Promise.resolve({ ok:true });
  }
};
`;

/* ============================ static server ================================ */
const MIME = { ".html":"text/html", ".js":"text/javascript", ".mjs":"text/javascript",
  ".json":"application/json", ".css":"text/css", ".png":"image/png", ".jpg":"image/jpeg",
  ".webp":"image/webp", ".svg":"image/svg+xml", ".txt":"text/plain",
  ".webmanifest":"application/manifest+json" };
function serve(){
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p === "/") p = "/index.html";
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
        res.statusCode = 404; return res.end("not found");
      }
      res.setHeader("content-type", MIME[path.extname(file)] || "application/octet-stream");
      res.setHeader("cache-control", "no-store");
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(PORT, "127.0.0.1", () => resolve(srv));
  });
}

/* ============================ browser plumbing ============================= */
const contexts = [];
const NOISE = /Failed to load resource|dynamically imported module|gstatic|firebase|ERR_FAILED|ERR_BLOCKED/i;

async function newPage(browser, calMock, { user = "Mom", viewport = { width: 390, height: 844, deviceScaleFactor: 1 } } = {}){
  const ctx = browser.createBrowserContext
    ? await browser.createBrowserContext()
    : await browser.createIncognitoBrowserContext();
  contexts.push(ctx);
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  const errors = [];
  page.on("pageerror", (e) => { if (!NOISE.test(String(e))) errors.push(String(e)); });
  page.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) errors.push("console: " + m.text()); });

  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const url = r.url();
    if (/googleapis|firestore|firebase|gstatic/i.test(url)) return r.abort();
    if (/esm\.sh\/@emailjs\/browser/i.test(url)){
      // A dynamic import() of a cross-origin module is CORS-checked like any other module
      // fetch — without an explicit allow-origin header Chrome blocks it before it ever
      // reaches sendEmail()'s own try/catch, which would look like "email silently no-ops".
      return r.respond({ status: 200, contentType: "text/javascript",
        headers: { "access-control-allow-origin": "*" }, body: EMAILJS_STUB });
    }
    if (/\/push-client\.js(\?|$)/.test(url)){
      return r.respond({ status: 200, contentType: "text/javascript", body: PUSH_STUB });
    }
    if (url.includes("/.netlify/functions/calendar")){
      const res = calMock.handle(r.postData());
      return r.respond({ status: 200, contentType: "application/json", body: JSON.stringify(res) });
    }
    if (url.includes("/.netlify/functions/")){
      return r.respond({ status: 200, contentType: "application/json", body: "{}" });
    }
    if (/^https?:\/\/(?!127\.0\.0\.1)/.test(url)) return r.abort();   // no real network, ever
    r.continue();
  });

  await page.evaluateOnNewDocument((u) => {
    localStorage.setItem("choreUnlocked", "amenfarms");
    // evaluateOnNewDocument re-runs on EVERY navigation in this page/context (including a
    // mid-test reload), so an unconditional setItem would stomp a profile switch (Section F
    // switches to Isaac then reloads) right back to the original user. Only seed it when
    // nothing is already there — i.e. this context's first navigation.
    if (u){ if (!localStorage.getItem("choreUser")) localStorage.setItem("choreUser", u); }
    else localStorage.removeItem("choreUser");
    window.prompt = () => null;
    window.alert = () => {};
    window.confirm = () => true;
  }, user);

  return { page, errors };
}

/** Seed the family roster into the local backend, then load the app. */
async function boot(page, { profiles } = {}){
  await page.goto(BASE + "/index.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate((list) => {
    if (list) localStorage.setItem("buckyData1", JSON.stringify(list));
  }, profiles || null);
  await page.goto(BASE + "/index.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__NAV__ && window.__CAL__, { timeout: 20000 });
  await sleep(700);
}

async function settle(page, ms){ await sleep(ms || 500); }

async function gotoCalendar(page){
  await page.evaluate(() => { window.__NAV__.goTo("calendar"); });
  await page.waitForFunction(() => document.getElementById("calOverlay") !== null, { timeout: 10000 });
}

function setInputValue(page, sel, val){
  return page.evaluate((s, v) => {
    const el = document.querySelector(s);
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, sel, val);
}
// Order matters: start before end, so the end field's own "change" listener (calEndTouched =
// true) fires AFTER start's calFollowStart — otherwise an explicit end value could be
// silently pulled back up to match start.
async function fillEventForm(page, { title, date, start, end, notes } = {}){
  if (title !== undefined) await setInputValue(page, "#calEvTitle", title);
  if (date !== undefined) await setInputValue(page, "#calEvDate", date);
  if (start !== undefined) await setInputValue(page, "#calEvStart", start);
  if (end !== undefined) await setInputValue(page, "#calEvEnd", end);
  if (notes !== undefined) await setInputValue(page, "#calEvNotes", notes);
}
async function tickNotify(page, name){
  await page.click(`#calNotifyList input[data-name="${name}"]`);
}
async function checkedNames(page){
  return page.evaluate(() => [...document.querySelectorAll("#calNotifyList input[type=checkbox]:checked")].map((cb) => cb.dataset.name));
}
async function notifyRows(page){
  return page.evaluate(() => [...document.querySelectorAll("#calNotifyList .cal-notify-row")].map((r) => ({
    name: (r.querySelector("span") || {}).textContent || "",
    checked: !!(r.querySelector("input") || {}).checked,
    note: r.querySelector("small") ? r.querySelector("small").textContent : null,
  })));
}
async function notifiedLine(page){
  return page.evaluate(() => {
    const el = document.getElementById("calNotifiedLine");
    return { visible: el.style.display !== "none", text: el.textContent };
  });
}
// Raw per-person inbox — read straight off localStorage rather than through the app's own
// (module-scoped, so unreachable from page.evaluate) loadNotifInbox(). This is deliberately
// the UNDEDUPED array exactly as addNotif() wrote it: dedupeNotifInbox() only runs when the
// app's own bell renderer reads the inbox, which these count-assertions never trigger.
async function inboxFor(page, name){
  return page.evaluate((n) => {
    try { return JSON.parse(localStorage.getItem("buckyNotifs_" + n) || "[]"); } catch { return []; }
  }, name);
}
function calEntries(inbox){ return inbox.filter((n) => n.type === "cal_event"); }
async function emails(page){ return page.evaluate(() => window.__EMAILS__ || []); }
async function pushes(page){ return page.evaluate(() => window.__PUSHES__ || []); }
async function events(page){ return page.evaluate(() => window.__CAL__.state().events); }
async function openSheetFor(page, ev){
  await page.evaluate((e) => { window.__CAL__.openSheet(e); }, ev);
  await settle(page, 300);
}
async function save(page, ms){
  await page.click("#calSaveBtn");
  await settle(page, ms || 900);
}

/* ============================================================================
   A. The Notify section itself: every roster member, all unchecked, the no-email note,
      and no "Told…" line on a brand-new event.
   ============================================================================ */
async function sectionList(browser){
  section("A. The Notify section — roster, unchecked, no-email note");
  const calMock = makeCalMock();
  const { page, errors } = await newPage(browser, calMock, { user: "Mom" });
  await boot(page, { profiles: ROSTER });
  await gotoCalendar(page);

  ok(await page.evaluate(() => !!document.getElementById("calNotifyList")), "the sheet has a #calNotifyList container");
  ok(await page.evaluate(() => !!document.getElementById("calNotifiedLine")), "…and a #calNotifiedLine record row");

  await page.click("#addFab");
  await settle(page, 300);
  ok(await page.evaluate(() => document.getElementById("calOverlay").classList.contains("open")), "+ opens the event sheet");

  const rows = await notifyRows(page);
  ok(rows.length === 4, `one checkbox row per family member (${rows.length} of 4)`);
  ok(rows.every((r) => !r.checked), "every checkbox starts unchecked");
  const names = rows.map((r) => r.name).sort();
  ok(JSON.stringify(names) === JSON.stringify(["Eleanor", "Grandma", "Isaac", "Mom"]),
    `the rows are exactly the roster, nobody excluded (got: ${names.join(", ")})`);

  const grandma = rows.find((r) => r.name === "Grandma");
  ok(!!grandma && /in-app only/i.test(grandma.note || "") && /no email/i.test(grandma.note || ""),
    `the member with no email on file is labeled ("${grandma && grandma.note}")`);
  for (const withEmail of ["Mom", "Isaac", "Eleanor"]){
    const r = rows.find((x) => x.name === withEmail);
    ok(!!r && !r.note, `${withEmail} (has an email on file) shows no muted note`);
  }

  const line = await notifiedLine(page);
  ok(!line.visible, "a brand-new event shows no 'Told…' line");

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
}

/* ============================================================================
   B. Full lifecycle: nothing ticked -> zero sends; ticked -> exactly the right two people,
      never the creator; reopen -> boxes unchecked again + the Told line; re-save with
      nothing ticked -> the anti-spam property (nothing more goes out).
   ============================================================================ */
async function sectionLifecycle(browser){
  section("B. Create -> notify -> reopen -> anti-spam re-save");
  const calMock = makeCalMock();
  const { page, errors } = await newPage(browser, calMock, { user: "Mom" });
  await boot(page, { profiles: ROSTER });
  await gotoCalendar(page);

  /* -- nobody ticked: the event still saves, nothing goes out -- */
  await page.click("#addFab");
  await settle(page, 300);
  await fillEventForm(page, { title: "Family picnic", date: "2026-08-20", start: "12:00", end: "13:00" });
  ok((await checkedNames(page)).length === 0, "nobody is ticked by default");
  await save(page);

  ok(calMock.createCalls === 1 && calMock.store.length === 1, "the event saved even with nobody ticked");
  for (const who of ["Mom", "Isaac", "Eleanor", "Grandma"]){
    ok(calEntries(await inboxFor(page, who)).length === 0, `${who} got no in-app notification (nobody was ticked)`);
  }
  ok((await pushes(page)).length === 0, "…no pushes went out either");
  ok((await emails(page)).length === 0, "…and no emails went out");

  /* -- Mom + Isaac + Eleanor ticked (Mom is the creator/current session) -- */
  await page.click("#addFab");
  await settle(page, 300);
  await fillEventForm(page, { title: "Vet visit", date: "2026-08-15", start: "10:00", end: "11:00", notes: "Bring the crate" });
  await tickNotify(page, "Mom");
  await tickNotify(page, "Isaac");
  await tickNotify(page, "Eleanor");
  ok((await checkedNames(page)).sort().join(",") === "Eleanor,Isaac,Mom", "three boxes are ticked going into Save");
  await save(page);

  ok(calMock.createCalls === 2 && calMock.store.length === 2, "the second event also saved");
  ok(calMock.store[1].title === "Vet visit", "…with the right title");

  const isaacInbox1 = calEntries(await inboxFor(page, "Isaac"));
  const eleanorInbox1 = calEntries(await inboxFor(page, "Eleanor"));
  const momInbox1 = calEntries(await inboxFor(page, "Mom"));
  ok(isaacInbox1.length === 1, `Isaac got exactly one in-app notification (${isaacInbox1.length})`);
  ok(eleanorInbox1.length === 1, `Eleanor got exactly one in-app notification (${eleanorInbox1.length})`);
  ok(momInbox1.length === 0, "Mom (the creator) got NO in-app notification, even though her own box was ticked");
  ok(/^📅 New event: Vet visit/.test(isaacInbox1[0].text), `the text names the event ("${isaacInbox1[0].text}")`);

  const pushes1 = (await pushes(page)).filter((p) => /Vet visit|New event/.test(p.title + " " + p.body));
  ok(pushes1.length === 2, `exactly two pushes went out (${pushes1.length})`);
  ok(pushes1.some((p) => p.targetUser === "Isaac") && pushes1.some((p) => p.targetUser === "Eleanor"),
    "the pushes targeted Isaac and Eleanor");
  ok(!pushes1.some((p) => p.targetUser === "Mom"), "…and never the creator");

  const emails1 = await emails(page);
  ok(emails1.length === 2, `exactly two emails went out — one per ticked person WITH an email (${emails1.length})`);
  ok(emails1.some((e) => e.params.to_email === "isaac@example.com"), "…one reached Isaac's address");
  ok(emails1.some((e) => e.params.to_email === "eleanor@example.com"), "…one reached Eleanor's address");
  ok(!emails1.some((e) => e.params.to_email === "mom@example.com"), "…and none was ever sent to the creator");
  ok(!!emails1[0] && /📅 New event: Vet visit/.test(emails1[0].params.subject), "the email subject matches the spec's example shape");

  /* -- reopen THAT event: boxes are unchecked again, and the Told line names who knows -- */
  const evs = await events(page);
  const savedEv = evs.find((e) => e.title === "Vet visit");
  ok(!!savedEv, "the created event is fetchable again (list re-ran after save)");
  await openSheetFor(page, savedEv);

  ok((await checkedNames(page)).length === 0, "reopening the event starts every box unchecked again");
  const line1 = await notifiedLine(page);
  ok(line1.visible, "the 'Told…' record line is visible on reopen");
  ok(/^Told /.test(line1.text), `it reads as a record ("${line1.text}")`);
  ok(/Isaac/.test(line1.text) && /Eleanor/.test(line1.text), `it names who was told ("${line1.text}")`);
  ok(!new RegExp("\\bMom\\b").test(line1.text), `…and never claims the creator was told ("${line1.text}")`);

  /* -- save again with nobody ticked: the anti-spam property -- */
  await save(page);
  ok(calMock.updateCalls === 1, "the re-save reached the (mocked) function as an update");
  ok(calEntries(await inboxFor(page, "Isaac")).length === 1, "…but Isaac gets nothing MORE (nobody was ticked this time)");
  ok(calEntries(await inboxFor(page, "Eleanor")).length === 1, "…nor does Eleanor");
  ok((await pushes(page)).filter((p) => /Vet visit|New event|Event updated/.test(p.title + " " + p.body)).length === 2,
    "…no additional pushes");
  ok((await emails(page)).length === 2, "…no additional emails");

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
}

/* ============================================================================
   C. Editing wording ("Event updated") + re-ticking is a deliberate re-notify that
      accumulates in the Told line, rather than a silent no-op.
   ============================================================================ */
async function sectionEditWording(browser){
  section("C. Editing sends 'Event updated', and re-ticking is a deliberate re-notify");
  const calMock = makeCalMock();
  const { page, errors } = await newPage(browser, calMock, { user: "Mom" });
  await boot(page, { profiles: ROSTER });
  await gotoCalendar(page);

  await page.click("#addFab");
  await settle(page, 300);
  await fillEventForm(page, { title: "Piano recital", date: "2026-09-01", start: "18:00", end: "19:00" });
  await save(page);   // nobody ticked at creation — this section is about editing

  let ev = (await events(page)).find((e) => e.title === "Piano recital");
  await openSheetFor(page, ev);
  await tickNotify(page, "Isaac");
  await save(page);

  const isaacInbox = calEntries(await inboxFor(page, "Isaac"));
  ok(isaacInbox.length === 1, "Isaac got one notification from the edit");
  ok(/^📅 Event updated: Piano recital/.test(isaacInbox[0].text),
    `an edit says "Event updated", not "New event" ("${isaacInbox[0].text}")`);
  const pushUpdated = (await pushes(page)).find((p) => p.targetUser === "Isaac");
  ok(!!pushUpdated && pushUpdated.title === "📅 Event updated", `the push title matches ("${pushUpdated && pushUpdated.title}")`);

  /* -- reopen again: unchecked, Told line names Isaac only so far -- */
  ev = (await events(page)).find((e) => e.title === "Piano recital");
  await openSheetFor(page, ev);
  ok((await checkedNames(page)).length === 0, "reopening after the edit still starts unchecked");
  let line = await notifiedLine(page);
  ok(/Isaac/.test(line.text) && !/Eleanor/.test(line.text), `so far only Isaac is recorded ("${line.text}")`);

  /* -- a SECOND edit, ticking someone new: a deliberate re-tick, not a repeat -- */
  await tickNotify(page, "Eleanor");
  await save(page);

  const eleanorInbox = calEntries(await inboxFor(page, "Eleanor"));
  ok(eleanorInbox.length === 1, "Eleanor's re-tick on a later edit really does notify her");
  ok(/^📅 Event updated: Piano recital/.test(eleanorInbox[0].text), "…with the same 'Event updated' wording");
  ok(calEntries(await inboxFor(page, "Isaac")).length === 1, "…and Isaac (not re-ticked this time) gets nothing more");

  ev = (await events(page)).find((e) => e.title === "Piano recital");
  await openSheetFor(page, ev);
  line = await notifiedLine(page);
  ok(/Isaac/.test(line.text) && /Eleanor/.test(line.text), `the Told line now accumulates both names ("${line.text}")`);

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
}

/* ============================================================================
   D. A recurring event notifies ONCE (never per-occurrence) and says its cadence.
   ============================================================================ */
async function sectionRecurring(browser){
  section("D. Recurring events notify once and mention the cadence");
  const calMock = makeCalMock();
  const { page, errors } = await newPage(browser, calMock, { user: "Mom" });
  await boot(page, { profiles: ROSTER });
  await gotoCalendar(page);

  await page.click("#addFab");
  await settle(page, 300);
  await fillEventForm(page, { title: "Trash day", date: "2026-08-18", start: "07:00", end: "07:15" });
  await page.select("#calRepeatSel", "WEEKLY");
  await tickNotify(page, "Isaac");
  await save(page);

  ok(calMock.store.length === 1 && !!calMock.store[0].id, "the recurring event saved");
  const isaacInbox = calEntries(await inboxFor(page, "Isaac"));
  ok(isaacInbox.length === 1, `Isaac was notified exactly ONCE for the whole series, not per-occurrence (${isaacInbox.length})`);
  ok(/Repeats weekly/.test(isaacInbox[0].text), `the notification text says the cadence ("${isaacInbox[0].text}")`);

  const push = (await pushes(page)).find((p) => p.targetUser === "Isaac");
  ok(!!push && /Repeats weekly/.test(push.body), `…the push mentions it too ("${push && push.body}")`);

  const email = (await emails(page)).find((e) => e.params.to_email === "isaac@example.com");
  ok(!!email, "…and the email went out");
  ok(!!email && /Repeats weekly/.test(email.params.details_block || ""), "…with the cadence in its details block");

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
}

/* ============================================================================
   E. A throwing email must never block the save, the other channels, or the other
      recipient's email.
   ============================================================================ */
async function sectionEmailFailure(browser){
  section("E. One bad email cannot stop the others, or the save");
  const calMock = makeCalMock();
  const { page, errors } = await newPage(browser, calMock, { user: "Mom" });
  await boot(page, { profiles: ROSTER });
  await gotoCalendar(page);

  await page.click("#addFab");
  await settle(page, 300);
  await fillEventForm(page, { title: "Dentist", date: "2026-08-22", start: "09:00", end: "09:30" });
  await tickNotify(page, "Isaac");
  await tickNotify(page, "Eleanor");
  await page.evaluate(() => { window.__EMAIL_FAIL_FOR__ = "isaac@example.com"; });
  await save(page);

  ok(calMock.store.length === 1 && calMock.store[0].title === "Dentist",
    "the event still exists — a downstream email failure never touches the save");

  const emailsAfter = await emails(page);
  ok(emailsAfter.some((e) => e.params.to_email === "eleanor@example.com"),
    "Eleanor's email still went out even though Isaac's threw");
  ok(!emailsAfter.some((e) => e.params.to_email === "isaac@example.com"),
    "…and Isaac's failed send left no successful record (the stub throws before recording)");

  // The failure is scoped to the EMAIL channel only — Isaac's in-app notif and push, which
  // fire synchronously before the async email loop even starts, are untouched.
  ok(calEntries(await inboxFor(page, "Isaac")).length === 1, "Isaac still got his in-app notification");
  ok(calEntries(await inboxFor(page, "Eleanor")).length === 1, "…and so did Eleanor");
  const pushesAfter = await pushes(page);
  ok(pushesAfter.some((p) => p.targetUser === "Isaac"), "Isaac still got pushed");
  ok(pushesAfter.some((p) => p.targetUser === "Eleanor"), "…and so did Eleanor");

  // sendEmail() itself console.error()s a failed send (its own existing, unmodified try/catch
  // logging) — that is exactly what THIS section deliberately triggered, not a bug. Everything
  // else must still be silent.
  const unexpected = errors.filter((e) => !/Email alert failed/.test(e));
  ok(unexpected.length === 0, "no page errors besides the deliberately-triggered email failure" + (unexpected.length ? ": " + unexpected[0] : ""));
}

/* ============================================================================
   F. The notified person's OWN bell, exercising the LOCAL-INBOX FALLBACK path only: same
      browser context/localStorage as the creator (identity switched in place, storage never
      cleared). writeCloudNotif() falls back to this exact path whenever notifsCol/notifsFs
      aren't connected (the local backend, or before a cloud listener attaches) — this section
      proves that fallback still works. It does NOT exercise (and never did) the cross-device
      cloud path — see section G for that, which is the actual fix this suite exists to catch.
   ============================================================================ */
async function sectionBell(browser){
  section("F. The notified person sees it in their own bell and it deep-links to Calendar");
  const calMock = makeCalMock();
  const { page, errors } = await newPage(browser, calMock, { user: "Mom" });
  await boot(page, { profiles: ROSTER });
  await gotoCalendar(page);

  await page.click("#addFab");
  await settle(page, 300);
  await fillEventForm(page, { title: "Feed check", date: "2026-08-16", start: "16:00", end: "16:30" });
  await tickNotify(page, "Isaac");
  await save(page);

  // Switch identity WITHOUT clearing storage — this is the same device/context Mom just
  // used, so Isaac's freshly-written buckyNotifs_Isaac entry is still there to read.
  await page.evaluate(() => { localStorage.setItem("choreUser", "Isaac"); });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__NAV__, { timeout: 20000 });
  await settle(page, 600);

  await page.click("#bellBtn");
  await settle(page, 300);
  ok(await page.evaluate(() => document.getElementById("notifOverlay").classList.contains("open")), "the bell panel opens");

  const row = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("#notifList .notif-row")];
    const hit = rows.find((el) => /Feed check/.test(el.textContent));
    return hit ? hit.textContent : null;
  });
  ok(!!row, "Isaac's bell shows the event notification");
  ok(!!row && /New event/.test(row), `…with the right wording ("${row}")`);

  await page.evaluate(() => {
    const rows = [...document.querySelectorAll("#notifList .notif-row")];
    const hit = rows.find((el) => /Feed check/.test(el.textContent));
    if (hit) hit.click();
  });
  await settle(page, 300);
  ok(await page.evaluate(() => window.__NAV__.tab() === "calendar"), "tapping the notification deep-links into the Calendar tab");
  ok(await page.evaluate(() => !document.getElementById("notifOverlay").classList.contains("open")), "…and the bell panel closes");

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
}

/* ============================================================================
   G. CROSS-DEVICE DELIVERY — the notification travels through the notifs_<familyKey> CLOUD
      collection, not local storage. This is the section that actually catches the bug: two
      genuinely separate browser contexts (their own localStorage, standing in for two separate
      phones) with Firestore itself still blocked (per the house rule) — window.__NOTIFY__ fakes
      the cloud CONNECTION just far enough to prove writeCloudNotif() takes the cloud branch, and
      that a doc captured off one device reproduces correctly on another through the SAME
      applyInviteDocs() code a live onSnapshot listener runs. Also covers the render-branch
      restructuring: cal_event/bank_credit/lobby-invite/unknown all render distinctly, and the
      JOIN button is opt-in (lobby-invite only) rather than a catch-all default.
   ============================================================================ */
async function sectionCrossDevice(browser){
  section("G. Cross-device delivery via the notifs_<familyKey> cloud collection");
  const calMock = makeCalMock();

  /* ---- Device A ("Mom"'s phone): creates the event, ticks Isaac, saves. ---- */
  const a = await newPage(browser, calMock, { user: "Mom" });
  await boot(a.page, { profiles: ROSTER });
  await a.page.evaluate(() => window.__NOTIFY__.fakeCloudConnect());
  await gotoCalendar(a.page);
  await a.page.click("#addFab");
  await settle(a.page, 300);
  await fillEventForm(a.page, { title: "Cross-device check", date: "2026-08-19", start: "08:00", end: "08:30" });
  await tickNotify(a.page, "Isaac");
  await save(a.page);

  const writesA = await a.page.evaluate(() => window.__NOTIFY__.cloudWrites());
  const calWrite = writesA.find((w) => w.type === "cal_event");
  ok(!!calWrite, "device A's writeCloudNotif call landed in the (faked) cloud collection");
  ok(!!calWrite && calWrite.to === "Isaac", `…addressed to Isaac (got "${calWrite && calWrite.to}")`);
  ok(!!calWrite && /^cal_/.test(calWrite.id), `…with a "cal_"-prefixed doc id (got "${calWrite && calWrite.id}")`);
  ok(!!calWrite && /Cross-device check/.test(calWrite.text), "…the text names the event");
  ok(!!calWrite && calWrite.url === "index.html#calendar", `…and carries the calendar deep-link url (got "${calWrite && calWrite.url}")`);

  // The actual bug, proven fixed: once the cloud branch is taken, device A must NEVER fall back
  // to writing under Isaac's key in ITS OWN localStorage. That was the original defect exactly —
  // the SENDER's device held a notification addressed to someone else, and the someone else's
  // own phone never got anything.
  ok(calEntries(await inboxFor(a.page, "Isaac")).length === 0,
    "device A's own localStorage got NO cal_event entry for Isaac — the write went to the cloud only, not local storage");

  /* ---- Device B ("Isaac"'s own phone): a FRESH, separate browser context. Nothing shared
     with device A — that separation is exactly what a real second device would give us. ---- */
  const b = await newPage(browser, calMock, { user: "Isaac" });
  await boot(b.page, { profiles: ROSTER });
  ok(calEntries(await inboxFor(b.page, "Isaac")).length === 0,
    "device B (Isaac's own device) starts with nothing for Isaac — a genuinely fresh context");

  await b.page.evaluate(() => window.__NOTIFY__.fakeCloudConnect());
  // Hand device A's captured cloud write to device B — the ONE thing a real Firestore
  // onSnapshot would have done; everything downstream (applyInviteDocs -> renderBell ->
  // renderNotifList) is the exact production code path, unmodified for this test.
  await b.page.evaluate((docs) => window.__NOTIFY__.deliverCloudDocs(docs), writesA);

  await b.page.click("#bellBtn");
  await settle(b.page, 300);
  ok(await b.page.evaluate(() => document.getElementById("notifOverlay").classList.contains("open")), "device B's bell panel opens");

  const rowInfo = (label) => b.page.evaluate((needle) => {
    const rows = [...document.querySelectorAll("#notifList .notif-row")];
    const hit = rows.find((el) => el.textContent.includes(needle));
    return hit ? { text: hit.textContent, cls: hit.className, hasJoin: !!hit.querySelector(".invite-join") } : null;
  }, label);

  let ri = await rowInfo("Cross-device check");
  ok(!!ri, "device B's bell shows the calendar notification — delivered via the cloud, never via localStorage");
  ok(!!ri && /New event/.test(ri.text), `…with the right wording (got "${ri && ri.text}")`);
  ok(!!ri && !ri.hasJoin, "…rendered as a plain row — NO 'JOIN THE KITCHEN' button on a calendar notification");
  ok(!!ri && !/\binvite\b/.test(ri.cls), `…and not styled as an invite row (class "${ri && ri.cls}")`);

  await b.page.evaluate(() => {
    const rows = [...document.querySelectorAll("#notifList .notif-row")];
    const hit = rows.find((el) => el.textContent.includes("Cross-device check"));
    if (hit) hit.click();
  });
  await settle(b.page, 300);
  ok(await b.page.evaluate(() => window.__NAV__.tab() === "calendar"), "tapping it on device B deep-links into the Calendar tab");
  ok(await b.page.evaluate(() => !document.getElementById("notifOverlay").classList.contains("open")), "…and the bell panel closes");

  /* ---- An unrecognized future type never inherits the kitchen button (the JOIN branch is
     opt-in, not a catch-all default). ---- */
  await b.page.evaluate(() => window.__NOTIFY__.deliverCloudDocs([
    { id: "mystery1", to: "Isaac", from: "BUCKY", type: "something_new_later",
      text: "A future notification type nobody wrote a branch for yet", url: "", at: Date.now(), read: false },
  ]));
  await b.page.click("#bellBtn");
  await settle(b.page, 300);
  const mi = await rowInfo("future notification type");
  ok(!!mi, "an unrecognized notification type still renders (never silently dropped)");
  ok(!!mi && !mi.hasJoin, "…but never with a JOIN THE KITCHEN button");
  ok(!!mi && !/\binvite\b/.test(mi.cls), `…and not styled as an invite (class "${mi && mi.cls}")`);

  /* ---- bank_credit rendering is UNCHANGED by the restructuring: still a plain row that
     routes to Farm Bank. ---- */
  await b.page.evaluate(() => window.__NOTIFY__.deliverCloudDocs([
    { id: "bank_test1", to: "Isaac", from: "BUCKY", type: "bank_credit",
      text: "💰 $5.00 added to your bank!", url: "index.html#farmbank", at: Date.now(), read: false },
  ]));
  await b.page.click("#bellBtn");
  await settle(b.page, 300);
  const bi = await rowInfo("added to your bank");
  ok(!!bi, "a bank_credit cloud doc still renders");
  ok(!!bi && !bi.hasJoin, "…as a plain row, no JOIN button (unchanged)");
  ok(!!bi && !/\binvite\b/.test(bi.cls), "…not styled as an invite (unchanged)");
  await b.page.evaluate(() => {
    const rows = [...document.querySelectorAll("#notifList .notif-row")];
    const hit = rows.find((el) => el.textContent.includes("added to your bank"));
    if (hit) hit.click();
  });
  await settle(b.page, 300);
  ok(await b.page.evaluate(() => window.__NAV__.tab() === "farmbank"), "…and tapping it still routes to Farm Bank (unchanged)");

  /* ---- A genuine lobby-invite doc must STILL render its JOIN button and still work. This is
     LAST on device B because clicking JOIN navigates away for real. ---- */
  await b.page.evaluate((url) => window.__NOTIFY__.deliverCloudDocs([
    { id: "inv_test1", to: "Isaac", from: "Mom", type: "lobby-invite",
      text: "Mom wants to cook with you in Barnyard Bistro! 🍅", url, at: Date.now(), read: false },
  ]), "games.html?probe=xdevice");
  await b.page.click("#bellBtn");
  await settle(b.page, 300);
  const ii = await rowInfo("cook with you");
  ok(!!ii, "a genuine lobby-invite doc still shows up in the bell");
  ok(!!ii && /\binvite\b/.test(ii.cls), `…styled as an invite row (class "${ii && ii.cls}")`);
  const joinText = await b.page.evaluate(() => {
    const rows = [...document.querySelectorAll("#notifList .notif-row")];
    const hit = rows.find((el) => el.textContent.includes("cook with you"));
    const join = hit ? hit.querySelector(".invite-join") : null;
    return join ? join.textContent : null;
  });
  ok(joinText === "JOIN THE KITCHEN 🍳", `…with its JOIN button intact (got "${joinText}")`);

  await b.page.evaluate(() => {
    const rows = [...document.querySelectorAll("#notifList .notif-row")];
    const hit = rows.find((el) => el.textContent.includes("cook with you"));
    const join = hit ? hit.querySelector(".invite-join") : null;
    if (join) join.click();
  });
  await b.page.waitForFunction(() => location.href.includes("games.html"), { timeout: 8000 }).catch(() => {});
  ok(b.page.url().includes("games.html"), `…and tapping JOIN really navigates (landed on "${b.page.url()}")`);

  /* ---- The bank_credit doc-id PREFIX is unchanged by the writeCloudNotif refactor: still
     exactly "bank_" + idSlug(dedupeId), never "bank_credit_...". ---- */
  await a.page.evaluate(() => { window.__BANK__.notifyCredit("Isaac", 5, "test", "xdevice-check"); });
  await settle(a.page, 200);
  const bankWrites = await a.page.evaluate(() => window.__NOTIFY__.cloudWrites().filter((w) => w.type === "bank_credit"));
  ok(bankWrites.length === 1, `exactly one bank_credit cloud write from device A (${bankWrites.length})`);
  ok(!!bankWrites[0] && bankWrites[0].id === "bank_xdevice-check",
    `…and its id format is UNCHANGED — "bank_" + idSlug(dedupeId), not "bank_credit_..." (got "${bankWrites[0] && bankWrites[0].id}")`);

  ok(a.errors.length === 0, "device A: no page errors" + (a.errors.length ? ": " + a.errors[0] : ""));
  // device B intentionally ends this section on games.html (see the JOIN-navigation check just
  // above), so its `errors` array only reflects index.html activity up to that navigation.
  ok(b.errors.length === 0, "device B: no page errors before navigating away" + (b.errors.length ? ": " + b.errors[0] : ""));
}

/* ============================================================================
   H. Layout: the Notify section fits a 390x844 phone with no horizontal scroll, and the
      sheet is generally usable there.
   ============================================================================ */
async function sectionLayout(browser){
  section("H. Layout at 390x844 (+ a quick desktop pass)");
  const calMock = makeCalMock();
  const { page, errors } = await newPage(browser, calMock, { user: "Mom" });
  await boot(page, { profiles: ROSTER });
  await gotoCalendar(page);

  await page.click("#addFab");
  await settle(page, 300);
  await fillEventForm(page, {
    title: "Sunday family dinner",
    date: "2026-08-23", start: "17:00", end: "19:00",
    notes: "Grandma's coming — pick up the cake on the way.",
  });

  const geo = await page.evaluate(() => ({
    docScrollW: document.documentElement.scrollWidth,
    bodyScrollW: document.body.scrollWidth,
    innerW: window.innerWidth,
    sheetRight: document.querySelector(".sheet").getBoundingClientRect().right,
  }));
  ok(geo.docScrollW <= geo.innerW + 1, `no horizontal document scroll at 390px (${geo.docScrollW} <= ${geo.innerW})`);
  ok(geo.bodyScrollW <= geo.innerW + 1, `…and no horizontal body scroll (${geo.bodyScrollW} <= ${geo.innerW})`);
  ok(geo.sheetRight <= geo.innerW + 1, `the sheet itself stays inside the viewport (${geo.sheetRight} <= ${geo.innerW})`);

  const rowsFit = await page.evaluate(() => {
    const innerW = window.innerWidth;
    return [...document.querySelectorAll("#calNotifyList .cal-notify-row, #calNotifiedLine")]
      .every((el) => el.getBoundingClientRect().right <= innerW + 1);
  });
  ok(rowsFit, "every Notify row (and the Told line) stays inside the viewport width");

  // Exercise the record line too, so the shot shows the feature end-to-end, not just an
  // empty first-open state.
  await tickNotify(page, "Isaac");
  await save(page);
  // Let the "Adding event…"/"Event added ✅" toasts (4s auto-dismiss) clear before reopening,
  // so the review screenshot shows the sheet, not a toast stack overlapping the title field.
  await page.waitForFunction(() => document.getElementById("toastWrap").children.length === 0, { timeout: 6000 }).catch(() => {});
  const ev = (await events(page)).find((e) => e.title === "Sunday family dinner");
  await openSheetFor(page, ev);

  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, "cal_notify.png") });
  console.log("  (screenshot: shots/cal_notify.png)");

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));

  /* -- a quick desktop pass, mostly to confirm nothing about the section is phone-only -- */
  const desk = await newPage(browser, calMock, { user: "Mom", viewport: { width: 1280, height: 900, deviceScaleFactor: 1 } });
  await boot(desk.page, { profiles: ROSTER });
  await gotoCalendar(desk.page);
  await desk.page.click("#addFab");
  await settle(desk.page, 300);
  const deskRows = await notifyRows(desk.page);
  ok(deskRows.length === 4, "the Notify section still lists all 4 members at desktop width");
  if (WANT_SHOTS){
    await desk.page.screenshot({ path: path.join(SHOTS, "cal_notify_desktop.png") });
  }
  ok(desk.errors.length === 0, "no page errors on desktop" + (desk.errors.length ? ": " + desk.errors[0] : ""));
}

/* ================================ run ===================================== */
(async () => {
  const srv = await serve();
  const browser = await puppeteer.launch({
    channel: "chrome",
    headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });

  const sections = [
    sectionList, sectionLifecycle, sectionEditWording, sectionRecurring,
    sectionEmailFailure, sectionBell, sectionCrossDevice, sectionLayout,
  ];
  try {
    for (const fn of sections){
      try { await fn(browser); }
      catch (err){ fail++; failures.push(fn.name + " crashed: " + err.message); console.log("\n✗ " + fn.name.toUpperCase() + " ERROR: " + (err && err.stack || err)); }
    }
  } finally {
    await browser.close();
    srv.close();
  }

  console.log(`\n${"=".repeat(52)}`);
  console.log(`CALNOTIFY: ${pass}/${pass + fail} checks passed`);
  if (fail){ console.log("\nFailures:"); for (const f of failures) console.log("  ✗ " + f); }
  process.exit(fail ? 1 : 0);
})();
