// BUCKY — scheduled event reminders.
//
// A Netlify Scheduled Function that fires every 5 minutes and sends a push notification (plus
// an in-app bell entry) 1 hour before every TIMED calendar event on the shared family Google
// Calendar. All-day events never get a reminder — there is no single "1 hour before" instant
// for an event with no time on it.
//
// SCHEDULING NOTE: the cron fires every 5 minutes (`*/5 * * * *`, see netlify.toml). On each
// run we select events whose start instant falls in the half-open window [55, 65) minutes from
// "now" — TWICE the cadence, so consecutive runs deliberately OVERLAP and each event is offered
// to two runs. A window exactly as wide as the cadence would tile perfectly, but only while
// every run fires: one skipped run would drop its events permanently and silently. The slack sits
// on the FLOOR, not the ceiling: a missed run means the next one sees the event FEWER minutes
// ahead, so 55 is what recovers it (see the WINDOW_MIN comment). Overlap plus the Firestore
// idempotency marker gives both properties — a missed run costs nothing, and the
// marker (not the arithmetic) prevents the double send. We compare absolute epoch
// instants throughout (event.start.dateTime carries its own UTC offset from Google), never
// wall-clock strings — that makes the window check inherently DST-safe with no Central-time
// guard needed (unlike chorereminders.mjs, which fires at fixed Central wall-clock times and
// therefore DOES need one; do not copy that part here).
//
// The disjoint window is not the ONLY defence, though: a Netlify retry, an overlapping cold
// start, or a slightly-late/early cron fire could still process the same event twice. Before
// sending, the handler checks a Firestore marker doc keyed on the event id + its instance start
// instant; after a (best-effort) send it writes that marker. That marker check is also what
// makes a stray manual HTTP invoke of this function harmless — invoking it out-of-band either
// finds nothing in-window (no-op) or finds events already marked from the real scheduled run
// (no-op) — there is no separate "force" flag to gate here the way chorereminders.mjs needs
// one, because the window + marker ARE the guard.
//
// Reuses the same hand-signed service-account JWT (RS256 via node:crypto) technique as
// calendar.mjs / chorereminders.mjs / leaguecron.mjs, and chorereminders.mjs's
// getAllDeviceTokens/dead-token-pruning shape for the FCM lookup — but is fully
// self-contained per the repo's one-file-per-function convention. Nothing here is imported from
// (or imports into) those files.
//
// TARGETED, NOT BROADCAST (2026-08-18): this used to broadcast to every registered device,
// because push tokens are keyed on whatever name a person was signed in as when they enabled
// push (BuckyPush's `user` field), and an earlier check of that overlap against the roster
// undercounted it (a paginated Firestore read stopped at the first page and missed most of the
// roster). The real picture: push identity and roster identity are independently maintained and
// only PARTLY overlap, which is exactly why this can't be a simple "trust the token's `user`"
// broadcast OR a simple "trust the roster name" lookup — it has to match one against the other
// and say plainly when a selected person has no match. That gap is closed from the calendar
// side: calendar.mjs persists exactly who was ticked in the event sheet's Notify section onto
// the Google event itself (extendedProperties.private.buckyNotify, a JSON array of names — see
// calendar.mjs's buildGoogleEvent/normalizeEvent), and this function reads that list back as the
// event's `notify` names and reminds ONLY them. An event nobody ticked gets NO reminder — that
// is the direct, intended consequence, not an oversight (see the empty-selection handling below).
//
// A selected roster name still is not guaranteed to resolve to a device: some do match a
// registered device's `user` field outright, some only after normalising away case/whitespace
// drift (a real device is registered as "Perry  Kreusser", double space, for the roster's
// "Dad"), and some don't resolve at all (a device can be registered under a name that isn't on
// the roster at all, e.g. "Joe Adams"). Rather than papering over the unresolved case with a
// broadcast fallback (which would silently restore the old, unaccountable behaviour), a
// selected person with no matching device is counted and reported in the response
// (`unmatchedNames`) so the gap is visible, not silent. index.html's Notify rows warn about it
// too (see renderCalNotifyList's push-device check), for the same reason.
//
// Name matching is intentionally forgiving: trim, collapse internal whitespace, compare
// case-insensitively (normalizeNotifyName, below) — that double-space "Perry  Kreusser" case is
// real, and is exactly what this normalisation is for.
//
// Required env: FIREBASE_SERVICE_ACCOUNT, GOOGLE_CALENDAR_ID. Missing either -> clean no-op.
// Optional: EVENTREMINDER_FAMILY_KEY (defaults to the production family key).
// Test overrides (used only by tools/_verify-eventreminders.mjs's in-process harness):
//   EVENTREMINDER_TEST_NOW_MS   - fixed "now" in ms since epoch
//   EVENTREMINDER_CALENDAR_BASE_URL, EVENTREMINDER_TOKEN_URL,
//   EVENTREMINDER_FIRESTORE_BASE, EVENTREMINDER_FCM_BASE

