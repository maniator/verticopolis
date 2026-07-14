# Product Brief - Declarative UI Rendering Layer

**Author:** John (PM), with Winston (Architect) and Amelia (Dev)
**Produced with:** `bmad-product-brief`
**Companion to:** `20-architecture-decision.md`, `30-epics-and-stories.md`,
`40-spec-first-story.md`, and the party findings `00-party-notes.md`.
**Intended target location:**
`_bmad-output/planning-artifacts/design/brief-ui-render-layer-2026-07-14.md`
(a design-brief sibling to the `arch-*`/`gdd-*` pairs).

This brief frames WHY the DOM UI moves from hand-built HTML strings to a
declarative rendering layer, what success looks like, and the boundaries the
work must respect. It does not choose the framework (see the architecture doc)
or sequence the stories (see the epics doc).

---

## Problem

The DOM UI outside the Excalibur canvas (dialogs, panels, status bar, palette,
editor, inspector, toasts, bulletin log) is rendered by hand-built HTML strings
plus imperative wiring. The Wave C-2 split (2026-07-14) cleanly isolated the
view as pure `data -> HTML string` builders in `src/ui/uiTemplates.ts` (and
`statsHtml.ts`, `editorHtml.ts`), with controllers in `src/ui/uiDialogs.ts` that
open a modal from a template string and then bind every interactive element by
hand. That split was deliberately behavior-preserving and left the framework
question to its own initiative (recorded in
`_bmad-output/implementation-artifacts/backlog.md`). This is that initiative.

The string-concatenation approach carries recurring costs:

- **Hand-wiring every control.** Each dialog re-queries its buttons by
  `[data-act]`/`id` and attaches handlers imperatively (`wireActions`, per-input
  `addEventListener` loops). The template and its wiring live apart, so a
  renamed action or a template typo fails at runtime, not compile time.
- **Manual HTML escaping.** `escapeHtml` must be threaded through every
  interpolation of engine or user text (tower names, log lines, import report
  strings). A single missed call is an injection defect. This is a standing
  correctness tax with no structural guardrail.
- **Re-implemented diffing.** The batch-pricing dialog hand-writes a `refresh()`
  that recomputes preview text and button state on every input. The editor panel
  maintains a bespoke `renderEditor(key, build, volatile)` + `patchVolatile`
  protocol whose entire purpose is to avoid clobbering a button mid-click during
  a periodic rebuild. Both are manual re-creations of what a diffing renderer
  does automatically.
- **No structural ceiling.** Nothing prevents the next god-template, a forgotten
  prune, or a new un-escaped interpolation. Review is the only guard.

The pain is maintainability and correctness-surface, not a player-visible defect.
The UI works today. The goal is to make it cheaper and safer to keep working.

## Why now

- The `uiTemplates` seam already exists and is clean, so the migration has a
  natural, pre-built starting line. Waiting lets the seam rot as new dialogs are
  added in the old style.
- The `main.ts` file-size split is **on hold** specifically because its
  `UICallbacks` construction is the boundary a declarative migration might
  reshape. Resolving the rendering-layer direction unblocks that split (see the
  architecture doc for how).
- Doing it incrementally is only possible while the surface is this well
  factored. Every new imperative dialog raises the eventual cost.

## Goals

1. Replace hand-built HTML strings + imperative wiring with a **declarative
   rendering layer** across the DOM UI, dialog-by-dialog, with no stop-the-world
   rewrite.
2. **Delete the wiring boilerplate**: event handlers are declared with the markup,
   not re-attached in a separate pass.
3. **Delete the manual-escaping obligation**: interpolations are auto-escaped by
   the renderer; raw-HTML injection is opt-in and rare, and reviewable.
4. **Replace the hand-rolled diffing** (batch-pricing `refresh`, editor
   `patchVolatile`) with the renderer's own binding diff, preserving the
   mid-click-safety and per-frame-surgical behaviors they exist to provide.
5. **Unblock and land the held `main.ts` / `UICallbacks` split** as part of the
   sequencing.
6. Keep the new dependency **small enough to be invisible** in the PWA precache.

## Non-goals

- **No player-visible change.** Not a redesign, not a copy change, not a new
  screen. Pixels and behavior stay identical. (No `package.json` version bump for
  a genuinely behavior-preserving phase; internal-only work needs none.)
