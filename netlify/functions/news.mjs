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
//     -> { summaries:{ id: "..." }, ok, usage:{in,out} }
//
// WHY THOSE ARE TWO CALLS AND NOT ONE. A Netlify function has ~10 seconds to answer, and
// writing forty paragraph-length summaries is minutes of generation — one combined call would
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
// SUMMARIES are written by Haiku in BATCHES of a few articles rather than one call each —
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
// Optional env: FIREBASE_SERVICE_ACCOUNT (already set for FarmGPT) turns on usage logging —
//   without it the summaries are identical, they just don't appear on the cost dashboard;
//   NEWS_ANTHROPIC_BASE_URL / ANTHROPIC_BASE_URL to point at a fake server in tests,
//   FARMGPT_GOOGLE_TOKEN_URL / FARMGPT_FIRESTORE_BASE to do the same for the usage write,
//   NEWS_ALLOW_PRIVATE=1 to permit private-network fetches (test harness only — see guardUrl).

import { lookup as dnsLookup } from "node:dns/promises";

const ALLOWED_ORIGINS = new Set([
  "https://amenfarms.netlify.app",
  "http://localhost:8080",
  "http://localhost:3000",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:3000",
]);

// Haiku, not Sonnet (user call 2026-08-03): a factual compression of a supplied excerpt
// doesn't need the bigger model, and Haiku is ~a third the price. Still true at the longer
// 2026-08-04 summary length — see the live samples in that day's CLAUDE.md entry. Same id
// convention as farmgpt.mjs's STORY_MODEL.
const SUMMARY_MODEL = "claude-haiku-4-5";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 BuckyNews/1.0";

const MAX_SOURCES = 25;         // how many publications one request may carry
const MAX_PER_SOURCE = 6;       // articles kept from any single publication
const MAX_ITEMS = 40;           // total articles in a digest (caps the summariser's bill)
/* MAX_SUMMARIZE 8 -> 6 (2026-08-04). Netlify answers a synchronous function in ~10s, and
   4-5 sentence summaries take three times the generation of the old one-liners. MEASURED
   against real Haiku with every excerpt at the full 1800 chars — the case that produces the
   longest replies: batches of 8 ran 4.4 / 4.4 / 6.3s, batches of 6 ran 3.8 / 4.0 / 4.1s.
   Eight would work on a good day, which is the problem: a batch that overruns fails WHOLE
   and every one of its cards drops silently back to the publisher's blurb. Six keeps ~6s of
   margin instead of ~4s. The client pays for it with one more parallel batch, not with time
   (NEWS_SUM_CHUNK / NEWS_SUM_PARALLEL in index.html — keep the chunk equal to this). */
const MAX_SUMMARIZE = 6;        // articles per summarize call — MEASURED, see above
const DEFAULT_HOURS = 36;       // "today's news" window; a quiet feed falls back to its newest
const FETCH_TIMEOUT_MS = 6000;  // one slow publisher must not sink the whole request
const MAX_BODY_BYTES = 3 * 1024 * 1024;
/* EXCERPT_CHARS 700 -> 1800 (2026-08-04, with the move to 4-5 sentence summaries).
   700 characters is ~120 words of source. Asking for a 95-word summary from that is not
   summarising, it is padding, and it fights the invent-nothing rule directly. 1800 is ~300
   words: about three times the summary, which is a real compression ratio, and it is where
   the returns stop — news writing is an inverted pyramid, so the first 300 words carry the
   substance and the rest is quotes and background that a family digest would drop anyway.
   MEASURED on five real feeds (NPR, BBC, The Verge, Science Daily, Ars Technica): excerpt
   lengths run min 89 / median 306 / max 1379, so this only bites on the publications that
   put real text in content:encoded — which is exactly the handful that were being cut at
   700 (Ars alone had four articles between 877 and 1379). The others ship a teaser and
   there is nothing more to have. */
const EXCERPT_CHARS = 1800;     // per-article text handed to the summariser

