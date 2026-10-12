#!/usr/bin/env node
// chorereminders.mjs — the three sends land at 8:30 AM / 1:00 PM / 8:30 PM CENTRAL in summer AND
// winter (2026-10-12). Black-box: drive the real handler at every UTC minute the netlify.toml cron
// fires, with no FIREBASE_SERVICE_ACCOUNT set — a selected slot answers 500 "not set", an
// unselected one answers {skipped:"not-a-scheduled-slot"}. No network is touched either way.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ok   " + m); } else { fail++; console.log("  FAIL " + m); } };

delete process.env.FIREBASE_SERVICE_ACCOUNT;
delete process.env.CHOREREMINDER_FORCE;
const handler = (await import(join(ROOT, "netlify/functions/chorereminders.mjs"))).default;

// the cron as deployed
const toml = readFileSync(join(ROOT, "netlify.toml"), "utf8");
const cron = (toml.match(/\[functions\."chorereminders"\]\s*\n\s*schedule\s*=\s*"([^"]+)"/) || [])[1];
ok(!!cron, "netlify.toml has a chorereminders schedule: " + cron);
const [mins, hours] = cron.split(/\s+/);
const fires = [];
for (const h of hours.split(",").map(Number)) for (const m of mins.split(",").map(Number)) fires.push([h, m]);

const central = (d) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit", hour12: true }).format(d);

// A CDT day, the fall-back day itself, a CST day, deep winter, the spring-forward day, a CDT day.
for (const day of ["2026-10-12", "2026-11-01", "2026-11-10", "2027-01-15", "2027-03-14", "2027-06-01"]) {
  const sent = [];
  // a Central "day" spans two UTC dates: walk UTC from day 00:00 to next day 23:59
  for (const off of [0, 1]) {
    const base = new Date(day + "T00:00:00Z"); base.setUTCDate(base.getUTCDate() + off);
    for (const [h, m] of fires) {
      const t = new Date(base); t.setUTCHours(h, m, 0, 0);
      const cDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(t);
      if (cDate !== day) continue;   // only fires that fall on this CENTRAL date
      process.env.CHOREREMINDER_TEST_NOW_MS = String(t.getTime());
      const r = await handler();
      const body = await r.json();
      if (r.status === 500 && /FIREBASE_SERVICE_ACCOUNT/.test(body.error || "")) sent.push(central(t));
      else if (!(r.status === 200 && body.skipped === "not-a-scheduled-slot")) sent.push("?" + r.status);
    }
  }
  const want = ["8:30 AM", "1:00 PM", "8:30 PM"];
  ok(JSON.stringify(sent.sort()) === JSON.stringify(want.slice().sort()),
    `${day}: exactly one send per slot at ${want.join(" / ")} Central (got ${sent.join(" / ") || "none"})`);
}
// a stray manual invoke at an odd time never sends
process.env.CHOREREMINDER_TEST_NOW_MS = String(Date.parse("2026-11-10T17:12:00Z"));
const stray = await (await handler()).json();
ok(stray.skipped === "not-a-scheduled-slot", "an off-schedule invoke (11:12 AM CST) no-ops");
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
