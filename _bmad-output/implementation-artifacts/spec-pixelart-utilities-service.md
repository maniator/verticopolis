---
title: 'Pixel-art utilities and service: recycling, metro, medical, security, housekeeping, and the basement garage'
type: 'feature'
created: '2026-07-14'
status: 'done'
updated: '2026-07-15'
baseline_commit: '2edf133'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-pixel-art-overhaul.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-pixelart-people-system.md'
  - '{project-root}/_bmad-output/planning-artifacts/design/arch-pixel-art-overhaul-2026-07-14.md'
  - '{project-root}/CLAUDE.md'
---

<frozen-after-approval reason="human-owned intent ratified in the art bible and arch doc; do not modify unless a human renegotiates the utilities-and-service art direction">

## Intent

**Problem:** The seven utilities-and-service facilities on Figma page 01 (recycling, metro, medical, security, housekeeping, parking, parking ramp) still render at the pre-overhaul density. Each is a flat `serviceBack` wash with two or three props: `drawSecurity` is a desk plus a green-dot row, `drawMedical` is a red cross plus a bed loop, `drawHousekeeping` is a cart plus a mop, `drawRecycling` is three bins plus the live fill pile, `drawParking` and `drawParkingRamp` are a concrete slab with one car, and `drawMetro` is a tiled wall with a platform. None reads as the warm, lit, lived-in cross-section the ratified art direction calls for, and two of them break the people rules: `drawMetro` sprays a seeded `scatterPeople` crowd on the platform whether or not anyone is actually there (ghost people), and every service figure is the old squat silhouette rather than the finalized human. These are services drawn through `drawInterior`, never leased tenants, so none carries a lease or sale card; their staff are the facility's own, always present when the facility exists.

**Approach:** Port each kind from its committed pixel-exact reference build script under `pixelart-figma/build-scripts/` (recycling, metro, medical, security, housekeeping from `page-01-utilities.build.js`; parking from `page-01-parking-medical-security.build.js`; the ramp from `page-01-parking-ramp.build.js`). Porting is mechanical: each `F(A, x, y, w, h, color, opacity)` rectangle becomes `ctx.fillStyle = color; ctx.globalAlpha = opacity ?? 1; ctx.fillRect(x, y, w, h)`, scaled to the screen rect, integer coordinates only. The figures are NOT re-derived here: this spec inherits the redesigned `person()` family and `moodTint` from the people-system spec and maps the reference helpers to it (`pSeat` to the 15px seated build, `pStand` to the 18px standing build with the white-coat overlay for medical staff, `pWalk` to the 24px `personWalker`, the recycling plant hand a 22px `personHiVis` with a hardhat). Each facility keeps the live inputs already threaded through `DrawCtx`: recycling keeps `d.recycleFill` (its growing waste pile and the green to amber to red FULL gauge), parking keeps `d.parkingUse` and `d.parkingDead` (a car appears only on a chained space, never on a dead one). The metro loses its ghost crowd: the baked station draws empty, and its real-commuter walkers ride the redraw overlay that the people-system traffic seam owns, so an empty tower shows an empty platform. Enrichment overflows the 500-line file, so the seven routines extract into `sprites/utilities.ts` (re-exported through the `sprites/facilities.ts` barrel) before they grow. No engine change: `basement:true` placement, the parking chain, and the fill and usage fractions are already engine truth.

## Boundaries & Constraints

**Always:**
- Port from the reference build scripts; the tile functions are the pixel-exact source and double as the draw code. Integer coordinates only; round before every `fillRect`.
- Reuse the shared `person()` family and `moodTint` from the people-system spec (`pixelSprites`). Do not hand-roll a figure. Map `pSeat` to seated (15px), `pStand` to standing (18px), `pWalk` to `personWalker` (24px), and the recycling hand to `personHiVis` (22px, hardhat).
- Recycling keeps its live waste pile driven by `d.recycleFill` and its FULL gauge cue: green `#6bd47a`, then amber `#e0a94e` past 0.7, then red at 1 with the `FULL` label. The FULL red is a state cue and stays.
- Parking keeps `d.parkingUse` and `d.parkingDead`: a car shows only when `rand(u.id) < parkingUse` and the space is not dead. A dead (unchained) space never shows a car.
- Services carry no lease or sale card and no vacancy state; they always draw their staffed interior (they are never "for lease"). Their staff are the facility's own, always present, not population-gated.
- `basement:true` kinds (parking, parkingRamp, recycling, metro) render only underground; the engine already enforces placement (`roomPlacementReason`, placement.ts:53). Render adds no basement rule.
- American English; no em-dashes in new prose or comments. Reserved colors are never reused for decoration: stress red `#C24A3A`, vacancy grays `#C9CCC4` / `#B2B0A4`, notice amber `#E8A030`, dirty tray `#D4623A`, ready lamp `#FFD86A`, closed sign `#E0556B`. The recycling worker vest amber `#E8862A` is the people-system impatient-mood value and is not a reserved color; it is allowed.
- geoVariant luminance stays within 10 per RGB channel of the anchor for any per-unit garnish. Services derive per-unit variety from the existing `rand(u.id ...)` seeds, not the geoVariant axis.

