# Standalone app sites (Bucky News, Bucky Shopping)

Each folder here is a complete Netlify site: one `_redirects` file and nothing else. It sends
the bare address to `/news` (or `/shop`) and proxies everything else to
https://amenfarms.netlify.app. You deploy it by hand, once. It never changes when Bucky does,
and it costs no extra builds or functions.

## Why a second web address at all

Bucky is installed on the family's phones with scope `/`. Android Chrome will not install a
second app whose scope an installed app already covers; it offers "Open in Bucky" instead. On
iPhone and desktop `https://amenfarms.netlify.app/news` installs fine by itself. On Android
(five of the six family devices) each app needs its own address. A proxy site gives it one while
the code, the functions and the data stay in the main site.

Through the proxy the browser sees a same-origin page, so nothing here needs CORS. Both
`news.mjs` and Firestore were checked for an Origin allowlist that would reject the new address:
`news.mjs` only sets CORS response headers (the family password in the request body is its only
gate), and Shopping talks to Firestore directly with no origin check on our side.

## Deploy steps (about two minutes each)

1. Open https://app.netlify.com/drop, or Sites > Add new site > Deploy manually.
2. Drag in the `news` folder (the folder, not the file inside it).
3. Sites > the new site > Site configuration > Change site name. Pick something short, for
   example `bucky-news`. The address becomes `https://bucky-news.netlify.app`.
4. On the phone, open that address in Chrome. It lands on the News app. Menu > Install app.
5. Repeat with the `shop` folder (for example `bucky-shop`).

Do not connect these sites to the GitHub repo. They are deployed by drag-and-drop on purpose.

## First launch on a new address

A new address starts with empty storage, the same as a new browser. Each phone enters the family
password once, then taps its own name at "Who's this?". Because the app does not ask for
notification permission and does not register for push, a phone that already gets Bucky alerts
does not get a second copy of each one.

## Checking it worked

- `https://<name>.netlify.app/` should redirect to `/news` (or `/shop`) and show the app with no
  top bar or bottom bar.
- The browser menu should say "Install app", not "Open in Bucky".
- `https://<name>.netlify.app/news.webmanifest` should open and show `"name": "Bucky News"`
  (`/shop.webmanifest` and "Bucky Shopping" for the other).

## Changing a rule

Edit `_redirects` and drag the folder in again (Deploys > drag the folder onto the page).
Rules run top to bottom and the first match wins, so the catch-all `/*` line has to stay last.
The `!` after `200` forces the proxy even if a file with that name exists on the proxy site.

## Adding a third app

Add the app to `STANDALONE_APPS` in `index.html` and to the matching table in the head script,
add a manifest and icons, add the rewrite in `netlify.toml`, add a folder here with the same
two lines, and run `node tools/_verify-standalone.cjs`.