const PROJECT_ID = "amen-farms-app";
const DEFAULT_FAMILY_KEY = "fam2jan2g"; // roomId("amenfarms") — same default as chorereminders.mjs

const CALENDAR_BASE_URL = () =>
  process.env.EVENTREMINDER_CALENDAR_BASE_URL || "https://www.googleapis.com/calendar/v3";
const TOKEN_URL = () => process.env.EVENTREMINDER_TOKEN_URL || "https://oauth2.googleapis.com/token";
const FIRESTORE_BASE = () =>
  process.env.EVENTREMINDER_FIRESTORE_BASE ||
  `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const FCM_SEND_URL = () =>
  (process.env.EVENTREMINDER_FCM_BASE || `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}`) + "/messages:send";

// One combined scope set: Calendar (read-only — this function never writes an event) + FCM +
// Firestore, so a single access token covers every call this function makes.
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/firebase.messaging",
  "https://www.googleapis.com/auth/datastore",
].join(" ");

const TZ = "America/Chicago";
const DEEP_LINK = "index.html#calendar";

// The reminder window, in minutes-ahead-of-now: [WINDOW_MIN, WINDOW_MAX).
//
// Deliberately 10 minutes wide against a 5-minute cron — i.e. OVERLAPPING, not tiling. A window
// exactly as wide as the cadence tiles perfectly only while every run fires; a single skipped or
// delayed run (which scheduled functions do occasionally) drops that window's events on the floor
// and the reminder is lost silently and permanently, because no later window ever revisits them.
//
// The extra width has to go on the FLOOR, not the ceiling. A skipped run means the next run sees
// the event FEWER minutes ahead, not more — an event 62 minutes out at the run that was missed is
// 57 minutes out at the next one. Raising the ceiling to 70 would only send reminders earlier and
// would NOT recover anything; dropping the floor to 55 is what catches the late look. (The first
// version of this constant got that backwards, and the resilience test below is what caught it.)
//
// The idempotency marker — not the window arithmetic — is what stops the overlap from
// double-sending: dedupe belongs in the thing that knows what was already sent.
//
// Consequence, acceptable: a reminder lands 55-65 minutes ahead rather than 60-65 (still "about
// an hour"). Two consecutive missed runs would still lose it; a lower floor trades punctuality
// for more slack.
const WINDOW_MIN = 55;
const WINDOW_MAX = 65;

// Lazy-delete markers older than this so the marker collection can't grow without bound.
const MARKER_STALE_MS = 2 * 24 * 60 * 60 * 1000; // ~2 days

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { "Content-Type": "application/json" } });
}

// ---- Google token (hand-signed JWT, RS256) — same technique as calendar.mjs/chorereminders.mjs ----
function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function getGoogleAccessToken(serviceAccount) {
  const crypto = await import("node:crypto");
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: serviceAccount.client_email,
    scope: SCOPES,
    aud: TOKEN_URL(),
    iat: nowSec,
    exp: nowSec + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(serviceAccount.private_key);
  const assertion = `${unsigned}.${base64url(signature)}`;

  const resp = await fetch(TOKEN_URL(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.access_token) {
    throw new Error(`OAuth token exchange failed: ${resp.status} ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

