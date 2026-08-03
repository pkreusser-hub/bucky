// BUCKY — the family news feed.
//
// Netlify Function (ESM). POST JSON, secret-gated like every other function here.
//
//   { secret, action:"discover", url }
//     -> { ok, feedUrl, title, siteUrl }   — turn a publication's homepage into its RSS feed
//
//   { secret, action:"feed", sources:[{id,title,feedUrl}], perSource, hours }
//     -> { items:[{id, sourceId, sourceTitle, title, link, published, image, excerpt, summary}],
//          sources:[{id, ok, count, reason}] }
//
//   { secret, action:"summarize", articles:[{id,sourceTitle,title,excerpt}] }
//     -> { summaries:{ id: "..." }, ok }
//
// WHY THOSE ARE TWO CALLS AND NOT ONE. A Netlify function has ~10 seconds to answer, and
// Sonnet writing forty 40-word summaries is a minute of generation — one combined call would
// time out every single day. So "feed" does the fast part (fetch + parse, a few seconds) and
// returns each article with the publisher's own blurb already in `summary`; the client paints
// those headlines immediately and then fires several small "summarize" calls in parallel,
// swapping each card's text as its batch lands. Progressive by necessity, better by accident:
// the reader sees headlines in about a second instead of staring at a spinner.
//
// WHY A SERVER PROXY (the stocks.mjs argument, again): publishers do not send CORS headers on
// their RSS feeds, so a browser fetch of nytimes.com/rss fails before it starts. Fetching
// server-side sidesteps CORS entirely and lets us set a real User-Agent (several publishers
// 403 the default one). It is also the only place the Anthropic key may live.
//
// SUMMARIES are written by Sonnet 5 in BATCHES of a few articles rather than one call each —
// cheaper, and a batch that fails only costs its own handful of cards (they keep the
// publisher's blurb). The client caches the finished digest for the whole family (see
// newsDigest in index.html), so a normal day costs one set of calls no matter how many
// people read it, and re-opening the app costs nothing at all.
//
// Zero dependencies, hand-rolled fetch + XML parsing — the house convention shared with
// calendar.mjs / farmgpt.mjs / notify.mjs / stocks.mjs.
//
// Required env: BUCKY_NOTIFY_SECRET (the shared family passphrase), ANTHROPIC_API_KEY
//   (already set for FarmGPT; without it articles still arrive, just with the publisher's own
//   blurb instead of a written summary — the feed degrades, it never fails).
// Optional env: NEWS_ANTHROPIC_BASE_URL / ANTHROPIC_BASE_URL to point at a fake server in tests,
//   NEWS_ALLOW_PRIVATE=1 to permit private-network fetches (test harness only — see guardUrl).

import { lookup as dnsLookup } from "node:dns/promises";

const ALLOWED_ORIGINS = new Set([
  "https://amenfarms.netlify.app",
  "http://localhost:8080",
  "http://localhost:3000",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:3000",
]);

const SUMMARY_MODEL = "claude-sonnet-5";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 BuckyNews/1.0";

const MAX_SOURCES = 25;         // how many publications one request may carry
const MAX_PER_SOURCE = 6;       // articles kept from any single publication
const MAX_ITEMS = 40;           // total articles in a digest (caps the summariser's bill)
const MAX_SUMMARIZE = 8;        // articles per summarize call — sized to land inside ~10s
const DEFAULT_HOURS = 36;       // "today's news" window; a quiet feed falls back to its newest
const FETCH_TIMEOUT_MS = 6000;  // one slow publisher must not sink the whole request
const MAX_BODY_BYTES = 3 * 1024 * 1024;
const EXCERPT_CHARS = 700;      // per-article text handed to the summariser

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

/* ---------------------------------------------------------------------------
   URL safety.

   This function fetches a URL a person typed in. Only Dad can add a source, so the
   threat model is mild, but "our server will GET any address you name" is exactly the
   shape of an SSRF, so it is closed properly rather than trusted: https/http only, no
   credentials, no non-standard ports, and the hostname must not resolve into a private
   or link-local range (169.254.169.254 is the cloud metadata endpoint).
   --------------------------------------------------------------------------- */
