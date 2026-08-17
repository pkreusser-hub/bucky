// Throwaway diagnostic: why do these 9 roster keys fail name+team resolution?
// Fetches the real Sleeper directory and reports, for each unresolved player,
// every Sleeper entry with the same normalized NAME (any team), plus its espn_id.
const ALIAS = { "bam knight": "zonovan knight" };
function normName(n) {
  n = String(n || "").toLowerCase().replace(/[^a-z ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").trim().replace(/ +/g, " ");
  return ALIAS[n] || n;
}
const slpTeam = (ab) => (ab === "WSH" ? "WAS" : ab || "");

const UNRESOLVED = [
  ["4567048", "Kenneth Walker III", "SEA"],
  ["4361432", "Romeo Doubs", "GB"],
  ["4371733", "Kenneth Gainwell", "PIT"],
  ["4569587", "Wan'Dale Robinson", "NYG"],
  ["4887558", "Emanuel Wilson", "GB"],
  ["4372016", "Jaylen Waddle", "MIA"],
  ["4239996", "Travis Etienne Jr.", "JAX"],
  ["4362619", "Chris Rodriguez Jr.", "WSH"],
  ["4361529", "Isiah Pacheco", "KC"],
];

const res = await fetch("https://api.sleeper.app/v1/players/nfl");
const dir = await res.json();
const byName = new Map(); // normName -> [entries]
for (const pid in dir) {
  const p = dir[pid];
  const nm = normName(p.full_name || ((p.first_name || "") + " " + (p.last_name || "")));
  if (!nm) continue;
  if (!byName.has(nm)) byName.set(nm, []);
  byName.get(nm).push({ pid, team: p.team, espn_id: p.espn_id, pos: p.position, active: p.active, full_name: p.full_name });
}
for (const [key, name, team] of UNRESOLVED) {
  const nm = normName(name);
  const want = nm + "|" + slpTeam(team);
  const hits = byName.get(nm) || [];
  console.log(`\n${name} (roster team ${team}, espn key ${key}) -> normName "${nm}"`);
  if (!hits.length) { console.log("  NO Sleeper entry with this name at all"); continue; }
  for (const h of hits) {
    const match = (nm + "|" + (h.team || "")) === want ? "  <-- would match" : "";
    console.log(`  pid=${h.pid} team=${h.team} pos=${h.pos} espn_id=${h.espn_id} active=${h.active} name="${h.full_name}"${match}`);
  }
}
