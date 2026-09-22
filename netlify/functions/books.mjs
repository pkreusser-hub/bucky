// BUCKY — the family bookshelf: search, Goodreads reviews, recommendations,
// and a transparent political / woke rating.
//
// Netlify Function (ESM). POST JSON, secret-gated like every other function here.
//
//   { secret, action:"search", q }
//     -> { books:[{ id, title, author, year, isbn, cover, description, subjects,
//                   rating, ratingsCount, ratingSource, goodreadsUrl,
//                   political, woke, evidence, confidence }] }
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
//   { secret, action:"recommend", shelf, interests, maxPolitical?, maxWoke? }
//     -> { books:[{ title, author, summary, why }], model, error? }
//     The whole shelf (title / author / the reader's own stars) goes to grok-4.7
//     with reasoning_effort "low". High is the model default and ran past the
//     old 20s abort (41s on a two-book shelf). Low returned five books for the
//     135-title shelf in 27s. The wait is 50s, under the 60s synchronous limit.
//     Catalog ranker recommendScore stays exported for the arithmetic suite.
//
//   { secret, action:"rate", title, author?, description?, subjects? }
//     -> { political, woke, evidence, confidence }
//
// WHY A SERVER PROXY. Open Library is CORS-open; Goodreads and often Google Books are
// not. The ratings and review text have to be fetched here. The political score is
// also computed here so the page cannot "help" a check by scoring in two places.
//
// Zero dependencies, hand-rolled fetch — same house convention as news.mjs / stocks.mjs.
//
// Required env: BUCKY_NOTIFY_SECRET
// Optional env:
//   BOOKS_OL_BASE / BOOKS_GB_BASE / BOOKS_GR_BASE / BOOKS_XAI_BASE
//                                                  — point at fake servers in tests
//   BOOKS_GROK_MODEL                               — default grok-4.7
//   XAI_API_KEY / XAI_BASE_URL                     — Grok recommend
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
const MAX_RECOMMEND_QUERIES = 3;
const GROK_TIMEOUT_MS = 50000;
const GROK_MODEL = process.env.BOOKS_GROK_MODEL || "grok-4.7";
// Netlify's edge 504s a response that has moved no bytes for 30s (measured on
// this site). grok-4.7 at low effort is often 17–27s and sometimes slower, so
// a buffered call dies and the button paints nothing. A leading space starts
// the clock; the JSON is the last line. Reasoning tokens also bill against
// max_tokens (the gffltrade lesson) — 1800 let a long think eat the JSON.
const KEEPALIVE_MS = 8000;
const GROK_MAX_TOKENS = 6000;

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

function clamp5(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 5) return 5;
  return x;
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
function hayOf(parts) {
  return normSpace(parts.filter(Boolean).join(" ")).toLowerCase();
}
function normName(s) {
  return normSpace(s).toLowerCase().replace(/[^a-z0-9 ]+/g, "");
}

/* ---------------------------------------------------------------------------
   Political / woke rubric.

   Two independent 0–5 axes, each the sum of unique phrase hits then capped at 5.
   A hit is a literal lowercase substring of title + description + subjects.
   Each phrase counts once. The number is hand-computable from the fixture text
   and the lists below — the suite does that arithmetic, it does not trust this
   function's own output as the expected value.

   Political = how much the book is ABOUT government, parties, ideology, or
   activism. "War" alone does not count (too many novels).

   Woke = how central contemporary identity-politics / social-justice framing
   is: critical-race / privilege theory, gender-identity ideology as the
   lesson, DEI as a moral framework. A Black or gay character, a history of
   slavery, or the civil rights movement does NOT add a point by itself —
   those are representation or history, not this axis. That distinction is
   the whole point of the list: "race" / "gay" / "slavery" / "civil rights"
   are deliberately absent.
   --------------------------------------------------------------------------- */
