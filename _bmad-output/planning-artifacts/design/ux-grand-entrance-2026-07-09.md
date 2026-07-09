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

> **NOTE (2026-07-09): the detection rules below are the ORIGINAL 1-tile
> design. They were superseded during implementation by two follow-up
> `bmad-party-mode` sessions that widened the grand entrance to a 2-tile
> storefront (with a compact 1-tile fallback for narrow lobbies) and
> re-anchored the predicate to CONTIGUOUS RUNS, not global lobby extent, so
> mid-lobby gaps can't orphan a half-facade. The as-shipped rules live in
> `TowerEngine.refreshFloor1EntranceMap` and `TowerEngine.floor1EntranceKind`
> (`src/render/excalibur/TowerEngine.ts`). Read them for the canonical
> behavior; the text below is preserved as design history.**


Both variants are chosen from tower geometry, at render time, in the same place
`lobbyVariant(x)` already lives. Floor 1 only. Predicate, in priority order:

```
Given a floor-1 lobby unit at grid x, and the floor-1 lobby extent
(e.min = leftmost lobby tile x, e.max = one past the rightmost lobby tile x):

  if x == e.min:            -> grand
  else if x == e.max - 1
       and e.max - e.min > 1: -> service
  else:                       -> variant  (existing 4-cycle pattern)
```

Rules that fall out of this predicate:

- **Single-tile lobby** (`e.max - e.min == 1`): grand only, no service. Grand
  wins the tie because a one-tile toy tower doesn't need a service entrance.
- **Two-tile lobby**: grand at left tile, service at right tile, no overlap.
- **Wider lobbies**: exactly one grand tile and one service tile per tower, at
  the frontage corners; every interior tile uses the existing 4-variant cycle.
- **Basement-only or empty lot**: no floor-1 lobby exists, so no grand or
  service tile. Same clamping already used by `facadeGeometry`.

The predicate does not touch any tile above floor 1. Sky lobbies keep the
existing variant cycle unchanged.

Detection reuses the same `e.min`/`e.max` the exterior marquee already reads via
`facadeGeometry` and `syncEscapes`, so the grand entrance visually sits under
the marquee by construction. No extra data is threaded through the render path.

## Art direction

Consistent with the shipped ground-floor lobby palette: warm marble walls
(`#f8f1dc` to `#e3d7b3`), gilded cornice (`#caa84a`, `#8a7430`), red carpet
(`#a3243c` + `#d9b356` edge), and the green-and-gold marquee overhead
(`#234b39`, `#c9a94c`).

### Grand entrance tile (11x34 px, floor 1, x == e.min)

Priority-ordered elements (must-have first, cut from the bottom if pixels run
out):

1. **Glass double doors** (must have). A dark frame (approx `#3a2a20`) with a
   pale glass panel (`#eef2f7` daytime). Centered in the tile, roughly 6 px
   wide and reaching from just above the carpet to just below the wainscot line
   (about y = 6..y + h - 6). A thin gold split line down the center so the eye
   reads two doors, not one.
2. **Warm interior glow** (must have). A soft rectangle of warm light spilling
   through the glass, wider than the door itself (approx door width + 4 px),
   fading at the edges. Daytime: subtle (`#f7e3a8` at low alpha). Night: strong
   (`#ffe08a` at higher alpha), so the entrance visibly "turns on" at dusk.
   The rest of the concourse's chandeliers already brighten at night; the grand
   entrance goes brightest, becoming the visual anchor after dark.
3. **Doorman figure** (must have). Roughly 8 px tall, standing to the right of
   the doors, wearing a green-and-gold uniform that echoes the marquee:
   green torso (`#234b39`), gold trim at the collar and cuffs (`#c9a94c`), a
   simple neutral face color, dark shoes. He must read as "staff, on duty,"
   not as a tenant.
4. **Red carpet accent** (should have). One extra pixel of carpet color over
   the polished-floor sheen line, right at the base of the doors, so the
   interior carpet visibly meets the door. This is a subtle continuity beat,
   not a projection onto the sidewalk (staying inside the 11 px tile keeps the
   z-order clean; the sidewalk lives in a different actor layer).

**No chandelier in the grand tile.** The marquee outside already carries that
role; adding a chandelier inside would create two competing focal points at the
same eye height.

### Service entrance tile (11x34 px, floor 1, x == e.max - 1 when lobby > 1 wide)

- **Same door frame as the grand tile.** Dark frame, pale glass panel, gold
  split line. So both entrances read as the same building.
- **No interior glow.** The service door does not brighten at night; it stays
  the day-tone glass color at all clocks. This is the visual "quiet" beat that
  makes the grand side read as primary.
- **No doorman, no red-carpet accent.** The floor strip stays the standard
  polished floor + carpet without any local override.

The service entrance is intentionally under-detailed. It provides symmetry with
the grand side so the right frontage doesn't feel visually orphaned, but it
never competes with the grand entrance for attention.

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

- A single-tile floor-1 lobby (`e.max - e.min == 1`) shows exactly one grand
  tile and no service tile.
- A two-tile lobby shows grand at the left tile and service at the right tile,
  never both on the same tile.
- Wider lobbies show exactly one grand tile and exactly one service tile;
  every interior tile follows the existing 4-variant cycle.
- No floor-1 lobby means no grand or service tile (basement-only, empty lot).
- Sky lobbies on floors 2+ are unaffected. `lobbyVariant(x)` still drives them.
- The doorman sways once every 3 seconds of in-game time; the sway pauses when
  the game is paused (same rule as other decorative motion in the tower).
- No save-format bump, no `saveMigration` change, no new engine surface.

## Deliberate non-goals

- No revolving doors (Samus withdrew this early; too much noise at 11 px).
- No potted urns flanking the door (cut for pixel budget).
- No doorman for the service entrance (asymmetry is the point).
- No projection of the carpet onto the sidewalk actor (z-order pain).
- No player-configurable "which side is grand" — always left, always right.
- No behavior change to walker spawns / entry / exit logic. The grand entrance
  reads the sim; it does not drive it.

## Files touched (implementation preview, not a plan)

- `src/render/sprites/structure.ts`: two new draw functions (or a single
  parameterized function taking `grand`/`service`) and the tile size doc.
- `src/render/excalibur/TowerEngine.ts`: bake the new canvases per lit-state,
  extend the `lobbyGfx` shape or add a floor-1 override in `lobbyTileGfx()`
  that reads the floor-1 lobby extent from the same source `syncEscapes` uses.
- `src/tests/sprites.test.ts`: smoke coverage that both new sprites paint and
  differ from each other and from the existing variants.
- `scripts/screenshot-scenes.ts`: extend the existing `lobby-awnings` scene
  (or add a peer scene) so the grand and service tiles are actually in frame
  in the committed docs images.
- Version bump: patch (player-noticeable visual change).

## Party attribution

The design was distilled from a bmad-party-mode session with:
- Sally (UX Designer): the wayfinding language, the night-glow beat, the
  "load-bearing beauty" rule (render trick, no new state).
- Samus Shepard (Game Designer): the primary-vs-service asymmetry, the
  doorman as "he's alive," the "make visible what's already true" ethos.
- Cloud Dragonborn (Game Architect): the derive-from-`e.min`/`e.max` predicate
  and the tie-break precedence, the acknowledgment that the grand tile needs
  the animated repaint path.
