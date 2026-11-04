# Read model shape at df59d0d, 2026-10-15

**Snapshot of 2026-10-15, not refreshing.** One run of `npm run perf:worker -- --read-model` on commit `df59d0d` (app 2.34.1), in Node on the TypeScript engine, not in a browser. Live numbers come from re-running it. Raw data: [verticopolis-benchmarks](https://github.com/maniator/verticopolis-benchmarks/tree/main/results/2026-10-15-df59d0d-read-model) (private repository).

Each scenario loads its save, then runs 720 steps of 2 minutes in batches of 4, and counts what changed at every merge of the worker host (24 merges, one per game hour).

## Top numbers

| Scenario | Units  | Save size       | Units changed per merge (median / max) | Share of units changed (median / max) |
| -------- | ------ | --------------- | -------------------------------------- | ------------------------------------- |
| small    | 2,240  | 109,161 chars   | 34 / 140                               | 1.5% / 6.3%                           |
| medium   | 12,062 | 648,859 chars   | 17 / 258                               | 0.1% / 2.1%                           |
| large    | 43,358 | 2,157,388 chars | 0.5 / 2,888                            | under 0.01% / 6.7%                    |

## What it shows

- Units are 97 to 99.9% of a save, and a merge changes a small share of them (a few percent at most), so shipping only what changed beats shipping the whole save. This fed the design in [read-model-deltas.md](../../architecture/read-model-deltas.md).
- On the large tower the median merge changes half a unit but the worst one touches 2,888, so a delta format has to cope with both.