- **No change to the game engine, simulation, save format, or TDT round-trip.**
  This is strictly the DOM layer outside the canvas.
- **No web components / Shadow DOM.** The global `src/styles.css` and the design
  system must stay intact.
- **No reshaping of the `UICallbacks` command boundary.** Components dispatch
  through the same actions the imperative code uses today.
- **No forced migration of the deliberate imperative structures** (bulletin-log
  append/prune, toast rail) if migrating them regresses their performance
  intent; leaving them is an allowed, documented outcome.
- **No re-minting of visual baselines or doc screenshots as a routine step.**
  Baselines change only if a real pixel diff appears, and only via the pinned
  container.

## Success criteria

- Every migrated dialog and panel renders through the declarative layer; the
  imperative `addEventListener` wiring for those surfaces is gone.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` are green at
  every phase boundary.
- `e2e/*.spec.ts` behavioral tests pass **unchanged** (same selectors: `#modal`,
  `.modal-box`, `[data-act]`, `.pal-item[data-kind]`, `#editor`, `#inspector`,
  `.whatsnew li`, `.build-id`, and the `window.game` runtime surface).
- `e2e/visual.spec.ts-snapshots/**` and `docs/screenshots/**` are **untouched**
  in the diff for each behavior-preserving phase; any change is investigated as a
  bug before a baseline is regenerated via the pinned image.
- No `escapeHtml` call remains in a migrated template (escaping is the renderer's
  job); any surviving raw-HTML insertion is explicit and reviewed.
- The throttled `ui.update(sim)` path stays surgical: no full-subtree
  `innerHTML` rebuild per pump, no regression against the 60fps loop.
- The `main.ts` `UICallbacks` split is landed.
- Bundle: the new runtime dependency adds no more than a few KB gzipped to the
  game precache (target: under ~6 KB; lit-html is ~3.7 KB).
- Each PR ran `/bmad-code-review` in-session; `patch` findings fixed, `defer`
  findings logged to the backlog.

## Constraints

- **PWA + bundle budget.** Installable PWA; the Workbox precache ceiling is 6 MB
  per file and every KB counts. Prefer a no-JSX-build option if the cost is
  acceptable.
- **Coexistence with the Excalibur WebGL loop.** The DOM UI is separate from the
  canvas and reads sim state each frame via a throttled `ui.update(sim)`. The
  chosen layer must not re-render the whole tree per frame or otherwise contend
  with `TowerEngine`'s 60fps loop.
- **Incremental only.** A defined imperative-to-declarative bridge for
  `GameApp`/`main.ts` and a dialog-by-dialog order starting at the `uiTemplates`
  seam. No big-bang.
- **Test and snapshot stability.** Keep `e2e/*.spec.ts` green and avoid churning
  `e2e/visual.spec.ts-snapshots` or the CSS-depended-upon DOM structure and class
  names (`docs/design-system.md` is the contract).
- **Engine purity.** `src/engine/` stays free of DOM and rendering; this work
  never reaches into it.
- **American English; no em-dashes in new prose.** Use commas, colons,
  parentheses, or separate sentences.
- **Mandatory deep review.** `/bmad-code-review` in the same session as each
  change (tooling/UI-plumbing + architecture).

## Stakeholders and impact

- **Players:** no visible change; the win is indirect (fewer UI regressions,
  faster future UI work).
- **Contributors:** simpler dialog authoring, no wiring boilerplate, no escaping
  footgun, compile-time safety on bindings.
- **The `main.ts` split:** unblocked.
- **Risk owners:** the visual-snapshot and e2e selector contracts (Sally / QA),
  guarded per-phase.

## Risks (summary; detail in the architecture doc)

- Snapshot or selector churn if a migrated template drifts from the literal
  markup. Mitigation: author markup verbatim; assert zero snapshot diff per phase.
- Per-frame regression if a live view re-renders too eagerly. Mitigation: keep
  the existing throttle; rely on binding-level diffing; measure on a phone tier.
- The editor volatile-patch protocol interacting badly with the renderer's
  diffing. Mitigation: migrate the editor/inspector last, with a dedicated story.
- Scope creep into a redesign. Mitigation: non-goals above; behavior-preserving
  is a hard gate.
