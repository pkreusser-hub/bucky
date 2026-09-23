// BUCKY — the family bookshelf: search, Goodreads reviews, recommendations,
// and the Open Library community rating on each card.
//
// Netlify Function (ESM). POST JSON, secret-gated like every other function here.
//
//   { secret, action:"search", q }
//     -> { books:[{ id, title, author, year, isbn, cover, description, subjects,
//                   rating, ratingsCount, ratingSource, goodreadsUrl }] }
//
//   { secret, action:"reviews", isbn?, title?, author? }
//     -> { ok, title, author, rating, ratingsCount, reviewCount, reviews:[{author,rating,body}],
//          description, goodreadsUrl, source, reason? }
//     Goodreads shut the public API. This reads the PUBLIC book page (ISBN redirect →
//     /book/show/…) and pulls the JSON-LD aggregate plus the __NEXT_DATA__ review
//     objects the live page actually ships — measured 2026-09-21 against The Hobbit.
//     A blocked / empty / captcha page degrades to {ok:false} plus the outbound URL;
//     it never invents a rating.
//
//   { secret, action:"recommend", shelf, interests }
//     -> { books:[{ title, author, summary, why }], model, error? }
//     The whole shelf (title / author / the reader's own stars) goes to
//     Claude Opus 5.5 (claude-opus-5-5) at effort "low". It was grok-4.7
//     until 2026-09-22. The sync call waits 50s; the background job 180s.
//     A synchronous streamed call on this site is closed at about 30s with only
//     the keepalive spaces left in the body (measured 2026-09-22: last byte
//     ~25s, HTTP 200, four spaces, no JSON). Eleanor's short shelf still
//     finishes. Dad's seeded shelf does not, so that recommend is
//     books-recommend-background plus action "recommend-result".
//
//   { secret, action:"ratings", books:[{ title, author }] }
//     -> { ratings:[{ title, author, rating, ratingsCount, ratingSource,
//                     cover, isbn, reason? }] }
//     The Open Library community rating for cards that do not have one yet:
//     a recommendation, an Already read row, a seed row with no snapshot.
//     search.json by title and author, then the work's ratings.json when
//     search left no ratings. A title that does not match is a miss, never
//     another book's score. A miss is rating null, never 0.
//
// WHY A SERVER PROXY. Open Library is CORS-open; Goodreads and often Google Books are
// not. The ratings and review text have to be fetched here.
//
// Zero dependencies, hand-rolled fetch — same house convention as news.mjs / stocks.mjs.
//
// Required env: BUCKY_NOTIFY_SECRET
// Optional env:
//   BOOKS_OL_BASE / BOOKS_GB_BASE / BOOKS_GR_BASE / BOOKS_ANTHROPIC_BASE
//                                                  — point at fake servers in tests
//   BOOKS_RECOMMEND_MODEL                          — default claude-opus-5-5
//   ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL         — Opus recommend
//   BOOKS_ALLOW_PRIVATE=1                          — unused; fetches only hit configured bases

// goatfantasyleague.com is the same site. Movies already allowed it. Without
// these two, a Bookshelf recommend from that domain is blocked by the browser.
const ALLOWED_ORIGINS = new Set([
  "https://amenfarms.netlify.app",
  "https://goatfantasyleague.com",
  "https://www.goatfantasyleague.com",
  "http://localhost:8080",
  "http://localhost:3000",
  "http://localhost:8791",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:8791",
  "http://127.0.0.1:8894",
]);

