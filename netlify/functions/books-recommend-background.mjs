// Bookshelf recommend for a long shelf. The "-background" suffix makes Netlify
// run this with the 15-minute allowance (the caller gets a 202 immediately).
// A synchronous recommend on this site is closed at about 30s with only the
// keepalive spaces left, which is Dad's shelf and not Eleanor's. The page
// polls books.mjs action "recommend-result" for the Firestore doc this writes.
import { runRecommendJob } from "./books.mjs";

export default async (req) => {
  try { await runRecommendJob(await req.json()); } catch { /* poll times out with the failure line */ }
  return new Response("", { status: 200 });
};
