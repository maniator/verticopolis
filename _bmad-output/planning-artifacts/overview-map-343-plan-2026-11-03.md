# Plan: tower MAP window (#343) and release placement

Status: **approved by the owner on 2026-11-03** (decisions below). Repo: maniator/verticopolis, planned against main at 03adf82 (app 2.77.5). Companion spec: `_bmad-output/specs/spec-overview-map/SPEC.md`.

## Owner decisions (2026-11-03)

1. Target 3.0.0. If the complete feature cannot be reviewed, tested and merged before the release candidate freeze, it moves to 3.1.0 automatically. The existing freeze criteria apply (no new calendar deadline). No existing release gate is weakened or delayed. If a release blocker appears, the blocker takes priority and the remaining MAP work moves to 3.1.0.
2. The window is closed by default, with a clearly discoverable Map button.
3. The existing sidebar control labeled "Map overlay" is renamed "Floor heatmap" (done in S3, the same PR as the new chrome).
4. Capture the original PC MAP window for Classic fidelity if practical. It is not a blocker.
5. Classic keeps the original MAP window behavior and styling as closely as the evidence allows. Modern may use richer facility colors and presentation.
6. Hotel, Eval and Pricing views are tracked as separate items for 3.1.0 where feasible: #1617 (Hotel), #1618 (Eval), #1619 (Pricing).
7. Start S0 to S2 when an implementation slot is free. Coordinate S3 with the in-flight work that edits the same files.
8. Nothing user-visible ships until the whole v1 is done: no partially implemented map. Desktop and mobile regression coverage, accessible controls, clean CI, visual snapshot approval and performance validation are all required.
9. Small, meaningful commits and clean PR histories. Each slice is fully reviewed (review skill, hot-path record) before it merges.

Milestone note: the owner placed #343 in the `3.0.0` milestone as a non-gating item on 2026-11-03: it carries no gate label, is not a release gate, and moves out automatically (to 3.1.0 or 3.x) if it is not ready for the 3.0.0 cut. The three view issues (#1617, #1618, #1619) are in `3.x` with a 3.1.0 target.

## Recommendation (as approved)

Put the MAP window on the 3.0.0 train as a decoupled track and slip it to 3.1.0 if it misses the freeze. Ship only the v1 core. The Rust-only game ships as 2.x releases and 3.0.0 is reserved for confirmed Classic and TDT parity (owner, 2026-10-30), so "in 3.0.0" means merged as a 2.x minor before the 3.0.0 candidate is cut.

- It needs **no engine change** (see Architecture). Rust stays authoritative, saves do not change, no crate bump, no conformance change.
- It is not a gate item and does not touch #945, #1104 or #1561.
- The risks are chrome changes that move every screenshot and visual baseline, files at the 500-line ceiling that other threads edit, a new window on the hot-path surfaces the Performance gate measures, and review capacity.

## What the original MAP window does (own words, sources cited)

Sources: the retail manual's Map Window and Tutorial sections (PDF pp. 14, 23, 32, 39-40), the community Map window wiki article, and the kiwizoid and strawhat FAQs, as summarized in `simtower-final-reference-2026-10-30/SimTower_Complete_PC_Classic_Reference.md` (project files, rows near lines 1688-1697 and 1814-1818). Nothing is copied into the repo.

- A small separate window shows the whole lot as a miniature, in a schematic tower layout.
- An outlined rectangle marks what the main view shows. Clicking the map or dragging the rectangle scrolls the main view.
- The tower is drawn in gray, with elevators as lines colored by kind (the manual: express blue, standard gray, service red).
- Four buttons sit on top: Edit (the default), Eval, Pricing, Hotel. Eval colors tenants by rating, Pricing by rent level, Hotel marks rooms that are dirty in red. The three tinted views pause the game while active.
- The lot is 375 segments wide and the map shows it in full, basements included.
- The manual's tutorial describes the elevator as a black vertical line, while its Map Window section gives colors by kind; the plain description does not settle which Classic should draw. v1 draws a shaft-width mark colored by kind.
- Pixel-level styling was measured later the same day from the PC harness (decision 4): see the SPEC's Retail capture findings. The window is fixed at 200 by 288 px with a fixed scale, and the Edit tab is a flat gray silhouette with no rooms, which changes the Classic style (slice S2b).

## Architecture findings

**Data.** `SimView` already provides everything the plain map needs, cheaply and keyed to the tower revision: `structure` (floor and lobby runs, about 110 on the 40,000-tile `large` fixture), `rooms` (about 2,900 on `large`), `tower.transports`, `highestFloor` and `lowestFloor`, and the bound world from `viewWorld()` (lot width, min and max floor). Kind colors exist in `FACILITY_PRESENTATION`, and a kind's height in floors comes from the catalog the view already binds (`findViewKind(kind)?.floors`, `src/presentation/viewKinds.ts`). For the later views: `UnitView.state` carries `dirty` and `infested` (Hotel); `RenderSim.floorHeatmap(mode)` is Rust-backed and returns per-floor cells with severity (Eval); there is **no bulk rent read**, so Pricing needs a new engine export (crate bump, CHANGELOG section, `npm run engine:compat`, conformance lock, binding declaration). A unit's `state` can move without a revision change, so a state-tinted view repaints on a throttle.

