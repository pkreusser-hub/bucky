// Single clock source for everything farm-related. Wraps Date.now() with a
// test-only offset so headless tests (and later, playtesters who want to
// preview "what does a ready pumpkin look like") can fast-forward growth
// deterministically without waiting real hours. P2 (Firestore) reuses this
// exact hook — see farmlife-plan.md's lazy-timestamp growth model.
//
// Test hook: window.__FL__.farm._setTimeOffset(ms) / ._addTimeOffset(ms).

let offsetMs = 0;

export function now(): number {
  return Date.now() + offsetMs;
}

export function setTimeOffset(ms: number): void {
  offsetMs = ms;
}

export function addTimeOffset(ms: number): void {
  offsetMs += ms;
}

export function getTimeOffset(): number {
  return offsetMs;
}
