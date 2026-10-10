# Sprite atlas

Verticopolis draws all of its art in code, and that art is CC BY 4.0
([ASSETS-LICENSE.md](../ASSETS-LICENSE.md)). The sprite atlas packs it into
texture pages and a JSON manifest so any frontend on the open engine can use the
same art without porting the drawing code.

## Getting it

Every tag's GitHub release carries `verticopolis-atlas-<tag>.zip` and a
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
screenshot workflows use), with Playwright's own Chromium from that image, the
browser the e2e comparison runs in. A host browser works for a preview (point
`PW_CHROME` at it), but it rasterizes text and curves slightly differently, so
its pixels and checksum will not match the release. To bake in the pinned
image locally, use the container recipe in CONTRIBUTING.md (Regenerating
screenshot drift) with `npm run atlas -- --out dist-atlas` as the command.

Before it writes anything, the export checks the atlas against the game's own
paint for the sample signatures in `src/render/atlas/samples.ts` and stops on
any mismatch.

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
  ASSETS-LICENSE.md        the asset license, verbatim
  1x/page-000.png          512 x 512 color page
  1x/page-000.normal.png   its normal map
  2x/...                   1024 x 1024
  4x/...                   2048 x 2048
```

Every rectangle in the manifest is in 1x pixels. For a 2x or 4x page, multiply
`x`, `y`, `w` and `h` (and any `dx`, `dy`, anchor) by the scale; the page index
stays the same. Sample the pages with nearest filtering: each image has a
one-pixel transparent gutter (two pixels between neighbors at 1x), which is not
enough for linear filtering.

Normal maps are tangent-space, OpenGL convention (+X right, +Y up, +Z toward the
viewer), encoded as `rgb = n * 0.5 + 0.5`, and share their color page's layout.
Height comes from luminance times coverage, with each sprite's outline (a
visible pixel next to a transparent one) sunk to half height so silhouettes
read as beveled. Each normal map is taken over the whole frame before it is
trimmed, sliced or split into layers, so none of those cuts bevels, and a
frame's own border does not either (rooms tile side by side). A layer's normals
come from the frame it completes. Normal alpha is 255 wherever the color pixel
shows and 0 elsewhere, so a loader that premultiplies alpha leaves the vectors
intact.

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
| Cars | `car/<elevator kind>/<idle, up or down>/<full or notfull>/s<0-3>` with a `riders` chain (sampled seeds in `data.carSeeds`) |
| People | `person/<seated, standing, walker, rider or hiVis>/<shirt<i>, staff, impatient or fedUp>`, one `shirt<i>` per entry of `data.shirts` |
| Facade | `facade/escape/<left or right>/<0 or 1>`, `facade/awning/<left or right>`, animation `facade/crane/<lit>` |
| Vehicles | `vehicle/streetcar/s<0-3>` (sampled seeds in `data.streetCarSeeds`), `vehicle/garbagetruck`, `vehicle/metrotrain/<headlight or dark>` |
| Sky | `sky/gradient` (one column per quarter hour), `sky/sun`, `sky/moon`, `sky/cloud/<overcast or rain>/<0-4>`, `sky/skyline/<far or near>` |

A shaft is drawn floor by floor: `top` for its top floor, `bottom` for its
bottom floor, `stop` or `skip` for each floor between (an express skip floor
has no stop line), and `single` for a one-floor shaft.

## Reading a room

The web game re-bakes a room whenever its signature changes
(`src/render/excalibur/towerReconcile.ts`). The atlas bakes the static part of
that signature into frame names and leaves the rest as layers. The reference
reader is `src/render/atlas/lookup.ts`; in short:

1. A burning or unbuilt room plays `fire/<kind>` or `construction/<kind>`.
2. Otherwise build the frame name from the kind, state, subtype (a subtype
   the engine does not list for the kind uses `-`), width, the lighting, the
   business hours at the current hour, the late night (23:00 to 06:00) of a
   condo, studio or apartment, and the variant you picked for that room.
3. For most rooms, append `/home` when `occupants > 0`, else `/away`, and on a
   home frame draw the `occupants` chain up to `occupants - outForMeal`.
4. A parking space draws the `dead` overlay when it is not chained to a ramp;
   otherwise it draws `car<id % 7>` when it holds a car (the game's presence
   roll is spelled out in `signature.rules.parkingRoll`). A recycling center
   draws its `fill` chain up to `round(fill * 8)`. The game re-bakes the pile on
   the same eighths but paints the exact fill, so between steps a pile can
   differ by a bag or a gauge pixel.

The chain layers carry the occupants: step `k` holds exactly the pixels that
change when the visible count goes from `k - 1` to `k`, at their place in the
room (for most rooms, the figure that sits down in that slot). Draw them in
order; a single step on its own is not a standalone figure.

Frames exist for each kind's catalog width only. A room imported from an old
tower at another width has no frame yet.

Room variety in the web comes from each room's floor, column and id, which no
finite atlas can cover. The atlas bakes four sampled placements per kind (the
metro, which fills the lot, has one); pick one per room, for example from its
position, and keep it.

A few details in the security office, medical center, housekeeping, sky bar
and fitness club follow the draw origin in the web game rather than the room's
position. The atlas carries the look at the origin; see
`signature.rules.originSeeded`. The cinema's marquee and screen read the
animation clock; the game keeps whatever phase its last re-bake caught, and
the atlas bakes phase 0.

The crane's motion never repeats in the game. Its animation is a sampled
stretch (`loop: false`); play it forward and back, or hold, as suits you.

## How it is checked

`e2e/atlas.spec.ts` (and the export's own pre-flight) composes atlas frames and
layers for the sample room signatures with the reference reader, paints the
same rooms through the game's own paint functions (`src/render/regionPaint.ts`,
which the region compositor and the burning-room canvas call) at two region
offsets, and requires an exact pixel match. The bake refuses to write a layer
that would not compose back to the game's pixels, or a chain that its cap cut
short. A unit test rebuilds every frame and layer from the packed pages
through the manifest.

The same check covers the other families (`verifyExtras.ts`): a whole express
and standard shaft rebuilt from their floor pieces (skip floor included), cabs
with composed riders, a walker, a lobby tile, an entrance pose, a fire escape
and the sky strip, each against the game's draw call with the game's
arguments.

## Not in the atlas yet

Event cameos (Santa, the VIP limo, the thief), the plaza and street scenery,
and the ground strip are not exported yet.
