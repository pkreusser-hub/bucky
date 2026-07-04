// BUCKY — push notification client helper.
//
// Plain script (NOT a module) so it can be dropped in with a plain
// <script src="push-client.js"></script> tag. Everything it needs
// (Firebase SDKs) is loaded lazily via dynamic import() so this file itself
// stays framework-free at parse time.
//
// Exposes window.BuckyPush = { enable, disable, isSupported, status, notify }
//
// ---------------------------------------------------------------------------
// TODO(owner): paste your VAPID key here. Get it from:
//   Firebase console -> Project settings -> Cloud Messaging -> Web Push
//   certificates -> "Generate key pair"
// See PUSH_SETUP.md for full instructions.
window.BUCKY_VAPID_KEY = window.BUCKY_VAPID_KEY || "PASTE_VAPID_PUBLIC_KEY_HERE";
// ---------------------------------------------------------------------------

(function () {
  "use strict";

  // Same Firebase project as index.html (amen-farms-app). Kept as a literal
  // here (rather than imported) because this file must work standalone,
  // without depending on index.html's module scope.
  var DEFAULT_FIREBASE_CONFIG = {
    apiKey: "AIzaSyAA1hn-j9_pPuXoaHIzcyyXYJN6EhUccJU",
    authDomain: "amen-farms-app.firebaseapp.com",
    projectId: "amen-farms-app",
    storageBucket: "amen-farms-app.firebasestorage.app",
    messagingSenderId: "321230755979",
    appId: "1:321230755979:web:d362c56aaf7e50b4ab5c8e",
  };

  var FIREBASE_SDK_VERSION = "10.12.2";
  var STATE_KEY = "buckyPushState"; // localStorage: last known {token, familyKey, user} we wrote

  var _cache = { app: null, messaging: null, firestoreMod: null, appMod: null, messagingMod: null };

  function isSupported() {
    return (
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window
    );
  }

  function status() {
    var raw = null;
    try {
      raw = localStorage.getItem(STATE_KEY);
    } catch (e) {
      /* localStorage unavailable (private mode, etc.) */
    }
    var saved = raw ? JSON.parse(raw) : null;
    return {
      supported: isSupported(),
      permission: (typeof Notification !== "undefined" && Notification.permission) || "unsupported",
      enabled: !!saved,
      user: saved && saved.user,
      familyKey: saved && saved.familyKey,
    };
  }

  // Short, non-identifying device label for the token doc (e.g. "Chrome on Android").
  function deviceLabel() {
    var ua = navigator.userAgent || "";
    var browser = "Browser";
    if (/Edg\//.test(ua)) browser = "Edge";
    else if (/Chrome\//.test(ua)) browser = "Chrome";
    else if (/Firefox\//.test(ua)) browser = "Firefox";
    else if (/Safari\//.test(ua)) browser = "Safari";

    var os = "device";
    if (/Android/.test(ua)) os = "Android";
    else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
    else if (/Windows/.test(ua)) os = "Windows";
    else if (/Mac OS X/.test(ua)) os = "Mac";
    else if (/Linux/.test(ua)) os = "Linux";

    return browser + " on " + os;
  }

  // Simple, dependency-free string hash -> used as a stable Firestore doc id per token.
  async function hashToken(token) {
    if (window.crypto && window.crypto.subtle) {
      var enc = new TextEncoder().encode(token);
      var digest = await window.crypto.subtle.digest("SHA-256", enc);
      var bytes = Array.from(new Uint8Array(digest));
      return bytes.map(function (b) { return b.toString(16).padStart(2, "0"); }).join("").slice(0, 32);
    }
    // Fallback (very old browsers without SubtleCrypto): weak but stable.
    var h = 0;
    for (var i = 0; i < token.length; i++) {
      h = (h * 31 + token.charCodeAt(i)) >>> 0;
    }
    return "tok" + h.toString(36);
  }

  async function loadFirebaseModules(firebaseConfig) {
    if (!_cache.appMod) {
      _cache.appMod = await import(
        "https://www.gstatic.com/firebasejs/" + FIREBASE_SDK_VERSION + "/firebase-app.js"
      );
    }
    if (!_cache.messagingMod) {
      _cache.messagingMod = await import(
        "https://www.gstatic.com/firebasejs/" + FIREBASE_SDK_VERSION + "/firebase-messaging.js"
      );
    }
    if (!_cache.firestoreMod) {
      _cache.firestoreMod = await import(
        "https://www.gstatic.com/firebasejs/" + FIREBASE_SDK_VERSION + "/firebase-firestore.js"
      );
    }
    if (!_cache.app) {
      // Use a distinct app name so this never collides with index.html's own
      // Firebase app instance (which may or may not exist on this page).
      _cache.app = _cache.appMod.initializeApp(firebaseConfig, "bucky-push");
    }
    return _cache;
  }

  async function enable(userName, familyKey, firebaseConfigOverride) {
    if (!isSupported()) {
      throw new Error("Push notifications are not supported in this browser.");
    }
    if (!userName || !familyKey) {
      throw new Error("BuckyPush.enable(userName, familyKey) requires both arguments.");
    }
    if (!window.BUCKY_VAPID_KEY || window.BUCKY_VAPID_KEY === "PASTE_VAPID_PUBLIC_KEY_HERE") {
      throw new Error(
        "BUCKY_VAPID_KEY is not configured. See PUSH_SETUP.md to generate one and paste it into push-client.js."
      );
    }

    var firebaseConfig = firebaseConfigOverride || DEFAULT_FIREBASE_CONFIG;

    var reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");

    var permission = await Notification.requestPermission();
    if (permission !== "granted") {
      throw new Error("Notification permission was not granted (" + permission + ").");
    }

    var mods = await loadFirebaseModules(firebaseConfig);
    if (!_cache.messaging) {
      _cache.messaging = mods.messagingMod.getMessaging(_cache.app);
    }

    var token = await mods.messagingMod.getToken(_cache.messaging, {
      vapidKey: window.BUCKY_VAPID_KEY,
      serviceWorkerRegistration: reg,
    });

    if (!token) {
      throw new Error("Could not obtain a push token (getToken returned empty).");
    }

    var db = mods.firestoreMod.getFirestore(_cache.app);
    var docId = await hashToken(token);
    var ref = mods.firestoreMod.doc(db, "pushTokens_" + familyKey, docId);
    await mods.firestoreMod.setDoc(ref, {
      token: token,
      user: userName,
      ua: deviceLabel(),
      at: Date.now(),
    });

    try {
      localStorage.setItem(
        STATE_KEY,
        JSON.stringify({ token: token, familyKey: familyKey, user: userName, docId: docId })
      );
    } catch (e) {
      /* ignore storage failures */
    }

    return { token: token, docId: docId };
  }

  async function disable() {
    var raw = null;
    try {
      raw = localStorage.getItem(STATE_KEY);
    } catch (e) {
      /* ignore */
    }
    if (!raw) return false;

    var saved = JSON.parse(raw);

    try {
      if (_cache.messaging && _cache.messagingMod) {
        await _cache.messagingMod.deleteToken(_cache.messaging);
      }
    } catch (e) {
      console.warn("BuckyPush.disable: deleteToken failed (continuing)", e);
    }

    try {
      if (_cache.firestoreMod && _cache.app && saved.familyKey && saved.docId) {
        var db = _cache.firestoreMod.getFirestore(_cache.app);
        var ref = _cache.firestoreMod.doc(db, "pushTokens_" + saved.familyKey, saved.docId);
        await _cache.firestoreMod.deleteDoc(ref);
      }
    } catch (e) {
      console.warn("BuckyPush.disable: could not remove token doc (continuing)", e);
    }

    try {
      localStorage.removeItem(STATE_KEY);
    } catch (e) {
      /* ignore */
    }

    return true;
  }

  // Fire-and-forget notify call to the Netlify function. Never throws —
  // callers can just do `BuckyPush.notify(...)` without awaiting/catching.
  async function notify(secret, familyKey, targetUser, title, body) {
    try {
      var res = await fetch("/.netlify/functions/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: secret,
          familyKey: familyKey,
          targetUser: targetUser,
          title: title,
          body: body,
        }),
      });
      return await res.json();
    } catch (e) {
      console.warn("BuckyPush.notify failed (ignored):", e);
      return null;
    }
  }

  window.BuckyPush = {
    enable: enable,
    disable: disable,
    isSupported: isSupported,
    status: status,
    notify: notify,
  };
})();
