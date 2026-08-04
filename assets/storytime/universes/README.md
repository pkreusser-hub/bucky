# Story Time universe packs

A **pack** is a partial ledger that seeds a new Story Time story so the reader's world
starts out already knowing itself — who everyone is, how they talk, what they can and
cannot know, and how the universe's rules work. Packs exist because Story Time kept
getting franchise facts wrong: the kids noticed wrong character details and wrong
lightsaber mechanics. **Pack accuracy is the product.** Every factual claim below was
web-verified during authoring; sources are listed per pack.

## Format

Each `<id>.json` is the **pack subset** of Ledger schema v1 — `meta.timeline_point`,
`canon[]`, `characters[]`, `relationships[]`, `locations[]`. The schema itself, the rules
that govern it (canon is append-only; precedence is FAMILY_RULES > reader > pack > story;
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

Current: **928/928 checks green.** A 14-case negative test (deliberately corrupted packs)
confirmed each rule actually fires rather than passing vacuously.

## Size, and the ledger budget

The number that matters is the **minified seed**, because that is what the story's ledger
starts at and it counts against the server's ~30 KB ledger cap.

| pack | seed | characters | canon | relationships | locations |
|---|---|---|---|---|---|
| `httyd.json` | 22.7 KB | 22 | 17 | 7 | 5 |
| `starwars.json` | 9.5 KB | 3 | 25 | 3 | 3 |

**HTTYD is over the 4–8 KB that was hoped for, and that is a real trade-off, not an
oversight.** Twenty-two characters — six riders, their six dragons, Stoick, Gobber,
Heather and Windshear, Dagur and Sleuther, Mala, and the four antagonists — each carrying
eight prose fields plus JSON keys has a floor near 16 KB however tightly it is worded.
The prose was cut twice; what remains is `voice`, `status` (the timeline point's actual
payload) and the knowledge buckets, which are the three things the pack exists to fix.
Trimming further would mean dropping characters or dropping `voice`, and both were
explicitly asked for.

**For the engine:** 22.7 KB leaves ~7 KB of headroom under a 30 KB cap, which is tight.
Two easy outs if it bites — seed only the characters a story actually touches and admit
the rest on first mention, or let the planned compaction step (plan doc, build step 5)
collapse dormant characters. Flagged rather than solved here because it is the engine's
call, not the pack's.

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
