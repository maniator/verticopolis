<!--
Thanks for contributing to Verticopolis! Fill in the sections below.
Keep the engine (src/engine/) free of DOM/rendering, and use American English.
-->

## What & why

<!-- What does this change do, and what problem does it solve? Link any related issue. -->

Closes #

## Type of change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] Classic-canon fix (matches the 1994 original for all towers)
- [ ] Modern-mode feature (opt-in, "what the original couldn't do")
- [ ] New player-facing feature (mode-agnostic)
- [ ] Refactor / internal-only (no player-facing behavior change)
- [ ] Docs / tooling

## Game mode impact

<!--
Towers are founded once as "classic" or "modern" (immutable for the tower's life).
Classic must stay faithful to SimTower 1994; Modern is the opt-in divergence layer.
All behavior the two modes disagree on lives behind the mode's rule-set strategy —
resolved once at founding, never branched on ad hoc or smeared through the simulation.
See AGENTS.md for the current rule-set location and the "don't smear mode logic" tripwire.
Delete this section only if the change cannot affect gameplay (e.g. docs/tooling).
-->

- [ ] This change is **classic-canon** (affects all towers, stays faithful to the 1994 original)
- [ ] This change is **modern-only** (gated behind Modern mode, does not alter Classic behavior)
- [ ] This change is **mode-agnostic** (identical in both modes)
- [ ] Any mode-divergent behavior lives behind the mode rule-set strategy (see AGENTS.md), not smeared into the simulation

## Quality gates

<!-- All four must be green before merge. -->

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`

## Versioning

<!--
Bump package.json `version` on any player-facing change:
  minor = new player-facing capability, patch = player-noticeable fix/behavior change.
Internal-only work needs no bump. See AGENTS.md → Versioning.
-->

- [ ] Bumped `version` (minor / patch), **or** this change is internal-only and needs no bump

## Screenshots / recordings

<!-- For any visual or gameplay change, include before/after. Delete if not applicable. -->

## Notes for reviewers

<!-- Canon references, trade-offs, follow-ups, anything that helps the review. -->
