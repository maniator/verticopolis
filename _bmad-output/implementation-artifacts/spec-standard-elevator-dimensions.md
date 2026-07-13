---
title: 'Canon standard elevator dimensions: 4-tile shaft, square car'
type: 'bugfix'
created: '2026-07-12'
status: 'done'
context: []
baseline_commit: '953dcbbf94cbc349591010dc7080fbc08d44670c'
---

<frozen-after-approval reason="human-owned intent: do not modify unless human renegotiates">

## Intent

**Problem:** Our standard elevator was narrowed to 3 tiles to fake a square car at the 34px floor height, diverging from 1994 canon where the standard and service shafts share the same 4-tile footprint. Every TDT import shrinks the save's standard shafts by one tile, leaving a gap beside each shaft the original game does not have.

**Approach:** Restore `elevatorStandard` to width 4 (matching service, per canon "a service elevator is a staff-only standard elevator") and raise the per-floor render height from 34px to 44px so a 4-tile car (44px) stays square. Sprites are parameterized on `(x, y, w, h)` and anchor to the floor line, so they inherit the taller floor; only baked constants need touching.

## Boundaries & Constraints

**Always:** Keep `src/engine/` free of DOM/rendering. Transports keep their own persisted width and the loader trusts it (E1b precedent): old saves load unchanged at their legacy footprints, no forced reflow. All texture bands stay under 2048px. Quality gates green before push. Patch version bump (player-noticeable behavior change).

**Ask First:** (Renegotiated by the owner mid-implementation, 2026-07-12: a shaft-widening migration IS in scope. The owner supplied their SixSeven tower as the golden fixture and asked for a reflow-style migration "same as we updated room sizes".) Save v5 with `upgradeV4toV5`: widen legacy 3-wide elevator shafts in place, per-shaft keep-legacy fallback, never relocate or scramble.

**Never:** Do not change express/service widths, car counts, shaft pooling, spans, or build caps. Do not regenerate visual baselines or docs screenshots from a host browser; only the pinned-container workflows (`[update-baselines]` / `[update-screenshots]` markers) mint them. Do not alter TDT byte formats.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New build | Player places standard elevator | 4-tile shaft, car renders 44x44 (square) | N/A |
| TDT import | Real 1994 save with 4-wide shafts | Shafts import at width 4 on their exact original footprints (no 1-tile gap) | Corrupt entries still dropped/trimmed per existing rules |
| Legacy save | v1-v4 save holding 3-wide standard shafts | v5 migration widens each shaft in place: grow right, else shift left up to the width delta; a boxed-in shaft keeps width 3 and still loads | Garbled transport entries pass through untouched for deserialize's coercion |
| Lot edge | Legacy shaft stored at x=372 (width 3; lot is 375 wide) | Migration shifts it to x=371 at width 4 when clear; if boxed in it keeps width 3 AND the loader must not move it | N/A |
| Tall shaft | 100-floor shaft texture | Bands stay under 2048px (band size reduced from 48 floors) | N/A |

</frozen-after-approval>

## Code Map

