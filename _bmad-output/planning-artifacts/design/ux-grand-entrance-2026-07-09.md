---
type: ux-spec
scope: render-layer
status: final
authors: Sally, Samus, Cloud (via bmad-party-mode)
distilled_by: gds-ux
date: 2026-07-09
supersedes: none
related:
  - _bmad-output/implementation-artifacts/backlog.md (row: lobby-awnings, done)
  - src/render/sprites/structure.ts (LOBBY_VARIANTS, drawLobby, drawAwning)
  - src/render/excalibur/TowerEngine.ts (syncEscapes, lobbyTileGfx)
---

# Ground-floor grand entrance UX spec

## What this is

Two new lobby-tile variants for floor 1: a **grand entrance** on the left frontage
edge and a quieter **service entrance** on the right. Both are pure render-layer
additions to the existing ground-floor lobby tile pattern. No new sim state, no
save changes, no new facilities, no mode branching.

## What this is NOT

Not a new placeable facility, not an engine change, not a save-format change,
not player-configurable. Not a change to the exterior marquee (shipped 1.14.2).
Not the "richer facade" or "background cityscape" backlog items.

## Wayfinding intent

The tower's ground floor already reads as "a lobby": chandeliers, columns, red
carpet, gilded cornice. It does NOT read as "here is the front door." A new
player building their first tower has to infer the entrance from where walkers
appear. The grand entrance tile makes visible what the sim already treats as
true: this is the frontage corner where people arrive.

The service entrance is the counterweight: symmetry-preserving on the opposite
corner, but visually quiet so the eye locks onto the grand side.

## Detection (derived, no state)

The entrance kinds are picked per floor-1 lobby tile at render time. Floor 1
only. Predicate walks the floor-1 lobby tiles' CONTIGUOUS RUNS so a gap in the
middle of the lobby (mid-remodel bulldoze) cannot orphan a half-facade with no
neighbor. Rules, in the order they resolve:

```
Given floor-1 lobby tiles, grouped into their contiguous runs by grid x:

  Grand entrance goes on the LEFTMOST run:
    - run width >= 2 tiles: runStart      -> grand-left
                             runStart + 1 -> grand-right
    - run width == 1 tile:   runStart      -> grand-solo (compact fallback)

  Service entrance goes on the RIGHTMOST run's rightmost tile IFF:
    - the rightmost tile is not already claimed by the grand entrance
    - AND the rightmost run has room past the grand span
      (same run as grand: run width > grand span; different run: always)

  Every other tile: -> variant (existing 4-cycle pattern)
```

Rules that fall out of this predicate:

- **Single-tile lobby**: grand-solo, no service. Toy tower doesn't get the wide
  storefront and doesn't need a service entrance.
- **Two-tile lobby**: grand-left + grand-right. No service (grand claims both
  frontage tiles of the tower).
- **Three-or-more-tile contiguous lobby**: grand-left + grand-right at the
  left frontage, service at the rightmost tile, normal variant cycle in
  between.
- **Lobby with a mid-remodel gap**: the leftmost run holds the grand entrance
  (in whichever form fits its width), the rightmost run holds service on its
  rightmost tile. Gap tiles between them stay empty. No orphan half-facade.
- **Two disjoint one-tile lobbies**: leftmost gets grand-solo, rightmost gets
  service.
- **Basement-only or empty lot**: no floor-1 lobby exists, so no grand or
  service tile is placed. `floor1EntranceMap` stays empty.

The predicate does not touch any tile above floor 1. Sky lobbies keep the
existing variant cycle unchanged.

Detection reads only `sim.tower.units` (which already drives the exterior
marquee via `facadeGeometry` / `syncEscapes`), so the grand entrance visually
sits under the marquee by construction. No extra data is threaded through the
render path.

## Art direction

Consistent with the shipped ground-floor lobby palette: warm marble walls
(`#f8f1dc` to `#e3d7b3`), gilded cornice (`#caa84a`, `#8a7430`), red carpet
(`#a3243c` + `#d9b356` edge), and the green-and-gold marquee overhead
(`#234b39`, `#c9a94c`).

### Grand entrance, wide form (22x34 px = 2 x 11x34 tiles)

