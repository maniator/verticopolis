# 3.0.0 PC verification checklist

> **Snapshot, written 2026-11-03 against main at app 2.77.5 (engine crate 1.5.2). This is a plan, not a result: nothing in it has been run and no number in it is evidence.** The live state of every item is on its issue, in the `3.0.0` milestone and in #945, #1104 and #1561. A measurement counts only when a local session on the owner's PC ran it and a results folder or kept file exists (benchmark protocol, `docs/performance/benchmark-protocol.md`).

Everything that needs the owner's PC is grouped into six sessions, so each environment is set up once. The PC is `<home>\projects\verticopolis` (Ryzen 5 5600X, RTX 3060, Windows 11, Docker with WSL for the original game). "Naftali" means the owner. Cloud work that unblocks a session is listed under **Before the session**, so the PC time goes only to what a cloud container cannot do.

## What does not need the PC (corrections to the lane list)

| Item | Where it runs | Why |
| --- | --- | --- |
| #900 e2e perf gate baseline | CI (`update-perf-baseline.yml`, Playwright image) | `e2e/perf/baseline.json` is minted on CI hardware by design; a PC number there would be wrong. Dispatch the workflow on the candidate branch and review the bot commit. |
| #1162 `perf:compare` warmed second tower | Probably done | `src/tests/perfCompare/runner.ts` already opens a fresh page per scenario (`freshPage`, from #1164). The lane owner confirms and closes; the PC only needs the rule that pre-#1164 folders are not references. |
| #1534 nine-save suite | CI (Rust integration test) | No original-game step (the .TDT thread's note). The "SimTower loads our export" evidence is session A. |
| #1111 A/A mode for `perf:worker` | Code first | `perf:worker` stops at its engine-worker-chunk check on main (#1607). The PC run waits for that code. Without it, M4 (long tasks) has no A/A source, so a gate row that needs M4 stays open. |
| Safari proper and a real phone | Not the PC | #1522 asks for Safari and a throttled phone. Safari needs a Mac or iPhone. Playwright's WebKit build on the PC is a stand-in, and the result must say so. Naftali says if he has a device. |

## Sessions at a glance

| Session | Environment | Items | Wall time | Needs |
| --- | --- | --- | --- | --- |
| 0. One-time setup | PowerShell and WSL | worktree, toolchain, browser path | 30 min | nothing |
| A. Original SimTower | WSL and Docker | #920 claims 1 and 7, #740, #343 MAP captures | about 3 h | Naftali's disc image, interactive for A4 |
| B. Performance | PowerShell, unattended | #1254, Performance row, #932 reading, memory | about 4 h, the PC idle | no other use of the PC, no model inference |
| C. Browser and installed PWA | Chrome, Firefox, Playwright WebKit | #985, #1522, sound | about 2 h | production build served over HTTPS or localhost |
| D. Save and load regression | Chrome on the PC | nine real saves, round trips, his own saves | about 1 h | a backup of his browser profile |
| E. Release candidate | all of the above, once | #945 rows measured on the candidate commit | about 6 h after the freeze | the freeze, a pinned SHA |
| F. Vercel rollback rehearsal | PowerShell and the Vercel dashboard | #1221 | about 1 h | **Naftali's explicit go** |

Order: 0, then A (independent of builds, can run any time), then C and D on the current main as a dry run, then B. After the freeze, E repeats B, C and D on the candidate SHA and F runs once, last. Sessions B, C, D and F must not overlap a timed run.

---

## Session 0: one-time setup (30 min)

**Prerequisites.** AC power. Docker running. ChatGPT app, NVIDIA Overlay, other browsers and editors closed during B. No local model inference during B or E (an idle `ollama` process respawned in an earlier run; note it and leave it).

**Steps (PowerShell).**

```powershell
cd "<home>\projects\verticopolis"
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
cargo --version; wasm-bindgen --version      # wasm-bindgen must match engine-rs/Cargo.toml
git fetch origin
git worktree add --detach .worktrees\pc-3.0 <SHA>     # the SHA the coordinator pins; main for a dry run
cd .worktrees\pc-3.0
git rev-parse HEAD                                    # must equal the pin
npm.cmd ci
npm.cmd run wasm:build
git status --porcelain                                # must print nothing; a dirty tree voids a perf run
(Get-Content src\public\engine\BUILD.json | ConvertFrom-Json).sources    # record it
$env:PW_CHROMIUM_PATH = "$env:LOCALAPPDATA\ms-playwright\chromium-1228\chrome-win64\chrome.exe"
```

