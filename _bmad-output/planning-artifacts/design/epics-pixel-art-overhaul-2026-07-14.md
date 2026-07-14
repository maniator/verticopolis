# Pixel-Art Overhaul - Epics and Stories

**Companion to:** `gdd-pixel-art-overhaul-2026-07-14.md`,
`arch-pixel-art-overhaul-2026-07-14.md`, the art bible
(`../../implementation-artifacts/spec-pixel-art-overhaul.md`), and the per-domain
implementation specs under `../../implementation-artifacts/spec-pixelart-*.md`.

Produced with `gds-create-epics-and-stories`. Sequences the repaint into
buildable stories. Each story names its per-domain spec (the WHAT and the tile
recipes), the render files it touches, and its acceptance criteria. Every story
runs the four quality gates and, being player-facing render work, the mandatory
`gds-code-review` in-session.

## Sequencing rationale

E1 lands the shared language (palette, the `person()` family, helpers) that every
later epic imports, plus the file-size extractions, so no later story fights the
500-line ceiling or re-derives the people geometry. E2 to E8 are per-domain and
mostly parallel once E1 is in; E6 carries the one engine seam and gates its queue
and fill visuals behind it. E7 (states) is verified across the kinds E2 to E6
touch. E9 regenerates baselines and screenshots and runs the deep review once the
art is complete. Baselines regenerate once, at the end, via the pinned path.

## Cross-cutting definition of done (every story)

- Matches its tiles in the rendered gallery and the Figma board tile for tile.
- Occupancy maps to `visibleOccupants(u)`; no ghost people; people use the
  finalized geometry (15 / 18 / 24px).
- Reserved state colors and geometry unchanged; state cues legible lit, unlit,
  scrimmed, and heatmapped.
- Reads only bake-signature inputs; no per-frame full-collection scan; integer
  coordinates.
- Quality gates green; `gds-code-review` run, `patch` findings fixed, `defer`
  findings logged to `backlog.md`. Version bumped once for the player-facing set.

---

## E1 - Shared visual language and file-size prep

Spec: `spec-pixelart-people-system.md` (people), art bible (palette, axis map).
Files: `pixelSprites/common.ts`, `pixelSprites.ts` barrel, new `food.looks.ts` /
`shop.looks.ts`, `pixelSpritesCommon.test.ts`, `fileSize.ratchet.txt`.

- **E1-S1 Palette expansion.** Add the new warm `PAL` keys; assert none equals a
  reserved value; existing keys byte-stable. AC: `pixelSpritesCommon` green;
  residential/food/shop still compile against `PAL`.
- **E1-S2 The `person()` family.** Implement seated 15px, standing 18px, walker
  24px (plus rider 17px, hi-vis worker) with mood-fill and class silhouettes,
  keeping the exported `person` signature call-compatible. AC: existing call sites
  unchanged in behavior; new sizes match the art bible; unit test pins the builds.
- **E1-S3 Shared helpers.** Add window/skyline view, room glow, ceiling fixtures,
  dado, cast shadow, all keyed on `lit`. AC: no `d.anim` read added to a static room.
- **E1-S4 File-size extractions.** Move look tables to `food.looks.ts` /
  `shop.looks.ts`, re-export via the barrel. AC: `fileSize.guard`, `subtypeVisuals`,
  `barrelSurface` green; no new ratchet entries.

## E2 - Tenant rooms

Spec: `spec-pixelart-tenant-rooms.md`. Files: `pixelSprites/residential.ts`,
`common.ts`.

- **E2-S1 Office** (three geo layouts + vacant + night). AC: cubicle / meeting /
  executive layouts, olive carpet, skyline window, seated staff = occupants.
- **E2-S2 Condo** (living / dining / study + for-sale). AC: home-glow signal
  present; late-night asleep dimming; sale card reserved geometry.
- **E2-S3 Hotel grades 1 to 3 + states.** AC: pink bedding; asleep, dirty, ready
  cues unchanged in color and geometry, drawn outside the mirror wrapper.

## E3 - Food and entertainment

Spec: `spec-pixelart-food-entertainment.md`. Files: `pixelSprites/food.ts`
(+ `food.looks.ts`, optional `food.interiors.ts`), `sprites/facilities.ts`
(`drawPartyHall`).

- **E3-S1 Fast food, five distinct subtypes** (each a different room, not a
  recolor). AC: `subtypeVisuals` distinctness holds; menu-board silhouette reads.
