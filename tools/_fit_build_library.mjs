#!/usr/bin/env node
/**
 * BUCKY Fitness — exercise library bake.
 *
 * Pulls the free-exercise-db (Unlicense / public domain), scopes it down to what
 * Isaac and Eleanor can actually do at home, downscales both animation frames per
 * exercise, and writes a self-contained library into assets/fitness/ so a workout
 * never depends on the network mid-set.
 *
 *   node tools/_fit_build_library.mjs            # bake (skips images already on disk)
 *   node tools/_fit_build_library.mjs --force    # re-encode every image
 *   node tools/_fit_build_library.mjs --dry      # report what would be written, touch nothing
 *
 * Source: https://github.com/yuhonas/free-exercise-db
 *
 * WHY WEBP 600px: measured against the real photos — webp/600/q72 averages 12.5 KB,
 * the same total as jpeg/480/q76 but with 25% more resolution. See the header note in
 * assets/fitness/LICENSE.txt for the provenance we ship alongside the images.
 *
 * NOTE ON `equipment: null`: 76 non-expert entries carry a null equipment field. They
 * are all genuinely no-equipment movements (Mountain Climbers, walking lunges, and the
 * whole stretch catalogue). They are normalised to "none" and kept — the stretches are
 * what a warm-up / cool-down block is built from.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT = path.join(ROOT, "assets", "fitness");
const IMG_OUT = path.join(OUT, "img");

const SRC_JSON = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json";
const SRC_IMG = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/";

const IMG_WIDTH = 600;
const IMG_QUALITY = 72;
/* Mirrors of the app's budget constants, used only to PRINT each plan's length at bake
   time so a plan that drifts off ~10 minutes is visible here rather than in the game. */
const REP_SECS_EST = 3, MIN_REP_SECS_EST = 20, BLOCK_CARD_S_EST = 5;
const CONCURRENCY = 8;
const RETRIES = 3;

const FORCE = process.argv.includes("--force");
const DRY = process.argv.includes("--dry");

/* Equipment we actually have. `null` in the source means "nothing at all". */
const KEEP_EQUIPMENT = new Set([null, "body only", "dumbbell", "bands"]);

/* Movements a physio would flag for an unsupervised kid: loaded spinal flexion/extension
   and anything that loads the neck. Small and deliberate — everything else in scope stays. */
const EXCLUDE_IDS = new Set([
  "Band_Good_Morning",
  "Band_Good_Morning_Pull_Through",
  "Dumbbell_Clean",
  "Hyperextensions_With_No_Hyperextension_Bench",
  "Isometric_Neck_Exercise_-_Front_And_Back",
  "Isometric_Neck_Exercise_-_Sides",
  "Side_Neck_Stretch",
  "Chin_To_Chest_Stretch",
  "Stiff-Legged_Dumbbell_Deadlift",
]);

/* Muscle groups the picker shows, in the order it shows them. `label` is what a
   10-year-old reads; `muscles` are the source's own primaryMuscles values. */
const MUSCLE_GROUPS = [
  { id: "core",      label: "Core",        ico: "🎯", muscles: ["abdominals"] },
  { id: "chest",     label: "Chest",       ico: "💥", muscles: ["chest"] },
  // NOT 🔙 — that emoji renders as a literal "BACK" arrow and reads as navigation,
  // which is genuinely confusing sitting next to the picker's own "← Back" button.
  { id: "back",      label: "Back",        ico: "🧗", muscles: ["lats", "middle back", "lower back", "traps"] },
  { id: "shoulders", label: "Shoulders",   ico: "🙌", muscles: ["shoulders"] },
  { id: "arms",      label: "Arms",        ico: "💪", muscles: ["biceps", "triceps", "forearms"] },
  { id: "legs",      label: "Legs",        ico: "🦵", muscles: ["quadriceps", "hamstrings", "calves"] },
  { id: "glutes",    label: "Glutes",      ico: "🍑", muscles: ["glutes", "abductors", "adductors"] },
  { id: "other",     label: "Everything else", ico: "✨", muscles: [] },
];

