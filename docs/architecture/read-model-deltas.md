# Research: an incremental engine read model

> **Snapshot, written 2026-10-15 from three result folders, none of them refreshing.** Timings: the perf:worker runs on commit `e25ec01` (app 2.34.1), Ryzen 5 5600X, RTX 3060, in `docs/performance/results/2026-10-15-e25ec01c-worker-1280x720/` and `docs/performance/results/2026-10-15-e25ec01-worker/` (640x360). Save shape and churn: `docs/performance/results/2026-10-15-209dfbe-read-model/` (commit `209dfbe`, app 2.34.1, Node 22.22.0, TypeScript engine). Live numbers: re-run `npm run perf:worker` for the timings and `npm run perf:worker -- --read-model` for the shape (both in `src/tests/perfWorker/`, arithmetic pinned by `src/tests/perfWorker/analysis.test.ts`). Figures marked **(derived)** are computed here from a code layout, not read off a row.

Status: research and recommendation. The only code it brought is the read model section of the perf harness (`src/tests/perfWorker/readModel.ts`). Vetted by a BMGD party (game architect, game dev, UX/perf); the transcript is `_bmad-output/party-mode/read-model-deltas-party-2026-10-15.md`. It feeds backlog row `engine-rs-binding-read-model` (#868), which already names "a structural snapshot instead of a save deserialization" and "typed arrays over WASM memory" as open items. The implementation is tracked as the worker host speed plan (section 7): #1048, #1045, #1049, #1050 and #1051.

## 1. The finding in one paragraph

Both engine-to-UI channels re-send state that did not change. On the worker host, **most main-thread time is the hourly full-save merge** (large, 1x: 2207 of 2585 ms over 720 steps; medium 647 of 803; small 134 of 160). On the large tower the save is **99.91% unit records**, and **40,083 of its 43,358 units are `floor` tiles**, 77.9% of the save on their own. Of the 24 merges in the hosted rows' 720 steps, the median merge on the large tower changed **no unit at all**, and the busiest changed 2,887 (6.7%); on medium the median merge changed 0.1% of units and the busiest 2.1%, on small 1.5% and 5.0%. The per-frame view has the same shape: unit records are 43,358 × 6 numbers × 8 bytes = 1.98 MiB of the measured **2.00 MiB per reply** (derived from the layout in `engine-rs/src/frame.rs`), so people and cars are about 1% of it. At the frames rows' 120 sim minutes per second an hour pass lands every half second, which is the large-tower stutter: frame p99 **89.5 ms** on the worker host against 15.5 ms on TypeScript, 1% low **9.4 fps** against 48.7. The 640x360 run reads the same (p99 89.2 ms, 1% low 9.82 fps), so the cost is read-model sync, not rendering.

## 2. Where full rebuilds happen today

| # | Site | What is rebuilt | When | Cost evidence |
|---|---|---|---|---|
| 1 | `EngineWorkerCore.ops` (`workerCore.ts`): `engine.serialize()` + `elevatorTelemetry()` | The whole save as a JSON string, in the worker | Every hour pass (`onHourRuns` moved), every revision bump, every refused op (`fail()` resets `sentRevision`), every `merge: true` request | Worker side, inside "worker engine time" |
| 2 | Structured clone of the reply | The 4.49 MiB save string unpacked on the main thread | Every merge reply | Not in the hosted rows (limitations note); in the frames rows |
| 3 | `parseMerge` (`workerApply.ts`): `Simulation.deserialize(JSON.parse(save))` | A whole second `Simulation` | Every merge | With row 4, the 2207 ms of hosted main-thread merge time over the 24 merges at large, 1x |
| 4 | `mergeSimulation` / `mergeTower` / `mergeById` (`merge.ts`) | Walks every Simulation and Tower key, `Object.assign` on all 43,358 units, rebuilds `byId` and `transportsById`, clears and refills Tower maps, replaces non-Map fields (which resets the revision-keyed caches such as `stopsCache`) | Every merge | Inside row 3's 2207 ms; cache resets add lazy rebuild work afterwards |
| 5 | `frame_view` (`engine-rs/src/frame.rs`) and the binding copy | A fresh `Vec<f64>` of every person, every unit, every car, copied out to a `Float64Array` | Every reply (worker) or every step (`wasm`) / frame (`wasm-frame`) | 2.00 MiB per reply at large, 99.81 MiB/s received (frames, 1x) |
| 6 | `checkRecords` + `applyRecords` (`frameApply.ts`) | Two passes over the whole array, one `byId` lookup and six writes per unit | Every reply | Inside the main-thread time left after the merges (2585 ms less 2207 at large, 1x, over 180 batches) |
| 7 | `decodeFrame` + `syncPeople`/`syncUnits`/`syncCars` (`wasmHost.ts`, step mode) | Intermediate record objects for the whole frame | Every step (up to 4 a frame) | Why `wasm` (6784 ms hosted, large 1x) trails `wasm-frame` (4519 ms) |
| 8 | Main-thread hosts' `merge` (`wasmHost.ts`) | Same as rows 1, 3 and 4 on the main thread, with no worker to hide the serialize | Every hour pass or revision | Shared by `wasm` and `wasm-frame` |

Already incremental: gameplay events (one drain per reply), the log (`logSince` cursor), the pending choice (sent only while up), and the frame-view routes (`setRoute` writes only on change).

## 3. Candidate designs

All three must keep the existing parity bar: the step, coalesced and worker hosts reach the same exact engine save, read model, crowd, cars, counters, log, events, money and clock (`wasmWorkerHost.integration.test.ts`), and the conformance digest across ts and wasm is unchanged (`conformanceWasm.integration.test.ts`).

### A. "Changed since last sent", computed in the engine (recommended)

The engine keeps, per consumer, what it last sent, and emits only what differs.

- **Save channel.** A binding call next to `serialize()` (call it `saveDelta`) returns the changed top-level keys whole (at large, 1x the merges moved `events`, `ledger`, `log`, `minutes`, `seed` and `transports`; small and medium also `money`) and, for `units`, the records whose serialized form differs from the last sent copy, plus a removed-id list and the order when it changed. The main thread applies records onto the existing unit objects through the same per-unit decode `Simulation.deserialize` uses, and updates `byId` only for added and removed ids.
- **Frame channel (second step).** Unit records in the frame view become "changed since last reply" with the total unit count kept in the header for checking. People and cars stay whole until a row says otherwise (dwelling people are the only static ones).
- **Keyframes.** The cache resets and a full payload goes out on load, a refused op (the existing `fail()` path), a fatal and restart, a tower swap, and any `merge: true` request (`settle`, exact saves). A delta is always relative to a keyframe the consumer acknowledged; a sequence number on each delta lets the main thread refuse a gap and ask for a keyframe.
- **Cost.** Engine-rs: a last-sent cache (about 2 MiB for frame unit records plus the per-unit save bytes or a hash of them at large; check the memory rows) and a compare pass, sub-millisecond for 43k fixed-width records. Protocol: a versioned delta message and a keyframe flag. TypeScript: `merge.ts` gains a delta apply beside the full merge, used by all three WASM hosts.
- **Fidelity.** Correct by construction for content: there is no field list to forget, because it compares outputs, not writes. Risks: (1) the cache must stay out of the save, `state_view` and the conformance digest, or ts and wasm stop agreeing; (2) applying a raw record could skip a normalization `Simulation.deserialize` does, so the apply must reuse the per-unit decode; (3) the revision-keyed caches stop being reset every hour (they reset today as a side effect of `mergeTower`), which #868 already wants made deliberate; (4) synchronous `serialize` callers get the read model's save more often, since replies stop carrying a full save. That is sound only if the delta carries every save key, `seed` included; the async paths keep using `settle` and stay exact; (5) the worker reply path now parses and shape-checks everything a reply carries before writing any of it (`workerApply.ts`, PR #1030), and a delta has to join that rule: read and check it whole, then apply.

### B. Engine-tracked versioned slices (the #868 "structural snapshot")

Per-slice revisions in the engine (structure: the existing `tower.revision`; hourly unit state; economy and ledger; events; telemetry; RNG and memos), with a typed "hourly view" like `frame_view` for the mutable unit fields, and the structure sent only when `revision` moves.

- **Cost.** Smallest payloads and no last-sent cache, but every write site in engine-rs must bump the right slice, and the hourly view needs a fixed layout mirrored in TypeScript, as `PERSON_FIXED` is today.
- **Fidelity.** The highest drift risk of the three: a field written without its slice bump, or added to the save but not to a slice, drifts silently. That is the `KEEP`-set problem the 2026-10-13 note on #868 records. It needs a coverage guard (every save field is in exactly one slice) and still benefits from A's equality test. Worth revisiting once A's delta sizes are known; if A's hourly delta is already small, B's extra savings do not pay for the risk.

### C. Shared memory or zero-copy reads

A `SharedArrayBuffer` over WASM memory, or the read model living in typed arrays the UI reads in place.

- **Rejected for now.** Production is not cross-origin isolated (`docs/architecture/wasm-worker-host.md`, "Rust and WASM threads"), while the benchmark page is (`cross-origin isolated: true` in both reports), so a prototype would look best exactly where players are not. The renderer and every panel read TypeScript objects, so zero-copy bytes have no consumer without a UI rewrite. Transferables are already used for the frame view; moving the save to a transferred UTF-8 or binary buffer would only swap the structured clone for a decode, and the parse and merge (rows 3 and 4) remain.

## 4. Recommendation

Adopt **A**, save channel first, frame-view unit records second, with one "changed since last sent" contract (the same cache, keyframe triggers and sequence check) shared by both channels and by all three WASM hosts. The party argued the order. The frame-view delta is smaller and lower risk. The save delta removes the twice-a-second judder the player sees, and it carries most of the measured main-thread cost (2207 of 2585 ms at large, 1x). The order follows the cost. Do not adopt B or C now.

The save shape and churn are governed rows now (`npm run perf:worker -- --read-model`, section 6); size the design from them, and add the delta rows section 6 still lists as it lands.

Design A is what the worker host speed plan builds (section 7): the save half is #1045 and the frame half is #1049. Their issues set the acceptance bars and the rule that change detection must prove a net saving; this doc is the research behind them.

## 5. The rows that would prove it

Compare against this snapshot on the same machine, `wasm-worker` column unless noted; the `wasm` and `wasm-frame` columns should move too, since all three hosts share the apply.

| Section | Row | Large 1x now | Target |
|---|---|---|---|
| hosted | main-thread merge time, 720 steps | 2207 ms | under 10% of today |
| hosted | main-thread time, 720 steps (`wasm-worker` / `wasm-frame` / `wasm`) | 2585 / 4519 / 6784 ms | worker toward TypeScript's 692 ms |
| hosted | main-thread time per batch, p95 / max | 93.3 / 112 ms | under 16 ms (one frame) |
| traffic | full-save bytes per merge | 4.49 MiB | keyframes only; new delta row in tens to hundreds of KiB |
| traffic | full-save merges, 720 steps | 24 | 0 in steady play (keyframes counted apart) |
| traffic | frame view bytes per reply (step two) | 2.00 MiB | about the people and cars share, tens of KiB |
| traffic | bytes received per second (frames) | 99.81 MiB/s | down by the same factor |
| frames | frame time p99 | 89.5 ms | toward 15.5 ms |
| frames | 1% low FPS | 9.41 fps | toward 48.7 fps |
| frames | main-thread blocking (long tasks past 50 ms) | 1317 ms | 0 |
| frames | sim minutes per second, large 4x | 61.8 min/s | toward 120 min/s |
| memory | JS heaps + WASM memory | 205.17 MiB | no worse than the last-sent cache's size |

The frames rows are the acceptance bar, not the hosted rows alone, because the hosted rows leave out the structured clone of each reply.

## 6. Fidelity gates and proposed measurements

- **Equality test.** At every hour pass on small, medium and large, and through a command stream (build, demolish, a refused command, a mid-run load, a settle), the delta-applied read model equals the full-merge read model field for field (the `WasmParityError` fingerprint covers most of it), on all three WASM hosts.
- **Digest unchanged.** The conformance digest and `state_view` read nothing from the last-sent cache; the existing ts/wasm conformance run is the check.
- **Keyframe chaos.** Dropped or reordered delta (sequence gap) leads to a keyframe request, never a silent apply.
- **Harness rows (governed by `analysis.test.ts`):** save composition by top-level key and by unit kind; units changed per merge; delta bytes per hour pass; delta apply time; keyframes per run. The first two landed with this doc as the read model section (appendix); the delta rows land with the implementation.

## 7. The tracked plan

The worker host speed plan carries this research as issues; each issue body lists the sequence and its acceptance rows.

1. #1048: split the worker host's costs in perf:worker. The read model rows this doc cites (save composition by key and unit kind, units changed per merge, and changed units the frame cannot carry) are part of it.
2. #1045: replace the hourly full-save merge with a revisioned delta (design A, save channel).
3. #1049: send only changed unit records in the per-reply frame (design A, frame channel). On the large tower 40,083 of the 43,358 units are `floor` tiles, which bears on its change-detection choice: most records never change, so a skip that is cheap per static record matters more than a fast compare.
4. #1050: carry structural edits in the delta instead of a full-save merge.
5. #1051: close the Rust engine's bare-step gap, alongside steps 2 to 4.

One open question for #1045 and #1049: the one-off probe in #1045 (WASM package) counted 674 units changed per hour pass on the large tower, 554 of them outside the frame's fields, while the read model rows (TypeScript engine, the hosted rows' warm steps and batches) give a median of 0 and a maximum of 2,887 changed, and at most 70 outside the frame. The two measurements differ in engine, start point and summary, so they are not yet comparable; #1048's committed probe on the WASM engine should settle which shape the delta is sized for.

## Appendix: the read model rows

From `docs/performance/results/2026-10-15-209dfbe-read-model/report.md` (`npm run perf:worker -- --read-model`, `src/tests/perfWorker/readModel.ts`). Each scenario loads its save in Node on the TypeScript engine, runs the hosted rows' 120 warm steps, then their 720 steps of 2 minutes in batches of 4, and counts a merge after each batch where the worker host would merge (the hour-pass counter or the tower revision moved). It counted 24 merges in each scenario, all on hour passes, the same count as the hosted rows' full-save merges. Sizes are JSON characters. A unit "changed" when it is in both saves and its record differs; shares are of the units present. "Outside the frame" counts changed units whose changed fields are all ones the frame view's unit record (`UnitRecord`: state, occupants and the three visit counters) does not carry, so only a merge delivers them.

| Scenario | Save chars | Units | `floor` units (share of save) | `units` key share | Units changed per merge, median / max | Changed outside the frame, median / max | Unit fields that changed |
|---|---|---|---|---|---|---|---|
| small | 114,553 | 2,240 | 1,960 (75.3%) | 98.9% | 1.5% / 5.0% (34 / 112) | 33.5 / 34 | `occupants`, `patronageToday`, `patronageYest`, `pendingIncome`, `profitToday`, `profitYest`, `satisfaction` |
| medium | 649,169 | 12,062 | 10,129 (70.1%) | 96.7% | 0.1% / 2.1% (17 / 258) | 9 / 20 | the small list plus `state` |
| large | 2,336,909 | 43,358 | 40,083 (77.9%) | 99.9% | 0.0% / 6.7% (0 / 2,887) | 0 / 70 | `dirtyDays`, `occupants`, `satisfaction`, `state`, `vacateAt`, `vacateReason` |

Top-level keys that changed across the merges: small `events`, `ledger`, `minutes`, `money`, `seed`, `transports`, `units`; medium those plus `lastQuarterMoney` and `log`; large `events`, `ledger`, `log`, `minutes`, `seed`, `transports`, `units`. No merge added or removed a unit. The WASM engine reaches the same end state (the hosted end-state digests agree), but its intermediate saves were not compared. The timings the scratch pass took (parse plus deserialize per save) are not governed and are left out; the hosted merge-time row covers that cost.
