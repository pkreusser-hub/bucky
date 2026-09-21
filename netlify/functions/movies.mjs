// BUCKY — the family movie shelf: search what to add, and ask grok-4.7
// what to watch next from the movies the household already owns.
//
//   { secret, action:"search", q }
//     -> { movies:[{ title, director, year, genre, cover, description,
//                    communityRating, ratingsCount, ratingSource, storeUrl }] }
//     Wikidata is the catalog. iTunes Search media=movie returned
//     resultCount 0 for Inception, Toy Story, and The Iron Giant on
//     2026-09-21 (a music search on the same host still returned a track).
//     A film has no invented star rating — communityRating stays null.
//
//   { secret, action:"detail", title, year? }
//     -> { found, title, year, director, cover, tomatoMeter, tomatoAverage,
//          userAverage, popcornMeter, rtPath, reason? }
//     The poster is the English Wikipedia page image for the film's sitelink.
//     Guessing the article from the title is wrong: "Super Buddies" opened
//     the DC team page on 2026-09-21, while the sitelink is
//     "Super Buddies (film)" and that page image is the poster.
//     Wikidata P444 claims reviewed by Rotten Tomatoes (Q105584) are the
//     fallback: Tomatometer Q108403393 (a percent), Popcornmeter Q131100566
//     (a percent, only when the item has one), and the critic average
//     Q108403540 (x/10). Wikidata has no user average. When the film's
//     Rotten Tomatoes page loads, its mediaScorecard replaces those numbers
//     and adds the user average (audienceScore.averageRating, out of 5).
//     The critic average on that card is criticsScore.averageRating, out of
//     10. A 403 or a page with no scorecard leaves the Wikidata numbers and
//     a null user average. A missing score stays null. A real 0 stays 0.
//     OMDb returned 401 "No API key provided" the same day, so it is not
//     this lookup.
//
//   { secret, action:"recommend", shelf, interests }
//     -> { movies:[{ title, director, summary, why }], model, error? }
//     The whole owned list (title and the viewer's own stars) goes to grok-4.7
//     at low effort. A leading keepalive byte keeps the edge from 504ing a
//     silent call at 30s. Reasoning tokens bill against max_tokens, so the
//     budget is 6000. The JSON is the last line.
//
// Required env: BUCKY_NOTIFY_SECRET
// Optional: MOVIES_WIKI_BASE, MOVIES_ENWIKI_BASE, MOVIES_RT_BASE, MOVIES_XAI_BASE, XAI_BASE_URL, XAI_API_KEY, MOVIES_GROK_MODEL

const ALLOWED_ORIGINS = new Set([
  "https://amenfarms.netlify.app",
  "https://goatfantasyleague.com",
  "https://www.goatfantasyleague.com",
  "http://localhost:8080",
  "http://localhost:3000",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:8894",
]);

const WIKI_BASE = process.env.MOVIES_WIKI_BASE || "https://www.wikidata.org";
const ENWIKI_BASE = process.env.MOVIES_ENWIKI_BASE || "https://en.wikipedia.org";
const RT_BASE = process.env.MOVIES_RT_BASE || "https://www.rottentomatoes.com";
const RT_BY = "Q105584";
const RT_TOMATOMETER = "Q108403393";
const RT_POPCORN = "Q131100566";
const RT_AVERAGE = "Q108403540";
// P31 values that are a film. A novel or a soundtrack is not one of these.
const FILM_TYPES = new Set([
  "Q11424",    // film
  "Q202866",   // animated film
  "Q24869",    // short film
  "Q506240",   // television film
  "Q29168811", // animated short film
  "Q93204",    // documentary film
]);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 BuckyMovies/1.0";
const FETCH_TIMEOUT_MS = 8000;
const MAX_Q = 80;
const MAX_RESULTS = 8;
const MAX_SHELF = 200;
const MAX_INTERESTS = 12;
const GROK_TIMEOUT_MS = 50000;
const GROK_MODEL = process.env.MOVIES_GROK_MODEL || "grok-4.7";
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
        payload = { movies: [], error: "Could not recommend right now.", reason: "handler" };
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