const groupForMuscle = (m) =>
  (MUSCLE_GROUPS.find((g) => g.muscles.includes(m)) || MUSCLE_GROUPS[MUSCLE_GROUPS.length - 1]).id;

/* ---------------------------------------------------------------- default week */
/* 3 blocks x 3 exercises, ~40s work / 20s rest, lands ~9-10 min. Deliberately
   ZERO-EQUIPMENT so the very first workout needs nothing but floor space. Every id
   here is validated against the baked library before this file is written — a typo
   fails the bake rather than shipping a broken Monday. */
const DEFAULT_PLAN = {
  v: 1,
  rest: 20,
  days: {
    mon: {
      title: "Full Body",
      blocks: [
        { group: "core",   items: [ ["Plank", "time", 45], ["Crunches", "reps", 18], ["Mountain_Climbers", "time", 45] ] },
        { group: "chest",  items: [ ["Pushups", "reps", 12], ["Incline_Push-Up", "reps", 14], ["Bench_Dips", "reps", 12] ] },
        { group: "legs",   items: [ ["Bodyweight_Squat", "reps", 18], ["Star_Jump", "time", 45], ["Bodyweight_Walking_Lunge", "reps", 14] ] },
      ],
    },
    tue: {
      title: "Core & Cardio",
      blocks: [
        { group: "core",   items: [ ["Air_Bike", "reps", 20], ["Russian_Twist", "reps", 20], ["Side_Bridge", "time", 40] ] },
        { group: "legs",   items: [ ["Rocket_Jump", "reps", 14], ["Split_Jump", "reps", 14], ["Knee_Tuck_Jump", "reps", 12] ] },
        { group: "glutes", items: [ ["Butt_Lift_Bridge", "reps", 16], ["Glute_Kickback", "reps", 14], ["Flutter_Kicks", "time", 40] ] },
      ],
    },
    wed: {
      title: "Upper Body",
      blocks: [
        { group: "chest",  items: [ ["Pushups", "reps", 12], ["Push_Up_to_Side_Plank", "reps", 12], ["Decline_Push-Up", "reps", 10] ] },
        { group: "arms",   items: [ ["Bench_Dips", "reps", 14], ["Body-Up", "reps", 14], ["Push-Ups_-_Close_Triceps_Position", "reps", 10] ] },
        { group: "core",   items: [ ["Plank", "time", 45], ["Dead_Bug", "reps", 20], ["Cross-Body_Crunch", "reps", 20] ] },
      ],
    },
    thu: {
      title: "Legs & Glutes",
      blocks: [
        { group: "legs",   items: [ ["Bodyweight_Squat", "reps", 18], ["Bodyweight_Walking_Lunge", "reps", 16], ["Freehand_Jump_Squat", "reps", 14] ] },
        { group: "glutes", items: [ ["Single_Leg_Glute_Bridge", "reps", 14], ["Step-up_with_Knee_Raise", "reps", 14], ["Leg_Lift", "reps", 16] ] },
        { group: "core",   items: [ ["Mountain_Climbers", "time", 45], ["Bottoms_Up", "reps", 14], ["Plank", "time", 45] ] },
      ],
    },
    fri: {
      title: "Full Body",
      blocks: [
        { group: "core",   items: [ ["Crunches", "reps", 20], ["Butt-Ups", "reps", 14], ["Air_Bike", "reps", 20] ] },
        { group: "chest",  items: [ ["Push-Up_Wide", "reps", 12], ["Incline_Push-Up", "reps", 14], ["Isometric_Chest_Squeezes", "time", 35] ] },
        { group: "legs",   items: [ ["Star_Jump", "time", 45], ["Scissors_Jump", "reps", 16], ["Bodyweight_Squat", "reps", 16] ] },
      ],
    },
    sat: {
      title: "Play Day",
      blocks: [
        { group: "legs",   items: [ ["Fast_Skipping", "time", 50], ["Standing_Long_Jump", "reps", 10], ["Double_Leg_Butt_Kick", "time", 40] ] },
        { group: "core",   items: [ ["Mountain_Climbers", "time", 45], ["Plank", "time", 45], ["Superman", "reps", 16] ] },
        { group: "other",  items: [ ["Worlds_Greatest_Stretch", "time", 45], ["Hamstring_Stretch", "time", 40], ["Childs_Pose", "time", 40] ] },
      ],
    },
    sun: { rest: true, title: "Rest Day" },
  },
};

