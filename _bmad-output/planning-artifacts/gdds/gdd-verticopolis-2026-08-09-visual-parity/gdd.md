---
title: Verticopolis Visual Parity
game_type: simulation (tycoon / management)
platforms: [web, desktop shell, android]
created: 2026-08-09
updated: 2026-08-09
owns: render and art-direction canon
---

# Verticopolis Visual Parity - Game Design Document

## Executive Summary

### Core Concept

Verticopolis renders a tower that should read like SimTower (1994) reads: a row of
discrete rooms per floor, anchored by dark structure, dense enough to feel like a
building rather than a diagram. It currently does not, and the reasons are
measurable. This document fixes the visual canon against numbers taken from the
retail 1994 game rather than from recollection.

Four linked defects, discovered by rendering one real 1994 save (`TOWER13.TDT`, 91
floors over 9 basements, 4 stars, 616 offices, 447 condos) in the retail game under
the project's Wine harness and in Verticopolis at matched scale:

1. The world grid ratio is wrong (4:1 against the original's 4.5:1).
2. The interior palette has no dark end, so structure cannot separate from fill.
3. Room modules have no visible seam, so a floor reads as one continuous band.
4. Interiors carry more colors but less detail than the original, reading flat.

### Target Audience

Players who know the original. The r/SimTower audience compares screenshots floor by
floor; that scrutiny is the acceptance bar this document is written against.

### Unique Selling Points

- Parity claims backed by measurement against the retail game, not by eye.
- Art-direction invariants pinned by tests, so drift is caught mechanically.

## Goals and Context

### Project Goals

- A tower whose floors read as discrete rooms at the zoom players actually use.
- World geometry proportioned as the original's, so any future side-by-side aligns.
- Art direction that is measurably disciplined rather than subjectively "close."

### Background and Rationale

Every figure below was measured on 2026-08-09 from a retail SimTower render compared
against the same save imported into Verticopolis.

**Grid geometry.** The original's floor pitch is exactly 36 px (nine consecutive
floor gaps measured at 36) and an elevator shaft is 31-32 px wide, which is 4 tiles
at 8 px. The original is therefore `TILE = 8`, `FLOOR = 36`, a ratio of 4.5:1.
Verticopolis is `TILE = 11`, `FLOOR = 4 x TILE = 44`, a ratio of 4:1, so our tiles
are 12.5% too wide relative to floor height. The comment in `src/render/scale.ts`
justifies 4:1 on the grounds that it makes a 4-tile elevator car "read square, as in
the 1994 original." The measurement contradicts this: the original's 4-tile car is
32 x 36, taller than it is wide. The rationale is wrong and has propagated into every
sprite authored since.

**Palette.** Measured on daylight interiors, sky excluded:

| Quantity | Original | Verticopolis |
| --- | --- | --- |
| Distinct colors (4-bit bins) | 43 | 99 |
| Average luminance | 103.5 | 166.5 |
| Average saturation | 0.272 | 0.358 |
| Darkest decile | 18 | 97 |
| Median luminance | 116 | 167 |
| Brightest decile | 180 | 224 |

The original separates a module seam by roughly 162 luminance points, 18 against 180.
Verticopolis cannot exceed about 70, because in daylight it holds no tone below 97.
The tower lives almost entirely above the midpoint of the range.

**Density.** Also measured on daylight interiors:

| Quantity | Original | Verticopolis |
| --- | --- | --- |
| Edge density (adjacent pixels differing) | 0.233 | 0.138 |
| Dither index (ABA alternation) | 0.039 | 0.019 |
| Average flat-color run | 4.29 px | 7.27 px |

The original carries more detail in fewer colors. Verticopolis carries more colors in
less detail. The original was not stylized pixel art; it was constrained-palette art
straining toward realism, and the quality players read as "more real" is spatial
frequency, not color count.

## Core Gameplay

Unchanged by this document. Recorded here only to bound scope: no mechanic, economy,
or simulation behavior changes. This is render canon.

## Art and Audio Direction

### Art Style

**Pillar A - Anchored, not bright.** Structure occupies the dark end of the range and
interiors sit above it. A room seam must be able to reach near-black. Target the
original's shape (darkest decile near 18, median near 116), not its exact values.

**Pillar B - Structured density, never noise.** Rooms carry three or four planes of
depth (back wall, floor, ceiling shadow, furniture) with furniture in consistent
positions, so density reads as rhythm. Detail must survive downsampling as tone: a
texture that turns to noise at half zoom fails, because that is the zoom the game is
played at.

