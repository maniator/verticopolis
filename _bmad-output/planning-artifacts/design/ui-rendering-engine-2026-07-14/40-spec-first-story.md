---
id: SPEC-ui-render-foundation
title: "E0 - lit-html foundation: dependency, modal-template mount, test harness, and confirmModal proof"
companions:
  - ../20-architecture-decision.md
  - ../30-epics-and-stories.md
  - ../50-testing-strategy.md
  - ../15-party-review-synthesis.md
sources:
  - _bmad-output/implementation-artifacts/backlog.md (Preact follow-up, 2026-07-14)
intended_target_location: _bmad-output/specs/spec-ui-render-foundation/SPEC.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the
> complete, preservation-validated contract for what to build, test, and
> validate. Source documents in frontmatter are for traceability only.

# lit-html foundation: dependency, modal-template mount, test harness, and confirmModal proof

## Why

The DOM UI is hand-built HTML strings + imperative wiring. The plan of record
(`20-architecture-decision.md`) adopts `lit-html` and migrates dialog-by-dialog
from the `uiTemplates.ts` seam. This first story lays the foundation and proves
the whole approach on the smallest meaningful surface before any breadth is
attempted: add the pinned dependency, build the sibling `openModalTemplate` mount
beside the kept imperative `openModal`, deliver the shift-left test harness every
later story depends on, and convert exactly one dialog end to end. The proof
dialog is `confirmModal`, chosen over the simpler `congratsTower` because it also
proves inline callback dispatch (the `onYes` path) and the `{ close: false }`
no-close-button case, which is the mechanism every later dialog reuses. If the
integration spec and the visual snapshots are untouched by that conversion, the
mechanism is validated and E2 onward can proceed with confidence.

## Capabilities

- **CAP-1**: `lit-html` is a pinned production dependency, imported minimally, and
  the built bundle is the production lit build with no web-component code.
  - **intent:** A developer can author a `TemplateResult` and render it, using
    `html`/`render` from `lit-html` directly, without pulling `LitElement`.
  - **success:** `package.json` lists `lit-html` at a pinned version alongside
    `excalibur`/`tone`/`fflate`; imports are from `lit-html` (and
    `lit-html/directives/*` if needed), never the `lit` barrel; `npm run build`
    succeeds; the built chunk contains NO `LitElement`/custom-element code and is
    the PRODUCTION lit build (no lit dev banner in `dist`); any directive import
    resolves from `lit-html/directives/*` and tree-shakes; the gzipped bundle
    delta is under ~6 KB; lit-html stays in the main app chunk (no `manualChunks`
    split).

- **CAP-2**: A sibling `openModalTemplate(result)` renders a template into the
  shared modal with the exact lifecycle the tested `openModal` produces, into a
  fresh-per-open box.
  - **intent:** A dialog controller can hand a `TemplateResult` to the facade and
    get the identical modal shell, title-bar treatment, backdrop-close, and
    `Esc`/cancel behavior `openModal(htmlString)` produces today, WITHOUT the lit
    part-cache ever sharing a container with the string path.
  - **success:** `openModalTemplate` builds the SAME `.modal-box.win` shell, skins
    the top-level `h2` as `.win-title`, appends the title-bar x via `titleBarClose`
    as the LAST child AFTER `showModal()` (so focus lands on the primary action,
    not the x), wires backdrop `onclick` and `oncancel` to close by PROPERTY
    ASSIGNMENT, and `render`s into a box that is fresh per open and discarded on
    close. The kept imperative `openModal` is unchanged and still serves the
    unconverted string dialogs. `closeModal()` clears the container. One container,
    one renderer: the two mount paths never share a box.

- **CAP-3**: The shift-left test harness exists and is used.
  - **intent:** Every later story can render a lit template and assert its
    structure, its old-vs-new equivalence, and its event dispatch, at the unit
    tier in happy-dom, before the e2e tier runs.
  - **success:** three helpers ship with their own unit tests:
    `renderToFragment(TemplateResult)`; `assertDomEquivalent(legacyString,
    litTemplate)` (normalized tag/class/id/`data-*`/`aria-*`/`role`/`name`/`type`/
    boolean-attr equality, insignificant whitespace ignored, significant inline
    whitespace preserved, NEVER raw `outerHTML` equality); and an event-dispatch
    harness (fire @click/@change, assert callback + args).

- **CAP-4**: `confirmModal` is migrated to lit-html end to end.
  - **intent:** A reviewer sees a complete real conversion (template + controller +
    inline event binding) of a dialog with a callback action, with its actions
    dispatched inline rather than by a separate `addEventListener` pass.
  - **success:** `confirmHtml` becomes a lit template; `confirmModal` renders it via
    `openModalTemplate` with the `onYes` and Cancel actions as inline `@click`
    bindings; the `wireActions`/`addEventListener` pass for this dialog is gone; the
    `{ close: false }` no-close-button case holds (the title-bar x still closes via
    the cancel path); the dialog opens, confirms, cancels, and closes identically.