function isPrivateIPv4(ip) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  if (p[0] === 169 && p[1] === 254) return true;   // link-local + cloud metadata
  if (p[0] >= 224) return true;                    // multicast / reserved
  return false;
}
function isPrivateIPv6(ip) {
  const s = String(ip).toLowerCase();
  if (s === "::1" || s === "::") return true;
  if (s.startsWith("fe80") || s.startsWith("fc") || s.startsWith("fd")) return true;
  if (s.startsWith("::ffff:")) return isPrivateIPv4(s.slice(7));
  return false;
}

async function guardUrl(raw) {
  let u;
  try { u = new URL(String(raw || "").trim()); } catch { return { ok: false, reason: "bad-url" }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: "bad-scheme" };
  if (u.username || u.password) return { ok: false, reason: "bad-url" };
  // The escape hatch comes first so a test harness can serve a fake publisher on any
  // loopback port; in production neither branch below is skipped.
  if (process.env.NEWS_ALLOW_PRIVATE === "1") return { ok: true, url: u };
  if (u.port && !["", "80", "443", "8080"].includes(u.port)) return { ok: false, reason: "bad-port" };

  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return { ok: false, reason: "private" };
  }
  let addrs;
  try { addrs = await dnsLookup(host, { all: true }); } catch { return { ok: false, reason: "dns" }; }
  if (!addrs.length) return { ok: false, reason: "dns" };
  for (const a of addrs) {
    const bad = a.family === 6 ? isPrivateIPv6(a.address) : isPrivateIPv4(a.address);
    if (bad) return { ok: false, reason: "private" };
  }
  return { ok: true, url: u };
}

/** Fetch with a timeout and a hard size cap, returning text. Never throws. */
async function getText(url, accept) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": UA, accept: accept || "*/*", "accept-language": "en-US,en;q=0.9" },
    });
    if (!r.ok) return { ok: false, reason: "http-" + r.status };
    const len = Number(r.headers.get("content-length") || 0);
    if (len && len > MAX_BODY_BYTES) return { ok: false, reason: "too-big" };
    const text = await r.text();
    if (text.length > MAX_BODY_BYTES) return { ok: false, reason: "too-big" };
    return { ok: true, text, finalUrl: r.url || url, type: r.headers.get("content-type") || "" };
  } catch (e) {
    return { ok: false, reason: (e && e.name === "AbortError") ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------------------
   Tiny XML/HTML helpers. Deliberately string-based: a full parser is a dependency,
   and feeds are a small, well-known shape.
   --------------------------------------------------------------------------- */
const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…", eacute: "é",
};
function decodeEntities(s) {
  return String(s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ""; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(Number(d)); } catch { return ""; } })
    .replace(/&([a-z]+);/gi, (m, n) => (ENTITIES[n.toLowerCase()] !== undefined ? ENTITIES[n.toLowerCase()] : m));
}
/** Feed text arrives as escaped HTML, real HTML, or CDATA. Reduce all three to plain text. */
function toPlainText(s) {
  let t = String(s || "");
  t = t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ");
  t = t.replace(/<br\s*\/?>/gi, " ").replace(/<\/p>/gi, " ");
  t = t.replace(/<[^>]*>/g, " ");
  t = decodeEntities(t);
  // A feed that double-escapes (&lt;p&gt; for a tag, &amp;ndash; for a dash) leaves a
  // second round of both behind. Decode once more so the reader sees "7–2" rather than
  // "7&ndash;2". Safe here in a way it would not be elsewhere: this text is only ever
  // written with textContent, never innerHTML, so there is no markup to smuggle back in.
  if (/<[a-z/][^>]*>/i.test(t)) t = decodeEntities(t.replace(/<[^>]*>/g, " "));
  else if (/&[a-z]+;|&#\d+;/i.test(t)) t = decodeEntities(t);
  return t.replace(/\s+/g, " ").trim();
}
function stripCdata(s) {
  return String(s || "").replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").trim();
}
/** First <tag>…</tag> inside a block. Namespaced names (dc:creator) are matched literally. */
function tagText(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i");
  const m = re.exec(block);
  return m ? stripCdata(m[1]) : "";
}
function attrOf(tagStr, name) {
  const m = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tagStr || "");
  return m ? decodeEntities(m[2] !== undefined ? m[2] : m[3]) : "";
}

