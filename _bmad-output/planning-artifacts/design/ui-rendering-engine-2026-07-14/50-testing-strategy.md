# Declarative UI Rendering Layer - Testing and Regression Strategy

**Produced with:** the mandatory shift-left plus regression testing contract for
the lit-html migration.
**Companion to:** `20-architecture-decision.md` (section 10 carries the same
contract inline), `30-epics-and-stories.md` (the per-story test-package AC
block), `15-party-review-synthesis.md`, `40-spec-first-story.md`.
**Intended target location:**
`_bmad-output/planning-artifacts/design/testing-ui-render-layer-2026-07-14.md`

This is the standalone testing contract for the migration. It is a hard,
merge-blocking gate, not guidance. Every touched aspect (each dialog, panel, and
live view) carries the same five-part test package. The migration is shift-left:
correctness is proven at the unit tier (happy-dom, runs pre-push before the e2e
tier) before the slower behavioral and visual tiers run. It is also regression
first: an old-vs-new equivalence test rides alongside each migration and is
retired in the same PR that retires the string builder it guards.

The project already splits tests into a unit tier (`src/**/*.test.ts`, colocated,
happy-dom) and an integration tier (`src/**/*.integration.test.ts`), both run by
`vitest run`, with a coverage ratchet over the whole app (see `vite.config.ts`
and CONTRIBUTING.md). This contract slots into that structure: new lit unit tests
are colocated `*.test.ts` files, the integration spec
(`src/tests/integration/uiDialogs.integration.test.ts`) stays the behavioral
gate, and the coverage ratchet must not fall.

## 1. E0 shift-left infrastructure (built once, used by every later story)

E0 delivers the harness the whole migration depends on. It is unit tier, runs in
happy-dom, and runs pre-push before the e2e tier. Three helpers:

- **`renderToFragment(result: TemplateResult): DocumentFragment`.** Renders a lit
  template into a detached container and returns the resulting nodes, so a unit
  test can assert structure without a live modal, a dialog controller, or the
  app. This is the lit-era equivalent of asserting on a string builder's output.
- **`assertDomEquivalent(legacyString: string, litTemplate: TemplateResult)`.**
  Parses the legacy HTML string and renders the lit template, then asserts a
  NORMALIZED structural equality: same tag tree, and for every element the same
  `class` set, `id`, `data-*`, `aria-*`, `role`, `name`, `type`, and boolean
  attributes (`disabled`, `checked`, `hidden`, `autofocus`, `required`).
  Insignificant whitespace between block elements is ignored; significant inline
  whitespace (between inline elements, where a reflow would change layout or
  spacing) is preserved and compared. This is the transitional regression guard:
  it proves the lit output matches the string output the design system and the
  selectors depend on, and it catches exactly the drift the pixel snapshot is
  blind to (a dropped `data-*` or `aria-*`, a reordered attribute, a
  property-vs-attribute swap).
- **Event-dispatch harness.** A small helper to fire `@click` / `@change` /
  `@input` on a rendered node and assert the bound callback ran with the right
  arguments (for example, a stops checkbox toggle calls back with
  `(floor, checked)`; a saves delete calls `onDeleteSlot(slot)`).

Constraint on `assertDomEquivalent`: it compares normalized DOM, NEVER raw
`outerHTML` string equality. Raw `outerHTML` equality would fail on cosmetic,
behavior-neutral differences (attribute serialization order, quote style) and
pass on some meaningful ones; it is the wrong instrument. Unit assertions in the
package are likewise semantic (`querySelector` + attribute reads), never
`outerHTML`.

## 2. The five-part test package (every touched aspect, merge-blocking)

Each migrated dialog, panel, or live view ships all five. All five are hard
acceptance criteria; a story is not done until each is present and green.

1. **Colocated shift-left unit test** (`*.test.ts` next to the module). Renders
   the lit template via `renderToFragment` and asserts:
   - SEMANTIC structure: the tags, `class` sets, `id`s, and `data-*`/`aria-*`/
     `role` attributes the selectors and CSS key on are present. Never
     `outerHTML` equality.
   - Event dispatch: firing each interactive element calls the correct callback
     with the correct arguments.
   - Hostile input auto-escapes to text: a tower name or report line containing
     markup renders as visible text, not parsed HTML (this replaces, and
     strengthens, the old `escapeHtml` obligation).
   - The a11y specifics from this aspect's per-phase checklist (section 4 of
     `30-epics-and-stories.md`), asserted directly.
