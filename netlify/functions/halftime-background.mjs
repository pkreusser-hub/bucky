// The halftime desk's script writer. The "-background" suffix gives it Netlify's 15-minute
// allowance (the caller, halftime.mjs, gets a 202 at once): an Opus call with thinking runs past
// what a synchronous function gets. It writes the script into Firestore sunday_halftime/<event>,
// which halftime.mjs serves to every viewer.
import { runHalftimeJob } from "./halftime.mjs";

export default async (req) => {
  try { await runHalftimeJob(await req.json()); } catch { /* the page's poll gives up with the stand-in lines */ }
  return new Response("", { status: 200 });
};
