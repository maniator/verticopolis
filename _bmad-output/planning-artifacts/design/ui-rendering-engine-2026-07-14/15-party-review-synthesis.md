# Party Review Synthesis - Declarative UI Rendering Layer

**Produced with:** three-lens review of the plan of record (dev, design/UX,
game/perf), folded back into the artifacts.
**Companion to:** `00-party-notes.md`, `10-product-brief.md`,
`20-architecture-decision.md`, `30-epics-and-stories.md`,
`40-spec-first-story.md`, `50-testing-strategy.md`.
**Intended target location:**
`_bmad-output/party-mode/2026-07-14-ui-render-layer-review-synthesis.md`

This document records the three-lens review of the lit-html plan, the verdicts,
and a finding-by-finding trace of where each review output was folded into the
plan. It is the audit trail for the revision: nothing here is a fresh decision,
every row points at the artifact and section that now carries the change.

## Verdicts

All three lenses **ENDORSE WITH CHANGES**. None asked to change the framework
decision (lit-html standalone). Each attached a set of blocking and non-blocking
changes, all of which are now folded into the plan of record.

| Lens | Verdict | Headline of the required changes |
|---|---|---|
| 💻 **Dev** | ENDORSE WITH CHANGES | String-composition builders auto-escape under lit, so several dialogs are not a mechanical port; one-container-one-renderer invariant; the modal-mount decision; harden the E1 factory; E6 rewrites two test files. |
| 🎨 **Design / UX** | ENDORSE WITH CHANGES | Most a11y lives in controller side effects, not markup, so a mechanical port drops it; per-phase a11y checklist as acceptance criteria; the fire-once modal deadlock risk; render-target granularity so lit and `main.ts` do not clobber `#traffic`. |
| 🎮 **Game / Perf** | ENDORSE WITH CHANGES | Correct the cadence language (throttled ~6 Hz, not per-frame); per-surface truth instead of a uniform diffing win; a blocking perf-gate story (E5-S0) with committed baselines; name the catch-up-spiral mechanism in Risks. |

## Resolved open questions

The party notes carried five open questions to the owner. They are now resolved
and recorded here so no downstream story re-opens them.

1. **Reactive layer:** adopt **lit-html standalone** (`html`/`render` from
   `lit-html`), no `LitElement`, no Shadow DOM, so the global `src/styles.css`
   reaches every node. Confirmed.
2. **Reactivity primitive:** start **snapshot-only, render-on-change** (shallow
   compare a per-frame view snapshot, skip `render()` when unchanged). No
   `@lit-labs/signals` dependency now; it is a separate, gated decision if a
   specific view later needs fine-grained reactivity. Confirmed.
3. **Bulletin log and toast rail:** **stay imperative.** They are deliberate
   performance structures (constant-node append and prune, self-removing toast
   cap), not markup. E7 records the decision; do not throttle their announcements
   to meet a frame budget.
4. **Crash screen and onboarding chrome:** **out of scope** for this initiative.
5. **Version bump:** **none** for a genuinely behavior-preserving, pixel-identical
   refactor (internal-only work needs none). A discovered pixel or behavior change
   is a defect to fix, not a bump to make.
6. **E0 proof dialog:** **`confirmModal`**, chosen over `congratsTower` because it
   also proves inline callback dispatch (the `onYes` path and the `{ close: false }`
   no-close-button case), which is the mechanism every later dialog reuses.

## Findings-to-resolution traceability

Every review finding, and where it now lives in the plan.

### Game / Perf lens

