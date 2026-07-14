# Declarative UI Rendering Layer - Epics and Stories

**Produced with:** `bmad-create-epics-and-stories`, revised to fold in the
three-lens review (all ENDORSE WITH CHANGES). See `15-party-review-synthesis.md`.
**Companion to:** `10-product-brief.md`, `20-architecture-decision.md`,
`40-spec-first-story.md`, `15-party-review-synthesis.md`,
`50-testing-strategy.md`, and the party findings `00-party-notes.md`.
**Intended target location:**
`_bmad-output/planning-artifacts/design/epics-ui-render-layer-2026-07-14.md`

Sequences the migration from hand-built HTML strings + imperative wiring to
`lit-html` into buildable stories. Each story names the files it touches, its
acceptance criteria, its a11y checklist, and carries the five-part test package.
**Every story is tooling/UI-plumbing + architecture, so the mandatory in-session
deep review is `/bmad-code-review`, never gds.** Every story runs the four quality
gates (`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`).

## Sequencing rationale

E0 proves the approach on one dialog, lands the shared modal-template mount, and
delivers the shift-left test harness, so no later story debates the mechanism or
lacks the tooling to test it. E1 lands the held `main.ts` `UICallbacks` split
(framework-agnostic) so the rest of the work dispatches into a clean action
surface. E2 to E4 convert dialogs from the leaves outward (simple, then
list-and-blob driven, then the one stateful dialog), each independently shippable.
E5 converts the live views behind a blocking perf gate (E5-S0), per surface, where
the diffing win is real (the tower-stats grid) and the throttled ~6 Hz constraint
is tightest. E6 converts the editor/inspector last (highest coupling), rewriting
the two tests that encode the mechanism it removes. E7 decides the fate of the
deliberately imperative log and toast surfaces. Each epic is behavior-preserving
and independently revertible.

## Cross-cutting definition of done (every story)

- The emitted DOM (tags, `id`s, class names, `data-*`, `aria-*`, text) is
  identical to before; e2e selectors unchanged; markup authored verbatim with no
  reflowed inline whitespace.
- **The five-part test package ships and is green** (see the AC block below and
  `50-testing-strategy.md`). Merge-blocking.
- **The per-story a11y checklist is satisfied and asserted as acceptance
  criteria**, not left to the pixel snapshot (a11y lives in controller side
  effects, invariant 5).
- No `escapeHtml` call remains in a migrated template; sub-rows are nested
  `TemplateResult`s, not interpolated HTML strings; `unsafeHTML` is a reviewable
  red flag, not a shortcut.
- One container, one renderer: never `render()` and set `.innerHTML` on the same
  element.
- The four quality gates are green; `/bmad-code-review` ran in-session; `patch`
  findings fixed and re-verified, `defer` findings logged to `backlog.md`.
- Migrated modules gain real unit coverage; the coverage ratchet does not fall; no
  new coverage exemption.
- No `package.json` version bump (behavior-preserving, internal-only). A pixel or
  behavior change discovered is a defect to fix, not a bump.
- No new full-collection scan on the throttled pump or any per-tick path.

## The five-part test package (repeated AC block, every migration story)

Every migration story (E2 onward, and the E0 proof) ships all five, all
merge-blocking (full detail in `50-testing-strategy.md`):

1. **Colocated shift-left unit test** (`*.test.ts`): renders the template via
   `renderToFragment` and asserts SEMANTIC structure (never `outerHTML`
   equality), event dispatch to the correct callback with correct args, hostile
   input auto-escaping to visible text, and this story's a11y-checklist specifics.
2. **Transitional old-vs-new DOM-equivalence test**: `assertDomEquivalent(oldBuilder(args),
   newTemplate(args))` over empty / populated / hostile / boundary inputs.
   DELETED in the same PR that retires the string builder.
3. **The integration spec stays green** (`uiDialogs.integration.test.ts`
   unchanged), with the E6 rewrite carve-out.
