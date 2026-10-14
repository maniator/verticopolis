---
story: gameplay-events-glue
status: review
issue: 907
---

# Story: the WASM host's gameplay event glue (#907)

## Why

The party review of #873 phase 1 found that the drain glue had grown across
review rounds:

- The binding's drain returned JSON text that each caller parsed and cast.
- A drained batch was handed back by hand in several places (the refused
  attach and the detach).
- `attachWasmHost`'s detach was three nested `try`/`finally` blocks.

The phase 2 review (#938) added one more case. The binding empties the
engine's buffer before the host parses the text, so a batch that fails to
parse was lost outright and counted nowhere.

## Scope

Two points of the issue's fix shape land differently, on purpose:

- The typed drain lives in `src/wasmhost/`, beside its one caller, the host.
  The binding module (`src/dualrun/binding.ts`) describes the raw surface the
  dual run and the host share; the dual run's harness compares the raw text
  of both engines, so it keeps reading it.
- The merge no longer hands a batch back by hand: it puts the instance's own
  buffer object back after `mergeSimulation`, which needs no restore. Only
  the refused attach and the detach did.

The changes:

- `src/wasmhost/engineEvents.ts`: `drainEngineBatch(engine)` reads the
  binding's pending count, drains, and parses. A batch it cannot read (bad
  JSON, or JSON that is not a list) comes back as no events with `lost` set to
  that count. Entries not shaped like an event are left out, and `lost` counts
  whatever the list falls short of the pending count by. An engine that throws
  still throws.
- The Rust binding gains `gameplayEventsPending()`, the buffer's length
  (`engine-rs/src/wasm.rs`, declared in `src/dualrun/engine.d.ts`, listed in
  `INSTANCE_METHODS`).
- `GameplayEventBuffer.restore(batch, dropped)` makes a buffer hold exactly a
  handed-back batch with that drop count. It replaces the hand-written pushes
  on the refused attach and on detach.
- The host adds what an unreadable batch lost to its drop count, so
  `gameplayEventsDropped` reports it while hosted and the instance keeps it
  after detach.
- The detach is one flat list of steps, each run even after an earlier one
  throws, with the first error thrown at the end (`runEach`). That keeps the
  old guarantee (the instance is always let go, the engine always freed) and
  closes a gap: before, a throw from `useTowerCatalogSource` skipped the
  property restores and the buffer hand-back in the same block. It reads the
  engine's drop count once. A refused attach still throws its own reason when
  freeing the engine behind it also fails.
- The host's drain reads the engine before it empties the read model's
  copies, so a drain that traps while hosted leaves them for the detach to
  count.

Internal only: no wire, save, catalog or conformance-lock change, and no
version bump.

## Tests

- `src/wasmhost/engineEvents.test.ts`: a readable batch loses nothing; bad
  JSON and a non-list each count the pending events as lost; entries that are
  not events are left out and counted with any shortfall; a trapped engine
  still throws.
- `src/engine/gameplayEmission.test.ts`: `restore` replaces what the buffer
  held, sets the drop count, and a batch past the ring counts its overflow.
- `src/tests/integration/wasmHost.integration.test.ts`, under the real WASM
  engine. The existing host tests are unchanged and pass. New cases:
  - an unreadable batch while hosted is counted in `gameplayEventsDropped`,
    the next batch reads again, and an unreadable batch at detach leaves the
    count on the instance;
  - an unreadable batch followed by a trapped detach keeps both losses;
  - a drain that traps while hosted is counted once the host lets go.

## Review record (`/bmad-code-review`)

- **Round 1.** Patched:
  - The typed drain shape-checks entries and counts any shortfall against the pending count.
  - The detach reads the engine's drop count once.
  - A refused attach throws its own reason when freeing also fails.
  - Added a test for an unreadable batch followed by a trapped detach.
  - Notes on where the drain lives and why the merge needs no restore, and the #873 row's follow-up line.

  Dismissed:
  - The refused attach's `restore` equals the old append (nothing can push between the drain and the refusal).
  - A stale binding is refused at load (`checkBinding`) and the app falls back to the TypeScript engine.
  - The `f64` return matches `gameplayEventsDropped`.

  Deferred: none. The drop count can still fall after a trapped detach, as before; the estimate is documented in the detach comment.
- **Round 2.** Patched:
  - The host's drain reads the engine before it empties the read model, so a hosted trap is counted at detach. The new test fails on the old order.
  - Story layout.

  Dismissed: swallowing a free failure behind a refused attach (the refusal reason is the caller's answer).
- **Round 3.** No code findings from any layer. Two story wording fixes, patched.