const OL_BASE = process.env.BOOKS_OL_BASE || "https://openlibrary.org";
const GB_BASE = process.env.BOOKS_GB_BASE || "https://www.googleapis.com";
const GR_BASE = process.env.BOOKS_GR_BASE || "https://www.goodreads.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 BuckyBooks/1.0";
const FETCH_TIMEOUT_MS = 8000;
const MAX_Q = 80;
const MAX_RESULTS = 8;
const MAX_REVIEWS = 5;
const MAX_SHELF = 200;
const MAX_INTERESTS = 12;
// A page asks for the cards it is painting: ten picks, or a few shelf rows.
const MAX_RATING_LOOKUPS = 12;
const RATING_CONCURRENCY = 3;
const RECOMMEND_TIMEOUT_MS = 50000;
// Dad's 135-title shelf was still running when this 50s abort fired inside
// the background job (measured 2026-09-22 on grok-4.7, reason "timeout"). The
// background function is allowed minutes, so that job waits longer.
const RECOMMEND_JOB_TIMEOUT_MS = 180000;
// Recommend moved from grok-4.7 to Claude Opus 5.5 on 2026-09-22.
const RECOMMEND_MODEL = "claude-opus-5-5";
const RECOMMEND_EFFORT = "low";
// Netlify's edge 504s a response that has moved no bytes for 30s (measured on
// this site). A leading space starts the clock; the JSON is the last line.
// A call that HAS been sending spaces is still closed around 30-40s, before
// the JSON line, when the shelf is Dad's. The background job finishes it.
const KEEPALIVE_MS = 8000;
// Opus 5.5 thinking bills against max_tokens. Ten picks are about 1500
// tokens of JSON; the rest is room to think at low effort.
const RECOMMEND_MAX_TOKENS = 16000;
const JOB_COLLECTION = "books_rec_jobs";
const JOB_ID = /^[a-z0-9]{6,40}$/i;
const FIRESTORE_DOC_BASE = "projects/amen-farms-app/databases/(default)/documents";

function corsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://amenfarms.netlify.app";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
}
function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers });
}

function startKeepalive(controller, encoder) {
  let timer = null;
  const stop = () => { if (timer !== null) { clearInterval(timer); timer = null; } };
  try { controller.enqueue(encoder.encode(" ")); } catch { return stop; }
  timer = setInterval(() => {
    try { controller.enqueue(encoder.encode(" ")); } catch { stop(); }
  }, KEEPALIVE_MS);
  return stop;
}

function recommendStream(pending, headers) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const stop = startKeepalive(controller, encoder);
      let payload;
      try {
        payload = await pending;
      } catch (e) {
        payload = { books: [], error: "Could not recommend right now.", reason: "handler" };
      } finally {
        stop();
      }
      try { controller.enqueue(encoder.encode("\n" + JSON.stringify(payload))); } catch { /* closed */ }
      try { controller.close(); } catch { /* closed */ }
    },
  });
  const streamed = Object.assign({}, headers, { "Content-Type": "text/plain; charset=utf-8" });
  return new Response(stream, { status: 200, headers: streamed });
}

