# Declarative UI Rendering Layer - Architecture Decision

**Architect:** Winston (with Amelia on migration mechanics, Sally on fidelity),
revised to fold in a three-lens review (dev, design/UX, game/perf), all three
ENDORSE WITH CHANGES. See `15-party-review-synthesis.md` for the verdicts and the
finding-by-finding trace.
**Produced with:** `bmad-architecture`
**Companion to:** `10-product-brief.md`, `30-epics-and-stories.md`,
`40-spec-first-story.md`, `15-party-review-synthesis.md`,
`50-testing-strategy.md`, and the party findings `00-party-notes.md`.
**Intended target location:**
`_bmad-output/planning-artifacts/design/arch-ui-render-layer-2026-07-14.md`

This document says HOW the DOM UI moves from hand-built HTML strings + imperative
wiring to a declarative rendering layer: the framework decision and its rejected
alternatives, the component model, the imperative-to-declarative bridge for
`GameApp`, how throttled sim state feeds the layer without re-rendering the
world, the modal-mount decision, the bundle/interop/snapshot impact, the
incremental migration phase order, the testing and regression strategy, and how
it resolves the held `main.ts` split. It is the plan of record for the
initiative. It changes nothing a player can see.

---

## 1. Load-bearing invariants (read before touching a template)

These hold across every phase. A future contributor gets the red flags first.

1. **The emitted DOM is byte-stable.** Tags, class names, `id`s, `data-*`
   attributes, attribute order where it is observable, and text content match the
   pre-migration strings. The design system (`docs/design-system.md`), the e2e
   selectors, and the visual snapshots all key on this. A migrated template that
   changes the markup is a bug, not an improvement. Author markup verbatim, with
   no reflowed whitespace between inline elements (the batch stepper
   `>-</button>...<button>+` and the `vol-row` are the sharp cases: a space
   introduced or dropped between inline elements is an observable change).
2. **The `UICallbacks` command boundary is unchanged.** Declarative components
   dispatch user intent through the same `cb.onX(...)` actions the imperative
   wiring uses today. The framework does not move this boundary. This is what
   keeps the migration incremental and unblocks the `main.ts` split (section 8).
3. **The throttled pump stays surgical, at or below today's cost.** DOM refresh
   runs on a ~6 Hz throttle, NOT per frame: `main.ts` gates it on
   `now - lastUiUpdate > 160`. It must not rebuild a subtree's `innerHTML` on a
   pump. It updates values through render-on-change (shallow-compare the view
   snapshot, skip `render()` when unchanged) and binding-level diffing, never a
   teardown. The 60fps Excalibur loop owns the frame budget; the DOM layer is a
   throttled guest whose per-pump cost must be at or below the pre-migration cost
   (the E5-S0 perf gate enforces this).
4. **One container, one renderer.** At any instant a given container is owned by
   exactly one renderer, imperative XOR lit, never both. lit stores its render
   state as a property on the container; the string path's `closeModal` does
   `innerHTML = ""`, which removes child nodes but NOT that property. Never call
   `render()` and set `.innerHTML` on the same element. During the mixed
   migration this is guaranteed by giving the lit path its own fresh-per-open box
   (section 4), so the string path and the lit path never share a container.
5. **A11y lives in controller side effects, not only in markup.** Most of the
   accessibility here is applied by controllers after render (the title-bar x,
   the `.focus()` on the primary action, `#a11y-live` announcements, the
   property-assigned `onclick`/`oncancel` resolve-once wiring, the OS-forced
   reduced-motion relabel). A mechanical template port drops all of it. Every
   migration story enumerates its a11y behaviors as acceptance criteria and tests
   them; a green pixel snapshot does not cover them.
6. **`src/engine/` stays free of DOM and rendering.** This work lives entirely
   under `src/ui/` and the `main.ts` composition root. No engine file imports the
   render library.
7. **No Shadow DOM.** The global `src/styles.css` must reach every rendered node.
   We use the standalone template renderer, not web components.
8. **Escaping is the renderer's job, and composition is nested, not concatenated.**
   Interpolations are auto-escaped. Raw-HTML insertion (`unsafeHTML`) is a
   reviewable red flag, never a shortcut, and no migrated template calls
   `escapeHtml`. Sub-rows are recomposed as NESTED `TemplateResult`s, never as
   pre-built HTML strings interpolated into a template (lit would escape such a
   string to visible text, section 3).