- **CAP-5**: The migration is invisible to tests, selectors, and pixels, and
  carries the full five-part test package.
  - **intent:** The conversion changes no behavior a test or a player can observe,
    and proves it with the same package every later story uses.
  - **success:** the emitted DOM for `confirmModal` is identical (tags, `id`s,
    class names, `data-*`, `aria-*`, text); the integration spec's confirm and
    "window grammar" blocks pass unchanged; the five-part package ships (colocated
    semantic unit test with event dispatch and hostile-input-as-text; a
    transitional `assertDomEquivalent(confirmHtml(...), confirmTemplate(...))` test;
    the integration spec green; zero visual/snapshot churn via `git diff --stat`);
    `package.json` has no version bump.

## Constraints

- **No `package.json` version bump.** Behavior-preserving, pixel-identical,
  internal-only. A missing bump is correct here; a bump would misreport the build.
- **No Shadow DOM / no `LitElement`.** Import `html`/`render` from `lit-html`
  directly so the global `src/styles.css` reaches every node.
- **The `UICallbacks` command boundary is unchanged.** `confirmModal`'s actions
  dispatch through the same `onYes` callback and close it makes today, inline in
  the template.
- **One container, one renderer.** `openModalTemplate` uses a fresh-per-open box;
  never call `render()` and set `.innerHTML` on the same element (the lit
  part-cache would collide with the string path's `innerHTML = ""`).
- **A11y is a controller side effect, preserved explicitly.** Drive initial focus
  with an explicit `.focus()` on the primary action, NOT the `autofocus` attribute
  surviving lit's diffing. Append the x AFTER `showModal()` and focus. Set
  `onclick`/`oncancel` by PROPERTY ASSIGNMENT, never `addEventListener`.
- **The emitted DOM is byte-stable.** `confirmTemplate` is authored as the literal
  markup `confirmHtml` produces: no restructuring, no class renames, no attribute
  reordering, and no reflowed whitespace between inline elements.
- **No `escapeHtml`; nested templates, not string interpolation.** lit-html
  auto-escapes interpolations. `confirm`'s `title`/`body`/`yesLabel` are trusted
  today and stay so, now auto-escaped. `unsafeHTML` is not used.
- **Test comparisons are semantic.** Unit assertions use `querySelector` +
  attribute reads; `assertDomEquivalent` compares normalized DOM. Never
  `outerHTML` equality.
- **Engine purity.** No change under `src/engine/`; no engine file imports
  `lit-html`.
- **American English; no em-dashes in new prose** (comments, commit, PR text).
- **Deep review runs in this session:** `/bmad-code-review` (tooling/UI-plumbing +
  architecture). Fix every `patch` finding and re-verify; record every `defer` in
  `_bmad-output/implementation-artifacts/backlog.md`.

## Non-goals

- No migration of any other dialog, panel, the status/stats pump, the palette, the
  editor/inspector, the bulletin log, or the toast rail. Those are later epics.
- No `main.ts` `UICallbacks` split (that is E1, its own story).
- No reactive/signals primitive; this story renders once per open, not on the pump.
- No `manualChunks` split for lit-html (too small to warrant its own vendor chunk).
- No perf gate (that is E5-S0; this story touches no live view).
- No re-minting of visual baselines or doc screenshots; a snapshot diff here is a
  defect to investigate, not a baseline to regenerate.
- No change to the `window.game` runtime surface.
- No deferred a11y WINS (the `#modal` `aria-labelledby` tie is backlog, not here).

## Success signal

A reviewer checks out the branch and runs `npm run typecheck && npm run lint &&
npm test && npm run build`, watching all four pass, including the new harness unit
tests and the `confirmModal` five-part package. They confirm `git diff --stat`
touches no file under `e2e/visual.spec.ts-snapshots/` or `docs/screenshots/`, and
that `package.json` has no version bump. They open a confirm dialog in the running
game: it appears with focus on the primary action (not the x), Confirm fires
`onYes` and closes, Cancel and the title-bar x and Esc all close it, exactly as
before. They read the diff and see `confirmModal` rendered from a lit template with
its actions bound inline, the sibling `openModalTemplate` mount beside the
unchanged `openModal`, the three test helpers, and `lit-html` pinned in
`package.json`, with the built bundle free of web-component code and carrying no
lit dev banner. The approach and its test contract are proven; the rest of the
migration can follow.

## Assumptions

- `confirmModal`/`confirmHtml` is the right first conversion: it is low risk (a
  short static body) yet exercises inline callback dispatch (`onYes`) and the
  `{ close: false }` no-close-button path, so it proves the mechanism later
  dialogs reuse. `congratsTower` remains a fallback if a callback-free proof is
  preferred, but the plan of record selects `confirmModal`.
- The current `openModal`/`closeModal` lifecycle (title-bar x, backdrop close,
  `oncancel`) is the behavior `openModalTemplate` reproduces. The two mount helpers
  coexist during the migration (both render into `#modal`, never the same box) and
  collapse into one once the last string dialog is converted.
- lit-html at its current stable major is compatible with the project's `esnext`
  build target and TypeScript version, and with the happy-dom unit test
  environment; no build-config change is needed beyond the dependency.

## Open Questions

- **Coexistence collapse timing:** keep both `openModal(html)` and
  `openModalTemplate(result)` until the last string dialog is converted (E6/E7),
  then collapse. Confirm this is the intended end state (assumed: yes).
- Confirm the **no-version-bump** policy for this and every behavior-preserving
  phase (assumed: none).
</content>
