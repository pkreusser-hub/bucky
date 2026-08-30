#!/usr/bin/env node
"use strict";
/**
 * BUCKY identity suite — pid/role/capability layer (docs/identity.md).
 *
 *   node tools/_verify-identity.cjs [--shots]
 *
 * Phase 1 of the identity refactor replaced every name-literal gate (BANK_ADMIN, BANK_KIDS,
 * FITNESS_USERS, isDadName(), ...) with can(capability) resolved off a profile's role + a
 * per-profile grant/deny override. This suite's whole point is proving that swap changed NO
 * user-visible behaviour: section B hand-derives, from the OLD constants (not from reading the
 * new CAPS map — that would be tautological), the exact capability table every one of the 10
 * real family profiles had before this refactor, then drives the REAL app to confirm can()
 * (and, for a few representative profiles, real nav DOM) still says the same thing.
 *
 * FIREBASE IS BLOCKED THROUGHOUT (googleapis / firestore / firebase / gstatic). Not optional:
 * an unblocked headless run against index.html has twice seeded duplicates into the live
 * family herd. This suite writes profile docs (migration, roster edits) through the LOCAL
 * backend only (buckyData1 in localStorage) — nothing here ever touches production Firestore.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const WANT_SHOTS = process.argv.includes("--shots");
const PORT = 8937;
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
const contexts = [];
async function newPage(browser, { user, viewport = { width:390, height:844, deviceScaleFactor:1 } } = {}){
  const ctx = browser.createBrowserContext
    ? await browser.createBrowserContext()
    : await browser.createIncognitoBrowserContext();
  contexts.push(ctx);
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
    // Queue-based prompt mock (same shape _verify-fitness.cjs / _verify-news.cjs use for their
    // own Dad-PIN gates): window.__PROMPTS__ is a caller-loaded queue of answers; empty queue
    // means "user cancelled" (null), same as every other suite's default.
    window.__PROMPTS__ = [];
    window.prompt = () => (window.__PROMPTS__.length ? window.__PROMPTS__.shift() : null);
    window.alert = () => {};
    window.confirm = () => true;
  }, user);
  return { page, errors };
}

/** Load index.html once with `profiles` (and optionally other chores/settings) seeded directly
    into the local backend's buckyData1 array, then reload so the app boots against that data. */
async function boot(page, { profiles, extraDocs, choreUser } = {}){
  await page.goto(BASE + "/index.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate((list, extra, cu) => {
    const rows = (list || []).concat(extra || []);
    if (rows.length || list) localStorage.setItem("buckyData1", JSON.stringify(rows));
    if (cu !== undefined) { if (cu === null) localStorage.removeItem("choreUser"); else localStorage.setItem("choreUser", cu); }
  }, profiles || null, extraDocs || null, choreUser);
  await page.goto(BASE + "/index.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__NAV__ && window.__IDENTITY__, { timeout: 20000 });
  await sleep(900);
}

function readProfiles(page){ return page.evaluate(() => window.__IDENTITY__.profiles()); }
function readLS(page, key){ return page.evaluate((k) => localStorage.getItem(k), key); }

/* ============================ the real family roster ========================= */
// The 10 live profiles (docs/bucky-app.md's identity inventory), UNMIGRATED — no pid/role yet.
// This is exactly the shape saveFamilyMember() wrote before this refactor.
function unmigratedRoster(){
  const names = ["Christy", "Dad", "Eleanor", "Grandma", "Grandpa", "Isaac", "Janae", "John", "Joy", "Mom"];
  return names.map((name, i) => ({ id: "prof_" + name.toLowerCase(), frequency: "profile", name, email: name.toLowerCase() + "@example.com", order: i + 1 }));
}

