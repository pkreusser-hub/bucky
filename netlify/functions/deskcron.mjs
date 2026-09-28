// The halftime and postgame desks' scheduled sweep (schedule in netlify.toml, every 2 minutes).
// 2026-09-28, user: "we need to make it so that after the game ends it triggers the script creation,
// not someone just opening it because then they just see '...' instead of a script". It reads ESPN's
// scoreboard and starts the script job for every game at halftime or just gone final (halftime.mjs
// sweepDesks), so the lines are written before anyone opens the game. A viewer's request still
// starts a missing one, as before.
import { sweepDesks } from "./halftime.mjs";

export default async () => {
  let out;
  try { out = await sweepDesks(); } catch (e) { out = { reason: "sweep" }; }
  return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
};