Use `npm.cmd`, never `npm`, whenever a command has `--` (PowerShell swallows it). If `package-lock.json` moved Playwright past 1.61, the counting browser changes: read protocol section 1, "Which browser counts", first.

**Expected.** Clean tree, `BUILD.json` `sources` recorded, Chromium path exists.

**Effort.** 30 min, mostly `npm.cmd ci` and the Rust build.

**Evidence to keep.** The SHA, the `sources` hash, `cargo`, `wasm-bindgen` and Chromium versions, the power plan GUID (restore Balanced afterward), idle CPU load before each timed pass. These go in the notes file of every run (`pc-run-<name>-notes.md`, project files root).

---

## Session A: original SimTower (about 3 h)

**Prerequisites.** `tools/simtower/` set up per its README: your own SimTower ISO (the disc binary is v1.0, so every result says "SimTower v1.0"), `./run.sh build` done, `COMMDLG.DLL` in `tools/simtower/native/` for File > Save. Game files, saves and the Wine prefix stay out of git (the clean-room rule). The three test files below come from the .TDT thread's helper (it commits the script that writes them once this run is approved); until then A1 to A3 cannot start.

Evidence rule for the whole session: a screenshot or a re-saved `.TDT` per observation, named `PK-<claim>-<variant>`, in the project files folder `release-3.0/tdt-reddit/pc-verify/` (not in the repo, since game-written bytes are not committed).

### A1. #920 claim 1: overlapping shaft records (30 min)

- **Steps.** Take our export of TOWER5 and make two variants, one shaft overlapping its neighbor by 1 tile and one with the same x. In WSL: `./run.sh load /wine/drive_c/saves/<file>.TDT` for each; screenshot at the shafts, and the minimap if the game shows one.
- **Expected.** One of three outcomes. (a) Both shafts draw: our importer's drop is wrong. (b) One draws: our rule and the export warning are right. (c) The load fails: the export should refuse or move the shaft.
- **Evidence.** Two screenshots, the outcome letter, the filenames.
- **Decision it feeds.** Only (c) or a surprise comes back to Naftali (keep the warning as a documented exception, or change the export).

### A2. #920 claim 7: zero person records (60 min)

- **Steps.** Export TOWER4 three ways from the helper: 0 person records, today's count of zero records, 15,000. `./run.sh load` each, read the population on screen, watch a few game minutes for spawning or a stall, then `./run.sh save <file> 'c:\saves\OUT.TDT'` and compare the person-block bytes.
- **Expected.** (a) Population follows the count and zero records are inert: no change. (b) The game builds people from the records, which would explain the earlier 1,280, 0 and 329 readings (`PARITY-NOTES.md`): write the count the game expects. (c) The game rewrites or rejects them: record what it does.
- **Evidence.** Three screenshots with the population, the three re-saved files' person blocks, a note on stalls.

### A3. #740: shafts after an express slot (30 min)

- **Steps.** Export a tower with two or more express shafts, one in slot 0, from current main (the helper provides the files). Load in the original and count the surviving shafts (blue lines on the minimap).
- **Expected.** All survive: the "express last" ordering in `encoder.rs` can go and #740 can close. Some are lost: the old byte-level rows stand.
- **Evidence.** The screenshot and the count against the number written.

### A4. #343 MAP window reference captures (60 min, interactive, not a blocker)

The MAP track is optional for 3.0.0 and auto-defers to 3.1.0, and the owner said not to hold implementation for these. They record the original window's behavior and its view modes for reference. Since 2026-11-04 the Classic Map has taken Modern's look (owner decision), so the captures no longer set its colors or scale.