function normSpace(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

export function asNum(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function joinUrl(base, path) {
  return String(base || "").replace(/\/$/, "") + path;
}

async function fetchJson(url) {
  const got = await fetchText(url, "application/json");
  if (!got.ok) return { ok: false, reason: got.reason, data: null };
  try {
    return { ok: true, reason: "", data: JSON.parse(got.text) };
  } catch {
    return { ok: false, reason: "bad-json", data: null };
  }
}

async function fetchText(url, accept) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: ac.signal,
      headers: { "User-Agent": UA, Accept: accept || "text/html" },
    });
    if (!r.ok) return { ok: false, reason: "http-" + r.status, text: "" };
    return { ok: true, reason: "", text: await r.text() };
  } catch (e) {
    return { ok: false, reason: e && e.name === "AbortError" ? "timeout" : "unreachable", text: "" };
  } finally {
    clearTimeout(t);
  }
}

function entityDescription(entity) {
  const block = entity && entity.descriptions && entity.descriptions.en;
  return normSpace(block && block.value);
}

function looksLikeFilmBlurb(desc) {
  const text = normSpace(desc);
  if (!/\b(film|movie)\b/i.test(text)) return false;
  return !/\b(novel|album|soundtrack|song|video game|book|score|series|episode)\b/i.test(text);
}

function claimValues(entity, prop) {
  const claims = entity && entity.claims && entity.claims[prop];
  if (!Array.isArray(claims)) return [];
  const out = [];
  for (const c of claims) {
    const v = c && c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
    if (v != null) out.push(v);
  }
  return out;
}

function claimIds(entity, prop) {
  const out = [];
  for (const v of claimValues(entity, prop)) {
    if (v && typeof v.id === "string" && /^Q\d+$/.test(v.id)) out.push(v.id);
  }
  return out;
}

function claimYear(entity, prop) {
  const v = claimValues(entity, prop)[0];
  const m = String(v && v.time || "").match(/([+-]?\d{4})/);
  if (!m) return null;
  const y = Number(m[1]);
  if (!Number.isFinite(y) || y < 1880 || y > 2100) return null;
  return y;
}

function claimString(entity, prop) {
  const v = claimValues(entity, prop)[0];
  return typeof v === "string" ? normSpace(v) : "";
}

export function isFilmEntity(entity) {
  const types = claimIds(entity, "P31");
  if (types.length) return types.some((id) => FILM_TYPES.has(id));
  return looksLikeFilmBlurb(entityDescription(entity));
}

export function mapWikiFilm(entity, labelById) {
  if (!entity || entity.missing) return null;
  if (!isFilmEntity(entity)) return null;
  const label = entity.labels && entity.labels.en && entity.labels.en.value;
  const title = normSpace(label).slice(0, 200);
  if (!title) return null;
  const labels = labelById || {};
  const directors = claimIds(entity, "P57").map((id) => labels[id]).filter(Boolean).slice(0, 2);
  const genre = claimIds(entity, "P136").map((id) => labels[id]).filter(Boolean)[0] || "";
  const file = claimString(entity, "P18");
  const cover = file
    ? ("https://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(file) + "?width=200")
    : "";
  return {
    title,
    director: directors.join(", ").slice(0, 120),
    year: claimYear(entity, "P577"),
    genre: normSpace(genre).slice(0, 60),
    cover: cover.slice(0, 400),
    description: entityDescription(entity).slice(0, 800),
    // Wikidata has no star count. Do not invent a 0.
    communityRating: null,
    ratingsCount: null,
    ratingSource: "",
    storeUrl: "",
  };
}

async function wikiSearchIds(q) {
  const query = normSpace(q).slice(0, MAX_Q);
  if (!query) return [];
  const searchUrl = joinUrl(WIKI_BASE, "/w/api.php")
    + "?action=wbsearchentities&search=" + encodeURIComponent(query)
    + "&language=en&type=item&limit=12&format=json";
  const found = await fetchJson(searchUrl);
  const hits = found.ok && found.data && Array.isArray(found.data.search) ? found.data.search : [];
  const ids = [];
  for (const hit of hits) {
    const id = hit && hit.id;
    if (!/^Q\d+$/.test(id || "")) continue;
    const desc = normSpace(hit.description);
    if (desc && !looksLikeFilmBlurb(desc)) continue;
    ids.push(id);
    if (ids.length >= MAX_RESULTS) break;
  }
  return ids;
}

async function wikiEntities(ids, props) {
  if (!ids.length) return {};
  const got = await fetchJson(joinUrl(WIKI_BASE, "/w/api.php")
    + "?action=wbgetentities&ids=" + ids.join("%7C")
    + "&props=" + props
    + "&languages=en&format=json");
  return got.ok && got.data && got.data.entities ? got.data.entities : {};
}

function qualifierIds(statement, prop) {
  const list = statement && statement.qualifiers && statement.qualifiers[prop];
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const q of list) {
    const v = q && q.datavalue && q.datavalue.value;
    if (v && typeof v.id === "string" && /^Q\d+$/.test(v.id)) out.push(v.id);
  }
  return out;
}

