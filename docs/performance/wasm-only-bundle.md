# The wasm-only build: what leaves the bundle, and what does not

> **Snapshot, measured 2026-10-14.** Every figure below comes from builds of
> two commits, `d03747d` (the baseline: `main` at `6b2bb34` with #993 at
> `c608425` merged in) and this branch, with one engine package built from
> the same Rust sources. It does not refresh. To measure the current tree,
> run the commands in [Reproduce](#reproduce). `scripts/engine-bundle-size.ts`
> produces the size tables and reuses the #979 size analysis
> (`src/tests/perfCompare/bundle.ts`).

## Summary

`VC_ENGINE=wasm` builds the wasm-only game: the Rust/WASM engine is the only
engine, the runtime engine switch is compiled away, the TypeScript step loop
is swapped out, and an engine that cannot start stops the game with a message
instead of falling back. `scripts/verify-engine-bundle.ts` proves the bundle
part after every build, from the emitted sourcemaps and the precache.

**The TypeScript simulation is not eliminated from the production artifact.**
In the wasm-only build, 85 of the 87 `src/engine/` modules the default build
ships are still in the shipped JavaScript. They come to 171,642 minified bytes
(12.2% of the game's JavaScript). Brotli-compressed on their own, they are
about 47.2 KiB (48,307 bytes). The step loop (`src/engine/sim/loop.ts`) and
`economy/rentalIncome.ts`, which only the loop used, are gone: 2,739 minified
bytes. Every other module ships because the app is still built around a
TypeScript `Simulation` instance:

1. **It is the read model.** The UI, renderer, audio and analytics read
   `app.sim`. The WASM host refreshes it from the engine's frame view and
   full save (`src/wasmhost/wasmHost.ts`, `mergeSimulation`). Replacing it
   with an engine-owned snapshot is #868 (cutover AD-4).
2. **Commands still run on it first.** Every player command runs on the
   instance and is then relayed to the engine (cutover AD-1, due before the
   3.0.0 flip).
3. **Loads parse through it.** Loads and undo restores go through
   `Simulation.deserialize` and its migrations before the engine boots
   (cutover AD-8).
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
shrink as those items land.

## Size comparison

Raw and Brotli (quality 11) bytes of the files each build wrote. Game
JavaScript leaves out the help, gallery and preview pages, the service worker
and sourcemaps. "Initial" means the entry script and the modulepreload links
in `index.html`. "Lazy" means the other game chunks (Tone.js and workbox-window).

| | Baseline (`d03747d`) | Switchable (this branch) | Wasm-only (this branch) |
| --- | --- | --- | --- |
| Game JavaScript, raw | 1375.0 KiB (8 chunks) | 1377.1 KiB (8 chunks) | 1374.6 KiB (8 chunks) |
| Game JavaScript, Brotli | 341.3 KiB | 342.0 KiB | 341.4 KiB |
| Initial JavaScript, raw / Brotli | 1083.9 / 276.6 KiB | 1086.0 / 277.3 KiB | 1083.5 / 276.7 KiB |
| Lazy JavaScript, raw / Brotli | 291.1 / 64.7 KiB | 291.1 / 64.7 KiB | 291.1 / 64.7 KiB |
| WASM engine package (glue + binary), raw / Brotli | 1418.2 / 324.6 KiB | 1418.2 / 324.6 KiB | 1418.2 / 324.6 KiB |
| Precache entries | 24 | 23 | 23 |
| Precache, raw / Brotli | 2984.8 / 802.0 KiB | 2980.7 / 800.7 KiB | 2978.2 / 800.1 KiB |
| TypeScript engine in game JS (minified) | 174,381 B (12.4%) | 174,381 B (12.4%) | 171,642 B (12.2%) |

What changed:

- **No game JavaScript chunk was eliminated.** The JavaScript totals moved by
  less than 3 KiB raw and 1 KiB Brotli. The new boot code (the failure
  message, the boot state) costs about as much as the removed step loop
  saves.
- **One precache entry is gone in both modes:** the dual-run worker
  (`assets/worker-*.js`, 6.4 KiB raw). The dual run is a developer switch that
  bootstrap only reaches in dev serves and `VC_TOOLING=1` builds. Vite still
  emitted its worker for every build, and the precache shipped it to every
  install. Player builds and wasm-only builds now swap in
  `src/dualrun/dualRunAbsent.ts`, and the guard checks that the worker stays
  out.
- **What a first visit fetches before play** is the initial JavaScript, plus
  the engine package wherever the WASM engine runs. A wasm-only build always
  fetches the package: 601.4 KiB Brotli before play, against 277.3 KiB for a
  switchable build on the TypeScript engine. That difference is the engine
  itself, and #993 already precaches it for every install. It is not a cost
  of this change.

The TypeScript-engine rows come from decoding each game chunk's sourcemap
mappings and counting the minified bytes mapped to `src/engine/`. The Brotli
figure (47.2 KiB) compresses those bytes on their own, outside their chunks,
so it is an estimate.

## Startup, runtime and memory

Not measured separately for this change. The wasm-only boot path is the same
one the switchable build takes under `?engine=wasm`: load the package, then
build the app. #979 measured that path (`docs/performance/ts-vs-wasm.md`,
"Startup"). This change removes about 0.4 KiB of JavaScript from that path
and adds no step at run time, so no startup, frame-time or memory difference
is claimed. The engine benchmark (`npm run perf:compare`) measures simulation
performance. That is a different question from bundle size, and this change
does not alter it.

## What the guard checks

`scripts/verify-engine-bundle.ts` runs in `postbuild` after every
`npm run build`, including deploys. It reads every emitted `.js` file's
sourcemap. A missing map fails the check, except for the wasm-bindgen glue,
which is generated from Rust. It also reads `sw.js`'s precache list and the
mode `dist/version.json` records. It then checks:

- **Every build:** no test code (`src/tests/`, `*.test.ts`, `e2e/`) ships.
- **Every player build** (no `VC_TOOLING`): the dual run and its worker do not
  ship.
- **Wasm-only builds:**
  - The bundle has no step loop, no runtime engine switch
    (`src/wasmhost/engineChoice.ts`) and no dual run.
  - The engine glue and binary are precached.
  - Every `src/engine/` module that ships is listed in
    `scripts/engine-bundle.allow.txt`, and every listed module ships.
  - The build's recorded mode matches `VC_ENGINE`.

The sourcemaps list the same modules as Rollup's own metadata for the build
(`renderedLength` > 0): 85 engine modules each way when this was written. The
`e2e-wasm-only` CI job also adds a step-loop import to `src/bootstrap.ts` and
checks that the build fails with the guard's message.

## Offline and fallback behavior

Checked by `e2e/wasmOnly.spec.ts` on the wasm-only build, alongside the whole
e2e suite (31 passed and 2 skipped locally, the skips being the suite's
existing TypeScript-only tests):

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
  from another build, and an installed game whose cached binary is evicted or
  corrupted (offline) all stop on the engine-failure message, with no `game`
  and no host. Nothing runs on TypeScript.
- **Offline:** `e2e/offline.spec.ts` (#993) runs on this build too. The game
  starts offline on WASM, keeps playing when the network drops, plays today's
  sounds, and saves and loads.

What is still open on #985: a cold start in a fresh offline browser session,
checking the cached glue, binary and `BUILD.json` against each other, the
update path across two deploys, and the size budget decision. This change does
not close #985.

## Reproduce

```sh
git checkout <commit>
npm ci && npm run wasm:build
npx vite build --outDir /tmp/out-switchable
VC_ENGINE=wasm npx vite build --outDir /tmp/out-wasm
npx tsx scripts/engine-bundle-size.ts /tmp/out-switchable
npx tsx scripts/engine-bundle-size.ts /tmp/out-wasm --wasm-at-boot
VC_ENGINE=wasm npm run build   # the full build with every postbuild check
```

For the baseline, build `d03747d` the same way, with the same engine package
copied into `src/public/engine/`.
