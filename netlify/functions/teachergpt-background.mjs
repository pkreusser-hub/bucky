// TeacherGPT background worker. The "-background" suffix makes Netlify run this with the
// 15-minute background allowance (the caller gets a 202 immediately) — an Opus 5 quiz/test
// generation takes 60-90+ seconds, past the synchronous/streaming execution caps that killed
// the first in-function attempts. All the real work (secret check, Opus call, Google Doc
// build + share, result-doc write for the page's poll) lives in farmgpt.mjs's runTeacherJob.
import { runTeacherJob } from "./farmgpt.mjs";

export default async (req) => {
  try { await runTeacherJob(await req.json()); } catch { /* poll times out with a friendly note */ }
  return new Response("", { status: 200 });
};
