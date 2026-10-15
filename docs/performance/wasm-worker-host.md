# The WASM engine in a Web Worker: measured

> **Snapshot, measured 2026-10-14 17:22 to 22:10 UTC on commit `c80416c`
> (app 2.32.0).** This is one run on one cloud container, and it is not a live
> figure. The live numbers come from re-running `npm run perf:worker`
> (`src/tests/perfWorker/`, its arithmetic pinned by
> `src/tests/perfWorker/analysis.test.ts`). Every figure here is in
> [`results/2026-10-14-c80416c-worker/`](results/2026-10-14-c80416c-worker/)
> (`results.json` with every run, `metrics.csv`, `ratios.csv`, and the
> machine-written `report.md`). The command-to-visible-frame rows in that
> folder are wrong and are not used here (see "Command latency").

Design: [`docs/architecture/wasm-worker-host.md`](../architecture/wasm-worker-host.md).
The earlier TypeScript-against-WASM baseline is [`ts-vs-wasm.md`](ts-vs-wasm.md).

## Summary

- **The worker host is the fastest of the three WASM hosts, and it is still
  slower than the TypeScript engine.** On the 17,322-person tower at 1x, 720
  hosted steps take 23,094 ms on the shipped WASM host, 14,872 ms on the
  coalesced host and 16,240 ms on the worker host, against 1,992 ms on
  TypeScript. The worker host uses 9,360 ms of main-thread time for them,
  4.52x TypeScript's.
- **Two separate gains, measured apart.** Syncing once per frame straight from
  the frame array (the coalesced host) cuts hosted main-thread time to 0.66x
  to 0.75x of the shipped host's on every tower. Moving the engine to a worker
  on top of that cuts it again, to 0.49x to 0.61x of the coalesced host's.
  Wall time at 1x does not improve with the move (1.05x to 1.16x of the
  coalesced host, inconclusive): the main thread waits for each reply.
- **In real frames the move helps on the WASM side, and TypeScript is still
  ahead on the medium and large towers.** On the large tower at 1x the worker
  host draws 11.3 fps mean against 7.17 on the coalesced host and 5.21 on the
  shipped host; TypeScript draws 16.5. Its 1% low is 2.11 fps against
  TypeScript's 6.67.
- **Most of what is left on the worker host's main thread is the hourly
  full-save merge.** On the large tower at 1x, 7,989 ms of the 9,360 ms is
  parsing and merging the engine's save (24 merges of 4.49 MiB). Follow-up
  #1045.
- **Commands are acknowledged in about one round trip.** The worker host's
  command-to-ack median is 55 to 60 ms at 1x and 131 to 162 ms at 4x. The
  main-thread hosts answer in the call.
- **No cost found in startup, memory or offline.** Start-up is within noise
  of the other modes, the worker adds 2.6 KiB (Brotli) of script, memory is
  1.01x the main-thread WASM host's, and an offline reload comes back on the
  worker host.

**Recommendation: B, keep it experimental.** The worker host does what it was
built for (it moves the engine's own time and the frame copy off the main
thread, without changing a digest), but it does not beat the default
TypeScript engine on any tower larger than the small one, so it should not
replace either shipped engine. The next step that could change that is
#1045 (see "Rust and WASM threads" for why threads are not it).

## What was measured

- Four modes, each in a fresh headless Chromium process per repetition:
  - `ts`: the TypeScript engine (the default);
  - `wasm`: the shipped main-thread WASM host (`?engine=wasm`), which syncs
    the read model after every step;
  - `wasm-frame`: the experimental coalesced host (`?engine=wasm-frame`),
    the same host syncing once per rendered frame;
  - `wasm-worker`: the experimental worker host (`?engine=wasm-worker`).
- 10 repetitions, mode order rotated by repetition, at 1x and under 4x
  DevTools CPU throttling.
- Three towers: small (729 people), medium (3,240) and large (17,322).
- Per mode and tower:
  - start-up to a ready engine, cold and warm;
  - a bare engine pass (720 steps, no host) for `ts` and `wasm`;
  - a hosted pass (720 steps of 2 minutes in batches of 4, no rendering),
    with wall time, main-thread time and per-batch main-thread time;
  - 15 s of real frames at speed 3 with a rename every second, for FPS, frame
    times, simulated minutes per second and long tasks;
  - memory after 30 steps and a forced GC;
  - on the worker host, messages, bytes, merges and the worker's own time;
  - an offline reload with the service worker installed.
