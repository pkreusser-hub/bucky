# Story Time universe packs

A **pack** is a partial ledger that seeds a new Story Time story so the reader's world
starts out already knowing itself — who everyone is, how they talk, what they can and
cannot know, and how the universe's rules work. Packs exist because Story Time kept
getting franchise facts wrong: the kids noticed wrong character details and wrong
lightsaber mechanics. **Pack accuracy is the product.** Every factual claim below was
web-verified during authoring; sources are listed per pack.

## Schema v2 (2026-08-22) — packs are now the ONLY copy

The server used to hold a second set of these facts (`UNIVERSE_BIBLES` in
`netlify/functions/farmgpt.mjs`), injected into every scene's prompt. A ledger HTTYD scene was
paying for both. The bibles are deleted; their facts were folded in here, and two `meta` fields
carry what the server needed from them:

- **`meta.triggers`** — the detection regex SOURCE, as a string, compiled with `"i"`. Selects this
  pack from a story's setup text when the reader taps no chip, and keeps a legacy (pre-ledger)
  story attached to its universe. **A chip pick always wins over detection.**
- **`meta.eras`** — `{ default, list: [{ id, label, timeline_point, triggers, canon_add,
  canon_remove, characters_add, character_overrides, locations_add }] }`. An era is a set of
  overrides applied to this pack **before** it seeds a ledger, so one file can hold *the end of
  Race to the Edge* and *after the third film* without two copies of the cast. The Fable seeder
  picks the era from the setup text (constrained to these ids); each era's own `triggers` is the
  fallback. `character_overrides` may touch only
  `role`/`status`/`knows`/`does_not_know`/`last_seen`/`physical`/`motivation` — the validator
  rejects anything else, and never lets an era rewrite a `voice`.

Canon `source` gains **`"family"`** at the ledger level (never in a pack file): the readers' own
creations, seeded from Firestore at story creation. Precedence is now
**FAMILY_RULES > reader > family > pack > story**.

## Format

Each `<id>.json` is the **pack subset** of Ledger schema v1 — `meta.timeline_point`,
`canon[]`, `characters[]`, `relationships[]`, `locations[]`. The schema itself, the rules
that govern it (canon is append-only; precedence is FAMILY_RULES > reader > family > pack > story;
`player_knowledge` gating) and how a pack seeds a story live in
**`storytime-continuity-plan.md`** at the repo root — read that first, this file does not
restate it.

Pack-specific conventions, on top of the schema:

- `origin` is always `"pack"`, `source` is always `"pack"`, and every `turn` /
  `changed_turn` / `last_seen.turn` is `0` — a pack is the state of the world before
  turn one. The reader's own character is added later by the engine with
  `origin: "reader"`.
- **The pack file is never mutated by play.** A story gets a *copy* in its ledger, and a
  reader assertion may override a pack fact inside that copy only.
- `voice` is a line of style guidance, not a description — it is what stops characters
  drifting into sounding the same. Dragons have `voice` too; theirs says *how they
  communicate* ("does not speak — warbles, croons…"), which is the instruction the
  narrator needs.
- **`knows` / `does_not_know` are the dramatic irony.** A fact the audience of later
  films knows but these characters do not goes in `does_not_know`, never in `knows`.
  This is the bucket most worth getting right and the easiest to get wrong.
- One sentence per `canon[].rule`. The validator enforces it.
- Tone is kid-appropriate throughout (FAMILY_RULES). Deaths that canon requires are
  acknowledged plainly and gently, without violence.

## Validating

```
node assets/storytime/universes/_validate.mjs             # every pack
node assets/storytime/universes/_validate.mjs httyd.json  # one pack
```

Exit 0 = clean. It checks JSON parses, the schema subset is complete, no field is empty,
ids are unique and well-formed (`C*` / `CH*` / `L*`), canon rules are single sentences,
pack turns are 0, there are no stray top-level keys, and the **seed size** fits under the
server's ledger cap. Reusable by future packs — add a `.json` here and it is picked up.

Current: **1857/1857 checks green** across four packs. A 14-case negative test (deliberately
corrupted packs) confirmed each rule actually fires rather than passing vacuously. Schema v2 added
checks for `meta.triggers` (compiles, does not match the empty string, matches the pack's own
title) and `meta.eras` (ids unique and lowercase, default is a real id, each era's regex compiles,
`canon_remove` names an id the pack actually has, `character_overrides` names a real character and
touches only the whitelisted fields, nothing carries a hand-written `id`).

## Size, and the ledger budget

The number that matters is the **minified seed**, because that is what the story's ledger
starts at and it counts against the server's ~30 KB ledger cap. Since schema v2 the seed is
measured **per era**, and `meta.triggers` / `meta.eras` are excluded — they never ride the ledger,
so the file on disk is now bigger than the seed it produces.

