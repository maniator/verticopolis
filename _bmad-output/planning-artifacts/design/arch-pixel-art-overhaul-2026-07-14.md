# Pixel-Art Overhaul - Game Architecture

**Architect:** Cloud Dragonborn (with Sally on legibility, Samus on intent)
**Companion to:** `gdd-pixel-art-overhaul-2026-07-14.md`,
`epics-pixel-art-overhaul-2026-07-14.md`, and the art bible
(`../../implementation-artifacts/spec-pixel-art-overhaul.md`).

Produced with `gds-game-architecture`. This document says HOW the render engine
realizes the GDD's visual systems: where each system lives in code, the one
engine data seam, and the discipline that keeps the repaint free of gameplay,
performance, and save regressions. It does not restate the art direction.

---

## 1. Guiding constraint: enrich in place, do not rearchitect

The dispatch, the bake host, and the two-layer grid all stay. The overhaul
enriches the per-kind draw routines and the shared helpers; it adds exactly one
engine data seam (elevator queues and car fill). `src/engine/` stays free of DOM
and rendering.

## 2. Current render architecture (unchanged surface)

- `src/render/scale.ts`: `TILE = 11`, `FLOOR = 44`. Every draw routine fills the
  screen rect it is given; true in-game pixels scale to that rect.
- `src/render/sprites.ts` `drawUnit(d, u, x, y, w, h)`: the single entry. Routes
  by kind and state:
  - `floor` -> `drawFloor`; `lobby` -> `drawLobby`; `state === "construction"`
    -> `drawConstruction`; `fire` -> burnt shell + flames; `gutted` -> burnt shell.
  - `ROOM_KINDS` (office, condo, hotelSingle/Double/Suite, fastFood, restaurant,
    shop, cinema) -> `drawRoom` in `src/render/pixelSprites.ts`.
  - everything else -> `drawInterior` (partyHall, parking, parkingRamp, security,
    medical, housekeeping, recycling, metro, weddingHall).
- `src/render/pixelSprites.ts` `drawRoom`: closed-shutter gate, per-kind switch,
  night dimming, the `vacating` notice badge. Barrel that re-exports `PAL`,
  `SHIRTS`, `SKIN`, `person`, and the look tables.
- Tenant modules: `src/render/pixelSprites/{common,residential,food,shop}.ts`.
- Service / structure / transport / actors:
  `src/render/sprites/{facilities,events,transport,common}.ts` and
  `src/render/sprites/structure/{shell,lobby,entrance,rooftop}.ts`.
- Bake host: `src/render/excalibur/TowerEngine.ts`. Each room bakes into an
  `ex.Canvas`; a signature change re-rasterizes in place.

## 3. The shared visual language (`pixelSprites/common.ts`)

The leverage point every tenant kind imports.

- **Palette.** Add new `PAL` keys only; never mutate existing ones (residential,
  food, shop reference them directly). No new key equals a reserved state color.
- **The `person()` family.** The single most-shared helper. Provide one
  parameterized routine (or a small family: `person` seated 15px, a standing
  variant 18px, a walker 24px) with the finalized geometry from the art bible.
  The exported `person` signature stays call-compatible so existing call sites keep
  working; new detail sits behind defaulted parameters. `SHIRTS` and `SKIN` stay
  the palettes; mood picks the torso fill (`SHIRTS` color, amber `#E8862A`, or
  stress red `#C24A3A`).
- **New shared helpers** (added, not overloaded onto `shell()`): a window/skyline
  view, a warm room-glow pair, ceiling fixtures, a wainscot dado, and cast-shadow,
  all keyed only on `lit` and other signature inputs.
- **geoVariant axis map.** Each kind uses distinct axis integers; the map is
  documented in the art bible. Determinism across a TDT round-trip is automatic
  (a pure function of kind, floor, x). Hold luminance within 10 per RGB channel of
  each anchor.

## 4. The bake-signature boundary (the performance contract)

`TowerEngine.ts` builds the room signature as
`` `${state}:${litState?1:0}:${width}:${occupants}:${outForMeal ?? 0}:${subtype ?? ""}:` `` followed by the concatenated flag characters `open` + `lateNight` + `dead`
(no separators between those three), then an optional `liveBits` suffix (`:pN`
parking use, `:rN` recycle fill, otherwise empty).

Rules the overhaul must hold:

- Decorative art reads ONLY inputs already in the signature. Window views and
  room glow key on `lit`. No new `d.anim` read in a `cache:true` room; only fire,
  construction, and the existing cinema marquee redraw per frame.
- If a new visual must vary on a live input not in the signature, that input is
  added to the signature deliberately (a review decision), never read behind its
  back, or the room will not repaint when it changes.
- No new full-collection scan (`find` / `filter` / `some`) nested in a per-tick or
  per-frame loop. Occupant and queue data arrive as prepared inputs, not derived
  by scanning inside a draw routine.

## 5. File-size strategy (the 500-line ceiling)

Enrichment overflows `fileSize.guard`. Extract before enriching:

- Look tables into data siblings: `pixelSprites/food.looks.ts` (`FASTFOOD_LOOKS`,
  `RESTAURANT_LOOKS`) and `pixelSprites/shop.looks.ts` (`SHOP_LOOKS`), re-exported
  through the `pixelSprites.ts` barrel so `subtypeVisuals` and `barrelSurface`
  keep importing from there.
- If a kind's interior switch still overflows, extract per-interior draw functions
  into `food.interiors.ts` / `shop.interiors.ts` with thin dispatchers. New files
  ship under 500 lines from the start (no new ratchet entries).

## 6. The one engine seam: elevator queues and car fill

The only change that reaches `src/engine/`. Everything else is render-only.

- **Need.** The render layer must draw, per served floor at a shaft landing, the
  ordered waiting sims (tinted by wait) and, inside each car, the boarded sims up
  to capacity. Boarding is queue-minus-who-fit against the same tracked
  individuals.
- **Source of truth.** `Crowd.elevatorCalls(tower)` already produces per-shaft
  hall calls and per-car cab calls that `ElevatorDispatch` consumes. The waiting
  population is already tracked; today the render layer sees only aggregate calls.
- **Seam.** Expose, read-only to the render layer, per-shaft and per-floor a small
  ordered waiter list (count plus a bounded wait-tier per floor) and, per car, its
  boarded count. This is a projection of existing tracked state, not a new
  simulation. It is computed once per outer step alongside `accumulate`, keyed by
  `revision` and memoized (mirror `Tower.stopsOf`), never re-derived per frame.
- **Boundary.** The projection lives in the engine or a thin adapter; the render
  layer in `sprites/transport.ts` (`drawTransport`) reads it and draws the queue
  and fill. The room bake path is untouched (queues are on the transport render
  path, which already redraws, not in `cache:true` room bakes).
- **Fallbacks.** Feed the live crowd (`crowd.elevatorCalls(tower)`) so visible
  waiters are not stranded when statistical demand rounds to zero. Service
  elevators show only real staff waiters. Express skip-stops draw no queue on
  skipped floors.
- **Sequencing.** This seam is the gate for the queue and fill visuals; it is a
  distinct story in E6 so the transport art can land first and the queue and fill
  follow behind the seam.

## 7. Reference draw code -> Canvas 2D port

The committed build scripts under `../../implementation-artifacts/pixelart-figma/build-scripts/`
are the pixel-exact source. Porting is mechanical:

```
F(A, x, y, w, h, color, opacity)
  ->  ctx.fillStyle = color; ctx.globalAlpha = opacity ?? 1; ctx.fillRect(x, y, w, h);
```

A build-script tile function becomes the per-kind draw routine (`office`, `burger`,
`recycling`, ...) under `pixelSprites/**` or `sprites/**`, scaled to the screen
rect and reading only signature inputs. Coordinates stay integer. `rasterize.mjs`
proves the scripts render and regenerates the gallery from the checked-in sources.

## 8. Save, subtype, and mode safety

- Visual-only: no `Unit` shape change, no `SAVE_VERSION` bump, no TDT format
  change. The retail subtype ordinal in `retailSubtypes.ts` is untouched.
- Mode-agnostic: the art is identical in Classic and Modern. No mode branch enters
  a draw routine.
- Party hall two-floor is already engine truth (catalog `floors: 2`,
  `expandLegacyPartyHalls`); the art targets the two-floor rect.

## 9. Testing and verification architecture

- Behavior guards in the same change: `subtypeVisuals` (subtype names and order
  untouched, entries pairwise-distinct), `pixelSpritesCommon` (pinned helper
  colors, updated only if a reserved-adjacent value moves), `fileSize.guard` and
  `barrelSurface` after the extractions.
- Visual regression: regenerate `e2e/visual.spec.ts-snapshots` only via the pinned
  Playwright image; the gallery churn is expected, any non-art pixel move is a bug.
- Screenshots: regenerate `docs/screenshots/**` only via the pinned container.
- The elevator-seam story carries an engine unit test pinning the projection
  (queue order preserved, boarded = min(queue, remaining capacity), leftover is the
  same individuals) at the cheapest tier.
- Deep review is `gds-code-review` (gameplay-facing render and the engine seam),
  run in-session, with `bmad-code-review` if a change also carries a big tooling
  surface.

## 10. Risks

- **Visual-regression churn (high, expected):** every baseline changes. Stage
  per-kind commits; regenerate only via the pinned path; treat any non-art pixel
  move as a real bug.
- **State-cue legibility under richer walls:** hold geo-variant luminance within
  10 per channel; keep reserved literals unchanged; spot-check every kind unlit,
  scrimmed, and heatmapped.
- **Bake-signature drift:** a new visual varying on an unsignatured input silently
  fails to repaint. Review every new input against section 4.
- **Engine seam scope creep:** the queue and fill projection must stay a read-only
  view of existing tracked state. It computes nothing new about who waits or
  boards; it only surfaces it.
