---
name: 'Rust-backed simulation facade'
type: architecture-review
status: proposed (awaiting the owner's sign-off)
created: '2026-10-20'
binds: [AD-1, AD-3, AD-4, AD-7, AD-8, '#868', '#954', '#874', '#1068', '#1049', '#1050']
companions:
  - consumer-inventory.md
  - measurements.md
  - slice-plan.md
  - plan-updates.md
  - reviews/party-review.md
---

# The TypeScript mirror or a Rust-backed facade (A vs B)

> **Snapshot, written 2026-10-20 against `main` at `9cd44d1` (app 2.40.0,
> engine crate 0.2.0, after #1139).** Status: proposed. Nothing here is built,
> and nothing here changes the default engine, starts a cohort stage or
> removes the TypeScript fallback. Every figure below is either a cloud
> measurement labeled exploratory (method and tables in
> [`measurements.md`](./measurements.md)) or a PC figure the owner quoted as
> motivation; acceptance numbers come only from the PC protocol (release
> plan section 5, the #1164 fresh-page harness, the counting Chromium).

**Names.** "A" and "B" in this document are the owner's two options of
2026-10-20: **A, the mirror** (keep a TypeScript `Simulation` on the healthy
WASM path and keep making its sync cheaper) and **B, the facade** (no
TypeScript `Simulation` on that path; a Rust-backed port plus a small
renderer-facing view). The 2026-10-15 read-model research
(`docs/architecture/read-model-deltas.md`) and OD-9 (ii) also use "design A"
(changed since last sent) and "design B" (versioned slices) for delta
formats. This document calls those **delta design A** and **delta design B**
whenever it means them.

## 1. The answer

**Recommend B.** On the healthy WASM path the page should hold one
simulation, the Rust engine, behind a port that both hosts implement; the
browser keeps presentation state and a view it can rebuild from the engine
at any time. The TypeScript engine stays as the separate emergency fallback,
started only from an engine-written recovery point after a fault.

Why, in order of weight:

1. **B makes AD-1 true by construction.** With no TypeScript instance on the
   path, a command can only be answered by Rust, can only run once, and
   cannot disagree with a second copy. Under A, #954 has to make the
   instance skip refused commands and still apply accepted ones a second
   time to keep the mirror right, which is the double application the owner
   ruled out.
2. **A keeps costs that no delta removes.** A second simulation has to be
   kept consistent (the keyframe rules C1 to C7 exist for that), the panels
   run TypeScript gameplay functions on a copy that can lag, and every frame
   writes engine state into TypeScript objects. B has none of these.
3. **The measured costs point the same way.** In the cloud matrix, today's
   host costs 36x the bare engine on large over a game day, with a 398 ms
   step p99, and every build is a 370 ms merge; the coalesced host is 22x.
   B with a changed-units frame costs about 1.6x bare on large and 0.27x
   the TypeScript engine in the same run, with no garbage collection in the
   timed window and a step p99 within about 1 ms of bare. A fully delta'd A
   (#1068, #1049 and #1050 together) has not been measured, and it would
   close much of the transfer gap. The furthest measured step toward it is
   the coalesced host with #1068's hourly delta (prototype #1133) plus
   #1051's engine speedup: in the worker thread's cloud run 2 (a browser
   figure under software rendering, exploratory, not comparable with these
   Node rows) it reached 0.72x / 1.63x the TypeScript main-thread time on
   medium / large at 1x, with its per-batch maximum still 5.4x TypeScript's
   on large. So a delta'd A can beat TypeScript on the medium tower; on the
   large tower it was still above, and its structural costs stay either way.
4. **B is the shape retirement needs.** Every consumer that moves to the
   port stops depending on `src/engine/`, so the TypeScript engine shrinks
   to the fallback and the reference. Under A, the mirror is a permanent
   consumer that keeps the whole engine alive in the page.

**Conditions.** B ships only if the PC protocol confirms it (frame pacing,
long tasks, memory, commands and throughput on medium and large), with every
existing correctness suite green and none of them weakened. The PC bar is
the protocol rows, M2 to M6 against TypeScript, not "better than today's
host". A measurement-only browser spike checks the renderer's cost of
reading B's view on the PC before the renderer migrates. B is built in
small slices that keep today's host working behind its flag until B has
passed, so any slice can be reverted on its own (the slice plan,
[`slice-plan.md`](./slice-plan.md)).

**What B costs the schedule.** B lengthens the path to the flip. S6 grows
from a sync design into slices 1 to 8, and eligible reliability sessions
start at S9, which under B is slice 10, when the facade becomes the WASM
host; nothing in B redefines eligibility. Some work leaves the path: A5's
sync design rule, RUN-0b's churn decision for S6, #1050's patching of the
mirror and #954's skip-and-reapply logic.

**What B does not fix.** The engine's WASM memory high-water mark is set by
loading the save (51 MiB medium, 128 MiB large in Node), in both designs,
because `fromSave` parses the whole save into a `serde_json::Value` tree
first. B removes the mirror's JavaScript heap (21 MiB on large) but not that
peak. It needs its own item (section 8, M6).

### Decisions for the owner

| Id | Question | Recommendation |
| --- | --- | --- |
| F1 | Adopt B for the healthy WASM path (spine amendment AD-9, [`plan-updates.md`](./plan-updates.md)) | Yes |
| F2 | Commands and panel queries return promises on every host, with the main-thread host resolving in the same task | Yes: one interface for both hosts, no pretend-sync |
| F3 | The facility diagnostics ("why is this unhappy") move to a Rust getter that returns facts, with the TypeScript keeping only the copy | Yes: the largest single new Rust piece, and the only way the inspector stops running TypeScript gameplay code on the healthy path |
| F4 | B supersedes A5's design rule for S6 (OD-9 (ii)): S6 becomes the facade, not a sync design picked from RUN-0b's churn rows | Yes. RUN-0b's cost split stays useful as the baseline |
| F5 | #1068 stays on hold. Its read-model role ends under B; its Rust `SaveMirror` is kept only if restore-point cost needs it (section 5.7) | Yes. The worker evaluation keeps running. If F1 is declined, #1068 with #1051 is the strongest measured A path (cloud run 2: the worker's main-thread time 0.31x / 0.66x TypeScript's, its wall time 0.91x / 1.77x) |
| F6 | #1049 and #1050 are retargeted from the mirror to B's view (changed units, structural snapshot) | Yes |
| F7 | A new engine item for the load-time memory peak, checked against M6 | Yes |
| F8 | Restore points under B are the engine saves the host already takes (undo captures, the 30-second autosave, manual saves), each with a versioned transient sidecar; no save added per command or tick (#1101's property); a pre-registered budget of no save task over 50 ms on large at 1x and 4x on the PC | Yes |
| F9 | Accept the longer path to the flip: eligible sessions start when the facade becomes the WASM host (slice 10) | Yes, given the owner's direction; the alternative is to ship 3.0 on A |

## 2. The two options

| | A: the mirror | B: the facade |
| --- | --- | --- |
| Simulations in the page | Two: the engine, and a TypeScript `Simulation` kept in step | One: the engine. The fallback engine exists only after a fault |
| Who answers a command | Today TypeScript, then relayed (#954's gap). With #954, Rust first, then applied again to the instance | Rust, once |
| Per-frame read | `frameView` decoded into TypeScript objects (all unit records) | Changed units, people and cars into typed arrays and a pooled view |
| On an hour | Full save, parse, deserialize, merge (with #1068: a delta patched into the instance) | Nothing for the view. A restore point when one is due |
| On a structural edit | Full merge (with #1050: a structural delta into the instance) | A structural snapshot (a few ms on large) |
| Panels and overlays | TypeScript gameplay functions on the mirrored state | Rust getters, cached per revision or hour |
| Saves, undo | Engine save text, but the instance re-serializes at attach (AD-8's gap) | Engine bytes only |
| Worker host | The mirror lives on the main thread, fed by messages (`parseMerge`) | The same port, async; the view is fed by transferred buffers |
| What it keeps alive | All of `src/engine/` in the page, as a live simulation | `src/engine/` only as the fallback and reference, loaded on a fault |
| Drift risk | The mirror can lag or disagree; keyframe rules C1 to C7 exist to contain it | The view can only lag by one frame; it never decides anything |

A's improvements are real and some carry over. #1068's work established the
"changed since last sent" contract and its oracle; #1049's changed-unit
frame and #1050's structural edits are exactly what B's view needs, aimed at
a view instead of a second simulation. What does not carry over is the
merge into TypeScript objects, the keyframe rule set as a read-model
mechanism, and the per-command relay.

## 3. Evidence

**From the worker thread's cloud run 2 (exploratory; section 8b of
`release-3.0/host-sync/host-sync-analysis.md`).** With #1051 on every host,
at 1x, medium / large, as a share of TypeScript's main-thread time: today's
main-thread host 3.03x / 9.01x (#1051 moved it only 0.92x / 0.84x, since
sync is its cost); the coalesced host with the hourly delta 0.72x / 1.63x;
the worker with #1068 0.31x / 0.66x, with hosted wall time 0.91x / 1.77x
TypeScript's. Memory did not move with #1051 (every WASM host about 96 /
203 to 206 MiB against TypeScript's 60 / 75), which matches the load-time
peak in [`measurements.md`](./measurements.md).

**From the PC (motivation, not acceptance).** a532572 after #1051's
optimization: WASM bare 222 / 296 ms per game day on medium / large, hosted
2,128 / 7,047 ms, and on large only about 4.8% of hosted time in the engine
tick, 20.6% in exports and 74.6% in host JavaScript. The large cross-engine
ratio from that run is invalid under #1164's order bias and is not used.
The point the attribution makes holds without it: the hosted cost is the
host, and the host's cost is the mirror.

**From the cloud (exploratory; [`measurements.md`](./measurements.md)).**
Same machine, same process, interleaved, 7 repetitions, 720 steps:

| | medium | large |
| --- | --- | --- |
| Bare engine | 395 ms | 513 ms |
| A-step (today's 3.0 host) | 5,200 ms, p99 step 114 ms, 135 GCs | 18,515 ms, p99 step 398 ms, 410 GCs |
| A-frame (coalesced) | 3,507 ms | 11,514 ms |
| B, changed units per frame (upper bound) | 415 ms, p99 3.4 ms, 0 GCs | 832 ms, p99 8.0 ms, 0 GCs |
| B, people and cars only (lower bound) | 415 ms | 711 ms |
| TypeScript engine (run 2, beside bare 399 / 604 and B 494 / 883) | 2,015 ms, p99 13.4 ms | 3,300 ms, p99 23.8 ms |
| A: one build plus its sync | 104 ms | 369 ms |
| B: one build plus its structural snapshot | 1.5 ms | 5.6 ms |
| JS heap the read model keeps (A's mirror / B's view) | 7.4 / 0.65 MiB | 21.4 / 1.0 MiB |

Units differ across sources: the PC and #1133 figures are browser
main-thread times, these are Node times, and the two are never divided by
each other. Two more cautions. Node has no renderer, so neither design's drawing cost is in
these numbers, and B still has to adapt the renderer to read its view. And
the B prototype builds the whole frame in Rust and then compares every unit
record; a shipped version compares only the rooms (section 5.2), so the B
rows are an upper bound on B's read cost.

## 4. Main thread and worker

**Main-thread host.** Under A the engine tick is cheap and the mirror is
the cost. Under B the main thread pays the tick (about 0.3 to 0.4 ms per
step on the PC after #1139) plus the view read, which the cloud figures put
at about 0.1 to 0.5 ms per frame on medium and up to 1.8 ms on large with
the prototype's full walk. That is the host 3.0 ships (AD-7).

**Worker host.** Under A, the worker moves the tick off the main thread but
the mirror stays on it: `parseMerge` and the frame apply are main-thread
work, which is why #1068 measured its large win there (worker main-thread
time 0.27x / 0.18x of the worker on `main`). Under B the worker owns the
engine and the main thread only applies transferred buffers to the view, the
same apply as the main-thread host without the tick. Commands become a
message round trip, so they are asynchronous, and the port says so for both
hosts (F2). The worker stays after the flip (AD-7); B makes it a second
adapter of one port instead of a second sync design. The worker thread's
#1068 evaluation (TS against the worker at 1x; with and without #1068 at 1x
and 4x) keeps running and informs the worker adapter's slice, and its "4x
throughput not comparable" rule stands.

## 5. B's design

### 5.1 The port

One interface, `SimPort`, implemented three times: `RustSim` (the engine on
the main thread), `RustWorkerSim` (the engine in a worker, after the flip
unless the owner moves it) and `TsSim` (the TypeScript engine, for the
fallback and the reference). `app.sim` becomes a `SimPort`; nothing in
`src/ui`, `src/game` or `src/render` holds a `Simulation` on the healthy
path. A sketch (names settle in the first slice's story):

```ts
interface SimPort {
  readonly view: SimView;                       // read synchronously, one frame old at most
  tick(dtMinutes: number): void;                // the frame loop's step (the step driver stays host-side until #867)
  command(c: Command): Promise<CommandResult>;  // Rust first; one result shape
  query<Q extends Query>(q: Q): Promise<QueryResult<Q>>; // panels, previews, overlays
  cached<Q extends Query>(q: Q): QueryResult<Q> | undefined; // the last answer, for render loops
  save(): Promise<SaveBytes>;                   // engine-written
  load(bytes: SaveBytes, how: LoadKind): Promise<void>;
  drainEvents(): GameplayEvent[];
  readonly changeCounter: number;               // undo's signature, from the engine
}
```

`advanceOwedMinutes` in `src/game/frameLoop.ts` already takes a narrow
`{ tick, clock }` shape, which is the pattern the rest of the app moves to.

### 5.2 The view

The view is data, never a simulation: no method on it can change money, the
tower or a rule. It has four parts, each versioned.

- **Header** (every frame): clock, money, star, population, weather, log
  sequence, pending choice, the tower revision and meal-overlay revision,
  and the unlocked kinds keyed on the star. Most of it is today's
  `frameView` header.
- **Structure** (rebuilt when `tower.revision` moves): units and transports
  with their ids, kinds, geometry, subtype and labels, plus an id-to-slot
  index built once per snapshot. Floor and lobby tiles, 40,083 of the large
  tower's 43,358 units, can travel as runs per floor so the snapshot scales
  with rooms (HP-11). The renderer already rebuilds structure only on a
  revision change (`towerSyncSchedule.ts`).
- **Dynamic frame** (every rendered frame): the drawn people as
  structure-of-arrays typed arrays, the cars, and the unit records that
  changed since the last read, addressed by slot. The engine finds them by
  comparing the frame fields over the rooms index (`room_units()`, 2,900 on
  large) and never walks the floor and lobby tiles. That is complete only
  if a structural tile's frame fields change no faster than the revision
  (construction, fire and the other states in `frame.rs`); slice 6a proves
  that with a test, or carries a short list of changed structural ids where
  it does not hold. The hot-path record states the reason (HP-2). Marks set at each write site are the optimization if
  the PC shows the compare matters, since a missed write site would leave a
  stale room on screen. The view oracle checks either way.
- **Slices** (on demand, cached by revision or hour): overlays (floor
  heatmap, peak congestion, the elevator queue view, crowd stress, which
  `commuteStress` already exports), the elevator telemetry and the
  housekeeping report.

Memory ownership: a binding call returns a copy (wasm-bindgen copies a
returned `Vec<f64>` into a fresh JavaScript array), so no JavaScript view
ever points into the engine's linear memory across a call, and a
`memory.grow` cannot invalidate what the view holds. The copies scale with
what changed. The binding exports the layout widths and a layout version
(AD-4 already requires it); the view checks both on load and refuses a
mismatch.

The renderer reads `TowerView`, `UnitView`, `TransportView` and `CrowdView`
interfaces, `readonly` all the way down, so no render path can change the
tower through `TsSim`'s live objects. The TypeScript `Tower` and `Crowd`
satisfy them structurally, so `TsSim` exposes its live objects without copying, and most of the 33
renderer-structure files change types, not logic. `RustSim` backs them with
plain records rebuilt on a revision and a pool of person records reused by
id.

### 5.3 Commands

Every tier-1 command goes to the engine first and the caller gets the
engine's answer in one shape (AD-1, #954 AC2): `{ ok, reason?, delta? }`
plus named fields, converted by one adapter. There is no instance to skip
or patch, so "no duplicate effects" holds by construction on the healthy
path. Everything that touches the engine runs in issue order through one
queue per port: commands, saves, loads, undo and redo, restore points.
While the fallback adopts a tower, the port holds the queue or refuses
with a stated reason. On the main thread the promise resolves in the same
task, so a click's sound and toast land in the same frame they do today.

Before a command's promise resolves, the port applies the engine's answer
to the view: the header, and after a structural command the structure.
Some call sites depend on that today: the paint brush in
`buildActions.ts` builds a tile and then calls `structureKindAt` to skip
tiles already done and to judge the gesture. The brush becomes one engine
command over its tile list (defined as the same builds in order, so it
charges and logs exactly as they do), and slice 2 audits every other call
site's reads after a command. Build-preview quotes are latest-wins by
sequence number, which matters on the worker. The binding gaps (#868): the
exterminator's `cost` and `rooms`, `previewRentBatch`, an unknown kind
answering a refusal instead of throwing, and the transport dry run
(`placeTransportDryRun`, `validateTransport`) that the build preview calls
on every pointer move.

### 5.4 Queries and panels

Each panel gets one Rust getter returning its data, cached in the engine by
revision or hour so a UI tick does not walk every unit (HP-2's wall-clock
budget): the stats screen (`statsReport`), the inspector and editor
(`unitDetail`, `transportDetail` with hourly load and origins), the
onboarding checklist, the HUD's traffic hotspot, and the facility
diagnostics (F3). The diagnostics getter returns facts (the satisfaction
context, coverage, reachability, noise, the binding transport class); the
TypeScript keeps only `gripeCopy`'s wording. Each getter has a differential
test against the TypeScript function it replaces, on the conformance corpus,
so the fallback shows the same numbers the healthy path does.

### 5.5 Saves, undo, redo, load, import, offline

All of it moves to engine bytes (AD-8): a save is `serialize()` or
`encodeVctower()`, a load is `fromSave` or `fromVctower`, `.TDT` goes
through `importTdt` / `exportTdt`, and an undo snapshot is the engine's save
text. Undo's per-command signature (`towerStateSig` on the instance today)
becomes an engine change counter, because `stateDigest` costs 108 ms on
large (measurements). The counter covers what `towerStateSig` covers (the
tower and money), proven by a test against `towerStateSig` on `TsSim`
command by command, so undo records the same steps it does today. The offline package (#985) and the version identity
(#963) are unchanged; B adds binding exports, so the crate version, the
binding declaration (`src/dualrun/engine.d.ts`) and `npm run engine:compat`
move with each Rust slice (CONTRIBUTING.md, "The engine crate version").

### 5.6 Events, log, audio

Gameplay events stay engine-emitted and drained once per host (AD-6). The
log comes from `logSince` by sequence, as today. Audio cues read the view's
header or the engine's events, so a cue no longer waits for a merge (risk 6
in the release plan's assumption table): the cue-timing test S6 and S9 owe
runs on the facade.

### 5.7 The fallback (#874)

The fallback keeps its contract and loses its mirror. A restore point is
the engine's `serialize()` plus a sidecar of transient state the save does
not carry: the boundary markers `fromSave` already accepts, the open extend
gesture, commute stress, elevator telemetry and the housekeeping report
(today's `carryLiveState` reads these from the mirror). The sidecar is a
contract between the two engines, Rust writing and TypeScript reading, so it
carries a version and a schema, has a round-trip test on both engines, and
is refused loudly on a mismatch; it lives in memory only and never needs a
save version.

Points ride the engine saves the host already takes, as #1101 does today,
whose tests pin that no save is added per command or tick. Under A the
hourly merge's save is one of those; under B it is gone, so the points come
from the others: the undo capture before a gesture's first command, the
30-second autosave and manual saves, each with its sidecar read beside it.
That keeps #1101's property and avoids the game-hour clock, which matters:
at the top speed (120 game minutes a second) a game hour is half a real
second, and a `serialize()` on large costs about 63 ms in the cloud. The
lost-progress bound becomes "since the last gesture or autosave", at most
30 seconds of play, which #874's disclosure states. The budget is
pre-registered: no save task over 50 ms on large at 1x and 4x on the PC. If
the autosave's `serialize()` misses it, the remedies in order are idle-time
capture, a faster serializer, then #1068's `SaveMirror` (keyframe plus
deltas, the C6 patcher), the one place its Rust half may still be wanted
(F5). Today's host pays a 370 ms merge every game hour, so this is a
smaller version of a cost players already have.

On a fault, the host builds a TypeScript `Simulation` from the newest point
that loads, applies the sidecar, swaps in `TsSim`, and rebuilds the view
from it. The TypeScript engine never runs before that. The fallback module
may load through a dynamic import, but it stays in the precache manifest
(the `verify-precache` gate), and a test plays on after a forced trap with
the network off.

### 5.8 Rust independence

The new exports are one-line wrappers in `src/wasm.rs` over functions in
core modules (`wasm.rs` is already 1,455 lines and on the file-size
ratchet; if the wrappers still grow it, slice 6a first splits it into
`src/wasm/` and the independence test admits that directory) (a view builder, panel getters, the dirty marks), which know nothing
of JavaScript, workers or the DOM; `engine-rs/tests/independence.rs` keeps
holding. Getters are read-only, so the conformance lock and the hashes do
not move; dirty marks live beside the revision-keyed memos, outside the
save, `state_view` and the digest.

## 6. Migration risk

| Risk | Where | Mitigation |
| --- | --- | --- |
| The port migration breaks a UI flow | 102 files touch engine types | Strangler order: the port lands first with `TsSim` over the live instance, consumers move bucket by bucket while today's hosts keep working, and `RustSim` replaces `TsSim` only when nothing reaches past the port. Each slice is behavior-preserving and revertable |
| Async commands reorder or double-fire | 31 command entry points | One queue per port; tests per command family for order, refusal and the result shape; the main-thread port resolves in the same task |
| Rust getters disagree with the TypeScript functions | stats, inspector, diagnostics, overlays | A differential test per getter on the conformance corpus; the Rust value is authoritative on the healthy path |
| Diagnostics port is large | about 790 lines of TypeScript across three files | Facts in Rust, wording in TypeScript; its own slice and review |
| The view lags or shows a stale structure | renderer | Revision-keyed snapshot; a test that the view equals a fresh snapshot after every caught-up frame (the oracle #1068 built, aimed at the view) |
| Restore points cost a long task | fallback | Points ride the existing saves (no added save); PC measurement against the budget; idle-time capture; `SaveMirror` as the last remedy |
| Shared files with other lanes | `wasmHost.ts`, `startWasmHost.ts`, `hostFault.ts` (Runtime), renderer files (Rendering), worker files (worker thread) | Slices that touch them are agreed with the owning thread first; none starts while #1092 is mid-flight in the same files |
| The critical path gets longer | S6 and S9 grow | Offset in part: A5's sync design, RUN-0b's churn decision and #1050's mirror patching drop out. Section 8 and the slice plan show the order |

## 7. Tests

What changes: the merge and sync tests (`merge`, `frameSync`, `frameApply`,
`wasmHostPoints`, `workerApply`) test code that B removes from the healthy
path; they stay while today's host stays and go with it in the last slice.
What does not change: conformance, parity, the seeded differential, the
fuzz, the dual run and the save round trips test the engines, not the hosts.

What B adds:

- **A port contract suite** run against `TsSim` and `RustSim` (and later
  `RustWorkerSim`): the same scripted game gives the same command results
  and the same view after every caught-up frame.
- **A guard that the healthy path holds no `Simulation`**: an import-graph
  check extending #1118's ratchet (no runtime import of the `Simulation`
  module from `src/ui`, `src/game`, `src/render` outside the fallback
  module), and a `chromium-wasm` e2e assertion, on the tooling build, that
  no `Simulation` was constructed and `Simulation.deserialize` was never
  called during normal play.
- **Per-command tests** that the result is the engine's (#954's list), and
  per-getter differential tests (section 5.4).
- **A forced-trap test** that the fallback starts from a restore point plus
  sidecar, with no mirror.
- **The cue-timing test** on the facade.

## 8. Release-gate effects

| Gate or row | Effect of B |
| --- | --- |
| Performance (M2 to M6) | Expected to improve throughput, frame pacing and long tasks sharply on both towers; measured only by the PC protocol on the facade. M6 (memory) still carries the load-time WASM peak, which B does not touch: F7's item |
| Authority (#954, S9) | Met by construction once commands go through `RustSim`; the per-command tests stay |
| Reliability eligibility | Eligible sessions start at the first build carrying S9 (OD-2). Under B that is slice 10, when `RustSim` becomes the WASM host, so the 1,000-session count and the observation period start later than under A (F9) |
| Seeded replay and the freeze | B adds Rust exports, which change the window key; they land before the freeze like every other key-changing item |
| Unit and integration | The six exclusions S6 was to remove go with the mirror; the port contract suite is added |
| End to end | `chromium-wasm` runs on the facade before it becomes the WASM path |
| Saves | Unchanged format, no save version bump; AD-8 holds structurally |
| Dual run, conformance | Unchanged |
| Rollback rehearsal | Rehearses the facade and the TypeScript fallback |

## 9. Hot-path record for the design

The design-level record of `docs/performance/hot-path-review.md`; each
slice carries its own record for its diff.

| Item | Result | Evidence | Resolution |
| --- | --- | --- | --- |
| HP-1 | clear | Entry points: the frame read and render sync (per frame), panel getters (wall clock), commands and snapshots (per command), restore points (per hour) | Each slice traces its own callers |
| HP-2 | finding (1) | The prototype's changed-unit read walks all units per frame | A compare over the rooms index with the reason recorded, marks at write sites if the PC shows the need (slice 6a); the prototype is measurement-only |
| HP-3 | clear | Copies scale with what changed; the person pool is reused | Slice records confirm |
| HP-4 | n/a | No sort per frame | |
| HP-5 | clear | The id-to-slot index is built once per structure snapshot; per-frame records carry slots | |
| HP-6 | clear | Lookups by id through the index | |
| HP-7 | finding (1) | The diagnostics move from TypeScript to Rust: inherited algorithms reviewed as new | Slice 6c's record |
| HP-8 | finding (1) | TypeScript `stats()` walks all units per UI tick on the mirror (5.7 ms on large); its Rust getter must cache by revision or hour | Slice 6b |
| HP-9 | clear | Remedies named in this table | |
| HP-10 | clear | Getters are read-only; dirty marks sit outside the save and digest; differential tests per getter | |
| HP-11 | finding (2) | Today's `frameView` sends all unit records every frame (#1049), and the hourly merge (#1045, #1068) | Both removed by B |
| HP-12 | finding (1) | `congestion()` and `floorHeatmap` run in TypeScript on the mirror per frame or per overlay frame | Engine slices, cached per revision or hour |

## 10. How this review was done

Owner direction of 2026-10-20 20:45 UTC; the consumer inventory
([`consumer-inventory.md`](./consumer-inventory.md)), a compiler-API scan of
every production access to engine types; the cloud matrix and the command,
memory and serialize passes ([`measurements.md`](./measurements.md)); the
spine, the release plan, the cutover plan, the read-model research, the
worker-host design and the host-sync analysis; and a BMAD party review of
this document ([`reviews/party-review.md`](./reviews/party-review.md)),
whose findings are folded in above.
