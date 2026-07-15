---
title: 'Pixel-art tenant rooms: office, condo, and hotel dollhouse interiors with geo-seeded layouts and reserved state cues'
type: 'feature'
created: '2026-07-14'
status: 'done'
updated: '2026-07-15'
baseline_commit: 'e3993a8'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-pixel-art-overhaul.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-pixelart-people-system.md'
  - '{project-root}/_bmad-output/planning-artifacts/design/arch-pixel-art-overhaul-2026-07-14.md'
  - '{project-root}/_bmad-output/implementation-artifacts/pixelart-figma/build-scripts/page-02-offices-residential.build.js'
  - '{project-root}/CLAUDE.md'
---

<frozen-after-approval reason="human-owned intent ratified in the art bible (page 02) and arch doc; do not modify unless a human renegotiates the tenant-room art canon or the bake-signature boundary">

## Intent

**Problem:** Office, condo, and the three hotel grades ship the first-pass dollhouse art (`pixelSprites/residential.ts`): a flat `shell()` wall, a hard floor line, and a few furniture rectangles. They miss the ratified 1994 narrative look the Figma board (page 02 `25:3`) now defines. Three gaps. (1) Composition: no warm crown-molding ceiling with downlights, no pinstriped or papered interior wall, no wainscot dado, no plank floor with grain, no curtained skyline window, so the rooms read as diagrams rather than lit cross-sections. (2) Palette drift: the office carpet, hotel bedding, window sky, and lamp glow are hand-picked hexes rather than the canon `PAL` keys (`carpetGreen`, `hotelPink`, `hotelRed`, `skyDay`, `skyNight`, `cityLight`, `glowLit`), so the warm-inside-cool-outside pillar does not hold and the palette is not luminance-validated against the night scrim and heatmap. (3) Figure scale: seated occupants render at the old squat `person()` build (roughly 10px) instead of the owner-approved 15px seated occupant, so a diner and a lobby crosser are the same silhouette at two zooms.

**Approach:** Port the three room routines to the page-02 build script (`page-02-offices-residential.build.js`), which is the pixel-exact reference draw code (`F(A,x,y,w,h,c,o)` maps directly to `ctx.fillRect`). The composition detail lives in a small set of new shared dollhouse helpers (interior wall, ceiling cap, downlights, wainscot dado, plank floor, skyline window, warm room glow, curtain, framed art, bevel box), added to `pixelSprites/common.ts` and reused by every later tenant, food, retail, and lobby spec, all keyed only on signature inputs (`lit`, `occupants`, the condo `lateNight` flag). Office keeps its three geo-seeded layouts (cubicle row, meeting room, executive corner) plus the vacant and night reads, over olive `carpetGreen` under a curtained skyline window, any layout mirrored, seated staff mapped one-to-one to `visibleOccupants(u)`. Condo keeps its three layouts (living, dining, study) plus the for-sale read, with the standing-lamp home-glow signal preserved in every layout and the late-night asleep dimming intact. Hotel grades 1 to 3 get `hotelPink` bedding on a walnut headboard, and their reserved state cues (asleep sleeper and floating "z", dirty tray, ready lamp) stay drawn OUTSIDE the `maybeMirrored` wrapper at unchanged colors and geometry so a flipped room broadcasts ready, asleep, and dirty pixel-identically. Occupancy is always `visibleOccupants(u)`; the seated occupant figure is the people-system spec's redesigned 15px build, inherited unchanged (this spec does not redefine people geometry). Vacant and for-sale keep the reserved `vacancy()` gray shell verbatim; no state cue is redecorated.

This is a pure-render change. No `Unit` shape change, no `SAVE_VERSION` bump, no TDT touch, no engine read. It reads only inputs already in the room bake signature (`TowerEngine.ts:1632`), so every room still repaints exactly when its look changes and never on a per-frame `d.anim` read.

## Boundaries & Constraints

