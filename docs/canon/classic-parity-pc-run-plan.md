# Classic parity: original-game PC run plan

Written 2026-10-30. This records how the approved original-SimTower test run (the "classic parity" spec, about 40 scenarios) is split, what is run first, and how a full run would be done later. It is a plan and a hand-off note. No scenario has been run yet.

The spec lives in the project files (`release-3.0/classic-parity/pc-test-spec-2026-10-30.md`), not in the repository. Its scenario ids are used here as written: T1, T2, O1 to O3, E1 to E4, X1, M1 to M3, R1, R2, S1, L1, C1 to C5, F1 and PK1 to PK10.

## Rules for every result

- Original game observation only. A result is canon only when a kept screenshot or saved `.TDT` shows it.
- Mark anything not run with the reason. Do not infer a result.
- The target is Windows SimTower 1.1B. If the disc binary is 1.0, say so in the results (Help, About).
- Say how each tower was made. A tower built through our exporter is "the original game running a tower we built", not a tower built in the game.

## What the harness can and cannot do (learned 2026-10-29)

Works: load a `.TDT` headlessly under Wine in Docker, screenshot it, run it for a while, File > Save from a script (the Windows output path needs a backslash variable, see `tools/simtower/README.md`), read the saved bytes, and drive a live container with `docker exec` and `xdotool`.

Does not work reliably: placing buildings by scripted clicks (the toolbar and map windows change focus), and starting a new game without a save (the title screen stays up). So a run that needs a tower with a given layout must either build that tower in code and export it, or have a person place it with `./run.sh`.

## Run now: subset C (no building)

These need only real saves already in the repository (`conformance/fixtures/tdt-reddit/`):

- **PK8** real saves: load TOWER7, MYTOWER and TOWER1 unmodified. Record suite and office colors, red X stalls, and for TOWER7 the five parking floors the loader reads as unserved. Save at once and again 24 game hours later and diff.
- **PK10** stall gaps: TOWER7's own parking row (stalls behind a 1-tile and a 3-tile gap from the ramp). Record the red X and the connected-stall count in the saved file.
- Version check of the disc binary.

## Follow-up: full run (option A)

Build each remaining scenario's tower in code with the Rust engine, export it as `.TDT`, load it in the original, run it for the required game days (use a persistent container and save at the needed moments), and read results from the re-saved files and screenshots. Order: E1 to E4 with PK5, PK1 and PK2, T1 and T2, O1 to O3, R1 and R2, X1, S1, M1 to M3, then L1, C1 to C5, F1, PK3 to PK7 and PK9. Known limits of this route: the exporter does not reproduce the per-stall tail records or the parking connected list, so the PK scenarios that read those need the tower built in the game by a person.

Tracked in issue [#1543](https://github.com/maniator/verticopolis/issues/1543).