## 2. Decision: adopt `lit-html` (standalone), not full Lit

We adopt **`lit-html`**, the standalone HTML template and render library from the
Lit project. We do **not** adopt `LitElement`/web components/Shadow DOM.

Rationale (full scoring in `00-party-notes.md`):

- **It is the `uiTemplates` seam, upgraded.** `uiTemplates.ts` is already a set
  of pure `data -> HTML string` builders. A lit-html template is a pure `data ->
  TemplateResult` builder. Migrating a template is mechanical for the simple
  cases: replace the backtick string with an ``html`...` `` tagged literal, keep
  the `${}` interpolations, and fold button wiring into inline `@click=${...}`
  bindings. The not-mechanical cases are the string-composition builders
  (section 3).
- **No build-step change.** Plain TypeScript + Vite. No JSX, no new compiler, no
  `.tsx` toolchain. This satisfies the "prefer no-JSX-build" constraint directly.
- **Fidelity by construction.** Markup is authored literally, so the emitted DOM
  is identical; the e2e selectors and visual snapshots survive.
- **It deletes the two taxes.** Inline `@event` bindings remove the
  `addEventListener` boilerplate; auto-escaping removes the `escapeHtml`
  obligation and closes the injection class.
- **It coexists with the loop.** `render(template, container)` diffs only the
  dynamic bindings, leaving stable DOM in place, so a throttled render updates
  values without rebuilding nodes. It is a guest on the ~6 Hz pump, not a driver
  of it.
- **Negligible bundle cost.** ~3.7 KB min+gzip against ~550 KB of Excalibur and
  ~66 KB of Tone already in the precache.

Version pin: add `lit-html` (importing `html`/`render` from `lit-html` directly,
and `lit-html/directives/*` if needed) as a production dependency, pinned like
`excalibur`/`tone`/`fflate`. Import from `lit-html` directly to keep the
tree-shaken surface minimal and avoid pulling `LitElement`. The build must bundle
the PRODUCTION lit build (no dev banner in `dist`), and directive imports must
resolve from `lit-html/directives/*` and tree-shake. Use `map` (unkeyed), not
`repeat`, for the lists (none of them keep keyed identity across reorders). `ref`
is not needed: `render()` is synchronous, so a post-render `offsetWidth` read is
valid immediately after.

### 2.1 Rejected alternatives

- **Preact (+ `htm`) - runner-up, not chosen.** Mature, tiny, React-shaped. Lost
  because idiomatic JSX forces a `.tsx` build step we can avoid, and its component
  model is a larger jump from the current string-builder seam, so the per-dialog
  migration is less mechanical. Retain as the fallback if lit-html's directives
  prove limiting.
- **Solid - rejected.** Best-in-class fine-grained reactivity, but requires the
  Solid compiler/Babel preset (a build-step change) and its runtime wants to own
  and insert its own subtree, which is awkward to adopt piecemeal into an
  existing imperatively-built DOM. Fails the incremental constraint.
- **Hand-rolled signals/vdom - rejected.** Zero new dependency, but re-creates
  the diffing and escaping machinery we are trying to delete, at real risk, to
  save a few KB. False economy against the initiative's own goal.

## 3. Component model

Four kinds of unit, in decreasing order of how much they change:

1. **Presentational templates** (`data -> TemplateResult`). The direct successors
   to the `uiTemplates.ts` / `statsHtml.ts` / `editorHtml.ts` functions. Pure, no
   side effects, no app state, no DOM access. Example:
   `confirmTemplate(title, body, yesLabel)` returns an ``html`...` `` result.
   These are unit-testable by rendering into a detached container and asserting
   structure (section 10).
   - **String-composition rule (the not-mechanical cases).** Several builders do
     not interpolate values, they interpolate pre-built MARKUP:
     `statsModalHtml(html)` injects a whole `buildStatsHtml` blob; `savesHtml` and
     the import/export report builders build their `<li>` rows with
     `lines.map(s => ...).join("")`; `stopsHtml`, `towerStatsHtml`, and
     `buildToolInfoHtml` build inner rows by string concat. Under lit, an
     interpolated HTML string is auto-escaped to VISIBLE TEXT, not parsed. Rule:
     recompose these as nested `TemplateResult`s (the row builder returns
     ``html`...` `` and the parent interpolates the array of results). Reaching
     for `unsafeHTML` to paste the old string back in is a reviewable red flag,
     never the shortcut. Migrating one of these dialogs usually pulls its
     sub-builders (for example Statistics pulls `buildStatsHtml`) into the same
     story.