- `src/engine/facilities.ts:175-188` -- `elevatorStandard.width` 3 -> 4; replace the "3 tiles = square car" comment with the canon rationale
- `src/render/excalibur/TowerEngine.ts:35-42` -- `FLOOR` 34 -> 44; `TRANSPORT_BAND_FLOORS` 48 -> 45 (45*44 = 1980 < 2048)
- `src/render/sprites/transport.ts` -- parameterized on `floorH`; car (`drawCar`) draws w x floorH, becomes square automatically; verify floor-number font sizing still reads
- `src/render/sprites/{structure,facilities,common}.ts` -- parameterized `(x,y,w,h)`, floor-line anchored; visual check only
- `src/storage/tdtImport.ts:829` -- imported shaft width comes from `FACILITIES[kind].width`; no code change, fidelity fixed by the catalog
- `src/engine/saveMigration.ts` -- `SAVE_VERSION = 5`; `upgradeV4toV5` shaft widening (owner-renegotiated)
- `src/engine/Simulation.ts:2490-2511` -- deserialize preserves stored transport width; the on-lot x-clamp uses `min(stored, catalog)` width so a kept-legacy lot-edge shaft loads at its exact saved x (review fix)
- `src/tests/cameraBounds.test.ts:9` -- local `FLOOR` mirrors the engine constant; updated to 44
- `src/tests/elevatorWidthMigration.test.ts` -- migration + canon width regression suite; `fixtures/sixseven_2.vctower` is the golden real save
- `src/tests/renderTransport.test.ts` -- floorH-parameterized, no change needed
- `src/tests/tdtImport.test.ts:926` -- width assertion is catalog-driven, adapts; overlap check at :934 holds (fixture shafts sit 23 tiles apart)
- `e2e/visual.spec.ts-snapshots/`, `docs/screenshots/` -- regenerate via bot workflows with commit markers
- `_bmad-output/implementation-artifacts/backlog.md:100` -- `service-elevator-width` row resolves in this direction; record any deferred legacy-shaft migration as a new row
- `package.json` -- patch bump on top of whatever main holds at merge time; currently 1.23.2 over main's 1.23.1 (re-resolves the same way if main moves again)

## Tasks & Acceptance

**Execution:**
- [x] `src/engine/facilities.ts` -- set `elevatorStandard.width: 4`, rewrite the width comment -- canon footprint, shared with service
- [x] `src/render/excalibur/TowerEngine.ts` -- `FLOOR = 44`, `TRANSPORT_BAND_FLOORS = 45` -- square car, texture-safe bands
- [x] `src/engine/saveMigration.ts` -- `SAVE_VERSION = 5`, `upgradeV4toV5` widens legacy 3-wide elevator shafts in place (grow right, else shift left; keep-legacy fallback; walkways untouched) -- owner-renegotiated scope
- [x] `src/tests/cameraBounds.test.ts` -- mirror `FLOOR = 44` -- keep the mirrored constant honest
- [x] `npm test` sweep -- walkingPenalties distances moved by the 1-tile edge shift; version-ladder pins in personCensus/reflowMigration/storage/sparseSave now read `SAVE_VERSION`; no assertion weakened
- [x] `src/tests/elevatorWidthMigration.test.ts` + `src/tests/fixtures/sixseven_2.vctower` -- 13 tests: catalog widths, widen right/left/boxed/lot-edge/shared-floor cases, garbled passthrough, migrateSave chain, golden-fixture migration (9 shafts widen in place, no overlaps, sim runs), v5 legacy-width trust -- pins the fix and the compatibility contract
- [x] `_bmad-output/implementation-artifacts/backlog.md` -- `service-elevator-width` moved to Completed (resolved opposite to its proposal); new `walkway-width-migration` row records the deliberate walkway skip -- bookkeeping
- [x] `package.json` -- patch bump on top of main's version at merge time (currently 1.23.2 over 1.23.1; the branch rebased over four main releases) -- player-noticeable change
- [x] Review round (BMGD 3-layer) -- loader x-clamp fix, winningTower fixture repair, `src/render/scale.ts` + `renderScale.test.ts`, migration coverage gaps closed, TDT decode width pinned; defers recorded in backlog -- see Spec Change Log
- [x] Final commit message carries `[update-baselines]` and `[update-screenshots]` (commit 3d4bb03) -- bots re-mint pixels from the pinned container; one follow-up push after the bot commits re-arms CI (GITHUB_TOKEN pushes trigger no workflows)

**Acceptance Criteria:**
- Given a fresh tower, when the player builds a standard elevator, then it occupies 4 tiles and its car sprite is 44x44 world px (square).
- Given my_tower.TDT (3 shafts at x 161/184/207), when imported, then standard and service shafts all have width 4, sit at the save's x positions, and do not overlap.
- Given a v4 save containing width-3 standard shafts (the SixSeven fixture), when loaded, then every shaft that fits widens to 4 in place, boxed-in shafts keep width 3, nothing overlaps or leaves the lot, and the sim runs without error.
- Given a 100-floor shaft, when its texture bands are built, then every band is at most 45 floors (1980px).
- Given the full quality gates (`typecheck`, `lint`, `test`, `build`), when run, then all four pass.

