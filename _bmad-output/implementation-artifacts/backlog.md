# Engineering Backlog

This is the **single** backlog for cross-cutting or future action items that
emerge from reviews and planning. It is the successor to the old
`deferred-work.md`. Everything that used to land there lands here now.

Routing guidance:

- Use this file for non-urgent optimizations, refactors, or follow-ups that span
  multiple stories/epics, plus review deferrals that are real but intentionally
  not actioned in the PR that found them.
- Must-fix items to ship a story belong in that story's `Tasks / Subtasks`.
- Same-epic improvements may also be captured under the epic Tech Spec
  `Post-Review Follow-ups` section.

How items flow:

1. The BMGD/BMAD review skills (`gds-code-review`, `bmad-code-review`,
   `*-quick-dev`) append each `defer` finding to the **Deferral inbox** below,
   under a dated `### Deferred from:` heading.
2. Triage folds inbox entries into the table as a curated row (and removes the
   raw inbox note once captured). Pick items up when you next touch the area.
3. **GitHub mirror (standing rule, 2026-07-15):** every curated row that is not
   finished has a matching GitHub issue, recorded in the `GH` column as `#NNN`.
   Finished means `done`, `resolved`, `shipped-v1` (its remainders live on
   their own rows), or superseded; every other status is open work and needs a
   live issue. Create the issue when the row lands: matching template title
   prefix (`[Feature]:` / `[Bug]:` / `[Parity]:` / `[Docs]:`; for the internal
   Types, a defect-shaped `review-deferral` or `bug` takes `[Bug]:`, an
   improvement-shaped `review-deferral`, `perf`, `design-decision`, or `task`
   takes `[Feature]:`, a divergence of implemented behavior from 1994 takes
   `[Parity]:`, and docs/process work takes `[Docs]:`), the priority tag
   `[P1]`-`[P3]` in the title (the label taxonomy has no priority axis), and
   the row's notes as the body with a pointer back to the story id. When a row
   finishes, close the issue (completed or not planned) and set the `GH` cell
   to `—`; when an issue is closed on GitHub first, true up the row the same
   way in the next session that touches this file.
   `src/tests/backlogIssueMirror.test.ts` enforces the row half of the
   invariant: well-formed rows, a known status vocabulary, no unresolved row
   without an issue, no finished row holding a live reference, and no two rows
   sharing an issue number.
4. `Type` legend: `review-deferral` (a real finding parked for scope),
   `perf` (a measured/suspected optimization), `feature-request` (unbuilt
   capability awaiting a spec), `bug` (a player-reported defect awaiting a
   fix), `design-decision` (a ruling recorded for the record, often parked
   with its trigger), `task` (a scoped follow-up with a known method).
   `Status`: `open`, `in-progress`, `idea` (feature not yet specced),
   `done` (delivered in full), plus the table's established refinements:
   `partial` (a named remainder is still open), `parked` (deliberately
   shelved with a resurrection condition), `next` (queued), `shipped-v1`
   (first version shipped; the row tracks refinements), `resolved`
   (investigated or fixed and verified; kept for the record, unlike `done`
   it usually closes a defect or a question rather than delivering a
   feature), and `impl-review` (implemented, awaiting review/validation).
5. `Priority` is the do-first order (impact × effort × risk, and whether the
   item is blocked), distinct from `Severity`, which is impact alone. **P1**:
   work next; real correctness/data-safety impact and ready to pick up. **P2**:
   worthwhile, do opportunistically when you next touch the area. **P3**:
   low/cosmetic, blocked on investigation, watch-only, or a feature awaiting a
   spec. The `Priority` value stays strictly `P1`/`P2`/`P3` so the column is
   machine-sortable. Within P3, _ready_ cheap fixes are ordered before _gated_
   ones (blocked on profiling / a spec / watch-only), and each P3 row's Notes
   lead with **Ready.** or **Gated.** so nobody burns a session grabbing a
   blocked "easy P3."
6. Priorities validated by an agent party (game architect + game designer +
   persistence architect, 2026-07-06): P1/P2 and the P3 tier confirmed
   unanimously; the design voice dissented on the VIP-limo row (argued P2 on
   player-visibility), resolved by ranking it first among the P3 cosmetics
   rather than a tier bump.

