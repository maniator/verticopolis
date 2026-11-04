# Plan: tower MAP window (#343) and release placement

Status: **approved by the owner on 2026-11-03** (decisions below). Repo: maniator/verticopolis, planned against main at 03adf82 (app 2.77.5). Companion spec: `_bmad-output/specs/spec-overview-map/SPEC.md`.

## Owner decisions (2026-11-03)

1. Target 3.0.0. If the complete feature cannot be reviewed, tested and merged before the release candidate freeze, it moves to 3.1.0 automatically. The existing freeze criteria apply (no new calendar deadline). No existing release gate is weakened or delayed. If a release blocker appears, the blocker takes priority and the remaining MAP work moves to 3.1.0.
2. The window is open by default on desktop (closable, with only an explicit choice remembered) and closed on phone behind a Map pill. This revises the same day's first call, which was closed by default everywhere with a Map button. The party's follow-up calls (memory per layout class, onboarding, phone card, Modern banded crop) are in the SPEC decision log.
3. The existing sidebar control labeled "Map overlay" is renamed "Floor heatmap" (done in S3, the same PR as the new chrome). Timing note, 2026-11-03: the chrome reaches players only in S5, when the preview flag comes off (decision 8, nothing user-visible before S5), so the rename rides S5 with it; S3b builds the window behind the flag only.
4. Capture the original PC MAP window for Classic fidelity if practical. It is not a blocker.
5. Classic keeps the original MAP window behavior and styling as closely as the evidence allows. Modern may use richer facility colors and presentation. Superseded 2026-11-04: the owner gave Classic the same look as Modern (room colors and patterns, the banded fitted crop, side margins), and the view tabs will use that look in both modes (SPEC, Decision log). The window's behavior still follows the original.
6. Hotel, Eval and Pricing views are tracked as separate items for 3.1.0 where feasible: #1617 (Hotel), #1618 (Eval), #1619 (Pricing). Superseded the same day: the owner moved all three into 3.0.0 for map parity (S6 to S9 below).
7. Start S0 to S2 when an implementation slot is free. Coordinate S3 with the in-flight work that edits the same files.
8. Nothing user-visible ships until the whole v1 is done: no partially implemented map. Desktop and mobile regression coverage, accessible controls, clean CI, visual snapshot approval and performance validation are all required. The owner made one exception on 2026-11-03: S5 merges before the paired PC perf run, which follows before the release candidate (#1726).
9. Small, meaningful commits and clean PR histories. Each slice is fully reviewed (review skill, hot-path record) before it merges.

Milestone note: the owner placed #343 in the `3.0.0` milestone as a non-gating item on 2026-11-03: it carries no gate label, is not a release gate, and moves out automatically (to 3.1.0 or 3.x) if it is not ready for the 3.0.0 cut. The three view issues (#1617, #1618, #1619) were first in `3.x` with a 3.1.0 target; since the parity decision they are in `3.0.0`, non-gating, with #1727 (S9) beside them.

## Recommendation (as approved)

Put the MAP window on the 3.0.0 train as a decoupled track and slip it to 3.1.0 if it misses the freeze. Ship only the v1 core. The Rust-only game ships as 2.x releases and 3.0.0 is reserved for confirmed Classic and TDT parity (owner, 2026-10-30), so "in 3.0.0" means merged as a 2.x minor before the 3.0.0 candidate is cut.

- It needs **no engine change** (see Architecture). Rust stays authoritative, saves do not change, no crate bump, no conformance change.
- It is not a gate item and does not touch #945, #1104 or #1561.
- The risks are chrome changes that move every screenshot and visual baseline, files at the 500-line ceiling that other threads edit, a new window on the hot-path surfaces the Performance gate measures, and review capacity.

## What the original MAP window does (own words, sources cited)

Sources: the retail manual's Map Window and Tutorial sections (PDF pp. 14, 23, 32, 39-40), the community Map window wiki article, and the kiwizoid and strawhat FAQs, as summarized in `simtower-final-reference-2026-10-30/SimTower_Complete_PC_Classic_Reference.md` (project files, rows near lines 1688-1697 and 1814-1818). Nothing is copied into the repo.

- A small separate window shows the whole lot as a miniature, in a schematic tower layout.
- An outlined rectangle marks what the main view shows. Clicking the map or dragging the rectangle scrolls the main view.
- The tower is drawn in gray, with elevators as lines colored by kind (the manual: express blue, standard gray, service red; the retail capture shows the standard line black, see the SPEC's Retail capture findings).
- Four buttons sit on top: Edit (the default), Eval, Pricing, Hotel. Eval colors tenants by rating, Pricing by rent level, Hotel marks rooms that are dirty in red. The three tinted views pause the game while active. (Whether Verticopolis pauses too is checked against the PC reference; the parity plan's default is no pause.)
- The lot is 375 segments wide and the map shows it in full, basements included.
- The manual's tutorial describes the elevator as a black vertical line, while its Map Window section gives colors by kind; the plain description did not settle which Classic should draw. The retail capture settled it: Classic draws a line 1 CSS px wide at the shaft's left tile, colored by kind, and leaves stairs and escalators out (SPEC, Retail capture findings).
- Pixel-level styling was measured later the same day from the PC harness (decision 4): see the SPEC's Retail capture findings. The window is fixed at 200 by 288 px with a fixed scale, and the Edit tab is a flat gray silhouette with no rooms, which changes the Classic style (slice S2b).
- These findings are history since 2026-11-04 (decision 5): Classic now draws the Map the way Modern does, and the retail look stays recorded in the SPEC only.

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
| S1 | Pure geometry (`src/render/overviewMap/geometry.ts`) with unit tests | merged (#1626) |
| S2 | Draw-list builder and style table (`src/render/overviewMap/`) with unit tests and a large-tower budget test | merged (#1626) |
| S2b | Apply the retail capture to Classic: flat gray silhouette, 1 px shaft lines, fixed-scale layout option, dotted camera outline (SPEC, Retail capture findings); the style table part only, the fixed-scale layout and camera outline land in S3 | merged (#1636); retail elevator colors and stairs left out of Classic in #1640; retired 2026-11-04 when Classic took Modern's look (#1804) |
| S3a | Pure state, no caller: Classic shaft lines, the Modern banded crop, the view's placement against the map (clipped, above, below) and the edge band, the text summary, the per-layout open preference, and the model that decides when to rebuild and redraw | merged (#1665) |
| S3b | Window, Map button and phone pill, camera binding (click, tap, drag, keys), a11y; all chrome and CSS in one PR, built only behind the `?map` preview flag in dev and tooling builds until S5 | merged (#1690) |
| S4 | Playwright desktop and phone-touch specs, visual snapshots (pinned image), large-tower performance run of the map alone with the real catalog height lookup, the real pattern source and a real canvas (the S2 unit budget is synthetic and only pins the algorithm's shape). The gallery scenes move to S5: the gallery documents the player build, which shows the map only once the flag comes off. S4 makes no hardware claim, so it needs no PC run | merged (#1704) |
| S5 | "Floor heatmap" rename, Help entry, gallery scenes (desktop and phone; with a heatmap on, the phone card moves below the legend), the paired open versus closed perf pass in the harness (`perf:worker --aa wasm --map-ab`; the protocol run is the owner's on the PC after merge, #1726), CHANGELOG line, minor version bump, remove the preview flag, backlog row finished, #343 closed | done with this PR (the paired PC run follows, #1726) |
| S6 to S9 | The map's view tabs, now in 3.0.0 (owner, 2026-11-03: parity for 3.0), all held in one stack of pull requests with no URL flag (owner, 2026-11-04) and shipped together or deferred together to 3.1.0 at the RC freeze. S6: the tab row and Hotel (#1617). S7: a Rust export of per-room rating and rent level (crate bump; `roomTiers`, crate 1.19.0, contract in the SPEC). S8: Eval (#1618) and Pricing (#1619). S9: the Modern Traffic and Occupancy tabs, and the sidebar picker and the main-view tint retired. See `_bmad-output/party-mode/overview-map-parity-party-2026-11-03.md`; its S8 palette split by game mode (retail colors for Classic) is superseded by the owner's 2026-11-04 one-look decision, so each view has one style in both modes (SPEC Decision log) | after S5 |

Visibility rule (decision 8): S1 and S2 are pure modules with no caller, so merging them exposes nothing. S3a adds more pure modules with no caller. The Map button and window arrive only in S3b and are enabled for players only once S3 to S5 are all merged.

## Risks

| Risk | Level | Mitigation |
| --- | --- | --- |
| Simulation, save or conformance regression | Very low | Read-only projection, no export, no migration. |
| Gesture or input regression on mobile | Medium | DOM window outside the world canvas; S4 proves the world canvas still pans and pinches with the map open. |
| Frame-time regression | Low to medium | Revision-keyed bitmap, O(1) camera overlay, closed costs nothing; S4 measures the map's own cost on a large tower, and S5 adds the paired open versus closed whole-frame pass; the owner chose to merge S5 first and run it on the PC before the release candidate (#1726). |
| Screenshot and baseline churn near the freeze | Medium | One chrome PR, one approval click, local compare first. |
| File-ceiling and rebase conflicts | Medium | New files, near-zero lines in capped files, file ownership agreed before S3. |
| Review capacity | Medium | Review skill per PR (`/bmad-code-review`, since this is UI plumbing) plus the hot-path record. |
| Original-fidelity gap | Low | The Map no longer copies the retail window's look in either game mode (owner, 2026-11-04: one look), so the retail capture is history in the SPEC. What each view marks, and whether a tab pauses the game (parity plan item 7), are checked on the PC reference (PC checklist A4). |

## Release-gate impact

None by design. No change to #945, #1104, #1561, their labels or the milestones. The Performance gate is the one row the feature could touch; since the Map is open by default on desktop, the paired open-versus-closed measurement on the `large` fixture covers the default state (on the build that removes the flag, since only that build carries the map for players; the owner chose on 2026-11-03 to merge S5 first and run the pass on the PC before the release candidate, #1726, and a regression it shows is fixed before the RC), and with no per-frame cost and the freeze cut-off its measurements stay valid. A slice that lands after the freeze waits for 3.1.0.
