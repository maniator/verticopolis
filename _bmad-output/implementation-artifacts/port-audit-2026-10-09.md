# Port audit: `src/engine/` against `engine-rs/src/` (2026-10-09)

Seven read-only auditors, one per subsystem, read every exported symbol of
the TypeScript engine and its Rust counterpart side by side and judged, for
each, whether it is ported exactly, differs, is missing, or is UI-only and
not the engine's to port; and whether a conformance scenario or a loader
case reaches it. Slices: static data and rules; tower, placement, transports
and schedules; the command surface, building and pricing; the crowd and
dispatch; the tick loop and the per-step, hourly and daily systems; the
economy, housekeeping, ledger and events; serialization, migration,
coercion, loading, the container and the clock.

## The verdict

No difference that moves a conformance hash was found in any tick-time or
command path on any save an engine writes. Every constant, table entry,
rng draw (order and count), rounding and branch order read as the same.
The differences fall into four groups.

### Fixed with the audit (this PR)

| Finding | Where | Fix |
| --- | --- | --- |
| A fractional position over a structural gap: the TypeScript gives it its own fractional segment id, the Rust one sentinel, so two different off-run positions compared equal in the BFS shortcut. | `crowd/routing.rs` | `off_run_pair` decides the route the way the fractional ids would: the same position routes to itself, a different one has no route. Unit test beside it. |
| `events` of a truthy non-object (a number, a string, an array) resets the event state in the TypeScript (`loadState` runs for anything truthy); the Rust skipped it and kept the seed-derived rng. | `load.rs` | Loads it as an empty object; `0` and `""` still skip. Loader cases `events-number`, `events-zero`, `events-array`. |
| A fractional `lastSantaYear` was truncated (3.5 became 3 and blocked Santa for year 3). | `events.rs`, `load.rs` | Kept as a float; loader case `events-santa-fractional`. |
| Fractional blockbuster ids were truncated and merged. | `sim.rs`, `economy.rs`, `sim_loop.rs`, `load.rs` | Kept as floats (a fraction matches no cinema, as in the TypeScript); loader case `blockbusters-fractional`. |
| A fractional `vipVisitDay` was truncated (-0.5 became 0 and the inspection fired). | `sim.rs`, `services.rs`, `build.rs`, `load.rs` | Kept as a float; loader case `vip-visit-day-fractional`. |
| `canBuild` with a transport kind took the room branch and refused with "Not a room." instead of the placement refusal. | `build.rs` | The structural branch, as `!isRoomKind` does. Unit test beside it. |
| `detectFounder`'s `parseInt` trimmed Rust whitespace instead of the JavaScript set (the byte order mark). | `load.rs` | `js_trim`; unit test. |
| `set_label` trimmed with Rust's whitespace set. | `tower.rs` | `js_trim`; the mirror sends the label as stored. |

### Deferred to the backlog

- **#867 `engine-rs-host-step-driver`:** the engine-owned fixed step and
  `paceFactor`, and `sampleElevatorUtil` with the dispatcher's boarding
  tally. Nothing hashed, needed once a Rust host drives the engine itself.
- **#868 `engine-rs-binding-read-model`:** what the binding does not expose
  that the web UI calls (`canBuild`, `isUnlocked`, `previewRentBatch`, the
  full exterminator result, the read model). The switch story's checklist.
- **#869 `conformance-audit-unreached-branches`:** ported branches no
  scenario or loader case reaches (a Modern quarter, a rental payout, a
  thief's loss, rain over a metro, the wedding hall and the TOWER inspection,
  an Aquatic Center, and the loader coercions the table's base saves cannot
  reach).
- **#858 `engine-rs-hand-edited-save-fidelity` (extended):** the raw-value
  semantics the Rust loader types away on forged saves (`evaluatedTower`,
  `vipFavorable`, `builtWeddingHall`, `towerName`, `carDir`, the transport
  `load` field and unknown transport keys, `lastVipNagDay` beyond i64, the
  legacy condo backfill on a non-string state, v1 reflow with non-number
  geometry, a top-level `null` save, the clock beyond 1.3e22 minutes).
- **Prose (the copy-catalog story):** every log line and pending message
  the Rust writes without thousands separators or with shorter text (the
  treasure, the ransom and rescue lines, rent and checkout lines, the
  notices' per-cause tally, the fire-rescue offer). The hash strips prose;
  `story-engine-copy-catalog` replaces it with ids on both engines.

### Not the engine's to port

About seventy symbols the UI, the renderer, the TDT exporter or the tests
read and the tick never does: facility colors and descriptions, the editor's
car and extend prices, the heatmap and traffic tiers, the queue view, the
congestion readouts, the schedule authoring and origin rings, the
housekeeping report, the ledger averages, the cosmetic trigger counters, the
undo history, the v1 simulation model the tests keep. Each is listed in the
slice reports with its caller.

### Unreachable edges

NaN handling (`Math.max`/`Math.min` keep NaN, Rust `min`/`max` drop it) in
`demandFactor`, the daycare bonus, the fire satisfaction drain, the
satisfaction clamp and the car-position clamp; the clockless `moveCars`
branch; out-of-range car indexes. No JSON save and no command produces the
input, so these stay as they are, noted here.

## Counts

| Slice | Ported exactly | Differs | Missing (engine-needed) | UI-only |
| --- | --- | --- | --- | --- |
| Static data and rules | 160 | 2 (NaN only) | 0 | 7 |
| Tower and transports | 65 | 4 (one fixed, three edge) | 0 | 8 |
| Commands, build, rent | 29 | 7 (prose, one fixed) | 0 | 17 |
| Crowd and dispatch | 52 | 4 (edges) | 0 (tally deferred) | 5 |
| Loop and systems | 55 | 6 (prose) | 2 (deferred, host-facing) | 11 |
| Economy and events | 47 | 10 (prose, 3 fixed) | 0 | 6 |
| Serialization and load | 36 | 22 (5 fixed, rest to #858) | 0 | 4 |
