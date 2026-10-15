---
story: relayed-command-input-trust
status: review
issue: 996
---

# Story: relayed edit commands refuse malformed input in both engines (#996)

## Why

#923 closed the malformed-input split for the four charge commands
(`addCar`, `removeCar`, `extendTransport`, `removeFacility`). The round-5
`/gds-code-review` of that work found the same gap in the other relayed
edits: the mirror cast their arguments with `n()`, and the binding took them
as `i32` or `bool`, so the glue coerced a malformed value (`"3"` to 3, `null`
to 0, `true` to 1) or truncated it to 32 bits, while the TypeScript engine
refused it or acted on it differently. Two examples from TypeScript:
`sellAt("2", "180")` sold the office (the tower keys tiles by string), and
`setCars(lift, 2.5)` stored a fractional car count while `setCars(lift, NaN)`
threw a `RangeError`. The web UI never sends these values; a second frontend or a relay
could.

## Scope

The #923 pattern, applied to `setCars`, `towerSetCars` (TypeScript
`tower.setCars`), `resizeTransport`, `towerResizeTransport` (TypeScript
`tower.resizeTransport`), `sellAt`, `setStop`, `setSchedule` (the id only),
`adjustRent` and `setNoRate`.

- **The rule.** Every numeric argument must be a whole JS number within
  `Number.isSafeInteger`; `setStop`'s `stop` must be a JS boolean;
  `adjustRent`'s `dir` must be exactly 1 or -1. Anything else is refused
  before anything moves, with no gameplay event, and with the command's
  existing refusal value: `false` for the boolean commands, `null` for
  `adjustRent`, and `{ ok: false, reason: INVALID_REQUEST }` for the resizes.
