import { describe, it, expect } from "vitest";
import {
  resolveAction,
  naturalVerb,
  tankConsume,
  tankRefill,
  TOOL_ORDER,
  type TileState,
  type ToolId,
  type ResolveCtx,
} from "./action";

const CTX: ResolveCtx = { selectedCrop: "turnip", seedCount: 5, tank: 6, tileCrop: "turnip" };
const ALL_STATES: TileState[] = ["untouched", "tilled", "growing", "thirsty", "ready"];

describe("action.ts — tool/auto action resolver", () => {
  it("naturalVerb maps every tile state to its intended verb", () => {
    expect(naturalVerb("untouched")).toBe("till");
    expect(naturalVerb("tilled")).toBe("plant");
    expect(naturalVerb("thirsty")).toBe("water");
    expect(naturalVerb("ready")).toBe("harvest");
    expect(naturalVerb("growing")).toBe(null);
  });

  // ---- TOOL MODE: right tool succeeds -------------------------------------
  it("tool mode: the matching tool performs the tile's natural verb", () => {
    expect(resolveAction("untouched", "hoe", "tool", CTX).verb).toBe("till");
    expect(resolveAction("tilled", "seeds", "tool", CTX).verb).toBe("plant");
    expect(resolveAction("thirsty", "can", "tool", CTX).verb).toBe("water");
    expect(resolveAction("ready", "hands", "tool", CTX).verb).toBe("harvest");
  });

  it("tool mode: plant carries the selected crop, harvest/water carry the tile's crop", () => {
    const plant = resolveAction("tilled", "seeds", "tool", { ...CTX, selectedCrop: "corn" });
    expect(plant.verb).toBe("plant");
    expect(plant.cropId).toBe("corn");
    const harvest = resolveAction("ready", "hands", "tool", { ...CTX, tileCrop: "pumpkin" });
    expect(harvest.cropId).toBe("pumpkin");
  });

  // ---- TOOL MODE: wrong tool -> gentle hint, no verb ----------------------
  it("tool mode: a wrong tool on a needy tile returns a hint (verb null, hint true)", () => {
    // untouched grass needs the hoe; any other tool hints
    for (const t of ["hands", "can", "seeds"] as ToolId[]) {
      const r = resolveAction("untouched", t, "tool", CTX);
      expect(r.verb).toBe(null);
      expect(r.hint).toBe(true);
      expect(r.label).toMatch(/hoe/i);
    }
    expect(resolveAction("thirsty", "hoe", "tool", CTX).label).toMatch(/water/i);
    expect(resolveAction("ready", "hoe", "tool", CTX).label).toMatch(/hands/i);
    expect(resolveAction("tilled", "hoe", "tool", CTX).label).toMatch(/seed/i);
  });

  it("tool mode: a growing (watered) tile is a no-op with no hint, whatever the tool", () => {
    for (const t of TOOL_ORDER) {
      const r = resolveAction("growing", t, "tool", CTX);
      expect(r.verb).toBe(null);
      expect(r.hint).toBe(false);
      expect(r.label).toMatch(/growing/i);
    }
  });

  // ---- resource gates (both modes) ----------------------------------------
  it("tool mode: planting with no seeds is a hint, not an action", () => {
    const r = resolveAction("tilled", "seeds", "tool", { ...CTX, seedCount: 0 });
    expect(r.verb).toBe(null);
    expect(r.hint).toBe(true);
    expect(r.label).toMatch(/no .*seed/i);
  });

  it("tool mode: watering with an empty tank is a hint pointing at the pond", () => {
    const r = resolveAction("thirsty", "can", "tool", { ...CTX, tank: 0 });
    expect(r.verb).toBe(null);
    expect(r.hint).toBe(true);
    expect(r.label).toMatch(/pond/i);
  });

  // ---- AUTO MODE: verb picked regardless of equipped tool -----------------
  it("auto mode: picks the correct verb for every tile state, ignoring the equipped tool", () => {
    const expected: Record<TileState, ReturnType<typeof naturalVerb>> = {
      untouched: "till",
      tilled: "plant",
      thirsty: "water",
      ready: "harvest",
      growing: null,
    };
    for (const state of ALL_STATES) {
      // deliberately equip the WRONG tool (hands) — auto ignores it
      const r = resolveAction(state, "hands", "auto", CTX);
      expect(r.verb).toBe(expected[state]);
      if (r.verb) expect(r.hint).toBe(false);
    }
  });

  it("auto mode: resource gates still apply (no seeds / empty tank hint)", () => {
    expect(resolveAction("tilled", "hands", "auto", { ...CTX, seedCount: 0 }).hint).toBe(true);
    expect(resolveAction("thirsty", "hands", "auto", { ...CTX, tank: 0 }).hint).toBe(true);
  });

  it("auto mode never produces a wrong-tool hint (only resource hints)", () => {
    // with full resources, every actionable state yields a verb, never a hint
    for (const state of ALL_STATES) {
      for (const t of TOOL_ORDER) {
        const r = resolveAction(state, t, "auto", CTX);
        if (naturalVerb(state) !== null) expect(r.hint).toBe(false);
      }
    }
  });

  // ---- tank helpers -------------------------------------------------------
  it("tankConsume decrements and floors at zero", () => {
    expect(tankConsume(6)).toBe(5);
    expect(tankConsume(1)).toBe(0);
    expect(tankConsume(0)).toBe(0);
  });

  it("tankRefill returns capacity (integer, floored at 0)", () => {
    expect(tankRefill(6)).toBe(6);
    expect(tankRefill(6.9)).toBe(6);
    expect(tankRefill(-3)).toBe(0);
  });

  it("consume N times then refill returns to capacity (round-trip)", () => {
    let tank = 6;
    for (let i = 0; i < 4; i++) tank = tankConsume(tank);
    expect(tank).toBe(2);
    tank = tankRefill(6);
    expect(tank).toBe(6);
  });
});
