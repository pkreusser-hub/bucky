#!/usr/bin/env node
"use strict";
/**
 * BUCKY profile-page suite — Identity Phase 2 (docs/identity.md): permitted-vs-visible nav,
 * notification categories, and the first-run identity gate.
 *
 *   node tools/_verify-profilepage.cjs
 *
 * Same harness shape as tools/_verify-identity.cjs (Phase 1's own suite) — same fake-server,
 * same newPage/boot plumbing, same choreUnlocked seeding. FIREBASE IS BLOCKED THROUGHOUT
 * (googleapis / firestore / firebase / gstatic); everything here runs against the LOCAL backend
 * only (buckyData1 in localStorage) — nothing here ever touches production Firestore.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8938;
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const failures = [];
const ok = (cond, name) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; failures.push(name); console.log("  ✗ FAIL " + name); }
};
const section = (t) => console.log("\n=== " + t + " ===");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
async function newPage(browser, { user, viewport = { width:390, height:844, deviceScaleFactor:1 } } = {}){
  const ctx = browser.createBrowserContext
    ? await browser.createBrowserContext()
    : await browser.createIncognitoBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  const errors = [];
  const NOISE = /Failed to load resource|dynamically imported module|gstatic|firebase|ERR_FAILED|ERR_BLOCKED/i;
  page.on("pageerror", (e) => { if (!NOISE.test(String(e))) errors.push(String(e)); });
  page.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) errors.push("console: " + m.text()); });

  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const u = r.url();
    if (/googleapis|firestore|firebase|gstatic/i.test(u)) return r.abort();
    if (u.includes("/.netlify/functions/")) return r.respond({ status: 200, contentType: "application/json", body: "{}" });
    if (/^https?:\/\/(?!127\.0\.0\.1)/.test(u)) return r.abort();
    r.continue();
  });

  await page.evaluateOnNewDocument((u) => {
    localStorage.setItem("choreUnlocked", "amenfarms");
    if (u === undefined) { /* leave choreUser exactly as the fixture wants it (may be absent) */ }
    else if (u === null) localStorage.removeItem("choreUser");
    else localStorage.setItem("choreUser", u);
    window.__PROMPTS__ = [];
    window.prompt = () => (window.__PROMPTS__.length ? window.__PROMPTS__.shift() : null);
    window.alert = () => {};
    window.confirm = () => true;
    // Deterministic, fully controllable Notification stub — real headless Chrome's Notification
    // API behaves inconsistently across environments; this makes "requested exactly once" and
    // "granted" / "denied" / "default" states assertable without depending on that.
    // window.__NOTIF_REQUEST_CALLS__ counts actual native PROMPTS — matching how a real browser
    // behaves: requestPermission() called again once permission is already decided ("granted" /
    // "denied", not "default") resolves immediately with NO new UI shown, so it's called freely
    // from multiple places (index.html's requestNotifPermissionOnce AND push-client.js's own
    // enable(), which unconditionally calls it too — pre-existing, shared by every OTHER
    // enable() call site in this app: toggleDesktopAlerts/refreshPushRegistration/notifTestBtn
    // all do the exact same "request then enable()" double-call already). Only the FIRST call
    // while permission is still "default" is a real user-facing prompt.
    window.__NOTIF_REQUEST_CALLS__ = 0;
    function FakeNotification(title, opts){ this.title = title; this.opts = opts; }
    FakeNotification.permission = "default";
    FakeNotification.requestPermission = () => {
      if (FakeNotification.permission === "default") window.__NOTIF_REQUEST_CALLS__++;
      FakeNotification.permission = window.__NOTIF_GRANT__ === false ? "denied" : "granted";
      return Promise.resolve(FakeNotification.permission);
    };
    window.Notification = FakeNotification;
  }, user);
  return { page, errors };
}

/** Load index.html once with `profiles` (and optionally other chores/settings) seeded directly
    into the local backend's buckyData1 array, then reload so the app boots against that data. */