**Ask First:**
- Adding any new `DrawCtx` or bake-signature input. Recycling (`:rN`) and parking (`:pN`) already have their live suffixes; medical, security, and housekeeping read only `lit`. If a new visual must vary on a live input not already present, add it deliberately as a reviewed decision.
- Changing `PAL`, `SHIRTS`, `SKIN`, or the `geoVariant` axis integers. New palette keys only.
- Touching `drawMetroTrain`, `drawGarbageTruck`, or `drawStreetCar` beyond moving them with the extraction. These actors already match the board and belong to the actors-and-events spec.

**Never:**
- No ghost people. Remove the `scatterPeople` crowd from `drawMetro`; do not replace it with another seeded, population-independent crowd. The real commuter crowd is the people-system traffic seam's overlay.
- No reserved color as decoration. The reference recycling `items` palette in `page-01-utilities.build.js` contains `#C24A3A` as a conveyor bale; the port must substitute a non-reserved recycling color there.
- No new full-collection scan (`find` / `filter` / `some` / a loop over `crowd.people` or `tower.units`) in a per-tick or per-frame draw path. `recycleFill`, `parkingUse`, `parkingDead`, and any commuter count arrive as prepared inputs.
- No metro commuter crowd baked into the `cache:true` station. The crowd rides the redraw overlay so the station does not re-bake as traffic changes.
- No mode branch (Classic or Modern) inside any draw routine. No `Unit` shape change, no `SAVE_VERSION` bump, no TDT format change.

## I/O & Edge-Case Matrix

| Scenario | State / action | Expected behavior |
|----------|----------------|-------------------|
| Recycling, low fill | `d.recycleFill` near 0 | The enriched plant draws (concrete hall, conveyor, baler, three bins, brown bales, a `personHiVis` hand in a hardhat); the waste pile is small and the wall gauge reads green. |
| Recycling, filling | `d.recycleFill` past 0.5 then 0.7 | The pile grows rightward and stacks a second row past half; the gauge crosses to amber `#e0a94e` past 0.7. |
| Recycling, FULL | `d.recycleFill >= 1` | The gauge is red and the `FULL` state label shows. No `#C24A3A` appears on any bale or prop; the FULL red is the only reserved-family red, and it is a state cue. |
| Recycling span | 20 tiles by 2 floors | The composition fills the two-floor rect; the conveyor, baler, and bin row read at the 88px height. |
| Metro, empty tower | No routed commuters | The baked station draws (tunnel, vaulted ceiling with light strips, tiled pillars, lit route-map board, blue METRO sign and red M roundel, benches, yellow-edged platform); the platform is empty. No ghost crowd. |
| Metro, real traffic | Routed commuters present | The commuter walkers draw at the 24px walker scale on the platform via the traffic overlay, tinted content, then amber, then stress red by wait. They are real routed sims only. |
| Metro span and depth | LOT_WIDTH by 3 floors, `basement:true` | Fills the full-lot three-floor rect; renders only underground. |
| Metro train | `drawMetroTrain` actor | The silver carriage with red livery, lit windows, and the blinking headlight still slides along the platform as its own actor. Unchanged. |
| Medical | Any medical unit | Cream tiled walls, ceiling lights, the red cross sign, two curtained exam beds each with a resting patient head on a pillow, a heart monitor with a green trace, an IV stand, a wheelchair, a stocked cabinet, and a nurse and doctor as standing figures with the white-coat overlay. Above-ground allowed. |
| Security | Any security unit | Navy walls, a two-by-five wall of green-dot camera monitors, a seated guard at a console desk, a brass badge shield, a key rack, and the red alarm light with its glow. |
| Housekeeping | Any housekeeping unit | Warm-tan walls, a linen shelf with folded white and blue linens, a teal (`#3E8E8E`) supply cart with towels and spray bottles, a mop and bucket, and a standing housekeeper in the teal uniform. |
| Parking, occupied | `d.parkingUse` high, space chained | A boxy warm-body car sits centered in the single bay over the concrete deck with pillar, beam, and pipe; the blue P sign shows. |
| Parking, empty bay | `rand(u.id) >= parkingUse` | The bay draws empty (deck, stall lines, pillar); no car. |
| Parking, dead space | `d.parkingDead === true` | No car ever, regardless of `parkingUse` (nothing could have driven to an unchained space). |
| Parking, basement-only | `basement:true` | Renders only underground. |
| Parking ramp | Any ramp unit | The descending ramp slab reads as a raised driving surface (shaded slab, dark void beneath, support column, descending yellow chevrons, ramp-mouth portal, the blue P roundel), so it reads as the anchor that spaces chain to. Basement-only. |
| Lit vs unlit | `d.lit` toggles | Warm room glow and lamp glows key on `lit`; state cues (gauge, P sign, red cross, alarm) are unaffected. No `d.anim` read. |
| No lease or vacancy | Service unit idle or empty | Always draws the staffed interior; never a lease or sale card, never a vacancy gray. |
| Per-frame cost | A render frame runs | The frame reads `recycleFill`, `parkingUse`, `parkingDead`, and the prepared commuter count; it runs no scan over `crowd.people` or `tower.units`. |