**Always:**
- Draw only from inputs already in the room bake signature (`TowerEngine.ts:1632`): `u.state`, `litState` (`d.lit`), `u.width`, `u.occupants`, `u.outForMeal`, and the condo `lateNight` flag (`TowerEngine.ts:1610`). Window day/night keys on `d.lit`; occupant count keys on `visibleOccupants(u)`; condo home glow and asleep dim key on occupancy and `lateNight`. No new signature input is introduced.
- Occupancy is `visibleOccupants(u)` (`u.occupants - (u.outForMeal ?? 0)`, `crowd/person.ts`). Seated occupant count equals the visible count, capped by the available seats or desks in the layout, filled in seat order. Empty rooms draw zero occupants.
- Seated occupants render through the existing `person(ctx, x, footY, s, seed, true)` call, which the people-system spec has redesigned to the 15px seated build. This spec keeps the `seated = true` call sites and does not redefine or fork people geometry.
- Integer pixel coordinates only, in every helper and every call site. Round before `fillRect`.
- Add new `PAL` keys only (`warmWall`, `carpetGreen`, `hotelPink`, `hotelRed`, `skyDay`, `skyNight`, `cityLight`, `glowLit`, `glowDim`, `walnut`, `oak`); never mutate an existing anchor. No new key equals a reserved value.
- Hotel state cues and their nightstand anchor draw OUTSIDE `maybeMirrored`, at unchanged colors and geometry: dirty tray `#D4623A`, ready lamp `#FFD86A` (with its 1px ink socket ring), asleep sleeper and "z". The "z" is text and must stay outside the wrapper (mirrored text renders backward).
- geo-seeded variety differs in geometry first (layout, furniture, mirroring); color is support. Hold each variant's luminance within 10 per RGB channel of its anchor, so night scrim, heatmap tint, and lit/dark reads never grow ambiguous.
- American English; no em-dashes in new prose or comments.

