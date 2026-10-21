# Restore-point overhead (#874)

> **Snapshot of one run on 2026-10-21, commit `4fa8072`, not refreshing.** AMD Ryzen 5 5600X 6-Core Processor              (12 threads, 31.9 GB), win32 10.0.26200, Chromium 149.0.7827.55. Evidence only when it ran on the owner's desktop under `docs/performance/benchmark-protocol.md` and is committed; a cloud container's run is indicative only. To refresh, run `npm run perf:restore` (`scripts/perf-restore-points.ts`); `src/tests/perfRestore/report.test.ts` pins how these figures are computed.

What it measures: the work the runtime fallback's restore points add to a hosted tower. Every engine save the host already reads is a restore point at no cost: a merge's, and a hosted save's (an undo capture, an autosave, an export; each read the engine's save on main too). The points add an engine save only when a tick's events would leave the engine with no point behind them, plus each relayed command's pull of its own events. Each workload runs on the hosted tower at each CPU throttle, in a fresh browser process per repetition, and every step ends with the frame loop's event drain:

- **plain**: 240 steps of 2 game minutes, no commands.
- **drag**: 40 steps, each placing one floor tile first (a structural command that merges at the next sync, as a floor drag does).
- **click**: 240 steps with a rent change every 20 (a plain command with an event).
- **edits**: 40 steps, each a whole gesture: an undo capture, one floor tile and the commit, as rapid single clicks are.

## Steps

Step times are the median over repetitions of each run's median and 95th percentile, and the slowest step of any run. *Pulls* is the time inside the engine's event exports per step, and its share of the step.

| Scenario | Workload | CPU | Reps | Step median ms | Step p95 ms | Step max ms | Pulls ms/step | Pull share |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| small | plain | 1x | 10 | 0.418 | 0.739 | 12.1 | 0.003 | 0.37% |
| small | plain | 4x | 10 | 2.7 | 3.4 | 71.2 | 0.022 | 0.49% |
| small | drag | 1x | 10 | 7.1 | 9.4 | 14.3 | 0.013 | 0.18% |
| small | drag | 4x | 10 | 49.4 | 61.1 | 72.0 | 0.107 | 0.22% |
| small | click | 1x | 10 | 0.415 | 0.716 | 11.5 | 0.003 | 0.42% |
| small | click | 4x | 10 | 2.7 | 3.4 | 72.2 | 0.027 | 0.59% |
| small | edits | 1x | 10 | 9.9 | 12.8 | 15.5 | 0.016 | 0.16% |
| small | edits | 4x | 10 | 68.8 | 81.3 | 99.3 | 0.120 | 0.17% |
| medium | plain | 1x | 10 | 1.2 | 2.8 | 87.4 | 0.004 | 0.12% |
| medium | plain | 4x | 10 | 8.0 | 10.9 | 352.7 | 0.026 | 0.14% |
| medium | drag | 1x | 10 | 44.0 | 57.1 | 85.1 | 0.019 | 0.04% |
| medium | drag | 4x | 10 | 285.1 | 340.1 | 370.4 | 0.113 | 0.04% |
| medium | click | 1x | 10 | 1.2 | 2.8 | 61.3 | 0.004 | 0.14% |
| medium | click | 4x | 10 | 8.0 | 11.1 | 358.4 | 0.030 | 0.17% |
| medium | edits | 1x | 10 | 59.3 | 72.3 | 102.6 | 0.027 | 0.04% |
| medium | edits | 4x | 10 | 391.5 | 451.4 | 504.9 | 0.196 | 0.05% |
| large | plain | 1x | 10 | 5.7 | 9.2 | 259.6 | 0.006 | 0.06% |
| large | plain | 4x | 10 | 36.3 | 44.4 | 1052.2 | 0.051 | 0.07% |
| large | drag | 1x | 10 | 140.7 | 197.3 | 236.4 | 0.026 | 0.02% |
| large | drag | 4x | 10 | 928.4 | 1005.2 | 1150.4 | 0.148 | 0.02% |
| large | click | 1x | 10 | 5.6 | 8.7 | 207.2 | 0.007 | 0.07% |
| large | click | 4x | 10 | 36.2 | 43.4 | 1092.3 | 0.051 | 0.08% |
| large | edits | 1x | 10 | 196.0 | 255.7 | 307.9 | 0.046 | 0.02% |
| large | edits | 4x | 10 | 1289.2 | 1376.3 | 1473.7 | 0.255 | 0.02% |

## Saves