2. **Dialog controllers** (thin). Successors to the `uiDialogs.ts` functions.
   Each renders its presentational template into the shared modal via the
   `openModalTemplate` helper (section 4), with event handlers already inline in
   the template (dispatching to `ui.cb.*` or dialog-local callbacks). The
   `wireActions` / per-button `addEventListener` passes disappear. A11y and
   resolve-once lifecycle that is not markup (the title-bar close button, the
   explicit primary `.focus()`, the property-assigned `onclick`/`oncancel`
   resolve-exactly-once logic for the emergency and update modals, `#a11y-live`
   announcements) stays in the controller (invariant 5).
3. **Live views** (throttled ~6 Hz, render-on-change from a snapshot). The
   tower-stats grid, the tool-info panel, and optionally the palette lock state.
   Each is a presentational template rendered from a per-frame **view snapshot**
   (section 5), called from the throttled `ui.update(sim)`, and re-rendered ONLY
   when its slice of the snapshot changed. Per surface (this is the corrected
   framing, not a uniform diffing win):
   - **Tower-stats grid: migrate (genuine win).** Today `ui.el.towerStats.innerHTML
     = towerStatsHtml(sim.stats())` reparses the whole grid every pump; lit diffs
     the handful of changed values instead.
   - **Status bar: keep imperative or render-on-change.** The five stat writes
     (`money`/`pop`/`star`/`time`/`date`) are already zero-allocation
     `textContent` writes; lit does not beat that. Either keep them imperative or
     gate a `render()` on snapshot-inequality. Whichever, target the individual
     leaf spans, never a wrapper (section 5, the `#traffic` hazard).
   - **Palette lock/afford scan: keep imperative unless it measures clean.** It is
     a `classList.toggle` pass; a free win to bank is to dirty-gate it (rescan
     only when a star threshold or an affordability boundary is crossed), which is
     valuable whether or not it moves to a `classMap` binding.
   - **Tool-info panel: event-driven, not a hot path.** It re-renders on tool
     select, not on the pump, so it is free to migrate.
4. **Retained imperative surfaces** (deliberate, do not migrate). The
   bulletin-log append+prune (`uiStatus.renderLog`, `LOG_DOM_CAP`, column-reverse)
   and the toast rail (`uiStatus.toast`) are performance structures, not markup.
   They stay imperative (invariant 3). The editor/inspector volatile-patch
   protocol migrates last, with care (section 6).

No component owns app state. State lives in the `Simulation` (read on the pump)
and in dialog-local closures (as today). Components are functions of their inputs.

## 4. The imperative-to-declarative bridge for GameApp, and the modal-mount decision

Today `GameApp` builds `new UI({ ...~30 callbacks })` and drives it imperatively:
`ui.update(sim)` on the throttle, plus `ui.showHelp()`, `ui.showSaves(...)`,
`ui.toast(...)`, `ui.showStats(...)`, etc. The bridge keeps that outer shape and
changes only what happens inside `UI`.

- **Commands stay imperative and unchanged.** `GameApp` continues to call
  `ui.showHelp()`, `ui.confirmModal(...)`, `ui.showBatchPricingDialog(...)` and so
  on. Internally each now renders a lit template instead of assigning an HTML
  string. `GameApp` does not learn about lit-html; the `UI` facade absorbs it.
- **`UICallbacks` is the command bus.** Components raise user intent by calling
  `ui.cb.onX(...)` inline in their event bindings, exactly the calls the current
  `addEventListener` handlers make. The interface is unchanged (invariant 2).
- **State flows one way, on the pump.** `GameApp` -> `ui.update(sim)` -> the `UI`
  facade builds a view snapshot from `sim` -> render-on-change of the live-view
  templates from it. No two-way binding, no component-held mutable state; the sim
  is the single source of truth for live data.

**Modal-mount decision (dev and design converged, now the arch decision).** Keep
the tested `openModal` shell imperative, and add a sibling `openModalTemplate`.