// Number(null) is 0. A book with no community rating must stay `null`,
// or a missing score and a real zero-star pile-on become the same number.
function asNum(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normSpace(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}
function normName(s) {
  return normSpace(s).toLowerCase().replace(/[^a-z0-9 ]+/g, "");
}

export function goodreadsUrlFor(isbn, title, author) {
  const isbn13 = String(isbn || "").replace(/[^0-9Xx]/g, "");
  if (isbn13.length >= 10) return `${GR_BASE.replace(/\/$/, "")}/book/isbn/${isbn13}`;
  const q = normSpace([title, author].filter(Boolean).join(" "));
  if (!q) return `${GR_BASE.replace(/\/$/, "")}/`;
  return `${GR_BASE.replace(/\/$/, "")}/search?q=${encodeURIComponent(q)}`;
}

function stripHtml(s) {
  return normSpace(String(s || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'"));
}

/* Real Goodreads shape, measured 2026-09-21 on /book/show for The Hobbit:
   a schema.org Book JSON-LD with aggregateRating, plus __NEXT_DATA__
   props.pageProps.apolloState Review:* objects (text, rating, creator.__ref → User:*.name). */
export function parseGoodreadsHtml(html) {
  const out = {
    ok: false,
    title: "",
    author: "",
    rating: null,
    ratingsCount: null,
    reviewCount: null,
    reviews: [],
    description: "",
    source: "goodreads",
  };
  const text = String(html || "");
  if (!text) return out;

  const ldMatch = text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
  if (ldMatch) {
    try {
      const ld = JSON.parse(ldMatch[1]);
      if (ld && (ld["@type"] === "Book" || (Array.isArray(ld["@type"]) && ld["@type"].includes("Book")))) {
        out.title = normSpace(ld.name);
        const auth = Array.isArray(ld.author) ? ld.author[0] : ld.author;
        out.author = normSpace(auth && auth.name);
        const agg = ld.aggregateRating || {};
        const rv = Number(agg.ratingValue);
        const rc = Number(agg.ratingCount);
        const rvc = Number(agg.reviewCount);
        if (Number.isFinite(rv)) out.rating = rv;
        if (Number.isFinite(rc)) out.ratingsCount = rc;
        if (Number.isFinite(rvc)) out.reviewCount = rvc;
        if (ld.description) out.description = stripHtml(ld.description);
      }
    } catch { /* live page can ship broken JSON-LD; keep going */ }
  }

  const nextMatch = text.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i);
  if (nextMatch) {
    try {
      const next = JSON.parse(nextMatch[1]);
      const state = next && next.props && next.props.pageProps && next.props.pageProps.apolloState;
      if (state && typeof state === "object") {
        const users = {};
        for (const [k, v] of Object.entries(state)) {
          if (k.startsWith("User:") && v && v.name) users[k] = String(v.name);
        }
        for (const [k, v] of Object.entries(state)) {
          if (!k.startsWith("Review:") || !v || v.__typename !== "Review") continue;
          const body = stripHtml(v.text);
          if (!body) continue;
          const ref = v.creator && v.creator.__ref;
          const rating = Number(v.rating);
          out.reviews.push({
            author: (ref && users[ref]) || "A reader",
            rating: Number.isFinite(rating) ? rating : null,
            body: body.slice(0, 600),
          });
          if (out.reviews.length >= MAX_REVIEWS) break;
        }
      }
    } catch { /* same: a half-rendered Next payload is a miss, not a crash */ }
  }

  if (out.rating == null) {
    const star = text.match(/RatingStatistics__rating[^>]*>([0-9.]+)</);
    if (star) {
      const rv = Number(star[1]);
      if (Number.isFinite(rv)) out.rating = rv;
    }
  }

  out.ok = out.rating != null || out.reviews.length > 0;
  return out;
}

function bookKey(title, author) {
  return normName(title) + "::" + normName(author);
}

function isbn13Of(list) {
  if (!Array.isArray(list)) return "";
  for (const x of list) {
    const s = String(x || "").replace(/[^0-9Xx]/g, "");
    if (s.length === 13) return s;
    if (s.length === 10 && !isbn13Of.length) return s;
  }
  const first = String(list[0] || "").replace(/[^0-9Xx]/g, "");
  return first.length >= 10 ? first : "";
}

function decorateBook(raw) {
  return {
    id: raw.id || bookKey(raw.title, raw.author),
    title: normSpace(raw.title),
    author: normSpace(raw.author),
    year: raw.year || "",
    isbn: raw.isbn || "",
    cover: raw.cover || "",
    description: normSpace(raw.description).slice(0, 800),
    subjects: Array.isArray(raw.subjects) ? raw.subjects.slice(0, 12) : [],
    rating: asNum(raw.rating),
    ratingsCount: asNum(raw.ratingsCount),
    ratingSource: raw.ratingSource || "",
    goodreadsUrl: goodreadsUrlFor(raw.isbn, raw.title, raw.author),
  };
}

export function mergeSearchHits(olDocs, gbItems) {
  const byKey = new Map();
  for (const d of (Array.isArray(olDocs) ? olDocs : [])) {
    const title = normSpace(d.title);
    const author = normSpace((d.author_name && d.author_name[0]) || d.author || "");
    if (!title) continue;
    const isbn = isbn13Of(d.isbn);
    const rating = Number(d.ratings_average);
    const ratingsCount = Number(d.ratings_count);
    const book = decorateBook({
      id: d.key || bookKey(title, author),
      title,
      author,
      year: d.first_publish_year ? String(d.first_publish_year) : "",
      isbn,
      cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : "",
      description: "",
      subjects: Array.isArray(d.subject) ? d.subject.slice(0, 12) : [],
      rating: Number.isFinite(rating) ? rating : null,
      ratingsCount: Number.isFinite(ratingsCount) ? ratingsCount : null,
      ratingSource: Number.isFinite(rating) ? "open-library" : "",
    });
    byKey.set(bookKey(title, author), book);
  }
  for (const item of (Array.isArray(gbItems) ? gbItems : [])) {
    const v = (item && item.volumeInfo) || {};
    const title = normSpace(v.title);
    const author = normSpace((v.authors && v.authors[0]) || "");
    if (!title) continue;
    const ids = Array.isArray(v.industryIdentifiers) ? v.industryIdentifiers : [];
    const isbn13 = (ids.find((i) => i.type === "ISBN_13") || {}).identifier
      || (ids.find((i) => i.type === "ISBN_10") || {}).identifier
      || "";
    const rating = Number(v.averageRating);
    const ratingsCount = Number(v.ratingsCount);
    const incoming = decorateBook({
      id: item.id || bookKey(title, author),
      title,
      author,
      year: v.publishedDate ? String(v.publishedDate).slice(0, 4) : "",
      isbn: String(isbn13 || "").replace(/[^0-9Xx]/g, ""),
      cover: (v.imageLinks && (v.imageLinks.thumbnail || v.imageLinks.smallThumbnail)) || "",
      description: v.description || "",
      subjects: Array.isArray(v.categories) ? v.categories.slice(0, 12) : [],
      rating: Number.isFinite(rating) ? rating : null,
      ratingsCount: Number.isFinite(ratingsCount) ? ratingsCount : null,
      ratingSource: Number.isFinite(rating) ? "google-books" : "",
    });
    const k = bookKey(title, author);
    const prev = byKey.get(k);
    if (!prev) {
      byKey.set(k, incoming);
      continue;
    }
    // Prefer a real description, a real ISBN, and a rating that is a number
    // (including 0 — a one-star pile-on is information, not a miss).
    if (!prev.description && incoming.description) prev.description = incoming.description;
    if (!prev.isbn && incoming.isbn) prev.isbn = incoming.isbn;
    if (!prev.cover && incoming.cover) prev.cover = incoming.cover;
    if (prev.rating == null && incoming.rating != null) {
      prev.rating = incoming.rating;
      prev.ratingsCount = incoming.ratingsCount;
      prev.ratingSource = incoming.ratingSource;
    }
    if (!prev.subjects.length && incoming.subjects.length) prev.subjects = incoming.subjects;
    prev.goodreadsUrl = goodreadsUrlFor(prev.isbn, prev.title, prev.author);
    byKey.set(k, prev);
  }
  return [...byKey.values()].slice(0, MAX_RESULTS);
}

function joinUrl(base, path) {
  const b = String(base || "").replace(/\/$/, "");
  const p = path.startsWith("/") ? path : "/" + path;
  return b + p;
}

async function fetchJson(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: ac.signal, redirect: "follow" });
    if (!r.ok) return { ok: false, reason: "http-" + r.status, data: null };
    const data = await r.json();
    return { ok: true, reason: "", data };
  } catch (e) {
    return { ok: false, reason: e && e.name === "AbortError" ? "timeout" : "fetch-failed", data: null };
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" }, signal: ac.signal, redirect: "follow" });
    if (!r.ok) return { ok: false, reason: "http-" + r.status, text: "" };
    const text = await r.text();
    return { ok: true, reason: "", text, finalUrl: r.url || url };
  } catch (e) {
    return { ok: false, reason: e && e.name === "AbortError" ? "timeout" : "fetch-failed", text: "" };
  } finally {
    clearTimeout(t);
  }
}

