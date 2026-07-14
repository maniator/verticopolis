# Pixel-Art Overhaul - Game Design Document

**Author:** Naftali (with the design party: Samus Shepard, Sally, Cloud Dragonborn)
**Game Type:** Simulation / tycoon (SimTower 1994 parity)
**Target Platform(s):** Web (primary), Android TWA, iOS Capacitor

Feature-scoped GDD produced with `gds-gdd`. Design intent only (what the player
sees and what each visual system must achieve); the render-engine mapping is in
`arch-pixel-art-overhaul-2026-07-14.md`, and the buildable breakdown is in
`epics-pixel-art-overhaul-2026-07-14.md`. The ratified art direction, palette,
Figma source-of-truth index, finalized people geometry, and the rendered module
gallery live in `../../implementation-artifacts/spec-pixel-art-overhaul.md`
(the art bible), which this GDD does not restate.

---

## Executive Summary

### Core Concept

Redraw every room, subtype, service, structure, transport module, unit state,
and event actor so the tower reads as the warm, lived-in 1994 SimTower
cross-section, using 100% original procedural Canvas 2D art (no imported
assets). The Figma mood board (`2nFfdgPNNSVo6xBqEP8OCz`) is the visual source of
truth; the shipped art matches it at true in-game sizes (`TILE = 11px` wide,
`FLOOR = 44px` tall). The current art is competent but reads flat, cool, and
underpopulated next to the original; this overhaul closes that gap without
touching a single gameplay rule.

### Target Audience

Existing and prospective players who know SimTower and expect its dollhouse
warmth. The overhaul is mode-agnostic and player-facing: every tower, Classic or
Modern, renders with it.

### Unique Selling Points (USPs)

- A 60-floor tower where each room is nameable at a glance from one iconic
  silhouette, and the whole building reads warm and inhabited.
- Honest population: the people you see are the people who are actually there.
  Crowds, queues, and moods reflect the live simulation, never decoration.
- Clean-room homage: pixel-identical to a hand-built reference board, shipped as
  procedural code, reproducible from committed sources.

---

## Goals and Context

### Project Goals

- Move all 25 facility kinds, all 21 named retail subtypes, every unit state,
  the three transport kinds, and the event actors into the ratified narrative
  style, at true in-game sizes.
- Make population honest and legible: two figure scales, class silhouettes, mood
  color, no ghost people, and visible elevator queues and car fill.
- Preserve every gameplay invariant, state cue, save round-trip, and performance
  budget. This is a repaint, so no rule, number, or data shape changes.

### Background and Rationale

