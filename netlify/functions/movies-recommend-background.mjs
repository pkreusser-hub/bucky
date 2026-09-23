// Movies recommend for the whole owned list. The "-background" suffix makes
// Netlify run this with the 15-minute allowance (the caller gets a 202
// immediately). Same shape as books-recommend-background: a synchronous
// recommend on this site is closed at 30-40s with only keepalive spaces left,
// and the owned list is 158 titles. The page polls movies.mjs action
// "recommend-result" for the Firestore doc this writes.
import { runRecommendJob } from "./movies.mjs";

export default async (req) => {
  try { await runRecommendJob(await req.json()); } catch { /* poll times out with the failure line */ }
  return new Response("", { status: 200 });
};