// Hand-derived, from the OLD (pre-refactor) constants — NOT from reading CAPS. This is the
// "no behaviour change" proof's ground truth.
//   BANK_ADMIN="Dad" (isDadName/bankAdmin)      -> bankAdminUI, approvePayouts: Dad only
//   BANK_KIDS=["Isaac","Eleanor"]                -> kidBank: Isaac, Eleanor only
//   seesFinance() = !BANK_KIDS.includes(name)    -> everyone except Isaac/Eleanor
//   FITNESS_USERS=["Isaac","Eleanor","Dad"]      -> seesFit
//   FIT_LOCKED_USERS=["Isaac","Eleanor"]         -> fitLocked
//   MEAL_USERS=["Mom","Dad"]                     -> seesMeals
//   CHORE_USERS=["Isaac","Eleanor"]              -> seesChores
//   BANK_USERS=["Eleanor","Isaac","Dad"]         -> seesBank (kidBank OR bankAdminUI, same set)
const EXPECTED = {
  Dad:      { role: "parent",   kidBank: false, seesFinance: true,  seesFit: true,  fitLocked: false, seesMeals: true,  seesChores: false, seesBank: true,  bankAdminUI: true,  approvePayouts: true  },
  Mom:      { role: "parent",   kidBank: false, seesFinance: true,  seesFit: false, fitLocked: false, seesMeals: true,  seesChores: false, seesBank: false, bankAdminUI: false, approvePayouts: false },
  Isaac:    { role: "kid",      kidBank: true,  seesFinance: false, seesFit: true,  fitLocked: true,  seesMeals: false, seesChores: true,  seesBank: true,  bankAdminUI: false, approvePayouts: false },
  Eleanor:  { role: "kid",      kidBank: true,  seesFinance: false, seesFit: true,  fitLocked: true,  seesMeals: false, seesChores: true,  seesBank: true,  bankAdminUI: false, approvePayouts: false },
  Christy:  { role: "extended", kidBank: false, seesFinance: true,  seesFit: false, fitLocked: false, seesMeals: false, seesChores: false, seesBank: false, bankAdminUI: false, approvePayouts: false },
  Grandma:  { role: "extended", kidBank: false, seesFinance: true,  seesFit: false, fitLocked: false, seesMeals: false, seesChores: false, seesBank: false, bankAdminUI: false, approvePayouts: false },
  Grandpa:  { role: "extended", kidBank: false, seesFinance: true,  seesFit: false, fitLocked: false, seesMeals: false, seesChores: false, seesBank: false, bankAdminUI: false, approvePayouts: false },
  Janae:    { role: "extended", kidBank: false, seesFinance: true,  seesFit: false, fitLocked: false, seesMeals: false, seesChores: false, seesBank: false, bankAdminUI: false, approvePayouts: false },
  John:     { role: "extended", kidBank: false, seesFinance: true,  seesFit: false, fitLocked: false, seesMeals: false, seesChores: false, seesBank: false, bankAdminUI: false, approvePayouts: false },
  Joy:      { role: "extended", kidBank: false, seesFinance: true,  seesFit: false, fitLocked: false, seesMeals: false, seesChores: false, seesBank: false, bankAdminUI: false, approvePayouts: false },
};
// "seesBank" is deliberately absent here — it isn't a stored capability, it's the OR of
// kidBank || bankAdminUI (see sectionCapabilityMatrix, which computes it that way too).
const CAP_KEYS = ["kidBank", "seesFinance", "seesFit", "fitLocked", "seesMeals", "seesChores", "bankAdminUI", "approvePayouts"];

