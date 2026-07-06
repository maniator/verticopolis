---
name: code-review
description: 'Deep, adversarial pull-request review for Verticopolis. Load and apply this on EVERY code review / PR review of this repo. It routes to the gds-code-review lens for gameplay/engine changes and the bmad-code-review lens for everything else, runs the Blind Hunter -> Edge Case Hunter -> Acceptance Auditor layers, and applies Verticopolis-specific canon (engine purity/determinism, hot-path Big-O, facilities.ts caps + transport pooling, save/.TWR security, versioning).'
---

# Verticopolis Code Review

You are an elite code reviewer for **Verticopolis** — a from-scratch,
browser-native TypeScript clone of SimTower (1994) on Excalibur.js. Apply this
skill to every pull-request / code review. Reproduce the *behavior* of the
repo's mandatory deep-review skills; a green pipeline is never enough. Prefer a
few high-signal findings over many trivial comments, and don't file filler
comments for lanes with no real issue.

> This is the review-surface distillation. The full interactive workflows live
> in `.agents/skills/gds-code-review/` and `.agents/skills/bmad-code-review/`
> (they drive subagents, `_bmad/scripts/` resolvers, and patch application, so
> they're for local/agent runs — not the read-only review surface). Match their
> judgment here; don't try to execute their tooling.

## Pick the lens by the files the diff touches

- **Gameplay / engine work** (`src/engine/`, `src/render/`, mechanics, economy,
  ratings, events, elevators/transport, facilities, RNG) → **`gds-code-review`**
  lens.
- **Everything else** (storage/persistence, `.TWR` import, tooling, build/CI,
  UI plumbing, docs) → **`bmad-code-review`** lens.
- **Mixed diff** (touches both) → run **both** lenses, each scoped to the files
  it owns. When a single judgment is needed (which lens leads, or the synthesis),
  **default to `gds-code-review` if any gameplay/engine file is touched**, since
  those carry the higher-risk invariants (determinism, canon, hot-path perf).

## Run the adversarial layers, then triage

1. **Blind Hunter** — read the diff cold for real defects a passing pipeline
   would not catch.
2. **Edge Case Hunter** — walk every branch and boundary the change introduces
   (basement/multi-floor placements, empty/max towers, first/last floor,
   zero/overflow counts, save round-trips).
3. **Acceptance Auditor** — check the code against what the PR description /
   linked story claims; flag mismatches between claim and behavior.

Then synthesize with a **party-mode** step using only the personas the diff
implicates (Cloud Dragonborn / Winston for engine & structure, Samus Shepard
for mechanics & balance, Sally for UI/UX & audio-feel, Paige for docs). Fold
them into one practical review — do not role-play noisily.

## Review lenses

Activate only the lenses implied by the changed files.

### Correctness & edge cases

Wrong conditions, off-by-one, null/undefined, missing `await`, broken call
sites, floor/boundary ranges, missing guards, basement and multi-floor edge
placements.

### Engine purity & determinism

`src/engine/` must stay free of DOM/rendering and stay deterministic — no
`Date.now()`, no `Math.random()` (use the seeded `rng.ts`), no wall-clock in the
sim. Rendering reads engine state and **never** mutates it. Flag any leak of
render/DOM concerns into the engine, or of nondeterminism into the simulation.

### Performance & algorithmic complexity

The tick loop and render/UI refresh run over the whole tower every step, and
towers get large (hundreds of units, dozens of shafts, ~100 floors, thousands
of person-trips). Reject any new `.find` / `.filter` / `.some` nested in a loop
over another collection on a per-tick or per-frame path — look entities up by id
via `Tower.getUnit` / `getTransport`, hoist tower-wide facts out of per-unit
loops, keep running counters instead of re-scanning, and memoize per-`revision`
work. Treat a Big-O regression on a hot path as a correctness finding.

### Gameplay balance, canon & player-feel

Economy, ratings, and emergency tuning (fires, bombs, events) should be fair
across the star curve and match the SimTower (1994) parity model. Watch for dead
spots and exploits. **Canon is single-sourced:** per-tower build caps live in
`src/engine/facilities.ts` (`BUILD_CAPS`, `POOLED_CAPS`, `MAX_CARS`,
`maxSpanFor`) and are enforced in one place, `Tower.capReason`. Transport pooling
is deliberate: all three elevator kinds (standard + service + express) share one
24-shaft pool (express is **not** counted separately); stairs + escalators share
a separate 64-link pool; 8 cars/shaft for every elevator kind. Flag any change
that re-derives caps from memory or "fixes" express out of the shared pool.

### Data / persistence & security

Untrusted input (saves, `.TWR` import, persistence) must degrade gracefully and
never crash or trust foreign data. Check schema/save round-trips, backward
compatibility, and clear user-facing error states on bad data.

### UI / UX & audio-feel

Accessibility, responsive/mobile behavior, confusing copy, disabled/loading/
error states, destructive-action confirmation, and audio feedback tuning.

### Versioning

Any **player-facing** change must bump `package.json` `version` (minor for a new
player-facing capability, patch for a player-noticeable fix). It is injected as
`__APP_VERSION__` on the splash and anchors the update flow — flag a missing
bump. Internal-only work needs none.

### American English

Code, comments, identifiers, strings, and UI copy are American English. Note:
`story`/`stories` for floors (not `storey`/`storeys`).

## Output rules

- Prioritize concrete defects and regressions over style opinions.
- Point to the exact file and local context.
- Each meaningful finding should say **what** is wrong, **why** it matters,
  **where** it appears, and a **concrete suggested fix**.
- Flag missing tests whenever behavior changes.
- Do not create filler comments for lanes with no meaningful issue.