Rendered as a 2-tile storefront facade. The tile at `x = runStart` paints the
LEFT slice (a big glass display window looking into the lobby); the tile at
`x = runStart + 1` paints the RIGHT slice (double doors + doorman + smaller
glass panel). The two slices compose into one continuous 22 px facade with
matching cornice, floor and carpet lines so no seam shows.

Shared skeleton (both slices):

- **Gilded cornice** across the top, matching the concourse's other tiles so
  the ceiling line reads continuous across the whole lobby.
- **Dark storefront frame top rail** just under the cornice (`#3a2a20`).
- **Kickplate** under the glass, meeting the floor.
- **Polished floor + red carpet** at the bottom, same rows as the base ground
  lobby tile (so the entrance blends into the concourse's floor line).
- **Warm interior background** visible through the glass across the whole
  facade. Brightens at night so the storefront reads as a hot rectangle of
  light after dark. Interior carpet stripe visible through the very bottom of
  the glass.

Left slice adds:

- **Outer storefront frame post** at the left edge.
- **Chandelier** visible through the display window, echoing the concourse's
  chandeliers. This one lives inside the tile because the whole slice is a
  window looking INTO the lobby, so it inherits an interior chandelier by
  construction (which is different from the earlier 1-tile design's "no
  chandelier" rule).
- **Gold accent rail** across the display window at head height.
- **Door jamb** along the right edge, meeting the doors in the right slice.

Right slice adds:

- **Double doors** at the left edge of the slice, with a **brighter warm glow**
  behind the doors than through the display windows (a hotter opening reads
  as the actual entrance, the wayfinding beat).
- **Gold split rail** between the two door leaves.
- **Door jamb** to the right of the doors, then a smaller **glass panel** with
  the **doorman** visible inside on the carpet.
- **Outer storefront frame post** at the right edge.

Doorman: a small 2-wide pixel figure with a dark green hat cap, a warm skin
tone, a green tunic (`#234b39`) with a gold collar band (`#c9a94c`), and dark
shoes. Two-frame idle sway keyed to `d.anim` (see Animation below).

### Grand entrance, compact form (11x34 px, single-tile fallback)

Used when the leftmost contiguous lobby run is only one tile wide (a toy
tower). Compresses the wide design into a single tile:

- Dark door frame (`#3a2a20`) centered in the tile, ~5 px wide.
- Gold split rail between the two door leaves.
- Warm interior glow behind the glass (subtle by day, hot at night).
- Small doorman just outside the right jamb, same recipe as the wide form.
- Red carpet accent at the base of the doors.

### Service entrance tile (11x34 px)

Placed on the rightmost tile of the rightmost contiguous floor-1 lobby run
when the predicate above allows. Keeps the concourse's warm-lobby grammar
(same frame color, same cornice) but swaps the glass double-door language
for a solid wood-panel door:

- **Dark frame** (`#3a2a20`) at the door edges (jambs, header, sill). Same
  color as the grand entrance's frame so both doors clearly belong to the
  same building's carpentry.
- **Solid wood door panel**, warm mid-brown (`#7a5230`) with a highlight
  edge (`#8f6438`) and shadow edge (`#5c3d21`) for grain, plus two recessed
  interior panels (upper + lower) so it reads as a paneled wood door.
- **Brass hinges** (two gold dots on the left jamb) and a small **doorknob**
  on the right side of the panel.
- **Small brass "service" plate** on the wall to the right of the door: a
  gold rectangle with darker gold border and a horizontal etch line standing
  in for lettering at this pixel scale.
- **Potted plant** further right on the wall: brass pot with a green shrub,
  using the same shrub language the sky-lobby planter uses so plants read as
  one family across the concourse.

**No interior glow, no doorman, no red-carpet accent.** The service door is
deliberately quiet, and the brass plate + planter give the tile enough
positive detail to feel like a real service door rather than a shrunken grand
entrance.

## Animation

### Doorman idle sway

The doorman uses a 2-frame idle animation, alternating every 3 seconds of
in-game time (independent of game speed pause). The sway is a 1 px horizontal
shift of the torso, keeping the feet planted. The purpose is the difference
between "sprite" and "he is alive."

This means the grand tile draws on the animated-repaint path (bake per frame),
NOT the cache-once path the other lobby variants use. The service tile stays
on the cache-once path.

### No other motion

Nothing else in either tile moves. The interior glow is a static painting; its
day/night change is driven by the same `lit` state the concourse already reads,
not by any per-frame animation. The doors do not open or close.

## Wayfinding hierarchy (day vs night)

The tile system, ordered by visual weight:

- **Day**: marquee > grand doors > chandeliers > columns > planters > service
  door > plain wall. The grand entrance and the marquee together anchor the
  eye. The service door reads as "there but quiet."
- **Night**: grand entrance glow > marquee > chandeliers > sconces > service
  door > plain wall. The entrance becomes the brightest surface on the tower
  after dark, making the lobby's role legible even at zoomed-out overview.

## Acceptance criteria

Owned by implementation but pinned here for the reviewer:

- A single-tile floor-1 lobby shows exactly one **grand-solo** tile and no
  service tile.
- A two-tile contiguous floor-1 lobby shows **grand-left** at the leftmost
  tile and **grand-right** at the next tile. No service tile (grand claims
  both frontage tiles).
- A three-or-more-tile contiguous floor-1 lobby shows grand-left + grand-right
  at the left frontage, a service tile at the rightmost tile, and the normal
  4-variant cycle on every tile in between.
- A mid-lobby gap (bulldozed middle tile) keeps grand-left / grand-right on
  the leftmost run and service on the rightmost run's rightmost tile. No
  orphan half-facade in the gap.
- Two disjoint single-tile lobbies (leftmost run + separate rightmost run)
  place grand-solo on the leftmost run and service on the rightmost run.
- No floor-1 lobby (basement-only, empty lot) places no grand or service tile.
- Sky lobbies on floors 2+ are unaffected. `lobbyVariant(x)` still drives them.
- The doorman sways once every 3 seconds of in-game time; the sway pauses when
  the game is paused (same rule as other decorative motion in the tower). The
  shoes stay planted while the head, hat and torso shift 1 px.
- No save-format bump, no `saveMigration` change, no new engine surface.

## Deliberate non-goals

- No revolving doors (Samus withdrew this early; too much noise at 11 px).
- No support columns holding up the exterior marquee (a hotel marquee is a
  wall-mounted cantilever, not a portico).
- No doorman for the service entrance (asymmetry is the point).
- No projection of the carpet onto the sidewalk actor (z-order pain).
- No player-configurable "which side is grand"; always left, always right.
- No behavior change to walker spawns / entry / exit logic. The grand entrance
  reads the sim; it does not drive it.

## Files touched

- `src/render/sprites/structure.ts`: `drawGrandFacadeLeft`,
  `drawGrandFacadeRight`, `drawGrandCompact`, `drawServiceEntrance`, plus the
  shared `drawDoorman` helper and the `ENTRANCE_GRAND_LEFT` / `_RIGHT` /
  `_SOLO` / `ENTRANCE_SERVICE` sentinels routed through `drawLobbyEntrance`.
- `src/render/excalibur/TowerEngine.ts`: `refreshFloor1EntranceMap` (contiguous
  runs), `floor1EntranceKind` (map lookup), `lobbyTileGfx` routing, and the
  new `entranceGrandLeftGfx` / `entranceGrandRightGfx` / `entranceGrandSoloGfx`
  / `entranceServiceGfx` baked canvases.
- `src/tests/sprites.test.ts`: smoke coverage for all four entrance kinds
  plus the doorman sway.
- `scripts/screenshot-scenes.ts`: already covers the two zoomed edge crops
  from the previous marquee PR; no scene changes needed.
- Version bump: minor (new player-facing capability, distinct new tile type).

## Party attribution

The design was distilled from a bmad-party-mode session with:
- Sally (UX Designer): the wayfinding language, the night-glow beat, the
  "load-bearing beauty" rule (render trick, no new state).
- Samus Shepard (Game Designer): the primary-vs-service asymmetry, the
  doorman as "he's alive," the "make visible what's already true" ethos.
- Cloud Dragonborn (Game Architect): the derive-from-`e.min`/`e.max` predicate
  and the tie-break precedence, the acknowledgment that the grand tile needs
  the animated repaint path.
