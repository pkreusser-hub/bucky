import { describe, it, expect } from "vitest";
import { checkMilestones, cropsShippedTotal, MILESTONE_KEYS, type MilestoneFacts } from "./milestones";
import { CROP_ORDER } from "./growth";

function facts(over: Partial<MilestoneFacts> = {}): MilestoneFacts {
  return { shipped: {}, decorCount: 0, earned: {}, ...over };
}

describe("milestones.ts — pure milestone check", () => {
  it("exposes the 9 expected milestone keys", () => {
    expect(MILESTONE_KEYS.length).toBe(9);
    for (const k of ["firstHarvest", "firstMilk", "firstEgg", "firstDecoration", "tenTurnips", "fiftyCrops", "hundredCrops", "greenThumb", "fullBloom"]) {
      expect(MILESTONE_KEYS).toContain(k);
    }
  });

  it("first-harvest is a one-shot event trigger, not a shipped count", () => {
    expect(checkMilestones(facts({ shipped: { turnip: 99 } }))).not.toContain("firstHarvest");
    expect(checkMilestones(facts({ harvestedEvent: true }))).toContain("firstHarvest");
  });

  it("first-milk / first-egg flip on their own event only", () => {
    expect(checkMilestones(facts({ milkEvent: true }))).toEqual(["firstMilk"]);
    expect(checkMilestones(facts({ eggEvent: true }))).toEqual(["firstEgg"]);
  });

  it("first-decoration flips on a decor-place event", () => {
    expect(checkMilestones(facts({ decorEvent: true }))).toContain("firstDecoration");
    expect(checkMilestones(facts())).not.toContain("firstDecoration");
  });

  it("10 turnips flips exactly at 10, not at 9", () => {
    expect(checkMilestones(facts({ shipped: { turnip: 9 } }))).not.toContain("tenTurnips");
    expect(checkMilestones(facts({ shipped: { turnip: 10 } }))).toContain("tenTurnips");
    expect(checkMilestones(facts({ shipped: { turnip: 11 } }))).toContain("tenTurnips");
  });

  it("does NOT re-fire an already-earned milestone", () => {
    const earned = { tenTurnips: 123 };
    expect(checkMilestones(facts({ shipped: { turnip: 50 }, earned }))).not.toContain("tenTurnips");
  });

  it("50/100 crops shipped use the crop-only total, produce excluded", () => {
    // 49 crops + a pile of produce -> not yet
    expect(cropsShippedTotal({ turnip: 49, milk: 100, egg: 100 })).toBe(49);
    expect(checkMilestones(facts({ shipped: { turnip: 49, milk: 100 } }))).not.toContain("fiftyCrops");
    expect(checkMilestones(facts({ shipped: { turnip: 30, potato: 20 } }))).toContain("fiftyCrops");
    // boundary at 100
    expect(checkMilestones(facts({ shipped: { corn: 99 } }))).not.toContain("hundredCrops");
    expect(checkMilestones(facts({ shipped: { corn: 100 } }))).toContain("hundredCrops");
  });

  it("green thumb requires >=1 of EVERY crop in CROP_ORDER (all 8)", () => {
    const almost: Record<string, number> = {};
    for (const id of CROP_ORDER) almost[id] = 1;
    delete almost[CROP_ORDER[CROP_ORDER.length - 1]]; // drop the last one
    expect(checkMilestones(facts({ shipped: almost }))).not.toContain("greenThumb");
    const all: Record<string, number> = {};
    for (const id of CROP_ORDER) all[id] = 1;
    expect(checkMilestones(facts({ shipped: all }))).toContain("greenThumb");
  });

  it("full bloom flips at 5 placed decorations", () => {
    expect(checkMilestones(facts({ decorCount: 4 }))).not.toContain("fullBloom");
    expect(checkMilestones(facts({ decorCount: 5 }))).toContain("fullBloom");
  });

  it("full bloom NEVER un-flips once earned (decor later removed below 5)", () => {
    const earned = { fullBloom: 999 };
    // count dropped back to 2 — must not re-report AND must not clear
    const result = checkMilestones(facts({ decorCount: 2, earned }));
    expect(result).not.toContain("fullBloom");
    expect(earned.fullBloom).toBe(999); // input untouched (pure)
  });

  it("two identical calls: the second (with the first folded into earned) reports nothing new", () => {
    const f1 = facts({ shipped: { turnip: 10 }, decorEvent: true });
    const first = checkMilestones(f1);
    expect(first.sort()).toEqual(["firstDecoration", "tenTurnips"].sort());
    const earned: Record<string, number> = {};
    for (const k of first) earned[k] = 1;
    // same monotonic facts, but the transient decorEvent already consumed
    const second = checkMilestones(facts({ shipped: { turnip: 10 }, earned }));
    expect(second).toEqual([]);
  });
});