/* ---------------------------------------------------- the kids' own plans
   Written by Dad (2026-08-02), transcribed verbatim. Eleanor's is volleyball-leaning;
   Isaac's is the general-strength cut of the same programme. Five training days,
   Mon–Fri, with the weekend off.

   Item form here is [id, mode, amount, extra?] where extra may carry:
     side — the reps are PER SIDE. Doubles the time estimate (8 per leg is 16 reps of
            work) and is printed next to the number so nobody halves their sets.
     note — the range or the swap Dad wrote down, kept in his words.

   Every id is validated against the baked library before these files are written. */
const KID_PLANS = {
  Eleanor: {
    rest: 30,
    rounds: 2,
    days: {
      mon: { title: "Legs & Jump Power", group: "legs", focus: "Squatting strength and explosive power for blocking and spiking.", items: [
        ["Bodyweight_Squat", "reps", 10, { note: "10–12 reps" }],
        ["Freehand_Jump_Squat", "reps", 8, { note: "soft, controlled reps" }],
        ["Dumbbell_Lunges", "reps", 8, { side: "per leg", note: "bodyweight lunges are fine" }],
        ["Single_Leg_Glute_Bridge", "reps", 8, { side: "per leg" }],
        ["Standing_Dumbbell_Calf_Raise", "reps", 12, { note: "or bodyweight calf raises" }],
      ]},
      tue: { title: "Upper Body Push + Core", group: "chest", focus: "Pushing strength and trunk control for serving and posture.", items: [
        ["Incline_Push-Up", "reps", 8, { note: "8–10 · knees or a higher surface if needed" }],
        ["Band_Pull_Apart", "reps", 12, { note: "or slow arm openings" }],
        ["Dumbbell_Shoulder_Press", "reps", 8, { note: "8–10 · light dumbbells" }],
        ["Plank", "time", 20, { note: "20–30 seconds" }],
        ["Dead_Bug", "reps", 8, { side: "per side" }],
      ]},
      wed: { title: "Athletic Movement", group: "back", focus: "Hip stability, back strength and coordination.", items: [
        ["Inchworm", "reps", 6, { note: "6–8" }],
        ["Monster_Walk", "reps", 8, { side: "steps each way", note: "or side steps without a band" }],
        ["Glute_Kickback", "reps", 10, { side: "per leg" }],
        ["Bent_Over_Two-Dumbbell_Row", "reps", 10, { note: "or bodyweight Superman holds" }],
        ["Air_Bike", "reps", 12, { note: "slow reps" }],
      ]},
      thu: { title: "Shoulders, Back & Glutes", group: "shoulders", focus: "Shoulder health for overhead actions, and a strong posterior chain.", items: [
        ["Butt_Lift_Bridge", "reps", 12],
        ["Superman", "reps", 8, { note: "8–10 · hold 1–2 sec at the top" }],
        ["Side_Lateral_Raise", "reps", 10, { note: "or lateral raises with bands" }],
        ["One-Arm_Dumbbell_Row", "reps", 8, { side: "per arm" }],
        ["Plank", "time", 20, { note: "20–25 seconds · a short side plank works too" }],
      ]},
      fri: { title: "Core + Lateral Power", group: "core", focus: "Rotational core and side-to-side strength for court movement.", items: [
        ["Side_Leg_Raises", "reps", 10, { side: "per side" }],
        ["Cross-Body_Crunch", "reps", 12, { note: "or regular crunches" }],
        ["Hip_Circles_prone", "reps", 8, { side: "each direction", note: "8–10" }],
        ["Band_Pull_Apart", "reps", 10, { note: "10–12 · or side lateral raises" }],
        ["Bodyweight_Squat", "reps", 10, { note: "or light jump squats" }],
      ]},
      sat: { rest: true, title: "Rest Day" },
      sun: { rest: true, title: "Rest Day" },
    },
  },

  Isaac: {
    rest: 30,
    rounds: 2,
    days: {
      mon: { title: "Lower Body Strength & Power", group: "legs", items: [
        ["Bodyweight_Squat", "reps", 10, { note: "10–12 reps" }],
        ["Freehand_Jump_Squat", "reps", 8, { note: "soft, controlled reps" }],
        ["Dumbbell_Lunges", "reps", 8, { side: "per leg", note: "bodyweight lunges are fine" }],
        ["Single_Leg_Glute_Bridge", "reps", 8, { side: "per leg" }],
        ["Standing_Dumbbell_Calf_Raise", "reps", 12, { note: "or bodyweight" }],
      ]},
      tue: { title: "Upper Body Push + Core", group: "chest", items: [
        ["Pushups", "reps", 8, { note: "8–12 · knees or elevated hands if needed" }],
        ["Dumbbell_Shoulder_Press", "reps", 8, { note: "8–10 · light dumbbells, or the overhead press motion" }],
        ["Band_Pull_Apart", "reps", 12, { note: "or a slow reverse fly motion" }],
        ["Plank", "time", 20, { note: "20–30 seconds" }],
        ["Dead_Bug", "reps", 8, { side: "per side" }],
      ]},
      wed: { title: "Full-Body Athletic Movement", group: "back", items: [
        ["Inchworm", "reps", 6, { note: "6–8" }],
        ["Monster_Walk", "reps", 8, { side: "steps each way", note: "or side steps without a band" }],
        ["Glute_Kickback", "reps", 10, { side: "per leg" }],
        ["Bent_Over_Two-Dumbbell_Row", "reps", 10, { note: "or bodyweight Superman" }],
        ["Air_Bike", "reps", 12, { note: "controlled reps" }],
      ]},
      thu: { title: "Posterior Chain & Shoulders", group: "shoulders", items: [
        ["Butt_Lift_Bridge", "reps", 12],
        ["Superman", "reps", 8, { note: "8–10 · brief hold at the top" }],
        ["Side_Lateral_Raise", "reps", 10, { note: "or lateral raises with bands" }],
        ["One-Arm_Dumbbell_Row", "reps", 8, { side: "per arm", note: "8–10 · or the two-arm version" }],
        ["Plank", "time", 20, { note: "20–25 seconds · a short side plank works too" }],
      ]},
      fri: { title: "Core + Balanced Strength", group: "core", items: [
        ["Side_Leg_Raises", "reps", 10, { side: "per side" }],
        ["Cross-Body_Crunch", "reps", 12, { note: "or regular crunches" }],
        ["Hip_Circles_prone", "reps", 8, { side: "each direction", note: "8–10" }],
        ["Band_Pull_Apart", "reps", 10, { note: "10–12 · or side lateral raises" }],
        ["Bodyweight_Squat", "reps", 10, { note: "or light jump squats" }],
      ]},
      sat: { rest: true, title: "Rest Day" },
      sun: { rest: true, title: "Rest Day" },
    },
  },
};