- **Steps.** `./run.sh` interactive (the toolbar and map windows change focus, so scripted clicks are unreliable). Load TOWER7 (large, basements, metro) and MYTOWER. Open the MAP window and capture, at 1024 x 768 with the clock visible: the default view; the camera rectangle after scrolling the tower; each mode the window offers (note the modes' names as the game spells them, since Hotel, Eval and Pricing are the planned later modes); the window resized or moved if the game allows it; a tower with basements; a tower with a skewed shape. Click inside the map and record whether the view centers there. With the clock running, switch between the modes and note whether the game pauses while a mode is shown (parity plan item 7).
- **Expected.** A set of images and a short behavior note: colors per facility class, whether basements show, how the camera rectangle is drawn, click behavior, whether switching modes pauses the game, what the title bar and close control look like.
- **Evidence.** Images and the note in `release-3.0/map-reference/` (project files). Third-party text or images are not committed; own-words notes and our own captures only.
- **Cloud preparation.** The map thread (cmsg_01BVeca2nMyie8SiSsA47YddC6suZxfeRahPter5TWPU5Y) sends the exact mode list it wants captured if that differs from this list. Add it here before the session.

### A5. Optional, not part of 3.0.0: remaining classic-parity scenarios (#1543, milestone 5.x)

The 30 unrun scenarios of `docs/canon/classic-parity-pc-test-spec.md` stay with #1543. Do them in this session only if time is left, and only after the .TDT thread builds the towers in code. They block nothing in 3.0.0.

---

## Session B: performance (about 4 h, unattended)

**Prerequisites.** Session 0 on the pinned SHA. GPU preflight (`preflight.mjs` from `archive/pc-run-1051-bare-step.md` section 3, project files) prints `GPU OK`. If it does not, stop. Idle CPU load recorded. Cloud work done first: #1607 (trim `perf:worker`) if the M4 long-task row is wanted, and the pinned TypeScript baseline build (`.perf-ts-baseline/`, built by `perf:compare` itself on first run, so the first run is slower).

**What the arms are.** The TypeScript arm is the pinned pre-cutover build (`f3304e3`, app 2.77.5, #1597), served beside the current Rust build. The two differ in app code as well as engine, and the report says so. No "faster than TypeScript" claim leaves this session unless the Performance row's rule passes on the candidate commit (session E), and the player line stays "a little faster".

### B1. Hosted comparison, 1x and 4x (about 2.5 h)

```powershell
npm.cmd run perf:compare -- --reps 10 --out docs/performance/results/<date>-<sha7>-gate
npm.cmd run perf:compare -- --aa wasm --reps 10 --skip-build --out docs/performance/results/<date>-<sha7>-gate-aa-wasm-1
```

- **Expected.** Report header says Validation: passed, the WebGL renderer names the RTX 3060, the engine package hash shows no `MISMATCH`, the commit equals the pin with no `(dirty tree)`, at least 10 valid pairs for every row a verdict uses.
- **Reads.** M1 to M3 (tick and frame rows), M5 cold start to ready with the paired difference (#1254; the old table showed +71.8 ms at 1x against an ε near 20 ms, so this is the number that decides whether #1254 stays a blocker), mean FPS, 1% low and p99 frame time (invert rates before applying a rule, as the protocol says), memory, transfer and build sizes.
- **Do not** rerun a failed verdict to improve it. A rerun needs a recorded cause or a code change.
- **Evidence.** Both results folders committed through a PR by the Evidence lane (a run that is not committed is not evidence), plus `pc-run-<name>-{preflight,notes}` in the project files root.

### B2. Load memory (30 min)

```powershell
npm.cmd run perf:load-memory -- --reps 10
```

- **Expected.** Peak WASM memory on the medium and large fixtures at or under the last accepted run (`pc-run-1454-load-memory-*`, project files), no trap.
- **Evidence.** The `.md` and `.json` it writes.

### B3. Package cost reading for #932 (20 min, after B1)

- **Steps.** Take the served engine package size from the B1 report (raw and gzipped `.wasm`, the build-size table) and the M5 row. Compare with the numbers in #932 (1,045,859 to 1,240,052 bytes raw, 329,755 to 385,910 gzipped at filing; the current binary is about 2.0 MB raw).
- **Expected.** A recorded size and cold-start cost. If M5 passes, #932 closes with the measurement. If M5 fails, the TDT module behind a cargo feature is the first option, and that is code.
- **Evidence.** The two lines quoted in the #932 close comment.

### B4. Optional, after code: `perf:worker` A/A for M4 (#1111)

Skip until #1607 lands. Then `npm.cmd run perf:worker -- --aa wasm --reps 10 --viewport 1280x720 --out docs/performance/results/<date>-<sha7>-aa-worker-1280x720`, and read the long-task epsilon with `perf:calibrate`.

---

## Session C: browser and installed PWA (about 2 h)

**Prerequisites.** A production build (not the tooling build) of the pinned SHA, served the way Vercel serves it: either the preview deployment URL for the branch, or locally `npm.cmd run build` then `npm.cmd run preview` (service workers work on localhost). Cloud preparation: #985's automated tests green in CI (`offlineColdStart`, `offlineUpdate`, `engineRepair*` specs), and the Firefox and WebKit Playwright projects from the post-merge plan merged (needed for C4; without them C4 is manual smoke only).

### C1. Installed PWA cold start offline (#985 criteria 1 to 4) (30 min)

- **Steps.** In Chrome open the production URL online, wait for "ready to play offline" or about 30 s, install the app. Load a saved tower, play 1 minute, save. Close every window. Turn the network off (Windows airplane mode, not only DevTools offline). Launch the installed app. Play, build something, save, close, relaunch.
- **Expected.** The game opens; About or Copy Diagnostics reads the Rust engine active with no failure reason; the clock advances; the tower and the new save reload with the same state; no failed request in the Network panel for engine files.
- **Evidence.** Screenshot of About with the network off, the Network panel showing the engine files served from the service worker, a note of the version shown.

### C2. Sound offline (#985 criterion 3) (15 min)

- **Steps.** In the same offline session click once, build, and let the music start.
- **Expected.** Build cue and music play; the two crowd voice files load from cache.
- **Evidence.** A line in the notes file saying what was heard. A listening check has no automated twin; that is why it is here.

### C3. Update rehearsal, old to new (#1522 item 3) (30 min)

- **Steps.** Install the previous build as a PWA (use a deployment URL of the last release or session F's local previous build), save a tower, then deploy or serve the candidate at the same origin, reopen the installed app online, accept the update prompt, then go offline and relaunch.
- **Expected.** Update prompt names the new build; after it, old cache is gone, the game starts and plays offline, the tower is intact, and a shell is never mixed with another build's engine package (a mismatch shows the refusal screen, never a running game).
- **Evidence.** Prompt screenshot, About before and after, a note of cache names from DevTools Application tab (old removed).

### C4. Firefox and WebKit (#1522 item 2) (45 min)

- **Automated first.** Once the CI projects exist, the cloud run covers determinism hashes in Firefox and WebKit. The PC adds only what CI cannot: a real Firefox window.
- **Steps.** Firefox (latest): open the production URL, load the nine real saves (session D) and one new game, play 5 game days at 3x, save, reload. Playwright WebKit (`npx playwright install webkit`, then the project) as the Safari stand-in.
- **Expected.** Same engine identity record, the same tower summaries as Chromium for the same save and seed (the determinism hash from the CI project), no trap, no engine failure screen.
- **Evidence.** The hash lines, screenshots of any difference, and the plain statement "WebKit stand-in, not Safari" in the notes.

### C5. CPU-throttled Chromium pass (#1522) (15 min)

- **Steps.** DevTools Performance, CPU 4x slowdown, load the large fixture save and play 2 game days at 3x.
- **Expected.** No engine failure screen, no repeated "engine stopped" prompt, the game stays playable.
- **Evidence.** Screenshot and a one-line note.

---

## Session D: save and load regression (about 1 h)

**Prerequisites.** Back up your normal Chrome profile's local storage first (a `vctower` export of each tower you care about: Saved Towers, Export). The nine real saves are in `conformance/fixtures/tdt-reddit/` (and `PK8-*` in the project files).

### D1. Nine real 1990s saves in the real browser (30 min)

- **Steps.** Import each `.TDT` in the production build, check the import report, save, reload, export `.vctower`, import it again, export `.TDT`.
- **Expected.** Each imports with the report matching `tests/tdt_real_saves.rs`'s expectations (the nine-save suite, #1534, lists them); star, funds and floor count match the file; the re-import equals the first; no engine failure screen. Basement express stops survive (2.77.3).
- **Evidence.** Screenshot per tower with the report open, and a table of star, funds and shaft count.

### D2. Your own towers on the new build (20 min)

- **Steps.** In the Chrome profile you normally play in, open the candidate (preview URL, same origin only if the preview shares storage; otherwise import your exported `.vctower` files).
- **Expected.** Each tower loads, the same name, star, funds and day as the backup's slot list; no tower lands in "unreadable save".
- **Evidence.** Slot list screenshot before and after.

### D3. Failure paths (10 min)

- **Steps.** Import a truncated `.vctower` and a renamed text file. Corrupt one stored autosave by hand in DevTools and reload.
- **Expected.** A plain refusal message, the live tower and every stored save unchanged, the corrupt autosave kept under "unreadable" and downloadable (this mirrors `e2e/saveRoundTrip.spec.ts`, now on a real profile).
- **Evidence.** Screenshots of the messages.

---

## Session E: release candidate (about 6 h after the freeze)

**Prerequisites.** The freeze, the candidate SHA pinned in `release-3.0-matrix.md`, CI green on that SHA (including the screenshot drift check and the CI-minted perf baseline), the exception register current, session 0 repeated on the candidate SHA. Only the candidate commit's numbers count for #945.

| Step | What | Notes |
| --- | --- | --- |
| E1 | Session B1 and B2 on the candidate SHA | This is the Performance row. B1's A/A pass sits beside it. |
| E2 | Version identity (#945 row): About and Copy Diagnostics | Expect UI version and commit, engine identity record from the binding (crate version, sources hash, save and layout versions), no fallback reason, plus the mismatch and unavailable states. Test the two failure states by serving a package with a wrong hash (the deployment helpers in `e2e/deployments.ts` do this locally). |
| E3 | Session C1 to C3 on the candidate's production deployment | The Deployment row's offline clause. |
| E4 | Session D1 and D2 on the candidate | Saves row, real browser half. |
| E5 | Session A1 to A3 results recorded and any approved exception in the register | Owner approval is his alone. |
| E6 | Session F, then a final C1 on whatever production serves afterward | Only on his go. |
| E7 | Copy the evidence list into #945 | Each row of the original table names the folder, file or screenshot that satisfies it. Reliability stays his (window and population numbers). |

The GO or NO-GO verdict is written by the Evidence lane from these files, never by the PC session.

---

## Session F: Vercel rollback rehearsal, #1221 (about 1 h, needs Naftali's explicit go)

This session touches production and does not start without his words in the thread. The script, tests, fixtures and procedure are in [`release-3.0-rollback-rehearsal.md`](release-3.0-rollback-rehearsal.md). In short:

- **Before.** The cloud runs the engine-layer rehearsal (previous engine loads candidate-written saves, no unexplained loss) and the local two-build browser rehearsal, both on the candidate SHA, and attaches the reports.
- **On the PC.** Record the current production deployment id, seed a fresh browser profile with candidate-written saves (`node scripts/rollback-rehearsal.ts seed ...`), roll production back to the previous deployment in the Vercel dashboard (or through the Vercel tools, on his go), run `verify --play-seconds 90`, roll forward again, run `verify --play-seconds 90` once more.
- **Expected.** Every seeded tower loads on the previous build with the same name, funds and day on the picker (the engine layer compares every field); any dropped field is on the allowed-loss list with an exception id; the installed PWA updates to the rolled-back shell and plays offline; rolling forward loads the previous build's saves.
- **Evidence.** The two JSON reports and their rendered tables (paste on #945's Rollback row), deployment ids before and after, screenshots of About on each build.

---

## Evidence checklist (what to hand back after each session)

- Session 0: the pin table (SHA, `sources`, tool versions, power plan GUID).
- A: screenshots and re-saved files in `release-3.0/tdt-reddit/pc-verify/`, outcome letters per claim, the MAP note and images.
- B and E1: results folders in the worktree (committed through a PR), preflight text per pass, notes file with three times per pass and any deviation.
- C: screenshots and a notes file per item, the DevTools cache list.
- D: tables and screenshots.
- F: the two reports and deployment ids.

Never describe a result as measured on the PC unless its folder or file exists. If a session cannot run, say which prerequisite is missing; do not substitute a cloud number.
