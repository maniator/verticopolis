# TypeScript vs Rust/WASM engine performance

> **Snapshot, measured 2026-10-14 04:23 to 06:58 UTC on commit `01c6153`
> (app 2.30.0), with public main at `a2b90e3`.** This is a pre-3.0 baseline of an
> engine still being cut over (#945). It is not a live figure and not release
> performance. The live number comes from re-running `npm run perf:compare`
> (`src/tests/perfCompare/`, tests beside it). The raw results behind every
> figure here are in
> [`results/2026-10-14-01c6153/`](results/2026-10-14-01c6153/) (`results.json`,
> `metrics.csv`, `raw.csv`, `comparisons.csv`, and the machine-written
> `report.md`).

Spec: #972. Harness and these results: PR #979.

## Summary

On one 4-CPU container, in headless Chromium 141 with software WebGL, with
10 paired repetitions in fresh browser processes:

- **The bare Rust engine is faster on small and medium towers and not on the
  large one.** For 24 in-game hours (720 steps), WASM takes 0.55x the
  TypeScript time on the small tower and 0.54x on the medium tower. On the
  17,322-person tower it is 1.08x at 1x CPU (inconclusive) and 1.39x at 4x
  throttle (slower).
- **Hosted the way the app hosts it today, WASM is 3x to 8x slower than
  TypeScript.** The host keeps a TypeScript read model of the tower and
  refreshes it from the engine after every step. That sync accounts for about
  60% of hosted WASM time, and reading the engine's exports for another 20%.
  The engine's own tick is about 20%.
- **In gameplay, small towers play the same and large towers get worse.** On
  the large tower at 1x, mean FPS drops from 6.83 to 4.47, the 1% low from 4.62
  to 1.94 fps, and the sim runs at 34 in-game minutes per second instead of 55.
  Audio on or off does not change that picture.
- **Startup to a playable game is the same within noise at 1x** (269 ms TS,
  328 ms WASM, inconclusive). At 4x it is 1.31x slower (wasm slower).
- **WASM costs memory and bytes.** JS heap plus WASM linear memory is 1.18x,
  1.70x and 2.70x the TypeScript figure on the three towers, because the
  TypeScript read model stays resident beside the engine. The engine package
  adds 321.8 KiB Brotli to a 566.6 KiB game, and a cold WASM start transfers
  619.2 KiB before ready, against 295.2 KiB.
- **Both engines produced identical states.** Start and end digests matched in
  every repetition and against the Node conformance check, and nothing fell
  back to TypeScript.

The engine is not the bottleneck in the hosted numbers. The host's read-model
sync and the export reads are. The cutover work tracked in #868 (read model)
and #954 (commands) is where the hosted cost would move. This baseline is the
"before" for that work.

## What was measured

`npm run perf:compare` builds the app twice from the same sources: a
production build (for sizes) and a `VC_TOOLING=1` build (for timings, which
only adds the `window.game` handle). It then runs each engine in its own fresh
Chromium process, 10 repetitions each, alternating which engine goes first.
Every number below compares the same build, browser, machine, viewport
(1280x720 at DPR 1) and saved towers.

| Scenario | Source | Population | Units | Transports | Save |
| --- | --- | --- | --- | --- | --- |
| small | synthetic 15-floor tower (`buildSmallTower`) | 729 | 2240 | 2 | 106.0 KiB |
| medium | player fixture `sixseven_2.vctower` | 3240 | 12062 | 15 | 629.7 KiB |
| large | Tier-1 win tower (`winningTower.ts`) | 17,322 | 43,358 | 5 | 2.06 MiB |

Each repetition measures:

- **Simulation, bare engine:** a detached engine instance ticks 720 steps of
  2 in-game minutes (24 in-game hours) after 120 warmup steps on a throwaway
  instance. No app, no read model.
- **Simulation, as hosted:** the same 720 steps through the live app's step
  path, so for WASM this includes the host's read-model sync. A separate pass
  wraps every engine method to split WASM's hosted time into the engine's tick,
  the exports the host reads, and host JavaScript. It never runs in the timed
  pass.
- **Gameplay frames:** 15 s of play at speed index 3 after 2 s of warmup, in a
  fresh page, once with audio never started and once with audio started the
  way a first click starts it. The two blocks alternate order by repetition.
- **Startup:** a cold and a warm start to the moment the app is ready, and a
  cold start under 4x throttle.
- **Memory:** per scenario in its own fresh page, after loading the save and
  running two in-game hours, then a forced GC.
- **Transfer and build sizes:** bytes the harness's server sent (Brotli 11 or
  gzip 9 static compression, `Cache-Control` per `vercel.json`), and every file
  in `dist/` raw, gzip and Brotli.

