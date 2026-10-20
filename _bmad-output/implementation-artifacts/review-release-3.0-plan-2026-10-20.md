# Review record: the 3.0 web release plan (Phase 2)

> **Snapshot of 2026-10-20, against `main` at `8f3a143`. Not live.** It records
> one review of the planning PR on branch `claude/release-3.0-plan-sh109t`.
> The plan's current text is the live word:
> `_bmad-output/planning-artifacts/release-3.0-web-plan-2026-10-20.md`, and its
> matrix's live copy is the tracking issue created on approval.

## What was reviewed

- **Skill:** `/bmad-code-review` (the change is docs and backlog only, with no
  engine or gameplay code), with its three layers run as independent agents:
  Blind Hunter (diff only), Edge Case Hunter (diff plus repository access) and
  Acceptance Auditor (diff plus a restated spec of the owner's Phase 2 brief).
- **Diff:** the uncommitted planning change against `main`:
  - the plan, `release-3.0-web-plan-2026-10-20.md`;
  - the snapshot matrix, `release-3.0-matrix.md`;
  - the party transcript, `_bmad-output/party-mode/release-3-0-planning-party-2026-10-20.md`;
  - the pointer added to `rust-wasm-web-cutover-plan-2026-10.md`;
  - `backlog.md`: the D6 priority changes and 12 restored rows;
  - the party memlog, `_bmad-output/party-mode/memories/cross-cutting-review/.memlog.md`.
- **Raw findings:** Blind Hunter 39, Edge Case Hunter 19, Acceptance Auditor 29
  (27 findings plus 2 from its mechanical prose checks). One more came from
  the orchestrator's own prose scan. After merging duplicates, 69 unique
  findings remain, listed below.
- **Result:** 62 patched; 6 sent to the owner as decisions (inside OD-2, OD-6,
  OD-8 and OD-9); 1 deferred to a backlog row (#1079). One part of a patched
  finding was dismissed. Two patched findings also widened OD-1 and OD-4 with
  the owner parameters they exposed.

Source tags: **BH** Blind Hunter, **ECH** Edge Case Hunter, **AA** Acceptance
Auditor (by severity band, since its findings are unnumbered), **O**
orchestrator. Section numbers are the plan's.

## Triage

### Precedence and status

| # | Finding | Sources | Class | Outcome |
| --- | --- | --- | --- | --- |
| 1 | The cutover plan's new pointer ranks the unapproved draft above itself, and its two clauses contradict each other | BH1, ECH18, AA High | patch | The pointer now says the Phase 2 plan amends nothing until the owner approves OD-7, and the cutover plan's stories, criteria and gate rows hold until then |
| 2 | The memlog records "3.0.0 ships the switchable build" as an outcome, and the matrix lists the proposed cue-timing spec as blocking | BH1, AA Low | patch | A memlog correction marks it as the room's recommendation for OD-5; the matrix's End to end row reads "if OD-7 adds it" |
| 3 | Section 14 sends the plan's review to the PR instead of a BMAD location | AA Low | patch | This file |

### The dependency graph and the order of work

| # | Finding | Sources | Class | Outcome |
| --- | --- | --- | --- | --- |
| 4 | The candidate waits on gates (RUN-3, the reliability tail) that can only run on the candidate | BH2 | patch | Section 3 defines the candidate engine (the frozen key) and the candidate commit; the graph routes every gate row to a gate review node after the candidate |
| 5 | The flowchart, matrix and phases disagree; DUAL and CONF dead-end; Phase C's exit is unmeetable while unrelated P3 engine rows are open | BH35 | patch | One graph with every gate row reaching the gate review; Phase C's exit scoped to "work on the 3.0 path that changes the key" |
| 6 | The 14-night differential is listed as "start now" in the graph but is step 5 of 7 in WS-B, behind the held #1068 | AA Medium-high | patch | B2 is WS-B's third step, after B0 and B1, and no longer waits on B7 |
| 7 | B4 depends on #865, scheduled after it; the nightly's 60-minute budget is never addressed | BH24, ECH14 (part), AA Medium-high | patch | #865 (B4) moves ahead of #867 (B5); upgrade item 4 lands before the counting window; B2's spec sets the time budget (4.2 item 8) |
| 8 | S12 (and S14) are scheduled in Phase D, inside the freeze they must land before | AA Medium-high | patch | B6 (S12 and the Saves audit) lands before the freeze. S14's engine half (#879's pins in `gameplay.rs`) also moved to Phase C, after the orchestrator's re-check of this outcome found it still in Phase D |
| 9 | The graph drops the cutover plan's S3 → S6 dependency and the S4 → S16 edge | AA Medium-high | patch | #1062 can meet the Unit and integration row with the six merge-per-tick timeouts named, and S6 removes them; C1 depends on A3 |
| 10 | The rendering stack gets the third thread ahead of the performance and offline lanes | BH6, AA Medium | patch | Thread order in 9.3 is WS-P, WS-C, WS-R, WS-D; 7.1 records the reasoning |
| 11 | #965, #841, the gallery and baseline re-mint at the flip, and the version-bump owner under auto-merge have no owner | BH39 | patch | #965 sits in A6, the #841 check in A1, the re-mint in X3, and each PR's author bumps the version (9.7) |

### Shared files

| # | Finding | Sources | Class | Outcome |
| --- | --- | --- | --- | --- |
| 12 | The file table has collisions (#902 and `wasmHost.ts`, A1 and `startWasmHost.ts`, B5 and `src/engine/sim/*`, S7 and `src/render/**`, S17 and `wasm.rs`) | BH5, AA High | patch | 9.5 is rebuilt from each PR's real file list, with a first holder and a release condition per row. #1062 and #902 share the parity setup files, so #1062 merges first |
| 13 | `exportTiers.ts` is held by WS-B indefinitely, but A3, A5 and A6 add exports that need tier entries | ECH10 | patch | Each lane adds the tier entries for its own exports in the same PR, and no lane holds the file (the first wording, "regenerated on rebase", was wrong: the file is hand-written; corrected in round 2) |
| 14 | Unowned or doubly owned files: `src/engine/sim/*` release, `conformance/expected.json`, `engineChoice.ts`, `bootstrap.ts`, `engineBoot.ts` | ECH11, AA High | patch | Rows added with release conditions; the conformance lock is in the regenerated row |
| 15 | The matrix's file table differs from the plan's | BH5, AA Low | patch | The matrix copy matches 9.5 (only after round 2, which copied the table verbatim) |

### The replay window

| # | Finding | Sources | Class | Outcome |
| --- | --- | --- | --- | --- |
| 16 | The differential never runs the artifact that ships (wasm32, a 32-bit `usize`, another libm) | BH9 | patch | Upgrade item 7: a share of each night's seeds runs through the WASM build |
| 17 | The key leaves out `Cargo.toml`, the toolchain pin, the event catalog, the TypeScript side of the compare, `package-lock.json` and `.nvmrc` | BH9, ECH2 | patch | The key is `engineSourceHash` of `engine-rs/`, `src/engine` without tests, the compare script's import closure outside `src/engine`, `package-lock.json`, `.nvmrc` and `engine-fuzz.yml` |
| 18 | The key resets on changes the fuzzer never runs (the binding, inline Rust tests, the TDT codec) | ECH9 | patch | Accepted on purpose and written down: "The key is deliberately wide", since a missing input lets an untested change through and an extra reset costs only time; R5 names it |
| 19 | The count does not say what happens to manual, re-run, skipped or timed-out nights | ECH4 | patch | Counting rules (scheduled, first attempt, default seeds, one per UTC date), what resets, what neither counts nor resets, a ledger in the tracking issue, and run hygiene in item 8; risk R20 |
| 20 | The neutral-change exemption swaps a passing test in for the window, and any Rust-only change meets it by construction | BH27, ECH13, AA Medium | patch | The exemption is removed (4.2) |
| 21 | The transcript says a command Rust refuses and TypeScript accepts is never compared, which is false for `build`, `buildTransport` and `callExterminator` | ECH14 | patch | 4.2 states which refusals stay as `expectFail` and which six are dropped; item 4 is scoped to those six; the transcript is corrected |

### Reliability

| # | Finding | Sources | Class | Outcome |
| --- | --- | --- | --- | --- |
| 22 | The web game has no consent switch, so "749 consented sessions" and "consent off sends nothing" have no referent | ECH3 | patch | The figure is "749 sessions" from the `session_lengths` view; the fields keep the relay's posture (no cookie, no `localStorage` identifier, codes only); the proposed Analytics and Reliability rows drop the consent wording |
| 23 | A stored arm may change the privacy posture and the help text | ECH3 | patch | The arm is a label from a closed list, and OD-1 includes the help-text sentence |
| 24 | `size-gated` is filed as a fallback reason, and the `engine` enum lacks `wasm-frame`, `wasm-worker` and `none` | BH11, ECH5, ECH6, AA Low | patch | `size_gated` is its own flag, kept out of both counts; the `engine` enum covers every placement and `none` |
| 25 | "Zero unexplained fallbacks" has no meaning when every fallback carries a code; the list has no catch-all | BH12, ECH6 | patch | "Every fallback triaged to a root cause"; an `other` code is added |
| 26 | The arm can be redrawn, overridden or mislabeled (private windows, `?engine=`, `vc.engine`) | ECH5 | patch | The `arm` values include `override` and `unassigned`; 4.1 sets precedence and analysis by assigned arm |
| 27 | The session unit, re-adoption within a page life, the best-effort relay and device clustering are undefined | ECH6 | patch | The unit is the page life with the `session_lengths` walk, a fallback counts once per page life, both counts are reported, and the rate is stated as a lower bound with triage by repeat; risk R21 |
| 28 | Package-mismatch fallbacks are known by design and count against the gate, while #1046 waits for them to accumulate | BH33 | decision | OD-2 asks whether `package-mismatch` counts against the engine; the recommendation reports it on its own line |
| 29 | Missing owner parameters (the M4 allowance, the size-gate threshold), days only at 1,000 sessions, a mislabeled header, and no second-load rule | BH38 | patch | OD-1 and OD-4 carry the parameters; the 4.1 table gives days at 1,000, 3,000 and 4,750 sessions at full and 50% arms, from the governed 749 sessions per 30 days; the size gate is checked when a tower loads, and A4's spec defines a second load in the same page life |
| 30 | "Cannot pass as written" reads "under 0.1%" as an upper bound; read literally, zero in 1,000 passes | AA Low | patch | R4 reads "Certain as an upper bound"; OD-2 asks whether the rule is a point estimate or a bound |
| 31 | A1 ships production analytics fields with no stated owner gate | AA Low | patch | Section 13: approving the plan approves A1's fields once reviewed, since they change nothing a player sees |
| 32 | The transcript's two-minute median has no governed source | BH29, AA Low | patch | Cited as the 132 s median session from the governed view (the 2026-10-13 findings); memlog correction appended (round 2 corrected "page life" to "session") |
| 33 | The existing `$exception` path sends a bounded message and stack for any uncaught error, so "no raw error text leaves the device" is false, and an engine trap could escape there | ECH3 | patch | 4.1 states what `$exception` sends and that A1 routes the traps the host catches through the coded path |

### Performance

| # | Finding | Sources | Class | Outcome |
| --- | --- | --- | --- | --- |
| 34 | The `.wasm` hash is not reproducible across builders (it embeds the cargo registry path), so "a mismatch voids the run" voids every desktop run | ECH1 | patch | Run identity is the engine source hash recomputed from git; the `.wasm` hash is recorded only (5.2) |
| 35 | Same finding: make the WASM build reproducible so the binary hash can be compared | ECH1 | defer | Backlog row `engine-wasm-reproducible-build`, #1079 (P3, Ready) |
| 36 | R0 cannot meet the protocol's own preconditions on `e25ec01`, and it cannot settle the 1,640 figure | BH8, ECH16, AA Medium | patch | RUN-0a reproduces `e25ec01` on its own harness now, identified by source hash; "settles both" is dropped |
| 37 | Zero-margin acceptance in the restored rows (#1049, #1050, #1051), and a recommended δ of 5% right after the warning against reusing it | BH10, AA Medium | patch | The rows are read under the protocol's margin; δ is calibrated by an A/A pass in RUN-0b |
| 38 | The late-game fixture the Performance row names is replaced by the harness towers without saying so (#864) | AA Medium | patch | OD-4 asks: the harness towers in place of the late-game fixture, or #864 on the path |
| 39 | The pass rule never says which way the ratio runs; the harnesses report opposite orientations | ECH7 | patch | Ratios are oriented so above 1 means WASM is worse, per metric, and the harness emits the gate's orientation (B3) |
| 40 | "Every committed run" ignores the inconclusive `01c6153` row, and the range is wrong | BH15, ECH15, AA Medium | patch | "Every conclusive committed run", 1.15x to 1.43x paired, `01c6153` inconclusive at 1x; #1051's row matches |
| 41 | The transcript calls #1045's "1,990" the bare figure; it is the hosted one | BH16, AA Medium | patch | Transcript corrected; 5.1 names both figures |
| 42 | `perf:compare` is cited for a bare-step ratio while 5.2 says it measures startup and bytes | BH34 | patch | 5.2 corrected; the table names each run's harness |
| 43 | The hourly merge is named the cause of the shipping host's cost without a main-thread measurement | BH30, ECH8 | patch | The cost is split from the committed rows: about 2,265 ms of per-step sync (what `wasm-frame` removes) and about 2,207 ms of merge in the worker column; B3 adds the main-thread split |
| 44 | Figures are quoted with no folder beside them, and TypeScript's hosted 692 ms sits below its bare 702 ms | BH28, AA Medium-low | patch | Each figure names its folder; 5.1 explains that the two are separate measurements with overlapping intervals; "M5 passes" reads "met as last measured" |
| 45 | M7 disagrees with #900 on what the baseline is | BH31 | patch | M7 holds the WASM run to TypeScript's baseline, and #900 adds a baseline per engine |
| 46 | The gate measures no editing, where the full-save merge hurts most | BH32 | patch | M8, an edit scene on the host that ships, built in PF2 |
| 47 | The `saveDelta` choice in S6 is decided by a run after S6 lands | BH3, AA Medium | decision | OD-9 (ii), decided after RUN-0b's cost split, before A5 starts |
| 48 | The plan bets on the structural snapshot that the #868 row's own research recommends against | BH4 | decision | OD-9 (ii) puts design A against design B to the owner; the #868 prefix now names the sync, the merge and OD-9 |
| 49 | B3 moves #1068's Windows build fix to `main` around the D2 hold | AA Medium | decision | OD-9 (i) asks the owner; section 13 ties B3's extraction to that approval |

### Authority and saves

| # | Finding | Sources | Class | Outcome |
| --- | --- | --- | --- | --- |
| 50 | #1066's `.TDT` half routes imports through the Rust codec while its prerequisites (#885, #886, #887, #920) sit after the flip | BH7, AA High | decision | OD-8: keep #1066 whole (the four rise to P1 in this PR, and #885 needs the owner's real saves) or split it; R14 names the owner gate |
| 51 | #1064 is described as S4's case in one place and S9's in another | BH13 | patch | #1064 is S9's engine-first mirror of S4's instance-first report; A3 keeps S4's, A6 owns #1064 |
| 52 | The restored rows describe code from the lost #954 branch as if it were on `main` | BH14 | patch | #1064, #1065, #1066 and #1071 each say they describe the lost branch and how `main` behaves today |
| 53 | The rollback rehearsal does not test the #902 data loss it cites | BH26 | patch | A deploy rollback to the last release before #902, with a tower written mid-booking |
| 54 | The Authority gap counts only `src/ui` and `src/game`; `src/render` adds 12 to 13 files | AA Low, ECH11 | patch | Counted, and #921 parts 2b and 2c take `src/render` after the stack |
| 55 | #893 is set aside without addressing cutover decision 4 (3.0.0 rests on the crate's compatibility policy) | AA Medium-low | decision | OD-6 puts both options to the owner |

### Labels and backlog rows

| # | Finding | Sources | Class | Outcome |
| --- | --- | --- | --- | --- |
| 56 | The D6 rule is applied to issues it does not cover (#932, #1048, #1051) | BH17 | patch | The rule gains the owner's 2026-10-16 order; #1048 stays P2 as worker tooling; #1051 rests on the Performance row |
| 57 | Freeze prerequisites stay P3 (#859, #1067, #1059) and #926 rises wholesale | BH18, AA Medium-low | patch | #1059 rises to P1; #926 rises for items 1 to 4 only; #859 stays P3 as one candidate inside #1051 and #1067 lands before the freeze or goes to the register, both stated in section 8 |
| 58 | #873's priority disagrees between the matrix and the #945 row | BH19 | patch | #873 is P2 on GitHub and in its row; the #945 row now says "#873 at P2" |
| 59 | The #932 row reads "Gated" while P1, and asks for a low-end device the protocol lacks | BH20, AA Medium-low | patch | Ready, with a 4x CPU throttle standing in for the device, and landing before the freeze |
| 60 | "12 issues on the 3.0 path" overclaims, and #1053's status is unstated | BH21 | patch | "Six are on the 3.0 path" and six are worker-host or gated work; #1053 already has a row |
| 61 | Restored rows cite issues whose titles still carry banned prefixes | AA Low | patch | Section 8 lists the prefixes to drop when this PR merges, the moment the rows reach `main` |

### Process, numbering and provenance

| # | Finding | Sources | Class | Outcome |
| --- | --- | --- | --- | --- |
| 62 | Run IDs collide with risk IDs; no risk covers an S4 slip; R17's trigger fires by design | BH22 | patch | Runs renamed RUN-0a to RUN-3; R19 covers the S4 slip; R17 fires beyond the entries the plan already names |
| 63 | #1048's reproduction and the old-harness run share "R0"; the #1048 → #1051 link is not wired | BH25 | patch | RUN-0a and RUN-0b are separate; #1051 no longer measures through #1048 |
| 64 | The patch order contradicts "apply to the stated base"; the patches' custody and full hashes are missing; criterion 7 and #1059's landing disagree | BH23, ECH12, AA Low | patch | Apply on the stated base, then merge `main`; the full SHA-256 of each patch is in section 2; the patches are with the coordinator; #1047 is criterion 5's design and criterion 7 is open; #1059 lands with #874 |
| 65 | D2 to D4 are used but never defined, and D and OD numbers invite confusion | BH36 | patch | Section 1.1 lists D1 to D6 |
| 66 | "No #945 row passes today" conflicts with Coverage | BH37 | patch | "No row passes today except Coverage" |
| 67 | "Push at every green step" conflicts with CLAUDE.md's batching, and "bump at merge time" means a push after approval | ECH17, AA Medium-low | patch | 9.7: push early while a draft, then batch fixes once review starts; bump just before the final review, and re-bump on rebase |
| 68 | The D3 takeover list leaves out #1047 and #1059 | AA Low | patch | Both added |
| 69 | Prose: "judder" (chiefly British), "X, not Y" constructions in the plan and transcript, `sw.js` called no-store, and he/his for the owner | AA prose, ECH19, AA Low, O | patch | "stutter"; each construction rephrased; `sw.js` is `max-age=0, must-revalidate` and only `version.json` is `no-store`; the owner is "the owner" |

## Dismissed

- **Part of finding 33: redact or reroute the existing `$exception` event.**
  The event predates this plan, sends a bounded message and stack by a
  documented choice (the privacy note in `src/analyticsErrors.ts`), and is not
  a 3.0 gate input. The plan states what it sends and keeps A1's new fields
  coded. Changing `$exception` is its own analytics decision for the owner,
  outside this release.

## Owner decisions this review created or widened

- **OD-8** (new): #1066's `.TDT` half, finding 50.
- **OD-9** (new): what may come out of #1068 while its hold stands, and S6's
  design, findings 47 to 49.
- **OD-2** (widened): point estimate or bound, and `package-mismatch`,
  findings 28 and 30.
- **OD-6** (widened): cutover decision 4, finding 55.
- **OD-1 and OD-4** (widened): the owner parameters of findings 29 and 38.

## Confirming pass (round 2)

The same three layers ran again as independent agents on the revised diff,
with this record in it. The Acceptance Auditor also checked every round 1
outcome against the text. It confirmed the six decisions, the defer, every
cited performance figure, the patch hashes, the source hash of `e25ec01`, the
import counts and the backlog format, and listed the outcomes the text did
not fully support (4, 5, 12, 13, 15, 30, 32, 44, 62 and 69). Those are
corrected above or below.

Raw findings: Blind Hunter 22 plus 9 nits and a prose list, Edge Case Hunter
14, Acceptance Auditor 12. After merging duplicates, 39 remain; all are
patched, and one also widened OD-2.

| # | Finding | Sources | Class | Outcome |
| --- | --- | --- | --- | --- |
| R2-1 | The replay key includes `package-lock.json`, whose version fields change with every version bump, so any player-facing merge resets the 14 nights | BH1, ECH1, AA1 | patch | Key item 5 hashes the lockfile without its root `version` fields; version bumps keep merging during the freeze; R5 says so |
| R2-2 | Dependabot rewrites the pins in `engine-fuzz.yml` and the lockfile | ECH1 | patch | Merges to the key's paths, Dependabot's included, wait for the 14 nights; a security fix that cannot wait restarts the count on the owner's call |
| R2-3 | The reliability tail has no definition, and section 3 says both windows count only on the candidate engine | BH2, AA3 | patch, OD-2 widened | Sessions from every build since S4 count toward *N*; the tail is every session on the candidate build over the 14 nights, triaged, with no latch-off (about 175 at a 50% arm, a projection); the candidate deploy is an owner step in the graph and in OD-1; OD-2 asks for the tail's rule |
| R2-4 | The reliability unit: 749 counts session ids, the view's walk cannot count page lives exactly, and `boot` fires before the host starts | BH21, AA3, ECH3 | patch | The unit is the governed session (a distinct session id); *N* counts sessions; A1 mints a page-life id and sends its fields after the host settles and on each runtime fallback |
| R2-5 | This record cited a confirming pass before one had run | BH3 | patch | Finding 8's outcome reworded; this section records the pass |
| R2-6 | Phase C's exit points at a list the matrix does not have | BH4 | patch | The matrix's work items carry a "Changes the key" column, and Phase C ends when none of them is open |
| R2-7 | The graph and the matrix order B2 and B4 in opposite directions | BH5, AA2 | patch | `DIFF --> P865` |
| R2-8 | The graph runs the gate review before the rollback rehearsal | BH6 | patch | The rehearsal runs on the candidate commit and feeds the gate review, which feeds the flip |
| R2-9 | The graph has no End to end or Coverage node, and omits B5's dependencies on A2 and A5 | AA2, ECH14 | patch | Both rows reach the gate review; B5's two dependencies are dotted edges |
| R2-10 | The #880 row describes an older `engineSourceHash`, and key item 3 leaves out `fuzz-compare.ts` itself | BH7 | patch | The row describes today's file set (checked against `packageHash.ts`); item 3 names every script the nightly runs |
| R2-11 | The key misses the WASM build's inputs, the other scripts' import closures and `tsconfig.json`, so a change to the differential is not machine-checked | ECH6 | patch | Item 3 is the union of every nightly script's closure plus `tsconfig.json`; item 4 is the WASM build's inputs; a change to the differential is a change to the key, and the PR corpus filter uses the same paths |
| R2-12 | The reset rules leave red outcomes unclassified (panics, self-replay mismatches, missing checkpoints, recurring timeouts, a non-reproducing divergence, a key that comes back) | ECH2 | patch | Any engine-output failure resets, whichever run finds it; only a failure before any seed runs is infrastructure; a returning key starts at zero |
| R2-13 | The `frameLoop.ts` row puts B5 first while the steps put A5 first, and leaves out #965 | BH8, AA8, ECH8 | patch | First WS-A (A5's cue test, A6's #965), then WS-B (B5); `clock.rs` has its own row |
| R2-14 | The binding hold is ambiguous; WS-C holds no files; `lib.rs`, `Cargo.toml`, `helpContent.ts` and the analytics second lane are unassigned; the matrix copy differs | BH9, ECH8, AA8 | patch | Other lanes add exports after B1 and merge after any open A-step PR; WS-C rows for the Workbox block, the precache scripts and the identity UI; `lib.rs` and `Cargo.toml` are shared; `helpContent.ts` is A4 then C2; X1 follows WS-A in `src/analytics*`; the matrix copies 9.5 verbatim |
| R2-15 | `exportTiers.ts` is called regenerated, though it is hand-written | AA8 | patch | Outcome 13 corrected; the matrix says each lane adds its own entries |
| R2-16 | The matrix ties the TDT prerequisites to all of S9, and A7 is missing from 9.1 | BH10 | patch | A6 waits on A7 for #1066's `.TDT` half only; A7 is in 9.1 with its review skill and the owner's part (the real saves) |
| R2-17 | Thread order puts the rendering stack ahead of the catalog lane (WS-D) | BH11, AA4 | patch | WS-D is third, WS-R fourth; WS-R may use a thread while WS-D waits for S6 and parks at a PR boundary when S6 merges (7.1, 9.3, matrix RS1) |
| R2-18 | OD-9 (i) has no path if the owner says no | BH12 | patch | B3 then writes its own fix from the Windows failure, without #1068's code |
| R2-19 | RUN-0a's build claim leaves line endings and a failing Windows build unhandled | BH13 | patch | `core.autocrlf=false` until #880; if the build fails, the run applies only the patch's build half and says so |
| R2-20 | Run identity covers only the Rust side, and RUN-3 is placed on the candidate engine instead of a commit | BH14, ECH4 | patch | Every run records the SHA and `git status --porcelain`, and a dirty tree voids it; RUN-3 runs on the candidate commit, and a later host-path change means a re-run or an owner waiver |
| R2-21 | δ is underspecified (one value or per metric, which engine, one A/A sample) | BH15, ECH9 | patch | Three A/A passes per engine; one δ per ratio family at the largest upper bound; RUN-3 repeats one pass |
| R2-22 | M7 is a CI measure inside a desktop-only protocol | BH16 | patch | M7 is a CI gate outside the protocol, read on the candidate commit's CI run |
| R2-23 | Long tasks have a zero TypeScript reference, so their ratio never reaches a verdict | ECH5 | patch | M4 and M8's long tasks are a paired difference in ms against the owner's allowance; 5.2 excludes zero-reference metrics from the ratio rule; M5 and M6 name their statistic |
| R2-24 | `divergence_reports` starts at S9, so S4's reports are never counted | BH17 | patch | It counts from A3 onward |
| R2-25 | OD-3 and OD-7 both appear to own the key and counting rules | BH18 | patch | They are proposed under OD-7; OD-3 is the freeze or the candidate ref |
| R2-26 | #880 stays P2 although the protocol's runs need it | BH19 | patch | P1 in section 8, the row and the matrix |
| R2-27 | Rule 9.7.2 still counts four pieces of lost work | BH20, AA9 | patch | Three |
| R2-28 | Approval and merging this PR are not distinguished | BH22 | patch | Section 13: the owner approves by saying so or by merging; OD-1 to OD-9 stay open until answered |
| R2-29 | `fallback_reason` has no code for a tower the host refuses | ECH7 | patch | `attach-refused`, with its stage, counted as a fallback |
| R2-30 | The cohort draw would randomize e2e, the screenshot pipeline and `npm run perf` | ECH10 | patch | Tooling and CI builds turn the draw off |
| R2-31 | The size gate drops large towers from the WASM arm only | ECH11 | patch | The would-be gate is computed in both arms, and sessions above it leave both |
| R2-32 | WS-A's critical path waits on #1062 with no risk row | AA5 | patch | R19's signal and mitigation name #1062 |
| R2-33 | D6 gaps (#983, #1005, #841, #965), a rule that would raise S12 and S14, #919 left out of the rowless list, and #907 (closed) listed as open | AA7, ECH12 | patch | Each stays with a stated reason; the rule carves out the exception-register items; #919 is listed; the #945 row says #907 closed on 2026-10-14 |
| R2-34 | The 132 s figure is labeled a median page life | AA6, ECH13 | patch | A median session, in the memlog (appended) and finding 32 |
| R2-35 | Contrast constructions remain in the transcript and plan | BH prose, AA10 | patch | Dana, Theo, Vex and Tess rephrased; plan 7.2 rephrased |
| R2-36 | Leftovers: R7's run name, two 5.1 figures without a folder, the #1049 to #1051 citations, no memlog line for "cannot pass as written", #900's Copilot assignment, #893's framing, and matrix nits (PF1, PF3, the "Windows" heading, WS-C's start, B4's note, the transcript's corrections list, who posts notes no lane takes) | BH nits, AA11 | patch | Each fixed; #893 now reads "for a second frontend", as the issue says |
| R2-37 | Rule 9.7.9's "a production engine change" could forbid ordinary engine merges | AA12 | patch | It now names the candidate deploy |
| R2-38 | 5.2 says `perf:worker` prints only TypeScript ÷ WASM | ECH14 | patch | Its report leads with that, and its `ratios.csv` has both |
| R2-39 | "robustness" in #887's name reads as marketing vocabulary | BH prose | patch | "forged-input handling" in the plan's prose; the issue's title is unchanged |

**No change needed:**

- The memlog's `updated` stamp looked older than its newest entries. The
  memlog script rewrites it on every append, and it is current.
- The #1065 row's "Never a full state view per command" is a prohibition
  with its reason, and the #865 row's "refuses the same commands, not that it
  refuses for the same reason" is older row text this PR carries unchanged;
  neither is new emphatic prose.

## Confirming pass (round 3)

Recorded below once it runs on the round 2 diff.