- The current `openModal(htmlString)` is pinned by the integration spec's
  "window grammar" block: it creates `.modal-box.win`, skins the top-level `h2` as
  `.win-title`, appends the title-bar x via `titleBarClose` (as the LAST child,
  after `showModal()`, so focus lands on the primary action not the x), wires
  backdrop `onclick` and `oncancel` to close, and calls `showModal()` once. Keep
  it exactly as it is for the unconverted string dialogs.
- Add `openModalTemplate(result: TemplateResult)` that builds the SAME shell and
  `render(result, freshBox)` into a fresh-per-open box discarded on close. It
  reuses the identical title-bar / focus / backdrop / `oncancel` code path, so the
  window grammar the test pins is preserved, and because the box is fresh per open
  and discarded on close, the lit part-cache never collides with the string path's
  `innerHTML = ""` (invariant 4, the container-ownership hazard).
- Fire-once modals (emergency, update prompt) keep their resolve-exactly-once
  logic in the controller, and set `dialog.onclick` / `dialog.oncancel` by
  PROPERTY ASSIGNMENT, never `addEventListener` (Risks R1). Property assignment is
  load-bearing: a second listener could double-resolve or, worse, a dropped
  resolve deadlocks the frozen sim. All four dismissal paths (button, Esc,
  backdrop, x) must resolve, and a test exercises each.
- Initial focus is driven by an explicit `.focus()` on the primary action, NOT by
  relying on the `autofocus` attribute surviving lit's diffing.

Net: the bridge is the `UI` facade itself. It already delegates to friend modules
(`uiDialogs`, `uiPanels`, `uiStatus`, `uiPalette`); those modules change their
implementation from "build string + wire" to "render template," and nothing above
the facade moves. The two mount helpers coexist during the migration and collapse
into one once the last string dialog is converted.

## 5. Throttled sim state without re-rendering the world

DOM refresh is a throttled guest on the ~6 Hz pump (`main.ts` gates on
`now - lastUiUpdate > 160`), NOT a per-frame render. Two properties must hold: no
full-subtree rebuild, and no contention with the 60fps render loop.

- **Keep the existing throttle.** `main.ts` already gates DOM refresh; that stays.
  lit-html does not change the cadence.
- **Render-on-change from a cheap snapshot, not from live objects.**
  `ui.update(sim)` computes the small set of primitives the live views need (money
  string and sign, population, star string, clock/date strings, the `sim.stats()`
  object, and the palette lock/afford booleans), shallow-compares against the last
  snapshot, and re-renders only the views whose slice changed. When nothing
  changed, it renders nothing. These are the same reads the current
  `uiStatus.update` makes.
- **Binding-level diffing is the mechanism for the grid.** Calling
  `render(towerStatsTemplate(vm), container)` does not rebuild the DOM: lit-html
  compares the new interpolated values against the last render and writes only the
  changed text nodes and attributes. This replaces today's
  `towerStats.innerHTML = towerStatsHtml(...)` full reparse.
- **Render-target granularity: the `#traffic` hazard.** The status bar must render
  the individual leaf stat spans (`money`/`pop`/`star`/`time`/`date`), NOT a
  wrapper that also owns `#traffic`. `#traffic` and its `traffic-glyph` /
  `traffic-label` / `traffic-floor` children are updated imperatively by `main.ts`
  `updateTraffic()` (with boundary hysteresis and an aria-label), called right
  after `ui.update(sim)`. If a lit template owned a wrapper that spanned
  `#traffic`, lit and `main.ts` would clobber each other on every pump. Pin the
  render target to the leaf spans (E5-S1).
- **Do not over-migrate the hot loop.** The palette lock scan and the bulletin log
  are already tuned imperative code. Dirty-gate the palette scan (rescan only when
  star or affordability crosses a boundary); the log stays imperative
  (invariant 3). No new full-collection scan (`find`/`filter`/`some`) enters the
  pump path (the standing perf gate).
- **Ordering: write before layout read.** A live-view write must happen before any
  `positionPanels`-style layout read, so a write never forces a synchronous reflow
  that a later `offsetWidth` read pays for (E5-S0 measurement C).
- **Reactivity primitive: start snapshot-only.** No signals dependency initially.
  The per-frame snapshot + render-on-change is sufficient and matches the current
  model. Add `@lit-labs/signals` only if a specific view later needs fine-grained
  reactivity; that is a separate, gated decision, not part of this plan.

## 6. The editor/inspector volatile-patch protocol

