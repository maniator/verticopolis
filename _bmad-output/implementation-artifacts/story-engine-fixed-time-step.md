---
story: engine-fixed-time-step
status: review
baseline_commit: 686aafa
---

# Story: engine-owned fixed time step

## Why

Today the host frame loop (`src/game/frameLoop.ts`) chooses the sim's step size:
it steps `Math.min(20, accMinutes)` where `accMinutes` is fractional and derived
from real frame time. Trip spawning and elevator demand accumulation run once per
step (`src/engine/sim/loop.ts` `advanceStep`), so the step sequence changes the
result. Measured on `sixseven_2.vctower` over three game days, 30, 60 and 144 Hz
ended with different money and population.

Any future cross-host check (a second frontend, a port of the engine to another
language, a conformance suite of state hashes) is meaningless until the same owed
game time always produces the same sequence of `tick` calls. This story pins that.

## Acceptance criteria

1. **AC1 Engine owns the cut.** A DOM-free engine module decides how owed game
   minutes are cut into steps. The host passes owed minutes and receives the
   carried remainder; it never chooses a step size.
2. **AC2 Frame-rate independence.** For a fixed speed, the same owed total played
   at 30 Hz, 60 Hz, 144 Hz and an irregular frame source produces the same
   sequence of `tick` calls and a byte-identical `serialize()` result. Proven by
   an integration test on a real save.
3. **AC3 Bounded 60 Hz cost.** The step is a 60 Hz frame's owed minutes from
   the canon pacing curve, rounded down to whole minutes and never under 1 (so
   1 minute through the lunch crawl, and bigger steps at the fastest speed
   through the evening and the night sprint). Rounding down means a 60 Hz host
   steps every frame it owes a minute or more, never banking an empty frame, at
   the cost of an occasional second step. Computed against the old loop at
   60 Hz from the pacing curve (approximate figures recorded for the trade-off,
   not enforced in CI), steps per frame rise by up to about 80% in the worst hour (fastest
   speed, 17:00 to 18:00), about 60% for the middle speed through the night
   sprint, about 35% in a few other bands, and under about 15% otherwise. With
   the steady-clock preference the step is sized from a flat pace and the step
   count matches the old loop. Speed and steady clock are player inputs:
   changing either changes the step size from then on.
4. **AC4 Bounded frame work.** One frame runs at most a fixed number of steps.
   A device too slow to keep up at the fastest speed runs the game slower than
   requested instead of stacking sim work into a frame (the Android WebGL
   reclaim load). The unstepped rest carries as debt, bounded by the existing
   30-minute catch-up cap, which is where a host that cannot keep up drops time.
   A change of speed or steady clock clears the carry where the player makes
   it, so banked time never replays under a different step size, even when the
   change is undone before the next frame; speed 0 spends nothing. The debt
   drops step by step, so a step that throws never re-owes the steps that ran.
5. **AC5 Existing guarantees hold.** Modal freeze, speed 0, and the non-finite
   `dtMs` recovery keep working; Classic golden masters and every existing test
   stay green; `sim.tick(dt)` semantics are unchanged for direct callers.
6. **AC6 Version.** Minor bump (CLAUDE.md: minor is the default for anything a
   player notices) with an empty changelog section, since the felt change is
   not worth a "What's new" line: a slow device runs below the requested rate
   instead of taking coarser steps. On the canon curve that starts below about
   16 to 20 frames a second at the fastest speed in most hours (about 27 from
   17:00 to 18:00), below about 24 at the middle speed at night, and below
   about 8 at the slowest; with the steady clock, about 15, 8 and 3. Such a
   device also runs up to four small steps a frame where it ran one or two
   coarse ones; that cost is the price of the same tower at every frame rate.

## Out of scope

- Persisting the sub-quantum remainder across save and load. A save and reload
  mid-session therefore drops under one quantum of owed time; a conformance
  replay that spans a reload must start its owed-minute feed fresh after it.
- Making the host's catch-up cap or pacing curve part of the determinism
  contract (they only change how much time is owed, not how it is stepped).
- Proving determinism through the full host `runFrame` on a real save. Its
  per-frame UI hooks (surfacing an emergency choice, which freezes time) run on
  a real-time throttle by design, so they are player-input timing; the host's
  stepping is pinned by `frameLoop.test.ts` and the engine's on a real save.
- Reducing the per-step unit scans (`crowd.spawn`, `elevators.accumulate`),
  which the profile shows dominate sim cost. Tracked in the backlog as
  `sim-step-unit-scans` (#846).

## Review record

`/gds-code-review` (Blind Hunter, Edge Case Hunter, Acceptance Auditor) ran
seven rounds, the last with no blocking Acceptance Auditor finding and only
low-severity repeats of earlier dismissals from the other two layers. Patched along the way: pause and splash spending carried time; the
step budget ignoring the pacing curve; banked time replaying after a speed or
steady-clock change (now dropped by the engine's `syncStepMode`); steps re-owed
after a throw; host-chosen step size; input guards; and the rounding that left
empty 60 Hz frames (the step now rounds down). Deferred: motion cadence on
high-refresh displays (backlog `sim-step-high-refresh-cadence`, #845). Also
filed: the per-step scan cost (`sim-step-unit-scans`, #846). A step is capped
at 20 minutes so it always fits under the host's 30-minute catch-up cap.

PR review (Codex) added two fixes: the pure fixed-step guards now also live in
the unit tier (`src/engine/sim/fixedStep.test.ts`, with a chunking check on a
fake host), and a speed or steady-clock change now drops the carry where the
player makes it (`applySpeed`, `toggleSteadyClock`), so a change undone before
the next frame no longer replays the old carry. A later Codex pass found that
the `Math.max(0, ...)` after a step taken within the tolerance threw away the
forgiven shortfall, so two near-quantum frames could step twice where the same
minutes in one frame stepped once. The shortfall now stays owed (a debt at most the
tolerance below 0) and the next frame pays it back, pinned by a unit test.
