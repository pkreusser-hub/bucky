#!/usr/bin/env node
"use strict";
/**
 * Farm Life — consolidated 2D SMOKE runner (the one-command pre-playtest check).
 * Runs the OFFLINE suites in sequence and prints a single summary:
 *   verify-2d-r1  (render core)          — network blocked
 *   verify-2d-r2  (gameplay parity)      — network blocked
 *   verify-2d-r3 --offline (Section C)   — solo degrade + touch + THREE-shed
 *
 * Starts ONE shared http-server on 8790 so the children reuse it (they only
 * spawn/kill a server they started themselves). This runner does NOT touch
 * Firestore or Playroom — for the live MP + famtestfl cloud sections run
 * `node farmlife/verify-2d-r3.cjs` (full) directly.
 *
 * Run:  node farmlife/verify-2d-all.cjs        (from repo root)
 */
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8790;

function isOpen(port) {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host: "127.0.0.1" });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
    s.setTimeout(800, () => { s.destroy(); resolve(false); });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitServer(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await isOpen(PORT)) {
      try {
        await new Promise((res, rej) => http.get({ host: "127.0.0.1", port: PORT, path: "/farmlife/dist/index.html", timeout: 1000 }, (r) => { r.resume(); res(); }).on("error", rej));
        return;
      } catch (_) {}
    }
    await sleep(200);
  }
  throw new Error("server timeout");
}

function runSuite(label, file, args) {
  return new Promise((resolve) => {
    console.log(`\n\x1b[1m========== ${label} ==========\x1b[0m`);
    const child = spawn(process.execPath, [path.join(__dirname, file), ...args], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { const s = d.toString(); out += s; process.stdout.write(s); });
    child.stderr.on("data", (d) => process.stderr.write(d));
    child.on("close", (code) => {
      const m = out.match(/(\d+)\/(\d+) checks passed/);
      resolve({ label, passed: m ? +m[1] : 0, total: m ? +m[2] : 0, code: code == null ? 1 : code, parsed: !!m });
    });
  });
}

async function main() {
  let server = null;
  if (!(await isOpen(PORT))) {
    server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1"], { cwd: ROOT, stdio: "ignore", shell: true });
  }
  await waitServer(20000);

  const suites = [];
  suites.push(await runSuite("R1 — render core", "verify-2d-r1.cjs", []));
  suites.push(await runSuite("R2 — gameplay parity", "verify-2d-r2.cjs", []));
  suites.push(await runSuite("R3 — offline solo / touch / THREE-shed", "verify-2d-r3.cjs", ["--offline"]));
  suites.push(await runSuite("R4 — scale / interiors / auto-tile", "verify-2d-r4.cjs", []));

  if (server) try { process.kill(server.pid); } catch (_) {}

  console.log("\n\x1b[1m========== SMOKE SUMMARY ==========\x1b[0m");
  let allOk = true;
  let sumP = 0, sumT = 0;
  for (const s of suites) {
    const ok = s.code === 0 && s.parsed && s.passed === s.total;
    allOk = allOk && ok;
    sumP += s.passed; sumT += s.total;
    console.log(`  ${ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${s.label.padEnd(42)} ${s.passed}/${s.total}${s.code !== 0 ? "  (exit " + s.code + ")" : ""}`);
  }
  console.log(`\n  TOTAL: ${sumP}/${sumT} checks — ${allOk ? "\x1b[32mALL GREEN\x1b[0m" : "\x1b[31mSOME FAILED\x1b[0m"}`);
  console.log("  (live MP + famtestfl cloud: run `node farmlife/verify-2d-r3.cjs` for the full suite)");
  process.exit(allOk ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