Today `renderEditor(key, build, volatile)` does a full rebuild only when the
selection's shape (`key`) changes, and otherwise patches only the `data-field`
cells via `patchVolatile`, so a periodic refresh never clobbers a button
mid-click (the "+ rent sometimes does nothing" bug the `editorBusy` suppression
also guards). lit-html subsumes this, with a test carve-out:

- Rendering the editor template each refresh with lit-html keeps node identity for
  unchanged bindings, so buttons and inputs are not recreated and an in-flight
  click is not swallowed. The `key`/`patchVolatile` split becomes unnecessary in
  principle: the diff does the same job automatically.
- **Test carve-out (this is not a mechanical, test-unchanged phase).** The
  `renderEditor` describe block in `uiDialogs.integration.test.ts` and
  `editorPatch.test.ts` encode the exact `key`/`patchVolatile` mechanism lit's
  diff replaces, so they cannot pass unchanged. Those tests are REWRITTEN in this
  story, and a new test pins the SURVIVING invariant directly: a refresh landing
  between `pointerdown` and `pointerup` must not recreate the pressed button (the
  "+ rent" bug). Keep the `editorBusy` pointer suppression as belt-and-suspenders
  through E6.
- This is the highest-touch surface (anchoring math, the cached `editorSize`
  measure, the `data-edit`/`data-field` action dispatch, mobile folding of the
  inspector into the editor). It migrates LAST. The migration preserves the
  mid-click safety, the cached `editorSize`, and the `data-edit`/`data-field`
  attributes that `main.ts` and tests read.
- The `patchVolatile`/`anchorBeside` exports re-exported from `ui/UI` for tests
  (`anchor.test.ts`, `editorPatch.test.ts`) stay exported until those tests are
  updated in the same story; do not break the import identity mid-migration.

## 7. Bundle, interop, and snapshot impact

- **Bundle.** +~3.7 KB min+gzip for lit-html, tree-shaken to `html`/`render`
  (plus any directives used, each small). The built chunk must contain NO
  `LitElement`/custom-element code, and must be the PRODUCTION lit build (no dev
  banner in `dist`). It joins the game precache under the existing 6 MB per-file
  ceiling with vast headroom. It is too small to warrant a dedicated
  `manualChunks` split (unlike the ~550 KB Excalibur split it sits beside); leave
  it in the main app chunk.
- **Interop with Excalibur.** None. lit-html renders into DOM containers outside
  the canvas; it never touches WebGL, the game loop, or `TowerEngine`. The
  context-loss recovery path (which rebuilds the canvas) is unaffected because it
  does not touch `#modal`/`#editor`/status DOM.
- **`window.game` runtime surface.** Unchanged. `e2e/helpers.ts`,
  `visual.spec.ts`, and the screenshot script reach `sim`, `engine`, `speed`,
  `grid` and the any-cast `selectPicked`/`selected`/`refreshEditor`. None are
  rendering internals; the migration does not rename them.
- **Snapshots and e2e selectors.** The e2e specs select `#modal`, `.modal-box`,
  `[data-act="later"]`, `.pal-item[data-kind]`, `#editor`, `#inspector`,
  `.whatsnew li`, `.build-id`, `#splash`, `#crash-screen`. All are authored
  literally in the migrated templates and must remain. Each phase asserts **zero**
  `visual.spec.ts-snapshots/**` and `docs/screenshots/**` diff; a diff is
  investigated as a defect before any baseline regenerates, and regeneration is
  only ever via the pinned Playwright image. Note the snapshot gate's blind spots
  (a dropped `data-*`/`aria-*`, a reordered attribute, a property-vs-attribute
  swap do not move pixels, and most dialogs are in no baseline): the transitional
  DOM-equivalence test (section 10) covers what the snapshot cannot.

## 8. How this resolves the held `main.ts` split

The `main.ts` file-size split is on hold because its `UICallbacks` construction
(the ~30-callback object literal passed to `new UI({...})`) is the seam a
declarative migration might reshape. This decision settles that seam:

- **The `UICallbacks` boundary does not move** (invariant 2). lit-html components
  dispatch through the exact same `cb.onX(...)` actions. The framework choice
  imposes no new shape on the callback object.
- Because the boundary is stable, the split is unblocked and sequenced first:
  extract the `UICallbacks` construction out of the `GameApp` constructor into a
  dedicated factory (for example `src/game/uiCallbacks.ts` exporting
  `createUICallbacks(app: GameAppPorts): UICallbacks`, taking a narrow deps slice
  of the app spine, mirroring the existing `BuildActions`/`EditorActions`/
  `SaveLoad` pattern).
