# Story: Daily Auto-tune for elevator schedules (Modern)

Status: ready-for-dev

Plan sources: owner ask (Naftali, 2026-11-17: "Shouldn't it auto tune
though?", then "Yes" to a per-shaft Auto checkbox), the Engine Room party
`_bmad-output/party-mode/elevator-daily-auto-tune-party-findings-2026-11-17.md`,
and the elevator-scheduling design
(`_bmad-output/planning-artifacts/design/gdd-elevator-scheduling-2026-07-16.md`
section 4.4, "optional per-shaft auto-tune"). Stacks on PR #2415 (walk-aware
routing, `in_service_frac`, `twin_load`), which this story reuses and does not
duplicate.

## Story

As a Modern player with a growing tower,
I want an elevator's schedule to re-tune itself every morning from the
traffic it measured,
so that a schedule tuned once does not go stale and starve a shaft as the
tower changes.

## Acceptance Criteria

1. **Flag.** A Modern elevator's schedule carries an Auto flag
   (`Schedule.auto_tune`, `autoTune` in the save, the port and the TS
   `ElevatorSchedule`). A Modern elevator built from this version on starts
   with Auto on (owner, 2026-11-17, decision card); a Classic elevator never
   does, and a shaft loaded from an older save keeps Auto off. A schedule
   with Auto on and no rows is kept (it is not coerced to none).