async function searchCatalog(q) {
  const query = normSpace(q).slice(0, MAX_Q);
  if (!query) return [];
  const olUrl = joinUrl(OL_BASE, "/search.json") + "?q=" + encodeURIComponent(query) + "&limit=" + MAX_RESULTS;
  const gbUrl = joinUrl(GB_BASE, "/books/v1/volumes") + "?q=" + encodeURIComponent(query) + "&maxResults=" + MAX_RESULTS;
  const [ol, gb] = await Promise.all([fetchJson(olUrl), fetchJson(gbUrl)]);
  const docs = ol.ok && ol.data && Array.isArray(ol.data.docs) ? ol.data.docs : [];
  const items = gb.ok && gb.data && Array.isArray(gb.data.items) ? gb.data.items : [];
  return mergeSearchHits(docs, items);
}

// A title from the shelf or from the model, reduced to what Open Library's
// title field holds: no subtitle after a colon, no "(We Are Bob)" series tag,
// no leading article.
function titleCore(title) {
  return normName(String(title || "").replace(/\([^)]*\)/g, " ").split(":")[0]).replace(/^(a|an|the)\s+/, "").trim();
}
function lastName(author) {
  const parts = normName(author).split(" ").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}
// The doc has to be this book. The first search hit for a common title can be
// a study guide or another author's book, and its score is not this one's.
// The titles must match exactly once the subtitle and series tag are gone: a
// prefix match took "The Hobbit Cookbook" for The Hobbit, and would take
// "Dune Messiah" for Dune. A miss shows no score; a wrong match shows a
// wrong one.
export function pickRatingDoc(docs, title, author) {
  const want = titleCore(title);
  const last = lastName(author);
  if (!want) return null;
  for (const d of (Array.isArray(docs) ? docs : [])) {
    const got = titleCore(d && d.title);
    if (!got || got !== want) continue;
    const names = Array.isArray(d.author_name) ? d.author_name : [];
    if (last && !names.some((n) => normName(n).split(" ").includes(last))) continue;
    return d;
  }
  return null;
}

