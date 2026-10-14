# The wasm-only build: what leaves the bundle, and what does not

> **Snapshot, measured 2026-10-14.** Every figure below comes from builds of
> two commits: `d03747d` (the baseline: `main` at `6b2bb34` with #993 at
> `c608425` merged in) and `fe3c8c9` (this change), each built with
> `npx vite build` and the same engine package from the same Rust sources.
> It does not refresh. To measure the current tree, run the commands in
> [Reproduce](#reproduce): `scripts/engine-bundle-size.ts` produces every
> figure here. It reuses the #979 size analysis
> (`src/tests/perfCompare/bundle.ts`) and attributes bytes to sources with
> `src/build/sourcemapBytes.ts`, which `src/build/sourcemapBytes.test.ts`
> pins.

## Summary

`VC_ENGINE=wasm` builds the wasm-only game: the Rust/WASM engine is the only
engine, the runtime engine switch is compiled away, the TypeScript step loop
is swapped out, and an engine that cannot start stops the game with a message
instead of falling back. `scripts/verify-engine-bundle.ts` proves the bundle
part after every build, from the emitted sourcemaps and the precache.

**The TypeScript simulation is not eliminated from the production artifact.**
In the wasm-only build, 85 of the 87 `src/engine/` modules the default build
ships are still in the shipped JavaScript (the module counts come from the
guard's `VC_ENGINE_REPORT`; see [Reproduce](#reproduce)). They come to 171,642 minified bytes
(12.2% of the game's JavaScript). Brotli-compressed on their own, they are
about 47.4 KiB. The step loop (`src/engine/sim/loop.ts`) and
`economy/rentalIncome.ts`, which only the loop used, are gone. The engine's
total fell by 2,739 minified bytes, a difference of the two builds' totals
(renaming in the minifier can move a few bytes between modules). Every other module ships because the app is still built around a
TypeScript `Simulation` instance:

1. **It is the read model.** The UI, renderer, audio and analytics read
   `app.sim`. The WASM host refreshes it from the engine's frame view and
   full save (`src/wasmhost/wasmHost.ts`, `mergeSimulation`). Replacing it
   with an engine-owned snapshot is #868 (cutover AD-4).
2. **Commands still run on it first.** Every player command runs on the
   instance and is then relayed to the engine (cutover AD-1, #954, due
   before the 3.0.0 flip).
3. **Loads parse through it.** Loads and undo restores go through
   `Simulation.deserialize` and its migrations before the engine boots
   (cutover AD-8, #954).
4. **Classes ship whole.** A bundler keeps all of a class's methods, so
   `Crowd`, `EconomySystem`, `EventSystem`, `ElevatorDispatch` and `Tower`
   carry their step-time code even though the wasm-only build never calls it.
5. **The UI reads reference data from it.** Catalog, prices and caps move to
   the engine's catalog through #921.
6. **The host-side step driver is TypeScript.** `fixedStep` and `timePacing`
   move into the crate with #867 (cutover AD-2).

Ordinary tree shaking cannot remove any of this, and this change does not
move simulation rules into the frontend to make it look smaller.
`scripts/engine-bundle.allow.txt` lists every remaining module, and the guard
fails if one is added or if a listed module stops shipping. The list can only
shrink as those items land, and TypeScript retirement (cutover row 7) empties
it.

## Size comparison

Raw and Brotli (quality 11) bytes of the files each build wrote. Game
JavaScript leaves out the help, gallery and preview pages, the service worker
and sourcemaps. "Initial" means the entry script and the modulepreload links
in `index.html`. "Lazy" means the other game chunks (Tone.js and workbox-window).

| | Baseline (`d03747d`) | Switchable (this branch) | Wasm-only (this branch) |
| --- | --- | --- | --- |
| Game JavaScript, raw | 1375.0 KiB (8 chunks) | 1377.9 KiB (8 chunks) | 1375.4 KiB (8 chunks) |
| Game JavaScript, Brotli | 341.3 KiB | 342.2 KiB | 341.6 KiB |
| Initial JavaScript, raw / Brotli | 1083.9 / 276.6 KiB | 1086.8 / 277.5 KiB | 1084.3 / 276.9 KiB |
| Lazy JavaScript, raw / Brotli | 291.1 / 64.7 KiB | 291.1 / 64.7 KiB | 291.1 / 64.7 KiB |
| WASM engine package (glue + binary), raw / Brotli | 1418.2 / 324.6 KiB | 1418.2 / 324.6 KiB | 1418.2 / 324.6 KiB |
| Precache entries | 24 | 23 | 23 |
| Precache, raw / Brotli | 2984.8 / 802.0 KiB | 2981.5 / 800.9 KiB | 2979.0 / 800.3 KiB |
| TypeScript engine in game JS (minified) | 174,381 B (12.4%) | 174,381 B (12.4%) | 171,642 B (12.2%) |
| TypeScript engine, Brotli on its own (estimate) | 47.9 KiB | 47.9 KiB | 47.4 KiB |

What changed:

- **No game JavaScript chunk was eliminated.** Against the baseline, the
  wasm-only build's game JavaScript is 0.4 KiB larger raw and 0.3 KiB larger
  Brotli: the new boot code (the failure message, the boot state, the load
  limit, the stop gates) costs a little more than the removed step loop
  saves. Against the
  switchable build of the same commit, it is 2.5 KiB smaller raw and 0.6 KiB
  smaller Brotli.
- **One precache entry is gone in both modes:** the dual-run worker
  (`assets/worker-*.js`, 6,409 bytes raw in the baseline build, read from a
  directory listing of that build rather than from the size script). The dual run is a developer switch that
  bootstrap only reaches in dev serves and `VC_TOOLING=1` builds. Vite still
  emitted its worker for every build, and the precache shipped it to every
  install. Player builds and wasm-only builds now swap in
  `src/dualrun/dualRunAbsent.ts`, and the guard checks that the worker stays
  out.
- **What a first visit fetches before play** is the initial JavaScript, plus
  the engine package wherever the WASM engine runs. A wasm-only build always
  fetches the package: 601.5 KiB Brotli before play (the initial JavaScript
  plus the package, summed before rounding), against 277.5 KiB for a
  switchable build on the TypeScript engine. That difference is the engine
  itself, and #993 already precaches it for every install. It is not a cost
  of this change.

The TypeScript-engine rows come from decoding each game chunk's sourcemap
mappings and counting the minified characters mapped to `src/engine/`
(`src/build/sourcemapBytes.ts`). Sourcemap columns count UTF-16 code units;
the minified output is ASCII, so these are bytes. The Brotli row compresses those bytes on
their own, outside their chunks, so it is an estimate.

## Startup, runtime and memory

Not measured separately for this change. The wasm-only boot path is the same
one the switchable build takes under `?engine=wasm`: load the package, then
build the app. #979 measured that path (`docs/performance/ts-vs-wasm.md`,
"Startup"). This change moves the JavaScript on that path by well under
1 KiB Brotli and adds no step at run time, so no startup, frame-time or
memory difference is claimed. The engine benchmark (`npm run perf:compare`) measures simulation
performance. That is a different question from bundle size, and this change
does not alter it.

## What the guard checks

`scripts/verify-engine-bundle.ts` runs in `postbuild` after every
`npm run build`, including deploys. It reads every emitted `.js` file's
sourcemap. A missing map fails the check, except for the engine package's
wasm-bindgen glue, which is generated from Rust.
It also reads the `precacheAndRoute` manifest in `sw.js` and the mode
`dist/version.json` records, which must match `VC_ENGINE` in every build. It
then checks:

- **Every build:** no test code (`src/tests/`, `*.test.*`, `*.spec.*`,
  `__mocks__/`, `e2e/`) ships.
- **Every switchable build:** the TypeScript step loop still ships, so a
  wasm-only swap cannot leak into the default build.
- **Every player build** (no `VC_TOOLING`): the dual run and its worker do not
  ship.
- **Wasm-only builds:**
  - The bundle has no step loop, no runtime engine switch
    (`src/wasmhost/engineChoice.ts`) and no dual run.
  - The engine glue and binary are precached.
  - Every `src/engine/` module that ships is listed in
    `scripts/engine-bundle.allow.txt`, and every listed module ships.

When this was written, a one-off comparison (not part of the guard) found
the sourcemaps list the same 85 engine modules as Rollup's own metadata for
the build (modules with `renderedLength` above zero). The `e2e-wasm-only`
CI job adds a step-loop import to `src/bootstrap.ts` and checks that the
build fails with the guard's message.
`src/build/engineAliases.test.ts` pins that only `Simulation.ts` imports
`./sim/loop` and only `bootstrap.ts` imports `./dualrun/dualRun`, and that no
other import, re-export or dynamic import in `src/` reaches either module,
since a specifier alias matches the text from any importer.

## Offline and fallback behavior

Checked by `e2e/wasmOnly.spec.ts` on the wasm-only build, which CI's
`e2e-wasm-only` job runs with the rest of the e2e suite. As on the
`chromium-wasm` project, the suite's TypeScript-only specs (`tsOnlyOnWasm`)
and the visual baselines are skipped there.

- **Boot:** the build boots on WASM whatever `?engine=` or `vc.engine` says.
  `window.__vcEngineBoot` reads
  `{ build: "wasm-only", engine: "wasm", failure: null }`, and the title
  screen names the engine.
- **No TypeScript stepping:** every TypeScript step entry point throws
  `StepLoopAbsentError`, while the hosted tower's own `tick` advances the
  engine.
- **Saves:** the engine saves, reloads and replays two days from the same save
  to the same `stateDigest`.
- **Failures stop the game:** a missing binary, a corrupted binary, a glue
  that lacks the binding's surface, and an installed game whose cached binary
  is evicted or corrupted (offline) all stop on the engine-failure message,
  with no `game` and no host. A package that loads but cannot host the first
  tower stops at the start stage, and a tower the host refuses mid-game stops
  at the host stage; in both, the tower never ticks on TypeScript. Nothing runs on TypeScript.
- **A stop is final:** once the message is up, the frame loop advances
  nothing, the keyboard shortcuts and autosave do nothing, and the speed
  buttons sit under the message, so neither the player nor a timer can change
  or save the tower. The save the message points back to stays as it was.
- **Recovery:** the message gives the reason and what to try. A stopped game
  takes a waiting update at once instead of prompting under the message, and
  a load that never settles gives up after 90 seconds.
- **Offline:** `e2e/offline.spec.ts` (#993) runs on this build too. The game
  starts offline on WASM, keeps playing when the network drops, plays today's
  sounds, and saves and loads.

What is still open on #985: a cold start in a fresh offline browser session,
checking the cached glue, binary and `BUILD.json` against each other (a glue
and binary from two builds that both carry the full binding are not caught
yet), the update path across two deploys (including a switch between a
switchable deploy and a wasm-only one, which nothing tests yet), and the size
budget decision. This change does not close #985.

Also open, on #874: an engine throw after a successful attach (a trap in
`tick`, or in the command relay after the instance has applied the command)
is caught by the frame-error guard and logged while the tower stops
advancing. A wasm-only build should stop on the engine-failure message there
too, before the flip deploys it.

## Reproduce

The size script and the guard are part of this change, so the baseline is
built at `d03747d` and measured with the scripts from `fe3c8c9`:

```sh
git worktree add /tmp/base d03747d   # the baseline, built without this change
(cd /tmp/base && npm ci && npm run wasm:build && npx vite build --outDir /tmp/out-base)
git checkout fe3c8c9
npm ci && npm run wasm:build
npx tsx scripts/engine-bundle-size.ts /tmp/out-base
npx vite build --outDir /tmp/out-switchable
VC_ENGINE=wasm npx vite build --outDir /tmp/out-wasm
npx tsx scripts/engine-bundle-size.ts /tmp/out-switchable
npx tsx scripts/engine-bundle-size.ts /tmp/out-wasm --wasm-at-boot
VC_ENGINE=wasm npm run build   # the full build with every postbuild check
VC_ENGINE=wasm VC_ENGINE_REPORT=/tmp/wasm-modules.json node scripts/verify-engine-bundle.ts
npm run build && VC_ENGINE_REPORT=/tmp/switchable-modules.json node scripts/verify-engine-bundle.ts
```

The two reports list the `src/engine/` modules each build ships (85 and 87).
`d03747d` is the merge of `main` and #993 at the base of this change's
branch, so it is in the branch history.

The tables use `npx vite build`, which writes what the deploy serves before
the postbuild checks run. `npm run build` adds `third-party-notices.txt` and
the prerendered `/help` page, neither of which is game JavaScript or
precached. For the published figures the baseline used the same engine
package as the other two builds (copied into its `src/public/engine/`), so
the builds differ only in their JavaScript.