2. **Morning pass.** In the 05:00 hourly pass of every game day, in Modern
   only (`GameMode::schedule_assist`), each elevator with Auto on and at least
   one car has its weekday and weekend active-car rows set from the engine's
   Auto-tune proposal (`Simulation::auto_tune_proposal`, the same answer the
   button applies, including #2415's twin load). A day type that is not warm
   keeps its row. Staging homes, Standard Floor Departure and Waiting Car
   Response are never changed by the pass. The pass clears `heldBack` for the
   rows it writes. It draws no rng and emits no log line.
3. **Hand-set schedules untouched.** A shaft with Auto off is never changed by
   the pass. Because new Modern elevators start with Auto on, Modern
   conformance hashes and goldens that build an elevator and run past 05:00
   move in this PR; each moved hash is explained in the PR, and a Modern run
   whose shafts all have Auto off is byte-identical to today.
4. **Classic unchanged.** No checkbox, no pass, no change in any Classic
   golden or hash. A flag on a Classic tower (only reachable by a hand-edited
   save) does nothing.
5. **Dialog.** The Modern schedule dialog shows an "Auto" checkbox beside
   Auto-tune. Checking it fills the rows from the proposal immediately (homes
   seeded only when the player has none, as the button does) and locks the
   hour grid and presets; the Auto-tune button hides while Auto is on. A line
   explains: Auto re-tunes the car counts every morning at 5 AM from measured
   traffic; uncheck Auto to set them by hand. With no warm day, it says Auto
   starts once the shaft has measured a day of traffic. Unchecking keeps the
   current rows as hand-set rows. OK applies the flag and rows as one schedule
   edit (one undo step). Express and service elevators behave the same as
   standard ones wherever the button is offered.
6. **Save compatibility.** `autoTune: true` is written only when on. Every old
   save (real `.vctower` files from earlier versions) loads with Auto off and
   re-serializes byte-identical. A save with any shaft on Auto is stamped
   version 12; a save without keeps the version it is stamped with today.
   `SAVE_VERSION` becomes 12. Round trip: save with Auto on, load, Auto still
   on, rows identical.
7. **Undo.** A morning re-tune does not make older undo steps on that shaft
   refuse: `Transport::config_eq` compares schedules with the Auto-owned rows
   masked when both sides have Auto on. The pass opens no undo journal.
8. **Determinism.** Saving at 04:59, loading and running past 05:00 gives the
   same state as the uninterrupted run.
9. **Stability (pre-registered).** On a steady Modern fixture with Auto on,
   over 21 game days, no hour of either row changes more than once in the last
   7 days. If this fails, stop and report before adding any deadband.
10. **Analytics.** OK that changes the flag sends `app_action`
    `elevator_auto_tune` with `detail` `on` or `off`; the data map and the
    PostHog dashboard gain it. The morning pass sends nothing.
11. **Docs.** The help page (`help-site/src/content/docs/building/elevators.mdx`)
    describes Auto in the manual's style; the engine guides note the new slot
    and flag; a change note declares `app: minor`, `crate: minor`.
12. **Screenshots.** A new screenshot shard covers the dialog with Auto off,
    Auto on (warm), Auto on (waiting for data), and Classic (no checkbox).
13. **Performance.** Nothing new runs per tick or per frame. The pass is once
    per game day per Auto shaft; the hot-path record (section 6 of
    `docs/performance/hot-path-review.md`) goes on the PR.

## Tasks / Subtasks

- [ ] Engine flag (AC 1, 6)
  - [ ] `Schedule.auto_tune: bool` in `engine-rs/src/schedule.rs`: `coerce`
        reads `autoTune === true`, `to_json` writes it only when true,
        `is_empty` counts it. Update every `Schedule { .. }` literal.
  - [ ] Port slot: `SCHEDULE_LEN` + 1 in `engine-rs/src/wasm_port_life.rs`
        (`schedule_json` / `schedule_slots`), `VIEW_LAYOUT_VERSION` + 1, pin
        tests updated; `src/simport/scheduleSlots.ts` and
        `src/shared/engineTypes.ts` to match; `engine.d.ts` comment.
- [ ] Save version (AC 6): `AUTO_TUNE_SAVE_VERSION = 12`, stamped by
      `written_save_version` / `save_fields` when any shaft has Auto on;
      identity, compat record, `npm run engine:compat`.
- [ ] New Modern elevators start with Auto on (AC 1): set at build in the
      Modern build path only; Classic and loaded shafts untouched.
- [ ] Morning pass (AC 2, 3, 4, 8): a `retune_auto_schedules` step in
      `on_hour` at hour 5, gated on `schedule_assist`; it builds the proposal
      per Auto shaft (draft = the current schedule) and writes rows only. New
      file if `sim_loop.rs` or `schedule_authoring.rs` would pass 500 lines.
- [ ] Undo mask (AC 7): `config_eq` in `engine-rs/src/tower/undoing.rs`.
- [ ] Rust tests: flag coerce/serialize, empty-but-Auto kept, pass writes rows
      and leaves homes/timings, cold day kept, Auto off untouched, Classic
      inert, heldBack cleared, save version stamping, round trip, 04:59
      save/load determinism, undo survives the pass, 21-day stability.
- [ ] Real old saves (AC 6): load the project's older `.vctower` fixtures
      (the maxed towers), assert Auto off and byte-identical re-save.
- [ ] Dialog (AC 5): `src/ui/templates/elevatorSchedule.ts`,
      `src/ui/uiElevatorSchedule.ts`; unit tests with mocked engine port;
      an integration test against the real engine.
- [ ] Analytics (AC 10): `AppActionName` gains `elevator_auto_tune`, the data
      map, dashboard tile.
- [ ] Help page, engine guides, change note (AC 11).
- [ ] Screenshot shard (AC 12) rendered in the pinned container.
- [ ] Quality gates, `/gds-code-review` (engine) plus the UI layer, HP record.

## Dev Notes

### Current state (read before changing)

- `engine-rs/src/schedule_authoring.rs`: `auto_tune_proposal(id, draft,
  weekend_view)` is read-only. With a warm day it returns `tuned_row` from the
  ring (on #2415, from `twin_load`); a cold day keeps the draft's row; homes
  are seeded only when the draft has none (`homes_seeded`). The morning pass
  passes the current schedule as the draft, so hand-staged or previously seeded
  homes are kept, and writes only `weekday` / `weekend`.
- `engine-rs/src/schedule.rs`: `Schedule::coerce` drops an empty schedule to
  `None`; `refit` handles car sales and `heldBack` (#1546).
- `engine-rs/src/tower/transports.rs::set_schedule`: the dialog's OK path;
  homes snap to stops only when they changed (#1557). Keep that.
- `engine-rs/src/sim_loop.rs::on_hour`: hour-gated steps already live here
  (checkout at 8, morning venue roll-over). `sample_elevator_util` runs at the
  end of each pass; run the re-tune before it so the 05:00 sample reads the
  new rows only from the next hour on.
- `engine-rs/src/tower/undoing.rs::config_eq` compares `schedule` whole.
- `engine-rs/src/sim.rs`: `stamped_save_version` and the version history
  comment; extend it, do not reorder it.
- Telemetry rings are EMAs (weight 0.3), so "the last day's traffic" is a
  recency-weighted measure, which damps the daily loop (party, Anika).

### Must preserve

- The one-time Auto-tune button and its announcements for hand-set schedules.
- Classic goldens, conformance hashes with Auto off, TDT (Classic only).
- Undo semantics for every other shaft edit.

### Project Context Rules

- Rust is authoritative; the UI shows the engine's answers. No TS duplicate of
  the tuning rule.
- Unit tests mock the engine port; real-engine checks are integration or Rust
  tests. No guard or config tests.
- 500-line file ceiling (Rust included), American English, no em-dashes.
- Named flags, not bit math, for the new slot.
- Change note: `app: minor`, `crate: minor`, engine guides or `readmes:` line.
- Every PR updates help pages and analytics in the same PR (owner).
- Save changes are release blockers until proven with real old saves.

### References

- [Source: engine-rs/src/schedule_authoring.rs]
- [Source: engine-rs/src/schedule.rs]
- [Source: engine-rs/src/wasm_port_life.rs#schedule_json]
- [Source: engine-rs/src/sim.rs#SAVE_VERSION]
- [Source: engine-rs/src/tower/undoing.rs#config_eq]
- [Source: src/ui/uiElevatorSchedule.ts]
- [Source: _bmad-output/party-mode/elevator-daily-auto-tune-party-findings-2026-11-17.md]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed: comprehensive developer guide
  created.
- Built on #2415 at d7337fc. Its first saturated-hour reading made a daily
  rerun swing an hour by one car; its second round (`cars_for`) proposes rows
  with room, so the pass settles. A regression over every load pins it
  (findings, second amendment, item 14).
- AC9's pre-registered test passes with no deadband.

### File List
