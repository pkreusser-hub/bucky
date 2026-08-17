# FarmGPT — the family AI

`farmgpt.html` + `netlify/functions/farmgpt.mjs`, plus `storytime.html` (early reader),
`dungeon.html` (Dad-only D&D) and the TeacherGPT quiz builder. Covers story mode, the
continuity ledger engine, research/tutor mode, the parent story log, and usage accounting.

Read it before touching any model prompt, any `MODES` entry, or the usage-bucket letters —
the bucket letters are shared across every mode and two modes writing one bucket makes both
dashboard rows lie.

> Split out of the single 12,800-line `CLAUDE.md` on 2026-08-16. Entries are verbatim and in
> their original order — the oldest at the top, the newest at the bottom. Later entries
> routinely correct earlier ones, so when two disagree, the lower one wins.

---

# 🌾 FarmGPT — family AI: story time + research (2026-07-07)

farmgpt.html + netlify/functions/farmgpt.mjs. PER-MODE MODEL (2026-07-08): STORY + its
background SUMMARY run on Anthropic claude-haiku-4-5 ($1/$5 MTok); RESEARCH stays on
claude-sonnet-5 ($3/$15, stronger homework/coding). STORY_PROVIDER env = "haiku" (default) |
"gemini" | "sonnet" flips story without a code change (resolves provider+model near the
upstream fetch; RESEARCH_MODEL/STORY_MODEL/GEMINI_MODEL consts). WHY HAIKU over the earlier
Gemini plan: the Gemini 2.5 Flash FREE tier turned out to be capped at ~20 requests/DAY on
this project (quotaId GenerateRequestsPerDayPerProjectPerModel-FreeTier=20 — the free tier is
unusable for a family story app; gemini-2.0-flash's free quota also reads 0, only 2.5-flash
had any). Haiku wins on: reuses the existing ANTHROPIC_API_KEY + Anthropic request/SSE path
(no new vendor/key), no rate-limit cliff, reliable ===CHOICES===/===CHAPTER===/guardrail
adherence (Claude family), ~pennies (still ~4x Gemini-paid but negligible at family volume —
cost + Gemini's bigger context are both non-factors here since the summary system keeps every
request tiny). 3-way quality test (Haiku vs Sonnet vs Gemini 2.5 Flash on the exact prompt):
Haiku ≈ Gemini for kids' chapters, both a notch below Sonnet. HAIKU QUIRK fixed: Haiku added a
Markdown "# Title" heading → STORY_SYSTEM now says "write plain story prose only, no Markdown,
titles come only from ===CHAPTER===". The GEMINI PATH is still in the function (kept for the
STORY_PROVIDER=gemini escape hatch): :streamGenerateContent?alt=sse, system_instruction +
user/model contents + thinkingBudget 0, toGeminiContent() maps messages; GOTCHA — Gemini SSE
delimits events with CRLF (\r\n\r\n) vs Anthropic's bare LF, so the hand-parser strips all raw
\r; Gemini refusals (finishReason SAFETY/RECITATION/OTHER or promptFeedback.blockReason) map
to the shared "refusal" stand-in; GEMINI_API_KEY only needed when STORY_PROVIDER=gemini.
Usage dashboard prices story/summary at Haiku ($1/$5) and research at Sonnet ($3/$15) w/ cache
(1.25x write / 0.1x read). Verified in-process vs REAL Haiku+Sonnet: story→Haiku (===CHAPTER===
title, exactly-3 ===CHOICES===, no Markdown heading), close→===CHAPTER END===, summary
continuity, research→Sonnet. GEMINI_BASE_URL env override exists for fake-server tests.
- SLOW-BURN PACING (2026-07-08): STORY_SYSTEM rewritten to fix "world ends by sentence 3" — new
  PACING & TONE section (start small in ordinary life, build stakes slowly over many chapters, one
  thread at a time, no world-ending stakes early, calm moments valued); choices reframed from
  "genuinely different directions" → "natural next steps that fit the moment"; intro dropped the
  "exciting" pressure. Verified on the Star Trek scenario: 3 chapters stayed grounded (a flickering
  conduit), zero chaos words.
- CHAPTER SYSTEM + shelving (2026-07-08): stories are now an endless serialized NOVEL told in
  young-adult-length CHAPTERS (the ===THE END===/finish button is GONE; END_MARK kept only so
  legacy finished stories still resume). Each assistant reply is a "scene" ending in ===CHOICES===
  as before; the CLIENT tracks words in the open chapter (CHAPTER_TARGET_WORDS=1600) and, once over,
  sends endChapter:true so the next scene CLOSES the chapter with ===CHAPTER END=== (no choices) →
  UI shows "Read the next chapter →" / "📚 Shelve for now". Shelve saves to the existing bookshelf;
  resume rebuilds chapter dividers + restores the chapter-end prompt. "Next chapter" pushes a
  NEXT_CHAPTER_MSG sentinel (never rendered as a picked choice) with newChapter:true → model opens
  a ===CHAPTER=== <title> scene and MAY switch POV (multi-protagonist saga). New markers CHAPTER_MARK
  / CHAPTER_END_MARK; parseChapter returns {title, chapterEnd}; story.chapter + story.closing (latch)
  persisted. KEY LESSON: a CLOSE-chapter directive placed in the SYSTEM prompt loses to the base
  "end EVERY scene with ===CHOICES===" rule — Gemini kept emitting choices. FIX: the server injects
  the new/close directive onto the LAST USER TURN (models follow the immediate user instruction far
  more reliably); confirmed live (===CHAPTER END=== with a gentle close). The client latches
  story.closing so it keeps asking until the model complies. Tunable: CHAPTER_TARGET_WORDS. Verified:
  25/25 headless UI checks (divider, threshold→close, chapter-end UI, shelve, resume incl. chapter-end
  state, next-chapter POV, sentinel not shown, 0 pageerrors) + both directives live on real Gemini.
