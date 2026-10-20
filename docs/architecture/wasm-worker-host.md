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

- **Frequency.** A frame view per step (up to four a frame), and a full save
  once per in-game hour (an hour is half a real second at the fastest speed)
  and on every tower edit.
- **Size.** Both grow with the tower: a frame view carries every person,
  unit and car, and the full save the whole structure.
- **Measured.** The traffic rows of the `npm run perf:worker` report count
  them on the worker host, where they cross a thread: frame view bytes per
  reply, full-save bytes per merge, merges per run, and main-thread merge
  time. The frame view and the save are the same on the main-thread host
  (the same layout, the same engine), which reads one frame view per step
  where the worker host reads one per reply. The latest run is in
  [`docs/performance/wasm-worker-host.md`](../performance/wasm-worker-host.md),
  dated at its top.

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

The full-save merge is unchanged on the step and coalesced hosts. It still
runs on the main thread, hourly and on every edit (backlog #868 owns shrinking
it). The worker host sends an hourly delta instead when only the hour pass
moved (see below), and the full save on edits and loads.

## The worker host

```
main thread                                  engine worker
-----------                                  -------------
frame loop: steps (clock += dt) ──ops──────▶ apply ops in seq order
            flush: one request ─────────────▶ frameView, events, log, pending
commands: run on instance, ──ops──────────▶   (+ full save when the layout moved,
          relayed in seq order                  or a delta on an hour pass)
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
- `frame {gen, req, seq, view, events, dropped, log, pending, merge?, delta?, workMs, memoryBytes}`
  - `seq` is the last op the reply includes.
  - `view`'s buffer is transferred, not copied.
  - `events` is the one drain of the engine's gameplay events since the
    last reply.
  - `log` holds the entries after the request's cursor.
  - `merge` is the full save. It is sent when the revision moved since the
    last one sent, when the request asks for it, or on an hour pass the
    delta below cannot carry (the cases are listed with it).
  - `delta` replaces it when only the hour pass moved (#1045): the engine's
    `saveDelta()` text, holding the unit records whose save form changed
    since the last save or delta sent and every other top-level key of the
    save (the transports among them). The engine keeps a mirror of the units
    as last sent, and a unit equal to its copy is never serialized again.
    Every full save and delta takes the next number in the tower's sync
    sequence (`sync`), and a delta names the one it was taken against
    (`base`). The main thread patches the changed records onto the objects it
    holds (`mergeSimulationDelta`) only when `base` is the last one it
    applied; otherwise, or when the delta names a unit it does not hold, it
    asks for a full save. The load primes the mirror, so the first hour pass
    is a delta too; when the engine read the save into something other than
    what the main thread sent, the first reply carries a full save instead.
    An hour pass after a command (a camera stamp, a log line such as the
    frame loop's meal-rush bulletins, or a tower rename aside; the exempt
    list is `saveSyncRules.ts`) also sends the full save: the
    read model ran the command on its own, and a command the engine answered
    differently in its result alone leaves a unit the engine never changes,
    which no delta would correct. Units moved in place (a changed
    floor, x or width) count as a layout change and ask for a full save too.
- `error {gen?, seq?, fatal, message}`: `fatal` for a refused load, a gap in
  the sequence, a step the engine failed on or a reply that could not be
  built (the worker frees the engine and the main thread lets the tower go);
  without it, one command the engine refused (reported, and the next reply
  carries a full save).
- There is no separate ack message: a command is acknowledged by the first
  frame reply whose `seq` includes it. A command sent between frames goes out
  at once, and the next frame request (or `settle`) asks for that reply.

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
command is refused (#908). Its gameplay events are the engine's and are kept,
held until the next fresh reply and handed out with it, in order (so during
a long drag a fire or a star reaches the player when the drag pauses):

- nothing of its state is applied, since it predates a command the instance
  already answered and its crowd and cars may name what the command removed;
- the next request goes out at once with no new steps (and asks for the
  skipped full save), and the gate stays shut until a reply includes every
  command, so a stream of commands holds the steps for a round trip each
  instead of starving the read model;
- after `MAX_STALE_STREAK` (4) stale replies in a row the next request waits
  for the frame loop's flush, which sends it with the frame's steps, so the
  clock does not stop while the player drags out a build (a command per
  round trip), unless a settle is waiting, which asks at once; the read
  model then waits for a reply that includes every command;
- a camera stamp (`setView`) does not make a reply stale, and a reply that
  includes every op but camera stamps is caught up (its exact save gets the
  latest stamp patched in): a stamp changes nothing the simulation, the
  money, the log or the pending choice holds. A merge keeps the page's view.

**Replies.** A frame reply must answer the request in flight (one at a time,
answered in order); any other is fatal.

**Watchdog.** A load or a frame request that gets no answer within
`REPLY_TIMEOUT_MS` (10 s) is fatal: a hung worker or a lost reply gives the
tower back to TypeScript instead of freezing it. While the page is hidden
(where a frozen page can run an overdue timer before the reply queued behind
it) the watchdog waits for the page to be visible again.

**Events.** The worker drains every reply. The main thread queues the events
and answers `drainGameplayEvents` from that queue. There is one drain and one
fan-out, and an event is never handed out twice.

### Saves and `serialize`

`serialize` cannot wait for the worker, so:

- It answers with the engine's exact save while the read model is caught up
  (the last reply included every op sent but camera stamps, and carried a
  full save). A camera
  stamp (`view`, which the save carries and the simulation never reads) since
  then is patched into it, so a save that stamps the camera first stays exact.
- Otherwise it answers with the read model's own save: the state of the
  last fresh reply plus the player's commands since, with the internals the
  frame does not carry (the RNG, `satisfaction`, the dispatch memos) as of
  the last merge or delta applied (an hour pass brings one, or asks for a
  full save the next reply brings). The steps still in flight
  are not in it, so it carries that reply's minute instead of the frame
  loop's clock, and a tower loaded from it runs those steps again, an hour
  or day pass among them (#1018).
- `settle()` asks for an exact save and resolves when it has one.
  - The autosave and the `.vctower` export call it through `settleEngine`,
    with a 2-second cap so a hung worker cannot hold a save (the host drops
    a wait that gave up), then stamp the camera. A tower adopted during the
    wait is the one saved or exported. Each settle costs one full save round trip (the worker serializes
    and the main thread merges it), once per autosave or export.
  - The other `serialize` callers are synchronous: the quick save and slot
    saves, the undo snapshot, the crash report, the pre-update flush and the
    TDT export. They
    get whichever save is current, and the host counts the ones that were
    the read model's (`stats.approximateSaves`).
    A save taken with steps in flight carries the last fresh reply's minute,
    so a tower loaded from it runs those steps again, an hour or day pass
    among them. `src/tests/integration/wasmWorkerSaves.integration.test.ts`
    calls `serialize()` (what every one of these callers calls) with steps in
    flight on the real package. It checks the minute, the tower name and
    money set mid-flight, that the hour pass among the in-flight steps runs
    once on the loaded tower, and that each save loads and steps on a fresh
    engine and on TypeScript. What stays approximate is the order: a command
    made mid-flight lands before the in-flight steps it followed on the
    engine (#1053).

### Errors, recovery and lifecycle

- **An op the engine refused** (a throw from a command) is reported on the
  status. The host goes on, as the main-thread host goes on.
- **Fatal errors** let the tower go. It continues on the TypeScript engine
  from the read model, and the error is on the status and the console. The
  broken worker is terminated. Fatal errors are:
  - a refused load;
  - a gap in the sequence, or a step the engine failed on;
  - a malformed reply;
  - a clock disagreement;
  - a crashed worker (`onerror`);
  - a message that cannot be posted (a payload that cannot be cloned);
  - a reply that does not come within the watchdog, or one that answers no
    request in flight.
- **Recovery.** The next tower the app adopts starts a fresh worker. A load
  or a new game is the way back onto the engine. The fresh worker needs the
  package loaded again; a tower that ticks on TypeScript while it starts and
  forms a crowd stays on TypeScript (the engine starts only from a save,
  which carries no crowd).
- **Start-up.** Before the app exists, the worker must answer ready within
  20 seconds (`WORKER_READY_TIMEOUT_MS`). Otherwise the game boots on
  TypeScript, as a failed package load does on the main-thread host.
- **Steps before loading.** No step runs before the worker has loaded a
  tower: the gate holds them.
- **Detach** (a tower swap, or a fallback after a fatal error).
  - It sends `free`, restores every override and hands back the engine's
    events it was holding, then the read model's own copies of the events of
    commands no reply had included yet, so a command's event is never lost or
    handed out twice. The engine events stale replies brought and that no
    fresh reply has released are not handed out: they belong to the steps
    given back below, which the TypeScript engine runs again.
  - The engine's own tick events from a batch still in flight (fires, stars,
    milestones) are not waited for and are lost.
  - Steps the engine never confirmed are given back: the clock returns to the
    minute of the last fresh reply (the state the read model holds), so after
    a fallback the TypeScript engine does not start ahead of it. A meal-rush
    bulletin for an hour the rollback crosses again can show twice (the frame
    loop emits it, not the engine).

### Compatibility

- **#868 (read model).** The worker host keeps the read model's gaps
  exactly as the main-thread host does: placeholders for the fields a frame
  does not carry, and a full merge (or the hourly delta) for the rest. The delta adds one gap: its reply carries no exact save text, so a synchronous save right after an hour pass is approximate while steps are in flight (backlog row `wasm-worker-delta-review-deferrals`).
- **#954 (engine-first answers).** Commands still answer from the
  instance, as on the main-thread host. On the coalesced and worker hosts the
  instance is up to a frame (worker: a round trip) behind the engine, so an
  answer can come from slightly older money or structure than the step
  host's; a refusal by the engine is reported and the next full save corrects
  the read model. When #954 moves answers to the
  engine, the worker host needs an asynchronous answer path, or the commands
  that need an answer have to stay synchronous. `commandAckMs` in the host's
  stats is the latency such a path would add.
- **#908 (engine threads).** This is that row's worker half. It follows the
  row's direction:
  - sequence numbers on every command and snapshot;
  - stale snapshots refused (their events kept);
  - commands applied at step boundaries in send order;
  - in-flight steps bounded by the fixed-step cap;
  - a save answered after every earlier command;
  - a digest test across the hosts;
  - a transferable buffer, with no SharedArrayBuffer and no COOP/COEP
    requirement.
- **Offline.** The worker script (`assets/engineWorker-*.js`) and the
  engine package are both in the service worker's precache (#985). The
  worker loads the package through the page's service worker, so an offline
  reload comes back on the worker host, as the main-thread host comes back
  on the engine.
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
  - Speed changes, a pause and a resume through the frame loop's own
    owed-minute math leave all three hosts on the same tower.
  - Pipelined as in the browser (no wait for replies, so the gate banks
    minutes and commands land while a batch is in flight), the worker's
    engine ends as a bare engine fed the same ops, and the caught-up read
    model is that engine's.
  - It also covers builds on a new game, a reply older than a command, the
    step gate, pause and commands while paused, and a save that resumes on a
    fresh worker.
- `src/tests/integration/wasmWorkerLifecycle.integration.test.ts` covers:
  - the ready handshake, the label and the handle;
  - a timeout and an error at start;
  - 25 adopted towers in one worker, freeing each, with an older tower's
    reply ignored;
  - a crash with fallback and restart, ten crashes in a row on fresh workers,
    and a malformed reply;
  - a refused load before any step;
  - `settle`, and its timeout.
- `src/tests/integration/wasmWorkerSaves.integration.test.ts` takes
  synchronous saves with steps in flight on the real package (see "Saves").
- The lifecycle file also covers a crash with a batch in flight and a command
  no reply has included: the clock rolls back to the applied minute, the
  command and its event are kept once, and the saved tower loads on a fresh
  worker.
- The headless units run on a fake engine: `workerHost.test.ts`,
  `workerHostEdges.test.ts` (among others, a fresh reply that does not parse
  or is not the engine's shape fails before any write),
  `workerController.test.ts`, `wasmHostFrame.test.ts` and
  `frameApply.test.ts`.
- `e2e/wasmWorker.spec.ts` (chromium-wasm) runs in a real browser:
  - the main thread fetches no `.wasm`;
  - the clock advances;
  - a build reaches the engine;
  - the settled save round-trips through a second engine unchanged;
  - the worker script is precached;
  - a fatal worker error falls back to TypeScript and a fresh worker takes the
    next tower (a real worker crash, `onerror`, is covered in Node);
  - an offline reload with the service worker installed comes back on the
    worker host.

## Rust and WASM threads

Not adopted. Both reasons are in the performance doc:

- None of the measured costs is the engine's own step, so a parallel step
  would not move them.
- WASM threads need SharedArrayBuffer, so the production site would need
  cross-origin isolation, which it does not have.

The engine's determinism across thread counts is untouched because no
threading was added.
