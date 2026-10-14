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
  `removeFacility` read every argument raw as a `JsValue`, while the `.d.ts`
  types them `number`, `"up" | "down"`, `"sell" | "bulldoze"` and an optional
  `string | null` mark (the enums narrowed from `string`). A number counts only if it is a whole JS number
  within `Number.isSafeInteger`; an enum only if it is that exact JS string; a
  mark only if it is null, undefined or JSON `{ bottom, top }` text whose
  fields are written as JSON integers (the text `null` is no mark). Anything
  else gets the refusal JSON, with an extension's refusal carrying the shaft's
  ends as they stand. Before this, `addCar("12")` bought a car, `lift.id + 0.5`
  reached the engine as `lift.id`, and an unknown `end` or a bad mark threw.
- **Intentionally unsupported raw inputs** (refused by the binding, moving
  nothing, where TypeScript would act):
  - a mark passed as an object instead of its JSON text;
  - a mark field written as a JSON float (`2.0`, `1e1`,
    `9007199254740990.5`, and `-0`, which the JSON reader takes as a float),
    since an `f64` parse would round a fraction to a whole floor;
  - mark text that is not strict JSON anywhere, even in a field the engine
    ignores (a lone surrogate escape, nesting past 128 levels).

  The reverse also holds: TypeScript's `extendTransport` takes the mark as an
  object, so JSON text handed to it is refused there. The mirror relays only
  `{ bottom, top }` through `JSON.stringify`, which writes none of these.
- **Mirror:** the charge commands relay a non-number id, floor or mark field
  as NaN and a non-string `end` or `method` as an empty string, and check
  any mark but null or undefined, so a malformed value reaches the binding
  only in a form it refuses the way TypeScript does (round 1). The mirror
  reads such a mark once, before the call, and hands the engine and the
  relay that copy (rounds 5 and 6).
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
  - `chargeBindingRaw.integration.test.ts` (in `npm run test:wasm` and the
    Rust engine workflow's paths): 123 malformed calls straight into the
    glue, each checked for no throw, the TypeScript refusal, an equal answer
    and an unchanged state in both engines. 29 accepted edge values must get
    the same refusal from both, never `INVALID_REQUEST`: ids that name
    nothing, among them the shaft's id plus or minus 2^32, which the old
    `i32` truncation aliased to the shaft; floor 3 plus or minus 2^32, which
    it read as floor 3; and floors and marks at ±(2^53 - 1). No gameplay
    event comes from either engine; then well-formed calls must land with
    equal answers, states and events.
- **#958:** that PR removed the checked-in WASM package
  (`src/public/engine/*`) and landed first, so this branch merges main and
  drops its package changes; CI and Vercel build the package.
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

### Round 4 (`/gds-code-review` on the raw `JsValue` binding, with Codex)

- [x] [Review][Patch] `parse_hwm` read mark fields as `f64`, so
  `{"bottom":1,"top":9007199254740990.5}` rounded to a whole floor and was
  billed (Codex P2) [engine-rs/src/wasm.rs]: fields must be JSON integers
  within the safe range; a native test and the raw test pin it.
- [x] [Review][Patch] The JSON text `null` was refused as a mark, though it
  is what `JSON.stringify(null)` sends (Edge Case Hunter, Acceptance Auditor)
  [engine-rs/src/wasm.rs]: it is no mark.
- [x] [Review][Patch] Taking `JsValue` turned the generated `.d.ts` into
  `any` (Blind Hunter, Acceptance Auditor): `unchecked_param_type` restores
  the types, and the docs on all four methods state the raw-argument rule.
- [x] [Review][Patch] The raw test missed cases and parity (Edge Case Hunter,
  Acceptance Auditor): it now covers every missing-argument shape, BigInt,
  Symbol, boxed strings, `-2^53`, empty and raw-`NaN` marks, accepted
  edge ids (`-0`, `-1`, `±(2^53 - 1)`), state per case, an exact case count,
  gameplay events in both engines, and cross-engine state after the
  well-formed calls; the file is in the Rust workflow's paths filter.
- [x] [Review][Patch] `RawMark::None` read like `Option::None`: renamed
  `Absent`.
- [x] [Review][Patch] This story and the PR body described the `f64` binding
  (Acceptance Auditor): updated.
- Codex P1 (a raw call coerced in the glue) was fixed by 51e8a9f.

### Round 5 (confirming pass)

- [x] [Review][Patch] The mirror read a mark's fields again after the
  TypeScript call, so an accessor mark billed one value in TypeScript and
  relayed another (Edge Case Hunter with a repro, Blind Hunter; Round 2 had
  dismissed it) [src/dualrun/mirror.ts]: the wrapper copies an object mark
  once before the call and both read the copy. The dual-run test bills two
  such marks and fails on the old mirror.
- [x] [Review][Patch] The dual-run test never asserted that a checkpoint
  compared the engines, and read the lift through a captured reference
  (Blind Hunter) [dualRunEdits.integration.test.ts]: it pins 2 checkpoints
  and re-reads the shaft by id.
- [x] [Review][Patch] The raw test sent no accepted floor or mark at the
  edge of the safe range (Acceptance Auditor): three such calls join the
  parity cases.
- [x] [Review][Patch] The unsupported-input list missed `-0` as JSON text,
  non-strict JSON in an ignored field, and JSON text handed to TypeScript
  (Edge Case Hunter, Blind Hunter, Acceptance Auditor): documented here and
  in the raw test, which now pins each binding refusal.
- [x] [Review][Patch] #958 landed first and the branch conflicted on the
  package files; the backlog done row and the PR body described the `f64`
  binding (Acceptance Auditor): main is merged with the package dropped,
  and the prose is updated.
- [x] [Review][Defer] Every other relayed command still coerces raw
  arguments in the binding glue (Blind Hunter): backlog row
  `relayed-command-input-trust`, #996.
- Dismissed (4): `charges.ts` missing from the Rust workflow's paths (it is
  under `src/engine/**`); the conformance adapter's dropped 32-bit guard
  (the scenario loader checks charge arguments, Round 2); the hand-kept
  `.d.ts` drifting (it is generated by `npm run wasm:build`, and the package
  hash test catches a stale build); parsing the mark twice for the `null`
  check (a few bytes per drag event).

