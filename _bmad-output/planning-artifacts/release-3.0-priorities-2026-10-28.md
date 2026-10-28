# Release 3.0 priorities: what is left for 3.0 and what moves to 3.x (revision 3.1; decisions 5 and 6 await the owner)

> **Snapshot, Oct 28, 2026 about 20:55 UTC (4:55 PM EDT), against main 093da570 (app 2.50.0, engine crate 0.20.0). It does not refresh. Naftali approved it at 20:45 UTC (4:45 PM EDT): decisions 1 to 4 and 7 to 13, with the 20:45 clarifications that belong to them (the recovery copy kept apart from export). Decisions 5 (the gameplay sequence) and 6 (M5a and M5b) come from the review's clarification text and are proposed, awaiting his own OK. Also separate and unapproved: the analytics packet, the size-gate measure and cutoffs, the population minimums and each #920 exception. Approving this plan approves no value he has not reviewed. #1348 and its held TypeScript-retirement decisions are untouched, and no rollout starts without his explicit GO.** Live state: GitHub issues and PRs, and `src/engineCohort/config.ts` for the cohort. The three reviews this revision answers (20:06, 20:21 and 20:45 UTC) were written by ChatGPT, as Naftali clarified each time. They are input, so every point in them appears below as a proposal with my verdict, and the "approvals" in the second and third reviews are listed as decisions still waiting for his own confirmation. Sources checked for this revision: current main (storage, the TypeScript engine's port, the perf scripts, e2e), the release plan's section 5.3 (M1 to M8 and the δ and ε rule), #1104's rows, #1350, #1422, #1221, and the Oct 28 PC suite summary.

## What changed from revision 2

1. **The format boundary is now three layers.** Revision 2 moved the save stamp and serialization into Rust for both engines. That was wrong: the TypeScript engine has to write and read its own saves with no engine package. The fix is below under "The format boundary".
2. **A "no engine package" acceptance test is added,** built as the one `@ts-smoke` test CI already runs on TypeScript, so it keeps your one-test rule.
3. **The raw save download does not exist yet.** `SaveGame.preserveUnreadable` keeps unreadable bytes in storage, but no player can download them. It becomes new work riding on 6b, which already builds a save download for the crash dialog.
4. **#1254's pass rule is corrected.** Revision 2 used slice 9's provisional ε (50 ms of blocking or 5%). Slice 9 is gone, and RUN-1 uses section 5.3's calibrated ε, which for cold start is capped at 5% of TypeScript's median cold start; the 50 ms cap belongs to M4's long tasks. On today's numbers the saved-tower start misses that cap on every tower.
5. **The memory bar is corrected.** 1.25x is not a new proposal: it is M6's approved ceiling (peak JS heap plus WASM, large tower). Revision 2 applied it to absolute memory after the gameplay sequence, which would fail the medium tower today (1.79x) for reasons unrelated to #1259 or #1338. The sequence now gates on growth during the sequence, and absolute memory stays M6's.
6. **#1429 merged** (e2e on Rust, f1d275c6, 20:19 UTC).
7. **The PC run is reframed** against your 19:38 UTC position (no rerun now, one validated run later). See decision 2.

**Revision 3.1 (the 20:45 UTC review):**

8. **The emergency raw-save download is now separate from ordinary `.vctower` export.** Without the engine package, export says "unavailable" and offers the recovery copy. It no longer falls back to a TypeScript writer.
9. **The memory-growth bar reports growth in MiB, sampled peaks and the ratio,** with a floor so a near-zero TypeScript growth can't produce a meaningless ratio. M6 is unchanged.
10. **Cold start becomes M5a (fresh start) and M5b (saved-tower start),** each with its own calibrated ε at 1x and 4x. Proposed (from the review), awaiting Naftali's own OK. M5b would be an explicit expansion of the gate, their ε values come from calibration, and any exception is his.
11. **#1433 (6a) merged** at 20:42 UTC (093da570, app 2.50.0).

## Remaining actual blockers

Everything here is open today and something approved stands on it. Items that are only work in flight are in the workstream table.