/* ---------------------------------------------------------------------------
   RSS feed discovery: homepage -> feed URL.
   --------------------------------------------------------------------------- */
const FEED_GUESSES = ["/feed", "/rss", "/feed/", "/rss.xml", "/feed.xml", "/index.xml", "/atom.xml", "/feeds/all.atom.xml", "/blog/feed"];

function looksLikeFeed(text, contentType) {
  if (/(?:application|text)\/(?:rss|atom|xml)/i.test(contentType || "")) {
    if (/<(?:rss|feed|rdf:RDF)[\s>]/i.test(text)) return true;
  }
  return /<(?:rss|feed|rdf:RDF)[\s>]/i.test(String(text).slice(0, 2000));
}

function feedTitleOf(text) {
  // The channel/feed title lives before the first item, so cut there to avoid an article title.
  const cut = text.search(/<(?:item|entry)[\s>]/i);
  const head = cut > 0 ? text.slice(0, cut) : text.slice(0, 4000);
  return toPlainText(tagText(head, "title")).slice(0, 80);
}

async function discover(rawUrl) {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(String(rawUrl || "").trim())
    ? String(rawUrl).trim()
    : "https://" + String(rawUrl || "").trim().replace(/^\/+/, "");

  const guard = await guardUrl(withScheme);
  if (!guard.ok) return { ok: false, reason: guard.reason };
  const base = guard.url;

  // 1. The URL itself may already be a feed.
  const first = await getText(base.href, "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/html;q=0.8");
  if (first.ok && looksLikeFeed(first.text, first.type)) {
    return { ok: true, feedUrl: first.finalUrl || base.href, title: feedTitleOf(first.text) || base.hostname, siteUrl: base.origin };
  }

  // 2. <link rel="alternate" type="application/rss+xml" href="...">
  if (first.ok) {
    const links = first.text.match(/<link\b[^>]*>/gi) || [];
    const cands = [];
    for (const tag of links) {
      const rel = attrOf(tag, "rel").toLowerCase();
      const type = attrOf(tag, "type").toLowerCase();
      const href = attrOf(tag, "href");
      if (!href || !rel.includes("alternate")) continue;
      if (!/rss|atom|xml/.test(type)) continue;
      cands.push({ href, title: attrOf(tag, "title"), rss: type.includes("rss") });
    }
    cands.sort((a, b) => Number(b.rss) - Number(a.rss));   // prefer RSS over Atom, arbitrary but stable
    for (const c of cands.slice(0, 4)) {
      let abs;
      try { abs = new URL(c.href, first.finalUrl || base.href).href; } catch { continue; }
      const g = await guardUrl(abs);
      if (!g.ok) continue;
      const r = await getText(abs, "application/rss+xml, application/xml");
      if (r.ok && looksLikeFeed(r.text, r.type)) {
        return { ok: true, feedUrl: r.finalUrl || abs, title: feedTitleOf(r.text) || c.title || base.hostname, siteUrl: base.origin };
      }
    }
  }

  // 3. The well-known paths, in order.
  for (const path of FEED_GUESSES) {
    let abs;
    try { abs = new URL(path, base.origin).href; } catch { continue; }
    const g = await guardUrl(abs);
    if (!g.ok) continue;
    const r = await getText(abs, "application/rss+xml, application/xml");
    if (r.ok && looksLikeFeed(r.text, r.type)) {
      return { ok: true, feedUrl: r.finalUrl || abs, title: feedTitleOf(r.text) || base.hostname, siteUrl: base.origin };
    }
  }

  return { ok: false, reason: first.ok ? "no-feed" : first.reason };
}