4. **Live views only**: clears the E5-S0 perf baselines.
5. **Zero visual/snapshot churn**: `git diff --stat` touches no file under
   `e2e/visual.spec.ts-snapshots/` or `docs/screenshots/`.

---

## E0 - Foundation: dependency, mount, test harness, and proof

Files: `package.json`, `src/ui/UI.ts`, `src/ui/uiTemplates.ts` (or a new
`src/ui/templates/` module), a new test-harness module (for example
`src/ui/testing/litTestUtils.ts`), the migrated `confirmModal`, its tests.

- **E0-S1 Add `lit-html` and the modal-template mount.** Add `lit-html` as a
  pinned production dependency (import `html`/`render` from `lit-html` directly,
  not the `lit` barrel). Add `openModalTemplate(result)` beside the kept
  imperative `openModal`: it builds the SAME `.modal-box.win` shell, skins the
  top-level `h2` as `.win-title`, appends the title-bar x via `titleBarClose` as
  the LAST child after `showModal()`, wires backdrop `onclick` and `oncancel` to
  close, and `render`s into a fresh-per-open box discarded on close.
  - **Bundle ACs:** build green; the built chunk contains NO `LitElement`/
    custom-element code; the PRODUCTION lit build is bundled (no lit dev banner in
    `dist`); directive imports resolve from `lit-html/directives/*` and tree-shake;
    lists will use `map` (unkeyed), not `repeat`; `ref` is not used (render is
    synchronous, so post-render `offsetWidth` reads are valid); bundle delta under
    ~6 KB gzipped.
  - **A11y checklist (E0 mount):** x appended AFTER focus and `showModal()`;
    `onclick`/`oncancel` set by PROPERTY ASSIGNMENT, never `addEventListener`;
    initial focus driven by an explicit `.focus()` on the primary action, not the
    `autofocus` attribute.
- **E0-S2 Shift-left test harness.** Deliver `renderToFragment(TemplateResult)`,
  `assertDomEquivalent(legacyString, litTemplate)` (normalized tag/class/id/
  `data-*`/`aria-*`/`role`/`name`/`type`/boolean-attr equality, insignificant
  whitespace ignored, significant inline whitespace preserved, never raw
  `outerHTML` equality), and a small event-dispatch harness (fire @click/@change,
  assert callback + args). Unit tier, happy-dom, runs pre-push before e2e. AC:
  each helper has its own unit test; the three helpers are importable by every
  later story's tests.
- **E0-S3 Convert `confirmModal` as proof.** Migrate `confirmHtml` + `confirmModal`
  to a lit template with the `onYes`/close actions as inline `@click` bindings, no
  separate `addEventListener` pass. Chosen because it also proves inline callback
  dispatch and the `{ close: false }` no-close-button case (the mechanism every
  later dialog reuses). AC: `#modal .modal-box` structure identical; `[data-act]`
  intact; the integration spec's confirm and window-grammar blocks pass; the
  five-part test package ships (including the transitional `assertDomEquivalent`
  test for `confirmHtml`); zero snapshot diff.

## E1 - Land the held `main.ts` UICallbacks split (no lit-html)

Files: `src/main.ts`, new `src/game/uiCallbacks.ts`.

- **E1-S1 Extract `createUICallbacks(...)`.** Move the ~30-callback object literal
  out of the `GameApp` constructor into `createUICallbacks(app: GameAppPorts):
  UICallbacks`, taking a narrow deps slice, mirroring `BuildActions`/
  `EditorActions`/`SaveLoad`. Hardened ACs:
  - The factory captures the LIVE instance through getters/thunks (mirroring
    `getSim: () => this.sim`), NEVER destructured values, so an `adoptSim` swap is
    still seen by the callbacks.
  - Callbacks that mutate private `GameApp` state (`onSelectTool` writing
    `this.tool` / `paintAnchor` / `transportStart` / `engine.preview...` etc.)
    DELEGATE to `GameApp` methods or ports, they do not reach into privates.
  - Construction order preserved: controllers built BEFORE `new UI(...)`, because
    the UI ctor's initial `selectTool` fires `onSelectTool` synchronously and needs
    `this.keyboard`.
  - `main.ts` shrinks below the file-size guard for this concern; `UICallbacks`
    interface unchanged; all e2e and unit tests green; no behavior change. This
    resolves the split that was on hold. (No lit-html, so no template test
    package; the standard four gates and `/bmad-code-review` still apply.)