Counts are summed over the repetitions. *Hosted saves* are the tower's own saves (each undo capture reads one). *Extra saves* are engine saves beyond the merges' and the hosted ones: the restore points' own cost, which the design expects to be 0. *Saves per command* and *save ms per command* count every engine save, merges' and captures' included, so they show what serialization costs each edit. *One point* is what a single restore point costs on that tower (`engine.serialize`), and *point size* its length; the host holds up to three. *Restore* is what a fallback pays once, at the fault (parse the point and load it on TypeScript).

| Scenario | Workload | CPU | Commands (accepted) | Merges | Hosted saves | Extra saves | Saves per command | Save ms per command | Extra save ms/step | One point ms | Point size (M chars) | Restore ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| small | plain | 1x | 0 (0) | 80 | 0 | 0 | n/a | n/a | 0.000 | 1.6 | 0.11 | 3.0 |
| small | plain | 4x | 0 (0) | 80 | 0 | 0 | n/a | n/a | 0.000 | 11.0 | 0.11 | 20.9 |
| small | drag | 1x | 400 (400) | 400 | 0 | 0 | 1.00 | 1.6 | 0.000 | 1.6 | 0.12 | 2.9 |
| small | drag | 4x | 400 (400) | 400 | 0 | 0 | 1.00 | 10.7 | 0.000 | 11.3 | 0.12 | 20.0 |
| small | click | 1x | 120 (120) | 80 | 0 | 0 | 0.67 | 1.0 | 0.000 | 1.5 | 0.11 | 2.9 |
| small | click | 4x | 120 (120) | 80 | 0 | 0 | 0.67 | 7.2 | 0.000 | 11.0 | 0.11 | 20.5 |
| small | edits | 1x | 400 (400) | 400 | 400 | 0 | 2.00 | 3.3 | 0.000 | 1.6 | 0.12 | 2.9 |
| small | edits | 4x | 400 (400) | 400 | 400 | 0 | 2.00 | 21.7 | 0.000 | 11.2 | 0.12 | 20.1 |
| medium | plain | 1x | 0 (0) | 80 | 0 | 0 | n/a | n/a | 0.000 | 8.7 | 0.65 | 18.4 |
| medium | plain | 4x | 0 (0) | 80 | 0 | 0 | n/a | n/a | 0.000 | 60.4 | 0.65 | 123.1 |
| medium | drag | 1x | 400 (400) | 400 | 0 | 0 | 1.00 | 9.1 | 0.000 | 8.8 | 0.65 | 17.7 |
| medium | drag | 4x | 400 (400) | 400 | 0 | 0 | 1.00 | 60.2 | 0.000 | 60.9 | 0.65 | 117.8 |
| medium | click | 1x | 120 (120) | 80 | 0 | 0 | 0.67 | 5.9 | 0.000 | 8.7 | 0.65 | 18.2 |
| medium | click | 4x | 120 (120) | 80 | 0 | 0 | 0.67 | 39.8 | 0.000 | 60.6 | 0.65 | 124.9 |
| medium | edits | 1x | 400 (400) | 400 | 400 | 0 | 2.00 | 18.0 | 0.000 | 8.8 | 0.65 | 17.6 |
| medium | edits | 4x | 400 (400) | 400 | 400 | 0 | 2.00 | 119.8 | 0.000 | 60.3 | 0.65 | 115.3 |
| large | plain | 1x | 0 (0) | 80 | 0 | 0 | n/a | n/a | 0.000 | 31.6 | 2.38 | 61.4 |
| large | plain | 4x | 0 (0) | 80 | 0 | 0 | n/a | n/a | 0.000 | 215.1 | 2.38 | 399.6 |
| large | drag | 1x | 400 (400) | 400 | 0 | 0 | 1.00 | 31.5 | 0.000 | 31.0 | 2.27 | 58.7 |
| large | drag | 4x | 400 (400) | 400 | 0 | 0 | 1.00 | 205.6 | 0.000 | 214.1 | 2.27 | 389.8 |
| large | click | 1x | 120 (120) | 80 | 0 | 0 | 0.67 | 20.8 | 0.000 | 31.4 | 2.39 | 60.8 |
| large | click | 4x | 120 (120) | 80 | 0 | 0 | 0.67 | 138.6 | 0.000 | 216.6 | 2.39 | 403.8 |
| large | edits | 1x | 400 (400) | 400 | 400 | 0 | 2.00 | 63.0 | 0.000 | 30.7 | 2.27 | 58.8 |
| large | edits | 4x | 400 (400) | 400 | 400 | 0 | 2.00 | 412.7 | 0.000 | 213.4 | 2.27 | 393.1 |

## Problems

None.
