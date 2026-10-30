# Post-merge review: prioritized plan

**Snapshot of 2026-10-30, about 16:50 UTC. Not live status.** Main was `54f5e90` (app 2.71.0, engine crate 1.0.4). Test CI was green on it; the Rust engine workflow was still running when I looked. Live status is in the GitHub issues named below. Vercel deploy health could not be checked from here (no access), so "production deploy is healthy" is unverified.

Grades: **confirmed** (seen in code or a run), **probable**, **conflicting**, **unverified**. Classic findings only unless a line says Modern. Nothing here changes a rule; items that need your call are marked **Your call**.

Open PRs at the time: #1516 (wedding hall, app 2.72.0, crate 1.1.0), #1525 (parking audit, docs only).

## Do now (small PRs, no Classic rule change)

| # | Item | Grade | Owner | Issue |
|---|---|---|---|---|
| 1 | **The engine-failure screen cannot download the player's save.** It offers Repair, Copy diagnostics and Reload; the stored-bytes download helper exists but is not wired in. A save that makes the engine trap on load gets one reload, then a stop with no export. Also the crash dialog is dead code (gated off in the wasm-only build). Fix: add "Download recovery copy" to the failure and stop screens, drop or rewire the dead dialog, add an e2e that downloads the exact stored text. | Confirmed (`src/bootstrap.ts:133-155`, `:386`) | Reliability worker (new thread) | #1515, raised to P1 by comment |
| 2 | **Autosave only on a 30 s timer.** No save on tab hide; failed autosave, load and import send no telemetry and show no message. | Confirmed | Reliability worker | New #1533 (**Your call** on the new analytics codes) |
| 3 | **Real-save regression suite on the loaded tower.** Import and export are well pinned (all pass). Nothing loads the importer output through `deserialize`, plays a few days, or pins express stops, dimensions, parking and census per save. This gap is why #1532 went unseen. | Confirmed | TDT worker | New #1534 |
| 4 | **Express basement stops are dropped on load** for all eight non-empty saves (e.g. TOWER2 parking floors with a stop 9 to 3, TOWER7 9 to 1). Fix is loader-only: keep the stops a loaded file carries. | Confirmed (probe) | TDT worker, after #1534 | #1532. **Your call**: it changes how imported towers behave. The rule for newly built Classic express shafts stays in #1527. |
| 5 | **Firefox and WebKit have no coverage.** Only two Chromium Playwright projects exist; the only determinism check is Chromium. Add firefox and webkit projects running the wasm-only spec plus a state-digest test. | Confirmed | CI worker | #1522 item 2 |
| 6 | **#1435 specs never run.** `regions.spec` and the mobile `Access:` check are skipped on every project. Port both to Rust. The issue text still mentions `PW_ENGINE=ts` and `@ts-smoke`, which no longer exist. | Confirmed | CI worker | #1435 |
| 7 | **Codec pin.** No test forbids a TypeScript parser running in production. `SaveGame.infoFrom` still calls the TS `Simulation.deserialize` for the slot list, and the TS container codec is still used. Fold into the TS removal (below) so the pin lands when the code goes. | Confirmed | Rust-only thread | #1522 item 1 |

## Before #1516 merges