- **Hardened ACs for the factory (dev finding).** The factory captures the LIVE
  instance through getters/thunks (mirroring the existing `getSim: () => this.sim`
  pattern), NEVER destructured values, so an `adoptSim` swap that replaces the sim
  is still seen by the callbacks. Callbacks that mutate private `GameApp` state
  (for example `onSelectTool` writing `this.tool` / `paintAnchor` /
  `transportStart` / `engine.preview...`) DELEGATE to `GameApp` methods or ports,
  they do not reach into privates from the factory. And the construction order is
  preserved: the controllers are built BEFORE `new UI(...)`, because the `UI`
  constructor's initial `selectTool` fires `onSelectTool` synchronously and that
  handler needs `this.keyboard` to already exist.
- This does two things at once: it lands the file-size reduction that was on hold,
  and it produces a clean, framework-agnostic action surface the subsequent
  lit-html migrations dispatch into. The split stops being "blocked pending a
  UI-architecture decision" and becomes story E1 of this initiative.

## 9. Incremental migration phase order

Each phase is one or more PRs, each behavior-preserving, each running the four
quality gates and `/bmad-code-review` in-session, each carrying the five-part test
package (section 10) and asserting zero snapshot churn. Detailed stories and ACs
are in `30-epics-and-stories.md`. In brief:

- **E0 - Foundation.** Add `lit-html`. Build the `openModalTemplate` mount beside
  the kept imperative `openModal`. Deliver the shift-left test harness
  (`renderToFragment`, `assertDomEquivalent`, the event-dispatch helper). Convert
  `confirmModal` as the proof (chosen because it also proves inline callback
  dispatch and the `{ close: false }` no-close-button case).
- **E1 - The held `main.ts` split (no lit-html).** Extract
  `createUICallbacks(...)` with the hardened ACs (section 8).
- **E2 - Simple dialogs.** `confirmModal`/`showEventChoice`, `showUpdatePrompt`
  + chip, `showSettings` (stateful, its own checklist), `showHelp`.
- **E3 - Data-driven and blob dialogs.** `showSaves`, `showStopsDialog`,
  `newTowerModal` (calendar renders always), the import/export reports + export
  choice, and the Statistics dialog (the worst string-composition case).
- **E4 - The interactive stateful dialog.** `showBatchPricingDialog`.
- **E5 - Live views.** E5-S0 perf gate first (blocking), then the tower-stats grid
  and tool-info panel, then the optional palette lock/afford binding move.
- **E6 - Editor and inspector.** Highest coupling, last, with the test-rewrite
  carve-out (section 6).
- **E7 - Decide the retained imperative surfaces.** Default: leave the bulletin
  log and toast rail imperative and record the decision.

Ordering rationale: leaves first (least wiring, easiest to prove fidelity), the
`main.ts` split early (unblocks other work and produces the clean action surface),
the perf-gated live views only after their baseline harness lands, and the editor
last (highest coupling). Every phase is independently shippable and independently
revertible.

## 10. Testing and regression strategy

The full contract is in `50-testing-strategy.md`; the load-bearing points, inline:

- **Shift-left harness (E0).** Three unit-tier helpers, happy-dom, run pre-push
  before the e2e tier: `renderToFragment(TemplateResult)`;
  `assertDomEquivalent(legacyString, litTemplate)` (normalized equality of tag
  tree, `class`/`id`/`data-*`/`aria-*`/`role`/`name`/`type`/boolean attributes,
  insignificant whitespace ignored, significant inline whitespace preserved); and
  a small event-dispatch harness. Comparison is NORMALIZED DOM, never raw
  `outerHTML` equality.
- **Five-part package per touched aspect (merge-blocking).** (1) a colocated
  shift-left unit test asserting SEMANTIC structure, event dispatch to the correct
  callback/args, hostile input auto-escaping to text, and the checklist a11y
  specifics, never `outerHTML` equality; (2) a transitional old-vs-new
  DOM-equivalence regression test, DELETED in the same PR that retires the string
  builder so it cannot rot; (3) the integration spec stays green (with the E6
  rewrite carve-out); (4) for live views, the E5 perf baselines; (5) zero
  visual/snapshot churn via `git diff --stat`.