## E2 - Simple dialogs

Files: `src/ui/uiTemplates.ts`, `src/ui/uiDialogs.ts` (one dialog per story),
tests.

- **E2-S1 Confirm and event-choice.** Migrate `confirmModal` (finishing E0's proof
  into the seam) and `showEventChoice`. Preserve the emergency modal's
  resolve-exactly-once logic in the controller.
  - **A11y checklist (confirm/event):** fire-once resolves across all FOUR paths
    (button, Esc, backdrop, x); dismiss == decline; `{ close: false }` (no close
    button, x still closes via cancel). `onclick`/`oncancel` by property
    assignment. AC: single-resolve intact across all four paths (tested);
    `{ close: false }` preserved; snapshots unchanged.
- **E2-S2 Update prompt and update chip.** Migrate `showUpdatePrompt` (and the
  `updatePromptHtml` notes/build-id blocks) and the update chip.
  - **A11y checklist (update):** later == backdrop == Esc == x; handlers
    fire-and-forget (async, contained); the chip re-announces on EVERY call
    (`#a11y-live` cleared then re-set on the next rAF), asserted after show. AC:
    `.whatsnew li` and `.build-id` selectors intact; single-resolve across all
    four paths; the chip announcement test passes; snapshots unchanged.
- **E2-S3 Settings (stateful, its own checklist).** Migrate `showSettings`
  (`settingsHtml`). NOTE: Settings is NOT a simple/static dialog. It is stateful:
  sliders read live volumes and apply on input, both switches re-read live state
  after every toggle, and OS-forced reduced motion sets the switch `disabled` AND
  relabels the span to "Reduced motion (system)".
  - **A11y checklist (settings):** `role=switch` + `aria-describedby` on both
    toggles; the OS-forced-reduced-motion path disables the switch AND relabels the
    span; the `data-vol-val` volume readouts stay `aria-hidden`. AC: sliders
    initialize from live volumes and apply on input; switches reflect and re-read
    live state; the OS-forced path disables + relabels; readouts stay
    `aria-hidden`; snapshots unchanged.
- **E2-S4 Help.** Migrate `showHelp` (`helpHtml`): the long body, the
  splash-gated replay button, the external report link.
  - **A11y checklist (help):** explicit primary focus on "Got it" (not the
    external link); replay `disabled` + `title` while the splash is up; the report
    link keeps `rel=noopener` + its visually-hidden span and routes through
    `routeExternalInWrapper`. AC: replay disabled on splash; report link routed in
    the wrapper; primary focus correct; version line correct; snapshots unchanged.

## E3 - Data-driven and blob dialogs

Files: `src/ui/uiTemplates.ts`, `src/ui/statsHtml.ts`, `src/ui/uiDialogs.ts`,
tests.

- **E3-S1 Saved towers.** Migrate `showSaves` (`savesHtml`): auto-save + numbered
  slot rows with save/load/delete per row, export/import actions. Rows via `map`
  (unkeyed); recompose the per-row markup as nested `TemplateResult`s (not a
  `.join("")` string); drop `escapeHtml` on tower names (auto-escaped).
  - **A11y checklist (saves):** each delete button keeps its per-row
    `aria-label="Delete save slot N"`, templated through the map. AC:
    `[data-save]`/`[data-load]`/`[data-del]` dispatch intact; slot detail
    formatting identical; hostile tower name renders as text; snapshots unchanged.
