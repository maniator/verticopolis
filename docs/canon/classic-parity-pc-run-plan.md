# Classic parity: original-game PC run plan

Written 2026-10-30. This records how the approved original-SimTower test run (the "classic parity" spec, 33 scenarios) is split, what is run first, and how a full run would be done later. It is a plan and a hand-off note. **No scenario has been run yet and no result exists.**

The spec is copied into the repository as [classic-parity-pc-test-spec.md](./classic-parity-pc-test-spec.md) (the original is the project file `release-3.0/classic-parity/pc-test-spec-2026-10-30.md`). It has 33 scenarios: T1, T2 (2); O1 to O3 (3); E1 to E4 (4); X1 (1); M1 to M3 (3); R1, R2 (2); S1 (1); L1 (1); C1 to C5 (5); F1 (1); PK1 to PK10 (10).

## Status

Evidence means a kept screenshot or saved `.TDT` from the original game. Updated 2026-10-30 after the first PC run (no building; real saves only). Every result is from **SimTower v1.0**: the disc binary on the PC (`simtower.exe`, 6,566,400 bytes) shows "SimTower v1.0" in its about text, not 1.1B, so any v1.0 versus 1.1B difference is unknown.

| Scenario | Status | Observation and evidence |
|---|---|---|
| Version check | observed | The about text in the exe reads "SimTower v1.0". Evidence: that string in the extracted `simtower.exe`. |
| PK8, TOWER7 | observed, with gaps | Loaded unmodified and saved at once (`T7A`, game minute 23,814, 1,481 game minutes after the file's 22,333), then saved again (`T7B`, minute 30,989, 7,175 game minutes or about 5 game days later). Hotel rooms: 29 dirty and 136 empty in the file, 165 empty at `T7A`, still 165 empty and none asleep at `T7B`. Occupied offices 238 in all three, units 14,789 in all three, funds 924,653,000 then 925,618,000 then 928,649,000. Parking floors B1 to B9 show cars in the stalls and no red X (screenshots of the untouched save with only the saved view shifted). Gaps: suite and office evaluation colors were not read (the Query tool was not used), and the five floors the loader reads as unserved were not compared one by one. |
| PK8, MYTOWER | observed, with gaps | Saved at once (`TMA`, minute 62,865) and again (`TMB`, minute 74,880, which is 12,015 game minutes or about 8.3 game days later). Hotel: 215 empty in the file and in `TMA`, 215 asleep in `TMB`. Occupied offices 307 in all three, units 15,238 in all three, funds 955,094,300 then 956,985,400 then 963,935,700. Gaps: red X stalls and evaluation colors were not recorded. |
| PK8, TOWER1 | incomplete | Saved at once (`T1A`, 248,616 bytes, the same size as the file). The later save did not write in two attempts, so there is no later comparison and no connected-stall count. |
| PK10 | incomplete, not run | It needs three built parking rows (no gap, 1-tile gap, 3-tile gap) and the connected-stall count read from a saved file. I did not build them and I have not located that count field in the file with confidence. The only related observation is the TOWER7 B5 row in the original: the paving pieces at tiles 138 to 141 and 149 to 150 draw as plain blocks, and no stall there shows a red X. |
| Every other scenario (30 more) | not run | none |

## What the harness can and cannot do (learned 2026-10-29)

Works: load a `.TDT` headlessly under Wine in Docker, screenshot it, run it for a while, File > Save from a script (the Windows output path needs a backslash variable, see `tools/simtower/README.md`), read the saved bytes, and drive a live container with `docker exec` and `xdotool`.

Does not work reliably: placing buildings by scripted clicks (the toolbar and map windows change focus), and starting a new game without a save (the title screen stays up). So a run that needs a tower with a given layout must either build that tower in code and export it, or have a person place it with `./run.sh`.

## Subset C (no building): first run done 2026-10-30

These need only real saves already in the repository (`conformance/fixtures/tdt-reddit/`):

- **PK8** real saves: load TOWER7, MYTOWER and TOWER1 unmodified. Record suite and office colors, red X stalls, and for TOWER7 the five parking floors the loader reads as unserved. Save at once and again 24 game hours later and diff.
- **PK10** stall gaps: TOWER7's own parking row (stalls behind a 1-tile and a 3-tile gap from the ramp). Record the red X and the connected-stall count in the saved file.
- Version check of the disc binary.

## Follow-up: full run (option A)

Build each remaining scenario's tower in code with the Rust engine, export it as `.TDT`, load it in the original, run it for the required game days (use a persistent container and save at the needed moments), and read results from the re-saved files and screenshots. Order: E1 to E4 with PK5, PK1 and PK2, T1 and T2, O1 to O3, R1 and R2, X1, S1, M1 to M3, then L1, C1 to C5, F1, PK3 to PK7 and PK9. Known limits of this route: the exporter does not reproduce the per-stall tail records or the parking connected list, so the PK scenarios that read those need the tower built in the game by a person.

Tracked in issue [#1543](https://github.com/maniator/verticopolis/issues/1543).