/* ===================== A. migration: idempotent, merge-only ===================== */
async function sectionMigration(browser){
  section("A. Migration is idempotent and never overwrites an existing pid/role");

  // A profile that's ALREADY been renamed since its (hypothetical) migration: pid stays
  // "isaac" (frozen at the ORIGINAL name) even though the current name is "Zack". Proves
  // migration keys off "has a pid at all", never off whether the name still matches the slug.
  const renamed = { id: "prof_zack", frequency: "profile", name: "Zack", email: "zack@example.com", order: 99, pid: "isaac", role: "kid" };
  const roster = unmigratedRoster().concat([renamed]);

  const { page, errors } = await newPage(browser, { user: "Dad" });
  await boot(page, { profiles: roster });

  const first = await readProfiles(page);
  ok(first.length === 11, `all 11 seeded profiles are present (${first.length})`);

  for (const [name, exp] of Object.entries(EXPECTED)){
    const p = first.find((x) => x.name === name);
    ok(!!p && p.pid === name.toLowerCase(), `${name} minted pid "${name.toLowerCase()}" (got ${p && p.pid})`);
    ok(!!p && p.role === exp.role, `${name} minted role "${exp.role}" (got ${p && p.role})`);
  }
  const dad = first.find((x) => x.name === "Dad");
  ok(dad && ["seesFit", "bankAdminUI", "approvePayouts"].every((c) => dad.grant.includes(c)),
    `Dad's grant seeded with seesFit/bankAdminUI/approvePayouts (got ${JSON.stringify(dad && dad.grant)})`);
  const others = first.filter((x) => x.name !== "Dad");
  ok(others.every((p) => !p.grant || p.grant.length === 0), "nobody else got a grant array");

  const zack = first.find((x) => x.name === "Zack");
  ok(!!zack && zack.pid === "isaac", `the renamed profile's pid was NOT re-derived from its current name (still "isaac", got ${zack && zack.pid})`);

  // Re-run: reload the SAME page (buckyData1 already carries the migrated docs) and confirm
  // nothing changes on a second pass.
  await page.evaluate(() => window.__IDENTITY__.migrate());
  await sleep(200);
  const second = await readProfiles(page);
  ok(JSON.stringify(first) === JSON.stringify(second), "running migration a second time changes nothing (idempotent)");

  // A real full reload (fresh module load, fresh migrateIdentity() call from boot) is the same.
  await page.goto(BASE + "/index.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__NAV__ && window.__IDENTITY__, { timeout: 20000 });
  await sleep(900);
  const third = await readProfiles(page);
  ok(JSON.stringify(first) === JSON.stringify(third), "…and neither does a full page reload");

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
}

/* ============= B. can() matrix — the "no behaviour change" proof ================ */
async function sectionCapabilityMatrix(browser){
  section("B. can() matrix — every one of the 10 real profiles, matched against the OLD gates");

  const { page, errors } = await newPage(browser, { user: "Dad" });
  await boot(page, { profiles: unmigratedRoster() });

  for (const name of Object.keys(EXPECTED)){
    const exp = EXPECTED[name];
    const results = await page.evaluate((n, caps) => {
      const out = {};
      for (const c of caps) out[c] = window.__IDENTITY__.can(c, n);
      // seesBank() itself isn't a stored capability — it's the OR of two (kidBank ||
      // bankAdminUI), exactly like the real app's seesBank() function computes it.
      out.seesBank = window.__IDENTITY__.can("kidBank", n) || window.__IDENTITY__.can("bankAdminUI", n);
      return out;
    }, name, CAP_KEYS);
    for (const cap of CAP_KEYS.concat(["seesBank"])){
      ok(results[cap] === exp[cap], `${name}: can("${cap}") = ${exp[cap]} (got ${results[cap]})`);
    }
  }
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
}

/* ==================== B2. real UI/DOM, not just can() ============================ */
async function sectionRealUI(browser){
  section("B2. The can() matrix reflected in real nav DOM, for a representative slice");

  // The shared area's LABEL (navAreaLabel) is kidBank-only, always was — "Bank" reads for the
  // two kids with real accounts, "Finance" for everyone else INCLUDING Dad (who still reaches
  // both halves via the segmented sub-nav; seesBank() gates whether the AREA shows at all,
  // not which word it's labelled with — see the can("kidBank") vs seesBank() distinction in
  // section B above).
  const cases = [
    { name: "Dad",     bankLabel: "Finance", fit: true,  meals: true  },
    { name: "Mom",     bankLabel: "Finance", fit: false, meals: true  },
    { name: "Isaac",   bankLabel: "Bank",    fit: true,  meals: false },
    { name: "Eleanor", bankLabel: "Bank",    fit: true,  meals: false },
    { name: "Grandma", bankLabel: "Finance", fit: false, meals: false },
  ];
  for (const c of cases){
    const { page, errors } = await newPage(browser, { user: c.name });
    await boot(page, { profiles: unmigratedRoster() });
    await page.waitForFunction(() => !!document.getElementById("bnav"), { timeout: 10000 });

    const state = await page.evaluate(() => {
      const bankBtn = [...document.querySelectorAll("#bnav .bnav-btn")].find((b) => b.dataset.gid === "bank");
      const fitBtn = [...document.querySelectorAll("#bnav .bnav-btn")].find((b) => b.dataset.gid === "fit");
      const mealsBtn = [...document.querySelectorAll("#bnav .bnav-btn")].find((b) => b.dataset.gid === "meals");
      return {
        bankLabel: bankBtn ? bankBtn.querySelector(".blabel").textContent.trim() : null,
        fitPresent: !!fitBtn,
        mealsPresent: !!mealsBtn,
      };
    });
    ok(state.bankLabel === c.bankLabel, `${c.name}: shared Bank/Finance nav reads "${c.bankLabel}" (got "${state.bankLabel}")`);
    ok(state.fitPresent === c.fit, `${c.name}: Fitness chip present = ${c.fit} (got ${state.fitPresent})`);
    ok(state.mealsPresent === c.meals, `${c.name}: Meals chip present = ${c.meals} (got ${state.mealsPresent})`);
    ok(errors.length === 0, `${c.name}: no page errors` + (errors.length ? ": " + errors[0] : ""));
  }
}

/* ==================== C. grant/deny overrides beat the role default ============== */
async function sectionOverrides(browser){
  section("C. Per-profile grant/deny overrides — deny beats grant beats the role default");

  const roster = [
    { id: "p1", frequency: "profile", name: "Aunt Sue", email: "sue@example.com", order: 1, pid: "auntsue", role: "extended", grant: ["kidBank"] },
    { id: "p2", frequency: "profile", name: "Teen",      email: "teen@example.com", order: 2, pid: "teen",    role: "kid",      deny: ["kidBank"] },
  ];
  const { page, errors } = await newPage(browser, { user: "Aunt Sue" });
  await boot(page, { profiles: roster });

  const sueKidBank = await page.evaluate(() => window.__IDENTITY__.can("kidBank", "Aunt Sue"));
  ok(sueKidBank === true, `an extended profile with grant:["kidBank"] sees Bank despite its role (got ${sueKidBank})`);
  const sueFinance = await page.evaluate(() => window.__IDENTITY__.can("seesFinance", "Aunt Sue"));
  ok(sueFinance === true, "…and still gets everything else her role provides (seesFinance)");

  const teenKidBank = await page.evaluate(() => window.__IDENTITY__.can("kidBank", "Teen"));
  ok(teenKidBank === false, `a kid profile with deny:["kidBank"] does NOT see Bank despite its role (got ${teenKidBank})`);
  const teenFit = await page.evaluate(() => window.__IDENTITY__.can("seesFit", "Teen"));
  ok(teenFit === true, "…but keeps every OTHER kid-role capability (seesFit) — deny is per-capability, not a role swap");

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
}

/* ============== D. "This is me" sets BOTH chorePid and choreUser ================= */
async function sectionPickMe(browser){
  section("D. Picking \"This is me\" sets pid alongside name");

  const { page, errors } = await newPage(browser, { user: null });
  await boot(page, { profiles: unmigratedRoster(), choreUser: null });

  await page.evaluate(() => { document.getElementById("whoBtn").click(); });
  await sleep(300);
  await page.evaluate(() => {
    const row = [...document.querySelectorAll("#familyList > div")].find((r) => r.textContent.includes("Isaac"));
    const btn = row && [...row.querySelectorAll("button")].find((b) => /this is me/i.test(b.textContent));
    if (btn) btn.click();
  });
  await sleep(300);

  const choreUser = await readLS(page, "choreUser");
  const chorePid = await readLS(page, "chorePid");
  ok(choreUser === "Isaac", `choreUser is set to the picked name (got "${choreUser}")`);
  ok(chorePid === "isaac", `chorePid is set to that profile's pid in the SAME click (got "${chorePid}")`);

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
}

/* =============== E. boot backfill: choreUser-only device gets chorePid ============ */
async function sectionBackfill(browser){
  section("E. Boot backfill — a device with only choreUser gets chorePid filled in");

  // Profiles already migrated (as if this were a family that upgraded a while ago); THIS
  // device just never had chorePid written (e.g. it picked "This is me" before this refactor
  // shipped, or a headless suite that only ever sets choreUser).
  const roster = unmigratedRoster(); // migrateIdentity() at boot mints pid/role anyway
  const { page, errors } = await newPage(browser, { user: "Eleanor" });
  await boot(page, { profiles: roster, choreUser: "Eleanor" });

  const chorePidBefore = await readLS(page, "chorePid");
  ok(chorePidBefore === "eleanor", `chorePid was backfilled to Eleanor's pid on boot with no user action (got "${chorePidBefore}")`);

  // The load-bearing proof this compat exists for: can() must resolve correctly even though
  // chorePid didn't exist until THIS boot backfilled it — i.e. capability resolution never
  // silently depended on a pid the device didn't have yet.
  const seesFit = await page.evaluate(() => window.__IDENTITY__.can("seesFit"));
  ok(seesFit === true, "…and can() for the CURRENT user resolves correctly right away (Eleanor sees Fit)");

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
}

/* ======= E2. a suite/device with NO profile docs at all still behaves correctly === */
async function sectionNoRosterFallback(browser){
  section("E2. choreUser with NO profile doc at all still resolves — the synthetic-profile fallback");

  const { page, errors } = await newPage(browser, { user: "Isaac" });
  await boot(page, { profiles: [], choreUser: "Isaac" }); // zero profile docs, exactly like an
                                                            // old suite that only ever set choreUser

  const results = await page.evaluate(() => ({
    kidBank: window.__IDENTITY__.can("kidBank"),
    seesFinance: window.__IDENTITY__.can("seesFinance"),
    seesFit: window.__IDENTITY__.can("seesFit"),
  }));
  ok(results.kidBank === true, `Isaac still resolves kidBank=true with zero profile docs seeded (got ${results.kidBank})`);
  ok(results.seesFinance === false, `…and seesFinance=false, same as always (got ${results.seesFinance})`);
  ok(results.seesFit === true, `…and seesFit=true (got ${results.seesFit})`);

  await page.waitForFunction(() => !!document.getElementById("bnav"), { timeout: 10000 });
  const bankLabel = await page.evaluate(() => {
    const b = [...document.querySelectorAll("#bnav .bnav-btn")].find((x) => x.dataset.gid === "bank");
    return b ? b.querySelector(".blabel").textContent.trim() : null;
  });
  ok(bankLabel === "Bank", `…and the real nav reads "Bank" for Isaac even with no profile docs (got "${bankLabel}")`);

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
}

/* ==================== F. new-profile pid minting ================================= */
async function sectionMintPid(browser){
  section("F. A brand-new profile mints its own pid (+ picks a role) at creation");

  const { page, errors } = await newPage(browser, { user: "Dad" });
  await boot(page, { profiles: unmigratedRoster() });

  // Roster mutations are PIN-gated (gateDadForRoster) even for the signed-in Dad — it never
  // trusts the stored device-unlock flag, always prompts fresh (see index.html's comment on
  // gateDadForRoster). Load two answers: covers BOTH "set a new PIN" (two prompts) and
  // "enter the existing PIN" (one prompt), whichever path dadConfigured() is on.
  await page.evaluate(() => { window.__PROMPTS__ = ["1234", "1234"]; });
  await page.evaluate(() => { document.getElementById("whoBtn").click(); });
  await sleep(200);
  await page.evaluate(() => {
    document.getElementById("famName").value = "Uncle Theo";
    document.getElementById("famEmail").value = "theo@example.com";
    document.getElementById("famRole").value = "extended";
  });
  await page.evaluate(() => { document.getElementById("famAddBtn").click(); });
  await sleep(300);

  const all = await readProfiles(page);
  const theo = all.find((p) => p.name === "Uncle Theo");
  ok(!!theo, "the new member was created");
  ok(!!theo && theo.pid === "uncletheo", `its pid is minted from the name, slugged with no separators (got "${theo && theo.pid}")`);
  ok(!!theo && theo.role === "extended", `its role is what the form picked (got "${theo && theo.role}")`);

  // Collision handling (checked directly — the family has no real same-slug pair today):
  // two people who'd slug to the same pid get a numeric suffix, never silently overwritten.
  const collide = await page.evaluate(() => ({
    first: window.__IDENTITY__.mintPid("Sam"),
    // mintPid only looks at EXISTING profiles, so simulate "Sam" already existing by minting
    // against the live roster after adding one — the real collision path is exercised via a
    // second add below.
  }));
  ok(collide.first === "sam", `mintPid("Sam") with no existing "sam" pid returns "sam" (got "${collide.first}")`);

  // gateDadForRoster ALWAYS re-prompts (never satisfied by the stored device unlock) — a
  // fresh PIN answer is needed before every single roster mutation, not just the first.
  await page.evaluate(() => { window.__PROMPTS__ = ["1234"]; });
  await page.evaluate(() => {
    document.getElementById("famName").value = "Sam";
    document.getElementById("famRole").value = "extended";
  });
  await page.evaluate(() => { document.getElementById("famAddBtn").click(); });
  await sleep(300);
  await page.evaluate(() => { window.__PROMPTS__ = ["1234"]; });
  await page.evaluate(() => {
    document.getElementById("famName").value = "Sam";
    document.getElementById("famRole").value = "extended";
  });
  await page.evaluate(() => { document.getElementById("famAddBtn").click(); });
  await sleep(300);

  const withSams = await readProfiles(page);
  const sams = withSams.filter((p) => p.name === "Sam");
  ok(sams.length === 2, `two same-named members were both created (${sams.length})`);
  ok(new Set(sams.map((p) => p.pid)).size === 2, `…with two DIFFERENT pids, never a silent collision (got ${JSON.stringify(sams.map((p) => p.pid))})`);
  ok(sams.some((p) => p.pid === "sam") && sams.some((p) => p.pid === "sam2"), `…specifically "sam" and "sam2" (got ${JSON.stringify(sams.map((p) => p.pid))})`);

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
}

/* ================= G. a rename never touches pid, role or grants ================= */
async function sectionRename(browser){
  section("G. A renamed profile keeps its identity (pid/role/grant untouched)");

  const roster = unmigratedRoster();
  // A pre-existing per-name doc, exactly like fitPlan_Isaac — seeded directly via the local
  // backend's setting_ convention, so we can prove the rename never destroys it.
  const extraSetting = { key: "setting_fitPlan_Isaac", value: JSON.stringify({ v: 1, rest: 30, days: { mon: { title: "Legs" } } }) };

  const { page, errors } = await newPage(browser, { user: "Dad" });
  await boot(page, { profiles: roster });
  await page.evaluate((s) => localStorage.setItem(s.key, s.value), extraSetting);

  const before = await readProfiles(page);
  const isaacBefore = before.find((p) => p.name === "Isaac");
  ok(!!isaacBefore && isaacBefore.pid === "isaac" && isaacBefore.role === "kid", "Isaac is migrated (pid=isaac, role=kid) before the rename");

  // Edit -> rename "Isaac" to "Zack" via the real roster-edit flow. Both the ✎ button (which
  // populates the form) and Save (saveFamilyMember) independently call gateDadForRoster, which
  // ALWAYS re-prompts (never satisfied by a stored unlock flag) — a fresh PIN answer is loaded
  // before each.
  await page.evaluate(() => { document.getElementById("whoBtn").click(); });
  await sleep(200);
  await page.evaluate(() => { window.__PROMPTS__ = ["1234", "1234"]; });
  await page.evaluate(() => {
    const row = [...document.querySelectorAll("#familyList > div")].find((r) => r.textContent.includes("Isaac"));
    const btn = row && [...row.querySelectorAll("button")].find((b) => b.innerHTML.includes("✎"));
    if (btn) btn.click();
  });
  await sleep(200);
  await page.evaluate(() => { document.getElementById("famName").value = "Zack"; });
  await page.evaluate(() => { window.__PROMPTS__ = ["1234"]; });
  await page.evaluate(() => { document.getElementById("famAddBtn").click(); });
  await sleep(300);

  const after = await readProfiles(page);
  const zack = after.find((p) => p.pid === "isaac");
  ok(!!zack && zack.name === "Zack", `the profile is now named "Zack" (got "${zack && zack.name}")`);
  ok(!!zack && zack.pid === "isaac", `…but its pid is UNCHANGED — still "isaac" (got "${zack && zack.pid}")`);
  ok(!!zack && zack.role === "kid", `…and its role is unchanged too (got "${zack && zack.role}")`);

  const capAfter = await page.evaluate(() => window.__IDENTITY__.can("kidBank", "isaac"));
  ok(capAfter === true, `capability lookup BY PID still resolves the renamed profile correctly (kidBank via pid "isaac" = ${capAfter})`);

  // The pre-existing per-name doc (fitPlan_Isaac) is a NAME-keyed legacy doc, unaffected by
  // this phase (myName()/per-user data keys stay display-only, per docs/identity.md's compat
  // note) — the rename must not have deleted or otherwise touched it.
  const settingAfter = await readLS(page, "setting_fitPlan_Isaac");
  ok(settingAfter === extraSetting.value, "the pre-existing fitPlan_Isaac doc is untouched by the rename (rename is non-destructive)");

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
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
    await sectionMigration(browser);
    await sectionCapabilityMatrix(browser);
    await sectionRealUI(browser);
    await sectionOverrides(browser);
    await sectionPickMe(browser);
    await sectionBackfill(browser);
    await sectionNoRosterFallback(browser);
    await sectionMintPid(browser);
    await sectionRename(browser);
  } catch (err) {
    fail++; failures.push("suite crashed: " + err.message);
    console.log("\n✗ SUITE ERROR: " + (err && err.stack || err));
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${"=".repeat(52)}`);
  console.log(`IDENTITY: ${pass}/${pass + fail} checks passed`);
  if (fail){ console.log("\nFailures:"); for (const f of failures) console.log("  ✗ " + f); }
  process.exit(fail ? 1 : 0);
})();
