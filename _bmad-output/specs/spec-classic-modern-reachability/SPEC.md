---
id: SPEC-classic-modern-reachability
companions: []
sources: []
---

> **Canonical contract.** This SPEC is the complete, preservation-validated contract for what to build, test, and validate. It was distilled from a five-agent design party (UX, visual/craft, game design, architecture, dev) whose rationale lives in `.memlog.md`; consult that only for narrative color this contract omits.

# Classic vs Modern ruleset reachability

## Why

An opportunity to close a real in-game gap. Verticopolis founds each tower as Classic (faithful 1994) or Modern (same game plus opt-in extras), an irreversible choice, yet nothing in the running game names which rule-set the active tower uses, and a player who founded Modern sessions ago has no way to recall what Modern actually changes. The full "Classic vs Modern" comparison exists only as a collapsed section buried in the Help dialog, and its copy is maintained by hand (it has already drifted twice as Modern features shipped). This work makes the active rule-set visible and the comparison reachable during play, and collapses the comparison to a single source so it cannot drift, all inside the existing dialog machinery with no new page, route, or build surface.

## Capabilities

- **CAP-1**
  - **intent:** Every UI surface renders the Classic vs Modern comparison from one shared template, so the copy has a single source and cannot drift.
  - **success:** The comparison body lives in `src/ui/templates/compare.ts` (`compareTemplate()`); `help.ts` renders it inside the unchanged `<details class="help-modes"><summary>Classic vs Modern</summary>`, and the existing `help.test.ts` drift guard (the `RULE_TO_HELP` map, copy-sync, and uniqueness tests, located via `sectionBySummary("Classic vs Modern")`) passes with no edits.

- **CAP-2**
  - **intent:** A player mid-game can see which rule-set the current tower runs.
  - **success:** A badge in the Tower panel reads "This tower: Classic" or "This tower: Modern" from the live mode (`ui.cb.getMode()` / `sim.mode`, set from `uiStatus` after `setTowerName`); it updates after an `adoptSim` swap and updates its label/class only when the mode changes.

- **CAP-3**
  - **intent:** A player can open the full comparison during play.
  - **success:** Clicking the mode badge opens a Compare modal (`uiDialogs.showCompare` rendering `compareModalTemplate`: an `<h2>Classic vs Modern</h2>`, `compareTemplate()`, and a close button) through the existing single `#modal` `openModalTemplate`, and it closes cleanly via the standard close/Esc/backdrop path.

- **CAP-4**
  - **intent:** At founding, a player can read the full comparison without leaving the mode decision.
  - **success:** A collapsed `<details class="nt-compare well">` beneath the two mode cards in the founding modal reveals `compareTemplate()` inline; the mode radio selection is untouched (the founding dialog keeps its one DOM box), with no second surface and no change to `newTowerModal` wiring.

## Constraints

- In-app only: reuse the single reused `#modal` (`UI.ts` `openModalTemplate`) and lit-html. No standalone HTML page, no client-side router, no new Vite input, no Workbox precache entry, no Vercel routing change.
- No modal stacking and no drawer. `showModal()` puts the dialog in the browser top layer, so a drawer renders behind the backdrop, and a second dialog occludes the first on mobile while compounding the backdrop dimming. Founding reveals the comparison with an inline `<details>` only.
- `compareTemplate()` is the only copy of the comparison prose. `help.test.ts` must pass unedited, because `compareTemplate()` renders inside the same "Classic vs Modern" section the guard inspects.
- No "Modern adds N" feature count on the founding screen. Frame Classic as the faithful reference build, never as the option with fewer features. Keep the existing three-feature "Modern adds" teaser.
- Do not render the mode inside `#tower-stats` (the lit one-renderer invariant owns that element); the badge is a separate element. `setMode` updates the badge only when the mode value changes, so the per-frame status pump carries no cost.
- American English, no em-dashes, no marketing vocabulary, no "X, not Y" emphatic pattern. Minor `package.json` version bump (player-facing), lockfile in lockstep. Review lane: `/bmad-code-review`. Do not touch `GameRules` or engine behavior.

## Non-goals

- A standalone `/help.html` page, a deep-linkable `/help` URL, or any SEO/shareable rendering of the comparison.
- A client-side router or hash routes. (A hash route is noted as the lightest future deep-link if one is ever wanted, but it is out of scope here.)
- Any change to `GameRules` / engine behavior, or to the wording of the comparison beyond extracting it verbatim into the shared template.
- Any PWA (Workbox precache), Vite multi-page input, or Vercel configuration change.

## Success signal

A returning player opens a Modern tower they founded long ago, sees "This tower: Modern" in the Tower panel, clicks it, and reads the full Classic vs Modern comparison, all from the same copy the Help dialog and the founding screen show, with no new page, route, or duplicated text. Adding a future Modern divergence still fails `npm run typecheck` at the `RULE_TO_HELP` map until it is classified, and the single `compareTemplate()` means the new line appears everywhere at once.

## Assumptions

- The active mode is available to the UI without new plumbing (`ui.cb.getMode()` is already used in `uiDialogs.ts`, and `sim.mode` is already read in `uiStatus.ts`).
- The Tower panel (`src/index.html`, near `#tower-name`) is the right home for the mode badge; the badge doubles as the click target that opens the Compare modal.

## Open Questions

- Review lane: the dev lens placed this in `/bmad-code-review` (UI plumbing plus shared copy, no engine change); the architecture lens noted `/gds-code-review` because the copy names gameplay-parity semantics. Default is `/bmad-code-review`; confirm whether the parity-copy content warrants also running `/gds-code-review`.
