# BUCKY push notifications — owner setup checklist

This covers the one-time setup needed to turn on real (closed-app) push
notifications. Everything code-side is already built; the steps below are
things only you can do, because they involve your Firebase/Netlify accounts.

Nothing here works yet — every phone will just see `enable() failed: ...`
until you finish steps 1 and 2.

---

## 1. Get a VAPID key (lets browsers trust push messages from your Firebase project)

1. Go to the [Firebase console](https://console.firebase.google.com/) → your
   **amen-farms-app** project.
2. Click the gear icon → **Project settings**.
3. Open the **Cloud Messaging** tab.
4. Scroll to **Web Push certificates** → click **Generate key pair**.
5. Copy the long key string it shows you (starts with something like
   `BN...`).
6. Open **push-client.js** in this repo, find this line near the top:

   ```js
   window.BUCKY_VAPID_KEY = window.BUCKY_VAPID_KEY || "PASTE_VAPID_PUBLIC_KEY_HERE";
   ```

   Replace `PASTE_VAPID_PUBLIC_KEY_HERE` with the key you copied (keep the
   quotes).

This key is public (it's shipped to every browser), so it's fine that it
lives in a plain JS file that gets deployed.

---

## 2. Give the Netlify Function a service account + a shared secret

The `notify.mjs` function needs to authenticate to Google's FCM API as your
Firebase project, and needs a passphrase so randoms on the internet can't
use it to spam your family.

1. Firebase console → gear icon → **Project settings** → **Service accounts**
   tab.
2. Click **Generate new private key**. This downloads a `.json` file —
   keep it secret, don't commit it anywhere.
3. Go to your Netlify site → **Site configuration** (or **Site settings**) →
   **Environment variables**.
4. Add a variable named **`FIREBASE_SERVICE_ACCOUNT`**. For its value, paste
   the *entire contents* of that downloaded JSON file as one string (Netlify's
   environment variable editor accepts multi-line values fine).
5. Add a second variable named **`BUCKY_NOTIFY_SECRET`**. Its value can be
   any passphrase you make up (e.g. a long random word). This is the same
   secret the app itself will send when it asks the function to notify
   someone — treat it like a shared family password.
6. Redeploy the site after adding these (env var changes need a new deploy
   to take effect — see step 4 below).

---

## 3. Firestore rules

Push device tokens are stored in a new collection per family:
`pushTokens_<familyKey>` (parallel to the existing `chores_<familyKey>`
collection). Your current Firestore rules (per SETUP-GUIDE.md) are a
wide-open wildcard:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

Because `{document=**}` matches **every** collection, `pushTokens_*` is
already covered automatically — **you don't need to change anything** if
you're still using this wildcard rule. If you ever tighten these rules to
be collection-specific, make sure to add a block for `pushTokens_{familyKey}`
mirroring whatever you do for `chores_{familyKey}`, e.g.:

```
match /pushTokens_{familyKey}/{tokenDoc} {
  allow read, write: if true;
}
```

---

## 4. Deploying (functions included)

The Netlify Function lives at `netlify/functions/notify.mjs`, wired up by
`netlify.toml` at the repo root (`publish = "."`, `functions =
"netlify/functions"`).

- **Netlify CLI** (recommended, most predictable):
  ```
  npx netlify-cli deploy --prod
  ```
  Run this from the repo root. It reads `netlify.toml`, bundles the function
  with esbuild, and deploys both the static site and the function together.

- **Drag-and-drop UI deploy**: Yes, this bundles functions too, **as long as
  `netlify.toml` is present at the root of the folder you drag in** (it now
  is). Netlify's drag-and-drop deploy reads `netlify.toml` to find the
  `functions` directory and packages everything under it, exactly like a
  CLI/Git deploy would. The one thing drag-and-drop does *not* do is read
  environment variables from anywhere local — those must already be set in
  the Netlify UI (step 2 above) since they're a site-level setting, not part
  of the uploaded folder.

Either way, double-check after deploying: Netlify site → **Functions** tab
should list `notify`.

---

## 5. Testing end-to-end with two phones

1. On **Phone A** (e.g. a parent's phone), open the deployed app
   (`https://amenfarms.netlify.app`), log in with the family password, and
   trigger whatever UI toggle turns on notifications (see "remaining
   wiring" below — this part still needs to be added to index.html).
   Accept the browser's permission prompt when asked.
2. Confirm a new document appeared in Firestore console under
   `pushTokens_<yourFamilyKey>` with `user` set to whatever name Phone A
   used, and a `token` field.
3. On **Phone B**, open a browser console (or a temporary debug button) and
   call:
   ```js
   BuckyPush.notify(
     "<the BUCKY_NOTIFY_SECRET you set in Netlify>",
     "<familyKey>",
     "<the user name Phone A registered with>",
     "Test",
     "If you see this, push works!"
   );
   ```
4. **Close the app fully on Phone A** (swipe it away, don't just background
   it) and wait a few seconds after step 3 — you should get a system
   notification even with the app closed. Tapping it should open/focus the
   app.
5. If nothing arrives: check the Netlify function's logs (Netlify site →
   **Functions** → `notify` → **real-time logs**) for the JSON response —
   `{ sent: 0, pruned: 0 }` means no token was found for that user/family
   (check step 2 again); a 500 with an OAuth error usually means the
   `FIREBASE_SERVICE_ACCOUNT` env var is malformed (make sure you pasted the
   *whole* JSON file, including the outer `{ }`).

---

## What wiring remains in index.html

Since `index.html` is off-limits to this task, here is exactly what still
needs to be added there by hand (or by whoever edits that file next):

1. **A toggle to turn notifications on/off**, e.g. a button in settings that
   calls:
   ```js
   await BuckyPush.enable(currentUserName, familyKey);
   ```
   on enable, and `await BuckyPush.disable();` on disable. Wrap in
   try/catch and show `err.message` to the user (it already has friendly
   messages for "not supported," "no VAPID key configured," "permission
   denied," etc.).

2. **After creating a new work order assigned to someone**, fire a
   notification to the assignee:
   ```js
   BuckyPush.notify(NOTIFY_SECRET, familyKey, assigneeName,
     "New work order", `${creatorName} assigned you: ${woTitle}`);
   ```
   (Fire-and-forget — `notify()` never throws, so this can be a bare call
   with no `await`/`try` needed.)

3. **After a work order is marked complete**, fire a notification back to
   whoever created it:
   ```js
   BuckyPush.notify(NOTIFY_SECRET, familyKey, creatorName,
     "Work order done", `${completerName} finished: ${woTitle}`);
   ```

4. Both call sites need `<script src="push-client.js"></script>` added to
   `index.html` (before the app's own `<script type="module">` block, so
   `window.BuckyPush` exists first), plus a `<link rel="manifest"
   href="manifest.webmanifest">` tag — note index.html already has that tag
   (this task only updated the manifest's contents, not that link).

5. `NOTIFY_SECRET` above needs to be the *same string* as the
   `BUCKY_NOTIFY_SECRET` Netlify env var. Since it's sent from client JS, it
   is not really secret from a technically sophisticated family member — its
   purpose is to block random internet strangers from hitting the function,
   not to be cryptographically secure against your own household.