| pack | seed | characters | canon | relationships | locations |
|---|---|---|---|---|---|
| `httyd.json` (`rtte`, default) | 25.7 KB | 23 | 18 | 7 | 5 |
| `httyd.json` (`post_httyd3`) | **27.4 KB** | 26 | 21 | 7 | 6 |
| `mario.json` | 17.1 KB | 12 | 19 | 5 | 6 |
| `starwars.json` | 11.0 KB | 3 | 32 | 3 | 3 |
| `pokemon.json` | 8.8 KB | 5 | 16 | 3 | 3 |

**HTTYD is over the 4–8 KB that was hoped for, and that is a real trade-off, not an
oversight.** Twenty-plus characters — six riders, their six dragons, Stoick and Skullcrusher,
Gobber, Heather and Windshear, Dagur and Sleuther, Mala, and the antagonists — each carrying
eight prose fields plus JSON keys has a floor near 16 KB however tightly it is worded.
The prose was cut twice; what remains is `voice`, `status` (the timeline point's actual
payload) and the knowledge buckets, which are the three things the pack exists to fix.
Trimming further would mean dropping characters or dropping `voice`, and both were
explicitly asked for.

**For the engine:** the worst era leaves **2.6 KB** of headroom under a 30 KB cap, which is
tight. Getting there already cost three walk-on parts — Gustav, Fanghook and Cloudjumper were
folded in from the server's old bibles and then cut again, because three walk-ons are cheaper to
lose than Valka, the Light Fury or Grimmel; Cloudjumper survives inside Valka's own sheet. The
next era that adds a cast needs the compaction step (plan doc, build step 5), not more trimming.

---

## `httyd.json` — How To Train Your Dragon

**Timeline point: the conclusion of *Race to the Edge*, before *How To Train Your Dragon 2*.**
Every status is true as of the end of the series, not the films. This is the user's spec.

The subtleties the timeline point exists to protect — all of them things a model will get
wrong if left to average the whole franchise together:

- **Hiccup believes his mother Valka is dead.** So does Stoick. It is in both their
  `does_not_know`.
- **Toothless is believed the last Night Fury** — by everyone including himself. No Light
  Fury, no Hidden World.
- **Hiccup is not chief.** Stoick is alive and still chief, and the succession is an
  unspoken question between them.
- **Hiccup and Astrid are openly a couple, and are not engaged.** The finale's epilogue
  frames a wedding that turns out to be Dagur and Mala's, not theirs.
- **Berk is at peace with dragons**, and the Riders have moved home; Dragon's Edge stands
  empty.
- **Dagur is redeemed** — an ally, married to Mala, ruling the Berserkers with her.
- **Both Dragon Eyes are destroyed**, on Hiccup's own order, so no map can lead a hunter
  to Vanaheim.

Antagonist statuses at series end, which are the most commonly misremembered facts here:

| who | status |
|---|---|
| Viggo Grimborn | dead — betrayed by Johann, he turned on his old partners and died so Hiccup and Toothless could escape |
| Ryker Grimborn | dead — his ship was dragged under by a Submaripper during the battle over the Shellfire |
| Johann | dead — frozen by the Bewilderbeast, the true King of Dragons, as he moved against Hiccup |
| Krogan | **alive** — driven off by Toothless, he leapt from the cliff and escaped without a trace |

**Sources consulted:** the How to Train Your Dragon Wiki and Race to the Edge Wiki
(Fandom) entries for Viggo Grimborn, Ryker Grimborn, Krogan, Johann, Dagur the Deranged,
Heather, Stoick the Vast, Night Fury, Toothless, Inferno, Hiccup's Flightsuit, Dragon Eye
II, Dragon's Edge, and the episode pages for *King of Dragons, Part 2* and *Shell
Shocked, Part 2*; TV Tropes recaps of those two episodes; Wikipedia's *DreamWorks
Dragons* article for season/episode ordering.

**Judgment calls:**

- **Krogan lives.** He is often remembered as dying in the finale. The wiki accounts
  agree he is beaten off by Toothless and escapes off the cliff with his fate left open,
  so he is `alive but vanished` — which is also the more useful seed, since he is the one
  RTTE villain a new story can still use.
- **Toothless's shot limit** is written as "Hiccup counts him at about six", which is what
  Hiccup states in-universe. Episodes have shown him firing well past that; the hedge
  keeps the kid-expectation reading without asserting a hard number the show contradicts.
- **Toothless cannot fly without his rider.** Automatic tail fins exist at points in the
  wider franchise; the pack states the rule the family expects and the films lean on.
