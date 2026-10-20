---
story: facade-6d-command-gaps
status: in-progress
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
| Placement dry run | `tower.placeTransportDryRun(kind, x, bottom, top)` | no export |
| Shaft validation | `tower.validateTransport(kind, x, bottom, top)`: `{ ok }` or `{ ok: false, reason }` | no export |

The last two are on every transport drag move (`buildPreview`, `engineWiring`,
`keyboardPlay`), so they are per-pointer-move work (HP-1, HP-2).

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
5. **AC5** Each answer equals the TypeScript's in a differential test over the
   conformance towers (both modes, bridging on and off where the mode allows,
   money flush, short and exactly at a price), plus malformed inputs.
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
- `buildTransport` and `build` raw whole-number argument reads: both stay `i32`
  like their siblings (`canBuild`); the gap is recorded as a backlog row.
- The TypeScript wording of any refusal stays where it is.

## Tasks

- [ ] `engine-rs/src/wasm_facade_commands.rs` (new): the checked bodies and the
      JSON shapes, with native tests (AC1 to AC4, AC6).
- [ ] `engine-rs/src/wasm.rs`: the three new exports in one appended
      `#[wasm_bindgen] impl Engine` block; the unknown-kind refusal in `build`,
      `buildTransport` and `applyRentBatch`; `callExterminator` carries the
      fields.
- [ ] TypeScript: `buildTransport` and `validateTransport` refuse an unknown
      kind; `validateTransport` refuses a non-whole argument (AC3, AC4).
- [ ] `src/dualrun/binding.ts` and `exportTiers.ts` list the new exports;
      `engine.d.ts` regenerated.
- [ ] `src/tests/integration/conformanceWasmFacadeCommands.integration.test.ts`:
      the differential test (AC5).
- [ ] Crate bump, `npm run engine:compat`, CHANGELOG-free (nothing a player sees).
- [ ] `/gds-code-review`, the HP-1..HP-12 record, the independent review.

## Dev notes

- **Where.** The engine already has every rule: `Simulation::call_exterminator`
  returns `Ok((cost, rooms))` and `Err(Funds { cost, rooms })`;
  `Simulation::compute_batch(.., mutate = false)` is the preview;
  `Tower::validate_transport` is the shaft check. The slice is the binding
  shape and the unknown-kind and malformed-argument edges.
- **File layout.** `wasm.rs` is on the file-size ratchet, so the logic lives in
  a child module like `wasm_relay.rs`; `wasm.rs` gets only the thin wrappers,
  appended in one block at the end (the parallel map's rule).
- **Hot path.** `validateTransport` and `placeTransportDryRun` run per pointer
  move while a shaft is dragged. The work is O(span x shafts), plus one scan
  of the units for an escalator on a floor with an office (inherited from the
  TypeScript, which does the same scan). Recorded in the HP table; measured
  against the 16 ms frame budget at the large tower fixture.
- **Rules to keep.** No em-dashes, American English, Rust files under 500
  lines, `cargo fmt` and `clippy -D warnings`. Never a closing keyword before
  #868 or #954.

## Dev Agent Record

### Completion Notes List

### File List
