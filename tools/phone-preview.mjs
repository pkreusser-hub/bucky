#!/usr/bin/env node
/**
 * Serve BUCKY to your REAL phone over wifi.
 *
 *   node tools/phone-preview.mjs                 # → index.html
 *   node tools/phone-preview.mjs fitness         # → index.html#fitness  (deep-links the tab)
 *   node tools/phone-preview.mjs farmgpt.html    # → any page
 *   node tools/phone-preview.mjs --port 8791
 *
 * Different from `mobile-preview.mjs`, which opens a phone-SIZED desktop Chrome on this
 * machine. This one binds to the LAN so the actual phone in your pocket can load the page —
 * real touch, real Safari/Chrome, real screen. Nothing is deployed and nothing is pushed.
 *
 * Phone and computer must be on the same wifi.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const portArg = args.indexOf("--port");
const PORT = portArg >= 0 ? Number(args[portArg + 1]) : 8790;
const target = args.filter((a) => !a.startsWith("--") && a !== String(PORT))[0] || "index.html";

/* A bare word is treated as an in-app tab (index.html#<tab>) — that's how you land straight
   on Fitness instead of hunting for it on a phone screen. */
const TABS = ["dashboard","chores","workorders","print3d","shopping","farmbank","goathooves",
              "goatcare","calendar","animalcare","mealplan","fitness","play"];
const pagePath = TABS.includes(target) ? `index.html#${target}`
               : target.endsWith(".html") ? target
               : `${target}.html`;

const MIME = {
  ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8",
  ".mjs":"text/javascript; charset=utf-8", ".json":"application/json; charset=utf-8",
  ".css":"text/css; charset=utf-8", ".webp":"image/webp", ".png":"image/png",
  ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".gif":"image/gif", ".svg":"image/svg+xml",
  ".glb":"model/gltf-binary", ".gltf":"model/gltf+json", ".mp3":"audio/mpeg",
  ".wav":"audio/wav", ".txt":"text/plain; charset=utf-8", ".ico":"image/x-icon",
  ".webmanifest":"application/manifest+json", ".woff2":"font/woff2",
};

function lanAddresses(){
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())){
    for (const a of addrs || []){
      if (a.family === "IPv4" && !a.internal) out.push({ name, address: a.address });
    }
  }
  // Wifi first — that's the one the phone is almost certainly on.
  out.sort((a, b) => (/wi-?fi|wlan/i.test(b.name) ? 1 : 0) - (/wi-?fi|wlan/i.test(a.name) ? 1 : 0));
  return out;
}

/** On Windows the usual failure is the firewall silently dropping inbound connections. */
function firewallHint(){
  if (process.platform !== "win32") return null;
  try {
    const out = execSync('netsh advfirewall firewall show rule name="BUCKY phone preview"', { stdio:["ignore","pipe","ignore"] }).toString();
    if (/Enabled:\s*Yes/i.test(out)) return { allowed: true };
  } catch { /* rule doesn't exist */ }
  return { allowed: false };
}

const srv = http.createServer((req, res) => {
  let rel = decodeURIComponent((req.url || "/").split("?")[0].split("#")[0]);
  if (rel === "/") rel = "/index.html";
  const file = path.join(ROOT, rel);

  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
    res.statusCode = 404;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    return res.end("404 — " + rel);
  }
  res.setHeader("content-type", MIME[path.extname(file).toLowerCase()] || "application/octet-stream");
  // No caching: you're iterating, and a stale phone cache wastes more time than it saves.
  res.setHeader("cache-control", "no-store, must-revalidate");
  res.setHeader("access-control-allow-origin", "*");
  fs.createReadStream(file).pipe(res);
});

srv.on("error", (err) => {
  if (err.code === "EADDRINUSE"){
    console.error(`\n✗ Port ${PORT} is already in use.`);
    console.error(`  Something else (probably mobile-preview) is serving there.`);
    console.error(`  Either use it as-is, or run:  node tools/phone-preview.mjs --port 8791\n`);
  } else {
    console.error("\n✗ " + err.message + "\n");
  }
  process.exit(1);
});

srv.listen(PORT, "0.0.0.0", () => {
  const ips = lanAddresses();
  const fw = firewallHint();

  console.log("");
  console.log("  📱  BUCKY on your phone");
  console.log("  " + "─".repeat(46));

  if (!ips.length){
    console.log("\n  ✗ No wifi/LAN address found — is this machine online?\n");
    return;
  }

  console.log("\n  Type this into your phone's browser:\n");
  for (const [i, ip] of ips.entries()){
    const url = `http://${ip.address}:${PORT}/${pagePath}`;
    console.log(`     ${i === 0 ? "→" : " "}  ${url}`);
    if (ips.length > 1) console.log(`        (${ip.name})`);
  }

  console.log("\n  Phone and computer must be on the same wifi.");
  console.log("  Add it to your home screen for a full-screen, app-like run.");

  if (fw && !fw.allowed){
    console.log("\n  If the phone can't connect, Windows Firewall is blocking it.");
    console.log("  Run this ONCE in an admin PowerShell:\n");
    console.log(`     netsh advfirewall firewall add rule name="BUCKY phone preview" dir=in action=allow protocol=TCP localport=${PORT}`);
  }

  console.log("\n  Ctrl+C to stop.\n");
});