// ---- Google Calendar read ----
// singleEvents:true + orderBy:startTime so a recurring series arrives as individual instances,
// same as calendar.mjs's own listEvents. A tight timeMin/timeMax (with a little slack either
// side of the exact window) keeps this a small query instead of pulling the whole calendar.
async function listUpcomingEvents(token, calId, timeMinISO, timeMaxISO) {
  const query = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    timeMin: timeMinISO,
    timeMax: timeMaxISO,
    maxResults: "50",
  });
  const url = `${CALENDAR_BASE_URL()}/calendars/${encodeURIComponent(calId)}/events?${query}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`Google Calendar list failed: ${resp.status} ${JSON.stringify(data)}`);
  return Array.isArray(data.items) ? data.items : [];
}

// All-day events carry start.date and NO start.dateTime — same rule calendar.mjs's
// normalizeEvent() uses. Timed events carry start.dateTime (with its own UTC offset).
function isAllDay(ev) {
  return !!(ev.start && ev.start.date && !ev.start.dateTime);
}
function startMsOf(ev) {
  const dt = ev.start && ev.start.dateTime;
  if (!dt) return NaN;
  const ms = Date.parse(dt);
  return Number.isFinite(ms) ? ms : NaN;
}

// ---- Notify list: read back what calendar.mjs's buildGoogleEvent wrote (duplicated logic —
// NOT imported, per the repo's one-file-per-function convention; calendar.mjs's normalizeEvent
// has the write-side twin of this parse). Google returns extendedProperties on a plain list
// call with no `fields` restriction, so ev.extendedProperties is already present here.
function parseNotifyList(ev) {
  try {
    const raw = ev.extendedProperties && ev.extendedProperties.private && ev.extendedProperties.private.buckyNotify;
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((n) => typeof n === "string" && n.trim()) : [];
  } catch {
    return [];
  }
}

// Trim, collapse internal whitespace, lowercase — the SAME normalisation index.html's
// no-push-device Notify-row warning must use, so a name that matches here also reads as
// matched there. One real device is registered as "Perry  Kreusser" (double space) against a
// roster entry of "Perry Kreusser" (single space); this is what makes them the same person.
function normalizeNotifyName(s) {
  return String(s == null ? "" : s).trim().replace(/\s+/g, " ").toLowerCase();
}

// Selected names (deduped, original spelling kept for display/bell docs) -> which registered
// device tokens they resolve to, and which selected names resolved to NO device at all.
// selected/unmatchedNames use the ORIGINAL name text (bell docs and the response payload read
// better that way); matching itself is done on the normalized form.
function resolveNotifyRecipients(notifyRaw, tokens) {
  const selected = [];
  const seenNorm = new Set();
  for (const n of notifyRaw || []) {
    const norm = normalizeNotifyName(n);
    if (!norm || seenNorm.has(norm)) continue;
    seenNorm.add(norm);
    selected.push(String(n).trim());
  }
  const matchedTokens = tokens.filter((t) => t.user && seenNorm.has(normalizeNotifyName(t.user)));
  const matchedNorm = new Set(matchedTokens.map((t) => normalizeNotifyName(t.user)));
  const unmatchedNames = selected.filter((n) => !matchedNorm.has(normalizeNotifyName(n)));
  return { selected, matchedTokens, unmatchedNames };
}

// ---- Firestore field helpers (field names must match [a-zA-Z_][a-zA-Z_0-9]* or Google 400s) ----
function fStr(s) { return { stringValue: String(s == null ? "" : s) }; }
function fInt(n) { return { integerValue: String(Math.round(Number(n) || 0)) }; }
function fBool(b) { return { booleanValue: !!b }; }

function idSlug(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "x";
}

// ---- Idempotency marker (evremind_<familyKey>) ----
// Keyed on the event id AND its instance start instant, so a recurring series' instances
// (which share a master id in some Calendar API shapes) each get their own marker.
function markerId(eventId, startMs) {
  return "ev-" + idSlug(eventId) + "-" + startMs;
}
async function markerExists(accessToken, familyKey, id) {
  const resp = await fetch(`${FIRESTORE_BASE()}/evremind_${familyKey}/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return resp.ok; // 200 = exists, 404 = doesn't
}
async function writeMarker(accessToken, familyKey, id, eventId, startMs, now) {
  await fetch(`${FIRESTORE_BASE()}/evremind_${familyKey}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { eventId: fStr(eventId), start: fInt(startMs), at: fInt(now) } }),
  });
}
// Best-effort lazy cleanup of markers older than MARKER_STALE_MS. Never allowed to fail the run.
async function cleanupOldMarkers(accessToken, familyKey, now) {
  try {
    const url = `${FIRESTORE_BASE()}:runQuery`;
    const body = { structuredQuery: { from: [{ collectionId: `evremind_${familyKey}` }] } };
    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const rows = await resp.json().catch(() => []);
    let cleaned = 0;
    for (const row of Array.isArray(rows) ? rows : []) {
      const doc = row.document;
      if (!doc) continue;
      const at = doc.fields && doc.fields.at && Number(doc.fields.at.integerValue);
      if (!Number.isFinite(at) || now - at < MARKER_STALE_MS) continue;
      const parts = doc.name.split("/");
      const id = parts[parts.length - 1];
      await fetch(`${FIRESTORE_BASE()}/evremind_${familyKey}/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      cleaned++;
    }
    return cleaned;
  } catch {
    return 0;
  }
}

