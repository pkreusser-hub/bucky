// ---------------------------------------------------------------------------
// Action resolution — the ONE pipeline both the P1.5 tool mode and the future
// "little kid" auto-context mode flow through (plan: build only tool mode now,
// but design the seam so the accessibility toggle is UI-only later).
//
// PURE MODULE: no THREE, no DOM — unit-tested in action.test.ts. main.ts maps a
// stored TileRecord to a TileState and calls resolveAction(); the return tells
// the HUD what floating label to show and, on action press, what verb to run
// (or which gentle hint toast to fire).
//
//   tool  mode: the equipped tool decides the *attempted* verb; only the tool
//               matching the tile's natural need succeeds, else a wrong-tool
//               hint. Missing seeds / empty tank also produce a gentle hint.
//   auto  mode: the equipped tool is ignored — the tile's natural verb is
//               attempted directly (resource checks still apply). This mode is
//               NOT wired to any UI yet; it exists so P1.5+ can add a toggle.
// ---------------------------------------------------------------------------

import { CROPS, CropId } from "./growth";

export type ToolId = "hands" | "hoe" | "can" | "seeds";
export type Verb = "till" | "plant" | "water" | "harvest";
/** Derived, gameplay-facing state of a single tile (computed from a TileRecord). */
export type TileState = "untouched" | "tilled" | "growing" | "thirsty" | "ready";

export type ActionMode = "tool" | "auto";

export const TOOL_ORDER: ToolId[] = ["hands", "hoe", "can", "seeds"];

// There is no hoe emoji, and ⛏️ reads as a pickaxe, so the hoe carries a small
// custom inline-SVG icon (handle + perpendicular flat blade). The HUD renders
// `icon` (innerHTML) when present, else `emoji` (textContent). `emoji` is kept
// as a text fallback for contexts that can't take markup (toasts).
export const TOOL_META: Record<ToolId, { emoji: string; name: string; icon?: string }> = {
  hands: { emoji: "🖐", name: "Hands" },
  hoe: {
    emoji: "🌱",
    name: "Hoe",
    icon:
      '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">' +
      '<line x1="5.5" y1="19.5" x2="15.5" y2="7" stroke="#8a5a2b" stroke-width="2.6" stroke-linecap="round"/>' +
      '<path d="M12.6 4.6 L20 6.8 L18.9 10.4 L11.9 8.2 Z" fill="#c8ccd4" stroke="#20242a" stroke-width="0.9" stroke-linejoin="round"/>' +
      "</svg>",
  },
  can: { emoji: "🚿", name: "Watering Can" },
  seeds: { emoji: "🌱", name: "Seeds" },
};

/** Which tool performs each verb (tool-mode matching + hint text). */
export const VERB_TOOL: Record<Verb, ToolId> = {
  till: "hoe",
  plant: "seeds",
  water: "can",
  harvest: "hands",
};

export interface ResolveCtx {
  selectedCrop: CropId;
  seedCount: number; // seeds owned of selectedCrop
  tank: number; // watering-can units left
  tileCrop?: CropId; // crop growing on the tile (growing/thirsty/ready states)
}

export interface ActionResolution {
  verb: Verb | null; // action to run on press; null = nothing actionable
  cropId?: CropId; // crop context (plant = selected, water/harvest = tile's)
  label: string; // floating-label text (verb OR gentle hint)
  hint: boolean; // true = wrong-tool / missing-resource; fire a rate-limited toast on press
}

/** The verb a tile naturally wants, ignoring the equipped tool (auto mode uses this directly). */
export function naturalVerb(state: TileState): Verb | null {
  switch (state) {
    case "untouched":
      return "till";
    case "tilled":
      return "plant";
    case "thirsty":
      return "water";
    case "ready":
      return "harvest";
    default:
      return null; // "growing" — watered & not yet ready: nothing to do but wait
  }
}

function neededHint(verb: Verb): string {
  switch (verb) {
    case "till":
      return "Needs the hoe! 🌱";
    case "plant":
      return "Plant a seed here! 🌱";
    case "water":
      return "Water me! 🚿";
    case "harvest":
      return "It's ready — use your hands! ✋";
  }
}

function verbLabel(verb: Verb, ctx: ResolveCtx): string {
  switch (verb) {
    case "till":
      return "Till";
    case "plant":
      return `Plant ${CROPS[ctx.selectedCrop].name}`;
    case "water":
      return "Water 🚿";
    case "harvest":
      return `Harvest ${ctx.tileCrop ? CROPS[ctx.tileCrop].emoji : ""}!`;
  }
}

/**
 * Resolve what pressing the action button does to a tile, given the equipped
 * tool, the mode, and inventory context. PURE.
 */
export function resolveAction(
  state: TileState,
  tool: ToolId,
  mode: ActionMode,
  ctx: ResolveCtx
): ActionResolution {
  const nv = naturalVerb(state);
  const emoji = ctx.tileCrop ? CROPS[ctx.tileCrop].emoji : "";

  // Nothing actionable (a watered, still-growing crop). Never a hint toast.
  if (nv === null) {
    return { verb: null, label: state === "growing" ? `Growing ${emoji}…` : "", hint: false };
  }

  // tool mode: only the matching tool succeeds; auto mode ignores the tool.
  const attempting: Verb | null = mode === "auto" ? nv : VERB_TOOL[nv] === tool ? nv : null;

  if (attempting === null) {
    // wrong tool equipped in tool mode -> gentle "needs the …" hint
    return { verb: null, label: neededHint(nv), hint: true };
  }

  // resource gates apply in BOTH modes
  if (attempting === "plant" && ctx.seedCount <= 0) {
    return { verb: null, label: `No ${CROPS[ctx.selectedCrop].name} seeds`, hint: true };
  }
  if (attempting === "water" && ctx.tank <= 0) {
    return { verb: null, label: "Can empty — refill at the pond 💧", hint: true };
  }

  return {
    verb: attempting,
    cropId: attempting === "plant" ? ctx.selectedCrop : ctx.tileCrop,
    label: verbLabel(attempting, ctx),
    hint: false,
  };
}

// ---- watering-can tank ------------------------------------------------------
/** Consume one tank unit (floored at 0). PURE. */
export function tankConsume(tank: number): number {
  return Math.max(0, tank - 1);
}
/** Refill to capacity. PURE. */
export function tankRefill(capacity: number): number {
  return Math.max(0, Math.floor(capacity));
}