async function boot(page, { profiles, extraDocs, choreUser, notifGrant } = {}){
  await page.goto(BASE + "/index.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate((list, extra, cu, ng) => {
    const rows = (list || []).concat(extra || []);
    if (rows.length || list) localStorage.setItem("buckyData1", JSON.stringify(rows));
    if (cu !== undefined) { if (cu === null) localStorage.removeItem("choreUser"); else localStorage.setItem("choreUser", cu); }
    if (ng !== undefined) window.__NOTIF_GRANT__ = ng;
  }, profiles || null, extraDocs || null, choreUser, notifGrant);
  await page.goto(BASE + "/index.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__NAV__ && window.__IDENTITY__ && window.__PROFILE__ && window.__IDGATE__ && window.__NOTIFTEST__, { timeout: 20000 });
  await sleep(900);
}

function readProfiles(page){ return page.evaluate(() => window.__IDENTITY__.profiles()); }
function readLS(page, key){ return page.evaluate((k) => localStorage.getItem(k), key); }
function bnavGids(page){
  return page.evaluate(() => [...document.querySelectorAll("#bnav .bnav-btn")].map((b) => b.dataset.gid));
}

/* ============================ fixtures ========================= */
function roster(){
  return [
    { id: "p_dad",     frequency: "profile", name: "Dad",     email: "dad@example.com",     order: 1, pid: "dad",     role: "parent", grant: ["seesFit", "bankAdminUI", "approvePayouts"] },
    { id: "p_mom",     frequency: "profile", name: "Mom",     email: "mom@example.com",      order: 2, pid: "mom",     role: "parent" },
    { id: "p_isaac",   frequency: "profile", name: "Isaac",   email: "isaac@example.com",    order: 3, pid: "isaac",   role: "kid" },
    { id: "p_eleanor", frequency: "profile", name: "Eleanor", email: "eleanor@example.com",  order: 4, pid: "eleanor", role: "kid" },
    { id: "p_grandma", frequency: "profile", name: "Grandma", email: "grandma@example.com",  order: 5, pid: "grandma", role: "extended" },
  ];
}
// gateDad's PIN flow: first-ever PIN needs two matching prompts (set + confirm); after that,
// one prompt per gateDad() call (gateDadForRoster/openProfilePage always re-prompt, never
// satisfied by a stored flag) — see index.html's own comment on gateDadForRoster.
async function dadLoginPrompts(page, alreadyConfigured){
  await page.evaluate((cfg) => { window.__PROMPTS__ = cfg ? ["1234"] : ["1234", "1234"]; }, !!alreadyConfigured);
}

