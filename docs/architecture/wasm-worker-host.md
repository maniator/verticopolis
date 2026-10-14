# The WASM engine in a Web Worker (experimental)

Status: experimental, opt-in, never a default. The shipped engines are still
TypeScript (the default) and the main-thread WASM host (`?engine=wasm`).
Measurements and the recommendation are in
[`docs/performance/wasm-worker-host.md`](../performance/wasm-worker-host.md).

## Flags

| URL or `localStorage["vc.engine"]` | What runs |
| --- | --- |
| (none), `ts` | The TypeScript engine (default). |
| `wasm` | The Rust engine on the main thread. The read model syncs after every step (`src/wasmhost/wasmHost.ts`, unchanged). |
| `wasm-frame` | Experimental. The same main-thread host, syncing once per rendered frame straight from the frame array. |
| `wasm-worker` | Experimental. The Rust engine in a dedicated module worker; the read model syncs from its replies. |

`?engine=` wins over the stored value, as before (`src/wasmhost/engineChoice.ts`).
The title screen reads "WASM engine (worker)" on the worker host.

## How the main-thread host works today (the baseline)

- **Clock and steps.** The frame loop (`src/game/frameLoop.ts`) owes minutes
  per frame and cuts them into fixed steps (`src/engine/sim/fixedStep.ts`, at
  most four per frame, each sized from the sim clock). Every step calls
  `sim.tick(dt)`, and the step size of the next one reads the clock the step
  just moved. The host only forwards the step (#867).
- **Host.** `attachWasmHost` replaces `sim.tick` with `engine.tick(dt)` and a
  full sync: `frameView()` (a `Float64Array` of the header, every person, unit
  and car), a decode into records, and an apply into the TypeScript read
  model. When the tower's revision or the engine's hour pass moves, it also
  merges the engine's full save (`serialize`, `JSON.parse`,
  `Simulation.deserialize`, `mergeSimulation`).
- **Commands.** Every command runs on the TypeScript instance first, so the
  caller gets the answer it always got, and is relayed to the engine as a
  `ShadowCommand` (`src/dualrun/mirror.ts`).
- **Events.** One drain per frame (`drainEngineEvents`, plus one at page
  hide). The host's `drainGameplayEvents` answers with the engine's batch.
- **Saves.** `serialize` answers with the engine's save, synchronously.

### What it costs

Measured in Node (V8) over 720 steps of 2 minutes, after 120 warm steps, on
the `perf:compare` towers (a probe run for this design, not a published
benchmark; the browser numbers are in the performance doc):

| Tower | Bare engine ticks | `frameView` export | Decode | Frame size per step | Full save: serialize / deserialize, each | Save size | Hosted total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| small | 173 ms | 63 ms | 331 ms | 119 KiB | 5.3 / 11.5 ms | 112 KiB | 1,131 ms |
| medium | 1,451 ms | 429 ms | 768 ms | 587 KiB | 26.4 / 66.6 ms | 640 KiB | 8,718 ms |
| large | 4,499 ms | 2,033 ms | 3,589 ms | 2.0 MiB | 100.6 / 260.8 ms | 2.3 MiB | 33,421 ms |

- **Frequency.** A frame view per step (up to four a frame). A full save once
  per in-game hour (an hour is half a real second at the fastest speed) and on
  every tower edit.
- On the large tower, the engine's own ticks are about 13% of the hosted
  time. The rest is reading the engine's exports back and rebuilding the read
  model.

Moving that host into a worker unchanged would move only the engine's ticks
and exports off the main thread. The decode, the apply and the full-save
merge read the TypeScript read model, so they would stay on the main thread.
They would also gain a structured clone of every frame and every save. The
design below cuts the sync work first, then moves the engine.

## Sync changes (both experimental hosts)

1. **Once per frame.** The coalesced host applies the frame view once per
   rendered frame, from the frame loop's `flush` (`src/wasmhost/stepGate.ts`),
   instead of once per step.
   - Between steps, the instance's clock advances by each step's minutes,
     which is exactly what the engine's clock does. The fixed step therefore
     sizes the same steps.
   - The frame loop calls `flush` after its steps and before the meal-rush
     bulletin, so commands still land after a sync.
