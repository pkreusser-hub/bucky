// BUCKY — Firebase Cloud Messaging service worker.
// Handles PUSH notifications while the app is closed / backgrounded.
//
// Deliberately minimal: no fetch/cache handlers here. Adding an install/fetch
// caching layer to this worker risks serving a stale copy of index.html after
// deploys — this file's only job is push delivery.
//
// Config below is copied from index.html's `firebaseConfig` (see
// index.html ~line 598). Keep them in sync if the Firebase project ever
// changes. This file cannot import index.html's values directly because
// service workers load standalone, outside the page's module scope.

importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

const firebaseConfig = {
  apiKey: "AIzaSyAA1hn-j9_pPuXoaHIzcyyXYJN6EhUccJU",
  authDomain: "amen-farms-app.firebaseapp.com",
  projectId: "amen-farms-app",
  storageBucket: "amen-farms-app.firebasestorage.app",
  messagingSenderId: "321230755979",
  appId: "1:321230755979:web:d362c56aaf7e50b4ab5c8e",
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  // Messages are DATA-ONLY (see netlify/functions/notify.mjs) so the browser never
  // auto-displays a duplicate — this handler is the single source of tray notifications.
  const d = payload.data || {};
  const title = d.title || (payload.notification && payload.notification.title) || "BUCKY";
  const body = d.body || (payload.notification && payload.notification.body) || "";
  const url = d.url || "/";

  self.registration.showNotification(title, {
    body,
    icon: "/icons/icon-192.png",
    // one tag = new pushes REPLACE the old tray entry instead of stacking,
    // so the launcher badge can't climb; renotify keeps the buzz on replace
    tag: "bucky-workorders",
    renotify: true,
    data: { url },
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of allClients) {
        // Focus an existing BUCKY tab/window if one is already open.
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try { await client.navigate(targetUrl); } catch (e) { /* ignore */ }
          }
          return;
        }
      }
      if (clients.openWindow) {
        await clients.openWindow(targetUrl);
      }
    })()
  );
});
