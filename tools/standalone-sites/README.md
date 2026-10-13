# Standalone app sites (News, Shopping, Work Orders, Calendar, Finance)

Each folder here is a complete Netlify site: one `_redirects` file and nothing else. It sends
the bare address to the app (`/news`, `/shop`, `/workorders`, `/calendar` or `/finance`) and
proxies everything else to https://amenfarms.netlify.app. You deploy it by hand, once. It never
changes when Bucky does, and it costs no extra builds or functions.

| folder | app | suggested site name | address after deploy |
|---|---|---|---|
| `news` | Bucky News | `bucky-news` | https://bucky-news.netlify.app |
| `shop` | Bucky Shopping | `bucky-shop` | https://bucky-shop.netlify.app |
| `workorders` | Bucky Work Orders | `bucky-workorders` | https://bucky-workorders.netlify.app |
| `calendar` | Bucky Calendar | `bucky-calendar` | https://bucky-calendar.netlify.app |
| `finance` | Bucky Finance | `bucky-finance` | https://bucky-finance.netlify.app |

Netlify site names are global, so one of these may already be taken. Pick any short name that is
free; the name only changes the address.

## Why a second web address at all

Bucky is installed on the family's phones with scope `/`. Android Chrome will not install a
second app whose scope an installed app already covers; it offers "Open in Bucky" instead. On
iPhone and desktop `https://amenfarms.netlify.app/news` installs fine by itself. On Android
(five of the six family devices) each app needs its own address. A proxy site gives it one while
the code, the functions and the data stay in the main site.

Through the proxy the browser sees a same-origin page, so nothing here needs CORS. Both
`news.mjs` and Firestore were checked for an Origin allowlist that would reject the new address:
`news.mjs` only sets CORS response headers (the family password in the request body is its only
gate), and Shopping talks to Firestore directly with no origin check on our side. The calendar
and stocks functions answer the same way: they check the family password in the body and set CORS
response headers, nothing more.

## Deploy steps (about two minutes each)

1. Open https://app.netlify.com/drop, or Sites > Add new site > Deploy manually.
2. Drag in one app's folder (the folder, not the file inside it), for example `workorders`.
3. Sites > the new site > Site configuration > Change site name. Pick the name from the table
   above, or any short free one. The address becomes `https://<name>.netlify.app`.
4. On the phone, open that address in Chrome. It lands on the app. Menu > Install app.
5. Repeat with the other folders.

Do not connect these sites to the GitHub repo. They are deployed by drag-and-drop on purpose.

## First launch on a new address

A new address starts with empty storage, the same as a new browser. Each phone enters the family
password once, then taps its own name at "Who's this?". Because the app does not ask for
notification permission and does not register for push, a phone that already gets Bucky alerts
does not get a second copy of each one.

Two apps behave a little differently on that first launch, on purpose:

- **Work Orders** and **Finance** draw nothing until a name is picked. Finance would otherwise
  fetch market data before it knew whether the person may see it (a child is refused), and Work
  Orders opens only the picked person's own group of orders.
- **Finance** is for adults. A child who opens it gets one card: "Finance isn't turned on for this
  account. Ask a parent to enable it." Dad and the grandparents get the markets and their
  watchlist.
- **Work Orders** asks Dad for his PIN when he taps "Enter Dad PIN to confirm" on a finished order.
  The app does not ask for the PIN when it opens.

## Checking it worked

For each app (`<path>` is `news`, `shop`, `workorders`, `calendar` or `finance`):

- `https://<name>.netlify.app/` should redirect to `/<path>` and show the app with no top bar or
  bottom bar.
- The browser menu should say "Install app", not "Open in Bucky".
- `https://<name>.netlify.app/<path>.webmanifest` should open and show the app's name: "Bucky
  News", "Bucky Shopping", "Bucky Work Orders", "Bucky Calendar" or "Bucky Finance".
- Work Orders and Calendar show a round + button at the bottom right. News, Shopping and Finance
  have none.

## Changing a rule

Edit `_redirects` and drag the folder in again (Deploys > drag the folder onto the page).
Rules run top to bottom and the first match wins, so the catch-all `/*` line has to stay last.
The `!` after `200` forces the proxy even if a file with that name exists on the proxy site.

## Adding another app

Add the app to `STANDALONE_APPS` in `index.html` and to the matching table in the head script
(set `fab` in both if it needs the + button), add `<id>.webmanifest`, run
`node tools/make-standalone-icons.cjs --only=<id>` after adding its glyph, add the two rewrites
in `netlify.toml` (first check that no file or folder at the repo root is named `<id>`), add a
folder here with the same two `_redirects` lines (LF endings; `.gitattributes` already covers
`tools/standalone-sites/**/_redirects`), add the app to `APPS` in `tools/_verify-standalone.cjs`,
and run `node tools/_verify-standalone.cjs`. If the app's area is shared with something a
person in the family may use that this app must not show (Finance and the kids' Farm Bank), give
it a `cap` in the registry so the area check alone does not let them in.