- **Deaths are stated plainly and gently** — how each person died, no violence on the
  page. Their `knows` / `does_not_know` read "nothing further — his story is finished"
  rather than being left empty, so the narrator cannot mistake an absent field for an
  unknown one.
- **Drago Bludvist** is in Stoick's `knows` (he met him years before, per HTTYD 2's
  flashback) and in Hiccup's `does_not_know`. It is the sharpest piece of dramatic irony
  available at this timeline point.

---

## `starwars.json` — Star Wars

**Rules-focused by request, not a cast dump.** Twenty-five canon entries covering how the
Force works and how lightsabers work, which is where the family's accuracy complaints
actually landed. `characters[]` is deliberately minimal — the Jedi and the Sith are
described as *institutions* in `canon`, not as character entries.

**Timeline point: era-agnostic.** The pack does not pick an era. The reader sets one in
their story setup if they want one ("during the Clone Wars", "after the Empire falls"),
and the three marquee characters included — Yoda, Obi-Wan Kenobi, Darth Vader — carry
their era inside `status` so a story set before the Empire correctly has no Vader in it.

Rules coverage: the Force as an energy field created by all life · inborn sensitivity and
midi-chlorians · training over raw talent · calm over grabbing · what feeds the light and
the dark · falling as a gradual choice and return being possible · telekinesis · enhanced
reflexes and leaps · sensing life and danger · visions showing one possible future ·
the mind trick, who resists it (Hutts, Toydarians) and why it never works on droids ·
steadying and healing others · dark powers and their cost · the Jedi and the Sith,
including the Rule of Two · kyber crystals as the living heart of a blade · attunement
and colour · bleeding a crystal red and healing it back · building your own saber as a
rite of passage · what a blade cuts · **what resists it — beskar, cortosis, phrik** ·
blades locking against each other and deflecting blaster bolts · and why training is
about safety before duelling.

**Sources consulted:** Wookieepedia entries for The Force, Force-sensitive,
Midi-chlorian, Mind trick, Kyber crystal, Bleeding, Cortosis, and the
lightsaber-resistant materials category; StarWars.com's article on cortosis and beskar.

**Judgment calls:**

- **Canon over Legends** wherever the two differ, since that is what the kids have
  watched. Cortosis is written as *shorting a blade out* (the canon behaviour) rather
  than the Legends variants.
- **Midi-chlorians are mentioned once**, framed as the sign of sensitivity "in the
  films", so the pack matches what the kids have seen without turning the Force into
  biology.
- **The dark side's cost is moral, not gory** — power that grips the person using it.
  Corruption is a choice made in small steps, and coming back is possible; that framing
  is deliberate for this audience.
- **Only three characters, all era-flagged.** Any more and the pack starts asserting an
  era it was asked not to pick.

---

## `httyd.json` — the `post_httyd3` era (added 2026-08-22)

The default era is still the end of *Race to the Edge*, exactly as specified above. It gained a
second one because a real reader's stories were set after the third film while the pack insisted
Stoick was alive — and her August 2–3 redos were her correcting those timeline facts by hand.

**`post_httyd3` — "after How To Train Your Dragon 3: Grimmel is beaten, the Hidden World is
known, and Hiccup is Chief of Berk."** What the era overrides, and nothing else:

| who | becomes |
|---|---|
| Stoick the Vast | dead — he stepped in front of a blast meant for Hiccup; Berk gave him a chief's farewell and Hiccup carries his helmet |
| Hiccup | Chief of Berk, married to Astrid; now KNOWS Valka is alive, that Toothless is not the last Night Fury, and where the Hidden World is |
| Astrid | married to Hiccup, the Chief's steadiest counsel |
| Toothless | Alpha of all dragons, mated to the Light Fury, no longer the last of his kind |
| *added* | Valka · the Light Fury · Grimmel the Grisly (beaten and gone) |
| *added place* | the Hidden World |
| canon removed | C15, "the mightiest Alpha the Riders have seen is a Bewilderbeast" |
| canon added | Toothless is the Alpha · a Light Fury's invisibility · the Hidden World · Hiccup is chief |

**Judgment calls:**

- **The dragons have NOT left.** The third film ends with them going to the Hidden World, which
  would mean a dragon-riding story with no dragons in it. The era places the Hidden World as a
  known, findable place and leaves Toothless and the Light Fury moving between it and Berk. This
  is the era a nine-year-old is asking for when she says "after the third movie" — she wants
  Grimmel and Light Furies, not an epilogue.
- **How Stoick died is stated plainly and gently**, in one clause, with no violence on the page —
  the same rule the RTTE antagonists' deaths follow.
- **Grimmel is beaten and gone, not dead.** The films leave him falling; "gone" is both true to
  what is shown and the more useful seed.