- Fail-closed checks: the build stamp and engine package hashes, identical
  end digests across modes, raw against hosted agreement, the throttle
  probes, and missing rows or counters. All passed, with no warnings.

**Machine:** Intel Xeon at 2.80 GHz, 4 CPUs, 15.7 GiB, Ubuntu 24.04.5,
Node 22.22.0, Playwright 1.61.1, Chromium 141.0.7390.37, software WebGL
(SwiftShader). Frames render at a 640×360 viewport, because a 1280×720
frame took about 250 ms on this renderer, past the game's 200 ms frame clamp.

**One interruption:** the container restarted at about 19:58 UTC, after 7 of
the 10 repetitions. The harness resumed from its checkpoint on the same
commit, engine bytes, configuration, CPU model, kernel and toolchain, which it
checks before it continues, and ran repetitions 8 to 10. No repetition spans
the restart.

## Comparison

Medians of 10 with the paired ratio and its 95% interval; "inconclusive"
means the interval did not clear a 5% band. Full tables, with every interval,
are in the results folder's `report.md`.

### Hosted, 720 steps (no rendering)

| tower | throttle | metric | ts | wasm | wasm-frame | wasm-worker |
| --- | --- | --- | --- | --- | --- | --- |
| small | 1x | wall (ms) | 306 | 1,081 | 782 | 907 |
| small | 1x | main thread (ms) | 306 | 1,080 | 781 | 477 |
| medium | 1x | wall (ms) | 1,981 | 6,559 | 4,452 | 4,927 |
| medium | 1x | main thread (ms) | 1,980 | 6,557 | 4,450 | 2,719 |
| large | 1x | wall (ms) | 1,992 | 23,094 | 14,872 | 16,240 |
| large | 1x | main thread (ms) | 1,990 | 23,091 | 14,870 | 9,360 |
| large | 1x | main thread per batch, p95 (ms) | 27.2 | 492 | 473 | 349 |
| large | 4x | wall (ms) | 9,916 | 127,606 | 87,317 | 50,898 |
| large | 4x | main thread (ms) | 9,906 | 127,597 | 87,302 | 43,068 |

### Frames (15 s at speed 3, 640×360, software WebGL)

| tower | throttle | metric | ts | wasm | wasm-frame | wasm-worker |
| --- | --- | --- | --- | --- | --- | --- |
| small | 1x | mean FPS | 16.9 | 14.8 | 14.8 | 15.5 |
| medium | 1x | mean FPS | 11.0 | 8.64 | 9.71 | 11.5 |
| medium | 1x | 1% low FPS | 6.00 | 3.53 | 3.88 | 4.00 |
| large | 1x | mean FPS | 16.5 | 5.21 | 7.17 | 11.3 |
| large | 1x | 1% low FPS | 6.67 | 1.45 | 1.56 | 2.11 |
| large | 1x | frame time p99 (ms) | 128 | 640 | 574 | 438 |
| large | 1x | sim minutes per second | 117 | 41.6 | 55.4 | 63.1 |
| large | 1x | main-thread blocking (ms) | 3,015 | 11,169 | 9,672 | 5,560 |
| large | 4x | mean FPS | 4.07 | 1.65 | 1.97 | 2.99 |
| large | 4x | sim minutes per second | 27.1 | 6.80 | 8.01 | 16.3 |

On the small tower every mode keeps up with the clock (113 to 119 sim
minutes per second at 1x), so the frame rows there measure the renderer.

## Where the gains come from

Each pair below changes one thing, so the two gains can be read apart.

Hosted main-thread time:

| tower | throttle | sync change alone (`wasm-frame / wasm`) | worker placement alone (`wasm-worker / wasm-frame`) | worker against TypeScript (`wasm-worker / ts`) |
| --- | --- | --- | --- | --- |
| small | 1x | 0.75x [0.63, 0.78] | 0.61x [0.54, 0.71] | 1.53x [1.31, 1.78] |
| medium | 1x | 0.70x [0.66, 0.76] | 0.58x [0.54, 0.68] | 1.31x [1.24, 1.52] |
| large | 1x | 0.67x [0.57, 0.72] | 0.60x [0.56, 0.67] | 4.52x [4.14, 5.07] |
| large | 4x | 0.66x [0.64, 0.69] | 0.49x [0.46, 0.55] | 4.45x [3.95, 4.69] |