// search.json leaves ratings_average off a work nobody rated, and can carry a
// 0 count while the work's own ratings.json has votes (We Are Legion: 4.1053
// from 19). A count of 0 is no rating, never a 0.00 book.
async function openLibraryRating(title, author) {
  const t = normSpace(title).slice(0, 200);
  const a = normSpace(author).slice(0, 120);
  const miss = (reason) => ({ title: t, author: a, rating: null, ratingsCount: null, ratingSource: "", cover: "", isbn: "", reason });
  if (!titleCore(t)) return miss("no-title");
  const q = "?title=" + encodeURIComponent(titleCore(t)) + (a ? "&author=" + encodeURIComponent(a) : "")
    + "&fields=key,title,author_name,ratings_average,ratings_count,cover_i,isbn&limit=5";
  const got = await fetchJson(joinUrl(OL_BASE, "/search.json") + q);
  if (!got.ok) return miss(got.reason || "unavailable");
  const doc = pickRatingDoc(got.data && got.data.docs, t, a);
  if (!doc) return miss("not-found");
  let rating = asNum(doc.ratings_average);
  let count = asNum(doc.ratings_count);
  if (rating == null || !count) {
    rating = null;
    count = null;
    const key = String(doc.key || "");
    if (/^\/works\/OL\d+W$/.test(key)) {
      const work = await fetchJson(joinUrl(OL_BASE, key + "/ratings.json"));
      const sum = work.ok && work.data && work.data.summary;
      const avg = asNum(sum && sum.average);
      const n = asNum(sum && sum.count);
      if (avg != null && n) { rating = avg; count = n; }
    }
  }
  const out = {
    title: t,
    author: a,
    rating,
    ratingsCount: count,
    ratingSource: rating == null ? "" : "open-library",
    cover: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : "",
    isbn: isbn13Of(doc.isbn),
  };
  if (rating == null) out.reason = "no-ratings";
  return out;
}

async function lookupRatings(raw) {
  const list = [];
  for (const b of (Array.isArray(raw) ? raw : [])) {
    if (!b || !normSpace(b.title)) continue;
    list.push({ title: b.title, author: b.author });
    if (list.length >= MAX_RATING_LOOKUPS) break;
  }
  const out = new Array(list.length);
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const i = next++;
      out[i] = await openLibraryRating(list[i].title, list[i].author);
    }
  }
  await Promise.all(Array.from({ length: Math.min(RATING_CONCURRENCY, list.length) }, worker));
  return out;
}

async function fetchReviews({ isbn, title, author }) {
  const url = goodreadsUrlFor(isbn, title, author);
  const got = await fetchText(url);
  if (!got.ok) {
    return { ok: false, reason: got.reason || "unavailable", goodreadsUrl: url, reviews: [], rating: null, ratingsCount: null, reviewCount: null, title: normSpace(title), author: normSpace(author), description: "", source: "goodreads" };
  }
  const parsed = parseGoodreadsHtml(got.text);
  parsed.goodreadsUrl = got.finalUrl || url;
  if (!parsed.title) parsed.title = normSpace(title);
  if (!parsed.author) parsed.author = normSpace(author);
  if (!parsed.ok) parsed.reason = "no-reviews";
  return parsed;
}