- **The Valka reunion is settled, not pending.** She is home and widowed. A story that has to
  re-run the reunion before it can start is a story that cannot start.

**Sources consulted:** the How to Train Your Dragon Wiki entries for *How to Train Your Dragon:
The Hidden World*, Grimmel the Grisly, Light Fury, Valka, Cloudjumper, Stoick the Vast and the
Hidden World.

---

## `mario.json` — Super Mario

**Isaac's universe, and the reason this merge happened at all.** He wrote ~140 Mario scenes in a
fortnight and neither system knew his actual favourites: the packs had no Mario file, and the
server's bible had generic Mushroom Kingdom facts — Goombas, warp pipes, Bowser — and nothing
about the two Mario & Luigi RPG villains he keeps writing stories about.

19 canon rules, 12 characters, 6 locations. The rules are the ones a story can actually break:
**nobody is ever truly killed** (a defeated enemy poofs, a defeated hero loses a life), jumping is
the answer, each power-up and exactly what it does, question-mark blocks, warp pipes, every common
enemy's one trick, Yoshi's tongue and eggs, Yoshi says only "Yoshi!", cartoon danger, kart racing,
**the Dream World's rule that whatever Luigi dreams is really there**, brothers fight better
together, **Concordia's bonds are a real power**, and **Rabbids are chaos in rabbit form**.

The three entries the pack was written for:

- **Antasma** (*Mario & Luigi: Dream Team*) — the bat king of the Dream World who feeds on
  nightmares, shifts between a bat, a gas cloud and a battle form, and speaks in a Dracula drawl
  full of hissing v-sounds broken by bat screeches. Status: **beaten** — Mario defeated him inside
  the Dream World and he burst like a balloon, after Bowser betrayed him. Whether anything is left
  of him is deliberately left open, because that is where a new story starts.
- **Reclusa** (*Mario & Luigi: Brothership*) — the true final antagonist: a red legless figure in
  a purple robe and gold gauntlets with a boxy old television for a head, its screen showing
  yellow and blue eyes and a red triangle mouth that changes with his mood. He despises bonds and
  tried to enforce isolation across Concordia. Status: **gone**, beaten by the strength of every
  bond the brothers had gathered, still not understanding it.
- **The Rabbids** — Rabbid Peach (who found a picture of the Princess and decided to be her, and
  is never without her phone) and Rabbid Luigi (the gloomiest Rabbid alive). They shriek "Bwaah!"
  rather than speaking, and mean no harm by any of it.

**Sources consulted:** Super Mario Wiki entries for Antasma, Reclusa, Rabbid, Power-up,
*Mario & Luigi: Dream Team* and *Mario & Luigi: Brothership*.

**Judgment calls:**

- **Both RPG villains are seeded as BEATEN, not active.** Isaac's stories are set after the games
  he has played, and a villain who is already gone is far better fuel — "why does the Dozing Dunes
  shadow screech like a bat?" is a story; "Antasma attacks" is a recap. The live probe's seeder
  did exactly this unprompted.
- **Reclusa's TV head is described precisely** (the expressions, the frilly collar, the gold
  gauntlets) because that is the class of detail the kids correct.
- **The power-up rules name what each one DOES**, not what it is. "A Super Mushroom lets you take
  one hit" is playable; "a Super Mushroom makes you Super Mario" is a tautology.
- **Bowser is a rival, not a threat.** "Deadly serious in a castle, oddly companionable on a kart
  track" is the relationship the games actually have, and it is the one that keeps him usable.

---

## `pokemon.json` — Pokémon

16 canon rules, 5 characters, 3 locations. Rules-heavy for the same reason Star Wars is: the
complaints are about mechanics. **A Pokémon says only its own name** (with Meowth as the one
famous exception, stated explicitly so a story does not have to guess), a battle ends when a
Pokémon **faints** and is healed free at any Center, six to a belt, the type chart as the kids use
it, four moves at a time, the three-stage starter lines, **all eight of Eevee's evolutions with
their actual methods**, the Pokédex, gyms and badges, legendaries being met rather than caught,
Charizard's tail flame, and Team Rocket always blasting off harmlessly.

**Sources consulted:** Bulbapedia entries for Eevee and for Type.

**Judgment calls:**

- **Eevee gets its own rule with all eight methods.** It is the single most-asked Pokémon question
  in this house and the one a model most reliably gets half right.
- **Ash is not in the pack.** A named protagonist crowds out the reader's own trainer, which is
  the whole point of the story. Nurse Joy and the Team Rocket trio are in, because they are
  furniture a story leans on rather than a hero it competes with.
- **Fainting, never dying**, is canon rather than tone guidance, so a scene that tries to break it
  fails inside the story like any other canon violation.