/* max_tokens — a HARD FLOOR, not a tuning knob.
   If the cap falls short the reply is cut off MID-JSON, the array never parses, and every
   card in the batch silently falls back to the publisher's blurb — shorter summaries, no
   error, nobody notices. That is exactly how the story keeper was quietly losing scenes at
   600 tokens, and the OLD formula (220 + n*90) was already there: a measured worst-case
   batch of 8 rich articles produced 995 output tokens against its cap of 940. It would have
   failed, in production, on the days with the most to read.
   MEASURED worst case (every excerpt at the full 1800 chars, real Haiku): 6 articles ->
   689-743 output tokens, i.e. ~124 each. 250 each is twice that, plus a base covering the
   array brackets and the odd ```json fence. Output bills for what is PRODUCED, never for
   the ceiling, so the headroom costs nothing. */
const SUMMARY_BASE_TOKENS = 300;
const SUMMARY_TOKENS_PER_ARTICLE = 250;
const summaryMaxTokens = (n) => Math.min(4096, SUMMARY_BASE_TOKENS + n * SUMMARY_TOKENS_PER_ARTICLE);

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
   The summariser: ONE model call per batch.
   --------------------------------------------------------------------------- */
const SUMMARY_SYSTEM = `You write the summaries under headlines in a family's daily news digest.

For each numbered article you are given a headline and, usually, an excerpt of the article's own text.

Write 4-5 plain sentences, 80-110 words, saying what actually happened, who it involves, and why it matters.
- Lead with the substance. Never open with "This article..." or "The piece discusses...".
- Use ONLY the headline and excerpt given. Never add facts, figures, names, dates, causes, reactions or outcomes that are not there. Do not fill the length with background you happen to know, with what usually happens in situations like this, or with what is likely to happen next. If you are reaching for something to say, you have already written enough — stop.
- LENGTH IS A CEILING, NOT A QUOTA. A short honest summary is always better than a long padded one. Say everything the excerpt actually contains, then stop, however short that turns out to be.
- If the excerpt is missing, or is only a teaser sentence or two, write ONE neutral sentence from what you were given and nothing more. That is the right answer, not a failure — do not speculate about what the rest of the article probably says in order to reach four sentences.
- Neutral and factual. No opinion, no editorialising, no hype, no clickbait.
- This is read by a whole family including children: no graphic detail. Summarise difficult news plainly and gently rather than vividly.
- Plain prose only. No markdown, no bullets, no quotation marks around the whole summary.

Reply with ONLY a JSON array, one object per article, in the order given:
[{"i":1,"s":"..."},{"i":2,"s":"..."}]
No prose before or after the array.`;

function fallbackSummary(item) {
  // The publisher's own blurb, trimmed at a sentence boundary — used when the model is
  // unavailable or skipped an article. Never leaves a card blank.
  // The 220 is DELIBERATELY independent of EXCERPT_CHARS: the excerpt grew to 1800 to give
  // the summariser something to compress, but this is the card the reader sees when there is
  // no summary, and 1800 characters of raw article body on a phone card is not a fallback,
  // it is a wall. Raising EXCERPT_CHARS must never lengthen this.
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
        max_tokens: summaryMaxTokens(items.length),
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
    // 900, not 400: at 80-110 words a summary runs ~500-700 characters, so the old cap (sized
    // for the 25-45 word version) would have lopped the last sentence off every long one —
    // mid-word, with no error. Still a cap, so a model that ignores the brief can't post an essay.
    if (Number.isInteger(i) && i >= 1 && i <= items.length && s) byIndex.set(i, s.slice(0, 900));
  }
  return { ok: true, byIndex, usage: (j && j.usage) || null };
}

