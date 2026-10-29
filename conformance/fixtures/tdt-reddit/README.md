# Real 1997 SimTower saves

`TOWER1.TDT` to `TOWER4.TDT` are four real saves from the 1997 SimTower, played
and sent by Reddit user **u/invokes**. They asked nothing for them and said
"Yes that's totally fine" when asked whether the saves could go in the public
repository as test files, credited to them (r/SimTower thread, 2026-10-29).
Thank you.

They are the first saves of that vintage the importer has seen (issue #1491).
`TOWER2.TDT` is a 100-floor 4-star tower whose two express shafts carry a
payload no documented layout predicts, which used to lose the whole elevator
and stairway table. Two tests read all four:
`src/tests/integration/tdtRealSaves.integration.test.ts` and
`engine-rs/tests/tdt_real_saves.rs`.

The files are the originals, unmodified. Do not add them to the conformance
lock (`conformance/tdt-cases.json`): its cases are synthetic.
