#!/usr/bin/env node
"use strict";
/**
 * Headless verification for Farm Life P1 farming loop, UPDATED for the P1.5a
 * TOOL-BASED flow: equip hoe → till · equip seeds → plant · equip can → water
 * (with tank decrement) · equip hands → harvest · sell at the bin · buy at the
 * stand. Real-time growth + localStorage persistence unchanged.
 * Serves the REPO ROOT and loads /farmlife/dist/index.html. Blocks Firebase/
 * Playroom out of habit (pure localStorage). Desktop + mobile passes.
 *
 * TIME-INJECTION HOOK (P2 reuse): window.__FL__.farm._setTimeOffset(ms) /
 * ._addTimeOffset(ms) fast-forward growth deterministically.
 *
 * Run:  node farmlife/verify-p1.cjs        (from repo root)
 */
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require(path.resolve(__dirname, "..", "tools", "node_modules", "puppeteer-core"));

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const PORT = 8790;
const BASE = `http://127.0.0.1:${PORT}`;
const URL = BASE + "/farmlife/dist/index.html";

require("fs").mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: detail == null ? "" : String(detail) });
  console.log((cond ? "  ok  " : " FAIL ") + name + (detail != null ? "  → " + detail : ""));
}

function isOpen(port) {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host: "127.0.0.1" });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
    s.setTimeout(800, () => { s.destroy(); resolve(false); });
  });
}
async function waitServer(port, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await isOpen(port)) {
      try {
        await new Promise((res, rej) => {
          http.get({ host: "127.0.0.1", port, path: "/farmlife/dist/index.html", timeout: 1000 }, (r) => { r.resume(); res(); }).on("error", rej);
        });
        return;
      } catch (_) {}
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server timeout");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bootPage(browser, mobile) {
  const page = await browser.newPage();
  await page.setViewport(
    mobile ? { width: 390, height: 844, deviceScaleFactor: 2 } : { width: 1280, height: 800, deviceScaleFactor: 1 }
  );
  if (mobile) {
    await page.evaluateOnNewDocument(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (q) => {
        if (String(q).includes("pointer: coarse") || String(q).includes("pointer:coarse")) {
          return { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, onchange: null, dispatchEvent() { return false; } };
        }
        return real(q);
      };
    });
  }
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  await page.setRequestInterception(true);
  // Deterministic OFF for fast-grow (test mode defaults ON) so growth timelines
  // read on the REAL clock in these suites. Merges over any existing tune.
  await page.evaluateOnNewDocument(() => { try { const _t = JSON.parse(localStorage.getItem("fl_tune_v1") || "{}"); _t.fastGrow = false; localStorage.setItem("fl_tune_v1", JSON.stringify(_t)); } catch (_) {} });
  page.on("request", (req) => {
    if (/playroom|googleapis|firestore|firebase|gstatic/i.test(req.url())) return req.abort();
    req.continue();
  });
  await page.goto(URL, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.__FL__ && window.__FL__.farm && typeof window.__FL__.farm.state === "function", { timeout: 20000 });
  await sleep(400);
  return { page, errors };
}

// Stand 1.6m south of the tile center, heading 0 (facing +Z).
async function faceTile(page, gx, gz) {
  await page.evaluate((gx, gz) => {
    const FL = window.__FL__;
    const ORIGIN_X = -6 - 12, ORIGIN_Z = 6 - 12, TILE = 2;
    const x = ORIGIN_X + TILE * (gx + 0.5);
    const z = ORIGIN_Z + TILE * (gz + 0.5);
    FL.farm.teleport(x, z - 1.6);
    FL.farm.setHeading(0);
  }, gx, gz);
  await sleep(120);
}
async function equip(page, tool) {
  await page.evaluate((t) => window.__FL__.farm.equip(t), tool);
  await sleep(60);
}
// Wait out any in-flight tool-use animation so the next action isn't ignored.
async function waitIdle(page) {
  await page.waitForFunction(() => !window.__FL__.avatar.isBusy(), { timeout: 3000 }).catch(() => {});
}

