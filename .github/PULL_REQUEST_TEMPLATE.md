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
Classic must stay faithful to SimTower 1994; Modern is the opt-in "what the original
couldn't do" layer. Keep behavior the two modes disagree on in a single mode-resolved
rule-set — resolved once at founding — rather than branching on the mode ad hoc or
smearing mode checks through the simulation.
Delete this section only if the change cannot affect gameplay (e.g. docs/tooling).
-->

- [ ] This change is **classic-canon** (affects all towers, stays faithful to the 1994 original)
- [ ] This change is **modern-only** (gated behind Modern mode, does not alter Classic behavior)
- [ ] This change is **mode-agnostic** (identical in both modes)
- [ ] Any mode-divergent behavior is isolated in the mode rule-set (resolved once at founding), not smeared into the simulation with ad-hoc mode checks

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

<!--
For any visual or gameplay change, embed actual before/after images here — not a
prose description of what a screenshot would show. See docs/screenshots.md for how
to capture, commit, and embed them. Delete this section only if the change has no
visual or gameplay surface.
-->

## Notes for reviewers

<!-- Canon references, trade-offs, follow-ups, anything that helps the review. -->
