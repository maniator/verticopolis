# Review record: M5 W1, the startup split and the saved-tower starts

> **Snapshot of 2026-10-21 (about 02:20 to 03:00 UTC). Not live.** It records
> one `/bmad-code-review` of W1 on branch `claude/project-thread-ftmym9`: the
> first cut was commit `3977d6b` on `main` at `272e0e1`, and the fixes were
> made on `main` at `4b1e440`. The PR's diff is the live word, and #1254 tracks
> the work.

## What was reviewed

- **Skill:** `/bmad-code-review`. W1 is a measuring harness (`src/tests/perfCompare`)
  with no gameplay, engine or save code, so the gameplay skill does not apply.
  Its three layers ran as independent agents: Blind Hunter (the diff only),
  Edge Case Hunter (the diff and the repository) and Acceptance Auditor (the
  diff against `story-m5-engine-cold-start.md` A1 to A5 and the W1 row).
- **Raw findings:** Blind Hunter 26, Edge Case Hunter 11, Acceptance Auditor 11.
  After merging duplicates, 27 remain: 20 patched, 7 dismissed, none deferred
  and none left for the owner.
- **Hot-path record (`docs/performance/hot-path-review.md` section 6):** no
  hot-path surface. Every changed file is under `src/tests/`, `docs/` or
  `_bmad-output/`, which section 1 does not list.

Source tags: **BH** Blind Hunter, **ECH** Edge Case Hunter, **AA** Acceptance
Auditor.

## Patched

| # | Finding | Sources | Fix |
| --- | --- | --- | --- |
| 1 | A failed saved-tower start threw inside the repetition's `try`, so the repetition failed and its M5 samples were dropped; validation also required the rows, rejected results written before them, and counted their context losses and page errors against the run | BH, ECH, AA | The starts are auxiliary: they run after the first visit, outside the `try`, keep their own errors, page errors and context losses on a `SavedStart` record, and keep a sample only when every check passed. A gap is a validation warning; older results have no rows and no warning |
| 2 | The seed was written by an init script after navigation began, inside the timed start, and a failed write was silent | BH, ECH, AA | The seed goes in through the context's `storageState`, which Playwright writes while it creates the context, before any page opens |
| 3 | The only proof that the seed loaded was the population, and a tower of population 0 would pass | BH, ECH | The runner also requires `hadReadableSave` and no `saveWasCorrupt`; the preflight refuses a scenario with no people |
| 4 | A seed that could not load was found only after a process's timed passes, in every repetition | ECH | `checkAutosaveSeeds` packs each seed and reads it back through `SaveGame.loadResult` in Node before the first browser starts |
| 5 | The saved boots ran after the last renderer read, and the comments said "last" while the first visit ran after them | ECH, AA | Each saved start reads the renderer and drops its sample when it differs from the process's start; the starts now really run last |
| 6 | The seed's bytes were not recorded, a resumed run packs new bytes, and the memo was keyed by scenario name (a test locked in the stale seed) | BH, ECH, AA | Memo keyed by save text; each record keeps the seed's sha256; validation warns when one scenario's seeds differ across runs; the test now checks that a different save gets its own seed |
| 7 | Nothing tied the mark to the boot point it is read as; a negative split would be averaged | BH | `pageProbes.test.ts` pins the first `publishBootState(` after `await loadBootEngine(` and before `create();`, and that only `publishBootState` writes the state; a mark after ready gives no split |
| 8 | The load phase could not be read with the paired statistic, and the W1 row named a DCL start and #1005's split that were not built | BH, AA | `engine loaded` (navigation to the boot's publish) is printed with the paired difference; the W1 row now lists what W1 builds, and #1005 stays on its own row |
| 9 | W1's dependency on #1183 was not met or explained | AA | A5 and the W1 row: whichever merges second resolves the overlap, and a BEFORE/AFTER pair has #1183 on both sides or neither |
| 10 | The split rows got cross-engine verdicts although each engine's span covers different work | BH, AA | A `noVerdict` reason on every "loaded to ready" row, dropped in an A/A pass like the boot-order one |
| 11 | The probe also reached perf:worker pages (shared `installProbes`) and ran inside the timed start, undisclosed | ECH, AA | The probe is its own init script, `installEngineBootProbe`, which only perf:compare adds; `installProbes` is unchanged. The setter's one `performance.now()` inside the start is disclosed in A5 |
| 12 | The story's snapshot header gave the cloud figures no window, cited a project-files path for the PC run, and A2's figures read as a statistic | AA, BH | Header names both windows and commits and the committed PC results folder; A2 gives the medians and the paired difference |
| 13 | The backlog row's status, type and epic broke the table's conventions, and it listed W1 to W5 only | BH, AA | `engine-rs`, `perf`, `in-progress`, W1 to W8 |
| 14 | "engine settled" read like bootstrap's later `noteEngineSettled` | AA | Renamed to "engine loaded" and "loaded to ready" |
| 15 | The saved-tower rows were described as a returning player's Continue and invited subtraction from M5's row, though they run in a warmer process | BH | The docs, the limitations line and the report heading say to compare them across engines only, and why |
| 16 | The reported table printed thin intervals like gate-grade ones | ECH | The pairs column flags a count under the gate's minimum, as M5's lines do |
| 17 | Test gaps: the M5-exclusion assertion checked nothing absent, the A/A lookup passed with no row, the report wiring and the row names were unpinned, the seed helpers ran only in a DOM environment, the source guard was CRLF-fragile and did not check the context close, and the context leaked on a throw | BH, ECH | Each fixed: absence and count assertions, a defined-row check, a `markdownReport` check, the names shared from `metrics.ts` and tested against the rows, a Node-environment seed test, CRLF normalization, a guard on the fresh context and its `finally` close |
| 18 | `ts-vs-wasm.md` said the report prints every new row with the paired difference, which `engine settled` lacked | BH | True now (finding 8), and the paragraph is rewritten |
| 19 | Story figures: "a frame and a half", the variant table's header and missing repetition counts, which host M5 is about, the saved rows being 1x only | BH | Each corrected or stated |
| 20 | New prose used the "X, not Y" pattern | AA | Rewritten in the story, `savedStart.ts` and `pageProbes.test.ts` |