| # | Finding | Folded into |
|---|---|---|
| GP-1 | Cadence is throttled to ~6 Hz (`main.ts`: `now - lastUiUpdate > 160`), not per-frame. Stop saying "per-frame render()". | `20` invariant 3 and section 5 (corrected cadence language); `10` success criteria; `30` cross-cutting DoD; this doc. |
| GP-2 | Per-surface truth, not a uniform diffing win: tower-stats grid = genuine win (migrate), status bar = keep imperative or gate on snapshot-inequality, palette lock scan = keep imperative unless it measures clean, tool-info = event-driven (free to migrate). | `20` section 3 (component model, per-surface) and section 5; `30` E5-S1/S2/S3 rewritten per surface; `50` per-phase matrix. |
| GP-3 | Model is render-on-change (shallow-compare snapshot, skip render when unchanged), not render-per-pump. | `20` invariant 3 and section 5 (render-on-change); `30` E5 ACs. |
| GP-4 | Free win to bank: dirty-gate the palette lock scan (rescan only when star or affordability crosses a boundary). | `20` section 5; `30` E5-S3. |
| GP-5 | Add a BLOCKING perf-gate story before E5 live views (E5-S0): (A) `ui.update` ms/frame micro-benchmark on a committed large-tower fixture, N=2000, median(after) <= median(before) hard-fail at +5%, p95 <= 1.10x; (B) at speed 120 on a 4-6x CPU-throttled profile, sim-minutes advanced per real second over a fixed window >= baseline; (C) DOM node-identity stable + write-before-`positionPanels`-read ordering (no forced reflow). Baselines committed as JSON, enforced in CI. | `30` new story E5-S0; `50` perf-gate section; `20` section 5 and section 10. |
| GP-6 | Risks: a heavier pump inflates measured `dtMs`, feeding the catch-up accumulator and the spiral blamed for the Pixel-8a WebGL context loss; `MAX_CATCHUP_MINUTES` clamps but converts extra cost into the game visibly running slower than the speed button. Structural mitigation (record, do not do now): decouple `ui.update` from `engine.onUpdate`'s dt accounting (own rAF/timer) so UI cost cannot feed the sim catch-up; apply only if profile B regresses. | `20` section 11 (new perf-spiral risk with the named mitigation, marked deferred). |

### Design / UX lens