export function sanitizeShelf(raw) {
  const out = [];
  for (const b of (Array.isArray(raw) ? raw : [])) {
    if (!b || !b.title) continue;
    out.push({
      title: normSpace(b.title).slice(0, 200),
      author: normSpace(b.author).slice(0, 120),
      subjects: Array.isArray(b.subjects) ? b.subjects.map((s) => normSpace(s).slice(0, 60)).filter(Boolean).slice(0, 12) : [],
      description: normSpace(b.description).slice(0, 800),
      rating: asNum(b.rating),
    });
    if (out.length >= MAX_SHELF) break;
  }
  return out;
}

const MAX_PASSED = 80;

export function sanitizePassed(raw) {
  const out = [];
  const seen = new Set();
  for (const b of (Array.isArray(raw) ? raw : [])) {
    const title = normSpace(b && b.title).slice(0, 200);
    if (!title) continue;
    const author = normSpace(b && b.author).slice(0, 120);
    const k = normName(title);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ title, author });
    if (out.length >= MAX_PASSED) break;
  }
  return out;
}

function blockKey(title) {
  return normName(title).replace(/^(a|an|the)\s+/, "");
}

// Standing recommend limits, on every recommend. They are part of the ask,
// not a score: the political / woke meter was removed on 2026-09-23.
const RECOMMEND_LIMITS = "If a book on the shelf is part of a series, assume they have read the whole series. Do not recommend the next book in that series, or any other book in it. Do not recommend a book with LGBT characters.";
const REC_COUNT = 10;

export function buildRecommendPrompt(shelf, extras) {
  const interests = Array.isArray(extras && extras.interests) ? extras.interests : [];
  const skipped = sanitizePassed(extras && extras.skipped);
  const readlist = sanitizePassed(extras && extras.readlist);
  const lines = (Array.isArray(shelf) ? shelf : []).map((b) => {
    const r = asNum(b.rating);
    const stars = r == null ? "unrated" : r + "/5";
    return "- " + (b.title || "Untitled") + " — " + (b.author || "unknown") + " — " + stars;
  });
  let extra = "";
  if (interests.length) extra += "\nInterests they named: " + interests.join(", ") + ".";
  if (skipped.length) {
    extra += "\n\nNOT INTERESTED (do not recommend these):\n" + skipped.map((b) => {
      return "- " + b.title + (b.author ? " — " + b.author : "");
    }).join("\n");
  }
  if (readlist.length) {
    extra += "\n\nREAD LIST (do not recommend these):\n" + readlist.map((b) => {
      return "- " + b.title + (b.author ? " — " + b.author : "");
    }).join("\n");
  }
  const ask = readlist.length
    ? "Recommend exactly " + REC_COUNT + " books they have NOT already read, that are not in the not-interested list, and that are not on the read list."
    : (skipped.length
      ? "Recommend exactly " + REC_COUNT + " books they have NOT already read and that are not in the not-interested list."
      : "Recommend exactly " + REC_COUNT + " books they have NOT already read.");
  return (
    "Here is everything this reader has already read, with their own star rating when they gave one (1-5). Unrated means they read it but have not scored it.\n\n"
    + "READ SO FAR:\n" + (lines.length ? lines.join("\n") : "(empty shelf)") + "\n"
    + extra
    + "\n\n" + RECOMMEND_LIMITS
    + "\n\n" + ask + " For each, write a brief summary (two sentences) and why it fits this list.\n"
    + "Reply with JSON only, no markdown:\n"
    + '{"books":[{"title":"","author":"","summary":"","why":""}]}'
  );
}

