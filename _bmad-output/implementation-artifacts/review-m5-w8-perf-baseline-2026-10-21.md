# Review record: M5 W8, the perf gate's baseline per engine (#900)

> **Snapshot of 2026-10-21 to 2026-10-27. Not live.** It records one
> `/bmad-code-review` of W8 on branch `claude/project-thread-ftmym9` (PR
> #1295): the layers read commit `01c8667` on `main` at `02a9129`; the fixes
> were made after the CI mint's bot commit `eb44215`, Copilot's `6f8a492` and
> a merge of `main` at `d8e5a84`. The PR's diff is the live word, and #900
> tracks the work.

## What was reviewed

- **Skill:** `/bmad-code-review`. W8 is CI tooling for the perf gate (`e2e/`,
  `scripts/`, `src/tests/`, `.github/`), with no gameplay, engine or save
  code, so the gameplay skill does not apply. Its three layers ran as
  independent agents: Blind Hunter (the diff only), Edge Case Hunter (the diff
  and the repository) and Acceptance Auditor (the diff against the W8 row of
  `story-m5-engine-cold-start.md`, the #900 row and the plan's M7 row).
- **Raw findings:** Blind Hunter 19, Edge Case Hunter 12, Acceptance Auditor
  13. After merging duplicates, 35 remain: 23 patched, 5 deferred to the #900
  row, 7 dismissed. One patched finding (4) leaves a choice with the owner:
  which WASM budgets block before M7's calibration.
- **Outside reviewers on the PR:** Codex (three threads) and Copilot (one
  thread, and commit `6f8a492`, which made the WASM speed budget report-only).
  Each thread maps to a finding below.
- **Hot-path record (`docs/performance/hot-path-review.md` section 6):** no
  hot-path surface. Every changed file is under `e2e/`, `scripts/`,
  `src/tests/`, `.github/`, `docs/` or `_bmad-output/`, which section 1 does
  not list; the `e2e/helpers.ts` change is a comment.

Source tags: **BH** Blind Hunter, **ECH** Edge Case Hunter, **AA** Acceptance
Auditor, **CX** Codex, **CP** Copilot.

## CI's first calibration round (the mint at `eb44215`)

Five WASM passes on one runner, each held to the median of the five:

| Budget | Tolerance | Worst pass | Passes outside |
| --- | --- | --- | --- |
| ui.update median | x1.05 | x1.209 | 1 of 5 |
| ui.update p95 | x1.1 | x1.162 | 1 of 5 |
| sim speed | x0.9 | x0.963 | 0 of 5 |

CI did not show the cloud's 0-or-0.48 speed split. The ui.update budgets miss
the δ cap (5%), so a blocking WASM gate at today's values would fail about one
unchanged run in five. That is round 1 of the plan's M7 calibration.

## Patched

| # | Finding | Sources | Fix |
| --- | --- | --- | --- |
| 1 | `committed()` read any git failure as "no committed file", so a mint could drop the TypeScript entry, and `mintProblem` compared against the same wrong file | BH, ECH | Only a HEAD with no such path (`git ls-tree`) reads as empty; any other git failure throws with git's stderr. The script also refuses when the file on disk differs from HEAD's before it writes |
| 2 | A plain local `npm run perf` wrote host-machine numbers into the tracked file whenever an engine had no entry | BH, ECH, AA | Only `PERF_CAPTURE=1` writes the file (a preview). A plain local run annotates its numbers and writes nothing; the decision is `runAction`, tested |
| 3 | The parser accepted a zero or malformed entry (a zero speed floor passes any run; a missing part threw a `TypeError`), and the capture wrote unchecked values | BH, ECH | `measurementProblem` requires both parts and every value finite and above zero; `parseBaselineFile` and the capture use it, with the re-mint marker in the message |
| 4 | The WASM leg blocked CI on uncalibrated tolerances above the δ cap: the speed probe can read 0, and CI's round 1 put ui.update outside on one pass in five | BH, ECH, AA, CX, CP | Copilot's `6f8a492` made the WASM speed budget print and gate nothing. Which WASM budgets block before M7's calibration is the owner's call, pending, so this head keeps that split and puts it in one constant (`BLOCKING`), every WASM budget printing to the log and job summary marked blocking or reported. The lane's recommendation, with the data, went to him: all three WASM budgets print until calibration |
| 5 | A dispatch could mint from one to four passes | BH, AA, CX | The workflow takes 5 to 10, and the script refuses fewer than `MIN_MINT_PASSES` (5) |
| 6 | M7's reading compared towers built two ways (in place against a loaded save, #905) at different clock times, unnamed | BH, ECH, AA | M7's lines carry a note naming both, and the `buildToStar` comment says which entry measures which tower. Making the fixtures match re-mints the TypeScript entry, so it is deferred (D1) |
| 7 | The "A/A spread" was one job's within-run spread, and nothing could read the TypeScript spread without re-minting it | BH, AA | Renamed a within-run spread with its limits stated; a dispatch with `dry_run` measures and prints and commits nothing; the docs say calibration reads the `perf <engine>:` lines of CI runs and dry runs |
| 8 | M7's reading never printed while the WASM entry was missing, and only reached the raw log | BH, ECH, AA | The measurement, M7's reading and the WASM engine's own reading print before anything can fail, and also go to the job summary |
| 9 | The test pins the TypeScript numbers, so a re-mint fails `npm test`, undocumented | BH, ECH, AA, CX | Kept on purpose (the entry is the approved gate and a re-mint is the owner's call); the workflow header and the test say so |
| 10 | `engine-wasm` built the crate for a run the engine step refused | BH, ECH | `needs: resolve-image` |
| 11 | A dispatch could commit a baseline to `main` or a tag | BH, ECH | Refused unless it is a dry run |
| 12 | A rebase conflict in the push loop left HEAD at the remote tip, so the next push "succeeded" with nothing pushed | ECH | The rebase failure aborts and fails the job |
| 13 | A pass holding `null` (a NaN) was sorted as zero, and a refused mint showed no numbers | ECH | `entryFromPasses` checks each pass first; the script prints the passes before anything can refuse and writes the file last |
| 14 | The spread reached only the job summary, so the bot's commit carried no sign of a noisy mint | ECH | The spread goes into the bot commit's message. Refusing such a mint is deferred (D3) |
| 15 | Nothing forced the passes to run one at a time | BH | `--workers=1` on the measure step (the config already sets one worker) |
| 16 | `tol` could only take today's literal values | BH | A `PerfTolerances` interface |
| 17 | The header said "five times" while dispatch took 1 to 20, and the timeout assumed fewer passes | BH | Header rewritten, with the pinned environment spelled out; passes capped at 10 inside the 90-minute timeout |
| 18 | The passes artifact could not be re-uploaded on a job re-run | BH | `overwrite: true` |
| 19 | A missing engine field printed "records the engine undefined", pinned by a test | BH | "records no engine" |
| 20 | Test gaps: the missing-entry decision, the workflow's engine step, a zero or malformed entry, the byte-for-byte round trip, a pass order | BH, AA | `runAction` tests, `perfBaselineWorkflow.test.ts` (runs the engine step's script as the runner does and checks the job wiring), parse tests, a round-trip test of the committed file, an order-independence test; the mint script was run locally on synthetic passes (dry run, three passes, a tampered file, no repository) |
| 21 | The 5,000+ population precondition was not asserted | AA | The spec asserts the fixture reaches TOWER, which needs 15,000 people (`TOWER_POPULATION`) |
| 22 | Stale docs: the skip rows in `story-engine-test-parity.md`, the #900 row's opener, M7's harness column; S13's second clause unplaced | AA | Each updated; the #900 row says S13's second clause is the desktop M1 to M6 (plan section 5.3) |
| 23 | New prose used the "X, not Y" pattern | AA | Rewritten |

## Deferred (recorded in the #900 row, decided with M7's calibration)

| # | Finding | Sources | Why later |
| --- | --- | --- | --- |
| D1 | One build path and one clock time for both towers | BH, ECH, AA | It re-mints the TypeScript entry, which is the owner's call |
| D2 | Longer speed windows on both engines (4-second windows see the clock's 2-minute steps) | BH, CX, CP | The same: it changes the TypeScript entry's harness |
| D3 | Refuse a mint whose own passes fall outside the tolerances | ECH | The tolerances are what the calibration sets; until then the spread goes into the commit |
| D4 | Record which build (switchable or wasm-only) an entry was minted on | ECH | Nothing runs `@perf` on the wasm-only lane yet |
| D5 | The TypeScript entry is one run, the WASM entry a median of five | BH | The calibration reads both engines' spreads and decides |

## Dismissed

| # | Finding | Sources | Why |
| --- | --- | --- | --- |
| 1 | No WASM entry at `01c8667`, so the gate failed | BH, AA | The mint's bot commit `eb44215` holds it, and a test now requires it |
| 2 | Parallel local captures overwrite each other | BH | `playwright.config.ts` sets one worker, so captures run in turn |
| 3 | The engine check on the TypeScript project rests on unverified assumptions | BH | CI's run of `01c8667` passed the `chromium` leg, and `expectEngineHosted` does nothing off WASM |
| 4 | The workflow depends on unseen `package.json` scripts | BH | `perf:capture` is `PERF_CAPTURE=1 playwright test --grep @perf` (no nested `npm run`), the CI mint ran five passes, and `tsx` is a pinned devDependency |
| 5 | The backlog row's `in-progress` status | BH | The mirror test accepts it, and other rows use it |
| 6 | The marker's prefix match also catches prose and both markers | BH, AA | On purpose, so a misspelled marker fails out loud; the TypeScript pin backstops an accidental TypeScript mint |
| 7 | W8 was rewritten in the commit that built it | AA | Information: the row now follows the plan's M7 protocol, and nothing in it loosens a gate |