- It had a lean self-review only (no hot-path record), and the review skill is not installed in these sessions. CLAUDE.md requires `/gds-code-review` for gameplay work. **Your call**: accept a documented lean review again, or have an independent reviewer do it.
- **Probable risk:** the old-tower hall widening checks rooms but not transport. A shaft ending at floor 100 inside the widened span is not checked. Ask the PR's thread to test one.
- It needs your screenshot-approval click on the rebased tree; the earlier approval does not carry.
- Same process gap applies to recently merged Classic PRs (#1514, #1517, #1519): they merged on self-review. I did not find a defect in them; the review simply was not the one the repo requires.

## Nine real saves (Priority 2): current state

- Import, `.vctower` round trip and re-export keep units, transports, clock, money and stars on all nine. 282 of 282 TDT referee cases pass, and all nine fixture scenarios pass.
- Width mismatches are **zero on all nine** (the #1510 fix worked). Parking stalls connected on load equal the file's count on all nine.
- Existing Verticopolis saves: a loaded unit keeps its saved width, so the #1510 catalog change cannot resize or overlap old towers, and the committed pre-2.71 fixtures load. Unverified: old towers with rooms under a metro or on B10 (the new rule is placement-only, so I expect no change, but no test says so).
- **Population on load is well below the file** on most saves (TOWER7 1890 of 4429, TOWER2 3025 of 6223) and barely moves in two simulated days. That conflicts with our format doc, which says counts build up. One sample, so **probable**; #1500 holds it, with my numbers in a comment.
- Still unproven: that SimTower itself loads our current export. The only evidence is from 2.59.0, before the finance-block fix. The PC thread owns this.

## Issue housekeeping (proposed; I closed nothing)

- **Close as done:** #311 (superseded by #1499; the rest lives in #1500), #883 and #886 (the TypeScript codec and generator they cover are gone).
- **Close with a pointer or retitle:** #1491 (elevator and stair desync, twin wording and widths are fixed; roster, names and finance history are documented gaps; census is #1500). #1495 (a per-offset table is in `stair_scan.rs`; #1499 says it closes it) after a quick check.
- **Re-scope:** #885 (Rust-only round-trip or fuzz property), #920 (still points at the deleted TS reference), #310 (real saves show a 17,242-byte tail, ours writes 25,600).
- **Keep open:** #740 (needs PC evidence), #1503, #1524, #1500, #1532.
- Backlog has no rows for #1500, #1503, #1532, #1524 or #1495.

## Reliability: other findings

- Reload loop risk is bounded (confirmed): one reload, then stop; a new tab gets one more.
- Mid-session traps halt the game and block autosave correctly. The handler is not wrapped in try/catch (probable, P3).
- **Telemetry:** init failures are detectable (attempt without settle, or the settle row). Post-engagement traps are collected but the report script never uses them. **No browser-family split is possible**, because #1522 dropped that field. Adding a coarse chromium/gecko/webkit field is the cheapest way to see Safari or Firefox problems. **Your call** (privacy doc change).
- No post-deploy smoke test: Vercel builds its own artifact and nothing runs the deployed bundle. Add a deployment-status workflow running the engine-boot slice (P2).
- A page whose entry module fails before boot has no watchdog (probable, P3).
- Installed-PWA update rehearsal is automated on Chromium only; the real device rehearsal stays a manual checklist.
- CI is otherwise healthy: gated PRs, retries, pinned Playwright image, a bundle guard that fails on a TS step-loop import.

## Visual and gameplay polish (Priority 3)

- Dimensions: confirmed correct on all nine saves (see above). Stretched-sprite check by eye is not done from the cloud; it needs the local screenshot compare against main (standing rule) when #1516's gallery lands.
- Metro: art and rules landed in #1510; a game-time cadence PR is in progress; PC reference frames are in the project folder root. The metro per-rider model waits on the PC run (#361, M1 to M3).
- Wedding hall: #1516 reviewed above.

## Classic parity (Priority 4)

All nine mechanics questions are still **conflicting or unverified** in the sources, and none should change before the PC run (#1531, #1526 to #1530, #1524, #573, #361). The PC thread is paused on how to run the spec. **Your call, my recommendation: option C**, a subset that settles the most. Run first: PK8 and PK10 (no building needed), E1 to E4 (express stops, also settles #1532's second half), T1 and T2 (transfers), X1 (cinema crowd), F1 (maintenance, reads the Finance window only). Option A makes the results "the original running our exporter's towers", which weakens them.

## Roadmap (Priority 5)

3.0.0 still holds 33 open issues, almost all written for the staged rollout (flip, cohort stages, TypeScript default, 1,000-session gates). I judged these from titles and the issue bodies I read (#945, #1104, #1522), not every body.

- **Obsolete gate machinery, close or rewrite:** #945 (the whole table assumes a TS default and a flip), #1104 (its "current scope" lists #1197, #1289 and #1350, already closed), #1090, #1250, #1086, #1111, #1162, #841 (cohort-era telemetry), #1085 and #878 (TS versus Rust test parity, moot once TS is gone), #932 (measure once and close).
- **Fold into the TS removal program** (Rust-only thread owns it): #1301, #1498, #1421, #921, #926, #1215, #1064.
- **Keep, but not 3.0 blockers (3.x):** perf and memory (#1254, #1259, #1237, #900), #1205 (trap in the save writer), #985 (offline PWA, check how much already shipped), #873, #879, #1221 (Vercel rollback rehearsal).
- **Leftover staged-rollout text in code and docs:** the default `switchable` build with a "3.0.0 flip" comment (`src/build/engineBundle.ts:21`), `test.yml:244`, the `?engine=` switch, `ts-fallback` engine kind, `scripts/engine-reliability.mjs` arms, `gate-1/2/3` labels, `docs/analytics-data-map.md:77`. These go with the TS removal.
- **TS removal order (you decided just now):** gallery moves to the Rust catalog from main first, then the TS engine removal, owned by the Rust-only thread. I am not duplicating it.

### Proposed remaining 3.0 scope (Classic and .TDT fidelity)

1. Nine-save suite (#1534), express basement stops (#1532), census follow-up (#1500, after the probe is confirmed).
2. Wedding hall (#1516) and metro finish.
3. Failure-screen save download and the Firefox and WebKit determinism run, as the reliability floor for a Rust-only release.
4. PC-verified Classic mechanics land as they get evidence, not as 3.0 blockers: they go to 3.x.

4.x (visual) and 5.x (deeper simulation) stay as sorted on Oct 29; nothing found here moves them.

## Ownership summary

| Work | Owner |
|---|---|
| Items 1, 2 | New reliability worker thread |
| Items 3, 4 | TDT worker (existing .TDT thread), after your go on item 4 |
| Items 5, 6 | CI worker |
| Item 7, gallery, TS removal, obsolete gates | Rust-only thread |
| #1516 | Its thread, plus your screenshot click |
| PC run | PC thread, after your A, B or C choice |
| Issue closes and #945/#1104 rewrite | After your go on the lists above |

## Community note

Keep the Reddit follow-up to gameplay and visuals: nine real saves import cleanly with the right room sizes, metro and wedding hall art, and hotel guests carried over. I did not read any Reddit content; nothing here depends on it.

## Approvals and next steps (2026-10-30, 18:44 UTC)
### Approvals

- PC run: yes. He did not name A, B or C. The recommendation in the plan is option C (a subset: PK8, PK10, E1-E4, T1, T2, X1, F1 first). Confirm with him or the PC thread before building towers by code.
- Loader fix for #1532 (keep the basement stops a loaded file carries): approved. The rule for newly built Classic express shafts stays in #1527 and is NOT approved.
- New analytics codes in #1533 (`autosave_failed`, `load_failed`, `import_failed`): approved. The browser-family field was not named, so it is NOT approved.
- Roadmap closes and the #945/#1104 rewrite: approved.
- #1516 review question (lean self-review vs independent review) was not answered.

### Work to pick up, in order

1. **Failure-screen save download** (#1515, P1). Add "Download recovery copy" to `showEngineFailure` in `src/bootstrap.ts` using `downloadRecoveryCopy(readRecoveryText)`; drop or rewire the dead crash dialog (`!__WASM_ONLY__ && !onRust` gate, `src/bootstrap.ts:386`); wasm-only e2e that seeds a save, forces a load failure and downloads the stored text. Needs a version bump (player-facing), `/bmad-code-review`.
2. **Nine-save suite** (#1534), then **#1532 loader fix** with the nine-fixture parking-reachability test. Touches `Tower::coerce_express_stops` (`engine-rs/src/tower.rs`), crate bump, `npm run engine:compat`, `/gds-code-review`. Classic only.
3. **#1533**: autosave on `visibilitychange` hidden, failure message, three `app_action` codes, `docs/analytics-data-map.md`.
4. **CI**: Firefox and WebKit Playwright projects (#1522), port `regions.spec` and the mobile `Access:` check (#1435, fix its stale text).
5. **Roadmap rewrite**: new short body for #1104 and a Rust-only 3.0 scope for #945 (Classic/.TDT fidelity plus the reliability floor in the plan). Move the issue groups as listed in the plan. Rust-only thread owns the TS removal group.

### Roadmap closes (approved)

Done by the review thread: #311, #883, #886 (each with a pointer comment).

Still to do, after a quick body check of each: #1491 (close with a pointer to #1500), #1495 (confirm `stair_scan.rs` table, then close), obsolete-gate issues #1090, #1250, #1086, #1111, #1162, #841, #1085, #878, #932. Re-scope, do not close: #885, #920, #310. Keep: #740, #1503, #1524, #1500, #1532, #1221.

### Open risks to remember

- #1516 widening does not check for a shaft ending at floor 100 inside the widened hall span (probable). Not run.
- Merges since 2.65 had lean self-review only; the BMGD review skill is not installed in cloud sessions.
- Vercel deploy health was not checkable from the cloud.
- TOWER7 star answers for Naftali: star level comes from the file header and never drops; the TOWER VIP needs 15,000 population, a metro and 5 stars. Notes are in #1500.
