---
title: "Party Findings - Declarative UI Rendering Layer"
event: Architecture round-table on replacing string-concatenation UI rendering
date: 2026-07-14
room: Winston (Architect), Amelia (Dev), Sally (UX Designer), John (PM)
relates_to:
  - _bmad-output/implementation-artifacts/backlog.md (Preact follow-up note, 2026-07-14, from Wave C-2)
  - src/ui/uiTemplates.ts (the data->HTML string seam)
  - src/ui/uiDialogs.ts, src/ui/UI.ts, src/ui/uiPanels.ts, src/ui/uiStatus.ts, src/ui/uiPalette.ts
  - src/main.ts (GameApp composition root; UICallbacks construction)
intended_target_location: _bmad-output/party-mode/2026-07-14-ui-render-layer-findings.md
---

# Party Findings - Declarative UI Rendering Layer

A multi-perspective round-table convened to execute the backlog follow-up
"evaluate a Preact (or similar) UI rendering layer" (2026-07-14, deferred from
the Wave C-2 `UI.ts` split). The framework choice was left genuinely open. This
is the durable record: the candidates weighed, the scoring, the recommendation,
and the sequencing constraints the room agreed on. It feeds the architecture
decision (`20-architecture-decision.md`).

## The room

| | Voice | Pushed for |
|---|---|---|
| 🏗️ | **Winston** - Architect | Smallest new surface. A layer that maps 1:1 onto the existing `uiTemplates` seam, does not fork the build, and cannot fight the 60fps Excalibur loop. |
| 💻 | **Amelia** - Dev | A mechanical, low-risk migration. Each dialog convertible in isolation, no stop-the-world, and the `addEventListener` wiring boilerplate in `uiDialogs.ts` gone. |
| 🎨 | **Sally** - UX Designer | Byte-for-byte DOM fidelity. The design system keys on exact class names and structure (`docs/design-system.md`); nothing may reshape the markup or churn a visual snapshot. |
| 📋 | **John** - PM | No player-visible change, no bundle bloat on an installable PWA, and a phased plan that ships value per PR without a risky big-bang. |

## The problem, stated plainly

Today the DOM UI outside the canvas is hand-built HTML strings plus imperative
wiring. The Wave C-2 split already isolated the "view" as pure `data -> HTML
string` builders in `src/ui/uiTemplates.ts` (and siblings `statsHtml.ts`,
`editorHtml.ts`), with controllers in `src/ui/uiDialogs.ts` that call
`ui.openModal(templateString)` then hand-wire every button with
`addEventListener`. The costs the room named:

- **Wiring boilerplate and drift risk.** Every dialog re-queries its own buttons
  by `[data-act]` and binds handlers by hand (`wireActions`, the `forEach`
  loops). A template typo becomes a runtime throw, not a compile error.
- **Manual escaping.** `escapeHtml` is threaded through every interpolation of
  untrusted or engine text. A missed call is an injection. Amelia flagged this as
  the quiet correctness tax.
- **Imperative refresh choreography.** The batch-pricing dialog hand-writes a
  `refresh()` that recomputes and re-sets `textContent`/`disabled` on every
  input event. The editor panel maintains a bespoke `renderEditor(key, build,
  volatile)` + `patchVolatile` protocol just to avoid clobbering a button
  mid-click. These are re-implementations of what a diffing renderer does for
  free.
- **No structural safety.** Nothing stops the next contributor from growing a
  new god-template or forgetting a prune step.

Not a problem: the throttled (~6 Hz) status pump (`uiStatus.update`) is already surgical
(targeted `textContent`/`classList` writes, never an `innerHTML` rebuild). Any
replacement must preserve that property, not regress it.

## Candidate evaluation matrix

Scored 1 (poor) to 5 (excellent) against the hard constraints. Weights reflect
the room's priority order: fidelity and incremental adoption are gates, not
nice-to-haves.

| Constraint (weight) | lit-html | Preact (+htm) | Solid | Hand-rolled signals/vdom |
|---|---|---|---|---|
| Bundle size on a PWA (x2) | 5 (~3.7 KB) | 4 (~4-5 KB core) | 4 (small runtime) | 5 (0 new dep) |
| No new build step / JSX toolchain (x2) | 5 (tagged templates, plain Vite+TS) | 3 (JSX needs a build; htm avoids it but is off-idiom) | 2 (needs the Solid compiler/babel preset) | 5 (none) |
| Coexists with 60fps loop, no full re-render (x2) | 4 (render() diffs bindings) | 4 (vdom reconcile) | 5 (fine-grained signals) | 3 (you build the diffing) |
| Incremental adoption from the `uiTemplates` seam (x3) | 5 (a lit template IS a data->result builder) | 4 (component is a bigger conceptual jump) | 2 (wants to own its subtree; awkward piecemeal) | 3 (you design the seam) |
| DOM / CSS / snapshot fidelity (x3) | 5 (markup authored literally) | 4 (JSX reshapes attribute/class authoring slightly) | 3 (compiler-owned output) | 5 (literal) |
| Removes wiring + auto-escapes (security) (x2) | 5 (inline `@event`, auto-escape, no `unsafeHTML`) | 4 (JSX handlers, auto-escape) | 4 | 2 (you re-build escaping) |
| Ecosystem / familiarity / maintenance (x1) | 4 (Lit project, stable) | 5 (React-shaped, ubiquitous) | 3 | 1 (bespoke, you own the bugs) |
| **Weighted total (of 75)** | **70** | **58** | **46** | **54** |

## The recommendation: lit-html (standalone render library)