- **E3-S2 Elevator stops.** Migrate `showStopsDialog` (`stopsHtml`): per-floor
  checkboxes with the lobby tag, `onToggle` per checkbox via inline `@change`;
  nested `TemplateResult` rows, not a joined string.
  - **A11y checklist (stops):** each checkbox has its label association; the lobby
    floor keeps its lobby tag. AC: toggling a floor calls back with
    `(floor, checked)`; title renders as text; snapshots unchanged.
- **E3-S3 New tower picker.** Migrate `newTowerModal` (`newTowerHtml`): the
  Classic/Modern radio bodies, the calendar sub-picker, the conditional abandon
  warning. IMPORTANT: the `.nt-calendar` block renders ALWAYS (both modes); only
  `found()` reads `nt-cal`, and only when the mode is Modern. Do NOT "improve" it
  into a `mode==='modern' ? html : nothing` conditional; that would change the
  markup and the tab order.
  - **A11y checklist (new-tower):** calendar always rendered and reachable;
    radios keep their label wrapping. AC: `found` reads the picked mode and (for
    Modern) the calendar exactly; Classic ignores `nt-cal` and pins the harmless
    default; abandon warning folds in only when a tower exists to lose; cancel
    path intact; snapshots unchanged.
- **E3-S4 Import/export reports and export choice.** Migrate `showImportReport`,
  `showExportReport`, and `confirmExport` (`importReportHtml`, `exportReportHtml`,
  `exportConfirmHtml`): the fact lines, brought-over/couldn't-bring lists (nested
  `TemplateResult`s, not joined strings), the a11y-live announcements, the
  Modern-gated legacy button. Drop `escapeHtml` on report strings and filenames.
  - **A11y checklist (reports):** the `#a11y-live` polite announcement fires when
    each report opens (asserted after open); the `isModalOpen()` clobber guard is
    preserved (a report yields with a toast rather than wiping a live modal); the
    Modern-gated legacy button stays `disabled` + `title`. AC: guard preserved;
    legacy button disabled + titled for Modern; announcements fire; report strings
    render as text; snapshots unchanged.
- **E3-S5 Statistics dialog (the worst string-composition case).** Migrate
  `showStats` / `statsModalHtml`, which today interpolates a pre-built
  `buildStatsHtml(sim)` HTML blob. Under lit that blob would be escaped to visible
  text, so this cannot be a mechanical port. Decide and record: either migrate
  `buildStatsHtml` (and `buildElevatorHtml`/`buildIncomeHtml`/`buildMilestonesHtml`
  in `statsHtml.ts`) to nested `TemplateResult`s alongside the modal, or keep the
  stats blob rendering imperative into its own container (one container, one
  renderer) and leave only the modal shell on lit. `unsafeHTML` is not the answer.
  - **A11y checklist (stats):** the stats body renders as real DOM (not escaped
    text); the close action dispatches inline. AC: the decision on `buildStatsHtml`
    is recorded; the stats body is real DOM; the dialog opens and closes
    identically; snapshots unchanged.

## E4 - The interactive stateful dialog

Files: `src/ui/uiTemplates.ts`, `src/ui/uiDialogs.ts`, tests.

- **E4-S1 Batch pricing.** Migrate `showBatchPricingDialog` (`batchPricingHtml`).
  Replace the hand-written `refresh()` (recompute preview text + `disabled` on
  every input) with a re-render from local dialog state on each input event.
  Preserve exactly: snap-to-step normalization, the inc/dec adjuster, the
  only-default-priced filter, the honest preview counts, and the two-click
  confirm-reset for the bulk default.
  - **A11y checklist (batch):** `#bp-preview` keeps `aria-live="polite"`; the
    inc/dec buttons keep their `aria-label` ("decrease"/"increase"); the two-click
    reset and the Apply-disabled parity behave identically. (Announcing the reset
    arming is a deferred a11y WIN, logged to the backlog, NOT added here.) AC:
    preview and Apply-disabled identical across every input path; confirm-reset
    requires two clicks; `#bp-preview` stays a live region; snapshots unchanged.