Each timing row is measured at 1x CPU and under Chromium's 4x CPU throttle. A
fixed CPU probe runs under each throttle before the timed passes, and the run
fails if the slowdown is less than half the nominal rate. In this run it
measured 83 ms unthrottled and 306 to 357 ms at 4x.

Ratios are WASM over TypeScript, paired by repetition, with a
distribution-free 95% interval of the median ratio. A verdict needs at least
six pairs and an interval clear of a 5% equivalence band. Otherwise it reads
"inconclusive".

## What the WASM engine does today

Measured at `01c6153`:

- **Ticks run in the Rust engine.** When `?engine=wasm` is active, the engine
  alone advances the simulation.
- **The TypeScript simulation is still resident as a read model.** After every
  step it is refreshed from the engine's frame view. It also takes a full save
  merge whenever the tower revision moves or an in-game hour passes
  (`src/wasmhost/wasmHost.ts`, #868).
- **Player commands still run on the read model and are relayed to the
  engine** (#954). This benchmark does not time commands.
- **The step driver is the TypeScript host's for both engines** (#867).
- **Reads moved in #921 part 1:** prices, sizes and build rules now come from
  the tower's catalog. Other reads stay on TypeScript (#926).
- **Offline, the game comes back on TypeScript.** The service worker does not
  precache `engine/**`, so an offline reload after a first visit booted on
  TypeScript in all 20 processes, the WASM ones included (#987).

## Results

All medians are over 10 repetitions per engine. The paired ratio's 95%
interval is in parentheses.

### Simulation only, bare engine

24 in-game hours (720 steps):

| Tower | CPU | TypeScript | WASM | WASM / TS | Verdict |
| --- | --- | --- | --- | --- | --- |
| small | 1x | 162 ms | 90.41 ms | 0.55x (0.50 to 0.79) | wasm faster |
| small | 4x | 684 ms | 395 ms | 0.60x (0.48 to 0.77) | wasm faster |
| medium | 1x | 1265 ms | 678 ms | 0.54x (0.49 to 0.61) | wasm faster |
| medium | 4x | 5625 ms | 4152 ms | 0.71x (0.61 to 0.78) | wasm faster |
| large | 1x | 2452 ms | 2644 ms | 1.08x (0.97 to 1.29) | inconclusive |
| large | 4x | 8696 ms | 12525 ms | 1.39x (1.20 to 1.48) | wasm slower |

Step tails follow the same shape. The p99 step is inconclusive on the small
and medium towers and slower for WASM on the large one: 23.57 ms against
16.80 ms at 1x, and 123 ms against 60.03 ms at 4x. Creating an engine from a
save is slower for WASM on the medium tower (120 ms against 51.04 ms at 1x,
2.24x).

As a secondary data point, Node's V8 shows the same shape for the same
720 steps: small 278 ms TS against 93 ms WASM, medium 1508 against 609, large
1975 against 2425. These are single runs per scenario, not medians.

### Simulation only, as the app hosts it

| Tower | CPU | TypeScript | WASM | WASM / TS | Verdict |
| --- | --- | --- | --- | --- | --- |
| small | 1x | 177 ms | 709 ms | 4.02x (3.08 to 4.55) | wasm slower |
| small | 4x | 740 ms | 2865 ms | 4.00x (3.09 to 4.25) | wasm slower |
| medium | 1x | 1268 ms | 3992 ms | 3.23x (2.97 to 3.45) | wasm slower |
| medium | 4x | 5756 ms | 18194 ms | 3.22x (2.94 to 3.49) | wasm slower |
| large | 1x | 2679 ms | 14469 ms | 5.45x (4.91 to 5.87) | wasm slower |
| large | 4x | 8593 ms | 68874 ms | 8.05x (6.93 to 8.47) | wasm slower |

TypeScript's hosted median is within 10% of its bare median. WASM's hosted
median is 5.5x to 7.8x its bare median. Both comparisons are ratios of the
medians in the two tables, not paired figures.

Where hosted WASM time goes (medians of the attribution pass):

| Tower | CPU | Engine's tick | Exports the host reads | Host JS sync |
| --- | --- | --- | --- | --- |
| small | 1x | 18.6% | 22.1% | 59.4% |
| medium | 1x | 21.1% | 18.6% | 60.1% |
| large | 1x | 19.4% | 19.5% | 61.1% |
| large | 4x | 20.3% | 20.5% | 59.2% |

The host JS share is an upper bound: the wrappers' own bookkeeping outside
their timed window lands there.

The p99 hosted step is where WASM hurts most: 258 ms against 17.65 ms on the
large tower at 1x (14.87x), and 1132 ms against 56.60 ms at 4x. The host
also runs a full save merge every in-game hour. The harness does not time
that merge on its own, so whether it causes these spikes is not established.

### Gameplay frames

Frames render through SwiftShader (software WebGL), so render cost dominates
the frame and absolute frame rates are far below a GPU device's. Read the
rows for the difference between engines, not the level.

Audio off:

| Tower | CPU | Mean FPS TS | Mean FPS WASM | 1% low TS | 1% low WASM | Sim min/s TS | Sim min/s WASM |
| --- | --- | --- | --- | --- | --- | --- | --- |
| small | 1x | 6.95 | 6.63 | 5.00 | 4.62 | 55.58 | 53.01 |
| medium | 1x | 6.73 | 5.80 | 5.00 | 3.75 | 53.81 | 46.42 |
| large | 1x | 6.83 | 4.47 | 4.62 | 1.94 | 54.60 | 34.36 |
| large | 4x | 3.91 | 3.18 | 2.03 | 0.57 | 6.53 | 3.17 |

Audio on:

| Tower | CPU | Mean FPS TS | Mean FPS WASM | 1% low TS | 1% low WASM | Sim min/s TS | Sim min/s WASM |
| --- | --- | --- | --- | --- | --- | --- | --- |
| small | 1x | 6.17 | 6.02 | 4.62 | 4.45 | 49.33 | 48.13 |
| medium | 1x | 6.12 | 5.40 | 4.45 | 3.64 | 48.98 | 42.87 |
| large | 1x | 6.14 | 4.24 | 4.02 | 2.00 | 48.72 | 28.58 |
| large | 4x | 3.75 | 3.42 | 2.00 | 0.62 | 1.91 | 0.40 |

On the small tower every frame row is inconclusive or equivalent. On the
large tower at 1x, WASM is slower on mean FPS (0.65x audio off, 0.69x audio
on), on the 1% low (0.45x and 0.48x) and on achieved sim speed (0.62x and
0.63x). The share of frame time in `sim.tick` rises from 10.2% to 37.7% (audio
off). Starting audio costs both engines a similar amount: comparing the two
tables' medians, mean FPS falls by 0.23 to 0.78 fps. The audio-off and
audio-on blocks ran in different pages, so this is not a paired figure.

Most throttled frame rows, and the WASM frame rows of the medium and large
towers at 1x, carry harness warnings. Excalibur hands a frame over 200 ms 1 ms of elapsed time, so those
rows understate the simulation work, and windows of 40 to 110 frames make the
p99 and 1% low rest on one or two frames. All 426 warnings in the run are of
these two kinds, and `report.md` lists them per repetition.

### Startup

| Metric | CPU | TypeScript | WASM | WASM / TS | Verdict |
| --- | --- | --- | --- | --- | --- |
| cold, game ready | 1x | 269 ms | 328 ms | 1.25x (0.97 to 1.42) | inconclusive |
| warm, game ready | 1x | 232 ms | 256 ms | 1.07x (0.94 to 1.26) | inconclusive |
| cold, game ready | 4x | 789 ms | 972 ms | 1.31x (1.19 to 1.37) | wasm slower |
| cold, first frame after ready | 4x | 1787 ms | 1922 ms | 1.11x (1.04 to 1.17) | inconclusive |

On the WASM boot path the engine itself is small: a cold `.wasm` fetch takes
13.54 ms (resource timing), and compile plus instantiate takes 15.75 ms at 1x
and 47.52 ms at 4x.

Two startup rows in `report.md` need care:

- **DOMContentLoaded and the load event are not an engine comparison.** The
  report gives them a "wasm faster" verdict (0.30x and 0.20x). In WASM mode,
  `src/bootstrap.ts` awaits the engine package before it builds the app, so
  the module yields and DOMContentLoaded fires early. In TypeScript mode the
  app is built inside module evaluation, which delays the event. Game ready is
  the comparable figure.
- **The "WASM load steps" table overstates fetch and compile.** It awaits
  each step on the live app page, so each await includes waiting on that
  page's event loop: 371 ms fetch and 250 ms compile, against the boot path's
  13.54 ms and 15.75 ms for the same bytes. Its synchronous rows are reliable:
  `initSync` takes 0.598 ms and the first `Engine.fromSave` 29.65 ms.

Both are tracked as `perf-compare-startup-rows` (#1005).

### Memory and save load

At 1x, after loading the save and two in-game hours, then a forced GC:

| Tower | Load the save TS | Load the save WASM | JS heap + linear memory TS | JS heap + linear memory WASM | WASM linear memory | Browser PSS TS | Browser PSS WASM |
| --- | --- | --- | --- | --- | --- | --- | --- |
| small | 17.29 ms | 41.97 ms | 46.32 MiB | 54.60 MiB | 8.44 MiB | 563.21 MiB | 568.82 MiB |
| medium | 87.38 ms | 161 ms | 58.74 MiB | 100.11 MiB | 37.19 MiB | 591.76 MiB | 639.53 MiB |
| large | 117 ms | 484 ms | 74.99 MiB | 202.57 MiB | 128.31 MiB | 614.99 MiB | 738.73 MiB |

The JS heap is about the same for both engines because the WASM host keeps
the TypeScript read model. The engine's linear memory comes on top of that.
Linear memory only grows, so each figure is that page's high-water mark,
including the boot tower it hosted before the save loaded.

### Download and build size

From the production build (`dist/`):

| | Raw | gzip -9 | Brotli 11 |
| --- | --- | --- | --- |
| Game files without the WASM engine | 1.73 MiB | 638.7 KiB | 566.6 KiB |
| WASM engine files (binary, loader, `BUILD.json`) | 1.38 MiB | 429.0 KiB | 321.8 KiB |
| Game files with the engine | 3.11 MiB | 1.04 MiB | 888.5 KiB |

Bytes the server sent on a cold start:

| | TypeScript | WASM |
| --- | --- | --- |
| before the game was ready | 295.2 KiB | 619.2 KiB |
| a first visit with the service worker installing | 494.1 KiB | 815.9 KiB |

- **The engine is loaded only for WASM.** With the TypeScript engine, the
  page fetches none of `engine/*`. With WASM, the 314.9 KiB binary and 6.9 KiB
  loader arrive before the game is ready.
- **The service worker's precache leaves the engine out.** It holds 22
  entries, 1.53 MiB raw and 477.8 KiB Brotli. Leaving `engine/**` out is why
  offline play falls back to TypeScript (#987).
- **The `.wasm` is built with `debug = 1` and no `wasm-opt`.** Its custom
  sections are 187.5 KiB raw, almost all of it the name section (187.2 KiB).
  How much stripping them would save after Brotli was not measured.
- **The WASM host's own JavaScript is not in the WASM figure.** It ships
  inside the shared app chunks, so it is counted as shared for both engines
  (`perf-compare-host-js-share`, #983).

## Validation

The run passed every check the harness makes, with 0 errors:

- **The engine was the one requested.** After every sample the page reported
  the expected engine, with no host errors and no `[wasm]` or `[tick]` page
  errors. The WASM engine was hosted before the game was ready.
- **The engines agreed.** For every scenario, the start and end digests were
  identical across engines, repetitions, throttles and modes, and matched the Node conformance
  check (state, crowd). The clock advanced by exactly 720 x 2 minutes, and the
  state changed.
- **Throttling held.** The CPU probe confirmed every 4x pass, and `gc()` was
  available for every memory sample.
- **Audio ran when asked.** Every audio-on block started audio with a running
  context, in all 20 processes.
- **The build was the measured commit.** Both builds came from the clean tree
  at `01c6153`. They served the same engine bytes (`.wasm` SHA-256
  `018210d3f93cfe6e…`), and the package's `BUILD.json` source hash
  (`2af72cd4…`) matched the `engine-rs` sources. From `26ebce1` on, a missing
  `BUILD.json`, a source hash mismatch, the two builds serving different
  bytes, no package at all, or a checkout without `engine-rs` sources fails
  the run (`packageErrors`, with a test for each case).
- **Nothing was dropped or resumed.** All 20 processes completed, and no
  sample was excluded.

Earlier attempts were discarded and are not published:

- one stopped when the container restarted onto a different CPU (2.80 GHz
  against this run's 2.10 GHz), where the resume guard refused to mix machines;
- two stopped because the branch was rebased under them, the second onto
  #921 part 1, which changed `src/wasmhost/wasmHost.ts`.

### Which commit was measured

Measured: `01c6153`, rebased onto main `a2b90e3`, with 0 commits of main
missing.

The harness commits after it (`dcd92d7` moves a doc comment, `26ebce1` makes
the package checks fail closed) change no engine or app code. Main has since
gained #998, which removes the wrapper build's boot branch from
`src/bootstrap.ts`. The web build never takes that branch.

## Environment

| Item | Value |
| --- | --- |
| CPU | Intel Xeon @ 2.10 GHz, 4 logical CPUs (cloud container) |
| Memory | 15.7 GiB |
| OS | Ubuntu 24.04.5 LTS, kernel 6.18.44, x64 |
| Browser | Chromium 141.0.7390.37, headless, driven by Playwright 1.61.1 |
| WebGL | ANGLE on SwiftShader (software rasterizer) |
| Isolation | cross-origin isolated (COOP/COEP), timer resolution 5 µs |
| Node | v22.22.0 |
| Rust | rustc 1.97.0 |

## Limitations

- **One machine.** These figures come from one container with no GPU, in
  headless Chromium. Other hardware, other browsers and a GPU will give
  different numbers, especially for frames.
- **Render cost is inflated.** Frames are rendered in software, so render
  cost dominates them. Render time is not separated from compositor, GC and
  idle time; that remainder is reported as one share.
- **Throttling is emulated.** CPU throttling is DevTools emulation: it scales
  CPU time but not memory bandwidth or cache behavior.
- **Isolation differs from production.** The pages are cross-origin isolated
  for a fine timer. The production site is not, and isolation does not change
  how either engine executes.
- **Transfer sizes come from this harness's server.** A CDN's compression
  levels and protocol overhead differ, and headers are not counted.
- **Audio plays to no device.** Headless Chromium has no output device, so
  the audio thread's cost on real hardware may differ.
- **Commands are not timed.** Only ticks are measured, and commands still run
  on both the read model and the engine (#954).
- **Many rows, some wrong by chance.** Each row is its own 95% interval, so a
  few borderline verdicts across the report can be wrong by chance.
- **This is a baseline of work in progress.** It describes the engine before
  the 3.0 cutover (#945) and will move as #868, #954, #867 and #921 land.

## Reproduce

```sh
npm ci
npm run wasm:build            # the engine package, if engine-rs changed
PW_CHROMIUM_PATH=/path/to/chromium npm run perf:compare
```

A full run takes about 2.5 hours on this machine and writes a new folder under
`docs/performance/results/<date>-<commit>/`. It never overwrites an existing
folder, and it marks quick, `--skip-build` and dirty runs in the folder name.
`--quick` gives a 2-repetition smoke run. A stopped run continues with
`--resume <folder>` on the same commit and machine.

To compare a later run with this one, open the two folders' `comparisons.csv`
files side by side. Each row is keyed by group, scenario, throttle and metric.

## Reddit-ready summary (draft, not posted)

> We benchmarked our tower sim's TypeScript engine against its Rust engine
> compiled to WASM, on the same build in headless Chromium, with 10 paired runs
> in fresh processes, at 1x and 4x CPU throttle. The two engines produced
> identical states in every run.
>
> - The bare Rust engine is about 1.8x faster on small and medium towers
>   (0.55x and 0.54x the TS time for 24 in-game hours). On a 17k-person tower
>   it's the same at 1x and 1.4x slower under 4x throttle.
> - Hosted in the actual game today, WASM is 3x to 8x slower. That's because
>   the game still keeps the TS model in sync after every step. About 60% of
>   the time goes to that sync, and the engine's own tick is about 20%.
> - In play, small towers feel the same. On the big tower, mean FPS goes from
>   6.8 to 4.5 in a software-rendered container, and the 1% low from 4.6 to 1.9.
> - The engine adds 322 KiB Brotli to a 567 KiB game, and up to 128 MiB of
>   linear memory on the largest tower.
>
> This is a pre-3.0 baseline: the read-model sync and command relay are the
> next things to move, and we'll re-run the same harness as they do. Raw data,
> method and limitations are in the repo.
