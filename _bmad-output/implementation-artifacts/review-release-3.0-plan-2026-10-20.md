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
| 10 | The rendering stack gets the third thread ahead of the performance and offline lanes | BH6, AA Medium | patch | Thread order in 9.3 is WS-P, WS-C, WS-R, WS-D; 7.1 records the reasoning (superseded by R2-17: WS-D now comes before WS-R) |
| 11 | #965, #841, the gallery and baseline re-mint at the flip, and the version-bump owner under auto-merge have no owner | BH39 | patch | #965 sits in A6, the #841 check in A1, the re-mint in X3, and each PR's author bumps the version (9.7) (superseded by R3-3: #965 lands in A5 or A6) |

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
| 17 | The key leaves out `Cargo.toml`, the toolchain pin, the event catalog, the TypeScript side of the compare, `package-lock.json` and `.nvmrc` | BH9, ECH2 | patch | The key is `engineSourceHash` of `engine-rs/`, `src/engine` without tests, the compare script's import closure outside `src/engine`, `package-lock.json`, `.nvmrc` and `engine-fuzz.yml` (superseded by R2-1, R2-11 and R3-9; plan 4.2 holds the current key) |
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
| 27 | The session unit, re-adoption within a page life, the best-effort relay and device clustering are undefined | ECH6 | patch | The unit is the page life with the `session_lengths` walk, a fallback counts once per page life, both counts are reported, and the rate is stated as a lower bound with triage by repeat; risk R21 (superseded by R2-4: the unit is now the governed session) |
| 28 | Package-mismatch fallbacks are known by design and count against the gate, while #1046 waits for them to accumulate | BH33 | decision | OD-2 asks whether `package-mismatch` counts against the engine; the recommendation reports it on its own line |
| 29 | Missing owner parameters (the M4 allowance, the size-gate threshold), days only at 1,000 sessions, a mislabeled header, and no second-load rule | BH38 | patch | OD-1 and OD-4 carry the parameters; the 4.1 table gives days at 1,000, 3,000 and 4,750 sessions at full and 50% arms, from the governed 749 sessions per 30 days; the size gate is checked when a tower loads, and A4's spec defines a second load in the same page life (superseded by R2-4: the unit is now the session) |
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
| 37 | Zero-margin acceptance in the restored rows (#1049, #1050, #1051), and a recommended δ of 5% right after the warning against reusing it | BH10, AA Medium | patch | The rows are read under the protocol's margin; δ is calibrated by an A/A pass in RUN-0b (superseded by R2-21: three A/A passes per engine) |
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
| 56 | The D6 rule is applied to issues it does not cover (#932, #1048, #1051) | BH17 | patch | The rule gains the owner's 2026-10-16 order; #1048 stays P2 as worker tooling; #1051 rests on the Performance row (superseded by R3-1 and R4-4: #1048 is P1 because #1051 follows it) |
| 57 | Freeze prerequisites stay P3 (#859, #1067, #1059) and #926 rises wholesale | BH18, AA Medium-low | patch | #1059 rises to P1; #926 rises for items 1 to 4 only; #859 stays P3 as one candidate inside #1051 and #1067 lands before the freeze or goes to the register, both stated in section 8 |
| 58 | #873's priority disagrees between the matrix and the #945 row | BH19 | patch | #873 is P2 on GitHub and in its row; the #945 row now says "#873 at P2" |
| 59 | The #932 row reads "Gated" while P1, and asks for a low-end device the protocol lacks | BH20, AA Medium-low | patch | Ready, with a 4x CPU throttle standing in for the device, and landing before the freeze |
| 60 | "12 issues on the 3.0 path" overclaims, and #1053's status is unstated | BH21 | patch | "Six are on the 3.0 path" and six are worker-host or gated work; #1053 already has a row (superseded by R3-1: seven on the path, five off it) |
| 61 | Restored rows cite issues whose titles still carry banned prefixes | AA Low | patch | Section 8 lists the prefixes to drop when this PR merges, the moment the rows reach `main` |

### Process, numbering and provenance

| # | Finding | Sources | Class | Outcome |
| --- | --- | --- | --- | --- |
| 62 | Run IDs collide with risk IDs; no risk covers an S4 slip; R17's trigger fires by design | BH22 | patch | Runs renamed RUN-0a to RUN-3; R19 covers the S4 slip; R17 fires beyond the entries the plan already names |
| 63 | #1048's reproduction and the old-harness run share "R0"; the #1048 → #1051 link is not wired | BH25 | patch | RUN-0a and RUN-0b are separate; #1051 no longer measures through #1048 (superseded by R3-1: #1051 starts after #1048, by the owner's order) |
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
| R2-3 | The reliability tail has no definition, and section 3 says both windows count only on the candidate engine | BH2, AA3 | patch, OD-2 widened | Sessions from every build since S4 count toward *N*; the tail is every session on the candidate build over the 14 nights, triaged, with no latch-off (about 175 at a 50% arm, a projection); the candidate deploy is an owner step in the graph and in OD-1; OD-2 asks for the tail's rule (refined by R3-2 and R3-4: pre-S9 sessions stay the owner's call under OD-2, and the candidate deploy needs the host-path inputs merged) |
| R2-4 | The reliability unit: 749 counts session ids, the view's walk cannot count page lives exactly, and `boot` fires before the host starts | BH21, AA3, ECH3 | patch | The unit is the governed session (a distinct session id); *N* counts sessions; A1 mints a page-life id and sends its fields after the host settles and on each runtime fallback |
| R2-5 | This record cited a confirming pass before one had run | BH3 | patch | Finding 8's outcome reworded; this section records the pass |
| R2-6 | Phase C's exit points at a list the matrix does not have | BH4 | patch | The matrix's work items carry a "Changes the key" column, and Phase C ends when none of them is open |
| R2-7 | The graph and the matrix order B2 and B4 in opposite directions | BH5, AA2 | patch | `DIFF --> P865` |
| R2-8 | The graph runs the gate review before the rollback rehearsal | BH6 | patch | The rehearsal runs on the candidate commit and feeds the gate review, which feeds the flip |
| R2-9 | The graph has no End to end or Coverage node, and omits B5's dependencies on A2 and A5 | AA2, ECH14 | patch | Both rows reach the gate review; B5's two dependencies are dotted edges |
| R2-10 | The #880 row describes an older `engineSourceHash`, and key item 3 leaves out `fuzz-compare.ts` itself | BH7 | patch | The row describes today's file set (checked against `packageHash.ts`); item 3 names every script the nightly runs |
| R2-11 | The key misses the WASM build's inputs, the other scripts' import closures and `tsconfig.json`, so a change to the differential is not machine-checked | ECH6 | patch | Item 3 is the union of every nightly script's closure plus `tsconfig.json`; item 4 is the WASM build's inputs; a change to the differential is a change to the key, and the PR corpus filter uses the same paths |
| R2-12 | The reset rules leave red outcomes unclassified (panics, self-replay mismatches, missing checkpoints, recurring timeouts, a non-reproducing divergence, a key that comes back) | ECH2 | patch | Any engine-output failure resets, whichever run finds it; only a failure before any seed runs is infrastructure; a returning key starts at zero (refined by R3-17: infrastructure is classified by cause) |
| R2-13 | The `frameLoop.ts` row puts B5 first while the steps put A5 first, and leaves out #965 | BH8, AA8, ECH8 | patch | First WS-A (A5's cue test, A6's #965), then WS-B (B5); `clock.rs` has its own row (refined by R3-3: A6's #965 rebases over B5) |
| R2-14 | The binding hold is ambiguous; WS-C holds no files; `lib.rs`, `Cargo.toml`, `helpContent.ts` and the analytics second lane are unassigned; the matrix copy differs | BH9, ECH8, AA8 | patch | Other lanes add exports after B1 and merge after any open A-step PR; WS-C rows for the Workbox block, the precache scripts and the identity UI; `lib.rs` and `Cargo.toml` are shared; `helpContent.ts` is A4 then C2; X1 follows WS-A in `src/analytics*`; the matrix copies 9.5 verbatim |
| R2-15 | `exportTiers.ts` is called regenerated, though it is hand-written | AA8 | patch | Outcome 13 corrected; the matrix says each lane adds its own entries |
| R2-16 | The matrix ties the TDT prerequisites to all of S9, and A7 is missing from 9.1 | BH10 | patch | A6 waits on A7 for #1066's `.TDT` half only; A7 is in 9.1 with its review skill and the owner's part (the real saves) |
| R2-17 | Thread order puts the rendering stack ahead of the catalog lane (WS-D) | BH11, AA4 | patch | WS-D is third, WS-R fourth; WS-R may use a thread while WS-D waits for S6 and parks at a PR boundary when S6 merges (7.1, 9.3, matrix RS1) |
| R2-18 | OD-9 (i) has no path if the owner says no | BH12 | patch | B3 then writes its own fix from the Windows failure, without #1068's code |
| R2-19 | RUN-0a's build claim leaves line endings and a failing Windows build unhandled | BH13 | patch | `core.autocrlf=false` until #880; if the build fails, the run applies only the patch's build half and says so (superseded by R3-18 and R4-6: a hand fix, declared) |
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

The same three layers ran again as independent agents on the round 2 diff.
The Acceptance Auditor checked every round 2 outcome against the text and the
cited facts against GitHub. It confirmed the governed analytics figures, the
tail arithmetic (749 / 30 x 14 x 0.5, about 175), the backlog rows' format,
and that every fuzzer outcome maps to a reset. The Edge Case Hunter confirmed
the key's files exist and that "root `version` fields" covers both lockfile
fields a bump changes.

Raw findings: Blind Hunter 10 (9 plus a prose list), Edge Case Hunter 6,
Acceptance Auditor 7. After merging duplicates, 19 remain; all are patched.
The most consequential is R3-1: the plan had run #902 ahead of #874, against
the owner's later order.

| # | Finding | Sources | Class | Outcome |
| --- | --- | --- | --- | --- |
| R3-1 | The plan reverses two points of the owner's 2026-10-16 order on #945 without saying so: it runs #902 before #874 (the order queues #902 after #874, since both edit the same host and save paths) and puts #1048 after the flip (the order has it in progress, with #1051 after it) | AA1 | patch | WS-A runs #874, then #902, in section 1, the graph, the phases, 9.1, 9.4, R19 and the matrix; A3 notes that the cutover plan's S4 row lists S5 and that the owner's later order wins. #1048 is P1 in section 8, the backlog and the matrix, and WS-P runs it before #1051 (graph edge `P1048 --> P1051`) (refined by R4-4 and R4-5: the reason and the remaining places) |
| R3-2 | Whether pre-S9 sessions count is open under OD-2, but five places state it as decided | BH1 | patch | Section 3 and 4.1 call it OD-2's recommendation; OD-2 recommends counting them, by build; the transcript's corrections, R2-3's outcome and the memlog (appended) say the same |
| R3-3 | The audio cue fix forms a cycle (A5's cue test can only be fixed by #965 in A6), and the `frameLoop.ts` row puts B5 behind A6 | BH2 | patch | #965 lands in whichever step's cue test fails first (A5 or A6), in 9.1 and section 6 row 6; the `frameLoop.ts` row puts A5 first, then B5, and A6's #965 rebases over B5 |
| R3-4 | The reliability tail can run on a host that does not ship, nothing restarts it, and section 3 still puts RUN-3 on the candidate engine | BH3, AA3 | patch | The candidate deploy is defined in section 3 and cut from a commit with A1's runtime reasons, A3 and C1 merged; a later host-path change means a new deploy and a restarted tail, or an owner waiver; a new key means a new deploy and tail; section 3 puts RUN-3 on the candidate commit; the matrix has a tail row (refined by R4-2: the tail's own paths and restart rule) |
| R3-5 | The session unit spans builds, so "by build" and the tail are undefined, and an undo restore fits two codes | ECH3 | patch | A1 sends `version` with each page life's fields; a fallback is charged to its page life's build and a session counts once under each build it ran, pinned in the definition's test; 175 is an upper bound that assumes full adoption, with the real share from `boot.version`; `attach-refused` covers an undo restore and `trap-undo` a trap inside the undo command |
| R3-6 | "Approval by merging" would let an auto-merge armed by a thread count as the owner's approval | BH4 | patch | Section 13: only the owner merges this PR, and no thread arms auto-merge on it |
| R3-7 | The #1068 build-fix extraction reads as decided in section 2 and 9.4, though OD-9 (i) is open | BH5 | patch | Both make it conditional on OD-9 (i), with B3's own fix otherwise |
| R3-8 | 9.5 files #932 under #859's tower files, leaves WS-P out of the binding-exports clause, and gives `scripts/wasm-build.ts` no holder although C1 and #932 both edit it | BH6, ECH5 | patch | The tower row is #859's only; a new row gives `scripts/wasm-build.ts`, `engineAssets.ts` and `enginePackageNames.ts` to WS-C (C1), then WS-P (#932); WS-P's #932 joins the binding-exports clause; the matrix copies the table verbatim |
| R3-9 | Key items 3 and 4 disagree about the WASM build's inputs, an import graph misses files read at run time, and the matrix marks B3 and C1 as leaving the key alone | BH7, ECH4 | patch | Item 4 is the engine-wasm action's cache inputs (`wasm-build.ts` and the files it imports, `build-engine-wasm.sh`, the action, the `wasm:build` script line); item 6 adds the fixtures a scenario reads; the matrix marks B3 (#880, `packageHash.ts`) and C1 (`wasm-build.ts`, `engineAssets.ts`) as changing the key |
| R3-10 | One of R19's signals can never fire ("#1062 still open at the end of Phase A", which ends only when #1062 merges) | BH8 | patch | Both signals are read when A1 deploys |
| R3-11 | Round 1 outcomes 10, 17, 27, 29 and 37 no longer match the text and carry no note | BH9, AA6 | patch | Each carries a supersession note, as do R2-3, R2-12 and R2-13; a memlog line points to plan 4.2 for the key |
| R3-12 | Prose: "cancelled" in 4.2, and an "X, not Y" construction in a memlog line this PR added | BH10 | patch | "canceled"; the memlog line, which this PR adds, is rephrased |
| R3-13 | Copilot facts are wrong: #831, #1039 and #1047 have Copilot reviews, #817's last was on 2026-10-15 at `a45c1c4` (six later attempts errored), and #1047's ten open threads are 9 from Codex and 1 from Copilot | AA2 | patch | Section 2, the 7.1 D1 table, Grumbal's line and the transcript's corrections list are corrected; 9.4, the D3 list, B0 and the matrix name 9 Codex threads and Copilot's open thread |
| R3-14 | The restored #1048 row says no code exists, but #1056 landed part of it | AA4 | patch | The row says what #1056 landed and what is still owed |
| R3-15 | OD-4 still offers "calibrated by an A/A pass" | AA5 | patch | "calibrated by repeated A/A passes" |
| R3-16 | The matrix's gallery rule differs from plan 9.5 | AA7 | patch | The gallery and baselines are refreshed only through the drift check's approval job on the PR that changes pixels |
| R3-17 | The reset rules classify infrastructure failures by when they happen, so a failure after the seeds start lands nowhere | ECH1 | patch | Classified by cause: any failure outside engine output, wherever it happens (setup, a lost or canceled runner, the upload step, a timeout or kill that does not recur on replay), neither counts nor resets, and the ledger records the clearing replay; a night counts when its fuzz and compare steps are green; a kill that recurs resets (refined by R4-1: the seed steps are named, and the upload step left the infrastructure list) |
| R3-18 | RUN-0a's fallback patch does not apply to `e25ec01` (its `main.ts` hunks expect a later `sh()` helper) | ECH2 | patch | The build fix is ported by hand (add `build.ts`, replace the two `sh(...)` calls in `main.ts`); the run's notes commit that diff and its SHA-256 as the declared patch |
| R3-19 | 5.2 says the clean-tree check covers three folders, though it covers the whole tree, and records only a boolean | ECH6 | patch | `environment.dirty` covers the whole tree except `docs/performance/results/`; the notes paste the `git status --porcelain` output and the declared patch's SHA-256, and B3 makes the harness record both |

## Confirming pass (round 4)

The same three layers ran again as independent agents on the round 3 commit.
The Acceptance Auditor checked each round 3 outcome against the text, the
owner's 2026-10-16 order on #945, and GitHub (the Copilot reviews on #817,
#831, #1039 and #1047, PR #1056 and issue #1048), and confirmed most of them;
the six error reviews on #817 are visible in the reviews API. The Edge Case
Hunter confirmed key items 1, 3, 4 and 5 against the code, every fuzzer exit
against the reset classes, and the matrix's "Changes the key" column.

Raw findings: Blind Hunter 10, Edge Case Hunter 8, Acceptance Auditor 6.
After merging duplicates, 16 remain; all are patched. They are narrower than
round 3's: most carry a round 3 change into a place it missed, or settle a
detail a step's spec would otherwise have to settle.

| # | Finding | Sources | Class | Outcome |
| --- | --- | --- | --- | --- |
| R4-1 | The upload step is counted in one bullet and excluded in the next; "the fuzz and compare steps" is not defined once B2 adds steps; a job-budget kill that recurs on replay would read as an engine reset | BH1, ECH3, ECH8 | patch | A night counts when its seed steps are green (today the one Fuzz step; after B2, the steps B2's spec names), whatever later steps do; "neither" covers failures that stop the seed steps, a job-budget kill among them; a per-seed timeout or kill resets only when that seed, replayed alone, repeats it |
| R4-2 | The tail cannot be read by build while `main` keeps deploying, `version` alone cannot tell builds apart, its paths are undefined, every fix restarts it with no risk row, and the candidate deploy assumes OD-1 (a) | BH2, ECH1, BH10 | patch | 4.1 lists the tail's paths, covers every deploy from the candidate deploy on that keeps them and the key, and states what restarts it (a tail fix included) and the waiver; merges to the tail's paths wait; A1 sends `__APP_SHA__`; R22; section 3 defines the candidate deploy for any OD-1 choice; the matrix row carries the waiver |
| R4-3 | Which page lives count is unstated when only some builds or arms count | ECH5 | patch | *N* and the tail read only page lives on counted builds and arms; a session enters if any counted page life ran and falls back only if a counted one fell back; the definition's test pins it |
| R4-4 | #1048's reason misquotes the owner (the order does not list it before the flip; it puts #1051 after it), its desktop reproduction is an unscheduled run on the freeze path, its worker split names a delta that exists only in held #1068, and it edits worker files 9.5 gives only to WS-B | AA1, BH3, ECH2 | patch | The reason is "#1051 follows it and is P1" in section 8, the backlog, the transcript and the memlog; the desktop check is read from the next protocol run on `main`, and #1051 starts once #1048's code merges; the split on `main` is step, frame-view build and serialize; the worker-files row gives WS-P (#1048) the second turn, with #1068 rebased over it under the hold |
| R4-5 | The new order is not carried through: S4's booking-case test has no home, matrix A5 still follows A3, and 9.5's first row still names A2 first | BH5 | patch | Matrix A2 and the #902 row carry the test, and #874 stays open until A2 merges; matrix A5 follows A2; the 9.5 row lists A3, then A2 |
| R4-6 | RUN-0a's hand fix takes #1068 code before OD-9 (i) is answered; the patch fails on `main` too; `perf:compare` has the same build calls; a plain `git diff` leaves out the new file; "the whole tree" overstates the clean-tree check | BH6, ECH4 | patch | RUN-0a ports from the patch only if OD-9 (i) is approved and otherwise writes its fix from the failure, declared with `git add -N`; B3 ports by hand on `main` and covers `perf:compare` (or `--skip-build`); the check covers tracked and non-ignored untracked files |
| R4-7 | Round 1 outcomes 11, 56, 60 and 63 and R2-19 no longer match the text | BH7, AA2 | patch | Each carries a supersession note, as do R3-1, R3-4 and R3-17 |
| R4-8 | The matrix misses R3-3's #965 wording, PF4 does not depend on C1 for #932, and the graph has no #932 node | BH8, AA5 | patch | Matrix A5 and A6 carry the wording; PF4 depends on C1 for #932; the graph has `P985 -.-> P932 --> FREEZE` |
| R4-9 | R19's #874 signal always fires, and "WS-A's first code step after A1" is untrue while #902's draft opens first | BH9 | patch | The signal waits a week after both A1 deploys and #1062 merges; nothing in WS-A merges ahead of #874 except A1 |
| R4-10 | Section 6 row 8 still says outside review was unavailable | BH10 | patch | "Copilot was intermittent (429s until 2026-10-19)" |
| R4-11 | A memlog line this PR adds reads as a list | BH10 | patch | A colon after "#945" |
| R4-12 | The gallery and baselines rule gives the baselines the drift check's job, which commits only `docs/screenshots` | AA3 | patch | The gallery: the drift check's `commit-on-approval` job or the pinned image; the baselines: `update-visual-baselines.yml` or the pinned image; never a host browser; in 9.5 and the matrix |
| R4-13 | #1047 adds a #1046 backlog row that this PR also restores, so the two could land as duplicates | AA4 | patch | B0 drops #1047's copy, which also answers Copilot's thread; in 9.2, 9.4 and the matrix |
| R4-14 | The owner's order asks for #1064, #1065 and #1066 in focused PRs after #954, and A6 bundles them | AA6 | patch | A6: #954 first, then each in a focused PR with parity tests |
| R4-15 | Key item 4's file list is hand-maintained with no test, and item 6 depends on what each night reads | BH4, ECH6 | patch | Item 4 is computed from the import graph, with a B2 guard test that the action's list agrees; item 6 hashes the whole `conformance/fixtures/` directory, and B2's spec keeps nightly scenarios from naming fixtures elsewhere |
| R4-16 | The fallback codes leave redo, the undo capture's serialize, and autosave or export serialize traps unclassified | ECH7 | patch | `trap-undo` covers undo and redo; the capture reports `trap-command` with its own stage; autosave and export serialize traps report `other` with their stage |

## Coordinator corrections (2026-10-20, after round 4)

The coordinator reviewed head `a79d751` and asked for nine corrections. Each
was checked against the repository or the project instructions and applied.

| # | Correction | Outcome |
| --- | --- | --- |
| C-1 | A verdict needs at least 10 valid paired repetitions, with failed ones re-run (the project instructions), where 5.2 said six pairs | 5.2 steps 4 and 6 say at least 10 valid pairs and re-run failures; no other place gave fewer |
| C-2 | The "234 commits behind" figure for #1062 | Re-verified with git against `main` at `8f3a143`: #1062 is four merges behind on `main`'s first-parent line (#1060, #1055, #823, #816), and `git rev-list` counts 234 commits because #823 carried 211 commits from its own branch; #1068 is two merges behind (#823, #816), 221 commits by the same count. The coordinator's 29 commits did not reproduce; section 2 and the matrix give both measures |
| C-3 | 9.4 applied `wasm-integration.patch` on `main`, against 9.7 rule 3 | #874 branches from the patch's base, applies only the #1059 code and tests, then merges `main` once #1062 has merged |
| C-4 | A1 and #1062 both edit `startWasmHost.test.ts` and `fakeEngine.fixture.ts` | 9.5: B1 merges first, and A1 and A3 rebase over it |
| C-5 | `WasmHostStatus` lives in `startWasmHost.ts`, and no analytics data map exists | 4.1 and 9.1 name both files; A1 creates the data map |
| C-6 | B0 drops #1047's copy of the #1046 row, so it must not merge before this PR | 9.2, 9.4 and the matrix say so |
| C-7 | Plan approval must not cover A1's fields in production | Section 13, 9.1, 9.7 rule 9, R3 and the matrix: A1's PR asks the owner for a separate OK |
| C-8 | Model and effort per lane | New 9.8, keyed to the project instructions' kinds of work; the model names stay in the project instructions, since repository artifacts carry no model identifiers |
| C-9 | RUN-0a is PC measurement | 5.2, 9.3 and the matrix: a local session the coordinator schedules, and no implementation thread runs it |
