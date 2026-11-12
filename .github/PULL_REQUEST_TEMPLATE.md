<!--
Thanks for contributing to Verticopolis! Fill in the sections below.
Keep the engine (engine-rs/) free of DOM/rendering, and use American English.
Keep every ## heading and write something under each one: "None" or
"n/a: <reason>" where a section does not apply. The PR template check
(.github/workflows/pr-template.yml) fails a description that drops a heading.
Opening a PR through the API or `gh pr create --body` skips this template, so
start that body from this file (see AGENTS.md, "Pull request descriptions").
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
rule-set (resolved once at founding) rather than branching on the mode ad hoc or
smearing mode checks through the simulation.
If the change cannot affect gameplay (e.g. docs/tooling), write "n/a: <reason>"
instead of ticking a box.
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
Do not edit a version. Add .changes/<branch-slug>.md with the app and crate tiers
(major / minor / patch / none) and the Player and Engine lines; the release PR
raises the versions. See .changes/README.md.
-->

- [ ] Added a `.changes` note with the right `app:` and `crate:` levels, **or** this PR changes no deployed path
- [ ] Engine change: updated `packages/verticopolis-engine/README.md` and/or `engine-rs/CRATE_README.md`, **or** read both and put `readmes: unchanged` in the note, **or** this PR changes no engine source

## Complexity

<!--
A change to a hot-path surface (section 1 of docs/performance/hot-path-review.md:
either engine and its build, the app build settings, the WASM binding, the
hosts, saves, rendering, the frame loop, UI, analytics, audio and the app
shell) fills in the note from section 5 of that page: hot paths and callers, sizes, complexity before and
after, remaining scans and why, the caches, indexes and counters either engine
has there and whether each is kept (HP-8), invalidation evidence,
measurements. A significant change (section 5) gives every field. Any other
change, or a hot-path change section 5 does not count as significant, may
replace the first line below with "n/a: <reason>". The second line links the
section 6 review record once a review skill has posted it on this PR, or says
"no hot-path surface".
-->

Hot paths and call frequency (tier), sizes, complexity before and after, remaining scans and why, caches kept or replaced (HP-8), invalidation evidence, measurements:

Hot-path record (section 6): link

## Screenshots / recordings

<!--
For any visual or gameplay change, embed actual before/after images here, not a
prose description of what a screenshot would show. See docs/screenshots.md for how
to capture, commit, and embed them. If the change has no visual or gameplay
surface, write "None: <reason>".
-->

## Notes for reviewers

<!-- Canon references, trade-offs, follow-ups, anything that helps the review. "None" if nothing. -->