### Round 6 (confirming pass)

- [x] [Review][Patch] The mirror copied only a mark whose `typeof` is
  `"object"`, so a function carrying an accessor field still billed one
  value and relayed another (Edge Case Hunter with a repro, Blind Hunter)
  [src/dualrun/mirror.ts]: it copies any mark but null or undefined, the
  marks the engine reads fields from; the dual-run test bills a callable
  mark and fails on the old mirror.
- [x] [Review][Patch] The TypeScript refusals of non-numbers, non-strings
  and missing arguments were tested only in suites that skip without the
  WASM package (Blind Hunter) [charges.test.ts]: the unit test now sends
  numeric strings, null, undefined, booleans, BigInt, boxed values, arrays,
  objects, non-string enums, non-object and text marks and missing
  arguments.
- [x] [Review][Patch] The dual-run test's shifting mark first read past the
  shaft, pinning the caller-mark free floors #990 will close (Blind
  Hunter): its first read now stays within the shaft.
- [x] [Review][Patch] The raw test landed no `removeCar` or `removeFacility`
  through the binding, sent no malformed negative mark edge, and checked
  ends only for an elevator (Blind Hunter, Acceptance Auditor): it does all
  three, with a stair link's ends and a unit id's 0 and 0.
- [x] [Review][Patch] Prose: the Rust `INVALID_REQUEST` doc named only
  `whole`, the TypeScript `whole` doc still said "float", the story missed
  a period, the backlog row overstated the raw test, and the mirror's
  `prepare` did not say the engine sees a copy (Blind Hunter, Acceptance
  Auditor): all fixed; the checkpoint count carries its reason.