## E5 - Live views (behind a blocking perf gate)

Files: `src/ui/uiStatus.ts`, `src/ui/uiTemplates.ts` (`towerStatsHtml`,
`buildToolInfoHtml`), `src/ui/uiPalette.ts`, `src/main.ts` (the throttle stays),
plus new committed perf-baseline JSON and a Playwright perf spec.

- **E5-S0 Perf gate (BLOCKING, before any live-view migration).** Land the perf
  harness and capture baselines on the pre-E5 commit, committed as JSON, enforced
  in CI:
  - **(A)** a Playwright micro-benchmark of `ui.update` ms/frame on a committed
    large-tower fixture, N=2000 pumps: assert `median(after) <= median(before)`,
    HARD-FAIL at +5%; `p95(after) <= 1.10 x p95(before)`.
  - **(B)** at speed 120 on a 4-6x CPU-throttled profile, measure sim-minutes
    advanced per real second over a fixed window: assert `>= baseline` (this tests
    "same speed or faster" end to end and catches the catch-up spiral).
  - **(C)** DOM node identity stable across pumps (no per-pump rebuild) + a
    write-before-`positionPanels`-layout-read ordering rule (no forced reflow).
  - AC: the three measurements run in CI against committed baselines; E5-S1 onward
    must clear them (test-package part 4). If profile B ever regresses, apply the
    recorded structural mitigation (decouple `ui.update` from `engine.onUpdate`'s
    dt accounting); it is out of scope unless B fails.
- **E5-S1 Tower-stats grid (migrate) and status bar (keep or render-on-change).**
  Migrate the tower-stats grid: replace `towerStats.innerHTML =
  towerStatsHtml(...)` (a full reparse every pump) with a `render(...)` from the
  per-frame snapshot, keeping the `lastUiUpdate` throttle. For the status bar, keep
  the five leaf writes imperative or gate a `render()` on snapshot-inequality;
  either way target the individual leaf spans (`money`/`pop`/`star`/`time`/`date`),
  NOT a wrapper that also owns `#traffic` (updated imperatively by `main.ts`
  `updateTraffic()` with hysteresis, or the two writers clobber each other).
  - **A11y checklist (status):** money-negative color preserved; the star string
    preserved; node identity stable. AC: grid values match the old surgical writes;
    render target is the leaf spans, not `#traffic`; node identity stable across
    pumps; clears E5-S0; snapshots unchanged.
- **E5-S2 Tool-info panel.** Render `buildToolInfoHtml` / the bulldoze+inspect info
  through lit on tool select (event-driven, not a pump path, so free to migrate).
  Recompose its inner rows as nested `TemplateResult`s. AC: identical markup per
  tool; clears E5-S0; snapshots unchanged.
- **E5-S3 Palette lock/afford (dirty-gate; optional binding move).** Bank the free
  win: dirty-gate the lock scan so it rescans only when a star threshold or an
  affordability boundary is crossed. Optionally express the per-item
  `.locked`/`.unaffordable` and group-title hidden state as `classMap` bindings,
  only if it measures clean on a phone tier; otherwise leave the imperative pass
  and record the decision.
  - **A11y checklist (palette):** keep `.locked` items OUT of the tab order;
    preserve `role=button`, `tabindex`, Enter/Space activation, the `e.repeat`
    guard, and `stopPropagation` on the keyboard path. AC: parity with current
    lock/afford behavior; the dirty-gate rescans only on a crossing; clears E5-S0;
    snapshots unchanged.

## E6 - Editor and inspector panels (highest coupling, last)

