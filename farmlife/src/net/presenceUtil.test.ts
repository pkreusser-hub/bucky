import { describe, it, expect } from "vitest";
import { roomCodeFromFamily, shirtTint, nameHash, SHIRT_TINTS } from "./presenceUtil";

describe("roomCodeFromFamily", () => {
  it("is deterministic for the same family key", () => {
    expect(roomCodeFromFamily("fam2jan2g")).toBe(roomCodeFromFamily("fam2jan2g"));
  });

  it("uppercases, strips to [A-Z0-9], and prefixes FL", () => {
    expect(roomCodeFromFamily("fam2jan2g")).toBe("FLFAM2JAN2G");
    expect(roomCodeFromFamily("famtestfl")).toBe("FLFAMTESTFL");
  });

  it("only ever contains Playroom-safe characters", () => {
    for (const fam of ["fam2jan2g", "famtestfl", "weird key!!", "a-b_c.d", ""]) {
      expect(roomCodeFromFamily(fam)).toMatch(/^[A-Z0-9]+$/);
    }
  });

  it("caps length at 12", () => {
    expect(roomCodeFromFamily("famverylongfamilykeyhere").length).toBeLessThanOrEqual(12);
  });

  it("gives different codes to different families", () => {
    expect(roomCodeFromFamily("fam2jan2g")).not.toBe(roomCodeFromFamily("famtestfl"));
  });
});

describe("shirtTint", () => {
  it("is deterministic for the same name", () => {
    expect(shirtTint("Eleanor")).toBe(shirtTint("Eleanor"));
    expect(shirtTint("Isaac")).toBe(shirtTint("Isaac"));
  });

  it("always returns a colour from the palette", () => {
    for (const n of ["Eleanor", "Isaac", "Mom", "Dad", "Grandma", "", "Farmer"]) {
      expect(SHIRT_TINTS).toContain(shirtTint(n));
    }
  });

  it("never returns the local player's red", () => {
    for (const n of ["Eleanor", "Isaac", "Mom", "Dad", "Grandma", "Farmer"]) {
      expect(shirtTint(n).toLowerCase()).not.toBe("#d24b4b");
    }
  });

  it("nameHash is stable and non-negative", () => {
    expect(nameHash("Eleanor")).toBe(nameHash("Eleanor"));
    expect(nameHash("Eleanor")).toBeGreaterThanOrEqual(0);
  });
});