export const POLITICAL_PHRASES = [
  { phrase: "communist manifesto", weight: 3 },
  { phrase: "federalist papers", weight: 3 },
  { phrase: "political science", weight: 3 },
  { phrase: "election", weight: 2 },
  { phrase: "campaign", weight: 2 },
  { phrase: "congress", weight: 2 },
  { phrase: "democrat", weight: 2 },
  { phrase: "republican", weight: 2 },
  { phrase: "marxism", weight: 2 },
  { phrase: "capitalism", weight: 2 },
  { phrase: "libertarian", weight: 2 },
  { phrase: "conservatism", weight: 2 },
  { phrase: "liberalism", weight: 2 },
  { phrase: "totalitarian", weight: 1 },
  { phrase: "revolution", weight: 1 },
  { phrase: "propaganda", weight: 1 },
  { phrase: "dictator", weight: 1 },
  { phrase: "government", weight: 1 },
  { phrase: "political", weight: 1 },
  { phrase: "protest", weight: 1 },
];

export const WOKE_PHRASES = [
  { phrase: "white fragility", weight: 3 },
  { phrase: "how to be an antiracist", weight: 3 },
  { phrase: "antiracist baby", weight: 3 },
  { phrase: "critical race theory", weight: 3 },
  { phrase: "intersectionality", weight: 3 },
  { phrase: "white privilege", weight: 3 },
  { phrase: "queer theory", weight: 3 },
  { phrase: "gender queer", weight: 3 },
  { phrase: "antiracism", weight: 2 },
  { phrase: "anti-racism", weight: 2 },
  { phrase: "systemic racism", weight: 2 },
  { phrase: "social justice", weight: 2 },
  { phrase: "diversity equity inclusion", weight: 2 },
  { phrase: "gender identity", weight: 2 },
  { phrase: "assigned female at birth", weight: 2 },
  { phrase: "assigned male at birth", weight: 2 },
  { phrase: "cisgender", weight: 2 },
  { phrase: "toxic masculinity", weight: 2 },
  { phrase: "whiteness", weight: 2 },
  { phrase: "settler colonial", weight: 2 },
  { phrase: "decoloniz", weight: 2 },
  { phrase: "climate justice", weight: 2 },
  { phrase: "oppression", weight: 1 },
  { phrase: "privilege", weight: 1 },
  { phrase: "activism", weight: 1 },
  { phrase: "equity", weight: 1 },
  { phrase: "inclusion", weight: 1 },
  { phrase: "microaggression", weight: 1 },
  { phrase: "allyship", weight: 1 },
  { phrase: "patriarchy", weight: 1 },
  { phrase: "dei", weight: 1 },
];

function scoreAxis(hay, phrases) {
  const hits = [];
  for (const { phrase, weight } of phrases) {
    if (hay.includes(phrase)) hits.push({ phrase, weight });
  }
  // "privilege" is also inside "white privilege" — keep the longer hit only,
  // so the shorter tag does not add a phantom extra point.
  const kept = hits.filter((h) => !hits.some((o) => o.phrase !== h.phrase && o.phrase.includes(h.phrase)));
  const raw = kept.reduce((s, h) => s + h.weight, 0);
  return { raw, score: Math.min(5, raw), evidence: kept.map((h) => h.phrase) };
}