- **E3-S2 Restaurants, five distinct subtypes.** AC: dressed tables, seated diners
  = occupants.
- **E3-S3 Cinema (2 floors)** with exits on both floors; keep the animated marquee.
- **E3-S4 Party hall (2 floors)** targeting the shipped two-floor rect.

## E4 - Retail

Spec: `spec-pixelart-retail.md`. Files: `pixelSprites/shop.ts` (+ `shop.looks.ts`).

- **E4-S1 Eleven canon trades** with per-trade awning, sign, and interior. AC:
  striped-awning anchor and closed-hours shutter preserved; ordinal untouched.
- **E4-S2 Generic fallback** byte-stable for an unset subtype.

## E5 - Utilities and service

Spec: `spec-pixelart-utilities-service.md`. Files: `sprites/facilities.ts`.

- **E5-S1 Recycling** (keep `recycleFill` pile and gauge) and **metro** (waiting
  crowd = real commuters, keep the train actor).
- **E5-S2 Medical, security, housekeeping** with staff figures.
- **E5-S3 Parking and ramp** (keep `parkingUse` / `parkingDead` car visibility and
  the ramp-chain requirement).

## E6 - Structure, lobbies, and transport

Specs: `spec-pixelart-structure-transport.md`, plus the queue and fill parts of
`spec-pixelart-people-system.md`. Files: `sprites/structure/{shell,lobby,entrance}.ts`,
`sprites/transport.ts`, `sprites/facilities.ts` (wedding hall), and the engine seam.

- **E6-S1 Floor and construction.** AC: construction reads `state==="construction"`
  and redraws per frame as today.
- **E6-S2 Ground and sky lobby, three entrances.** AC: `LOBBY_VARIANTS` and the
  entrance sentinels unchanged; walkers at 24px; no ambient pedestrians.
- **E6-S3 Wedding hall** (floor 100, two-floor grand composition).
- **E6-S4 Stairs and escalator** single flight landing on floor two; keep rider
  figures.
- **E6-S5 Elevator shafts and cars** (standard, service, express) with the express
  see-through glass, floor-number legibility, FULL red bar, direction lantern.
- **E6-S6 Engine seam: per-floor queues and car fill** (blocks the queue and fill
  visuals). Expose the read-only projection (ordered waiters + wait tier per floor,
  boarded count per car) from tracked crowd state, memoized per `revision`. AC: unit
  test pins queue order, `boarded = min(queue, remaining capacity)`, and that
  leftover waiters are the same individuals; no per-frame scan.
- **E6-S7 Queue and fill render** behind S6. AC: queues tint amber then stress red
  with wait; car fill reads at a glance; service shows staff-only waiters; express
  draws no queue on skipped floors.

## E7 - Unit states

Spec: `spec-pixelart-unit-states.md`. Files: `common.ts`, `sprites/structure.ts`,
per-kind routines.

- **E7-S1 Verify every reserved state visual** (construction, empty lease/sale,
  vacating, asleep, dirty, fire, gutted, closed) stays geo-invariant and legible
  across the kinds E2 to E6 touched. AC: gallery sweep by every state, lit and
  unlit, scrim and heatmap; reserved literals unchanged.

## E8 - Actors and events

Spec: `spec-pixelart-actors-events.md`. Files: `sprites/facilities.ts` (truck,
train, car), `sprites/events.ts` (thief, Santa).

- **E8-S1 Vehicles:** garbage truck, metro train, street car.
- **E8-S2 Events:** thief (crime) and Santa (December), each appearing only on its
  real event.

## E9 - Verification, baselines, review, release

- **E9-S1 Regenerate visual baselines** (`e2e/visual.spec.ts-snapshots`) via the
  pinned image; review the diff kind by kind.
- **E9-S2 Regenerate `docs/screenshots/**`** via the pinned container; compare to
  the reference board.
- **E9-S3 Deep review** (`gds-code-review`) across the set; fix `patch`, log `defer`.
- **E9-S4 Version bump** (minor, one player-facing capability) and the update-flow
  check.

## Dependencies and parallelism

- E1 blocks E2 to E8 (shared helpers and extractions).
- E6-S6 (engine seam) blocks E6-S7 (queue and fill render) only; the rest of E6
  and all of E2 to E5, E8 run in parallel after E1.
- E7 depends on E2 to E6 (states live in those kinds).
- E9 depends on all art epics; baselines regenerate once, last.
