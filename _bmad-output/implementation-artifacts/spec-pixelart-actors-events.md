---
title: 'Pixel-art actors and events: the vehicle sprites and the thief and Santa event figures'
type: 'feature'
created: '2026-07-14'
status: 'done'
updated: '2026-07-15'
baseline_commit: 'e3993a8'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-pixel-art-overhaul.md'
  - '{project-root}/_bmad-output/planning-artifacts/design/arch-pixel-art-overhaul-2026-07-14.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-pixelart-people-system.md'
  - '{project-root}/CLAUDE.md'
---

<frozen-after-approval reason="human-owned intent ratified in the art bible (page 08) and arch doc; do not modify unless a human renegotiates the actors-and-events canon">

## Intent

**Problem:** The tower's moving actors and one-off event characters miss the ratified 1994 narrative style (art bible, Figma page 08). Three vehicle sprites are crude: `drawGarbageTruck` is a flat green box with arc wheels and no recycle badge; `drawMetroTrain` has a dark window band with no lit glass, top highlight, or crisp livery; `drawStreetCar` picks a rainbow `ACCENTS` body with soft detailing. Two event characters are placeholder shapes: `drawThief` is a hooded `#2b2f38` blob with an arc loot sack and a `$` glyph, and the Santa inside `drawSanta`'s sleigh is a hand-drawn torso plus an arc face and beard. None of them match the board's clean pixel figures, and the board's own Santa build script paints the gift with the reserved stress red `#C24A3A`, which a faithful port must not reuse for decoration.