/* ===================== A. Permitted vs Visible separation ===================== */
async function sectionPermittedVsVisible(browser){
  section("A. Permitted (parent-controlled) vs Visible (self-controlled) — deliberately separate");

  const { page, errors } = await newPage(browser, { user: "Dad" });
  await boot(page, { profiles: roster() });

  // Dad denies Isaac "News" from Isaac's own profile page.
  await page.evaluate(() => window.__PROFILE__.open("isaac"));
  await dadLoginPrompts(page, false);
  await sleep(300);
  await page.evaluate(() => window.__PROFILE__.open("isaac"));   // re-open now that gateDad ran
  await sleep(200);
  const newsRowBefore = await page.evaluate(() => {
    const row = [...document.querySelectorAll("#profPermList label")].find((r) => r.dataset.gid === "news");
    return row ? row.querySelector("input").checked : null;
  });
  ok(newsRowBefore === true, `Isaac's News permitted checkbox starts checked (got ${newsRowBefore})`);
  await page.evaluate(() => {
    const row = [...document.querySelectorAll("#profPermList label")].find((r) => r.dataset.gid === "news");
    row.querySelector("input").click();
  });
  await sleep(300);

  const isaacDeny = (await readProfiles(page)).find((p) => p.pid === "isaac").deny || [];
  ok(isaacDeny.includes("seesNews"), `denying News wrote seesNews into Isaac's deny array (got ${JSON.stringify(isaacDeny)})`);

  // Switch to Isaac and confirm News is gone from HIS nav, and a deep link redirects Home.
  // Seed the SECOND page from the RAW buckyData1 doc (frequency + all fields intact) rather
  // than __IDENTITY__.profiles()'s mapped/stripped shape (no `frequency`, which would make
  // familyMembers() filter every seeded row straight back out).
  const rawDocsJson = await readLS(page, "buckyData1");
  const isaacSide = await newPage(browser, { user: "Isaac" });
  await boot(isaacSide.page, { profiles: JSON.parse(rawDocsJson) });
  let gids = await bnavGids(isaacSide.page);
  ok(!gids.includes("news"), `News is gone from Isaac's own nav (got ${JSON.stringify(gids)})`);
  await isaacSide.page.evaluate(() => window.__NAV__.goTo("news"));
  await sleep(200);
  const tabAfterDeny = await isaacSide.page.evaluate(() => window.__NAV__.tab());
  ok(tabAfterDeny === "dashboard", `a deep link to a DENIED area (News) redirects Home — got tab "${tabAfterDeny}"`);

  // Isaac hides Chores HIMSELF (self-controlled Visible layer) — still permitted, just hidden.
  await isaacSide.page.evaluate(() => window.__PROFILE__.open("isaac"));
  await sleep(200);
  const choresVisBefore = await isaacSide.page.evaluate(() => {
    const row = [...document.querySelectorAll("#profVisList label")].find((r) => r.dataset.gid === "tasks");
    return row ? row.querySelector("input").checked : null;
  });
  ok(choresVisBefore === true, `Isaac's own "show Chores in your nav" starts checked (got ${choresVisBefore})`);
  await isaacSide.page.evaluate(() => {
    const row = [...document.querySelectorAll("#profVisList label")].find((r) => r.dataset.gid === "tasks");
    row.querySelector("input").click();
  });
  await sleep(300);

  gids = await bnavGids(isaacSide.page);
  ok(!gids.includes("tasks"), `Chores is gone from Isaac's nav after he hides it himself (got ${JSON.stringify(gids)})`);
  ok(await isaacSide.page.evaluate(() => window.__NAV__.permitted("tasks")) === true,
    "…but Chores is still PERMITTED for Isaac (hiding is preference, not a denial)");
  await isaacSide.page.evaluate(() => window.__NAV__.goTo("chores"));
  await sleep(200);
  const tabAfterHide = await isaacSide.page.evaluate(() => window.__NAV__.tab());
  ok(tabAfterHide === "chores", `…and a deep link to a merely-HIDDEN area still WORKS (lands on "${tabAfterHide}", not bounced Home)`);

  ok(errors.length === 0, "no page errors (Dad side)" + (errors.length ? ": " + errors[0] : ""));
  ok(isaacSide.errors.length === 0, "no page errors (Isaac side)" + (isaacSide.errors.length ? ": " + isaacSide.errors[0] : ""));
}

/* ===================== B. Home is un-hideable ===================== */
async function sectionHomeUnhideable(browser){
  section("B. Home is un-hideable — always permitted, never offered as a Permitted/Visible checkbox");

  const { page, errors } = await newPage(browser, { user: "Isaac" });
  await boot(page, { profiles: roster() });

  const permitted = await page.evaluate(() => window.__NAV__.permitted("home"));
  ok(permitted === true, `navGroupPermitted("home") is always true (got ${permitted})`);
  const visible = await page.evaluate(() => window.__NAV__.visible("home"));
  ok(visible === true, `navGroupVisible("home") is always true (got ${visible})`);

  await page.evaluate(() => window.__PROFILE__.open("isaac"));
  await sleep(200);
  const homeOffered = await page.evaluate(() =>
    [...document.querySelectorAll("#profVisList label")].some((r) => r.dataset.gid === "home"));
  ok(homeOffered === false, "Home never appears as a row in the self-controlled Visible list");

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
}