The reference screenshots the owner shared show warm furnished interiors, colored
storefront awnings, pink hotel bedding, green-carpet offices, and a skyline
behind the tower. The current renderer draws cooler, sparser rooms with tiny
figures. Owner review during the design pass set two hard corrections that this
GDD encodes as pillars: figures were too small (now calibrated to explicit pixel
sizes) and lobbies must not host ambient pedestrians (only real population
appears). Party hall shipped as two floors during this pass (PR #242), so the
art targets the two-floor composition.

---

## Core Gameplay

This is a rendering feature, so "gameplay" here means what the render layer must
show for the existing simulation to read correctly. No new player verbs.

### Game Pillars

1. **Warm dollhouse density.** Every occupied cell is a lit, furnished
   cross-section carrying at least 3 readable props plus one silhouette doing an
   activity. A lived-in room outreads an accurate one. Cream and warm-gray walls,
   never cool blue-gray; interiors brighter than the shell; warm light within,
   cool skyline outside.
2. **One iconic silhouette per kind.** A player skimming a full tower names each
   room from its single strongest shape (menu board over a counter, pink bed
   with a brass lamp, striped awning over a glass window). Legibility at 16px
   beats detail.
3. **Honest, legible population.** Figures appear only where real occupants or
   routed sims exist. Two context scales separate room occupants from tower
   walkers, class silhouettes distinguish who a sim is, and fill color encodes
   mood so a stressed crowd reads instantly.
4. **State cues always win.** Reserved state colors and their geometry (lease
   card, sale card, notice ribbon, dirty tray, ready lamp, asleep cue, closed
   shutter, construction, burnt shell) stay unambiguous over the richer walls,
   under the night scrim and the heatmap overlay.

### Core Gameplay Loop

The render loop the player experiences: place a unit, watch it fill with the
right furniture and the right number of occupants, read its state at a glance,
and read tower-wide congestion from the queues and crowd colors. Each pillar
reinforces the loop: density makes the room legible, the silhouette names it, the
population makes it feel alive and diagnostic, and the state cues keep problems
findable.

### Win/Loss Conditions

Unchanged. The overhaul alters no rating, economy, or event outcome.

---

## Game Mechanics

The player-facing visual systems, with the concrete numbers that make them
specifications rather than moods. All figures are true in-game pixels.

### Primary Mechanics

- **People system (two scales, class, mood, honesty).**
  - Seated room occupant: head 5 + torso 10 = 15px tall, 6px wide, no legs
    (diners, seated workers and readers, wedding guests, behind-counter staff).
  - Standing room occupant: 5 + 9 + 4 = 18px, 6px wide (staff standing in the
    open: medical, housekeeping).
  - Walker: 5 + 13 + 6 = 24px, 7px wide (lobby, sky lobby, entrances, metro
    platform, corridor and transport-landing traffic). Roughly 55% of a module.
  - Transport rider on the incline: 17px (stairs, escalator). Hi-vis worker: ~22px.
  - Class is silhouette plus size (child, woman, man, office worker, businessman,
    tourist, housekeeper, security, doctor or nurse, elderly), chosen from what
    the sim actually is.
  - Mood is the torso fill: content = class color (the `SHIRTS` palette),
    impatient = amber `#E8862A`, fed up = the reserved stress red `#C24A3A`. No
    class color equals the stress red.
  - No ghost people: room figures equal `visibleOccupants(u)`; walker figures map
    to real routed sims and appear only when traffic is present. An empty tower
    reads empty.
- **Elevator queues, car fill, and tracked boarding.** Sims physically line up at
  each served floor's shaft landing. The queue tints from class color to amber to
  stress red as waits grow. When a car arrives, the sims already in that floor's
  queue board in order up to the car's remaining capacity; whoever does not fit
  stays in the same queue (the same individuals) for the next car. The car's fill
  is those boarded sims, drawn inside the cab up to capacity. Nobody is spawned to
  fill a car or discarded when it leaves.
- **Module composition (per-kind look bible).** Each of the 25 kinds and 21
  subtypes has a fixed interior recipe (walls, floor, 3 to 5 props, signage, and
  its occupant grid), specified per module in the art bible and rendered pixel-
  for-pixel by the committed build scripts. Occupancy maps seats, beds, and desks
  to `visibleOccupants(u)`.
- **Geo-seeded variety.** Rows of the same kind differ by a per-(kind, floor, x)
  seed that varies geometry first (layout, wall item, window seed), holding
  luminance within 10 per RGB channel of each anchor so the night scrim and
  heatmap survive. Determinism across a TDT save round-trip is automatic.
- **State visuals.** Construction (girders, scaffolding, crane, hard-hat worker),
  empty (lease or sale card on a hatched shell), vacating (amber notice ribbon),
  asleep and dirty (hotel cues), fire and gutted (burnt shell and flames), and
  closed-hours (shutter) each keep their reserved color and geometry, drawn
  outside any mirror wrapper.

### Controls and Input

Unchanged. No new input. Existing zoom, pan, and inspect surfaces read the new
art directly.

---

## Simulation-Genre Specific Design

### Population readability

The tower's health is read from its people: a floor whose queue is stress red is
a transport problem; an empty lobby is an empty tower, not a broken renderer; a
packed express car versus a near-empty one reads at a glance. The art must never
manufacture activity the simulation does not have.

### Facility identity at scale

At a 60-floor zoom a single module is roughly 16px tall. The iconic-silhouette
pillar guarantees each kind survives that scale: the identity prop (menu board,
pink bed, awning, green cross, red curtain screen) stays legible when the detail
does not.

### Two-layer grid honesty

Rooms sit on the structural floor/lobby layer exactly like the original corridor
model. The art respects that: floors, lobbies, and entrances are structure; rooms
are tenants on top; multi-floor venues (cinema, party hall, wedding hall, the
elevator span views) are drawn at their true height (44px per floor).

---

## Progression and Balance

### Player Progression

Unchanged. The overhaul adds no unlocks and gates nothing. Every star tier renders
with the same system; richer towers simply show more of it.

### Difficulty Curve

Unchanged.

### Economy and Resources

Unchanged. The render layer reads existing occupancy, satisfaction, traffic, and
event state; it writes nothing back into the economy.

---

## Level Design Framework

### Level Types

A "level" is the player's tower. The overhaul touches the visual vocabulary the
tower is built from: 25 facility kinds, 21 named retail subtypes, 8 unit states,
3 transport kinds, ground and sky lobbies, 3 entrances, and the event actors. The
Figma board organizes them into eight labeled pages (the source-of-truth index in
the art bible).

### Level Progression

Unchanged. Floors -9 to 100 render identically to today's grid; only the pixels
inside each module change.

---

## Art and Audio Direction

### Art Style

The full ratified direction is the art bible; the load-bearing summary: warm
dollhouse cross-sections, the expanded warm `PAL` palette (cream walls, olive
office carpet, warm pink and red hotel bedding, warm woods, warm lamp glow, a cool
day and night skyline behind windows), colored storefront awnings and lit signs,
and the finalized people geometry above. Reserved state colors are never reused
for decoration. The rendered module gallery (six page overviews plus 63 per-tile
PNGs) and the pixel-exact build scripts are committed under
`../../implementation-artifacts/pixelart-figma/`.

### Audio and Music

Out of scope. No audio change.

---

## Technical Specifications

### Performance Requirements

No regression to the existing budget. Decorative art reads only inputs already in
the bake signature so static rooms bake once and repaint only on a signature
change; only fire, construction, and the existing cinema marquee redraw per
frame. No new full-collection scan on a per-tick or per-frame path. Details and
the queue/fill data seam are in the architecture doc.

### Platform-Specific Details

Tall shafts and the ground plane stay banded into texture-size-safe strips so
mobile GPUs do not render them black. Integer pixel coordinates only.

### Asset Requirements

Zero binary game assets: all art is procedural Canvas 2D. The committed PNGs are
documentation (the reference gallery), not shipped game assets.

---

## Development Epics

Detailed in `epics-pixel-art-overhaul-2026-07-14.md`. Summary sequence:

| # | Epic | Delivers |
|---|---|---|
| E1 | Shared visual language | Palette keys, the `person()` family (15/18/24px), window/glow/texture helpers, geoVariant axis map, file-size prep |
| E2 | Tenant rooms | Office, condo, three hotel grades and their states |
| E3 | Food and entertainment | 5 fast food, 5 restaurants, 2-floor cinema, 2-floor party hall |
| E4 | Retail | 11 canon trades plus the generic fallback |
| E5 | Utilities and service | Recycling, metro, medical, security, housekeeping, parking, ramp |
| E6 | Structure, lobbies and transport | Floor, construction, ground and sky lobby, three entrances, wedding hall, stairs, escalator, three elevators, plus the elevator queue and car-fill engine seam |
| E7 | Unit states | Construction, empty, vacating, asleep, dirty, fire, gutted, closed, verified geo-invariant |
| E8 | Actors and events | Garbage truck, metro train, street car, thief, Santa |
| E9 | Verification and review | Visual baselines, screenshots via the pinned container, the mandatory `gds-code-review`, version bump |

---

## Success Metrics

### Technical Metrics

- All four quality gates green (`typecheck`, `lint`, `test`, `build`), plus
  `subtypeVisuals`, `pixelSpritesCommon`, `fileSize.guard`, and `barrelSurface`.
- Visual regression baselines regenerated only via the pinned path; every
  non-art pixel move treated as a real bug.
- No per-frame budget regression on the tick and render paths.

### Gameplay Metrics

- Every kind and every state reads unambiguously lit, unlit, under the night
  scrim, and under the heatmap overlay.
- Occupant counts match `visibleOccupants(u)`; an empty tower reads empty.
- The shipped gallery matches the reference board tile for tile.

---

## Out of Scope

- Per-unit interior animations (people moving inside a module, machinery in
  motion). Deferred to a follow-up design pass after this overhaul merges;
  tracked in `../../implementation-artifacts/backlog.md`.
- Any new gameplay mechanic, facility kind, retail subtype, economy number, or
  event outcome. This is a repaint.
- Audio.
- New DOM or CSS render paths for rooms (the engine stays canvas-baked).

## Assumptions and Dependencies

- The bake signature (`TowerEngine.ts`) is the only input surface for decorative
  art; new variants key only on bits already in it.
- The 500-line file-size ceiling holds; look tables extract into siblings before
  enrichment.
- The retail subtype list order (`retailSubtypes.ts`) is a load-bearing TDT
  ordinal and is never reordered.
- Party hall is two floors (shipped, PR #242); the art targets that.
- [DEPENDENCY] Visible per-floor elevator queues and car fill need a small engine
  data seam (per-shaft, per-floor waiting lists and boarded-passenger counts
  exposed to the render layer). The queue and fill visuals are gated on that seam;
  it is scoped as a story in E6 and flagged in the architecture doc.
- [ASSUMPTION] The finalized people pixel sizes (15 / 18 / 24) are owner-approved
  from the calibration and rollout; the implementation matches them exactly.
