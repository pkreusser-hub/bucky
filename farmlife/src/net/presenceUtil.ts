// ---------------------------------------------------------------------------
// Pure, dependency-free helpers for the P3 presence layer (Playroom). Kept in
// their own module — no `playroomkit`/`three`/`firebase` imports — so they are
// cheaply unit-testable (mirrors net/sync.ts's "pure math, framework-free"
// convention). Two things live here:
//   1. roomCodeFromFamily() — the DETERMINISTIC family-room code derivation.
//   2. shirtTint()          — the DETERMINISTIC per-player shirt colour.
// ---------------------------------------------------------------------------

/**
 * Derive the ONE persistent Playroom room code for a family from its familyKey
 * (e.g. "fam2jan2g" for the real family, "famtestfl" in tests). Everyone who
 * opens Farm Life resolves the same familyKey → the same room code → they all
 * land in the same room automatically (`insertCoin({ roomCode })`, no lobby UI,
 * no `#r=` hash — the barnyardbistro CAUTION: Playroom's own hash parsing beats
 * the roomCode option, so we NEVER use hashes).
 *
 * Derivation: uppercase the familyKey, strip to Playroom's safe [A-Z0-9]
 * charset, prefix "FL" (Farm Life namespace so it can't collide with a raw
 * family hash used elsewhere), and cap length. Deterministic and stable:
 *   "fam2jan2g" -> "FLFAM2JAN2G"
 *   "famtestfl" -> "FLFAMTESTFL"
 */
export function roomCodeFromFamily(familyKey: string): string {
  const clean = (familyKey || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return ("FL" + clean).slice(0, 12);
}

// A small palette of friendly, mutually-distinct shirt colours for remote
// farmers. Deliberately EXCLUDES the local player's warm red (#d24b4b, see
// player.ts) so remote avatars read as "someone else" at a glance.
export const SHIRT_TINTS = [
  "#4f8fd2", // blue
  "#5bb85b", // green
  "#e0a53a", // amber
  "#9b6dd0", // purple
  "#e07aa8", // pink
  "#3fb8a8", // teal
  "#e57b3a", // orange
  "#7a9b3a", // olive
];

/** Deterministic djb2 string hash (same family as index.html's roomId hash). */
export function nameHash(name: string): number {
  let h = 5381;
  const s = name || "";
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

/** Deterministic shirt colour for a remote farmer, keyed only on their name so
 * every device paints the same person the same colour. */
export function shirtTint(name: string): string {
  return SHIRT_TINTS[nameHash(name) % SHIRT_TINTS.length];
}