- Dismissed (1): a mark getter that throws makes TypeScript throw rather
  than refuse (the caller's own exception surfaces, as from any JavaScript
  call, and the mirror relays nothing).

### Round 7 (confirming pass)

- Edge Case Hunter: clean (21 probes of the copied mark, from primitives
  and proxies to getters that run other commands; the one split it found,
  a getter writing an unwatched transport field, is the mirror's general
  limit and not this change's).
- [x] [Review][Patch] Nothing pinned that an id cannot alias another, and no
  mark carried Infinity (Acceptance Auditor) [chargeBindingRaw]: the shaft's
  id plus or minus 2^32 joins the accepted edges in all four commands, and
  an Infinity top joins the malformed marks.
- [x] [Review][Patch] A second frontend writing marks with a float spelling
  learns the integers-only rule only from this story (Blind Hunter)
  [engine-rs/src/wasm.rs]: the binding's `extendTransport` doc states it.
- [x] [Review][Patch] The mark text was parsed twice, for `null` and for the
  fields (Blind Hunter): `parse_mark` reads it once.
- [x] [Review][Patch] Test gaps (Blind Hunter): the TypeScript unit test
  bills a shifting mark on a real extension and pins TypeScript taking a
  `-0` mark field; the native Rust test checks a refusal emits no event; the
  dual-run test asserts the ends and floors a shifting mark bills.
- [x] [Review][Patch] The conformance adapter's comment still said "floats"
  (Acceptance Auditor); the story's mirror bullet read awkwardly: both fixed.
- Dismissed (7): the free relay ops (`towerSetCars`, `towerResizeTransport`)
  reachable by a second frontend (AC5's owner decision; #990 closes the
  caller-mark side); `ShadowCommand` typing NaN and `""` as valid (the shadow
  only forwards them to a binding that refuses them); the checkpoint count
  and the case counts as pinned numbers (they guard against a silent drop,
  and each carries its reason); the raw test's loose engine type (the
  generated `.d.ts` is checked for staleness in CI, and the test calls with
  values the types forbid); a generic refusal reaching a player (no UI path
  sends a malformed command, and the text would flag the bug if one did);
  accepting zero-fraction floats in a mark (they cannot be told from a
  rounded fraction once parsed, so the rule stays integers only and is now
  documented on the binding).

### Round 8 (confirming pass)

- [x] [Review][Patch] Round 7's unit-test edit drained the event buffer
  after the billed shifting mark and then asserted it empty, so the
  refusals' no-event check could not fail (all three layers)
  [charges.test.ts]: the buffer is checked right after the refusals.
- [x] [Review][Patch] The Infinity mark case reached the binding as JSON
  `null`, a case already covered (Blind Hunter): it is written raw, as
  `1e400` and as the word `Infinity`.
- [x] [Review][Patch] Only ids were pinned against `i32` aliasing, not
  floors; the accepted edges checked only that the engines agree, not that
  neither called them malformed (Blind Hunter) [chargeBindingRaw]: floor 3
  plus or minus 2^32 joins them, and each must not be `INVALID_REQUEST`.
- [x] [Review][Patch] The native test no longer told the text `null` from
  malformed text (Blind Hunter) [engine-rs/src/wasm.rs]: it asserts
  `parse_mark` directly.
- [x] [Review][Patch] Prose (all layers): the binding doc called `-0` a
  float spelling and did not say to stringify `{ bottom, top }` alone (an
  extra key with a lone surrogate escape gets the mark refused); the
  `parse_hwm` doc missed the `null` text; the `INVALID_REQUEST` doc named
  `parse_hwm`; the `-0` unit test's name claimed the binding half; the
  story said the `.d.ts` "still" typed the enums, which it narrows; the
  dual-run marks now assert their bottom end; the case counts carry their
  arithmetic.
- Edge Case Hunter: otherwise clean (BOM, duplicate keys, top-level
  non-objects, `i64::MIN`, `u64::MAX`, inverted marks all agree or refuse).
