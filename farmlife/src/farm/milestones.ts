// ---------------------------------------------------------------------------
// Milestones — P5. PURE, deterministic, testable (growth.ts / animals.ts
// discipline): given the same facts + already-earned set, always the same
// answer, and it NEVER un-flips an earned milestone. The store persists which
// milestones are earned (milestone_<key> = first-earned ms); this module only
// decides which NEW ones a given event just crossed.
//
// Nine family-shared milestones, each flips exactly once and stays earned
// forever (even if the underlying count later drops — Full Bloom stays lit even
// if decorations are removed below 5). Monotonic shipped-total milestones flip
// when their threshold is first crossed; one-shot event milestones (first
// harvest / milk / egg / decoration) flip on the triggering action.
// ---------------------------------------------------------------------------

import { CROP_ORDER, type CropId } from "./growth";

export interface MilestoneDef {
  key: string;
  label: string;
  emoji: string;
  desc: string;
}

/** Display order + copy for the Farm Book checklist. */
export const MILESTONES: MilestoneDef[] = [
  { key: "firstHarvest", label: "First Harvest", emoji: "🌱", desc: "Harvest your very first crop" },
  { key: "firstMilk", label: "First Milk", emoji: "🥛", desc: "Collect milk from a goat" },
  { key: "firstEgg", label: "First Egg", emoji: "🥚", desc: "Collect an egg from a chicken" },
  { key: "firstDecoration", label: "First Decoration", emoji: "🎀", desc: "Place your first decoration" },
  { key: "tenTurnips", label: "10 Turnips", emoji: "🟣", desc: "Ship 10 turnips in all" },
  { key: "fiftyCrops", label: "50 Crops Shipped", emoji: "🚜", desc: "Ship 50 crops in all" },
  { key: "hundredCrops", label: "100 Crops Shipped", emoji: "🏆", desc: "Ship 100 crops in all" },
  { key: "greenThumb", label: "Green Thumb", emoji: "🌈", desc: "Ship at least one of every crop" },
  { key: "fullBloom", label: "Full Bloom", emoji: "🌸", desc: "Have 5 decorations placed at once" },
];

export const MILESTONE_KEYS: string[] = MILESTONES.map((m) => m.key);

/**
 * The facts a milestone check reads. `shipped` = running per-id shipped totals
 * (crops AND produce keyed by id). `decorCount` = LIVE count of placed decor.
 * `earned` = milestone keys already flipped (their persisted first-earned ms).
 * The `*Event` flags are transient — true only on the specific action that just
 * happened (a harvest / a milk collection / an egg collection / a decor place),
 * so one-shot milestones flip on the action, not a stored counter.
 */
export interface MilestoneFacts {
  shipped: Record<string, number>;
  decorCount: number;
  earned: Record<string, number>;
  harvestedEvent?: boolean;
  milkEvent?: boolean;
  eggEvent?: boolean;
  decorEvent?: boolean;
}

/** Sum of shipped CROP totals (produce excluded — "crops shipped" means crops;
 * milk/eggs are their own thing). */
export function cropsShippedTotal(shipped: Record<string, number>): number {
  let total = 0;
  for (const id of CROP_ORDER) total += shipped[id] ?? 0;
  return total;
}

function condition(key: string, f: MilestoneFacts): boolean {
  switch (key) {
    case "firstHarvest":
      return !!f.harvestedEvent;
    case "firstMilk":
      return !!f.milkEvent;
    case "firstEgg":
      return !!f.eggEvent;
    case "firstDecoration":
      return !!f.decorEvent;
    case "tenTurnips":
      return (f.shipped.turnip ?? 0) >= 10;
    case "fiftyCrops":
      return cropsShippedTotal(f.shipped) >= 50;
    case "hundredCrops":
      return cropsShippedTotal(f.shipped) >= 100;
    case "greenThumb":
      return CROP_ORDER.every((id: CropId) => (f.shipped[id] ?? 0) >= 1);
    case "fullBloom":
      return f.decorCount >= 5;
    default:
      return false;
  }
}

/**
 * PURE. Returns the milestone keys that NEWLY flip for these facts — i.e. whose
 * condition holds AND which are not already in `earned`. Calling twice with the
 * same facts (the second time with the first result folded into `earned`)
 * returns nothing the second time. Never clears an earned milestone.
 */
export function checkMilestones(facts: MilestoneFacts): string[] {
  const out: string[] = [];
  for (const key of MILESTONE_KEYS) {
    if (facts.earned[key]) continue; // already flipped — never un-flips or re-fires
    if (condition(key, facts)) out.push(key);
  }
  return out;
}