</frozen-after-approval>

## Code Map

Real functions and files. Pure render; no engine change.

### Reference sources (pixel-exact, port mechanically)

- `pixelart-figma/build-scripts/page-01-utilities.build.js`: authoritative composition for `recycling`, `metro`, `medical`, `security`, `housekeeping`. Uses the finalized figure helpers `pSeat` (15px), `pStand` (18px, `coat` flag), `pWalk` (24px), plus the recycling hi-vis build at line 46 (amber vest `#E8862A` + hardhat `#F4D24A`), and the room helpers `wallp`, `floorb`, `box`, `glow`. The recycling `items` array (line 30) contains the reserved `#C24A3A`; substitute a non-reserved bale color on port.
- `pixelart-figma/build-scripts/page-01-parking-medical-security.build.js`: authoritative composition for `parking` (the `parking()` function, lines 59-72). Its older `person()` medical and security figures are superseded by the finalized figures in `page-01-utilities.build.js`; do not port those two from here. The `cc` variable (line 67) references `#C24A3A` in a dead ternary that paints nothing; the car is `#4E7A9E`. Do not copy the dead artifact.
- `pixelart-figma/build-scripts/page-01-parking-ramp.build.js`: authoritative composition for `parkingRamp` (the `ramp()` function). Solid shaded slab, under-ramp void, support column, descending chevrons, ramp-mouth portal, blue P roundel, side-view car at the foot.

### Render routines (`src/render/sprites/facilities.ts`, extracting to `src/render/sprites/utilities.ts`)

- `drawRecycling(d, u, x, y, w, h)` (facilities.ts:88): port the enriched static plant from the reference, then retain the shipped live behavior: the `d.recycleFill` waste pile (lines 110-127) and the green/amber/red FULL gauge plus `FULL` label (lines 128-137). Swap the flat `serviceBack` for the concrete `wallp`/`floorb` idiom. Replace the plain worker `person(...)` (line 139) with `personHiVis`.
- `drawMetro(d, x, y, w, h)` (facilities.ts:203): port the enriched station. Remove the `scatterPeople` crowd (line 220); the baked station draws empty. Keep the M roundel and METRO sign as icon signage. The train stays a separate actor.
- `drawMedical(ctx, x, y, w, h)` (facilities.ts:47): port the two curtained beds with resting patients, red cross, heart monitor, IV, wheelchair, cabinet; nurse and doctor as standing figures with the white-coat overlay.
- `drawSecurity(ctx, x, y, w, h)` (facilities.ts:30): port the two-by-five monitor wall, seated guard, badge shield, key rack, and red alarm light. Keep the `star` badge helper (facilities.ts:188) or replace with the reference shield.
- `drawHousekeeping(ctx, x, y, w, h)` (facilities.ts:68): port the linen shelf, teal supply cart, mop and bucket, and standing housekeeper.
- `drawParking(d, u, x, y, w, h)` (facilities.ts:247): port the enriched bay; keep the `d.parkingUse` / `d.parkingDead` car-visibility gate (lines 270-287) exactly.
- `drawParkingRamp(ctx, u, x, y, w, h)` (facilities.ts:290): port the shaded descending slab, void, column, chevrons, portal, and P roundel.
- Actors `drawMetroTrain` (236), `drawGarbageTruck` (145), `drawStreetCar` (175): keep as-is; move with the extraction so they sit with their facilities.
- `drawPartyHall` (7) and `drawWeddingHall` (331) stay in `facilities.ts`; other specs own them. Note `drawPartyHall` also calls the ghost `scatterPeople` (line 25); its retirement is the food-and-entertainment spec's, not this one.