/* ===================== C. Guest defaults are tight ===================== */
async function sectionGuestDefaults(browser){
  section("C. A fresh guest profile gets the tight default set (no grant/deny overrides)");

  const guestRoster = roster().concat([
    { id: "p_guest", frequency: "profile", name: "Visiting Friend", email: "", order: 6, pid: "visitingfriend", role: "guest" },
  ]);
  const { page, errors } = await newPage(browser, { user: "Dad" });
  await boot(page, { profiles: guestRoster });

  const caps = await page.evaluate(() => {
    const list = ["seesPlan", "seesMeals", "seesNews", "seesSports", "seesGffl", "seesPlay", "seesAi",
      "kidBank", "seesFinance", "seesJobs", "seesChoresArea", "seesFit", "seesFarm", "seesShop"];
    const out = {};
    for (const c of list) out[c] = window.__IDENTITY__.can(c, "visitingfriend");
    return out;
  });
  const expected = {
    seesPlan: true, seesMeals: false, seesNews: true, seesSports: true, seesGffl: false,
    seesPlay: true, seesAi: true, kidBank: false, seesFinance: false, seesJobs: false,
    seesChoresArea: false, seesFit: false, seesFarm: false, seesShop: true,
  };
  for (const [cap, exp] of Object.entries(expected)){
    ok(caps[cap] === exp, `guest: can("${cap}") = ${exp} (got ${caps[cap]})`);
  }

  // Dad's own nav is untouched by any of this — the real check is the GUEST's own nav.
  const guestSide = await newPage(browser, { user: "Visiting Friend" });
  await boot(guestSide.page, { profiles: guestRoster });
  const guestGids = await bnavGids(guestSide.page);
  ok(guestGids.includes("home"), "guest's nav still includes Home");
  ok(!guestGids.includes("bank"), `guest's nav excludes Bank (got ${JSON.stringify(guestGids)})`);
  ok(!guestGids.includes("fit"), "guest's nav excludes Fit");
  ok(guestGids.includes("news"), "guest's nav includes News");

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
  ok(guestSide.errors.length === 0, "no page errors (guest side)" + (guestSide.errors.length ? ": " + guestSide.errors[0] : ""));
}

/* ===================== D. Self-demotion guard ===================== */
async function sectionSelfDemotionGuard(browser){
  section("D. The role picker never appears on your OWN profile page, even for a bankAdminUI holder");

  const { page, errors } = await newPage(browser, { user: "Dad" });
  await boot(page, { profiles: roster() });

  await page.evaluate(() => window.__PROFILE__.open("dad"));
  await sleep(200);
  const state = await page.evaluate(() => ({
    hasRoleSelect: !!document.querySelector("#profileSheetInner select"),
    hasPermList: !!document.getElementById("profPermList"),
  }));
  ok(state.hasRoleSelect === false, "Dad viewing his OWN profile gets no role-picker <select>");
  ok(state.hasPermList === false, "…and no Permitted editor either — both are 'someone else's page' only");

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
}

/* ===================== E. Role picker is bankAdminUI-gated ===================== */
async function sectionRolePickerGated(browser){
  section("E. Role picker + Permitted editor: bankAdminUI holders only, and it actually changes the role");

  // Isaac (kid, no bankAdminUI) views Mom's page: read-only.
  const { page: kidPage, errors: kidErrors } = await newPage(browser, { user: "Isaac" });
  await boot(kidPage, { profiles: roster() });
  await kidPage.evaluate(() => window.__PROFILE__.open("mom"));
  await sleep(200);
  const kidView = await kidPage.evaluate(() => ({
    hasRoleSelect: !!document.querySelector("#profileSheetInner select"),
    hasPermList: !!document.getElementById("profPermList"),
  }));
  ok(kidView.hasRoleSelect === false, "a non-admin viewing someone else's page gets no role picker");
  ok(kidView.hasPermList === false, "…and no Permitted editor");
  ok(kidErrors.length === 0, "no page errors (kid side)" + (kidErrors.length ? ": " + kidErrors[0] : ""));

  // Dad (bankAdminUI) views Isaac's page: role picker present, and using it really persists.
  const { page, errors } = await newPage(browser, { user: "Dad" });
  await boot(page, { profiles: roster() });
  await page.evaluate(() => window.__PROFILE__.open("isaac"));
  await dadLoginPrompts(page, false);
  await sleep(300);
  await page.evaluate(() => window.__PROFILE__.open("isaac"));
  await sleep(200);
  const hasSelect = await page.evaluate(() => !!document.querySelector("#profileSheetInner select"));
  ok(hasSelect === true, "Dad (bankAdminUI, PIN-unlocked) viewing Isaac's page DOES get a role picker");

  await page.evaluate(() => {
    const sel = document.querySelector("#profileSheetInner select");
    sel.value = "extended"; sel.dispatchEvent(new Event("change"));
  });
  await sleep(300);
  const isaacAfter = (await readProfiles(page)).find((p) => p.pid === "isaac");
  ok(isaacAfter.role === "extended", `changing the role picker persisted through backend.update (got "${isaacAfter.role}")`);

  ok(errors.length === 0, "no page errors (Dad side)" + (errors.length ? ": " + errors[0] : ""));
}