2. **Apply from the array.** `src/wasmhost/frameApply.ts` reads the
   `Float64Array` directly, without building intermediate records.
   - It skips a route that did not change.
   - When the crowd's order did not change, it updates the crowd in place
     without an id index.
   - It checks the whole array before writing anything. A randomized test
     (`frameApply.test.ts`) holds it to the default host's decode-then-apply
     result.
3. **Log order.** With steps and commands interleaved between syncs, the
   default host's dedupe (drop the first N engine lines) would drop the wrong
   lines. The coalesced and worker hosts instead replace the instance's own
   lines since the last sync with the engine's, in the engine's order
   (`appendEngineLog`).

The full-save merge is unchanged. It still runs on the main thread, hourly
and on every edit, in all three WASM modes (backlog #868 owns shrinking it).

## The worker host

```
main thread                                  engine worker
-----------                                  -------------
frame loop: steps (clock += dt) ──ops──────▶ apply ops in seq order
            flush: one request ─────────────▶ frameView, events, log, pending
commands: run on instance, ──ops──────────▶   (+ full save when it moved)
          relayed in seq order
apply reply ◀──── frame (buffer transferred) ─┘
```

### State ownership

- **The worker owns** the one authoritative engine. It applies steps and
  commands in sequence order, and it alone produces gameplay events, log
  lines and saves.
- **The main thread owns** the read model (renderer, panels, audio,
  analytics, input), the frame loop's pacing and step sizing, and the
  sequence counter.
  - This is a deliberate departure from "the worker owns the clock". The
    step size is a pure function of the speed, the steady-clock choice and
    the sim clock. The frame loop already owns that function (#867), so
    moving it would mean two implementations.
  - The worker advances the authoritative clock. The main thread advances
    its copy by the same minutes, and checks the two agree on every caught-up
    reply. A disagreement is fatal.

### Protocol (`src/wasmhost/workerProtocol.ts`)

**To the worker**

- `init {url}`: where the package is served.
- `load {gen, save, markers}`: start a tower.
- `ops {gen, ops: [{seq, dt} | {seq, cmd}], request?: {req, logSeq, merge}}`
- `free {gen}`

**From the worker**

- `ready {catalogs}`: the catalogs' text, so the main thread never loads a
  second copy of the engine.
- `loaded {gen, view}`
- `frame {gen, req, seq, view, events, dropped, log, pending, merge?, workMs, memoryBytes}`
  - `seq` is the last op the reply includes.
  - `view`'s buffer is transferred, not copied.
  - `events` is the one drain of the engine's gameplay events since the
    last reply.
  - `log` holds the entries after the request's cursor.
  - `merge` is the full save. It is sent only when the revision or the hour
    pass moved since the last one sent, or when the request asks for it.
- `error {gen?, seq?, message}`

**Ordering**

- Every message about a tower carries its generation. A reply for an older
  tower is ignored.
- Ops carry one sequence per tower. The worker refuses a gap as fatal.
- Commands go out in a microtask after they run. Steps go out with the
  frame's request, so a command and the steps around it reach the worker in
  the order they ran.

**Bounded work**

- At most one request is in flight. While it is, the gate's `canStep()` is
  false.
- The frame loop then banks the frame's owed minutes under the existing
  30-minute catch-up cap, instead of queueing steps. At most one frame's
  steps (the fixed step's cap of four) are ever unacknowledged.

**Stale replies.** A reply whose `seq` is older than the instance's last
command:

- is applied as motion only (the crowd, the unit counters, the cars);
- leaves money, star, log, pending choice and full save for a reply that
  includes the command, so the command's local answer is never undone for a
  frame;
- asks again for the skipped full save (`merge: true` on the next request).

**Events.** The worker drains every reply. The main thread queues the events
and answers `drainGameplayEvents` from that queue. There is one drain and one
fan-out, and an event is never handed out twice.

### Saves and `serialize`

`serialize` cannot wait for the worker, so:

- It answers with the engine's exact save while the read model is caught up
  (the last reply included every op sent, and carried a full save).
- Otherwise it answers with the read model's own save. That save has the
  structure and money of the last sync, and the internals as of the last
  merge.
- `settle()` asks for an exact save and resolves when it has one.
  - The autosave and the `.vctower` export call it through `settleEngine`,
    with a 2-second cap so a hung worker cannot hold a save.
  - The other `serialize` callers are synchronous: the quick save, the undo
    snapshot, the crash report, the pre-reload flush and the TDT export. They
    get whichever save is current. That is a known gap of the experimental
    host (backlog `wasm-worker-sync-serialize`).

### Errors, recovery and lifecycle

- **An op the engine refused** (a throw from a command) is reported on the
  status. The host goes on, as the main-thread host goes on.
- **Fatal errors** let the tower go. It continues on the TypeScript engine
  from the read model, and the error is on the status and the console. The
  broken worker is terminated. Fatal errors are:
  - a refused load;
  - a gap in the sequence;
  - a malformed reply;
  - a clock disagreement;
  - a crashed worker (`onerror`);
  - a worker that reports an error with no op.
- **Recovery.** The next tower the app adopts starts a fresh worker. A load
  or a new game is the way back onto the engine.
- **Start-up.** Before the app exists, the worker must answer ready within
  20 seconds (`WORKER_READY_TIMEOUT_MS`). Otherwise the game boots on
  TypeScript, as a failed package load does on the main-thread host.
- **Steps before loading.** No step runs before the worker has loaded a
  tower: the gate holds them.
- **Detach.**
  - It sends `free`, restores every override and hands the queued events
    back to the instance.
  - The engine's events from a batch still in flight are not waited for.
    Detach happens on a tower swap, where the old tower is being replaced.

### Compatibility

- **#868 (read model).** The worker host keeps the read model's gaps
  exactly as the main-thread host does: placeholders for the fields a frame
  does not carry, and a full merge for the rest. It adds no new gap.
- **#954 (engine-first answers).** Commands still answer from the
  instance, as on the main-thread host. When #954 moves answers to the
  engine, the worker host needs an asynchronous answer path, or the commands
  that need an answer have to stay synchronous. `commandAckMs` in the host's
  stats is the latency such a path would add.
- **#908 (engine threads).** This is that row's worker half. It follows the
  row's direction:
  - sequence numbers on every command and snapshot;
  - stale snapshots refused;
  - commands applied at step boundaries in send order;
  - in-flight steps bounded by the fixed-step cap;
  - a save answered after every earlier command;
  - a digest test across the hosts;
  - a transferable buffer, with no SharedArrayBuffer and no COOP/COEP
    requirement.
- **Offline.** The worker script (`assets/engineWorker-*.js`) is in the
  service worker's precache. The engine package is not (#985). Offline, the
  worker cannot load it, and the game boots on TypeScript, as the
  main-thread host does today.
- **The engine.** Nothing in `engine-rs/` or `src/engine/` changed. The
  worker drives the same binding through the same `ShadowEngine` the dual
  run uses.

## Tests

- `src/tests/integration/wasmWorkerHost.integration.test.ts` runs the real
  package behind a `MessageChannel`, so every message is structured-cloned
  and every buffer transferred.
  - The step, coalesced and worker hosts run the same steps and commands on
    the small, medium and large towers. They must reach the same exact engine
    save, read model, crowd, cars and counters, log, events, money and clock.
  - It also covers builds on a new game, a reply older than a command, the
    step gate, pause and commands while paused, and a save that resumes on a
    fresh worker.
- `src/tests/integration/wasmWorkerLifecycle.integration.test.ts` covers:
  - the ready handshake, the label and the handle;
  - a timeout and an error at start;
  - 25 adopted towers in one worker, freeing each;
  - a crash with fallback and restart, and a malformed reply;
  - a refused load before any step;
  - `settle`, and its timeout.
- The headless units run on a fake engine: `workerHost.test.ts`,
  `workerController.test.ts`, `wasmHostFrame.test.ts` and
  `frameApply.test.ts`.
- `e2e/wasmWorker.spec.ts` (chromium-wasm) runs in a real browser:
  - the main thread fetches no `.wasm`;
  - the clock advances;
  - a build reaches the engine;
  - the settled save round-trips through a second engine unchanged;
  - the worker script is precached;
  - a crash falls back to TypeScript and a fresh worker takes the next tower.

## Rust and WASM threads

Not adopted. Both reasons are in the performance doc:

- None of the measured costs is the engine's own step, so a parallel step
  would not move them.
- WASM threads need SharedArrayBuffer, so the production site would need
  cross-origin isolation, which it does not have.

The engine's determinism across thread counts is untouched because no
threading was added.