// ---- Push tokens: read every registered device, then match by name (see resolveNotifyRecipients
// above) — no longer a broadcast (see file header for why that changed 2026-08-18). ----
async function getAllDeviceTokens(accessToken, familyKey) {
  const url = `${FIRESTORE_BASE()}:runQuery`;
  const body = { structuredQuery: { from: [{ collectionId: `pushTokens_${familyKey}` }] } };
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const rows = await resp.json().catch(() => []);
  if (!resp.ok) throw new Error(`Firestore token query failed: ${resp.status} ${JSON.stringify(rows)}`);
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const doc = row.document;
    if (!doc) continue;
    const token = doc.fields && doc.fields.token && doc.fields.token.stringValue;
    if (!token) continue;
    const user = doc.fields && doc.fields.user && doc.fields.user.stringValue;
    const parts = doc.name.split("/");
    out.push({ docId: parts[parts.length - 1], token, user: user || null });
  }
  return out;
}
async function deleteTokenDoc(accessToken, familyKey, docId) {
  await fetch(`${FIRESTORE_BASE()}/pushTokens_${familyKey}/${docId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

async function sendFcmMessage(accessToken, token, title, body, url) {
  const message = {
    message: {
      token,
      data: { title, body, url },
      webpush: { headers: { Urgency: "high" } },
    },
  };
  const resp = await fetch(FCM_SEND_URL(), {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, data };
}
function isUnregistered(result) {
  if (result.status === 404 || result.status === 410) return true;
  const status = result.data && result.data.error && result.data.error.status;
  return status === "UNREGISTERED" || status === "NOT_FOUND";
}

// Write one bell doc per SELECTED person (the event's own notify list — see
// resolveNotifyRecipients), whether or not they have a push device: the bell is an in-app
// fallback, so someone with no device on file still gets told inside the app. Deterministic id
// (derived from the same reminder key) so racing writers converge on one doc, same discipline as
// index.html's writeCloudNotif. PATCH = create-or-overwrite.
async function writeBellDoc(accessToken, familyKey, to, text, url, reminderKey, now) {
  const id = "cal-" + idSlug(reminderKey) + "-" + idSlug(to);
  await fetch(`${FIRESTORE_BASE()}/notifs_${familyKey}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: {
        to: fStr(to), from: fStr("BUCKY"), type: fStr("cal_event"),
        text: fStr(text), url: fStr(url), at: fInt(now), read: fBool(false),
      },
    }),
  });
}

function chicagoTimeText(ms) {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true });
  return fmt.format(new Date(ms));
}

function nowMs() {
  const t = Number(process.env.EVENTREMINDER_TEST_NOW_MS);
  return Number.isFinite(t) && t > 0 ? t : Date.now();
}

