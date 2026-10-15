---
story: engine-retire-typescript
status: planned
depends_on: engine-wasm-switch, engine-tdt-port
---

# Story: retire the TypeScript engine

## Why

Once the web game runs on the Rust engine through WASM and the Godot client
links the same crate natively, the TypeScript engine is a second copy of the
simulation that no host runs. Keeping it means every simulation change lands
twice. This story removes it, and names what has to be true first, because
the removal also deletes the 360 tests under `src/engine/` that pin the
simulation's behavior today.

## Gates, all of them, before the branch opens

1. The web game has shipped on WASM as the default for at least two releases
   and the fallback flag has not been used.
2. The dual-run phase and the nightly fuzzer report no divergence over that
   window.
3. The test-mapping table is complete: every one of the 360 TypeScript engine
   tests maps to a conformance scenario, a Rust unit test, or a recorded
   drop with a reason, and a CI test fails if an engine test file has no row.
4. TDT import and export run in the crate (`story-engine-tdt-port`).
5. The copy catalog holds every engine-emitted sentence
   (`story-engine-copy-catalog`), so no prose dies with `src/engine/`.
6. The coverage floor on the Rust job is at or above the TypeScript floors
   for the engine layer (lines 94, functions 94, branches 86 in
   `vite.config.ts`), measured over the tests plus the referee.

## Acceptance criteria

1. **AC1 `src/engine/` is gone**, and so are the TypeScript runner and the
   lock generator; the lock becomes the Rust engine's own regression
   baseline, regenerated only on purpose by the Rust referee.
2. **AC2 Nothing in the web game imports engine internals.** The seam from the
   WASM switch is the only path, verified by the wrapper-seam build check.
3. **AC3 Every claim survives.** The test-mapping table shows no unmapped
   test, and the suite the table points at is green.
4. **AC4 Saves, TDT, screenshots and golden masters unchanged**, byte for
   byte where they are bytes, hash for hash where they are hashes.
5. **AC5 Version bump: major.** Players see no change, but the engine
   substrate is a headline milestone and the update flow should say so.

## Sequence it sits in

See the roadmap's "Order and gates" section:
scenario library, then WASM build and binding, then dual run, then the
switch, then TDT in the crate, then this story.
