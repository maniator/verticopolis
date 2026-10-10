# Sprite atlas

Verticopolis draws all of its art in code, and that art is CC BY 4.0
([ASSETS-LICENSE.md](../ASSETS-LICENSE.md)). The sprite atlas packs it into
texture pages and a JSON manifest so any frontend on the open engine can use the
same art without porting the drawing code.

## Getting it

Every tag's GitHub release carries `verticopolis-atlas-<version>.zip` and a
`.sha256` file beside it (`.github/workflows/atlas-release.yml`). Fetch the
release for the commit your frontend pins and check the archive against the
checksum before you unpack it. Nothing generated is committed to this
repository.

To build it yourself:

```bash
npm ci
npm run atlas -- --out dist-atlas            # whole catalog
npm run atlas -- --out dist-atlas --filter room/office   # a slice, for a preview
```

The release copy is baked inside the pinned Playwright image (the same
`mcr.microsoft.com/playwright:v<lockfile playwright version>-jammy` the
screenshot workflows use), with `PW_CHROME` pointing at that image's Chromium.
A host browser works for a preview, but it rasterizes text and curves slightly
differently, so its pixels and checksum will not match the release.

## How it is made

Each draw routine runs once, at the game's canonical size (a 10 x 45 pixel tile
per floor column), in a real 2D canvas set up the way the game sets up its own
bake canvases. The 2x and 4x pages are nearest-neighbor upscales of those 1x
pages. The art is never redrawn larger: the routines use fixed pixel literals
(#812, #813), so a larger redraw changes the geometry.

## Archive layout

```text
verticopolis-atlas/
  manifest.json
  ATTRIBUTION.txt          the CC BY 4.0 attribution line
  LICENSE-ASSETS.md        ASSETS-LICENSE.md, verbatim
  1x/page-000.png          512 x 512 color page
  1x/page-000.normal.png   its normal map
  2x/...                   1024 x 1024
  4x/...                   2048 x 2048
```

Every rectangle in the manifest is in 1x pixels. For a 2x or 4x page, multiply
`x`, `y`, `w` and `h` (and any `dx`, `dy`, anchor) by the scale; the page index
stays the same. Sample the pages with nearest filtering: images sit one 1x
pixel apart, so linear filtering bleeds between neighbors.

Normal maps are tangent-space, OpenGL convention (+X right, +Y up, +Z toward the
viewer), encoded as `rgb = n * 0.5 + 0.5`. Height comes from luminance times
coverage, with each sprite's outline sunk to half height so silhouettes read as
beveled. Transparent pixels stay transparent.

## The manifest

`schema` is the manifest version (currently 1). Frame names and the meaning of
every field are stable within a schema version; a change a reader could notice
bumps it. New frames or optional fields do not.

- `frames`: frame name to record. A record has the full frame size (`w`, `h`),
  its `anchor`, structured `keys` (the same values the name spells), and
  `parts`: the packed pieces with their offset inside the frame (transparent
  borders are trimmed; a frame wider than a page, like the metro, is cut into
  column slices). `parts` is empty for a fully transparent frame.
- `chains`: composed layers indexed by an engine number. To show input `n`, draw
  the frame, then steps `1..min(n, max)` in order with ordinary source-over
  blending; a `null` step draws nothing.
- `overlays`: single named layers drawn the same way.
- `animations`: frame names in play order, the seconds each holds (`dt`), and
  whether the last frame loops into the first.
- `signature`: which inputs are baked into frames, which a frontend composes,
  which animate, and the exact rule for each (`signature.rules`).
- `variants`: the sampled placements behind each room variant.
- `data`: small tables (the 24 hourly sky colors, the skyline fills, the shirt
  colors, the person build sizes, the sampled seeds).

### Anchors

Rooms, structure tiles, shafts, cars, escapes and awnings anchor at their top
left, which sits on the grid point of the unit's left column at the top of its
highest floor. People anchor at the feet (the contact-shadow row). The crane
anchors at its bottom center over the roof. The sun, moon and clouds anchor at
the point the game positions them by.

### Frame names

Names follow the engine's own strings: the facility keys from
`engine-rs/src/facilities.rs` and the `UnitState` names.

| Family | Name |
| --- | --- |
| Rooms | `room/<kind>/<state>/<subtype or ->/w<tiles>/<lit or unlit>/<open, closed or always>/<late, notlate or any>/v<variant>[/home or /away]` |
| Fire, construction | animation `fire/<kind>`, `construction/<kind>`; frames `.../<i>` |
| Structure | `structure/floor`, `structure/lobby/<ground or sky>/<lit>/v<0-3>`, animation `structure/entrance/<grand-left, grand-right, grand-solo or service>/<lit>/<staffed or unstaffed>` |
| Shafts | `shaft/<elevator kind>/<top, stop, skip, bottom or single>`, `transport/stairs`, `transport/escalator` |
| Cars | `car/<elevator kind>/<idle, up or down>/<full or notfull>/s<seed>` with a `riders` chain |
| People | `person/<seated, standing, walker, rider or hiVis>/<shirt0-7, staff, impatient or fedUp>` |
| Facade | `facade/escape/<left or right>/<0 or 1>`, `facade/awning/<left or right>`, animation `facade/crane/<lit>` |
| Vehicles | `vehicle/streetcar/s<seed>`, `vehicle/garbagetruck`, `vehicle/metrotrain/<headlight or dark>` |
| Sky | `sky/gradient` (one column per hour), `sky/sun`, `sky/moon`, `sky/cloud/<overcast or rain>/<0-4>`, `sky/skyline/<far or near>` |

A shaft is drawn floor by floor: `top` for its top floor, `bottom` for its
bottom floor, `stop` or `skip` for each floor between (an express skip floor
has no stop line), and `single` for a one-floor shaft.

## Reading a room

The web game re-bakes a room whenever its signature changes
(`src/render/excalibur/towerReconcile.ts`). The atlas bakes the static part of
that signature into frame names and leaves the rest as layers. The reference
reader is `src/render/atlas/lookup.ts`; in short:

1. A burning or unbuilt room plays `fire/<kind>` or `construction/<kind>`.
2. Otherwise build the frame name from the kind, state, subtype, width, the
   lighting, the business hours at the current hour, a condo's late night
   (23:00 to 06:00), and the variant you picked for that room.
3. For most rooms, append `/home` when `occupants > 0`, else `/away`, and on a
   home frame draw the `occupants` chain up to `occupants - outForMeal`.
4. A parking space draws the `dead` overlay when it is not chained to a ramp;
   otherwise it draws `car<id % 7>` when it holds a car. A recycling center
   draws its `fill` chain up to `round(fill * 8)`.

Room variety in the web comes from each room's floor, column and id, which no
finite atlas can cover. The atlas bakes four sampled placements per kind (the
metro, which fills the lot, has one); pick one per room, for example from its
position, and keep it.

A few details in the security office, medical center, housekeeping, sky bar
and fitness club follow the draw origin in the web game rather than the room's
position. The atlas carries the look at the origin; see
`signature.rules.originSeeded`.

## How it is checked

`e2e/atlas.spec.ts` composes atlas frames and layers for a sample of live
signatures with the reference reader, paints the same rooms the way the game's
region compositor does, and requires an exact pixel match. The bake itself
refuses to write a layer that would not compose back to the web's pixels.

## Not in the atlas yet

Event cameos (Santa, the VIP limo, the thief), the plaza and street scenery,
the ground strip, and the in-cab mood tints are not exported yet.
