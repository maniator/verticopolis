---
title: 'Pixel-art structure and transport: floor, lobbies, entrances, wedding hall, stairs, escalator, and the three elevators'
type: 'feature'
created: '2026-07-14'
status: 'done'
updated: '2026-07-15'
baseline_commit: 'e3993a8'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-pixel-art-overhaul.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-pixelart-people-system.md'
  - '{project-root}/_bmad-output/planning-artifacts/design/arch-pixel-art-overhaul-2026-07-14.md'
  - '{project-root}/_bmad-output/planning-artifacts/design/epics-pixel-art-overhaul-2026-07-14.md'
  - '{project-root}/CLAUDE.md'
---

<frozen-after-approval reason="human-owned intent ratified in the art bible, the arch doc, and epic E6; do not modify unless a human renegotiates the structure/transport canon">

## Intent

**Problem:** Structure and transport are the tower's skeleton and its most-repeated shapes after the sims, and today they miss the ratified 1994 dollhouse style. The bare deck (`drawFloor`) is a flat gray band with no banded texture. The lobby concourse (`drawLobbyTile`) uses coolish gradients and thin decoration rather than the warm veined-marble, gilded-cornice, red-carpet, tall-glass-skyline composition the board calibrates, and the sky lobby is a desaturated recolor rather than the airy floor-to-ceiling-window transfer floor. The three entrances read as functional doors, not the grand front-and-canopy, quiet service back-door, and plain standard treatments on the board. The wedding hall (`drawWeddingHall`) is a single-floor arch-and-rings icon, not the two-floor floral-arch, white-aisle-runner, ribboned-chairs, candelabra, couple-at-the-altar hall the board draws (floor 100 is a two-floor venue now). Stairs and escalator (`drawTransport`) draw a bare tread run and belt with no landing, no warm treads or metallic steps, and no rider. The three elevator shafts and cars (`drawTransport` plus `drawCar`) are close but their express glass backing, floor-number legibility, the FULL red bar, and the direction lantern must survive intact while the shaft, cab, and landing art move to the warm brass and walnut board look. And the lobbies and metro platform still lean on ambient scatter decoration instead of real occupants.

**Approach:** Port the committed page-05 build scripts (the pixel-exact reference draw code) into the existing structure and transport routines, enriching in place with no dispatch or bake-signature change (arch sections 1, 4, 7). Floor, ground and sky lobby, the three entrances, the canopy, and the wedding hall read only signature inputs (`lit`, width, variant) and keep their bake caching. Walkers adopt the 24px `personWalker` build from the people-system spec; lobbies and the metro platform draw NO ambient pedestrians, so the current `scatterPeople` and constant-crowd idiom is retired or gated per that spec (real occupants only, an empty tower reads empty). Stairs and escalator draw exactly ONE flight rising a single floor and terminating in a LANDING on the second-floor deck, carrying the shipped ~17px incline riders (`personRider`). The three elevator shafts keep their pooled 24-shaft canon and per-type dressing: standard and service stay an opaque dark column, express stays the see-through glass shaft the rooms show through; the cab keeps the FULL red bar, the direction lantern, and legible floor numbers. The per-floor waiting QUEUE at each landing and the in-car passenger FILL are NOT redefined here: they are owned by `spec-pixelart-people-system.md` and gated on the E6 engine seam (the read-only `ElevatorQueueView` projection). This spec delivers the shaft, cab, and landing ART plus the landing anchor the overlay draws onto, and references the people-system spec for the overlay contract. Tall shafts and the ground plane stay banded into texture-safe horizontal strips so mobile GPUs never see one giant fill, and no routine adds a per-frame full-collection scan. Construction is a state owned by the unit-states spec, not enriched here.

## Boundaries & Constraints