async function main() {
  let server = null;
  if (!(await isOpen(PORT))) {
    server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1"], { cwd: ROOT, stdio: "ignore", shell: true });
  }
  await waitServer(PORT, 20000);

  const browser = await puppeteer.launch({
    channel: "chrome",
    headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });

  // ============================= DESKTOP =============================
  console.log("\n=== DESKTOP 1280×800 — full tool-based farming loop ===");
  const { page, errors } = await bootPage(browser, false);

  await page.evaluate(() => localStorage.removeItem("fl_farm_v1"));
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__FL__ && window.__FL__.farm && typeof window.__FL__.farm.state === "function", { timeout: 20000 });
  await sleep(400);

  const HOUR = 3_600_000;
  const GX = 6, GZ = 6;

  const s0 = await page.evaluate(() => window.__FL__.farm.state());
  check(
    "fresh state: 100 coins, 5 turnip seeds, crop=turnip, tool=hoe, tank=6",
    s0.coins === 100 && s0.seeds.turnip === 5 && s0.selectedCrop === "turnip" && s0.selectedTool === "hoe" && s0.tank === 6,
    JSON.stringify({ coins: s0.coins, seeds: s0.seeds.turnip, crop: s0.selectedCrop, tool: s0.selectedTool, tank: s0.tank })
  );

  // ---- till (hoe equipped by default) ----
  await equip(page, "hoe");
  await faceTile(page, GX, GZ);
  const t0 = await page.evaluate(() => window.__FL__.farm.target());
  check("hoe on untouched tile: target resolves to till", t0 && t0.gx === GX && t0.gz === GZ && t0.kind === "till", JSON.stringify(t0));
  await page.evaluate(() => window.__FL__.farm.action());
  await waitIdle(page);
  let tile = await page.evaluate((gx, gz) => window.__FL__.farm.tileAt(gx, gz), GX, GZ);
  check("till: tile present + tilled, no crop", tile.present && tile.tilled && tile.crop === null, JSON.stringify(tile));

  // ---- wrong tool hint (hands on tilled tile wants seeds) ----
  await equip(page, "hands");
  await faceTile(page, GX, GZ);
  const hintTgt = await page.evaluate(() => window.__FL__.farm.target());
  check("wrong tool (hands on tilled): resolves to a hint, not an action", hintTgt && hintTgt.kind === "hint" && hintTgt.hint === true, JSON.stringify(hintTgt));

  // ---- plant (seeds equipped) ----
  await equip(page, "seeds");
  await faceTile(page, GX, GZ);
  const tgtPlant = await page.evaluate(() => window.__FL__.farm.target());
  check("seeds on tilled tile: target resolves to plant (turnip)", tgtPlant && tgtPlant.kind === "plant" && tgtPlant.cropId === "turnip", JSON.stringify(tgtPlant));
  await page.evaluate(() => window.__FL__.farm.action());
  await waitIdle(page);
  tile = await page.evaluate((gx, gz) => window.__FL__.farm.tileAt(gx, gz), GX, GZ);
  const sAfterPlant = await page.evaluate(() => window.__FL__.farm.state());
  check("plant: tile has turnip crop at stage 0", tile.crop === "turnip" && tile.stage === 0, JSON.stringify(tile));
  check("plant: seed count decremented 5 -> 4", sAfterPlant.seeds.turnip === 4, sAfterPlant.seeds.turnip);

  // ---- water x3 with the can, tank decrements each time ----
  await equip(page, "can");
  let prevTank = (await page.evaluate(() => window.__FL__.farm.state())).tank;
  for (let i = 1; i <= 3; i++) {
    await page.evaluate(() => window.__FL__.farm._addTimeOffset(3600001)); // 1h + 1ms
    await faceTile(page, GX, GZ);
    const tgt = await page.evaluate(() => window.__FL__.farm.target());
    check(`watering step ${i}: can on thirsty crop resolves to water`, tgt && tgt.kind === "water", JSON.stringify(tgt));
    await page.evaluate(() => window.__FL__.farm.action());
    await waitIdle(page);
    const tank = (await page.evaluate(() => window.__FL__.farm.tank()));
    check(`watering step ${i}: tank decremented (${prevTank} -> ${tank})`, tank === prevTank - 1, `tank=${tank}`);
    prevTank = tank;
  }
  tile = await page.evaluate((gx, gz) => window.__FL__.farm.tileAt(gx, gz), GX, GZ);
  check("after 3 waterings (3h/4h banked): stage is 2, not ready yet", tile.stage === 2, JSON.stringify(tile));

  // ---- growth-pause control tile (2,2), never watered ----
  const PGX = 2, PGZ = 2;
  await equip(page, "hoe");
  await faceTile(page, PGX, PGZ);
  await page.evaluate(() => window.__FL__.farm.action()); // till
  await waitIdle(page);
  await equip(page, "seeds");
  await faceTile(page, PGX, PGZ);
  await page.evaluate(() => window.__FL__.farm.action()); // plant (turnip)
  await waitIdle(page);
  await page.evaluate(() => window.__FL__.farm._addTimeOffset(3600002)); // just past the 1h grace window
  const pausedAtBoundary = await page.evaluate((gx, gz) => window.__FL__.farm.tileAt(gx, gz), PGX, PGZ);
  await page.evaluate((h) => window.__FL__.farm._addTimeOffset(h * 20), HOUR);
  const pausedMuchLater = await page.evaluate((gx, gz) => window.__FL__.farm.tileAt(gx, gz), PGX, PGZ);
  check(
    "unwatered tile pauses: stage identical at boundary and much later (never ready)",
    pausedAtBoundary.stage === pausedMuchLater.stage && pausedMuchLater.stage !== "ready",
    `boundary=${pausedAtBoundary.stage} muchLater=${pausedMuchLater.stage}`
  );

  // ---- main tile reaches ready purely from elapsed time ----
  await page.evaluate((h) => window.__FL__.farm._addTimeOffset(h), HOUR);
  tile = await page.evaluate((gx, gz) => window.__FL__.farm.tileAt(gx, gz), GX, GZ);
  check("tile reads 'ready' purely from elapsed time (no action taken)", tile.stage === "ready", JSON.stringify(tile));

  // ---- harvest (hands equipped) ----
  await equip(page, "hands");
  await faceTile(page, GX, GZ);
  const tgtHarvest = await page.evaluate(() => window.__FL__.farm.target());
  check("hands on ready tile: target resolves to harvest", tgtHarvest && tgtHarvest.kind === "harvest" && tgtHarvest.cropId === "turnip", JSON.stringify(tgtHarvest));
  await page.evaluate(() => window.__FL__.farm.action());
  await waitIdle(page);
  tile = await page.evaluate((gx, gz) => window.__FL__.farm.tileAt(gx, gz), GX, GZ);
  const sAfterHarvest = await page.evaluate(() => window.__FL__.farm.state());
  check("harvest: inventory +1 turnip, tile back to bare tilled soil", sAfterHarvest.crops.turnip === 1 && tile.crop === null && tile.tilled, JSON.stringify({ crops: sAfterHarvest.crops, tile }));

  // ---- sell at the shipping bin ----
  const binPos = await page.evaluate(() => window.__FL__.farm.binPos);
  await page.evaluate((x, z) => window.__FL__.farm.teleport(x, z), binPos.x, binPos.z);
  await sleep(140);
  const tgtSell = await page.evaluate(() => window.__FL__.farm.target());
  check("near the shipping bin with crops held: action resolves to sell", tgtSell && tgtSell.kind === "sell", JSON.stringify(tgtSell));
  const coinsBeforeSell = (await page.evaluate(() => window.__FL__.farm.state())).coins;
  await page.evaluate(() => window.__FL__.farm.action());
  await sleep(80);
  const sAfterSell = await page.evaluate(() => window.__FL__.farm.state());
  check("sell: coins +18 (turnip sellPrice), inventory cleared", sAfterSell.coins === coinsBeforeSell + 18 && sAfterSell.crops.turnip === 0, `coins ${coinsBeforeSell}->${sAfterSell.coins}`);

  // ---- shop at the seed stand ----
  const standPos = await page.evaluate(() => window.__FL__.farm.standPos);
  await page.evaluate((x, z) => window.__FL__.farm.teleport(x, z), standPos.x, standPos.z);
  await sleep(200);
  const shopOpen = await page.evaluate(() => window.__FL__.farm.isShopOpen());
  check("proximity to seed stand opens the shop", shopOpen, shopOpen);
  const coinsBeforeBuy = (await page.evaluate(() => window.__FL__.farm.state())).coins;
  const potatoSeedsBefore = (await page.evaluate(() => window.__FL__.farm.state())).seeds.potato;
  const bought = await page.evaluate(() => {
    const rows = document.querySelectorAll("#fl-shop-rows .row");
    const btn = rows[1].querySelector("button.buy"); // potato
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  });
  await sleep(80);
  const sAfterBuy = await page.evaluate(() => window.__FL__.farm.state());
  check("buy via real DOM shop button: clicked", bought, bought);
  check(
    "buy: coins -22 (potato seedCost), potato seeds +1",
    sAfterBuy.coins === coinsBeforeBuy - 22 && sAfterBuy.seeds.potato === potatoSeedsBefore + 1,
    `coins ${coinsBeforeBuy}->${sAfterBuy.coins} seeds ${potatoSeedsBefore}->${sAfterBuy.seeds.potato}`
  );

  // shop CLOSE button must STAY closed while STILL standing at the stand
  // (playtest fix — the proximity loop used to reopen it on the very next frame).
  await page.evaluate(() => { const b = document.querySelector("#fl-shop button.close"); if (b) b.click(); });
  await sleep(400); // several proximity frames
  const stayedClosed = await page.evaluate(() => window.__FL__.farm.isShopOpen());
  check("shop Close button stays closed while standing at the stand", !stayedClosed, `open=${stayedClosed}`);

  await page.evaluate(() => window.__FL__.farm.teleport(0, 40));
  await sleep(200);
  const shopClosedAfterWalk = await page.evaluate(() => window.__FL__.farm.isShopOpen());
  check("walking away from the stand closes the shop", !shopClosedAfterWalk, shopClosedAfterWalk);

  // returning to the stand re-opens it (the dismiss latch clears on walk-away)
  await page.evaluate((x, z) => window.__FL__.farm.teleport(x, z), standPos.x, standPos.z);
  await sleep(300);
  const reopened = await page.evaluate(() => window.__FL__.farm.isShopOpen());
  check("returning to the stand re-opens the shop (dismiss latch cleared)", reopened, `open=${reopened}`);

  // ---- tool hotbar selection via DOM + keyboard ----
  await page.evaluate(() => {
    document.querySelector('.fl-slot[data-tool="can"]').dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  await sleep(60);
  const selCan = await page.evaluate(() => window.__FL__.farm.selectedTool());
  check("hotbar tap selects the watering can", selCan === "can", selCan);
  await page.keyboard.press("2"); // TOOL_ORDER[1] = hoe
  await sleep(60);
  const selHoe = await page.evaluate(() => window.__FL__.farm.selectedTool());
  check("hotbar '2' key selects the hoe", selHoe === "hoe", selHoe);

  // ---- seed-pouch crop cycle ----
  await page.evaluate(() => window.__FL__.farm.selectCrop("turnip"));
  await equip(page, "seeds");
  await page.evaluate(() => {
    document.querySelector('.fl-slot[data-tool="seeds"]').dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  await sleep(60);
  const cropAfterCycle = (await page.evaluate(() => window.__FL__.farm.state())).selectedCrop;
  check("tapping the seed slot again cycles the crop (turnip -> potato)", cropAfterCycle === "potato", cropAfterCycle);

  // ---- persistence across reload ----
  await page.evaluate(() => window.__FL__.farm.selectCrop("turnip"));
  const snapshotBefore = await page.evaluate(() => window.__FL__.farm.state());
  await page.evaluate(() => window.__FL__.farm.flushSave());
  await sleep(100);
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__FL__ && window.__FL__.farm && typeof window.__FL__.farm.state === "function", { timeout: 20000 });
  await sleep(400);
  const snapshotAfter = await page.evaluate(() => window.__FL__.farm.state());
  check(
    "reload mid-state: coins/seeds/crops/tiles/tool/tank identical",
    snapshotBefore.coins === snapshotAfter.coins &&
      JSON.stringify(snapshotBefore.seeds) === JSON.stringify(snapshotAfter.seeds) &&
      JSON.stringify(snapshotBefore.crops) === JSON.stringify(snapshotAfter.crops) &&
      JSON.stringify(snapshotBefore.tiles) === JSON.stringify(snapshotAfter.tiles) &&
      snapshotBefore.selectedTool === snapshotAfter.selectedTool &&
      snapshotBefore.tank === snapshotAfter.tank,
    `tool ${snapshotBefore.selectedTool}->${snapshotAfter.selectedTool} tank ${snapshotBefore.tank}->${snapshotAfter.tank}`
  );

  // ---- migration: an old v1 save with `selectedSeed` and no tool/tank ----
  // Use a FRESH page that injects the legacy save at document-start, so the
  // live page's pagehide-flush can't clobber the injected value on a reload.
  {
    const migPage = await browser.newPage();
    await migPage.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await migPage.setRequestInterception(true);
    await migPage.evaluateOnNewDocument(() => { try { const _t = JSON.parse(localStorage.getItem("fl_tune_v1") || "{}"); _t.fastGrow = false; localStorage.setItem("fl_tune_v1", JSON.stringify(_t)); } catch (_) {} });
    migPage.on("request", (req) => {
      if (/playroom|googleapis|firestore|firebase|gstatic/i.test(req.url())) return req.abort();
      req.continue();
    });
    await migPage.evaluateOnNewDocument((legacy) => {
      try { localStorage.setItem("fl_farm_v1", legacy); } catch (e) {}
    }, JSON.stringify({
      tiles: {}, seeds: { turnip: 3, potato: 0, corn: 0, pumpkin: 0 },
      crops: { turnip: 0, potato: 0, corn: 0, pumpkin: 0 }, coins: 55, selectedSeed: "corn",
    }));
    await migPage.goto(URL, { waitUntil: "load", timeout: 60000 });
    await migPage.waitForFunction(() => window.__FL__ && window.__FL__.farm && typeof window.__FL__.farm.state === "function", { timeout: 20000 });
    await sleep(400);
    const migrated = await migPage.evaluate(() => window.__FL__.farm.state());
    check(
      "legacy v1 save migrates: selectedSeed -> selectedCrop, tool/tank default in",
      migrated.coins === 55 && migrated.selectedCrop === "corn" && migrated.selectedTool === "hoe" && migrated.tank === 6,
      JSON.stringify({ coins: migrated.coins, crop: migrated.selectedCrop, tool: migrated.selectedTool, tank: migrated.tank })
    );
    await migPage.close();
  }

  // ---- staged shot: several tiles at different crop/stage combos ----
  await page.evaluate(() => localStorage.removeItem("fl_farm_v1"));
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__FL__ && window.__FL__.farm && typeof window.__FL__.farm.state === "function", { timeout: 20000 });
  await sleep(400);
  await page.evaluate(() => {
    window.__FL__.farm.buySeed("turnip");
    window.__FL__.farm.buySeed("turnip");
    window.__FL__.farm.buySeed("corn");
  });
  const plot = async (gx, gz, crop, waterings, stepMs) => {
    await equip(page, "hoe");
    await faceTile(page, gx, gz);
    await page.evaluate(() => window.__FL__.farm.action()); // till
    await waitIdle(page);
    await page.evaluate((c) => window.__FL__.farm.selectCrop(c), crop);
    await equip(page, "seeds");
    await faceTile(page, gx, gz);
    await page.evaluate(() => window.__FL__.farm.action()); // plant
    await waitIdle(page);
    await equip(page, "can");
    for (let i = 0; i < waterings; i++) {
      await page.evaluate((ms) => window.__FL__.farm._addTimeOffset(ms), stepMs);
      await faceTile(page, gx, gz);
      await page.evaluate(() => window.__FL__.farm.action()); // water
      await waitIdle(page);
      await page.evaluate(() => window.__FL__.farm._addTimeOffset(-0)); // no-op keep offset
    }
    // refill so the tank never runs dry across the staged plots
    await page.evaluate((x, z) => window.__FL__.farm.teleport(x, z), 30, -20);
    await sleep(60);
    await page.evaluate(() => window.__FL__.farm.action());
    await waitIdle(page);
  };
  await plot(3, 3, "turnip", 0, 0);
  await plot(4, 3, "turnip", 2, HOUR + 1);
  await plot(5, 3, "corn", 1, 6 * HOUR + 1);

  // camera: stand south of the staged cluster, facing north into the field
  await page.evaluate(() => {
    window.__FL__.farm.teleport(-9, -1);
    window.__FL__.farm.setHeading(0);
    window.__FL__._setYaw(0);
    window.__FL__._setPitch(0.5);
    window.__FL__.farm.equip("hoe");
  });
  await sleep(500);

  await page.screenshot({ path: path.join(SHOTS, "farmlife-p1-desktop.png") });
  const realErr = errors.filter((e) => !/favicon|Failed to load resource/i.test(e));
  check("desktop: 0 pageerrors", realErr.length === 0, realErr.join(" | "));
  await page.close();

  // ============================= MOBILE =============================
  console.log("\n=== MOBILE 390×844 (coarse pointer) ===");
  const m = await bootPage(browser, true);
  const mp = m.page;
  await mp.evaluate(() => localStorage.removeItem("fl_farm_v1"));
  await mp.reload({ waitUntil: "load" });
  await mp.waitForFunction(() => window.__FL__ && window.__FL__.farm && typeof window.__FL__.farm.state === "function", { timeout: 20000 });
  await sleep(400);

  const actionBtnVisible = await mp.evaluate(() => getComputedStyle(document.getElementById("fl-actionbtn")).display);
  check("mobile: action button visible", actionBtnVisible === "flex", actionBtnVisible);

  // default tool is hoe -> tapping action tills
  await faceTile(mp, 4, 4);
  await mp.evaluate(() => document.getElementById("fl-actionbtn").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
  await waitIdle(mp);
  const mTile = await mp.evaluate((gx, gz) => window.__FL__.farm.tileAt(gx, gz), 4, 4);
  check("mobile: tapping the action button uses the equipped tool (hoe tills)", mTile.present && mTile.tilled, JSON.stringify(mTile));

  // tool hotbar tappable
  await mp.evaluate(() => document.querySelector('.fl-slot[data-tool="can"]').dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
  await sleep(60);
  const mSel = await mp.evaluate(() => window.__FL__.farm.selectedTool());
  check("mobile: tool hotbar is tappable (selected can)", mSel === "can", mSel);

  const mStandPos = await mp.evaluate(() => window.__FL__.farm.standPos);
  await mp.evaluate((x, z) => window.__FL__.farm.teleport(x, z), mStandPos.x, mStandPos.z);
  await sleep(200);
  const mShopOpen = await mp.evaluate(() => window.__FL__.farm.isShopOpen());
  check("mobile: shop opens by proximity", mShopOpen, mShopOpen);
  const mBought = await mp.evaluate(() => {
    const btn = document.querySelectorAll("#fl-shop-rows .row")[0].querySelector("button.buy");
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  });
  check("mobile: shop buy button usable", mBought, mBought);
  await mp.evaluate(() => window.__FL__.farm.closeShop());

  // P0 regression: joystick + orbit still work with tool HUD / buttons on top
  await mp.evaluate(() => window.__FL__.farm.teleport(0, 40));
  await sleep(80);
  const beforeM = await mp.evaluate(() => ({ x: window.__FL__.player.x, z: window.__FL__.player.z }));
  await mp.evaluate(async () => {
    const sz = document.getElementById("fl-stickzone");
    const send = (type, id, x, y) => {
      const ev = new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true });
      (type === "pointerdown" ? sz : window).dispatchEvent(ev);
    };
    send("pointerdown", 1, 100, 500);
    for (let i = 0; i < 20; i++) { send("pointermove", 1, 100, 500 - i * 6); await new Promise((r) => setTimeout(r, 16)); }
    await new Promise((r) => setTimeout(r, 900));
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true }));
  });
  const afterM = await mp.evaluate(() => ({ x: window.__FL__.player.x, z: window.__FL__.player.z }));
  const movedM = Math.hypot(afterM.x - beforeM.x, afterM.z - beforeM.z);
  check("mobile regression: joystick still moves the player", movedM > 1.5, `moved=${movedM.toFixed(2)}m`);

  const myaw0 = await mp.evaluate(() => window.__FL__.cam.yaw);
  await mp.evaluate(async () => {
    const oz = document.getElementById("fl-orbitzone");
    const send = (type, id, x, y) => {
      const ev = new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true });
      (type === "pointerdown" ? oz : window).dispatchEvent(ev);
    };
    send("pointerdown", 2, 130, 400);
    for (let i = 0; i < 20; i++) { send("pointermove", 2, 130 - i * 8, 400); await new Promise((r) => setTimeout(r, 16)); }
    send("pointerup", 2, -30, 400);
  });
  const myaw1 = await mp.evaluate(() => window.__FL__.cam.yaw);
  check("mobile regression: right-side drag still orbits camera", Math.abs(myaw1 - myaw0) > 0.2, `yaw ${myaw0.toFixed(2)}→${myaw1.toFixed(2)}`);

  await mp.screenshot({ path: path.join(SHOTS, "farmlife-p1-mobile.png") });
  const realErrM = m.errors.filter((e) => !/favicon|Failed to load resource/i.test(e));
  check("mobile: 0 pageerrors", realErrM.length === 0, realErrM.join(" | "));
  await mp.close();

  await browser.close();
  if (server) try { process.kill(server.pid); } catch (_) {}

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  console.log("shots: shots/farmlife-p1-desktop.png, shots/farmlife-p1-mobile.png");
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