**Open decisions that block work** (lettered, so they don't mix with the numbered decisions further down):

| Letter | Open decision | Blocks |
| --- | --- | --- |
| A | The analytics packet (cohort fields, `engine` on every event, `crash-reload`, browser family, the tap event, #1090's fields) | 6b's analytics value, the fields PR, gate 1 |
| B | The size gate's measure and cutoffs (plan 1.3.9 item 2) | Building the size gate, gate 1 |
| C | Decision 5: adding the gameplay sequence, and its numeric bars (the floor, the growth ratio, 200 ms per task, the unit-count check) | Whether #1259 and #1338 stay deferred, gate 2 |
| D | Decision 6: M5a and M5b, including M5b's explicit expansion of the gate; then any exception. Their ε values come from A/A calibration under section 5.3, and a calibration that misses the cap goes to Naftali | #1254's verdict, gate 2 |
| E | The PC slot for the validated run (approved for before stage 1, when practical) | Gate 1 |
| F | Coverage minimums for the 300 report (already planned as his dated thresholds file in #1350) | Gate 3 |
| G | #920's exceptions, one at a time | Gate 3 |
| H | His stage-1 GO, then each stage, the flip and 3.0.0 | Every gate |

**Work not started or not finished that a gate needs:**

- Gate 1: 6b (6a merged as #1433); the save-integrity tests; the no-package test; the recovery copy; the fields PR (after open decision A); the size gate (after open decision B); #1258 rechecked on the port host; the ST1 cut; the validated PC run; #1345 triaged.
- Gate 2: RUN-1 with δ and ε calibrated (#1162, #1111); the gameplay-sequence row; #1254 fixed or excepted (likely a real fix, see below); #1237; the audio cue-timing test; #1430 and PR 7 (#1421, #878) with the coverage inventory.
- Gate 3: the 300 with per-population reporting; #1085's window; the compatibility items; #985 and #1345; #900's per-engine baseline; #1221 rewritten and rehearsed; X1 (#879, #873); version identity; #945 and the exception register.

## The format boundary (three layers)

This applies your 20:00 UTC direction (all `.vctower` and `.TDT` import and export in Rust) and keeps a TypeScript player able to play when the engine package is missing.

| Layer | Owner | What it covers | Without the engine package |
| --- | --- | --- | --- |
| 1. Browser storage, compression and recovery | TypeScript, shared by both engines | Save slots, the `VCZ1:` container (magic, deflate, base64 in `saveCompression.ts` and `towerFileCodec.ts`, the same container a `.vctower` file uses), the unreadable-save stash (`SaveGame.preserveUnreadable`), and the emergency recovery copy | Works |
| 2. Each engine's own save serialization | Each engine, in its own language | Writing and reading its own towers, the save stamp, and older-version migrations. One JSON schema both ways, pinned by cross-engine tests (a Rust-written autosave opens on TypeScript, which 6a's second-trap path depends on, and the reverse) | TypeScript works |
| 3. External files | Rust, for both engines | Ordinary `.vctower` import and export, `.TDT` import and export, and any conversion. The TypeScript engine loads the package on demand for these, and its exports pass through Rust's validator, so every exported file is one the Rust engine opens | Import and export say "unavailable", leave stored saves untouched and offer the recovery copy. No TypeScript writer stands in |

The TypeScript `.vctower` and `.TDT` parsers (`TsEngine.loadVctower`, `loadTdt` and `tdtExport` today) leave the runtime and stay only as test referees until 3.x deletes them, so no second codec ships. The container-only fallback in `vctowerWriter.ts` leaves the export path too.

**The recovery copy versus ordinary export.** The recovery copy is not an export. It writes the stored slot's bytes exactly as they sit in browser storage, with no parsing, no re-serialization and no validation, under a name that says recovery and a file type GitHub accepts. It is offered on the unreadable-save notice, the engine failure screen, the crash dialog (6b) and wherever export is unavailable. Because the bytes are the same container a `.vctower` uses, the Rust importer can open a recovery copy whose contents are sound, so there is still only one external-format implementation. Ordinary export always goes through Rust and produces a validated file.

**The no-package acceptance test.** Grow the one `@ts-smoke` test (`e2e/integration.spec.ts`, `PW_ENGINE=ts`) with the engine package's requests blocked: load an autosave, advance, save, reload and check the tower; try a `.vctower` and a `.TDT` import and see the "unavailable" message with stored saves byte-identical; then the raw download. Unit tests (no browser) cover older save versions and an unreadable slot kept rather than overwritten. This keeps your rule of one TypeScript-tagged e2e test with no duplicate files.

## Performance and memory acceptance

The plan's section 5.3 already fixes most of this; what is new is marked.

- **Measures stay separate,** as your Oct 21 directive says: bare engine (M1), hosted time (M2), frames (M3), main-thread blocking (M4), cold start (M5), memory (M6), CI tripwire (M7), edits (M8). Ten repetitions, distributions and paired 95% intervals, at 1x and 4x.
- **Memory (M6, approved):** peak JS heap plus WASM linear memory on the large tower, at most 1.25x TypeScript on the paired ratio's upper bound. Report JS heap and WASM separately as well as combined (the suite already does). WASM linear memory never shrinks, so its peak and its after-test value are the same number; the peak-versus-after split only matters for the JS heap, which needs sampled peaks. Medium (1.79x) and large (1.16x) from today's suite are reported, and only large is gated, as M6 is written.
- **The gameplay sequence (new, for #1259 and #1338; adding it is proposed, its bars are proposals):** load the large and the many-unit towers, build one room, advance 720 steps, save, export `.vctower` and `.TDT`. `scripts/perf-load-memory.ts` already walks load, build, save, play, serialize and reload for WASM memory, so it is the starting point. Proposed bars, all new and yours to set:
  - growth during the sequence (memory after it minus memory after load) at most 1.25x TypeScript's growth, read as `Rust growth / max(TypeScript growth, floor)`. The proposed floor is 8 MiB, or the A/A noise of TypeScript's growth across reps if that is larger, fixed before the run. Below the floor the bar becomes an allowance in MiB (1.25x the floor), so a near-zero TypeScript growth can't make the ratio meaningless or unstable. The report always shows growth in MiB, the sampled JS heap peak (sampled at a fixed interval during the sequence; WASM's peak is its final size), and the ratio;
  - no single main-thread task over 200 ms from build, save or export at 1x. An operation's total duration is reported separately, since a slow export split into small tasks blocks nothing;
  - the unit count after the first build equals the count before it plus what was built.

  If it passes, #1259 and #1338 stay deferred to 3.x. If not, they are fixed before gate 2.
- **Cold start (M5a fresh start, M5b saved-tower start, #1254):** the plan's row reads "cold start to ready" at 1x and 4x and does not say whether a tower is loaded. Proposed (from the review), awaiting Naftali's own OK: M5a (a fresh start with an empty cache) and M5b (a start that resumes a saved tower) are reported and gated separately, each with its own calibrated ε at each throttle. M5b would be an explicit expansion of the gate. Their ε values come from calibration, and any exception to either is Naftali's. Today's suite measured only the saved-tower start, at 1x: Rust is 47 to 78 ms slower on every tower (for example medium 249 against 299 ms, large 296 against 372 ms), while 5% of TypeScript's start is 11 to 15 ms. The pass rule, from section 5.3: ε is calibrated from A/A passes and capped at 5% of TypeScript's median cold start at that throttle, and M5 passes when the upper bound of the paired 95% interval of Rust minus TypeScript, in ms, is at most ε at both throttles. Unless RUN-1 shows something different, M5b fails and #1254 is a real fix, not a deferral. M5a has not been measured on the current harness.
- **#900 (M7):** the plan's M7 row already says it: a baseline per engine, tolerances calibrated from A/A CI runs under the same cap as δ. It stays in 3.0.0.

## Coverage and the reliability count

- The 300 and the 1,000 stay as approved. The 300 report shows each population cell (platform, channel, display, browser family once approved, tower size), and a cell under your minimum is printed as insufficient for the final decision, never folded into the total.
- Slow hardware: targeted low-end testers and the CPU-throttled lab passes already in #1350 (one throttled Chromium pass, a throttled phone smoke run), with no new production field.
- Large towers enter only at stage 3 because of the size gate, so the stage-3 report has its own large-tower line.

## Workstreams and dependencies

| Stream | Work, in order | Waits on | Feeds |
| --- | --- | --- | --- |
| A. Crash and save integrity | 6b with the recovery copy (6a merged as #1433), save-integrity and no-package tests, #1066's unstamped boots, #1236 | 6b's analytics value waits on open decision A | Gate 1 |
| B. Analytics and counting | The fields PR, #1350's pins, #1268, the per-population report | Open decision A | Gate 1, then the 300 |
| C. Cohort controls | The size gate, #1258 recheck, ST1 | Open decision B | Gate 1 |
| D. Performance and memory | The validated PC run with the gameplay-sequence row, #1349 (#1242) resumed, #1259 and #1338 measured, #1254 fix, #1162, #1111, #1237, RUN-1 | PC slots (other threads pause during a run), open decisions C, D and E | Gates 1 and 2 |
| E. Tests on Rust | #1430, PR 7 (#1421, #878) with the inventory, the cue-timing test, #900 | none (#1429 merged) | Gates 2 and 3 |
| F. Formats in Rust | Layer 3 for the TypeScript engine, #885, #886, #920 triage, #932, A7's real saves, #740 check | None (decision 3 approved) | Gate 3 |
| G. Release docs and ops | #985, #1345, #1085, #1221's rehearsal, X1, #945 (the reconciliation edits are done) | None | Gate 3 |

A, E, F, G and the unblocked parts of D can run now. B and C start on open decisions A and B.

## Every original issue

Status key: **3.0** (with its gate), **conditional** (criteria above), **3.x**, **superseded**, **complete**. "Superseded" and the mappings were approved as decision 9.

| Issue or PR | Status | Note |
| --- | --- | --- |
| #1422 PR 6 (6a #1433, 6b) | 3.0, gate 1 | 6a merged (093da570); 6b adds the recovery copy |
| #1350 count tooling | 3.0, gate 1 | Text changes drafted |
| #1090, #1268 | 3.0, gate 1 | |
| #1197 cohort, #1258 | 3.0, gate 1 | |
| #1066 | 3.0, gate 1 (unstamped boots), gate 3 (`.TDT`) | D5 |
| #1345 offline cold start | Conditional | Gate 1 if switchable builds fail offline after a lost precache, else gate 3 |
| #1428 harness fix | Complete | c1ebcf1 |
| #1259, #1338 | Conditional, gate 2 | The gameplay sequence |
| #1242 (PR #1349) | 3.0, gate 2 | Review round 4 owed |
| #1254, #1005 | 3.0, gate 2 | Likely a real fix on today's numbers |
| #1237 | 3.0, gate 2 | Your Oct 21 directive |
| #1162, #1111 | 3.0, gate 2 | |
| #1220 slice 9 | Superseded by RUN-1 | |
| #1353 (#1429 merged, #1430 open), #878 (PR 7) | 3.0, gate 2 | |
| #900 | 3.0, gate 3 | M7 as written |
| #954, #921, #926 | 3.0, gate 2 (verify) | Likely done by the cutover |
| #1064 | 3.0, gate 3 | May close when PR 7 ends dual answering |
| #1236 | 3.0, gates 1 and 3 | |
| #1301 codec boundary | 3.0, gate 3 | Rescoped to the three layers |
| #885, #886, #932, A7 (#887 complete) | 3.0, gate 3 | Your 20:00 decision |
| #920 | 3.0, gate 3, triaged | Data-loss and failed-import claims fixed; the rest are your exceptions |
| #740 | Conditional | Fixed if our writer causes it; an exception and a Help note if the 1994 game drops correct data |
| #985, #1085 | 3.0, gate 3 | |
| #865, #867 | Complete (verify) | |
| #1221 | 3.0, gate 3 | Rewrite drafted |
| #879, #873 (X1) | 3.0, gate 3 | Fix or exception |
| #945, #1104 | 3.0, gate 3 / docs | #1104 edits drafted |
| #1215 slice 6c readout | Conditional | Ships in 3.0 only if the TypeScript game shows it today |
| #1207, #1209 to #1213, #1222, #1396 | Complete (verify) | Done by the cutover's PRs 1 to 5 |
| #868 (S6) | Superseded | Mapped onto the cutover's PRs |
| #1217, #1218 | Superseded | By #1422 |
| #1051 | Complete | Criterion met Oct 21 |
| #1432 | Not a gate | |
| #1223, #1109, TypeScript removal ladder | 3.x | #1348's removal wording stays on your hold |
| #1045, #1053, #1071 worker host | Superseded | Your 16:18 UTC call: future work, not 3.0 |
| #705 | 3.x | |
| TDT CLI crate | 3.x | Oct 28 lean round: an `engine-rs/tdt-cli/` converter that depends on the engine, `publish = false`, after #885, #886 and #920 are green |
| #1348 | On your hold | Untouched |

## Decisions

Each proposal names where it came from. Status as of 20:45 UTC: Naftali's "Sure" approved decisions 1 to 4 and 7 to 13, with the clarifications that belong to them. Decisions 5 and 6 came from the review's clarification text (written by ChatGPT) and are proposed, awaiting his own OK.

| # | Proposal | From | My verdict | Status (20:45 UTC) |
| --- | --- | --- | --- | --- |
| 1 | Three gates (stage 1, stage 3, 3.0.0) with the streams above, plus the cue-timing test and the size gate's removal at gate 2 and the soak and tail at gate 3 | GPT 20:06, revision 2 | Agree. The additions are already approved conditions. | Approved |
| 2 | One validated PC run before stage 1, not now. It adds the gameplay-sequence row. Your "final release evidence" run with the memory-over-time leg stays before 3.0.0 | GPT 20:21, your 19:38 | Agree. It fits your 19:38 position. | Approved |
| 3 | The three-layer format boundary and the no-package test | GPT 20:21, revised here | Agree. It corrects revision 2. It also changes #1104's A9 row (your Oct 22 direction), which keeps the TypeScript codec as a runtime safe fallback. Under your 20:00 direction that fallback leaves the runtime, and A9's aim (a codec failure never strands a save) is carried by layers 1 and 2 instead. Approved with the A9 change. | Approved |
| 4 | The recovery copy, riding on 6b, kept separate from ordinary export | New (GPT assumed it existed); GPT 20:45 asked for the separation | Agree. Small, and the recovery path needs it. A player-facing change, so a minor version. | Approved |
| 5 | Add the gameplay sequence; its bars (growth 1.25x over the floor, 200 ms per task, unit count) | Revision 2, GPT 20:21 and 20:45 | Agree. The 8 MiB floor is my proposal and the number is yours. | Proposed (from the review), awaiting owner OK (C) |
| 6 | M5a (fresh) and M5b (saved tower), each gated at 1x and 4x with its own calibrated ε; M5b as an explicit gate expansion | GPT 20:45 (GPT 20:21 had said fresh only) | Agree. The saved-tower start is what returning players see. Expanding a gate needs his own words. | Proposed (from the review), awaiting owner OK (D) |
| 7 | Slow-hardware coverage from targeted testers and throttled runs, no new field; a large-tower line at stage 3; insufficient cells flagged | GPT 20:21 | Agree. | Approved |
| 8 | #900 in 3.0.0 with a per-engine baseline and regression budget | GPT 20:21, revision 2 | Agree. It is M7 as written. | Approved |
| 9 | The 300's "facade host" read as the port host; S6 mapped onto cutover PRs 1 to 7; RUN-1 replacing slice 9; your slice-9-before-10 rule marked overtaken | GPT 20:21 (as an approval), revision 2 | Agree. | Approved |
| 10 | Record AD-9's reload-first change in the plan | GPT 20:21 (as an approval) | Agree. The behavior is Naftali's own 19:33 direction. | Approved |
| 11 | The analytics packet and the size-gate cutoffs stay separate decisions | GPT 20:21 | Agree. | Approved |
| 12 | #920 exceptions case by case | GPT 20:06 and 20:21 | Agree. | Approved |
| 13 | Post the reconciliation edits for #1104, #1350, #1422 and #1221; #1348 untouched | GPT 20:21 | Agree. Applied on Oct 28 from the live bodies: #1422, #1221 and #1350 edited, and #1104 given a row-by-row reconciliation comment instead of a body rewrite. | Approved and applied |

## How the 20:06 review's nine points landed

Unchanged from revision 2 except where revision 3 corrects it: (1) save integrity and #1422 first, save in a bug report only when the player attaches it by hand: agree. (2) Rust owns the formats for both engines: agree, now as the three layers. (3) three gates: agree, with the additions in decision 1. (4) Rust in the main suites with no redundant TypeScript legs: agree; TypeScript keeps unit, golden and conformance tests and the one `@ts-smoke` test. (5) performance beyond M2 to M6: agree, as the gameplay sequence. (6) risk-based `.TDT`: agree. (7) per-population counts, 300 not proof for everyone: agree. (8) reconcile stale text: drafts ready, waiting on you. (9) keep 3.0 focused: agree.