export function parseRecs(text, shelf, blocked) {
  const raw = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let parsed;
  try { parsed = JSON.parse(raw); } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return [];
    try { parsed = JSON.parse(m[0]); } catch { return []; }
  }
  const rows = Array.isArray(parsed && parsed.books) ? parsed.books : (Array.isArray(parsed) ? parsed : []);
  const have = new Set((Array.isArray(shelf) ? shelf : []).map((b) => bookKey(b.title, b.author)));
  const banned = new Set(sanitizePassed(blocked).map((b) => blockKey(b.title)));
  const out = [];
  const seen = new Set();
  for (const b of rows) {
    if (!b || !b.title) continue;
    const title = normSpace(b.title).slice(0, 200);
    const author = normSpace(b.author).slice(0, 120);
    const k = bookKey(title, author);
    if (!title || have.has(k) || banned.has(blockKey(title)) || seen.has(k)) continue;
    seen.add(k);
    out.push({
      title,
      author,
      summary: normSpace(b.summary).slice(0, 600),
      why: normSpace(b.why).slice(0, 400),
      reasons: [normSpace(b.why).slice(0, 400)].filter(Boolean),
      description: normSpace(b.summary).slice(0, 600),
      rating: null,
      ratingsCount: null,
      ratingSource: "",
      cover: "",
      isbn: "",
      goodreadsUrl: goodreadsUrlFor("", title, author),
    });
    if (out.length >= REC_COUNT) break;
  }
  return out;
}

// The Anthropic Messages API, raw fetch like farmgpt.mjs. Opus 5.5 always
// thinks; effort is the only dial, and its default is medium. Low keeps a
// long shelf near the old Grok time. Thinking bills against max_tokens, so
// the budget is 16000, not the 6000 that fit Grok. No temperature: this
// model answers 400 to sampling parameters. The reply is read by block type,
// because thinking blocks come first. A refusal is a failure with its own
// reason, not an empty list of picks.
async function callClaudeRecommend(prompt, timeoutMs) {
  const key = process.env.ANTHROPIC_API_KEY || "";
  const base = (process.env.BOOKS_ANTHROPIC_BASE || process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "");
  const model = process.env.BOOKS_RECOMMEND_MODEL || RECOMMEND_MODEL;
  if (!key) return { ok: false, reason: "no-key", text: "", model };
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs || RECOMMEND_TIMEOUT_MS);
  try {
    const r = await fetch(base + "/v1/messages", {
      method: "POST",
      signal: ac.signal,
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: RECOMMEND_MAX_TOKENS,
        system: "You recommend unread books from one reader's shelf. " + RECOMMEND_LIMITS + " Reply with JSON only.",
        messages: [{ role: "user", content: prompt }],
        output_config: { effort: RECOMMEND_EFFORT },
      }),
    });
    if (!r.ok) return { ok: false, reason: "http-" + r.status, text: "", model };
    const j = await r.json();
    if (j && j.stop_reason === "refusal") return { ok: false, reason: "refusal", text: "", model };
    const text = (Array.isArray(j && j.content) ? j.content : [])
      .filter((b) => b && b.type === "text")
      .map((b) => String(b.text || ""))
      .join("");
    if (!text.trim()) return { ok: false, reason: j && j.stop_reason === "max_tokens" ? "max-tokens" : "empty", text: "", model };
    return { ok: true, reason: "", text, model: (j && j.model) || model };
  } catch (e) {
    return { ok: false, reason: e && e.name === "AbortError" ? "timeout" : "unreachable", text: "", model };
  } finally {
    clearTimeout(t);
  }
}

async function recommend(body, timeoutMs) {
  const shelf = sanitizeShelf(body.shelf);
  const interests = [];
  for (const i of (Array.isArray(body.interests) ? body.interests : [])) {
    const s = normSpace(i).slice(0, 40);
    if (s) interests.push(s);
    if (interests.length >= MAX_INTERESTS) break;
  }
  const skipped = sanitizePassed(body.skipped);
  const readlist = sanitizePassed(body.readlist);
  const extras = {
    interests,
    skipped,
    readlist,
  };
  const prompt = buildRecommendPrompt(shelf, extras);
  const got = await callClaudeRecommend(prompt, timeoutMs || RECOMMEND_TIMEOUT_MS);
  if (!got.ok) {
    return { books: [], model: got.model, error: got.reason === "no-key" ? "Recommendations need an Anthropic key." : "Could not recommend right now.", reason: got.reason };
  }
  return { books: parseRecs(got.text, shelf, skipped.concat(readlist)), model: got.model };
}