export default async () => {
  const now = nowMs();
  const familyKey = process.env.EVENTREMINDER_FAMILY_KEY || DEFAULT_FAMILY_KEY;

  // ---- No-op paths: missing config, bad config, or a Google outage must never throw ----
  if (!process.env.FIREBASE_SERVICE_ACCOUNT || !process.env.GOOGLE_CALENDAR_ID) {
    console.log("[eventreminders] skipping: FIREBASE_SERVICE_ACCOUNT or GOOGLE_CALENDAR_ID not set");
    return json({ ok: true, skipped: "not-configured" });
  }
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (!serviceAccount || !serviceAccount.client_email || !serviceAccount.private_key) throw new Error("shape");
  } catch {
    console.log("[eventreminders] skipping: FIREBASE_SERVICE_ACCOUNT is not valid");
    return json({ ok: true, skipped: "bad-service-account" });
  }
  const calId = process.env.GOOGLE_CALENDAR_ID;

  let accessToken;
  try {
    accessToken = await getGoogleAccessToken(serviceAccount);
  } catch (err) {
    console.error("[eventreminders] Google auth failed:", err && err.message);
    return json({ ok: true, skipped: "google-error", detail: String((err && err.message) || err).slice(0, 160) });
  }

  // Query a little wider than the exact [60,65) window so a slightly-off Google clock/rounding
  // never drops an event; the precise boundary is enforced in code just below.
  const timeMinISO = new Date(now + 50 * 60000).toISOString();
  const timeMaxISO = new Date(now + 75 * 60000).toISOString();

  let events;
  try {
    events = await listUpcomingEvents(accessToken, calId, timeMinISO, timeMaxISO);
  } catch (err) {
    console.error("[eventreminders] Google Calendar list failed:", err && err.message);
    return json({ ok: true, skipped: "google-error", detail: String((err && err.message) || err).slice(0, 160) });
  }

  const cleaned = await cleanupOldMarkers(accessToken, familyKey, now);

  // Select events whose start instant falls in [now+60min, now+65min) and are NOT all-day.
  const candidates = [];
  for (const ev of events) {
    if (isAllDay(ev)) continue;
    const startMs = startMsOf(ev);
    if (!Number.isFinite(startMs)) continue;
    const diffMin = (startMs - now) / 60000;
    if (diffMin >= WINDOW_MIN && diffMin < WINDOW_MAX) candidates.push({ ev, startMs });
  }

  let remindersSent = 0, remindersSkippedEmpty = 0, tokensNotified = 0, tokensPruned = 0,
    bellDocsWritten = 0, alreadyMarked = 0;
  // Aggregated across every candidate processed this run (not just the ones that actually sent
  // anything) — first-seen spelling kept, deduped by the same normalisation used for matching.
  // This is the visibility the identity gap needs: a selected person with no matching device
  // must show up here, never just vanish.
  const selectedAgg = [], selectedSeen = new Set();
  const unmatchedAgg = [], unmatchedSeen = new Set();

  if (candidates.length) {
    let tokens = [];
    try {
      tokens = await getAllDeviceTokens(accessToken, familyKey);
    } catch (err) {
      console.error("[eventreminders] Firestore read failed:", err && err.message);
      return json({ ok: true, skipped: "firestore-error", detail: String((err && err.message) || err).slice(0, 160) });
    }

    for (const { ev, startMs } of candidates) {
      const id = markerId(ev.id, startMs);
      let exists;
      try {
        exists = await markerExists(accessToken, familyKey, id);
      } catch {
        exists = false; // Firestore hiccup on the CHECK: fail open, better a rare dupe than a silently dropped reminder
      }
      if (exists) { alreadyMarked++; continue; }

      const notifyRaw = parseNotifyList(ev);
      const { selected, matchedTokens, unmatchedNames } = resolveNotifyRecipients(notifyRaw, tokens);
      for (const n of selected) {
        const norm = normalizeNotifyName(n);
        if (!selectedSeen.has(norm)) { selectedSeen.add(norm); selectedAgg.push(n); }
      }
      for (const n of unmatchedNames) {
        const norm = normalizeNotifyName(n);
        if (!unmatchedSeen.has(norm)) { unmatchedSeen.add(norm); unmatchedAgg.push(n); }
      }

      // Nobody ticked the Notify section for this event -> NO reminder, by design. This is the
      // direct consequence of targeting instead of broadcasting (see file header): there is no
      // "everyone" fallback here, because that would silently restore the old behaviour. The
      // marker is still written so an overlapping run doesn't re-derive the same nothing.
      if (!selected.length) {
        try { await writeMarker(accessToken, familyKey, id, ev.id, startMs, now); } catch {}
        remindersSkippedEmpty++;
        continue;
      }

      const title = ev.summary || "(untitled)";
      const timeText = chicagoTimeText(startMs);
      const text = `⏰ In 1 hour: ${title} — ${timeText}`;

      for (const { docId, token } of matchedTokens) {
        let result;
        try {
          result = await sendFcmMessage(accessToken, token, "⏰ In 1 hour", `${title} — ${timeText}`, DEEP_LINK);
        } catch {
          continue;
        }
        if (result.ok) tokensNotified++;
        else if (isUnregistered(result)) { await deleteTokenDoc(accessToken, familyKey, docId); tokensPruned++; }
      }

      for (const to of selected) {
        try {
          await writeBellDoc(accessToken, familyKey, to, text, DEEP_LINK, id, now);
          bellDocsWritten++;
        } catch { /* best-effort */ }
      }

      try {
        await writeMarker(accessToken, familyKey, id, ev.id, startMs, now);
      } catch { /* best-effort — a lost marker write risks a rare dupe next window, not a crash */ }
      remindersSent++;
    }
  }

  return json({
    ok: true,
    remindersSent, remindersSkippedEmpty, tokensNotified, tokensPruned, bellDocsWritten, alreadyMarked,
    markersCleaned: cleaned,
    candidates: candidates.length,
    // Visibility into the name-matching gap (see file header): who was selected across this
    // run's events, and which of those selected names resolved to no registered device.
    selected: selectedAgg,
    resolvedDevices: tokensNotified,
    unmatchedNames: unmatchedAgg,
  });
};

// The cron schedule lives in netlify.toml ([functions."eventreminders"].schedule = "*/5 * * * *")
// — declared in ONE place to avoid a conflicting dual declaration, same convention as
// chorereminders.mjs / leaguecron.mjs.
