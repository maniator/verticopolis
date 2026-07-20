# Media plan: paired Classic vs Modern stills

Load-bearing detail for CAP-8 (the paired stills that demo Classic vs Modern),
which is Phase P2. CAP-7 (the gallery restyle) also cites this companion for its
screenshot-impact note below. SPEC.md cites both from their success criteria.

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

## Screenshot impact on existing captures (P1, not just the new scene)

CAP-8's new scene is additive, but the P1 UI changes render new pixels and will
drift captures that already exist. Plan for regenerating them through the pinned
container (never a host browser), so the drift gate does not surprise the P1 PR:

- **Mode badge (CAP-2):** it lands in the Tower panel near `#tower-name`, so any
  scene that frames the main game view or the tower panel now shows "This tower:
  Classic / Modern" and its capture drifts.
- **Gallery restyle + cell resize (CAP-7):** `gallery.html`'s rendered output
  changes (new retro chrome, sibling links, corrected multi-floor cell heights),
  so the gallery visual snapshot (`e2e/visual.spec.ts` and the gallery reference
  in `milestones.spec.ts`) drifts and is regenerated.
- **Help dialog (CAP-1):** the copy is only extracted verbatim into
  `compareTemplate()`, so the "02-help" showcase scene (captured collapsed)
  should not drift. Verify this at implementation rather than assume it; if it
  does drift, regenerate it the same way.

The `/help` page itself is new, so it has no prior capture to drift; its scene
coverage is the CAP-8 shortlist above.