export function scorePolitics(book) {
  const title = normSpace(book && book.title);
  const description = normSpace(book && book.description);
  const subjects = Array.isArray(book && book.subjects) ? book.subjects.map(normSpace).filter(Boolean) : [];
  const hay = hayOf([title, description, subjects.join(" ")]);
  const pol = scoreAxis(hay, POLITICAL_PHRASES);
  const woke = scoreAxis(hay, WOKE_PHRASES);
  const evidence = pol.evidence.concat(woke.evidence);
  const raw = pol.raw + woke.raw;
  let confidence = "low";
  if (evidence.length) confidence = (raw >= 3 || evidence.length >= 2) ? "high" : "medium";
  else if (hay.length >= 80) confidence = "high";
  return {
    political: pol.score,
    woke: woke.score,
    evidence,
    confidence,
  };
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

export function recommendScore(candidate, profile) {
  const shelf = Array.isArray(profile && profile.shelf) ? profile.shelf : [];
  const interests = Array.isArray(profile && profile.interests) ? profile.interests.map(normName).filter(Boolean) : [];
  const maxPolitical = profile && profile.maxPolitical;
  const maxWoke = profile && profile.maxWoke;
  const title = normSpace(candidate && candidate.title);
  const author = normSpace(candidate && candidate.author);
  const subjects = Array.isArray(candidate && candidate.subjects) ? candidate.subjects : [];
  const description = normSpace(candidate && candidate.description);
  const political = clamp5(candidate && candidate.political);
  const woke = clamp5(candidate && candidate.woke);
  const key = bookKey(title, author);

  if (shelf.some((b) => bookKey(b.title, b.author) === key)) {
    return { score: 0, reasons: [], excluded: true, excludeReason: "already-on-shelf" };
  }
  // `>` not `>=`, and Number.isFinite — a max of 0 must keep a book scored 0
  // and drop a book scored 1. `maxWoke || 5` would turn "no woke books" into "anything".
  if (Number.isFinite(maxPolitical) && political > maxPolitical) {
    return { score: 0, reasons: [], excluded: true, excludeReason: "over-political" };
  }
  if (Number.isFinite(maxWoke) && woke > maxWoke) {
    return { score: 0, reasons: [], excluded: true, excludeReason: "over-woke" };
  }

  let score = 0;
  const reasons = [];
  const candAuthor = normName(author);
  if (candAuthor && shelf.some((b) => normName(b.author) === candAuthor && Number(b.rating) >= 4)) {
    score += 3;
    reasons.push("same author as a book you liked");
  }
  const candSubs = new Set(subjects.map(normName).filter(Boolean));
  let subHits = 0;
  for (const b of shelf) {
    const theirs = Array.isArray(b.subjects) ? b.subjects.map(normName) : [];
    for (const s of theirs) {
      if (s && candSubs.has(s)) subHits += 1;
    }
  }
  const subScore = Math.min(4, subHits);
  if (subScore) {
    score += subScore;
    reasons.push("shares subjects with your shelf");
  }
  const hay = hayOf([title, description, subjects.join(" ")]);
  let intHits = 0;
  for (const interest of interests) {
    if (interest && hay.includes(interest)) intHits += 1;
  }
  const intScore = Math.min(6, intHits * 2);
  if (intScore) {
    score += intScore;
    reasons.push("matches an interest");
  }
  return { score, reasons, excluded: false, excludeReason: "" };
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
  const scored = scorePolitics(raw);
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
    political: scored.political,
    woke: scored.woke,
    evidence: scored.evidence,
    confidence: scored.confidence,
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
    const rescored = scorePolitics(prev);
    prev.political = rescored.political;
    prev.woke = rescored.woke;
    prev.evidence = rescored.evidence;
    prev.confidence = rescored.confidence;
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

// Standing recommend limits. The woke meter still does not score a gay
// character. This ask is stricter, and it is on every recommend.
const RECOMMEND_LIMITS = "If a book on the shelf is part of a series, assume they have read the whole series. Do not recommend the next book in that series, or any other book in it. Do not recommend a book with LGBT characters.";
const REC_COUNT = 10;

export function buildRecommendPrompt(shelf, extras) {
  const interests = Array.isArray(extras && extras.interests) ? extras.interests : [];
  const maxPolitical = extras && extras.maxPolitical;
  const maxWoke = extras && extras.maxWoke;
  const skipped = sanitizePassed(extras && extras.skipped);
  const readlist = sanitizePassed(extras && extras.readlist);
  const lines = (Array.isArray(shelf) ? shelf : []).map((b) => {
    const r = asNum(b.rating);
    const stars = r == null ? "unrated" : r + "/5";
    return "- " + (b.title || "Untitled") + " — " + (b.author || "unknown") + " — " + stars;
  });
  let extra = "";
  if (interests.length) extra += "\nInterests they named: " + interests.join(", ") + ".";
  if (Number.isFinite(Number(maxPolitical))) extra += "\nPolitical cap: " + Number(maxPolitical) + " of 5.";
  if (Number.isFinite(Number(maxWoke))) extra += "\nWoke cap: " + Number(maxWoke) + " of 5. Stay at or under those caps.";
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

export function parseGrokRecs(text, shelf, blocked) {
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
      political: 0,
      woke: 0,
      evidence: [],
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

async function callGrokRecommend(prompt) {
  const key = process.env.XAI_API_KEY || "";
  const base = (process.env.BOOKS_XAI_BASE || process.env.XAI_BASE_URL || "https://api.x.ai").replace(/\/$/, "");
  const model = process.env.BOOKS_GROK_MODEL || GROK_MODEL;
  if (!key) return { ok: false, reason: "no-key", text: "", model };
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), GROK_TIMEOUT_MS);
  try {
    const r = await fetch(base + "/v1/chat/completions", {
      method: "POST",
      signal: ac.signal,
      headers: { authorization: "Bearer " + key, "content-type": "application/json", "User-Agent": UA },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You recommend unread books from one reader's shelf. " + RECOMMEND_LIMITS + " Reply with JSON only." },
          { role: "user", content: prompt },
        ],
        temperature: 0.4,
        max_tokens: GROK_MAX_TOKENS,
        reasoning_effort: "low",
      }),
    });
    if (!r.ok) return { ok: false, reason: "http-" + r.status, text: "", model };
    const j = await r.json();
    const text = j && j.choices && j.choices[0] && j.choices[0].message ? String(j.choices[0].message.content || "") : "";
    if (!text.trim()) return { ok: false, reason: "empty", text: "", model };
    return { ok: true, reason: "", text, model };
  } catch (e) {
    return { ok: false, reason: e && e.name === "AbortError" ? "timeout" : "unreachable", text: "", model };
  } finally {
    clearTimeout(t);
  }
}

