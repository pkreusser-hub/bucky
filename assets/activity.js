/* BUCKY — the activity beacon.
 *
 *   <script src="/assets/activity.js" data-feature="games" defer></script>
 *
 * Records that somebody OPENED a page and how long they actually stayed on it. Nothing
 * else in BUCKY has ever recorded a view, so this is the only thing that can answer "is
 * anyone playing the games?" or "who reads the news?" — and the difference between a view
 * and a minute is the whole point: a page that gets opened and abandoned looks identical
 * to a page that gets used, until you measure dwell.
 *
 * WHO: localStorage["choreUser"], the app-wide profile name every other feature keys off.
 * An unset profile is attributed to "Unknown" — never guessed at, never invented.
 *
 * WHAT: the feature name comes from this tag's own data-feature, else the page's file
 * name (index.html -> "app"). window.BuckyActivity.hit("app_news") records a finer-grained
 * view from inside a page — that is how section-level use inside index.html shows up.
 *
 * HOW IT LEAVES: rows are aggregated in localStorage and posted in a batch — on the ~90s
 * timer, when the tab is hidden, and on pagehide — with sendBeacon (which survives the page
 * going away) falling back to keepalive fetch. A flush that fails keeps its rows and tries
 * again next time; the buffer is capped so a device that is offline for a month cannot grow
 * it without bound.
 *
 * THE RULE THIS FILE LIVES BY: it must not be able to break a page. Every entry point is
 * wrapped, nothing runs synchronously on the critical path, and if localStorage or fetch is
 * missing it degrades to an in-memory no-op. A game must render identically whether or not
 * this file loaded at all — which is also why it is loaded `defer` and never awaited.
 */
