---
title: 'Count every rider aboard in the elevator demand ring and utilization (#2397)'
type: 'bugfix'
created: '2026-11-17'
status: 'in-review'
baseline_commit: '513bbeb'
context:
  - '{project-root}/docs/performance/hot-path-review.md'
---

<frozen-after-approval reason="human-owned intent: do not modify unless human renegotiates">

## Intent

**Problem:** `sample_elevator_util` (`engine-rs/src/telemetry.rs`) reads each car's `car_load` plus the commuters riding the shaft. `car_load` is the dispatch's notional load: the waiting estimate's seats plus some crowd callers (Standard Floor Departure newcomers, a staff car's hall callers), so visitors, residents, hotel guests and staff riding as people are mostly missing and a few are counted twice. The demand ring, the utilization ("Avg load: N% full"), the schedule dialog's car advice and Auto-tune all read numbers that are too low.

**Approach:** The dispatch keeps, beside `car_load`, each car's estimate seats (the part of `car_load` that came from the waiting estimate). The sampler reads estimate seats plus the crowd's own riders per car (`Crowd::car_riders`), so every rider aboard counts once. `car_load` and every dispatch decision stay exactly as they are.

## Boundaries & Constraints

**Always:** all logic in the Rust engine; the dispatch's fill, leave and boarding behavior unchanged (`car_load` untouched); estimate seats saved with the cars' other mid-stop timers in the `dispatch` save object, so a reloaded tower samples what the unbroken game would; a save without them loads (estimate seats start as the passenger cars' `car_load`, a staff car's at zero); no added per-step scan; American English, no em-dashes, files under 500 lines.

**Ask First:** moving the conformance lock (`expected.json`) or a save version; any change that makes a measured path slower.

**Never:** change `car_load` arithmetic or the dispatch's room math; count a crowd rider from `car_load`; add a guard test; hand-merge generated files.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Venue crowd fills a car | Modern shaft, no estimate seats, crowd riders aboard filling a car | hourly ring and utilization read the crowd's share (full car reads 1.0) | N/A |
| Estimate riders only | Classic condo residents boarded by the estimate | ring reads the estimate seats, as today | N/A |
| Crowd newcomers at a dwelling car | `arrivals` boards estimate and crowd newcomers | estimate seats grow by the estimate part only; the newcomers count once, as crowd riders | N/A |
| Staff car | service car carrying staff | estimate seats stay 0; ring reads the staff aboard once | N/A |
| Car parks or is stood down empty | `car_load` reset to 0 | estimate seats reset to 0 | N/A |
| Arrival unloads 45% | `car_load` decays at a stop | estimate seats keep their share of `car_load` | never above `car_load`, never negative |
| Car count changes | shaft gains or loses cars | estimate seats resized like `car_load` (kept cars keep theirs, new ones 0) | N/A |
| Old save | `dispatch` cars carry no estimate list | loads; estimate seats start from `car_load` (passenger) or 0 (staff) | malformed list skipped like the other lists |

</frozen-after-approval>

## Code Map

- `engine-rs/src/dispatch.rs` -- `ElevatorDispatch`: per-car transient vectors (`car_dwell`, `car_seen`, `car_held`) and `move_cars`, every `car_load` write.
- `engine-rs/src/dispatch_cars.rs` (new) -- one per-shaft record `Cars { seen, held, seats }` replacing `car_seen` and `car_held`, plus `riders_aboard`.
- `engine-rs/src/dispatch_classic.rs` -- `Boarding::board` / `arrivals`: what boards, split between estimate and crowd.
- `engine-rs/src/dispatch_save.rs` -- the `dispatch` save object (excluded from the state hash, `snapshot.rs`).
- `engine-rs/src/telemetry.rs` -- `sample_elevator_util`, the reader to fix (hourly).
- `engine-rs/src/crowd/mod.rs`, `crowd/motion.rs` -- `car_riders`, the crowd's riders per car.
- `engine-rs/src/rule_tests/` -- rule tests for the ring.
- `help-site/src/content/docs/building/elevators.mdx` -- Modern schedule paragraph (what Auto-tune measures).

## Tasks & Acceptance

**Execution:**
- [x] `engine-rs/src/dispatch_classic.rs` -- `arrivals` returns the estimate part and the total -- the caller needs the split.
- [x] `engine-rs/src/dispatch.rs` (+ a small sibling module if the file nears 500 lines) -- add `car_estimate` per shaft, pruned and sized with the others; mirror every `car_load` write (board, arrivals, decay share, resets); expose `estimate_seats(shaft)` for the sampler.
- [x] `engine-rs/src/dispatch_save.rs` -- write `estimate` per car; restore it when present and well formed.
- [x] `engine-rs/src/telemetry.rs` -- load = estimate seats + `car_riders` per car; drop the per-hour scan of every person for commuters.
- [x] `engine-rs/src/rule_tests/` -- rule tests for every matrix row, including a venue crowd filling a shaft and the ring reading it, and a save round trip.
- [x] `help-site/.../elevators.mdx`, `.changes/<branch>.md` -- say what the busy numbers count; patch note.

**Acceptance Criteria:**
- Given a Modern shaft whose car a venue crowd fills, when the hour samples, then the hourly ring and utilization read the car as full.
- Given any tower, when the change runs, then `conformance/expected.json` is unchanged (the dispatch's moves are identical).
- Given a save made mid-ride, when it reloads, then the next sample equals the unbroken game's.

## Spec Change Log

- 2026-11-17, perf review (callgrind, author's lean pass): a separate seats map cost one more BTreeMap lookup per shaft per motion chunk and one more retain per step, measured +0.2 to +0.7% Ir per tick. Amended: the seats live in one per-shaft record with `seen` and `held` (`dispatch_cars.rs`), so a step looks a shaft up twice where main did three times. KEEP: `car_load` arithmetic untouched; seats keep their share on unload; the meter clamps seats to the car's load.

## Design Notes

Estimate seats keep their share of `car_load` when 45% leave at a stop (`e' = e * l'/l`), so they never exceed `car_load` and need no rounding rule of their own. The crowd's riders already leave their seats in `release_seat`, so the crowd side needs nothing new. Planning was approved by the owner's "plan and execute properly" (2026-11-17), so Checkpoint 1 is recorded here rather than halting.

## Verification

**Commands:**
- `cd engine-rs && cargo test --lib` -- all pass
- `cd engine-rs && cargo fmt --check && cargo clippy --all-targets -- -D warnings` -- clean
- `npm run typecheck && npm run lint && npm test && npm run build` -- green; conformance integration unchanged