**Camera.** `engine.cam` is driven from `src/render/excalibur/towerInputCamera.ts`. The map reads `cam.pos`, `cam.zoom`, `viewWidth` and `viewHeight`, and moves the camera through the existing `TowerEngine.setCamera` and `applyView`, which clamp through `clampCameraY` and the lot-width clamp. No new camera logic, so the map stays out of `towerInputCamera.ts`.

**Placement.** A DOM window with its own `<canvas>` inside `#stage`, outside the Excalibur render layer. The inspector and editor follow that precedent, pointer capture on the map never competes with the world canvas gesture arbiter, focus and ARIA come for free, and a closed window costs nothing inside the Excalibur frame.

**Drawing.** Paint to an offscreen bitmap only when the tower data changes (about 3,000 rectangles). The camera rectangle is a cheap overlay updated from a dirty check on camera position, zoom and viewport size. No per-frame tower scan. The repaint key is the identity of `rooms`, `structure` and `transports` plus the layout, since a host can repeat a revision (#1296); resize repaints are coalesced to one per animation frame.

## Overlap with in-flight work

| File | State | Handling |
| --- | --- | --- |
| `src/main.ts` (499 lines), `src/ui/UI.ts` (487), `towerInputCamera.ts` (499), `TowerEngine.ts` (492) | At or near the 500-line ceiling | Wire through a new module and one seam, near-zero net lines. Agree file ownership with the Rust-only and Rust-gaps threads before S3. |
| `src/index.html`, `src/styles.css` | Edited by chrome work | Keep map markup and CSS in new files; rebase right before S3. |
| `renderSim.ts`, `src/simport/*`, `src/engine/` type imports | Being moved off `src/engine/` | The map imports only `SimView` and `src/presentation/`. |
| Gallery screenshots, visual baselines | Any chrome change | One chrome PR, one owner approval click, local compare against main first, baselines only through the pinned image. |

## Slices

| Slice | Scope | Status |
| --- | --- | --- |
| S0 | Spec and evidence: `SPEC.md`, optional retail MAP capture on the PC | spec written; retail capture done, findings in the SPEC |
| S1 | Pure geometry (`src/render/overviewMap/geometry.ts`) with unit tests | in this PR |
| S2 | Draw-list builder and style table (`src/render/overviewMap/`) with unit tests and a large-tower budget test | in this PR |
| S2b | Apply the retail capture to Classic: flat gray silhouette, 1 px shaft lines, fixed-scale layout option, dotted camera outline (SPEC, Retail capture findings) | next, before S3 |
| S3 | Window, Map button, camera binding, a11y, "Floor heatmap" rename; all chrome and CSS in one PR | after file ownership is agreed |
| S4 | Playwright desktop and phone-touch specs, visual snapshots (pinned image), gallery scenes, large-tower performance run with the real catalog height lookup, the real pattern source and a real canvas (the S2 unit budget is synthetic and only pins the algorithm's shape), PC run for hardware claims | after S3 |
| S5 | Help entry, CHANGELOG line, minor version bump, backlog row finished, #343 closed | after S4 |
| S6 | Hotel (#1617), Eval (#1618), Pricing (#1619): 3.1.0 | later |

Visibility rule (decision 8): S1 and S2 are pure modules with no caller, so merging them exposes nothing. The Map button and window arrive only in S3 and are enabled for players only once S3 to S5 are all merged.

## Risks

| Risk | Level | Mitigation |
| --- | --- | --- |
| Simulation, save or conformance regression | Very low | Read-only projection, no export, no migration. |
| Gesture or input regression on mobile | Medium | DOM window outside the world canvas; S4 proves the world canvas still pans and pinches with the map open. |
| Frame-time regression | Low to medium | Revision-keyed bitmap, O(1) camera overlay, closed costs nothing, open versus closed measured in S4. |
| Screenshot and baseline churn near the freeze | Medium | One chrome PR, one approval click, local compare first. |
| File-ceiling and rebase conflicts | Medium | New files, near-zero lines in capped files, file ownership agreed before S3. |
| Review capacity | Medium | Review skill per PR (`/bmad-code-review`, since this is UI plumbing) plus the hot-path record. |
| Original-fidelity gap | Low | Edit view is well documented; styling from the retail capture. |

## Release-gate impact

None by design. No change to #945, #1104, #1561, their labels or the milestones. The Performance gate is the one row the feature could touch; closed by default with no per-frame cost, plus the freeze cut-off, keeps its measurements valid. A slice that lands after the freeze waits for 3.1.0.
