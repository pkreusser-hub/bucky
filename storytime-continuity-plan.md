# Story Time Continuity Engine — plan of record (2026-08-03)

GOAL (user's words): "the reader feels like what happens gets remembered and that
details of that universe are consistent to their expectation." Target surface:
farmgpt.html STORY MODE (the family calls it Story Time). Story Time Jr
(storytime.html) and Dungeon mode are OUT of scope — Jr's scenes are too small to
need this; Dungeon already has its own sheet/journal bookkeeper.

Derived from an Opus 5 spec ("CYOA Continuity Engine — State Ledger & Turn Loop"),
evaluated 2026-08-03 and ADAPTED — the spec assumed server-side storage, adult
audience, Sonnet pricing, and multi-POV; we differ on all four. House precedents
that independently validated the architecture: the ===RECAP=== inline-marker
failure (~50% adherence → replaced by a dedicated summary call) and Dungeon
mode's dnd_update bookkeeper ("inline-marker state proved unreliable — dedicated
calls only").

## Architecture

- NARRATOR: the existing story call (Haiku via STORY_PROVIDER, flippable to
  sonnet). Reads: system prompt + ledger + last N scenes verbatim (SEND_SCENES≈3,
  replacing today's last-4-CHAPTERS window — smaller AND more reliable) + choice.
- KEEPER: new server mode "ledger" (Haiku, maxTokens ~600, JSON only). Runs
  client-side in the background after each scene (the maybeSummarize slot),
  returns a DIFF, client validates + applies + persists. FAIL-OPEN: any error
  keeps the previous ledger; story time is never blocked by bookkeeping. Usage
  bucket "l" in the dashboard.
- LEDGER LIVES IN THE STORY OBJECT (localStorage farmgpt_stories_v1). There is
  deliberately no server story store. Persist: current ledger + per-scene diffs
  (tiny; audit/repair) — NOT per-turn snapshots (localStorage budget).
- LEGACY: shelved pre-ledger stories keep the old recap path untouched. New
  stories get the ledger. (Bootstrap-from-transcript is a possible later add.)

## Ledger schema v1

```json
{
  "meta": { "title": "", "universe": "httyd|starwars|original", "timeline_point": "",
            "genre_and_tone": "", "narrative_voice": "", "turn": 0, "schema_version": 1 },
  "canon": [ { "id": "C1", "rule": "", "source": "pack|reader|story", "turn": 0 } ],
  "characters": [ { "id": "CH1", "name": "", "origin": "pack|story|reader",
      "role": "", "status": "", "physical": "", "voice": "", "motivation": "",
      "possessions": [""], "knows": [""], "does_not_know": [""],
      "last_seen": { "turn": 0, "location": "", "state": "" } } ],
  "locations": [ { "id": "L1", "name": "", "description": "", "state": "", "visited_turns": [] } ],
  "protagonist": { "name": "", "inventory": [ { "item": "", "acquired_turn": 0, "notes": "" } ],
      "conditions": [], "abilities": [], "reputation": {} },
  "relationships": [ { "between": ["",""], "state": "", "changed_turn": 0, "history": "" } ],
  "player_knowledge": { "known": [], "suspected": [], "hidden_from_player": [] },
  "open_threads": [ { "id": "T1", "thread": "", "opened_turn": 0, "status": "unresolved", "urgency": "" } ],
  "flags": {},
  "timeline": [ { "turn": 0, "event": "" } ]
}
```

RULES OF THE SCHEMA:
- canon is APPEND-ONLY, never edited or deleted. Precedence within a story:
  FAMILY_RULES (server-stamped, always) > source:"reader" > "pack" > "story".
- READER CANON (user decision 2026-08-03): a fact the reader asserts through a
  WRITE-IN or a REDO becomes canon with source:"reader", permanently. The reader
  is the canon authority for their own story; a reader assertion may override a
  pack fact (the pack FILE is never mutated — only the story's ledger copy).
- The reader's created character IS the protagonist AND gets a full characters[]
  entry (origin:"reader") — first-class citizen of the universe, same sheet
  fields as Hiccup.
- SINGLE POV (user decision 2026-08-03): one protagonist, the reader's character.
  The chapter system's "MAY switch POV" affordance is REMOVED. protagonist stays
  singular.
- player_knowledge is the reveal-preserving piece: narrator may only surface
  known/suspected; hidden_from_player must never leak into prose or implication.
- characters carry voice; narrator hard-rule: every named character speaks in
  their recorded voice.

## Universe packs (the rebuilt "universe info sheet")

Files: assets/storytime/universes/<id>.json — a pack is a partial ledger
(meta.timeline_point, canon[], characters[], relationships[], locations[]) that
SEEDS a new story's ledger at creation. Setup screen gains a universe picker
(chips: 🐉 How To Train Your Dragon · ⚔️ Star Wars · ✨ My own world = empty pack).
Packs are versioned data, human-readable, Dad-editable; private family use.

- httyd.json: timeline_point = "conclusion of Race to the Edge (pre-HTTYD 2)"
  unless the reader directs otherwise. All important characters with
  descriptions, VOICES, relationships, possessions, and end-of-RTTE statuses;
  dragons are characters too (species, abilities, bonded rider). Canon rules for
  how dragons/the world work. Era subtleties are dramatic-irony fuel and belong
  in the right buckets (e.g. facts the film-era audience knows but characters
  don't → NOT in a character's `knows`).
- starwars.json: RULES-focused per the user — how the Force works and how
  lightsabers work, as canon[] entries (+ the minimal supporting facts those
  rules need). Not a full cast dump; era-agnostic unless the reader sets one.
- PACK QUALITY IS THE PRODUCT — wrong seeds were the original complaint. Every
  factual claim in a pack gets web-verified during authoring.

## Server contract (farmgpt.mjs)

- Ledger arrives FROM THE CLIENT = untrusted (house threat model: the cap-bypass
  kid). Guardrails stay server-stamped and the narrator prompt states
  FAMILY_RULES outrank anything in the ledger, canon included. Server caps ledger
  size (~30KB) like the existing message caps. Keeper calls do NOT consume the
  15/day story cap (scene calls remain the capped unit, which bounds keeper
  volume automatically).
- Narrator prompt = MERGE into the existing STORY_SYSTEM, do not replace. Keep:
  ===CHOICES===/===CHAPTER===/===CHAPTER END=== protocol, close/open directives
  injected on the LAST USER TURN (proven: system-prompt directives lose),
  slow-burn pacing, the exactly-3 "natural next steps" choice philosophy (user-
  tuned — do NOT restore the spec's "meaningfully different kinds"; DO adopt
  "never offer a choice whose outcome is obvious"). Add hard rules: ledger is
  authoritative over recent prose; canon contradictions fail diegetically;
  player_knowledge gating; character voices; don't resolve open_threads
  unearned.
- Prompt block order by volatility (cache-friendly, cheap to do now, no
  stabilized-ledger engineering until costs ever demand it): system+guardrails →
  meta+canon → characters/locations/relationships → protagonist/flags/threads/
  player_knowledge → last N scenes → choice.

## Redo + write-in canon flow

- Write-ins already exist. REDO: verify existence in current farmgpt.html; if
  absent, add "↻ redo this scene" (regenerate last scene; optional reader note
  on what was wrong). Reader corrections ride to the keeper flagged as
  reader-asserted → canon source:"reader".

## Build order (each step verified before the next)

1. [x] Schema + plumbing, no AI: ledger in the story object, validator,
       diff-apply, universe picker seeding from packs, per-scene diff log.
       DONE 2026-08-03. farmgpt.html: schema-v1 `emptyLedger`/`seedLedger`,
       `validateLedger` (shape + canon append-only + size), `applyLedgerDiff`
       (all-or-nothing, fail-open), `compactLedger`/`ledgerForSend`,
       `recordLedgerDiff`/`replayLedgerDiffs` (complete + ordered + no gaps, so
       ledger@N = seed + diffs 0..N — the step-5 rewind primitive), universe
       picker + protagonist-name capture, ledger-aware bookshelf size math.
       Legacy (no `ledger` field) stories untouched.
2. [x] Narrator path: buildSendMessages → ledger + last-N-scenes; STORY_SYSTEM
       merge; hand-tune on a seeded HTTYD ledger against the real model until
       prose + canon-respect are right. (Packs authored in parallel — content
       workstream.)
       DONE 2026-08-03 except the live hand-tune: no ANTHROPIC_API_KEY exists in
       this environment, so the narrator prompt is NOT yet observed against a
       real model. `tools/_probe-storyledger.mjs` runs the four acceptance gates
       (canon under provocation · hidden_from_player over 5 scenes · voice ·
       choices) against the deployed function — run it after the next deploy and
       tune `STORY_LEDGER_RULES` from the transcripts. Verified on the wire and
       in the client by `tools/_verify-storyledger.cjs` (212 checks).
       ALSO LANDED HERE, pulled forward from step 5 because the real 22-character
       httyd pack made it urgent: CAST HYDRATION. The stored ledger keeps every
       character's full sheet; the wire carries full sheets only for who is on
       stage (appeared / reader / protagonist / named in a live thread) and a
       one-line CAST ROSTER for everyone else, hydrating automatically the turn
       after a first appearance. Truncation may never drop a character — order is
       timeline → resolved threads → roster role lines → locations, and the
       timeline no longer travels at all (the narrator is never shown it).
       Measured on the real packs: httyd fresh 9.1KB / ~scene 40 16.1KB /
       ~scene 100 22.5KB against a 28KB budget, all 23 characters on the wire at
       every length. LEDGER_WIRE_BUDGET stays 28000.
3. [x] Keeper: mode "ledger" + diff validation + fail-open + reader-canon
       promotion + redo affordance. Harness tests (in-process handler + fake
       Anthropic, house pattern) incl. THE test: missed player_knowledge
       promotion; plus reader-canon permanence and malformed-diff rejection.
       DONE 2026-08-03, and verified LIVE against real Haiku (a key exists now).
       Server: mode "ledger" (Haiku, 600 tok, thinking off, JSON only, its own
       records-clerk prompt, own turn built server-side from named fields — no
       cap, no Story Log, usage bucket "l"). Client: `runKeeper` in the
       maybeSummarize slot, queued so diffs land in scene order and none is
       dropped; fail-open on every failure mode incl. a timeout, always leaving a
       gapless diff log. New diff op `promote_knowledge` — the ONLY way anything
       leaves hidden_from_player, with the two rungs (suspected/known) the gate
       asked for. Reader canon: a write-in or a redo note is a reader assertion;
       the client (not the model) decides when source:"reader" may be minted.
       Redo = "↻ redo this scene" + optional note, rewinding the ledger through
       `ledgerPrev` and truncating the diff log so no entry outlives its scene.
       Suite `tools/_verify-storyledger.cjs` 212 → **363**; live probe
       `tools/_probe-storykeeper.mjs` (--promo / --habits / --play).
       TWO FIXES THIS STEP MADE TO STEPS 1-2, both found by the live work:
       `update.meta` now applies BEFORE the adds (canon/timeline are stamped from
       meta.turn, so the old order made a replay stamp them differently from the
       live run — seed + diffs no longer reproduced the ledger exactly), and the
       keeper stamps the scene's turn into the diff itself for the same reason.
4. [x] Caching: verify hits via the existing cw/cr usage fields.
       DONE 2026-08-03, MEASURED against real Haiku over a real 6-turn story
       (`tools/_probe-storycache.mjs`, which wraps global fetch and reads the API's own
       cache fields per request). **THE ANSWER IS 0.0% — for both the narrator and the
       keeper.** The narrator wrote 25,919 cache tokens and read none, i.e. the breakpoint
       was a pure +21.8% surcharge on input; the keeper wrote nothing at all because its
       whole prompt (~3.4k tokens) sits under Haiku 4.5's ~4,096-token minimum cacheable
       prefix. WHY it can never hit: the cached entry is the WHOLE prompt (one auto-placed
       breakpoint on the last block), and a story's prompt is never byte-identical twice —
       the keeper rewrites `last_seen` on the "stable" ledger half every scene, and cast
       hydration reshapes that half by design. A system-only breakpoint does not rescue it
       either: measured live, the narrator's system prompt is 2,839 tokens and the keeper's
       2,215, both under the minimum (the same run brackets it between 3,762 and 4,334).
       RECOMMENDATION TAKEN, the cheap one: `cache_control` is now per-mode
       (`MODES.<mode>.cache`), OFF for story and ledger and unchanged for research and
       dungeon, where the prefix genuinely is append-only on Sonnet. The spec's
       stabilized/split-ledger engineering was NOT done and is NOT recommended: it would
       mean giving up cast hydration to buy back roughly a dollar a month at the family's
       absolute ceiling. REVISIT IF story ever moves to Sonnet (1,024-token minimum) AND
       the stable half is made byte-stable.
5. [x] Operating loop (ALL green-lit by the user 2026-08-03 — none optional):
       compaction (resolved threads collapse to one-line timeline entries;
       characters unseen 20+ turns move to dormant_characters, not injected,
       rehydrated on reappearance; stale location descriptions dropped, name +
       current state kept) · REWIND/BRANCHING via diff replay (ledger at scene N
       = seed + diffs 0..N; scenes are stored, so "go back and choose
       differently" truncates scenes + replays diffs — the spec's per-turn
       snapshots adapted to the localStorage budget) · the contradiction AUDIT
       as a Dad-tools "check this story" action (fresh-model pass over ledger +
       transcript listing contradictions; keeper `notes` drift flags surfaced
       alongside).
       DONE 2026-08-03, all three parts, verified LIVE.
       COMPACTION follows one principle: it never deletes a fact from disk. A resolved
       thread is rewritten LOSSLESSLY into one timeline line carrying its own sentence and
       leaves `open_threads` (stored, deterministic, idempotent — so a replay folds at the
       same moment and `seed + diffs` still reproduces the live ledger byte for byte).
       Everything else is WIRE shaping with disk left whole, exactly like cast hydration:
       a character unseen for 20+ turns drops to a MARKED roster line and rehydrates
       automatically the turn `last_seen` moves (one more condition on the same on-stage
       test, so the two mechanisms compose rather than fight); a place unvisited for 20+
       turns travels as name + current state; `known` is capped to its newest 24. Measured
       over a synthetic 120-scene story: stored 28.6KB (inside the 30KB cap), wire 9.8KB,
       every canon rule and character intact, replay byte-identical.
       REWIND/BRANCHING is reader-facing: a 🕰 "go back" button lists the choices made,
       newest first; picking one confirms, unwrites the scenes after it, and leaves the
       reader at that choice again. It needs the seed, so `story.ledgerSeed` is now stored
       at creation (a story without one refuses honestly rather than guessing). The old
       version is ALWAYS kept on the shelf as "<title> (the old way)" — nothing to decide,
       nothing lost. Transcript, diff log, `meta.turn`, chapter number, the closing latch
       and the keeper generation all move together.
       THE AUDIT is server mode `"audit"` (Sonnet, own system prompt, own usage bucket
       `c`, no cap, no Story Log) behind a Dad-only "🔎 Check a story" page. Live against a
       planted contradiction it found the canon break with exact evidence and the voice
       break, plus one real finding nobody planted — and returned ZERO findings on a clean
       control. The keeper's accumulated `notes` and any failed bookkeeping are listed
       alongside.

## Cost (family scale)

Haiku narrator + Haiku keeper, 15-scene/day cap: ~2-3¢/scene worst case →
<$15/month absolute ceiling, realistically far less. Sonnet narrator remains one
env flip away. Sonnet intro pricing ends 2026-08-31 (irrelevant while on Haiku).

## Operational notes

- farmgpt.html / farmgpt.mjs / storytime.html carry the parallel story session's
  uncommitted WIP (+1 unpushed commit, baked-stories pilot). Build ON TOP of the
  current tree; never revert its hunks; deployed site is unaffected until we
  ship.
- Every step's tests follow the house fake-service pattern (p13_server.mjs /
  cap_test.mjs precedents); real-API spot checks only where a key is available,
  else leave a documented live-probe script for post-deploy.