// Dad's shelf does not finish inside the synchronous call. The background
// function runs this and the page polls recommend-result. Same shape as
// TeacherGPT's job doc: one Firestore document, string payload.
let cachedGoogleToken = null;

function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getGoogleAccessToken() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  if (cachedGoogleToken && Date.now() < cachedGoogleToken.exp - 60000) return cachedGoogleToken.token;
  const sa = JSON.parse(raw);
  const crypto = await import("node:crypto");
  const nowSec = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: nowSec,
    exp: nowSec + 3600,
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(header + "." + claims);
  const jwt = header + "." + claims + "." + base64url(signer.sign(sa.private_key));
  const tokenUrl = process.env.BOOKS_GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!resp.ok) return null;
  const j = await resp.json();
  cachedGoogleToken = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cachedGoogleToken.token;
}

function firestoreRoot() {
  return process.env.BOOKS_FIRESTORE_BASE || `https://firestore.googleapis.com/v1/${FIRESTORE_DOC_BASE}`;
}

export async function runRecommendJob(body) {
  if (!body || body.secret !== process.env.BUCKY_NOTIFY_SECRET) return;
  const jobId = typeof body.jobId === "string" && JOB_ID.test(body.jobId) ? body.jobId : null;
  if (!jobId) return;
  let res;
  try { res = await recommend(body, RECOMMEND_JOB_TIMEOUT_MS); }
  catch { res = { books: [], error: "Could not recommend right now.", reason: "handler" }; }
  try {
    const token = await getGoogleAccessToken();
    if (!token) return;
    const fields = {
      status: { stringValue: "done" },
      payload: { stringValue: JSON.stringify(res) },
    };
    await fetch(`${firestoreRoot()}:commit`, {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify({
        writes: [{ update: { name: `${FIRESTORE_DOC_BASE}/${JOB_COLLECTION}/${jobId}`, fields } }],
      }),
    });
  } catch { /* the page's poll times out with the same failure line */ }
}

async function readRecommendJob(jobId) {
  const token = await getGoogleAccessToken();
  if (!token) return { error: "Could not recommend right now.", reason: "no-store" };
  const r = await fetch(`${firestoreRoot()}/${JOB_COLLECTION}/${jobId}`, {
    headers: { authorization: "Bearer " + token },
  });
  if (!r.ok) return { pending: true };
  const j = await r.json().catch(() => null);
  const payload = j && j.fields && j.fields.payload && j.fields.payload.stringValue;
  if (!payload) return { pending: true };
  try { return JSON.parse(payload); }
  catch { return { error: "Could not recommend right now.", reason: "bad-job" }; }
}

export default async (req) => {
  const origin = req.headers.get("origin") || "";
  const headers = corsHeaders(origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return json({ error: "POST only" }, 405, headers);

  const familySecret = process.env.BUCKY_NOTIFY_SECRET;
  if (!familySecret) return json({ error: "Server misconfigured: BUCKY_NOTIFY_SECRET is not set" }, 500, headers);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400, headers); }
  if (!body || body.secret !== familySecret) return json({ error: "Wrong family password" }, 401, headers);

  const action = body.action;
  if (action === "search") {
    const books = await searchCatalog(body.q);
    return json({ books }, 200, headers);
  }
  if (action === "reviews") {
    const res = await fetchReviews({
      isbn: String(body.isbn || "").slice(0, 20),
      title: String(body.title || "").slice(0, 200),
      author: String(body.author || "").slice(0, 120),
    });
    return json(res, 200, headers);
  }
  if (action === "recommend") {
    return recommendStream(recommend(body), headers);
  }
  if (action === "recommend-result") {
    const jobId = typeof body.jobId === "string" && JOB_ID.test(body.jobId) ? body.jobId : "";
    if (!jobId) return json({ error: "jobId required" }, 400, headers);
    return json(await readRecommendJob(jobId), 200, headers);
  }
  if (action === "ratings") {
    return json({ ratings: await lookupRatings(body.books) }, 200, headers);
  }
  return json({ error: 'action must be "search", "reviews", "ratings", "recommend" or "recommend-result"' }, 400, headers);
};