- **The integration spec is the primary behavioral gate (E2-E5).** The 1544-line
  `uiDialogs.integration.test.ts` pins `data-act` routing, single-resolve, x/focus
  ordering, hostile-name escaping (which independently validates lit auto-escape),
  the toast cap, the log-freeze regression, and palette lock/afford. "This spec
  passes unchanged" is the primary gate; per-template unit tests supplement it.
- **Coverage rule.** Migrated lit modules get real unit coverage, a coverage GAIN
  versus the string builders, with NO new coverage exemption. The global ratchet
  (statements 91, lines 92, functions 90, branches 85) and the per-file floors do
  not fall.
- **Deferred a11y WINS (do not slip into a behavior-preserving phase).** Add
  `aria-labelledby` tying `#modal` to its `.win-title` h2; announce the batch
  two-click reset arming. Log both to
  `_bmad-output/implementation-artifacts/backlog.md`.
- **Deep review.** `/bmad-code-review` in-session on every story (tooling/UI
  plumbing + architecture). Fix `patch`, log `defer` to the backlog.
- **Version bump.** None for a genuinely behavior-preserving, pixel-identical
  phase (internal-only work needs none). A discovered pixel or behavior change is
  a defect to fix, not a bump to make.

## 11. Risks

- **Perf catch-up spiral (medium, structural).** A heavier pump inflates the
  measured `dtMs`, which feeds the catch-up accumulator (`accMinutes`), which is
  the spiral the code blames for the Pixel-8a WebGL context loss.
  `MAX_CATCHUP_MINUTES` clamps the debt, but the clamp converts the extra cost
  into the game visibly running SLOWER than the speed button promises rather than
  crashing. Mitigation now: the E5-S0 perf gate (at or below baseline `ui.update`
  cost, and profile B measuring sim-minutes per real second at speed 120 under a
  4-6x CPU throttle). Structural mitigation, RECORDED, not done now, applied only
  if profile B regresses: decouple `ui.update` from `engine.onUpdate`'s dt
  accounting (give the UI its own rAF/timer) so UI cost cannot feed the sim
  catch-up.
- **Sim deadlock on a dropped resolve (R1, high, contained to fire-once modals).**
  The emergency and update modals must resolve exactly once across button/Esc/
  backdrop/x; a dropped resolve deadlocks the sim (frozen while the modal is
  open). Mitigation: the shared modal helper sets `onclick`/`oncancel` by PROPERTY
  ASSIGNMENT, never `addEventListener`, and all four dismissal paths are tested per
  fire-once modal.
- **Container part-cache collision (medium, mixed-migration only).** lit stores
  render state as a property on its container; the string path's `closeModal` does
  `innerHTML = ""`, which does not clear it. Mitigation: one container, one
  renderer (invariant 4); the lit path uses a fresh-per-open box discarded on
  close, so it never shares a container with the string path.
- **E1 factory laziness (medium, contained to E1).** A factory that captures
  destructured values instead of live getters breaks on an `adoptSim` swap.
  Mitigation: capture the live instance through getters/thunks; delegate private
  mutations to `GameApp`; preserve controllers-before-`new UI(...)` order
  (section 8).
- **E6 test rewrite (medium, contained to E6).** The `renderEditor` integration
  block and `editorPatch.test.ts` encode the mechanism E6 removes, so they cannot
  pass unchanged. Mitigation: rewrite them in the E6 story, add a new test pinning
  the surviving mid-click invariant, keep `editorBusy` as belt-and-suspenders
  (section 6).
- **A11y drop on a mechanical port (medium).** Most a11y is controller side
  effects, not markup (invariant 5). Mitigation: per-story a11y checklist as
  acceptance criteria, tested directly, not left to the pixel snapshot.
- **Snapshot / selector churn (medium).** A migrated template drifts from the
  literal markup. Mitigation: author verbatim; the transitional DOM-equivalence
  test catches the drift the pixel snapshot cannot; e2e selectors are a hard gate.
- **Scope creep into a redesign (low, high-cost if it happens).** Mitigation: the
  non-goals in the brief; behavior-preserving is a gate; a tempting cleanup spotted
  mid-migration is a `defer`, not an in-flight change.
- **Dependency surface (low).** Importing `lit` broadly could pull `LitElement`.
  Mitigation: import from `lit-html` directly; verify the built chunk includes no
  web-component code and is the production build.