## Dismissed

| # | Finding | Sources | Why |
| --- | --- | --- | --- |
| 1 | The population could drift between ready and the read | BH | A seeded boot waits paused on the title screen (ECH traced the boot flow), so the tower does not tick before the read |
| 2 | On WASM, `game.sim` is the TypeScript tower, so the check does not prove the engine got the save | BH | The engine check rejects a fallback, and the WASM host is attached from that same tower before ready (the hosted-before-ready check), so the engine runs the loaded tower |
| 3 | The autosave key is a copied literal | BH | The Node round trip reads it through `SaveGame.loadResult`, which fails if the two differ |
| 4 | The probe test leaves accessors on the window | BH | Vitest gives each test file its own environment |
| 5 | M5's readers do not filter on scenario | ECH | No new row uses M5's name, and a test pins that M5's lines leave the saved rows out |
| 6 | The backlog row has an em-dash | BH | It is the table's empty-cell placeholder, as on every row |
| 7 | The saved-tower ready row gets a verdict in the comparisons table | AA | Every row of that table is reported only and M5's gate is its own lines; this row times the same work on both engines, so its ratio is a fair comparison. The split rows, which do not, lost their verdicts (patched 10) |

## Second pass

An Edge Case Hunter re-pass over the fixed diff found no correctness bug in
the fixes. It confirmed that Playwright's storage-state setup sends no request
to the perf server and finishes before the context's init scripts are added,
that the Node seed check restores the global storage on Node 22, that the
perf:worker harness is unchanged, and that M5 and ε cannot move. Its six
edges:

| # | Finding | Class | Outcome |
| --- | --- | --- | --- |
| 1 | A seed that failed to pack inside `savedStarts` would throw after `run.ok`, outside any catch, and lose the repetition (unreachable after the preflight, reachable from another caller) | patch | The seed is made inside the start's `try` |
| 2 | `startup()`'s last page read has no bound, so a hung saved start could stall the run | patch | The saved start's `startup()` is bounded at 5 minutes |
| 3 | A context whose setup throws after `newContext` is not closed until the browser closes | dismiss | It has no page and closes with the browser at the end of the process; changing `newContext`'s body would widen the measuring diff for no measurable gain |
| 4 | A stored result with an earlier shape of `coldSaved` would make validation throw | patch | Optional reads in validation (nothing re-validates stored results today) |
| 5 | A5 named only the probe's setter, while Playwright also evaluates the script at each document start inside the timed window | patch | A5 and the PR name the whole cost |
| 6 | The staged index and the working tree differed in `runner.ts` | dismiss | Checked before committing; the committed text is the reviewed one |

## Re-verification

After both passes, merged onto `main` at `22d1d1d` (with #1183 and #1185):
the four gates, and a two-repetition `perf:compare --quick` in the cloud that
checked the wiring only (the seed check, a sample from every saved start on
both engines, the reported table). No number from that run is evidence.
