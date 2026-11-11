---
title: 'Move the storage tests off the TypeScript engine (#1875 step 5, storage)'
type: 'refactor'
created: '2026-11-11'
status: 'in-review'
baseline_commit: '4d0b416c'
context: ['{project-root}/CONTRIBUTING.md']
---

## Intent

**Problem:** Six storage unit tests (`src/storage/{saveCap,saveCompression,saveRehydrate,saveText,towerFileCodec,vctowerWriter}.test.ts`) build their saves with the TypeScript `Simulation`, and two lean on its founder rule and its load. The TypeScript engine is being deleted (#1875).

**Approach:** The unit tests check save text only. A save they need is written by hand (`src/tests/fixtures/handSaves.ts`) or is a conformance `.vctower` read by the import. No unit fixture is refreshed from a live engine. Where a test reached the engine (an autosave read), a `mockPort` spy stands in and the test asserts the text it was handed. The engine checks (a repaired pair kept as one excavated entry, the founder rule after the codec, a round-tripped tower's name, clock and population) move to `src/tests/integration/saveRepair.integration.test.ts` on the Rust engine, run by `test:wasm:host`.

## Boundaries & Constraints

**Always:** The integration suite takes its saves from the engine itself (`Engine.newGame(1)`), so no unit fixture tracks engine output. The ratchet only shrinks. American English, no em-dashes.

**Never:** Record/replay. Tests that read config or workflow text. Dropping an engine-behavior assertion instead of moving it.

## Tasks & Acceptance

- [x] `src/tests/fixtures/handSaves.ts` holds the hand-written save.
- [x] six storage tests rewritten without the TypeScript engine.
- [x] `saveRepair.integration.test.ts` holds the moved engine checks.
- [x] five ratchet lines removed.

**Acceptance:** Given no engine package, `npm test` runs the storage suites with none skipped. Given the package, `saveRepair` passes.

## Verification

- `npm run typecheck && npm run lint`: clean
- `npx vitest run --project unit src/storage`: pass
- `npx vitest run --project integration saveRepair`: pass with the engine