(function () {
  "use strict";

  var SECRET = "amenfarms";                              // the family passphrase, as in farmgpt.html
  var ENDPOINT = "/.netlify/functions/activity";
  var BUF_KEY = "bucky_act_buf";
  var MAX_ROWS = 200;          // buffered rows kept; oldest dropped past this
  var TICK_MS = 30000;         // dwell heartbeat
  var FLUSH_MS = 90000;        // periodic send
  var MAX_GAP_MS = 120000;     // one dwell step longer than this is a sleeping laptop, not reading
  var MIN_SEND_M = 0.05;       // ~3 seconds: below this a dwell-only row isn't worth a request

  /* ---------------------------------------------------------------------- */

  function safe(fn) {
    return function () {
      try { return fn.apply(null, arguments); } catch (e) { /* never break the page */ }
    };
  }

  /** Storage that degrades to memory when localStorage is unavailable (private mode,
   *  disabled cookies, a sandboxed frame). Reading it can THROW, not just return null. */
  var mem = {};
  var haveLS = (function () {
    try {
      var k = "__act__";
      window.localStorage.setItem(k, "1");
      window.localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  })();
  function getItem(k) {
    try { return haveLS ? window.localStorage.getItem(k) : (mem[k] === undefined ? null : mem[k]); }
    catch (e) { return null; }
  }
  function setItem(k, v) {
    try { if (haveLS) window.localStorage.setItem(k, v); else mem[k] = v; } catch (e) { /* full quota */ }
  }

  /** [a-z0-9_], collapsed, trimmed of edge underscores, 24 chars. The server slugs again
   *  with the same rule — this is convenience, not security. */
  function slug(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 24);
  }

  /** The family's calendar day (Central), matching every other day-keyed feature here. */
  function dayKey() {
    try { return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }); }
    catch (e) { return new Date().toISOString().slice(0, 10); }
  }

  function whoAmI() {
    var n = getItem("choreUser");
    n = String(n == null ? "" : n).trim();
    return n ? n.slice(0, 40) : "Unknown";
  }

  /* ---- the feature this page is ---- */
  var FILE_FEATURE = { index: "app", "": "app" };
  function pageFeature() {
    var el = document.currentScript;
    if (!el) {
      // `defer` scripts still expose currentScript while executing, but be safe.
      var all = document.querySelectorAll('script[src*="activity.js"]');
      el = all.length ? all[all.length - 1] : null;
    }
    var explicit = el && el.getAttribute ? el.getAttribute("data-feature") : "";
    if (explicit && slug(explicit)) return slug(explicit);
    var base = String(location.pathname || "").split("/").pop().replace(/\.[a-z0-9]+$/i, "");
    return slug(FILE_FEATURE[base.toLowerCase()] || base) || "app";
  }
  var FEATURE = "app";
  try { FEATURE = pageFeature(); } catch (e) {}

  /* ---- the buffer ---- */
  function readBuf() {
    try {
      var raw = getItem(BUF_KEY);
      if (!raw) return [];
      var a = JSON.parse(raw);
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }
  function writeBuf(rows) {
    try {
      if (rows.length > MAX_ROWS) rows = rows.slice(rows.length - MAX_ROWS);   // drop oldest
      setItem(BUF_KEY, JSON.stringify(rows));
    } catch (e) {}
  }
  /** Merge a row into a list in place, keyed by user+day+feature. */
  function mergeInto(rows, row) {
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r && r.user === row.user && r.day === row.day && r.feature === row.feature) {
        r.v = (r.v || 0) + (row.v || 0);
        r.m = Math.round(((r.m || 0) + (row.m || 0)) * 100) / 100;
        return rows;
      }
    }
    rows.push({ user: row.user, day: row.day, feature: row.feature,
      v: row.v || 0, m: Math.round((row.m || 0) * 100) / 100 });
    return rows;
  }
  function record(feature, views, minutes) {
    var rows = readBuf();
    mergeInto(rows, { user: whoAmI(), day: dayKey(), feature: feature, v: views, m: minutes });
    writeBuf(rows);
  }

  /* ---- dwell ----
     Elapsed wall time while the tab is VISIBLE, attributed to whatever feature was last
     hit. Measured, not assumed: each step adds the real gap since the last mark rather than
     a nominal 30 seconds, so a throttled background timer cannot inflate it — and a gap
     longer than MAX_GAP_MS is discarded outright (a laptop that slept for six hours was
     not six hours of reading).                                                            */
  var current = FEATURE;
  var mark = Date.now();
  var visible = true;
  try { visible = document.visibilityState !== "hidden"; } catch (e) {}

  function accrue() {
    var now = Date.now();
    var gap = now - mark;
    mark = now;
    // Hosted in a hidden iframe (index.html's embedded Sports/AI tabs), this
    // document still reports "visible" — the app sets __buckyEmbedVisible=false
    // when another tab covers the frame, so covered time never counts as reading.
    if (window.__buckyEmbedVisible === false) return 0;
    if (!visible || !(gap > 0) || gap > MAX_GAP_MS) return 0;
    var minutes = gap / 60000;
    if (minutes <= 0) return 0;
    record(current, 0, minutes);
    return minutes;
  }

  /* ---- sending ---- */
  var sending = false;
  function send(rows, useBeacon) {
    var payload = JSON.stringify({ secret: SECRET, action: "log", rows: rows });
    // Same-origin, so no preflight even with a JSON content type.
    if (useBeacon && navigator && typeof navigator.sendBeacon === "function") {
      try {
        var blob = new Blob([payload], { type: "application/json" });
        return navigator.sendBeacon(ENDPOINT, blob) ? Promise.resolve(true) : Promise.resolve(false);
      } catch (e) { /* fall through to fetch */ }
    }
    if (typeof fetch !== "function") return Promise.resolve(false);
    try {
      return fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).then(function (r) { return !!(r && r.ok); }, function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }

  /** Take the buffer, try to send it, and put it BACK if the send failed. Taking first is
   *  what stops a slow request from double-counting rows a later flush also picks up. */
  function flush(useBeacon) {
    if (sending) return Promise.resolve(false);
    accrue();
    var rows = readBuf().filter(function (r) {
      return r && r.feature && ((r.v || 0) > 0 || (r.m || 0) >= MIN_SEND_M);
    });
    if (!rows.length) return Promise.resolve(true);
    sending = true;
    writeBuf([]);
    return send(rows, useBeacon).then(function (okRes) {
      sending = false;
      if (!okRes) {
        var now = readBuf();
        for (var i = 0; i < rows.length; i++) mergeInto(now, rows[i]);
        writeBuf(now);
      }
      return okRes;
    }, function () {
      sending = false;
      var now2 = readBuf();
      for (var j = 0; j < rows.length; j++) mergeInto(now2, rows[j]);
      writeBuf(now2);
      return false;
    });
  }

  /* ---- public API ---- */
  var api = {
    hit: safe(function (feature, opts) {
      var f = slug(feature) || FEATURE;
      accrue();                 // close out the time spent on whatever came before
      current = f;
      record(f, (opts && opts.views === 0) ? 0 : 1, 0);
    }),
    flush: safe(function () { return flush(false); }),
    // Debug/test surface: the current buffer, and a forced dwell step so a test does not
    // have to wait 30 seconds for the heartbeat.
    rows: safe(function () { return readBuf(); }),
    dwell: safe(function () { return accrue(); }),
    feature: function () { return current; },
  };
  try { window.BuckyActivity = api; } catch (e) {}

  /* ---- wiring ---- */
  safe(function () {
    record(FEATURE, 1, 0);      // the auto-view, once per page load

    setInterval(safe(accrue), TICK_MS);
    setInterval(safe(function () { flush(false); }), FLUSH_MS);

    document.addEventListener("visibilitychange", safe(function () {
      var nowVisible = document.visibilityState !== "hidden";
      if (!nowVisible) { accrue(); visible = false; flush(true); }
      else { visible = true; mark = Date.now(); }
    }), false);

    window.addEventListener("pagehide", safe(function () { flush(true); }), false);
    // Safari on iOS has historically fired neither pagehide nor visibilitychange reliably
    // on a real close; beforeunload is the belt to that pair of braces. All three funnel
    // into the same idempotent flush.
    window.addEventListener("beforeunload", safe(function () { flush(true); }), false);
  })();
})();