- PARENT MONITORING (2026-07-09): (1) the 📊 API-usage-&-cost link in FarmGPT is now Dad-only —
  gated on localStorage["choreUser"]==="Dad" (same identity as index.html PRINT_ADMIN; NOT a hard
  lock — the stats endpoint is still family-password gated — just keeps spend out of the kids'
  sight). (2) STORY CONTENT LOG so Dad can review what the kids read: the FUNCTION logs every story
  scene to Firestore collection farmgpt_story_log (server-side, kids can't bypass), keyed by kid +
  Central day; deterministic doc id `<date>__<user>__<storyId>__<idx>` (retries overwrite, never
  dup). The client sends user(choreUser)/storyId/storyTitle/sceneIdx/choice on story requests;
  logStoryReq gate skips research/summary AND user==="Dad"; ===ART=== SVG stripped before store;
  logged in the stream finally (never breaks a reply). DELIVERY = an IN-APP Dad-only "📖 Story Log"
  page in FarmGPT (NOT a local file / not emailed — user iterated through all three; the browser
  page needs no Windows Task Scheduler and works on any device). New secret-gated function actions:
  mode:"storylog" → readStoryLog() lists the collection server-side (service account), AUTO-PRUNES
  anything older than STORY_LOG_RETENTION_DAYS=30 (bounds public-Firestore exposure w/o a scheduler),
  returns {entries} sorted date-desc/idx-asc; mode:"storylog_clear" {date} → clearStoryLog() deletes
  a day (via :commit delete writes). Client Story Log view groups entries date→user→story and
  renders each scene with the EXISTING parseChapter() (world/setup line, chapter title, prose,
  choices offered + the one taken) + a per-day 🗑 clear. Button + view gated on choreUser==="Dad"
  (UI-hidden only; endpoints are family-password gated like stats). WHY route the browser read
  through the function (not Firestore-direct): dodges browser CORS, reuses the server-side service
  account, keeps the public key off a third page. Verified: backend storylog read excludes Dad +
  prunes 30-day-old docs + clear empties + 401 on bad secret (fake Firestore + REAL Haiku); UI
  renders grouped/parsed w/ Dad-gating + clear, 0 pageerrors. (Retention gotcha: .slChap CSS
  uppercases the chapter label, so innerText reads it uppercased in tests.)
- DAD ACCOUNT LOCK (2026-07-09, app-wide — index.html + farmgpt.html): the Dad profile is now
  PIN-protected (sensitive stuff moved to it — banking, API cost, kids' Story Log). In-app PIN
  (user chose "no server setup"): created the first time Dad is selected, hashed sha256(pin +
  ":" + FAMILY_PASSWORD) — never stored plaintext — saved to Firestore settings_<familyKey>/
  dadAuth.pinHash AND mirrored to localStorage["dadPinHash"] so farmgpt.html (no Firebase SDK)
  can verify it too. Unlock = sessionStorage["dadUnlocked"]="1", which is ORIGIN-WIDE so unlocking
  in one page unlocks the other. Shared helper names identical in both files: sha256Hex,
  dadPinHash(), dadConfigured(), dadUnlocked(), gateDad()/tryUnlockDad(). index.html: added
  backend.getSetting/setSetting (a settings_<fam> doc, kept OUT of the chores collection; local
  backend uses localStorage "setting_<id>"); meBtn (profile switch) → gateDad() when name==="Dad"
  (create-or-verify; leaving Dad clears the unlock); afterBackendReady() syncs the hash + auto-
  prompts if Dad-but-locked on load; the two banking gates (payout confirm buttons + kid bank
  admin chips) changed myName()===BANK_ADMIN → bankAdmin()= name && dadUnlocked(). farmgpt.html:
  usage + Story Log links gated on isDad()=name && dadUnlocked(); a "🔒 Unlock Dad tools" link
  (shown when Dad-but-locked & PIN synced locally) prompts + verifies against the local hash. SOFT
  client gate (a devtools kid could set the session flag; the real strength is not knowing the
  PIN) — consistent with the app's existing choreUser-identity posture. Verified headless: farmgpt
  gating + PIN unlock reveals the Dad links (18/18); index.html create-PIN/verify/reject-wrong/
  auto-prompt-on-load, banking untouched, Firestore blocked → local backend, 0 pageerrors (10/10).
  KNOWN GAP: banking data still lives in public Firestore (rules unchanged) — the lock hides the
  admin UI, not the raw data; true server enforcement would need the "server-enforced" option
  (DAD_PASSWORD env var) the user declined.
- ROSTER-EDIT PIN GATE (2026-07-10, index.html): a kid discovered the FarmGPT 30/day story cap
  is per-choreUser-identity and beat it by renaming their own profile in the Family sheet (new
  name = fresh identity = fresh cap). Family-sheet roster MUTATIONS (add member, save an edit,
  delete a member) are now gated behind `gateDadForRoster()` — a wrapper around the existing
  `gateDad()` (create-or-verify PIN prompt) called at every mutation point: `saveFamilyMember()`
  (covers both Add and Save-edit — the single mutation path for both), the ✎ edit-entry `onclick`
  (gated too, for early friction — the ✎ button just loads the form, so double-gating it is free),
  and the 🗑 delete `onclick`. "This is me" (selecting an EXISTING profile) stays ungated except
  the pre-existing Dad-profile gate. A muted hint line was added under the form: "🔒 Dad's PIN is
  needed to change the family list". SUBTLETY CAUGHT: `gateDad()` sets the SESSION-WIDE
  `sessionStorage["dadUnlocked"]` flag on success, and that same flag also gates banking admin UI
  via `bankAdmin() = isDadName() && dadUnlocked()`. Traced every `dadUnlocked()` call site (3:
  `bankAdmin()`, the payout-confirm/kid-bank-admin-chip gate, and the Dad-but-locked auto-prompt in
  `render()`) — all of them ALSO require `isDadName()` (current profile === "Dad"), so a kid's
  session having `dadUnlocked=1` while `choreUser` is still the kid's own name does NOT by itself
  unlock banking (and re-selecting "This is me" → Dad still forces a fresh `gateDad()` prompt
  regardless of the flag). Handled defensively anyway per the task spec: `gateDadForRoster()`
  clears `sessionStorage["dadUnlocked"]` right after a successful gate IF the current profile is
  NOT Dad, so a kid's session never carries the flag past the roster edit; if the current profile
  IS Dad, the unlock is left in place (a legitimate Dad session, matches existing behavior).
  Verified headless (scratchpad p14_roster_gate.mjs, window.prompt stubbed via addInitScript with a
  scriptable answer queue since gateDad uses prompt()/alert()): 10/10 — fresh family + cancel PIN
  creation → no member added; wrong PIN at the ✎ entry gate → form not populated; wrong PIN at the
  save gate → rename rejected; right PIN at both → rename applies; add-with-right-PIN succeeds;
  "This is me" on a non-Dad profile calls prompt() 0 times; post-edit sessionStorage.dadUnlocked is
  null for a kid session; 0 pageerrors. Regressions unaffected (profile-switch flows exercised
  there call no roster mutations): p7_fixes.mjs 15/15, p8_gate.mjs 18/18.
- STORY CAP: CANONICAL IDENTITY BUCKETS (2026-07-16, user: Eleanor ran 50+ story requests/day
  despite the 30 cap): production `farmgpt_story_log` showed the cap WAS enforcing exactly 30 —
  per exact `user` STRING. Eleanor ran a second identity `"Eleanor ( :"` alongside `"Eleanor"`
  (30+30 on 07-11, 30+21 on 07-12; no such profile exists in the roster now — either deleted
  after, or she set localStorage.choreUser directly, the roster PIN gate can't stop devtools).
  (Her 54-scene 07-10 run predates that day's 13:44 CDT cap deploy — not a live bug.) FIX
  (farmgpt.mjs): `canonStoryUser()` — lowercase, strip non-alphanumerics; any name CONTAINING a
  known family name (STORY_CAP_KNOWN = eleanor/grandma/grandpa/janae/isaac/john/joy/mom) buckets
  as that person; anything unrecognized shares ONE `~other` bucket (invented names split a single
  30/day, never one each). Only the EXACT string "Dad" stays uncapped (caller check unchanged) —
  "Dad ( :" style variants land in ~other and ARE capped. `countStoryToday()` now queries by date
  equality ONLY (+ a `select` mask on the `user` field — scene docs are up to ~24KB and only the
  name is needed) and bucket-matches in code; still fails OPEN on query errors. Log docs keep the
  RAW name so the Story Log shows the parent exactly what identity was used. Client mirror
  (farmgpt.html): same canon fn keys the local `farmgpt_story_count_v1` counter (a same-device
  rename no longer resets the pre-check) + exact-"Dad" client exemption added (previously the
  local counter would wrongly block Dad at 30 even though the server never would). KNOWN LIMIT:
  a devtools kid setting choreUser to exactly "Dad" bypasses cap AND logging — server can't
  verify the PIN; consistent with the app's stated identity posture. Keep STORY_CAP_KNOWN in sync
  (both files) when the family roster changes; a NEW legit member shares ~other until added.
  Verified: scratchpad cap_test.mjs (in-process handler + fake Google/Firestore/Anthropic, 13/13:
  rename/case/punctuation variants capped, mixed identities sum, 29 allowed, query shape, shared
  ~other bucket, per-kid isolation, Dad exempt / Dad-variant capped, fails open, research
  untouched) + cap_client_test.mjs (playwright vs local http, CDN libs stubbed — jsdelivr is
  unreachable from sandbox Chromium, 4/4). Production Firestore audit script: storylog_audit.mjs.
  CAP LOWERED 30 → 15/day (2026-07-16, user, after confirming the bucket fix held for a few
  days) — STORY_DAILY_CAP in BOTH farmgpt.mjs and farmgpt.html (keep in sync); both suites
  re-run green at 15.
- STORY LOG → DAILY SUMMARIES (2026-07-30, sonnet agent from Fable spec, PUSHED): Dad's Story
  Log no longer stores/renders full transcripts — ONE Haiku-written summary per kid per day
  (📖 about / 🧭 how the kid steered it, write-ins quoted / verdict line: ✅ clean or 🚩 flagged
  when the kid pushed toward restricted-adult content or the story had to redirect; uncertain →
  flag with a note). NEW collection farmgpt_story_summary (doc id <date>__<canonKey>, ~other→
  "other" in the id only; users[] keeps every raw identity seen so the rename trick stays
  visible; 90-day prune STORY_SUMMARY_RETENTION_DAYS). NEW action storylog_summaries (replaces
  the old storylog transcript action; runs LAZILY when Dad opens the log: groups raw scenes by
  (date, canonStoryUser), processes ≤3 groups/request, client polls while pending>0 cap 10).
  ORDERING GUARANTEE: the summary doc write is confirmed ok BEFORE that day's raw scenes are
  deleted, and TODAY's raw scenes are NEVER deleted (countStoryToday's daily cap queries them;
  today renders a "(so far today)" partial:true card, re-summarized when sceneCount changes).
  Failure = one retry then a flagged:null sentinel doc (sceneCount:-1) so the group re-attempts
  next open with scenes intact. storylog_clear now clears scenes AND summaries for the date.
  Summarizer = non-streaming Haiku (callAnthropicOnce), STRICT-JSON parsed defensively, usage
  under u_*; kidstory (Benjie) scenes summarize through the same path. GOTCHA the suite caught:
  `pending` must count group RESOLUTION (classified − resolved), not classified − batchSize —
  a failed write otherwise reports pending:0 and the client poll never converges. VERIFY:
  node tools/_verify-storylog-summary.mjs (77: blocked-write ordering proof, cap regression,
  rename-variant merge, all retry paths, pending arithmetic 7→3/3/1, both prunes, 401) +
  scratchpad client suite 24/24 + kidstory 54/54 + dnd 47/47 regressions. Flag QUALITY not
  live-testable from this env — spot-check the first real day post-deploy and tune
  STORY_LOG_SUMMARY_SYSTEM if flags read too twitchy or too quiet.
- CONTINUITY BATCH (2026-08-01, user: "Eleanor often hits continuity issues" — diagnosed from her
  live story log: the model narrated past a decision she reserved, and after her "Redo that…"
  correction the rejected scene's invented details (chains/cuffs) kept resurfacing because the bad
  scene stayed in the history; her most careful correction was ALSO silently clipped at the
  write-in box's maxlength=400, mid-sentence, at exactly 400 chars): (1) REDO MECHANIC — a
  write-in matching /^\s*(please\s+)?re-?do\b/i REMOVES the rejected scene from story.messages
  entirely (tryRedo in farmgpt.html; the redo text stays as its own user turn tagged
  {opener:bool}); consecutive user turns are merged ONLY at send time (mergeUserRuns in
  buildSendMessages — the API needs alternating roles, the saved transcript stays honest);
  paintTranscript (factored out of resumeStory) repaints the scroll; a redone chapter OPENER
  regenerates with newChapter:true (resume honors last.opener too); summarizedIdx pulls back if
  the rejected scene was already folded. sceneIdx for the parent log is now MONOTONIC
  (story.sceneSeq) so a redo logs under a FRESH doc id — Dad sees both versions AND redos still
  count against the 15/day cap (reusing the index would have overwritten the doc and made redos
  cap-free). (2) write-in maxlength 400→2000 (server already caps at 12k). (3) STORY BIBLE — the
  recap prompt (SUMMARY_SYSTEM, farmgpt.mjs) rewritten from "≤180-word bullet notes" to a
  4-section bible (CHARACTERS w/ established physical details marked CANON · NOW = where everyone
  is · FACTS & SECRETS incl. who-knows-what · THREADS), ≤400 words, maxTokens 400→800; redone
  content: "corrected version is the ONLY truth". (4) STORY_RULES_REMINDER (rides every last user
  turn) gains continuity law: reader-specified details are CANON, never contradicted; a reader-
  reserved decision ("I want to decide that") means END THE SCENE BEFORE that point; a REDO
  message means the flawed scene is already discarded — write fresh. Suites:
  tools/_verify-story-reminder.mjs now 25/25 (+bible checks) + scratchpad story_redo_test.cjs
  26/26 (wire/DOM/saved-story scene removal, role alternation, merged turns, fresh sceneIdx,
  opener redo, resume, maxlength) + storylog-summary 77 / kidstory 54 / dnd 47 regressions green.
- COLLABORATIVE STORY BATCH (2026-08-01, user, 6 changes): (1) CHAPTER STEERING — chapterEndRow
  gains #nextChapterIdea (maxlength 2000): filled → the idea IS the next chapter's opening user
  turn (tagged {opener:true}, addPickedEl'd, logged as the choice); blank → NEXT_CHAPTER_MSG
  sentinel as before; Enter submits. (2) SCROLL-GATED CHOICES — gateChoices()/storyAtBottom()
  (farmgpt.html): after a scene lands, choiceBtns/writeRow/chapterEndRow hide (.gated class +
  #scrollHint "⇣ keep reading") until #storyScroll is within 48px of the bottom; short scenes
  never gate; capped/ended never gate. (3) MEMORY BEEF-UP (user-approved token spend): mode
  "summary" now runs on SONNET always (provider resolution split from story; dashboard prices
  u_* at Sonnet from 2026-08-01 — earlier u_* docs were Haiku, slight over-estimate is fine);
  bible gains GOALS & MOTIVATIONS section + POSSESSIONS-per-character in CHARACTERS, ~700 words,
  maxTokens 1200; SEND_CHAPTERS 4→6. (4) PARENT-REPORT FLAGS RECALIBRATED — franchise crossovers
  (Star Wars/lightsabers) + ordinary fantasy combat are NEVER flag-worthy; flag only GRAPHIC
  content (gore/torture/dwelled-on injuries), REPEATED pushes for more/harsher violence (>1
  redirect), or sexual/political content. (5) TRANSCRIPTS RETAINED — raw farmgpt_story_log
  scenes are NO LONGER deleted after summarization (the cleanup kind is gone; final-summary +
  scenes = normal resting state); STORY_LOG_RETENTION_DAYS 30→90 (accessible for review via
  Firestore REST — public rules, see scratchpad pull_eleanor.mjs pattern); new secret-gated
  action storylog_scenes {date, canon} → the Story Log renders a "📜 Read the day's transcript"
  toggle under each report card (slTrans* CSS; parseChapter strips markers). storylog_clear
  still deletes both. (6) READER IS LAW — STORY_SYSTEM write-in line + STORY_RULES_REMINDER
  gain co-author language: write-ins are direction not suggestion, never watered down, crossovers
  welcome; content rules remain the only override. Suites: _verify-story-reminder 30/30 ·
  _verify-storylog-summary 86/86 (deletion asserts inverted to retention + storylog_scenes +
  flag-rule checks) · scratchpad story_ux_test.cjs 22/22 (gate/steer/transcript) ·
  story_redo_test 26/26 + parent-research 25 / kidstory 54 / dnd 47 / calories 24.
📚 UNIVERSE BIBLES (2026-08-01, user: Eleanor's redos mostly correct HTTYD canon): server-side
  UNIVERSE_BIBLES in farmgpt.mjs — compact franchise fact sheets (HTTYD incl. RTTE · Super Mario ·
  Star Wars · Pokémon; ~250 words each) AUTO-ATTACHED to the STORY system prompt when the
  request's message text matches a trigger regex (universeGuides(messages) — JSON.stringify scan;
  no picker, the world setup names the franchise and character names in scenes/recap keep it
  sticky after windowing; crossovers attach multiple guides). Key facts encode the exact redo
  classes: dragons NEVER talk, Hiccup/Toothless prosthetics, Grimborns, per-character
  weapons/dragons; Pokémon say only their names + faint-never-die; Mario poof-not-die. Guide
  header: reader's explicit changes WIN (reader-is-law compatible). story mode only (research/
  kidstory/summary untouched). False-positive care: bare "peach"/"toad" don't trigger ("princess
  peach" does). To add a universe: append an entry, nothing else to wire. Verify:
  _verify-story-reminder.mjs now 40/40 (+10: attach/facts/yield-line, no-trigger, peach guard,
  Mario, crossover BOTH, recap-sticky, research-never).
⚔️ STAR WARS SHEET REBUILT MECHANICS-FIRST (2026-08-02, user: "she needs more force awareness,
  not characters"): ~680 words — THE FORCE (light/dark, born-not-learned, ranks, Rule of Two;
  telekinesis scaling; body powers + deflection-via-precognition; mind trick limits; TELEPATHY
  & FORCE BONDS — siblings/partners speak mind-to-mind, feel each other, sense across distance,
  the exact mechanic Eleanor plays; dark powers; limits/costs/Force ghosts) + LIGHTSABERS
  (kyber crystals choose/bleeding-makes-red, weightless blade/cauterizes/locks, beskar resists;
  TYPES incl. double-bladed = ONE central handle — evidenced by her ASCII-art redo — shoto,
  crossguard, curved, darksaber; seven dueling forms) + compressed galaxy color. Triggers +=
  kyber|padawan|darksaber|force push|force lightning.
🧬 EVOLVING FAMILY CANON (2026-08-01, user: kid-created characters like Bree should become part
  of the universe sheet and evolve): farmgpt_canon/<universeKey> Firestore doc per universe —
  after every mode-"summary" story-bible fold, the server detects the story's universe(s) and a
  Sonnet bookkeeper (CANON_UPDATE_SYSTEM, ≤500 words, NO_CHANGES sentinel skips writes, never
  drops a reader-created character — compresses instead) merges reader-created characters +
  lasting universe changes into the doc (updateUniverseCanons in the stream finally;
  captureReply = logStoryReq || summary). universeGuides() is now ASYNC: serves baked facts +
  "FAMILY CANON" block (fetchUniverseCanon, 60s warm cache; write updates cache). Canon is
  FAMILY-SHARED — one kid's characters exist in siblings' stories. Usage logs under u_*
  (Sonnet-priced ✓). HTTYD sheet also expanded 3x (~1,050 words, full RTTE cast w/ physical
  descriptions, Dragon Eye, lore; Johann twist stated plainly — kids have seen everything;
  "dragon rider" trigger REMOVED as too generic — an original dragon world must never get
  "dragons never talk" imposed). Verify: _verify-storylog-summary 105/105 (+11 canon:
  no-universe skip, Sonnet fold, empty-canon first fold, doc write, story-prompt injection,
  current-canon merge, NO_CHANGES no-write) + reminder 40/40.
🎁 STORY BUDGET REFRESH (2026-08-01, user): Dad-only button atop the Story Log view
  (#budgetGrantBtn) → mode story_budget_grant increments farmgpt_story_bonus/<farmDate> .extra
  by STORY_DAILY_CAP — everyone's effective cap that day = 15 + extra (grants stack; bonus read
  fails CLOSED to the base cap, unlike the count query which fails open). Server cap check +
  new mode story_budget {user} → {used, cap, capped}. CLIENT: farmgpt_story_count_v1 gains
  .cap (default 15); when locally capped, guardStoryCap + the capped-UI paint fire a THROTTLED
  (8s) background refreshStoryBudget() — a granted device adopts the new cap, repaints the
  controls, toasts "🎁 Dad refreshed…" (no reload needed; local block stays instant). Suites:
  _verify-storylog-summary 94/94 (+8 budget: stack/uncap/stream/Dad/401; fake Firestore now
  APPLIES integer increment transforms) + story_ux_test 28/28.
🍎 TEACHERGPT (2026-08-02, user; FINAL SHAPE = on-device .docx, NO Google APIs): FarmGPT home
  card + viewTeacher — a teacher photographs material (≤8 photos, client-resized 1568px JPEG,
  >4.5MB batches pre-blocked: Netlify ~6MB body cap), picks Quiz/Test + question count (3-50)
  + optional notes → mode "teachergpt" (OPUS 5, callAnthropicOnce w/ image blocks, maxTokens
  8000, strict JSON {title,chapter,instructions,questions[{q,choices?,lines}],answerKey};
  existing-quiz photos → same problems DIFFERENT numbers, prompt-enforced) → server returns
  the QUIZ JSON; the PAGE builds a .docx ON DEVICE (buildTeacherDocx in farmgpt.html:
  hand-rolled STORED-entry zip + CRC32 + minimal WordprocessingML — centered bold title,
  chapter · QUIZ/TEST line, Name/Date line, instructions, numbered questions w/ lettered
  choices or ruled answer lines, PAGE BREAK, ANSWER KEY page) → 💾 Save (a[download]) + 📤
  Share (Web Share API w/ files — native sheet: email anyone/print/Drive; hidden where
  unsupported; docx imports into Google Docs). Test hook __TEACHER__ (docx blob/name/build).
  TIMEOUT SAGA (three live failures shaped this): (1) plain response → Netlify sync cap kills
  60-90s Opus runs; (2) keepalive stream ALSO died live (~45s); (3) Google-Docs delivery via
  the SA died 403 despite both APIs verified enabled (suspect: 2025 zero-Drive-quota for
  service accounts) → Google axed entirely per user ("word doc + share = simpler").
  ARCHITECTURE: netlify/functions/teachergpt-background.mjs (-background suffix = 202
  immediately, 15-min allowance) → runTeacherJob (exported from farmgpt.mjs; re-checks the
  secret — endpoint is public; validates jobId) → teacherGenerate → writes
  farmgpt_teacher_jobs/<jobId> {status, quiz JSON, error}; the page polls mode
  teachergpt_result every 5s (missing doc = pending, 5-min client timeout); the streamed
  in-function path remains an automatic fallback when the background endpoint 404s. Usage
  bucket t_* priced at Opus 5 ($5/$25) w/ 🍎 dashboard row. Verify: tools/
  _verify-teachergpt.mjs 32/32 (prompt rules, quiz-JSON contract, bg job/poll/auth, other
  modes clean) + scratchpad teacher_client_test.cjs 21/21 (incl. unzipping the built docx
  with python zipfile and asserting the full print layout). NOT live-tested vs real Opus —
  post-deploy: run one real quiz, open the .docx in Word/Google Docs, check layout + print.
  PLAYTEST BATCH (2026-08-02, PRs #17/#18): button = "Generate the quiz/test ✨"; 0.5" margins
  (pgMar 720); heading EXACTLY "Chapter XX Quiz/Test" (tHeading regex; model title never prints);
  #tClass class-name input under the heading; answer space = BLANK paragraphs not ruled lines,
  keepNext+keepLines chains keep each question whole per page; "lines" prompt-matched to required
  work (compact bias — Err on the SMALL side). SHARE SAGA: Android Chrome's Web Share file-type
  allowlist REFUSES .docx (canShare() lies true, share() throws) → final UX = 💾 Save as Word doc
  + 📤 Send as PDF (buildTeacherPdf: hand-rolled %PDF-1.4, letter, base-14 Helvetica/WinAnsi,
  uncompressed streams, block-based keep-together pagination; PDFs ARE share-allowlisted; desktop/
  refused-share falls back to saving). Headless quirk: blob-anchor downloads report
  suggestedFilename "download" — assertions must tolerate.
  TYPESET MATH (2026-08-02, user: "math notation that looks good in a document"): TEACHER_SYSTEM
  now REQUIRES $...$ math with a tiny LaTeX subset (\frac{a}{b}, ^{n}, _{n}, \sqrt{x}, \times \div
  \pi \le \ge \ne \pm, 90^{\circ}; fractions NEVER slashes; money = NOT math, bare $4.50). Client
  tMathParse/tMathSplit (farmgpt.html, shared by both builders) parse to nodes; a $span$ only
  counts as math if it has \cmd/^/_ or is a short symbol-y run — dollar amounts in word problems
  stay literal ("costs $4.50 and $2" never becomes math; rejected spans re-scan from the 2nd $).
  DOCX: real OMML (m:oMath/m:f/m:sSup/m:sSub/m:rad; xmlns:m on w:document) — Word/Google Docs
  render native stacked fractions. PDF: hand-typeset — stacked fractions w/ drawn bar (0.72×
  digits, axis y+0.30size), raised 0.66× superscripts, radical drawn as a line path, π≤≥≠ via
  base-14 SYMBOL font F3 (built-in encoding — do NOT add /WinAnsiEncoding), ×÷°± are WinAnsi;
  tokens wrap w/ math segs unbreakable+glued to adjacent text, frac lines get extra leading
  (tall flag). GOTCHAS: JS template literals EAT backslashes (\f=formfeed, \s dropped) — prompt
  source needs \\frac, and python embedded in a JS template must build backslashes via chr(92)/
  chr(960); PDF op font sizes need rounding (11*0.72 prints 7.920000000000001). Suites now
  server 36 + client 42 (OMML asserts, fraction-bar/radical path ops, Symbol font, money-literal
  both formats). Math rendering verified visually via pdf.js render of the built PDF.
  FORM-B STYLE PASS (2026-08-02, user brought a LaTeX-made sample: "better style especially the
  way it shows formulas"): (1) header = navy #233357 bold heading + chapter-topic SUBTITLE (text
  after ":" in q.chapter) + Name/Date/SCORE ___/N row over a navy rule; (2) per-question "section"
  field in the quiz JSON — consecutive questions sharing it print ONE italic textbook directive
  ("Add." / "Solve. Show your work.") and question text stops repeating instructions; (3) NEW math
  commands \\stack{641}{872}{+358} (vertical column arithmetic, rows right-aligned over an answer
  bar; docx = m:eqArr + figure-space \\u2007 padding + m:bar pos=bot on the last row) and
  \\longdiv{47}{3,170} (docx = divisor + ")" + m:bar pos=top vinculum; PDF draws both); (4) bold
  question-number prefix runs; (5) PDF gains F4 Helvetica-Oblique for the italic directives + rg/RG
  navy color ops + rule items; boolean "tall" leading replaced by MEASURED tPdfMathExtra {up,down}
  per line (stacks rise a full row per addend). Suites now server 39 · client 48. Regenerating a
  sample: scratchpad make_test.cjs + ch1_quiz.json drive the REAL page builders headless via
  route-mocks (the pattern for making a test by hand: write the quiz JSON, run make_test.cjs).
- GUARDRAILS TIGHTENED (2026-07-30, user): FAMILY_RULES — torture scenes are never written even
  if explicitly/repeatedly requested (redirects in-story like other restricted topics);
  interrogation OK (questioning/pressure/bluffing/wits) but zero violence, torture, or threats
  of physical harm; injuries/suffering MAY be described, just never graphically — no blood, no
  gore, no dwelling on wound detail (user iterated: first cut banned describing suffering
  entirely, softened same day). STORY_LOG_SUMMARY_SYSTEM flag list mirrors the additions
  (torture/deliberate cruelty, blood/gore, violent interrogation). kidstory (already bans all
  peril) + dungeon (deliberately unrestricted) untouched. Suites re-green 77/77 + 54/54.
- UI FIX BATCH (2026-07-09, index.html + games.html + farmgpt.html): (1) Farm Bank shows only the
  logged-in kid's account (renderFarmBank: a BANK_KID sees just their card; Dad sees all). (2) Work-
  order cards compacted (tighter .wo-top/.wo-meta/.wo-desc/.wo-actions padding + 34px thumb) to fit
  more per screen. (3) .sheet gets max-height:calc(100dvh-16px)+overflow-y:auto so the tall Edit-goat
  form scrolls instead of running off the top. (4) Goat-care "never logged" confusion FIXED: the care
  editor pre-filled TODAY when nothing was logged (toInputDate(at || Date.now())) — looked like a real
  date next to the tab's "Never logged"; now blank when at===0 (careAt/daysSince already treat 0 as
  never; no data bug). (5) PERSISTENT NAV: the index tab bar vanished on the FarmGPT/Games pages (they
  navigate away). Added a persistent #buckyNav to farmgpt.html + games.html; in-app tabs link to
  index.html#<key>, and DEEP_LINK_TABS expanded to every section key so those hashes open the right tab
  (was game/catgame/workorders/farmbank only). Fixes (1)-(4) + DEEP_LINK_TABS all landed in index.html
  while the PARALLEL UI-redesign session was copying index.html→redesign/index.html, so the flip-to-live
  CAPTURED THEM — they shipped inside the redesign commit d7336b5 and are LIVE (verified present:
  showKids 3300, .wo-top 283, .sheet max-height 520, care-blank 2374, DEEP_LINK_TABS 1009). Do NOT
  re-apply to index.html.
  NAV REDONE 2026-07-09 to match the redesign: the first pass was a 10-icon GREEN top row, but the live
  redesign replaced index's top row with a 5-AREA BOTTOM BAR (#bnav / NAV_GROUPS: Home/Tasks/Bank/Farm/
  Play) in the Old Glory navy/red palette. So the farmgpt/games #buckyNav was rebuilt as the SAME fixed
  bottom bar (5 areas, navy #233357 active on #e7eefb, frosted blur, icon+label), Play active on both
  pages (both live under the Play area; Play→games.html). Colors HARDCODED (not var-based) so each
  page's own tokens can't drift it. LAYOUT differs by page because their body layouts differ:
  · games.html (simple BLOCK flow, no bottom composer) → the bar is position:fixed + body padding-bottom
    calc(safe-area+78px). Fine — block containers honor padding-bottom for scroll.
  · farmgpt.html (full-height FLEX column: header + main flex:1 + composer) → the bar is an IN-FLOW flex
    child placed AFTER </main> (flex:0 0 auto), NOT fixed. main got overflow-y:auto so the story-setup
    view scrolls INSIDE main. WHY not fixed: a fixed bar covered the flex-pinned research composer AND
    the story-setup "Begin" button; padding-bottom on a flex SCROLL container is NOT honored at
    scroll-end (button stayed under the bar even at max scroll). As an in-flow last child the bar takes
    real layout space, main shrinks to fit, and content can never hide behind it. #toast lifted to
    bottom safe-area+84px so transient toasts float above the bar.
  Verified headless (scratchpad/navtest2.mjs, CDNs allowed): 25/25 — 5 areas + labels + Play-active +
  hrefs on both pages, bar at viewport bottom, farmgpt research composer AND story-setup Begin button
  both clear the bar (mainscroll.mjs: btn reachable at main max-scroll), games bar fixed, 0 pageerrors.
  Regression: clienttest 17/17 + storyloguitest 18/18 still green with the nav added. TEST GOTCHA:
  puppeteer page.goto to a hash-only-different URL is a same-document nav (no reload) so initialHashTab
  never re-reads — add a ?n=<nonce> to force a full load.
- ARCHITECTURE: static page → POST /.netlify/functions/farmgpt {secret, mode, messages}
  → function stamps the per-mode GUARDRAIL SYSTEM PROMPT server-side (browser can never
  override), streams the model's text back as plain chunks. Zero-dependency raw fetch +
  hand-parsed SSE (house convention, same as notify.mjs). Secret = the existing
  BUCKY_NOTIFY_SECRET / FAMILY_PASSWORD pair; NEW Netlify env var required:
  ANTHROPIC_API_KEY (function 500s with a clear message until set).
  ANTHROPIC_BASE_URL env override exists for testing against a fake server.
- GUARDRAILS (user spec, both modes share FAMILY_RULES): no swearing / graphic violence /
  sexual content; combat non-detailed ("he slew the dragon"), deaths OK but gentle;
  nothing political; nothing on gender identity / sexual orientation; restricted topics →
  story redirects in-story without lecturing, research suggests asking a parent/teacher.
- STORY MODE: first message = world+situation (setup screen w/ example chips); model must
  end every chapter with ===CHOICES=== + exactly 3 numbered choices (client parses into
  buttons; marker hidden during stream incl. partial-marker trim). Write-in input always
  available. thinking disabled (speed), max_tokens 1200. Bookshelf: localStorage
  farmgpt_stories_v1 (20 cap, resume/delete; resume with trailing user turn auto-continues).
- ENDLESS STORIES (2026-07-08, PUSHED ba3183d; top user complaint was the arbitrary
  ~8-15-chapter auto-ending). Two root causes fixed: the prompt told the model to "build toward
  an ending after 8-15 chapters", AND KEEP_TAIL_STORY=16 deleted the story's MIDDLE
  (head(2)+tail(16)) so it forgot the arc and wrapped up. TWO independent parts:
  (A) ENDINGS: prompt now says the story NEVER self-ends — always 3 fresh choices — and only
  writes ===THE END=== when the reader asks to finish. Kid-facing '🌙 Finish the story' button
  (#finishBtn, appears at ≥3 chapters, confirm → pushes a "wrap up now" user turn → finale).
  (B) MEMORY / FLAT COST via a DEDICATED SUMMARY CALL. NOTE: the first attempt (commit 6e63d6a)
  had the CHAPTER model emit an inline ===RECAP=== marker each turn — real-API testing showed it
  complied only ~HALF the time (stochastic, not caused by the recap-stripping; A/B-confirmed
  live), so story.recap often never set. REPLACED with MODES.summary (SUMMARY_SYSTEM, maxTokens
  400, thinking off) — a tiny single-purpose call whose only job is to compress the story so far
  into ≤180-word continuity notes, which it does reliably. Client: buildSendMessages() sends
  world-setup + story.recap folded into the head user turn as a "STORY SO FAR" note + last
  SEND_CHAPTERS=4 chapters verbatim (strippedForSend drops only ===ART===; windows once >4
  assistant msgs & a recap exists, else sends full). maybeSummarize() runs in the BACKGROUND
  after each chapter, folding new chapters into story.recap every SUMMARIZE_EVERY=3 (4≥3 so
  nothing leaves the verbatim window un-summarized); wrapped in try/catch — a failed summary
  keeps the prior note and never disrupts the story. story.recap + story.summarizedIdx persisted
  in the bookshelf. Per-chapter cost FLAT regardless of length (~9-msg sends at ch.9 or ch.90);
  summary calls add ~15-20%, bucketed under story ("s") in the usage dashboard. Server prompt has
  a CONTINUITY clause telling the model to treat the "STORY SO FAR" note as true past events.
  Verified vs the REAL API post-deploy: 6 chapters + 2 summary calls, coherent memory note
  stored, no auto-end, finish→THE END, no marker leak, 0 pageerrors. Tunable: SEND_CHAPTERS
  (verbatim depth), SUMMARIZE_EVERY (summary cadence).
- USAGE TRACKING v2 (2026-07-08): (1) summary calls now log to their OWN field prefix "u"
  (u_in/u_out/u_req/u_cw/u_cr) instead of being bucketed under story "s" — chapter vs recap cost
  is now separable; logUsage key = story→s, summary→u, research→r. (2) HOURLY granularity: every
  logUsage commit now increments BOTH the daily doc (farmgpt_usage/<date>) AND an hourly doc
  (farmgpt_usage_hourly/<YYYY-MM-DD-HH> Central via farmHour()) in ONE :commit (two writes, one
  network call). readCollection() shared mapper (usageRow) reads s/u/r × in/out/req/cw/cr;
  readHourly caps at 72 rows. mode:stats now returns {days, hours}. Dashboard: 3-way split
  (📖 Story chapters / 📝 Story recaps / 🔬 Research), rowCost() counts all three, daily table
  gained a 📝 column, new "🕐 Recent hours" table. NOTE hourly docs accumulate ~24/day forever
  (no TTL yet — fine for now, revisit if the collection grows huge). Old day docs pre-v2 read
  u_*=0 (summary cost is retro-mixed into their s_*, unavoidable).
- STORY TRANSCRIPT EXPORT (2026-07-08): '⬇ Export all' button on the bookshelf header
  (renderBookshelf) → exportStories() downloads a readable .txt of ALL saved stories on THIS
  device (storyToText strips ===CHOICES/RECAP/ART=== and the private recap notes; shows [The
  world], chapter prose, '➤ (You chose) …', '*** THE END ***'). IMPORTANT REALITY: stories live
  ONLY in per-device localStorage farmgpt_stories_v1 — there is NO server-side story store, so
  transcripts can't be pulled centrally/server-side; each device exports its own. Verified
  headless (createObjectURL hook): 2 stories, titles/world/chapters/choices/THE END present, no
  markers or recap notes leaked, 0 pageerrors.
- STORY DAILY CAP + LONGER CHAPTERS + HOME CAMERA→RESEARCH + RING FIX (2026-07-09, user: story
  time "getting too much use"): (1) DAILY CAP — server-enforced (kids can't bypass): on mode
  "story" requests (not research/summary), before calling the model, countStoryToday(user) runs a
  Firestore structuredQuery (:runQuery, two EQUALITY filters on date+user against
  farmgpt_story_log — no composite index needed) counting today's logged scenes; at/over
  STORY_DAILY_CAP=30 the function returns 200 + JSON {capped:true, message} WITHOUT ever calling
  the model (never a scary error). Dad and any unnamed session pass through uncapped (same
  condition logStoryReq already used to skip logging them — nothing new to count). Fails OPEN: a
  runQuery failure (network/auth/infra) returns null and the request proceeds normally — the cap
  must never break story time. Mirrored client-side (farmgpt.html) as a cheap pre-check +
  UX: localStorage farmgpt_story_count_v1 = {day (Central, en-CA format — matches the server's
  farmDate()), user, count}, bumped after each successful scene; guardStoryCap() short-circuits
  beginBtn/takeTurn/nextChapterBtn/resume-continue before ever hitting the network once local
  count hits 30, resets automatically on a new Central day (day mismatch = fresh state). If the
  server disagrees (says capped when the local counter didn't), callFarmGPT detects the JSON
  {capped:true} response (vs the normal text/plain stream) via content-type, throws a tagged
  err.capped, and streamChapter's catch syncs the local counter up to 30. UI: new #storyCappedRow
  ("📚 Wow, you've read a LOT today! … come back tomorrow…") replaces choices+write-in
  (setStoryControls computes `capped` and it wins over chapterEnd); shelving (doShelveStory,
  shared by #shelveBtn/#shelveCappedBtn) and the whole bookshelf stay fully usable. Research mode
  untouched. (2) CHAPTER LENGTH raised for an average ~3500 words/chapter (was ~1600):
  CHAPTER_SOFT_WORDS 1400→2800, CHAPTER_HARD_WORDS 2200→4200 (client word-count window that
  decides when to ask the model to close a chapter — chapters are still built from several ~900-
  word scenes since server maxTokens for story stays 1200). STORY_SYSTEM gained a line asking for
  full, unhurried, multi-paragraph scenes so length comes from richer scenes, not just more of
  them; also found (and fixed) that the model COULD self-close a chapter by emitting
  ===CHAPTER END=== unprompted (parseChapter honors the marker wherever it appears) — added an
  explicit "never write ===CHAPTER END=== unless a message explicitly instructs you to close the
  chapter right now" line to STORY_SYSTEM. (3) HOME CAMERA→RESEARCH: index.html's Home ask bar
  (.askbar) 🔬 icon replaced with a tappable 📷 button (.askcam, aria-label "Snap a photo for
  research") wired to a hidden <input type=file accept="image/*" capture="environment"> — picking
  a photo reuses resizeImage(file,1280,cb) (same helper the goat/work-order photo pickers use) to
  downscale to a JPEG dataURL, stashes it in sessionStorage["farmgpt_ask_photo"], then navigates
  to farmgpt.html?ask=<typed text>&photo=1. farmgpt.html's handleAskParam() extended: on photo=1
  it pops (reads + removes) that sessionStorage key, opens Research, and sends it through the
  SAME research photo pathway as the in-app 📷 attach flow (image content block + scaleToJpeg
  thumb via submitResearch) — text defaults to "Can you help me with this?" when nothing was
  typed. URL cleaned via replaceState either way so a refresh never re-asks/re-sends. Typed-text-
  only submits (no photo) are unchanged. Story cap does not apply to research. (4) RING CENTERING:
  .home2 .ring .val had been switched to display:flex;align-items:baseline (to get the "3/6"
  numerator+denominator on one baseline) which broke vertical centering inside the absolutely-
  positioned inset:0 box. Fixed by splitting the concerns: outer .val back to
  display:grid;place-items:center (true 2-axis centering) wrapping a new inner <span> that does
  display:flex;align-items:baseline (renderDashboard's hero template now emits
  `<span>${done}<small>/${total}</small></span>` inside .val). TESTS (scratchpad, new
  sessions must recreate the fake-service pattern — none of this hits real
  Anthropic/Firestore): p13_server.mjs (in-process farmgpt.mjs harness — fake Google
  token/Firestore/Anthropic http servers; 20/20: under-cap allowed, capped at 30 blocks the model,
  29 still allowed, query-failure fails open, research/summary unaffected, Dad/no-name pass
  through, runQuery filter shape, STORY_SYSTEM source checks), p13_client.mjs (playwright,
  farmgpt.html served over local http — file:// pages can't fetch() a root-relative path at all,
  so route-mocked fetch tests need a real scheme; 31/31: normal flow, local pre-cap blocks Begin
  with a toast, mid-story local cap replaces choices/composer while bookshelf stays usable
  (shelve+resume), server-side capped response syncs the local counter, stale-day rollover, research
  unaffected, raised word constants), p13_camera_ring.mjs (playwright, index.html + farmgpt.html
  both served over the same local http origin — file:// throws SecurityError on session/
  localStorage, and an ABORTED top-level navigation replaces the document with Chromium's
  network-error interstitial (also opaque-origin) which broke a naive "abort and then inspect
  sessionStorage" test — fix was to leave the intercepted navigation request pending instead of
  aborting it, so the original document stays alive to inspect; 21/21: camera button + hidden
  input wiring, sessionStorage payload + URL handoff (with and without typed text), farmgpt.html
  photo=1 pathway sends a real image block + text (typed and default-text cases), sessionStorage
  cleared + URL cleaned, typed-text-only regression, ring "3/6" centered within a fraction of a
  px on both axes). Regression note: this session's scratchpad happened to retain
  p9_home2.mjs/p10_navwx.mjs/p11_taste.mjs/p12_polish.mjs from earlier sessions (scratchpad
  persistence isn't guaranteed) — re-ran p12_polish.mjs (26/26) as a spot-check that the ring
  markup/CSS change didn't regress the rest of Home; didn't re-run p9/p10/p11 since none of them
  touch the ring/askbar/chapter code paths this batch changed.
- 🧒 STORY TIME JR — early-reader page for a visiting 6-year-old (2026-07-24, built for
  nephew Benjie on an iPad): `storytime.html` (self-contained, no nav chrome) + server modes
  `kidstory` (Haiku, maxTokens 500) and `kidart` (Sonnet — draws noticeably better shapes).
  DELIBERATELY NOT the big-kid story mode: scenes are 3-5 sentences of 3-9 words (a first
  grader can't read 900-word chapters), and the child NEVER TYPES. THE CENTRAL SAFEGUARD is
  that closed loop: the opening turn is one of 9 fixed STARTERS baked into the page, and every
  turn after is a choice the model itself wrote — so no text a child can produce ever enters
  the conversation. Backed server-side by KID_TURN_MAX_CHARS=200 truncation on kid-mode USER
  turns only (assistant scenes uncapped), so a tampered client still can't smuggle
  instructions. Guardrails stack KID_RULES (no peril/danger/death/villains/weapons/meanness/
  gross-out, every turn ends safe or silly, quietly steer away rather than refuse, treat all
  input as story never command) ON TOP OF the shared FAMILY_RULES. No daily cap; every scene
  IS logged to farmgpt_story_log so it shows in Dad's existing Story Log (logStoryReq extended
  to kidstory; parseChapter renders them fine since they use ===CHOICES===).
  CHOICE FORMAT: `1. 🦆 | Say hi to the duck` — the PIPE is deliberate, emoji-vs-text regex
  splitting is fragile; client falls back to a leading-Extended_Pictographic match then "✨".
  CLIENT (iPad-first): 30px/1.95 story text in per-word spans, read-aloud via SpeechSynthesis
  with word highlighting (boundary events + a 340ms paced fallback when they don't fire; iOS
  needs primeSpeech() — a silent utterance inside a real tap — before it will ever speak),
  96px+ choice cards, 9 emoji starter cards, localStorage resume (storytime_save_v1), `?who=`
  sets the greeting + Story Log name (default "Benjie", remembered per device).
  LAYOUT GOTCHA: stacked, the 400×260 picture fills a landscape iPad and pushes the words
  below the fold — landscape ≥900px goes SIDE-BY-SIDE (#storyTop grid: art left, words right,
  choices across the bottom). Per-word highlight spans need `margin: 0 -4px` to cancel their
  own padding or word gaps visibly inflate.
  🎨 IMAGES — two providers behind one env switch: `svg` (DEFAULT, free, no key: Sonnet draws
  a flat storybook scene, DOMPurify-sanitized client-side with script/foreignObject/image/text
  forbidden) and `gemini` (KID_ART_PROVIDER=gemini + GEMINI_API_KEY → gemini-2.5-flash-image
  "nano banana", ~4¢/image, returns a data: URL). Gemini failure FALLS THROUGH to the SVG
  drawing so a picture always appears. NOTE generativelanguage.googleapis.com IS reachable
  from the sandbox (unlike Anthropic/Yahoo) — verified with a real API-key-invalid response —
  so the image path can be live-probed with a key. Usage splits into TWO buckets since they
  bill differently: k_* kid text (Haiku) + a_* drawings (Sonnet) + g_* GENERATED IMAGES
  (counted, priced flat ~$0.039 each in the dashboard — per-image not per-token); rows 🧒/🎨/🖼.
  DIAGNOSTIC: mode `kidart_status` → {provider,hasGeminiKey,model,live} (no image, no cost) and
  `storytime.html?art=1` shows it as a banner — the gemini path falls back to a drawing SILENTLY,
  so without this there's no way to tell a configured setup from a quietly-broken one.
  TO TURN GENERATED IMAGES ON: Netlify env KID_ART_PROVIDER=gemini + GEMINI_API_KEY, redeploy.
  VERIFY: `node tools/_verify-kidstory-server.mjs` (36: model/budget, KID_RULES+FAMILY_RULES
  both stamped, 200-char user cap w/ assistant uncapped, no-cap + logging, k_*/a_* buckets,
  svg vs gemini provider incl. failure fallback + prompt content, story/research untouched)
  + scratchpad kidstory_client_test.mjs (37: zero text inputs anywhere ×2 screens, 30px text,
  choice parsing/size, exact wire payload, hostile-SVG neutered, resume, portrait+landscape
  fit). NOT live-tested vs real Haiku/Sonnet (env blocks Anthropic) — after deploy check
  reading level, exactly-3 piped choices, and drawing quality; if SVG art disappoints, flip
  KID_ART_PROVIDER=gemini. Page is intentionally UNLINKED from the family nav — bookmark
  storytime.html to the iPad home screen (apple-mobile-web-app-capable = opens fullscreen).
- 🎲 DUNGEON MODE (2026-07-23, Dad-only D&D 5e DM): `dungeon.html` (self-contained page, linked
  Dad-only from the FarmGPT home next to Story Log) + modes `dnd`/`dnd_update`/`dnd_summary` +
  storage actions `dnd_list/get/save/delete` in farmgpt.mjs. Sonnet 5 (RESEARCH_MODEL), adaptive
  thinking, maxTokens 3000. DELIBERATE DIFFERENCES from story mode (user spec): NO FAMILY_RULES
  appended (stock Sonnet only), NO daily cap, NO story-log capture. Because guardrails are off,
  this is the app's ONE hard server-side gate: every dnd* request carries Dad's RAW PIN
  (`dndPin`, typed per page-load, kept in memory + tab sessionStorage only, NEVER localStorage —
  the synced pinHash is public-ish so hash-as-credential would be replayable by any kid device);
  server sha256(pin+":"+secret)-compares vs settings_<fam>/dadAuth.pinHash (familyKeyFromSecret
  mirrors index.html roomId; 10-min warm cache; 8 wrong tries/10min = brake) and FAILS CLOSED.
  DM contract in DND_SYSTEM: absolute player agency (never act/speak for the PC), RAW 5e 2014,
  module fidelity, and REAL DICE — model may never invent a roll; it ends replies with
  `===ROLL=== dice|player-or-dm|label` lines, the page rolls crypto-random (adv/dis = d20adv/
  d20dis notation), player rolls tap-to-roll / dm rolls auto-roll openly, results auto-send as a
  `[ROLLS] …` user turn the prompt treats as authoritative. STATE: character sheet (JSON) +
  campaign journal appended client-side to the FINAL user turn only (older history stays
  byte-stable for the prompt cache); sheet updated after each DM turn by a dedicated `dnd_update`
  bookkeeper call (inline-marker state proved unreliable in the recap saga — dedicated calls
  only), journal folded by `dnd_summary` when >24 unsummarized turns; Dad can edit the sheet
  JSON directly (source of truth) + quick HP ± buttons. STORAGE: Firestore `farmgpt_dnd` via the
  function — campaign doc c_<id> (kind, name, charName, sheet, journal, turns tail ≤80,
  moduleShards, updatedAt) + module shards m_<id>_<n> (≤400k chars each, module ≤600k, pasted or
  .txt at campaign creation; module rides in the system prompt every dnd turn → cached re-reads).
  No sheet at creation → DM runs session zero. MODULE PDFs (2026-07-23): picker accepts .pdf —
  text-layer PDFs extract client-side via VENDORED pdf.js (assets/pdfjs/, pdfjs-dist 3.11.174,
  lazy-loaded on pick; "----- page N -----" markers so the DM honors page refs; 600k cap);
  SCANNED/photocopy PDFs (no text layer, detected <200 chars over >2 pages) offer "🔍 Read it
  with AI" → mode `dnd_ocr` (Sonnet vision, PIN-gated, 1 page-JPEG per request ≤1568px q0.82,
  3 in flight, 2 attempts/page, cancel keeps finished pages, ~1-2¢/page one-time). Usage logs
  under NEW `d_*` prefix (dashboard: 🎲 row + column, priced at Sonnet). VERIFY:
  `node tools/_verify-dnd-server.mjs` (47 checks:
  PIN fail-closed/brake, no-FAMILY_RULES + Sonnet + module injection asserts, no-cap/no-log,
  d_* usage, storage round-trip incl. shard preservation on module-less re-save, story/research
  regression — rules still stamped, cap still fires, scenes still logged). Client suite (35
  checks, playwright) in session scratchpad `dnd_client_test.mjs` (gate/create/dice/sheet/
  persistence/mobile). NOT yet live-tested vs real Sonnet (env can't reach the API) — after
  deploy, spot-check: never-acts-for-player, ===ROLL=== adherence, sheet extraction, module
  fidelity. Netlify request-body limits cap a pasted module ~a few MB (600k chars is fine).
- PARENT RESEARCH MODE (2026-08-01, user): research requests now carry `user` (choreUser) and
  EXACTLY "Dad"/"Mom" get PARENT_RESEARCH_SYSTEM — direct answers, full ANSWER KEYS for pasted/
  photographed worksheets (numbered, bold finals, one-line justifications), grade-a-kid's-work
  checks; tutor restrictions absent; FAMILY_RULES + LaTeX/Markdown + ===ANSWERS=== protocol
  kept; maxTokens unchanged. Everyone else (kids, "dad", "Dad ( :", missing) keeps the tutor
  prompt (PARENT_RESEARCH_USERS exact-match — same soft-identity posture as the story cap's Dad
  exemption; no PIN check server-side). Verify: tools/_verify-parent-research.mjs (25) +
  scratchpad parent_research_client.cjs (4, wire carries user).
- RESEARCH MODE: teen homework+coding chat; markdown via marked+DOMPurify CDN; adaptive
  thinking (default) w/ "Thinking…" indicator, max_tokens 4096; localStorage
  farmgpt_research_v1 (50 msgs; user msg saved BEFORE the reply streams so a mid-stream
  close keeps the exchange).
- Server-side caps: ≤60 messages, ≤12k chars each, long convos trimmed head(2)+tail(40)
  re-aligned to a user turn. Refusal stop w/ no text → friendly stand-in line.
- games.html: 🌾 FarmGPT tile added.
- Verified E2E headless (REAL function handler in-process + fake Anthropic SSE server):
  401/400 paths, progressive streaming, choices parse, THE END, bookshelf resume,
  research markdown+persist+clear, request shape (model/stream/thinking/guardrails),
  mobile 375px layout. 0 pageerrors. NOT yet tested against the real API (needs
  ANTHROPIC_API_KEY in Netlify) — set env var, redeploy, then live-test both modes.
- MATH RENDERING (2026-07-07, user report: raw $$ formulas): research mode typesets
  LaTeX via KaTeX CDN (auto-render). mdToHtml STASHES math segments ($$..$$, [..],
  (..), $..$) behind ❢N❢ placeholders BEFORE marked.parse (else underscores in
  subscripts become <em>), restores them HTML-escaped after DOMPurify, then
  renderMathInElement typesets in-DOM (throwOnError:false). System prompt now tells the
  model to always write LaTeX math. Verified: display+inline math typeset, no raw $$,
  subscripts un-mangled.
- TUTOR POLICY (2026-07-07, user: learn the material, don't do their homework):
  RESEARCH_SYSTEM rewritten around "concepts are free, their assignment is theirs".
  Tutor moves: parallel example w/ different numbers then hand theirs back ·
  invite/diagnose their attempt (never present the corrected version) · graduated
  hints (never flat refusal, never answer on first ask) · holds the line warmly
  under "just give me the answer" pressure (never caves) · writing = outline/
  brainstorm/feedback only, never submittable prose · ends with a now-you-try.
  CODING: only on explicitly coding questions (never volunteered elsewhere);
  concept snippets fine, build-X assignments get skeletons/TODOs not programs,
  debugging points at the bug. Live-probed all 5 behaviors on deployed Sonnet 5:
  solve-for-me → method on a different quadratic + hands it back (roots never
  given, even under pressure); essay request → outline coaching; no code on a
  math question; concept questions still fully taught.
- USAGE TRACKING (2026-07-07, user request): every reply exact token counts (SSE
  message_start input_tokens / message_delta usage.output_tokens) are aggregated into ONE
  Firestore doc per day - farmgpt_usage/<YYYY-MM-DD America/Chicago>, per-mode increment
  fields s_in/s_out/s_req + r_in/r_out/r_req via documents:commit fieldTransforms
  (creates-if-missing; no per-request docs, storage stays ~1 doc/day). Auth reuses
  FIREBASE_SERVICE_ACCOUNT w/ hand-signed JWT (notify.mjs technique), token cached across
  warm invocations; logging awaited in the stream finally (lambda stays alive) and can
  NEVER break a reply. mode:stats returns the day docs (secret-gated). Page: 📊 API
  usage link on FarmGPT home -> month estimate + all-time, story/research split, 21-day
  table; cost estimated at Sonnet 5 list price (USD 3 in / 15 out per MTok; labeled
  estimate, may read high vs intro pricing). Test env overrides: FARMGPT_FIRESTORE_BASE +
  FARMGPT_GOOGLE_TOKEN_URL (harness fakes Google token + Firestore commit/list with a
  generated RSA key). Verified: increments exact (3 story + 1 research -> 369/150/123/50),
  dashboard renders, stats 200.
- PROMPT CACHING (2026-07-07, PUSHED 948c9b5; user cost concern: $0.71/29 story reqs —
  the growing story history was re-sent at full input price every chapter): top-level
  cache_control ephemeral on the API request (auto-places on the last cacheable block;
  system+history re-read at 0.1x within the 5-min TTL; prefixes <2048 tokens silently
  skip caching on Sonnet 5 — fine, kicks in a few chapters deep). Usage tracking also
  logs cache tokens (s_cw/s_cr + r_cw/r_cr daily increments; legacy docs read 0) and
  the dashboard prices them (writes 1.25x in-rate, reads 0.1x) + "cached 💰" split line.
  DECISIONS: Max subscription can NOT fund API calls (asked 2026-07-07) — FarmGPT stays
  on Console pay-as-you-go; both modes stay on Sonnet 5 (Haiku-for-story offered,
  declined). Verified: real handler in-process vs fake Anthropic SSE + fake Firestore,
  7/7 (cache_control on wire, cache tokens committed, stats returns new fields).
- [x] SOLO COMPACT KITCHEN + AUTO-WORK (2026-07-07, user: solo layout too large, nobody to
      throw to): LEVEL 1 played ALONE (1 chef at hostStartLevel — no couch P2, no guest)
      runs on a 10×8 grid (same width, HALF the depth). Kitchen depth is now DYNAMIC:
      FLOOR_D/HALF_D/INNER_Z are lets switched by setKitchenDepth() inside
      rebuildKitchenForLevel(levelId, compact); COUNTER_TILES regenerates in place; the
      render layer gained rebuildKitchenGeometryVisuals() = rebuildFloorMeshes +
      rebuildCounterTileMeshes (per-tile materials disposed) + rebuildSlotLayer (slot
      groups + slotTileMesh, now a let); fitCamera far-wall depth reads live HALF_D (the
      SCENE_HALF_D const remains only for boot-time ground/decor sizing). Every runtime
      HALF_D consumer (moveChef clamps, throw bounces, landing clamps, field ring,
      exterior checks, lob exit) adapts automatically. layoutCellToXZ maps r===FLOOR_D as
      the bottom row / z = r-(HALF_D+0.5). SOLO_L1_LAYOUT_ENTRIES: crates across the top
      (lettuce c3, onion c4, potato c5, tomato c7), board c3 + trash c4 + board c6 +
      sink c8 across the bottom, patty/stove/oven/plates down the left, dough/pan/cheese/
      bun/dirtyBin down the right (17 entries, all required stations present; inactive =
      plain counters). Solo spawn: center-bottom (z = HALF_D-CT-1).
      AUTO-WORK (compact only): an item that arrived at a cut/wash station BY THROW works
      itself at 50% of player speed — thrown raw+choppable onto a board sets board.auto
      (cleared on any HAND placement + on completion); thrown dirty plate parking at the
      sink bumps G.sink.autoQueue (manual scrubs clamp it to parked). advanceAutoWork(dt)
      in hostSim ticks boards (skipped while board.manualHold>0, set each frame the player
      holds WORK — player = normal speed, never additive) and the sink (skipped while
      washingChef set; completion parked--/autoQueue--/clean++). Progress bars render via
      the existing fields untouched.
      MP: G.compact synced in snapshots; guest applySnapshot rebuilds on compact change
      (same path as level change, before cs applies); a guest joining mid-compact makes
      hostAssignSeat RESTART the current level on the full grid (or quietly swap back if
      on level-select/day-end). Verified headless: compact 8/32 tiles + camera 28.6→18.6,
      all ACTIVE stations self-resolve (inactive→neighbor/slot is by design), thrown
      tomato auto-chops in 3s, manual chop 0.5 progress @0.75s (normal, not stacked),
      thrown dirty plate auto-washes (parked/queue/clean exact), hand-placed never autos,
      L2 solo + L1 couch stay full 16/48, L1 solo returns compact, real V-lob salad from
      center = +35 served. 0 pageerrors. PUSHED 94f72bf.
- [x] SOLO TUNING (2026-07-07, user playtest): auto-work 50% -> 25% of player speed (chop
      ~6s, wash ~8s alone). Solo layout wash loop now faces itself ACROSS the kitchen:
      sink LEFT r5 (x -4.5, z 0.5) directly opposite dirtyBin RIGHT r5 (x 4.5, z 0.5) —
      grab dirty plate at the bin, throw it clean across to the sink; oven took the sink
      old bottom c8 tile, cheese/bun shifted down the right wall. Compact spawns 30%
      faster (spawnFactor × 0.7). BUGFIX exposed by the new loop: resolveIngredientLanding
      now takes the flight dir and DROPS candidates BEHIND the throw (dot < -0.35 vs the
      launch-relative anchor) — without it, throwing a dirty plate from beside the bin
      re-absorbed it into the bin on the first flight step (and a raw ingredient thrown
      from beside its own crate went straight back in the box). Both call sites (flight +
      aim preview) pass dir. Verified: cross-kitchen dirty-plate throw parks at the sink,
      auto rates measured at 25%, manual override still exactly 1x, full regression suite
      green. PUSHED 94f72bf.
- [x] SOLO MODE ALL LEVELS + PLATE RECOVERY (2026-07-07, user): G.compact now = solo on ANY
      level (was L1-only). SOLO_LAYOUT_ENTRIES = per-level 10×8 maps designed around the
      THROW-ACROSS principle (sink LEFT always directly opposite dirtyBin RIGHT):
      L2 Soup ping-pong — veg TOP → boards BOTTOM → chopped thrown back UP to the pot
      (stove top c8); L3 Burger signature cross — patty crate L r2 directly opposite the
      pan R r2 (throw the patty clean across to the grill), veg top → boards bottom;
      L4 Pizza — dough/tomato/cheese top → boards bottom, oven bottom c8 beside the
      boards (pizzaBase is not throwable → short carry); L5 Feast — all active, veg+dough
      top, patty L2↔pan R2 AND stove L3↔oven R3 face-offs. All 17 entries/level, all
      required stations present. Verified per level: compact 8-deep, sink↔bin opposite,
      every ACTIVE station self-resolves (L5: 0 fails with everything active), L3 patty
      cross-throw lands in the pan cooking, L2 chopped tomato throw lands in the pot.
      PLATE RECOVERY (user: lobbing dishes out = fail state): hostResolveClaims now uses
      PLATE_RECOVERY_TTL=3s for any exterior item WITHOUT a completed dish (empty/partial
      plates, stray ingredients) — and the crow return includes kind dirtyPlate (was
      plate-only: a lobbed dirty plate was PERMANENTLY lost → soft-lock with all 3 out).
      Completed dishes keep the 5s claimable crow TTL. Verified: dirtyPlate + empty +
      partial plate lobbed outside all back in dirtyQueue ~4s later. PUSHED 94f72bf.
- [x] CHEF BUCKY — first fully in-house Blender chef (2026-07-07, user request): modeled,
      rigged AND animated from scratch via the Blender MCP bridge (official Blender Lab
      MCP addon, installed via CLI: lab repo zip -> extension install-file -> enable +
      use_autostart; server localhost:9876, works whenever Blender is open). SOURCE OF
      TRUTH: assets/blender/chefbucky.blend (186KB) — 29-part chunky low-poly upright
      goat mascot chef (brown fur, toque, apron, blaze, droopy ears, horn nubs, beard),
      faces -Y in Blender = +Z in glTF. Rig: 7 deform bones (Hips/Chest/Head/LeftArm/
      RightArm/LeftLeg/RightLeg — Left/RightArm names are what buildChefGLB carry-pose
      regex needs) + 3 LEAF bones (feet + HeadTop) added because the game scales chefs by
      the JOINT-ORIGIN bounding box (computeBoneWorldBox) — without leaves the 7 origins
      spanned 0.58-1.22 and scaleTo came out 2.34 (giant chef); with leaves 0.04-1.58 ->
      0.974. Skinning: RIGID per part (each object vertex-grouped 100% to one bone before
      join — no auto-weight bleed; bevel modifiers applied pre-join since join discards
      them). Anims hand-keyed at 24fps as 5 Blender actions (idle 48f breathe/sway, walk
      16f, run 12f + lean, chop 14f raise-slam loop, throw 18f windup-snap-follow); sign
      conventions: -X = forward swing, empty-dict frames are SKIPPED by the keyframe
      helper (idle loop-close needed explicit neutral keys). Export: glTF ACTIONS mode ->
      one GLB -> gltf-transform split into chef-bucky.glb (419KB) + 5 MESH-LESS clip GLBs
      (~19KB each, Tinker pattern). Game: GLB_CHEF_IDS + picker card 🐐 Chef Bucky (5th).
      Fur brightened at the source (dark under kitchen lights, same as Tinker lesson).
      Verified in-game headless: picker, GLB-backed, idle/run/chop/throw via real keys,
      carry pose, scale 0.974. 0 pageerrors. PUSHED 94f72bf.
- [x] CARRY ANIM + ARM-STOMP FIX (2026-07-07): Blender "carry" clip (16f walk cycle,
      arms locked in a world-space-solved tray pose euler (-72,±0.6,±0.8), f1 =
      passing pose) -> chef-bucky-carry.glb (mesh-less). Game: optional per-model
      6th clip via GLB_CHEF_EXTRA_CLIPS; holding+moving+a.carry -> animState "carry"
      (run timeScale rules); heldSlot raised to (0,0.80,0.42) so items rest ON the
      outstretched hands. CRITICAL FIX found during wiring: the hold-pose blend wrote
      bone.rotation.x every frame, which rebuilds the quaternion from STALE euler y/z
      and silently FROZE all GLB chefs' arm animation in-game — now a post-mixer
      additive quaternion delta applied only while blend>0.01 (verified: arm quat
      delta 1.73/frame mid-chop vs 0 before).
- [x] NEW 3-CHARACTER CAST (2026-07-07, PUSHED 94f72bf): Otis 🐶 (white golden
      retriever: cream fur, blue band/belt, floppy hanging ears — goat ears rotated
      72° about an inner-top pivot — fluffy tail, black nose) and Boots 🐱 (grey cat:
      WHITE paws/feet, pink nose, brick-red band, new 4-vert-cone pointy ears, long
      thin upturned tail) — both dissected from the ChefBucky mesh via loose-part
      separation (identify parts by material+bbox center; horns/beard deleted) and
      REJOINED ON THE SAME ChefBuckyRig in assets/blender/chefbucky.blend. Shared
      skeleton = shared clips: chef-otis.glb / chef-boots.glb are BASE-ONLY (361KB);
      all 6 clips load from chef-bucky-*.glb via GLB_CHEF_CLIP_SRC — new rig anims
      automatically work for the whole cast. Picker = exactly bucky/otis/boots; old
      chefs (farmer/grandma/kid/steampunk Tinker) REMOVED incl all 24 Meshy GLBs
      (~30MB, in git history); default/legacy chefModel ids -> bucky; couch P2
      default otis. GOTCHAS: Blender MCP render_viewport_to_path renders from the
      scene CAMERA and ignores hide_set/hide_viewport (use hide_render or move
      objects apart — overlapping chars z-fight into a chimera that reads as wrong
      materials); .blend1 backups must not be committed; export with everyone at
      the origin (export_apply bakes object transforms).
- [x] HOME POLISH + DAD JOKES V2 (2026-07-07, PUSHED 59f83e7): dashboard tiles
      2-col cards -> compact 3x3 grid (42px icon circles, descs hidden <560px);
      greeting + joke card tightened. FIT GUARANTEE: on 375x812 the greeting,
      all 9 section tiles, AND the full dad-joke card are visible with zero
      scrolling (joke bottom 620/812; desktop 1280x800 also fits w/ descs).
      Folded in the parallel session's work: assets/dadjokes.js 723-joke DB
      (window.DAD_JOKES + inline fallback, joke-of-day keyed to date, ➜ bonus
      jokes), pill-style scrollable top tab bar, header gradient, FarmGPT
      no-auto-scroll-while-streaming. TEST GOTCHA: headless index.html tests
      with choreUnlocked+choreUser hit PRODUCTION Firestore (notification
      toasts bury the layout) — block googleapis/firestore requests for
      deterministic offline shots ("using this phone only" mode).
- [x] ONE-ROW TAB BAR (2026-07-07, PUSHED 4d20720): index.html tabs = single fixed
      row of 10 equal-width icon-only buttons (flex 1 1 0; labels -> tooltips/aria;
      scrollIntoView centering removed). No horizontal scroll at any width.
- [x] RESEARCH FOLLOW-UPS + MC PRACTICE (2026-07-07, PUSHED d4d1d1e): every research
      answer ends in tappable next moves — chips 📚 More examples / ✏️ Practice
      problems / ➡️ Next step (write-in always available). Practice = ALWAYS
      multiple choice: server prompt protocol ===ANSWERS=== + 4 "A) opt" lines
      (mirrors story's ===CHOICES===), client parses to A-D tap buttons (KaTeX
      typeset labels; tap sends "My answer: B) ..."), marker hidden incl. partial
      mid-stream; actions restored on reload + after failed requests. RAW reply
      (with marker) stays in researchMsgs so the model sees its own protocol.
      Verified E2E vs real handler + fake Anthropic SSE. Live Sonnet 5 protocol
      adherence still to be spot-checked post-deploy ("give me a practice problem").
- [x] MC WRONG-ANSWER REWORK + ENDLESS REBALANCE (2026-07-07, PUSHED a5d2d05):
      research practice problems — wrong answer now = reveal the correct option +
      explain why + the picked distractor's mistake, then a NEW same-concept
      problem (different numbers) with fresh ===ANSWERS=== buttons in the SAME
      message (the same-problem-retry design + 🔁 Answer choices fallback chip
      were removed — didn't land in live testing). Endless Rush all levels:
      endlessSpawnInterval = max(5, 20*0.5^(t/180)) (was max(2.5, 18*0.5^(t/90)))
      and endlessMaxWaiting = min(7, 3+floor(t/90)) (was min(8, 3+floor(t/45)))
      — peak pressure halved and ~3x later; user asked for "a good bit" easier
      with a smoother ramp.
- [x] GOAT RECORD FIELDS (2026-07-07, PUSHED 1805d41, first sonnet-delegated task):
      Goats tab adds breed (datalist: Nigerian Dwarf / Mini LaMancha), regnum
      ("Registration #"), horns (select Disbudded/Horned/Polled), freshenings
      (number) — editable in the goat sheet, detail shows breed always + others
      when set. goatBreed(g) name-fallback (Archie/Graffi/Steffi/Oakley/Annie/
      Peyton -> Mini LaMancha, else Nigerian Dwarf) covers the LIVE Firestore
      herd; BUCKY_SEED backfilled via JSON transform. Also fixed pre-existing
      bug: #goatOverlay now z-index 41 (edit sheet used to open UNDER the
      detail overlay -> Save unclickable from the detail-view Edit path).
      DELEGATION LESSONS (policy re-enabled 2026-07-07, see memory): sonnet
      agents may hallucinate "I've launched a background agent" and stop after
      1 tool call (can chain!) — every delegation prompt needs an explicit
      "do ALL work yourself with Read/Edit/Bash; do NOT use the Agent tool"
      ground rule, and check `git diff --stat` on every completion before
      trusting the report. index.html's script is type="module" — headless
      tests must drive real DOM clicks (page.evaluate can't reach module
      globals), which is also what catches paint/stacking bugs.
- [x] HERD DUPLICATION incident + fix (2026-07-07, PUSHED 825106c): 34 goat dupes
      (+1 resurrected "Raspberry") appeared 2026-07-06 18:33Z — root cause: the
      cloud backend's one-time seeding ran on an EMPTY fromCache first snapshot
      (fresh device/test browser, cold cache) and addDoc'd the seed herd into
      the LIVE chores_fam2jan2g (write died mid-flight: 35 of 42 items landed,
      no starter chores). FIX: seeding requires !snap.metadata.fromCache.
      CLEANUP: 34 pristine seed copies (no photo/care) deleted via Firestore
      REST DELETE w/ the web API key (rules are public); originals untouched;
      user chose to KEEP Raspberry (previously deleted, now a bare record).
      LESSON: any headless test that lets index.html reach production Firestore
      with a fresh profile can trigger first-launch paths — ALWAYS block
      /googleapis|firestore|firebase|gstatic/ in test browsers (gstatic serves
      the SDK). Firestore REST audit one-liner lives in this session's
      transcript; familyKey = roomId("amenfarms") = fam2jan2g.
- [x] HERD DUPLICATION RECURRENCE + hardening (2026-07-09): 36 goat dupes + 2 daily
      chores ("Feed the goats"/"Collect eggs") re-appeared in ONE burst 2026-07-08
      00:50Z (BEFORE that day's redesign push — unrelated to it). All bare seed copies
      (no photo/care) matching BUCKY_SEED; the 06-29 originals (photos+care) survived
      underneath. The batch = seed items {1,2,7-42} (2 chores + all 36 goats, skipping
      chores 3-6) = the same partial-concurrent-write signature as the 07-06 incident,
      i.e. a re-seed/herd-load path fired against the live DB. The 07-06 fromCache guard
      only closed ONE door; TWO re-seed paths remained: (a) the cloud auto-seed looped 42
      NON-awaited addDocs (partial-write prone); (b) the "Load the goat herd" button
      (importHerd) dumps the WHOLE herd if tapped while the in-memory list is empty (fresh
      device / a headless test hitting production before sync — there ARE un-blocked
      index.html test scripts in this session's scratchpad: verify-dash.js/verify-wiring.js/
      verify-tray.js/etc.; MY p2-p6 tests all block Firebase). CLEANUP (Firestore REST,
      public rules): scratchpad/goat_cleanup.mjs merged one stray care log (Daisy dewormed)
      onto its original then deleted all 36 dupes → 38 goats, 0 dups; the 2 daily chores
      were KEPT (each had a completion). HARDENING (index.html): new `serverConfirmed` flag
      (true on the local backend always; on cloud only when a NON-fromCache snapshot
      arrives) — importHerd now REFUSES to run until serverConfirmed (can't dump the herd
      pre-sync); the cloud-seed loop now name+frequency dedupes against present docs AND
      awaits each addDoc (no more partial writes). Verified headless 20/20, 0 pageerrors.
      REMINDER (again): headless index.html tests MUST block /googleapis|firestore|firebase|
      gstatic/ — old scratchpad scripts that don't are how this keeps happening.
- [x] ILLUSTRATED STORIES + HOMEWORK CAMERA (2026-07-07, PUSHED 1b37ee0, built by
      an opus subagent from a Fable spec): story chapters can end ===ART=== +
      inline SVG (client DOMPurify svg profile + FORBID script/foreignObject/
      image/href — server prompt bans them too); 🎨 frequency seg on story
      setup (every / every3 DEFAULT / first / off, localStorage farmgpt_illust);
      illustrate:true requests get maxTokens 3000, plain stay 1200; art streams
      after text+choices; bookshelf saves >300KB strip art oldest-first.
      Research 📷: photo -> ≤1280px JPEG client-side -> vision image block;
      sanitizeMessages accepts text/image block arrays (jpeg/png/webp, ≤2.8M
      b64 chars, ≤4 imgs/request oldest-stripped); RESEARCH_SYSTEM PHOTOS block
      (coach photographed worksheets, never answer-sheet); saveResearch stores
      thumb (≤200px) + "[photo shared earlier]" placeholder, NEVER full b64
      (in-memory keeps full image for same-session follow-ups — storage copies,
      don't mutate, or the in-flight request loses its image). TODO next: live
      story on every3 -> read real ¢/illustration off the usage dashboard and
      tune default frequency/art prompt.

---

# 📖 STORY TIME CONTINUITY — the ledger engine, steps 1-2 (2026-08-03, UNPUSHED)

Plan of record: `storytime-continuity-plan.md`. Steps 1 (schema + plumbing) and 2 (narrator
path) are done; the KEEPER (step 3) is deliberately NOT built — the plan's own rule is that the
narrator has to be right before bookkeeping is automated. Files: `farmgpt.html`,
`netlify/functions/farmgpt.mjs`, new `tools/_verify-storyledger.cjs` (**212/212**, 0 page
errors) and `tools/_probe-storyledger.mjs`. Built on top of the parallel session's uncommitted
baked-stories WIP; none of its hunks were touched.

## What a ledger story is
A story object created from here on carries `ledger` (schema v1), `ledgerDiffs[]` and
`schemaVersion`. A story saved BEFORE this — no `ledger` field — is legacy forever and keeps
the "STORY SO FAR" recap path byte-identical, including `maybeSummarize`. `hasLedger(s)` is the
only switch, and every branch (send, save, resume, export) reads it. A ledger that comes back
malformed (hand-edited localStorage, a partial write) is DELETED on resume: the story drops to
the legacy path and still reads and still continues, rather than shipping a broken ledger to
the narrator.

## Step 1 — plumbing, no AI
- `validateLedger` is structural, not semantic: right shape ⇒ always renderable. It rejects a
  wrong `schema_version`, any list that isn't a list, a canon entry with no rule, and a ledger
  far past the cap.
- **Canon is append-only and `canonPreserved` proves it by comparison, not by intent** — it
  diffs the canon before and after and catches an edit, a delete, AND a reorder (a reorder is
  an edit in disguise once entries are referenced by position). `update.canon` is rejected on
  sight as malformed.
- `applyLedgerDiff` is **all-or-nothing**: everything lands on a deep copy, and the copy is
  adopted only once canon survives intact and the result validates. A patch that is half good
  applies NOTHING (tested). The original object is never mutated, so a rejected diff can't
  half-write. Ids are assigned by the CLIENT, never taken from the patch — a keeper can't
  collide or renumber.
- **`ledgerDiffs` is load-bearing for step 5's rewind**, so the contract is complete + ordered +
  no gaps: exactly one entry per scene, at its own index. A scene whose keeper hasn't run (right
  now: every scene) still records an honest empty entry, and `recordLedgerDiff` backfills any
  hole — a hole would silently shift every later replay. `replayLedgerDiffs(seed, log, N)`
  rebuilds the ledger at scene N and is asserted equal to the live one.
- **Universe picker** (🐉 HTTYD · ⚔️ Star Wars · ✨ My own world, default). A pack is fetched at
  story creation from `assets/storytime/universes/<id>.json` and seeds the ledger; the story's
  COPY is what evolves, so editing a pack file never rewrites a story in progress. A missing or
  broken pack degrades to a valid empty original-world ledger plus a quiet toast — a content
  workstream's uptime can never stop a story starting.
- **PROTAGONIST CAPTURE = a name field on the setup screen** (`#heroName`), applied to both the
  typed box and the builder, appended to the opening prompt as "My name is X." Both blocks are
  created either way: `protagonist` AND a full `characters[]` entry with `origin:"reader"` and
  the same sheet fields a pack character gets. With no name given they exist unnamed, for the
  keeper to fill from scene 1 — the renderer prints "(unnamed — the reader's own character; take
  the name from the story)", which reads fine to the narrator.
- Bookshelf size math: art still goes first; if the shelf is STILL over 300KB every ledger on it
  is compacted to 8KB (timeline first, then resolved threads — a character is NEVER dropped, so
  a 23KB HTTYD ledger simply stays; 20 of them is ~470KB of localStorage, well inside budget).
  20-story cap unchanged.

## Step 2 — the narrator path
- `SEND_SCENES = 3` verbatim for ledger stories (replacing the 4-CHAPTER window) — smaller AND
  more reliable, because the memory is now structure instead of prose. Legacy keeps
  `SEND_CHAPTERS = 4` + the recap fold-in.
- **THE LEDGER RIDES IN ITS OWN REQUEST FIELD (`body.ledger`), NOT INSIDE A MESSAGE.**
  `MAX_CONTENT_CHARS` is 12000 per message, so a 30KB ledger stuffed into `messages[0]` would be
  sliced mid-JSON — silently, and the narrator would read half a world. Keeping it separate also
  lets the SERVER own the rendering, the cap and the placement.
- **DEVIATION FROM THE PLAN, deliberate, and it serves the plan's own stated reason.** The plan
  orders the prompt "meta+canon → characters/locations/relationships → protagonist/flags/threads/
  player_knowledge → last N scenes → choice", justified as "by volatility (cache-friendly)". The
  ledger blocks keep exactly that ORDER, but the split lands the STABLE half (meta, canon, cast,
  places, bonds) on the world-setup turn and the VOLATILE half (hero, flags, live threads, what
  the reader knows) on the reader's newest message — i.e. AFTER the scenes, not before. Putting
  the volatile half in `messages[0]` would change the cached prefix every single turn and destroy
  caching outright, which is the opposite of the ordering's purpose. Recency is a bonus: "how
  things stand right now" sits where the model attends most. Asserted both ways in the suite.
- `STORY_LEDGER_RULES` is appended to the system prompt **only when a ledger is actually
  present**, so a legacy story's prompt is provably byte-identical to what it was. Rules: the
  ledger outranks recent prose · canon contradictions FAIL DIEGETICALLY (the world refuses, never
  the narrator) · `hidden_from_player` may not leak by statement, implication, hint or
  foreshadowing · recorded voices are mandatory · threads resolve only when earned · **FAMILY_RULES
  outrank every line of the ledger, canon included** (the ledger arrives from an untrusted
  client — the house cap-bypass threat model).
- `hidden_from_player` IS sent to the narrator, on purpose: it has to know the secret to write
  toward it without giving it away. The timeline is NOT sent — it is an audit trail for the
  keeper, and it is therefore also the first thing compaction drops.
- **Multi-POV retired** (single protagonist per the plan): the STORY_SYSTEM chapter clause and
  the `STORY_NEW_CHAPTER` directive both said a new chapter MAY switch whose eyes we follow.
  Both now pin the same hero. `SUMMARY_SYSTEM`'s "may follow SEVERAL protagonists" was left
  alone — that is the legacy recap path, and the brief said retire just the next-chapter
  affordance.
- Preserved verbatim and asserted: the ===CHOICES===/===CHAPTER===/===CHAPTER END=== protocol,
  directives-on-the-LAST-USER-TURN (the volatile ledger block is appended BEFORE the chapter
  directive so the directive stays last), the pacing section, "natural next steps" (the spec's
  rejected "meaningfully different kinds" was NOT restored), maxTokens 1200, thinking disabled,
  `cache_control`. ADDED per the plan: "never offer a choice whose outcome is obvious".
- Server size cap 30KB is a **backstop, not the mechanism**: the client trims to 28KB before
  sending, and an oversized ledger that arrives anyway is COMPACTED, never rejected — bookkeeping
  must never be the reason a scene fails to arrive.

## CAST HYDRATION — why the wire never truncates the cast
The real `httyd.json` carries **22 characters in 23.1KB**, of which ~16.5KB is character sheets.
An earlier version of `compactLedger` fit the budget by `pop()`ing the tail of `characters` —
which would have silently deleted Mala, the Grimborns and Johann from the world somewhere around
scene 10-20 of every HTTYD story. A kid asks about Snotlout and he no longer exists, with no
error anywhere. **That is the exact failure this engine exists to prevent, and it fails
silently, which is worse.** Truncation was the wrong tool; hydration is the right one (the
plan's step-5 "dormant characters" idea, applied from turn zero).
- The **STORED ledger always holds every character's full sheet.** Nothing is ever lost on disk.
- `shapeLedgerForWire` sends FULL sheets only for who is **ON STAGE**: the protagonist · the
  reader's character · anyone who has actually appeared (`last_seen.turn > 0`) · anyone named in
  an unresolved thread. Everyone else becomes a **CAST ROSTER** line — id, name, ≤10-word role,
  and nothing else (voice/physical/knows/does_not_know are where the bytes are).
- **HYDRATION IS AUTOMATIC**: the turn after the keeper sets `last_seen` on a first appearance,
  that character arrives with a full sheet. The narrator is told so — roster names are real,
  present-but-off-screen people it may walk into a scene, and it must NOT invent a voice or a
  history for one, because the sheet arrives the moment they enter. The roster block's wording
  is load-bearing: a roster that reads like a list of *absent* people invites the narrator to
  write the world as if they don't exist.
- **THREAD-NAME MATCHING IS STRENGTH-RANKED, and a test fixture caught why.** A cast whose names
  share a leading word ("Character 7…", "Character 19…") made a bare first-name substring match
  pull ALL 22 on stage, crowding out the one the thread was actually about. Matching is now
  word-bounded, full-name matches outrank first-name ones, and the over-`ONSTAGE_MAX` sort is
  most-recently-seen then thread-strength. The reader is never cut.
- **Truncation order, and nothing outside it is ever dropped**: timeline (oldest first) →
  resolved threads → roster ROLE LINES → locations. Canon, the protagonist, every on-stage sheet
  and every roster ENTRY are untouchable — a character may lose their role line, never their name.
- **THE TIMELINE NEVER TRAVELS.** `renderLedgerBlocks` never shows it to the narrator (it is the
  keeper's and the rewind tool's audit trail, both of which read the STORED ledger), so sending
  it bought nothing — and it was 5.5-10KB of every request, the single thing pinning a long story
  at 100% of budget. Dropped from the wire copy; the stored copy keeps every entry.

**MEASURED (`_verify-storyledger.cjs` section H prints these every run, against the REAL packs):**

| httyd.json (23 chars, 23.6KB stored) | wire bytes | % of 28KB | on stage | on the wire |
|---|---|---|---|---|
| fresh story | 9,128 | 33% | 1 | all 23 |
| ~scene 40 | 16,135 | 58% | 6 | all 23 |
| ~scene 100, heavy | 22,466 | 80% | 10 | all 23 |

(starwars.json, 4 chars: 7,572 / 13,378 / 17,759 — 27% / 48% / 63%.) At scene 100 the bytes are
onstage 6,532 · knowledge 4,240 · threads 3,691 · canon 2,957 · rels 1,852 · locations 1,376 ·
roster 1,281. **RECOMMENDATION: LEDGER_WIRE_BUDGET stays at 28,000.** With hydration and the
timeline off the wire there is 20% headroom on the worst realistic case, and compaction is not
touching content at any length — the suite asserts exactly that (`at ~scene 100 compaction has
not had to bite into roster roles or locations`). If that assertion ever trips, RAISE THE BUDGET
rather than lose content; at Haiku prices the cap is far cheaper than a missing character.

**ANSWERING THE PACK SECTION'S FLAG** (see "universe packs" below — it closes by noting ~7KB of
headroom is tight and offering two outs: seed only the characters a story touches, or let step 5
collapse dormant ones). That was the engine's call and this is it: **neither out was needed, and
the first one would have been the wrong answer** — a pack seeds every character precisely so the
narrator knows who exists, and a story cannot "touch" a character it was never told about. What
was actually expensive was sending 22 full SHEETS on every turn, not storing 22 characters. Step
5's dormant-character idea is pulled forward to turn zero as hydration, so the pack should keep
seeding its whole cast at full detail. **Packs do not need to get smaller for the engine's sake.**

## ⚠ NOT LIVE-VERIFIED — the step-2 gate is still open
There is no `ANTHROPIC_API_KEY` in this environment (`tools/.env` has only ELEVENLABS and TRIPO)
and api.anthropic.com is unreachable, so **the narrator prompt has never been run against a real
model.** Everything above is proven on the WIRE and in the CLIENT against a fake Anthropic.
`node tools/_probe-storyledger.mjs [--url <base>] [--gate canon|hidden|voice|choices]` runs the
four acceptance gates against the deployed function and prints the transcripts: a canon rule
("nobody in Saltmere can swim") attacked by a write-in that assumes swimming · a
`hidden_from_player` secret hunted across 5 consecutive scenes including a direct question ·
a terse character's voice under pressure to monologue · the choice contract. It sends **no
`user` field**, so it neither counts against the 15/day cap nor writes to the kids' Story Log.
Its automated checks are TRIPWIRES; the transcripts are the deliverable. Tune
`STORY_LEDGER_RULES` and re-run.

## Tests
`node tools/_verify-storyledger.cjs [--shots]` — **212/212**. Section A runs farmgpt.mjs IN
PROCESS against a fake Anthropic (which records every request body), a fake Google token signed
with a throwaway RSA key, and a fake Firestore: block order both halves, every ledger rule
stamped, the timeline withheld, legacy byte-identity, the preserved machinery, single POV, the
size backstop, and the regressions that matter — **the daily cap still fires (and the model is
never called), scenes still log, FAMILY_RULES still stamped**. Sections B-F drive the real page
in headless Chrome over a local http origin: validator accept/reject incl. all four canon-drift
shapes, ~12 diff rejections each proving the ledger is unchanged, all-or-nothing, the diff-log
contract, replay, seeding, graceful pack failure, the wire window for both paths, and a real
story start → shelve → reload → resume with a legacy story on the same shelf.
Section G is the hydration battery (a 22-character synthetic pack the same size as the real one:
nobody vanishes at any budget including 500 bytes, on-stage keeps its sheet while the unseen stay
roster lines, hydration lands the turn after first appearance, canon + protagonist survive, and a
long-story simulation still ships all 23). Section H MEASURES the REAL packs and reports rather
than asserting their content, so a pack edit can never fail the suite.
Regressions: `_verify-kidstory-server.mjs` 54/54, `_verify-dnd-server.mjs` 47/47.
**THE PACKS ARE NOT THIS SUITE'S TO ASSERT ON** — `assets/storytime/universes/*.json` is a
parallel content workstream; every pack FETCH is intercepted and answered with a FIXTURE defined
in the suite (an invented harbour town), so what is under test is the seeding CONTRACT, not
anyone's prose. The real packs are read only by section H, only to measure bytes.
New test hook `window.__STORY__`.
**TEST GOTCHAS**: the CDN libraries must be stubbed by request interception — jsdelivr is
unreachable here and `marked.setOptions` runs at page-script top level, so an unstubbed CDN
takes the whole script (test hook included) down with it, which reads as "the page is broken".
And the fake Anthropic response must be DRAINED FULLY (`await resp.text()`), or the handler's
`finally{}` logging never runs and the cap/log assertions test nothing.
Shots: `shots/st_ledger_setup.png`, `shots/st_ledger_universe.png`.

**DEFERRED to the keeper (step 3), by design**: nothing writes a diff yet, so every
`ledgerDiffs` entry is currently an honest `{diff:null, ok:false, reason:"no keeper yet"}` at
its own scene index; `meta.turn` advances per scene. Reader-canon promotion (`source:"reader"`
from a write-in or redo) has its schema field and its precedence documented but no
implementation, and there is no redo affordance yet.

---

# 📖 STORY TIME CONTINUITY — universe packs (2026-08-03)

The rebuilt "universe info sheet" the family lost. Packs seed a new Story Time story's
ledger so the world starts out knowing itself; they exist because Story Time kept getting
franchise facts wrong and the kids noticed (wrong character details, wrong lightsaber
mechanics). **Pack accuracy is the product** — every load-bearing claim was web-verified
during authoring, sources listed per pack in the directory README. Schema, precedence
rules and how a pack seeds a story live in `storytime-continuity-plan.md` (repo root);
this entry does not restate them. Engine side (farmgpt.html / farmgpt.mjs / storytime.html)
was built by a parallel agent and is NOT touched by this work.

**Files** — `assets/storytime/universes/`: `httyd.json` · `starwars.json` ·
`_validate.mjs` (reusable pack validator) · `README.md` (format, sources, judgment calls).

- **httyd.json** — timeline point **"conclusion of Race to the Edge (before HTTYD 2)"**,
  the user's explicit spec: every status true as of series end, not the films. 22
  characters (six riders AND their six dragons as full entries, Stoick, Gobber, Heather +
  Windshear, Dagur + Sleuther, Mala, and the four antagonists), 17 canon rules, 7
  relationships, 5 locations. The era subtleties are the point and live in the right
  buckets: Valka believed dead (Hiccup AND Stoick), Toothless believed the last Night
  Fury, no Hidden World or Light Fury, Hiccup not yet chief, Hiccup+Astrid together but
  NOT engaged, Berk at peace, both Dragon Eyes destroyed. Antagonists at series end —
  Viggo dead (sacrificed himself after Johann's betrayal), Ryker dead (Submaripper took
  his ship), Johann dead (frozen by the Bewilderbeast), **Krogan ALIVE and vanished**
  (commonly misremembered as a death; he is the one RTTE villain a new story can reuse).
- **starwars.json** — RULES pack per the user, not a cast dump: 25 canon entries on how
  the Force works and how lightsabers work (light/dark and what feeds each, training,
  telekinesis, reflexes, sensing, visions as one possible future, mind trick + who resists
  it + droids immune, kyber crystals as the living heart of a blade, attunement/colour,
  bleeding red and healing back, what a blade cuts and what resists it — beskar, cortosis,
  phrik — blade-on-blade locking, deflecting bolts). **Era-agnostic**; the reader sets an
  era in setup. Only 3 characters, each era-flagged inside `status` so a pre-Empire story
  correctly has no Vader. Jedi and Sith are canon entries, not characters.

**VERIFY**: `node assets/storytime/universes/_validate.mjs [file.json]` — **928/928, exit 0**
(schema subset complete, no empty field, unique/well-formed C*/CH*/L* ids, one-sentence
canon rules, pack turns all 0, no stray top-level keys, seed size under the ledger cap).
A 14-case negative test (deliberately corrupted packs) proved every rule actually fires —
and immediately caught a real bug in the validator itself: `argv.map(basename)` hands
`basename()` the array INDEX as its `suffix` argument, so single-file mode crashed on every
invocation. **A validator that has only ever passed is untested.**

**SIZE / the ledger budget** — the number that matters is the MINIFIED seed, since that is
what counts against the server's ~30KB ledger cap: httyd **22.7KB**, starwars **9.5KB**.
HTTYD is over the 4-8KB hoped for and that is a genuine trade-off, not an oversight: 22
characters × 8 prose fields plus JSON keys floors near 16KB however tightly worded, and the
prose was cut twice — what remains is `voice` (voice drift was a family complaint), `status`
(the timeline point's actual payload) and the knowledge buckets, i.e. the three things the
pack exists to fix. **Flagged for the engine**: ~7KB of headroom is tight; the easy outs are
seeding only the characters a story touches, or letting the planned compaction step (plan
doc build step 5) collapse dormant ones. That is the engine's call, not the pack's.

---

# 📖 STORY TIME CONTINUITY — the KEEPER, step 3 (2026-08-03, UNPUSHED)

Plan of record: `storytime-continuity-plan.md`, build step 3, now ticked. The ledger stops being
plumbing and starts remembering: after every scene of a ledger story a second tiny model call —
the KEEPER — reads what was just written and returns a DIFF, which the client validates, applies
and files. Files: `netlify/functions/farmgpt.mjs`, `farmgpt.html`, `tools/_verify-storyledger.cjs`
(212 → **374**, 0 page errors), new `tools/_probe-storykeeper.mjs`. **Verified LIVE against real
Haiku** — an `ANTHROPIC_API_KEY` exists in `tools/.env` now and api.anthropic.com is reachable, so
unlike steps 1-2 nothing below is fake-server-only. Built on top of the parallel session's WIP;
none of its hunks were touched.

## The keeper
Server mode `"ledger"`: Haiku, thinking off, JSON only, **its own** records-clerk system prompt
(`LEDGER_KEEPER_SYSTEM`) — it is not a storyteller, and FAMILY_RULES is deliberately NOT re-sent to
it (one short "leave that material out of the ledger, and stay JSON" line instead: a clerk that
refuses returns prose, and prose is a lost scene). Its single user turn is built SERVER-SIDE from
named body fields (`ledger` + `scene` + `choice` + `readerAssert` + `turn`); a `messages` array from
the client is ignored, because `MAX_CONTENT_CHARS` would slice a 28KB ledger mid-JSON.
`renderLedgerForKeeper` is deliberately NOT `renderLedgerBlocks`: the narrator is shown a world, the
clerk is shown a **filing system** — every entry carries the id an update must quote back, and
HIDDEN is a working list to promote FROM rather than a secret to write around.
- **It costs no daily cap and writes no Story Log.** Both gates were already `mode === "story"`, so
  this is structural rather than a new exception — the scene it reads was logged by the story call
  that produced it, and a second copy would corrupt Dad's review view AND double-count the cap.
- Usage lands in a new bucket **`l`** (`l_in/l_out/l_req/l_cw/l_cr`), with a 📒 row and column in the
  dashboard. Folding it into `s` would make a chapter look twice as expensive as it is.
- Pinned to Haiku regardless of `STORY_PROVIDER`: flipping the narrator to Gemini or Sonnet is a
  prose decision and must not silently move the bookkeeper onto a provider whose JSON adherence
  nobody has measured.

## Client: fail-open is the contract
`runKeeper` sits in the `maybeSummarize` slot (legacy stories keep the recap path untouched). EVERY
failure — network, unparseable JSON, a rejected patch, a canon violation, a timeout — leaves the
previous ledger byte-identical, records an honest empty entry so the diff log stays gapless, and
says nothing to the reader. A keeper failure is invisible from the reading chair.
- **Keeper calls QUEUE, they never overlap and are never dropped.** The first cut used a boolean
  latch, which silently threw away a scene's bookkeeping whenever the reader chose faster than the
  keeper answered — and diffs must apply in scene order anyway, each written against the ledger the
  one before it left behind.
- A 45s abort. Without it a hung request latched the keeper closed for the rest of the session —
  the one failure mode fail-open does not cover by itself.
- The failure REASON now carries a 200-char snippet of what actually came back. "Wasn't JSON" alone
  is unfalsifiable a week later, it is the field step 5's audit tool will read, and it is what found
  the max_tokens bug below.

## `promote_knowledge` — the reveal-preserving move
A new diff op, and **the only way anything ever leaves `hidden_from_player`**. Everything else in a
diff is additive (which is what makes a bad patch harmless), but player_knowledge has to move a line
between buckets: a secret still marked HIDDEN after the reader has learned it makes the narrator
hide something the reader is already holding. Two rungs, per the step-2 gate's finding:
**hidden → suspected** (the reader earned doubt) → **known** (the story confirmed it). Matching is
exact → normalised → containment-either-way with a ≥12-char overlap guard, because a model told to
"copy the line exactly" still paraphrases; the LEDGER'S wording is what moves, never the paraphrase.
A fact that was never hidden is simply added rather than lost. Re-promoting to the rung it is
already on is a no-op — the keeper does re-report.

## Reader canon
A write-in or a redo note is a READER ASSERTION and can become permanent canon with
`source:"reader"`, which the narrator is now told **outranks any other canon rule it contradicts**
(the pack FILE is never touched — only this story's copy). The rendered CANON block marks those
lines; FAMILY_RULES still has the last word.
**The CLIENT, not the model, decides when that authority may be minted.** `sanitizeKeeperDiff`
downgrades any `source:"reader"` the model invents on a turn that carried no assertion, and `"pack"`
is denied outright (only the seeder mints pack canon). Permanence is free: canon is append-only and
`canonPreserved` already catches an edit, a delete or a reorder.

## Redo
"↻ redo this scene" + an optional note, offered whenever a scene is on the page and the story is
waiting on the reader (including at a chapter end). It throws the last scene away, **truncates the
diff log so no entry outlives its scene**, and rewinds the ledger through `ledgerPrev` — the
keeper's snapshot from immediately before the diff it applied. A stale keeper still in flight for
the discarded scene abandons quietly (`story.keeperGen`) rather than stamping its diff onto the
index the replacement now occupies — a silent, unfindable corruption otherwise. `ledgerPrev` doubles
a ledger story's footprint, so under shelf pressure it is shed OLDEST BOOK FIRST, before any ledger
is compacted, and the book on top keeps its undo.
A redo can leave the reader's note attached to the NEXT_CHAPTER sentinel, so every "is this the
next-chapter turn?" test is now a PREFIX test (`isNextChapterTurn`) — four call sites.

## Two fixes this step made to steps 1-2, both found by the live work
- **`update.meta` now applies BEFORE the adds.** New canon and timeline entries are stamped from
  `meta.turn`, so with the update running last a replay stamped them differently from the live run —
  i.e. `seed + diffs 0..N` did NOT reproduce the ledger exactly, quietly breaking step 5's rewind
  primitive. Caught by asserting the WHOLE ledger rather than just its canon.
- The keeper stamps the scene's turn into the diff itself, for the same reason (a replay never runs
  the client code that sets `meta.turn`).
- Plus one tolerated misplacement: the model repeatedly emits `player_knowledge` at the TOP level
  instead of under `add`. Unshimmed that is an unknown key — the diff "succeeds" while silently
  losing what the reader learned. Only this one key is folded; an ambiguous misplacement
  (`protagonist`, which could mean add OR update) is left alone rather than guessed at.

## LIVE — what the model actually did
`node tools/_probe-storykeeper.mjs [--promo N] [--habits N] [--play N]` hosts the real function
in-process with the real key and Firestore pointed at a dead host (so probe scenes never touch the
Story Log and the cap query fails open), and `--play` drives the REAL page end to end.
- **PROMOTION, 5 fixed scenes × N trials** — fixed scenes so only the keeper's judgement varies;
  narrator variance would otherwise dominate the number. **Before tuning 31/40 = 22% failure**, in
  two clear shapes: found evidence read as PROOF (promoted straight to `known`), and mere
  topic-relevance read as suspicion (a confident accusation of the WRONG person promoted the
  secret). After rewriting that section as an ordered 3-question test plus an explicit WHEN NOT TO
  PROMOTE: **136/140 pooled over three runs = 3% failure**, then 40/40 on a fourth after the
  reader-canon tightening; the residue is the safe direction (over-knowing a fact nearly earned,
  not the narrator hiding one already learned). `last_seen` coverage — the other most-missed
  update — ran 39/40 · 60/60 · 38/40 across runs, i.e. ~95%+ and never the cause of a rejected
  diff. Invented ids: **0 in every run** — worth knowing, because one would throw a whole diff away.
- **READING EVERY DIFF OF A REAL STORY** is what found the rest, and NONE of it reproduced on short
  fixtures — the pre-tune prompt scores 32/32 on the isolated versions of all of these. They only
  appear once a ledger has accumulated. Found: canon minted from a QUESTION ("[C6] Wren asked Maren
  directly if she is putting out the lamps" — permanent, append-only, from a turn that asserted
  nothing) and later from an ACTION ("[C3] Wren walks from the quay to the lighthouse via the shoal
  path" — that is where she went, not a rule of the world); a character's DENIAL written into
  `known` while that very fact sat on the HIDDEN list, the ledger contradicting itself; and `known`
  growing five entries a scene to 38 by turn 15, every one re-read forever. Prompt rules fixed all
  of them — the reader-assertion section now carries three WORKED EXAMPLES (question / action /
  statement) because naming the categories abstractly left the action case failing 1-in-8. A
  regression battery for exactly these, `--habits`: **39/40 before the worked examples, 50/50
  after**, with the `known` bloat down to 20 entries at the same 15 turns and denials correctly
  recorded as "Maren SAYS she is not…".
- **THE max_tokens BUG, and it is the one worth remembering.** Three consecutive keeper failures
  mid-playthrough were invisible to every isolated test — 12/12 clean by direct POST, 8/8 clean
  through the client — because the untested variable was SCENE LENGTH. On a long, event-dense scene:
  **7 of 8 truncated MID-JSON at the plan's sketched 600 tokens, 0 of 8 at 1200.** The failure is
  silent and total (unparseable → fail-open → that scene's bookkeeping simply gone), and output
  tokens bill only for what is produced, so the headroom is free on ordinary scenes. A short-scene
  fixture will never reproduce it: do not lower `MODES.ledger.maxTokens` without re-measuring on a
  long one.
- **A PROBE FINDING, NOT A PRODUCT BUG, and it cost three runs**: every `--play` run stopped dead at
  exactly 15 turns. That is `STORY_DAILY_CAP` — the client counts every scene it renders, so a
  20-turn probe walks into the "you've read a LOT today" notice and correctly refuses to continue.
  The probe now identifies as **Dad**, the one identity exempt from the cap on both sides (it still
  sends no `user` on the wire, so the server counts and logs nothing either way). Worth remembering
  for any future long automated playthrough of story mode.
- **THE FINAL 20-TURN RUN, everything in**: 20 scenes, **20/20 keeper diffs applied, 0 not applied**,
  diff log 20 entries for 20 scenes and ordered, 3 promotions (hidden → suspected → known, the
  ladder walking on its own), the redo landing its note as the run's ONE reader-canon rule
  ("Bramblewick has a wooden leg."), 0 canon minted from a question, 0 denials in `known`, 0 leaks,
  0 page errors, ledger valid, 22 known entries / 8047 bytes on the wire.
- **ONE MORE BUG, caught by reading that run's diffs rather than by any test**: the keeper
  re-reports a fact it has already moved, and PARAPHRASES when it does — so a "…to known" for
  something already sitting in `suspected` matched nothing (it was no longer hidden) and landed a
  SECOND copy of the same secret in a second bucket. The narrator was then told the reader both
  knew it and merely suspected it. `promote_knowledge` now fuzzy-matches the OTHER rungs too, moves
  the ledger's own wording between them, and refuses to regress a known fact back to suspected.

## Suites
`tools/_verify-storyledger.cjs` **374/374**, 0 page errors — same house pattern (in-process handler
+ fake Anthropic/Google/Firestore for the wire; real Chrome over a local origin for the client).
New: A8-A11 (the keeper's wire, no-cap/no-log, its edges, reader-canon precedence for the narrator),
G (promote_knowledge incl. both rungs and wholesale rejection), H (the keeper: the happy path with
THE test — a secret learned on the page moves HIDDEN → KNOWN — then **eight failure modes one at a
time**, a timeout, the queue, and a redo racing a keeper), I (reader canon minted, persisted and
un-editable; the model downgraded on a non-asserting turn; redo's log truncation and ledger rewind;
replay-after-redo reproducing the live ledger EXACTLY; the shelf shedding `ledgerPrev` first).

**KNOWN / DEFERRED**: `known` still grows ~1.5 lines a scene, which is fine at 20 turns and wants
step 5's compaction by 100; `ledgerPrev` is a ONE-step undo, so redo replaces the last scene only;
and the probe's leak tripwire only fires while a fact is still hidden (once promoted the narrator is
entitled to play with it, and flagging that would be flagging the feature working).

---

# 📖 STORY TIME CONTINUITY — caching + the operating loop, steps 4-5 (2026-08-03, UNPUSHED)

Plan of record: `storytime-continuity-plan.md`, build steps 4 and 5, both now ticked — **the
continuity engine is complete**. Files: `netlify/functions/farmgpt.mjs`, `farmgpt.html`,
`tools/_verify-storyledger.cjs` (374 → **457**, 0 page errors), new `tools/_probe-storycache.mjs`
and `tools/_probe-storystep5.mjs`. Everything below was MEASURED or run against real models, not
reasoned about. Built on top of the parallel session's WIP; none of its hunks were touched.

## Step 4 — caching: the answer is 0.0%, and that is the finding

Step 2 chose the prompt block order FOR caching and never observed a cache field. So this step read
what the API actually reports. `tools/_probe-storycache.mjs` wraps global `fetch` before the
function module is imported, tees each upstream SSE response, and records
`cache_creation_input_tokens` / `cache_read_input_tokens` per request — narrator and keeper
separately — across a real 6-turn story driven through the real page. It also fingerprints the
system prompt and `messages[0]` per turn, so a zero hit rate can be **explained** rather than just
reported.

| real 6-turn story, real Haiku | input | cache write | cache read | hit rate |
|---|---|---|---|---|
| narrator | 3,777 | **25,919** | **0** | **0.0%** |
| keeper | 20,436 | 0 | 0 | 0.0% |

- **The narrator was paying a pure surcharge.** A cache WRITE bills at 1.25x input, so 25,919
  written-and-never-read tokens is **+21.8% on input for nothing**.
- **WHY IT CAN NEVER HIT.** The top-level flag auto-places ONE breakpoint on the last cacheable
  block, so the cached entry is the WHOLE prompt — and a story's prompt is never byte-identical
  twice. The probe's fingerprints show `messages[0]` changing every single turn: the keeper rewrites
  `last_seen` on the "stable" ledger half every scene, and cast hydration reshapes that half **by
  design** the turn a character first appears. (The system prompt also flips between two hashes —
  that is `shouldIllustrate()` appending `STORY_ILLUSTRATION` every third scene.)
- **A SYSTEM-ONLY BREAKPOINT DOES NOT RESCUE IT, and this was measured, not assumed.** Sent as a
  cache-controlled block on its own, the narrator's system prompt is 2,839 tokens and the keeper's
  2,215, and **both write nothing** — under Haiku 4.5's minimum cacheable prefix. The playthrough
  brackets that minimum independently: no write at 3,762 tokens, a write at 4,334. The documented
  figure is 4,096. **The minimum is not monotonic across models** — 1,024 on Sonnet 5, 4,096 on
  Haiku 4.5 — so "it caches on Sonnet" tells you nothing about Haiku.
- **THE CHEAP FIX, TAKEN**: `cache_control` is now per-mode (`MODES.<mode>.cache`, default on),
  **off for `story` and `ledger`**, unchanged for research and dungeon — where the prefix genuinely
  is append-only, the system prompt is large, and the model is Sonnet. The dungeon entry's claim
  that a pasted module re-reads at ~10% after the first turn is therefore intact.
- **THE EXPENSIVE FIX, NOT TAKEN, and this is the recommendation**: the spec's stabilized/split
  ledger would mean giving up cast hydration (a character moving from roster to full sheet IS a
  prefix change) to buy back roughly **$1/month at the family's absolute ceiling**. The plan's own
  rule is "no stabilized-ledger engineering until costs demand it"; they do not. REVISIT only if
  story moves to Sonnet AND the stable half is made byte-stable.

## Step 5a — compaction: one principle, and everything follows from it

> **COMPACTION NEVER DELETES A FACT FROM DISK.** What it removes from the STORED ledger is only
> structure already rewritten losslessly elsewhere in the same ledger. Everything else is shaping
> for THE WIRE, with the stored copy left whole — exactly like cast hydration.

That is what makes it reversible-safe, and it is asserted rather than assumed.
- **Resolved threads fold** into ONE timeline line carrying the thread's own sentence verbatim, then
  leave `open_threads`. Stored, deterministic (a pure function of the ledger — it reads `meta.turn`,
  never a clock), and **idempotent**, which is what lets it run inside every `applyLedgerDiff` so a
  replay folds at the same moments and `seed + diffs` still reproduces the live ledger BYTE for
  byte. The fold also had to teach `resolve_threads` tolerance: the keeper re-reports a resolution
  it has already reported, and without recognising an already-folded id that would throw away a
  whole otherwise-good diff (a genuinely unknown id still rejects it).
- **Dormancy is ONE MORE CONDITION on the on-stage test hydration already uses** — deliberately, so
  the two compose instead of fighting. Hydration asks "has this person ever appeared?"; fifty turns
  later the honest answer is "yes, long ago", and a full sheet for someone the story left behind
  costs the same bytes as a never-met one. Past `DORMANT_AFTER` 20 turns a character drops to a
  roster line **marked with `lastSeen`** — load-bearing, because the roster block otherwise tells
  the narrator that someone it has already written scenes for has never been on screen — and
  **rehydrates automatically** the turn the keeper moves `last_seen`. An unresolved thread naming
  them overrides dormancy. **Nothing is removed from disk.**
- **Stale places and a runaway KNOWN list, wire-only**: a place unvisited for 20+ turns travels as
  name + current state without its description (a place with no recorded `state` keeps it — a bare
  name tells the narrator nothing), and `known` is capped to its newest 24 (it grew ~1.5 lines a
  scene in the step-3 live runs and is most of the volatile block by turn 100).
- **MEASURED on a synthetic 120-scene story** (a timeline line, a known fact and a thread every
  scene, a character every tenth, a third of threads resolving): stored **28,651 bytes** — inside
  the 30KB cap — wire **9,843**, every canon rule and every character intact, every character still
  reaching the narrator in some form, and the whole run replaying **byte-identically**.
- KNOWN LIMIT, and it is the pre-existing timeline shedding rather than a new one: once a ledger
  nears its cap the budget compaction drops timeline entries oldest-first, folded thread lines
  included. The guarantee is "a folded thread keeps its sentence until the whole timeline is being
  shed", and the suite checks a RECENT fold for exactly that reason.

## Step 5b — go back: rewind and branching on the diff log

The primitive has been sitting there since step 1 (`ledger@N === seed + diffs 0..N`); this makes it
a reader-facing feature. A 🕰 **go back** button on the same bar as the redo affordance opens a list
of the choices the reader made, newest first; picking one confirms, then unwrites that scene and
everything after it, leaving the reader standing at that choice again.
- **`story.ledgerSeed` is new and load-bearing** — the world at turn 0, stored at creation and never
  written to again. Without it there is nothing to replay onto, so a story that predates the field
  **refuses honestly** instead of guessing at a starting world. It is shed LAST under shelf
  pressure and never from the book being read (it never grows, so it is rarely what put the shelf
  over).
- **THE OLD VERSION IS ALWAYS KEPT**, on the shelf under its own id as "<title> (the old way)".
  Going back is the one action here that destroys reading the family already did, so nothing is
  destroyed and there is no decision to make.
- What moves together, all asserted: the transcript (cut to end on a scene, so the choices are
  offered again), the diff log (cut to match, still one entry per scene with no gaps), `meta.turn`,
  the chapter number (recomputed), the `closing` latch, `ledgerPrev` (redo's undo pointed at a scene
  that no longer exists), and `keeperGen` — bumped, so a keeper still in flight abandons instead of
  stamping its diff onto an index that now belongs to a different scene.

## Step 5c — the contradiction audit (Dad only)

Server mode **`"audit"`**: Sonnet (a reasoning job over a whole story, read by a parent deciding
whether the engine works — the cheapest place to be wrong), its own `STORY_AUDIT_SYSTEM`, its own
single turn built SERVER-SIDE from `ledger` + `transcript` (same reason as the keeper's: a 28KB
ledger inside a message would be sliced at `MAX_CONTENT_CHARS`), **no daily cap, no Story Log** —
both gates are `mode === "story"`-only, so this is structural rather than a new exception. Usage
lands in a new bucket **`c`** with a 🔎 row and column in the dashboard. `cache:false` — a one-shot
call's cached prefix is never read.
- It gets the FULL ledger **including the timeline**, which the narrator never sees, because the
  timeline is precisely the audit trail a contradiction is checked against.
- The client page is Dad-gated exactly like the Story Log, lists the shelf (stories live only in
  this device's localStorage — there is no server story store), and renders findings by severity
  with the evidence a parent can check for themselves.
- **The keeper's accumulated `notes` are surfaced alongside**, plus any scene whose bookkeeping
  failed outright. `notes` is free text the diff format has always allowed and nothing had ever
  displayed — it is the bookkeeper's drift alarm, written at the moment it was unsure.

## LIVE — what the real models actually did
`node tools/_probe-storystep5.mjs [--rewind N] [--audit]` (real function in process, real key,
Firestore dead-hosted, probe identifies as **Dad** or the 15/day cap stops it at turn 16).
- **REWIND, a real 7-scene story**: rewound to scene 3 and every diff printed before and after. The
  rewound ledger is **byte-equal to a fresh replay of seed + surviving diffs**; the discarded
  version landed on the shelf whole (7 scenes); a different choice from the same moment produced a
  new scene with the log still gapless at 4/4 and the turn counter following. 0 page errors.
- **AUDIT, against three planted contradictions** (canon: nobody in Saltmere can swim, and the hero
  swims the channel · voice: warm wandering Maren speaking "clipped and short, the way Bramblewick
  would have" · a hidden fact the prose gives away): it found the canon break at HIGH severity with
  both quotations, found the voice break, AND found a real one nobody planted (the lighthouse
  recorded as lit while the scene ends with its lamp doused). **The control — the same world, a
  story that breaks nothing — returned ZERO findings**, which is the half that matters most: a
  checker that invents contradictions is worse than none.
- ONE PROMPT ITERATION, and it was worth it: the first live run found only the canon break. Adding a
  HOW TO WORK section that walks the ledger's lists in turn ("every character's VOICE: read their
  actual dialogue… the obvious break is rarely the only one") took it from 1 finding to 3 with the
  control still clean.

## Suites
`tools/_verify-storyledger.cjs` **457/457**, 0 page errors. New: **A12-A13** (the audit's wire —
its own system prompt with neither of the others leaking in, Sonnet, server-built turn, the timeline
included, no cap consumed, no Story Log written, usage in bucket `c`), **A14** (caching: the wire
facts asserted, the MEASURED numbers **reported not asserted** — cache behaviour depends on a
5-minute TTL and a model-dependent minimum, and an assertion on it would be a flaky test rather than
a useful one, the same treatment the pack-size measurements get), **J** (compaction: fold /
idempotence / re-report tolerance, replay identity across a fold, stale places, the KNOWN cap, disk
untouched, and the 120-scene simulation), **K** (rewind: points, truncation, `meta.turn`, chapter,
`keeperGen`, the shelf copy, refusals at both ends, a real branch, and THE test — the replayed
ledger byte-equal to a fresh play), **L** (the audit client: transcript building, keeper notes, JSON
tolerance, Dad gating, and the whole flow against a stubbed report).
Regressions: `_verify-kidstory-server.mjs` 54/54, `_verify-dnd-server.mjs` 47/47.
**RESTAGED, each with its reason in the file**: "prompt caching still requested" → story now asks
for NO breakpoint; two "a thread is resolved" checks → a resolved thread is now folded into the
timeline, so the same fact is checked where it now lives; the hydration battery's long-story case →
its fixture puts five characters 55 turns past their `last_seen`, which is exactly what dormancy
exists for, so it now asserts the dormant round trip instead; and the redo bar lays out as `flex`
rather than `block` now that it carries two affordances.
**TEST GOTCHA worth keeping**: every page in this suite shares one browser profile and therefore one
localStorage. Two things in it are cumulative and will silently break a later section — the daily
story counter (past `STORY_DAILY_CAP`, `takeTurn` stops doing anything at all, with no error) and
the bookshelf. Sections that drive many turns now clear both.

**KNOWN / DEFERRED**: the audit still misses the subtlest plant (a hidden fact the prose gave away)
about as often as it catches it; a story created before this step has no `ledgerSeed` and cannot be
rewound; and the shelf copy a rewind leaves behind counts against the 20-book cap like any other.

---

# 📖 STORY TIME CONTINUITY — landed on main (2026-08-03)

The four sections above were built on a base copy of `farmgpt.html` / `netlify/functions/farmgpt.mjs`
that was ~1,385 lines behind `origin/main`. Copying those files over main would have reverted three
other sessions' shipped work, and a branch merge produced 15 unrelated add/add conflicts across
fitness/news/castlekruzer. So the engine was landed as a NARROW three-way merge instead —
base = the ledger session's own HEAD, ours = `origin/main`, theirs = the ledger working tree — on
those two files only. **16 conflict hunks in the page, 5 in the function**, each resolved by hand.
Everything else in the branch is a new file.

**FIVE THINGS THE MERGE HAD TO DECIDE, and why:**
- **THE `c` USAGE BUCKET WAS ALREADY TAKEN.** The audit shipped writing `c_in/c_out/c_req` on the
  shared `farmgpt_usage` doc — and main's Meals calorie estimator has owned "c" there since
  2026-08-01. Two modes incrementing one bucket makes BOTH dashboard rows lie, and Firestore
  increments are not separable after the fact. The newcomer moved: **the audit is bucket `x`**
  (server map, `usageRow`'s read list, `rowCost`, `tokTotal`, the monthly split row, and the daily +
  hourly 🔎 columns). The suite assertion moved with it and now also pins that it is NOT "c".
- **TWO SESSIONS BUILT REDO INDEPENDENTLY.** Main has a typed one (`REDO_RE` / `tryRedo` — a
  write-in starting "redo…" splices the rejected scene out); the ledger has the ↻ button
  (`redoScene`, which additionally bumps `keeperGen` and truncates `ledgerDiffs`/`meta.turn`). Main's
  splice is CORRECT for a legacy story and CORRUPTING for a ledger one — `ledgerDiffs[N]` describes
  scene N, so a scene removed without its entry shifts every later replay and silently breaks 🕰 go
  back. `tryRedo` now delegates to `redoScene` when `hasLedger(story)`, and keeps its own body
  verbatim otherwise. Both roads, one destination.
- **BOTH SESSIONS EXTRACTED THE SAME PAINTER.** Main called it `paintTranscript()` (closes over the
  global `story`), the ledger `paintStoryScroll(s)`. The ledger's is a strict superset — it also
  renders a redo note left on the next-chapter sentinel, and validates a malformed ledger on resume
  — so it won, and main's one call site was repointed. (The auto-merge left one `story.messages`
  inside the `s`-parameterised body; caught by reading, not by a test.)
- **`SEND_CHAPTERS` IS MAIN'S KNOB, 6 NOT 4.** Main raised it for stronger continuity. The suite's
  legacy-window checks were written against a hardcoded 4 and a 6-scene fixture, which at 6 makes
  the whole transcript short enough to skip the recap path entirely — two failures that were the
  TEST being stale, not the code. The fixture is now sized off `S.SEND_CHAPTERS` and asserts against
  it. Ledger stories are unaffected: they travel on `SEND_SCENES = 3`.
- **THE PARALLEL SESSION'S WORK WAS ALREADY ON MAIN, and newer.** The story-log summary engine
  (`buildStoryLogCard`, `STORY_LOG_SUMMARY_SYSTEM`, the summary job) appeared on BOTH sides — main's
  version retains raw scenes as a 90-day readable transcript and has the refined flagging prompt, so
  main's won outright in both files (a 640-line hunk and a 106-line one).
Also merged rather than chosen: the `views` map (main's `teacher` + the ledger's `audit`), the
`sceneIdx` source (main's monotonic `story.sceneSeq` + the ledger's chapter-note-aware choice label),
the resume path (`isNextChapterTurn(...) || !!last.opener`), and `rowCost` (main's Sonnet-priced `u`,
`c`, Opus `t` + the ledger's `l` and `x`). The 🔎 audit button joined main's compact `#dadRow` pill
row rather than restoring the old stacked block.
**GOTCHA:** the ledger session wrote `farmgpt.mjs` with CRLF endings while main is LF, so the first
three-way merge reported "1 conflict" that was really the whole file. Normalise line endings before
trusting a merge-file count. Shipped LF, matching main.
**VERIFIED on the merge:** storyledger **457/457** · kidstory-server **54/54** · dnd-server **47/47**
· news **157/157** · fitness **253/253** · activity **147/147** · beacon-safety **90/90**, plus a
headless farmgpt.html boot at 390×844 and 1280×800 (0 page errors, all 16 hook functions and all 8
views present, home still fits one screen: 658/844 and 698/800) and a usage-dashboard render with
mocked stats (10/10 columns on both tables, all 11 mode rows, no sideways body scroll). LIVE against
real Haiku through the merged function AND the merged page (`_probe-storykeeper.mjs --promo 3
--play 4`): 4 scenes, 4 keeper diffs applied / 0 failed, a promotion fired, diff log 5 entries for 5
scenes in order, final ledger valid, 0 page errors.
**KNOWN, pre-existing, NOT introduced here:** main's `usageRow` never reads the `t_*` (TeacherGPT)
prefix it writes, so that dashboard row always shows zero. Left alone — it is another session's
feature and a one-word fix belongs with them.


## ⚠ THE FIELD-PATH BUG — twelve hours of silence (2026-08-04)

Shipped 2026-08-03 with 147/147 green; recorded NOTHING for twelve hours. Root cause: the
counter fields were named `03_news_v`, and **Firestore rejects any unquoted property path
that does not match `([a-zA-Z_][a-zA-Z_0-9]*)`** — every commit came back HTTP 400. They are
`d03_news_v` now, and that leading `d` is load-bearing, not decoration.

TWO THINGS HID IT, both fixed here:
1. **The fake Firestore was more permissive than the real one.** It stored whatever field
   name it was handed. A mock that accepts what the real service rejects is worse than no
   mock — it manufactures confidence. It now enforces the same grammar and answers the same
   400, so this exact bug fails the suite instead of passing it.
2. **`log` always returns 200** (correct — it is a beacon on a page someone is mid-use of),
   so the 400 was swallowed into a `reason` field nobody read. Diagnosis was one curl against
   production: `{"ok":true,"wrote":0,"reason":"http-400"}`. **`wrote:0` is the tell** — when
   this dashboard looks empty, curl the live `log` action before touching any code.

NEW SUITE: `node tools/_verify-activity-live.mjs` (9 checks) sends the function's REAL write
to REAL Firestore, reads it back, proves two commits ADD rather than clobber, and deletes
after itself. It uses the scratch collection `diag_activity` and the public web key — never
`bucky_activity`, never the service account. A fake can only ever encode the rules we already
know about, so run this whenever the write shape changes.

THE SHELL GOTCHA, AGAIN (this file already warned about it and I still hit it): appending
this very entry with `node -e "..."` containing backticks let bash run command substitution —
it EXECUTED the verify script and spliced its output into the docs. Use a quoted heredoc
(`<< 'EOF'`) or the Edit tool for any text containing backticks.

---

# 📖 STORY TIME — THE SHIPPING STACK: Fable seeds, Grok narrates, Haiku keeps the books (2026-08-04)

The comparison experiment is over and its result is now the default. `farmgpt.html` +
`netlify/functions/farmgpt.mjs`; suite `tools/_verify-storyledger.cjs` **545 → 602**; new live
probe `tools/_probe-storyship.mjs` and plate script `tools/_shot-usage-before.cjs`.

## The stack, and why each seat is filled the way it is
- **NARRATOR = grok-4.5.** `STORY_PROVIDER` defaults to `"grok"` (was `"haiku"`). Approved on the
  measured prose comparison.
- **SEEDER = Fable 5.** `STORY_SEED_PROVIDER` defaults to `"fable"` (was UNSET = dormant); `off` /
  `none` / `0` / `false` switch it back off. The client's `?seed=1` opt-in is gone — the flag now
  reads `!== "0"`, so `?seed=0` or `localStorage farmgpt_seed="0"` forces it off for testing.
- **THE KEEPER STAYS ON HAIKU 4.5, and this is the load-bearing negative result.** Grok's keeper
  scored 40/40 on judgement but ran a **median 47.8s against the client's 45s abort** and lost
  **3 of 8** scenes' bookkeeping in a real run. `KEEPER_PROVIDER` exists so that can be
  re-measured; it must stay defaulted to haiku. A bookkeeper that is right but late is worse than
  one that is merely good, because the failure is silent — the diff is simply never filed.
- Audit unchanged (Sonnet). Research unchanged.

## EVERY xAI ROUTE DEGRADES BY ITSELF — proven both ways, live
A Netlify site that has this code but no `XAI_API_KEY` is a working site, just a Haiku-narrated
one. Two independent guards:
1. **Before the request is built**: `provider === "xai" && !XAI_API_KEY` resolves back to
   Anthropic. No 500, and nothing is said to the reader.
2. **After it fails**: `openUpstream()` was extracted so a whole attempt — including a non-ok
   STATUS, not just a thrown fetch — is retryable, and a failed story-mode attempt is retried ONCE
   on Haiku. Deliberately **story-only**: the seeder already fails open into an ordinary story
   start, the keeper is on Anthropic anyway, and silently swapping the model under research or
   dungeon would hide a real misconfiguration instead of protecting a reader.
Live-verified with xAI pointed at a dead socket, at a 429, and with the key deleted outright: a
real Haiku scene arrived every time, with its choices, and the usage was billed to **the model
that actually wrote it** (`s_claudehaiku45_req`), not the one we asked for.

## ✨ FIVE MORE SCENES — the reader's own once-a-day grant
At the cap the screen used to just stop. It now offers **five more scenes to reach a stopping
place**, once per reader per Central day. `farmgpt_story_finish/<date>__<bucket>`, keyed on the
same `canonStoryUser` bucket the cap uses (a renamed profile shares one grant — this house has
already had that exact bypass in production). **Server-enforced by a
`currentDocument:{exists:false}` precondition**, so a second tap, or a second device racing the
first, LOSES the write and gets `{already:true}`. 15 + one grant = 20, and no more.

**IT IS A DESCENT, NOT SIMPLY MORE STORY.** The server computes how many granted scenes remain
from its OWN count — never from the client, which could lie about it — and injects
`STORY_FINISH_SOON(n)` ("about N more scenes remain… do NOT introduce a new mystery, enemy, place
or problem") on the LAST USER TURN. The final one gets `STORY_FINISH_LAST`, which forbids choices
and demands a real `===CHAPTER END===`, so the shelf shows a clean boundary. Live against real
Grok, the last granted scene came back as a lamplit landing with soup and "whatever strange quiet
had settled over the boats could wait until morning", then `===CHAPTER END===`. Once the five are
spent the message changes from "come back tomorrow" to a warm goodnight, and the offer does not
come back.

## ✂️ THE TRUNCATION BUG — it was the token ceiling, and the measurement says so
Reported live: scenes arriving cut off mid-sentence with **no `===CHOICES===` at all**, stranding
the reader (2 of 8 in one run; a third offered 2 choices). Measured directly against both real
APIs on the same ~900-word prompt:

| max_tokens | Haiku stop reason | Grok stop reason | choices? |
|---|---|---|---|
| **1200** | `max_tokens` (1200 out) | `length` (1200 out) | **NO** |
| **1600** | `end_turn` (1210 out) | `stop` (1197 out) | **yes** |

A 900-word scene wants ~1200 tokens, which sat exactly ON the old ceiling — hence the
intermittency. `MODES.story.maxTokens` 1200 → **1600**. Output bills only for what is produced, so
the headroom is free on an ordinary scene. Three defences, in order:
1. the bigger budget, which lowers the rate;
2. **`repairIfTruncated`** — a choice-less reply triggers exactly ONE repair call, never a loop:
   the half-scene goes back as the assistant turn it is, `STORY_REPAIR` rides the last user turn
   asking for the tail only, and the halves are joined at the break. It carries **no `user`
   field**, so it costs no scene of the daily cap and writes no second Story Log doc. A repair
   that also comes back truncated is DISCARDED rather than adopted;
3. **"▶ Keep going"** — a choice-less scene still renders a tappable control beside the write-in
   box. The reader is never stranded, whatever the cause.
Provider-agnostic by construction: the test is on the REPLY, not on who wrote it.

## 📊 THE USAGE DASHBOARD — cost follows the MODEL, not the mode
**The bug this had to fix first**: the moment story mode moved to Grok, every figure on this page
became silently wrong, including for months already closed. So `logUsage` now writes each record
TWICE in one commit — into its mode bucket (unchanged, so every existing row keeps working) and
into `<bucket>_<modelSlug>_*`. A row's cost is Σ(per-model tokens × that model's real rate) + the
REMAINDER priced at the mode's historical rate. For a row written before today the breakdown is
empty and everything falls to the old rate; for a row written after, the remainder is exactly
zero. **A closed month does not move** — verified, 2026-07 still prices at $0.20.
- Rates: Haiku 4.5 $1/$5 · Sonnet 5 $3/$15 · Opus 5 $5/$25 · Fable 5 $10/$50 · **grok-4.5 $2 in /
  $0.30 cached / $6 out** (docs.x.ai, re-verified — those are the <200k-prompt rates; ≥200k
  doubles, and our prompts are ~8k).
- **QUIET ROWS FOLD BY RULE, not by a list**: under 1% of the month's cost AND under 2% of its
  requests → a single 🧩 **Other** line that NAMES what it swallowed, with story and research as
  an always-show floor. The rows (Other included) reconcile to the headline — a table whose rows
  do not add up is its own bug, and the suite asserts it to within a cent per displayed row.
- **`t` (TeacherGPT) and `f` (the seeder) added to `usageRow`.** `t` is the pre-existing bug the
  last session flagged and left for its owner: `logUsage` wrote `t_*` faithfully and nothing ever
  read it back, so that row always showed zero however much Opus it had burned. Picked up here on
  request.
- Fixed while measuring: `sum()` did `a + d[k]`, so a day's document missing a bucket rendered the
  whole column as **NaN**. The `|| 0` there is load-bearing, not defensive habit.
- BEFORE → AFTER on the same fixture month: **11 rows (five of them reading "0 requests"), $4.51,
  story mislabelled "Haiku 4.5", no seeder row at all** → **five rows + Other, $6.00, every row
  naming the model that did the work**. Plates `shots/st_usage_{before,after}{,_mobile}.png`;
  390px verified (main's `scrollWrap` work intact, the page never scrolls sideways).

## ⚠️ LATENCY — the thing to watch after deploy
Measured through the real function, streamed:

| | TTFB | total | words | choices |
|---|---|---|---|---|
| **grok-4.5** | 4.0–13.2s | **23–29s** | 478–536 | 3 ✓ |
| **haiku** (fallback) | 0.7–1.6s | 12.2s | 622–730 | 3 ✓ |
| **Fable seeder** | **~14s** | **~52s** | (a whole world) | — |

**Netlify documents a 10-second synchronous function limit, and says a streaming response STOPS
when it is reached.** The live app has been serving ~12s Haiku scenes successfully, so the
effective limit on this deployment is demonstrably higher than the documented one — but nobody has
proven it is higher than 29s, and the seeder at ~52s is the biggest exposure. Mitigations are
already in place: the repair pass recovers a cut-off scene whatever cut it, and
`seedLedgerWithAI` now has a **75s AbortController timeout** whose expiry is just another
fail-open (the story starts on the ordinary pack/empty ledger). If Grok proves too slow in
production the rollback is one env var: `STORY_PROVIDER=haiku`. Grok also writes noticeably
SHORTER scenes than Haiku (478–536 vs 622–730 words) — worth reading a few before concluding it is
the better narrator for the kids.

## 🔑 NETLIFY ENV VARS THE USER MUST SET BY HAND
Exactly **one**, on purpose — everything else is a code-side default, so shipping the code and
enabling the feature are one step rather than two:
- **`XAI_API_KEY`** — from console.x.ai. **Without it the site still works**, on Haiku, silently.
Nothing else is needed. `STORY_PROVIDER`, `STORY_SEED_PROVIDER` and `KEEPER_PROVIDER` all default
correctly in code and exist only as overrides and rollbacks.

## Verified
storyledger **602/602** · kidstory-server **54/54** · dnd-server **47/47** · news **157/157** ·
fitness **253/253** = **1,113 checks, 0 page errors**. New suite sections: A16 (Grok default +
the outage fallback), A17 (the grant), A18 (the repair directive), A19 (usage buckets), M (repair
in the browser), N (the grant UI), O (the dashboard).
**RESTAGED, each with its reason recorded in the file, never bent**: story `maxTokens` 1200 →
1600; the seeder's "dormant by default" block → "on by default, and still switchable off"; "grok
with no key fails loudly" → "degrades to Anthropic" (no-key is the state every deploy is in until
the key is added, and a reader must never meet it); the keeper-independence check now pins the
NARRATOR to Haiku and proves the keeper stays on Grok (the old form was really asserting the old
haiku-by-default narrator); and kidstory-server's "big-kid story unchanged (Haiku, 1200 tok)" →
1600 tokens with Haiku as the fallback.
LIVE, against real Fable + real Grok + real Haiku, with a fake Firestore so nothing touched the
family's data: `node tools/_probe-storyship.mjs [--gate seed|narrate|grant|fallback]` — 6/6,
12/12, 16/16, 5/5.

**TEST-HARNESS NOTE worth keeping**: the suite's fake Firestore grew a real document store — it
honours increments AND the `exists:false` precondition — because "once per day" cannot be
demonstrated against a mock that accepts every write. That is the same lesson the activity
field-path bug taught two entries above: a mock more permissive than the real service manufactures
confidence. Also, `clearFlags()` does NOT clear `XAI_API_KEY`, so any section that wants to read
the narrator's prompt off the Anthropic fake has to delete it first — three checks failed on that
alone.

**KNOWN / DEFERRED**: a repair sends no `user`, so Dad's Story Log keeps the TRUNCATED half of a
repaired scene (what the model genuinely produced) while the reader saw the mended one; the grant
is five scenes and once a day, with both numbers as server constants rather than settings; and the
seeder's ~14s time-to-first-byte is the one number to re-check on the real host after deploy.

---

# ⏳ STORY TIME — THE WORLD-CREATION WAIT SCREEN (2026-08-04, UNPUSHED)

User: *"because Fable takes some serious time to set up, the user doesnt really know to wait and
might get frustrated, a status bar would be helpful or even show the blank page and say the story
world is being created, please wait."* Files: `farmgpt.html` (a new view, a new module, a streamed
seeder) and `tools/_verify-storyledger.cjs` (602 → **683**), plus a new live probe
`tools/_probe-storyworld.mjs`.

## The rule the screen is built on: IT MAY NOT LIE
Every stage transition and every millimetre the bar moves is a REAL event — a request opening, a
character finishing, the first word of the story arriving. The bar is stages FINISHED over stages
total, so it is structurally incapable of moving without one. The only thing on screen that moves
on its own is the pulsing dot beside the running stage, and it claims nothing except "alive".
Stages are chosen from what will ACTUALLY happen: no pack, no notes stage; the seeder switched
off, no world stage. A bar over stages that were never going to run is the first way a progress
screen lies.

## THE SEEDER IS READ AS A STREAM NOW — that is what made the screen interesting
`seedLedgerWithAI` used to `await resp.text()`. The server already streams every model mode as
`text/plain`, so buffering threw away every event in the ~40s between the request and the world,
and those events are the only honest progress this screen has. It now reads the body with a
reader and calls back on two things: the FIRST BYTE (Fable thinks before it writes), and each
character or place the moment it is finished — `partialArrayObjects(raw, key)` walks balanced
braces inside a half-written JSON document and returns only the complete objects, so a name
appears on screen the instant the world-builder finishes writing it. Falls back to a plain read
where no body reader exists. The scanner is scoped BY KEY and is only ever called for
`characters` and `locations`, so it never walks `player_knowledge` at all.

## HOW SECRETS ARE GUARANTEED NOT TO LEAK
The seeder's whole point is planted secrets, so a leak here would destroy the feature. Three
layers, and the third is the one that earns its keep:
1. **An ALLOWLIST, not a denylist.** `WORLD_SAFE_FIELDS = {characters:["name","role"],
   locations:["name"]}`, read by name. Nothing is spread, nothing is iterated generically.
   `hidden_from_player` and `open_threads` are never read for display — only COUNTED, and a count
   ("3 secrets hidden for you to find") teases without telling, which is the nicest line on the
   screen.
2. **A phrase scrub.** `role` is model-written and CAN come back carrying a secret's own wording.
   Any candidate sharing a run of 4 consecutive words with a hidden secret or an open thread is
   dropped. WORD RUNS, not single words — a character's name appears inside their own secret
   constantly, and dropping the name would delete the feature to protect nothing. The suite's
   fixture plants the secret verbatim as a character's `role`: the allowlist alone does not save
   you there, the scrub does.
3. **Mid-stream, names only.** When a character arrives the secrets usually have not (they are
   written last), so there is nothing to scrub a `role` against. Streaming shows the NAME alone;
   the roles fill in at the end from the finished world, when the scrub has the whole list. A
   second beat, and provably safe rather than carefully safe.

The test is not "we filtered it": a sentinel watches every DOM mutation AND polls the painted text
every 25ms for the whole run, and the assertion is that the planted string was on screen zero
times over ~3,000 sampled frames. The live probe runs the same sentinel against real secrets.

## THE HANDOFF — the screen dies on the first word, not the last
`streamChapter` gained `opts.onFirstToken`, fired on the first chunk carrying visible prose. The
wait screen owns the storyteller's stage too and tears down the moment there are words, so it is
up exactly as long as there is nothing to read. For an opening scene the first readable text is
the chapter's own title, one chunk ahead of the prose — that is the right moment: the instant
there are words the child should be looking at them. It is a VIEW, not an overlay (`show()`
toggles views mutually exclusive), so it is structurally incapable of ending up painted on top of
scene one, and awaiting `streamChapter` in a `try/finally` covers the error path — a scene that
never arrives still lands the reader in the book with the storyteller's own toast.

## THE UNHAPPY PATHS ALL END IN A STORY
The seeder already fails open; the screen matches. A server error, a seeder switched off
server-side, a world that comes back as nonsense, a hung request — all of them simply mean less
to show, never an error a child can act on. `WORLD_SEED_DEADLINE_MS = SEED_TIMEOUT_MS + 4000`
races the seed at the FLOW level, so the screen can never outlive the seeder's own abort even if
something upstream wedges (the suite shrinks both clocks and exercises it for real rather than
asserting about constants). Backing out mid-build cancels: the screen's own 46px button and the
header link both abort the request and return to setup with no half-made story and nothing on the
shelf. Once the first page is being written the cancel goes away rather than lying about what it
can do — that request is in flight and already logged.

## MEASURED LIVE — what the child actually experiences
`node tools/_probe-storyworld.mjs [--runs N] [--universe httyd]` drives the real page through a
real creation against real Fable + real Grok (Firestore dead-hosted; the probe is Dad, so it
neither counts against the cap nor writes to the Story Log). Elapsed from the Begin tap:

| | original world (3 runs) | with the HTTYD pack |
|---|---|---|
| Fable's first byte | 4.5 / 5.2 / **21.0**s | 18.6–35.6s |
| first NAME on screen | 13.1 / 13.8 / **28.0**s | 24.4s |
| world finished | 39.7 / 43.6 / 53.4s | 41.9s |
| FIRST WORD (into the book) | 47.7 / 63.0 / 57.9s | 46.0s |
| scene finished streaming | 62.3 / 85.0 / 79.8s | 72.1s |

**Fable thinks for 4–21s on an original world and 18–36s on a packed one** (23KB of established
canon to read first), then writes for another 20–38s. Grok reaches its first word in 4–19s.
So: **~13–28s before there is anything to look at, ~46–63s to the first word, ~62–86s to a
finished opening scene.** Two design decisions came straight out of those numbers.
- **The reassurance ladder is SPLIT per phase** (`pre` at 9s and 25s, `post` at 18s and 40s from
  the first byte). One ladder would have described thinking while it was writing, or the reverse
  — a screen saying the wrong thing about what is happening is exactly what this set out not to
  do. `note()` swaps ladders on the real event. Reassurance never touches the bar.
- **The cast is capped at 8 characters and 4 places, with "…and 16 more to meet"** — the real
  HTTYD pack seeds 24 characters and unbounded that is a wall of names burying the once-only line
  and the way out under a scroll. Caught by a live run, not by reasoning.

## THREE BUGS THE WORK FOUND
1. **`paint()` discarded the stage's sub-line**, so any repaint put the generic text back over
   what a real event had just said — a screen that forgets what it told you reads as broken. The
   notes live in module state now and `paint()` reads them.
2. **Duplicate cast entries.** A pack names its people and the seeder is told not to name them
   again, but a model that does anyway put Bramblewick on screen twice. `worldReveal` dedupes by
   lowercased name, first entry (the pack's better wording) winning. Caught by a SCREENSHOT, not
   a test.
3. The reader's own entry read as *"Wren — the hero of this story — the reader's own character"*.
   It is now **"Wren — that's you!"**, sorted to the top of the cast; seeing your own name first
   is the best thing on the screen.

## Verified
storyledger **683/683** (was 602 — 81 new checks, every original one still green) ·
kidstory-server **54/54** · dnd-server **47/47**, 0 page errors. New section **P**: the filter
(allowlist, the phrase scrub, the planted-role trap, dedupe, the cap, counts-not-text), the
partial-JSON scanner, the live screen against a REAL chunked response served by the suite's own
static server (puppeteer's `req.respond` can only hand back a finished body, so the server grew a
scriptable `/.netlify/functions/farmgpt` route — armed only when a plan is set, so every other
section 404s on that path exactly as it always did), every unhappy path, the deadline for real,
cancel, "not on resume", 390px + desktop, and `prefers-reduced-motion`.
LIVE: `node tools/_probe-storyworld.mjs` — 4 real creations, all clean, 0 secrets on screen over
~12,000 sampled frames.
Shots: `shots/st_world_{mid_390,mid_desktop,handoff_390,handoff_desktop}.png`.

**KNOWN / DEFERRED**: the ~13–28s before the first name is the honest floor of a single
non-streamed thinking phase — the only way to shorten it is a faster seeder or a two-call seed
(cast first, then the rest), and neither is worth doing before the family has used this; the
handoff fires on the chapter TITLE, which then jumps from the body into the divider when the
scene finishes parsing (pre-existing streaming behaviour, now simply visible a beat earlier); and
`SEED_TIMEOUT_MS`/`WORLD_SEED_DEADLINE_MS` are `let` so the suite can shrink them, which means a
devtools reader could too — harmless, and the alternative was asserting about constants instead
of exercising the path.

---
