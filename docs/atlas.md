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
  the shirt colors, the person build sizes, the sampled seeds).

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
| Shafts | `shaft/<elevator kind>/<top, stop, skip, bottom, single, top-skip, bottom-skip or single-skip>`, `transport/stairs`, `transport/escalator` |
| Cars | `car/<elevator kind>/<idle, up or down>/<full or notfull>/s<0-3>` with a `riders` chain (sampled seeds in `data.carSeeds`) |
| People | `person/<seated, standing, walker, rider or hiVis>/<shirt<i>, staff, impatient or fedUp>`, one `shirt<i>` per entry of `data.shirts` |
| Facade | `facade/escape/<left or right>/<0 or 1>`, `facade/awning/<left or right>`, animation `facade/crane/<lit>` |
| Vehicles | `vehicle/streetcar/s<0-3>` (sampled seeds in `data.streetCarSeeds`), `vehicle/garbagetruck`, `vehicle/metrotrain/<headlight or dark>` |
| Sky | `sky/gradient` (one column per quarter hour), `sky/sun`, `sky/moon`, `sky/cloud/<overcast or rain>/<0-4>`, `sky/skyline/<far or near>` |

A shaft is drawn floor by floor: `top` for its top floor, `bottom` for its
bottom floor, `stop` or `skip` for each floor between (an express skip floor
has no stop line), and `single` for a one-floor shaft. `top-skip`,
`bottom-skip` and `single-skip` cover a shaft whose skip list holds one of its
own end floors (`top-skip` looks the same as `top`: the motor housing covers
that stop line).

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

## Depth layers

A frontend that draws rooms with depth can use a room's shell and its furniture
separately: for example, a 2.5D cutaway that sets the furniture a little in
front of the back wall. A room frame that supports this carries an optional
`layers` field next to its `parts`:

```json
"layers": {
  "shell": [ { "rect": {...}, "dx": 0, "dy": 0 } ],
  "furniture": [ ... ],
  "soft": [ ... ],
  "chains": { "occupants": { "shell": [null, ...], "furniture": [null, ...], "soft": [null, ...] } }
}
```

- `shell` is the room with its furniture and seated people taken out: the
  ceiling, back wall, windows, wall art and floor band, plus whatever the game
  draws over the room after its furniture, such as the night scrim (on an
  empty home or workplace at night, and on a condo whose residents are
  asleep), the notice badge, a hotel room's roaches (and an infested room's
  grime) and a sleeping guest's "z", ceiling lights and glow washes drawn last
  (security, housekeeping, amusements), a cinema's aisle lights and EXIT signs,
  the wedding hall's petal row, the pool water, and the metro's exit stairs,
  platform and track.
- `furniture` holds the pixels that differ between the shell and the flat
  frame, transparent everywhere else.
- `chains` (when the frame has an occupant chain) splits each occupant step
  the same way: `shell` holds what the step changes on the shell (an office's
  downlights or a condo's ceiling light, which switch on with the first
  occupant), `furniture` holds the people who sit down. Each list starts with
  a null step 0 and is trimmed on its own, like a frame's chain steps.
- `soft` (with its own steps in `chains`) is an optional alternative to
  `furniture`; see below.

Each picture is a list of placed parts like `parts` (a picture wider than a
page, like the metro's, is cut into column slices). To show `n` visible
occupants, draw with ordinary source-over blending, in this order:

1. the `shell` parts,
2. the chain's `shell` steps `1..min(n, len - 1)`,
3. the `furniture` parts,
4. the chain's `furniture` steps `1..min(n, len - 1)`.

The result is the frame's own `parts` plus its chain steps `1..n`, exactly.
Draw anything of your own that belongs between the wall and the furniture
(walkers, a depth offset) between steps 2 and 3. Then draw the frame's
overlays on top as usual. Any list can be empty (a fully transparent picture).

What that means for the pictures:

- The furniture layer holds only the pixels that differ. Where a piece of
  furniture happens to match the wall behind it, or where a mark drawn after
  the furniture covers it, the furniture layer is transparent and the shell
  shows that pixel.
- A mark drawn after the furniture sits on the shell, so the furniture layer
  carries the furniture as the flat frame shows it (darkened under the night
  scrim, tinted under the pool water).
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
  The furniture's normals come from the flat frame, masked to its pixels, like
  any other layer.

The game marks the split in each room's draw routine
(`src/render/pixelSprites/layers.ts`): one call where the shell ends, and one
where the furniture ends and the marks drawn over it begin. In the game both
calls do nothing. The export paints each room frame a second time with the
marks live and records the canvas at them; the flat frame comes from the
ordinary paint, so adding layers never changes a frame's pixels. The export
also requires every kind that splits to have furniture in some frame, since a
shell that still showed the furniture would compose back too.

A frame has no `layers`, and a frontend draws it flat, when:

- the room is vacant and shows its LEASE or SALE card (office, condo, studio,
  apartment), is closed and shows its shutter, or is gutted;
- it is a burning or unbuilt room (those are animations);
- its kind is one whose art does not mark a split yet: the parking space, the
  parking ramp and the recycling center (backlog row
  `atlas-depth-layers-flat-kinds`).

Every other room kind splits: office, condo, studio, apartment, the three
hotel grades, fast food, restaurant, food hall, cinema, shop, amusements,
boutique bay, fitness club, clinic, nightclub, spa, sky bar, daycare,
security, medical center, housekeeping, party hall, wedding hall, aquatic
center and metro station.

The layers' own images are packed on pages after the frame images', so a
frontend that ignores `layers` reads the same frames, parts and pages as before
they existed.

### Soft furniture

`soft` is the furniture painted on a transparent background instead of over
the shell, so its glows and soft shadows keep their transparency. Draw it in
place of `furniture` (and its `chains` steps in place of the `furniture`
steps); the order is the same. Over the shell it looks the same to the eye,
but it is not exact: translucent paint rounds slightly differently on its own
than over the wall. In the current atlas SOFT_PCT of the soft pixels differ
from the flat frame, by at most SOFT_MAX of 255 in any channel (the export
prints this measure). Use `furniture` when exact pixels matter, and `soft`
when the furniture moves away from the wall.

A frame has no `soft` when its occupant steps would change a translucent soft
pixel (source-over can only add to it, not replace it); the export counts
those frames.

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

A room frame with depth layers is also composed through its shell and
furniture (then its chains and overlays) and held to the same paint. After
packing, the export rebuilds every layered frame from the pages through the
manifest, shell then furniture with their occupant steps at every occupant
count, and requires its flat frame's pixels. It also measures how far the soft
furniture drifts from the flat frame and prints the share of pixels and the
largest channel difference.

The same check covers the other families (`verifyExtras.ts`): a whole express
and standard shaft rebuilt from their floor pieces (skip floor included), cabs
with composed riders, a walker, a lobby tile, an entrance pose, a fire escape
and the sky strip, each against the game's draw call with the game's
arguments.

## Not in the atlas yet

Event cameos (Santa, the VIP limo, the thief), the plaza and street scenery,
and the ground strip are not exported yet.