**Pillar C - Muted structure, saturated accents.** Walls, floors and ceilings trend
toward the original's 0.27 saturation. Plants, signage and upholstery keep their
punch. The original's rooms pop because architecture recedes and accents do not.

**Pillar D - Discipline, not imitation.** The target is the original's tight palette,
dark anchor and density, expressed at our 1.25x resolution with our own identity. Not
a color-for-color copy.

### Canon Decisions

- **Grid.** `TILE = 10`, `FLOOR = 45`, an exact 4.5:1. Chosen over 8/36 (exact but
  discards resolution already paid for) and 16/72 (exact 2x, but 45 floors x 72 =
  3,240 px breaks the ~2,048 px GPU texture cap that `TRANSPORT_BAND_FLOORS = 45` is
  pinned against; 45 x 45 = 2,025 stays under it). The elevator car becomes 40 x 45,
  taller than wide, which is correct.
- **Master palette.** Roughly 48-64 colors, built from the original's ramps, with the
  interior ramp extended at the dark end. Room sprites quantize to it.
- **Module seam.** A 2 px vertical band at the left edge of every module, in the base
  sprite: 1 px dark seam plus 1 px lighter highlight, so it reads as a lit wall rather
  than a line. The leftmost module on a floor keeps its wall; that is the building's
  exterior.
- **No dithering.** It was a color-depth workaround for hardware we do not have. At
  our resolution it shimmers under camera pan and reads as a rendering fault.

### Explicitly Out of Bounds

- A 1 px hairline seam (invisible at play zoom).
- A full architectural column as a divider (eats interior at 10 px tiles).
- A seam drawn into the occupancy-gated layer (empty rooms would lose their edges).
- A doubled seam where a room abuts an elevator shaft or stairwell; suppress the
  room's own seam there, because the shaft already draws its edge.
- Subdividing within a module; a 6-tile office gets one seam at its left, not six.
- A global LUT or post-process filter over the render.
- Quantizing the sky or the day/night gradient to the sprite palette; that gradient
  needs its full range.

## Technical Specifications

### Pinned Invariants

Art drift was invisible until it was measured. These exist so it cannot drift
silently again, and are enforced by test rather than by eye:

| Invariant | Target |
| --- | --- |
| Grid ratio | `FLOOR / TILE == 4.5` exactly |
| Elevator car | taller than wide (inverts the current "square car" pin) |
| Shaft band | `TRANSPORT_BAND_FLOORS * FLOOR <= 2048` |
| Palette count | interior sprites within the master palette, <= 64 colors |
| Darkest decile | interior daylight sample reaches the dark anchor |
| Saturation | architecture near 0.27; accents exempt |

### Blast Radius

15 files reference `TILE`, 26 reference `FLOOR`, and `scale.test.ts` pins the
"square car" invariant and must be inverted. Save compatibility is unaffected: view
state is stored in grid units, not pixels. The change is player-visible, so it takes
a version bump and a changelog line.

## Development Epics

Strictly sequential. Each step changes what the next should be drawn against, so they
must not run in parallel.

| # | Epic | Delivers |
| --- | --- | --- |
| 1 | Grid ratio to 4.5:1 | `TILE = 10`, `FLOOR = 45`, inverted car pin, corrected `scale.ts` rationale |
| 2 | Palette ramp | master palette, extended dark end, desaturated architecture, pinned metrics |
| 3 | Room redesign | density passes per room kind, presented for owner approval before implementation |
| 4 | Module seams | 2 px seam in base sprites, suppression at shaft and stairwell boundaries |

**Approval gate on Epic 3.** Redesigned rooms are presented to the owner for approval
before they are implemented. Room art is the game's face and the owner's call; this
document sets the rules the designs answer to, not the designs themselves.

## Out of Scope

- Any mechanic, economy or simulation change.
- Sky, weather and day/night gradient art.
- Audio, which is settled by the human-recorded soundtrack work.
- Desktop and Android shell chrome.
- A literal color-for-color match with the original (rejected in favor of discipline).

## Assumptions and Dependencies

- [ASSUMPTION] The original's 43-color interior palette reflects a fixed VGA palette
  reused across room kinds. Not verified against the game's binary, and deliberately
  not verified: the clean-room boundary in `docs/canon/tdt-format.md` permits observing
  behavior and data, not reading code or extracting assets. Our palette is authored
  from measured screen output, never from game bytes.
- Measurements were taken from a single tower at one zoom on one machine. A second
  tower should confirm the palette figures before Epic 2 changes tone values.

## Open Questions

- Does the density work in Epic 3 apply to every room kind at once, or only to the
  kinds that dominate a tall tower's screen area (office, condo, hotel rooms) first?
