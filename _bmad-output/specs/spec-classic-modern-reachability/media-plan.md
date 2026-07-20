# Media plan: paired Classic vs Modern stills

Load-bearing detail for CAP-7 (the screenshots that demo Classic vs Modern on the
`/help` page). SPEC.md cites this companion. Phase P2.

## Format decision

Paired PNG STILLS, Modern beside Classic, one pair per card. GIFs are a NON-GOAL
for v1: no GIF/video tooling exists in the repo (the pipeline is PNG stills only),
and adding an encoder is out of scope. If motion is ever wanted, a CSS crossfade
of the two existing PNGs on the page covers it with no new tooling.

## Capture pipeline (unchanged rules)

All captures come from the pinned Playwright Docker container, via a new scene
`scripts/scenes/classic-vs-modern.ts` feeding the existing `scripts/screenshots.ts`
runner. Output lands under `docs/screenshots/features/`. Fixed seeds and
fail-closed asserts per the existing scene conventions. This rides the existing
screenshot drift gate; it adds NO new CI gate.

## Shortlist

Cards that read clearly as a visual pair (capture both rule-sets at the same
moment/seed):

| Card | Modern frame | Classic frame |
| --- | --- | --- |
| Mode picker (founding) | founding modal, Modern selected | founding modal, Classic selected |
| Elevator schedule | schedule with presets/auto-tune UI | raw hand-set grid |
| Pricing | continuous rent slider | four-rung menu + No Rate |
| Stats / tenancy | Modern economy stats panel | Classic stats panel |
| Escalator on office floor | escalator serving an office floor (allowed) | same spot refused |
| Build hint | hover refusal-reason tooltip on an invalid spot | click -> refusal toast |

The escalator-on-office and hover-refusal pairs are the clearest divergences not
already shot elsewhere; the first four can reuse or extend existing paired stills.
An optional "livelier day" still at a fixed clock hour can show the daytime
presence difference.

## Caption-only (no still)

Divergences that are data or math, not a distinct on-screen frame, get a caption
under the card and no figure: variant-household relocation odds, operating
overhead / hold tax, churn tuning, cockroach recovery, express-transfer routing.
Forcing a screenshot for these would show two near-identical frames and mislead.

## No silent gaps

If a planned pair cannot be captured deterministically, the scene logs the
skipped pair and the card falls back to caption-only rather than shipping an
empty or mismatched figure.
