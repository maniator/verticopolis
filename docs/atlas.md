# Sprite atlas

Verticopolis draws all of its art in code, and that art is CC BY 4.0
([ASSETS-LICENSE.md](../ASSETS-LICENSE.md)). The sprite atlas packs it into
texture pages and a JSON manifest so any frontend on the open engine can use the
same art without porting the drawing code.

## Getting it

Every version tag (`v<package.json version>`, for example `v2.30.0`) gets a
published GitHub release carrying `verticopolis-atlas-<tag>.zip` and a
`.sha256` file beside it (`.github/workflows/atlas-release.yml`). Check the
archive against the checksum before you unpack it. Nothing generated is
committed to this repository.

The game deploys from `main` without a tag, so most commits have no atlas.
Pin your frontend to a version tag's commit and fetch that tag's release.

The release flow, for maintainers:

- Pushing a version tag is the publish step (CONTRIBUTING.md, Versioning). The
  tag must equal `v<package.json version>` at that commit, and the version must
  be a plain `x.y.z`, or the workflow stops.
- The workflow opens the tag's release as a draft (or reuses its draft),
  attaches the zip and checksum while it is still a draft, then publishes it.
  Publishing is the last step, so it works with GitHub's immutable releases.
  The notes are that version's player notes, read from `CHANGELOG.md` by the
  reader the in-game update prompt uses (every top-level bullet of the
  section's first list, uncapped); a version with no player notes gets a plain
  line. The release becomes Latest unless a higher version has already been
  released, so a backport tagged later leaves Latest alone. Two tags pushed
  within the same few minutes can both decide they are Latest; push one at a
  time, or set Latest by hand if that happens.
- A published release is never edited. Running the workflow again for a
  published tag is an audit: it checks the attached zip against the attached
  checksum and re-bakes, passing only when the bake reproduces that checksum.
- Publish releases only through the tag. A release published by hand without
  the atlas makes the workflow fail: a maintainer then deletes that release
  and re-runs the workflow (possible only while releases are not immutable),
  or ships the atlas with the next version's tag.

To build it yourself:

```bash
npm ci
npm run atlas -- --out dist-atlas            # whole catalog
npm run atlas -- --out dist-atlas --filter room/office   # a slice, written as verticopolis-atlas-preview.zip
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
any mismatch, then checks that every image comes back out of the packed pages.
A `--filter` run is a preview: it skips the sample check and is written as
`verticopolis-atlas-preview.zip`. A release archive takes its name from the
tag, with each run of characters other than letters, digits, `.`, `_` and `-`
turned into one `-`.

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
  icon/icon.svg            the app icon (see "The app icon")
  icon/...                 its maskable SVG and PNGs up to 1024 x 1024
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
trimmed or sliced, so neither cut bevels, and a frame's own border does not
either (rooms tile side by side). A layer's normals come from the frame it
completes, masked to the layer's pixels; the base frame's pixels right next to
a layer keep their own normals, so a composed normal map can differ from a
fresh one by up to a pixel around each layer. Normal alpha is 255 wherever the
color pixel shows and 0 elsewhere, so a loader that premultiplies alpha leaves
the vectors intact.

## The manifest

`schema` is the manifest version (currently 1). Frame names and the meaning of
every field are stable within a schema version; a change a reader could notice
bumps it. New frames or optional fields do not.

- `frames`: frame name to record. A record has the full frame size (`w`, `h`),
  its `anchor`, structured `keys` (the same values the name spells), and
  `parts`: the packed pieces with their offset inside the frame (transparent
  borders are trimmed; a frame wider than a page, like the metro, is cut into
  column slices). `parts` is empty for a fully transparent frame. A room frame
  can also carry `layers`, the same room split for depth (see
  [Depth layers](#depth-layers)).
- `chains`: composed layers indexed by an engine number. To show input `n`, draw
  the frame, then steps `1..min(n, max)` in order with ordinary source-over
  blending; a `null` step draws nothing.
- `overlays`: single named layers drawn the same way.
- `animations`: frame names in play order, the seconds each holds (`dt`), and
  whether the last frame loops into the first.
- `signature`: which inputs are baked into frames, which a frontend composes,
  which animate, and the exact rule for each (`signature.rules`).
- `variants`: the sampled placements behind each room variant.
- `data`: small tables (the sky color at each quarter hour, the skyline fills,
  the shirt colors, the person build sizes, the sampled seeds), the scenery
  layout (`scenery`), the sky's motion (`sky`) and the game's draw order
  (`depth`).

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
| Shafts | `shaft/<elevator kind>[/w<tiles>]/<top, stop, skip, bottom, single, top-skip, bottom-skip or single-skip>`, `transport/stairs[/w<tiles>]`, `transport/escalator[/w<tiles>]` (`w<tiles>` only on a legacy width, see below) |
| Cars | `car/<elevator kind>[/w<tiles>]/<idle, up or down>/<full or notfull>/s<0-3>` with a `riders` chain (sampled seeds in `data.carSeeds`) |
| People | `person/<seated, standing, walker, rider or hiVis>/<shirt<i>, staff, impatient or fedUp>`, one `shirt<i>` per entry of `data.shirts` |
| Facade | `facade/escape/<left or right>/<0 or 1>`, `facade/awning/<left or right>`, animation `facade/crane/<lit>` |
| Vehicles | `vehicle/streetcar/s<0-3>` (sampled seeds in `data.streetCarSeeds`), `vehicle/garbagetruck`, `vehicle/metrotrain/<headlight or dark>` |
| Sky | `sky/gradient` (one column per quarter hour), `sky/sun`, `sky/moon`, `sky/cloud/<overcast or rain>/<0-4>`, `sky/skyline/<far or near>` |
| Scenery | `scenery/roundabout`, animation `scenery/fountain`, `scenery/plaza-lamp/a<0, 25, 50, 75 or 100>`, `scenery/street-lamp/a<...>` (with the "375 ST" sign), `scenery/planter`, `scenery/tree/v<0-7>`, `scenery/bush`, `scenery/ground/<sidewalk, forecourt or road>`, `scenery/ground/grass/s<0-2>/<flat or tuft>` (the looks the lot uses), `scenery/ground/pave/<plain or joint>` (see "The world outside the tower") |

A shaft is drawn floor by floor: `top` for its top floor, `bottom` for its
bottom floor, `stop` or `skip` for each floor between (an express skip floor
has no stop line), and `single` for a one-floor shaft. `top-skip`,
`bottom-skip` and `single-skip` cover a shaft whose skip list holds one of its
own end floors (`top-skip` looks the same as `top`: the motor housing covers
that stop line).

## Reading a room

The web game re-bakes a room whenever its signature changes
(`src/render/excalibur/roomSignature.ts`). The atlas bakes the static part of
that signature into frame names and leaves the rest as layers. The reference
reader is `src/render/atlas/lookup.ts`; in short:

1. A burning or unbuilt room plays `fire/<kind>` or `construction/<kind>`.
2. Otherwise build the frame name from the kind, state, subtype (a subtype
   the engine does not list for the kind uses `-`), the kind's catalog width
   (a room at another width is drawn stretched, below), the lighting, the
   business hours at the current hour, the late night (23:00 to 06:00) of a
   condo, studio or apartment, and the variant you picked for that room.
3. For most rooms, append `/home` when `occupants > 0`, else `/away`, and on a
   home frame draw the `occupants` chain up to `occupants - outForMeal`
   (rounded up, at least 0, at most the chain's `max`).
4. A parking space draws the `dead` overlay when it is not chained to a ramp;
   otherwise it draws `car<id % 7>` when it holds a car (the game's presence
   roll is spelled out in `signature.rules.parkingRoll`; the game re-paints a
   space only when the garage's use crosses a sixth, so its cars can trail the
   live use slightly). A recycling center
   draws its `fill` chain up to `round(fill * 8)`. The game re-bakes the pile on
   the same eighths but paints the exact fill, so between steps a pile can
   differ by a bag or a gauge pixel.

The chain layers carry the occupants: step `k` holds exactly the pixels that
change when the visible count goes from `k - 1` to `k`, at their place in the
room (for most rooms, the figure that sits down in that slot). Draw them in
order; a single step on its own is not a standalone figure.

Room frames exist for each kind's catalog width only. A room imported from an
old tower (a TDT file) or loaded from an old save keeps its original width,
anything from one tile to the lot's width, too many to bake. Such a room uses
its catalog-width frame or animation: compose it as usual (chains, overlays and
layers, all in catalog-width coordinates), then scale the picture horizontally
to the room's real width, nearest neighbor from its left edge. The reference
reader returns that width as `stretchTo`. The result approximates the web
game, which redraws the room at its real width (its furniture and figures keep
their spacing), so it is a fallback rather than a match.

A shaft's width is a small set: a legacy save keeps the narrower width canon
used to have (stairs and escalators 4 tiles, the standard elevator 3, the
express 4), and the atlas bakes those too, named with a `w<tiles>` segment
after the kind (`transport/stairs/w4`, `transport/escalator/w4`,
`shaft/elevatorStandard/w3/top`, `car/elevatorExpress/w4/idle/notfull/s0`),
on pages of their own after the scenery's. `lookupShaft` in the reference
reader names them; a shaft at any other width (only a damaged save carries
one) uses its catalog frames with `stretchTo`. A legacy frame's `keys` carry
its `width`; a catalog-width frame's carry none.

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

## Depth layers

A frontend that draws rooms with depth can use a room's shell and its furniture
separately: for example, a 2.5D cutaway that sets the furniture a little in
front of the back wall. A room frame that supports this (and a lobby tile or
entrance frame, below) carries an optional `layers` field next to its
`parts`:

```json
"layers": {
  "shell": [ { "rect": {...}, "dx": 0, "dy": 0 } ],
  "furniture": [ ... ],
  "soft": [ ... ],
  "chains": { "occupants": { "shell": [null, ...], "furniture": [null, ...], "soft": [null, ...] } }
}
```

A cab or the train carries `front` in place of `soft` (and the cab `front`
chain steps); see below.

- `shell` is the room with its furniture and seated people taken out: the
  ceiling, back wall, windows, wall art and floor band, plus whatever the game
  draws over the room after its furniture, such as the night scrim (on an
  empty home or workplace at night, and on a condo whose residents are
  asleep), the notice badge, a hotel room's roaches (and an infested room's
  grime) and a sleeping guest's "z", ceiling lights and glow washes drawn last
  (security, housekeeping, amusements), a cinema's aisle lights and EXIT signs,
  the wedding hall's petal row, and the metro's exit stairs, platform and
  track. The aquatic center keeps its pool whole on the shell: the diver on
  the board and the swimmers in the pool stay there (they arrive as shell
  steps), and only the deck-chair loungers come forward as furniture (at the
  catalog's size every attendee is a diver or a swimmer, so the chairs are
  empty).
- `furniture` holds the pixels that differ between the shell and the flat
  frame, transparent everywhere else.
- `chains` splits the frame's chain step by step, under the same key
  (`occupants`; a frame with no chain, such as an `/away` frame, has none):
  `shell` holds what the step changes on the shell (an office's downlights or
  a condo's ceiling light, switched on by the first occupant, or the aquatic
  center's swimmers), `furniture` holds the people who sit down. Each list
  starts with a null step 0 and is trimmed on its own, like a frame's chain
  steps.
- `soft` (with its own steps in `chains`) is an optional alternative to
  `furniture`; see below.

Each picture is a list of placed parts like `parts` (a picture wider than a
page, like the metro's, is cut into column slices; an occupant step always
fits one page, and the export refuses one that does not). To show `n` visible
occupants, draw with ordinary source-over blending, in this order:

1. the `shell` parts,
2. the chain's `shell` steps `1..min(n, len - 1)`,
3. the `furniture` parts,
4. the chain's `furniture` steps `1..min(n, len - 1)`.

The result is the frame's own `parts` plus its chain steps `1..n`, exactly.
Pass the visible occupant count itself and clamp it to each list on its own:
a depth list can run past the chain's `max` when a step changes only pixels
the flat frame hides (a light behind a desk). A layered frame has at most one
chain, and its overlays (only the parking space has any) draw after these
four (and after a vehicle's front, below), in front.
Draw anything of your own that belongs between the wall and the furniture
(walkers, a depth offset) between steps 2 and 3. Any list can be empty (a
fully transparent picture).

What that means for the pictures:

- The furniture layer holds only the pixels that differ. Where a piece of
  furniture happens to match the wall behind it, or where a mark drawn after
  the furniture covers it, the furniture layer is transparent and the shell
  shows that pixel. Once an occupant step puts a pixel in the furniture, the
  later steps keep it there (each step only adds), so a frontend that offsets
  the furniture moves that pixel with it even where a later step shows the
  shell's color.
- A mark drawn after the furniture sits on the shell, so the furniture layer
  carries the furniture as the flat frame shows it (darkened under the night
  scrim).
- A soft shadow or glow drawn with the furniture (a restaurant's candles, a
  hotel or condo lamp) is baked into `furniture` as opaque pixels: the
  translucent paint over the wall behind it. Offset from the shell, it shows
  as a box of wall color. Use `soft` for those rooms.
- The hotel's roaches and its sleeping guest's "z" draw after the furniture
  ends, so they sit on the shell, even the roach on the bed and the "z" over
  the sleeper.
- Structure drawn over the furniture sits on the shell and hides the furniture
  under it in both pictures: the metro's platform deck covers the contact
  shadow under its benches and bins, and the cinema's EXIT signs cover the
  seats they overlap. A frontend that offsets the furniture shows those pieces
  cut off where the structure covered them.
- The shell's normal map is its own (it is a picture without the furniture).
  The furniture's normals, and the soft furniture's, come from the flat frame,
  masked to their pixels, like any other layer.

The game marks the split in each room's draw routine, and in the lobby and
entrance art (`src/render/pixelSprites/layers.ts`): one call where the shell
ends and, in a room that draws over its furniture, one where the furniture
ends and the marks drawn over it begin. A routine that draws some of its
shell late, over furniture already in place, wraps that art in a third call
(the recycling center's deck curb and wall gauge). In the game the first two
do nothing and the third only runs its draw, once. The
export paints each split frame (and each occupant step) again with the marks
live and records the canvas at them, once for the exact split and once more
for the soft furniture; the flat frame comes from the ordinary paint, so
adding layers never changes a frame's pixels. The export also requires every
kind that splits to have furniture in some frame, since a shell that still
showed the furniture would compose back too.

A frame has no `layers`, and a frontend draws it flat, when:

- the room is vacant and shows its LEASE or SALE card (office, condo, studio,
  apartment), is closed and shows its shutter, or is gutted;
- it is a burning or unbuilt room (those are animations).

Every room kind splits otherwise: office, condo, studio, apartment, the three
hotel grades, fast food, restaurant, food hall, cinema, shop, amusements,
boutique bay, fitness club, clinic, nightclub, spa, sky bar, daycare,
security, medical center, housekeeping, party hall, wedding hall, aquatic
center, metro station, recycling center, parking ramp and parking space. The
recycling center's chain is its `fill`: the wall gauge (and its FULL cue)
changes on the shell, the day's pile in front. The deck curb and the gauge
draw after the machines, as the game draws them, and land on the shell; the
furniture stops at the curb, which stays whole on the shell. The parking
ramp's furniture is the car parked at its foot. A parking space's shell is the whole bay and its
furniture list is empty: its car comes as a `car<i>` overlay (and a dead
space's red X as `dead`), which draws in front of everything.

The lobby splits too, so a concourse can be drawn with depth like the rooms
beside it. Every `structure/lobby/...` tile carries `layers`: the column,
console, sky-lobby bench, chandelier and planter come forward, while the
wall, windows, cornice, floor, carpet, sconce, framed print and the recessed
panel above the console stay on the shell (the sconce and print tile has an
empty furniture list). Each frame of the
`structure/entrance/...` animations carries its own `layers` too: the facade,
glass, awning, doors and carpet (or the service door and its plate) are the
shell, and the palms, the potted plant, the reception desk and its attendant,
and the doorman are the furniture. Neither has a chain, so a frontend draws
the shell and then the furniture (or the soft furniture).

The elevator cabs (`car/...`) and the metro train (`vehicle/metrotrain/...`)
carry the people inside them, so they split three ways and add a `front`
picture (the cab with `front` steps in its `riders` chain), drawn after the
furniture:

5. the `front` parts,
6. the chain's `front` steps `1..min(n, len - 1)`.

The shell is the interior seen through the doors or windows, the furniture
the riders, and the front the vehicle around them: a cab's door frames,
center seam, FULL bar and lantern, and the train's body, cut away where the
saloon windows are, with the glints on its window glass. A frontend that sets
the riders a little behind the front keeps them inside the vehicle. Like the
furniture, the front holds the flat frame's pixels where they differ from
what is under them, so a cab's translucent door frames carry the rider color
they cover. The service cab's kick plate and the express cab's livery band
run along the cab floor on the shell, behind the riders, as the game draws
them: the riders' legs and contact shadows cross every row of the band, and a
band split partway along would tear where the layers part. No rider reaches
the right side frame; the first rider's contact shadow meets the left frame
column, which the door frame over it (front) carries as the shadow color. A
frame with a front has no `soft` picture. The street cars and the garbage
truck show no one inside and are drawn flat; `data.depth` names the plane
each draws on.

The layers' own images are packed on pages after the frame images', so a
frontend that ignores `layers` reads the same frames, parts and pages as before
they existed. The same goes for the scenery, which joined the atlas later: its
images pack on pages of their own between the older frames' pages and the
layers'. The layers' pages come last, so their page numbers can change when a
family is added; read them from the manifest, never from an older one. An
entrance animation can carry `soft` on some of its frames and not
others (each frame splits on its own).

### Soft furniture

`soft` is the furniture painted on a transparent background instead of over
the shell, so its glows and soft shadows keep their transparency. Draw it in
place of `furniture` (and its `chains` steps in place of the `furniture`
steps); the order is the same. Over the shell it looks the same to the eye,
but translucent paint rounds a step or two differently on its own than over
the wall. Marks the game draws over the furniture (the night scrim) land on
the soft furniture only where it has pixels; the shell carries them everywhere
else. An opaque mark drawn over the furniture (a hotel roach on the bed, a
sleeping guest's "z", a notice badge) is therefore on both the shell and the
soft furniture: offset the soft furniture and it shows twice. In `furniture`
the same mark stays on the shell only, leaving a gap in the furniture under
it. In the current atlas 8% of the soft furniture's pixels differ from the
flat frame (each pixel counted once per occupant count it shows at), by at
most 2 of 255 in any channel; the export prints this measure and refuses an
atlas whose soft furniture strays more than 4 of 255 or misses a pixel of the
furniture. Use `furniture` when exact pixels matter, and `soft` when the
furniture moves away from the wall.

A frame has no `soft` when an occupant step would have to change a
translucent soft pixel, which source-over cannot do (it can only paint over
one), or when its soft pass fails; the export counts them and names the
first few. In the current atlas
that is about one layered frame in nine, where an occupant step changes a
glow or a soft shadow in the restaurant, food hall, party hall, amusements,
boutique bay, fitness club and nightclub; those frames offer `furniture`
only.

## The world outside the tower

The scenery around the lot comes as its own frames, painted by the game's
scenery painters (`src/render/excalibur/towerSceneryDraw.ts`), and
`data.scenery` publishes the game's own placement table (`sceneryPieces` in
`src/render/sceneryLayout.ts`) and the rules it seeds the rest by. Positions
are in pixels at 1x: x from the lot's left edge and y from the ground line
(negative is up), for a frame's top-left corner. `lotTiles` is the lot's width
in tiles, `tileW` a tile's width and `floorH` a floor's height, in pixels.
The game sizes the lot from the tower catalog's world; both catalogs state the
same one, and the atlas publishes its positions for it.
Draw, back to front (the planes are the ones in
[Draw order](#draw-order)):

1. The skyline, seeded by the tower (see below): solid rectangles in the two
   `data.skylineFills` colors (the `sky/skyline/<far or near>` frames are those
   fills), the far band first.
2. `ground.dirt` and `ground.line`: solid fills in their `color`. The dirt
   spans `x` to `x + w` from y 0 down `h` pixels; the ground line spans the
   same x and runs `h` pixels from `y`.
3. `ground.strip`: one frame per lot tile at x `tile * tileW` and `y`, drawn
   left to right. Each frame is one column wider than `tileW`, as the game
   paints it, and the next tile covers that column. The tower paves one span
   from its leftmost to its rightmost ground-floor room, widened by
   `apronPadTiles` on each side and kept on the lot; a paved tile uses
   `scenery/ground/pave/joint` when its index is a multiple of `jointEvery`
   and `scenery/ground/pave/plain` otherwise, and any other tile uses the
   grass frame `ground.strip.grass[tile]` names.
4. `ground.runs`, in order: the plaza sidewalk, the roundabout, the left road,
   the forecourt, the right sidewalk and the right road. Fill each run's box
   (`x`, `y`, `w`, `h`) with copies of its frame placed at `tileOriginX` plus
   whole multiples of the frame's width, clipped to the box (the roundabout's
   box holds exactly one copy). That puts every lane dash where the game has
   it, and the left road's last column over the roundabout's first, as the
   game draws it.
5. `props`, in order: the fountain (an animation; its motions share no period,
   so its 24 frames at 0.1 s sample a stretch close to a loop), the two plaza
   lamps, the street lamp with its "375 ST" sign, and the planter. The lamps
   fade in through dusk and out through dawn (`lamp.fadeIn` and
   `lamp.fadeOut`, in hours, a straight ramp); the atlas carries them at 0,
   25, 50, 75 and 100 percent lit.
6. The lot's trees and bushes, seeded by the tower (see below).

The props and plants stand apart from the tower and the ground, so a frontend
that draws with depth can set each at its own distance.

### Seeded by the tower

The skyline and the plants are a pure function of the tower's founding seed
(the engine's initial RNG seed, fixed for the tower's life), through this
hash, where `int32`, `imul32`, `^` and `>>>` are as in
`signature.rules.parkingRoll`:

```text
hash01(n): h = int32(trunc(n)); h = imul32(h ^ (h >>> 16), 0x45d9f3b);
           h = imul32(h ^ (h >>> 16), 0x45d9f3b); h = h ^ (h >>> 16);
           return (h as unsigned) / 2^32
```

The skyline (`skyline`): for each band in `bands`, a building at every tile
`t` from `start - overscanTiles` while `t < lotTiles + overscanTiles`, stepping
by `step`. It is `w.base + hash01(seed + t * w.key) * w.span` tiles wide and
`hFloors.base + hash01(seed + t * hFloors.key) * hFloors.span` floors tall
(both fractional; `w * tileW` by `hFloors * floorH` pixels), with its left
edge at x `t * tileW` and its bottom on the ground line. The game draws each
rectangle on its own in the band's translucent `frame` color, the far band
first, so where two overlap the color deepens; it scales a solid fill to the
fractional size with nearest sampling, with no rounding of its own.

The plants (`plants.rule`): a candidate at every tile `t` from `margin`
while `t < lotTiles - margin`, stepping by `step`. With `r = hash01(seed * 3 +
t)`, skip it when `r < skipBelow`; it is a bush when `r < bushBelow` and a
tree otherwise. It stands on tile `t + floor(hash01(seed + t * jitter.key) *
jitter.span) + jitter.min`, scaled `scale.base + hash01(seed + t * scale.key) *
scale.span`. Its canvas is `round(size.tiles * tileW * scale)` wide and
`round(size.floors * floorH * scale)` tall (`plants.size`, by kind), centered on
the tile's left edge (x `tile * tileW - w / 2`, which can land on a half pixel;
the game does not snap it, and draws with nearest sampling),
with its bottom edge at `bottomY` (its last row one above). The game paints a
plant at that size, `w` by `h`, with `plants.paint` (rectangles filled in
order, `round` and `ceil` as in JavaScript):

- a tree, with `ts = seed + tile`: the trunk `tw = max(trunk.minW, round(w *
  trunk.w))` wide and `th = round(h * trunk.h)` tall at x `round(w / 2 - tw /
  2)`, y `h - th`; then each `canopy` layer `i` at x `round(w * (1 - c.w) / 2)
  + round((hash01(ts + i * jitterKey) - 0.5) * 2)`, y `round(h - th - h *
  c.y)`, `round(w * c.w)` wide and `round(h * canopyH)` tall;
- a bush: `base` at x 0, y `round(h * base.y)`, `w` wide and `ceil(h *
  base.h)` tall, then `top` at x `round(w * top.x)`, y 0, `round(w * top.w)`
  wide and `round(h * top.h)` tall.

The `scenery/tree/v<0-7>` and `scenery/bush` frames are those plants at their
base size (trees seeded 0 to 7), for a frontend that would rather scale a
frame. A plant is hidden while the paved span reaches within
`clearTiles` tiles of it: it shows only when `tile + clearTiles` is at most
the span's first tile or `tile - clearTiles` is at least the tile after its
last.

### The sky

`data.sky` gives the sky's motion in the game's own terms. The sky is drawn
in screen space, sized to the view (`viewW` by `viewH` pixels), behind the
world, in this order:

1. The background: `data.skyColors[floor(hour) * background.columnsPerHour]`,
   the color of the whole game hour (it changes on the hour).
2. The sun (`sky/sun`) from `sun.rise` (inclusive) to `sun.set` (exclusive),
   and the moon (`sky/moon`) for the rest of the day, along the same arc. With
   the time as `hour + minute / 60`, at fraction `p` of its stretch (the day
   from rise to set, or the night from set to rise) the disc's center (the
   frame's `anchor`) is at x
   `p * viewW` and y `viewH * baseY - sin(p * PI) * viewH * lift`.
3. The clouds, on cloudy and rainy days: `clouds.weathers` maps the engine's
   weather (`cloudy` or `rain`) to its frames, `sky/cloud/<frames>/<i>`, one
   per entry in `clouds.list`. At `t` seconds of the game's animation clock
   (never negative), cloud `i`'s frame `anchor` is at x `((offset %
   (viewW + pad)) + t * speed) % (viewW + pad) - pad / 2` and y `viewH * top +
   row * viewH * band`, with `%` the floating-point remainder.

On rainy days the game also draws `sky.rain` over the whole view, in front of
the world and the tower: a `tint` fill, then `count` streaks stroked
`lineWidth` wide in `stroke`, streak `i` from x `((i * xMul) >>> 0) % viewW`
(the product taken as a double, then wrapped to an unsigned 32-bit integer)
and y `((i * yStep) % viewH + t * speed) % viewH`, to `dx`, `dy` pixels
further.

### Draw order

`data.depth` lists the game's draw planes back to front, each with its `z`
(the game's Excalibur z; higher draws in front) and the frame families on it:
the sky, the two skyline bands, the dirt and ground line, the ground strip,
the ground runs and roundabout, the props and plants, the fire escapes and
crane, the floor and lobby tiles, the rooms, the ambient walkers, the burning
and unbuilt rooms, the parking ramp's cars, the metro train and garbage truck,
the shafts and stairs, the cabs, the commuting crowd and the overlays (the
rain draws there, in front of everything). Things
on one plane draw in the order the game adds them. People appear on two
planes: the walkers pacing the floors and lobby, and the crowd in front of
them, which is every commuter the engine moves, the people waiting at an
elevator on the lobby floor among them. A crowd figure is the
`person/walker/...` frame: `shirt<i>` with i = |seed| mod the shirt count,
`staff` for staff, and `fedUp` once a tenant (never staff) has waited more
than 25 seconds on its current call, the game's cue that they are fed up.
Its feet stand 3 px above the bottom of its floor (at its fractional floor
while it climbs stairs), and a tenant riding a cab is hidden, since the cab's
riders show them.

## The app icon

`icon/` holds the game's app icon, drawn in code like every sprite
(`scripts/app-icon-svg.mjs`): a stepped art-deco tower with lit windows and a
setting sun on a dusk sky. `icon.svg` bleeds to every edge and
`icon-maskable.svg` keeps the tower inside the maskable safe zone (the center
80 percent). The PNGs are the ones the web app ships: `icon-1024x1024.png`
(the desktop master), `pwa-512x512.png`, `pwa-maskable-512x512.png`,
`pwa-192x192.png`, `apple-touch-icon.png` (180) and `favicon.png` (64),
rasterized from the same mark by `scripts/gen-pwa-icons.mjs`. They fall under
the same asset license as the rest of the atlas.

## How it is checked

`e2e/atlas.spec.ts` (and the export's own pre-flight) composes atlas frames and
layers for the sample room signatures with the reference reader, paints the
same rooms through the game's own paint functions (`src/render/regionPaint.ts`,
which the region compositor and the burning-room canvas call), and requires an
exact pixel match. Settled rooms are painted at two region offsets; burning and
unbuilt rooms at the per-unit origin the game paints them at; and the five
origin-seeded kinds at the per-unit origin, the look the atlas carries (the
game's region paint can differ for them, #915). A control case compares two different
pictures and must report a mismatch. The bake refuses to write a layer that
would not compose back to the game's pixels. A unit test rebuilds every frame
and layer from the packed pages through the manifest.

A room frame with depth layers is also composed through its depth split (the
shell and its occupant steps, then the furniture and its occupant steps, then
a vehicle's front and its steps) and held to the same paint. After packing,
the export rebuilds every layered frame from the pages through the
manifest, shell then furniture (then a vehicle's front) with their steps at
every occupant count, and requires its flat frame's pixels. It also measures
how far the soft furniture drifts from the flat frame, prints the share of
pixels and the largest channel difference, and refuses an atlas whose soft
furniture strays past the limit, misses a pixel of the furniture, or (in a
full export) is missing from every frame.

The same check covers the other families (`verifyExtras.ts`): a whole express
and standard shaft rebuilt from their floor pieces (skip floor included), cabs
with composed riders, a walker, lobby tiles, entrance poses, a fire escape,
the sky strip and the scenery (a fountain frame, the street lamp and sign, a
paved ground tile and the road), each against the game's draw call with the
game's arguments. The lobby tiles and entrance poses are also composed through
their depth layers.

## Not in the atlas yet

Event cameos (Santa, the VIP limo, the thief) are not exported yet.
