# Spec: Complete the lit-html conversion (diagnostics, palette, onboarding)

**Status:** in-progress
**Owner:** UI rendering layer
**Review skill:** `/bmad-code-review` AND `/gds-code-review` (the diagnostics read
sim/economy data and carry gameplay-facing copy, so both lenses apply)
**Companion:** the migration epic
`_bmad-output/planning-artifacts/design/ui-rendering-engine-2026-07-14/30-epics-and-stories.md`
and its E7 decision in `_bmad-output/implementation-artifacts/backlog.md`.

## Why

The lit-html migration (epics E0-E7) shipped every dialog and panel. Two things
were left behind, one recorded and one never scoped:

1. **The diagnostics never got their template form.** The migrated editor
   (`src/ui/templates/editor.ts`) and inspector (`src/ui/templates/inspector.ts`)
   cards still feed themselves `facilityDiagnostics()` / `transportDiagnostics()`
   HTML STRINGS through `unsafeHTML` (4 call sites), and those functions still
   call `escapeHtml`. The E7 note records this exactly: *"Diagnostics stay HTML
   strings bridged by unsafeHTML ... their template form is a final-sweep/E7
   question."* That question is answered here: they become lit templates and the
   `unsafeHTML` bridges are deleted. This is the migration's own definition of
   done ("no `escapeHtml` in a migrated template; `unsafeHTML` is a red flag").

2. **The build palette and the onboarding/splash screen were never in the epic.**
   Both still build markup with `innerHTML` string interpolation. They are
   converted here so the app has one rendering model for its live UI.

Two surfaces are DELIBERATELY LEFT IMPERATIVE and are out of scope:

- **The bulletin log + toast rail** (ratified E7-S1 decision: append-only streams
  with performance structure and unbatched `aria-live`).
- **The crash screen** (`src/ui/crashScreen.ts`) and the `main.ts` fatal-stage
  message: failure surfaces that must render when the app/renderer has already
  broken. Adding a lit `render()` dependency to the one path that must survive a
  broken bundle buys nothing. Same resilience rationale as the log/toast.

## Scope

In:

- `src/game/facilityDiagnostics.ts`: `facilityDiagnostics`, `transportDiagnostics`,
  `retailStatsLines`, and the `parkingDemandLine` / `recyclingLine` helpers return
  `TemplateResult[]` instead of HTML strings; the `escapeHtml` import and both
  calls are removed.
- `src/ui/templates/editor.ts` + `src/ui/templates/inspector.ts`: drop the
  `unsafeHTML` import and all 4 bridges; interpolate the arrays directly; the
  mobile editor gates its `.ed-diagnostics` wrapper on a non-empty array.
- `src/ui/uiPalette.ts`: `toolButton` / `facilityButton` render their inner
  markup with lit; the `makeActivatable` event wiring stays imperative.
- `src/ui/Onboarding.ts`: the splash (`showSplash`) and the checklist
  (`render` / `finish`) render with lit; focus trap, `data-splash` /
  `data-onboard` delegation, and every aria attribute are preserved.
- `src/ui/UI.ts`: delete the dead `openModal(html: string)` string path (no
  product caller; only a test helper reaches it).

Out: crash screen, `main.ts` stage message, bulletin log, toast rail.

## Capabilities and acceptance

- **CAP-1 (diagnostics templates, no unsafeHTML).**
  - intent: the editor and inspector cards fold in the diagnostics as real lit
    nodes, not a re-parsed HTML string.
  - success: `facilityDiagnostics` / `transportDiagnostics` / `retailStatsLines`
    return `TemplateResult[]`; grep for `unsafeHTML` across `src/` (non-test)
    returns nothing; `escapeHtml` is no longer imported by
    `facilityDiagnostics.ts`; the emitted DOM (the `<div>` lines, their
    `style="color:var(--bad|--good)"`, the `evalbar` span, text) is identical to
    before; the mobile editor renders NO `.ed-diagnostics` wrapper when the array
    is empty (parity with the old empty `:empty { display:none }` div), and the
    wrapper WITH its `data-field="diagnostics"` marker when non-empty.
  - line order preserved: access, hotel, parking, walk-far, commercial-lobby,
    recycling, notice, retail.

