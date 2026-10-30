# Classic parity: original-game PC run plan

Written 2026-10-30. This records how the approved original-SimTower test run (the "classic parity" spec, 33 scenarios) is split, what is run first, and how a full run would be done later. It is a plan and a hand-off note. **No scenario has been run yet and no result exists.**

The spec is copied into the repository as [classic-parity-pc-test-spec.md](./classic-parity-pc-test-spec.md) (the original is the project file `release-3.0/classic-parity/pc-test-spec-2026-10-30.md`). It has 33 scenarios: T1, T2 (2); O1 to O3 (3); E1 to E4 (4); X1 (1); M1 to M3 (3); R1, R2 (2); S1 (1); L1 (1); C1 to C5 (5); F1 (1); PK1 to PK10 (10).

## Status

Evidence means a kept screenshot or saved `.TDT` from the original game. As of 2026-10-30 there is none for any scenario.

| Scenario | Status | Evidence |
|---|---|---|
| PK8 | not run | none |
| PK10 | not run | none |
| Version check (1.0 or 1.1B) | not run | none |
| Every other scenario (30 more) | not run | none |

Update this table with observed or incomplete, plus the evidence file, as each one is run.

## Rules for every result

- Original game observation only. A result is canon only when a kept screenshot or saved `.TDT` shows it.
- Mark anything not run with the reason. Do not infer a result.
- The target is Windows SimTower 1.1B. If the disc binary is 1.0, say so in the results (Help, About).
- Say how each tower was made. A tower built through our exporter is "the original game running a tower we built", not a tower built in the game.

## What the harness can and cannot do (learned 2026-10-29)

Works: load a `.TDT` headlessly under Wine in Docker, screenshot it, run it for a while, File > Save from a script (the Windows output path needs a backslash variable, see `tools/simtower/README.md`), read the saved bytes, and drive a live container with `docker exec` and `xdotool`.

Does not work reliably: placing buildings by scripted clicks (the toolbar and map windows change focus), and starting a new game without a save (the title screen stays up). So a run that needs a tower with a given layout must either build that tower in code and export it, or have a person place it with `./run.sh`.

## Run first: subset C (no building)

These need only real saves already in the repository (`conformance/fixtures/tdt-reddit/`):

- **PK8** real saves: load TOWER7, MYTOWER and TOWER1 unmodified. Record suite and office colors, red X stalls, and for TOWER7 the five parking floors the loader reads as unserved. Save at once and again 24 game hours later and diff.
- **PK10** stall gaps: TOWER7's own parking row (stalls behind a 1-tile and a 3-tile gap from the ramp). Record the red X and the connected-stall count in the saved file.
- Version check of the disc binary.

## Follow-up: full run (option A)

Build each remaining scenario's tower in code with the Rust engine, export it as `.TDT`, load it in the original, run it for the required game days (use a persistent container and save at the needed moments), and read results from the re-saved files and screenshots. Order: E1 to E4 with PK5, PK1 and PK2, T1 and T2, O1 to O3, R1 and R2, X1, S1, M1 to M3, then L1, C1 to C5, F1, PK3 to PK7 and PK9. Known limits of this route: the exporter does not reproduce the per-stall tail records or the parking connected list, so the PK scenarios that read those need the tower built in the game by a person.

Tracked in issue [#1543](https://github.com/maniator/verticopolis/issues/1543).