function percentScore(text) {
  const m = String(text || "").match(/(\d+(?:\.\d+)?)\s*%/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return n;
}

function tenScore(text) {
  const m = String(text || "").match(/(\d+(?:\.\d+)?)\s*\/\s*10/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0 || n > 10) return null;
  return n;
}

function boundedScore(raw, max) {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return n;
}

// The scorecard is a script, not a guessed host. audienceScore.averageRating
// is out of 5. criticsScore.averageRating is out of 10. A 4.2 critic average
// must not be read as the user average, and a number past its scale is dropped.
export function parseRtScorecard(html) {
  const text = String(html || "");
  const mark = 'data-json="mediaScorecard"';
  const at = text.indexOf(mark);
  if (at < 0) return null;
  const open = text.indexOf(">", at);
  const close = text.indexOf("</script>", open);
  if (open < 0 || close < 0) return null;
  let data;
  try { data = JSON.parse(text.slice(open + 1, close)); } catch { return null; }
  if (!data || typeof data !== "object") return null;
  const critics = data.criticsScore && typeof data.criticsScore === "object" ? data.criticsScore : {};
  const audience = data.audienceScore && typeof data.audienceScore === "object" ? data.audienceScore : {};
  return {
    tomatoMeter: boundedScore(critics.score, 100),
    tomatoAverage: boundedScore(critics.averageRating, 10),
    popcornMeter: boundedScore(audience.score, 100),
    userAverage: boundedScore(audience.averageRating, 5),
  };
}

export function parseRtScores(entity) {
  const claims = entity && entity.claims && entity.claims.P444;
  let tomatoMeter = null;
  let tomatoAverage = null;
  let popcornMeter = null;
  if (!Array.isArray(claims)) return { tomatoMeter, tomatoAverage, popcornMeter };
  for (const c of claims) {
    if (!qualifierIds(c, "P447").includes(RT_BY)) continue;
    const methods = qualifierIds(c, "P459");
    const raw = c && c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
    const text = normSpace(typeof raw === "string" ? raw : "");
    if (methods.includes(RT_TOMATOMETER)) {
      const n = percentScore(text);
      if (n != null) tomatoMeter = n;
    } else if (methods.includes(RT_POPCORN)) {
      const n = percentScore(text);
      if (n != null) popcornMeter = n;
    } else if (methods.includes(RT_AVERAGE)) {
      const n = tenScore(text);
      if (n != null) tomatoAverage = n;
    }
  }
  return { tomatoMeter, tomatoAverage, popcornMeter };
}

export function titleQuery(title) {
  const raw = normSpace(title);
  const m = raw.match(/^(.*)\((\d{4})\)\s*$/);
  if (!m) return { title: raw, year: null };
  const y = Number(m[2]);
  if (!Number.isFinite(y) || y < 1880 || y > 2100) return { title: raw, year: null };
  return { title: normSpace(m[1]), year: y };
}

export function pickFilm(entities, title, year) {
  const want = blockKey(title);
  if (!want) return null;
  let exact = null;
  for (const entity of entities) {
    if (!entity || !isFilmEntity(entity)) continue;
    const label = entity.labels && entity.labels.en && entity.labels.en.value;
    if (blockKey(label) !== want) continue;
    if (year && claimYear(entity, "P577") === year) return entity;
    if (!exact) exact = entity;
  }
  return exact;
}

function wikiSlug(title) {
  const t = normSpace(title);
  if (!t || t.length > 180 || /[/?#]/.test(t)) return "";
  return encodeURIComponent(t.replace(/ /g, "_"));
}

function posterFromSummary(data) {
  const src = data && data.thumbnail && data.thumbnail.source;
  if (typeof src !== "string" || src.indexOf("https://upload.wikimedia.org/") !== 0) return "";
  return src.slice(0, 500);
}

function rtPathOf(entity) {
  const id = claimString(entity, "P1258");
  if (!/^m\/[a-z0-9_]+$/i.test(id)) return "";
  return id.toLowerCase();
}

export async function searchFilms(q) {
  const ids = await wikiSearchIds(q);
  if (!ids.length) return [];
  const entities = await wikiEntities(ids, "labels%7Cdescriptions%7Cclaims");
  const films = [];
  for (const id of ids) {
    const entity = entities[id];
    if (entity && isFilmEntity(entity)) films.push(entity);
  }
  const need = [];
  const seenNeed = new Set();
  for (const entity of films) {
    const related = claimIds(entity, "P57").slice(0, 2).concat(claimIds(entity, "P136").slice(0, 1));
    for (const id of related) {
      if (seenNeed.has(id)) continue;
      seenNeed.add(id);
      need.push(id);
    }
  }
  const labelById = {};
  if (need.length) {
    const labels = await fetchJson(joinUrl(WIKI_BASE, "/w/api.php")
      + "?action=wbgetentities&ids=" + need.slice(0, 40).join("%7C")
      + "&props=labels&languages=en&format=json");
    const named = labels.ok && labels.data && labels.data.entities ? labels.data.entities : {};
    for (const id of need) {
      const name = named[id] && named[id].labels && named[id].labels.en && named[id].labels.en.value;
      if (name) labelById[id] = normSpace(name);
    }
  }
  const out = [];
  for (const entity of films) {
    const movie = mapWikiFilm(entity, labelById);
    if (!movie) continue;
    out.push(movie);
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

export async function filmDetail(rawTitle, rawYear) {
  const parsed = titleQuery(rawTitle);
  const year = asNum(rawYear) == null ? parsed.year : asNum(rawYear);
  const title = parsed.title;
  if (!title) return { found: false, reason: "empty", title: "", year: null, director: "", cover: "", tomatoMeter: null, tomatoAverage: null, userAverage: null, popcornMeter: null, rtPath: "" };
  const ids = await wikiSearchIds(title);
  const entities = await wikiEntities(ids, "labels%7Cdescriptions%7Cclaims%7Csitelinks");
  const films = ids.map((id) => entities[id]).filter(Boolean);
  const entity = pickFilm(films, title, year);
  if (!entity) return { found: false, reason: "no-match", title: title, year: year, director: "", cover: "", tomatoMeter: null, tomatoAverage: null, userAverage: null, popcornMeter: null, rtPath: "" };
  const scores = parseRtScores(entity);
  const label = entity.labels && entity.labels.en && entity.labels.en.value;
  const directorIds = claimIds(entity, "P57").slice(0, 2);
  const named = await wikiEntities(directorIds, "labels");
  const directors = directorIds.map((id) => {
    const name = named[id] && named[id].labels && named[id].labels.en && named[id].labels.en.value;
    return name ? normSpace(name) : "";
  }).filter(Boolean);
  let cover = "";
  const wikiTitle = entity.sitelinks && entity.sitelinks.enwiki && entity.sitelinks.enwiki.title;
  const slug = wikiSlug(wikiTitle);
  if (slug) {
    const sum = await fetchJson(joinUrl(ENWIKI_BASE, "/api/rest_v1/page/summary/" + slug));
    cover = posterFromSummary(sum.ok ? sum.data : null);
  }
  if (!cover) {
    const file = claimString(entity, "P18");
    if (file) cover = ("https://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(file) + "?width=400").slice(0, 400);
  }
  const rtPath = rtPathOf(entity);
  let userAverage = null;
  if (rtPath) {
    const page = await fetchText(joinUrl(RT_BASE, "/" + rtPath));
    const card = page.ok ? parseRtScorecard(page.text) : null;
    if (card) {
      if (card.tomatoMeter != null) scores.tomatoMeter = card.tomatoMeter;
      if (card.tomatoAverage != null) scores.tomatoAverage = card.tomatoAverage;
      if (card.popcornMeter != null) scores.popcornMeter = card.popcornMeter;
      userAverage = card.userAverage;
    }
  }
  return {
    found: true,
    title: normSpace(label).slice(0, 200),
    year: claimYear(entity, "P577"),
    director: directors.join(", ").slice(0, 120),
    cover,
    tomatoMeter: scores.tomatoMeter,
    tomatoAverage: scores.tomatoAverage,
    userAverage,
    popcornMeter: scores.popcornMeter,
    rtPath,
  };
}

export function sanitizeShelf(raw) {
  const out = [];
  for (const b of (Array.isArray(raw) ? raw : [])) {
    if (!b || !b.title) continue;
    out.push({
      title: normSpace(b.title).slice(0, 200),
      director: normSpace(b.director).slice(0, 120),
      rating: asNum(b.rating),
    });
    if (out.length >= MAX_SHELF) break;
  }
  return out;
}

function movieKey(title) {
  return normSpace(title).toLowerCase();
}

const MAX_PASSED = 80;

export function sanitizePassed(raw) {
  const out = [];
  const seen = new Set();
  for (const b of (Array.isArray(raw) ? raw : [])) {
    const title = normSpace(b && b.title).slice(0, 200);
    if (!title) continue;
    const director = normSpace(b && (b.director || b.author)).slice(0, 120);
    const k = movieKey(title);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ title, director });
    if (out.length >= MAX_PASSED) break;
  }
  return out;
}

function blockKey(title) {
  return movieKey(title).replace(/^(a|an|the)\s+/, "");
}

function passedLines(rows) {
  return rows.map((b) => "- " + b.title + (b.director ? " — " + b.director : "")).join("\n");
}

export function buildRecommendPrompt(shelf, extras) {
  const interests = Array.isArray(extras && extras.interests) ? extras.interests : [];
  const skipped = sanitizePassed(extras && extras.skipped);
  const watched = sanitizePassed(extras && extras.watched);
  const lines = (Array.isArray(shelf) ? shelf : []).map((b) => {
    const r = asNum(b.rating);
    const stars = r == null ? "unrated" : r + "/5";
    return "- " + (b.title || "Untitled") + " — " + stars;
  });
  let extra = "";
  if (interests.length) extra += "\nInterests they named: " + interests.join(", ") + ".";
  if (watched.length) extra += "\n\nALREADY WATCHED (do not recommend these):\n" + passedLines(watched);
  if (skipped.length) extra += "\n\nNOT INTERESTED (do not recommend these):\n" + passedLines(skipped);
  const ask = (watched.length || skipped.length)
    ? "Recommend exactly 5 movies they do NOT already own, have not already watched, and are not in the not-interested list."
    : "Recommend exactly 5 movies they do NOT already own.";
  return (
    "Here is every movie this household already owns, with this viewer's own star rating when they gave one (1-5). Unrated means they own it but have not scored it.\n\n"
    + "OWNED:\n" + (lines.length ? lines.join("\n") : "(none yet)") + "\n"
    + extra
    + "\n\n" + ask + " For each, write a brief summary (two sentences) and why it fits this list.\n"
    + "Reply with JSON only, no markdown:\n"
    + '{"movies":[{"title":"","director":"","summary":"","why":""}]}'
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
  const rows = Array.isArray(parsed && parsed.movies) ? parsed.movies
    : (Array.isArray(parsed && parsed.books) ? parsed.books : (Array.isArray(parsed) ? parsed : []));
  const have = new Set((Array.isArray(shelf) ? shelf : []).map((b) => movieKey(b.title)));
  const banned = new Set(sanitizePassed(blocked).map((b) => blockKey(b.title)));
  const out = [];
  const seen = new Set();
  for (const b of rows) {
    if (!b || !b.title) continue;
    const title = normSpace(b.title).slice(0, 200);
    const director = normSpace(b.director || b.author).slice(0, 120);
    const k = movieKey(title);
    if (!title || have.has(k) || banned.has(blockKey(title)) || seen.has(k)) continue;
    seen.add(k);
    out.push({
      title,
      director,
      summary: normSpace(b.summary).slice(0, 600),
      why: normSpace(b.why).slice(0, 400),
    });
    if (out.length >= 5) break;
  }
  return out;
}

async function callGrokRecommend(prompt) {
  const key = process.env.XAI_API_KEY || "";
  const base = (process.env.MOVIES_XAI_BASE || process.env.XAI_BASE_URL || "https://api.x.ai").replace(/\/$/, "");
  const model = process.env.MOVIES_GROK_MODEL || GROK_MODEL;
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
          { role: "system", content: "You recommend movies this household does not already own. Reply with JSON only." },
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
  const skipped = sanitizePassed(body.skipped);
  const watched = sanitizePassed(body.watched);
  const prompt = buildRecommendPrompt(shelf, { interests, skipped, watched });
  const got = await callGrokRecommend(prompt);
  if (!got.ok) {
    return {
      movies: [],
      model: got.model,
      error: got.reason === "no-key" ? "Recommendations need a Grok key." : "Could not recommend right now.",
      reason: got.reason,
    };
  }
  return { movies: parseGrokRecs(got.text, shelf, skipped.concat(watched)), model: got.model };
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
    const movies = await searchFilms(body.q);
    return json({ movies }, 200, headers);
  }
  if (action === "detail") {
    const detail = await filmDetail(body.title, body.year);
    return json(detail, 200, headers);
  }
  if (action === "recommend") {
    return recommendStream(recommend(body), headers);
  }
  return json({ error: 'action must be "search", "detail", or "recommend"' }, 400, headers);
};