/* ===================== F. prefs round-trip through the save path ===================== */
async function sectionPrefsRoundTrip(browser){
  section("F. prefs.nav / prefs.notifs round-trip through the normal chores save path, and survive a reload");

  const { page, errors } = await newPage(browser, { user: "Eleanor" });
  await boot(page, { profiles: roster() });

  await page.evaluate(() => window.__PROFILE__.open("eleanor"));
  await sleep(200);
  await page.evaluate(() => {
    const navRow = [...document.querySelectorAll("#profVisList label")].find((r) => r.dataset.gid === "farm");
    navRow.querySelector("input").click();
    const notifRow = [...document.querySelectorAll("#profNotifList label")].find((r) => r.dataset.cat === "jobs");
    notifRow.querySelector("input").click();
  });
  await sleep(400);

  const before = (await readProfiles(page)).find((p) => p.pid === "eleanor");
  ok(before.prefs && Array.isArray(before.prefs.nav) && before.prefs.nav.includes("farm"),
    `prefs.nav was written through backend.update (got ${JSON.stringify(before.prefs)})`);
  ok(before.prefs && Array.isArray(before.prefs.notifs) && before.prefs.notifs.includes("jobs"),
    `prefs.notifs was written the same way (got ${JSON.stringify(before.prefs)})`);

  // A real reload — not just an in-memory check — proves it went through the actual save path.
  await page.goto(BASE + "/index.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__NAV__ && window.__IDENTITY__, { timeout: 20000 });
  await sleep(900);
  const after = (await readProfiles(page)).find((p) => p.pid === "eleanor");
  ok(JSON.stringify(after.prefs) === JSON.stringify(before.prefs), "…and the prefs survive a full page reload unchanged");

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
}

/* ===================== G. Notification toggles + call-site muting ===================== */
async function sectionNotifCallSites(browser){
  section("G. Notification category toggles default ON, and muting one really suppresses its call site");

  const { page, errors } = await newPage(browser, { user: "Isaac" });
  await boot(page, { profiles: roster() });

  // Default state: a fresh profile (no prefs.notifs at all) reads unmuted for every category.
  const defaults = await page.evaluate(() =>
    ["calendar", "jobs", "bank", "league", "scores"].map((c) => window.__PROFILE__.isNotifMuted("isaac", c)));
  ok(defaults.every((m) => m === false), `all 5 categories default UNMUTED with no prefs at all (got ${JSON.stringify(defaults)})`);

  await page.evaluate(() => window.__PROFILE__.open("isaac"));
  await sleep(200);
  const allChecked = await page.evaluate(() =>
    [...document.querySelectorAll("#profNotifList input[type=checkbox]")].every((cb) => cb.checked));
  ok(allChecked === true, "…and the profile page's UI shows all 5 category checkboxes checked by default");

  // Mute "bank" via the real UI, then prove notifyBankCredit's push+bell call site is a no-op —
  // stubbing window.BuckyPush so the assertion is "was it called", not "did a network request
  // succeed" (Firestore/FCM are blocked in this harness regardless).
  await page.evaluate(() => {
    const row = [...document.querySelectorAll("#profNotifList label")].find((r) => r.dataset.cat === "bank");
    row.querySelector("input").click();
  });
  await sleep(300);
  ok((await readProfiles(page)).find((p) => p.pid === "isaac").prefs.notifs.includes("bank"),
    "muting Bank via the checkbox wrote \"bank\" into Isaac's prefs.notifs");

  const bankResult = await page.evaluate(async () => {
    const calls = [];
    window.BuckyPush = { notify: (...args) => { calls.push(args); return Promise.resolve({ sent: 1 }); } };
    await window.__NOTIFTEST__.notifyBankCredit("Isaac", 5, "test", "test-dedupe-1");
    return calls.length;
  });
  ok(bankResult === 0, `notifyBankCredit's push call site is suppressed for the muted (Isaac/bank) case — got ${bankResult} calls`);

  // Eleanor is NOT muted for bank — the SAME call site must still fire for her, in the same run,
  // proving the gate is per-person/per-category, not a global kill switch.
  const eleanorResult = await page.evaluate(async () => {
    const calls = [];
    window.BuckyPush = { notify: (...args) => { calls.push(args); return Promise.resolve({ sent: 1 }); } };
    await window.__NOTIFTEST__.notifyBankCredit("Eleanor", 5, "test", "test-dedupe-2");
    return calls.length;
  });
  ok(eleanorResult === 1, `…but the SAME call site still fires normally for an unmuted kid (Eleanor) — got ${eleanorResult} calls`);

  // "jobs" category — notifyAssignee (work-order assignment).
  await page.evaluate(() => {
    const row = [...document.querySelectorAll("#profNotifList label")].find((r) => r.dataset.cat === "jobs");
    row.querySelector("input").click();
  });
  await sleep(300);
  const jobsResult = await page.evaluate(async () => {
    const pushCalls = []; const emailCalls = [];
    window.BuckyPush = { notify: (...args) => { pushCalls.push(args); return Promise.resolve({ sent: 1 }); } };
    window.__origSendEmail = window.__origSendEmail || null;
    await window.__NOTIFTEST__.notifyAssignee("Isaac", { name: "Mow the lawn", due: "", value: "" });
    return { push: pushCalls.length };
  });
  ok(jobsResult.push === 0, `notifyAssignee's push call site is suppressed once Isaac mutes "jobs" — got ${jobsResult.push} calls`);

  // "calendar" category — notifyCalEvent, gated on the notify TARGET (not the signed-in user).
  await page.evaluate(() => {
    const row = [...document.querySelectorAll("#profNotifList label")].find((r) => r.dataset.cat === "calendar");
    row.querySelector("input").click();
  });
  await sleep(300);
  const calResult = await page.evaluate(async () => {
    const calls = [];
    window.BuckyPush = { notify: (...args) => { calls.push(args); return Promise.resolve({ sent: 1 }); } };
    await window.__NOTIFTEST__.notifyCalEvent({ id: "ev1", title: "Vet visit" }, ["Isaac"], false, null);
    return calls.length;
  });
  ok(calResult === 0, `notifyCalEvent's push call site is suppressed once Isaac mutes "calendar" — got ${calResult} calls`);

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
}

/* ===================== H. desktopAlertsEnabled default flip ===================== */
async function sectionNotifDefaultFlip(browser){
  section("H. desktopAlertsEnabled() defaults ON; an explicit \"0\" is still respected as opt-out");

  const { page, errors } = await newPage(browser, { user: "Dad" });
  await boot(page, { profiles: roster() });

  const fresh = await page.evaluate(() => window.__NOTIFTEST__.desktopAlertsEnabled());
  ok(fresh === true, `a fresh profile with buckyNotifDesktop never set reads ENABLED by default (got ${fresh})`);

  await page.evaluate(() => localStorage.setItem("buckyNotifDesktop", "0"));
  const off = await page.evaluate(() => window.__NOTIFTEST__.desktopAlertsEnabled());
  ok(off === false, `an explicit "0" is still respected as the opt-out (got ${off})`);

  await page.evaluate(() => localStorage.setItem("buckyNotifDesktop", "1"));
  const on = await page.evaluate(() => window.__NOTIFTEST__.desktopAlertsEnabled());
  ok(on === true, `an explicit "1" still reads enabled too (got ${on})`);

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
}

/* ===================== I. First-run identity gate ===================== */
async function sectionIdentityGate(browser){
  section("I. First-run identity gate — appears only with no identity, pick / create-account paths, permission requested once");

  // I1. A device with an existing identity NEVER sees the gate.
  {
    const { page, errors } = await newPage(browser, { user: "Dad" });
    await boot(page, { profiles: roster() });
    const showing = await page.evaluate(() => window.__IDGATE__.showing());
    ok(showing === false, `a device with an existing identity (choreUser="Dad") never sees the gate (got showing=${showing})`);
    ok(errors.length === 0, "no page errors (existing identity)" + (errors.length ? ": " + errors[0] : ""));
  }

  // I2. A device with NO identity sees the gate, listing the real roster.
  {
    const { page, errors } = await newPage(browser, { user: null });
    await boot(page, { profiles: roster(), choreUser: null });
    const state = await page.evaluate(() => ({
      showing: window.__IDGATE__.showing(),
      names: [...document.querySelectorAll("#idGateRoster button")].map((b) => b.textContent.trim()),
    }));
    ok(state.showing === true, "a device with NEITHER chorePid nor choreUser sees the gate");
    ok(state.names.includes("Dad") && state.names.includes("Isaac"), `the gate lists the real roster (got ${JSON.stringify(state.names)})`);
    ok(errors.length === 0, "no page errors (gate showing)" + (errors.length ? ": " + errors[0] : ""));

    // Tapping an existing person picks them, hides the gate, lands Home, and requests
    // notification permission EXACTLY ONCE (the tap IS the required user gesture).
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll("#idGateRoster button")].find((b) => b.textContent.trim() === "Isaac");
      btn.click();
    });
    await sleep(400);
    const after = await page.evaluate(() => ({
      showing: window.__IDGATE__.showing(),
      choreUser: localStorage.getItem("choreUser"),
      chorePid: localStorage.getItem("chorePid"),
      tab: window.__NAV__.tab(),
      permCalls: window.__NOTIF_REQUEST_CALLS__,
    }));
    ok(after.showing === false, "picking a roster person hides the gate");
    ok(after.choreUser === "Isaac" && after.chorePid === "isaac", `picking Isaac set choreUser+chorePid together (got ${JSON.stringify(after)})`);
    ok(after.tab === "dashboard", `…and landed on Home (got tab "${after.tab}")`);
    ok(after.permCalls === 1, `the user sees the native permission PROMPT exactly once for this flow — later calls (index.html's own requestNotifPermissionOnce guard, plus push-client.js's enable() calling requestPermission() again internally) all resolve instantly against an already-decided permission with no new UI (got ${after.permCalls})`);
  }

  // I3. Create-account path: a brand-new name mints a guest + a real pid, lands Home.
  {
    const { page, errors } = await newPage(browser, { user: null });
    await boot(page, { profiles: roster(), choreUser: null });
    await page.evaluate(() => document.getElementById("idGateNewBtn").click());
    await sleep(150);
    await page.evaluate(() => {
      document.getElementById("idGateName").value = "Uncle Theo";
      document.getElementById("idGateEmail").value = "theo@example.com";
    });
    await page.evaluate(() => document.getElementById("idGateCreateBtn").click());
    await sleep(400);

    const theo = (await readProfiles(page)).find((p) => p.name === "Uncle Theo");
    ok(!!theo, "create-account minted a brand-new profile doc");
    ok(!!theo && theo.pid === "uncletheo", `…with a real pid, minted via the same mintPid() as the Family sheet (got "${theo && theo.pid}")`);
    ok(!!theo && theo.role === "guest", `…and role "guest", per the contract (got "${theo && theo.role}")`);
    const state = await page.evaluate(() => ({
      showing: window.__IDGATE__.showing(), tab: window.__NAV__.tab(),
      choreUser: localStorage.getItem("choreUser"), chorePid: localStorage.getItem("chorePid"),
      permCalls: window.__NOTIF_REQUEST_CALLS__,
    }));
    ok(state.showing === false, "the gate hides after create-account");
    ok(state.tab === "dashboard", `…and lands on Home (got "${state.tab}")`);
    ok(state.choreUser === "Uncle Theo" && state.chorePid === "uncletheo", "…with THIS device now signed in as the new guest");
    ok(state.permCalls === 1, `the create-account flow also only prompts once (got ${state.permCalls})`);
    ok(errors.length === 0, "no page errors (create-account)" + (errors.length ? ": " + errors[0] : ""));
  }

  // I4. Name-collision path: typing an EXISTING name offers "is this you?" instead of a duplicate.
  {
    const { page, errors } = await newPage(browser, { user: null });
    await boot(page, { profiles: roster(), choreUser: null });
    await page.evaluate(() => document.getElementById("idGateNewBtn").click());
    await sleep(150);
    await page.evaluate(() => { document.getElementById("idGateName").value = "isaac"; }); // case-insensitive collision
    await page.evaluate(() => document.getElementById("idGateCreateBtn").click());
    await sleep(200);

    const collision = await page.evaluate(() => ({
      boxText: document.getElementById("idGateCollisionBox") ? document.getElementById("idGateCollisionBox").textContent : null,
      profileCountForIsaac: window.__IDENTITY__.profiles().filter((p) => p.pid === "isaac").length,
    }));
    ok(!!collision.boxText && /is this you/i.test(collision.boxText), `a colliding name shows the "is this you?" box (got ${JSON.stringify(collision.boxText)})`);
    ok(collision.profileCountForIsaac === 1, "…and NO duplicate profile was created");

    // Tapping the matched name in the collision box picks that existing profile.
    await page.evaluate(() => {
      const box = document.getElementById("idGateCollisionBox");
      box.querySelector("button").click();
    });
    await sleep(300);
    const after = await page.evaluate(() => ({
      choreUser: localStorage.getItem("choreUser"), chorePid: localStorage.getItem("chorePid"),
      showing: window.__IDGATE__.showing(),
    }));
    ok(after.choreUser === "Isaac" && after.chorePid === "isaac", `tapping the matched profile in the collision box picks it (got ${JSON.stringify(after)})`);
    ok(after.showing === false, "…and the gate hides");
    ok(errors.length === 0, "no page errors (collision path)" + (errors.length ? ": " + errors[0] : ""));
  }

  // I5. arcade.html / games.html never gained the gate — belt-and-braces source check (out of
  // scope per the brief; confirms nothing here leaked into those files).
  {
    const arcade = fs.readFileSync(path.join(ROOT, "arcade.html"), "utf8");
    ok(!/idGateOverlay/.test(arcade), "arcade.html has no idGateOverlay — the gate is index.html-only");
    const games = fs.readFileSync(path.join(ROOT, "games.html"), "utf8");
    ok(!/idGateOverlay/.test(games), "games.html has no idGateOverlay either");
  }
}

/* ================================ run ===================================== */
(async () => {
  const srv = await serve();
  const browser = await puppeteer.launch({
    channel: "chrome",
    headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });
  try {
    await sectionPermittedVsVisible(browser);
    await sectionHomeUnhideable(browser);
    await sectionGuestDefaults(browser);
    await sectionSelfDemotionGuard(browser);
    await sectionRolePickerGated(browser);
    await sectionPrefsRoundTrip(browser);
    await sectionNotifCallSites(browser);
    await sectionNotifDefaultFlip(browser);
    await sectionIdentityGate(browser);
  } catch (err) {
    fail++; failures.push("suite crashed: " + err.message);
    console.log("\n✗ SUITE ERROR: " + (err && err.stack || err));
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${"=".repeat(52)}`);
  console.log(`PROFILEPAGE: ${pass}/${pass + fail} checks passed`);
  if (fail){ console.log("\nFailures:"); for (const f of failures) console.log("  ✗ " + f); }
  process.exit(fail ? 1 : 0);
})();
