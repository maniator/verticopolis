---
story: engine-dual-run
status: done
depends_on: engine-wasm-binding
---

# Story: the dual run, the WASM engine shadowing the live one

## Why

The referee proves the two engines agree on scripted scenarios. The web game
is not a script: it drives the engine from a frame loop with fractional owed
minutes and the pacing curve, at three speeds, under a player's hands, with
host-side writes the scenario runner never makes (a sale's refund, the camera
stamped on a save, a renamed tower, a log line). Before the renderer can
switch to the WASM engine (phase 3), the engine has to be shown holding
parity under exactly that load. This story runs both engines in the browser
and compares them every hour, and runs the same comparison in Node for a full
day on every fixture, at the game's own cadence, as the gate.

## Acceptance criteria

1. **AC1 Every command, both engines.** The four player commands only the
   TypeScript engine had (`toggleAutoBridge`, `setFilmPolicy`,
   `rerollSubtype`, `applyRentBatch`) and the two tower edits it alone had
   (`resizeTransport`, `clearStops`) are ported to `engine-rs`, exposed on the
   binding, added to both scenario runners (with `setStop` and `priceUnit`,
   which the editor also calls), and pinned by two new scenarios
   (`player-edits-classic`, `player-edits-modern`) that the native referee
   and the binding both match.
2. **AC2 One write path per host field.** The editor's rename goes through
   `Tower.setLabel`; the binding gains setters for what the host writes
   directly (`money`, `view`, `autoBridge`, `towerName`, a log line) and the
   editor's remaining tower edits (`removeUnit`, `removeTransport`, `setStop`,
   `setExpressStops`, `priceUnit`).
3. **AC3 The mirror.** `src/dualrun/mirror.ts` records every mutation a live
   simulation receives from its host as a `ShadowCommand`: the engine's
   command methods and the tower's edit methods, wrapped on the instance with
   the engine's own nested calls folded into the outer one, and the four
   direct-write fields turned into reporting accessors. After every tick that
   crosses an hour it emits a checkpoint carrying the two hashed views as
   canonical JSON. Detaching restores the plain instance.
4. **AC4 The shadow.** `src/dualrun/shadow.ts` applies the commands to one
   WASM `Engine` and answers a checkpoint with the first JSON path where its
   views depart from the live ones, with both values. It runs in a Web Worker
   in the browser (`worker.ts`, loading the web build of the package by URL)
   and in plain Node for the gate.
5. **AC5 The switch.** With `?dualrun=1` or `localStorage vc.dualrun=1`
   under `npm run dev` (the worker loads the browser package by URL, which
   only the dev server serves), the game starts the worker, shadows the
   current tower from its own save and boundary markers, follows every
   `adoptSim` (a load, a new game, an undo restore) under a new generation,
   and reports the first divergence in the console with its path.
   `window.__vcDualRun` carries the hours compared, the divergence and any
   worker errors.
6. **AC6 The day gate.** In Node, with the live simulation driven by the web
   host's own `advanceOwedMinutes` (the function `runFrame` calls) under a
   cycle of frame times that reaches the catch-up cap, every fixture save
   runs a full day at each of the three speeds, a new game of each mode runs
   a day at the fastest, and one run uses the steady clock: one comparison
   per hour the run crosses (24, or 25 when a capped frame carries past the
   day's end or a founded game checks its first hour), no divergence. A
   second suite plays every host-side edit on the four-star tower, an undo
   restore, a game founded and edited before the shadow attaches, and the
   Modern toggle without divergence, and shows a drifting shadow is caught
   at the next hour with its path. Both run in CI through
   `npm run test:wasm`.
7. **AC7 Docs.** The engine README, the conformance README, CONTRIBUTING's
   two-engines paragraph and the roadmap's order table say how the dual run
   works and how to switch it on.

## Out of scope

- The renderer reading anything from the WASM engine; that is the switch.
- A browser run in CI: the e2e job has no Rust toolchain and the package is
  build output, so the browser path is exercised by hand under `npm run dev`
  and the gate is the Node day run.
- Hashing in the browser: the views cross to the worker as canonical JSON
  and are compared as text, which also gives the path on a mismatch.

## Dev notes

- The shadow starts from the live tower's own serialized save plus its
  boundary markers (`lastHour`, `lastDay`, `lastQuarter`, `lastMonth`, which
  a save does not carry: a load rebuilds them from the clock while a founded
  game keeps them unset until its first boundary), so both engines hold the
  same state, stand at the same boundaries and rebuild the same crowd from
  the seed. A new game and an undo restore need no special start.
- The mirror's reentrancy guard is a depth counter: `sellAt` removing a unit
  through `tower.removeUnit` and refunding into `money` reports one command.
- A new game is founded at 7:00 and its first step runs the hour pass, so a
  day from a fresh game checkpoints 25 times, once more than a loaded save.
- The binding's TypeScript surface is the declaration wasm-bindgen writes,
  copied to `src/dualrun/engine.d.ts` by `npm run wasm:build` and checked in;
  `binding.ts` types against it and lists the methods the runtime check
  walks, with a typecheck failure when the list misses one. The
  `engine-rs.yml` job fails when the copy is stale.
- Review: `/gds-code-review`, four rounds (three fix rounds, one confirming
  pass with no patch findings). Deferred: #867, #868, #869 (the port audit)
  and #870 (the orphan worker chunk in the production build).