### Dispatch and helpers

- `src/render/sprites.ts` `drawInterior` (lines 90-115): thread `d` into the `medical`, `security`, and `housekeeping` cases (they currently pass only `ctx`, lines 99-103) so the interiors can read `d.lit` for the warm glow. This reads only `lit`, already in the bake signature, so no new signature input. `parking`, `recycling`, `metro` already receive `d`.
- `src/render/sprites/common.ts`: `DrawCtx` (34-53) already carries `parkingUse` (46), `parkingDead` (49), `recycleFill` (52). `scatterPeople` (65) is the ghost idiom; this spec stops calling it from `drawMetro`. `serviceBack` (71) and `serviceLabel` (57) remain for the FULL label; the enriched interiors favor icon signage (red cross, METRO/M, P, badge) over text.

### File-size and extraction (500-line ceiling)

- `src/render/sprites/facilities.ts` is 375 lines; enriching seven kinds overflows `fileSize.guard`. Before enriching, extract the seven in-scope routines plus the three actors and the `star` helper into a new `src/render/sprites/utilities.ts`, re-exported through `sprites/facilities.ts` so `sprites.ts` and `barrelSurface` import paths do not change. Both files ship under 500 lines (no new ratchet entry).

### Engine (no change; existing truth)

- `basement:true` placement: `src/engine/tower/placement.ts:53` (`roomPlacementReason`). Render reads it, does not re-implement it.
- Parking chain: `src/engine/tower/routing.ts:125` (`functionalParkingSet`) already decides which spaces are dead; the render receives the result as `d.parkingDead`.
- Fill and usage fractions: `d.recycleFill` and `d.parkingUse` are already computed and threaded. No new read of engine state from a draw routine.

### Tests and bookkeeping

- `src/render/sprites.test.ts`: extend the no-throw coverage to each enriched kind across `lit` on/off, `recycleFill` at 0 / 0.8 / 1, `parkingUse` high with `parkingDead` true and false; assert integer output.
- Reserved-color guard: pin that no service draw palette paints a reserved decoration color, and that `recycleFill >= 1` still yields the red gauge and the `FULL` label. Update only if a reserved-adjacent value moves.
- `fileSize.guard` and `barrelSurface`: re-verify after the extraction.
- `_bmad-output/implementation-artifacts/backlog.md`: record the metro real-commuter crowd as a follow-up dependent on the people-system traffic seam (the `scatterPeople` retirement); note the party-hall `scatterPeople` belongs to the food-and-entertainment spec.
- `package.json`: bump minor (player-facing visual capability).

## Tasks & Acceptance

**Execution (dependency order: extract, then port static, then wire live inputs, then the ghost-crowd removal, then tests):**
- [x] Extract the seven routines plus the three actors and `star` into `src/render/sprites/utilities.ts`; re-export through `sprites/facilities.ts`; re-verify `fileSize.guard` and `barrelSurface`.
- [x] Port `medical`, `security`, `housekeeping` from `page-01-utilities.build.js`; thread `d` into their dispatch cases for the `lit` glow.
- [x] Port `parking` and `parkingRamp` from their reference scripts; keep the `parkingUse` / `parkingDead` gate exactly.
- [x] Port `recycling`: enriched static plant plus the retained `recycleFill` pile and green/amber/red FULL gauge; substitute the reserved `#C24A3A` bale with a non-reserved color; use `personHiVis`.
- [x] Port the `metro` station; remove the `scatterPeople` crowd; leave the platform empty for the traffic overlay; keep the train actor.
- [x] Map every figure to the shared `person()` family (`pSeat` to seated, `pStand` to standing with coat, `pWalk` to `personWalker`, the recycling hand to `personHiVis`). Do not re-derive a figure.
- [x] Tests: per-kind no-throw and integer coverage; the reserved-color and FULL-gauge guard; re-verify the file-size and barrel guards.
- [x] `package.json`: bump minor. Backlog: record the metro-crowd follow-up.