/* ---------------------------------------------------------------------------
   Feed parsing: RSS 2.0, RDF/RSS 1.0 and Atom, into one shape.
   --------------------------------------------------------------------------- */
function blocksOf(xml, tag) {
  const out = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "gi");
  let m;
  while ((m = re.exec(xml)) !== null) { out.push(m[1]); if (out.length >= 60) break; }
  return out;
}

function atomLink(block) {
  const tags = block.match(/<link\b[^>]*>/gi) || [];
  let fallback = "";
  for (const t of tags) {
    const href = attrOf(t, "href");
    if (!href) continue;
    const rel = attrOf(t, "rel").toLowerCase();
    if (rel === "alternate" || rel === "") return href;
    if (!fallback) fallback = href;
  }
  return fallback;
}

function imageOf(block) {
  const media = /<media:(?:thumbnail|content)\b[^>]*>/i.exec(block);
  if (media) {
    const url = attrOf(media[0], "url");
    if (url && /^https?:\/\//i.test(url)) return url;
  }
  const enc = /<enclosure\b[^>]*>/i.exec(block);
  if (enc && /image\//i.test(attrOf(enc[0], "type"))) {
    const url = attrOf(enc[0], "url");
    if (url && /^https?:\/\//i.test(url)) return url;
  }
  const inline = /<img\b[^>]*src\s*=\s*("([^"]+)"|'([^']+)')/i.exec(block);
  if (inline) {
    const url = decodeEntities(inline[2] !== undefined ? inline[2] : inline[3]);
    if (/^https?:\/\//i.test(url)) return url;
  }
  return "";
}

function parseDate(s) {
  const t = String(s || "").trim();
  if (!t) return 0;
  const d = new Date(t);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function parseFeed(xml, sourceUrl) {
  const clean = String(xml).replace(/<!--[\s\S]*?-->/g, "");
  const isAtom = /<feed[\s>]/i.test(clean.slice(0, 2000)) && !/<rss[\s>]/i.test(clean.slice(0, 2000));
  const blocks = isAtom ? blocksOf(clean, "entry") : blocksOf(clean, "item");
  const out = [];
  for (const b of blocks) {
    const title = toPlainText(tagText(b, "title"));
    let link = isAtom ? atomLink(b) : toPlainText(tagText(b, "link"));
    if (!link) link = toPlainText(tagText(b, "guid"));
    if (link && !/^https?:\/\//i.test(link)) {
      try { link = new URL(link, sourceUrl).href; } catch { link = ""; }
    }
    if (!title && !link) continue;

    const body = tagText(b, "content:encoded") || tagText(b, "description")
      || tagText(b, "summary") || tagText(b, "content") || "";
    const when = parseDate(tagText(b, "pubDate") || tagText(b, "published")
      || tagText(b, "updated") || tagText(b, "dc:date"));

    out.push({
      title: title.slice(0, 300),
      link,
      published: when,
      excerpt: toPlainText(body).slice(0, EXCERPT_CHARS),
      image: imageOf(b),
      author: toPlainText(tagText(b, "dc:creator") || tagText(b, "author")).slice(0, 80),
    });
  }
  return out;
}

/** Stable per-article id so the client can de-dupe and remember what's been read. */
function itemId(sourceId, link, title) {
  const basis = `${sourceId}|${link || ""}|${title || ""}`;
  let h = 5381;
  for (let i = 0; i < basis.length; i++) h = ((h * 33) ^ basis.charCodeAt(i)) >>> 0;
  return "n" + h.toString(36);
}

/* ---------------------------------------------------------------------------
   The summariser: ONE Sonnet call for the whole digest.
   --------------------------------------------------------------------------- */
const SUMMARY_SYSTEM = `You write the one-line summaries under headlines in a family's daily news digest.

For each numbered article you are given a headline and, usually, an excerpt of the article's own text.

Write 1-2 plain sentences, 25-45 words, saying what actually happened and why it matters.
- Lead with the substance. Never open with "This article..." or "The piece discusses...".
- Use ONLY the headline and excerpt given. Never add facts, figures, names, or outcomes that are not there.
- If the excerpt is missing or too thin to say anything real, write a single neutral sentence from the headline alone and nothing more. Do not speculate about what the article probably says.
- Neutral and factual. No opinion, no editorialising, no hype, no clickbait.
- This is read by a whole family including children: no graphic detail. Summarise difficult news plainly and gently rather than vividly.
- Plain prose only. No markdown, no bullets, no quotation marks around the whole summary.

Reply with ONLY a JSON array, one object per article, in the order given:
[{"i":1,"s":"..."},{"i":2,"s":"..."}]
No prose before or after the array.`;

function fallbackSummary(item) {
  // The publisher's own blurb, trimmed at a sentence boundary — used when the model is
  // unavailable or skipped an article. Never leaves a card blank.
  const t = String(item.excerpt || "").trim();
  if (!t) return "";
  if (t.length <= 220) return t;
  const cut = t.slice(0, 220);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (stop > 90 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, "") + "…");
}

async function summarize(items, timeoutMs) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !items.length) return { ok: false, reason: apiKey ? "empty" : "no-key" };

  const lines = items.map((it, n) => {
    const parts = [`### Article ${n + 1}`, `Publication: ${it.sourceTitle}`, `Headline: ${it.title}`];
    if (it.excerpt) parts.push(`Excerpt: ${it.excerpt}`);
    else parts.push("Excerpt: (none provided)");
    return parts.join("\n");
  }).join("\n\n");

  const apiBase = process.env.NEWS_ANTHROPIC_BASE_URL || process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 20000);
  let r;
  try {
    r = await fetch(`${apiBase}/v1/messages`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: SUMMARY_MODEL,
        max_tokens: Math.min(4096, 220 + items.length * 90),
        system: SUMMARY_SYSTEM,
        messages: [{ role: "user", content: `Summarise these ${items.length} articles.\n\n${lines}` }],
      }),
    });
  } catch (e) {
    return { ok: false, reason: (e && e.name === "AbortError") ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
  if (!r.ok) return { ok: false, reason: "http-" + r.status };

  let j;
  try { j = await r.json(); } catch { return { ok: false, reason: "bad-json" }; }
  const text = (j && Array.isArray(j.content) ? j.content : [])
    .filter((b) => b && b.type === "text").map((b) => b.text).join("");

  // Models occasionally wrap the array in a fence or a sentence; take the outermost array.
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return { ok: false, reason: "no-array" };
  let arr;
  try { arr = JSON.parse(text.slice(start, end + 1)); } catch { return { ok: false, reason: "bad-array" }; }
  if (!Array.isArray(arr)) return { ok: false, reason: "bad-array" };

  const byIndex = new Map();
  for (const row of arr) {
    if (!row || typeof row !== "object") continue;
    const i = Number(row.i);
    const s = typeof row.s === "string" ? row.s.trim() : "";
    if (Number.isInteger(i) && i >= 1 && i <= items.length && s) byIndex.set(i, s.slice(0, 400));
  }
  return { ok: true, byIndex, usage: (j && j.usage) || null };
}

/* ---------------------------------------------------------------------------
   The digest.
   --------------------------------------------------------------------------- */
async function loadSource(src) {
  const guard = await guardUrl(src.feedUrl);
  if (!guard.ok) return { id: src.id, ok: false, reason: guard.reason, items: [] };

  const r = await getText(guard.url.href, "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8");
  if (!r.ok) return { id: src.id, ok: false, reason: r.reason, items: [] };
  if (!looksLikeFeed(r.text, r.type)) return { id: src.id, ok: false, reason: "not-a-feed", items: [] };

  let parsed;
  try { parsed = parseFeed(r.text, guard.url.href); } catch { return { id: src.id, ok: false, reason: "parse-failed", items: [] }; }
  if (!parsed.length) return { id: src.id, ok: false, reason: "empty", items: [] };
  return { id: src.id, ok: true, reason: "", items: parsed };
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

  /* ---- discover ---- */
  if (body.action === "discover") {
    const res = await discover(body.url);
    return json(res, 200, headers);
  }

  /* ---- summarize: one small batch, called several times in parallel by the client ---- */
  if (body.action === "summarize") {
    const articles = [];
    for (const a of (Array.isArray(body.articles) ? body.articles : [])) {
      if (!a || typeof a.id !== "string") continue;
      articles.push({
        id: a.id.slice(0, 64),
        sourceTitle: String(a.sourceTitle || "").slice(0, 80),
        title: String(a.title || "").slice(0, 300),
        excerpt: String(a.excerpt || "").slice(0, EXCERPT_CHARS),
      });
      if (articles.length >= MAX_SUMMARIZE) break;
    }
    if (!articles.length) return json({ ok: false, reason: "empty", summaries: {} }, 200, headers);

    const sum = await summarize(articles, 20000);
    const summaries = {};
    if (sum.ok) {
      for (let i = 0; i < articles.length; i++) {
        const s = sum.byIndex.get(i + 1);
        if (s) summaries[articles[i].id] = s;
      }
    }
    return json({ ok: !!sum.ok, reason: sum.ok ? "" : (sum.reason || ""), summaries }, 200, headers);
  }

  /* ---- feed ---- */
  if (body.action !== "feed") return json({ error: 'action must be "discover", "feed" or "summarize"' }, 400, headers);

  const sources = [];
  const seenIds = new Set();
  for (const s of (Array.isArray(body.sources) ? body.sources : [])) {
    if (!s || typeof s.feedUrl !== "string") continue;
    const id = String(s.id || s.feedUrl).slice(0, 64);
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    sources.push({ id, feedUrl: s.feedUrl, title: String(s.title || "").slice(0, 80) });
    if (sources.length >= MAX_SOURCES) break;
  }
  if (!sources.length) return json({ items: [], sources: [], summarized: false }, 200, headers);

  const perSource = Math.max(1, Math.min(MAX_PER_SOURCE, Number(body.perSource) || 4));
  const hours = Math.max(6, Math.min(24 * 7, Number(body.hours) || DEFAULT_HOURS));
  const cutoff = Date.now() - hours * 3600 * 1000;

  const loaded = await Promise.all(sources.map(loadSource));

  // Per publication: prefer what's inside the window, newest first. A publication that
  // simply hasn't posted today still contributes its newest piece rather than vanishing —
  // an empty card reads as broken, and half these feeds are weeklies.
  const report = [];
  const picked = [];
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i], res = loaded[i];
    if (!res.ok) { report.push({ id: src.id, ok: false, count: 0, reason: res.reason }); continue; }

    const sorted = res.items.slice().sort((a, b) => (b.published || 0) - (a.published || 0));
    let take = sorted.filter((it) => it.published && it.published >= cutoff).slice(0, perSource);
    let fresh = take.length > 0;
    if (!take.length) take = sorted.slice(0, Math.min(2, perSource));

    for (const it of take) {
      picked.push({
        id: itemId(src.id, it.link, it.title),
        sourceId: src.id,
        sourceTitle: src.title || res.sourceTitle || "",
        title: it.title,
        link: it.link,
        published: it.published,
        image: it.image,
        author: it.author,
        excerpt: it.excerpt,
        stale: !fresh,
      });
    }
    report.push({ id: src.id, ok: true, count: take.length, reason: fresh ? "" : "nothing-recent" });
  }

  // Newest first across the whole digest, then cap.
  picked.sort((a, b) => (b.published || 0) - (a.published || 0));
  const items = picked.slice(0, MAX_ITEMS);

  // Each article ships with the publisher's own blurb so the feed is readable the instant it
  // paints; the client then replaces these with written summaries batch by batch.
  for (const it of items) {
    it.summary = fallbackSummary(it);
    it.summarySource = it.summary ? "feed" : "none";
  }

  return json({
    items,
    sources: report,
    canSummarize: !!process.env.ANTHROPIC_API_KEY,
    generatedAt: Date.now(),
  }, 200, headers);
};

export const config = {
  path: "/.netlify/functions/news",
};
