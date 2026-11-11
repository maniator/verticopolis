# Session D: the nine real saves in a browser, 2026-11-10

**Snapshot of 2026-11-10, not refreshing.** The live checks are `engine-rs/tests/tdt_real_saves.rs` and `e2e/saveRoundTrip.spec.ts`. The raw JSON, screenshots (the import report open for each tower) and the script are in [verticopolis-benchmarks](https://github.com/maniator/verticopolis-benchmarks/tree/main/results) (private repository) under `2026-11-10-b8f5dec-session-c-d`.

- Commit `b8f5dec` (app 3.0.0), clean tree, a `VC_TOOLING=1` build served by `vite preview`. Windows 11, Ryzen 5 5600X. Chromium 149.0.7827.55, Firefox 151.0 and WebKit 26.5 (a stand-in, not Safari), each with a fresh browser context per tower.
- The nine saves are `conformance/fixtures/tdt-reddit/` (TOWER1 to TOWER8 and MYTOWER). These are Playwright profiles, not the owner's normal Chrome profile, so D2 (the owner's own towers) was not run.

## D1: import, save, reload, export, re-import

For each save the script used the real Saves dialog: import the `.TDT`, read the import report, press "Open tower", pause, save, reload (the autosave loads at boot), export a `.vctower`, import that file again, then export a `.TDT`. State is money, star, population, day, game minutes and room count.

| Tower | Report line | Population | Day | Shafts / links in report | Rust test expects |
| --- | --- | --- | --- | --- | --- |
| TOWER1 | 3 stars, $967,036,000, 47 floors / B10, 640 rooms | 951 | 14 | 15 / 1 | 15 / 1 |
| TOWER2 | 4 stars, $915,394,100, 100 floors / B10, 1,535 rooms | 3,025 | 53 | 24 / 30 | 24 / 30 |
| TOWER3 | 4 stars, $927,800,500, 30 floors / B10, 956 rooms | 1,668 | 7 | 11 / 29 | 11 / 29 |
| TOWER4 | 4 stars, $942,746,500, 61 floors / B10, 1,334 rooms | 3,293 | 10 | 18 / 29 | 18 / 29 |
| TOWER5 | 5 stars, $979,609,500, 30 floors / B10, 212 rooms | 648 | 7 | 7 / 7 | 7 / 7 |
| TOWER6 | 5 stars, $920,908,000, 100 floors / B10, 661 rooms | 1,502 | 13 | 23 / 64 | 23 / 64 |
| TOWER7 | 5 stars, $924,653,000, 100 floors / B10, 816 rooms | 1,890 | 15 | 24 / 64 | 24 / 64 |
| TOWER8 | 3 stars, $1,000,000,000, 0 floors, 0 rooms | 0 | 0 | none | 0 / 0 |
| MYTOWER | 3 stars, $955,094,300, 90 floors / B9, 958 rooms | 2,466 | 41 | 24 / 37 | 24 / 37 |

**Result: 9 of 9 pass in Chromium, Firefox and WebKit.** After the reload and after re-importing the exported `.vctower`, every tower matched its state right after the first import on all six fields. No engine failure screen. The shaft and link counts in the report match the expectations of the nine-save Rust test for the eight towers that have shafts. The basement express stops of TOWER7 are covered by the Rust test; the browser run did not inspect them.

## D3: failure paths

In Chromium, on a live tower with a stored save:

- A truncated `.vctower`: the message is "Import failed: This tower file is damaged and can't be read." The live tower and every stored save were unchanged.
- A renamed text file: "Import failed: Not a Verticopolis tower file." The live tower and every stored save were unchanged.
- A corrupt autosave seeded before the page loaded: the game starts, shows "Your saved tower couldn't be read.", keeps the corrupt text exactly under the unreadable key, and does not overwrite the autosave slot with a new save.

A first attempt that corrupted the autosave from the running page was a test mistake: the game rewrites its autosave when the page unloads, so the corruption never survived the reload. Seeding it before the page's own scripts (as `e2e/saveRoundTrip.spec.ts` does) is the valid test.

## Not run

D2, the owner's own towers in the normal Chrome profile. The "SimTower loads our export" check (session A) was not run.
