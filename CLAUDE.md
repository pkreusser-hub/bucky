# BUCKY — project notes for Claude

A static family web app: plain HTML/JS pages, no build step, deployed to
https://amenfarms.netlify.app (and goatfantasyleague.com, an alias of the same site) by
GitHub auto-deploy. Serverless endpoints live in `netlify/functions/`. Each page is
self-contained — its own `<script>`, its own state, no shared JS between pages. Config that
looks like it should be shared (the Firebase block, the family password) is duplicated per
page on purpose; that is the house convention, not an oversight.

**Pushing to `main` puts it in front of the family immediately.** Never push to `main`
without the user's preview approval unless the request already granted it. Pushing a branch
is free and safe.

## Where the detail lives

`CLAUDE.md` used to be one 12,800-line file loaded into every session. It is now split by
subject. **Read the file for the area you are touching before you touch it** — most of these
entries exist because something was got wrong once, and several later entries correct earlier
ones in the same file.

| working on | read first |
|---|---|
| `league.html`, `assets/league/lg-*.js`, `league.mjs`, `sports.html`, `ffdraft.html` | [docs/gffl.md](docs/gffl.md) |
| `index.html` and its sections; `weather.html`, `status.html`, `activity.html` | [docs/bucky-app.md](docs/bucky-app.md) |
| `farmgpt.html`, `farmgpt.mjs`, `storytime.html`, `dungeon.html` | [docs/farmgpt.md](docs/farmgpt.md) |
| `castlekruzer.html`, `assets/farmstead/fs-*.js` | [docs/castle-kruzer.md](docs/castle-kruzer.md) |
| `farmkart.html`, `farmkart-editor.html`, `assets/farmkart-*.js` | [docs/farm-kart.md](docs/farm-kart.md) |
| `barnyardbistro.html`, `farmparty.html`, `hayhem.html`, `farm3d.html`, `goatcare.html`, `games.html` | [docs/games.md](docs/games.md) |
| anything under `assets/cast/` — Tripo, rigs, sprite bakes | [docs/cast-and-3d.md](docs/cast-and-3d.md) |
| `portfolio.html` (REI valuation + scenario model) | [docs/portfolio.md](docs/portfolio.md) |
| preview servers, screenshot rigs | [docs/tooling.md](docs/tooling.md) |
| starting or finishing an agent worktree | [WORKTREES.md](WORKTREES.md) |

Within each file, entries run oldest at the top to newest at the bottom. **When two entries
disagree, the lower one wins.**

## How work gets verified here

Every feature has a suite: `node tools/_verify-<name>.{cjs,mjs}`. The battery must be green
before anything is pushed, and the count is quoted in the commit.

- **Restage a test with its reason written at the check, never bend it.** If a change makes an
  old assertion wrong, say in the file why the old rule no longer holds. Several entries in
  these docs are inversions of an earlier deliberate decision — each one names the decision it
  reverses. A test quietly loosened to pass is worse than a failure.
- **Prove a new check would have caught the bug**: stash the app files back to `HEAD`, re-run,
  and confirm the new checks fail there and every pre-existing check still passes. That
  before/after split is the evidence, not the passing run on its own.
- **Assert arithmetic and geometry, not pixels.** Hand-compute the expected number in the test
  from the fixture, and measure rendered text with a `Range` — a block element's own box tells
  you nothing about the ink inside it.
- **A fixture kinder than reality hides bugs.** Give the fake upstream the shape the real
  service actually returns, including its refusals. A mock more permissive than the real thing
  manufactures confidence — that is how a Firestore field-path bug logged nothing for twelve
  hours while its suite read 147/147.
- **Measure before deciding.** Widths, contrast ratios, latency, token counts. Nearly every
  reversal recorded in these docs replaced a guess with a number.

## Things that bite in more than one place

1. **Headless tests that load `index.html` must block `googleapis|firestore|firebase|gstatic`.**
   An unblocked run hits production Firestore and triggers first-launch paths; it has
   duplicated the live goat herd twice.
2. **A styled container toggled via the `hidden` attribute needs an explicit
   `[hidden]{display:none}`** — its own `display` rule outranks the UA stylesheet. This has
   shipped as a visible bug at least four times. Assert geometry (`offsetParent === null`),
   never the attribute.
3. **`x ?? y` does not fall through on a real `0`, and `x || 0` passes a truthy non-number
   straight through.** Both have silently corrupted scoring here.
4. **A template literal that wraps across source lines puts its own newline into
   `textContent`.** Normalise whitespace before a regex assertion, or the check fails on copy
   that is plainly on screen.
5. **Never run `node -e` with backticks in the string** — bash runs command substitution on it
   first. Use the Edit tool for anything containing backticks or `$(`.
6. **Never `taskkill` all node.** Another agent is probably running. Find the squatting PID.
7. **The git stash stack is shared across every worktree.** Use a throwaway WIP commit
   instead; see WORKTREES.md.
8. **Comment-stripping regexes over these files must not use the naive block form** —
   `accept="image/*"` in markup opens a `/*` that swallows the next 100 KB. A check that
   passes vacuously is the worst kind.
9. **Production data changes go backup → masked `PATCH` (`updateMask.fieldPaths`) →
   canonical re-read.** Firestore needs `integerValue` for whole numbers, and raw
   `JSON.stringify` of a read is key-order noise — sort keys before comparing.
10. **Screenshots are a review tool, not decoration.** Several bugs in these docs were found
    by looking at a plate after the suite went green.

## Working style

- Scratch files, screenshots and throwaway scripts go in the session scratchpad, never in the
  repo.
- Prose written for the family — UI copy, emails, reports — follows the `no-ai-slop` skill.
- App chrome carries no emoji: nav labels, buttons, headings and system messages use text or
  an inline SVG. User-typed content and family-chosen names are exempt.
- Delegate hands-on work to cheaper models by default; keep planning, architecture, diagnosis
  and the final review here.