Mean FPS in frames:

| tower | throttle | sync change alone | worker placement alone | worker against TypeScript |
| --- | --- | --- | --- | --- |
| medium | 1x | 1.16x [1.08, 1.23] | 1.16x [1.12, 1.26] | 1.04x [0.92, 1.07], inconclusive |
| large | 1x | 1.51x [1.20, 1.55] | 1.55x [1.44, 1.77] | 0.68x [0.65, 0.72] |
| large | 4x | 1.15x [1.06, 1.35] | 1.48x [1.28, 1.83] | 0.74x [0.65, 0.79] |

- **The sync change** is the read-model work alone: no thread moved. It is
  worth about a third of the shipped host's hosted time on every tower. It
  does not lower the per-batch p95 (0.89x to 1.00x), because a batch still
  ends in one full sync; it removes the syncs between the steps of a batch.
- **The placement** takes the engine's step, the frame copy and the save's
  serialize off the main thread. Hosted wall time at 1x does not drop with it
  (1.05x to 1.16x, inconclusive): with one batch in flight the main thread
  waits for each reply, so the engine's time moves rather than disappears. In
  real frames the waits are spent drawing, which is where the FPS gain comes
  from. Under 4x both the wall and the main-thread time drop.
- **Against TypeScript** the worker host still loses on the medium and large
  towers, on hosted time and in frames.

### What is left on the worker host's main thread

On the worker host the hosted rows split the work by thread (medians of 10):

| tower | throttle | main thread (ms) | of which full-save merges (ms) | worker engine time (ms) | merges | save size |
| --- | --- | --- | --- | --- | --- | --- |
| small | 1x | 477 | 389 | 349 | 24 | 235.2 KiB |
| medium | 1x | 2,719 | 2,259 | 2,130 | 24 | 1.29 MiB |
| large | 1x | 9,360 | 7,989 | 6,508 | 24 | 4.49 MiB |
| large | 4x | 43,068 | 36,091 | 6,424 | 24 | 4.49 MiB |

The merge is the read model being rebuilt from the engine's full save once
per in-game hour. It is the same merge the main-thread hosts run; on those
hosts it hides among the per-step syncs. Moving it, shrinking it or skipping
it is #1045. It is also why the worker host's 4x main-thread time scales with
the throttle while the worker's own time does not.

## Command latency

- **Command to ack (valid).** The worker host times each command from its
  post to the first reply that includes it, on `performance.now()`. Medians:
  55.4, 60.1 and 55.6 ms at 1x on the small, medium and large towers, and
  131, 162 and 135 ms at 4x. On the main-thread hosts a command is answered
  inside the call.
- **Command to visible frame (not usable).** The harness timed this from the
  command to the timestamp `requestAnimationFrame` passes in. That timestamp
  is when the frame began, which can come before the command, so the
  main-thread modes came out at about −10 ms and every mode's figure is
  shifted down by an amount the run did not record. The rows are in the raw
  files but are not used here, and no correction is applied. The harness now
  reads the clock inside the frame callback and fails a run with a negative
  sample, so the next run gives non-negative samples, timed to the frame
  callback (before the frame is painted).

## Start-up, download, memory, offline

- **Start-up** (cold, 1x): 961 ms TypeScript, 977 WASM, 998 coalesced and
  989 ms worker. Every ratio is inconclusive.
- **Download** (production build, Brotli 11): the worker chunk is 2.6 KiB
  (8.3 KiB raw). The engine package all three WASM modes load is 324.6 KiB
  (1.39 MiB raw); the rest of the JavaScript is 359.3 KiB.
- **Memory** after 30 steps and a GC, JS heaps plus WASM memory on both
  threads: on the large tower 75.8 MiB on TypeScript and 204.0, 204.0 and
  206.5 MiB on the three WASM hosts. The worker host is 1.01x the main-thread
  host, equivalent. Browser PSS: 544.9 MiB TypeScript, 663.0 to 665.0 MiB WASM.