| Date | Story | GH | Epic | Type | Priority | Severity | Owner | Status | Notes |
| ---- | ----- | -- | ---- | ---- | -------- | -------- | ----- | ------ | ----- |
| 2026-07-15 | commercial-demand-pools | #393 | SimTower parity | feature-request | P2 | med | — | in-progress | **Phase 0 (spec) drafted: `gdd-commercial-demand-pools-2026-07-15` + `arch-commercial-demand-pools-2026-07-15`. Model: per-origin census budget split across reachable venues by capacity; `min(1, D_v/cap_v)` replaces the `appeal` scalar; total demand conserved so a second identical venue cannibalizes the first (emergent abandonment). Build in phases A (engine swap + golden re-pin), B (inspector truth), C (GameRules `demandModel()` mode split), each its own `/gds-code-review` PR. From the SimTower optimization-thread gap analysis (`gdd-simtower-optimization-gaps-2026-07-15`). Epic, spec-first.** Commercial income is a tower-wide appeal scalar (`trafficAppeal` in `EconomySystem.ts`), so every venue earns the same share regardless of who is near it: no diminishing returns, no cross-venue lift, and the thread's suspected "abandonment limit" has nowhere to come from. Replace it with a per-origin demand budget split across reachable venues (divide an origin's demand by the venues sharing it); that denominator restores the classic placement loop and makes the abandonment limit emergent. Reuses `patronageToday`/`customersIn`/`retailSpendPerCustomer` plus reachability. Economy core, so `/gds-code-review` plus a golden reference-tower calibration test that conserves total income at the calibration point. Classic matches 1994 magnitudes; Modern may retune. Highest-leverage item in the roadmap. |
| 2026-07-15 | attendance-venue-demand | #424 | SimTower parity | feature-request | P3 | med | — | idea | **From the `/gds-code-review` of commercial-demand-pools Phase A (#423), under the #393 epic (GDD §4.5 revisit, now confirmed).** A cinema (`dailyTrafficIncome` 8000) and party hall (3000) enter the demand pool's `totalCap` as capacity sinks, so a single cinema in a modest tower collapses `share = pool / totalCap` and can zero genuine retail (shop/food) income, though a cinema's real patronage is the separate live-attendance system, not the office/condo/hotel demand pool. Fix: give attendance venues their own fraction from their attendance fill (`customersIn / attendance` cap) and drop them from the retail `totalCap`; verify against the `economyDepth` blockbuster economics. Per-spec today (intended capacity-sink, Acceptance Auditor), so a balance refinement, not a correctness bug. `/gds-code-review`; player-facing, version bump when built. |
| 2026-07-15 | graduated-lobby-distance-eval | #394 | SimTower parity | feature-request | P2 | med | — | idea | **From `gdd-simtower-optimization-gaps-2026-07-15`.** The 1994 game penalizes mid-block floors (6-10, 21-25, 36-40, ...) on a graduated far/very-far scale for every tenant, which is what makes sky-lobby placement matter; we model only W1 `transportFar` (office-only, single-tier, keyed to nearest shaft not lobby), so condos and hotels feel no lobby-distance pressure. Add a graduated satisfaction drain keyed on floors from the nearest (sky)lobby for office/condo/hotel, caps-not-kills like `NOISE_CAP`, folded into the single per-tick erosion step with a new `lobbyFar` vacate cause. Reuses `nearestLobbyFloorDistance`. Classic uses the canon bands; Modern a smoother curve. `/gds-code-review`; player-facing, so a version bump when built. |
| 2026-07-15 | leave-tower-unmet-demand | #395 | SimTower parity | feature-request | P2 | med | — | idea | **From `gdd-simtower-optimization-gaps-2026-07-15`. Depends on `commercial-demand-pools` (#393).** In 1994 a tenant with no reachable nearby venue leaves the tower to eat or shop and unmet demand costs population; we have only economic gates (stranded floors earn $0, W3 halves far commercial income) with no population or satisfaction consequence. Add a soft satisfaction drain when a tenant's reachable local-venue coverage for its meal or shop routine is below a floor, routed into the existing vacate/grace path, coupling venue mix to population to the star gates. Must read the statistical census, never the ~140-person drawn crowd (the cap saturates on big towers). `/gds-code-review`. |
| 2026-07-15 | contiguous-skylobby-transfer | #396 | SimTower parity | feature-request | P3 | — | — | idea | **Gated: routing-admissibility change, Classic-gated, regression risk. From `gdd-simtower-optimization-gaps-2026-07-15`.** In 1994 a sim transfers express to standard only through a contiguous sky lobby touching both; our routing allows a transfer at any shared stop via implicit graph adjacency (MAX_RIDES stays 2). The explicit rule forces the layered-tower architecture the thread is built around. Add it gated to Classic via `gameRules.ts` (Modern may keep the forgiving version); needs a strong routing-graph test surface before shipping since towers that route today could strand. `/gds-code-review`. |
| 2026-07-15 | condo-demographic-routines | #397 | Classic/Modern split | feature-request | P3 | — | — | idea | **Ready (Modern), builds on `gdd-condo-household-departures-2026-07-08`. From `gdd-simtower-optimization-gaps-2026-07-15`.** The thread describes condo demographics (children leave for school in the morning and return early afternoon) and office sales-call trips during the day; we model a generic "one stays home, the rest leave" with no school entity and no sales calls. Add these as statistical spawn-mix and timing biases on the existing crowd layer (no per-sim identity or serialization) using the meal round-trip machinery and `originUnitId`, giving each hour a distinct traffic signature. Texture and rhythm; keep Modern; optional visible daily-rhythm timeline. `/gds-code-review`. |
| 2026-07-15 | weekend-patronage-curve | #398 | SimTower parity | feature-request | P3 | — | — | idea | **Ready, small. From `gdd-simtower-optimization-gaps-2026-07-15`.** The 1994 game has explicit weekday/weekend visitor targets (fastFood/restaurant 35 weekday, 48 weekend; shops 25, 30); we model weekend presence but the commercial money loop reads no weekend term, so weekend income shifts only indirectly. Add per-kind weekday/weekend multipliers (restaurant and shop up on weekends, office-lunch venues down) so the canon 3-day calendar is economically legible. Draw any new factor from the seeded RNG at the existing call site for determinism. Classic matches 1994 numbers; Modern tunable. `/gds-code-review`; touches economy math. |
| 2026-07-15 | star-blockers-checklist | — | UI legibility | feature-request | P2 | — | — | done | **SHIPPED v1.35.0 (PR #409): the "Next: N★" checklist in the Tower Statistics modal, driven by the shared `cumulativeStarGates` read model in `sim/star.ts` so the checklist can never disagree with `evaluateStar`/`checkVip` promotion; issue #399 closed.** Original ask: a player stalls at 3 stars with population met and no idea a Medical Center or a favorable VIP review is missing; the gate booleans exist in `sim/star.ts` (security, medical, `recyclingDemandMet`, two-plus suites, `vipFavorable`, metro) but are scattered across the stats modal. Render one "To reach Nx" checklist section from those booleans, cloning the milestone-checklist renderer in `stats.ts`. Classic shows the checklist (information, not advice); Modern may add a cheapest-missing-gate hint. |
| 2026-07-15 | inspector-eval-reason | #400 | UI legibility | feature-request | P3 | — | — | in-progress | **Ready, cheap: attribution already exists. From `gdd-simtower-optimization-gaps-2026-07-15`.** The inspector shows a bare satisfaction percentage until a tenant is already on notice, when the diagnostics finally name the cause; the dominant `vacateCause` (congestion/transportFar/noise/rent/access) is attributed in `sim/satisfaction.ts`. Surface it as one plain-language "Main gripe" line before notice, turning a mystery number into an actionable lever. Relabel internal terms into plain language; Modern may also suggest the fix. |
| 2026-07-15 | housekeeping-coverage-overlay | #401 | UI legibility | feature-request | P3 | — | — | idea | **Ready: reuses the existing heatmap pipeline. From `gdd-simtower-optimization-gaps-2026-07-15`.** "Rooms to clean: N" names a problem but gives no geography, and there is no view of where service-elevator or housekeeping coverage reaches. Add a fourth heat-overlay mode tinting dirty rooms and shading floors outside service reach, reusing `floorHeatmap`/`drawStatsMap` (one new `HeatmapMode` case plus a legend entry). Gives the "build another housekeeping station" nudge a place to point. Mode-agnostic UI legibility. |
| 2026-07-15 | main-ts-split | #365 | refactor-large-files | task | P2 | med | — | open | **SECOND WAVE ONLY; the first main.ts split already shipped (the architecture party's extraction: buildActions, editorActions, saveLoad, inspector, keyboardPlay, later uiCallbacks/mealRush/gesture, all live in `src/game/`). From spec-refactor-large-files (Stage 4 remainder; CAP-2 unmet).** Even after that wave `src/main.ts` sits at 1,587 lines (verified on main 2026-07-15), ratchet-exempt, three times the 500-line review ceiling the spec was written to enforce. Split per `_bmad-output/specs/spec-refactor-large-files/split-plan.md` Stage 4 into the remaining `game/` collaborators (engineWiring, inputKeys, frameLoop, buildPreview, panelAnchoring, updateFlow, bootstrap), moves not rewrites, barrels stable, honoring the ratified laws (sim is a guest; narrow constructors; no event bus). Then delete the ratchet entry so the guard enforces the ceiling. Deferred when the lit-migration E1 prioritized the `createUICallbacks` seam over shrinking. |
| 2026-07-15 | render-perf-region-composition | #366 | render-perf | perf | P2 | med | — | in-progress | **ACTIVE INITIATIVE, recorded so the mirror stays complete: the render-perf effort is executing its spec story order** (CAP-1 zoom cull PR #296, CAP-3 deferred hour reconcile PR #297, picking via grid lookup PRs #301/#364 all shipped). Remaining core story: CAP-2 region composition per `_bmad-output/specs/spec-render-perf-mobile-zoom/region-design.md` (room actors collapse into shared region canvases with a budgeted upload drain), gated on the spec's pre-region gates (full-tower day/night visual baseline, one-region pixel-diff spike, texture-upload micro-bench with its verdict already in the memlog, blame-split probe). The optional drain-tuning story rides the same spec. Pixel-hash census (738 day / 1,302 night unique bitmaps) already falsified the shared-bake alternative; regions ruled unanimously (party 2026-07-15). |
| 2026-07-15 | onhour-amortization-consult | — | render-perf | design-decision | P2 | med | — | done | **Promoted from prose (the render-perf S1 defer section) to a row 2026-07-15.** `updateSatisfaction` and `collectTrafficIncome` scan the whole tower on the hour and are load-bearing for determinism and the golden master, so splitting their scans across frames needs a checkpoint-the-inputs design consult first (party verdict 2026-07-14: spec non-goal). Once CAP-2 removes the render share of the on-the-hour hitch, this becomes the residual hitch on big towers. Spec-first; do not attempt as a rider. **Resolved 2026-07-15 (#403, closing #367):** the consult ran (party 2026-07-14, `spec-onhour-boundary-cost`) and shipped the outcome-identical hourly noise-scan memo plus served-set hoists, cutting the owner-save median boundary tick about 36 percent (71 to 45ms) with the golden master unmoved. The determinism-breaking frame-splitting stays a non-goal; reopen #367 only if the Pixel 8a still hitches after on-device acceptance. |
| 2026-07-15 | toast-timer-prune-leak | #368 | UI polish | review-deferral | P3 | low | — | open | **Ready. From the spec-event-log-toast-freeze review (its memlog claimed this was backlogged; no entry existed, record made true 2026-07-15).** `toast()` in `src/ui/uiStatus.ts` arms a `setTimeout` per toast but nothing cancels it when the node is pruned early (rail cap overflow or DOM removal), so orphaned handles fire against removed nodes. Self-limiting and cosmetic-internal; fix by keeping the timer handle on the element and clearing on prune. |
| 2026-07-15 | test-file-splits-ratchet | #369 | refactor-large-files | task | P3 | low | — | open | **Ready, mechanical. From spec-refactor-large-files (CAP-6: the success criterion is an EMPTY allowlist).** Ten test files sit at 503-1,930 lines in `src/tests/fileSize.ratchet.txt`. Split by whole-describe-block moves with vitest count parity (`split-plan.md` Stage 5 method), then delete the ratchet file and its stale-entry check. Coverage-preserving, no product risk. |
| 2026-07-15 | editor-access-too-far-state | #370 | UI legibility | feature-request | P3 | — | — | idea | **From spec-stranded-floor-move-ins (Sally's deferred UI surface; the spec claimed it was backlogged, record made true 2026-07-15).** The editor panel's Elevator access line knows served/unserved but not the two-ride rule, so a structurally served but 3-rides-out floor reads fine in the editor while the inspector says no one travels here and the move-in gate refuses. Add a third state reading `sim.floorReachable`. The daily stranded nudge already covers the feedback gap, so this is legibility polish. |
| 2026-07-15 | traffic-soften-blend | #371 | traffic | design-decision | P3 | — | — | parked | **Gated: fires only if playtesting shows the straight-peak chip too twitchy on a single hot floor.** From spec-traffic-indicator-fix (benched by the numbers party: blend reserved as documented modern softening). Input seam is `updateTraffic` in `src/main.ts`. Record kept so the bench trigger is not lost; may never fire. |
| 2026-07-15 | traffic-chip-tap-to-hotspot | #372 | traffic | feature-request | P3 | — | — | idea | **Sally's IOU from the traffic party, scoped out of the fix PR on purpose (touches the camera).** The chip already names the worst floor (Backed up 42F); tapping it should fly the camera there. Touches the chip wiring in `src/main.ts` plus a small camera API on the render side. Navigation affordance, mode-agnostic. |
| 2026-07-15 | a11y-shaft-congestion-overlay | #373 | accessibility | feature-request | P3 | — | — | idea | **From gdd-accessibility-2026-07-01 (deferred to phase 2; the settings override in the GDD already promises to force this overlay on when it ships).** A congested-band hatch drawn on the shaft plus a small tier badge answers which shaft is choking without color reliance. Distinct from the `congestion-overlay` row (a perf memoization of `congestion()`), despite the similar name. Needs a small UX pass first. |
| 2026-07-15 | star-falling | #374 | Classic/Modern split | design-decision | P3 | — | — | parked | **PARKED epic, spec-first; row created 2026-07-15 because gdd-classic-modern-pricing-roadmap claims it exists.** Modern-only: star ratings can fall within bounds (grace window, only un-earned stars, never TOWER). Epic-sized, needs its own gdd-/arch- docs; the room's standing caution is that it opens the should-rating-fall can (evaluateStar only ratchets up today). Resurrect via a party, not a rider. |
| 2026-07-15 | post-tower-prestige | #375 | Classic/Modern split | design-decision | P3 | — | — | parked | **PARKED until player demand; row created 2026-07-15 because gdd-classic-modern-pricing-roadmap claims it exists.** A post-TOWER prestige progression for maxed towers. No design beyond the shortlist mention; record preserves the parking ruling and its resurrection condition (demand). |
| 2026-07-15 | hotel-sticky-states | #376 | SimTower parity | feature-request | P3 | — | — | idea | **Gated: needs art, a save field, and a small spec. Tier 2.5 of the pricing roadmap (own row promised, created 2026-07-15).** The 1994 game has an infested hotel state (TDT status flag bits 64/32 decode in our importer) and escalating dirty texture. CAVEAT recorded from tdt-hotel-status-fidelity: TDT byte 17 is NOT a persisted days-dirty counter, so the roadmap's save-field premise is partly stale; the gameplay feature (infestation state + escalation) is still unbuilt and this row owns it. |
| 2026-07-15 | pixelart-interior-animations | #377 | pixel-art | feature-request | P3 | — | — | idea | **From gdd-pixel-art-overhaul-2026-07-14 (deferred follow-up design pass; the GDD claimed it was tracked here, record made true 2026-07-15).** Subtle per-unit interior motion (desk fans, TV flicker, diners eating). Hard constraint from the bake architecture: only fire/construction redraw per frame today; any animated room must join the animated set deliberately or the texture cache churns. Design pass first, party-ratified. |
| 2026-07-15 | modal-aria-labelledby | — | accessibility | task | P3 | low | — | done | **DONE 2026-07-15 (issue #378 closes with the PR).** `UI.finishModal` (`src/ui/UI.ts`) now wraps the shared modal's top-level `.win-title` title contents in a span carrying a stable id and points `aria-labelledby` on `#modal` at that span (so the close button appended to the title bar never leaks into the accessible name), for the lit (`openModalTemplate`) mount path; `closeModal` clears the attribute so it never dangles while the dialog is closed/empty. Covered in `src/tests/integration/uiDialogs.integration.test.ts`. ORIGINAL: **Ready, one-line a11y win. Lit-migration deferred item (a) (design/ui-rendering-engine 30-epics-and-stories.md; promised to the backlog, record made true 2026-07-15).** The #modal dialog should reference its `.win-title` with `aria-labelledby` so screen readers announce which dialog opened. |
| 2026-07-15 | ui-update-decouple-mitigation | #379 | ui-rendering-engine | design-decision | P3 | — | — | parked | **Gated: fires only if the perf gate's profile B regresses. Lit-migration deferred item (c) (promised to the backlog, record made true 2026-07-15).** The structural mitigation decouples `ui.update` cadence from `engine.onUpdate` if lit template re-renders ever show up in the frame budget. Trigger recorded so it is not lost; no action while the perf gate stays green. |
| 2026-07-15 | hotel-twin-naming | #380 | SimTower parity | feature-request | P3 | — | — | idea | **Ready, cosmetic canon naming (tier 3 of the pricing roadmap; the only tier-3 item without a row until 2026-07-15).** The 1994 game calls our hotelDouble a Twin (TDT canon doc unit table; the Finance Window line reads Twin). Rename player-facing copy where canon (build palette, inspector, stats); the engine kind id stays hotelDouble (save compatibility). |
| 2026-07-15 | named-tenants | #381 | SimTower parity | feature-request | P3 | — | — | idea | **Idea awaiting a spec; three docs reference it as deferred (pricing roadmap tier 3, condo-departures GDD flourish, tdt-importer notes), row created 2026-07-15.** Named tenants let the importer's people records earn their bytes, feed the condo relocation flavor, and anchor the Modern shortlist item 3. Needs a spec: naming source, persistence cost, UI surfaces. |
| 2026-07-15 | fire-rebuild-in-place | #382 | gameplay-feel | feature-request | P3 | — | — | idea | **Ready, optional QoL from gdd-fire-aftermath-2026-07-01 (balance-neutral, ship later).** A gutted unit's inspector gains Rebuild in place: bulldoze + rebuild the same kind/subtype at the same footprint in one action, charging the normal build cost. No economy change; pure convenience after a fire. |
| 2026-07-15 | batch-pricing-v1.1 | #383 | pricing | design-decision | P3 | — | — | parked | **Gated on player demand; one grouped row preserving gdd-batch-pricing-2026-07-01's cut list and its revisit triggers.** Cut from v1: step/percent adjustment modes, cross-kind scopes, free-scope picker, Full Statistics entry point, floor-range selector, occupied/vacant filter, undo, income-delta preview. Multi-select was ruled never. v1 shipped and survived the lit re-platform with zero demand for any cut item so far. |
| 2026-07-15 | stairs-willingness-canon | #384 | SimTower parity | review-deferral | P3 | low | — | idea | **Gated: canon verification via the Wine harness. From gdd-simtower-parity-2026-07-06 (tracked as an open question that was tracked nowhere until 2026-07-15).** Sources conflict on how many cumulative floors a person will climb by stairs (4 vs 5). Verify in the real game and pin the constant; same species as walkway-variants and can ride the same harness session. |
| 2026-07-15 | mobile-e1d-e1e-stream | #385 | mobile distribution | task | P3 | low | — | open | **Found by the planning-artifact sweep 2026-07-15: the mobile-distribution epics' public-repo stream items E1d (docs/distribution.md + first release tag) and E1e (privacy-first analytics decision) have NO artifacts in this repo AND no tracking in the private repo's ledger (checked verticopolis-mobile the same day).** E1a/E1b/E1c shipped. Decide owner and repo for E1d/E1e and either execute or formally cut them in the epics doc; until then they are silently dropped scope. |
| 2026-07-15 | artifact-status-true-up | — | process | task | P3 | low | — | done | **DONE 2026-07-15 (docs-only sweep; issue #386 closes with the PR).** Trued up against git log and code presence: 7 of the 8 pixelart specs to done with verified boxes checked (people-system keeps two honest unchecked residuals: the amber impatient walker tier never shipped, and the queue render off the E6 seam is the separate E6-S7 story per the crowd/routing.ts comment); spec-pixelart-unit-states stays draft because the E7 verification sweep never ran as specified (only the amber-distinctness pin is verifiably delivered; state coverage landed piecemeal in the E2-E6 story tests and the E9 baseline review); save-latency to done (shipped in the PR #171 bundle, ae3e798); shard-screenshots boxes checked (PR shipped 54e0971 wave); five story files to done with merge evidence (PRs #173, #187, #194, #195/#196); pixel-8a investigation to Resolved (PRs #189/#191, #208); delivery lines appended to the refactor-large-files and traffic-indicator memlogs (refactor residual: 11 files still ratcheted); dated postscript on the event-log-toast-freeze stale transient-log non-goal (LOG_SAVE_CAP supersedes it). ORIGINAL: **Ready, docs-only. Found by the planning-artifact sweep 2026-07-15.** Stale statuses that misreport delivery: the 8 spec-pixelart-*.md read draft with unchecked tasks though E1-E9 shipped; spec-save-latency-mitigation reads in-progress with every box checked; spec-shard-screenshots-ci reads done with no boxes checked; five story files (save-metadata-and-log-tail, settings-modal, tower-wide-meal-cadence, view-state-save-parity, volume-settings) sit at review though merged; pixel-8a-fast-speed-crash-investigation reads Active though its follow-up shipped; the traffic and refactor memlogs end before delivery. One sweep, frontmatter only, no content rewrites. |
| 2026-07-15 | elevator-dispatch-balancing | #303 | gameplay-feel | review-deferral | P2 | med | — | open | **Recovered defer, recorded 2026-07-15 (it had lived only in session memory since the crowd/vehicle read-right review round, PR #285 era; the owner approved it then as its own PR).** `bfsRoute` picks deterministically among equivalent shafts, so identical trips funnel onto ONE shaft of a bank: that landing queue piles up while sibling shafts sit idle, and the drawn crowd makes the imbalance obvious. Balancing route choice across equivalent shafts changes sim behavior AND the rng stream (golden-master churn), so it ships alone in a quiet golden-master window. SEQUENCING LAW (people-tracking priority party 2026-07-15, unanimous after rebuttal): the elevator queue-view reconciliation (the `pixelart-elevator-queue-seam` defer in the inbox below) lands FIRST, so the queue panel trusts exactly one population before dispatch changes move `carLoad`; otherwise a dispatch regression and a display artifact are indistinguishable. Full ruling: "People-tracking priority ruling" section at the end of this file. SEQUENCING UPDATE 2026-07-15: the queue-view reconciliation precondition (E6-S7, GH #314) is DELIVERED on branch `claude/queue-view-reconcile` (`boarded` now reads the drawn `crowd.carRiders`), so this row is unblocked to ship in a quiet golden-master window; it stays open until the balancing fix itself lands. |
| 2026-07-13 | tdt-quirkAB-faithfulness | #317 | SimTower parity | feature-request | P3 | low | — | idea | **Gated: needs its own spec + party.** Owner asked (overriding the earlier party ruling that A/B are canonicalizations, not bugs) to make the round-trip FAITHFUL for the two TDT canonicalizations documented in `docs/canon/tdt-format.md` §14: (A) a plain floor on a sky-lobby story (15/30/45...) imports back as a lobby; (B) a vacant never-simulated built shop imports as occupied+subtype. Both are lossy at the TDT seam because the format can't represent the pre-canonical state. The RIGHT fix is engine-side, NOT touching parseTDT (Cloud's standing ruling): stop the engine from PRODUCING states the format can't hold, i.e. (A) a placement rule so a sky-lobby story can't carry bare floor tiles without a lobby, (B) assign a retail subtype at placement so a built shop is never subtype-less. This is a gameplay-adjacent engine change -> full gds-code-review + a Samus feel check; write a `gdd-`/spec first. Deferred from the 2026-07-13 tdt-fixes session (party: do not rush engine placement changes at a session tail). |
| 2026-07-13 | tdt-floor1213-skygap | #318 | SimTower parity | bug | P3 | low | — | open | **Gated: deep RE + harness iteration, unproven cause.** The real 1994 game renders a right-side SKY GAP on floors 12/13 when loading our export of the owner's wide "sixseven" tower; the export is verified data-complete 3 ways (all tiles, floor-header extents == records, room-tile-by-type all match the source vctower). Investigated 2026-07-13 (tdt-fixes session): the prime suspect, the zero-filled per-floor remap table (94 x u16, `tdtEncoder.ts` `w.pad(TDT_FLOOR_INDEX_ENTRIES*2)`), does NOT hold up: (1) decoded a native sample (`my_tower` floor 11: remap `[1,2,4,6,7,8,0...]` for 10 tenants) and the values point at a MIX of rooms and empty-floor tiles with no clean column/room mapping; semantics unclear without systematic multi-save RE; (2) more decisively, our zero-remap exports render MOSTLY correctly, so the game does not need the remap to render, making it a weak suspect for a specific two-floor right-side gap. Cause remains unexplained. Needs focused RE + Wine-harness iteration on the actual sixseven tower (the harness now works after the #225 run.sh fix; watch the winevdm crash flake on large towers). Own session, not a tail-end dive. |
| 2026-07-13 | tdt-hotel-status-fidelity | — | SimTower parity | review-deferral | P3 | low | — | resolved | **Investigated: hotel import is already FAITHFUL; "days-dirty at byte 17" is a doc myth (no code fix needed).** Checked the byte-17/days-dirty question that the byte-6 retail fix reopened, against game-written TOWER5 (338 hotels). Findings: (1) the flags byte (offset 5) fully encodes hotel state and is fully decoded by the importer: TOWER5's statuses are `1` (booked, guest out), `17/18/19` (asleep + 1/2/3 occupants), which import as 286 asleep (422 seeded occupants = 159x1+118x2+9x3, exact) + 52 booked->empty (honest couldNotBring note). infested(64)/dirty(32) branches exist and are tested. (2) **byte 17 is `0` for ALL 338 hotels** (and all game-written retail), so it is NOT hotel days-dirty; there is no persisted days-dirty counter in the unit record. SHIPPED: corrected `docs/canon/tdt-format.md` §4 (byte 17 is 0 for both retail and hotels, role unknown, no days-dirty), and added a `tdtImport.test.ts` case pinning TOWER5's exact status set. No engine/import behavior change. |
| 2026-07-13 | tdt-retail-variant-byte6 | — | SimTower parity | bug | P2 | med | — | resolved | **FIXED (v1.27.2, forked off #227). Retail variety is unit-record BYTE 6, not byte 17.** The importer/exporter keyed the shop/fastFood/restaurant variant off unit byte 17 (per an OpenSkyscraper/tower-docs note), but byte 17 is `0` in every game-written save, so ALL real-game retail imported as index 0 (Men's Clothing / English Pub / Japanese Soba) and our exports wrote the variant where the game ignores it. Confirmed 3 ways against `my_tower`/`mo`/`MYTSTFF` (game-written, identified by real finance headers): byte 6 = `3,1,2,4,0` (5 distinct fastFood), the Wine render shows a readable "BURGER" stand (byte6=2 = Hamburger Stand), and our import→export→import round-trip preserves the varieties. Fix: `tdtFormat.ts` reads byte 6 into `TdtTenant.variant`, `tdtParse.ts` maps it, `tdtEncoder.ts` writes it at byte 6 (byte 17 now 0); fixture + a byte-6-vs-byte-17 regression test guard it. FOLLOW-UP (own row): the §7 retail table's per-slot status/variant bytes do NOT match byte 6 (`my_tower` §7 variant column = `0,1,0,1,0`), so the §7 record layout past its floor byte is unresolved and our exporter's §7 variant write is likely wrong (harmless: the game reads the variant from byte 6, not §7). RE the §7 layout against a native save before trusting it. |
| 2026-07-13 | tdt-roundtrip-canonicalization | #319 | SimTower parity | review-deferral | P3 | low | — | open | **Ready (needs a working harness). Confirm on the live 1994 game that a sky-lobby story (floors 15/30/45...) carrying only plain floor tiles renders as a lobby**, which is what our importer canonicalizes it to (a plain floor at floor 30 exports byte-identically to a lobby there, so `parseTDT` reads it back as a lobby). Party 2026-07-13 (Boundary/Cloud/Grumbal/Samus/John) ruled this canonicalization, NOT a round-trip bug (documented in `docs/canon/tdt-format.md` §14; `.vctower` is lossless, TDT is the lossy interop, and the running game never produces bare floor tiles on a sky-lobby story). Grumbal's witness condition: capture a live render once the harness `winevdm` boot flake (row below) is worked around, to confirm the game agrees. A companion quirk (a freshly-placed never-simulated shop imports as occupied + subtype) is the same class and needs no live check (canon retail is always tenanted). Do NOT teach `parseTDT` to reconstruct the pre-canonical state. |
| 2026-07-13 | simtower-wine-harness | #320 | tooling | review-deferral | P3 | low | — | open | **Gated (Wine-internal, watch-only). The `tools/simtower` headless load intermittently pops a `winevdm.exe` "serious problem" crash dialog** that parks over the tower and can spoil a screenshot. Reproduced on a GENUINE native save (`SIMTOWER/TOWER5.TDT`), so it is a 16-bit Wine-subsystem flake, NOT our export. FIXED THIS SESSION (separate, real harness bugs): `run.sh` now forwards the `SCREEN`/`MAXIMIZE`/`ZOOM_CLICKS`/`CLICK_SECS`/`SHOT_DELAY`/`SHOT_OUT` env hooks and no longer mounts the host X socket into the headless modes (that mount made the container Xvfb fail to bind, so shots fell back to a blank 1024x768 frame); the image must be rebuilt after `entrypoint.sh` edits (README noted). The residual `winevdm` crash is Wine-internal; mitigations if revisited: gentler dialog-dismiss (avoid the WineDbg and the aggressive MAXIMIZE title-bar clicks), a retry-on-crash loop, or pinning a known-good Wine version in the image. |
| 2026-07-13 | context-loss-recovery | #321 | stability | review-deferral | P3 | low | — | open | **Game input stays live on a dead renderer during the in-place recovery wait** (gds-code-review, Edge Case Hunter). Between a context loss and the restore (up to ~8s of visible time, longer while backgrounded) the canvas is frozen but keyboard shortcuts, the palette, Load/New/Import and the speed buttons all still work, so a player can mutate the sim blind. The crash-screen path mutes game keys via `CRASH_SCREEN_ID`; the recovery wait has no equivalent guard. Mitigations already shipped: the "Recovering..." toast, gesture-state reset in `rebuildEngine`, and the tower-swap guard on the success bulletin. If revisited, add a lightweight input gate (like the crash screen's key mute) for the wait window. |
| 2026-07-13 | context-loss-recovery | #322 | stability | review-deferral | P3 | low | — | open | **Excalibur 0.32 leaks three window keyboard listeners per engine teardown** (gds-code-review, Edge Case Hunter). `Keyboard.init` adds raw `keydown`/`keyup`/`blur` window listeners that `Engine.dispose()` only flags off (`toggleEnabled(false)`), never detaches; each in-place recovery therefore strands three small listeners retaining the dead Keyboard object. Bounded and tiny (recoveries are rare), and the big retention paths (texture-GC idle loop, browser-component visibilitychange) are already cut in `TowerEngine.dispose()`. Revisit if Excalibur ships a fix or if recoveries ever become frequent. |
| 2026-07-10 | hotel-rating-cutoff-4star | — | SimTower parity | review-deferral | P3 | low | — | resolved | **RESOLVED 2026-07-10 (v1.18.1).** Shipped: hotels/suites count toward the star-rating population up to 4★, excluded at 4★+ (so 5★/TOWER need non-hotel residents); flipped `ratingPopulation()`/`hotelsCountTowardRating()` `star<3`->`star<4`. FORMERLY-DEFERRED CORNER NOW FIXED: `evaluateStar()` previously read one `ratingPopulation()` off the CURRENT star, so a 3★ tower clearing the 4★ AND 5★ population bars in a single tick counted hotel guests toward the 10k 5★ bar. Fixed by recomputing the census per star-rung being TESTED: `evaluateStar` now tests the 5★ rung against the non-hotel occupant census (`occupantPopulation()`) and lower rungs against the hotel-inclusive `totalPopulation()`, so no single tick can leap 3★->5★ on hotel guests. Guarded by `faqComplete.test.ts` "a 3★ tower can't leap to 5★ on hotel guests in one evaluateStar tick". `ratingPopulation()` keeps keying off the current star for the DISPLAY/HUD read only. MERGE-REVIEW UPDATE 2026-07-10 (gds-code-review after merging main): patched the digit-level copy/comment drift the flip left behind: stats-modal footnote said "from 5★ on, only permanent residents count" (contradicted the engine's exclude-at-4★ and mislabeled office workers as residents) -> now "count until you reach 4★; after that, only office and condo occupants do"; `facilities.ts` STAR_THRESHOLDS doc "Above 4★" -> "From 4★ up" (excluded AT 4★, not above); stale "stop counting at 3 stars" comments in `Tower.ts`/`Crowd.ts`/`personCensus.test.ts` bumped to 4★. Still DEFERRED (Sally, UX): "Counts toward next star"/"Counts toward stars" label drift across inspector + stats modal; standardize on "Counts toward stars" if the area is next touched. RESOLVED 2026-07-10 (same session): standardized the inspector's positive line to "Counts toward stars: yes." so the inspector and stats modal now share one label. No open deferrals remain for this change. |
| 2026-07-09 | per-person-meal-round-trips | #304 | SimTower parity | feature-request | P2 | med | — | partial | **CORE SHIPPED, row refreshed 2026-07-15 (severity re-graded high to med: only the hotel gate remains).** Real per-person round trips exist: people carry `mealVenueId`, dwell at the venue (`dwellSecondsLeft`), and RETURN (`returning` leg), and the visible occupancy dips honestly while a worker is out (`visibleOccupants()`, the `outForMeal` overlay; the raw `u.occupants` field stays untouched on purpose, so census and star math never see the dip). The owner insight of 2026-07-09 that killed the aggregate shell game is delivered, and the paired [[population-census-parity]] resolved earlier (v1.18.3). REMAINING SCOPE (the only open half): the hotel `spawnFloors` gate. `hotelFloors` is gated on `isTenanted(u)` or `u.state === "asleep"`, and hotel rooms are `dirty`/`empty` through 11:00-16:00, so hotels contribute ZERO lunch trips and few dinner trips even though `MEAL_MIX` declares them for those windows (the in-code note at the `src/engine/crowd/spawn.ts` hotel case documents this). Broaden the gate so mealtime hotel origins exist; keep the floor-first sampling idiom aligned with hotel-mingle (see the venue-people-routing defers). People-tracking priority party 2026-07-15: ranked 10 of 17, after the attendance-integrity guards. |
| 2026-07-08 | lunch-office-food-trips | — | SimTower parity | feature-request | P2 | med | — | done | **CLOSED 2026-07-15 (delivered by later work).** Delivered in two stages: the tower-wide meal cadence (v1.16.0) added the aggregate office->food->office flow at lunch and dinner (the windows `MEAL_MIX` declares office origins for; breakfast rides hotel/condo/staff origins and late-night rides hotel/condo, with weighted origins and return lag throughout), and the per-person round-trip work made it individual (the same worker leaves the office, eats at the venue via `mealVenueId` + dwell, and returns). Nothing of the original ask remains unbuilt; the surviving hotel-gate remainder is tracked on [[per-person-meal-round-trips]]. |
| 2026-07-08 | tdt-exporter | — | GDD gdd-tdt-export-2026-07-08 | feature-request | P2 | — | — | shipped-v1 | **v1 shipped (v1.11.0): `src/storage/tdtExport.ts` writes a complete `.TDT` from a serialized Classic tower, inverting the importer's shared tables (kind IDs, part stacks bottom-up, rent classes, hotel status flags, floors ours+9, money ÷100, clock via frameForMinuteOfDay); multi-story units split back into per-floor parts (the cathedral stacks down from the crown, taking only free floors); stacked walkways collapse into 1994's 2/3-story stair types; the reverse fidelity modal shows facts + comes-along/stays-behind before any download; Modern towers are refused with a typed LegacyExportError. Tests pin export→import round-trip room/transport equality, byte-identical re-export stability, and ZERO importer warnings on our own output.** DEFERRED: people records, finance history, retail subtypes and elevator schedule blocks are written as zero/empty defaults (mirrors the importer's deferrals); theatre SCREEN parts (34/35) are not emitted (our model has one full-width cinema; inventing the hall/screen split would be a guess, flag if the real game renders a screenless theatre oddly); the undocumented header region is zero-filled. Review round (bmad 3-layer, 2026-07-08): 13 patched (story-aware cathedral collision, vacating/moving-in and fire/gutted states, vacancy-history and truncation honesty lines, ramp-chained parking count, DOS device names, cars/skipFloors/floor-range/money hardening, per-floor tenant cap refusal, shared ELEVATOR_KINDS + transportCarCapacity). NEW DEFERRAL: legacy width-4 walkway pairs can overlap on RE-IMPORT when catalog width 8 applies (the format carries no width; the import-side dropped-flights line is the only surface today; add an export-side line if legacy-width saves prove common). FOLLOW-UP: validate an exported file in the real game (owner has the CD; DOSBox-X/86Box/v86 plan in the GDD §7), this also closes the importer's fixture-circularity limitation; game binaries and real save bytes never enter the repo. |
| 2026-07-07 | tdt-importer | — | OpenSkyscraper docs | feature-request | P2 | — | — | shipped-v1 | **v1 shipped (PR 3, v1.10.0), then realigned to the canon doc v2 (dfloer/tower-docs facts): `src/storage/tdtFormat.ts` walks header (floor map at 560), floor map, people, retail, ELEVATOR table (24 × 194-byte headers + skippable live-state payloads), finance/parking blocks, and the stairs table; `src/storage/tdtImport.ts` merges multi-story parts (theatre 18/19/34/35, recycling 20/21, party hall 29/30, metro 31/32/33, cathedral 36–40; 44 = parkade ramp, 45 = tunnel scenery), decodes rent classes onto our price bands, hotel status flags onto dirty/asleep states, and imports the save's own transports (per-floor stop settings included) with the deterministic synthesis kept as the tolerant-tail FALLBACK; the fidelity report names which path ran.** Still DEFERRED: named-tenant import, finance-block import (finance-1010 row), elevator schedule blocks (per-day-type car scheduling has no engine equivalent), and 2/3-story walkway canon verification (format supports them; the game may never create them). Layout notes: the 18-byte unit record's reserved bytes 6–15 are unparsed; the hotel days-dirty byte (17) is parsed but deliberately unapplied (the engine has no dirty-days counter; revisit with the auto-demolish rule if ever wanted); the elevator per-floor payload count is derived from the serviced-floors map (a misfit downgrades to the synthesis fallback, never a failure). |
| 2026-07-12 | tdt-real-game-fidelity | #300 | SimTower parity | review-deferral | P2 | — | — | open | **Real-game round-trip validated 2026-07-12** against `.TDT` saves the actual 1994 SimTower wrote (`my_tower`/`mo`/`TSTSAVE`, identified by nonzero finance header fields 0x08/0x0C/0x10 vs our zero-fill). Method (`tools/simtower/`): import each real save -> re-export -> byte-diff vs the original game bytes. **PERFECT:** floor-map geometry + facility TYPE encoding round-trip with **ZERO diffs** on every real save (positions, multi-story parts, kind IDs all match the game); header semantic counts (lobbyHeight/recycling/commercial/security/parking/hallCinema) all match. CONFIRMED GAPS (real game vs ours): **(1) rent class 4 "No Rate" collapses to 2 "Average"**, every rent-byte diff was a No-Rate unit; `rentFromClass` maps 4->undefined->default and the engine has no No-Rate state. Belongs to [[pricing-split]] (already lists a "No Rate" state; spec `gdd-classic-modern-pricing-roadmap-2026-07-08` §1-2). **(2) finance header fields not exported**, real game populates `lastQuarterMoney` (0x10; observed 16110/20000/8795); we zero 0x08/0x0C/0x10. Belongs to [[finance-1010]] (derive from `Ledger` on export; `lastQuarterMoney` needs a quarter-boundary money snapshot). (3) hotel/occupancy STATUS bytes + retail subtype/hotel days-dirty differ (already-documented lossy import). (4) real game emits the ground lobby as a type-24 unit record + sky lobbies + explicit empty-floor (type 0) records; we used to express both as paving extents only. **SHIPPED 2026-07-13:** gap (1)+(2) via **PR #200** (No-Rate rent class 4 round-trips + `lastQuarterMoney`/finance-header export; v1.26.0); gap (4) via **PR #204** (lobby type-24 + empty-floor type-0 span records; v1.25.1) after the "benign" call proved WRONG (exported towers rendered with the city backdrop bleeding through every missing lobby). Remaining OPEN: (3) hotel/occupancy status bytes + retail subtype/days-dirty (documented lossy import), and the NEW elevator built-payload finding (see the `tdt-elevator-many-shafts` row). |
| 2026-07-13 | tdt-elevator-many-shafts | — | SimTower parity | bug | P2 | high | — | resolved | **FIXED 2026-07-13 (v1.26.4).** ROOT CAUSE (harness-confirmed against the real 1994 game): the built-shaft payload was sized `3140 + serviced*324 + cars*348`, but the appended 348-byte car block is **cars-INDEPENDENT** (one per shaft, not one per car). The `* cars` was only ever validated on 1-car saves (my_tower and every native reference save we have is cars=1), so it silently over-sized every multi-car shaft. On the owner's "six seven" (shafts up to 8 cars) the retail game desynced the whole elevator table after the first multi-car shaft: ONLY ONE ELEVATOR RENDERED, and the parking/basement block after the table mis-read too (the "missing basement" symptom). FIX: `tdtExport.ts` + `tdtFormat.ts` (parser skip) + `tdtBuilder` fixture now write `3140 + serviced*324 + 348` (car count still truthful in the header). PROVEN: forcing the fixed size in a hand-edited six-seven export made all shafts render in Wine; a clean re-export renders all 11 (old tower) / 15 (sixseven_3) shafts down to B1. Canon doc corrected (docs/canon/tdt-format.md). NOTE: a separate residual is a floors-12/13 right-side sky gap in the real-game render that the export data does NOT explain (verified data-complete 3 ways: all tiles, floor header extents == records, and room-tile-by-type all match the source vctower, basement included); candidate is the zero-filled per-floor index/remap table (tdtExport.ts:647), but that has always been zero and my_tower renders fully, so it is unproven - own follow-up if it reproduces on a clean export. Original investigation notes: byte diff cross-checked against TS parseTdtBinary (agree exactly); overlap theory refuted (0 collisions); my_tower's 3 spread shafts always rendered. DEFERS from the 2026-07-13 gds-code-review (both adversarial layers): (a) rename `TDT_ELEVATOR_PER_CAR_SIZE` -> `TDT_ELEVATOR_CAR_BLOCK_SIZE` (name says 'per car' but the block is once-per-shaft, inviting a future `* cars` revert); mitigated by a clarifying doc-comment at the definition AND a new guard test (`tdtExport.test.ts` 'built-shaft payload size is car-count INDEPENDENT') that fails on any revert - so the rename is cosmetic follow-up. (b) `tools/simtower/docker/entrypoint.sh` MAXIMIZE/ZOOM_CLICKS click coords are hardcoded to the default window and do NOT scale with a wide `SCREEN` (SCREEN is validated to WxH and the coords are hardcoded to the default window, both harmless for an opt-in diagnostic). |
| 2026-07-08 | modern-economy-gating | — | Classic/Modern split | feature-request | P1 | — | — | done | **Shipped in PR #164 (v1.11.2).** Gated all three sinks behind Modern via new `GameRules` methods `operatingOverheadPerUnit()`/`condoHoldTaxRate()`/`noiseErosionScale()` (Classic returns 0/0/0; Modern returns the tuned values). `EconomySystem` reads overhead + condo tax through the rules object; `Simulation` scales noise erosion by `noiseErosionScale()` while keeping W1 transport-far erosion active in all towers. Fixed `project-context.md` stale "office noise does not evict" line. Added `modernEconomy.test.ts` (Classic monthly drain $0 and office-noise caps-at-0.6-never-evicts; Modern drains exactly `2*overhead + ceil(condo*taxRate)` and erodes below 0.4). New-game and Help copy updated to describe Modern's deeper economy. Original ready-note (for reference): tier-1, nearly free; three non-canon economy mechanics applied to ALL towers, breaking Classic's pixel-faithful promise: `overheadPerLeasableUnitMonthly` ($700/unit, EconomySystem.ts:430), `condoMonthlyTaxRate` (1.5%, EconomySystem.ts:421), and office-noise EROSION that evicts (gdd-tenant-churn F-8; canon is cap-at-0.6-never-evict). Gate all three behind Modern via new `GameRules` methods (`operatingOverhead()`/`condoHoldTax()`/`noiseErosionRate()`) returning 0/neutral for Classic. Old Classic saves load cheaper+gentler (non-breaking; add a golden Classic fixture confirming no first-load move-out wave). MUST also fix `project-context.md:46` (stale "office noise does not evict"). Noise-eviction removal needs its OWN test (Classic reverts to cap-only, not just a constant flip). Patch bump (Classic balance change). Party-ratified 2026-07-08 (Samus/Cloud/economy). |
| 2026-07-08 | pricing-split | #299 | Classic/Modern split | feature-request | P1 | — | — | idea | **Gated: tier-1, needs the small spec's editor-UX detail. Spec: gdd-classic-modern-pricing-roadmap-2026-07-08.md §1-2.** Classic uses the original's discrete 4-level rent dropdown (VeryLow/Low/Average/High) + a "No Rate" state; Modern keeps the continuous ranges. Add `GameRules.priceOptions(kind)` returning a discrete ladder (Classic) or the continuous band (Modern); editor renders dropdown vs stepper off the shape; `Unit.rent` stays a raw number so the ratio economy is untouched. Canon rungs (§2, user call 2026-07-08, Classic uses FULL canon values): office `2k/5k/10k/15k` (quarterly); condo `50k/100k/150k/200k` (one-time) and MAY sell below build cost (Modern keeps the 80k floor); hotel single/double/suite (nightly) `500/1500/2000/3000`, `800/2000/3000/4500`, `1500/4000/6000/9000`. Note hotel is ~10× our current rates: accepted because Classic goes pure (money trivializes late, faithfully) and stars gate on population not income; Modern keeps our tuned ranges. Comment each rung table with source (rent-class STRUCTURE from TDT docs; dollar tables from Relentless Optimizer, single-source, archive.org manual unverified). Flag a Classic playthrough sanity pass. Minor bump. 2026-07-15: the gating editor-UX detail spec now exists at `_bmad-output/planning-artifacts/design/ux-pricing-split-editor-2026-07-15.md` (rung picker + chip, No Rate legibility across editor/inspector/stats, snap-on-load bulletin copy, Classic batch dialog, and the folded-in #370 editor access third state). |
| 2026-07-08 | elevator-scheduling | #305 | Classic parity | feature-request | P2 | — | — | idea | **Gated: tier-2, spec-first (epic). Spec seed: gdd-classic-modern-pricing-roadmap-2026-07-08 §4 + §7.** OWNER TIEBREAK 2026-07-08: **FULL PARITY.** 1994 shipped elevator per-day-type car scheduling (the per-shaft schedule block in the TDT elevator record, `docs/canon/tdt-format.md`); this was previously listed under "do NOT build" and is now a confirmed Classic parity gap. Build the scheduling **behavior AND its UI** to match 1994, and round-trip the TDT schedule bytes on import/export (`tdtImport.ts`/`tdtExport.ts` currently zero/skip them). Epic-sized: needs its own `gdd-`/`arch-` docs before any build (the per-shaft per-day-type schedule model, the editor UI, and how a user schedule interacts with our automatic SCAN dispatch). The 3-day-week/12-day-calendar item stays ratified-out (never part of this conflict). Supersedes the earlier "do NOT build" ruling on this item. |
| 2026-07-07 | walkway-variants | #323 | OpenSkyscraper docs | review-deferral | P3 | — | — | open | **Gated: canon question, verify before touching the engine.** The TDT stairs table's type field supports 2- and 3-story stairs/escalators (`docs/canon/tdt-format.md` §8), but neither source says the shipped game ever creates them; our canon (CLAUDE.md) holds walkways to fixed two-floor flights. Party verdict (2026-07-07): format allowance ≠ game behavior, so HOLD; verify against the real game (play/screenshots) before any `maxSpanFor` change. |
| 2026-07-07 | service-capacity-10 | — | OpenSkyscraper docs | feature-request | P1 | — | — | done | **Implemented, targets v1.9.5.** `TRANSPORT_CAPACITY.elevatorService` 16 → **10** per the decoded capacity byte in dfloer's spec (42/21/10; the 42 and 21 match our already-sourced numbers; our 16 was uncited). Value flows through dispatch/congestion/stats via `transportCarCapacity()` (no test hard-coded 16); added a `canon.test.ts` tripwire pinning all three car capacities. Release note: "canon fix: service elevators carry 10, as in 1994." |
| 2026-07-07 | variable-pacing | — | OpenSkyscraper docs | feature-request | P2 | — | — | done | **Shipped 2026-07-07 (v1.9.4)**: wired per the party verdict below. Wire the 1994 "breathing clock" into the main loop: `accMinutes` × `paceFactor(minuteOfDay)` at `main.ts` (~:794). The factors are normalized so a day's TOTAL real time is unchanged (a harmonic invariant: ∫1/pace = 1440; the plain average of the factors is deliberately not 1, so never renormalize by the arithmetic mean). Presentation-only; sim stays a uniform 1440-min day. Party verdict (Samus/Cloud/Sally 2026-07-07, user-ratified): **ungated, all towers** (same species as the ×2 speed button; never serialized or mode-gated) + a device-level Preferences "Steady clock (disables the 1994 rhythm)" escape hatch. UX: no HUD gauges; one Help bullet + a noon "Lunch rush!" bulletin line. **Patch** bump. |
| 2026-07-07 | retail-subtypes | — | OpenSkyscraper docs | feature-request | P3 | — | — | shipped-v1 | **SHIPPED v1.17.0** per `spec-retail-subtypes-and-variety.md`. `Unit.subtype?: string` on shop / fastFood / restaurant, rolled from `sim.rng` at `Simulation.build` with a short-circuit BEFORE the RNG draw for non-retail kinds (byte-identical Classic stream when no retail is built). `Simulation.rerollSubtype(id)` powers the inspector's "Change variety" action, picking a canon name different from the current. TDT import adopts the variant byte from unit-record byte 17 (§4, stronger evidence than §7) via whitelist coerce; TDT export writes both the unit-record byte AND the §7 retail-table slot per emitted retail unit. Optional-field save seam like `filmPolicy` (no SAVE_VERSION bump); legacy retail loads generic (no re-roll). Inspector + editor titles read the subtype name. Guarded by `src/tests/canon.test.ts` (§7 order pin), `src/tests/simulation.test.ts` "Retail subtypes" block (build determinism, byte-identical Classic RNG, reroll off-current, cosmetic-only economy invariance), `src/tests/tdtImport.test.ts` retail-subtypes describe, and `src/tests/tdtExport.test.ts` round-trip. Followed by `facility-visual-variety` and `commercial-venue-inspector` (both open, in the Deferral inbox as PR-B; both read `Unit.subtype` on retail). |
| 2026-07-07 | finance-1010 | #324 | OpenSkyscraper docs | feature-request | P3 | — | — | idea | **Owner-requested 2026-07-08 (saw the real game's Finance Window and wants an equivalent in our UI): a two-column Total Income / Total Maintenance sheet with a Population + Income column per facility line and a Maintenance Expense column, plus Net Revenues / Other Income / Construction Costs / Last Quarter's Balance / Total Balance rows, hiding zero lines ("Items with no income or expenses are not displayed"). This validates §9's layout AND the per-line population semantics (see [[population-census-parity]]: the real window shows Fast Food population 175, Office 48, Condo 45). Ready: S–M.** Align the income report with the original's finance taxonomy (`docs/canon/tdt-format.md` §9): 10 income + 10 maintenance categories. Extend `LedgerCat` additively (hotel single/double/suite split; parking/metro/service maintenance lines; `Ledger.restore`'s `sanitizeDay` drops unknown keys so no version bump), rework `buildIncomeHtml` as a two-ledger Income \| Maintenance layout keeping our net-summary line; dim zero rows; stacks on phone. Patch bump if lines change. |
| 2026-07-07 | secom-exe-ideas | #325 | OpenSkyscraper docs | feature-request | P3 | — | — | idea | **Gated: Modern-only, needs a spec.** SECOM (TDT tenant ID 17, a cut 1994 feature) as a Modern-mode security contractor alternative, never Classic (cut content isn't canon). Also parked: user-supplied-`SIMTOWER.EXE` asset-extraction spike (NE-resource docs in `docs/canon/tdt-format.md` provenance repo; we can never ship extracted assets); revisit only after the importer + pacing land. |
| 2026-07-07 | authenticity-checklist | #326 | OpenSkyscraper docs | review-deferral | P3 | low (cosmetic) | — | open | **Ready: process artifact.** Turn the ~10 original-game screenshots in OpenSkyscraper `doc/simtower/` into a renderer-authenticity checklist for review sessions (underground palette, elevator shaft/car rendering, lobby dressing, hotel room states), incl. the insight that the original's day/night is a **palette swap** (resource 0xFF03): our dusk/dawn should read as a global tint ramp, not per-sprite lighting. |
| 2026-07-07 | deserialize-coercion | #306 | — | review-deferral | P2 | med | — | open | **Ready.** `Simulation.deserialize` assigns `sim.star = data.star`, `sim.money = data.money`, and `sim.clock = new Clock(data.minutes)` (~:2041–2043) **raw**: the numeric `data.*` reads there that skip the finite/range coercion every other field gets (same class as the towerName/builtWeddingHall row below; `Clock`'s constructor doesn't harden either). A forged `star: NaN`/`money: Infinity`/`minutes: NaN` flows into rating gates, the ledger, and every `clock.minutes` consumer (completeAt/vacate timers, the lunch bulletin, etc.). Coerce star to an integer 1–6, money to a finite number, and minutes to a finite number on load. (The lunch-bulletin symptom of the `minutes` case is already guarded locally in `emitLunchRush`; this row is the source fix. Found by the dev/architect pass over the importer seam + Copilot on PR #154, 2026-07-07; pre-existing, independent of the importer work.) |
| 2026-07-07 | e1c-migration | #327 | SimTower parity | review-deferral | P3 | low | — | open | **Ready, quality, not correctness.** The v1→v2 reflow safety net (`saveMigration.ts` `upgradeV1toV2`) is tower-WIDE all-or-nothing: if `migrationLooksValid` rejects the reflow (one overflowing/degenerate floor), the WHOLE tower reverts to legacy widths, clean floors don't canon-ize either. It's always *safe* (no corruption, the Edge Case Hunter confirmed no overlap/off-lot ever reaches the player), just coarse, and the fallback is *silent*. Enhancement: fall back **per-floor** (reflow the clean floors, keep legacy only on the offending one) and log a `migrationNotes`/telemetry line when a fallback fires so a no-op load is diagnosable. Also (Acceptance Auditor F4): re-pave doesn't enforce "a floor may not be wider than the floor below", harmless on real saves, add a clamp if a pathological save ever trips it. (Edge Case Hunter + Acceptance Auditor, E1c review.) **ADDED 2026-07-13 (express-parity party):** ALSO fold in a single general "N elevator shaft(s) widened to their 1994 footprint" load note covering ALL `widenLegacyElevatorShafts` moves (standard 3->4 AND express 4->6). The widen migration has always been SILENT; an express-only note was cut from `spec-express-elevator-parity.md` as inconsistent favoritism. Do this ONCE for every widen when the transparency channel (migrationNotes -> bulletin) is built, not per-kind. |
| 2026-07-07 | e1b-widths | #328 | SimTower parity | review-deferral | P3 | low | — | open | **Ready, arguably-correct, watch-only.** After E1b widened stairs/escalator 4→8, an OLD-save 4-wide walkway run can't be *continued* with a new 8-wide flight in the same column: the stacked-flight landing-share exemption (`Tower.ts:541-548`) requires `t.width === f.width`, so the mixed-width overlap is rejected as "shafts cannot overlap." Only affects extending a pre-E1b stair/escalator run; mixed-width shafts arguably *shouldn't* merge, so this may be correct-as-is. If it reads as a bug, allow the landing-share when the columns align regardless of width, or bulldoze+rebuild the run. (Edge Case Hunter, E1b review, Finding 2.) |
| 2026-07-07 | w3-basement-depth | #329 | SimTower parity | review-deferral | P3 | low | — | open | **Ready, likely by-design, watch-only.** W3 (`nearestLobbyFloorDistance`) anchors only on ground (floor 1), so a deep-basement commercial venue (B3 = floor −2 and below) sits >2 floors from a lobby and takes the permanent ×0.5 traffic penalty, and, because a lobby can never be placed in a basement (`isLobbyFloor` = floor 1 or ×15 only), it can **never** be restored, unlike an above-ground shop a sky lobby can rescue. Matches canon (deep-basement retail is genuinely far from the concourse) so shipping as-is, but if it reads as unfair, consider treating an operational **metro** floor as a W3 anchor (the canon underground entrance draws visitors), or clamp basement distance to the ground. (Edge Case Hunter, E2 review, Finding 3.) |
| 2026-07-07 | w3-push-signal | #330 | SimTower parity | review-deferral | P3 | low | — | open | **Ready, legibility polish.** W1/W2 redden the stats overlay and raise an on-notice ribbon; W3 only halves income and writes an inspector line, so a player who plops commercial on the lobby-dead floors (4–12, 18–27, …) silently loses half their trade (and ~0.25× in rain, since `lobbyMult` composes with `rainMult`) unless they hover each unit. Give W3 an at-a-glance pull cue consistent with the satisfaction penalties, a stats-overlay tint on far commercial, or fold into the existing underperforming-venue signal. (Game Designer + UX, E2 review.) |
| 2026-07-07 | w1w2-post-migration-wave | #331 | SimTower parity | review-deferral | P3 | low | — | open | **Ready, feel, not correctness.** After a v1→v2 reflow re-lays a returning player's wide tower on the 375 lot, a cohort of offices can cross the 79-tile (W1) / 11–21-tile (W2) lines and begin eroding together, a batched-but-large notice a day or two after load on a tower that "was fine." The erosion is gradual and telegraphed (one batched toast, 2-day notice, recoverable), so it's not a contract violation, but it can read as the game breaking a working tower. Consider a short post-migration grace (suppress W1/W2 erosion for the first in-game day after a v1 load) or a one-time explanatory toast ("Canon spacing rules now apply, check flagged units"). At minimum, confirm the golden `towerone_6` fixture doesn't dump a mass notice on first load. (Game Designer, E2 review, Finding 3.) |
| 2026-07-07 | parking-ramp-connectivity | #307 | SimTower parity | feature-request | P2 | — | — | idea | **Gated, own story + own SAVE_VERSION bump; do NOT fold into the segment-parity initiative.** Full 1994 ramp parity: first ramp under the lobby, ramps vertically stacked, a space works only if its ramp column connects up to the lobby, replaces the per-ramp independent-seed model in `functionalParkingSet` (`Tower.ts:971`). Party verdict (Cloud Dragonborn/Samus Shepard/Link Freeman, 2026-07-07): **defer.** Deciding factor: it's a spatial-regime change that re-evaluates on load, and W1 (transport-too-far) already is one, shipping both in one migration makes the change unattributable to the player. **Must-haves if built:** (1) migration **heals not harms**, build the missing ramp column up to the lobby so no existing tower loads with newly-dead parking ("heal or don't touch it"); (2) exactly **one** spatial-regime change per load, never combine with the W1/W2/W3 rollout; (3) **telegraph the repair loudly** (one honest toast, never a silent mutation); (4) **no split-brain** legacy-seed flag in `functionalParkingSet`, connectivity applies to all towers once shipped, which is *why* the healing migration is mandatory. Design merits are sound (more faithful, more strategic depth); this is purely a sequencing/legibility deferral. |
| 2026-07-06 | event-log-persistence | — | — | feature-request | P3 | — | — | done | **DONE (trued up 2026-07-15 during the spec-parity pass): the requested persistence shipped via story-save-metadata-and-log-tail (the serialized log tail, `LOG_SAVE_CAP`, with a save round-trip test), later raised 100 to 300 by the log-cap party. Issue #332 closed as completed. The spec-event-log-toast-freeze non-goal text predates this and reads stale; covered by [[artifact-status-true-up]].** Original ask (now delivered): **needs a spec (save-size tradeoff).** The event log is transient (not serialized), so a manual refresh, a PWA update, OR the game's own auto-reloads (GPU-context-loss recovery, "Update now") blank it, scrollback history vanishes often. If a durable, scrollable history is wanted, serialize a **bounded tail** (~50 entries) and harden it on load like every other `data.*`. Real value (the game reloads itself a lot) vs real cost (per-write save weight + untrusted-load hardening). Party-mode (game/UX/architect, 2026-07-06) split this out from the scrollable-panel work as its own ticket. |
| 2026-07-06 | crane-fix | #333 | — | review-deferral | P3 | low (cosmetic) | — | open | **Ready.** Crane can sit a story low over a multi-floor top unit (pre-existing). `Tower.highestFloor` returns max *base* floor and ignores multi-floor extents, so a top row formed only by the upper story of a 2-floor unit based at `hi−1` yields `highestFloor=hi−1`; the crane perches a story below the visual roof. More visible than the edge-overhang case below, do this one first when the crane/render code is open. Fix: derive the crane's floor from the true topmost occupied row (`u.floor + facilityFloors(u.kind) − 1`). (Edge Case Hunter, floating-crane fix.) |
| 2026-07-06 | crane-fix | #334 | — | review-deferral | P3 | low (cosmetic) | — | open | **Ready.** Narrow top-run at a tower edge can overhang the crane body past the lot. `syncCrane` anchors the mast over the widest run's center, but `CRANE_W=128px` (~11.6 tiles) with the mast near center means a run narrower than the crane flush to `x=0`/`x=GRID.width` hangs the jib over open sky. Rare (needs a <~12-tile top block flush to an edge). Bundle with the crane fix above. Clamping the body would pull the mast off the run it aligns to, only clamp `pos.x` when the run is near an edge. (gds-code-review, floating-crane fix.) |
| 2026-07-07 | pwa-notes-sanitizer-coverage | #335 | — | review-deferral | P3 | low | — | open | **Gated, needs a small source extraction.** `src/pwa.ts` is excluded from vitest coverage as un-unit-testable SW plumbing, but its `fetchUpdateInfo` contains pure, security-relevant logic (filters update `notes` to strings, trims, drops empties, clamps each to 200 chars, caps at 3, type-guards `version`/`sha`) that bounds malformed/hostile update payloads before the modal renders them. That sanitizer currently has no unit coverage and is masked by the file-level exclude. Fix: extract the sanitizer into a pure module (or export it), unit-test the clamps/guards, and drop the pwa.ts exclude to measure just that function. Pre-existing (the exclude predates the coverage-thresholds PR). (gds-quick-dev adversarial review, coverage PR #146.) |
| 2026-07-04 | event-visuals | #336 | — | review-deferral | P3 | low (cosmetic) | — | open | **Ready.** VIP inspection limo replays every 5 game-days on a persistently-failing tower. `Simulation.checkVip` fires `triggerVip()` before the pass/fail check, and a failed inspection reschedules `vipVisitDay=day+5`, so a tower stuck below TOWER criteria replays the 6.5s limo every 5 days with no throttle (unlike the nag lines, which throttle on `lastVipNagDay`). **Most player-visible of the P3 cosmetics**, the design voice argued P2 (a recurring cosmetic loop reads as a bug); parked at the head of P3 as a compromise. Fix by throttling the limo or only firing on a passing inspection. |
| 2026-07-06 | event-visuals | #337 | — | review-deferral | P3 | low (cosmetic) | — | open | **Ready.** Thief cosmetic can play fully **off-screen**. `TowerEngine.renderThief` anchors the thief's Y to a random tenanted floor (`worldToScreenY(thiefFloor)`); in a tall tower that floor is often outside the viewport, so the run animates invisibly (regression from the old always-visible `viewHeight*0.66`). Accepted tradeoff of grounding the thief on a real floor + the engine/render separation (the engine can't know the camera), and the player still gets the log/toast line. If it reads as "missing the cosmetic," bias selection toward the lobby / a low floor (like the VIP limo), or nudge the camera to the thief's floor for the run. (gds-code-review, thief-grounding: Blind + Edge Case Hunter.) |
| 2026-07-06 | pr-129-gh-templates | — | — | review-deferral | P3 | low | maintainer | resolved | **RESOLVED, verified 2026-07-15 during the issue-tracker seeding pass:** the label taxonomy from `.github/labels.yml` is live on the repo (`parity` carries the taxonomy's exact color 231367 and description), so the Sync labels run this row asked for has happened. Row kept for the record. |
| 2026-07-06 | congestion-overlay | #338 | — | perf | P3 | low | — | open | **Gated (measure first).** Per-frame `congestion()` rebuilds the spatial map every frame (pre-existing; **MEASURE FIRST**, blocked on profiling a maxed tower; do not touch the hot loop first). `TowerEngine.tick()` and `main.ts updateTraffic()` each call `sim.congestion()`, rebuilding `spatialCongestionByFloor()` per frame. A memo keyed on `(revision, rush)` is **wrong**, the map also depends on live `isPresent` occupancy, which drifts within a rush bucket. Likely fix: cache the *scalar* `congestion()` on the sim and refresh on the hour tick (where presence changes), not a map memo. |
| 2026-07-06 | condo-eviction | #339 | Modern condos | feature-request | P3 | — | — | partial | **Flavor (b) SHIPPED (v1.12.0): household-aware condo departures.** Spec: `gdd-condo-household-departures-2026-07-08.md` (party-ratified). A sold Modern condo's household can relocate on a monthly roll (`GameRules.condoRelocationChance(residents)`, scaled up with family size; Classic returns 0 and never rolls, RNG stream byte-identical); it enters a non-rescindable `"relocation"` notice and rides the existing buy-back at `householdPrice` (a self-scaling anti-trivialization sink: you reclaim 4s/5s while re-sales regress toward the mean 3, and the vacant unit bleeds hold-tax + overhead). Party (Samus/Cloud/Winston, 2026-07-08) chose reuse-the-buy-back over free turnover (a faucet). STILL PARKED (own specs before build): (a) **player-initiated evict/buy-out** (owner pays to reclaim a sold condo; the 1994 game had no condo evict); (c) **relocation offer** (offer a departing household a different empty condo before the forced buy-back). |
| 2026-07-08 | lobby-height | #308 | Classic parity | feature-request | P2 | — | — | idea | **Gated: tier-2, needs a spec. Spec seed: gdd-classic-modern-pricing-roadmap-2026-07-08 §4.** Buildable 1-3 story ground lobby (TDT header `lobbyHeight` byte 1-3; tdt-format.md §1). Today lobbies are a single-story transit layer (`facilities.ts`); the grand lobby is purely cosmetic dressing (PARITY:80). The audit ranked this the most VISIBLE missing thing in the game (the iconic tall grand lobby is a real buildable structural choice in the original). M-L; touches structure/placement/render + a save field. The importer's header parse doesn't consume `lobbyHeight` yet either. **EXTENDED (owner observation 2026-07-08, real mobile tower via harness): this is NOT just the ground lobby. SKY lobbies (floors 15/30/45/...) also have 1-3 story heights in the real 1994 game; we model every lobby (ground AND sky) as single-story (`facilities.ts`; `Tower.ts:16` "ground floor + every 15th"). So importing a real tower whose sky/ground lobbies are 2-3 stories LOSES that height (they come in single-story), and export writes `lobbyHeight` 0/1 only (`tdtExport.ts` setHdrU16 0x1c). This is a Classic parity gap (multi-story lobbies are canon structural choices, the iconic grand lobby), and it degrades the TDT round-trip fidelity we are otherwise fixing. Resolve in CLASSIC first (canon 1-3 story ground + sky lobbies, round-trip the height byte + the sky-lobby heights); optionally richer in Modern. Blocks full round-trip fidelity for towers with tall lobbies (e.g. the owner's mobile save). CONFIRMED CANON + the exact mechanic (SimTower Wiki, owner 2026-07-08): multi-level lobbies are a hidden input, hold `Ctrl` (2-level) or `Shift`+`Ctrl` (3-level) when FIRST placing a lobby (ground OR sky, so the sky-lobby extension holds). Effects to model: it changes the stairs/escalator appearance, elevators CANNOT stop on the extra lobby floors, and the floor number does NOT appear in the shaft on those floors. Lobby price is $1,250 per segment, 1-4 segments ($5,000 for a full 4-segment level); capacity infinite; cannot be placed underground; cannot be deleted. So `lobbyHeight` 1-3 is player-controlled and the round-trip should carry it. BUILD: the Ctrl/Shift+Ctrl placement modifier + the no-stop / no-floor-number render+dispatch consequences + round-trip the height on TDT import/export. Owner will generate a multi-story-lobby real save (headless Ctrl-place test is a follow-up) as a fixture.** |
| 2026-07-06 | deserialize-null-hardening | #340 | — | review-deferral | P3 | low | — | open | **Ready.** `deserialize` assigns `sim.tower.towerName = data.towerName` and `sim.tower.builtWeddingHall = data.builtWeddingHall` (Simulation.ts ~2148–2149) **raw**, with no coercion, the only two `data.*` reads in the method that skip the trust-boundary hardening every other field gets. A forged non-string `towerName` flows on into the export slug / UI (and a non-boolean `builtWeddingHall` into a truthiness branch). Pre-existing; out of scope of the null-entry P1 fix that surfaced it. Fix: coerce `towerName` to a string (fallback to the default name) and `builtWeddingHall` to a strict boolean on load. (bmad-code-review, Edge Case Hunter, deserialize-null-hardening.) |
| 2026-07-08 | save-perf-sparse-v3 | #341 | Save latency | perf | P3 | — | — | idea | **Ready: micro-win, feature-detect.** `SaveGame.toBase64` uses the chunked `String.fromCharCode` + `btoa` path everywhere; native `Uint8Array.prototype.toBase64` (Chrome 140+/Firefox 133+/Safari 18.2+) measured meaningfully faster on large payloads. Worth a feature-detected fast path with the existing chunked fallback once support is broad. Binary columnar codec stays out of scope per the 2026-07-07 decision log (reaffirmed 2026-07-08: sparse JSON + level-1 deflate closed most of the gap; binary's remaining few ms don't buy the codec/migration risk). (Save-perf party, PR #156 takeover.) |
| 2026-07-05 | condo-stickiness | #342 | — | review-deferral | P3 | low (test-only) | — | open | **Gated (watch-only).** D25's horizon margin is thinner (deterministic, not flaky; **watch-only, no code change now**). With the gentle condo noise rate, a permanent noisy neighbor reaches a notice at ≈151 game-hours; `faqComplete.test.ts` D25/D25b loop `24*8=192`, a fixed ~41-tick (~27%) cushion. Safe today (fully deterministic), but coupled to `CONDO_NOISE_EROSION` and the `24*8` horizon, if either is retuned, re-derive time-to-notice and widen the loop. (Edge Case Hunter, CONDO_NOISE_EROSION.) |
| 2026-07-08 | overview-map | #343 | SimTower parity | feature-request | P3 | — | — | idea | **Gated: needs a spec. Owner-requested 2026-07-08** after seeing the real game via the SimTower Wine harness (`tools/simtower/`). The 1994 game has an overview **MAP window**, a zoomed-out schematic of the whole tower (floors as rows, facilities color-coded, a viewport rectangle) for navigating tall towers. Add a minimap/overview UI: compact tower schematic, color-per-facility, drag/click to jump the camera. Pairs with tall-tower camera work. Open design call: DOM chrome vs engine-drawn world UI (see the ui-layer diegesis split, #editor/#inspector precedent). |
| 2026-07-08 | background-cityscape | #344 | SimTower parity | feature-request | P3 | — | — | idea | **Gated: needs a spec + art. Owner-requested 2026-07-08** (real-game reference: the New Tower shot from the harness). The 1994 game renders a parallax **city silhouette behind the player's tower**, a teal building skyline on the horizon, day/night palette-swapped. Add a graphical background cityscape layer behind our tower; it must respect the global dusk/dawn tint ramp rather than per-sprite lighting (see the `authenticity-checklist` row: the original's day/night is a palette swap, resource 0xFF03). Cosmetic/atmosphere; no save impact. |
| 2026-07-08 | facility-icons | #345 | SimTower parity | feature-request | P3 | — | — | idea | **Gated: needs a spec + icon art. Owner-requested 2026-07-08** (real-game reference: the SimTower build palette / room glyphs seen via the harness). For Classic especially, represent rooms/modules with little pictographic **icons** (à la the original's palette glyphs) instead of flat color fills + text labels, in the build palette and/or the unit representation. Owner flagged it should read well on **mobile** (icons scale/tap better than text at small sizes). Scope call: palette-only vs also in-world unit glyphs; likely a Classic-mode presentation toggle so Modern can keep its current look. Pairs with the icon set the palette already needs. |
| 2026-07-08 | auto-floor-build | — | SimTower parity | feature-request | P3 | — | — | done | **Both behaviors SHIPPED (behavior 2 v1.15.0, behavior 1 v1.25.0).** Owner observation 2026-07-08 playing the real game via the harness. Two related 1994 QOL behaviors: (1) **extending an elevator past the built structure auto-creates the floor behind it** (no separate floor-build step); (2) **floors auto-fill the empty gap between two modules** placed with space between them. **(2) DONE (v1.15.0):** placing a room (or lobby) auto-fills the horizontal gap to its nearest same-substrate neighbor on each of its own stories, a room with plain floor and a lobby with lobby tiles; charged for the bridge tiles, blocked when the whole run is unaffordable. **(1) DONE (v1.25.0, owner-requested):** `Tower.resizeTransport` auto-lays plain floor behind the shaft on every newly-served floor (up OR down into the basement), filling every empty column of the shaft footprint (partial floors are completed too) in support order via `Tower.layShaftFloors` (bottom-up for a grow, top-down for a basement, retry-loop drained), and rolls the batch back and refuses only when a tile can never be supported (a genuinely floating column) so the shaft never floats. **Also in v1.25.0: the plain FLOOR tool now bridges** to a neighboring floor exactly like a room/lobby (the earlier "floor tool never bridges" carve-out is gone; owner asked for floor-between-tiles fill), with the ground-floor bridge rescue extended to floors and the per-tile floor charge. Both mode-agnostic. **Sky-lobby floors (15/30/45…) are exempt from the auto-floor:** extending a shaft through an UNBUILT sky-lobby story refuses ("Build the sky lobby on floor N first, then extend through it.") rather than laying plain floor (which would pollute the concourse and block the player's later lobby) or auto-committing a permanent lobby the player never placed; a sky-lobby floor that already carries its lobby passes through normally. Reviewed via `/gds-code-review` (Blind + Edge Case hunters) plus Copilot + Codex rounds: partial-floor gap fixed pre-merge, basement bridge rescue, shared retry-loop DRY, unified overlap message, sky-lobby exemption; see the `auto-floor-extend-charge` deferral below for the one design note. |
| 2026-07-13 | auto-floor-extend-charge | #346 | SimTower parity | review-deferral | P3 | low | — | open | **Watch-only, by design. From the v1.25.0 `auto-floor-build` (1) review (gds-code-review, Blind Hunter).** The elevator-extend auto-floor (behavior 1) folds the auto-created floor tiles into the existing per-floor extend charge (`ECON.transportFloorCost`, $5,000/shaft-floor) rather than billing `floor.cost` per tile on top, so a shaft-floor is one priced action (matching the 1994 "no separate floor-build step"). This is deliberately asymmetric with the FLOOR-tool bridge, which charges `floor.cost` per gap tile. It is not an exploit: extending a shaft is strictly MORE expensive per floor than laying the tiles by hand ($5,000/floor vs $500/tile), so nobody floors a tower via elevators to save money. Itemizing the floor charge cleanly (without a negative-money edge in the budget-clamped `extendBill` drag path, which knows only a single flat per-floor cost and can't tell sky floors from built ones) is disproportionate to the ~$500/tile amounts. If the owner wants the extend to itemize its floor cost, add a non-mutating `Tower` count of the tiles a resize would create, fold it into `extendBill`'s per-step budget, and charge it in both editor extend paths. |
| 2026-07-09 | auto-floor-bridge-distance | #347 | SimTower parity | review-deferral | P3 | low | — | open | **Watch-only, by design. From the v1.15.0 `auto-floor-build` (2) review (gds-code-review, Acceptance Auditor + Edge Case Hunter).** `Tower.bridgeFillPlan` bridges to the *nearest* same-substrate structure with no maximum-gap cap and scans out to the lot edge. Two linked notes: (a) a distant nearest-neighbor auto-fills (and charges for) a long floor run, and can block an otherwise-affordable module with only a generic "Not enough money." toast; (b) when no neighbor exists on a story, the hover-preview scan runs to the lot edge each frame (bounded, cheap `Map.get`s, ~2xGRID.width per story, but at hover cadence). Kept nearest-neighbor unbounded because that matches the owner's stated intent ("fill the gap between them") and is pinned by a far-gap test. If the far-gap fill reads as surprising, add a max-gap cap (and a bridge-specific refusal message); if the hover scan ever shows up in a profile, short-circuit when the first column out is empty on both sides. |
| 2026-07-08 | tdt-header-counts-verify | #348 | SimTower parity | review-deferral | P3 | low | — | open | **Gated: needs the harness (real-game load).** From the v1.11.3 header-count fix review (bmad-code-review, 3 layers; no confirmed bugs, Blind Hunter's over-count "High" refuted by the repo-access layer). Two canon questions the diff review couldn't settle without the real game: (1) **commercialCount vs the empty §7 retail table**, the fix writes a nonzero commercialCount while the exporter still writes the 512-slot retail table entirely empty; if the 1994 reader cross-checks the header count against that table (variants/status/finance lines), the mismatch could mislead it the way a zeroed recyclingCount did. Recycling was verified against the real game; commercial was not. (2) **Under-construction crediting**, buildTDT counts under-construction facilities toward the header aggregates (consistent with "count what's emitted", they emit with a negative type byte); confirm the real game credits a still-building recycling/security/etc. toward its advisories, or only operational ones. Both LOW; verify once the DOSBox-X save/load harness lands. |
| 2026-07-08 | tdt-trailing-structure-layout | — | SimTower parity | bug | P2 | high | — | resolved | **RESOLVED (trued up 2026-07-15 during the issue-mirror pass; the notes below already declared both halves resolved while the status cell lagged at open). The live remainder is tracked on its own row, [[tdt-export-routing-tail]] (GH #310); issue #309 was opened from the stale status and is closed as completed.** **EPIC. CONFIRMED against the real 1994 game (Wine harness, tools/simtower/). Affects BOTH import and export -- one root cause.** Our model of the `.TDT` trailing structures (everything after the floor map: §6 people, §7 retail, §8 elevators+stairs, §9 finance, §10 parking, §11 lobby/reachability table) does NOT match the real game's actual layout. Symptoms: (a) EXPORT -- our `.TDT` crashes real SimTower on load (16-bit page fault 0x0799, a buffer overrun) while the game's own saves load fine; our empty export is 39,514 B vs the game's 65,112 (~25.6 KB short of trailing tables), so the game reads past our too-small tables. (b) IMPORT -- our own import report says *"the elevator table doesn't match the documented layout, so elevators were rebuilt from the floor layout and the save's stairways couldn't be read"*: we FALL BACK to synthesizing 1 elevator from the floors, LOSING the real elevators + all stairs/escalators (visible in the round-trip: a real my_tower with multiple shafts imports as 1). RE of the real empty save (TSTSAVE.TDT) shows the real order/offsets differ from our canon: e.g. a ~8.2 KB structure sits between the floor map end (0x5D20) and the retail table (real retail at 0x7D24, ours right after the floor map), and the §11 lobby table (528x6) is emitted not at all. FIX (epic, spec-first): re-derive the trailing layout from the real saves (empty TSTSAVE.TDT + my_tower.TDT which has elevators+stairs) as ground truth, correct `docs/canon/tdt-format.md` §6-11, then fix `tdtFormat.ts`/`tdtImport.ts` (parse the real elevator/stair tables instead of falling back) AND `tdtExport.ts` (emit every table at the real offset+size). GUARDS: importer reads the real my_tower's elevators+stairs (no fallback); exporter byte-length + structure offsets match TSTSAVE.TDT; re-verify load in the real game (no 0x0799). NOTE: header + floor map + room import are already CORRECT (rooms/funds/star/date faithful, 0 hard warnings); this is trailing-tables only. Neither symptom is player-shipping-critical today (importer degrades gracefully; export-to-1994 is niche), which is why it's P2 not P1. **RESOLVED both halves. IMPORT half fixed v1.13.0 (real elevator/stair tables parsed, no synthesis fallback). EXPORT half fixed v1.14.0: a full my_tower (2★, offices/hotels/condos/fast food/3 shafts/6 stairs) now LOADS AND PLAYS in the real 1994 game (Wine harness) with no 0x0799 crash. Root causes were, in order: (1) file too short -- the game reads a fixed trailing routing region after the stairs table; emit it 0xFF-filled to TDT_ROUTING_TAIL_SIZE (0xFF = empty-slot sentinel; zero-fill invents a phantom population); (2) a POPULATED tower with people count 0 faults -- write the resident/worker census with that many zeroed records (empty tower stays 0); (3) built shafts with a zero schedule block load with NO CARS (people trapped) -- emit the game's default block TDT_ELEVATOR_SCHEDULE_DEFAULT (01x14 05x14 00x28); (4) the saved view opened on the sky -- write the New Tower view-scroll default (header 0x26/0x28) so it opens on the ground lobby. Isolation done by blanking each structure in the game's OWN save (index maps proved NOT required; 0xFF tail + zeroed people/car records all load). Guarded by src/tests/tdtExport.test.ts. Remaining: see `tdt-export-routing-tail`. |
| 2026-07-08 | tdt-export-routing-tail | #310 | SimTower parity | task | P2 | med | — | open | **Follow-up to the now-resolved `tdt-trailing-structure-layout` export half (v1.14.0).** The exporter reaches the game's expected file length by emitting a FIXED-size `0xFF` routing tail (`TDT_ROUTING_TAIL_SIZE` = 0x6400), validated for Classic towers up to 2★ (the only real saves on hand: empty TSTSAVE.TDT + a 2★ my_tower). The real game's trailing region is not a single fixed size across saves, so a much bigger 3★+ tower (more elevators/floors, sky lobbies, big crowds, cinemas/cathedral) could read past the fixed tail and 0x0799 again. Over-emitting is safe (the game ignores trailing slack); under-emitting is the crash. TODO once higher-star real saves are available: pin the tail SIZE as a function of tower content (or confirm a safe upper bound) and replace the fixed constant. Also refine the people census: our count is low (77 for a tower the game runs at ~291) because the IMPORT under-captures office/condo occupancy (see `tdt-import-population-seed`) and commercial customers aren't counted (see `population-census-parity`); the export faithfully mirrors whatever we import, so this rides those two items. NEEDS: a few 3★/4★ saves with varied transport (multiple/express/service elevators, escalators, sky lobbies, parking) to RE the tail-size law. |
| 2026-07-08 | classic-calendar-parity | — | Classic/Modern split | feature-request | P1 | med | — | done | **DONE (trued up 2026-07-15 during the issue-mirror pass): PR #170 (v1.15.0) merged with the harness weekend-phase validation in the PR body; the impl-review status was stale.** **IMPLEMENTED 2026-07-08 (v1.15.0), pending gds-review + owner harness weekend-phase validation. New `src/engine/calendar.ts` (Calendar model: CANON 3/3/12 + REAL_WORLD 7/90/360, resolveCalendar/coerceCalendarKind); Clock holds a Calendar (default real-world so bare `new Clock()` is unchanged) and derives dayOfWeek/isWeekend/quarter/year/formatRetroDate from it; Simulation resolves the calendar from mode + a new persisted `modernCalendar` toggle and builds the clock with it; onDay maintenance rides `calendar.maintPeriodDays` (killed `day/30`); EconomySystem collectRent/payMaintenance income-invariant rescale (canon rent 1/30, maint 1/10; real-world factor exactly 1 = byte-identical); condoRelocation chance scaled by period; maybeSanta calendar-aware (real-world byte-identical); New-Tower Modern calendar toggle (UI.ts/main.ts/saveLoad.ts); no SAVE_VERSION bump (additive field, existing Classic saves SHOULD adopt canon = the fix). Guarded by src/tests/calendar.test.ts (20) + faqComplete fixups. Gates green (typecheck/lint/951 tests/build). gds-code-review DONE (3 layers; 7 patched: REAL_WORLD-linked divisors, lunch-gate + dayName calendar-aware, real-world maintenance wording restored, weekend-phase comment fix, added maint-invariance/cadence tests, doc reconcile; 2 deferred: 999-yr roll + non-trailing weekend phase; 2 dismissed). REMAINING before merge: (1) owner harness weekend-PHASE validation (which canon day-slot the real game treats as weekend for a known currentDay -- currently pinned to the trailing slot with a documented TODO in calendar.ts CANON; CONTINGENT FOLLOW-UP if the game's weekend is a NON-trailing slot: the trailing-only `weekendDays`-count model can't express it, so it would need an explicit weekend-phase offset on the Calendar + Clock arithmetic -- gds-review Auditor flag); (3) optional maintenance-cadence confirmation vs the Finance window. Date round-trip already proven (day 1280 -> Year 107). SPEC: `gdd-/arch-classic-calendar-parity-2026-07-08.md`. --- ORIGINAL SPEC NOTE 2026-07-08: `gdd-classic-calendar-parity-2026-07-08.md` + `arch-classic-calendar-parity-2026-07-08.md`. Party VERDICT: full canon calendar for Classic (display AND cadence); economy kept balanced by INCOME-INVARIANT RESCALE (per-collection amount x periodDays/oldPeriodDays, so money-per-in-game-day is unchanged; canon rent = rentOf/30 every 3 days) rather than canon amounts (blocked -- the 1994 rent table is in the un-OCR'd German manual); ONE mode-resolved `Calendar` where Modern real-world = today's constants EXACTLY (factor 1.0, byte-identical, the contained-risk safety net); kill the incoherent `day/30` maintenance month (longer than a canon year) -> canon per-quarter; rescale any per-year EventSystem cadence; `modernCalendar` save field + version decision; three harness validations gate merge (weekend phase, maintenance cadence, date round-trip). The change is ATOMIC: `onDay()` collects rent on `clock.quarter` change, so flipping the quarter without the rescale = 30x income bug; the mode gate is what makes atomic safe. SEQUENCING (owner 2026-07-08): designated FAST-FOLLOW immediately after the TDT export fix -- it is tightly TDT-coupled (the save's date is part of the round-trip) -- and AHEAD of the population-census work. Scope lever: consider decoupling the cheap DATE DISPLAY (what TDT needs) from the risky ECONOMIC QUARTER pacing (rent timing) if the full change is too heavy for a fast-follow. EPIC, spec-first. Revisits the earlier "3-day-week ratified-out" note on the elevator-scheduling row.** Adopt SimTower's real calendar for CLASSIC: a week = 3 days (2 weekday + 1 weekend), a quarter = 1 week (3 days), a year = 4 quarters = **12 days** (canon: `docs/canon/tdt-format.md` §3; day counter rolls at 11,987 = 999 years). Today our `Clock` (`src/engine/Clock.ts`) uses a 7-day week / 90-day quarter / 360-day year, a DELIBERATE divergence recorded in PARITY.md; the retro WD/WE date display already exists. Plan: put week/quarter/year lengths behind `GameRules`/`GameMode` so **Classic = the 12-day canon calendar** and **Modern = a startup TOGGLE (classic-short vs real-world-length)**. Payoff: makes `.TDT` date import/export EXACT (`currentDay` 56 -> "5th Year/3Q/WE", which our 360-day calendar currently renders as "1st Year"); closes a named parity gap. RISK / why it's an epic not a quick fix: the calendar length drives QUARTERLY RENT COLLECTION (a 3-day quarter collects rent every 3 days -- a real economic-pacing change), weekend crowd/office-closed behavior, milestones, and VIP/`completeAt`/`vacate` timers; needs a save-version gate so Classic replays stay deterministic, plus its own gdd/arch spec and tests. Interim (until this lands): TDT import keeps the honest report note that the original's date does not map 1:1 to our calendar. Supersedes the "3-day-week/12-day-calendar stays ratified-out" line on the `elevator-scheduling` row. |
| 2026-07-08 | facility-visual-variety | — | SimTower parity | feature-request | P3 | — | — | done | **DONE (trued up 2026-07-15 during the issue-mirror pass): the row's own notes said "FULLY SHIPPED 2026-07-12 (v1.19.0, PR #184), row can close after merge" and that merge happened.** **FULLY SHIPPED 2026-07-12 (v1.19.0, PR #184), row can close after merge.** Round 2 (owner call: color is not variety): every retail variety now furnishes its own room (structural interiors), offices draw one of three true layouts (desk row / meeting room / executive corner) and condos one of three (living / dining / study), both mirrorable, geo-seeded from (floor, x); hotels ruled deliberately uniform (linen tints + bed mirror only); cinemas de-cloned. Party law recorded in pixelSprites.ts: a variant must differ in geometry before color. ROUND 1: **RETAIL HALF SHIPPED 2026-07-12 (v1.19.0, PR #184):** every canon retail variety (5 fastFood, 5 restaurant, 11 shop) now draws distinctly via look tables in `src/render/pixelSprites.ts`, keyed by `Unit.subtype` (design party: kind silhouette sacred, band/awning/wall carry the variation plus one prop; undefined subtype renders the legacy art byte-identical; `subtype` joined the room bake sig and `rerollSubtype` bumps the meal-overlay revision so Change variety repaints immediately). Sprite gallery shows all 21 labeled varieties; screenshots/baselines minted via pinned CI. The once-remaining sliver (closed by round 2): OFFICE per-unit procedural variety (no canon subtype; vary interior look from a stable per-unit seed). ORIGINAL: **Gated: needs a spec + art. Owner observation 2026-07-08 building a real tower (harness).** In the 1994 game, same-kind rooms (offices, restaurants, ...) each look a LITTLE different -- subtle per-unit visual variation, not identical clones. Our engine draws every unit of a kind identically. Add per-unit variety: restaurants / fast-food / shops have canon SUBTYPE variants (§7: 5 restaurants, 5 fast-foods, 11 shops -- overlaps the existing `retail-subtypes` item; the variant byte lives in the save's retail table AND the unit record's final byte, so it's real save data). OFFICES have no canon subtype, but the original still varies their interior look -- do it procedurally from a stable per-unit seed (e.g. `id` or an x/floor hash) picking a palette/decor variant. Cosmetic-only, no economy read; stable across saves. Complements `retail-subtypes` and `facility-icons`. Owner: "probably lots of info in that save file." |
| 2026-07-08 | lobby-awnings | — | SimTower parity | feature-request | P3 | — | — | done | **Done 2026-07-09.** The 1994 ground-floor lobby/storefronts have little **awnings** that make the lobby look and feel much nicer. Shipped as green-and-gold entrance marquees (deep green canopy, gilded top rail, scalloped-arch fringe) hung on floor 1's frontage edges, standing in for the fire escape there. The exterior fire escape on floors 2 and up was also widened at the same time so both dressings read at play zoom (`drawAwning` in `src/render/sprites/structure.ts`, wired through `syncEscapes` in `TowerEngine.ts`). Cosmetic; complements the grand-lobby concourse (PR #96), `facility-visual-variety`, and `background-cityscape`. No engine/save impact. |
| 2026-07-08 | population-census-parity | — | SimTower parity | feature-request | P2 | med | — | resolved | **RESOLVED 2026-07-10 (v1.18.3).** Commercial venues now count live eating customers toward population census. `FACILITIES` catalog values scale with footprint: fastFood 25, restaurant 35, shop 20 (catalog/TDT). `Unit.customersIn` (transient O(1) counter) incremented on meal start, decremented in `Crowd.finish()`. `Tower.totalPopulation()` and `Simulation.occupantPopulation()` read `customersIn` for commercial. TDT export uses the catalog values; TDT import seeds `state="occupied"` only; `customersIn` resets to 0 on load and rebuilds organically. Both Classic and Modern modes. Full test coverage added in `personCensus.test.ts`, `tdtExport.test.ts`, `tdtImport.test.ts`, `canon.test.ts`. --- ORIGINAL: **CANON DATA CAPTURED 2026-07-08 (owner shared the real game's Finance Window; the sequenced "population phase" after the calendar fix).** Our POP caps ~119 for a tower the real game reports at ~234, a ~2x gap. The real Finance Window's POPULATION column resolves it: **Office 48 (= 8 x 6, matches our `population` 6), Condo 45 (= 15 x 3, matches our 3), Fast Food 175 (we count fast food as 0).** So our per-unit values for offices/condos are CORRECT; the gap is that the original counts **commercial-venue customers/traffic toward population** (fast food ~35 per unit here; restaurants and shops presumably similar) while our `FACILITIES.fastFood/restaurant/shop.population` are all 0. |
| 2026-07-08 | tdt-import-population-seed | #311 | SimTower parity | feature-request | P2 | med | — | idea | **Gated: needs a small spec. Owner question 2026-07-08 (real-tower import): pop 96 vs the save's 234.** We import the persistent OCCUPANCY (offices tenanted, condos sold, hotel rooms booked) but NOT the save's live person roster (§6, 768 sims) or live satisfaction: those are a transient crowd snapshot in the original's sim-model (positions, destinations, states referencing original floor/elevator indices) that does not map cleanly onto our emergent crowd, and it churns within sim-minutes, so a person-by-person port is high-effort/low-fidelity (correctly deferred). The real symptom worth fixing is the HEADCOUNT: on load our tower re-populates the crowd from empty, so `pop` lags the save's number for a while (worse before the stairs fix, since upper floors were unreachable). Proposal: SEED the initial population/crowd from the imported occupancy (and optionally the save's per-floor population line in the finance block §9, which we already locate) so the headcount and initial fill match on load, WITHOUT importing individual sims. Verify against my_tower.TDT (target pop ~234). Distinct from named-tenant import (still deferred). Minor bump. |
| 2026-07-08 | per-room-eval-parity | #312 | SimTower parity | feature-request | P2 | med | — | idea | **Owner observations 2026-07-08 (real vs imported, same rooms).** Two related gaps in per-unit evaluation: (A) the EVAL VALUE is computed differently from 1994 (owner saw the same room score differently in each; ties to the satisfaction-map difference where our imported tower reads uniformly high/green while the real one has spread). (B) MISSING FEATURE: the 1994 inspector shows textual **reasoning** for a unit's eval, e.g. a Condo popup reading "Single Room neighbor is noisy" (a full sentence naming the dominant dissatisfier). Add per-unit eval REASONS surfaced in our inspector (noisy neighbor, poor elevator access/long wait, too few nearby amenities, dirty hotel, etc.), derived from the same factors the satisfaction model already weighs. Note our imported satisfaction starts high because we don't import live satisfaction/people (see [[population-census-parity]], `tdt-import-population-seed`) and re-simulate from content, so compare eval parity on a SETTLED tower, not right after import. Reconcile our satisfaction factors + weights against the 1994 model before claiming a calc bug. Player-facing: reasons make the "why is this unhappy" legible (pairs with our existing satisfaction heatmap, PR #118). |
| 2026-07-08 | commercial-venue-inspector | #313 | SimTower parity | feature-request | P2 | med | — | idea | **Owner observation 2026-07-08 (real game restaurant/cafe inspector).** The 1994 inspector for a commercial venue shows data we don't track or surface: a named SUBTYPE ("Chinese Cafe" -- overlaps [[retail-subtypes]]), **Today's Patronage** (a per-venue daily customer count with a colored bar: yellow = average, red = very few), **Yesterday's Profit** (per-venue $), and REASONING text ("Business is average" / "Very few customers", plus a WEATHER modifier line "Rain might cause fewer customers"). Implies a per-venue model we may lack: daily patronage tracking, per-venue profit history, a business-level tier, and weather affecting commercial traffic (we have `WeatherKind`; confirm it modulates shop/restaurant/fast-food revenue+patronage). This patronage IS the commercial "population" the finance window counts (see [[population-census-parity]]: fast food pop 175). Build a commercial inspector panel + the underlying per-venue patronage/profit/weather model. Complements `per-room-eval-parity` (same "explain why" reasoning pattern) and `finance-1010`. |
| 2026-07-08 | bomb-threat-parity | #349 | SimTower parity | review-deferral | P3 | low | — | idea | **Owner asked 2026-07-08 "do we have this?" -- YES we do (`src/engine/EventSystem.ts` `bombThreat`: pay ransom vs. Security search; detonates ~5 floors + fine if no Security).** But parameters differ from 1994 and are worth a parity pass: 1994 fires the blackmail at ~**2 stars** (owner's screenshot), demands **$200,000**, and gives a live "**explodes at 3 o'clock**" deadline with Pay Them / Find the Bomb; ours gates at **4 stars and up**, demands **$300,000**, and resolves on the daily roll (no in-day timed deadline). Decide which are canon vs our deliberate tuning (the 4-star gate may be intentional difficulty pacing) and align the ransom / star-gate / timed-deadline for Classic. Low priority; the event exists and works. |
| 2026-07-08 | stairs-render-polish | #350 | UI legibility | feature-request | P3 | low | — | idea | **Ready-ish: art + small render pass. Owner observation 2026-07-08 (real-tower import): "I didn't even see the staircase."** Our stairs/escalator flights read poorly: on import the owner could not spot them. Make walkways legible and nicer: (1) let the flight visually **overlap slightly onto the top landing floor** it connects to (as the diagonal reads in the original), rather than sitting flush; (2) add **shadowing / depth** (drop shadow, edge highlight) so a flight pops against the floor behind it; (3) general walkway UI polish (clearer diagonal, handrail, step shading). Cosmetic only; no engine/save impact. Complements `elevator-floornum-contrast`, `facility-icons`, and `lobby-awnings`. |
| 2026-07-08 | elevator-floornum-contrast | — | UI legibility | bug | P3 | low | — | done | **RESOLVED 2026-07-13 (v1.26.1).** `drawTransport` (`src/render/sprites/transport.ts`) now paints each shaft floor number as a dark drop-shadow (`rgba(0,0,0,0.55)`, offset +1/+1) behind a brighter `rgba(255,255,255,0.62)` glyph, replacing the faint single `rgba(255,255,255,0.28)` fill. The shadow gives the digit an outline that reads on every shaft tint (standard/service/express all darken to near-black via `shade(-34)`) and at the small 8px font a tall imported tower uses, fixing the desktop wash-out without touching the mobile look (same center coordinates, same font). Guarded by `renderTransport.test.ts` (draw-order shadow-behind-glyph, brighter-than-old-fill alpha, express skip-floor suppression). The labels live on the shaft backing (the car actor rides over them), so the fix is on the shaft draw path, not the car. `gds-code-review` clean (no production defects; 2 test-hardening patches applied). Original: **Ready: small render/style fix. Owner observation 2026-07-08 (real-tower import, desktop).** The floor-number labels drawn inside elevator shafts (e.g. "9", "8") are near-unreadable on **desktop** (dark gray digits on the dark shaft fill, low contrast) but read fine on **mobile** (different scale/DPR makes them legible). Bump the shaft floor-number contrast so it holds on desktop too. |
| 2026-07-08 | elevator-config-ui | #352 | Classic parity | feature-request | P3 | — | — | idea | **Gated: needs a spec; UI half of the `elevator-scheduling` epic. Owner observation 2026-07-08 from the real game (harness screenshot).** The 1994 elevator inspector is far richer than ours: a per-shaft dialog with a **WD/WE weekday-vs-weekend schedule** toggle across a 24-hour clock-icon strip, **Waiting Car Response** (how many floors closer an idle car must be before it answers, stepper), **Standard Floor Departure** (seconds to wait before departing, stepper), a scrollable **serviced-floors list with per-floor SHOW On/Off** (including setting the shaft's **starting/base floor** from the UI), and **Simulate** / OK actions. Build an equivalent elevator config dialog. This is the front-end for `elevator-scheduling` (owner tiebreak: FULL PARITY, behavior AND UI) and should round-trip the same TDT schedule bytes; keep this row as the UI/UX design surface (dialog layout, mobile adaptation of the clock strip + floor list) and let `elevator-scheduling` own the sim/dispatch model. The DOM-chrome vs engine-drawn split ruling applies (dialogs are DOM chrome). |
| 2026-07-12 | walkway-width-migration | #353 | Classic parity | design-decision | P3 | low | — | idea | **Pre-E1b saves still carry 4-wide stairs/escalators (canon 8) and the v4->v5 shaft-widening migration deliberately skips walkways.** Doubling a flight's width in place is a different re-fit from the elevator +1: the exact-footprint stacking rule means every flight in a stacked run must widen together to the same x/width or the run stops merging ([[e1b-widths]]), and an 8-wide fit needs 4 extra clear columns. If legacy-width walkways read as a problem in practice, extend `upgradeV4toV5`'s approach run-wise (widen a whole stacked run or none of it); otherwise leave stored widths trusted, as today. |
| 2026-07-08 | service-elevator-car-color | — | UI legibility | feature-request | P3 | low | — | resolved | **RESOLVED 2026-07-13 (spec-elevator-car-visuals, v1.25.1): `drawCar` now takes the elevator kind and dresses the cab per type, keyed to the catalog palette. Standard stays byte-identical; service is a darker staff cab with a hazard-striped kick plate; express is a brighter liveried cab with an express-blue band. The cue is triple-encoded (brightness, bottom-edge pattern, hue) so it survives color-blindness; FULL bar and lantern positions unchanged. The sprite gallery elevator entries now draw their cars. Exact 1994 car colors were not confirmable from clean-room text sources, so the row's fallback clause (clearly distinct) applied.** Original: Owner observation 2026-07-08: service-elevator cars are hard to tell apart from regular elevators in our UI. The catalog palette already differs (`facilities.ts`: standard `#5a5a6a`, service `#4a4a52`, express `#3a3a8a`), but the rendered CAR reads the same as a regular car. Give the service car a visibly distinct look, ideally matching the 1994 original's service-car color; if the exact canon color isn't confirmable, at minimum make it clearly different from the passenger car so players can eyeball which shafts are staff-only. Cosmetic render pass in the elevator/car draw path (`src/render/**`); no engine/save impact. Pairs with [[service-elevator-width]] (same subsystem) and `elevator-floornum-contrast`. |
| 2026-07-10 | cinema-occupancy-display | — | SimTower parity | feature-request | P3 | low | — | done | **DONE 2026-07-15 (attendance-guards PR): the remaining inspector sliver shipped. The inspector now shows the live Customers line for attendance venues (cinema / party hall / wedding hall) from their routed tally, alongside the display core that v1.33.0's `syncAttendanceOccupants` already delivered. Issue #354 closes with the merge.** **CORE RESOLVED by the venue-attendance work (v1.33.0); verified in code 2026-07-15 during the backlog-hygiene pass.** `syncAttendanceOccupants` (`src/engine/census.ts`) mirrors live routed attendance (`customersIn`) into `occupants` for the population-0 attendance venues (cinema / party hall / wedding hall), so the occupancy heatmap, lit-window state, and interior art fill honestly; `src/tests/integration/venueAttendance.integration.test.ts` pins the mirror (mirror-in-step and non-operational-mirrors-0 included). The census exclusion this row required is preserved (`censusCount` gates on `population > 0` and never reads `occupants`). REMAINING SLIVER: the hover inspector shows neither a Customers nor an Occupants line for these venues (`isCommercialKind("cinema")` is true but `population` 0 hides the Customers branch, and the Occupants branch gates on `f.population`), so a mid-show cinema inspects with no attendance number at all. Small template change in `src/ui/templates/inspector.ts`; ride it on the attendance-integrity pass (people-tracking priority party 2026-07-15, item 3 as re-scoped). |
| 2026-07-10 | venue-peak-hour-scaling | #355 | performance | design-decision | P3 | low | — | parked | **Parked: hot path, redundant signal. Party decision 2026-07-10 (commercial venue fix session).** Proposal was: scale `u.occupants` up/down within open hours based on time of day (e.g., busier at noon for restaurants). CUT because (a) `u.occupants` is baked into the tile render cache key, so continuous variation would constantly invalidate the cache across every open venue every tick, a hot path problem; (b) the `customersIn` meal round-trip system already creates real transport stress during peak windows, so a fake visual envelope on top double-counts the story being told. If the player-visible heatmap "feels flat," revisit after the cinema occupancy display (above) is addressed and after per-person meal round-trips land. |
| 2026-07-12 | shopping-trips | #356 | SimTower parity | feature-request | P3 | med | — | parked | **PARKED by the people-tracking priority party (2026-07-15); row refreshed to shipped reality.** Shops now receive real one-way ambient foot traffic (the `isVenue` pool in `src/engine/crowd/spawn.ts` includes `shop`: strollers arrive, linger, and despawn there, and metro arrivals head to open venues too), so shop floors read alive. STILL TRUE from the 2026-07-12 premise: shops sit in no `MEAL_WINDOWS` venue list and ambient trips stamp no venue attribution, so `shop.customersIn` never increments and the shop inspector honestly shows "Customers: 0". The unbuilt remainder is the dedicated browse-window system (daytime, after-work, weekend-heavy origin mix from offices/condos/hotels with `mealVenueId`-style attribution). Party ruling (Grumbal's kill, uncontested in rebuttal): resurrect only on MEASURED shop starvation or when the "Customers: 0" inspector line bothers a real player, never on the strength of this note alone. Couples with [[per-person-meal-round-trips]] machinery when it does. |
| 2026-07-12 | tdt-commercial-vacancy-roundtrip | #357 | SimTower parity | design-decision | P3 | low | — | idea | **Party decision 2026-07-12 (PR #184 takeover review): harness-gated.** TDT import seeds every non-construction fastFood/restaurant/shop as `occupied` and ignores the unit status byte; our exporter never writes a status for commercial. So vacancy cannot round-trip: export a vacant venue, reimport, it comes back occupied and the next export adds its catalog customers (self-round-trip census drift). Cloud's read: the 1994 game likely has no vacant-commercial state at all (built venues always operate), which would make the importer FAITHFUL and the drift a Modern-tower-only lossy edge. Validate against the real game via the Wine harness (does the 1994 status byte ever encode commercial vacancy?) before touching the exporter/importer; if canon has no vacancy, document the one-way mapping in the fidelity report instead. |
| 2026-07-12 | recycling-census-flap | #358 | gameplay-feel | bug | P3 | low | — | idea | **Party decision 2026-07-12 (PR #184 takeover review, from Sally's UX pass).** `recyclingDemandMet()` and `recyclingFill()` read `totalPopulation()`, which now swells with live venue customers, so a tower within a knife's edge of exactly 2,500-per-center can flip the 4-star recycling gate at the lunch peak and re-arm the edge-triggered "Garbage is piling up" bulletin daily. Fix candidates: base the recycling gate and nudge on a non-transient census (baseline without `customersIn`), a daily-peak smoothed value, or debounce the bulletin across a day. Also consider Sally's stats-overview footnote ("Population varies through the day as customers visit venues") which preempts the general "is my POP broken?" question after a star is minted at a lunch peak. |
| 2026-07-08 | seam-grouping | #359 | sim-split party | design-decision | P3 | — | — | parked | **Parked with a threshold.** If `GameRules` grows past roughly a dozen methods, GROUP the interface (`rules.economy.*`, `rules.pricing.*` style) instead of letting it flatten out; a ModernSimulation subclass was steelmanned and ruled OUT (polymorphic deserialize would let a forged save pick its attack surface before validation; inheritance ships Classic bugfixes into Modern silently; the modes disagree rather than stack). Provenance: sim-split party 2026-07-08, Story 1.7 in `epics-classic-modern-roadmap-2026-07-08.md` (the tripwire test that enforces the seam law). |

---

## Deferral inbox

### Deferred from: `gds-code-review` of commercial-demand-pools Phase A (#393) (adversarial, 2026-07-15)

- **Attendance venues (cinema/partyHall) distort the retail demand pool (Edge Case Hunter, medium; GDD-flagged revisit).** Promoted to a curated row: `attendance-venue-demand` (#424). A cinema/party hall enters the demand pool's `totalCap` as a capacity sink and can collapse retail income; fix is an attendance-fill fraction that drops them from the retail `totalCap`. Per-spec today (Acceptance Auditor), so a balance refinement. See the row for detail.
- **`GameRules.demandModel()` omits the spec's `smoothing` field and soft-shoulder cap (Acceptance Auditor, low; Phase C).** The GDD/arch define the seam as `{ perCapita; floor; smoothing: "hard" | "soft" }`; Phase A ships `{ perCapita; floor }` only (Classic is a hard `min(1, ...)` cap). The soft-shoulder cap approach is the documented Phase C refinement (a gentle Modern shoulder near the cap); add the field and the Modern soft behavior when Phase C lands.

### Deferred from: code review of #400 inspector "Main gripe" line (`gds-code-review` adversarial, 2026-07-15)

- **Classic shows fix advice, but the GDD reserves advice for Modern (Acceptance Auditor, medium).** The `GRIPE_TEXT` strings in `src/game/facilityDiagnostics.ts` bake the fix into the line ("Add cars or a parallel shaft", "Lower it to keep them", "a lobby tile between them shields it"), shown in both modes, while `gdd-simtower-optimization-gaps-2026-07-15.md` says Classic shows information and only Modern adds advice. Not fixed in #400 because the fix is holistic: the existing inspector lines (Access "Add a sky-lobby transfer", W1 "Put a stairway...", W3 "Keep it within 2 floors...") ALL embed advice with no mode gate, so mode-gating only the new line would be inconsistent. The right move is one pass that routes all inspector advice through a `GameRules` gate (Classic = cause only, Modern = cause + fix). Scope it as its own story before touching it.
- **`dominantGripe` rebuilds the spatial congestion map per inspector render in v2 (Edge Case Hunter, low/perf).** `sim.dominantGripe(u)` calls `sim.congestionAt(u.floor)`, which in the v2 model rebuilds the whole `spatialCongestionByFloor` map (unmemoized) to read one floor; the inspector card re-renders on pointer-move and to tick live countdowns, so an unhappy office/condo/hotel hover pays one full-tower scan per render. Bounded (hover only, unhappy tenants only, v2 only) and the stats overlay already does the same, so it is not new-in-kind. Fold into the render-perf memoization work (see the `congestion` memoization / on-hour amortization threads) rather than a bespoke fix.

### Deferred from: code review of dropping the excalibur-preview screenshot scene (`/bmad-code-review` adversarial, 2026-07-15)

Change: removed the redundant `excalibur-preview` screenshot scene (it captured the
standalone `excalibur.html` dev page and rendered blank under the container's
software GL) from `scripts/scenes/showcase.ts`, dropped its id from the shard
partition in `scripts/screenshot-shards.ts`, and deleted the committed
`docs/screenshots/excalibur-preview.png`. On the owner's call (party-ratified,
2026-07-15) the change then grew to nuke the whole standalone Excalibur preview
harness, an orphaned bring-up scaffold nothing in `src/` imports and no CI job
hits: deleted `src/excalibur.html`, `src/excalibur-main.ts`, and the interim
`e2e/excalibur.spec.ts` boot smoke; removed the `excalibur` vite build input, its
Workbox `**/excalibur*` globIgnore/denylist, and its coverage-exclude line; and
pruned the tooling-page branch from the screenshot scripts. The Excalibur *engine*
(`src/render/excalibur/**`, the `excalibur` npm package) is untouched. Two review
layers ran (Blind Hunter, Edge Case Hunter; no spec, so no Acceptance Auditor).
One defer:

- **`pr-drift-check.yml` render-path filter misses `scripts/scenes/*.ts`** (Edge
  Case Hunter): the `changes` job classifies render-affecting edits with a
  `scripts/screenshot-*.ts` glob, which does not match `scripts/scenes/*.ts`. A
  future scene-only edit (adding or changing a shot without co-editing
  `scripts/screenshot-shards.ts` or another `screenshot-*.ts` file) could skip the
  screenshot drift capture and merge a stale gallery. This PR is unaffected because
  it co-edits `screenshot-shards.ts`, which the glob matches. Fix for the
  drift-workflow owner: widen the filter to include `scripts/scenes/**` (or
  `scripts/screenshot*`/`scripts/scenes` together). Low severity, watch-only until
  a scene-only PR actually lands.

### Deferred from: code review of the Modern escalator/office rule gate (`gds-code-review` adversarial, 2026-07-14)

Change: gated the Classic-canon "escalators link commercial floors only" placement
refusal behind `GameRules.allowsEscalatorOnOfficeFloors` (Classic false, Modern
true); `Tower` now carries the mode's rule-set, assigned by the `Simulation`
constructor. Two review layers ran (Blind Hunter, Edge Case Hunter; no spec, so no
Acceptance Auditor). Four patch findings applied (trick test now exercises real
office-over-shaft overlap, integration test places instead of only validating and
asserts every fixture step, `showsPreviewReason` doc no longer claims placement
rules are mode-identical). One defer:

- **Floor-wide vs landing-local office blocking is unverified canon** (Blind
  Hunter): `validateTransport` refuses an escalator when ANY office sits anywhere
  on either endpoint floor, regardless of x-distance to the landing. The 1994
  exploit folklore ("bulldoze the offices right behind the stairs") hints the
  original may have only cared about the tiles near the landing, but no FAQ
  passage settles it. Pre-existing scope, unchanged by this diff, and now pinned
  by tests as floor-wide. If canon research (faq-canon.md follow-up) ever shows
  the original was landing-local, narrow the Classic check and loosen the pinned
  tests; Modern is unaffected either way.

### Deferred from: code review of spec-pixelart-retail (E4) (`gds-code-review` adversarial, 2026-07-14)

Change: enriched the eleven canon retail interiors in `src/render/pixelSprites/shop.ts`
plus a new `src/render/pixelSprites/shop.interiors.ts` (per-trade draws, a lit sign
board, a board-faithful `pen()` rect helper), ported tile for tile from
`page-04-retail.build.js`. Three review layers (Blind Hunter, Edge Case Hunter,
Acceptance Auditor). No `patch`-level finding: the one applied fix was reverting a
comment inside the byte-stable generic branch so that branch stays literally
untouched. Two findings deferred, both watch-only:

- **Latent geometry underflow at non-shipping shop sizes** (Edge Case Hunter, Blind
  Hunter): the interiors and the `railY = awningBottom + 8` band assume the fixed
  shipping footprint (`shop` is catalog `width: 12` = 132px, 1 floor = 44px, so
  `fy=39`, `railY=14`). For a shop narrower than ~16px or shorter than ~11px, fixed
  offsets (counters at `w-16`, the electronics clerk at `x + w - 16`, tall props at
  `fy-16`) underflow or overrun and `pen.F` clamps them to 1px slivers or draws off
  the room's left edge. NOT reachable today: shops are fixed 132x44 and each room
  bakes into its own `w x h` canvas (any overrun is clipped, never bleeds into a
  neighbor). Only `screens()` carries an explicit right-edge break. If shops ever
  become variable-size, add an interior-band guard (`railY < floorY`) and clamp the
  fixed-offset props. Watch-only. (Ready, cheap, gated on shops becoming resizable.)
- **Salon renders the hash stand-in as a seated (mid-haircut) client, not a standing
  browser** (Edge Case Hunter, acceptance-flavored): when `u.occupants === 0` and
  `hash(u.id) > 0.4`, station 0 draws a seated client while both stylists always
  draw as staff. This is spec-compliant (the I/O matrix lists the Hair Salon client
  as a sanctioned seated figure, gated on the same single hash signal every shop
  uses; the client count is monotonic and never yields a second ghost), but it reads
  as a stronger presence than the "single browsing customer" other trades show for
  the same stand-in. If the honesty model tightens (real per-shop occupancy), revisit
  whether the salon client should gate on a real occupant rather than the stand-in.
  Watch-only, no behavior change wanted now.
### Deferred from: E3 pixel-art food and entertainment (`/gds-code-review`, 2026-07-14)

Change: enriched the food and entertainment rooms (5 fast-food subtypes, 5
restaurants, the two-floor cinema, and `drawPartyHall`) and tied every visible
figure to real occupancy. Bookkeeping and open follow-ups from this PR:

- DONE here: the party-hall `scatterPeople` ghost crowd is retired. Dancers
  (standing build), the DJ, and banquet guests (seated build) now gate on the
  hall's `u.occupants` and fill in seed order, so an empty hall draws none.
- OPEN (entertainment honest-attendance, cinema AND party hall): both kinds are
  population 0 (`facilitiesData.ts`), so `occupants` (and thus
  `visibleOccupants`) is pinned to 0, and the occupancy-gated audience/dancers
  render an EMPTY house on every real cinema and party hall. Per the frozen spec
  this is the honest read (n === 0 draws empty; "do not leave a constant
  crowd"), and it is exactly what the acceptance matrix states, so E3 ships it as
  drawn. The real fix is engine-side, not draw-code: give entertainment venues a
  visible-attendance count (a foot-traffic or booking-derived number), then feed
  it to the room as a reviewed bake-signature input (spec "Ask First"). Until
  then the cinema and party hall read empty. Flagged by the E3 `/gds-code-review`
  Edge Case Hunter. Do not reintroduce a population-independent ghost crowd to
  paper over it.
- OPEN (metro-platform `scatterPeople`): the metro-platform `scatterPeople`
  call (`src/render/sprites/facilities/service.ts`) is out of scope for E3 and
  still uses the seeded-scatter crowd idiom. It stays with the
  people-system/structure work and its own backlog follow-up.

Second review pass (three adversarial layers) on the finished branch:

- PATCHED here (Edge Case Hunter): person-implying props were drawn outside the
  occupancy gate, so an empty venue showed a floating prop. The seat filler now
  reports whether it drew an occupant, and the sushi chef's hat, the teahouse
  boba cups, the coffee-shop lounge laptop, and the coffee-shop window-bench cup
  all gate on that, matching the party-hall pattern (furniture always draws;
  person-implying props only when the seat fills). Re-verified with the gates.
- PATCHED here (Acceptance Auditor): `drawPartyHall` left the bottom ~6px of its
  two-floor 88px rect unpainted (the food rooms cover it with `pfloor`). Added a
  floor base band so the composition now fills the full rect height.
- DEFER (minor, Blind Hunter): the `f` / `glow` / `box` / `twall` primitives and
  the `(floor * 131 + x * 17)` geography seed are duplicated between
  `pixelSprites/food.interiors.ts` and `sprites/facilities/venue.ts` (different
  render modules). Left as-is to avoid cross-module coupling; a shared
  low-level helper module is the eventual cleanup. No behavior risk today.
- DEFER (low, Acceptance Auditor): the ice-cream parlor wall clock uses
  `#E8A050`. This is not the reserved notice amber `#E8A030` (blue differs by
  0x20, outside the within-10 collision band) and reads as a gold clock, not a
  state cue, so it passes the reserved-color rule. Noted for a future glance if
  the amber hue family is ever tightened.
### Deferred from: code review of spec-pixelart-structure-transport (`gds-code-review`, 2026-07-14)

Change: E6 structure and transport pixel art. Ports the page-05 board
composition into `structure/shell.ts` (banded deck), `structure/lobby.ts`
(marble concourse, reception/info desk, sky-lobby glass), `structure/entrance.ts`
(storefront skyline), `facilities/venue.ts` (two-floor wedding hall), and
`transport.ts` (stairs/escalator single-flight-plus-landing, warm elevator
shaft, brass-and-walnut car). Three review layers (Blind Hunter, Edge Case
Hunter, Acceptance Auditor). All eight frozen invariants verified preserved
(LOBBY_VARIANTS=4 and the four entrance sentinels, the `u.floor===1` ground
key with decoration reading only `lit`/`variant`/`ground`, the express
see-through glass backing, floor-number legibility, the FULL red bar, the
direction lantern, one flight per two-floor unit, no mode branch / no save
change). No reserved state-cue color used decoratively. Patched in-PR: the
wedding aisle runner (was red, spec mandates white) plus its test; the wedding
garland color rotation (`Math.abs(ax)%4` was constant); the storefront skyline
block heights (`(bx*3)%4` was constant); the wedding pilaster loop step (could
round to 0 and hang at a degenerate width); the floor-slab clamp (could paint
above a very short tile). Four findings deferred:

- **`scatterPeople` is still drawn on the metro platform and in the party
  hall** (`facilities/service.ts:156`, `facilities/venue.ts:28`). The E6 spec
  calls to retire or gate the ambient crowd so an empty tower reads empty, but
  that gating is owned by `spec-pixelart-people-system.md` and rides the E6
  read-only occupancy seam (`ElevatorQueueView` / real-occupant projection),
  which is not wired here. The enriched lobby and sky-lobby tiles already draw
  no ambient pedestrians; only these two venue/platform calls remain. Pick up
  with the people-system overlay story so the retirement and the real-occupant
  draw land together. (Medium; cross-spec, gated on the E6 seam.)
- **Stairs and escalator bake no ~17px rider** (`transport.ts` flight
  helpers). AC 151 and the I/O matrix describe a climbing rider on the incline,
  but the flight sprites are static `cache:true` art; baking a rider would show
  a phantom climber on empty stairs, contradicting the "empty tower reads
  empty" AC. The engine's routed climbers ride over the flight instead.
  Revisit if the people-system overlay wants a baked rider on the incline.
  (Low; reconciliation with the empty-tower invariant.)
- **The reception/info desk occupies lobby variant slot 1** (`structure/lobby.ts`),
  which the frozen I/O matrix line enumerates as "plain." The spec's own Ground
  and Sky I/O rows and Code Map both call for the desk, and `LOBBY_VARIANTS`
  and the sentinels are untouched, so this is a content realization, not a
  contract change; flagged as a spec internal inconsistency to reconcile in a
  spec touch-up. (Low; cosmetic / doc.)
- **Two 2px full-height guide-rail fills on the opaque elevator shafts**
  (`transport.ts`, non-express only) are drawn at full shaft height. They
  mirror the pre-existing full-height edge shadows and backing fill on the same
  shaft, so the incremental texture-safety cost is negligible, but they are
  additional full-height fills. If a future pass bands the shaft backing into
  per-floor strips, fold these in too. (Low; cosmetic, pre-existing pattern.)

### Deferred from: code review of facilities.ts split (`bmad-code-review` adversarial, 2026-07-14)

Change: `src/render/sprites/facilities.ts` (375 lines, 12 draw exports) split into
`facilities/service.ts` (in-tower service kinds), `facilities/vehicles.ts` (moving
actors), and `facilities/venue.ts` (event venues), with the original file kept as a
thin re-export barrel so no importer changed. Pure move, verified byte-for-byte
identical function bodies; zero pixel/behavior change. Two review layers (Blind
Hunter, Edge Case Hunter). The one patch finding (the new barrel was missing from
`barrelSurface.test.ts`) was fixed in-PR, and the stale `drawMetro` doc pointer to
`drawMetroTrain` (now a sibling in `vehicles.ts`) was corrected. Two findings
deferred, both cosmetic and both pre-existing to the move:

- **`facilities/service.ts` is a broad bucket** (Blind Hunter, subjective cohesion):
  it holds the true services (security, medical, housekeeping, recycling) alongside
  the metro station and the parking space/ramp, which are arguably their own
  transit/garage domains. Grouped this way deliberately (all in-tower, non-actor,
  non-venue kinds) and it sits comfortably under the 500-line ceiling at 252 lines.
  If it grows, consider a finer `transit.ts` / `garage.ts` cut. (Low; cosmetic.)
- **Dead `u: Unit` param on `drawParkingRamp`** (Blind Hunter): the function takes a
  unit it never reads and discards it with `void u;`. Pre-existing; preserved
  verbatim by the pure move (changing the signature would touch the `drawInterior`
  call site in `sprites.ts` and widen the diff past a pure relocation). Drop the
  param when the parking-ramp draw is next touched for real. (Low; cosmetic.)

### Deferred from: code review of pixelart-elevator-queue-seam (`/gds-code-review`, 2026-07-14)

- **DELIVERED 2026-07-15 (E6-S7, GH #314, branch `claude/queue-view-reconcile`).**
  Picked `crowd.carRiders` (the drawn per-car occupancy) as the single population.
  `ElevatorQueueView.boarded` now reads `crowd.carRiders` keyed `shaftId:carIndex`
  in `elevatorQueueView` (`src/engine/crowd/routing.ts`), replacing the statistical
  `t.carLoad` read, so both halves of the view count the same drawn crowd. The doc
  comments in `routing.ts` and `person.ts` now state the single-population
  invariant. `src/engine/crowd/queueView.test.ts` pins a real, non-hand-written
  same-individuals reconciliation (routed people board via `crowd.advance`, a
  poisoned `carLoad` proves it is ignored, and `boarded` is asserted against the
  independently counted riders aboard the car), plus an alight-lifecycle guard.
  Golden master unchanged (the view is a derived read, not in `serialize()`); no
  version bump (nothing consumes `boarded` visually yet, the render consumer is the
  separate queue-render story). The `/gds-code-review` layers cleared it with no
  patch or defer findings beyond two test-quality fixes applied in the same PR.
  Coordinator: close GH #314. ORIGINAL DEFER (kept for the record): the queue
  view's two halves read two different populations: reconcile boarded against the
  drawn crowd in E6-S7. `ElevatorQueueView.landings` counts the
  DRAWN `crowd.people` (real routed sims in the `waiting` state), but
  `ElevatorQueueView.boarded` reads the dispatch's statistical `t.carLoad`, which
  comes from the aggregate demand model, not the drawn crowd. The drawn per-car
  occupancy is `crowd.carRiders`, and a drawn waiter boarding does NOT change
  `carLoad`, so the two halves are unrelated counts. This seam PR keeps the
  spec-mandated `boarded = t.carLoad[i]` on purpose (it is the value the cab fill
  draws today, and nothing consumes `boarded` visually yet: the render consumer
  is the separate E6-S7 queue-render story). The spec's INTENT ("the leftover
  line is the same individuals, now shorter") is only truly honored if boarded
  and the queue are the same population. The engine unit test
  (`src/engine/crowd/queueView.test.ts`) reconciles boarded against the queue by
  HAND-WRITING `shaft.carLoad`, which stands in for the dispatch. E6-S7 must
  decide whether `boarded` reads `carLoad` or `crowd.carRiders` (the drawn
  occupancy) and add a real, non-hand-written "same individuals" reconciliation
  test then. Deferred: surfaced by the Edge Case Hunter, kept per the frozen spec
  for this seam-only PR. (Judgment call, flagged in the PR body.)

### Follow-up: evaluate a Preact (or similar) UI rendering layer (2026-07-14, from Wave C-2)

While splitting `UI.ts`, the owner raised moving the DOM generation to
React/Preact instead of hand-built HTML strings + imperative wiring. Deferred to
its OWN initiative on purpose: the Wave C-2 split is behavior-preserving (the
view moves to pure `uiTemplates.ts` string builders, the controller stays vanilla
imperative), whereas adopting a framework is a UI-architecture change (new
dependency, declarative components replacing `ui.update()/showX()/toast()`, and a
ripple into the e2e / visual-snapshot baselines). Pick up as a specced, party-run
initiative after the Wave C splits land: scope the component boundary, the
imperative-to-declarative bridge for `main.ts`, and a baseline-regeneration plan.
(Feature-request / architecture; open; owner-requested.)

### Deferred from: party consultation on audio baking (2026-07-13)

Owner follow-up to the Tone.js audio work: should we bake WAV files into the
PWA cache instead of generating tones on the fly? Party (dev + UX voices,
general-purpose research on how comparable browser games ship audio) returned a
clear verdict with three separate threads:

- **Music stays procedural. Baked WAV for the ambient score is rejected,
  unconditionally.** The three streaming scene beds are generated live by the
  Tone graph today; pre-rendering them to WAV is a net loss on every axis. Bytes:
  a few minutes of looping stereo WAV dwarfs the 66 KB gzipped Tone.js chunk and
  would blow well past the 6 MB Workbox precache ceiling (or force runtime
  fetches the offline install is meant to avoid). Feel: the procedural beds
  crossfade and re-voice per zoom scene (`OVERVIEW_ZOOM`/`DETAIL_ZOOM`), which a
  fixed loop cannot do without a much larger sample set. CPU: decoding and
  scheduling a large buffer is not obviously cheaper than the current synths on
  the target phones. No measurement could flip this one, so it is a closed
  decision, not a gated one.

- **Jingle-bake is a GATED follow-up, not scheduled work.** The one place baking
  could help is the short one-shot cues (build-complete, star-up, error, etc.):
  bake those ~6 jingles once (via `Tone.Offline` into an `AudioBuffer`, or ship
  small compressed Opus/Ogg assets) so a cue can fire from a decoded buffer
  instead of spinning up synth voices. The ONLY justification is first-gesture
  latency on a mid Android device: if the first click/build cue is audibly late
  or dropped while the Tone graph warms, baked buffers fix it. The gate is a real
  measurement of that first-cue latency on mid Android hardware, which cannot be
  taken in this headless environment. Per the dev voice: if the measurement comes
  back fine, the correct action is status quo and we ship nothing. Do not bake on
  spec. If we do bake the jingles, add them to `globPatterns` (currently
  `js,css,html,ico,png,svg,woff,woff2`, no audio) and re-check the precache
  budget.

- **First-gesture-silence bug (fix regardless of the bake decision).**
  `ToneAudioEngine.sfx()` no-ops until `this.started` is true, so the very first
  click or build cue before the Tone graph is unlocked is silent. This is a
  latent bug independent of baking (baking would mask it, but the graph should
  simply queue or arm the first cue on unlock). Fix it on its own small PR; it is
  the concrete deliverable this consultation surfaced.

- **Sampled stems into the existing mixer is a SEPARATE future project.** Feeding
  recorded instrument samples through the current Tone mixer for richer timbre is
  a different idea from "cache WAV to skip synthesis" and was not evaluated here.
  Park it as its own future exploration if the procedural palette ever feels thin.

### Deferred from: code review of express-elevator-parity (`gds-quick-dev` step-04, 2026-07-13)

- **Express build time rises 172 -> 188 in-game minutes as a side effect of the width 4->6 change.** `facilities.ts` `buildMinutes = round(60 + width*8 + cost/5000)`, so a 6-wide express takes 16 min longer to build. Arguably correct (bigger footprint = longer build) and never surfaced as a bug, but it is an un-called-out player-facing behavior change. Confirm the value reads fine in play; if not, decouple build time from width for elevators. Low. (Edge Case Hunter.)
- **The express lobby-stop coercion silently normalizes a pre-existing `.vctower` whose express was given non-lobby stops via the old (now-removed) UI.** On load, `coerceExpressStops` re-skips those floors. This is the INTENDED parity fix (those stops were the break), and the shaft never disconnects (endpoints + lobbies still serve), but it mutates a loaded save's config without notice. Fold into the general widen/coerce load-note tracked in the `e1c-migration` row (one honest line when a load changed a shaft), not per-fix. Low. (Edge Case Hunter.)
- **Formula-vs-index divergence for an UNBUILT sky-lobby floor.** `tdtImport.ts` builds an express's stops from the positional `isLobbyFloor` (floor % 15), while `coerceExpressStops` uses actual `floorHasLobby` tile counts. On a sparse tower whose floor 15 has no built lobby tile, the importer marks it a stop and coercion re-skips it. Harmless (nothing built there to serve) and they agree whenever the lobby is actually built; unify on one source if the area is next touched. Low. (Edge Case Hunter.)
- **No DEDICATED round-trip-at-6 test.** AC7 ("a 6-wide express round-trips through TDT at 6, zero warnings") is exercised INDIRECTLY (the importer reconstructs at catalog width 6 and the overlap sweep runs at the new width), but no test explicitly places a 6-wide express, exports, re-imports, and asserts width 6. Add the explicit assertion when the tdtExport/tdtImport suites are next touched. Coverage-only; behavior verified correct by all three reviewers. (Acceptance Auditor.)
- **A forged endpoint in `skipFloors` is only scrubbed for EXPRESS (via `coerceExpressStops`), not for standard/service/stairs.** `stopsAt` reads `skipFloors` literally, so a forged bottom/top on any OTHER transport would make it not stop at its own endpoint. Forged-only, pre-existing, and low blast radius (a non-stopping endpoint is a self-inflicted broken save), but a general "endpoints always stop" scrub on load would close it for all transports. Defer. (Blind Hunter, generalized.)

### Deferred from: code review of mobile-tap-hover (`/gds-code-review`, 2026-07-13)

- **A mobile inspect-tap now raises both the editor and the inspector card, so the facility name and floor render twice at once.** The tap opens the editor (docked bottom-left) and the quick-info card (docked top-left), which duplicates the header. It matches desktop (hover card plus selected editor coexist) and the two panels dock to opposite corners, so it reads as minor clutter, not a bug. A future mobile-UX pass could dedupe (suppress the card's header when the editor is open for the same facility, or slim the mobile card to the stats the editor lacks: access, patronage, satisfaction). Low, both hunters. (Blind Hunter L3 + Edge Case Hunter.)

### Deferred from: code review of commercial-venue-inspector (`/gds-code-review`, 2026-07-13, PR #205)

- **`rollOverRetailDay` skips a non-operational venue, so a burning-across-midnight unit keeps a stale `patronageToday`.** The `isOperational` gate (added to preserve the "no data yet" state for gutted/mid-build units) also skips a unit that traded, then caught fire, but is not yet gutted, across a midnight; its `patronageToday` is not rolled. Mitigated: the verdict now reads `patronageYest` (the last completed day), the fire status shows separately, and `gut` resets the fields once the unit is gutted. Revisit only if a burning venue's stale card reads wrong in playtest. (Blind Hunter, Low, largely mitigated.)

### Followups from: screenshot-determinism (party-vetted 2026-07-12, PR #188)

Both are screenshot-CI hardening. Speed is the enabler that makes the every-PR
drift-check affordable, so do it first. Design constraints came out of a party
round-table (Winston/Boundary/Dana/John/Grumbal); keep them or the followup
quietly reintroduces the very blind spots PR #188 removed.

- **Faster screenshots CI (DONE, PR 1).** Implemented in
  `spec-shard-screenshots-ci.md`: `scripts/screenshot-shards.ts` holds the
  explicit 4-shard partition (`showcase`, `slow`, `features`, `misc`) and a
  `verify` coverage guard (union of shard groups must equal every `SCENES` id,
  exactly once, checked at the gate before any capture). PR 1 originally crossed
  the `shoot` matrix `run:[a,b]` x `shard`; PR 2's reusable-capture refactor
  (see below) collapsed a/b INTO each shard job (each shard renders TWICE in one
  container, each leg from its OWN build + preview server, and self-compares), so
  the current shape is one job per shard, not eight. (Independent builds per leg,
  after a Codex finding, keep the guard catching build-time nondeterminism; the
  saving vs the 8-job matrix is the second checkout + npm ci, not the build.)
  Each shard uploads its verified `run-a` set plus a `.shard-complete`
  marker; the commit job rebuilds the gallery from the union of shards (pruning
  removed scenes). The original speed constraints held: 4 shards (not 8+),
  provable coverage, `ONLY=`-based subsetting.
- **Drift-check on every PR (IN PROGRESS, PR 2).** Speced in
  `spec-pr-drift-check.md` (approval-gated). Move the guard left to PR time, split
  into TWO signals with TWO verdicts or it becomes a wolf-crier that gets ignored:
  - **Hard fail = the generator disagrees with ITSELF** (generate twice, diff
    the two runs against each other, not against the committed set). That is
    nondeterminism, always a bug, and scope-independent, so it stays valid even
    as main drifts underneath the PR. This is PR #188's guard, moved to PR time.
  - **Differs from the COMMITTED set = a one-click APPROVAL GATE, not a red X.**
    Evolved from the original "advisory comment" after a user request: instead of
    telling the author to go do a marker push, the PR run (which already generated
    the canonical pinned-container pixels) waits at a GitHub Environment approval
    (`screenshot-approval`); on the maintainer's click it commits the regenerated
    gallery to the PR branch in the SAME run. Drift never turns the PR red on its
    own. Path-gated to `src/render/**` / `scripts/screenshot*` so it isn't noise.
  - Do not conflate the two: a naive "differs from committed = fail" turns every
    legit sprite tweak red, people learn to ignore red, and the day a real
    nondeterminism leak lands it is the boy who cried wolf.
- **Keep the `[update-screenshots]` marker; do NOT retire it in PR 2** (party
  round-tabled 2026-07-13: Winston/Dana/Boundary/John/Grumbal). The marker/
  `workflow_dispatch` and the PR drift-check are COMPLEMENTARY, not redundant: the
  marker is imperative + unconditional (regen on any branch, with no open PR, a
  force-refresh, or a pixel change that arrives via a non-gated path such as a
  Playwright/font/dep bump), while the drift-check is PR-diff-reactive + path-
  gated. The genuine duplication is the CAPTURE logic, which PR 2 (after the user
  renegotiated the "do not edit update-screenshots.yml" constraint) extracted
  into a shared reusable `workflow_call`, `screenshot-capture.yml`, that BOTH
  `update-screenshots.yml` and `pr-drift-check.yml` call, so they can never drift
  on how pixels are generated or how nondeterminism is caught. The commit logic
  stays per-caller (marker-commit vs approval-gated commit), since the two differ.
  Retirement of the marker is deferred, not denied: now that the shared capture
  is collapsed into one place, reconsider dropping the marker once the drift-check
  has real-PR mileage (keep `workflow_dispatch` regardless). That is a PR 3
  candidate.

### Deferred from: code review of spec-pr-drift-check (`/bmad-code-review`, 2026-07-13)

- **The `screenshot-approval` environment fails OPEN if it is deleted or its required reviewer is removed.** Referencing an undefined GitHub Environment auto-creates it with no protection rules, so `commit-on-approval` would then run with no human gate and auto-commit on every drift. The workflow cannot detect an unprotected environment from within a run, so this stays a repo-configuration invariant (documented in the workflow header as a PREREQUISITE). Mitigation if it ever bites: an org-level environment policy, or a preflight job that calls the REST API (`GET /repos/{o}/{r}/environments/{name}`) to assert `protection_rules` includes a required-reviewer rule and hard-fails otherwise. (Low; the maintainer configured the environment, and the header flags the risk.)
- **Fork-PR advisory comment is a silent no-op.** A `pull_request` from a fork gets a read-only `GITHUB_TOKEN`, so the sticky comment 403s and is swallowed by `continue-on-error`; the fork author sees no drift guidance, and `commit-on-approval` (correctly) never gates on forks anyway. This repo's PRs come from same-repo `claude/*` branches, so it does not bite today. Follow-up if forks become common: post the drift guidance via a `pull_request_target`-scoped commenter, or surface it in the check summary instead of a comment. (Low; repo uses same-repo branches.)

### Deferred from: code review of pr-drift-check marker skip (`/bmad-code-review`, 2026-07-13)

Change: `pr-drift-check.yml` now skips the Playwright capture when the PR head
commit carries `[update-screenshots]`, since `update-screenshots.yml` runs the
same capture on the push event (was 2x compute). Two review layers (Blind Hunter,
Edge Case Hunter). Patched in-PR: case-insensitive marker match (to mirror
`contains()`), and the skip is gated to same-repo, non-`main` heads so it only
fires when the backstop workflow actually runs. Residuals parked here:

- **A marker head reached via `opened`/`reopened` (no concurrent push), or after an `update-screenshots` run that hard-failed or committed nothing, has its PR drift check skipped with no regen in that same triggering.** The skip trusts that `update-screenshots.yml` ran and succeeded for this head. Determinism was already verified at the original push that carried the marker, and a hard-failed sibling run stays red on the same head SHA (its checks attach to the PR head commit), so the signal is visible, just not as this workflow's own job. Inherent to any "trust the sibling workflow" dedup and not cleanly detectable from within this run. Revisit only if a skipped-but-undrifted PR is observed in practice. (Low, Edge Case Hunter.)
- **Substring collision: a head commit that merely mentions `[update-screenshots]` in prose (a revert, a workflow-editing commit quoting the marker) trips the skip.** Kept intentionally: the guard must match `update-screenshots.yml`'s substring `contains` exactly, or a stricter word-boundary match would re-introduce the 2x divergence on real marker pushes. For same-repo non-`main` heads both workflows fire together, so they stay consistent. If the marker convention is ever tightened, tighten it in both files at once. (Low, both hunters, intentional.)

### Deferred from: code review of ToneAudioEngine split (`bmad-code-review` adversarial, 2026-07-14, Wave C-1)

Change: `ToneAudioEngine.ts` (831 lines) split into `toneScenes.ts` (data + pure
math), `toneVoices.ts` (synthesis free functions), and the orchestrator class.
Behavior-preserving. Two review layers (Blind Hunter, Edge Case Hunter) plus
Copilot. Nothing left deferred; both findings were patched in-PR:

- Throwaway `AccentNodes` allocation on zoomed-in no-accent scenes, now
  short-circuited before node resolution (`onStep` checks `def.accent !== "none"`).
- **`scheduleStep` NaN on an empty `def.scale`** (Edge Case Hunter + Copilot):
  the else branch indexed `def.scale[degree]` with no length guard, so an empty
  scale would produce a NaN note. Unreachable for the built-in `SCENES` (all 12
  have non-empty scales), but `scheduleStep` is now an exported helper whose
  `SceneDef` param does not constrain the scale to non-empty, so the extraction
  changed the risk profile. Fixed with a behavior-preserving `if (!def.scale.length) return;`
  guard (never fires for the shipped scenes) plus a `toneVoices.test.ts` case
  covering both the finite-frequency contract and the empty-scale short-circuit.

### Deferred from: code review of spec-shard-screenshots-ci (`/bmad-code-review`, 2026-07-13)

- **The a/b determinism guard only catches nondeterminism that diverges between two near-simultaneous, same-environment runs.** Both legs render in the same pinned image within the same time window, so entropy that is stable across the pair but varies run-to-run (wall-clock/date-stamped content, font/driver/locale changes) passes the diff yet still drifts. This is a pre-existing property of the two-run design, not introduced by sharding, and PR #188 already removed the known time leak by mocking the clock. If a future env/time leak slips it, the fix is to seed/pin the varying input in the generator, not to add a third run. (Low; inherent to the guard's scope.)
- **`resolve-image` pin step can throw if Playwright is not a top-level devDependency.** `require('./package.json').devDependencies.playwright.replace(...)` is the fallback when `package-lock.json` has no `node_modules/playwright` entry; if Playwright is only present via `@playwright/test` or under `dependencies`, `.replace` is called on `undefined`. Pre-existing code, unchanged by this PR. Harden with a `?.` + explicit error if it ever bites. (Low; pre-existing, current layout has top-level `playwright`.)
### Deferred from: code review of spec-standard-elevator-dimensions (BMGD 3-layer, 2026-07-12)

All four deferrals from this review were FIXED in the same PR at the owner's ask, so nothing
here needs triage: `Simulation.deserialize` now cross-checks transport overlaps (drops a
later shaft that overlaps a kept one, stacked-walkway exemption preserved); the v5 shaft
widening re-runs idempotently on every load, so a boxed-in kept-legacy shaft heals to canon
once the blocking neighbor is gone; the TDT export report warns when a kept-legacy narrow
shaft would collide at 1994's fixed elevator width; and project-context.md's lot width is
corrected (340 -> 375). One residual is unfixable in-format and intentionally NOT tracked as
work: the 1994 TDT format has no shaft-width field, so a still-boxed 3-wide shaft abutting a
neighbor can never round-trip a TDT export losslessly; the report line is the honest ceiling.
A second condensed review of those fixes confirmed one MEDIUM, fixed same-session: the loader
now clamps stored transport widths to the catalog width (above-catalog is always forged since
no canon width ever shrank), so one corrupt over-wide entry can no longer shadow-drop healthy
transports through the overlap filter; and the export collision warning now covers walkways
and counts drops by emulating the importer's keep/drop rule.

### Deferred from: spec-pixel-8a-crash-fix (2026-07-12)

- Renderer: the ~935 room actors still cost ~16ms of a paused desktop frame on a
  10,344-unit save (ablation in the crash investigation). Batching or culling
  them the way floor/lobby tiles were TileMap-ified is the next big win for
  huge towers on phones. See
  investigations/pixel-8a-fast-speed-crash-investigation.md.

### Deferred from: code review of screenshot-determinism (`/gds-code-review`, 2026-07-12)

- **`pgRefreshUi` depends on the ~160ms UI throttle living in the caller (`main.ts` `update()`), not inside `ui.update()`.** The screenshot runner repaints throttled DOM chrome before capture by calling `ui.update()` / `updateTraffic()` directly, which works only because the `performance.now()`-based throttle guard sits in `GameApp.update`, not in `UI.update`. If that throttle ever moves into `UI.update` (or becomes `performance.now`-based inside it), the direct call would be silently swallowed under stepped frames (a few wall-clock ms), capturing stale chrome with no error. Follow-up if it ever bites: expose an unthrottled `UI.forceUpdate()` entry point for the generator. (Low; fragile invariant, not a live bug.)
- **Scene builders and `assertReady` run against the already-adopted (frozen) clock.** `pgAdoptTestClock` precedes `pgDismissSplash`, `scene.build`, and `assertReady` in `runScene`, and no frames step until the first `settle()`. Every current builder mutates the sim synchronously (places units, `setSim`) and `assertReady` reads synchronous sim state, so this is a non-issue today. But a future builder that needs an engine tick to materialize something would spin to the `waitForFunction` timeout instead of passing as it would under the live clock. Latent constraint to remember when adding scenes. (Low; no current scene affected.)

### Deferred from: code review of spec-stranded-floor-move-ins (2026-07-12)

- Stranded-floor advisory latch is a single tower-wide boolean (`Simulation.strandedNudged`): while any stranded floor persists, a different floor going stranded on a later day emits no new advisory. Widened surface since the latch is now held by the `rentable` scope while the stats modal lists only `leased` floors, so an all-empty stranded slab (invisible in the modal) can consume the one-shot nudge a later leased-and-stranded floor would otherwise get. Consider a per-floor or count-based latch.


_Raw `### Deferred from:` sections appended by the review skills land here.
Triage them into the table above, then delete the raw note._

### Deferred from: code review of story-mobile-pinch-pointer-tracking (`/gds-code-review`, 2026-07-12)

- **Swallowed mouse pointerup outside the window leaks a transient tracker contact (Edge F3).** Mouse-down on the canvas, drag out of the window, release there: no up/cancel reaches Excalibur's canvas listener, so the contact stays tracked and the NEXT one-finger touch press reads as a pinch. Self-heals on the next mouse press (the stable native id overwrites, size stays 1) or a tower swap (`setSim` input reset). Pre-existing in the old `pointers` map; now transient instead of permanent. Follow-up if it ever bites: pointer capture on mouse-down or a window-blur `tracker.reset()`. (Low, pre-existing, hybrid devices only.)
- **Pinch-aborted paint run loses its undo step (Edge F4).** `captureUndo` fires in `onActionDown`; a pinch aborts the gesture without `onActionUp`, so the pending pre-paint snapshot is overwritten by the next gesture's capture and the pre-pinch strip can never be undone (immediate Ctrl+Z still works). Documented overwrite semantics in `UndoHistory.capture`; pre-existing, unchanged by the fix. (Low, pre-existing.)
- **Elevator hover ghost validity ignores dry-run/funds (investigation side finding).** `main.ts` `updateBuildPreview` sets `valid: isUnlocked(kind)` for drag-sized transports, so a desktop hover shows a gold ghost where a drop would refuse. Cosmetic, desktop-only. (Low, pre-existing.)

### Deferred from: saves-modal party ruling (2026-07-13)

- **Tower thumbnails in the Saves dialog, rendered FROM save data.** The save
  already carries every unit, so the modal could draw a small silhouette per
  slot at display time (no new save field, no stored image). Ruled a future
  UI story, owned by UX (Sally's IOU); sizing, caching per savedAt, and the
  cost of deserializing four slots at open time are the design questions.

### Deferred from: code review of story-save-metadata-and-log-tail (`/gds-code-review`, 2026-07-12)

- ~~**Undo/redo trims bulletin scrollback to the save cap (Edge, medium).**~~
  Done 2026-07-12 (owner-delegated party ruling, same day): `LOG_SAVE_CAP`
  now EQUALS the 300-entry ring cap, so saves and undo snapshots hold
  exactly what the live ring holds and no scrollback is ever lost. Roughly
  4-5 KB compressed for a full ring of realistic lines; the forged-input
  ceiling stays bounded by the restore caps (300 entries x 400 chars) and
  the import bomb guard. The undo-only snapshot path was rejected as a
  second serialize behavior to keep in sync forever.

### Deferred from: code review of PR #184 commercial census takeover (`/gds-code-review` + party, 2026-07-12)

- **Congestion-overlay meal invalidation lacks a direct test (Edge, layouts round).** `drawStatsMap` now invalidates on `mealOverlayRevision` for the congestion mode, but no test drives the private render path across a revision bump; `towerEngineMealOverlay.test.ts` covers the sync trigger only. Add one if a TowerEngine test harness ever exists. (Low, coverage.)

- **Closed shutter hides the variety (Blind, visuals round).** `closedShutter` draws a uniform shutter regardless of subtype, so a variety reroll is invisible on a closed venue despite the bake-sig repaint. Acceptable (closed venues reading uniform matches the 1994 feel); revisit only if players report confusion, e.g. tint the shutter with the variety's awning accent. (Low.)
- **Over-capacity arrivals eat uncounted (Edge, visuals round, documented by design).** `customersIn` counts arrived eaters only, so several people can be en route to a venue with one free seat; the extras eat visibly at the venue but never enter the census. Bounded and balanced; the "up to N" cap is on the census, not bodies in the room. Revisit with per-person round-trips if seat reservations ever matter. (Info.)

- **Crowd.reset() strands venue counters (Edge H2 latent).** `Crowd.reset()` empties `people` without decrementing `customersIn`/`outForMeal` on a retained tower. Only tests call it today; any future in-place "reset sim, keep tower" caller strands nonzero counters with no other zeroing mechanism. Guard or zero the counters if such a caller ever appears. (Low, latent.)
- **Eating increment skips state-at-arrival checks (Edge H4).** A venue that vacated, burned, or closed between spawn and arrival still gets `customersIn++` (balanced by the matched decrement; not counted by the census while not `isPresent`). One visible anomaly: eaters spawned just before close count in HUD population while the venue displays 0 occupants. Cosmetic; revisit with per-person round-trips. (Low.)
- **Returners count at the venue until despawn (party Q3, ratified).** Decrement stays in `finish()` (single-drain invariant) so a customer walking home still counts at the venue for a few sim-minutes. Dissolves when per-person round-trips rework the model. (Low, per intent.)
- **Commercial "Counts toward stars" cue missing (Sally, polish).** Hotels get an explicit counts/does-not-count inspector line; commercial venues, which now also count, get nothing. Fold into the existing [[commercial-venue-inspector]] row. (Polish.)
- **Save-slot pop snapshot is time-of-day dependent (Sally, polish).** Saving mid-lunch inflates the slot's pop readout vs the same tower saved at night. Aware, no action. (Polish.)

### Deferred from: code review of tower-wide-meal-cadence (`/gds-code-review`, 2026-07-09)

- **Spawn-vs-updatePresence ordering (Edge F3).** `advanceStep` calls `crowd.spawn` BEFORE `onHour -> updatePresence` runs. On the first tick that crosses into a new hour, spawnFloors sees `u.occupants` from the PRIOR hour. Normally benign because presence was already correct at the previous boundary; the diff's "no explicit isWeekend check needed" claim depends on this invariant, which is not asserted anywhere. Add a targeted regression if a bug ever surfaces on the Saturday-08:00 load edge. (Low, inherited, not caused by this diff.)
- **Day-0 breakfast bulletin silently skipped (Edge F5).** The sim starts at exactly 07:00, so `dayOfKind = floor((420 - 420)/1440) + 1 = 1` and `absMinute = 1860`; a first tick that stays under 1860 minutes cannot fire the breakfast bulletin. Consistent with the strict-after semantics the shipped lunch code has (lunch DOES fire day 0 because noon > 07:00). Documented behavior; breakfast fires from day 1 onward. (Low, inherited.)
- **Post-dinner 2.26x pacing sprint (Edge F6).** The 18:30-21:00 sub-period runs at 1.25 min/frame (2.26x normal) because the dinner-crawl budget is carved out of the shipped 400-frame 17-21 block. Real-time-to-simulate is invariant; the player watches the clock lurch after the dinner crawl ends. Design consequence, not a bug. Consider a bigger day budget as a follow-up if the lurch reads awkward in playtest. (Low.)
- **Bulletin misses on huge-frame multi-day catch-up (Edge F7).** A single tick spanning multiple days (background tab catch-up frame) computes `dayOfKind` for the FIRST meal-hour crossing only; days N+1..N are silently missed. Exists in original lunch code; the diff inherits it for all three meals. (Low, inherited.)
- **Evening flow dilution by dinner-window meal options (Edge F8).** At 17:00 (t=0 in dinner) meal options add ~12 options per spawn call vs 3 existing evening options, so the pre-diff evening flow (office->1, home<-1, venue<-1) gets ~20% probability during the overlap. Documented intent (aggregate flow, one pool), but the class of evening behavior IS materially different from pre-diff. Playtest and re-tune weights if a healthy tower's satisfaction dips through the overlap. (Low, per intent.)
- **`filter().map()` allocation per pushMealOptions call (Edge F10).** Up to 8 pushMealOptions calls per outer sim step; each allocates a filtered+mapped copy of `staffFloors`. In a 100-staff-floor tower that's 800 iterations per step for a bin that changes shape only across the two hourly boundaries 08:00 and 19:00. Cache the on-shift subset per outer step if a profiler ever flags it; negligible today. (Low, perf.)

### Deferred from: retail-subtypes-and-variety scope split (`/gds-quick-dev`, 2026-07-09)

Owner split the retail-subtypes-and-variety spec at CHECKPOINT 1 to keep the shipping PR under the token ceiling. PR-A ships the retail-subtype engine seam + TDT round-trip + inspector title + "Change variety" reroll (closes backlog `retail-subtypes`). PR-B is deferred; both items below are cleared to start immediately AFTER PR-A merges, since they read `Unit.subtype` on retail and share no engine surface with each other.

- **`facility-visual-variety` (P3, idea, remains open).** Same-kind rooms look a little different. Retail sprites read `u.subtype` for a per-variant palette (11 shop / 5 restaurant / 5 fast-food shades). Office/hotel*/condo sprites derive a stable per-unit variant from `hash(u.id)` at render time (never stored, no engine impact). Model: `src/render/excalibur/pixelSprites.ts:267` condo wall-color pattern (already reads `hash(u.id)`); extend to `src/render/excalibur/TowerEngine.ts:1444` sprite-cache `sig` so a rerolled subtype re-bakes. Cosmetic-only. No save impact. Version bump patch.
- **`commercial-venue-inspector` (P2, idea, remains open).** Adds four optional unit fields (`patronageToday/Yest`, `profitToday/Yest`) on shop/fastFood/restaurant only, serialized via the `filmPolicy` optional-field seam (no `SAVE_VERSION` bump). Accumulation lives at `src/engine/EconomySystem.ts:161-168` (next to the `u.pendingIncome += hourly` line). Daily rollover at `src/engine/Simulation.ts:onDay` (`patronageYest = patronageToday; patronageToday = 0` for retail, same for profit). Inspector card grows: "Today's Patronage" (count + colored bar), "Yesterday's Profit" ($), reasoning tier (3-band: `<0.5 => "Very few customers"` red / `0.5-1.2 => "Business is average"` neutral / `>1.2 => "Business is booming"` green, against a per-kind baseline derived from `ECON.dailyTrafficIncome[kind] / assumedSpendPerCustomer`), and (only when `sim.weather === "rain"`) "Rain might cause fewer customers." Note: `trafficAppeal()` at `src/engine/EconomySystem.ts:180-195` does NOT factor weather today (rain enters as `rainMult` per unit inside `collectTrafficIncome`), so the weather line is a descriptive display of an existing per-unit effect, not a new mechanic. Version bump minor.

### Deferred from: code review of classic-calendar-parity (`/gds-code-review`, 2026-07-08)

- **999-year day-counter roll unimplemented.** Canon (`docs/canon/tdt-format.md` §3, GDD §0) says the day counter rolls at 11,987 (999 years); our `Clock.year = floor(day / yearDays)` grows unbounded with no wrap, so a tower run for 999+ canon years (≈11,988 days) shows Year 1000+ where the real game wraps. Out of the GDD §5 acceptance scope and not player-reachable in normal play (12-day years, but still ~33 real-days of play at fast speed); flagged by the Acceptance Auditor for completeness. Add a wrap in `Clock.day`/`year` (and confirm the TDT export clamps `currentDay` to the same modulus) if it ever matters. (Info/Low.)
- **Weekend-phase model is trailing-slots only.** `Calendar.weekendDays` sets how many TRAILING day-slots are the weekend, so the model cannot express a NON-trailing canon weekend (slot 0 or 1). The canon "2 weekday + 1 weekend" week is naturally trailing, so this is only a problem if the owner harness-validation (task on the `classic-calendar-parity` row) finds the retail game phases the weekend on a non-trailing slot; then add an explicit weekend-phase offset to the Calendar + Clock arithmetic. Contingent on the harness result. (Auditor, Low/contingent.)

### Deferred from: code review of TDT import trailing-structure fix (`/bmad-code-review`, 2026-07-08)

- **Silent stair loss (no warning on locate-failure).** PARTIALLY ADDRESSED (Copilot re-review 2026-07-08): the clear truncation case (file ends right after the elevator table, before finance) now warns in `walkTolerantTail`. Still open for a non-truncated file: `locateStairs` (`src/storage/tdtFormat.ts`) returns `[]` both when a tower genuinely has no stairs AND when it fails to locate a real table; the old code pushed a player-visible "stairways and escalators stayed behind" warning on truncation. There is no reliable signal to distinguish the two (the scan is anchor-on-a-built-record). The scan is reliable on the one real sample; revisit with a truncation heuristic (e.g. warn if elevators decoded but the file is implausibly short for its content) if a real save ever shows a false-negative. Confirmed by Blind + Edge Case hunters (Med).
- **Per-car 348-byte term unverified.** The elevator record stride `3140 + 324*servicedFloors + 348*cars` is validated end-to-end only against my_tower.TDT, whose 3 shafts are all cars=1, and the fixture pads with the SAME formula (self-referential), so no test independently pins the 348 per-car size (or the 3140 base). Verify against a real save containing a MULTI-CAR built shaft before trusting exports/imports of many-car towers. Confirmed (Low, coverage gap).
- **`locateStairs` max-built scan is a heuristic, not a guarantee.** It picks the 64-record window with the most in-range built records; a coincidental later region (e.g. the §11 lobby/reachability 528x6 table, or §12 named-tenant bytes) could theoretically out-count a small real table and import phantom flights. Mitigated in practice (my_tower with those trailing blocks imported exactly 6 correct flights; parking's stall bytes inject rejecting values; window tightened to 4 KB; x>=1 rejects the common `01 00..` garbage). Harden with a contiguity/cluster check or calibrate against more real saves (esp. a low-stair-count tower with populated trailing blocks). Suspected (Edge Case hunter, Med).

### Deferred from: splash-on-cold-reopen (`/bmad-code-review`, 2026-07-08)

- **A newly founded tower (New Tower) lands at play speed, not paused.** From the
  splash, New Tower → `dismiss()` runs `teardownSplash()` → `pauseForSplash(false)`
  → `setSpeed(1)`, and `SaveLoad.newGame` (`src/game/saveLoad.ts`) never sets a
  speed, so the fresh tower begins ticking at ▶. Every other boot outcome
  (Continue, same-tab reload, post-update reload) deliberately lands paused. This
  is pre-existing (first-run New Tower already did it) and harmless (an empty
  tower loses no game-hours), so it was not patched in this PR. If we want "every
  boot lands paused" to be uniform, have `newGame` (or the splash New Tower path)
  `setSpeed(0)`. Type: review-deferral, Severity: low. (Edge Case Hunter, splash
  cold-reopen review.)

### Deferred from: code review of story-e1a-platform-port (`/gds-code-review`, 2026-07-08)

- **Native export feedback is wrong-shaped for the platform port.** `exportGame`
  (`src/game/saveLoad.ts:168-170`) toasts "Tower exported (X KB). Check your
  downloads." synchronously, before the port's async `saveFile` settles. Inside
  a native wrapper that means contradictory toasts on failure (good toast, then
  the "Couldn't save your tower file" bad toast), a "Check your downloads"
  message for a share sheet the player may have just cancelled, and copy that
  is wrong for a share/save flow even on success. Browser behavior is
  unaffected (its saveFile is synchronous-resolve and never rejects), which is
  why this is deferred and not patched: the fix (await the port, pick copy per
  `isNativeWrapper`, decide cancel semantics) is native-UX design that belongs
  with E3b (native bridge shell) in the mobile-distribution epics. (Edge Case
  Hunter, E1a review.)
- **The real native-mode resolution path is unreachable from vitest.** Two
  surfaces share this hole: `getPlatform()` in `src/platform/index.ts` (E1a)
  and the `registerPWA` guard in `src/pwa.ts` (E1b). Both read
  `import.meta.env.MODE`, which vitest pins to `"test"`; both use `vi.stubEnv`
  in their unit tests, which is an honest simulation but not the compile-time
  constant a `--mode native` bundle would carry. A mode-string rename or env
  misread on either surface would ship as a permanent silent fallback to
  browser behavior. Covered operationally by E1c, whose acceptance includes
  verifying the `--mode native` bundle through a local static server; keep
  that check when E1c lands and observe BOTH resolution paths (analytics
  platform port and PWA gating) end-to-end. (Blind Hunter + Edge Case Hunter,
  E1a review; extended by the E1b review's Acceptance Auditor.)

### Deferred from: code review of breathing-clock wire-up (PR #154, `/gds-code-review`, 2026-07-07)

- **Backgrounded-tab burst simulation is amplified by night pacing (pre-existing
  class, wider now).** `main.ts update()` accrues `accMinutes` from raw `dtMs`;
  Excalibur clamps a >200 ms frame down to 1 ms, which bounds ordinary hitches,
  but the pacing multiplier (up to 3.25x at night) scales whatever burst does
  get through, and any `accMinutes` overflow past the 2000x20-min guard carries
  into later frames as a fast-forward. Watch-only: verify Excalibur's clamp
  covers the tab-restore path on real devices before adding any `accMinutes`
  cap of our own.

### Deferred from: code review of the .TDT importer (2026-07-07)

- **Structure-aware shaft placement for imported towers**: `synthesizeTransports`
  (`src/storage/tdtImport.ts`) places every shaft in one x-run around the GLOBAL
  horizontal center of the built extents, so an asymmetric silhouette (full-width
  base, narrow upper floors) can leave a synthesized shaft spanning floors with no
  structure at its column, a state `Tower.validateTransport` forbids on the build
  path but `Simulation.deserialize` doesn't police. Harmless to the sim (dispatch
  ignores structure) but visually a floating shaft the player must bulldoze/rebuild.
  Fix idea: choose each band's x from the intersection of its own floors' extents
  (falling back to the widest floor), or clamp the band to floors whose extent
  covers the chosen column. Note: since the canon doc v2 landed, real saves decode
  their shafts directly, so this mainly concerns the synthesis FALLBACK for corrupt
  or truncated files; a decoded shaft with a corrupt x can also land over unbuilt
  columns (the decode clamps to the lot, not to structure). (Edge Case Hunter,
  .TDT importer review, both rounds.)

### Deferred from: traffic-indicator fix (PR #141, `/gds-code-review`)

- **Traffic chip's hotspot floor can jitter and spam the `aria-live` region on
  near-tie crossings**, `updateTraffic` (`src/main.ts`) recomputes
  `peakCongestionFloor()` raw each ~160ms tick with a strict-`>` argmax. The tier
  word is hysteresis-smoothed, but the floor suffix is not, so two floors at
  nearly-equal congestion whose curves cross flip the label `Backed up · 42F` ↔
  `· 47F`, and because `#traffic` is `aria-live="polite"` every flip re-announces
  the whole chip to screen readers. Fix direction: move the floor number out of
  the live region (announce the tier word, not the floor), or debounce the shown
  floor. Plausible-not-certain (needs genuine near-tie crossings; exact ties are
  stable). a11y polish, low severity.
- **Multi-tier upward jumps enter the higher tier ~0.02 congestion early**,
  the hysteresis up-guard indexes `B` by the current tier, not `raw-1`, so a
  0→2 or 1→3 jump validates against the lower boundary's deadband. Pre-existing
  behavior (not introduced by this change), no flicker, ~0.02 calibration
  asymmetry. Negligible; noting for completeness.

### Deferred from: gds-code-review E3.1 (parking ratio + one-car sprite), 2026-07-07

- **Dev sprite catalog stretches parking to the cell width**, `gallery.ts:144`
  (`w≈292`) and `preview.ts:79` render `drawParking` at the full catalog-cell
  width, so the new single-stall parking sprite reads as one small car adrift in
  a wide empty bay. Dev-only tooling (not player-facing), cosmetic. Fix (optional):
  render parking at its true `u.width * TILE` footprint in the catalog rather than
  stretching to the cell. _Note: relevant when the E1b width change (parking 6→4)
  lands and screenshots regenerate, revisit the sprite-gallery shot then._

### Deferred from: gds-code-review E4 (mobile floor/lobby drag-paint), 2026-07-07

- **Jittery touch tap with floor/lobby can over-paint one adjacent tile**, the
  "action" path has no movement slop (`TowerEngine.pointerMove` fires
  `onActionMove`→`paintFloorRun` on any movement), while the pan-tap path allows
  14px. So a touch tap that jitters across a tile boundary lays the anchor strip
  **and** one extra adjacent tile. Low: floor/lobby runs are contiguous by intent
  and cheap, and the deferred anchor still lays exactly one strip on a pure
  (no-move) tap. Fix if it annoys: gate `paintFloorRun` behind a small on-touch
  movement threshold mirroring the tap slop. (Blind Hunter finding 2.)

### Deferred from: gds-code-review (mobile tap lays the full brush strip), 2026-07-08

- **A browser `pointercancel` on an unmoved touch press commits the tap
  placement**: Excalibur routes `cancel` into the same handler as `up`
  (`TowerEngine.bindInput`), so `onActionUp` treats a system-cancelled press
  (edge-swipe takeover, notification, palm rejection) as a deliberate tap and
  stamps the brush strip; the same routing also lets a cancel commit an
  in-progress elevator drag. Pre-existing shape; the brush change raises the
  stake from 1 tile to 8. Fix when touched next: thread a `cancelled` flag
  from the engine's cancel event into `onActionUp` and drop the tap commit
  (and transport commit) on cancel. (Edge Case Hunter, 2026-07-08.)
- **A pinch that interrupts a just-seeded paint drag escapes undo**: press,
  one move (strip stamped), then a second finger: the pinch branch nulls the
  gesture, `onActionUp`/`commitUndo` never run, and the next gesture's
  `captureUndo` overwrites the pending pre-strip snapshot, so the strip joins
  no undo step. Pre-existing undo-capture shape on the pinch-cancel path;
  stake raised from 1 tile to the brush strip. Fix when touched next: commit
  the pending undo capture when a pinch cancels an action gesture.
  (Edge Case Hunter, 2026-07-08.)
- **Version bumps can leave `package-lock.json` behind**: the 1.11.0 bump
  landed in `package.json` only (lockfile stayed at 1.10.1) and was resynced
  incidentally by the 1.11.1 PR. Process note: bump with `npm version
  <x.y.z> --no-git-tag-version` (or run `npm install` after editing) so both
  files move together; consider a CI assert that the two versions match.
  (Blind Hunter, 2026-07-08.)

### Deferred from: party-mode chrome restructure, 2026-07-12

- **`colorblindCue` pref has no UI**: the Prefs field ships (default on, gates
  optional color-redundant markers) but nothing exposes it. The new Settings
  dialog is its natural home; exposing it deserves its own story with a demo
  of the gated markers and copy that explains what changes. (Party decision,
  2026-07-12.)

### Deferred from: gds-code-review (rain shaping / overview doubling), 2026-07-12

- **The overview melody doubling passes through the 650 Hz distance lowpass**,
  which attenuates the upper half of its 523-1975 Hz range by roughly 9-19 dB
  (the band it exists to supply for phone speakers). Empirically the effect
  still lands (500-2000 Hz energy rose 5.6x zoomed out in the built app), so
  shipped as is; if phones still read as too quiet zoomed out, route the
  doubling dry to the music bus like the rain layer, at the cost of dodging
  the reverb/scene mix. (Edge Case Hunter, 2026-07-12.)

### Deferred from: bmad-code-review (settings modal), 2026-07-12

- **The splash can no longer reach the sound/accessibility controls**: the
  Help dialog (openable from the splash's "How to Play") used to host the
  volume sliders and the Reduced motion / Steady clock toggles; they moved to
  the Settings dialog, whose only entry (`btn-settings`) sits behind the
  splash's focus trap. A motion-sensitive player without the OS-level
  `prefers-reduced-motion` (which still forces the pref and tames the splash)
  cannot enable the user override before dismissing the animated splash. Fix
  when touched next: a small Settings affordance on the splash, or hoist the
  Reduced motion toggle there. (Edge Case Hunter, 2026-07-12.)

### Deferred from: bmad-code-review (persisted volume settings), 2026-07-12

- **Cross-tab prefs writes are whole-object last-writer-wins**: `savePrefs`
  rewrites the entire `vc.prefs` blob from a per-tab in-memory copy loaded
  once at boot, so a write from tab A (e.g. the debounced volume save) can
  revert a newer field written by tab B (e.g. mute). Pre-existing shape for
  reducedMotion/steadyClock; the volume feature adds three fields and a
  200ms trailing debounce that widens the window slightly (pagehide flush
  bounds it). Fix when touched next: read-merge-write inside `savePrefs`, or
  a `storage`-event listener that folds remote changes into `this.prefs`.
  (Edge Case Hunter, 2026-07-12.)

### Deferred from: bmad-code-review (test-reorg infra, PR #229, 2026-07-13)

Two-tier Vitest projects (unit + integration) plus the colocation pilot. Blind
Hunter and Edge Case Hunter ran (Copilot also reviewed). The confirmed findings
were all patched in the PR: the drift-check path filter now excludes colocated
`*.test.ts`; the stale CONTRIBUTING/copilot docs were corrected; and the `unit`
project's `exclude` now spreads Vitest's default excludes back in before adding
`**/*.integration.test.ts` (Blind Hunter and Copilot both noted that a bare
project `exclude` drops the built-in `node_modules`/`dist` excludes; unreachable
today under the `src/**`-scoped include, but cheap to harden). One low residual
parked here:

- **Nothing enforces the `.integration.test.ts` naming convention.** Tier
  membership is decided purely by the filename suffix, so a mistyped suffix
  (`.integrations.`, `.integration.spec.ts`) silently lands a heavy multi-module
  test in the `unit` project. The full `vitest run` gate still executes it, so it
  is never lost, but it defeats the tier split and can blow the unit tier's
  timing assumptions. Consider a small naming check (a guard test or lint rule)
  as the per-area colocation reorg spreads. (Blind Hunter, Low.)

## Completed / superseded

- ~~**P2, `service-elevator-width`: standard (3) vs service/express (4) footprint mismatch**~~,
  resolved 2026-07-12 in spec-standard-elevator-dimensions, in the OPPOSITE direction from
  the row's proposal: the owner ruled the 1994 canon footprint is **4 tiles for standard AND
  service** (the earlier 4->3 narrowing was the mistake; it existed only to fake a square car
  at the 34px floor height, and it made every TDT import land standard shafts one tile
  narrower than the real save). `elevatorStandard.width` is back to 4, the render floor
  height went 34->44 so the 4-tile car stays square, and save v5 (`upgradeV4toV5`) widens
  legacy 3-wide shafts in place (grow right, else left; boxed-in shafts keep legacy width).
  Golden fixture: the owner's SixSeven tower (9 legacy shafts, all widen cleanly).

- ~~**P1, `deserialize` crashes on a `null`/malformed unit or transport entry (condo-modes)**~~
 , fixed in #134: `u != null`/`t != null` guards before the `isFacilityKind` filter,
  plus an `Array.isArray(...)` container guard (a bmad-code-review Blind Hunter catch, a
  forged non-array `units`/`transports` still threw), with corrupt-save tests. A corrupt
  save now drops the bad entries and loads instead of hard-crashing.
- ~~**Party Hall two-story footprint + v5->v6 migration (gds-code-review)**~~, done
  2026-07-13: catalog `floors: 2`, and `migrations/v5tov6.ts` expands each legacy
  one-story hall in place, else relocates it to the nearest supported two-story
  slot (attaching to existing structure, never onto a lobby concourse or bare
  lot), else drops it with a bulletin line. The adversarial review's confirmed
  findings were all patched in-session: the ground-concourse straddle and
  sky-lobby overlap are blocked (`lobbyCols` in `spanClear`); the v1->v2 reflow no
  longer discards itself over a phantom two-story overlap (`storiesAtVersion`
  treats the hall as one story pre-v6); the runtime validity net (drop-all-halls
  fallback) is delta-based so a pre-existing overlap is never blamed on the
  migration. Accepted trade-off (not a defect): a boxed-in hall may relocate to a
  distant floor or the basement and needs its transport reconnected; the drop is
  a one-shot last resort that does not restore the hall if space is later freed.
- ~~**P2, `QuotaExceededError` unhandled on the pre-reload save paths (pr-110-compress-saves)**~~
 , fixed here: `recoverFromContextLoss` now guards its pre-reload flush and, on a storage
  failure, shows the boot card (Reload button) instead of letting the throw abort the reload
  and strand the player on a dead GPU canvas. A failed `setItem` is atomic (never clobbers),
  so any prior autosave survives; the update path was already guarded in `main.ts`
  (`saveBeforeUpdate` throws → the update pauses rather than reloading). Both paths covered
  by tests.
- ~~**#129 GitHub-template deferrals (PR-template mode guidance; security/docs issue path)**~~
 , shipped in #129: the PR template's "Game mode impact" section is self-contained (no
  `AGENTS.md` dependency or merge-order requirement), and `SECURITY.md` + a
  private-vulnerability-reporting link + a `documentation.yml` issue form were added. The
  remaining one-time label-creation step is tracked as an open row in the table above.
- ~~**Out-of-band legacy condo prices aren't re-clamped on load**~~, fixed in
  #123: `deserialize` clamps an unsold condo's `rent` into the re-anchored
  `ECON.rent.condo` band; sold condos are left untouched so buy-back mirrors the
  historical sale price. `everOccupied` is coerced to a strict boolean on load.
- ~~**`floorHeatmap` recomputes the spatial congestion map once per built floor
  (O(F²))**~~, fixed in the congestion-overlay PR: the branch builds
  `spatialCongestionByFloor()` once and reads each floor from it.
- ~~**`hasSave()` ≠ `load()` for an unreadable present save**~~, done
  2026-07-04: `SaveGame.loadResult()` distinguishes absent from
  present-but-unreadable; boot snapshots readability once and uses it for both
  the splash and the "new tower" confirm; emits a bulletin before starting
  fresh; `preserveUnreadable()` backs up unreadable bytes at boot.
- ~~**Inspector card re-shows on continued hover after ✕-dismissal**~~, done
  2026-07-02: `inspectDismissed` latch in `main.ts` keeps the card closed while
  the pointer keeps picking the same facility; spent as soon as the pick moves.
- ~~**`escapeAttr` used for text content / raw engine-string interpolation**~~,
  done 2026-07-02: single shared `escapeHtml` in `src/ui/escape.ts`; the
  previously raw user-controlled `u.label` in the inspector card is now escaped.

### Deferred from: code review of E1 pixel-art shared language (`/gds-code-review`, 2026-07-14)

Change: E1 adds the finalized `person()` build family, `moodTint`, new `PAL`
keys, and the shared helpers (`windowView`, `roomGlow`, `ceilingFixture`,
`dado`, `castShadow`) to `pixelSprites/common.ts`, plus the food/shop
look-table splits into `food.looks.ts` / `shop.looks.ts`. Three review layers
(Blind Hunter, Edge Case Hunter; the Acceptance Auditor timed out, and its
spec-conformance scope was independently re-verified by the Edge Case Hunter:
build heights 15/18/24/17/22, new `PAL` keys vs the art bible, byte-identical
look data, barrel surface). Patched in-PR: the width-6 leg-gap bug (fixed leg
columns), the `windowView` `lit` inversion plus night-gating of the city
lights, the `RESERVED_COLORS` docstring overstatement, and per-wrapper build
tests. No residual defers: the one Edge Case Hunter parking item (the exported
`personFigure` / `dado` / `ceilingFixture` passing a bare color into `shade()`,
which yielded `rgb(NaN,...)` for a non-hex argument) was patched in-PR after
Copilot raised the same point on the PR. `shade()` now returns a non-hex
argument unchanged, so those helpers degrade gracefully; every shipped caller
still passes a `#RRGGBB` literal, so current output is byte-identical.

### Deferred from: code review of E2 pixel-art tenant rooms (`/gds-code-review`, 2026-07-14)

Change: E2 ports office, condo, and the three hotel grades to the ratified
page-02 warm-dollhouse composition. New `pixelSprites/dollhouse.ts` (the
composition primitives `fill`, `bevelBox`, `glow`, `interiorWall`,
`ceilingCap`, `downlights`, `plankFloor`, `curtain`, `framedArt`) and
`pixelSprites/residential.looks.ts` (the wall and picture look tables, re-tinted
to warm variants held within 10 per channel of each anchor); `residential.ts`
rewritten to compose the shell over the shared E1 helpers (`windowView`,
`dado`, `ceilingFixture`, `roomGlow`) and to adopt `personSeated`.

All three adversarial layers ran to completion (Blind Hunter, Edge Case
Hunter, Acceptance Auditor). Patched in-PR (10 findings). Two from the final
review pass: the suite coffee table drawn at the bed origin
(`x + suiteSofaW + 14`) and fully occluded by the bed painted afterward, so a
spec-required suite element rendered zero pixels (moved into the sitting area,
in front of the sofa, where it is visible and clear of the bed); and the condo
study's bottom book-spine row overflowing the bookcase by 1px onto the floor
line (rows anchored at `railY - 1` so all four 3px rows end at `floorY - 1`).
The Edge Case Hunter found no genuine unhandled edge cases. The earlier eight:
the 1px unpainted seam at row `y+3`
between the ceiling cap and the interior wall (interior wall now butts under
the cap at `y+3`, with the downlights/ceiling fixture drawn over it); the
misleading `cueTop` comment plus its single-use indirection (the asleep "z"
baseline is now inlined at `floorY - 10`); the duplicated suite `sofaW`
(hoisted to one `suiteSofaW`); the conditional `globalAlpha` reset in `fill`
(now unconditional, matching its docstring); the hotel asleep sleeper gating
on raw `u.occupants` (now `visibleOccupants(u)`, matching office/condo and the
file's occupancy contract); the asleep "z" not gated on occupancy while the
sleeper figure was (now both gated on `visibleOccupants(u) > 0`, so an empty
bed never shows a "z"); the narrow-meeting chair count that could over-claim a
seat (`Math.max(2, ...)` to `Math.max(1, ...)`, so seated never exceeds the
chairs that fit); and a documenting comment that a hotel has no vacancy shell
by design (state "empty" reads as ready-to-rent, the ready lamp lit, which the
shipped `sprites.test.ts` already pins).

No residual defers. Dismissed as intended-by-design or already-guarded: the
window off-rect math for sub-production widths (guarded by the `fill` /
`windowView` min-1 clamps, and production room widths are fixed at 44/66/99/
110/176px); the office downlights keying on occupancy rather than `d.lit` (the
spec I/O matrix wants downlights off for an empty office, with the empty-at-
night scrim handling the dim); the per-layout seat caps differing by geo
layout (the spec caps seated figures at the layout's seats, and the executive
corner is ratified as one exec plus two cubicles); the `w > 44` exclusion of
the single-grade ceiling light and framed art (mirrors the build's `if(W>44)`
at page-02 lines 50 and 54, the pixel-exact port reference; the single is the
deliberately plainest grade); the meeting worker drawn after the table
(matches the reference build's draw order); the hotel asleep sleeper drawn
inside `maybeMirrored` (the Code Map at spec line 104 directs it to stay in the
`bed` closure so the sleeper's head tracks the flipped headboard; only the
corner state cues, tray, ready lamp, and the "z" text, must be pixel-identical
across the mirror, and those do draw outside); the asleep "z" x-position being
flip-compensated (`zx = flip ? 2*x + w - zSrc - 5 : zSrc`) rather than literally
identical (it must float over the flipped bed, and it still draws outside the
wrapper so the text is never backward; the "identical pixels" AC wording is
imprecise); and the extracted `residential.looks.ts` tables and `dollhouse.ts`
helpers not being re-exported through the `pixelSprites.ts` barrel (they are
consumed directly by `residential.ts` and its test, have no cross-module barrel
consumer like the food/shop look tables do, and the `barrelSurface.test.ts`
deliberately curates a minimal barrel surface, so re-exporting would add dead
surface against an intentional guard).
### Deferred from: E5 pixel-art utilities and service (`/gds-code-review`, 2026-07-14)

Change: E5 enriches the seven utilities-and-service looks (recycling, metro,
medical, security, housekeeping, parking, parking ramp) by porting each from its
pixel-exact Figma reference build script through a shared `refMap` scaler, maps
every figure to the finalized `person()` family (`personSeated` guard,
`personStanding` nurse/doctor/housekeeper with a white-coat overlay for medical
staff, `personHiVis` recycling hand), keeps the `recycleFill` pile plus green /
amber / red FULL gauge and the `parkingUse` / `parkingDead` car gate, and splits
`service.ts` into `service.ts` (five interior kinds), `garage.ts` (parking and
ramp), and `serviceKit.ts` (shared port helpers).

- **Metro real-commuter platform crowd (follow-up, depends on the people-system
  traffic seam).** This PR removes the `scatterPeople` ghost crowd from
  `drawMetro` and leaves the baked platform empty, per spec. The real routed
  commuters are meant to ride the redraw overlay that the people-system traffic
  seam owns (walkers at the 24px scale, tinted content then amber then stress red
  by wait). That overlay is not landed here; when the seam ships, wire the metro
  platform crowd to it. Until then an empty tower correctly shows an empty
  platform. Type: review-deferral / feature-dependency.
- **Party-hall `scatterPeople` retirement is out of scope here.** `drawPartyHall`
  in `facilities/venue.ts` still calls the ghost `scatterPeople`; that retirement
  belongs to the food-and-entertainment spec, not this one. Noted so it is not
  lost.

Review findings (`/gds-code-review`, three layers). The Acceptance Auditor
returned compliant on every pinned constraint (reserved colors, the
`recycleFill` gauge, the `parkingUse` / `parkingDead` gate, no ghost crowd,
figures mapped to the shared family, integer coordinates, no per-frame scan, no
lease card). Patched in-PR: the `refMap` zero-size guard (a genuine 0-size
reference rect now paints nothing instead of being floored to a stray 1px, which
removes both the empty-gauge green sliver and the ramp-foot void pixel and
restores reference fidelity), `Number.isFinite` normalization of `recycleFill`
and `parkingUse` (a non-finite input can no longer blank the pile/gauge or
silently suppress a car), and a tightened metro test that now also asserts no
skin-tone figure of the finalized family is baked. One defer:

- **Fixed-size figures do not scale with the room rect at non-bake sizes
  (follow-up, people-system figure scaling).** The shared `person()` builds and
  the `whiteCoat` overlay draw at native 1x at a scaled anchor, so at the
  canonical bake size (`w === RW`, `h === RH`, identity map) they align with the
  furniture exactly, but at a non-identity rect the figures keep their pixel size
  while the furniture scales. The real render bakes at identity, so this is not a
  live defect; fixed-size character sprites are also the intended pixel-art
  behavior. Captured so that if the people-system traffic seam ever composites
  figures at a non-bake scale, figure sizing is handled there, not re-derived per
  facility. Type: review-deferral / render-consistency.

## E9 integration (PR #266): cross-cutting review defers and shipping followups

The six art epics merged into the integration branch and shipped as one overhaul
PR. Two defers came out of the cross-cutting `/gds-code-review` over the whole
integrated diff, and a set of E6 art-quality followups were split out so the
strong overhaul (E2 through E8) could ship without waiting on the E6 polish.

Cross-cutting review defers (both log-only, integration was otherwise clean):

- **Wedding-hall composition test lives in `sprites.transport.test.ts`.** After
  the `sprites.test.ts` split, the wedding-hall paint test sits in the transport
  sibling file. Harmless (it is grouped with structure and event coverage) but an
  odd home for a venue test. Relocate to `sprites.test.ts` next time these files
  are touched. Type: test-organization.
- **Reserved-color / integer-pixel sweep does not cover the venue kinds or
  cinema.** The `sprites.test.ts` guard sweeps the seven service kinds but not
  `partyHall` / `weddingHall` (in `venue.ts`) or `cinema`, which only get
  occupancy and paints-without-throw assertions. Venue colors were verified by
  hand at merge, but a guard over the venues would harden the merge-resolved
  `venue.ts` against future edits. Add a venue reserved-color guard next touch.
  Type: test-coverage.

E6 structure and transport art followups (owner-flagged from live play, split
into a fast-follow so the overhaul could ship). E2 (offices, hotels, condos) and
the other kinds read well in game; these are contained to the ground lobby and
the stair / escalator sprites:

> RESOLVED on branch `claude/pixelart-e6-followup`: the ground-lobby receptionist
> repeat, the sky-lobby night glare, the stair and escalator geometry, and the
> grand-entrance prominence are all fixed in that PR. The gallery multi-floor
> sizing shipped in part 1 of the same branch. Review defers from that PR are in
> the "code review of E6 structure/transport art followup" section below.

- **Ground lobby repeats the seated receptionist at every fourth tile.** The
  lobby tiles four baked variants by `x % 4`, and variant 1 is a staffed
  reception desk (`receptionDesk` with `personSeated`), so the same attendant
  reappears every four structural tiles across a wide concourse. A staffed
  reception is a once-per-lobby feature, not a tiling motif. Move the reception
  desk and attendant out of the repeating cycle (into the grand-entrance tile,
  which is placed once), and make variant 1 a tile-friendly architectural element
  (a wall panel or bench) instead. `src/render/sprites/structure/lobby.ts`.
- **Stair flight geometry reads badly.** `drawStairFlight`
  (`src/render/sprites/transport.ts`) renders a broken, jagged diagonal that does
  not read as a clean staircase and sits awkwardly over the lobby floor. Rework
  the flight so the treads, risers, stringer, and handrail compose a readable
  staircase at play zoom.
- **Escalator run reads badly.** `drawEscalatorRun` (same file) reads as a long
  shallow zigzag ramp rather than an escalator. Rework toward a clean inclined
  belt with a handrail and legible step edges.
- **Grand entrance / awning is not prominent in play.** The enriched grand
  storefront and doorman (`src/render/sprites/structure/entrance.ts`) do not read
  as a grand entrance at the lobby's frontage edge in game (it appears as a small
  green sliver). Confirm the grand-entrance tiles are being placed and consider a
  projecting marquee or awning so the entrance reads as grand.
- **Gallery squishes multi-floor kinds.** `src/gallery.ts` sizes every cell to
  about one floor, so genuinely multi-floor kinds (cinema, party hall, recycling,
  housekeeping floors 2; metro floors 3) render vertically crushed and cannot be
  judged in the baseline. Size each gallery cell by the facility's `floors` so
  multi-floor compositions show at their true proportion (clamp to the cell,
  scale width to preserve aspect). Regenerate the baseline and screenshots after.

### Deferred from: code review of E6 structure/transport art followup (`gds-code-review`, 2026-07-14)

Change: `src/render/sprites/structure/lobby.ts` (reception moved out of repeating
variant 1 into a person-free console/bench; `skyGlass` tones down the sky lobby),
`src/render/sprites/structure/entrance.ts` (one reception desk + attendant in the
grand-left slice; a projecting marquee on the wide and compact grand entrances),
and `src/render/sprites/transport.ts` (clean figure-free stair flight and
escalator run that land on the second-floor deck). Three review layers (Blind
Hunter, Edge Case Hunter, Acceptance Auditor). Patch findings fixed and
re-verified: the stair/escalator drop shadow no longer paints the `bandBottom`
row (height reduced to 1 so the deepest column stays inside the band), the newel
post is drawn after the top landing so it reads, and the once-per-lobby comments
were corrected to note the compact 1-tile fallback shows no receptionist. Defers:

- **Sky lobby shows zero attendants after de-repeat. RESOLVED: owner chose to
  keep the sky lobby UNSTAFFED (zero attendants).** De-repeating removed the tiled
  attendant, and there is no single-placement path for sky lobbies (the floor-1
  entrance map that hosts the ground lobby's one reception is `u.floor === 1`
  only). The owner decided the sky lobby stays unstaffed, so this is closed, not
  an open item, and the frozen I/O matrix line ("an info desk with an attendant")
  should be amended to match. No code change; do not add a sky-lobby placement
  seam. (Acceptance Auditor; owner decision 2026-07-14.)
- **Stairs/escalator no longer bake a rider; the frozen AC should be amended.**
  The frozen structure/transport spec AC and I/O matrix say the incline carries
  the ~17px rider build, but per the owner directive the flights bake no
  climber/rider (empty tower reads empty; the engine's routed sims ride over the
  static flight). This is an intentional renegotiation, not a defect. The frozen
  `spec-pixelart-structure-transport.md` AC should be amended to record it. Do not
  edit the frozen spec without the human renegotiation ritual. (Acceptance
  Auditor; supersedes the earlier "Stairs and escalator bake no ~17px rider"
  defer above. Low; spec traceability.)
- **Marquee overpaints the compact grand-solo door's top header row.** In
  `drawGrandCompact` the marquee is drawn last across the full tile; its body
  (y+3..y+6) meets the compact door header at `doorTop = y+6`, so the canopy sits
  over the door's top row. It reads correctly as "canopy in front of the door"
  and the wide facade avoids it by lowering its chandelier, but the compact path
  did not nudge the door top. Nudge `doorTop` down a pixel or trim the marquee on
  the solo tile if a future pass wants the door header fully clear. (Blind Hunter
  / Edge Case Hunter. Very low; cosmetic.)
- **A narrow (1-tile) floor-1 lobby run shows no receptionist.** The wide grand
  entrance (leftmost run of width >= 2) hosts the single reception; a 1-tile run
  maps to `grand-solo`, which has no room for a counter. Reachable for a toy
  lobby or a lobby whose leftmost contiguous run is split to width 1 by a gap.
  Both reviewers judged it acceptable for a degenerate lobby; revisit only if the
  owner wants a compact reception on the solo tile. (Edge Case Hunter. Low;
  degenerate-case cosmetic.)

### Deferred from: code review of E6 grand hotel entrance redraw (`gds-code-review`, 2026-07-14)

Change: `src/render/sprites/structure/entrance.ts` grand forms redrawn from the
glass storefront + green marquee to the page-05 `grandEnt` grand hotel entrance
(red scalloped awning, gold double doors, glass curtain wall, red carpet, potted
palm, doorman) on the wide (`drawGrandFacadeLeft` + `drawGrandFacadeRight`) and
compact (`drawGrandCompact`) forms; the service entrance is untouched. Three
review layers. Patch findings fixed and re-verified: the compact doorman was
moved from `lc + 4` to `lc + 3` so his 2px sway frame no longer clips column 11
off the 11px tile; the compact palm was resized to fit inside the tile instead of
spilling off the left edge; the compact door's right handle was mirrored about the
center split; the wide doorman was nudged to composite `dcx + 3` so both feet stay
on the carpet and clear of the right palm's pot; and the left reception desk now
derives its base from the `fy = h - 6` floor line. Defers:

- **Wide grand entrance carries one palm (right flank), not one on each side.**
  The reference `grandEnt` and the owner directive want a palm flanking the doors
  on both sides, but the left flank of the wide 2-tile form (22px) hosts the
  required single relocated reception desk + attendant (6px), which leaves no
  floor room for a left palm beside the left door leaf. The two requirements
  (keep the reception AND a palm on each side) conflict in 22px. Shipped with
  reception on the left, palm on the right, doorman on the carpet. Owner to
  decide: keep the reception plus one palm, or drop the reception here for a
  second palm. (Acceptance Auditor. Low; needs an owner decision, not a code fix.)
- **Door geometry is a fixed 18px tall, not proportional to `h`.** `doorH = 18`
  and `doorTopY = fy - 18` are constants tuned for the game's `FLOOR = 44`
  (`fy = 38`, door spans ry 20..38). At the unit tests' `h = 34` the door top
  rises into the awning band, and for `h <= 24` `doorTopY` would go negative (the
  `Filler` clamps rect SIZE, not position). Not reachable in production (entrance
  tiles always bake at `FLOOR = 44`), and the tests only assert `painted()` /
  `sig()` inequality, so it is test-fidelity / robustness only. Derive the door
  height from `h` if a future change ever bakes entrances at another height.
  (Edge Case Hunter. Low; robustness.)

### Deferred from: code review of E1 (createUICallbacks split) (`/bmad-code-review`, 2026-07-14)

Change: E1 extracts the ~30-callback `UICallbacks` literal out of the `GameApp`
constructor into `createUICallbacks(app: GameAppPorts)` in `src/game/uiCallbacks.ts`,
and moves the private-state-mutating callback bodies into `GameApp` methods. Three
adversarial layers ran (Blind Hunter, Edge Case Hunter, Acceptance Auditor). The
Blind Hunter confirmed all 15 moved bodies are byte-for-byte behavior-identical,
construction order preserved, and the live-re-read pattern survives `adoptSim()`.
Patched in-PR: the `adoptSim`-swap live-capture test (getMode re-reads per call),
strengthened `onLoadSlot` call-count assertions, an honest test docstring (it
guards the wiring; the moved bodies stay covered by the controller integration and
e2e suites), the corrected `audio` port doc (per-call read is the guarantee, not
"never swapped"), the restored `onInspectorClose` latch comment, and the
`renameTower` return-shape note. Residual defers (real but intentionally not
actioned, as behavior-preserving E1 must not change behavior or over-grow the
composition root):

- **Public widening of the controller ports and `setSpeed`/`undo`/`redo`/`setOverlay`.**
  To back `GameAppPorts` via `class GameApp implements GameAppPorts`, `editor`/
  `saveLoad`/`inspector` widened from `private readonly` to public `readonly` and
  four private methods became public. The `GameAppPorts` `Pick<>` slices express
  the intended factory surface, but the concrete class members are the full types,
  so a `GameApp` (or `window.game`) holder can reach them directly. Accepted for
  the app spine; the narrower alternative (keep controllers private, add ~9 thin
  public wrapper methods) was rejected because it adds surface and grows `main.ts`
  further for no guard benefit. Revisit if a UI-boundary lint/ratchet is added.
- **`main.ts` did not shrink (1573 -> 1604, +31).** The story's "shrinks" clause is
  in direct tension with the hardened AC3 ("delegate private-state bodies to
  GameApp methods"): the ~110-line inline literal left the constructor, but the
  ~130 lines of extracted methods must live in `GameApp`/`main.ts`. AC3 (the
  encapsulation point, and the story's real purpose: the `createUICallbacks` seam)
  won. `main.ts` stays on the file-size ratchet (guard passes; still far above 500).
- **Boot-order coupling is now separated from its guard.** `handleSelectTool` runs
  synchronously during `new UI(createUICallbacks(this))` (the UI ctor's initial
  `selectTool`) and reads `this.keyboard`/`build`/`engine`; the ordering is enforced
  only by the comment at the `new UI(...)` line, not a test (the boot path needs a
  full `GameApp` and is e2e-only). Left as prose + e2e coverage.
- **Pre-existing input-validation gaps surfaced by the Edge Case Hunter, unchanged
  by E1** (they were the behavior of the inline callbacks): `setVolume` with a
  `kind` outside `music`/`sfx` (type-guarded by `UICallbacks`), `saveToSlot`/
  `deleteSlot` with an out-of-range slot, and `renameTower` with a blank name. Not
  hardened here because E1 is behavior-preserving; candidates for a separate
  input-validation pass.

### Deferred from: code review of E2-S1 (event-choice lit migration) (`/bmad-code-review`, 2026-07-14)

Change: E2-S1 migrates `showEventChoice` (the emergency modal) onto the E0
`openModalTemplate` seam with a lit `eventChoiceTemplate` and inline `@click`,
keeping the resolve-exactly-once `finish` guard and the Esc/backdrop/x decline
paths in the controller. Three adversarial layers ran; all confirmed the code is
correct (override ordering, `closeModal()` not re-firing cancel, pixel parity, no
churn). Patched in-PR: the previously-missing fire-once path tests (backdrop click
resolves decline once and closes; a first-action Esc/cancel resolves decline once;
accept closes the modal; a button-vs-button double-tap cannot double-resolve), the
`costLabel` auto-escape unit test, a broadened `assertDomEquivalent` (apostrophe/
emoji production input class + empty boundary), the exact accept class-set
assertion, and the "trusted plain text" + `data-act`-retention docstring notes.
Residual defers (real but intentionally not actioned, behavior-preserving):

- **Transitional string-builder retirement is untracked and accumulating.**
  `eventChoiceHtml` (and `confirmHtml` from E0) are now dead production code kept
  alive only so their `assertDomEquivalent` guards have a legacy string to compare
  against. This matches the plan (retire the builder in the PR that retires its
  guard), but there is no running list of which builders await retirement. When the
  last string dialog is converted (E6/E7), delete every orphaned `*Html` builder
  and its transitional test in one sweep. Builders parked so far: `confirmHtml`,
  `eventChoiceHtml`.
- **The loud `[data-act]` lookup safety net is gone for migrated dialogs.** The old
  `wireActions` path threw at open if a `[data-act]` button was renamed/dropped;
  inline `@click` cannot "miss," so that fail-loud-on-first-open guarantee no longer
  applies to lit-migrated dialogs. Low severity (the binding is co-located with the
  element), inherent to the inline-dispatch model. No action.
- **Pre-existing input behaviors unchanged by E2-S1** (matching the original
  `eventChoiceHtml`/`showEventChoice`): no `isModalOpen` guard before opening (the
  sim is frozen while a choice is open, so emergencies cannot stack); an empty
  `message`/`costLabel` renders an empty `<p>` / a dangling "Pay "; `onResolve`
  throwing escapes the handler. Candidates for a later hardening pass, not here.
### Deferred from: code review of E2-S2 (update-prompt lit migration) (`/bmad-code-review`, 2026-07-14)

Change: E2-S2 migrates `showUpdatePrompt` onto the E0 `openModalTemplate` seam with
a lit `updatePromptTemplate` (inline `@click`, nested sub-templates for the
optional What's-new and build-id blocks), keeping the fire-once `done` guard, the
`fireAndForget` async containment, and the Esc/backdrop/x "Later" paths in the
controller; the update chip is unchanged. Three adversarial layers ran; all
confirmed the template port is byte-faithful (no DOM divergence, override ordering
correct, pixel parity). Patched in-PR: the previously-missing tests the story
demands (backdrop click resolves Later once; a mixed Update-then-backdrop second
dismissal cannot double-resolve; a throwing Update handler is contained and the
modal still closes; the chip clears `#a11y-live` then re-announces on the next
frame on EVERY call), plus the version-absent/sha-present build line, a hostile-note
`assertDomEquivalent` case (proving lit escaping equals the old escapeHtml), and the
4-notes cap boundary; the template uses lit's `nothing` sentinel for absent blocks.
Residual defers (real but intentionally not actioned, behavior-preserving):

- **`updatePromptHtml` joins the transitional string-builder retirement list.** Like
  `confirmHtml`/`eventChoiceHtml`, it is now dead production code kept only to feed
  its `assertDomEquivalent` guard. Delete it and its transitional test when the last
  string dialog converts (E6/E7). Builders parked so far: `confirmHtml`,
  `eventChoiceHtml`, `updatePromptHtml`.
- **`fireAndForget` swallows a failed Update silently** (`.catch(() => {})`,
  unchanged from origin/main): if the save-then-reload throws or rejects, the modal
  closes and the player sees nothing. A later hardening pass could surface a toast or
  log; not changed here (behavior-preserving).
- **Pre-existing input behaviors unchanged by E2-S2**: an empty-string note renders a
  blank bullet; a malformed non-array `notes` (bad version.json) would throw in both
  the old and new code. Candidates for a later validation pass.

### Deferred from: code review of E2-S3 (settings lit migration) (`/bmad-code-review`, 2026-07-14)

Change: E2-S3 migrates the Settings dialog structure (`settingsHtml`) onto the E0
`openModalTemplate` seam with a STATIC lit `settingsTemplate`. Settings is stateful,
so the controller (`showSettings`) keeps all the wiring verbatim: the volume sliders
initialize from live volumes and apply on input, both switches re-read the live
state after every toggle, and the OS-forced reduced-motion path disables and
relabels the switch. The Close button remains wired by the shared `wireActions` pass (its loud
`[data-act]` lookup is retained). Residual defers (behavior-preserving):

- **`settingsHtml` joins the transitional string-builder retirement list**
  (`confirmHtml`, `eventChoiceHtml`, `updatePromptHtml`, `settingsHtml`): it is now
  dead production code kept only to feed its `assertDomEquivalent` guard; retire it
  and its transitional test when the last string dialog converts (E6/E7).

### Deferred from: code review of E2-S4 (help lit migration) (`/bmad-code-review`, 2026-07-14)

Change: E2-S4 migrates the Help / How-to-play dialog (`helpHtml`) onto the E0
`openModalTemplate` seam with a lit `helpTemplate`. The large body is authored
verbatim as static markup (only the app `version` is interpolated, auto-escaped by
lit); the Replay button is disabled with an explaining `title` while the splash is
up (via `?disabled`/`title` bindings and lit's `nothing` sentinel) and binds its
action inline via `@click`. Binding is unconditional because two real backstops
make a splash-time trigger a no-op: a browser suppresses click events on a
`disabled` button, and `onReplayOnboarding` itself no-ops behind `#splash`. (Blind
Hunter noted the guarantee is behavioral, not structural: a synthetic `click()` in
happy-dom still reaches the handler, so the code comments say "behavioral" and the
disabled state is pinned by an integration test rather than a unit no-op assertion.)
The controller (`showHelp`) keeps routing the report link through the platform
wrapper (`routeExternalInWrapper`) and wires the plain Close via `wireActions`.
Residual defers (behavior-preserving):

- **`helpHtml` joins the transitional string-builder retirement list**
  (`confirmHtml`, `eventChoiceHtml`, `updatePromptHtml`, `settingsHtml`, `helpHtml`):
  it is now dead production code kept only to feed its `assertDomEquivalent` guard;
  retire it and its transitional test when the last string dialog converts (E6/E7).
  With E2 complete, the remaining string dialogs live in E3 onward (saves, stops,
  new-tower, import/export reports, statistics, batch pricing, editor/inspector).
- **`showHelp`'s `.help-report a` lookup is a non-null assertion** (pre-existing):
  it would throw if the body ever lost the report link. Behavior-preserving today
  (the link is always in the template); a defensive guard can wait until the body
  becomes conditional.
- **Double-activation of Replay is not de-duplicated** (pre-existing): `@click`
  fires per click, matching the old `addEventListener` wiring. `onReplayOnboarding`
  is idempotent enough that a fast double-click is harmless; no change needed now.

### Deferred from: code review of E3-S1 (saves lit migration) (`/bmad-code-review`, 2026-07-14)

Change: E3-S1 migrates the Saved Towers slot manager (`savesHtml`) onto the E0
`openModalTemplate` seam with a lit `savesTemplate`. Slot rows are nested
`TemplateResult`s (not a joined string), the tower name auto-escapes (no
`escapeHtml`), and the Delete button keeps its per-row `aria-label`. The template
is static structure only: the per-row Save/Load/Delete buttons and the
export/import/close actions stay wired imperatively by the controller
(`showSaves`), so the re-render-on-save flow is unchanged. Blind Hunter confirmed
the body is byte-for-byte equivalent to `savesHtml`; the Acceptance Auditor
confirmed all eight ACs. The two Edge Case Hunter `patch` gaps (mid-range star
glyph, and the `towerName`-absent → "Tower" / mode-absent → Classic fallbacks) are
fixed in `saves.test.ts`. Residual defers (behavior-preserving):

- **`savesHtml` joins the transitional string-builder retirement list**
  (`confirmHtml`, `eventChoiceHtml`, `updatePromptHtml`, `settingsHtml`, `helpHtml`,
  `savesHtml`): it is now dead production code kept only to feed its
  `assertDomEquivalent` guard; retire it and its transitional test when the last
  string dialog converts (E6/E7).
- **`when`-line boundaries are covered only structurally** (pre-existing): the
  `Number.isFinite(s.day)` guard (a `NaN`/`Infinity` day drops the "Day N" segment)
  and `Math.floor` (a fractional day floors) are exercised only via the equivalence
  guard, not asserted directly. `SlotInfo.day`'s producer (`infoFrom`) already
  bounds the value (finite, non-negative, under the ceiling), so these are
  unreachable in practice; a direct assertion can wait.
- **`population`/`funds` absent → 0 and `Math.round(funds)` rounding are unexercised**
  (pre-existing): every test slot supplies integers, and `infoFrom` always sets both
  on an existing slot. Low regression risk; defer.
- **Literal locale formatting is deliberately not asserted**: `fmtWhen`'s date and
  the pop/funds `toLocaleString` grouping are locale/timezone-dependent, so the suite
  leans on `assertDomEquivalent` for the formatting path rather than brittle literal
  strings. This is intentional, not a gap.

### Deferred from: code review of E3-S2 (stops lit migration) (`/bmad-code-review`, 2026-07-14)

Change: E3-S2 migrates the per-floor elevator stops dialog (`stopsHtml`) onto the
E0 `openModalTemplate` seam with a lit `stopsTemplate`. Rows are nested
`TemplateResult`s (not a joined string), the title auto-escapes (no `escapeHtml`),
and each checkbox binds its toggle inline via `@change` (the floor comes from the
row closure), so the controller (`showStopsDialog`) no longer walks `[data-floor]`
and only wires the Done action. `data-floor` stays on each input for structural
parity with the legacy body (it feeds the equivalence guard) and as a debugging
hook. Blind Hunter confirmed byte-for-byte equivalence; the Acceptance Auditor
confirmed all seven ACs; Edge Case Hunter found no `patch` gaps. Residual defers
(behavior-preserving):

- **`stopsHtml` joins the transitional string-builder retirement list**
  (`confirmHtml`, `eventChoiceHtml`, `updatePromptHtml`, `settingsHtml`, `helpHtml`,
  `savesHtml`, `stopsHtml`): dead production code kept only to feed its
  `assertDomEquivalent` guard; retire it and its transitional test when the last
  string dialog converts (E6/E7).
- **Second `@change` on the same box firing again is not directly pinned**: the old
  `addEventListener` fired on every change; the new inline `@change` does too, but no
  test dispatches twice. The modal renders once (no re-render), so a dropped listener
  is not reachable; low risk, defer.
- **Only a single lobby row is exercised**: all tests use exactly one `lobby:true`
  floor. The map is trivial and one lobby run per tower is the norm; low value, defer.
- **`floor === 0` renders "B0"** (pre-existing, both old and new): the `floor > 0`
  guard sends 0 to the basement label. Callers index ground as 1 and basements as
  negative, so floor 0 is unreachable; a latent legacy quirk, not this PR's to pin.

### Deferred from: code review of E3-S3 (new-tower lit migration) (`/bmad-code-review`, 2026-07-14)

Change: E3-S3 migrates the Found a New Tower rule-set picker (`newTowerHtml`) onto
the E0 `openModalTemplate` seam with a lit `newTowerTemplate`. Static structure:
only the abandon warning is conditional (on `hasSave`); the `.nt-calendar`
sub-picker renders unconditionally in both modes (not collapsed into a mode
ternary), and the controller (`newTowerModal`) still reads the picked `nt-mode` /
`nt-cal` radios off the mounted box and wires Cancel/Found. Blind Hunter confirmed
byte-for-byte equivalence (incl. the `2×–2.5×` / `2–5` numeric-range glyphs and the
⚠️ warning); the Acceptance Auditor confirmed all ACs; Edge Case Hunter found no
`patch` gaps. Residual defers (behavior-preserving):

- **`newTowerHtml` joins the transitional string-builder retirement list**
  (`confirmHtml`, `eventChoiceHtml`, `updatePromptHtml`, `settingsHtml`, `helpHtml`,
  `savesHtml`, `stopsHtml`, `newTowerHtml`): dead production code kept only to feed
  its `assertDomEquivalent` guard; retire it when the last string dialog converts.
- **Static copy is pinned only transitively by the equivalence guard**: the lede,
  both mode descriptions, the three Modern feature strings, and the calendar copy
  are asserted only via `assertDomEquivalent(newTowerHtml(...), ...)`. When
  `newTowerHtml` is deleted (E6/E7), add a direct text assertion (or a fixture
  snapshot) for that copy first, so a later typo in `newTower.ts` cannot slip
  through unguarded.
- **Calendar tab-order / keyboard reachability is e2e-only**: the "always reachable"
  invariant is DOM-source-order at the unit tier (the equivalence guard pins the
  calendar node between `.nt-modes` and the footer), but real focus traversal is
  verifiable only in an e2e. Confirm the e2e suite covers the new-tower dialog's tab
  order; add one if it does not.

### Deferred from: code review of E3-S4 (TDT reports lit migration) (`/bmad-code-review`, 2026-07-14)

Change: E3-S4 migrates the export-choice modal and the TDT import/export fidelity
reports (`exportConfirmHtml`, `importReportHtml`, `exportReportHtml`) onto the E0
`openModalTemplate` seam with lit templates in `reports.ts`. Fact lines and the
brought-over/couldn't-bring (and export twin) lists are nested `TemplateResult`s
(not joined strings), report strings and filenames auto-escape (no `escapeHtml`),
and the Modern-gated legacy `.TDT` button keeps its `disabled` + `title` via
`?disabled` / the `nothing` sentinel. The controllers keep their `isModalOpen()`
clobber guard, the `#a11y-live` announcement, and `wireActions`. Blind Hunter
confirmed byte-for-byte equivalence for all three templates; the Acceptance Auditor
confirmed the ACs once the two missing assertions were added. The Edge Case Hunter
`patch` (the import-rounds / export-does-not asymmetry was unpinned) is fixed with
direct `money: 100.6` unit tests on both templates, and the AC5 gap (`#a11y-live`
announcement not asserted after open) is fixed with integration assertions on both
report dialogs. Residual defers (behavior-preserving):

- **The three report builders join the transitional string-builder retirement list**
  (`exportConfirmHtml`, `importReportHtml`, `exportReportHtml`): dead production code
  kept only to feed their `assertDomEquivalent` guards; retire with the rest.
- **`#a11y-live` was previously unasserted for these reports** (pre-existing, now
  fixed): before this PR no test read the polite region for the report dialogs; the
  new integration assertions close that standing gap.

### Decision + deferrals: E3-S5 (statistics lit migration) (`/bmad-code-review`, 2026-07-14)

**Decision (the "worst string-composition case").** The Tower Statistics dialog is
migrated FULLY to nested `TemplateResult`s (Option A of the E3-S5 story), not left
as an imperative `innerHTML` blob rendered into its own container (Option B). New
`src/ui/templates/stats.ts` provides `statsTemplate(sim)` (plus `elevatorSection`
/ `incomeSection` / `milestonesSection` / `householdSection` and the
`statsModalTemplate` shell), mirroring `buildStatsHtml` and its friends in
`statsHtml.ts`. Rationale: Option A keeps ONE rendering path (lit everywhere), lets
the `statsHtml.ts` string builders retire with the rest of the transitional
builders, and avoids a permanent `unsafeHTML` / `innerHTML` sink. The seam now
carries a `TemplateResult` instead of a string: `main.ts` calls
`showStats(statsTemplate(sim))`, `UI.showStats(body: TemplateResult)`, and
`showStats` opens via `openModalTemplate(statsModalTemplate(body))`. Every
`escapeHtml` (tower name, elevator labels, milestone label/desc) is now auto-escaped
by lit. Fidelity is pinned by `assertDomEquivalent(buildStatsHtml(sim),
statsTemplate(sim))` across an empty tower, a built Classic tower with an elevator,
a fresh Modern tower (Households empty-state), a Modern tower with a sold household,
and a fresh Classic tower.

Residual defers (behavior-preserving):

- **`buildStatsHtml` + `buildElevatorHtml` / `buildIncomeHtml` / `buildMilestonesHtml`
  join the transitional string-builder retirement list**: dead production code kept
  only to feed the `assertDomEquivalent` guard. NOTE for the final sweep: the
  `condoModes.integration.test.ts` and `editorHtml.integration.test.ts` suites assert
  on `buildStatsHtml(sim)` output directly (not as a transitional guard); when the
  string builder is retired, port those assertions to render `statsTemplate(sim)` to
  a fragment instead.
- **Equivalence-guard coverage of the populated branches** (from the Blind Hunter +
  Edge Case Hunter triage): the guard now exercises the populated Income section
  (a ticked tower with trailing-quarter data, hitting the rows/two-column split/Net
  line) and the multi-shaft Elevator two-column split (four Standard shafts). Still
  unexercised by the guard, and so verified only by Blind Hunter's manual
  byte-for-byte reading (all confirmed correct), each a near-verbatim mirror of the
  string builder: the `ratingRow` "Counts toward stars" row + its 4★ hotel-exclusion
  explainer (needs a hotel-heavy star-4 tower, expensive to reach in a unit test);
  the Express `kindName` label (express is lobby-locked and would not build in the
  minimal fixture); the milestone `done` (`✓` / `ms-done`) markup and a non-zero
  progress-bar width; and the household `mix` with two or more distinct sizes. Add
  these fixtures before `buildStatsHtml` is retired in the final sweep, or fold them
  into the ported tests then.

### Deferred from: code review of E4 (batch-pricing reactive lit migration) (`/bmad-code-review`, 2026-07-14)

Change: E4 migrates the batch-pricing dialog (`batchPricingHtml`) onto the E0
`openModalTemplate` seam and, per the E4 story, replaces the imperative `refresh()`
with a re-render from local dialog state on every input event. The controller holds
`{ mode, priceRaw, only, resetArmed, previewMsg, applyDisabled }`, recomputes the
honest preview via `cb.preview`, and calls lit `render()` into the box; the pure
`batchPreviewMessage` / `batchPriceText` helpers moved to the template module (also
keeping `uiDialogs.ts` under the 500-line ceiling). Blind Hunter confirmed
byte-for-byte structural fidelity and exact behavior parity (snap-on-commit, the ±
adjuster, the only-default filter, the message chain, Apply-disabled, and the
two-click confirm-reset). The three Edge Case Hunter `patch` gaps are fixed:
`batchPreviewMessage` / `batchPriceText` now have direct unit tests (every clause +
singular/plural overwrite + both clamp clauses), snap-on-commit through the new
`@change` is pinned by an integration test (type `12345`, commit, snaps to `12000`),
and the reset-disarm is pinned (arm, then any input reverts to "Apply"). The caret
concern both hunters raised (writing `.value` on every keystroke would jerk the
caret to the end on a mid-number edit) is fixed with the lit `live()` directive,
which skips the write when the DOM already matches. Residual defers
(behavior-preserving):

- **`batchPricingHtml` joins the transitional string-builder retirement list**: dead
  production code kept only to feed its `assertDomEquivalent` guard.
- **Reset-arming is not announced to screen readers**: the story flags announcing the
  bulk-reset arming as a deferred a11y WIN, intentionally NOT added here.
- **Low-value reactive paths covered only structurally**: the set to default to set
  mode round-trip (priceRaw persistence + field re-enable), the only-default filter
  re-preview opts, and inc/dec from an empty/NaN field are each near-verbatim mirrors
  of the old controller; low regression risk, defer.

### Deferred from: code review of E5-S0 (perf gate harness) (`/bmad-code-review`, 2026-07-14)

Change: E5-S0 lands the blocking Playwright perf gate ahead of the live-view
migrations: `e2e/perf-harness.ts` (browser-side measurement helpers),
`e2e/perf.spec.ts` (the `@perf` gate), the `perf` / `perf:capture` npm scripts,
a perf step in the test.yml e2e job, and `update-perf-baseline.yml` (marker
`[update-perf-baseline]`) to mint the committed baseline in the pinned container.
The three reviewers' PATCH findings were all fixed before landing: (A) is now
batched (40 pumps/sample) and advances the clock each pump so it clears the
`performance.now()` ~0.1ms floor and measures the change path, not a no-op; (B)
clears `sim.pendingChoice` (the freeze that produced the anomalous 0.31 reading),
sets `steadyClock` to remove the pace-of-day confound, stubs autosave, and takes
the median of five windows; `retries` is forced to 0 for `@perf`; the CDP throttle
is reset in a `finally`. Locally the three metrics held to ~1% / ~5% / ~4%
run-to-run. Residual defers:

- **The write-before-`positionPanels`-layout-read ordering rule (plan §3(C)) is not
  asserted**: it holds structurally today (`ui.update` at main.ts:1167 precedes
  `positionPanels()` at :1218), but the harness does not probe for a forced
  synchronous reflow. It is only meaningfully assertable once a live-view write
  path exists, so E5-S1 should add a forced-layout probe (or record it as an
  accepted structural-only guarantee) when it introduces the first live render.
- **The committed baseline is minted by CI, not by hand**: `baseline.json` lands
  on the E5-S0 branch as a bot commit from `update-perf-baseline.yml` (the pinned
  container), never from a local capture. The gate itself now closes the
  silent-hole risk: in enforce mode (CI, or `PERF_ENFORCE=1`) a missing baseline
  is a hard failure with a mint pointer, while the bootstrap capture-and-skip
  remains for local runs and the capture workflow. E5-S1 need only keep this
  behavior; no extra exists-assertion is required there.
- **`towerStatsChildStable` is reported, not asserted**: the pre-E5 `innerHTML =`
  rebuilds the stats children every pump, so E5-S1 promotes this to an assertion
  once the grid renders on change.
- **B is a coarse guard**: at ~0.25 sim-min/s under the 4x throttle on the TOWER
  fixture the absolute rate is low; it is stable and sensitive to `ui.update` cost
  (the fixed-timestep engine falls behind when the pump is heavier), but if CI
  proves noisier than the local sandbox, widen `B_FLOOR_TOL` based on observed CI
  variance rather than the render path (mirrors how visual-snapshot thresholds are
  tuned to the CI renderer).
- **`@perf` grep is a substring match**: a future non-perf test whose title
  contains "@perf" would be miscategorized by `--grep`/`--grep-invert`. Low risk;
  tighten the tag convention if the suite grows.

### Decisions + deferrals: E5-S1 (tower-stats grid live view) (`/bmad-code-review`, 2026-07-14)

Change: E5-S1 migrates the first live view. The tower-stats grid renders through
lit on the ~6 Hz pump: `uiStatus.update` calls `render(towerStatsTemplate(
sim.stats()), ui.el.towerStats)` in place of the old `innerHTML = towerStatsHtml(
...)` full reparse, so the grid's child nodes keep their identity across pumps
(now ASSERTED by the E5-S0 gate's node-identity probe, promoted from reported).
The `#tower-stats` container is lit's exclusively (one container, one renderer;
`uiStatus.update` was its only writer). Decisions per the story's stated options:

- **Status bar stays imperative**: the five leaf writes (`money`/`pop`/`star`/
  `time`/`date`) remain surgical `textContent` writes, the story's "keep" option.
  They are already minimal (no parse, no allocation), and the render target
  question (leaf spans, never a `#traffic` wrapper) does not arise: `#traffic`
  keeps its own imperative writer (`main.ts` `updateTraffic()` with hysteresis)
  untouched.
- **The write-before-`positionPanels`-layout-read ordering rule is recorded as a
  structural guarantee** (the E5-S0 defer offered probe-or-record): in `main.ts`
  `update()`, `ui.update(sim)` (all DOM writes, including the new lit render)
  completes before `positionPanels()` performs its layout reads, and this story
  adds no layout read to the write path. A dedicated forced-reflow probe stays
  open for a later story if the write path ever grows a read.
- **`towerStatsHtml` joins the transitional string-builder retirement list**: dead
  production code kept only to feed its `assertDomEquivalent` guard.

Review outcome (both layers): 7/7 ACs MET; the one patch (a stale
perf-harness docstring describing the pre-promotion "reported, not asserted"
state) was fixed in-PR. Optional notes judged noise by the reviewers, recorded
for completeness: an identical-snapshot re-render no-op test would pin lit's own
dirty-check rather than project code, and a corrupted-container guard would pin
an invariant no current writer can violate (the container ships empty and
`uiStatus.update` is its only writer); the cheapest belt-and-suspenders form, if
ever wanted, is asserting `#tower-stats` is empty at UI construction.

### Deferred from: code review of E5-S2 (tool-info lit migration) (`/bmad-code-review`, 2026-07-14)

Change: E5-S2 renders the tool-info panel through lit on tool select (event-driven,
not a pump path). `UI.selectTool` calls `render()` into `#tool-info` with
`toolInfoTemplate` (build kinds, with the capacity/customers conditional) or the
`BULLDOZE_TOOL_INFO` / `INSPECT_TOOL_INFO` constants, replacing the three
`innerHTML` writes. The UI constructor clears the container's static HTML
placeholder before the initial selectTool so lit's first render never appends
after it (invisible: selectTool repaints immediately); `#tool-info` is lit's
container exclusively after that. Residual defers:

- **`buildToolInfoHtml`, `BULLDOZE_TOOL_INFO_HTML`, `INSPECT_TOOL_INFO_HTML` join
  the transitional string-builder retirement list**: dead production code kept only
  to feed their `assertDomEquivalent` guards.
- **Catalog copy escaping tightened for free**: the legacy builder interpolated
  `name`/`description` raw; lit auto-escapes them. The catalog is trusted static
  copy (one bare `&` in the wedding-hall description parses identically both ways),
  so this is a hardening, not a behavior change.

### Decisions + deferrals: E5-S3 (palette lock/afford dirty-gate) (`/bmad-code-review`, 2026-07-14)

Change: E5-S3 banks the free win. The palette lock/afford scan in `uiStatus.update`
is dirty-gated on a key of the star plus the per-kind affordability bitmask (both
pure engine reads, no DOM): the ~6 Hz pump now skips the two `querySelectorAll`
walks and the class writes unless the star or an affordability boundary crossed.
The scan body itself is unchanged, so the a11y checklist holds by construction:
`.locked` still hides items out of layout and tab order, and the keyboard wiring
(`role=button`, `tabindex`, Enter/Space, the `e.repeat` guard, `stopPropagation`)
lives in `uiPalette` and is untouched. The locked-tool fallback to Inspect is
gated with the scan: a tool can only become locked when the star drops, always a
key change. The palette is built once (the UI constructor), so no rebuild path
can strand fresh items behind an unchanged key. Decisions per the story:

- **The `classMap` binding move is NOT taken**: the story allows it only if it
  measures clean on a phone tier, which cannot be measured here; the imperative
  class pass stays, per the story's record-the-decision option.
- **Key covers a superset of the palette kinds**: it iterates all FACILITIES keys,
  so a boundary crossing on a non-palette kind causes a spurious (harmless,
  correct) rescan, never a missed one.

### Decisions + deferrals: E6-S1 (editor card via lit diffing) (`/bmad-code-review`, 2026-07-14)

Change: the editor card's `key`/`patchVolatile` protocol is replaced by lit's
binding diff (`templates/editor.ts`, PR #289), with the review's confirmed
findings landed in the follow-up PR #290 (the triage completed minutes after
auto-merge fired; the unkeyed build never reached a player-facing release).
Patched there: the card is `keyed` on the selected entity id, restoring the
legacy per-entity rebuild so a dirty rename input can never carry half-typed
text onto another unit; the delegated `.ed-close` path gains the same
containment guard as the `[data-edit]` path; the fast-food closed branch and
express skipped-lobby readout get direct assertions plus equivalence guards;
the addcar upper bound joins the equivalence suite; `simWith` asserts every
placement; one em-dash comment slip reworded; one stale `patchVolatile`
comment updated. Residual defers:

- **Describe-title em-dash separators stay**: the "subject, separator, behavior"
  title pattern appears in 63 pre-existing test files; the rewritten suites keep
  the house convention rather than diverging. Prose comments follow the
  no-em-dash rule.
- **Mobile diagnostics equivalence covers unit + standard elevator only**: the
  express/stairs mobile fold-ins ride the same `unsafeHTML(transportDiagnostics)`
  block; full diagnostics-surface coverage belongs to E6-S2, which migrates the
  inspector that owns those builders.
- **Zero-population service-kind access row on mobile is unguarded**: the
  `!mobile || !hasAccessDiagnostic(u)` condition is byte-identical in the legacy
  builder and the template, so drift requires editing both; add a fixture when a
  service kind next changes.
- **`unitEditorHtml`/`transportEditorHtml` join the string-builder retirement
  list**: retained as the equivalence oracle until the final sweep.
- **`editorSize` is re-measured per editor pump** instead of only on a shape
  change: per-frame anchoring still reads the cache; the forced read rides the
  ~6 Hz pump whose status-bar writes already dirty layout. Revisit only if a
  phone-tier profile ever blames it.
## Crowd + vehicle read-right fast-follow (v1.32.1)

Read-right pass over the in-tower vehicles and crowd, driven by the owner's prod
screenshots:

- Metro train rescaled from a 9px sliver to 20px (`METRO_TRAIN_H`).
- Garbage truck rescaled from 16px to 42px (`GARBAGE_TRUCK_H`), filling most of
  the recycling center's bottom story; redrawn so the body/cab/wheel rows derive
  their vertical extents from the height constant.
- Ambient walkers no longer float on the upper stories of multi-floor facilities.
- Lobby walkers fan into evenly spaced lanes instead of clumping at the ping-pong
  ends (layout math in `towerCrowdLayout.ts`, unit-tested).
- Elevator landing queues: per-waiter spacing widened from 0.6 to 1.1 tiles and
  reach from 16 to 30, and a jammed landing now compresses its line to fit the
  built floor instead of piling the overflow onto one wall tile.

`/gds-code-review` (Blind Hunter + Edge Case Hunter) ran across two rounds with
no confirmed findings. Copilot's real catch (a `(i * 7 + 3) % count` lane
interleave that collapses at counts divisible by 7) was fixed by switching to
evenly spaced lanes with an explicit multiple-of-7 non-collapse test.

Follow-up (owner + party ratified): a 60px "1.5 floor" metro train on a redrawn
high-platform station, plus real routed platform commuters (task #24), since the
metro platform draws empty today (the crowd never routes there as a destination).

### Decisions + deferrals: E6-S2 (inspector card + build refusal via lit) (`/bmad-code-review`, 2026-07-14)

Change: the hover inspector card and the Modern build-refusal tooltip render
through lit templates (`templates/inspector.ts`, PR #291); the mobile ✕ still
comes from the one shared `titleBarClose` recipe, appended after the h4's
lit-managed content and guarded against duplication. The triage confirmed no
correctness, fidelity, or lifecycle bugs; every flag was closed in-PR: the
retained ✕ is click-proven live after a same-card re-render and a hide/re-show
round trip (its lifecycle changed from fresh-per-show, so liveness is pinned,
not assumed); the ✕-survival test's h4 carries a binding like the production
title so it pins the exact child-part behavior the retained button rests on;
and the label-equals-subtype suppression, undefined customer count, and
vacant-venue closed-marker arms joined the legacy-replica equivalence suite.
Decisions and residual notes:

- **No retained oracle**: the deleted strings were inline, so the equivalence
  guards compare against verbatim replicas kept only in the test file; they
  retire with the transitional guards in the final sweep.
- **Hide keeps parking the stale card** (hidden class only, no clear), exactly
  the legacy surface; lit renders over it on the next show. No CSS relies on
  the container being empty (verified: no :empty/child-count selectors).
- **Diagnostics stay HTML strings bridged by unsafeHTML** on this surface too;
  their template form is a final-sweep/E7 question, shared with the editor's
  mobile fold-in.

### Decision: E7-S1 (bulletin log + toast rail stay imperative) (2026-07-14)

Evaluated migrating the last two DOM surfaces to lit and decided to LEAVE BOTH
IMPERATIVE, per the plan's default. The bulletin log is an append-only stream
with deliberate performance structure: `renderLog` appends only the fresh
`logSeq` delta and prunes the oldest past `LOG_DOM_CAP`, so the DOM node count
stays constant over an arbitrarily long session while scrollback keeps
flowing under column-reverse. Rendering it through lit would mean handing the
renderer a window of entries every pump and letting it re-diff the whole list
to discover one appended child, replacing an O(new entries) append with an
O(cap) diff and gaining nothing (the lines are inert text divs; nothing ever
patches in place). The toast rail is a set of self-removing transient nodes
with their own timers and a hard cap; ownership by a renderer that reconciles
children would fight the timers' self-removal. Both regions keep their static
`role=log` / `role=status` + `aria-live` markup (src/index.html), and their
announcements are never batched or throttled to fit a frame budget. Revisit
only if either surface grows interactive children. One-line note per the
story: log + toast stay imperative; lit owns every other UI surface.

### Final sweep: the legacy string builders and transitional guards retire (2026-07-14)

The lit migration's closing PR. Deleted from production: `ui/uiTemplates.ts`,
`ui/statsHtml.ts`, and `ui/editorHtml.ts` (every `*Html` dialog/panel builder;
zero call sites remained). Deleted from the harness: `assertDomEquivalent` and
its private normalization layer in `ui/testing/litTestUtils.ts` plus its own
test suites; git history keeps both the oracle code and the full guard suites
that proved every template structurally equivalent before retirement. The last
two live pieces moved out first: `shortMoney` to `ui/format.ts`, and the
TOWER-win congratulations modal (the one dialog outside the epic list) onto
the `openModalTemplate` seam as `templates/congrats.ts`. Before the oracle
died, the two stats branches the E3-S5 triage left unexercised (the 4-star
rating divergence row and the Express shaft label) gained fixtures run against
the live oracle in the sweep PR's first commit (af03790), then kept as
structural pins once the deletion commit removed the guards. Consumers ported: `condoModes` and the two
`gameControllers` suites render the lit templates where they read builder
strings, the income Net behavior tests moved beside `incomeSection`, and the
`editorHtml` integration suite retired with the volatile-map protocol it
pinned (its live assertions live on in `templates/editor.test.ts`). lit now
owns every dialog and panel; the log and toast rails stay imperative per the
E7-S1 decision above. Triage defers: `shortMoney` still has no direct unit
test (pre-existing; its 1M+ branch is uncovered, unchanged by the move), and
`condoModes` was split (`condoStatsPanel.integration.test.ts`) after landing
exactly on the 500-line ceiling.

### Render-perf S1: zoom cull of the moving layer (2026-07-15)

CAP-1 of the mobile render-perf spec
(`_bmad-output/specs/spec-render-perf-mobile-zoom/`). Review triage patched
everything the layers confirmed (reconcileCrowd running the idempotent
hysteresis step itself; the accidental milestone-PNG clobber reverted; the
loop-skip pinned at unit tier; the e2e crowd leg de-vacuumed with seeded
people; re-show leaving routed people to reconcileCrowd so a figure that
departed while culled never flashes at a stale position). Standing defers:

- **Engine `onHour` amortization stays out of scope** (spec non-goal, party
  verdict 2026-07-14). `updateSatisfaction` and `collectTrafficIncome` are
  load-bearing for determinism and the golden master; splitting their scans
  across frames needs a checkpoint-the-inputs design consult first. The
  render-side share of the on-the-hour hitch is CAP-3's target instead.
- **`TowerEngine.ts` sits at exactly the 500-line ceiling** after gaining the
  one-line `crowdCulled` latch. The next line added there forces a split (it
  is not in `fileSize.ratchet.txt`); plan the seam then rather than balancing
  on the limit.
- **`e2e/milestones.spec.ts` writes into `docs/screenshots/milestones/` as a
  side effect of any local run**, which is how host-browser captures snuck
  into a commit this story. Consider pointing its output at `test-results/`
  (or gating the write behind the screenshot workflow env) so a local e2e run
  can never dirty the committed gallery.

### Deferred from: code review of venue-people-routing (`/gds-code-review`, 2026-07-14)

- **Party hall carries roughly 2x the cinema's visit-option weight in hotel
  towers (Blind, low).** `pushVenueVisitOptions` contributes one lobby option
  plus one hotel-mingle option for the party hall, versus a single lobby
  option for a plain cinema. This mirrors how the meal pools contribute one
  option per origin population and reads as livelier halls in hotel towers,
  which fits the canon "hotel guests mingle" flavor. Deliberate for now;
  retune with explicit weights only if halls visibly starve cinemas.
- **Hotel-mingle spawn picks a hotel floor before a room (Blind, low).** A
  bad floor draw (no in-room guest) no-ops instead of retrying, so mingle
  frequency scales with the fraction of hotel floors holding guests, not
  guest count. This is the exact idiom `spawnMealOutbound` uses for meal
  origins; keeping the two aligned beats optimizing one. Revisit both
  together if origin sampling ever needs to be population-proportional.
- **The attendance tally has exactly one decrement path, `finish()` (Blind,
  med, defused).** Every current despawn route funnels through it (verified
  by the Edge Case Hunter), and production never wholesale-clears
  `crowd.people` while units persist (`Crowd.reset` has no engine caller;
  loads rebuild the sim and strip the tally). The standing rule for future
  work: any new despawn shortcut MUST route through `finish()`, or add a
  reconciliation pass first. No repair pass exists by design today.

### Render-perf S3: deferred hour reconcile (2026-07-15)

CAP-3 of the mobile render-perf spec. Review triage patched the confirmed
findings: the drain moved to frame start ahead of the sim advance (a
catch-up frame crossing the next hour re-stacked the deferred repaint with
that hour's scans, found by both Codex and the review layers), meal-overlay
repaints now dodge hour-crossing frames, the crane no longer double-flags
on a lit flip, the boot/tick lighting derivation is one shared helper, and
the module doc states the honest pre-change mechanics (the hour-triggered
reconcile ran the frame AFTER the scans; the true same-frame stack came
through the meal-overlay trigger). Standing defers:

- **Deep catch-up residual:** when every frame crosses an hour (throttled
  top speed), the hourly scans run every frame, so the drain halves the
  sync cadence instead of fully separating the costs. Full separation needs
  the engine-side onHour amortization, the recorded spec non-goal.
- **Sky leads the building by up to two frames at the hour flip:** the sky
  color reads the live clock while room lighting rides the deferred
  reconcile. Cosmetic and transient; lockstep would mean deriving the sky
  from the adopted display hour.
- **`start()` wiring has no test repo-wide** (pre-existing; the boot bake
  is behavior-pinned only through the shared displayLit helper's unit test
  and the deferral tests). A boot-path harness would need a real Excalibur
  engine; revisit if boot regressions ever surface.
- **`setSim` mid-deferral safety rests on `Tower.revision` never equaling
  the -1 reset sentinel** (revision starts at 0 and only increments), which
  guarantees a structural sync that absorbs any stale pending flag. Not
  separately pinned; a future setSim variant that adopts the revision
  directly must clear `hourSyncPending` itself.
- **Tooling gotcha, recorded for the next contributor:** vitest's mock
  hoisting detects the literal text "vi.mock (" even inside comments and
  rewraps the module, which silently broke TowerEngine's FLOOR/TILE
  re-exports in integration tests until the comment was reworded. Do not
  name that API with a following parenthesis in prose inside src modules.

## Metro platform commuters + high-platform station (v1.34.0)

The metro station became a real routed crowd destination (engine:
`crowd/venueTrips.ts` spawners, the `spawnFloors` metro bin, the
`Person.lingerFor` platform-wait hold), the train grew to the party-ratified 60px consist
with warm-lit riders behind the windows, and `drawMetro` was redrawn as the
high-platform composition (deck on the middle story's floor line, where the
crowd stands routed commuters). A `metro` screenshot scene captures the
platform with and without the train; the hero tower's first elevator bank
now reaches the platform. Before/after comparison screenshot groups were
removed at the owner's request (save-migration parity, parking day/predawn,
condo Classic vs Modern, palette unlock).

Integrated on top of the venue-attendance work (v1.33.0): the hall-routing
half of the original branch was dropped in its favor (its counted round
trips with the attendance ledger supersede the one-way hall guests this
branch first shipped), the trip primitives come from its `crowd/trips.ts`,
and `Person.lingerFor` stays metro-only (venue stays ride the `dwelling`
state and its `dwellSecondsLeft`, so the two mechanisms cannot stack).

Deferred / follow-up notes (from `/gds-code-review`, 2026-07-14):

- **Metro ridership economy**: commuters are visual-and-routing only; no
  income, congestion, or census coupling changed. The catalog's transit
  bonuses (+60 arrival capacity, congestion relief) stay statistical. A
  per-rider ridership model is a separate design question.
- **Metro as an attendance-visit origin** (SHIPPED v1.39.0, GH #316): the
  visits flow's `outside` VisitOrigin now picks a second street door for
  ticketed venues (cinema, party hall). When an operational metro's platform
  is served by passenger transport (`tower.isFloorServed(u.floor + 1)`), a
  share of outside visitors originate on the platform and route up to the
  venue; everyone else keeps the ground-lobby entrance. Implemented in
  `crowd/visits.ts` (`pickOutsideStreetDoor`), gated so a metro-less tower
  draws no new rng and stays byte-stable (golden master unchanged). The
  double-wait hazard is closed by construction: the rider is a plain
  visits-flow round-tripper spawned through the flow, so it never carries
  `lingerFor` or a metro-departure hold. Tests in
  `crowd/metroVisitOrigin.test.ts`.
- **Unroutable-metro spawn no-ops (review Edge #4)**: a metro with no shaft
  to its platform still contributes options to the spawn pool; picked
  options route null and consume the spawn budget as no-ops. Consistent
  with the pre-existing null-route behavior for unreachable floors, so
  deferred; a spawn-side routability pre-check (or a bulletin hint, "your
  metro platform has no elevator") would close it and double as player
  guidance.

## People-tracking priority ruling (2026-07-15)

The owner asked for a full inventory of open people-tracking work and a party
prioritization. The people-tracking priority party (six personas: Samus,
Cloud, Sally, Boundary, Grumbal, John) filed independent tier ballots, then
a rebuttal round with final ordered ballots, aggregated by Borda count. The
ratified order, with rulings:

1. **Backlog hygiene (this change, unanimous first on every ballot):** record
   `elevator-dispatch-balancing`, close `lunch-office-food-trips`, refresh
   `per-person-meal-round-trips` and `shopping-trips` to shipped reality.
2. **`finish()` tripwire test (GH #302, delivered 2026-07-15 by the attendance-guards PR: `src/tests/integration/attendanceTripwire.integration.test.ts`):** the attendance tally has one decrement path
   and no reconciliation pass (by design), and enforcement lives only in
   convention; land a cheap tripwire/reconciliation test BEFORE any new
   spawn/despawn path opens (see the venue-people-routing defers).
3. **Cinema occupancy display** ([[cinema-occupancy-display]], GH #354, delivered 2026-07-15 by the attendance-guards PR): re-scoped
   during this hygiene pass after a code check. The display core (heatmap, lit
   windows, interior art) already shipped with the venue-attendance work
   (v1.33.0 `syncAttendanceOccupants`); the remainder is the inspector sliver
   (no attendance line for cinema / party hall / wedding hall). The rank was
   balloted on the bigger premise, so treat the remainder as a cheap rider on
   the item 2 and item 6 attendance-integrity pass.
4. **Unroutable-metro guard + bulletin hint** (metro v1.34.0 defers, GH #315): gates the
   metro visit-origin feature and doubles as player guidance ("your metro
   platform has no elevator").
5. **Elevator queue-view reconciliation** (the `pixelart-elevator-queue-seam`
   defer, E6-S7, GH #314): pick ONE population for the panel (`crowd.carRiders` vs the
   statistical `carLoad`) and pin it with a same-individuals test. LAW: lands
   before `elevator-dispatch-balancing` (all six final ballots ordered the two
   this way). DELIVERED 2026-07-15 (branch `claude/queue-view-reconcile`): picked
   `crowd.carRiders`; `boarded` now reads the drawn per-car occupancy and a real
   same-individuals reconciliation test is in place. The sequencing law is
   satisfied, so `elevator-dispatch-balancing` (item 9, GH #303) is unblocked.
6. **Census arrival edges** (GH #360, delivered 2026-07-15 by the attendance-guards PR: state-at-arrival rechecks now cover census AND ticketed attendance venues, over-capacity stays balanced-by-design with the tripwire proving it; PR #184 defers: over-capacity arrivals eat
   uncounted; the eating increment skips state-at-arrival): rides the same
   attendance-integrity pass as items 2 and 5 (one bundle, one review); the
   "revisit with per-person round-trips" precondition has shipped.
7. **[[tdt-import-population-seed]] (GH #311):** seed occupants on import (a real 1994
   tower reads ~96 against the 234 written in its own save).
8. **Metro as visit origin** (SHIPPED v1.39.0, GH #316): outsiders ride the
   train in for a film or a party. Spawned through the visits flow (never a
   venue intent on a `lingerFor` person), gated on an operational,
   transport-served platform. See the shipped note under the metro defers
   above.
9. **`elevator-dispatch-balancing`** (new row in the table above, GH #303): own PR in a
   quiet golden-master window, after item 5 lands.
10. **Hotel meal gate (GH #304):** the open half of [[per-person-meal-round-trips]].

Later: [[shopping-trips]] (parked, GH #356; resurrect on measured starvation),
[[tdt-export-routing-tail]] (harness-gated, GH #310), and the metro ridership
economy (needs its own spec and party, GH #361). Confirmed parked on purpose:
hall visit weight (GH #362), hotel-mingle sampling (GH #363),
[[venue-peak-hour-scaling]] (GH #355), and [[w3-basement-depth]] (GH #329).

Standing sequencing law from the debate: GUARDS BEFORE FEATURES. The
`finish()` tripwire and the routability guard land before any new
spawn/despawn path opens, the display-honesty remainder rides that same guard
tier, and the queue view gets one trusted population before dispatch changes
move underneath it.
- **Cascade booking trade recorded (Codex round 3):** using the
  live-vs-displayed hour mismatch to BOOK the hour sync in the crossing
  frame itself would land repaints one frame sooner but double the
  reconcile cadence back to every frame in deep catch-up, the exact cost
  the deferral halves. Current choice favors catch-up cost over one frame
  of repaint latency; revisit only if the owner perceives the lag.

### Render-perf S2a: picking via grid lookup (2026-07-15, PR #301 + review-fix PR)

The pointer-path story ahead of region composition. The three review
layers confirmed no patch-mandatory defect in the merged diff; the
follow-up PR carries their actionable notes (two stale collider-hit-test
comments reworded, boundary/basement/out-of-grid/stale-transport/z-tie
pins added to the pick tests, vestigial roomActors/getUnit fixture stubs
swept). Consciously accepted, on the record:

- **Boundary tie-break changed at exact pixel lines.** The old actor
  ray-cast was right-edge-inclusive and left-edge-exclusive; the grid
  cell owns its left edge and top line instead. Measure-zero lines a
  float pointer essentially never hits, and the new mapping agrees with
  the (tile, floor) arguments every consumer already receives, where the
  old pick could disagree on those same pixels. A consistency fix, not a
  regression; now pinned by exact-edge tests.
- **The rush-probe-per-PR spec constraint was met with a reasoned waiver**
  (pointer path runs on input events; an O(rooms) scan became O(1), so a
  probe could only show improvement or noise). Precedent: waivers are
  acceptable for PRs with no frame-loop surface, stated in the PR body.

### Render-perf S2b: region composition (2026-07-15, PR #388)

The CAP-2 story (issue #366). Three review layers ran on the branch; every
patch-graded finding was fixed in the follow-up commit (initial-load queue
waste wired through `drainAllRegions` after the boot bake, demolition drops
made same-frame, animated-room z moved off the garage-car tie to 0.45,
membership recomputed per mark against footprint drift, `regionsOf` range
clamped with corner tests, the visual-spec settle now waits for queue-empty
per region-design I4, banned-vocabulary reword). Consciously deferred, on
the record:

- **Fire-cycle canvas churn in single-member regions (Hunter F3):** ignite
  evicts the region, extinguish re-materializes it, and the killed texture
  lingers until Excalibur's GC interval, so a burn/extinguish cycle briefly
  holds two 352x880 textures. Rare, bounded to one canvas per cycle, and
  keeping evicted regions alive on a grace period would trade away the
  eviction guarantee. Accepted cost.
- **Dead-parking X repaints stagger through the queue (Hunter F4 residual):**
  a ramp demolition orphans many spaces whose dead bits ride the sig into
  queued marks, so the X's appear over a few frames under a busy queue.
  Bounded by the drain budget and invisible outside mass-demolition;
  revisit only with player reports.
- **Pan-into-view rasters are unbounded by the drain budget (Hunter F2):**
  the budget bounds repaint flags; a flagged off-screen region rasters when
  it scrolls into view, so a fast pan after a full-tower flip can raster
  several regions in one frame. Per-unit canvases behaved identically;
  noted in the module header, no action.
- **towerRegions has no unit-test tier (Edge E6):** eviction-on-empty,
  sameFrame coalescing, membership idempotence, deadParking plumbing, and
  visible-first ordering are covered only by the regions e2e plus the CI
  visual gate. A vitest harness needs an Excalibur engine fake; take it up
  if towerRegions grows another feature.
- **Multi-region lifecycle is pixel-unverified (Edge E6):** the metro (12
  column regions) and a 2-story row-straddler never appear in the star-4
  baseline fixture or the regions e2e; basic straddle clipping is inside
  the baselines via the x=34+9k offices. Add a star-5 fixture or a targeted
  spike if a seam report ever comes in.
- **The regions e2e hardcodes budget literal 2 (Auditor note):** importing
  REGION_DRAIN_BUDGET would pull Excalibur into the Playwright node context;
  the literal carries a comment instead. Drift risk accepted.
- **Pinned-renderer baseline re-mint (CI e2e):** the four tower-scene
  baselines moved by ~1,735 px (0.27%) on the pinned Chromium while the
  local venue decodes byte-identical; re-minted on the branch via the
  sanctioned workflow, image diff reviewed as the blessing of the new
  visual truth. Canvas rasterization differing across Chromium builds is
  the documented reason local mints never bind.