**Acceptance Criteria:**
- Given a recycling unit with `d.recycleFill` at 0, 0.8, and 1, when it renders, then the plant draws with a small, then stacked, then capped pile, the gauge reads green, amber, then red with the `FULL` label, and no bale or prop paints `#C24A3A`.
- Given a metro station in an empty tower, when it renders, then the enriched station draws with no platform crowd; when real commuters are routed, the platform crowd is the real routed walkers at the 24px scale tinted by wait, and `scatterPeople` is not called.
- Given a medical unit, when it renders, then two curtained beds with resting patient heads, the red cross, and a nurse and doctor with the white-coat overlay draw, all at integer coordinates, with no lease or vacancy card.
- Given a parking space, when `d.parkingDead` is true, then no car draws regardless of `d.parkingUse`; when the space is chained and `rand(u.id) < parkingUse`, then one car draws centered in the bay.
- Given any of parking, parkingRamp, recycling, or metro, when placed, then it renders only underground; given security, medical, or housekeeping, then it renders above ground or below.
- Given a render frame, when it draws any of the seven, then it reads only the prepared `DrawCtx` inputs and runs no scan over `crowd.people` or `tower.units`.
- Given all four quality gates (`typecheck`, `lint`, `test`, `build`), then all are green; the visual-regression churn is limited to these facility pixels, and any non-art pixel move is treated as a bug.

## Design Notes

**Inherit the figures, do not re-derive them.** The reference build scripts carry their own `pSeat` / `pStand` / `pWalk` and a hi-vis build so the tiles render standalone, but the shipped render must call the shared `person()` family that the people-system spec redesigns to the same finalized geometry. Mapping the reference helpers to the shared builds keeps every human in the tower one silhouette family and lets this spec ride the mood tinting for free (the recycling and metro figures warm to amber and stress red through `moodTint`, the vest amber `#E8862A` notwithstanding since that is a decoration fill, not a mood).

**The recycling reds are two different things.** The FULL gauge red is a state cue and is meant to be read as alarm; it stays. The conveyor bale `#C24A3A` in the reference is decoration and collides with the reserved stress red, so it is swapped on port. Keeping the two straight is exactly the legibility discipline the art bible asks for: reserved warm reds mean state, never scenery.

**Staff are honest; only the metro crowd is population-gated.** These facilities are staffed amenities that always draw their interior, so their guard, nurse, doctor, housekeeper, and recycling hand are real to the facility and are not ghosts. The one population-driven crowd in this domain is the metro platform, and it is deliberately not baked: it rides the redraw overlay that the people-system traffic seam feeds, so an empty tower reads empty and the station does not re-bake as traffic ebbs and flows. That is why removing `scatterPeople` here is safe even though the real crowd lands with the seam.

**The basement and the chain are already engine truth.** Nothing in this render decides where a facility may sit or whether a parking space works. `roomPlacementReason` enforces `basement:true`, and `functionalParkingSet` decides dead spaces; the render only reflects them through `parkingDead`. The ramp art carries the chain story visually (it reads as the slab spaces must touch), but it enforces nothing.

## Verification

**Commands:**
- `npm run typecheck`: expected clean.
- `npm run lint`: expected clean.
- `npm test`: expected all green, including the per-kind no-throw coverage and the reserved-color and FULL-gauge guard.
- `npm run build`: expected succeeds.
- Visual regression (`e2e/visual.spec.ts-snapshots`) and screenshots (`docs/screenshots/**`): regenerate only via the pinned Playwright image per CLAUDE.md; the facility churn is expected, any non-art pixel move is a bug.
- Deep review: `/gds-code-review` in-session (gameplay-facing render), per CLAUDE.md and the art bible.