- **Offline:** with the service worker installed, an offline reload comes
  back in its own mode for all four, the worker host included.
- **Traffic** on the worker host during frames on the large tower at 1x: 8.65
  replies a second, 22.88 MiB a second received (frame views of 2.00 MiB
  each), and 374 ms a second spent applying replies.

## Rust and WASM threads

Investigated after the worker comparison, and not adopted. Nothing in
`engine-rs/` changed.

- **The measured costs are not the engine's step.** On the worker host the
  engine's own time (6,508 ms on the large tower at 1x, which includes
  building the frame views and serializing the saves) is already off the main
  thread. What the player waits on is the main thread's merge (7,989 ms) and
  its frame apply. A parallel step would shorten the worker's share and leave
  both.
- **The bare engine is not the gap either.** For 720 bare steps the WASM
  engine takes 0.49x to 0.59x TypeScript's time on the small and medium
  towers. On the large tower it takes 1.43x TypeScript's time at 1x and 1.95x
  at 4x, so part of the large tower's gap starts in the engine itself. That
  is a single-thread profiling question that a thread pool would not answer.
- **WASM threads need shared memory.** `SharedArrayBuffer` needs the page to
  be cross-origin isolated, which needs COOP and COEP headers on the origin.
  The production config (`vercel.json`) sends neither, and COEP would also
  constrain every third-party script and embed the site loads. (The benchmark
  pages report `crossOriginIsolated: true` because the harness's server sends
  COOP and COEP for finer timers; the production site does not.) WASM
  threads also need a nightly toolchain with the `atomics` target features
  today.
- **Determinism.** A parallel step needs a fixed partition, an ordered merge
  and no RNG draw inside a parallel phase, with the conformance referee
  running every scenario both ways. #908's plan already scopes that to native
  targets behind a cargo feature, after the TypeScript engine retires.

No rayon, atomics, shared memory or simulation change was added.

## Limitations

- One machine, a 4-CPU container with software WebGL. Render cost dominates
  every frame, so the FPS rows show how much main-thread time each host
  leaves the renderer. GPU-backed frame rates were not measured. A desktop run at 1280×720
  would test the worker's case better: a GPU frees the main thread and spare
  cores free the worker. `npm run perf:worker -- --viewport 1280x720` runs
  the frames at that size (see "Running it on another machine").
- CPU throttling is DevTools emulation of the renderer process, and the
  worker runs in that process, so the 4x rows slow it too. Whether emulation
  throttles a worker thread exactly as it throttles the main thread was not
  measured.
- The hosted passes keep one worker batch in flight, as the game does. The
  hosted rows run without rendering, so the worker's wall time includes the
  main thread's wait.
- Audio was not started in these frames (it is measured in `perf:compare`).
- The serialize and the parse of the full save are split only on the worker
  host. The main-thread hosts' sync is split in `perf:compare`'s attribution
  pass.
- Outbound message sizes (steps and commands) are not counted.
- The coalesced and worker hosts are experimental and opt-in. The default
  engine is unchanged.

## Running it on another machine

On a desktop with a GPU, from a clean checkout of this branch:

1. Install Rust, the `wasm32-unknown-unknown` target and the pinned
   `wasm-bindgen-cli` (the commands are in `engine-rs/README.md`), then run
   `npm ci` and `npm run wasm:build`.
2. Run `npm run perf:worker -- --viewport 1280x720`. It builds the app
   itself and writes `docs/performance/results/<date>-<commit>-worker/`. A
   run from a dirty tree gets a `-dirty` folder and a validation warning, and
   cannot be resumed. About four hours on the container above; a desktop is
   faster. A stopped run continues with `--resume <that folder> --viewport
   1280x720` (repeat the options it started with).
3. Keep each machine's results in its own folder and its own table. The
   harness records the machine, browser and viewport with every run.

## Incomplete

- Command to visible frame: the rows from this run are invalid (above). The
  harness is fixed, and the metric needs a new run.
- One machine only. No GPU-backed or desktop run.

## Follow-ups

- #1045: the hourly full-save merge on the worker host's main thread.
- #1018 (fixed in this PR): a synchronous save taken with steps in flight carried the frame loop's clock; it now carries its state's own minute.
- #1019: the engine log after an engine-refused command.
- #1020: two step-host edges the worker host review found.