async function recommend(body) {
  const shelf = sanitizeShelf(body.shelf);
  const interests = [];
  for (const i of (Array.isArray(body.interests) ? body.interests : [])) {
    const s = normSpace(i).slice(0, 40);
    if (s) interests.push(s);
    if (interests.length >= MAX_INTERESTS) break;
  }
  const maxPolitical = Number(body.maxPolitical);
  const maxWoke = Number(body.maxWoke);
  const skipped = sanitizePassed(body.skipped);
  const readlist = sanitizePassed(body.readlist);
  const extras = {
    interests,
    maxPolitical: Number.isFinite(maxPolitical) ? maxPolitical : 5,
    maxWoke: Number.isFinite(maxWoke) ? maxWoke : 5,
    skipped,
    readlist,
  };
  const prompt = buildRecommendPrompt(shelf, extras);
  const got = await callGrokRecommend(prompt);
  if (!got.ok) {
    return { books: [], model: got.model, error: got.reason === "no-key" ? "Recommendations need a Grok key." : "Could not recommend right now.", reason: got.reason };
  }
  return { books: parseGrokRecs(got.text, shelf, skipped.concat(readlist)), model: got.model };
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
  if (action === "rate") {
    return json(scorePolitics({
      title: String(body.title || "").slice(0, 200),
      author: String(body.author || "").slice(0, 120),
      description: String(body.description || "").slice(0, 2000),
      subjects: Array.isArray(body.subjects) ? body.subjects.slice(0, 20) : [],
    }), 200, headers);
  }
  return json({ error: 'action must be "search", "reviews", "recommend" or "rate"' }, 400, headers);
};