- **CAP-2 (palette on lit).**
  - success: `.pal-item` markup (`class`, `data-kind`, `data-group`, `data-tool`,
    the swatch/name/cost spans, `style="background:..."`) is byte-stable so the
    e2e selectors (`.pal-item[data-kind="office"]`, `[data-tool="inspect"]`) and
    the onboarding pulse selectors keep resolving; `role=button`, `tabindex=0`,
    `aria-label`, Enter/Space activation, the `e.repeat` guard, and
    `stopPropagation` all stay on the item via `makeActivatable`.

- **CAP-3 (onboarding on lit).**
  - success: the splash SVG renders pixel-identically (skyline paths, the
    wordmark/tagline `<text>` with `textLength` / `lengthAdjust` / `text-anchor`,
    `aria-hidden` on decorative layers, `role="img"` + `aria-label` on the two
    lettering SVGs); the focus trap, Esc/backdrop safe-dismiss, and
    `data-splash` / `data-onboard` handlers behave identically; the checklist
    `ob-step` states/marks and the send-off render identically.

- **CAP-4 (dead code).** `openModal(html:string)` is gone; the integration test
  that reached it is retargeted or retired.

## DOM-parity constraints (the correctness contract)

- Empty diagnostics map to an EMPTY ARRAY, never `""`; the editor gates its
  wrapper on `array.length` so no stray empty div (with lit part-marker comments)
  is emitted. This keeps the `#editor .ed-diagnostics:empty { display:none }`
  behavior as "no box at all", visually identical.
- `escapeHtml` removal is total: `VACATE_REASON_TEXT[...]` interpolates as a lit
  text binding (auto-escaped). A leftover `escapeHtml` inside a text binding would
  double-escape.
- The conditional retail-verdict color maps to `style=${color ? ` + "`color:${color}`" + ` : nothing}`
  so the no-color branch emits NO `style` attribute, exactly as today.
- Zero visual/snapshot churn: no file under `e2e/visual.spec.ts-snapshots/` or
  `docs/screenshots/` changes. A pixel diff is a defect to fix, not a baseline to
  regenerate. (lit part-marker comment nodes are invisible and do not move pixels.)

## Test plan

- Rewrite `src/game/inspectorRetailStats.test.ts` from HTML-string `.toContain`
  assertions to semantic-DOM assertions via `renderToFragment` (verdict text,
  the verdict div's `style` color, the `evalbar` width, plural/singular, rain
  line, empty case = empty array).
- Add `src/game/facilityDiagnostics.test.ts`: empty unit -> `[]`; access lines
  (connected / reachable / too-far); hotel counts-toward-stars; on-notice (both
  the relocation and the fixable branches, asserting the reason text renders as
  text and the recovery-target line); the color attributes.
- `src/ui/templates/editor.test.ts` and the two `gameControllers` integration
  suites assert on `textContent`, so the fold-in text is preserved; they are the
  regression net for the wrapper gating. One `editor.test.ts` case is updated to
  match the new gating: the mobile transport fold-in seeds a measured
  utilization so `transportDiagnostics` emits a line (an idle, never-ticked
  elevator has no measurement, so no `.ed-diagnostics` box now renders), with a
  companion case pinning that empty-elevator no-box behavior.
- Palette: extend/keep the palette coverage asserting `.pal-item` attributes,
  the swatch/name/cost spans, and activation semantics.
- Onboarding: a unit test rendering the splash template asserting the SVG aria
  attributes and the `data-splash` buttons; a checklist test asserting `ob-step`
  state classes and the skip button.

## Non-goals / decisions

- No `package.json` version bump: behavior-preserving, internal rendering-form
  change, no player-facing capability or fix.
- No data-struct split of the diagnostics (game returns structs, ui renders): the
  `TemplateResult` stays in `src/game/` beside the sim reads, matching the E6
  pattern where templates call `facilityDiagnostics` directly. A `TemplateResult`
  is inert data and touches no DOM, so the module's "no DOM until rendered"
  property holds; the header comment is updated to say so.
- Crash screen and log/toast stay imperative (recorded above).