**Always:**
- Integer pixel coordinates only, in every ported tile and at every call site. Round before `fillRect`.
- Keep `LOBBY_VARIANTS = 4` and the four entrance sentinel integers exactly: `ENTRANCE_GRAND_LEFT = 4`, `ENTRANCE_GRAND_RIGHT = 5`, `ENTRANCE_GRAND_SOLO = 6`, `ENTRANCE_SERVICE = 7` (`structure/lobby.ts:15,30-40`). They index the engine's baked-graphics array (`lobbyGfx[lit][ground][variant]` and the four `entrance*Gfx` canvases in `TowerEngine.bakeSharedGraphics`, `TowerEngine.ts:1480-1508,1847-1849`); renumbering or adding a sentinel desyncs the bake. Enrich the art behind each variant and sentinel; never change the variant contract or the `EntranceKind` union.
- `drawLobby` keys ground vs sky style on `u.floor === 1` (`lobby.ts:82`) as today; tile decoration reads only `lit`, `variant`, and `ground`. No new live input.
- The grand-entrance right slice and the compact tile keep the doorman's two-frame `anim` sway and stay `cache:false` (`TowerEngine.ts:1491-1496`, `entrance.ts` `drawDoorman`). The awning canopy (`drawAwning`) and the service tile stay static `cache:true`.
- Walkers use the 24px `personWalker` build; stairs and escalator riders use the 17px `personRider` build; both from the people-system spec's `person()` family. No local person geometry in these files.
- Stairs and escalator draw exactly one flight per two-floor unit, rising one floor to a landing on the second-floor deck; the top band is the landing, never a second stacked flight (matches the shipped `for (let fl = 1; fl <= t.top - t.bottom; fl++)` rule at `transport.ts:30` and the board's "ONE flight ... LANDING" caption).
- The elevator shaft and cab keep: the express see-through glass backing (low-alpha tint via `shadeAlpha(f.color, -34, 0.35)`, `transport.ts:78`), floor-number legibility (dark drop-shadow plus bright glyph over any tint, `transport.ts:107-110`), the FULL red bar across the cab top edge (`transport.ts:196-199`), and the direction lantern chevron (`transport.ts:201-218`). Express skip floors leave the shaft band blank (`transport.ts:94-97`).
- Transport pooling and caps are canon and untouched (all three elevator kinds share one 24-shaft pool, express not counted separately; stairs and escalators share the 64-link pool; 8 cars per shaft; spans standard and service 30, express whole tower, stairs and escalators 2). This work is ART only.
- Tall shafts and the ground plane band into texture-safe horizontal strips; no single full-height or full-width monolithic fill on a tall shaft or a long deck (mobile GPU texture safety).
- Reserved colors are never reused for decoration: stress red `#C24A3A`, vacancy grays `#C9CCC4` / `#B2B0A4`, notice amber `#E8A030`, dirty tray `#D4623A`, ready lamp `#FFD86A`, closed sign `#E0556B`.
- American English; no em-dashes in new prose or comments. `src/engine/` stays free of DOM and rendering.
- Files stay under the 500-line ceiling; extract the tile bodies before enriching if a structure or transport file would cross it.

**Ask First:**
- Adding any new input to a structural tile's bake path (the lobby and room bakes read `lit`, width, and variant; a new live input is a reviewed decision, never read behind the signature, or the tile will not repaint when it changes).
- Changing `LOBBY_VARIANTS`, the sentinel integers, the `drawLobbyEntrance` `EntranceKind` union, `AWNING_W`, `ESCAPE_W`, or the transport shaft width and car geometry the engine positions actors against.
- Reading crowd, queue, or car-fill state anywhere in these routines beyond the projection the people-system spec threads through `DrawData` (the queue and fill overlay is owned there and gated on the E6 seam).
- Bumping `SAVE_VERSION` or touching any `Unit` shape or TDT format. This work is visual; it must not.

**Never:**
- No ambient pedestrians in lobbies or on the metro platform. Only real occupants and traffic draw. Retire or gate `scatterPeople` (party hall `facilities.ts:25`, metro platform `facilities.ts:220`) per the people-system spec; do not leave a constant lobby or platform crowd behind.
- No second stacked stair flight or escalator run on the arrival (top) floor band.
- No new `d.anim` read added to a `cache:true` structural tile (floor, the four lobby concourse variants, sky lobby, service entrance, awning, wedding hall). Construction's per-frame redraw is owned by the unit-states spec, not added here.
- No redefinition of the elevator QUEUE or car FILL. Those live in `spec-pixelart-people-system.md`, drawn on the transport render path behind the E6 seam; this spec provides only the shaft, cab, and landing art plus the landing anchor.
- No mode branch (Classic or Modern) in any structure or transport draw routine.
- No renumbering of the retail subtype ordinal and no TDT or save change; visual-only.

## I/O & Edge-Case Matrix

| Scenario | State / action | Expected behavior |
|----------|----------------|-------------------|
| Empty deck | `drawFloor` on a bare structural tile | Warm banded deck: ceiling strip, mid slab band, dark base band, faint grout lines. Integer coordinates, `cache:true`, banded into horizontal strips, no per-frame scan. |
| Ground lobby | `drawLobby`, `u.floor === 1` | Warm veined-marble wall and polished floor, gilded cornice, red carpet with gold edge; the frontage shows the tall glass skyline; reception desk with a receptionist; keyed only on `lit`. |
| Sky lobby | `drawLobby`, `u.floor >= 2` | Airy transfer floor: floor-to-ceiling skyline windows, same gold trim, an info desk with an attendant; planter on variant 2, framed print on variant 3. |
| Lobby variant index | `lobbyVariant(u.x + t)` returns 0..3 | The four concourse slots (fluted column / plain / centerpiece chandelier or planter / sconce or framed print); mapping unchanged; adjacent tiles line up into one concourse. |
| Grand entrance, wide | frontage tiles baked as `GRAND_LEFT` + `GRAND_RIGHT` | The two 11px slices compose into one 22px storefront: glass display window, double doors with a gilded split rail, doorman on the carpet, gold rails; doorman sways on `anim`. |
| Grand entrance, compact | narrow lobby, `GRAND_SOLO` | Single-tile door, interior glow, doorman fallback; the board's Standard Entrance tile is the reference for its plainer glass-door read. No new sentinel. |
| Service entrance | `ENTRANCE_SERVICE` | Quiet wood panel door, brass service plate, potted plant; no glow, no doorman; static `cache:true`. |
| Standard entrance | board Standard tile | Plain glass-door frontage; realized within the existing sentinels and the concourse pattern (no fifth sentinel). |
| Entrance canopy | `drawAwning` on floor 1 | Deep-green gilded marquee juts from the frontage wall, replacing the fire escape on the ground row; static; keeps `AWNING_W` and the escape-segment anchor. |
| Wedding hall | `drawWeddingHall`, floor 100, two-floor rect | Two-floor grand hall: floral arch over a white aisle runner, ribboned chairs, candelabra, seated guests, and the couple (a dark-suited figure and a white-gowned figure) at the altar; drawn into the full `w x h` two-floor rect. |
| Stairs | `drawTransport`, kind `stairs`, two floors | One flight rising a single floor to a landing on the second-floor deck; warm tan treads, dark risers, shaded stringer, handrail, top and bottom landings; one ~17px climbing rider; the top band is landing only. |
| Escalator | `drawTransport`, kind `escalator`, two floors | One diagonal run rising a single floor to a second-floor landing; metallic warm-gray steps, glass balustrade and handrail, amber edge dots; evenly spaced ~17px riders. |
| Standard elevator | `drawTransport`, `elevatorStandard` | Opaque dark column, rails, motor caps, per-floor stop lines and legible numbers. |
| Service elevator | `elevatorService` | Same shaft footprint; staff cab dressing (hazard kick plate) via `drawCar`. |
| Express elevator | `elevatorExpress` | See-through glass backing the rooms and desks show through, floor mullions; stops only at served floors; a skipped floor leaves the shaft band blank. |
| Elevator car | `drawCar` | Warm brass and walnut interior with a ceiling dot; FULL red bar on the top edge at capacity; direction lantern chevron while moving; `riders` count from `t.carLoad`. |
| Floor-number legibility | any shaft tint | Dark drop-shadow behind a bright glyph so the number reads on standard, service, and express tint. |
| Landing queue overlay | people-system spec, behind the E6 seam | NOT drawn by this spec. The landing art provides the anchor; the ordered, tier-tinted waiting line is owned by `spec-pixelart-people-system.md` and gated on the engine projection. |
| Car fill overlay | people-system spec, behind the E6 seam | `drawCar` renders `riders` from `t.carLoad`; the passenger FILL count and mood reconciliation (queue minus who fit) is the people-system spec's overlay, not this spec. |
| Empty tower | population is zero | No walkers in the lobbies, no metro-platform crowd, no queue figures; the lobbies and platform read empty. |
| Tall shaft or long deck | a very tall shaft or a wide floor | Banded into per-floor and horizontal strips; no monolithic full fill. |
| Construction state | `u.state === "construction"` | Owned by the unit-states spec; drawn by `drawConstruction` per frame; not enriched here. |

</frozen-after-approval>

## Code Map

Real functions and files, grouped by tile. All are pure Canvas 2D draws ported from the page-05 build scripts (arch section 7: `F(A, x, y, w, h, c, o)` maps to `ctx.fillStyle = c; ctx.globalAlpha = o ?? 1; ctx.fillRect(x, y, w, h)`).

### Floor and deck (`src/render/sprites/structure/shell.ts`)

- `drawFloor(ctx, x, y, w, h)`: port `floorTile` from `page-05-structure.build.js`. Warm banded deck (ceiling strip, mid slab band, dark base band) with faint grout ticks. Stays a pure ctx draw baked into the `cache:true` `floorGfx` canvas (`TowerEngine.ts:1477`). Band into horizontal strips; no full-height monolith.
- `drawConstruction`, `drawBurntShell`, `drawFlames` stay as they are. Construction enrichment is owned by the unit-states spec; leave its per-frame `anim` reads untouched here.

### Lobby concourse and sky lobby (`src/render/sprites/structure/lobby.ts`)

- Keep `LOBBY_VARIANTS = 4`, `lobbyVariant`, the four sentinels, `drawLobbyEntrance`, the `drawLobby` signature, and the `drawLobbyTile(d, x, y, w, h, variant, ground)` contract exactly. Enrich `drawLobbyTile`'s per-variant art to the board: ground reads from `lobbyGround`, sky reads from `skyLobby` (both in `page-05-structure.build.js`). Ground = warm marble, gilded cornice, red carpet, fluted column (variant 0), chandelier (variant 2), sconce (variant 3), tall glass frontage with the reception desk. Sky = skyline windows, planter (variant 2), framed print (variant 3), info desk. Decoration reads only `lit`, `variant`, `ground`.
- Ground and sky crossing figures use `personWalker` (24px) from the people-system spec, gated on real occupancy (no scatter). No ambient pedestrians.
- If `lobby.ts` crosses 500 lines after enrichment, extract the two tile bodies into `structure/lobby.concourse.ts` (or fold the shared floor and cornice strips into a helper) and re-export through `structure.ts` and the `sprites.ts` barrel so every import path and `barrelSurface` resolve unchanged.

### The three entrances plus canopy (`src/render/sprites/structure/entrance.ts`, `structure/rooftop.ts`)

- `drawGrandFacadeLeft` / `drawGrandFacadeRight` (`GRAND_LEFT` / `GRAND_RIGHT`): port `grandEnt` split across the two 11px slices (glass storefront, double doors, doorman, gold rails). Keep `drawDoorman`'s two-frame `anim` sway; these bake `cache:false`.
- `drawGrandCompact` (`GRAND_SOLO`): the narrow single-tile fallback; the board's Standard Entrance (`stdEnt`) is the reference for its plainer glass-door read.
- `drawServiceEntrance` (`ENTRANCE_SERVICE`): port `serviceEnt`; quiet wood door, brass plate, potted plant; static `cache:true`.
- `drawAwning` (`rooftop.ts`, `AWNING_W`): the grand entrance canopy on floor 1, the gilded green marquee that replaces the fire escape on the ground row. Keep `AWNING_W` and the escape-segment anchor geometry; enrich the marquee to the board. Static.
- Mapping: the board's three entrance tiles (Grand, Service, Standard) realize onto the existing four sentinels plus the `drawAwning` canopy. Grand front-and-canopy = `GRAND_LEFT` + `GRAND_RIGHT` (wide) or `GRAND_SOLO` (compact) plus the canopy; service back-door = `ENTRANCE_SERVICE`; standard = the plain concourse frontage and the compact fallback the board's Standard tile calibrates. Keep the sentinel integers exactly.

### Wedding hall (`src/render/sprites/facilities.ts`)

- `drawWeddingHall(ctx, x, y, w, h)`: port `wedding` from `page-05-structure.build.js` to the two-floor grand composition (floral arch over a white aisle runner, ribboned chairs, candelabra, the couple at the altar, seated guests). Floor 100 is a two-floor venue (catalog `floors: 2`, `expandLegacyPartyHalls` precedent in the art bible); draw into the full `w x h` two-floor rect the caller gives. Guests and the couple are seated occupants (15px) via `person(..., seated)`. Dispatched by `drawInterior` (`sprites.ts:109-110`), unchanged.

### Stairs, escalator, elevator shaft, and cab (`src/render/sprites/transport.ts`)

- `drawTransport` stairs branch (`transport.ts:24-45`): port `stairs` from `page-05-stairs-escalator.build.js`. Keep the single-flight rule (top band is the landing). Warm tan treads, dark risers, shaded stringer, handrail, top and bottom landings; one ~17px climbing rider via `personRider`. The open structure (no solid backing) stays.
- `drawTransport` escalator branch (`transport.ts:47-68`): port `escalator`; metallic warm-gray steps, glass balustrade and handrail, amber edge dots, top and bottom landings; evenly spaced ~17px riders. Rises one floor to the second-floor landing.
- `drawTransport` elevator branch (`transport.ts:70-125`): keep the per-type backing (opaque `shade(f.color, -34)` for standard and service; `shadeAlpha(f.color, -34, 0.35)` see-through glass for express), rails, motor caps, per-floor stop lines and legible numbers, and the express skip-floor blanking (`t.skipFloors`). The shaft loop is already per-floor (texture-safe banding). Port the board's warm shaft dressing without touching the express see-through invariant.
- `drawCar(ctx, seed, w, floorH, riders, arrow, full, kind)` (`transport.ts:134-219`): keep the signature, the per-kind cab dressing, the FULL red bar, and the direction lantern. Enrich the cab interior to warm brass and walnut with a ceiling dot per the board. `riders` stays derived from `t.carLoad` by the caller (`TowerEngine.ts:2041`, `ind.riders`); the rider silhouettes use the 17px rider build. The passenger FILL count and mood reconciliation is the people-system spec's overlay behind the E6 seam.

### Cross-spec: the queue and car-fill overlay (owned by the people-system spec, E6 seam)

- The per-floor landing QUEUE and the in-car FILL are specified in `spec-pixelart-people-system.md` and gated on the E6 engine seam (the read-only `ElevatorQueueView` projection threaded through `DrawData` to `drawTransport`, arch section 6). This spec provides the shaft, cab, and landing art and the landing anchor the overlay draws onto; it does not define the projection, the ordered queue draw, or the boarding reconciliation. See that spec's Code Map, "Engine seam (E6 story)."

### Engine bake, no contract change (`src/render/excalibur/TowerEngine.ts`)

- `bakeSharedGraphics` (`TowerEngine.ts:1466-1560`): `floorGfx`, `lobbyGfx[lit][ground][variant]`, the four `entrance*Gfx` canvases, `awningGfx`, and `escGfx` bake unchanged; the enriched draw routines rasterize in place. The grand slices stay `cache:false` (doorman `anim`); floor, lobby variants, sky lobby, service, awning, and wedding hall stay `cache:true`.
- `drawTransport` and `drawCar` wiring (transport actor at `~1995`, car actor at `~2041` reading `ind.riders` from `t.carLoad`) is unchanged. The walker bake canvases (`bakePerson` 8x14, `personGfxRed` 8x16 at `TowerEngine.ts:1532-1559`) grow for the 24px walker in the people-system spec, not here (referenced, not duplicated).

### Tests and bookkeeping

- `src/render/sprites.test.ts`: the existing lobby, entrance, and transport no-throw tests, `lobbyVariant` determinism, and entrance-variant distinctness stay green; extend for the wedding-hall two-floor draw and the stairs and escalator single-flight-plus-landing.
- `src/tests/barrelSurface.test.ts`: the structure barrel surface (`LOBBY_VARIANTS`, the four sentinels, `drawLobbyEntrance`, `drawAwning`, and the rest) stays byte-identical unless an extraction adds a re-export.
- `fileSize.guard`: re-verify after any lobby or transport extraction; new files ship under 500 lines with no new ratchet entry.
- `_bmad-output/implementation-artifacts/backlog.md`: record the `scatterPeople` retirement follow-up (shared with the people-system spec) if it lands as a follow-up; note the E6 queue and fill seam dependency for the overlay.
- `package.json`: bump minor (player-facing visual capability), coordinated once across the overhaul set per the epics.

## Tasks & Acceptance

**Execution (dependency order: the shared `person()` family first (E1, people-system spec), then these structural and transport tiles, then the overlay behind the E6 seam):**
- [x] Port `drawFloor` to the warm banded deck; keep `cache:true` and horizontal strips.
- [x] Enrich `drawLobbyTile` ground and sky art to the board; keep `LOBBY_VARIANTS`, `lobbyVariant`, the `u.floor === 1` ground key, and the four sentinels exactly; walkers via `personWalker`, no scatter.
- [x] Port the three entrances plus canopy: grand left / right / solo (keep the doorman `anim`), service (static), and the `drawAwning` marquee; sentinel integers unchanged.
- [x] Port `drawWeddingHall` to the two-floor grand composition; guests and the couple as seated occupants at the altar.
- [x] Port stairs and escalator to the single-flight-plus-landing board tiles; ~17px riders; keep the single-flight rule.
- [x] Enrich the elevator shaft and `drawCar` to the board; keep the express see-through glass, floor-number legibility, the FULL red bar, and the direction lantern; keep express skip-floor blanking.
- [x] Retire or gate `scatterPeople` (party hall, metro) per the people-system spec; no ambient lobby or platform crowd; record any deferral in the backlog.
- [x] Reference (do not redefine) the people-system queue and fill overlay plus the E6 seam for the landing queue and the car FILL.
- [x] Tests: extend `sprites.test.ts` (wedding two-floor, stairs and escalator landing, no-throw); keep `barrelSurface`, `fileSize.guard`, and `lobbyVariant` green; extract before enriching if a file crosses 500 lines.
- [x] `package.json`: bump minor (once for the set).

**Acceptance Criteria:**
- Given `drawLobby` on a floor-1 unit, when it bakes, then each 11px slice renders warm marble, a gilded cornice, red carpet, and its variant decoration (column, chandelier, or sconce), and `lobbyVariant(u.x + t)` still returns 0..3 with adjacent tiles aligned; `LOBBY_VARIANTS` and the four entrance sentinel integers are unchanged.
- Given the wide grand entrance, when floor-1 frontage tiles bake as `GRAND_LEFT` + `GRAND_RIGHT`, then the two 11px slices compose into one 22px storefront with the doorman swaying on `anim`, the `drawAwning` canopy juts from the frontage, and the compact `GRAND_SOLO` renders the narrow fallback; no sentinel was added or renumbered.
- Given the wedding hall on floor 100, when it bakes into its two-floor rect, then the floral arch, white aisle runner, ribboned chairs, candelabra, seated guests, and the couple at the altar all read, and guests use the 15px seated occupant build.
- Given a two-floor stairway or escalator, when `drawTransport` draws it, then exactly one flight rises one floor to a landing on the second-floor deck (the top band is the landing only), and the incline carries the ~17px rider build.
- Given the three elevator kinds, when the shafts and cars draw, then standard and service show an opaque dark column while express shows the see-through glass backing the rooms show through, floor numbers stay legible on every tint, the cab keeps the FULL red bar and the direction lantern, and express skip floors leave the shaft band blank.
- Given any lobby, corridor, or metro platform, when population is zero, then no ambient pedestrian draws; walkers appear only for real occupants and traffic at the 24px build, and no `scatterPeople` constant crowd remains.
- Given the landing queue and the car FILL, when they render, then they are drawn by the people-system spec behind the E6 engine-seam projection reading `t.carLoad`, not by this spec; this spec supplies only the shaft, cab, and landing art plus the landing anchor.
- Given all four quality gates (`typecheck`, `lint`, `test`, `build`), then all are green; the e2e visual churn is limited to structure and transport tile pixels, and any non-art pixel move is treated as a bug.

## Design Notes

**The sentinels index the bake array, so they are frozen.** `TowerEngine.bakeSharedGraphics` bakes `lobbyGfx[lit][ground][0..LOBBY_VARIANTS-1]` and four discrete `entrance*Gfx` canvases, and `lobbyTileGfx` picks by `lobbyVariant(u.x)` and the entrance sentinels (`TowerEngine.ts:1480-1508,1847-1849`). The board's three narrative entrances (grand front-and-canopy, service back-door, standard) map onto the existing four sentinels plus the `drawAwning` canopy; the enrichment repaints the art behind each slot and never renumbers. That is why the spec forbids touching `LOBBY_VARIANTS`, the sentinel integers, or the `EntranceKind` union: any renumber desyncs the baked-graphics array and the floor-1 entrance map.

**The overlay is a seam, not this spec.** The visible per-floor queue and in-car fill are engine-data fidelity (the same tracked sims boarding in order up to capacity), so they live in the people-system spec and the E6 read-only projection. Keeping them out of this spec keeps the structural tiles on the `cache:true` bake path and the shaft on the transport render path, with the queue and fill drawn over the landing the shaft already provides. The elevator seam is arch section 6; this spec owns the art the seam draws onto.

**One flight, one landing.** The board's stairs and escalator captions pin "ONE flight ... LANDING on the second-floor deck." The shipped `drawTransport` already draws one flight per connected floor pair with the top band as the arrival landing (`transport.ts:30`), so the enrichment keeps that rule and adds the warm treads, the metallic steps, and the ~17px rider; a two-floor unit never shows two stacked flights.

**Texture-safe banding for mobile GPUs.** Tall shafts and the long ground plane fill as per-floor and horizontal strips (the shaft loop already iterates per floor; the deck bands into ceiling, slab, and base), so no draw issues one giant texture a mobile GPU would choke on, honoring the art bible's mobile constraint.

## Verification

**Commands:**
- `npm run typecheck`: expected clean.
- `npm run lint`: expected clean.
- `npm test`: expected all green, including `sprites.test.ts` (lobby, entrance, transport, and wedding no-throw; `lobbyVariant` determinism; entrance-variant distinctness), `barrelSurface`, and `fileSize.guard`.
- `npm run build`: expected succeeds.
- Visual regression (`e2e/visual.spec.ts-snapshots`) and screenshots (`docs/screenshots/**`): regenerate only via the pinned Playwright image per CLAUDE.md; the structure and transport churn is expected, any non-art pixel move is a bug.
- Deep review: `/gds-code-review` in-session (gameplay-facing render; the elevator landing feeds the engine-data-fidelity seam), per CLAUDE.md and arch section 9.
