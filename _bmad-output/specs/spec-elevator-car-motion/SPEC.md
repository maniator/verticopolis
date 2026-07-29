---
id: SPEC-elevator-car-motion
companions: [brownfield.md]
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability only — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Smooth Elevator Car Motion

## Why

A pain to solve, reported by a player on the 2.0 announcement thread (GH #688): "the ST elevators had a smooth acceleration/deceleration curve and looked sharp. These sort of stutter." The report is right twice. The simulation ticks only when a whole game-minute has accumulated (roughly 2-4 times per real second at normal pace), while the renderer draws cars straight off sim state at 60fps, so a moving car freezes and then jumps a floor or more; the breathing clock widens the gaps exactly at the lunch crush, when elevator traffic is the show. Separately, cars travel at constant speed and stop dead, where the 1994 original eased in and out. Elevators are the heart of the game; their motion is the single most-watched animation in it.

## Capabilities

- **CAP-1**
  - **intent:** Elevator cars glide continuously between sim updates instead of freezing and jumping when the simulation ticks.
  - **success:** With the sim ticking at whole-game-minute granularity, a moving car's drawn position changes every rendered frame; no frame-to-frame jump exceeds the distance implied by one frame of eased pursuit, and a test pins that the drawn position converges on the sim position.
- **CAP-2**
  - **intent:** Car motion carries an acceleration and deceleration shape: departures ramp up, arrivals settle, with no overshoot past the target.
  - **success:** A unit test drives a pursuit from rest toward a distant target and asserts per-frame speed rises from zero, peaks, falls as the target nears, and never crosses the target; a still car under a stationary target does not creep.
- **CAP-3**
  - **intent:** Discontinuities snap instead of gliding: a rebuilt motion layer, a loaded save, or a sim jump larger than a car could plausibly travel places the drawn car at the sim position immediately.
  - **success:** A test moves the sim position by several floors in one step beyond the snap threshold and asserts the drawn position lands there in one frame rather than animating across the tower.

## Constraints

- The simulation is untouched: `carPositions`, dispatch order, dwell timing, and arrival times stay byte-identical, and the golden master must not need a re-pin. The easing lives entirely between the sim value and the pixels.
- Interpolation advances on the engine update's stepped elapsed time (the same pipeline the screenshot TestClock steps in whole frames), never on wall clock, so the pinned-container gallery and the e2e visual baselines stay reproducible frame for frame.
- Car draw motion is functional motion, not decoration: it must not gate on the `d.anim` decoration clock, which freezes when ambient animation is off. A reduced-animation player still sees cars glide, the same rule the walkers follow.
- Cab indicators (rider bucket, direction lantern, FULL) keep deriving from live sim state via `carIndicator`; interpolation moves only the drawn position.
- Player-facing feel change: minor version bump with a one-line CHANGELOG note, and `/gds-code-review` is the named review skill.

## Non-goals

- No change to elevator dispatch, speeds, dwell, capacity, or any other sim behavior; this is not a rebalance and not a parity change to arrival times.
- No easing for the metro train or walkers (the train has its own scripted cycle; walkers already have their draw-position mechanism).
- No engine or graphics-layer swap; the fix lands inside the existing Excalibur render path.

## Success signal

A player watching a busy shaft at the lunch crush sees cars accelerate away from a stop, cruise, and settle onto their destination floor in one continuous motion, at every game speed and zoom, and the reporter's "these sort of stutter" no longer describes the game. The deterministic screenshot suite reproduces byte-identical pixels across two independent legs with the interpolation in place.
