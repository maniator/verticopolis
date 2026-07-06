---
applyTo: "**/*"
---

# BMGD/BMAD-Style Code Review Instructions

These are the always-applied overlay for pull-request review. The full method is
the loadable **`code-review`** skill at
[`.github/skills/code-review/SKILL.md`](../skills/code-review/SKILL.md) — the
Copilot code-review runner loads it directly when it's available. If it isn't
loaded for a given diff, reproduce its behavior from this overlay. Either way,
emulate this repo's mandatory deep review; a green pipeline is never enough. Do
not claim a BMAD/BMGD skill was actually invoked — reproduce its *behavior*.

## Pick the lens by the files the diff touches

- **Gameplay / engine work** (`src/engine/`, `src/render/`, mechanics, economy,
  ratings, events, elevators/transport, facilities, RNG) → **`gds-code-review`**.
- **Everything else** (storage/persistence, `.TWR` import, tooling, build/CI,
  UI plumbing, docs) → **`bmad-code-review`**.
- **Mixed diff** (touches both) → run **both** lenses, each scoped to the files
  it owns. When a single judgment is needed — the party-mode synthesis, or which
  lens leads — **default to `gds-code-review` if any gameplay/engine file is
  touched**, since those carry the higher-risk invariants (determinism, canon,
  hot-path performance).

## Run the adversarial layers, then triage

1. **Blind Hunter** — read the diff cold for real defects a passing pipeline
   would not catch.
2. **Edge Case Hunter** — walk every branch and boundary the change introduces
   (basement/multi-floor placements, empty/max towers, first/last floor,
   zero/overflow counts, save round-trips).
3. **Acceptance Auditor** — check the code against what the PR description /
   linked story claims; flag mismatches between claim and behavior.

Then synthesize with a **`bmad-party-mode`** step using only the personas the
diff implicates (Cloud Dragonborn / Winston for engine & structure, Samus
Shepard for mechanics & balance, Sally for UI/UX & audio-feel, Paige for docs).
Do not role-play noisily — fold the personas into one practical review.

## Lenses & output

Apply only the lenses implied by the changed files, and follow the output rules —
both are spelled out in full in the `code-review` skill linked above:
correctness & edge cases; engine purity & determinism; performance / hot-path
Big-O; gameplay balance, canon (`facilities.ts` caps + transport pooling) &
player-feel; data/persistence & security; UI/UX & audio-feel; versioning
(`package.json` bump on player-facing changes); American English. Prefer a few
high-signal findings over many trivial comments, and don't file filler comments
for lanes with no real issue.