## Spec Change Log

- 2026-07-12 (later rebases, version correction): main moved twice more under the branch (PR #188 screenshot determinism at 1.23.0 and PR #195), so the numbers in the earlier change-log entries are historical; each rebase re-resolves the bump as main's version plus a patch (1.23.2 over main's 1.23.1 as of the latest rebase). The stale bot screenshot commit was dropped during the last rebase in favor of a fresh pinned-container regeneration. Also fixed per Codex: the export overlap warning now builds its rects from the EMITTED tables (first 24 elevator slots plus the first 64 collapsed stair records expanded to their story spans) instead of the raw pre-collapse flight list, so towers whose >64 flights collapse into fewer records warn correctly; regression test pins it.

- 2026-07-12 (delta review round + rebase): rebased onto main twice (volume settings 1.21.1, then camera-view saves 1.22.0; version resolves to 1.22.1; main's SAVE_VERSION stayed 4, so our v5 remains the only v5). The condensed adversarial review of the deferral fixes confirmed one MEDIUM, also flagged independently by Copilot: the loader kept a forged over-wide transport and the new overlap filter then shadow-dropped every healthy transport under its bogus footprint. Fixed by clamping stored width to the catalog width on load (no canon width ever shrank, so above-catalog is always forged); the migration's footprint coercion mirrors the same bound. The export collision warning now covers walkways too and counts drops by emulating the importer's first-kept-wins rule (with the stacked-flight exemption), so the reported number matches what a re-import would actually lose. Review INFO noted and accepted: undo/redo restore runs the healing pass (deterministic, convergent, signature-invisible).

- 2026-07-12 (owner follow-up: "is there no way to fix those new deferrals in this branch?"): all four review deferrals fixed in-branch. (1) The shaft widening is extracted to `widenLegacyElevatorShafts` and re-runs idempotently on every v5 load, so a boxed-in kept-legacy shaft heals to canon on the first load after its blocking neighbor is demolished. (2) `Simulation.deserialize` now drops a transport that overlaps an earlier kept one (stacked-walkway landing exemption preserved), closing the pre-existing forged-save overlap hole. (3) The TDT export report gains a staysBehind warning when a kept-legacy narrow shaft would collide at 1994's fixed elevator width (the format has no width field, so this is the honest ceiling). (4) project-context.md's lot width corrected 340 -> 375. Also per Copilot round 2: cameraBounds.test.ts imports the real `FLOOR` from `render/scale` instead of mirroring a local constant. New tests: heal-on-load, still-boxed-stays, loader overlap drop with walkway stacking survival, export collision warning with a clear-pair control.
- 2026-07-12 (review round, BMGD 3-layer): the frozen lot-edge I/O row carried numbers derived from a stale doc (project-context.md "lot 340 wide"; `GRID.width` is really 375), so x=337 described mid-lot, not the edge. Corrected the row to x=372 -> 371 (the intent, a lot-edge shaft shifting left instead of running off-lot, has exactly one reading; flagged to the owner). Review patches applied: loader x-clamp now uses `min(stored, catalog)` width (Edge Case Hunter HIGH: a kept-legacy 3-wide shaft at x=372 was shoved onto its boxing neighbor on every load); `winningTower` fixture bands step by catalog width and assert placement (two of five shafts silently failed at width 4); scale constants moved to pure `src/render/scale.ts` with `renderScale.test.ts` pinning FLOOR == standard width x TILE and the 2048px band cap; live-footprint blocking and multi-shift migration paths now genuinely covered; TDT decode test asserts imported shaft width. Defers recorded in backlog (migration-vs-coercion on forged saves, TDT export of kept-legacy shafts, one-shot keep-legacy, stale lot-width doc). KEEP: the per-shaft keep-legacy fallback, the never-relocate rule, and the loader trusting stored widths - all three review layers confirmed them sound.
- 2026-07-12 (owner renegotiation, mid-implementation): the frozen "Ask First" migration question was answered by the owner directly ("why can't we reflow and migrate saves? do it, same as we updated room sizes") with their SixSeven tower attached as the example. Scope grew from "no migration, defer to backlog" to save v5 + `upgradeV4toV5` widening legacy shafts in place, with the SixSeven save committed as the golden fixture. KEEP: the per-shaft keep-legacy fallback and the never-relocate rule; the loader keeps trusting stored widths (a boxed-in v5 shaft still loads at 3).

## Design Notes

Migration shape: widening a stored 3-wide shaft in place can collide with a shaft built flush against it, so `upgradeV4toV5` tries x (grow right) then shifts left one column at a time; every candidate keeps the original columns inside the new footprint, so the engine's some-structure-per-floor rule keeps holding and no paving is needed. A shaft that fits nowhere keeps its legacy footprint (renders 33px wide against 44px floors until rebuilt) rather than being relocated, mirroring the v1->v2 reflow's never-scramble rule. Walkways are untouched (see backlog `walkway-width-migration`).

Why 44: the car must match the 4-tile shaft width at TILE = 11. This also lands closer to the original's proportions (SimTower floors are ~4.5 tiles tall; ours go from ~3.1 to 4.0).

## Verification

**Commands:**
- `npm run typecheck && npm run lint` -- expected: clean
- `npm test` -- expected: all green, including the new regression tests
- `npm run build` -- expected: clean build

**Manual checks (if no CLI):**
- Load the game locally: standard and service shafts read as the same width; the car looks square; rooms/lobby/people render sanely at the taller floor; no black bands on tall shafts.

## Suggested Review Order

**Canon footprint (the intent)**

- The one-line canon fix everything else serves: standard back to the service elevator's 4 tiles.
  [`facilities.ts:181`](../../src/engine/facilities.ts#L181)

- Floor height is structurally one shaft-width of tiles, so the car reads square.
  [`scale.ts:13`](../../src/render/scale.ts#L13)

**Save v5 migration**

- The widening algorithm: grow right, shift left up to the delta, keep-legacy fallback.
  [`saveMigration.ts:120`](../../src/engine/saveMigration.ts#L120)

- Version ladder hop wiring; v4 saves route through the widen exactly once.
  [`saveMigration.ts:96`](../../src/engine/saveMigration.ts#L96)

- Review HIGH fix: x-clamp trusts min(stored, catalog) width so lot-edge legacy shafts never move on load.
  [`Simulation.ts:2511`](../../src/engine/Simulation.ts#L2511)

**Render height knock-ons**

- TowerEngine now re-exports the pure scale constants; band cap dropped to 45 floors.
  [`TowerEngine.ts:34`](../../src/render/excalibur/TowerEngine.ts#L34)

**Tests and fixtures**

- The migration suite: unit cases plus the SixSeven golden fixture (real 12k-unit v4 save).
  [`elevatorWidthMigration.test.ts:57`](../../src/tests/elevatorWidthMigration.test.ts#L57)

- Square-car and texture-band invariants, pinned instead of comment-only.
  [`renderScale.test.ts:12`](../../src/tests/renderScale.test.ts#L12)

- Fixture repair: bands step by catalog width and assert placement (was silently unserved at width 4).
  [`winningTower.ts:56`](../../src/tests/fixtures/winningTower.ts#L56)

- Walk distances shifted one tile with the shaft edge; both sides of the 79/80 boundary re-pinned.
  [`walkingPenalties.test.ts:53`](../../src/tests/walkingPenalties.test.ts#L53)

- TDT decode now asserts imported shaft width (the one-tile-narrower import bug).
  [`tdtImport.test.ts:755`](../../src/tests/tdtImport.test.ts#L755)
