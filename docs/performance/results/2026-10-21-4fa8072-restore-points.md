# #874 restore-point saves at 4fa8072, 2026-10-21

**Snapshot of 2026-10-21, not refreshing.** One `npm run perf:restore -- --reps 10` run on main at `4fa8072` (the #1101 merge), on the owner's PC with full Chromium 149, 03:17Z to 03:59Z. Live numbers come from re-running it. Raw data: [verticopolis-benchmarks](https://github.com/maniator/verticopolis-benchmarks/tree/main/results/2026-10-21-4fa8072-restore-points) (private repository).

## Top numbers

- The rapid-edit check passes: every `edits` row (small, medium, large, at 1x and 4x) shows 400 commands, 400 merges, 400 hosted saves (one per command, the undo capture's own save) and 0 extra saves. Extra saves are 0 on all 24 rows. The report's problems line reads "None".
- Idle CPU before the run was noisy (8, 26, 45, 3, 17%). The check counts saves, so the noise does not touch it; the timings are context only.

## What it shows

- Undo capture saves once per command and no more, on all three towers. This is the evidence for the restore-point behavior of #874.
