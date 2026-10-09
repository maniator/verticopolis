---
story: engine-wasm-binding
status: done
depends_on: engine-scenario-library
---

# Story: the WASM build and the JavaScript binding

## Why

The Rust engine runs today under one host: the `conformance` binary, from the
command line. The web game needs it as a module it can call from JavaScript,
and the roadmap's next two phases (the dual run in the browser, then the
switch) both stand on that module. This story builds it and proves it with
the referee the crate already answers to: every scenario replayed through the
binding from Node must reproduce every pinned checkpoint.

## Acceptance criteria

1. **AC1 The build.** `engine-rs` compiles to `wasm32-unknown-unknown` behind a
   `wasm` cargo feature, with `wasm-bindgen` pinned to one exact version in
   `Cargo.toml` and the matching CLI generating the JavaScript glue. The
   native build, the tests and the `conformance` binary are untouched when
   the feature is off.
2. **AC2 A narrow surface.** One exported class, `Engine`, with constructors
   for a new game, a serialized save and a `.vctower` text, and methods for
   what the scenario runner and the renderer need: `tick`, `serialize`, the
   build and edit commands (`build`, `buildTransport`, `sellAt`,
   `adjustRent`, `setNoRate`, `setCars`, `setSchedule`), the events
   (`startFire`, `bombThreat`, `evaluateStar`, `callExterminator`,
   `pendingChoice`, `resolveChoice`), the tile queries (`unitAt`,
   `transportAt`), the readouts the runner checks (`mode`, `money`,
   `setMoney`, `fires`) and the two hashed views with their digests. Structured
   values cross as JSON text. Nothing in the binding simulates anything.
3. **AC3 The referee through the binding.** The TypeScript scenario runner
   drives any engine behind a `ScenarioEngine` interface. The TypeScript
   engine implements it directly and its hashes do not move; the WASM module
   implements it through an adapter, and a Vitest suite replays every
   scenario through it against `conformance/expected.json`. The lock is only
   ever written by the TypeScript run.
4. **AC4 CI.** `engine-rs.yml` installs the wasm target and the pinned CLI,
   builds the package with `npm run wasm:build`, and runs the WASM suite
   under `VC_REQUIRE_WASM=1`, where a missing package is a failure. The
   package is not checked in; without the switch the suite skips itself, so
   `npm test` stays green on a checkout with no Rust toolchain.
5. **AC5 Docs.** `engine-rs/README.md` and `conformance/README.md` say how to
   build the binding and run the referee through it; the roadmap's order
   table marks the story done.

## Out of scope

- Loading the module in the browser or a worker; that is the dual-run story.
- A renderer-facing view beyond `serialize` and the hashed views; the switch
  story defines what the renderer reads.
- Prose parity; still outside the contract.

## Dev notes

- Integers cross as 32-bit values (`i32`, with `u32` for the seed and the
  fire count) so the generated TypeScript sees `number`; the engine widens
  them on the way in, and the adapter refuses a value outside that range.
- wasm-bindgen's `nodejs` target emits CommonJS. The repository is ESM, so the
  build script writes a `package.json` marking `engine-rs/pkg/` CommonJS and
  the adapter loads it with `createRequire`.
- Review: `/gds-code-review`.