- **`dir`.** The conformance scenarios only ever send 1 or -1 (the scenario
  loader's `dir` field type admits nothing else), as do the editor and every
  test, so the stricter rule holds: 0, -0, 2 and 0.5 are refused.
- **TypeScript.** `whole` and `INVALID_REQUEST` moved to
  `src/engine/request.ts`; `sim/charges.ts` imports them and re-exports
  `INVALID_REQUEST`, so existing imports still work. The checks sit where
  both the simulation layer and the bare tower are covered:
  `tower/transport.ts` (`setCars`, `resizeTransport`, `setStop`,
  `setSchedule`, so `Simulation.setCars` and `tower.setCars` both refuse),
  `sim/build.ts` (`sellAt`) and `sim/rent.ts` (`adjustRent`, `setNoRate`).
- **Rust binding.** Each method takes `JsValue` arguments typed through
  `unchecked_param_type` (`number`, and `boolean` for `stop`), reads them with
  `as_f64` / `as_bool`, and delegates to a `pub(crate)` `*_checked` method in
  `engine-rs/src/wasm_relay.rs` (a child module of `wasm.rs`; the binding
  file grows by the raw signatures and their doc comments, and it is on the
  file-size ratchet). The checked methods use
  `crate::charges::whole` and call the unchanged `i64` simulation methods, so
  ids and floors now reach the engine over the full safe range and an id plus
  2^32 no longer aliases the shaft. `setSchedule` checks its id before it
  reads the schedule text, as TypeScript refuses before it looks at the
  payload.
- **Resize refusal shape.** TypeScript's resize refusals are
  `{ ok: false, reason }` with no `added` or `floorTilesCreated`; the binding
  used to add `added: 0, floorTilesCreated: 0` to every refusal. `resize_json`
  now writes a refusal as TypeScript does, so the binding's JSON equals the
  TypeScript result for the malformed refusal and the engine's own refusals
  alike. Successes are unchanged. No caller read those fields off a refusal.
- **Mirror.** These commands relay their numbers through `num()` (a
  non-number as NaN) and `stop` through `bool()` (a non-boolean as null). The
  `ShadowCommand` types say so: `setStop`'s `stop` is `boolean | null` and
  `adjustRent`'s `dir` is `number`. Commands cross to the worker by
  `postMessage` (structured clone, which keeps NaN); nothing serializes them
  as JSON. The schedule payload relays as before under a whole id; under a
  malformed id the mirror relays `null`, since both engines refuse before
  reading it.
- **Conformance adapter.** `src/tests/conformance/wasmEngine.ts` passes these
  commands' arguments through unchecked, as it does for the charges.
- No version bump (no player sees it). The conformance lock did not move.

## Tests

- `src/tests/integration/relayedCommandRaw.integration.test.ts` calls the
  binding raw, with no mirror: 16 malformed stand-ins (numeric strings,
  null, undefined, booleans, fractions, NaN, ±Infinity, ±2^53, BigInt,
  Symbol, objects, arrays, boxed numbers) for each of the 18 numeric
  arguments, 18 missing-argument calls, 12 non-boolean stops and 7 bad
  `dir`s. Each is answered the same by both engines, with the command's
  refusal, no state change (state digests) and no gameplay event. Accepted
  edges (whole numbers that name nothing, ±(2^53 - 1), id ± 2^32, a floor or
  column plus 2^32, a count of -(2^53 - 1)) get the engines' own matching
  refusals. Well-formed calls land with equal answers, state digests and
  events. The behavior cases are what pin the change: a numeric-string floor
  would have sold the office through the old `i32` glue. A glue check also
  shows the changed methods do not convert a string (it would pass on the old
  numeric signatures too, so it guards only against a `&str` parameter;
  `setSchedule`, whose payload is still a string, shows the check bites).
- `src/engine/request.test.ts`: the TypeScript half alone, for runs without
  the WASM package.
- `dualRunEdits.integration.test.ts`: malformed relayed edits through the
  mirror (including a Symbol and a BigInt) keep the shadow in step.
- `engine-rs/src/wasm_relay.rs` native tests (`cargo test --features wasm`):
  every checked method refuses `None`, fractions, NaN, ±infinity and ±2^53
  and moves nothing; ids and floors past 32 bits name nothing; well-formed
  calls land.

## Known remainder

These relayed commands still take `i32`, `f64`, `bool` or `&str` arguments
at the binding and relay through the mirror's `n()` / `s()` casts, so the
same coercion gap remains for them: `build`, `buildTransport`, `priceUnit`,
`applyRentBatch` (its kind and `onlyDefaultPriced`), `setFilmPolicy`,
`rerollSubtype`, `removeUnit`, `removeTransport`, `setExpressStops`,
`clearStops`, `setLabel` and `emit`. `setSchedule`'s payload is still read
as a string in the glue and through `JSON.stringify` in the shadow (a BigInt
in a schedule would throw there; a malformed id no longer relays the
payload). They are tracked by the backlog row `relayed-command-input-trust-rest`.

## Review record (`/gds-code-review`)

- **Round 1.** Patched:
  - `resize_json` branches on `ok` alone, so no refusal can take the success shape.
  - Native Rust tests at ±(2^53 - 1) for every checked command, under a debug build that panics on overflow.
  - The mirror relays no `setSchedule` payload when the id is malformed.
  - The raw test asserts its fixture ids are not 0, since the accepted edges send -0.
  - An assertion label.
  - Rewrapped comments in `tower/transport.ts` (it stays under 500 lines).
  - The story's glue-check and file-size claims.
  - The known remainder became backlog row `relayed-command-input-trust-rest` (#1021).

  Dismissed:
  - The tower-layer checks reaching internal callers: every one passes whole ids, floors and counts, and `stop` is always a real boolean.
  - Nothing reads `added` or `floorTilesCreated` off a resize refusal.
  - The different check order in `adjustRent` (both answer `null`).
  - Typing `stop` as `boolean | null` in the binding (the binding declares the valid input; the mirror's null is a deliberate refusal).
  - The conformance adapter's dropped `i32` guards (the scenario schemas already type these fields).
- **Round 2.** No code findings from any layer. Patched: `towerResizeTransport` gets an id at the safe-range edge in the native test, and the #1021 row records the wider `setSchedule` payload cases (a cycle, a Symbol, a function, and a whole id that names no elevator).
- **Round 3.** No code findings. Patched: the clamp check asserts the car counts it reaches, and the Mirror bullet describes the `setSchedule` payload rule.
