# Measurements for the A vs B review (cloud, exploratory)

> **Snapshot, exploratory, never evidence.** Cloud container (Intel Xeon
> 2.8 GHz, 4 cores, 16 GB), Node 22.22.0, no browser, no renderer, no GPU.
> Run on 2026-10-20 between about 20:40 and 21:10 UTC against `main` at
> `9cd44d1` (app 2.40.0, engine crate 0.2.0, after #1139). These figures
> compare designs on one machine in one process; they do not stand in for
> the PC protocol (release plan section 5, the #1164 fresh-page harness on
> the counting Chromium), which is where any acceptance number comes from.
> They are not cross-engine acceptance ratios, and the a532572 PC figures the
> owner quoted stay motivation only. The scripts, raw results and the
> prototype's diff are in the project's shared folder under
> `release-3.0/rust-facade/bench/`; rerun them to get current numbers.

## What was measured

The perf harness's step plan: load a scenario save, run 120 warm steps on a
throwaway instance, then time 720 steps of 2 game minutes (one game day,
25 hour boundaries) on a fresh instance. Every configuration drains gameplay
events once every 4 steps, the way the app does once per rendered frame
(about 4 steps per frame at 1x on the PC). Configurations run interleaved in
one process, the order reversed on alternate repetitions, 7 repetitions each.

| Config | What runs |
| --- | --- |
| `bare` | `Engine.tick` only, no read model at all |
| `ts` | The TypeScript `Simulation` alone (the fallback engine, and the reference) |
| `A-step` | Today's 3.0 default host: `attachWasmHost(sim, …, { sync: "step" })` on a TypeScript `Simulation`, which decodes `frameView` into the instance every step and runs the full `serialize` / `JSON.parse` / `Simulation.deserialize` / `mergeSimulation` on every hour and every revision change |
| `A-frame` | The coalesced host (`?engine=wasm-frame`): the same, with the frame applied once per rendered frame |
| `B-up-s`, `B-up-f` | No TypeScript `Simulation`: the engine plus a typed-array view (people as structure-of-arrays, unit dynamic slots, cars, the header) read from today's `frameView`, every step (`-s`) or every 4 steps (`-f`) |
| `B-chg-s`, `B-chg-f` | The same view fed by a prototype export that carries only the unit records that changed since the last read (`frameDynamicProto(0)`) plus a structural snapshot (`structureProto`) read on load |
| `B-pc-f` | The same with no unit records at all (people and cars only), a lower bound |

The prototype exports are a measurement-only patch to `engine-rs/src/wasm.rs`
(`proto-wasm.diff`, never pushed). `frameDynamicProto` builds the full frame
in Rust and then compares all unit records against the last ones it sent, so
it pays a walk over every unit per read. That walk breaks HP-2's per-frame
budget and a shipped version would replace it with dirty marks set where the
fields change (#1049's rule), so the `B-chg` rows are an upper bound for B
and `B-pc-f` a lower bound.

Scenarios (`buildScenarios()` in `src/tests/perfCompare/scenarios.ts`,
the PC harness's towers):

| Scenario | Save | Units (floor tiles) | Population | Transports | sha256 prefix |
| --- | --- | --- | --- | --- | --- |
| medium | 630 KiB | 12,062 (10,129) | 3,240 | 15 | `159b444c6a652384` |
| large | 2,107 KiB | 43,358 (40,083) | 17,322 | 5 | `e0db69ea489132e2` |

## Throughput and step pacing, 720 steps

Medians of 7 repetitions; the range is min to max. "MiB read" is what
crossed from WASM into JavaScript for the view (A's crossings are not
counted). "Merges" counts full-save merges in the timed window.

**Run 1** (`results.json`): every design, interleaved.

| Scenario | Config | Total ms | Step p99 ms | Step max ms | GCs | GC ms | MiB read | Merges |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| medium | bare | 395 (342 to 473) | 3.9 | 11.8 | 0 | 0 | 0 | 0 |
| medium | A-step | 5,200 (4,905 to 5,634) | 114.4 | 143.7 | 135 | 406 | n/a | 25 |
| medium | A-frame | 3,507 (3,406 to 3,660) | 114.3 | 143.0 | 48 | 219 | n/a | 24 |
| medium | B-up-s | 809 (738 to 911) | 4.3 | 13.7 | 15 | 11 | 411.4 | 0 |
| medium | B-up-f | 497 (464 to 598) | 4.1 | 10.9 | 6 | 5 | 102.9 | 0 |
| medium | B-chg-s | 603 (548 to 652) | 3.9 | 12.0 | 0 | 0 | 13.9 | 0 |
| medium | B-chg-f | 415 (395 to 458) | 3.4 | 11.2 | 0 | 0 | 3.5 | 0 |
| medium | B-pc-f | 415 (387 to 455) | 3.5 | 11.6 | 0 | 0 | 3.5 | 0 |
| large | bare | 513 (488 to 552) | 6.8 | 29.7 | 0 | 0 | 0 | 0 |
| large | A-step | 18,515 (17,746 to 18,627) | 398.2 | 460.5 | 410 | 1,626 | n/a | 25 |
| large | A-frame | 11,514 (11,419 to 12,132) | 382.2 | 447.0 | 154 | 883 | n/a | 25 |
| large | B-up-s | 2,264 (1,860 to 2,338) | 9.1 | 37.6 | 43 | 18 | 1,437.9 | 0 |
| large | B-up-f | 1,081 (948 to 1,204) | 8.9 | 31.6 | 15 | 17 | 359.5 | 0 |
| large | B-chg-s | 1,489 (1,334 to 1,658) | 7.9 | 33.5 | 0 | 0 | 9.3 | 0 |
| large | B-chg-f | 832 (776 to 1,031) | 8.0 | 31.2 | 0 | 0 | 2.6 | 0 |
| large | B-pc-f | 711 (662 to 805) | 7.1 | 30.6 | 0 | 0 | 2.2 | 0 |

**Run 2** (`results-ts.json`): the TypeScript engine against `bare` and B,
interleaved. Ratios below are within this run only.

| Scenario | Config | Total ms | Step p99 ms | Step max ms | GCs | GC ms |
| --- | --- | --- | --- | --- | --- | --- |
| medium | bare | 399 (368 to 435) | 3.8 | 11.4 | 0 | 0 |
| medium | ts | 2,015 (1,930 to 2,233) | 13.4 | 61.8 | 37 | 31 |
| medium | B-chg-f | 494 (427 to 545) | 4.3 | 12.0 | 0 | 0 |
| medium | B-pc-f | 449 (374 to 477) | 3.6 | 11.6 | 0 | 0 |
| large | bare | 604 (519 to 624) | 7.5 | 32.1 | 0 | 0 |
| large | ts | 3,300 (3,166 to 3,597) | 23.8 | 102.8 | 46 | 36 |
| large | B-chg-f | 883 (724 to 1,097) | 8.5 | 31.2 | 0 | 0 |
| large | B-pc-f | 742 (691 to 783) | 7.6 | 33.5 | 0 | 0 |

What the two runs show, within each run:

- **A's cost is the mirror, and mostly the merge.** A-step is 13x bare on
  medium and 36x on large. A full merge costs about 105 ms on medium and
  370 ms on large (the command pass below), so the 25 merges are about half
  of A-step's time and most of A-frame's. The rest is decoding the frame,
  all 43,358 unit records included on large, into TypeScript objects. Every
  merge is a long task: A's step p99 is 114 ms and 398 ms.
- **B costs a little more than bare.** B-chg-f adds 0.02 to 0.1 s on medium
  and about 0.3 s on large over 720 steps (about 0.1 to 0.5 ms and 1.5 to 1.8 ms
  per rendered frame) with the prototype's full-frame build and walk still in
  it; B-pc-f adds about half of that. Step p99 stays within about 1 ms of
  bare, and B triggers no garbage collection.
- **Reading the whole frame every frame is the next cost.** B-up-f moves
  360 MiB per game day on large, nearly all of it unit records that did not
  change; carrying only changed units cuts it to 2.6 MiB. This is #1049's
  finding, and B needs it on both hosts.
- **Against the TypeScript engine in run 2:** B-chg-f is 0.25x of `ts` on
  medium and 0.27x on large, with a lower step p99 (4.3 against 13.4 ms,
  8.5 against 23.8 ms). In Node, without a renderer, both of B's numbers sit
  close to bare's. The PC protocol decides whether that holds in the browser.

## Memory

One process per row (`mem.ts`): load, 60 steps, then two forced GCs. "Heap
delta" is the JavaScript heap over the process's baseline (modules loaded,
save text read); "WASM" is the engine's linear memory, which only grows.

| Scenario | Config | Heap delta MiB | WASM MiB | Total delta MiB |
| --- | --- | --- | --- | --- |
| medium | ts | 8.09 | 0 | 8.09 |
| medium | A-step | 7.43 | 36.06 | 43.50 |
| medium | A-frame | 7.43 | 36.06 | 43.49 |
| medium | B-chg | 0.65 | 50.00 | 50.65 |
| large | ts | 21.73 | 0 | 21.73 |
| large | A-step | 21.39 | 127.19 | 148.58 |
| large | A-frame | 21.40 | 127.19 | 148.59 |
| large | B-chg | 1.02 | 127.19 | 128.21 |

- **B drops the mirror's heap** (about 7 MiB on medium, 21 MiB on large),
  which is a copy of the TypeScript engine's own footprint.
- **The engine's linear memory is set by loading the save, in both
  designs.** `memload.ts` reads the linear memory right after
  `Engine.fromSave` and again after 60 steps, a `serialize` and a
  `frameView`: 51.13 MiB on medium and 128.31 MiB on large after the load,
  unchanged by everything after it. `fromSave` parses the whole save into a
  `serde_json::Value` tree (`load::parse_save_json`) before building the
  simulation, and WASM memory never shrinks, so that peak stays for the
  page's life. (A's medium row is lower because its engine boots from the
  instance's re-serialization at attach, AD-8's gap: a text within 1% of the
  save's size whose load peaks at 37.19 MiB instead of 51.13 MiB. The linear
  memory grows in steps, so small differences in a load move it.) Neither A
  nor B touches this. It is the largest single memory
  item against M6's ceiling and needs its own work item (review section 8).

## Commands and queries

`cmd.ts`, medians, ms. A structural command is a `floor` placed on a free
tile; each sample takes the next free tile (40 on medium, 8 on large).

| Measure | medium | large |
| --- | --- | --- |
| A: one forced structure sync (serialize, parse, deserialize, merge) | 116.1 | 429.2 |
| A: a build relayed through the instance, then its step and sync | 104.0 | 368.6 |
| A: a plain step with no sync due | 2.8 | 13.6 |
| B: the engine's `build` | 0.05 | 0.06 |
| B: structural snapshot read after the build | 1.49 | 5.53 |
| B: the next engine step after the build (re-plans routes; both designs pay it) | 0.70 | 30.1 |
| B: structural snapshot size, bytes (5 numbers per unit, floor tiles included) | 483,336 | 1,734,616 |
| B: one unit's detail (`unitAt`, JSON) | 0.007 | 0.005 |
| B: `canBuild` quote | 0.003 | 0.002 |
| TS on the mirror, per frame today: `congestion()` | 1.03 | 1.32 |
| TS on the mirror, per frame today: `crowd.queueView(tower)` | 0.00 | 0.00 |
| TS on the mirror, per overlay frame: `floorHeatmap` | 7.33 | 13.34 |
| TS on the mirror, per UI tick: `stats()` | 1.09 | 5.67 |

`ser.ts`, medians, ms, for restore points and lifecycle:

| Measure | medium | large |
| --- | --- | --- |
| `serialize()` alone | 18.3 | 62.8 |
| `Engine.fromSave` | 51.0 | 184.6 |
| `stateDigest()` | 29.3 | 107.6 |

- Under A every structural command costs a full merge, so every build or
  demolition on a large tower is a 370 ms hitch. Under B it costs the
  snapshot read (a few ms; sending floor tiles as runs would shrink it).
- The 30 ms engine step after a structural edit on large is an engine cost
  either design pays (revision-keyed caches rebuild). It belongs with the
  measured optimizations (#1143), not with this decision.
- Restore points under B need their own `serialize()` (63 ms on large here)
  at whatever cadence #874 picks, since no merge produces one any more.
- `stateDigest` is far too slow for undo's per-command signature; B needs a
  cheap change counter from the engine instead (review section 5.6).

## Not measured here

- The renderer: neither design's drawing cost, and not the cost of adapting
  the renderer to read B's view. This needs the browser and the PC.
- The worker host. Section 8 of the host-sync analysis
  (`release-3.0/host-sync/host-sync-analysis.md`) has exploratory cloud
  figures for the worker on `main` and with #1068's delta, and for the
  coalesced main-thread host with #1068's delta (prototype #1133): that last
  one was 1.19x / 3.83x the TypeScript main-thread time on medium / large,
  about half of the full-merge figure. B's main-thread cost on a worker is the
  view apply alone, the `B-chg-f` minus `bare` difference above.
- 4x speed, frame pacing in a browser, long tasks as the browser reports
  them, and memory in a browser. All of these are PC protocol rows.
