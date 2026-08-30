# Identity, roles and capabilities

*(Established 2026-08-30. The contract below is load-bearing — every gate in the app resolves
through it. Read this before touching anything that asks "who is this user?")*

## The three layers

1. **Identity** — WHO. A profile doc (`frequency:"profile"` in `chores_<familyKey>`) with a
   permanent `pid`, a display `name`, a `role`, and optional `email`. The device remembers a
   `pid`; the display name is looked up, never stored as identity.
2. **Authorization** — MAY. `can(capability)` resolved from `role`, plus per-profile overrides.
   Code never asks "is this Dad?"; it asks `can("approvePayouts")`.
3. **Preference** — WANTS. What a person has chosen to see, within what they may see. Lives in
   the profile's `prefs`. Preference can only narrow, never widen, authorization.

## pid — the one non-obvious rule

`pid` is the profile's name AT MIGRATION TIME, slugged (`"Isaac"` → `"isaac"`), then FROZEN
FOREVER. It is deliberately human-readable and deliberately never regenerated — a rename
changes `name` only. This is what made the migration safe: every legacy keyed doc
(`fitPlan_Isaac`, meals suffixes, kidbank docs, `stockWatch_Isaac`) already derives from the
2026-08 names, so pid-keyed lookups hit the same docs with NO data migration. Do not "clean
up" a pid to match a renamed profile; that orphans every doc keyed under it.

## Roles

`parent` | `kid` | `extended` | `guest`. Initial mapping (2026-08-30): Dad, Mom → parent;
Isaac, Eleanor → kid; Christy, Eleanor(sic), Grandma, Grandpa, Janae, John, Joy → extended.
Assigned once by the idempotent client migration; after that, the docs are the truth and the
mapping constant in code is DEAD — edit roles in the app, not the constant.

## Capabilities

The map lives in one place (`CAPS` in index.html). Role → set of capabilities; profile docs
may carry `grant`/`deny` arrays for the true exceptions (Fit was Isaac+Eleanor+Dad by name —
that is now a grant, not a rule). If you are about to write `name === "..."` in a gate, you
are on the wrong layer.

## Compat notes

- `choreUser` (display name) stays in localStorage for old suites and display; `chorePid` is
  identity. `myName()` is display-only.
- Push token docs carry BOTH `user` (display, legacy consumers) and `pid`. Match by pid first,
  normalized name as fallback — never name alone.
- The calendar Notify selection (extendedProperties.buckyNotify) stores pids going forward;
  readers tolerate legacy name entries.
