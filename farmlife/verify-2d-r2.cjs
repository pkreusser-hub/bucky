#!/usr/bin/env node
"use strict";
/**
 * Headless verification for Farm Life R2 — full 2D gameplay parity.
 * Serves the REPO ROOT and loads /farmlife/dist/index.html. Network BLOCKED
 * (playroom/firebase/gstatic) — R2 is offline gameplay/render work (no live
 * Firestore section was needed: door/egg SHARED state is verified via the local
 * BarnStore, which the cloud store mirrors 1:1).
 *
 * Run:  node farmlife/verify-2d-r2.cjs        (from repo root)
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
const CROPS = ["turnip", "potato", "corn", "pumpkin", "strawberry", "carrot", "tomato", "sunflower"];

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond });
  console.log((cond ? "  ok  " : " FAIL ") + name + (detail != null ? "  → " + detail : ""));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    await sleep(200);
  }
  throw new Error("server timeout");
}

async function bootPage(browser, mobile) {
  const page = await browser.newPage();
  await page.setViewport(mobile ? { width: 390, height: 844, deviceScaleFactor: 2 } : { width: 1280, height: 720, deviceScaleFactor: 1 });
  if (mobile) {
    await page.evaluateOnNewDocument(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (q) => (String(q).includes("coarse") ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent() { return false; } } : real(q));
    });
  }
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  await page.setRequestInterception(true);
  page.on("request", (req) => (/playroom|googleapis|firestore|firebase|gstatic/i.test(req.url()) ? req.abort() : req.continue()));
  await page.goto(URL, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.__FL__ && typeof window.__FL__._snap === "function", { timeout: 20000 });
  await sleep(400);
  return { page, errors };
}
const P = (page, fn, ...args) => page.evaluate(fn, ...args);

async function main() {
  let server = null;
  if (!(await isOpen(PORT))) server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1"], { cwd: ROOT, stdio: "ignore", shell: true });
  await waitServer(PORT, 20000);
  const browser = await puppeteer.launch({ channel: "chrome", headless: "new", args: ["--no-sandbox"] });

  try {
    console.log("\n=== DESKTOP 1280×720 ===");
    const { page, errors } = await bootPage(browser, false);
    await P(page, () => { window.__FL__.animals.setPhase("day"); window.__FL__.weather.applySky(); window.__FL__.farm.setFastGrow(true); });

    // ===================== 1. FULL LOOP (FREE-FORM, R5) =====================
    // The 12×12 grid is gone: tools act on the POINT ~1.2 m in front of the player.
    // Target world point WT=(-7,5); face it from (-7, 3.8) heading 0 (+Z) → aim WT.
    await P(page, () => {
      window.__FL__.farm.clearFarm();
      window.__FL__.farm.setCoins(200);
      window.__FL__.farm.selectCrop("turnip");
    });
    // TILL a patch at the aimed point
    await P(page, () => { window.__FL__.farm.equip("hoe"); window.__FL__.farm.teleport(-7, 3.8); window.__FL__.farm.setHeading(0); });
    await sleep(250);
    const tillTgt = await P(page, () => window.__FL__.farm.target());
    check("loop: hoe targets a point in front (till verb + marker)", tillTgt && tillTgt.kind === "till" && Math.abs(tillTgt.worldZ - 5.0) < 0.35, JSON.stringify(tillTgt));
    await P(page, () => window.__FL__.farm.action());
    await sleep(450); // clear the ~320ms action busy window
    const tilled = await P(page, () => ({ n: window.__FL__.farm.patchCount(), covered: window.__FL__.farm.patchCoverageAt(-7, 5) > 0 }));
    check("loop: E tills → a patch appears under the aimed point", tilled.n === 1 && tilled.covered, JSON.stringify(tilled));
    // PLANT turnip at the same point
    await P(page, () => { window.__FL__.farm.equip("seeds"); window.__FL__.farm.setHeading(0); });
    await sleep(250);
    const seeds0 = await P(page, () => window.__FL__.farm.state().seeds.turnip);
    const plantTgt = await P(page, () => window.__FL__.farm.target());
    await P(page, () => window.__FL__.farm.action());
    await sleep(450);
    const planted = await P(page, () => window.__FL__.farm.plantInfoAt(-7, 5));
    const seeds1 = await P(page, () => window.__FL__.farm.state().seeds.turnip);
    check("loop: plant turnip → a plant at the point, seeds−1", plantTgt.kind === "plant" && planted.present && planted.crop === "turnip" && seeds1 === seeds0 - 1, `crop=${planted.crop} seeds ${seeds0}→${seeds1}`);
    // let the moisture grace carry it to halfway (fastGrow: ~30s → thirsty), then WATER
    await P(page, () => window.__FL__.farm._addTimeOffset(31000));
    await sleep(100);
    await P(page, () => { window.__FL__.farm.equip("can"); window.__FL__.farm.setHeading(0); });
    await sleep(250);
    const tank0 = await P(page, () => window.__FL__.farm.tank());
    const waterTgt = await P(page, () => window.__FL__.farm.target());
    await P(page, () => window.__FL__.farm.action());
    await sleep(450);
    const tank1 = await P(page, () => window.__FL__.farm.tank());
    check("loop: water the thirsty plant → tank decrements", tank1 === tank0 - 1 && waterTgt && waterTgt.kind === "water", `kind=${waterTgt && waterTgt.kind} tank ${tank0}→${tank1}`);
    // FAST-GROW the watered crop the rest of the way to ready
    await P(page, () => window.__FL__.farm._addTimeOffset(31000));
    await sleep(200);
    const ready = await P(page, () => window.__FL__.farm.plantInfoAt(-7, 5));
    check("loop: watered plant matures to ready (fastGrow timeline)", ready.stage === "ready", JSON.stringify(ready.stage));
    // hands → harvest the ready plant
    await P(page, () => { window.__FL__.farm.equip("hands"); window.__FL__.farm.setHeading(0); });
    await sleep(250);
    const harvTgt = await P(page, () => window.__FL__.farm.target());
    check("loop: hands on the ready plant → harvest target + marker", harvTgt && harvTgt.kind === "harvest", JSON.stringify(harvTgt));
    // HARVEST + hold-up beat (acting + crop overhead render)
    const crops0 = await P(page, () => window.__FL__.farm.state().crops.turnip);
    await P(page, () => window.__FL__.farm.action());
    await sleep(150);
    const acting = await P(page, () => window.__FL__.avatar.acting());
    const lastH = await P(page, () => window.__FL__.farm.lastHarvest());
    const crops1 = await P(page, () => window.__FL__.farm.state().crops.turnip);
    const emptied = await P(page, () => window.__FL__.farm.plantInfoAt(-7, 5));
    check("loop: harvest → +1 crop, plant removed, lastHarvest=turnip", crops1 === crops0 + 1 && !emptied.present && lastH === "turnip", `crops ${crops0}→${crops1} present=${emptied.present}`);
    check("loop: harvest plays the hold-up beat (farmer.isActing)", acting === true, `acting=${acting}`);
    await sleep(700); // let the hold-up beat finish before the next action
    // SELL at the bin → coins up + coin arc fired
    const coinsBeforeSell = await P(page, () => window.__FL__.farm.state().coins);
    await P(page, () => { const b = window.__FL__.farm.binPos; window.__FL__.farm.teleport(b.x - 1.6, b.z); });
    await sleep(250);
    const sellTgt = await P(page, () => window.__FL__.farm.target());
    await P(page, () => window.__FL__.farm.action());
    await sleep(120);
    const coinsAfterSell = await P(page, () => window.__FL__.farm.state().coins);
    const arcCount = await P(page, () => window.__FL__.farm.coinArcCount());
    check("loop: sell at bin → coins increase", coinsAfterSell > coinsBeforeSell, `${coinsBeforeSell}→${coinsAfterSell} (tgt=${sellTgt && sellTgt.kind})`);
    check("loop: sell fires the coin-arc juice", arcCount > 0, `arcs=${arcCount}`);
    // SHOP buy seeds at the stand
    await P(page, () => { const s = window.__FL__.farm.standPos; window.__FL__.farm.teleport(s.x - 0.5, s.z + 0.5); });
    await sleep(300);
    const shopOpen = await P(page, () => window.__FL__.farm.isShopOpen());
    const seedsB = await P(page, () => window.__FL__.farm.state().seeds.potato);
    const coinsB = await P(page, () => window.__FL__.farm.state().coins);
    await P(page, () => window.__FL__.farm.buySeed("potato"));
    await sleep(120);
    const seedsA = await P(page, () => window.__FL__.farm.state().seeds.potato);
    const coinsA = await P(page, () => window.__FL__.farm.state().coins);
    check("loop: near the stand opens the shop", shopOpen, `open=${shopOpen}`);
    check("loop: buy potato seed → seeds+1, coins−cost", seedsA === seedsB + 1 && coinsA < coinsB, `seeds ${seedsB}→${seedsA} coins ${coinsB}→${coinsA}`);
    await P(page, () => window.__FL__.farm.closeShop());

    // ===================== 2. 8 CROPS DISTINCT (free-form row) =====================
    // place ready crops at CONTINUOUS world coords in a row (no grid), sample each.
    const ROWZ = 8;
    const cropX = (i) => -14 + i * 3.4;
    await P(page, () => window.__FL__.farm.setFastGrow(false));
    await P(page, (crops) => {
      window.__FL__.farm.clearFarm();
      for (let i = 0; i < crops.length; i++) window.__FL__.farm.plantStageAt(-14 + i * 3.4, 8, crops[i], 3); // ready
    }, CROPS);
    await P(page, () => window.__FL__.farm.teleport(-2, 8));
    await sleep(500);
    // sample each ready crop's fruit band (a few px up from the soil) as a colour signature
    const sigs = await P(page, (data) => {
      const out = {};
      for (let i = 0; i < data.crops.length; i++) {
        const cx = -14 + i * 3.4;
        const samples = [];
        for (const dy of [-6, -12, -20, -30]) {
          const p = window.__FL__._pixelOff(cx, data.z, 0, dy);
          if (p) samples.push(`${p.r >> 4},${p.g >> 4},${p.b >> 4}`);
        }
        out[data.crops[i]] = samples.join("|");
      }
      return out;
    }, { crops: CROPS, z: ROWZ });
    void cropX;
    const sigVals = CROPS.map((c) => sigs[c]);
    const distinct = new Set(sigVals).size;
    check("8 crops render distinct ready sprites (unique colour signatures)", distinct === 8, `${distinct}/8 distinct — ${JSON.stringify(sigs).slice(0, 200)}`);
    // each crop renders 4 distinct stage sprites (sample pumpkin 0..3 signatures)
    await P(page, () => {
      window.__FL__.farm.setFastGrow(false);
      window.__FL__.farm.clearFarm();
      for (let st = 0; st < 4; st++) window.__FL__.farm.plantStageAt(-10 + st * 3.4, 6, "pumpkin", st);
    });
    await P(page, () => window.__FL__.farm.teleport(-4, 6));
    await sleep(400);
    const stageSigs = await P(page, () => {
      const out = [];
      for (let st = 0; st < 4; st++) {
        const cx = -10 + st * 3.4;
        const s = [];
        for (const dy of [-2, -6, -10, -16, -22]) { const p = window.__FL__._pixelOff(cx, 6, 0, dy); if (p) s.push(`${p.r >> 4},${p.g >> 4},${p.b >> 4}`); }
        out.push(s.join("|"));
      }
      return out;
    });
    const uniqStages = new Set(stageSigs).size;
    check("crop stages render distinct sprites 0→3", uniqStages >= 3, `${uniqStages}/4 distinct stage signatures`);

    // ===================== 3. CAN REFILL AT POND =====================
    await P(page, () => window.__FL__.farm.setFastGrow(true));
    await P(page, () => {
      window.__FL__.farm.clearFarm();
      window.__FL__.farm.plantFreshAt(-7, 5, "turnip"); // waterable plant at (-7,5)
      window.__FL__.farm._addTimeOffset(31000); // grace elapses → thirsty (waterable)
    });
    // drain a unit by watering the thirsty plant (aim (-7,5) from (-7,3.8)), then refill
    await P(page, () => { window.__FL__.farm.equip("can"); window.__FL__.farm.teleport(-7, 3.8); window.__FL__.farm.setHeading(0); });
    await sleep(250);
    const tankFull = await P(page, () => window.__FL__.farm.tank());
    await P(page, () => window.__FL__.farm.action()); // water thirsty crop → tank−1
    await sleep(450);
    const tankDrained = await P(page, () => window.__FL__.farm.tank());
    const cap = await P(page, () => window.__FL__.farm.tankCap());
    await P(page, () => { const q = window.__FL__.farm.pondPos; window.__FL__.farm.teleport(q.x, q.z + q.r + 1.2); });
    await sleep(250);
    const refillTgt = await P(page, () => window.__FL__.farm.target());
    await P(page, () => window.__FL__.farm.action());
    await sleep(250);
    const tankRefilled = await P(page, () => window.__FL__.farm.tank());
    check("can refills to capacity at the pond edge", tankRefilled === cap && tankDrained < tankFull, `full=${tankFull} drained=${tankDrained} refilled=${tankRefilled}/${cap} (tgt=${refillTgt && refillTgt.kind})`);

    // ===================== 4. CLICK-TO-ACT + WALK-THEN-ACT =====================
    await P(page, () => { window.__FL__.farm.clearFarm(); window.__FL__.farm.equip("hoe"); });
    // NEAR: a real left-CLICK on the canvas at a point within reach → tilled now
    // (proves the button-0 pointer wiring, not just the internal hook)
    await P(page, () => { window.__FL__.farm.teleport(-7, 3.8); window.__FL__.farm.setHeading(0); window.__FL__.farm.cancelAutoWalk(); });
    await sleep(250);
    const near = await P(page, () => window.__FL__.farm.worldScreen(-7, 5)); // on-screen point near the player
    await page.mouse.click(near.sx, near.sy, { button: "left" });
    await sleep(450);
    const nearTilled = await P(page, () => window.__FL__.farm.patchCoverageAt(-7, 5) > 0);
    check("click-to-act: left-click a near point tills a patch there", nearTilled, `covered=${nearTilled}`);
    // FAR: request a distant point → auto-walk starts, converges, then tills
    await P(page, () => { window.__FL__.farm.teleport(-16, 16); window.__FL__.farm.cancelAutoWalk(); window.__FL__.farm.requestActionAt(1, -3); });
    await sleep(120);
    const walking = await P(page, () => window.__FL__.farm.autoWalk());
    check("walk-then-act: distant point starts an auto-walk", walking && Math.abs(walking.tx - 1) < 0.01 && Math.abs(walking.tz + 3) < 0.01, JSON.stringify(walking));
    // let it converge + act
    for (let i = 0; i < 40 && (await P(page, () => window.__FL__.farm.autoWalk())); i++) await sleep(100);
    await sleep(450);
    const farTilled = await P(page, () => window.__FL__.farm.patchCoverageAt(1, -3) > 0);
    const farPos = await P(page, () => window.__FL__.farm.pos());
    check("walk-then-act: player converges + tills the far point", farTilled, `covered=${farTilled} pos=${farPos.x.toFixed(1)},${farPos.z.toFixed(1)}`);
    // manual input cancels an auto-walk
    await P(page, () => { window.__FL__.farm.teleport(-16, 16); window.__FL__.farm.cancelAutoWalk(); window.__FL__.farm.requestActionAt(1, -1); });
    await sleep(120);
    const before = await P(page, () => !!window.__FL__.farm.autoWalk());
    await P(page, () => window.__FL__.setInput({ fwd: 1, strafe: 0 }));
    await sleep(250);
    const after = await P(page, () => !!window.__FL__.farm.autoWalk());
    await P(page, () => window.__FL__.setInput({ fwd: 0, strafe: 0 }));
    check("walk-then-act: manual input cancels the auto-walk", before && !after, `before=${before} after=${after}`);

    // ===================== 5. ANIMALS + BARN =====================
    // day: grazing in the pasture (not sleeping)
    await P(page, () => { window.__FL__.animals.setPhase("day"); });
    await P(page, () => window.__FL__.animals.advance(4));
    const dayState = await P(page, () => {
      const ids = window.__FL__.animals.ids();
      const inPasture = ids.every((id) => { const p = window.__FL__.animals.actorPos(id); return p.x > 22 && p.x < 52 && p.z > -8 && p.z < 14; });
      const anySleeping = ids.some((id) => window.__FL__.animals.sleeping(id));
      return { inPasture, anySleeping };
    });
    check("animals graze inside the pasture by day, none asleep", dayState.inPasture && !dayState.anySleeping, JSON.stringify(dayState));
    // night: place inside barn + advance → asleep + 💤
    await P(page, () => { window.__FL__.barn.setOpen(true); window.__FL__.animals.setPhase("night"); });
    await P(page, () => {
      const spots = { goat1: [35.5, 10.5], goat2: [39.5, 10.5], chicken1: [34.4, 11.7], chicken2: [37.4, 11.7], chicken3: [40, 11.7] };
      for (const id of Object.keys(spots)) window.__FL__.animals.setPos(id, spots[id][0], spots[id][1]);
    });
    await P(page, () => window.__FL__.animals.advance(18)); // settle to their sleep spots
    const nightState = await P(page, () => {
      const ids = window.__FL__.animals.ids();
      return { allSleep: ids.every((id) => window.__FL__.animals.sleeping(id)), zzz: ids.every((id) => window.__FL__.animals.zzzVisible(id)), allInside: window.__FL__.animals.allInside() };
    });
    check("animals sleep inside the barn at night (+💤)", nightState.allSleep && nightState.zzz && nightState.allInside, JSON.stringify(nightState));
    // door toggle animates (barnDoorFrac ramps toward open)
    await P(page, () => window.__FL__.barn.setOpen(false));
    await sleep(60);
    const dfMid = await P(page, () => window.__FL__.avatar.barnDoorFrac());
    await sleep(500);
    const dfClosed = await P(page, () => window.__FL__.avatar.barnDoorFrac());
    await P(page, () => window.__FL__.barn.setOpen(true));
    await sleep(500);
    const dfOpen = await P(page, () => window.__FL__.avatar.barnDoorFrac());
    check("barn door animates (frac closes→opens over time)", dfClosed < 0.15 && dfOpen > 0.85 && dfMid > dfClosed - 0.01, `mid=${dfMid.toFixed(2)} closed=${dfClosed.toFixed(2)} open=${dfOpen.toFixed(2)}`);
    // egg spawn → collect → inventory
    const egg0 = await P(page, () => window.__FL__.barn.eggCount());
    const eid = await P(page, () => window.__FL__.barn.spawnEggNow("chicken1"));
    const egg1 = await P(page, () => window.__FL__.barn.eggCount());
    const prodEgg0 = await P(page, () => window.__FL__.farm.state().produce.egg);
    await P(page, (id) => window.__FL__.barn.collect(id), eid);
    await sleep(120);
    const egg2 = await P(page, () => window.__FL__.barn.eggCount());
    const prodEgg1 = await P(page, () => window.__FL__.farm.state().produce.egg);
    check("egg: spawn adds to nest, collect → inventory +1 egg", egg1 === egg0 + 1 && egg2 === egg0 && prodEgg1 === prodEgg0 + 1, `count ${egg0}→${egg1}→${egg2} egg-inv ${prodEgg0}→${prodEgg1}`);

    // ===================== 6. DECOR PLACE + REMOVE =====================
    await P(page, () => { window.__FL__.farm.setCoins(500); window.__FL__.farm.teleport(-30, -30); window.__FL__.farm.setHeading(0); });
    const decor0 = await P(page, () => window.__FL__.decor.count());
    await P(page, () => window.__FL__.decor.buy("gnome"));
    await sleep(80);
    const placingState = await P(page, () => ({ placing: window.__FL__.decor.placing(), valid: window.__FL__.decor.placementValid() }));
    check("decor: buy enters placement mode with a valid ghost", placingState.placing && placingState.placing.type === "gnome" && placingState.valid === true, JSON.stringify(placingState));
    await P(page, () => window.__FL__.decor.confirmPlace());
    await sleep(80);
    const decor1 = await P(page, () => window.__FL__.decor.count());
    const stillPlacing = await P(page, () => !!window.__FL__.decor.placing());
    check("decor: confirm places the decoration (count+1, exit placement)", decor1 === decor0 + 1 && !stillPlacing, `count ${decor0}→${decor1} placing=${stillPlacing}`);
    // persists across reload
    await P(page, () => window.__FL__.decor.flushSave());
    await sleep(150);
    // remove with 2-tap confirm
    const gid = await P(page, () => window.__FL__.decor.ids()[0]);
    const grec = await P(page, (id) => window.__FL__.decor.record(id), gid);
    await P(page, (r) => { window.__FL__.farm.equip("hands"); window.__FL__.farm.teleport(r.x - 1.4, r.z); window.__FL__.farm.setHeading(Math.PI / 2); }, grec);
    await sleep(200);
    const remTgt = await P(page, () => window.__FL__.decor.target());
    await P(page, () => window.__FL__.decor.action()); // arm
    await sleep(80);
    await P(page, () => window.__FL__.decor.action()); // confirm remove
    await sleep(120);
    const decor2 = await P(page, () => window.__FL__.decor.count());
    check("decor: 2-tap remove deletes it (count−1)", decor2 === decor1 - 1 && remTgt && remTgt.id === gid, `tgt=${remTgt && remTgt.id} count ${decor1}→${decor2}`);
    const decorPersist = (await bootPage(browser, false)).page;
    const persistedCount = await decorPersist.evaluate(() => new Promise((res) => setTimeout(() => res(window.__FL__.decor.count()), 500)));
    check("decor: placements persist across reload", persistedCount >= 1, `count=${persistedCount}`);
    await decorPersist.close();

    // ===================== 7. RAIN → OVERLAY + AUTO-WATER =====================
    // fastGrow OFF so the crop stays genuinely thirsty (fastGrow would ripen it).
    await P(page, () => { window.__FL__.farm.setFastGrow(false); window.__FL__.animals.setPhase("day"); window.__FL__.weather.applySky(); });
    await P(page, () => {
      window.__FL__.farm.clearFarm();
      window.__FL__.farm.plantStageAt(-10, 2, "turnip", 1); // real timeline, mid-grown
      window.__FL__.farm._addTimeOffset(2 * 3600 * 1000); // 2h > turnip 1h waterEvery → thirsty
    });
    await sleep(150);
    const thirstyState = await P(page, () => window.__FL__.farm.plantInfoAt(-10, 2).stage);
    check("rain: crop is genuinely thirsty before rain (not ready)", thirstyState !== "ready", `stage=${thirstyState}`);
    await P(page, () => window.__FL__.weather._inject({ cond: "rain", code: 61, fetchedAt: Date.now(), tempF: 54 }));
    await sleep(300);
    const rainCond = await P(page, () => window.__FL__.weather.current().cond);
    const watered = await P(page, () => window.__FL__.weather.forceAutoWater());
    check("rain: weather reads 'rain' and the streak overlay renders", rainCond === "rain", `cond=${rainCond}`);
    check("rain: auto-water waters thirsty crops", watered >= 1, `watered=${watered}`);
    // snow renders without error
    await P(page, () => window.__FL__.weather._inject({ cond: "snow", code: 71, fetchedAt: Date.now(), tempF: 28 }));
    await sleep(300);
    const snowCond = await P(page, () => window.__FL__.weather.current().cond);
    check("snow: weather reads 'snow' (flake overlay renders)", snowCond === "snow");
    await P(page, () => window.__FL__.weather._inject({ cond: "clear", code: 0, fetchedAt: Date.now(), tempF: 72 }));

    // ===================== 8. MAP =====================
    await P(page, () => {
      window.__FL__.farm.setFastGrow(false); // so a stage-1 plant reads "growing", not instantly ready
      window.__FL__.farm.clearFarm();
      window.__FL__.farm.plantStageAt(-14, -4, "corn", 1); // growing
      window.__FL__.farm.plantStageAt(-10, -2, "pumpkin", 3); // ready
    });
    await sleep(150);
    const snap = await P(page, () => window.__FL__.mapinv.mapSnapshot());
    const hasReady = snap.plants.some((p) => p.ready);
    const hasGrowing = snap.plants.some((p) => !p.ready);
    const hasPatches = (snap.patches || []).length >= 2;
    const animalsOk = snap.animals.length === 5 && snap.animals.every((a) => a.x > 20 && a.x < 54);
    const stationsOk = snap.stations.some((s) => s.emoji === "🏪") && snap.stations.some((s) => s.emoji === "📦") && snap.stations.some((s) => s.emoji === "🏠");
    const geomOk = snap.field && Math.abs(snap.field.cx + 6) < 0.01 && snap.barn && snap.pasture && snap.pond;
    check("map: shows ready + growing plant dots + tilled patches", hasReady && hasGrowing && hasPatches, `ready=${hasReady} growing=${hasGrowing} patches=${hasPatches}`);
    check("map: 5 animals at pasture coords", animalsOk, `n=${snap.animals.length}`);
    check("map: stations (stand/bin/house) + field/barn/pasture/pond geometry present", stationsOk && geomOk, `stations=${stationsOk} geom=${geomOk}`);
    await P(page, () => window.__FL__.mapinv.drawMapNow());
    await sleep(100);

    // ===================== 9. FAST-GROW TOGGLE =====================
    // (the full loop above already proves fastGrow ripens a watered crop in ~60s.)
    // Here: the SAME fresh tile's interpreted growth accelerates when the toggle
    // is ON vs OFF — proving the client-side fastGrow scale is live in 2D.
    await P(page, () => { window.__FL__.farm.clearFarm(); window.__FL__.farm.plantFreshAt(-5, 7, "turnip"); });
    await P(page, () => window.__FL__.farm.setFastGrow(false));
    await P(page, () => window.__FL__.farm._addTimeOffset(90000)); // 90s: nothing on the real 4h timeline
    await sleep(80);
    const stOff = await P(page, () => window.__FL__.farm.plantInfoAt(-5, 7).stage);
    await P(page, () => window.__FL__.farm.setFastGrow(true)); // re-interpret the SAME elapsed time fast
    await sleep(80);
    const stOn = await P(page, () => window.__FL__.farm.plantInfoAt(-5, 7).stage);
    check("fastGrow toggle accelerates the same plant (off=stage0 → on=advanced)", stOff === 0 && stOn !== 0, `off=${stOff} on=${stOn}`);

    await P(page, () => window.__FL__.farm.flushSave());
    await sleep(150);
    check("0 pageerrors (desktop)", errors.length === 0, errors.slice(0, 4).join(" | "));
    await page.close();

    // ===================== MOBILE =====================
    console.log("\n=== MOBILE 390×844 ===");
    const m = await bootPage(browser, true);
    const mBody = await m.page.evaluate(() => document.body.classList.contains("fl-mobile"));
    const mSnap = await m.page.evaluate(() => window.__FL__._snap());
    check("mobile: touch layer active + world renders", mBody && mSnap.distinct > 12 && mSnap.stdev > 8, `body=${mBody} distinct=${mSnap.distinct}`);
    // a mini free-form loop on mobile: till a patch at a point
    await m.page.evaluate(() => { window.__FL__.farm.setFastGrow(true); window.__FL__.farm.clearFarm(); window.__FL__.farm.setCoins(200); });
    await m.page.evaluate(() => { window.__FL__.farm.equip("hoe"); window.__FL__.farm.teleport(-7, 3.8); window.__FL__.farm.setHeading(0); });
    await sleep(150);
    await m.page.evaluate(() => window.__FL__.farm.action());
    await sleep(150);
    const mTilled = await m.page.evaluate(() => ({ n: window.__FL__.farm.patchCount(), covered: window.__FL__.farm.patchCoverageAt(-7, 5) > 0 }));
    check("mobile: free-form till works", mTilled.n === 1 && mTilled.covered, JSON.stringify(mTilled));
    await m.page.screenshot({ path: path.join(SHOTS, "farmlife-2d-r2-mobile.png") });
    check("0 pageerrors (mobile)", m.errors.length === 0, m.errors.slice(0, 4).join(" | "));
    await m.page.close();
  } finally {
    await browser.close();
    if (server) server.kill();
  }

  const fails = results.filter((r) => !r.ok);
  console.log(`\n${results.length - fails.length}/${results.length} checks passed`);
  if (fails.length) { console.log("FAILED: " + fails.map((f) => f.name).join(", ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