/* ------------------------------------------------------------------- plumbing */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRetry(url, kind = "json") {
  let lastErr;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return kind === "json" ? await res.json() : Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
      if (attempt < RETRIES) await sleep(400 * attempt);
    }
  }
  throw new Error(`${url} failed after ${RETRIES} tries: ${lastErr.message}`);
}

/** Run `worker` over `items` with a fixed concurrency ceiling. */
async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await worker(items[i], i);
      }
    })
  );
  return results;
}

async function main() {
  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch (err) {
    console.error("✗ sharp is required for the image bake. Run `npm install` in tools/.");
    console.error("  " + err.message);
    process.exit(1);
  }

  console.log("→ fetching exercise index …");
  const all = await fetchRetry(SRC_JSON);
  console.log(`  ${all.length} exercises in source`);

  const kept = all
    .filter((x) => KEEP_EQUIPMENT.has(x.equipment ?? null))
    .filter((x) => x.level !== "expert")
    .filter((x) => !EXCLUDE_IDS.has(x.id))
    .filter((x) => Array.isArray(x.images) && x.images.length >= 2)
    .sort((a, b) => a.name.localeCompare(b.name));

  console.log(`  ${kept.length} kept (${all.length - kept.length} filtered out)`);

  /* Trimmed records — everything the UI reads, nothing it doesn't. */
  const library = kept.map((x) => {
    const primary = x.primaryMuscles || [];
    return {
      id: x.id,
      name: x.name,
      group: groupForMuscle(primary[0]),
      primary,
      secondary: x.secondaryMuscles || [],
      equipment: x.equipment || "none",
      level: x.level,
      category: x.category,
      force: x.force || null,
      mechanic: x.mechanic || null,
      steps: x.instructions || [],
    };
  });

  /* --- validate the default plan against what we actually kept, BEFORE writing --- */
  const byId = new Map(library.map((x) => [x.id, x]));
  const missing = [];
  for (const [dayKey, day] of Object.entries(DEFAULT_PLAN.days)) {
    if (day.rest) continue;
    for (const block of day.blocks) {
      for (const [id] of block.items) if (!byId.has(id)) missing.push(`${dayKey}: ${id}`);
    }
  }
  for (const [kid, kp] of Object.entries(KID_PLANS)){
    for (const [dayKey, day] of Object.entries(kp.days)){
      if (day.rest) continue;
      for (const [id] of day.items) if (!byId.has(id)) missing.push(`${kid}/${dayKey}: ${id}`);
    }
  }
  if (missing.length) {
    console.error("✗ a plan references exercises that are not in the library:");
    for (const m of missing) console.error("    " + m);
    process.exit(1);
  }
  console.log("  ✓ plans validated — every referenced exercise exists");

  /* Expand the compact tuple form into the shape index.html consumes. */
  const plan = {
    v: DEFAULT_PLAN.v,
    rest: DEFAULT_PLAN.rest,
    days: Object.fromEntries(
      Object.entries(DEFAULT_PLAN.days).map(([k, day]) => [
        k,
        day.rest
          ? { rest: true, title: day.title }
          : {
              title: day.title,
              blocks: day.blocks.map((b) => ({
                group: b.group,
                items: b.items.map(([id, mode, amount]) =>
                  mode === "time" ? { id, mode: "time", secs: amount } : { id, mode: "reps", reps: amount }
                ),
              })),
            },
      ])
    ),
  };

  if (DRY) {
    const counts = {};
    for (const x of library) counts[x.group] = (counts[x.group] || 0) + 1;
    console.log("\n--- dry run, nothing written ---");
    console.log("  library:", library.length, "exercises");
    console.log("  by group:", JSON.stringify(counts));
    console.log("  images that would be fetched:", library.length * 2);
    return;
  }

  fs.mkdirSync(IMG_OUT, { recursive: true });

  /* ------------------------------------------------------------- images */
  const jobs = [];
  for (const x of kept) {
    for (let frame = 0; frame < 2; frame++) {
      jobs.push({ id: x.id, frame, src: x.images[frame] });
    }
  }

  let done = 0, skipped = 0, written = 0, bytes = 0;
  const failures = [];

  await pool(jobs, CONCURRENCY, async (job) => {
    const dir = path.join(IMG_OUT, job.id);
    const dest = path.join(dir, `${job.frame}.webp`);

    if (!FORCE && fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      skipped++; bytes += fs.statSync(dest).size;
    } else {
      try {
        const raw = await fetchRetry(SRC_IMG + job.src, "bin");
        const out = await sharp(raw).resize({ width: IMG_WIDTH, withoutEnlargement: true })
                                    .webp({ quality: IMG_QUALITY })
                                    .toBuffer();
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(dest, out);
        written++; bytes += out.length;
      } catch (err) {
        failures.push(`${job.id}/${job.frame}: ${err.message}`);
      }
    }
    done++;
    if (done % 100 === 0 || done === jobs.length) {
      process.stdout.write(`\r  images ${done}/${jobs.length} (new ${written}, cached ${skipped}, failed ${failures.length})   `);
    }
  });
  process.stdout.write("\n");

  if (failures.length) {
    console.error(`✗ ${failures.length} image(s) failed:`);
    for (const f of failures.slice(0, 20)) console.error("    " + f);
    console.error("  Re-run to retry just the missing ones (existing files are skipped).");
    process.exit(1);
  }

  /* -------------------------------------------------------------- manifests */
  fs.writeFileSync(path.join(OUT, "exercises.json"),
    JSON.stringify({ v: 1, groups: MUSCLE_GROUPS.map(({ id, label, ico }) => ({ id, label, ico })), exercises: library }));

  fs.writeFileSync(path.join(OUT, "default-plan.json"), JSON.stringify(plan, null, 1));

  /* Per-kid plans. These are the DEFAULT content of that kid's own plan — the app falls
     back to them when Dad hasn't saved an override, so Isaac and Eleanor arrive with
     their real programme rather than the generic shared week. */
  const estimate = (it) => {
    const base = it.mode === "time" ? it.secs : Math.max(MIN_REP_SECS_EST, it.reps * REP_SECS_EST);
    return it.side ? base * 2 : base;
  };
  for (const [kid, kp] of Object.entries(KID_PLANS)){
    const rounds = kp.rounds || 1;
    const out = { v: 1, rest: kp.rest, forKid: kid, days: {} };
    for (const [dayKey, day] of Object.entries(kp.days)){
      if (day.rest){ out.days[dayKey] = { rest: true, title: day.title }; continue; }
      out.days[dayKey] = {
        title: day.title,
        // A CIRCUIT: run the whole list, then run it again. 5 exercises x 2 rounds is
        // 10 sets with a rest between every one of them.
        rounds,
        blocks: [{
          group: day.group,
          label: day.title,
          focus: day.focus || undefined,
          items: day.items.map(([id, mode, amount, extra]) => Object.assign(
            mode === "time" ? { id, mode: "time", secs: amount } : { id, mode: "reps", reps: amount },
            extra || {}
          )),
        }],
      };
    }
    fs.writeFileSync(path.join(OUT, `plan-${kid.toLowerCase()}.json`), JSON.stringify(out, null, 1));

    const mins = Object.entries(out.days).filter(([, d]) => !d.rest).map(([k, d]) => {
      const items = d.blocks.flatMap((b) => b.items);
      const r = d.rounds || 1, sets = items.length * r;
      const cards = r > 1 ? r : d.blocks.length;
      const secs = items.reduce((s, it) => s + estimate(it), 0) * r + out.rest * (sets - 1) + cards * BLOCK_CARD_S_EST;
      return `${k} ${Math.floor(secs/60)}:${String(secs%60).padStart(2,"0")}`;
    });
    console.log(`  ✓ plan-${kid.toLowerCase()}.json — ${rounds} rounds, ${out.rest}s rest — ${mins.join(" · ")}`);
  }

  fs.writeFileSync(path.join(OUT, "LICENSE.txt"),
`Exercise data and photographs in this folder come from the free-exercise-db project:

    https://github.com/yuhonas/free-exercise-db

That project releases its contents into the PUBLIC DOMAIN under the Unlicense
(https://unlicense.org). No attribution is required; it is recorded here anyway
because knowing where an asset came from matters more than the licence demanding it.

WHAT WAS CHANGED IN THIS COPY
  - Scoped to equipment we own: none / body only / dumbbell / bands.
  - Dropped "expert" difficulty, and a short exclusion list of loaded-spine and
    neck-loading movements that do not belong in an unsupervised kids' workout.
  - Both frames per exercise re-encoded to ${IMG_WIDTH}px-wide WebP at quality ${IMG_QUALITY}.
  - Records trimmed to the fields the app reads.

Regenerate with:  node tools/_fit_build_library.mjs
`);

  const groupCounts = {};
  for (const x of library) groupCounts[x.group] = (groupCounts[x.group] || 0) + 1;

  console.log(`\n✓ baked ${library.length} exercises → assets/fitness/`);
  console.log(`  images: ${written} new, ${skipped} cached, ${(bytes / 1048576).toFixed(1)} MB total`);
  console.log(`  by group: ${Object.entries(groupCounts).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
}

main().catch((err) => { console.error("✗ bake failed:", err); process.exit(1); });