2. **Transitional old-vs-new DOM-equivalence regression test.** Uses
   `assertDomEquivalent(oldStringBuilder(args), newTemplate(args))` across the
   inputs that matter (empty, populated, hostile, boundary). It is DELETED in the
   same PR that retires the string builder, so it cannot rot into a test of two
   dead code paths. Its whole job is to prove the swap changed nothing observable.
3. **The integration spec stays green.** `uiDialogs.integration.test.ts` (1544
   lines) is the primary behavioral gate for E2 through E5: it pins `data-act`
   routing, single-resolve, x/focus ordering, hostile-name escaping (which
   independently validates lit auto-escape), the toast cap, the log-freeze
   regression, and palette lock/afford visibility. It passes UNCHANGED, with one
   carve-out: at E6 the `renderEditor` describe block and `editorPatch.test.ts`
   are rewritten (section 3), because they encode the very `key`/`patchVolatile`
   mechanism E6 removes.
4. **For live views only: the E5 perf baselines.** The migrated live view must
   clear the E5-S0 perf gate (section 3 of this doc). This part is inert for
   dialog and panel stories and mandatory for E5 stories.
5. **Zero visual/snapshot churn.** `git diff --stat` touches no file under
   `e2e/visual.spec.ts-snapshots/` or `docs/screenshots/`. A diff is investigated
   as a defect before any baseline regenerates, and regeneration is only ever via
   the pinned Playwright image.

## 3. The E5-S0 perf gate (blocking, before any live-view migration)

E5-S0 lands the perf harness and the committed baselines before E5-S1 touches a
live surface. Baselines are captured on the pre-E5 commit, committed as JSON, and
enforced in CI. Three measurements:

- **(A) `ui.update` cost.** A Playwright micro-benchmark of `ui.update`
  milliseconds per frame on a committed large-tower fixture, N=2000 pumps.
  Assert `median(after) <= median(before)`, HARD-FAIL at +5%; `p95(after) <=
  1.10 x p95(before)`.
- **(B) End-to-end speed (the decisive one).** At speed 120 on a 4-6x
  CPU-throttled profile, measure sim-minutes advanced per real second over a
  fixed window. Assert `>= baseline`. This tests "same speed or faster" through
  the whole loop, not just the render call, and it is the measurement that
  catches the catch-up spiral (a heavier pump inflating `dtMs` and stretching
  frames).
- **(C) No forced reflow, stable identity.** DOM node identity is stable across
  pumps (no per-pump rebuild of the status or stats subtree), and the write path
  obeys a write-before-`positionPanels`-layout-read ordering rule so a live-view
  write never forces a synchronous reflow that a later `offsetWidth` read would
  pay for.

If profile B regresses, the recorded structural mitigation applies (decouple
`ui.update` from `engine.onUpdate`'s dt accounting via its own rAF/timer, so UI
cost cannot feed the sim catch-up). That mitigation is deferred and out of scope
unless B fails; it is named in the Risks section of the arch doc.

## 4. Coverage rule

Migrated lit modules get REAL unit coverage, a coverage GAIN versus the string
builders they replace, with no new coverage exemption added to `vite.config.ts`.
The global ratchet (statements 91, lines 92, functions 90, branches 85) and the
per-file floors must not fall. A migration that would drop coverage is
incomplete: add the unit tests, do not add an exemption.

## 5. Per-phase test matrix

Each row is an aspect, the tests it ships, and the specific behaviors those tests
pin. Every aspect also carries parts (1), (2), (3), and (5) of the package;
"perf" marks the aspects that additionally carry part (4).