Files: `src/ui/uiPanels.ts`, `src/ui/editorHtml.ts`, `src/ui/UI.ts`,
`src/ui/anchor.test.ts`, `src/ui/editorPatch.test.ts`,
`src/tests/integration/uiDialogs.integration.test.ts` (the `renderEditor` block),
`src/main.ts` (the `renderEditor(key, build, volatile)` call site).

- **E6-S1 Editor card via lit diffing (with the test-rewrite carve-out).** Migrate
  `renderEditor`/`showEditor` so lit-html's binding diff replaces the
  `key`/`patchVolatile` protocol. This phase is NOT test-unchanged by
  construction: the `renderEditor` describe block in the integration spec and
  `editorPatch.test.ts` encode the exact `key`/`patchVolatile` mechanism the diff
  removes, so they are REWRITTEN in this story, and a NEW test pins the surviving
  invariant directly: a refresh landing between `pointerdown` and `pointerup` must
  not recreate the pressed button (the "+ rent sometimes does nothing" bug). Keep
  `editorBusy` as belt-and-suspenders through E6. Keep `patchVolatile`/
  `anchorBeside` exported from `ui/UI` until their tests are updated in this same
  story. Preserve the cached `editorSize` measure and the `data-edit`/`data-field`
  attributes `main.ts` and tests read.
  - **A11y checklist (editor):** `.ed-close` keeps its aria-label; the `data-edit`
    action dispatch is preserved. AC: the "+ rent" mid-click bug does not regress
    (new test); anchoring math unchanged; the two rewritten tests are green;
    snapshots unchanged.
- **E6-S2 Inspector card and build-refusal tooltip.** Migrate `showInspector`
  (including the mobile x injection and the Modern build-refusal tooltip driven
  from `main.ts`).
  - **A11y checklist (inspector):** the `insp-close` x keeps its aria-label; the
    `win-title` h4 is preserved; mid-click safety and mobile x affordance intact.
    AC: mobile close affordance intact; refusal tooltip ownership
    (`buildRefusalShowing`) preserved; snapshots unchanged.

## E7 - Decide the retained imperative surfaces

Files: `src/ui/uiStatus.ts` (log + toast), a short decision note appended to the
backlog.

- **E7-S1 Log and toast decision.** Evaluate migrating the bulletin-log
  append/prune (`LOG_DOM_CAP`, column-reverse) and the toast rail. Default:
  **leave imperative** and record the rationale (deliberate performance
  structures, not markup). Do NOT throttle their `role=log` / `aria-live`
  announcements to meet a frame budget. If migrated, prove no regression to the
  constant-node append/prune and the self-removing toast cap.
  - **A11y checklist (log/toast):** keep the `role=log` / `aria-live` regions;
    announcements are not dropped for the frame budget. AC: a written decision; if
    left, a one-line note in `backlog.md`; if migrated, a perf spot-check and the
    a11y regions preserved.

## Deferred (backlog, not a behavior-preserving phase)

- A11y WIN: add `aria-labelledby` tying `#modal` to its `.win-title` h2.
- A11y WIN: announce the batch two-click reset arming.
- Structural perf mitigation: decouple `ui.update` from `engine.onUpdate`'s dt
  accounting (own rAF/timer), applied only if E5-S0 profile B regresses.

Log all three to `_bmad-output/implementation-artifacts/backlog.md`.

## Dependencies and parallelism

- E0 blocks everything (mount + harness + proof).
- E1 (the `main.ts` split) has no lit-html dependency and can land in parallel
  with E0, but is sequenced first among the migration work so later dialogs
  dispatch into the clean action surface.
- E2, E3, E4 are independent of each other once E0 lands; each dialog is its own
  PR and can be parallelized across contributors.
- E5-S0 blocks E5-S1/S2/S3 (the live views cannot merge without clearing the perf
  baselines). E5 depends on E0.
- E6 depends on E0 and is done last (highest coupling); it rewrites the panel and
  editor-patch tests.
- E7 is a decision, runnable any time after E5.
</content>
