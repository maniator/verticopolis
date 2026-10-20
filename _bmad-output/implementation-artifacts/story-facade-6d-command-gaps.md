---
story: facade-6d-command-gaps
status: review
issue: 1216
---

# Story: the engine answers the command gaps #868 lists (facade slice 6d, #1216)

Slice 6d of the Rust-backed facade (tracking issue #1207; plan in #1184,
`slice-plan.md`). It names #868 and #954 by reference only.

## Why

Under AD-9 the healthy WASM path holds no TypeScript `Simulation`, so every
answer a player command or a build preview reads has to come from the engine.
The 2026-10-09 port audit found six places where the binding answers less than
the TypeScript instance does today. The slice 2 commands and the slice 4
previews (`RustSim`, slice 7) cannot go Rust-first until these exist.

## The gaps, measured against the TypeScript

| Gap | TypeScript today | Binding today |
| --- | --- | --- |
| Exterminator booking | `{ ok, cost, rooms }`; a funds refusal is `{ ok: false, reason: "funds", cost, rooms }` | `{ ok, reason? }` |
| Rent batch preview | `previewRentBatch(kind, target, opts)`: the `BatchRentResult` the apply would give, nothing written; `null` for an unpriced kind or a target that does not apply | no export |
| Unknown facility kind | `build` and `canBuild` answer `{ ok: false, reason: "Unknown facility." }`; `previewRentBatch` and `applyRentBatch` answer `null` | `build`, `buildTransport` and `applyRentBatch` throw |
| Unknown kind on a shaft | `buildTransport` and `validateTransport` throw a `TypeError` (they index the catalog) | `buildTransport` throws |
| Express stops | `tower.setExpressStops(id)` answers `false` for an id that names no shaft | `setExpressStops(id): void` (asked for by the slice 1 review, #1216) |
| Placement dry run | `tower.placeTransportDryRun(kind, x, bottom, top)` | no export |
| Shaft validation | `tower.validateTransport(kind, x, bottom, top)`: `{ ok }` or `{ ok: false, reason }` | no export |

`placeTransportDryRun` runs on every transport drag move, stairs and escalator
hover and keyboard cursor move (`buildPreview`, `engineWiring`, `keyboardPlay`),
so it is per-frame work (HP-1, HP-2). `validateTransport` is read per build
(`buildActions.transportReason`).

## Acceptance criteria

1. **AC1** `callExterminator` carries `cost` and `rooms` exactly where the
   TypeScript does: on success, and on the `funds` refusal. The other refusals
   (`unavailable`, `pending`, `none`) carry only `reason`, as in TypeScript.
2. **AC2** `previewRentBatch(kind, target, onlyDefaultPriced)` returns the
   TypeScript `BatchRentResult` for the same tower, writes nothing (the save
   text is byte-identical afterwards), and gives the counters a following
   `applyRentBatch` reports. An unpriced kind, a No Rate target off the
   ladder, and a target that is not `"default"`, `"noRate"` or a finite number
   answer `null`.
3. **AC3** An unknown facility kind is refused with a reason, never thrown:
   `build` and `buildTransport` answer `{ ok: false, reason: "Unknown facility." }`;
   `previewRentBatch` and `applyRentBatch` answer `null`. The TypeScript
   `buildTransport` and `validateTransport` refuse the same way, so the two
   engines agree (they threw before).
4. **AC4** `placeTransportDryRun` and `validateTransport` export the engine's
   shaft validation. Arguments are read raw (#923, #996): a coordinate that is
   not a whole JS number within `Number.isSafeInteger` is refused with
   `INVALID_REQUEST`, in both engines.
5. **AC5** Each answer equals the TypeScript's in a differential test over new
   games and conformance towers in both modes (none of these answers reads the
   bridging setting, so it is not a test axis), with the exterminator at, below
   and above its price, plus malformed inputs: a non-string kind, a flag that is
   not a boolean, coordinates that are not whole numbers or sit at the edge of
   the safe range.
6. **AC6** No simulation hash moves. The conformance lock is unchanged, the
   dual run and the parity projects stay green, and the new exports mutate
   nothing (`previewRentBatch`, `placeTransportDryRun`, `validateTransport`).
7. **AC7** The crate takes one minor bump with `npm run engine:compat`; the
   binding declaration `src/dualrun/engine.d.ts` is regenerated, not edited.

## Out of scope

- `SimPort`, `Command` and `CommandResult` types and the `TsSim` adapter:
  slices 1 and 2 (this slice only has to match what they will read).
- `isUnlocked` through the port (derivable from the catalog's star gates and
  the star; slice 4's panel getter family).
- `build` and `buildTransport` floor and column reads: both stay `i32` like
  `canBuild`; the row `relayed-command-input-trust-rest` (#1021) carries it.
- The cap check's all-units walks inside `validateTransport` (hot-path finding,
  deferred to #1239; see Review).
- The TypeScript wording of any refusal stays where it is.

## Tasks

- [x] `engine-rs/src/wasm_facade_commands.rs` (new): the checked bodies and the
      JSON shapes, with native tests (AC1 to AC4, AC6).
- [x] `engine-rs/src/wasm.rs`: the three new exports in one appended
      `#[wasm_bindgen] impl Engine` block; the unknown-kind refusal in `build`,
      `buildTransport` and `applyRentBatch`; `callExterminator` carries the
      fields.
- [x] TypeScript: `buildTransport` and `validateTransport` refuse an unknown
      kind; `validateTransport` refuses a non-whole argument (AC3, AC4).
- [x] `src/dualrun/binding.ts` and `exportTiers.ts` list the new exports;
      `engine.d.ts` regenerated.
- [x] `src/tests/integration/conformanceWasmFacadeCommands.integration.test.ts`:
      the differential test (AC5).
- [x] Crate bump, `npm run engine:compat`, CHANGELOG-free (nothing a player sees).
- [x] `/gds-code-review` and the HP-1..HP-12 record (below).
- [ ] The independent review.

## Dev notes

- **Where.** The engine already has every rule: `Simulation::call_exterminator`
  returns `Ok((cost, rooms))` and `Err(Funds { cost, rooms })`;
  `Simulation::compute_batch(.., mutate = false)` is the preview;
  `Tower::validate_transport` is the shaft check. The slice is the binding
  shape and the unknown-kind and malformed-argument edges.
- **File layout.** `wasm.rs` is on the file-size ratchet, so the logic lives in
  a child module like `wasm_relay.rs`; `wasm.rs` gets only the thin wrappers,
  appended in one block at the end (the parallel map's rule).
- **Hot path.** `placeTransportDryRun` runs per pointer move while a shaft is
  dragged. The shaft loop is O(span x shafts), but `cap_reason` walks every unit
  once per kind in the pool first (3 times for an elevator), and a Classic
  escalator scans the units twice more. Inherited from the TypeScript, which
  does the same. See the HP record and #1239.
- **What it removes.** Nothing temporary. The new exports are what slice 7's
  `RustSim` reads; the mirror keeps calling the old ones.
- **Rules to keep.** No em-dashes, American English, Rust files under 500
  lines, `cargo fmt` and `clippy -D warnings`. Never a closing keyword before
  #868 or #954.

## Dev Agent Record

### Completion Notes List

- Added `previewRentBatch`, `validateTransport`, `placeTransportDryRun`; `callExterminator` carries `cost` and `rooms`; `setExpressStops` returns whether the id names a shaft (asked for by the slice 1 review). Unknown kinds, and kinds that are not strings, are refused in `build`, `buildTransport`, `applyRentBatch` and the new calls. The flag of `applyRentBatch` and `previewRentBatch` is read by truthiness, as TypeScript reads it.
- TypeScript agreed at the source: `Tower.validateTransport` and `buildTransport` refuse an unknown kind, `validateTransport` refuses a non-whole coordinate, `computeBatch` treats a name outside the catalog as unpriced (`"constructor"` used to crash it), `shadow.ts` relays a target JSON cannot write as `null`.
- `compute_batch` now visits the room list instead of every unit (hash-preserving, the preview and the apply share it).
- Crate 0.3.0 to 0.4.0, `compat-record.json` re-recorded; conformance lock unchanged.
- `/gds-code-review` ran (Blind Hunter, Edge Case Hunter, Acceptance Auditor, Hot-Path Auditor). Fixed: non-string kind and non-boolean flag at the binding, the relay target, the preview walk, test strength, docs. Deferred: the cap check and escalator office scans (#1239).

### Hot-path record (HP-1..HP-12)

Cloud estimates only, no desktop evidence. Sizes: large tower U 43,358, R 2,900, T 5; owner's save U 19,806, R 1,699, T 64.

| Item | Result | What was checked | Findings and resolution |
| --- | --- | --- | --- |
| HP-1 | finding (F1, F2) | `Engine::place_transport_dry_run` / `validate_transport` to `Tower::validate_transport` to `cap_reason` to `count_kind`, then the escalator office scan and the per-floor loop; TypeScript twins live today from `onActionMove`, `updateBuildPreview`, `refreshCursorPreview` (per frame), `transportReason` (per build); `preview_rent_batch` from the batch pricing `recompute` (per input event); `call_exterminator` per confirm | F1, F2 deferred to #1239; the rest per command |
| HP-2 | finding (F1, F2, F3) | F1: `count_kind` x3 (elevator) or x2 (stairs, escalator) over every unit and shaft per move, about 130,000 visits on the large tower, 440 to 460 us Rust and 560 to 600 us TypeScript (cloud). F2: Classic escalator office scan, two more walks, +200 us Rust, +410 us TypeScript. F3: `compute_batch` walked all units for one priced room kind. F4: span x shafts loop, at most 9,680 compares, accepted | F1, F2 deferred (#1239); F3 fixed (room list); F4 accepted |
| HP-3 | clear | `outcome()` builds one `json!` per `validateTransport` (per build); `placeTransportDryRun` returns a bool, 0.4 to 0.6 us; a refused call allocates one reason string | none |
| HP-4 | clear | no sort in the shaft check, `compute_batch`, `call_exterminator` or the JSON builders | none |
| HP-5 | clear | no new map or set; `structure` probes at most 110 per move; `Kind::parse` scans 37 entries per call | none |
| HP-6 | clear | no id scans; `setExpressStops` uses `get_transport` | none |
| HP-7 | finding (F1, F2, F3) | inherited algorithms exposed at a new route: the cap and office walks, the all-units rent walk | as HP-2 |
| HP-8 | clear | TypeScript has no cache for `countKind` or the office scan; `computeBatch` and `callExterminator` walk uncached there too; nothing dropped in the port | none |
| HP-9 | finding | F1: per-kind count index keyed on revision and counts; F2: `room_units()` or a per-floor office flag; F3: room list | #1239 for F1, F2 |
| HP-10 | clear | the diff adds no cache; previews write nothing (save text identical, no events, no revision bump); `validate_transport` takes `&self`; conformance lock unchanged; F3 preview equals apply in the differential | none |
| HP-11 | clear | arguments cross as `JsValue` read with `as_f64`, 3 imports per call, under 1 us; strings and JSON per call, never per unit | none |
| HP-12 | finding (F1, F2) | build preview on every pointer move walks all units in both engines | #1239 |

### File List