| # | Finding | Folded into |
|---|---|---|
| UX-1 | Invariant: most a11y here lives in controller side effects, not templates, so a mechanical port drops it; every story enumerates its a11y behaviors as acceptance criteria. | `20` invariant 5 (a11y-in-controllers); `30` per-story a11y checklist; `50`. |
| UX-2 | R1 (high, sim-deadlock): the fire-once emergency/update modals resolve once across button/Esc/backdrop/x by assigning `dialog.onclick`/`oncancel` PROPERTIES. The shared modal helper sets these by property assignment, never `addEventListener`; test all four dismissal paths per fire-once modal. A dropped resolve deadlocks the frozen sim. | `20` section 4 and Risks R1; `30` E2-S1/S2 checklist; `40` modal-mount constraints; `50` fire-once matrix. |
| UX-3 | R2: `#a11y-live` polite announcements (import/export reports, and the update chip's clear-then-rAF re-announce-every-call) are controller side effects; make them explicit acceptance criteria with a test asserting the region text after open. | `30` E3-S4 and E2-S2 checklists; `50`. |
| UX-4 | R3: E5 status bar renders the individual leaf spans (money/pop/star/time/date), NOT a wrapper that also owns `#traffic` (updated imperatively in `main.ts` with a hysteresis aria-label), else lit and `main.ts` clobber each other. Pin render-target granularity in E5-S1. | `20` section 5 and invariant 1 note; `30` E5-S1; `50`. |
| UX-5 | Visual-snapshot gate has blind spots (dropped `data-*`/`aria-*`, attribute order, property-vs-attribute do not move pixels; most dialogs are in no baseline). Require a transitional DOM-equivalence test per template (normalized DOM equality) and semantic unit assertions (querySelector + attribute reads), never raw `outerHTML` equality. | `20` section 10 (Testing & Regression strategy); `30` test-package AC block; `50` (the 5-part package). |
| UX-6 | Dialog-inventory fixes: Settings is stateful (own checklist), new-tower calendar renders always (forbid a `mode==='modern' ? html : nothing` improvement), saves per-row `aria-label="Delete save slot N"`, reports keep `isModalOpen()` guard + Modern-gated legacy `disabled`+`title`. | `30` E2-S3 (Settings own checklist, reframed stateful), E3-S3 (calendar-always note corrected), E3-S1 (saves aria-label), E3-S4 (reports guard). |
| UX-7 | Rules: drive initial modal focus with explicit `.focus()`, not reliance on the `autofocus` attribute surviving lit's diffing; keep the x appended after focus/`showModal`; author markup verbatim with no reflowed whitespace between inline elements (batch stepper `>-</button>...<button>+`, `vol-row`). | `20` section 4 and invariant 1; `30` E0 and per-story checklists; `40` constraints. |
| UX-8 | Per-phase a11y-preservation checklist on EACH story (E0 mount; E2 confirm/event/update/settings/help; E3 saves/stops/new-tower/reports; E4 batch; E5 status/palette; E6 editor/inspector; E7 log/toast). | `30` per-story a11y checklist (each story). |
| UX-9 | Deferred a11y WINS (log to the deferred list / backlog, do not slip into a behavior-preserving phase): `aria-labelledby` tying `#modal` to its `.win-title` h2; announce the batch two-click reset arming. | `20` section 10 deferred list; `30` cross-cutting DoD note; `50`. |

### Dev lens

| # | Finding | Folded into |
|---|---|---|
| DV-1 | Biggest not-mechanical item: string-composition builders auto-escape their own markup under lit. `statsModalHtml(html)`, `savesHtml`/report `li=()=>...join("")` lists, `stopsHtml`, `towerStatsHtml`, `buildToolInfoHtml` build inner rows by string concat. Rule: recompose as NESTED TemplateResults; `unsafeHTML` is a reviewable red flag, never a shortcut. Migrating a dialog often pulls its sub-builders with it. | `20` invariant 6 and section 3 (string-composition rule); `30` E3-S1/S2/S5 and E5; `50`. |
| DV-2 | Container-ownership hazard (mixed migration): lit stores render state as a property on its container; the string path's `closeModal` does `innerHTML=""`, removing child nodes but not that property. Invariant: ONE CONTAINER, ONE RENDERER (imperative XOR lit) at any instant; never call `render()` and set `.innerHTML` on the same element. | `20` invariant (one-container-one-renderer) and section 4; Risks (container part-cache). |
| DV-3 | Modal mount decision (dev + design converged, now the arch decision): keep the tested `openModal` shell imperative; add a sibling `openModalTemplate(result)` that builds the SAME shell and `render(result, freshBox)` into a fresh-per-open box discarded on close. Preserves the window grammar the integration test pins, keeps x/focus ordering, and dissolves the part-cache hazard. | `20` section 4 (modal-mount decision); `40` CAP-2; `50`. |
| DV-4 | E1 `createUICallbacks(app)` factory: harden the ACs. The factory captures the LIVE instance (getter/thunk slice, mirroring `getSim: () => this.sim`), never destructured values (else `adoptSim` swaps break); callbacks that mutate private `GameApp` state delegate to `GameApp` methods/ports, not privates; preserve controllers-before-`new UI(...)` order (the UI ctor's initial `selectTool` fires `onSelectTool` synchronously and needs `this.keyboard`). | `20` section 8 and Risks (factory laziness); `30` E1-S1 ACs. |
| DV-5 | E6 correction: "integration+e2e pass unchanged every phase" is FALSE at E6 by construction; the `renderEditor` describe block in the integration spec and `editorPatch.test.ts` encode the `key`/`patchVolatile` mechanism lit's diff replaces. Carve out: those are REWRITTEN at E6, and a new test pins the surviving invariant (a refresh between `pointerdown` and `pointerup` must not recreate the pressed button, the "+ rent" bug). Keep `editorBusy` as belt-and-suspenders through E6. | `20` section 6 and Risks (E6 test rewrite); `30` E6-S1 carve-out; `50`. |
| DV-6 | Schedule the Statistics dialog (`showStats`/`statsModalHtml` + `buildStatsHtml`) explicitly (in no epic; worst string-composition case): put it in E3 and decide whether `buildStatsHtml` migrates with it. | `30` new story E3-S5; `20` section 3 example. |
| DV-7 | E0 bundle ACs: assert no `LitElement` in the built chunk AND that the PROD (not development) lit build is bundled (no lit dev banner in dist); directive imports resolve from `lit-html/directives/*` and tree-shake. Use `map` (unkeyed) not `repeat` for the lists. `ref` not needed (render is synchronous, so post-render `offsetWidth` reads are valid). | `30` E0-S1 ACs; `40` CAP-1; `20` section 7. |
| DV-8 | The 1544-line `uiDialogs.integration.test.ts` is the STRONGEST per-phase gate (data-act routing, single-resolve, x/focus, hostile-name escaping which validates lit auto-escape, toast cap, log-freeze regression, palette lock/afford). Promote "this spec passes unchanged" to the primary gate for E2-E5; per-template unit tests supplement it. | `20` section 10; `30` cross-cutting DoD and test-package block; `50` (part 3). |

### Testing contract (cross-cutting mandate)

| # | Mandate | Folded into |
|---|---|---|
| T-1 | E0 delivers the shift-left INFRASTRUCTURE (unit tier, happy-dom, runs pre-push before e2e): `renderToFragment(TemplateResult)`; `assertDomEquivalent(legacyString, litTemplate)` (normalized tag/class/id/`data-*`/`aria-*`/role/name/type/boolean-attr equality, insignificant whitespace ignored); a small event-dispatch harness. | `30` new story E0-S2; `40` CAP; `50` harness section. |
| T-2 | EVERY touched aspect ships a merge-blocking 5-part test package: (1) colocated shift-left unit test (semantic structure, event dispatch to correct callback/args, hostile-input auto-escapes, checklist a11y specifics, never `outerHTML` equality); (2) transitional old-vs-new DOM-equivalence regression test (deleted in the same PR that retires the string builder); (3) integration spec stays green (E6 rewrite carve-out); (4) for live views, the E5 perf baselines; (5) zero visual/snapshot churn via `git diff --stat`. | `20` section 10; `30` repeated test-package AC block; `50` (the 5-part package). |
| T-3 | Coverage rule: migrated lit modules get real unit coverage (a coverage GAIN vs string builders; no new coverage exemption). | `20` section 10; `30` cross-cutting DoD; `50` coverage rule. |

## Notes for the owner (inconsistencies reconciled during the fold-in)

These are places where a review finding contradicted the draft as written. Each
is now corrected in the plan; they are surfaced here so the change is visible,
not hidden.

- **Cadence.** The drafts repeatedly said "per-frame status pump" and
  "per-frame `ui.update(sim)`". The live path is throttled to ~6 Hz
  (`main.ts` gates on `now - lastUiUpdate > 160`). Corrected to "throttled
  ~6 Hz pump" throughout.
- **Uniform diffing win.** The draft E5 framing treated the status bar migration
  as a clear diffing win. The status bar is already 5 zero-allocation
  `textContent` writes; lit does not beat that. Reframed per surface: migrate the
  tower-stats grid (today `innerHTML=` reparses the grid every pump), keep the
  status-bar leaf writes imperative or render-on-change, keep the palette lock
  scan imperative unless it measures clean.
- **Status bar owns `#traffic`?** No. `#traffic` and its `traffic-glyph` /
  `traffic-label` / `traffic-floor` children are updated imperatively by
  `main.ts` `updateTraffic()` (with boundary hysteresis and an aria-label),
  called right after `ui.update(sim)`. E5-S1 must target the leaf stat spans, not
  a wrapper that also owns `#traffic`, or the two writers clobber each other.
- **New-tower calendar conditionality.** The draft called it "the Modern calendar
  sub-picker", which reads as conditional. In `newTowerHtml` the `.nt-calendar`
  block renders ALWAYS; only `found()` reads `nt-cal` when the mode is Modern.
  Corrected: the calendar always renders, and a `mode==='modern' ? html : nothing`
  "improvement" is forbidden.
- **Settings filed as simple/static.** The arch Phase 2 list and the draft placed
  `showSettings` among "simple static dialogs". It is stateful (live volume
  reads, switch re-read after toggle, OS-forced-reduced-motion sets `disabled`
  AND relabels the span). It keeps its own story with its own a11y checklist and
  is no longer described as static.
- **Statistics dialog absent.** `showStats` / `statsModalHtml` (fed the pre-built
  `buildStatsHtml` blob) appeared in no epic. It is the worst string-composition
  case (a whole HTML blob interpolated into a template, which lit would escape to
  visible text). Added as E3-S5 with an explicit decision on whether
  `buildStatsHtml` migrates to nested templates with it.
- **"Tests pass unchanged every phase".** True through E5, false at E6: the
  `renderEditor` integration block and `editorPatch.test.ts` encode the exact
  `key`/`patchVolatile` mechanism E6 removes. Those are rewritten in E6, with a
  new test pinning the surviving mid-click invariant.
