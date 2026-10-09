---
story: engine-wasm-switch
status: in progress
depends_on: engine-dual-run
---

# Story: the switch, the web game running on the WASM engine

## Why

The dual run showed the two engines agree under the web game's own load for
a day on every fixture. The next step on the roadmap (phase 3) is the game
itself running on the Rust engine, so a player can play it and the Modern
profile can be measured on it, before the TypeScript engine is retired. The
owner asked for a preview build to test, so this story lands the switch
behind a flag first and leaves the read model's faster shapes and the
e2e-wide gate for the follow-up rows.

## How it works

The WASM engine is the authority: it alone ticks. The `Simulation` instance
the app holds stays, as a read model of the engine. Every frame the host
reads the engine's frame view (one flat number array: clock, money, star,
weather, the effects, the event counts, the people's positions and states,
every unit's state and counters, every car's position, load and direction)
and writes it into the instance. Whenever the engine's hour pass ran or its
tower revision moved, the host deserializes the engine's save and merges it
into the instance in place, so the renderer's and the panels' object
references (the tower, its units, its transports) keep their identity.
Every command the host makes still runs on the instance, so the caller gets
the answer the TypeScript engine gives, and is relayed to the engine through
the dual run's command relay; the two agree by the conformance suite, and
the next sync makes the engine's state the instance's. The instance's
`serialize` answers with the engine's save.

## Acceptance criteria

1. **AC1 The frame view.** `Engine.frameView()` returns the per-frame read
   model as one `Float64Array` with a documented layout, and `logSince(seq)`
   the log entries after a sequence number. The engine carries the five
   effect sequences and the three event counts the renderer and the shell
   read (`santaFxSeq`, `explosionFx`, `thiefFx`, `treasureFx`, `vipFxSeq`;
   fires, rooms lost to fire, bombs), fired at the same sites as the
   TypeScript. Unit tests pin the layout and the log numbering.
2. **AC2 The host.** `attachWasmHost(sim, module)` hosts an instance on the
   engine: the engine ticks, the frame view syncs every frame, the save
   merges on an hour pass or a revision change, commands relay, `serialize`
   is the engine's, and `detach` restores the instance. It refuses a tower
   whose crowd exists, like the dual run's load.
3. **AC3 The read model follows the engine.** For every fixture and a new
   game of each mode, a day at the fastest speed through the frame loop's
   own math: at every hour the instance's own state view equals the
   engine's, and the people the renderer draws match the engine's crowd.
   An edits case relays every host edit and shows the instance's save is
   the engine's.
4. **AC4 The switch.** `?engine=wasm` (or `vc.engine = "wasm"` in storage,
   `?engine=ts` to override) loads the served package before the app
   exists, hosts the boot tower and every later `adoptSim`, and publishes
   `window.__vcEngine` with the engine name, the towers hosted and any
   refusal. A package that fails to load leaves the game on the TypeScript
   engine with the reason in the console. The default stays TypeScript.
5. **AC5 The served package.** `npm run wasm:build` writes the browser
   package to `src/public/engine/`, committed with a `BUILD.json` naming the
   hash of the Rust sources it was built from; a unit test fails when the
   sources moved on without a rebuild, so the preview never runs a stale
   engine. The Vercel build (`scripts/vercel-build.sh`) installs the pinned
   toolchain and builds the package itself on every deploy, so a Rust change
   ships without a committed binary. The package is left out of the offline
   precache.
6. **AC6 In a browser.** An e2e spec loads the game with `?engine=wasm`,
   sees the boot tower hosted, the clock advancing through the engine, and
   a build reaching the engine.
7. **AC7 Docs.** The engine README, CONTRIBUTING, the roadmap table and the
   backlog rows #867 and #868 say what the switch does and what remains.

## Out of scope (follow-up rows)

- The per-frame typed arrays over WASM memory instead of a copied
  `Float64Array`, and the structural snapshot instead of a save
  deserialization (#868).
- The elevator statistics, housekeeping report and dispatch memos the save
  does not carry: the schedule dialog's load bars and the housekeeping
  panel read the TypeScript instance's own counters, which the engine does
  not fill while hosting (#868).
- The host step driver (#867): the frame loop still owes minutes to the
  instance's `tick`, which the host forwards.
- Golden masters on the engine and the Modern profile measurement (the
  roadmap's gate to finish phase 3). The e2e suite runs on both engines
  (the `chromium-wasm` Playwright project); the specs that script a tower
  through test helpers on the instance (`buildToStar` and the direct
  `events.pending` write) exercise the page and not the engine there, and
  moving them onto relayed commands is part of #878.

## Dev notes

- Review: `/gds-code-review`.