| Aspect | Story | Unit test pins | Integration / regression pins | Perf |
|---|---|---|---|---|
| `confirmModal` (E0 proof) | E0-S3 | inline `@click` dispatch to `onYes`; `{ close: false }` no-close-button; title/body/yesLabel render as text | `confirmModal renders no close button and wires yes/no`; x/Esc still close via cancel path | no |
| Modal shell (`openModalTemplate`) | E0-S2 | fresh-per-open box; `.modal-box.win`; top-level h2 skinned `.win-title`; x appended after `showModal` and focus | `openModal - the window grammar` block passes for the template path | no |
| `confirmModal` / `showEventChoice` | E2-S1 | decline == dismiss; render-as-text | emergency modal resolves decline once across button/Esc/backdrop/x (all four) | no |
| `showUpdatePrompt` + update chip | E2-S2 | later == backdrop == Esc == x, fire-and-forget; `.whatsnew li`, `.build-id` | `#a11y-live` re-announce (clear then rAF) asserted after chip show | no |
| `showSettings` (stateful) | E2-S3 | sliders init from live volumes and apply on input; switches re-read live state; OS-forced reduced-motion disables + relabels; `role=switch`, `aria-describedby`, `aria-hidden` readouts | Settings button opens Settings; hosts no help controls | no |
| `showHelp` | E2-S4 | replay disabled + `title` on splash; report link `rel=noopener` + visually-hidden span + `routeExternalInWrapper`; explicit primary focus on "Got it" | `showHelp - the Report an issue link` block | no |
| `showSaves` | E3-S1 | per-row `aria-label="Delete save slot N"` templated through the map; `[data-save]`/`[data-load]`/`[data-del]` dispatch; tower names as text (no `escapeHtml`) | saves export opens confirm; `map` (unkeyed) not `repeat` | no |
| `showStopsDialog` | E3-S2 | per-floor `@change` calls `(floor, checked)`; lobby tag; label association; title as text | stops toggle routing | no |
| `newTowerModal` | E3-S3 | calendar `.nt-calendar` renders ALWAYS (both modes); Classic ignores `nt-cal`; Modern reads it; abandon warning only with a tower to lose | `newTowerModal - the rule-set picker` block | no |
| Reports + export choice | E3-S4 | `#a11y-live` fires ("report ready"); `isModalOpen()` clobber guard; Modern-gated legacy `disabled`+`title`; report lines as text | import/export fidelity report blocks; hostile-name escaping | no |
| Statistics (`showStats`) | E3-S5 | body renders as real DOM, not escaped text (nested templates, not a string blob); decision on `buildStatsHtml` recorded | stats dialog opens and closes | no |
| `showBatchPricingDialog` | E4-S1 | `#bp-preview aria-live`; inc/dec `aria-label`; two-click reset arming; Apply-disabled parity across every input path | preview and Apply-disabled identical to the old `refresh()` | no |
| Status bar + tower stats | E5-S1 | leaf spans money/pop/star/time/date targeted, NOT a `#traffic` wrapper; money-negative color; star string; tower-stats grid migrates (status writes stay imperative or render-on-change); node identity | grid values match old surgical writes | perf |
| Tool-info panel | E5-S2 | identical markup per tool (event-driven, free to migrate) | tool select renders correct info | perf |
| Palette lock/afford | E5-S3 | keep `.locked` out of tab order; `role=button`/`tabindex`/Enter-Space/`e.repeat`/`stopPropagation`; dirty-gated rescan (only on star/afford crossing) | palette lock/afford visibility block | perf |
| Editor / inspector | E6-S1/S2 | mid-click safety (a refresh between `pointerdown` and `pointerup` does not recreate the pressed button, the "+ rent" bug); `.ed-close`/`insp-close` aria-label; `win-title` h4; mobile x; `data-edit`/`data-field` preserved | `renderEditor` block and `editorPatch.test.ts` REWRITTEN this story; new test pins the surviving mid-click invariant; `editorBusy` kept as belt-and-suspenders | no |
| Log + toast | E7-S1 | (stay imperative) constant-node append/prune; self-removing toast cap; announcements not throttled for frame budget | event-log toast/bulletin pump block stays green | no |

## 6. Deferred testing and a11y notes (backlog, not this migration)

- Deferred a11y WINS (do not slip into a behavior-preserving phase): add
  `aria-labelledby` tying `#modal` to its `.win-title` h2; announce the batch
  two-click reset arming. Log to `_bmad-output/implementation-artifacts/backlog.md`.
- Structural perf mitigation (decouple `ui.update` from the sim's dt accounting)
  is applied only if E5-S0 profile B regresses; otherwise it stays a recorded
  option.
</content>