**Ask First:**
- Adding any new input to the room bake signature. If a room visual must vary on a live input not already there, it is a reviewed signature change, never read behind the signature's back (or the room will not repaint).
- Changing `geoVariant` axis integers for office, condo, or hotel, or reordering a wall or picture look table (the geo pick is a pure function of kind, floor, and x; changing it moves every existing tower's rooms).
- Reading `d.anim` in any of these rooms, or moving queues, car fill, or any animated element onto the room bake path.

**Never:**
- No reserved color used for decoration: stress red `#C24A3A` (`PAL.red`), vacancy grays `#C9CCC4` / `#B2B0A4`, notice amber `#E8A030`, dirty tray `#D4623A`, ready lamp `#FFD86A`, closed sign `#E0556B`. These appear only in their reserved state cues.
- No `d.anim` read added to office, condo, or hotel (all `cache:true` room kinds). Window night, lamp glow, and lit monitors key on `lit`, `occupants`, and `lateNight`, never on animation.
- No redecoration of the vacant (`vacancy(..., "LEASE")`) or for-sale (`vacancy(..., "SALE")`) reads; the reserved gray hatched shell stays verbatim.
- No ghost occupants: a figure appears only where `visibleOccupants(u)` places it. No scattered residents in an empty condo, no seated staff at an unoccupied desk.
- No file over the 500-line ceiling: extract before enriching.

## I/O & Edge-Case Matrix

| Scenario | State / action | Expected behavior |
|----------|----------------|-------------------|
| Office cubicle row | `layout = geoVariant(u,3,5)` is 0 to 2 | Crown-molding ceiling with downlights, pinstriped `warmWall` interior wall, wainscot dado, `carpetGreen` plank floor, curtained skyline window, a bank of cubicles with lit monitors; seated staff up to the desk count. |
| Office meeting room | `geoVariant(u,3,5) === 3` | Boardroom table with laptop and papers, high-back chairs both sides, seated staff up to the chair count, a corner plant. |
| Office executive | `geoVariant(u,3,5) === 4` | Big walnut desk with a seated executive, tall binder shelf, plus two side cubicles so a staffed office still shows its people. |
| Office vacant | `u.state === "empty"` | `vacancy(ctx,x,y,w,h,"LEASE")` verbatim: reserved gray hatched shell with the LEASE card. No warm interior, no occupants. |
| Office night | `d.lit` true, `visibleOccupants(u) === 0` | Downlights read off, window shows the `skyNight` skyline with sparse `cityLight` dots; the `drawRoom` empty-at-night scrim dims the room. Keyed on `lit` and `occupants`, no `d.anim`. |
| Office occupancy | `visibleOccupants(u) === n` | Exactly `min(n, seats)` seated staff in content colors, filled in seat order; monitors at seated desks read lit, empty desks dark. |
| Office mirror | `geoVariant(u,4,2) === 1` | The whole layout draws mirrored via `maybeMirrored`; the wall band, window, and props flip together; integer coordinates preserved. |
| Condo living | `geoVariant(u,3,5)` is 0 to 2 | Papered wall with a framed art pair, ceiling light, curtained window, a tufted sofa with a seated resident when home, coffee table, standing floor lamp, and a right-slot swap (TV, low bookshelf, or plant). |
| Condo dining | `geoVariant(u,3,5) === 3` | Kitchenette with stove and upper cabinet, a set table with place settings and a candle glow, two seated diners when home, a sideboard, the standing lamp. |
| Condo study | `geoVariant(u,3,5) === 4` | A tall bookcase wall, a desk with an open book under the standing lamp, a seated reader when home, a low cabinet. |
| Condo home glow | `visibleOccupants(u) > 0` and not late night | Standing lamp and candle glow read `glowLit`; the TV screen and window read warm/active. The lamp appears in every layout so the home-glow signal survives the layout shuffle. |
| Condo late-night asleep | `visibleOccupants(u) > 0` and hour in [23,6) (the `lateNight` flag) | Lamp glow drops to `glowDim`, and the `drawRoom` asleep-home scrim dims the room. Keyed on `lateNight` (in the signature for condo) and occupancy. |
| Condo empty | `visibleOccupants(u) === 0` | No residents; standing lamp reads `glowDim`; TV dark. Room reads unoccupied. |
| Condo for-sale | `u.state === "empty"` | `vacancy(ctx,x,y,w,h,"SALE")` verbatim: reserved gray hatched shell with the SALE card (a condo is sold once, not leased). |
| Hotel single (grade 1) | `hotel(...,1)`, ready | Papered wall, crown molding, ceiling light, curtained window, a tall walnut headboard, one `hotelPink` bed with a plumped pillow, a dresser, and the ready lamp lit. |
| Hotel double (grade 2) | `hotel(...,2)`, ready | Two `hotelPink` beds with a real gap sharing a central nightstand, framed art, curtained window, ready lamp lit. |
| Hotel suite (grade 3) | `hotel(...,3)`, ready | A sitting sofa with its own floor lamp, coffee table, a wide two-pillow `hotelPink` bed on a deeper wall band, wall art, curtained window, ready lamp. |
| Hotel ready lamp | `lit` (not asleep, occupied or `d.lit`) | Ready lamp `#FFD86A` with a 1px ink socket ring, drawn OUTSIDE the mirror at the nightstand. `glowLit` / `cityLight` never adjacent to it (legibility rule). |
| Hotel asleep | `u.state === "asleep"` | Dark `#3A3550` wall and floor, a guest under a `hotelRed` blanket, a floating "z" (ink, or white with a 1px ink edge over `hotelRed`), all outside the mirror. No ready lamp. |
| Hotel dirty | `u.state === "dirty"` | Rumpled bedding and the orange housekeeping tray `#D4623A` on the nightstand, drawn OUTSIDE the mirror with a 1px ink separator from any warm decoration. No ready lamp. |
| Hotel mirror | `geoVariant(u,1,2) === 1` | Bed plan flips via `maybeMirrored`; the nightstand, ready lamp, dirty tray, and "z" draw outside the wrapper so they land pixel-identically on a flipped room. |
| Notice ribbon | `u.state === "vacating"` | `drawRoom` overlays `noticeBadge` (amber `#E8A030`) after the room draws; unchanged, keeps its 1px ink separator from any warm decoration. |
| Reserved-color guard | Any decoration pixel | No decoration equals `#C24A3A`, `#C9CCC4`, `#B2B0A4`, `#E8A030`, `#D4623A`, `#FFD86A`, or `#E0556B`. Pinned by the `pixelSpritesCommon` literal guard. |
| Bake signature stable | Any redraw | Every look above resolves from `u.state`, `litState`, `u.width`, `u.occupants`, `u.outForMeal`, and the condo `lateNight` flag; the signature at `TowerEngine.ts:1632` is unchanged and repaints correctly. |

</frozen-after-approval>

## Code Map

Real functions and files. Pure-render only; no engine or storage file is touched.

### Shared dollhouse helpers (`src/render/pixelSprites/common.ts`)

Port the page-02 build-script helpers into named shared helpers, added alongside `shell()` (not overloaded onto it), per arch section 3. Each `F(A,x,y,w,h,c,o)` becomes `ctx.fillStyle = c; ctx.globalAlpha = o ?? 1; ctx.fillRect(x,y,w,h)`. All key only on `lit` and other signature inputs.

- Add new `PAL` keys to the block at `common.ts:13-24` (never mutate existing): `warmWall` `#ECDFC2`, `carpetGreen` `#6E7A48`, `hotelPink` `#E8B7A8`, `hotelRed` `#A83C4A`, `skyDay` `#9CC4DE`, `skyNight` `#2A3350`, `cityLight` `#F3D08A`, `glowLit` `#F8E2B4`, `glowDim` `#8A7A5C`, `walnut` `#6B4A2B`, `oak` `#A9743C`.
- `bevelBox(ctx,x,y,w,h,base)`: the build script `box` (drop shadow, fill, lit top and left edges, shaded bottom and right). The shared prop primitive for desks, cabinets, sofas, headboards.
- `interiorWall(ctx,x,y,w,h,base,patterned?)`: the build `iwall` (base fill, upper-wall highlight band, faint horizontal courses, optional pinstripe or paper dots).
- `ceilingCap(ctx,x,y,w,base)` and `downlights(ctx,x,y,w,lit)`: the build `ceil` and `lights` (crown-molding cap, then evenly spaced downlights that glow when `lit`).
- `wainscotDado(ctx,x,floorY,w,railY,base)`: the build `dado` (lower-wall dado panel, stiles, a `walnut` chair rail).
- `plankFloor(ctx,x,floorY,w,h,base)`: the build `pfloor` (floor fill, polished top edge, plank seams). Office passes `PAL.carpetGreen`.
- `windowView(ctx,x,y,w,h,night)`: the build `windo` (a three-band `skyDay` or `skyNight` sky behind a seeded skyline of blocks, sparse 1px `cityLight` dots at night, an ink and slate mullion grid on top). `night` derives from `d.lit`. This is the "warm inside, cool outside" seam.
- `roomGlow(ctx,cx,cy,color)`: the build `glow` (nested translucent squares). Pass `glowLit` when active, `glowDim` when not; never place a `glowLit` glow adjacent to a `#FFD86A` ready lamp.
- `curtain(ctx,x,y,h,color)` and `framedArt(ctx,x,y,w,h,pic)`: the build `curtain` and `art`.
- Keep `person` as-is (owned by the people-system spec), plus `shade`, `hash`, `geoVariant` (`common.ts:67`), `maybeMirrored` (`common.ts:75`), `shell`, `wallItem`, `vacancy` (`common.ts:157`), `noticeBadge`, `closedShutter`, `POPULATED`, `SHIRTS`, `SKIN`.
- If `common.ts` crosses 500 lines after these helpers (and the people-system spec's `person` work), extract the dollhouse helpers into a new `pixelSprites/dollhouse.ts` and re-export through the `pixelSprites.ts` barrel and `common.ts` so `import { windowView } from "./common"` keeps resolving.

### Per-kind routines (`src/render/pixelSprites/residential.ts`)

- `office` (`residential.ts:35`): keep the empty-state `vacancy(..., "LEASE")` early return (line 37), the `OFFICE_WALLS` geo pick (line 42), the `visibleOccupants(u)` count (line 44), the layout and flip picks (lines 45 to 46), and the `maybeMirrored` body (line 47). Replace the flat `shell()` interior with `ceilingCap` + `downlights` + `interiorWall(warmWall, patterned)` + `wainscotDado` + `plankFloor(carpetGreen)` + `windowView(night = d.lit)` + `curtain`, then the wall clock or `wallItem`, `framedArt`, and the binder shelf. The three layout branches (meeting line 60, executive line 76, cubicle row line 102) keep their geometry and their `person(..., true)` seated calls; the cubicle helper (build `cube`) stays office-local. Downlights, lit monitors, and window day/night key on `d.lit` and `occupants`.
- `condo` (`residential.ts:133`): keep the empty-state `vacancy(..., "SALE")` early return (line 135), the `home` gate (line 137, `visibleOccupants(u) > 0 && !lateNight`), the `CONDO_WALLS` and `CONDO_PICTURES` geo picks, the right-slot pick (line 215), the layout and flip picks, the shared `lamp` closure (line 147, now `roomGlow` with `glowLit` when `home`, `glowDim` otherwise), and the `maybeMirrored` body. Enrich living (line 199), dining (line 160), and study (line 182) with the shared helpers; keep the standing lamp in all three so the home-glow signal survives; keep occupant placement gated on `home` and `visibleOccupants(u)`.
- `hotel` (`residential.ts:243`): keep the grade geometry (single, double, suite), the `HOTEL_WALLS` / `SUITE_WALLS` geo pick (line 254), the `lit` gate (line 256), the mirror pick (line 258), the per-grade `bed` closure (line 262, retinted to `hotelPink` bedding, `hotelRed` asleep blanket, `walnut` headboard), and the `beds` position table (line 283). Enrich the shell with the dollhouse helpers. The state cues stay exactly where they are, OUTSIDE `maybeMirrored`: nightstand (line 319), dirty tray `#D4623A` (line 323), ready lamp `#FFD86A` (line 326, add the 1px ink socket ring), asleep sleeper (in `bed`), and the "z" text (lines 328 to 337).
- Wall look tables `OFFICE_WALLS` / `CONDO_WALLS` / `CONDO_PICTURES` / `HOTEL_WALLS` / `SUITE_WALLS` (lines 13 to 31): if `residential.ts` approaches 500 lines after enrichment, extract them into `pixelSprites/residential.looks.ts` (mirror the `food.looks.ts` / `shop.looks.ts` pattern in arch section 5) and re-export through the barrel; keep the array order and length (the geo pick indexes them).

### Untouched by design

- `src/render/pixelSprites.ts` `drawRoom` (`pixelSprites.ts:29`): the closed-shutter gate (line 32), the per-kind switch (line 41), the night dimming scrim (lines 76 to 82), and the `noticeBadge` overlay (line 85) stay. The barrel re-exports (lines 95 to 97) gain any extracted look table or helper.
- `src/render/excalibur/TowerEngine.ts`: the room bake signature (`:1632`) and its `lateNight` derivation (`:1610`) are unchanged; no new input is added.
- `src/engine/`: nothing. `visibleOccupants` (`crowd/person.ts`, re-exported via `Crowd.ts`) is consumed read-only.

### geoVariant axis map (office, condo, hotel)

Extend, never reuse an axis integer within a kind (art bible axis map). Current axes are already load-bearing; new axes are additive.

- office: 0 wall band (`OFFICE_WALLS`), 1 wall item (clock, whiteboard, corkboard), 2 plant desk, 3 layout (0 to 2 cubicle row anchor, 3 meeting, 4 executive), 4 mirror. New: 5 window skyline seed.
- condo: 0 wall (`CONDO_WALLS`), 1 picture (`CONDO_PICTURES`), 2 right slot (TV, bookshelf, plant), 3 layout (0 to 2 living anchor, 3 dining, 4 study), 4 mirror. New: 5 window skyline seed.
- hotel: 0 wall tint (`HOTEL_WALLS` / `SUITE_WALLS`), 1 mirror. New: 2 window and curtain seed.

### Tests and bookkeeping

- `src/render/pixelSprites/common.test.ts` (the `pixelSpritesCommon` guard): pin the new `PAL` keys and the new helper literals (interior wall, plank floor, window sky bands, glow pair); assert none equals a reserved value (`#C24A3A`, `#C9CCC4`, `#B2B0A4`, `#E8A030`, `#D4623A`, `#FFD86A`, `#E0556B`); assert each geo variant's luminance sits within 10 per channel of its anchor.
- A residential render test: office, condo, and each hotel grade draw without throwing at representative states (occupied, empty, night, asleep, dirty); seated occupant count equals `visibleOccupants(u)` capped by seats; the empty and for-sale reads call `vacancy`; hotel state cues render on both the flipped and unflipped room.
- `fileSize.guard` and `barrelSurface`: re-verify after any extraction (dollhouse helpers or the residential look table).
- `package.json`: bump minor (player-facing visual capability).

## Tasks & Acceptance

**Execution (dependency order: palette and shared helpers first, then per-kind routines, then extraction if needed, then tests):**
- [x] Add the new `PAL` keys and the shared dollhouse helpers (`bevelBox`, `interiorWall`, `ceilingCap`, `downlights`, `wainscotDado`, `plankFloor`, `windowView`, `roomGlow`, `curtain`, `framedArt`) to `common.ts`, each keyed only on signature inputs.
- [x] Port `office` to the page-02 composition: dollhouse shell over `carpetGreen`, curtained skyline window, the three geo layouts, mirror, vacant and night reads, seated staff mapped to `visibleOccupants(u)`.
- [x] Port `condo`: three geo layouts, the standing-lamp home-glow (`glowLit` when home, `glowDim` otherwise) in every layout, late-night asleep dimming, for-sale via `vacancy(..., "SALE")`.
- [x] Port `hotel` grades 1 to 3: `hotelPink` bedding on a walnut headboard; keep the asleep, dirty, and ready-lamp cues OUTSIDE the mirror at unchanged colors and geometry, adding the ready-lamp ink socket ring.
- [x] Extract the residential look tables into `residential.looks.ts` (and the dollhouse helpers into `dollhouse.ts`) if either file approaches 500 lines; re-export through the barrel.
- [x] Tests: the `pixelSpritesCommon` literal and luminance guard, the residential render and occupancy test; re-verify `fileSize.guard` and `barrelSurface`.
- [x] `package.json`: bump minor.

**Acceptance Criteria:**
- Given an occupied office with `visibleOccupants(u) === n`, when it bakes at any of its three geo layouts, then exactly `min(n, seats)` seated 15px occupants draw in content colors over `carpetGreen`, under a downlit crown-molding ceiling, with a curtained skyline window, and changing `u.occupants` or `u.outForMeal` repaints it through the existing signature with no new input.
- Given an office at night (`d.lit`, zero occupants), when it renders, then the window shows the `skyNight` skyline with sparse `cityLight` dots, the downlights read off, and no `d.anim` is read.
- Given a condo, when occupied and not late night, then the standing lamp reads `glowLit` in whichever of the three layouts the geo seed picks; when occupied and the `lateNight` flag is set, the lamp drops to `glowDim` and the room dims; when empty, no residents draw.
- Given a condo or office in the empty state, when it renders, then it draws the reserved `vacancy` gray hatched shell (SALE for condo, LEASE for office) verbatim, with no warm interior and no occupants.
- Given a hotel room mirrored by its geo seed, when it is asleep, dirty, or ready, then the sleeper and "z", the dirty tray `#D4623A`, and the ready lamp `#FFD86A` draw at identical pixels to the unmirrored room, because they draw outside `maybeMirrored`.
- Given any decoration pixel across all three kinds, when the guard runs, then no decoration equals a reserved color, and each geo variant's luminance sits within 10 per RGB channel of its anchor.
- Given all four quality gates (`typecheck`, `lint`, `test`, `build`), then all are green; the e2e visual churn is limited to the tenant-room pixels, and any non-art pixel move is treated as a bug.

## Design Notes

**The window is the warm-inside-cool-outside seam.** `windowView` is the one place the cool world shows through: a muted `skyDay` or `skyNight` band behind an ink and slate mullion grid, never brighter than `glowLit` or more saturated than a foreground prop, so the amber interior reads against distance. Its day or night state derives from `d.lit` (in the signature), never from animation, so it repaints on the lighting flip and stays off the per-frame path.

**Why the state cues stay outside the mirror.** A hotel corridor is identical rooms whose whole job is broadcasting ready, asleep, or dirty. `maybeMirrored` flips the bed plan for per-unit variety, but a mirrored ready lamp or a backward "z" would corrupt the one signal that matters. Drawing the nightstand, tray, lamp, and "z" after the wrapper closes keeps the cue pixel-identical on every room regardless of the mirror bit, which is the legibility rule (state cues always win). The reserved tray and lamp colors are never reused by decoration, so the cue never collides with a warm prop.

**geoVariant is geography, not id.** The per-room pick is a pure function of kind, floor, and x, so a room's look survives a TDT save, load, export, and import even though import renumbers every unit id. Anchors are double-weighted in each look table so the classic look stays most common, and luminance holds within 10 per channel so the night scrim and heatmap never make a variant ambiguous. Adding an axis (window seed) is additive and cannot disturb the existing picks.

**Occupancy is honest.** Every seated figure maps to a real `visibleOccupants(u)` seat, capped by the layout's desk or chair count and filled in seat order; an empty room draws no one and an out-for-meal dip removes figures because `outForMeal` is in the signature. There are no decorative occupants.

## Verification

**Commands:**
- `npm run typecheck`: expected clean.
- `npm run lint`: expected clean.
- `npm test`: expected all green, including the `pixelSpritesCommon` literal and luminance guard and the residential render and occupancy test.
- `npm run build`: expected succeeds.
- Visual regression (`e2e/visual.spec.ts-snapshots`) and screenshots (`docs/screenshots/**`): regenerate only via the pinned Playwright image per CLAUDE.md; the tenant-room figure and composition churn is expected, any non-art pixel move is a bug.
- Deep review: `/gds-code-review` in-session (gameplay-facing render), per CLAUDE.md and arch section 9.