/* ---------------------------------------------------------------------------
   Usage logging — bucket "n" on the SAME dashboard as everything else.

   News had no telemetry at all, which is why its running cost could only ever be
   estimated. It writes into farmgpt_usage / farmgpt_usage_hourly exactly like
   farmgpt.mjs's logUsage: same Firestore docs, same `<bucket>_<metric>` and
   `<bucket>_<modelslug>_<metric>` field shapes, so the existing dashboard reader needs
   nothing but a row added to its BUCKETS table. "n" was free (s u r d k a g c l x t f
   were taken).

   The token-minting and commit code is DUPLICATED from farmgpt.mjs rather than shared:
   these are separate Netlify functions with no shared module in this repo (the same
   house convention that duplicates the Firebase config on every page). Like its
   original it can never break a reply — the whole thing is inside one try/catch and is
   awaited only after the summaries are already in hand.
   --------------------------------------------------------------------------- */
const USAGE_PROJECT_ID = "amen-farms-app";
const USAGE_FIRESTORE_BASE = process.env.FARMGPT_FIRESTORE_BASE ||
  `https://firestore.googleapis.com/v1/projects/${USAGE_PROJECT_ID}/databases/(default)/documents`;
const USAGE_GOOGLE_TOKEN_URL = process.env.FARMGPT_GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
const USAGE_BUCKET = "n";

let cachedGoogleToken = null;   // { token, exp(ms) } — survives across warm invocations

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
    iat: nowSec, exp: nowSec + 3600,
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(header + "." + claims);
  const jwt = header + "." + claims + "." + base64url(signer.sign(sa.private_key));
  const resp = await fetch(USAGE_GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!resp.ok) return null;
  const j = await resp.json();
  cachedGoogleToken = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cachedGoogleToken.token;
}
function farmDate() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}
function farmHour() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t).value;
  const hh = g("hour") === "24" ? "00" : g("hour");   // en-CA reports midnight as "24"
  return `${g("year")}-${g("month")}-${g("day")}-${hh}`;
}
function modelSlug(model) {
  const s = String(model || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return s ? s.slice(0, 24) : "unknown";
}

async function logUsage(inTok, outTok, cacheWriteTok = 0, cacheReadTok = 0, model = SUMMARY_MODEL) {
  try {
    const token = await getGoogleAccessToken();
    if (!token) return;
    const base = `projects/${USAGE_PROJECT_ID}/databases/(default)/documents`;
    const tf = (f, n) => ({ fieldPath: f, increment: { integerValue: String(n) } });
    const k = USAGE_BUCKET;
    const fields = [
      tf(k + "_in", inTok), tf(k + "_out", outTok), tf(k + "_req", 1),
      tf(k + "_cw", cacheWriteTok), tf(k + "_cr", cacheReadTok),
    ];
    if (model) {
      const mk = `${k}_${modelSlug(model)}`;
      fields.push(tf(mk + "_in", inTok), tf(mk + "_out", outTok), tf(mk + "_req", 1),
        tf(mk + "_cw", cacheWriteTok), tf(mk + "_cr", cacheReadTok));
    }
    await fetch(`${USAGE_FIRESTORE_BASE}:commit`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        writes: [
          { transform: { document: `${base}/farmgpt_usage/${farmDate()}`, fieldTransforms: fields } },
          { transform: { document: `${base}/farmgpt_usage_hourly/${farmHour()}`, fieldTransforms: fields } },
        ],
      }),
    });
  } catch { /* telemetry must never break a summary */ }
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
    // Telemetry after the work, never before it, and awaited only so the lambda stays alive
    // long enough for the commit (the farmgpt.mjs convention).
    const u = sum.usage || null;
    const inTok = Number(u && u.input_tokens) || 0;
    const outTok = Number(u && u.output_tokens) || 0;
    if (inTok || outTok) {
      await logUsage(inTok, outTok,
        Number(u.cache_creation_input_tokens) || 0, Number(u.cache_read_input_tokens) || 0);
    }
    return json({
      ok: !!sum.ok, reason: sum.ok ? "" : (sum.reason || ""), summaries,
      // Reported so a run can be MEASURED rather than estimated — this whole batch size was
      // once a guess for exactly the want of it.
      usage: (inTok || outTok) ? { in: inTok, out: outTok } : null,
    }, 200, headers);
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
