# Story: charge-command input trust (#923)

Status: review

## Story

As the owner of a second frontend, I want the engine-owned charge commands to
refuse malformed arguments the same way in both engines, so that a bad call
never moves money or the tower, and a relayed bad call never splits the
engines.

## Acceptance criteria (from #923 and its comments)

1. A charge command (`addCar`, `removeCar`, `extendTransport`,
   `removeFacility`) with an id, floor or mark that is not a whole number, or
   an unknown `end` or `method`, is refused before anything moves, with one
   shared reason, in both engines.
2. The WASM binding refuses the same inputs instead of truncating them to
   `i32` or throwing, so the dual-run shadow stays in step.
3. The dual-run mirror passes the mark through the same way as its other
   fields.
4. A mark narrower than the shaft cannot bill a standing floor again (the
   Edge Case Hunter case from #929).
5. The relay-only ops `towerSetCars` and `towerResizeTransport` (#906) are
   confined to the relay.
6. The engine-held gesture mark is considered.

## What landed

- **Both engines:** `INVALID_REQUEST`, `"That request is not valid."`.
  - TypeScript: `src/engine/sim/charges.ts` checks each argument with
    `Number.isSafeInteger` and the two known enums before any lookup.
  - Rust: `engine-rs/src/charges.rs` adds `whole(f64)`, the same rule.
- **WASM binding:** `addCar`, `removeCar`, `extendTransport` and
  `removeFacility` take ids and floors as `f64`. They return the refusal JSON,
  with an extension's refusal carrying the shaft's ends as they stand. Before
  this, `lift.id + 0.5` reached the engine as `lift.id`, and an unknown `end`
  or a bad mark threw.
- **Mirror:** the charge commands relay a non-number id, floor or mark field
  as NaN and a non-string `end` or `method` as an empty string, and check
  any mark but null or undefined, so the binding only ever sees values it
  refuses the way TypeScript does (round 1).
- **AC4:** already closed by #914, which widens the mark to the current span.
  A TypeScript test now pins it.
- **AC5, owner decision (2026-10-13):** the confinement stays as #950's
  `towerRelayOps.guard.test.ts`. The WASM host relays through the dual-run
  mirror in production, so the ops cannot be compiled out of the package.
- **AC6, owner decision (2026-10-13):** a fast follow-up PR, backlog row
  `engine-held-extend-mark` (#990).
- **Tests:**
  - TypeScript unit tests for every malformed input, checking that the save
    and the event buffer are unchanged.
  - A Rust binding test with NaN, fractional and unknown arguments, checking
    that the save is byte-identical and a well-formed call still lands.
  - A dual-run test that sends malformed commands through the mirror and
    checks that both engines stay in step.
- **Lock:** unchanged; no scenario sends a malformed command, and the scenario
  loader rejects one at load.

## Review Findings

### Round 1 (`/gds-code-review`: Blind Hunter, Edge Case Hunter, Acceptance Auditor)

- [x] [Review][Patch] The binding's glue coerced a non-number id or floor
  (`"5"` to 5, `null` to 0, `true` to 1) and threw or trapped on a non-string
  `end` or `method`, while TypeScript refused all of them; the mirror's `n()`
  is a cast only, so a relayed `addCar("<id>")` bought a car in Rust alone.
  All three layers found it, two by calling the built package
  [src/dualrun/mirror.ts]: the charge commands relay a non-number as NaN and
  a non-string as `""`.
- [x] [Review][Patch] A falsy, non-null mark (`0`, `""`) was refused by
  TypeScript but relayed as "no mark", so Rust billed the extension
  [src/dualrun/mirror.ts, src/dualrun/shadow.ts]: both now test `!= null`.
- [x] [Review][Patch] The dual-run test sent only numbers and strings it knew
  [dualRunEdits.integration.test.ts]: it now sends string ids and floors,
  `null`, `true`, a numeric `end` and `method`, and falsy and string marks,
  and checks the shaft did not move. It fails on the old mirror (the
  binding throws on the `null` end).
- [x] [Review][Patch] The conformance adapter still forced the charge
  arguments through its 32-bit check, which threw before the binding could
  refuse [src/tests/conformance/wasmEngine.ts]: they pass through.
- [x] [Review][Patch] `Simulation.extendTransport` did not take a `null` mark
  while the command does [src/engine/Simulation.ts].
- Dismissed (2): the dual run compares state and events, not each refusal's
  reason (state is the parity that matters, and a refusal moves nothing); the
  backlog row is marked done before the merge, with "closes #923 on merge"
  (the house style for a row a PR finishes; the Auditor confirmed it).

### Round 2 (confirming pass)

- [x] [Review][Patch] The rebase's backlog merge wrote the
  `charge-command-input-trust` done row twice and dropped the
  `engine-held-extend-mark` (#990) row the story and issue #990 point to
  (Blind Hunter and Acceptance Auditor) [backlog.md]: the second copy is now
  the open #990 row.
- [x] [Review][Patch] `extendTransport` read a caller's mark twice, so a
  getter answering 1 and then 0.5 passed the check and billed half a floor
  (Edge Case Hunter) [src/engine/sim/charges.ts]: the mark is copied once and
  only the copy is checked and used; a test counts the reads.
- [x] [Review][Patch] The tests did not pin the exact-match enums or the
  whole-number edges in Rust [engine-rs/src/wasm.rs, charges.test.ts]:
  `"UP"`, `"Sell"`, 2^53 and negative infinity are now refused in tests.
- Dismissed (4): the mirror reads a stateful mark a third time after the call
  (only a deliberately shifting object reaches it; the editor passes a plain
  literal, and the engine now reads once); the conformance adapter passes
  charge arguments through without `num`/`str` (the scenario loader checks
  ids, floors and enums before they reach it); `JSON.stringify` of a function
  mark in that adapter (the loader cannot produce one); NaN in relayed
  commands written as `null` if a sink serialized them (the worker uses
  structured clone, which keeps NaN, and JSON only shows divergences).

### Round 3 (confirming pass)

- Edge Case Hunter and Acceptance Auditor: clean on every layer.
- Blind Hunter: no patch-level finding. Two low items were taken anyway:
  the TypeScript test now refuses `"Sell"` and negative infinity too, so the
  coverage named in Round 2 holds in both engines' tests; and the
  `INVALID_REQUEST` comment in `charges.rs` now says a native Rust host gets
  no boundary check. Not taken: whole numbers past the old `i32` range now
  reach the engine (both engines keep them in range: `i64` arithmetic stays
  far from overflow, and `resizeTransport` refuses any floor outside the
  grid in both, as the Edge Case Hunter checked); the accepted edge of
  `whole` (2^53 - 1, -0) and a billing getter on `top` are untested (the
  Edge Case Hunter traced both and found the engines agree). The loop ends
  here: the pass surfaced no new patch finding.