**Adopt `lit-html`** - the standalone template/render library from the Lit
project - **not** full Lit/`LitElement`. No web components, no Shadow DOM (Shadow
DOM would sever the global `src/styles.css` the design system depends on).

Why it won the room unanimously:

- **It is the same seam, upgraded.** `uiTemplates.ts` is already a set of pure
  `data -> HTML string` builders. A lit-html template is a pure `data ->
  TemplateResult` builder. The migration of a template is: swap the backtick
  string for an ``html`...` `` tagged literal, keep the `${}` interpolations
  almost verbatim, and move button handlers from a separate `addEventListener`
  pass into inline `@click=${...}` bindings. Winston called it "a find-and-replace
  with benefits."
- **Zero build-step change.** It is plain TypeScript + Vite. No JSX, no new
  compiler, no `.tsx` toolchain to configure. This directly satisfies the
  "prefer no-JSX-build" constraint.
- **Fidelity is structural, not aspirational.** Because you author the markup
  literally inside the template, the emitted DOM (tags, class names, `data-*`
  attributes, order) is identical to today's strings. That is what protects the
  `e2e/*.spec.ts` selectors (`#modal .modal-box`, `[data-act="later"]`,
  `.pal-item[data-kind]`, `.whatsnew li`, `.build-id`) and the
  `visual.spec.ts-snapshots` from churn. Sally's gate is met by construction.
- **It removes the two taxes at once.** Inline `@event` bindings delete the
  `wireActions`/`addEventListener` boilerplate. Auto-escaping of interpolations
  (lit only inserts text/attribute values, never parses interpolated strings as
  markup) deletes the `escapeHtml` obligation and closes the injection class.
- **It cannot fight the loop.** `render(template, container)` diffs only the
  dynamic bindings and leaves stable DOM in place, so the throttled per-frame
  `ui.update(sim)` updates values without rebuilding nodes, preserving the
  surgical property the status pump has today.

Bundle cost is negligible against a PWA that already ships ~550 KB of Excalibur
and ~66 KB of Tone: ~3.7 KB min+gzip of lit-html rounds to noise in the precache.

## Runners-up (and why not)

- **Preact (+ `htm`) - runner-up.** The strongest fallback. Tiny, mature,
  React-shaped ergonomics (hooks, `@preact/signals`), and `htm` avoids the JSX
  build step. It lost on two counts: with idiomatic JSX it forces a `.tsx` build
  toolchain (a constraint we were told to avoid if the cost is acceptable, and it
  is avoidable), and its component model is a bigger conceptual jump from the
  current pure-string-builder seam than lit-html's template model, so the
  migration is less mechanical and touches more per dialog. Keep it as the
  fallback if lit-html's directive ergonomics ever prove limiting.
- **Solid - rejected for this codebase.** Technically excellent per-frame story
  (fine-grained signals would be the best fit for the status pump in isolation),
  but it requires the Solid compiler/Babel preset (a build-step change we are
  steering away from), and its runtime wants to own and insert its own subtree,
  which is awkward to adopt piecemeal into an existing imperatively-built DOM.
  The incremental constraint is where it fails.
- **Hand-rolled signals/vdom - rejected.** Zero new dependency is attractive on
  a PWA, but the entire point of the initiative is to delete hand-maintained UI
  plumbing. Rebuilding a diffing renderer and its escaping in-house re-creates
  exactly the maintenance and security surface we are trying to remove, at real
  risk, to save ~3.7 KB. False economy.

## Sequencing constraints the room agreed on

1. **The `UICallbacks` boundary survives the framework change.** Amelia and
   Winston confirmed that lit-html components dispatch user intent back through
   the exact same `cb.onX(...)` calls the imperative wiring uses today. Therefore
   the command/action boundary does **not** need reshaping. This is the key that
   unblocks the held `main.ts` split (see the architecture doc): the ~30-callback
   construction can be extracted to its own module first, behavior-preserving,
   because the framework does not move that boundary.
2. **Start at the leaves, from the `uiTemplates` seam.** First a spike on the
   simplest static dialog (`confirmHtml` / `congratsHtml`), prove the e2e and
   visual snapshots are untouched, then dialog-by-dialog outward. No stop-the-world.
3. **Some imperative code stays imperative, on purpose.** The bulletin-log
   append+prune (`LOG_DOM_CAP`, column-reverse) and the toast rail are deliberate
   performance structures, not markup. They migrate last, or not at all, and that
   is a documented decision, not an omission.
4. **Every phase asserts zero snapshot churn** as an acceptance gate; baselines
   regenerate only via the pinned Playwright image, and only if a real diff
   appears.
5. **Review skill is `/bmad-code-review`** for every story: this is
   tooling/UI-plumbing plus architecture, not gameplay/engine, so it routes to
   bmad, never gds.

## Open questions carried to the owner

- Confirm **lit-html standalone** (no `LitElement`/Shadow DOM), to keep the
  global stylesheet intact.
- Reactive primitive: start with a **plain per-frame snapshot + throttled
  `render()`** (no signals dependency), and add `@lit-labs/signals` only if a
  specific view needs fine-grained reactivity. Confirm this staged approach.
- Do the **bulletin log and toast rail** migrate, or stay imperative permanently?
  (Room's lean: stay imperative.)
- Do the **crash screen and onboarding** DOM chrome migrate, or stay as-is?
  (Room's lean: out of scope for this initiative.)
- Confirm the **no-version-bump** policy for a genuinely behavior-preserving,
  pixel-identical refactor (internal-only work needs none).

> "It is the same seam we already built, with the wiring and the escaping done
> for us." - the room, on why lit-html and not a rewrite.