**Approach:** Enrich the pixel art of the moving actors and the event figures to the board, and nothing else. This spec is render-only: it touches no `src/engine/` state, adds no engine seam, and changes no motion, gating, or bake plumbing. Every actor already appears only on its real trigger (the garbage truck on the collection hour at an operational center, the metro train on its platform cycle, the street car on the rush-hour parking run, the thief on the crime event's `thiefFx` bump, Santa on the yearly `santaFxSeq` bump), so honesty is preserved by construction: the port keeps those gates untouched and adds no ambient or idle actor. The three vehicle functions in `sprites/facilities.ts` are enriched in place, keeping their exported signatures so the `TowerEngine` bakes read unchanged. The two event figures land in `sprites/events.ts` as new module-private figure helpers (mirroring the existing `drawReindeer` precedent): `drawThiefFigure` and `drawSantaFigure` port the board's `thief` and `santa` rectangle arrays, and the existing `drawThief` and `drawSanta` compose them so `renderThief` and `renderSanta` (and the canon sky-crossing sleigh) stay call-compatible. The one deliberate divergence from the build script: Santa's gift moves off the reserved `#C24A3A` to a non-reserved festive red, because reserved colors are state cues.

## Boundaries & Constraints

**Always:**
- Enrich the sprites in place. Keep the exported signatures `drawGarbageTruck(ctx, w)`, `drawMetroTrain(ctx, w, headlightOn)`, `drawStreetCar(ctx, seed)`, `drawThief(ctx, x, y, scale, caught)`, and `drawSanta(ctx, x, y, scale)` so every `TowerEngine` bake and render call site is unchanged.
- Integer pixel coordinates only. Author every rectangle at integer 1x pixels (port the board rect arrays verbatim); round to integer device pixels after scaling the screen-space event figures.
- Each actor draws only on its real trigger. Preserve the existing gates exactly: the truck on `clock.hour === GARBAGE_COLLECT_HOUR` at an `isOperational` center, the street car on the rush-hour `parkingUse > 0` gate, the thief and Santa on their `thiefFx` / `santaFxSeq` counters polled in `syncEventFx`. Add no ambient, idle, or scattered actor. An empty tower off-hours reads empty.
- Reserved colors are never reused for decoration: stress red `#C24A3A`, vacancy grays `#C9CCC4` / `#B2B0A4`, notice amber `#E8A030`, dirty tray `#D4623A`, ready lamp `#FFD86A`, closed sign `#E0556B`. In particular, port Santa's gift as a non-reserved festive red, not the board build script's `#C24A3A`.
- American English; no em-dashes in new prose or comments. `src/engine/` stays untouched (this is render-only).
- The sprite functions read only their arguments (`ctx`, `w`, `seed`, `x`, `y`, `scale`, `caught`). No new full-collection scan over `tower.units` or `crowd.people`, and no read of live sim state added to a sprite body.

**Ask First:**
- Reframing Santa as a ground-level walking visitor (changing `renderSanta`'s sky placement or the "crossing the sky" emit copy in `EventSystem.ts`). This spec keeps the canon sky sleigh and only upgrades the rider figure; a ground reframe is a separate, reviewed decision.
- Changing any actor bake canvas size (`TowerEngine` fixes the truck at w x 16, the train at w x 9, the street car at 16 x 8). The port fits the board art into those heights; growing a canvas shifts the actor offset and is out of scope here.
- Adopting the people-system security walker for the caught-guard trail, or retiring the metro-platform / party-hall `scatterPeople` crowd. Those belong to the people-system spec, not this one.
- Reading any live sim input inside a sprite, or adding a new input to a bake signature.

**Never:**
- No ghost actor. Do not draw a truck, train, street car, thief, or Santa outside its real trigger window, and do not add a decorative idle instance.
- No engine change. No `src/engine/` touch, no new engine seam, no `SAVE_VERSION` bump, no `Unit` or FX-transient shape change.
- No reserved-color literal in any enriched sprite (guarded by a literal test).
- No `ctx.arc` / non-integer geometry left where the board uses integer rects: the enriched wheels, sack, and figures are integer rectangles.
- No mode branch (Classic or Modern) inside any sprite; the art is identical in both.

## I/O & Edge-Case Matrix

| Scenario | State / action | Expected behavior |
|----------|----------------|-------------------|
| Garbage truck sprite | Actor bakes into the w x 16 canvas (`cache: true`) | Ribbed green hopper (`#4A7A44`) with a top light (`#6A9A5E`), a recycle-arrow badge (`#DCE8C0`), a seam (`#2E5A2A`), cab (`#5A8A54`) with a windowed glint (`#CFE4FF` / `#E4F0FF`), rear loader mouth (`#3A5A36`), two-tone wheels (tire `#16181C` + hub `#5A5E66`), and a couple of bags at the loader. Integer rects; the board's display road row is dropped. |
| Garbage truck gating | `clock.hour === GARBAGE_COLLECT_HOUR` at an operational center | The truck rolls in, loads, and drives off along the center's bottom story (existing motion). At every other hour, or at a non-operational plant, no truck is drawn. Gating unchanged. |
| Metro train sprite | Actor bakes into the w x 9 canvas (`cache: true`) | Silver carriage (`#C6CCD4`) with a top highlight (`#E0E6EC`), red livery (`#D0392B` / `#E85D4A`), a lit window band (`#2A3440` with a `#9FC0E0` glint), and a headlight (`#FFE27A` on, `#9FC0E0` off) driven by `headlightOn`. |
| Metro train motion | Platform cycle | Slides in and out along the platform (existing `trainActors` cycle). Untouched. |
| Street car sprite | Actor bakes into the 16 x 8 canvas (`cache: true`) | Board sedan: body anchored to `#4E7A9E` and roof to `#3E6486` with a per-seed jitter of at most 10 per RGB channel (art-bible variant rule, replacing the rainbow `ACCENTS` pick), two windows (`#CFE4FF`), dark tires (`#16181C`), and a front headlight (`#FFE27A`). |
| Street car gating | Morning or evening rush with `displayParkingUse > 0` | The car cruises the deck (existing `garageCars` ping-pong). Off-rush or with no cars in use, no street car is drawn. Gating unchanged. |
| Thief figure | Crime event: `thiefFx.seq` bumps, `renderThief` runs | The board burglar crosses the prowled floor: striped dark coat (`#232830` with edge shades `#14171C` / `#33383F`, faint stripes `#3A4048`), skin face (`#E8C9A0`), mask band (`#14171C`), cap (`#1A1D22` / `#33383F`), swag sack (`#C9B98A` / `#E0D2A8`) with a tie (`#8A7A54`) and a poking coin (`#E8C14A`), tiptoe legs, and sneaky motion dashes (`#5A6472`). No `$` glyph. |
| Thief caught | `thiefFx.caught === true` | The trailing guard still draws behind (existing behavior), so a caught frame issues strictly more draw calls than an uncaught one. |
| Santa figure | December event: `santaFxSeq` bumps, `renderSanta` runs | The sleigh's rider is the board Santa: red coat (`#B8342E` with edge shades `#8A241E` / `#D0483E`), fur hem (`#F4F0EC` / `#FFFFFF`), belt (`#2A2A2A`) with a buckle (`#E8C14A`), skin face (`#E8C9A0`), beard (`#F4F0EC`) with a rosy cheek (`#E8B090`), hat (`#B8342E`) with a brim and pom (`#FFFFFF`), and a toy sack (`#8A5A3A` / `#A06E48`). |
| Santa sky crossing | Same event | The reindeer, sleigh, reins, and full sky flight are preserved (canon: Santa crosses the sky). Only the rider figure is upgraded. |
| Reserved-color guard | Any enriched sprite draws | No reserved literal appears as decoration. Santa's gift is a non-reserved festive red (coat family, for example `#D0483E`), never the board build script's `#C24A3A`; the green gift bit (`#5AA85A`) is kept. |
| No event, off-hours | No FX bump, hour outside the collection or rush window | No thief, no Santa, no truck, no street car is drawn. The tower reads empty of actors. |
| Reduced motion or pause | `reducedMotion` set, or the sim paused | Event figures are already suppressed or frozen via the anim clock and `syncEventFx`; the enriched sprites inherit that behavior with no change. |
| Per-frame cost | A render frame runs | The vehicle sprites are baked once (`cache: true`); the event figures read only the polled FX transient. No scan over `tower.units` or `crowd.people`, and no `src/engine/` read. |

</frozen-after-approval>

## Code Map

Real functions and files. Render-only; no `src/engine/` change.

- `src/render/sprites/facilities.ts:145` `drawGarbageTruck(ctx, w)`: enrich to board `truck`. Keep the `w`-parameterized hopper and rib run. Add the recycle-arrow badge (`#DCE8C0`), the top light (`#6A9A5E`), the seam (`#2E5A2A`), the darker ribs (`#3A6236`), the window top highlight (`#E4F0FF`), and the bags at the loader mouth. Replace the two `ctx.arc` wheels with integer two-tone rects (tire `#16181C`, hub `#5A5E66`). Drop the board's display road row (in-game the truck rides the center's own deck). Baked at `TowerEngine.ts:2079` (w x 16, `cache: true`); signature and bake unchanged.
- `src/render/sprites/facilities.ts:236` `drawMetroTrain(ctx, w, headlightOn)`: enrich to board `train`. Silver `#C6CCD4` with a `#E0E6EC` top highlight, red livery `#D0392B` + `#E85D4A`, a lit window band `#2A3440` with a `#9FC0E0` glass glint, and a headlight keyed on `headlightOn`. Baked at `TowerEngine.ts:2067` (w x 9); keep the height and the `headlightOn` parameter.
- `src/render/sprites/facilities.ts:175` `drawStreetCar(ctx, seed)`: enrich to board `car`. Anchor the body to `#4E7A9E` and the roof to `#3E6486`, jittered by at most 10 per channel from `seed` (art-bible variant rule), replacing the rainbow `ACCENTS[seed]` pick. Two windows `#CFE4FF`, tires `#16181C`, front headlight `#FFE27A`. Baked at `TowerEngine.ts:2113` (16 x 8); keep the `seed` signature. (The parked-stall car in `drawParking:279` is a separate sprite owned by the utilities and service spec, not this one.)
- `src/render/sprites/events.ts` NEW module-private `drawThiefFigure(ctx, x, footY, s)`: port the board `thief` rect array (striped coat with edge shades, faint burglar stripes, skin face, mask band, cap, swag sack with a tie and a poking coin, tiptoe legs, sneaky motion dashes). Mirrors the `drawReindeer` module-private precedent at `events.ts:19`.
- `src/render/sprites/events.ts:143` `drawThief(ctx, x, y, scale, caught)`: keep the signature. Replace the hooded `#2b2f38` blob, the arc loot sack, and the `$` `fillText` with a `drawThiefFigure` call (scaled, feet at `y`). Keep the trailing guard when `caught`. `renderThief` (`TowerEngine.ts:1173`, feet pinned to `thiefFloor`, sweeps across, scale `max(0.9, zoom)`) is untouched.
- `src/render/sprites/events.ts` NEW module-private `drawSantaFigure(ctx, x, footY, s)`: port the board `santa` rect array (red coat with edge shades, fur hem, belt and buckle, skin face, beard with a rosy cheek, hat with brim and pom, toy sack). Reserved-color fix: the board build script's gift `#C24A3A` is the reserved stress red; substitute a non-reserved festive red (coat family, for example `#D0483E`) and keep the `#5AA85A` green gift bit.
- `src/render/sprites/events.ts:46` `drawSanta(ctx, x, y, scale)`: keep the signature. Keep the reindeer, sleigh, reins, gold trim, and sky flight. Replace the crude inline Santa (torso `#d94322` + arc face + beard + hat) with a `drawSantaFigure` call for the sleigh's rider. `renderSanta` (`TowerEngine.ts:1080`, slides across the sky) is untouched.
- `src/render/excalibur/TowerEngine.ts`: no change. The bakes (2067, 2079, 2113), the event renders (1088, 1179), and the gates (`truckHour` / `isOperational` at 2264-2268, `rushing` at 2284, `syncEventFx` at 391-407) are the existing "only on its real trigger" honesty and are preserved.
- `src/render/sprites.test.ts:200-202`: extend the truck / metro / street-car no-throw tests to assert the enriched fills (badge, livery, headlight) are issued.
- `src/render/sprites.test.ts:274-277` and `src/tests/integration/eventSprites.integration.test.ts:66-75`: update the `drawThief` assertion. The board burglar has no `$`, so drop the `fillText` expectation; keep the "caught issues more draw calls than uncaught" check. The `drawSanta` stroke expectation (reins and antlers, `eventSprites.integration.test.ts:42-49`) still holds; add a fill assertion for the enriched rider.
- NEW literal guard (arch section 9, mirroring `pixelSpritesCommon`): pin the actor and event key colors and assert that no reserved literal (`#C24A3A`, `#C9CCC4`, `#B2B0A4`, `#E8A030`, `#D4623A`, `#FFD86A`, `#E0556B`) appears in the enriched sprites. This pins the Santa-gift fix against future drift.
- `_bmad-output/implementation-artifacts/backlog.md`: if the caught-guard trail is not upgraded to the people-system security walker here, record it as a cross-spec follow-up.
- `package.json`: bump minor (player-facing visual capability).

Both files stay under the 500-line ceiling after enrichment (`facilities.ts` ~375, `events.ts` ~262 at baseline). If either approaches the ceiling, extract the actor sprites into `sprites/actors.ts` or the figure helpers into `sprites/events.figures.ts` under 500 lines from the start; no import path changes for the exported functions.

## Tasks & Acceptance

**Execution (dependency order: vehicle sprites, then event figures, then tests, then version):**
- [x] `src/render/sprites/facilities.ts`: enrich `drawGarbageTruck`, `drawMetroTrain`, and `drawStreetCar` to the board, keeping signatures and bake sizes; integer rects; two-tone wheels replacing the arcs.
- [x] `src/render/sprites/events.ts`: add module-private `drawThiefFigure` and `drawSantaFigure` (board ports); rewire `drawThief` and `drawSanta` to compose them, keeping signatures and the caught-guard and sky-sleigh behavior; apply the reserved-color fix to Santa's gift.
- [x] Tests: extend the vehicle no-throw assertions; update the `drawThief` `fillText` expectation and add the Santa-figure fill; add the reserved-literal guard.
- [x] `package.json`: bump minor. Record any caught-guard follow-up in the backlog.

**Acceptance Criteria:**
- Given a recycling center at an operational plant, when the collection hour (`GARBAGE_COLLECT_HOUR`) arrives, then the enriched truck (ribbed green hopper, recycle badge, cab and window, loader mouth, two-tone wheels, bags) slides in, loads, and drives off, and at every other hour no truck is drawn.
- Given the metro station, when the train actor bakes, then it shows a silver carriage with red livery, a lit window band, a top highlight, and a headlight within the w x 9 canvas, and it slides in and out along the platform unchanged.
- Given a garage run at a rush hour with `displayParkingUse > 0`, when a street car bakes, then it shows the board sedan (blue-anchored with a per-seed jitter of at most 10 per channel, two windows, dark tires, headlight) and cruises the deck; off-rush or with no cars in use, no street car is drawn.
- Given a crime event (`thiefFx` bump), when the overlay renders, then the board burglar figure (striped coat, mask band, cap, swag sack with a poking coin, tiptoe) crosses the prowled floor with no `$` glyph, and the guard trails when `caught` so the caught frame issues strictly more draw calls.
- Given the December Santa event (`santaFxSeq` bump), when the sky renders, then the sleigh and reindeer cross the sky carrying the enriched board Santa (red coat with fur trim, white beard, hat with pom, toy sack), and with no event no Santa is drawn.
- Given every enriched actor and event sprite, when it draws, then no reserved color literal is reused for decoration (in particular Santa's gift is a non-reserved festive red, not `#C24A3A`), and every rectangle is authored at integer pixels.
- Given a render frame, when the sprites draw, then the vehicle sprites are baked once (`cache: true`) and the event figures read only the polled FX transient, with no new scan over `tower.units` or `crowd.people`, and `src/engine/` is untouched.
- Given all four quality gates (`typecheck`, `lint`, `test`, `build`), then all are green; the e2e visual churn is limited to the actor and event pixels, and any non-art pixel move is treated as a bug.

## Design Notes

**Enrich in place, signatures call-compatible.** The vehicle functions are rewritten internally but keep `drawGarbageTruck(ctx, w)`, `drawMetroTrain(ctx, w, headlightOn)`, and `drawStreetCar(ctx, seed)`, so the `TowerEngine` bakes at 2067, 2079, and 2113 read unchanged. For the events, the new board figures are module-private helpers (mirroring `drawReindeer`) that the existing `drawThief` and `drawSanta` compose, so `renderThief`, `renderSanta`, and the sky-crossing sleigh stay call-compatible. This is the same discipline the vehicles and the `person()` family use: land the art without editing every call site.

**The reserved-color correction is load-bearing.** The board's own `santa` build script paints the gift with `#C24A3A`, which is the reserved stress red the art bible forbids for decoration (a red crowd must read only as a transport or service problem). The render port is the one place that deliberately diverges from the build script: Santa's gift moves to a non-reserved festive red. The literal guard pins this so a later refactor cannot reintroduce the reserved value.

**No engine seam, honesty by construction.** Unlike the people-system spec, which adds one read-only elevator-queue projection to `src/engine/`, this spec touches no engine state. Every actor already carries its own trigger gate (the collection hour and `isOperational` for the truck, the `rushing` and `parkingUse` gate for the street car, the `thiefFx` and `santaFxSeq` counters for the events), so "an actor appears only on its real event or vehicle state" holds without any new plumbing. The port keeps those gates verbatim and adds no ambient instance.

**Canvas-height fidelity.** The board tiles are authored a row or two taller than the actor bakes because the board includes a display road or ground-shadow strip (truck 17, train 10, car 9 on the board; 16, 9, 8 in the engine). The port compresses each figure into the fixed bake height rather than resizing the actor, so the bake offsets in `syncMotion` stay correct.

**Shared idiom with the people system, no hard dependency.** The event figures reuse the same skin token (`#E8C9A0`) and integer-pixel idiom as the `person()` family, but they are bespoke event actors, not `person()` occupants, so this spec has no code dependency on the person() rebuild and can land independently. The caught-guard trail could later adopt the people-system security walker; that is a follow-up, not part of this change.

## Verification

**Commands:**
- `npm run typecheck`: expected clean.
- `npm run lint`: expected clean.
- `npm test`: expected all green, including the enriched vehicle and event sprite tests and the reserved-literal guard.
- `npm run build`: expected succeeds.
- Visual regression (`e2e/visual.spec.ts-snapshots`) and screenshots (`docs/screenshots/**`): regenerate only via the pinned Playwright image per CLAUDE.md; the actor and event pixel churn is expected, and any non-art pixel move is a bug.
- Deep review: `/gds-code-review` in-session (gameplay-facing render), per CLAUDE.md and arch section 9.
