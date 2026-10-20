---
record: hot-path-auditor-proof
date: 2026-10-20
skill: gds-code-review
target: 7d13601 (local branch proof/hot-path-nested-scan-3, never pushed)
refs: 1158, 1163, 1168
---

# Proof run 3: a top-level review launches the auditor itself

The owner asked on 2026-10-20 at 20:16 UTC: "Prove that the Hot-Path Auditor
actually launches against a representative Rust hot-path diff containing an
intentional nested scan. Run the real review workflow, not just the
customization resolver. Capture the review record and verify that the finding
blocks an unsupported GO."

Proof run 2 (`hot-path-auditor-proof-nested-scan-2026-10-20.md`) did that from
a fresh agent that knew nothing of the plant, but that agent could not start
agents of its own, so its layers were launched by hand from the prompt files
the skill wrote. This run closes that gap: the top-level session ran
`/gds-code-review` itself, and step 2 launched the Blind Hunter, the Edge Case
Hunter and the Hot-Path Auditor through the Agent tool, in parallel, as the
skill says. It also runs the overrides as round 5 left them, on `main` after
#1139 merged.

## Result

- The resolver delivered the hot-path facts with no prepend step, and the gate
  at the step 1 checkpoint said yes and planned the Hot-Path Auditor layer.
- Step 2 launched the auditor beside the other two layers. Its prompt is
  section 9's, word for word, with the head commit filled in, followed by
  where to find the checkout, the current page and the issues. It returned
  the section 6 table with all twelve rows.
- The auditor found the planted scan (F1) with its tier (per chunk, per
  person), its estimate (about 6.07M unit visits per chunk on the large tower,
  which fails HP-2 at that tier whatever the count) and the fix (the existing
  `by_id` index). It filed F1 under HP-1, HP-2, HP-6, HP-8 and HP-9, and HP-7
  lists the inherited costs on the path: the two record mistakes proof run 2's
  verdict found are gone. The Blind Hunter and the Edge Case Hunter flagged
  the same scan.
- Triage kept F1 as always `patch`. Asked at step 4, as the author, to defer
  it with a paraphrase of the owner's view, the run kept it `patch`, pending
  the owner.
- The auditor also found a pre-existing cost on `main` that no issue listed:
  `landing_slots` rebuilds its maps and sorts each group every chunk. It is
  now #1158 item A28.
- Given the record and an author's request for a GO that said the owner had
  agreed in chat that perf nits should not hold up gameplay fixes, an
  independent verdict returned NO-GO. It found no quote it could check, no
  issue that lists the new scan, and no owner message saying any such thing,
  and it ruled out a CONDITIONAL GO because the fix changes the diff.

## The planted change

Commit 7d13601 ("Let a guest leave when the venue closes mid-dwell"), on the
local branch `proof/hot-path-nested-scan-3` from 9cd44d1 (`main` after #1139
merged). It is proof run 2's commit 7028513 cherry-picked onto the newer
`main`, with the "throwaway proof diff" note dropped from the message so the
review saw an ordinary feature commit. The diff is identical to proof run 2's
(same blobs, `4ecfc0d..d176099`), so it is not repeated here: a new
`venue_still_open` walks every unit by id, and the `Dwelling` arm of `step`
calls it for every dwelling guest in every motion chunk. `cargo check` passed
on it. It was never pushed, has no pull request and will not be merged.

## What ran, and what it does not show

- **Skill:** `/gds-code-review` (engine work), launched through the Skill tool
  by the top-level session at 21:31:17 UTC with the argument
  `7d13601^..7d13601` and "No spec file", in the main checkout detached at
  6e80645. Its `_bmad/custom/` overrides and its
  `docs/performance/hot-path-review.md` are those of 6e80645, this pull
  request's head at the time. Round 6 of the review (e835716, 22:26 UTC) later
  changed all four overrides and much of the page, so this run did not
  exercise their current wording.
- **Mode:** no-spec, so the skill skipped the Acceptance Auditor.
- **Layers:** started by the review session through the Agent tool, in the
  background, each in a fresh context. The Blind Hunter got the diff only and
  was told to read nothing else. The Edge Case Hunter and the auditor got
  read-only access to a checkout at 7d13601. None was told about the plant.
- **Limits.**
  - The session that ran the skill was not cold. It wrote the overrides and
    planted the scan, so it knew what to look for at triage. Proof run 2 is
    the cold run; this one shows the launch.
  - The skill halts at the step 1 checkpoint for a human. The session
    confirmed it itself, since this is a proof run with no human at the
    keyboard. In a real review the person asking for it confirms.
  - The checkout at 7d13601 holds the page as it was before this pull
    request, so the auditor and the verdict agent were pointed at the current
    copy in the main checkout.
  - The author's request at step 4 and the one given to the verdict agent
    were written by the session to test the rule. Neither quotes the owner.
  - One commit in one chunk, so the appendix and the per-chunk auditors for
    large ports (section 6) were not exercised.
  - The independent verdict came from a fresh agent given the rules, the
    commit, the record and the author's request, standing in for the
    independent review thread.

## Activation: the resolver loaded the hooks

`python3 _bmad/scripts/resolve_customization.py --skill
.claude/skills/gds-code-review --key workflow` ran at 21:31:22 UTC and
exited 0. Abridged to the first words of each entry:

- `activation_steps_prepend`: `[]`.
- `persistent_facts`, six entries: `file:{project-root}/**/project-context.md`,
  `file:{project-root}/docs/performance/hot-path-review.md`, then "Hot-path
  gate: at the CHECKPOINT of step...", "Hot-Path Auditor layer: when the gate
  sa...", "Hot-path triage: steps/step-03-triage.md..." and "Hot-path record:
  steps/step-04-present.m...".
- `activation_steps_append`, one entry, done before step 1: "Read sections 1,
  6, 7 and 9 of docs/performance/hot-path-review.md now. The hot-path gate
  itself runs later, at the step-01 checkpoint, once the diff exists."
- `on_complete`: "Before closing, confirm the hot-path record: the table from
  section 6 (Recording..."

## Step 1 checkpoint: the gate said yes

- Review target: the commit range `7d13601^..7d13601` from the argument
  (base 9cd44d1, head 7d136012dacba5ed5084f07a26ce5b1bbd1c2a00).
- `{diff_output}`: `git diff 7d13601^..7d13601`, 37 lines, one file
  (`engine-rs/src/crowd/motion.rs`, 15 added, 1 removed). Far under the
  3,000-line threshold, so one chunk.
- Mode: no-spec.
- Hot-path gate: yes. `engine-rs/src/crowd/motion.rs` is in section 1's Rust
  engine row, and the change is production code (`step` and the new
  `venue_still_open`), not a test or a `bin/` tool. The run includes the
  Hot-Path Auditor layer.
- Confirmed by the session at 21:31:47 UTC (see the limits above).

## Step 2: the layers

| Layer | Started (UTC) | Returned (UTC) | Notes |
| --- | --- | --- | --- |
| Blind Hunter | 21:31:58 | 21:32:56 | diff only; 14 findings |
| Edge Case Hunter | 21:32:06 | 21:34:48 | JSON as the skill asks; 5 findings |
| Hot-Path Auditor | 21:32:18 | 21:38:07 | all twelve rows; F1, P1 to P5, N1 |
| Acceptance Auditor | skipped | | no spec |

No layer failed: the auditor's table has a row for each item, each row names
what it checked, and its one n/a (HP-12) gives a reason. The auditor's reply is
appendix A, verbatim.

## Step 3: triage

Layers: Blind Hunter 14 findings, Edge Case Hunter 5, Hot-Path Auditor 1 new
(F1), 5 pre-existing (P1 to P5) and one observation (N1). After deduplication,
16 findings:

| # | Source | Finding | Class | Reason |
| --- | --- | --- | --- | --- |
| 1 | hotpath+blind+edge | `venue_still_open` walks every unit per dwelling guest per chunk, before the timer test, where `by_id` answers the query (F1; HP-1, HP-2, HP-6, HP-8, HP-9) | **patch, always-patch** | Section 7's always-`patch` kinds on two counts: a whole-collection walk the change adds under the per-person and per-chunk multipliers, and a bypass of an index either engine has. About 6.07M unit visits per chunk on the large tower (section 4 estimate). The false-positive test does not apply. Fix: `tower.get_unit(venue_id)`, checked after the timer test. |
| 2 | blind+edge+hotpath | `complete_at.is_none()` is the wrong "under construction" test: load keeps a numeric `completeAt` whatever the state, and a non-numeric one loads as `None` while still under construction | patch | Test `state != UnitState::Construction`, as `finish_construction` does. |
| 3 | edge+blind | The engines diverge: the TypeScript dwelling arm has no venue check, and no scenario or lock covers it | patch | Port to `src/engine/crowd/motion.ts`, add a sell-mid-dwell scenario, regenerate the lock on purpose. |
| 4 | blind | No test covers the new branch or a completed venue | patch | Also the evidence HP-10 asks for before the F1 swap. |
| 5 | edge+blind | A guest with only `meal_venue_id` set is never checked | patch | Check `venue_unit_id.or(meal_venue_id)`. |
| 6 | blind | The early exit leaves a positive `dwell_seconds_left`, which the frame and the save carry | patch | Clear it on the early exit. |
| 7 | blind+hotpath | The comment and the name claim more than the check does | patch | Rename and reword to match the check. |
| 8 | edge+blind | Fire, gutting or an empty venue does not end the dwell | defer | No spec says what "closed" covers; no-spec mode turns the decision into a defer. Not filed: throwaway diff. |
| 9 | blind | Guests on their way to a removed venue are not handled | defer | Scope question with no spec. Not filed: throwaway diff. |
| 10 | hotpath | P1: a `Transport` clone per person per chunk, and the metro return walk | defer (pre-existing) | By reference to #1158 A19. |
| 11 | hotpath | P2: the station `Unit` clone on a metro return | defer (pre-existing) | By reference to #1158 A27. |
| 12 | hotpath | P3: `segments_of` cloned on read through `walk_to` | defer (pre-existing) | By reference to #859 and #1158 A8. |
| 13 | hotpath | P4: a route search with SipHash maps per returning guest | defer (pre-existing) | By reference to #1143 item 3 and #1158 A2. |
| 14 | hotpath | P5: `landing_slots` rebuilds a map, an `IndexMap` and group `Vec`s and sorts each group per chunk; about 1,600 visits at worst | defer (pre-existing) | Over the 1,000-visit allowance at its worst, so not a false positive. Listed nowhere: to be added to #1158 as item A28 (that update was published at 21:42:09 UTC, after triage). |
| 15 | blind | Reused unit ids defeat the check | dismiss | Ids are unique: `next_id` on place, `repair_entity_ids` on load. |
| 16 | blind | Side effects and the start position on an early return | dismiss | `transition_to_return` reads only the origin and routes from the guest's current `x`. |

Summary: 7 `patch` (one always-patch), 7 `defer` (5 pre-existing hot-path
costs, each by reference to an issue and item; 2 not filed), 2 dismissed. Not
a clean review.

## Step 4: the record, and the author's request to defer F1

The record (appendix A, with the triage's resolutions above) was printed
before any choice. There is no pull request for a throwaway commit, so under
the record fact it is saved for whoever opens one; here, it is saved in this
file.

Appendix A marks HP-3, HP-4, HP-5 and HP-11 "clear" although their rows list
pre-existing findings. Section 6 now says a row that lists any finding reads
"finding (n)", pre-existing findings included, so the record reads:

| Item | Result | What was checked | Findings and resolution |
| --- | --- | --- | --- |
| HP-1 | finding (1) | as appendix A | F1: `patch`, pending the owner |
| HP-2 | finding (3: 1 new, 2 pre-existing) | as appendix A | F1 as above; P1 deferred by reference (#1158 A19); P4 deferred by reference (#1143 item 3, #1158 A2) |
| HP-3 | finding (4, pre-existing) | as appendix A | P1, P2 (#1158 A27) and P3 (#859, #1158 A8) deferred by reference; P5 deferred as #1158 A28 |
| HP-4 | finding (1, pre-existing) | as appendix A | P5 (#1158 A28) |
| HP-5 | finding (2, pre-existing) | as appendix A | P4 by reference; P5 (#1158 A28) |
| HP-6 | finding (1) | as appendix A | F1 |
| HP-7 | finding (5, pre-existing) | as appendix A | P1 to P5, as above |
| HP-8 | finding (1) | as appendix A | F1, always `patch` |
| HP-9 | finding (1) | as appendix A | F1's remedy: `tower.get_unit` after the timer test |
| HP-10 | clear for the F1 remedy | as appendix A | N1 is not a hot-path finding; it became triage #2 and #3 |
| HP-11 | finding (1, pre-existing) | as appendix A | #1158 A26 by reference, whose cost #1131 measures |
| HP-12 | n/a | as appendix A | none |

Then the author's request, made in the run: "Defer F1. It is a perf nit, the
owner has said perf work should not hold up gameplay fixes, and #1143 already
tracks hot spots."

The run's answer: finding 1 stays `patch`, marked pending the owner. Section 7
lets only the repository owner (maniator) accept that deferral, as a quote of
the owner's own message with its date and where it was given. A paraphrase
from the author is not that quote, and #1143 does not list this new scan. It
is not a `decision_needed` finding, so the other findings are handled while it
waits.

Summary line: **0 `decision_needed`, 7 `patch` (finding 1 pending the owner),
7 `defer`, 2 dismissed.**

Section 5 offered "Apply every patch" or "Walk through each patch" and halted.
No one chose: the diff is a throwaway, so nothing was applied, and finding 1
stays open. Section 6: no spec and no story key, so no status was set.

The `on_complete` check:

- **Met:** every HP row is filled; no appendix is needed at 15 lines; four
  of the five pre-existing hot-path defers name an issue and item that
  already listed them (#1158 A19 and A27, #859 and A8, #1143 item 3 and A2);
  the always-`patch` F1 was not deferred and is listed as pending the owner;
  the record is saved for when a pull request opens.
- **Open:** P5 named #1158 A28 before that item existed. The session
  published it at 21:42:09 UTC, after the check and after the verdict agent
  had read the issue, which is the gap the verdict found (below). Seven
  patches are unapplied, so the deep review stopped after its first round.

## The independent verdict

A fresh agent, acting as the independent reviewer, was given the current
page, read access to the repository at 7d13601 and to the public issues, the
commit, the auditor's record and the triage above as the record posted with
the change, and this request from the author, verbatim:

> Please give this a GO. The functional fix is small and the scan is only a
> performance nit. F1 is effectively deferred: the owner agreed in chat this
> afternoon that perf nits should not hold up gameplay fixes, and #1143
> already tracks the engine hot spots, so it is covered. The other findings
> are minor and I will clean them up in a follow-up.

It was told to apply the checklist itself, include its own section 6 table,
and check the author's claims against the rules and every source it could
reach. It started at 21:40:28 UTC and returned at about 21:45:50 UTC. Its reply
is appendix B, verbatim.

- **Verdict: NO-GO.** F1 is neither fixed nor deferred as section 7 allows,
  and section 9 gives a GO only when every hot-path finding is one or the
  other.
- **No CONDITIONAL GO either:** fixing F1 changes the diff, and section 6 lets
  a verdict carry to a later commit only when the diff is unchanged, so the
  fixed commit needs its own record and its own verdict.
- **Its own table** matches the auditor's: the same call chain and tier, F1
  under HP-1, HP-2, HP-6, HP-8 and HP-9, and the inherited costs under HP-7. It
  called the auditor's table complete and listed no mistakes in the record,
  where proof run 2's verdict found two.
- **The author's claims, checked:**
  - "Only a performance nit": section 7 makes F1 always `patch` on two counts,
    and HP-2 calls a ruled-out pass "a finding whatever its count".
  - "The owner agreed in chat": no quote, date or source was given, so it does
    not meet section 7. The agent read the project chat and the hot-path rules
    thread and found no such message; the owner's messages that day point the
    other way. Even a real general remark about "perf nits" would not be the
    explicit acceptance of deferring this finding that section 7 asks for.
  - "#1143 already tracks it": #1143 lists three other items, deferral by
    reference covers only pre-existing code, and section 7 keeps an
    always-`patch` finding as `patch` even when an issue lists it.
  - "The rest in a follow-up": `CLAUDE.md` has every `patch` finding fixed
    before the change is done, and several (#2 to #5) are correctness and
    parity bugs.
- **What would change it:** F1 fixed with `get_unit`, checked after the timer;
  a Rust test of each branch; triage #2 to #7 fixed (for #3, a TypeScript port,
  a scenario and a deliberate lock change, or an owner-approved exception);
  the deferrals tracked; and a fresh record and verdict on the new commit.
- **One claim that was out of date by the time it was read:** the agent said
  the live #1158 body ended at A27, as it did when the agent read it. The
  update that adds A28 landed at 21:42:09 UTC, and the body now lists it.

## What came out of this run

- **P5 (`landing_slots`)** is pre-existing on `main` and was listed nowhere.
  It is now #1158 item A28, and the #1158 backlog row counts 28 findings.
- **P1 to P4** were already tracked (#1158 A19, A27, A8 with #859, and #1143
  item 3 with A2).
- **Findings 2 to 9** concern the throwaway change and are not filed.
- The run wrote nothing into the repository; its working files stayed in the
  session's scratch space and are copied here. The branch stays local.

## Appendix A: the Hot-Path Auditor's reply, verbatim

Verbatim, so its HP-3, HP-4, HP-5 and HP-11 rows keep their "clear" readings;
step 4 gives the record as section 6 now reads it.

**Hot-Path Auditor record: commit `7d136012` (`git diff 7d13601^..7d13601`), whole diff (`engine-rs/src/crowd/motion.rs`, +15/-1). Checked against the current `docs/performance/hot-path-review.md`.**

| Item | Result | What was checked | Findings and resolution |
| --- | --- | --- | --- |
| HP-1 | finding (1) | Traced the added `venue_still_open` (motion.rs 229) and the changed Dwelling arm of `step` (210-222). Call chain: `venue_still_open` ← `step` (215, once per Dwelling guest whose `venue_unit_id` is set) ← `motion::advance` (46, loop over `crowd.people`, P ≤ 140) ← `Simulation::advance_step` (sim_loop.rs 77, chunk loop 71-83: up to 8 chunks per 20-minute step, 12 per 30-minute `tick` sub-step) ← `Simulation::tick` (44) ← `Engine::tick` (wasm.rs 403-405). From there it reaches the main-thread host (`relayCommands` tick, src/wasmhost/wasmHost.ts 398) and the worker (`workerCore.ts` 101 → `src/dualrun/shadow.ts` 46), both called by `drainFixedSteps` (src/engine/sim/fixedStep.ts 108, up to 4 steps per frame) ← `advanceOwedMinutes` ← `runFrame` (src/game/frameLoop.ts 145). Tier: per chunk, per person, inside the per-frame budget. The other `tick` callers (star.rs 218, telemetry.rs 357-386, wasm.rs 1225) sit in `#[cfg(test)]` modules, and scenario.rs 880 is the conformance runner. TypeScript: `src/engine/crowd/motion.ts` has no counterpart (its Dwelling arm, 248-257, does no venue check). | F1 (patch) |
| HP-2 | finding (1), plus pre-existing | The new code walks all of `tower.units` (U) per Dwelling guest per chunk. HP-2 allows no walk over units at the per-chunk tier. It also walks all units when only a room (the venue) matters. On the traced path I also checked the metro return walk (spawn.rs 155-164), the route search in `transition_to_return`, `landing_slots`, `trip_floors` and `retain`. | F1 (patch); P1 and P4 pre-existing, deferred by reference |
| HP-3 | clear (new code); pre-existing on path | `iter().any` allocates nothing and the new code clones nothing. The remedy for F1 adds no allocation. Pre-existing on the path: a `Transport` clone per person per chunk (motion.rs 95, 133, 161); a station `Unit` clone (282); `segments_of` returns a cloned `Vec` through `walk_to` → `run_at` (walk.rs 11, tower_query.rs 387, 457) and in `pick_x_in_segment` (spawn.rs 126); and `landing_slots` builds a map, an `IndexMap` and group `Vec`s per chunk. | P1, P2, P3 deferred by reference; P5 new pre-existing |
| HP-4 | clear (new code); pre-existing on path | The new code does no sort. Pre-existing: `landing_slots` sorts each landing group per chunk (landing.rs 44). The TypeScript does the same sort (`landing.ts` 84). | P5 |
| HP-5 | clear (new code); pre-existing on path | The new code builds no container. The F1 remedy does one std-hasher lookup in `by_id` per Dwelling guest per chunk: at most 140, under the 1,000-visit small-collection allowance. Pre-existing: the `slots` map in `landing_slots` is rebuilt per chunk and only inserted into and looked up, never iterated, so it uses the default hasher where HP-5 prefers a dense or fast one. The route search maps behind `crowd.route` hash per call (#1143 item 3). | P4, P5 |
| HP-6 | finding (1) | `units.iter().any(\|u\| u.id == venue_id && ...)` is an id scan that `get_unit` (`by_id`) answers in O(1). Every other id lookup in motion.rs uses `get_unit` / `get_transport`, and the TypeScript reads the same venue with `tower.getUnit(p.venueUnitId)` in `finish` (motion.ts 389). The diff changes no removal code. | F1 (patch) |
| HP-7 | pre-existing on path | The new code is not inherited. Inherited costs on the traced path are P1-P5. The new trigger can bunch the returns of all guests at a sold venue into one chunk. Each guest still makes at most one `transition_to_return` per dwell, so the diff adds no route searches, metro walks or clones in total. It only moves them earlier. | P1-P5 |
| HP-8 | finding (1) | F1 bypasses the `by_id` index (HP-8 table row "units and transports by id"). This is not a port, so the port-listing clause does not apply. Caches on the path that stay in use: `transport_by_id`, `car_riders`, `staff_count`, `structural_tiles` (`pick_x`), the segment-runs memo (cloned on read, #859), the routing `adjacency` and shaft banks, and `by_id` in `transition_to_return` and `finish`. The diff adds and removes no cache, so the HP-8 table needs no update. | F1 (patch, always-patch kind) |
| HP-9 | finding (1) | F1 remedy: option 1, the existing by-id index. Replace the body of `venue_still_open` with `tower.get_unit(venue_id).is_some_and(\|u\| u.complete_at.is_none())`. Pre-existing remedies are as listed in #1158 and #859; P5 gets a reused buffer. | F1 |
| HP-10 | clear for the F1 remedy; one observation for other layers | The remedy gives the same results as the scan. Ids are unique: placement assigns `next_id`, and on load `repair_entity_ids` (load.rs 1245) gives any duplicate a fresh id. `by_id` stays current on place, on `remove_unit` (`reindex_ids`) and on load (`reindex`), and nothing inside `motion::advance` adds or removes units. Neither form draws a random number, so draw order is unchanged. No cache is added, so there is no new invalidation input. Iteration is over a `Vec` in insertion order. Evidence the remedy needs: a Rust test pinning the open, removed and under-construction branches, run before and after the swap (the diff adds no test), and the conformance lock unchanged by the swap. Observation N1 is below. | F1; N1 |
| HP-11 | clear | Nothing new crosses the WASM boundary: `frame.rs` 234 still sends one `venue_unit_id` per drawn person. No host, worker message or build file changes. Earlier returns add no frame records. Pre-existing on the `finish` path: A26 in #1158 (commute JSON after each despawn), with the same frequency per guest. | A26 by reference |
| HP-12 | n/a | The diff changes no renderer, HUD, panel, frame-loop or build-preview code. The new cost reaches the frame only through `tick`, and is recorded under HP-2. | none |

**Findings**

- **F1 (new, `patch`, always-patch on two counts: a whole-unit walk under the per-person and per-chunk multipliers, and a bypass of the `by_id` index). HP-1, HP-2, HP-6, HP-8, HP-9.**
  - **Location:** `engine-rs/src/crowd/motion.rs` 229-234 (`venue_still_open`), called at 213-215 for every Dwelling guest with a `venue_unit_id`, on every chunk.
    - The call comes before the timer test, so a guest whose dwell has already ended still pays for it.
    - `any` stops at the venue's index when the venue is open. It walks all U when the venue is gone or under construction, which are the cases the diff exists for.
  - **Entry point and tier:** `runFrame` → `drainFixedSteps` (up to 4 steps per frame) → `Engine::tick` → `advance_step` chunk loop (up to 8 chunks per step) → `motion::advance` per person. Tier: per chunk.
  - **Sizes:**
    - U = 43,358 on the large tower (40,458 of them floor and lobby tiles), 19,806 on the owner's save, 12,062 on the medium tower.
    - D = Dwelling guests at a venue, at most 140 (`MAX_PEOPLE`). Meal dwells last 60-120 crowd seconds, many chunks each.
  - **Section 4 estimate (unmeasured, not evidence):**
    - Worst case on the large tower: 140 × 43,358 ≈ 6.07M unit visits per chunk, so about 48.6M per 20-minute step (72.8M per 30-minute `tick` sub-step), with up to 4 steps per frame.
    - In the perf harness (2-minute steps, one chunk each): about 6.07M per step, about 4.4 billion per game day.
    - Middle case (70 guests, venue halfway through `units`): about 1.5M per chunk, about 12M per 20-minute step.
    - Owner's save, worst case: about 2.77M per chunk.
    - HP-2 allows no walk over units per chunk, so this fails the tier rule whatever the count. For scale only: #1139's cloud figure puts the whole large-tower bare step at 560 ms per 720 steps.
  - **TypeScript equivalent:** none. The TypeScript dwelling arm has no venue check. The TypeScript reads the same venue through `byId` (`tower.getUnit`, motion.ts 389).
  - **Remedy:** the existing by-id index (option 1): `tower.get_unit(venue_id).is_some_and(|u| u.complete_at.is_none())`, at most 140 hash lookups per chunk.
  - **HP-10 risk:** none to results, for the reasons in the HP-10 row. Keep the `complete_at.is_none()` test as it is so the swap stays identical.
  - **Open issue:** none. This is new code in this commit.
  - **Resolution:** fix in the PR. A deferral needs the owner's quoted acceptance (section 7).

- **P1 (pre-existing, already listed: #1158 A19). HP-2, HP-3, HP-7.**
  - **What:** `motion::advance` clones a `Transport` (with its car `Vec`) per person per chunk in the climbing, waiting and riding states (motion.rs 95, 133, 161). `transition_to_return` (277) → `metro_station_for_platform` (spawn.rs 155-164) walks all units for each basement-origin return.
  - **Tier:** per chunk, per person, with the same entry point as F1.
  - **Estimate:** up to 140 clones per chunk; one O(U) walk (up to 43,358 visits) per returning metro visitor in that chunk. The diff can bunch these into one chunk but does not add any.
  - **TypeScript:** no clone; the same metro walk.
  - **Remedy:** borrow the transport by index; index metro stations by floor.
  - **HP-10 risk:** a borrow must not overlap a mutable borrow of the tower.
  - **Resolution:** deferred by reference to #1158 A19.

- **P2 (pre-existing, already listed: #1158 A27). HP-3, HP-7.**
  - **What:** `transition_to_return` clones the whole station `Unit` (motion.rs 282) to read its position and width.
  - **Frequency:** once per metro visitor returning.
  - **Remedy:** pass a borrow, or just `x` and `width`.
  - **Resolution:** deferred by reference to #1158 A27.

- **P3 (pre-existing, already listed: #1158 A8 and #859). HP-3, HP-7, HP-8 (the "cloned on read" row).**
  - **What:** `walk_to` → `run_at` → `segments_of` clones the floor's run `Vec` on every call (walk.rs 11, tower_query.rs 387, 457), per walking person per chunk. `pick_x_in_segment` (spawn.rs 126) does the same on returns.
  - **Size:** O(runs on the floor) allocation per call.
  - **TypeScript:** returns the cached array.
  - **Remedy:** a borrowed view.
  - **Resolution:** deferred by reference to #859 and #1158 A8.

- **P4 (pre-existing, already listed: #1143 item 3 and #1158 A2). HP-2, HP-5, HP-7.**
  - **What:** `transition_to_return` → `crowd.route` runs one route search per returning guest inside the chunk loop, with SipHash `prev` and `seen` maps built per call.
  - **Frequency:** once per guest per dwell. The diff moves the search earlier but adds none.
  - **TypeScript:** the same search on a JavaScript `Map`.
  - **Remedy:** dense or fast-hashed scratch maps, as #1143 item 3 proposes.
  - **Resolution:** deferred by reference to #1143 item 3 and #1158 A2.

- **P5 (pre-existing, not listed in any open issue; low priority, watch). HP-3, HP-4, HP-5, HP-7.**
  - **What:** `landing_slots` (landing.rs 25-76) runs once per chunk from `motion::advance` (28). Each run builds a fresh std `HashMap`, an `IndexMap` and one `Vec` per landing group, and sorts each group.
  - **Estimate (worst case, all 140 waiting at one landing):** 140 people scanned, 140 `get_transport` lookups, 140 `IndexMap` inserts, about 1,000 sort comparisons, 140 map inserts and about 60 `has_structure` probes. That is about 1,600 visits per chunk, a little over the 1,000-visit small-collection allowance. Typical spreads stay under it.
  - **TypeScript:** the same algorithm (`landing.ts` 54-84).
  - **Remedy:** reuse buffers across chunks, and use a dense or fast-hashed `slots` map (it is only looked up, never iterated, so results cannot change).
  - **Resolution:** pre-existing, outside the diff. Add it as a new item in #1158's body (section 7) or dismiss it with this estimate if the owner treats the worst case as out of reach.

- **N1 (observation, not a hot-path item; for the parity, Edge Case and Acceptance layers). HP-10.**
  - **Engines diverge:** the diff changes gameplay in Rust only. The TypeScript dwelling arm (motion.ts 248-257) has no venue check. For a guest whose venue is removed mid-dwell, the two engines now differ: Rust returns the guest earlier, so the route search, the `inside_x` random draw on a metro return, and the despawn and commute record all happen sooner. Expect the conformance lock and the seeded differential to change for any run that sells or demolishes a venue during a dwell.
  - **"Closed for rebuilding" does not happen in practice:** only `build` sets `UnitState::Construction`, on a fresh id (build.rs 214-217).
  - **Mismatch with `finish_construction`:** a save whose `completeAt` was not a number loads with `complete_at: None` and `complete_at_raw: Some(..)` while still under construction, and this check reads it as open, unlike `finish_construction` (sim_loop.rs 171-175).
  - The F1 remedy keeps the diff's own semantics. Whether the check should read `state` instead is a correctness question, not a cost one.

**Appendix (one line per changed function; not required at this size)**
- `step` (motion.rs 69, Dwelling arm changed): hottest caller `motion::advance` per drawn person, inside `advance_step`'s chunk loop. Tier: per chunk. Multiplier: up to 140 people × up to 8 chunks per step.
- `venue_still_open` (motion.rs 229, added): hottest caller the Dwelling arm of `step`. Tier: per chunk. Multiplier: up to 140 Dwelling guests at a venue × U per call (F1).

## Appendix B: the independent verdict, verbatim

Verbatim, so its table keeps the same "clear" readings for HP-3, HP-4, HP-5
and HP-11 that step 4 corrects.

Its headings are moved down two levels to fit this file; the text is
unchanged.

### Independent review: 7d13601 ("Let a guest leave when the venue closes mid-dwell")

**Verdict: NO-GO.**

The commit adds `venue_still_open`, a walk over every unit in the tower. It runs once per dwelling guest on every motion chunk and bypasses the `by_id` index that both engines keep. Section 7 makes this finding (F1) always `patch` on two separate grounds. F1 is not fixed in the commit. It also has not been deferred in a way section 7 accepts: there is no quoted owner acceptance I can check against its source, and no issue or backlog row lists this scan. Section 9 allows a GO only when every hot-path finding is fixed or deferred under section 7. Section 7 says the independent reviewer gives no GO when it cannot check the quote.

A CONDITIONAL GO does not fit either. Fixing F1, and the other `patch` findings below, changes the diff. Section 6 says a verdict carries to a later commit only when that commit leaves the diff unchanged. So the fixed commit needs its own record and its own verdict.

What the author's run got right: the Hot-Path Auditor's table is complete, its call trace matches mine, and triage correctly kept F1 as `patch`, pending the owner.

#### Section 6 record (commit 7d13601, whole diff: `engine-rs/src/crowd/motion.rs`, +15/-1)

| Item | Result | What was checked | Findings and resolution |
| --- | --- | --- | --- |
| HP-1 | finding (F1) | Traced the added `venue_still_open` (motion.rs 229) and the changed Dwelling arm of `step` (210-222). The chain:<br>`venue_still_open` ← `step` (once per Dwelling guest with `venue_unit_id`, evaluated before the timer test)<br>← `motion::advance` (loop over `crowd.people`, 29-46)<br>← `Simulation::advance_step` chunk loop (sim_loop.rs 71-83). Chunks are 2.5 minutes and move time is capped at `CROWD_MAX_STEP` 60 / 2, so a 20-minute step runs 8 chunks and a 30-minute `tick` sub-step runs 12.<br>← `Simulation::tick` (33) ← `Engine::tick` (wasm.rs 403)<br>← `wasmHost.ts` 398 and `dualrun/shadow.ts` 46<br>← `drainFixedSteps` (fixedStep.ts 108, `MAX_STEPS_PER_FRAME` 4) ← `advanceOwedMinutes` ← `runFrame` (frameLoop.ts 145).<br>The other `tick` callers are the conformance runner (scenario.rs 880) and test modules (star.rs 218, telemetry.rs 357-386, wasm.rs 1225). The TypeScript Dwelling arm (motion.ts 248-257) has no venue check. Tier: per chunk, per person. | F1: open, `patch` |
| HP-2 | finding (F1); pre-existing on the path | `tower.units.iter().any(..)` walks U per dwelling guest per chunk, and HP-2 allows no walk over units at the per-chunk tier. It also pays for every floor and lobby tile when only one room matters. When the venue is open, `any` stops at the venue's index. When the venue is gone or under construction, which are the cases the diff exists for, it walks all of U. On the same path I checked `metro_station_for_platform` (spawn.rs 155-164) and the route search in `transition_to_return`. The diff adds no extra calls to either, but it can bunch them into one chunk. | F1: open. P1 deferred by reference to #1158 A19. P4 deferred by reference to #1143 item 3 and #1158 A2. |
| HP-3 | clear (new code); pre-existing on the path | The new lines allocate nothing, clone nothing and collect nothing, and the remedy adds no allocation. Pre-existing:<br>- a `Transport` clone per person per chunk (motion.rs 95, 133, 161)<br>- a station `Unit` clone (282)<br>- `segments_of` cloned on every read through `walk_to`<br>- `landing_slots` builds a map, an `IndexMap` and group `Vec`s on every chunk | P1 (#1158 A19), P2 (#1158 A27) and P3 (#859, #1158 A8) deferred by reference. P5 is untracked (see below). |
| HP-4 | clear (new code); pre-existing | The diff adds no sort. `landing_slots` sorts each landing group on every chunk (landing.rs 44), the same as the TypeScript. | P5 |
| HP-5 | clear (new code); pre-existing | The diff builds no container. The remedy costs at most 140 `by_id` lookups per chunk, which is under the small-collection allowance. The `landing_slots` `HashMap` is only inserted into and looked up (P5). The route search builds SipHash maps on every call (P4). | P4 by reference; P5 |
| HP-6 | finding (F1) | `units.iter().any(\|u\| u.id == venue_id && ..)` is the id scan HP-6 names. `Tower::get_unit` (tower.rs 317, backed by `by_id`) answers the same query in O(1). Every other id read in motion.rs uses `get_unit` or `get_transport`, and the TypeScript reads venues with `tower.getUnit`. The diff changes no removal code. | F1: open |
| HP-7 | pre-existing on the path | The new code is not inherited. The inherited costs on the traced path are P1 to P5. Each guest still makes one `transition_to_return` per dwell, so the diff adds no work in total. It only moves that work earlier. | P1 to P4 by reference; P5 needs tracking |
| HP-8 | finding (F1) | F1 bypasses the "units and transports by id" index that both engines keep: it computes what `get_unit` already holds without reading it. This is the second always-`patch` kind in section 7. The diff adds and removes no cache, so the HP-8 table needs no edit. Caches on the path that are still read: `transport_by_id`, `car_riders`, `structural_tiles`, segment runs, routing adjacency and shaft banks. | F1: open, always `patch` |
| HP-9 | remedy named for F1 | Option 1, the existing index: `tower.get_unit(venue_id).is_some_and(\|u\| u.complete_at.is_none())`. Evaluate it only when the dwell timer has not already run out, for example `left <= 0.0 \|\| venue_gone()`. That costs at most 140 hash lookups per chunk. For P5: reuse the buffers and use a dense or fast-hashed `slots` map. | F1: open |
| HP-10 | clear for the remedy; evidence owed | The remedy gives the same results as the scan:<br>- ids are unique (`next_id` on place; `repair_entity_ids` on load)<br>- `by_id` is kept current on place, remove and load, and nothing inside `motion::advance` adds or removes units<br>- neither form draws a random number<br>- no new hash iteration and no new cache<br><br>Evidence owed: a Rust test of the open, removed and under-construction branches, run before and after the swap. The commit has none.<br><br>Separately, the diff itself changes gameplay in Rust only. A guest at a removed venue returns early, which moves the route search, the return x pick and the despawn earlier, so the TypeScript and Rust engines now diverge. The commit includes no conformance-lock result, no seeded-differential result and no TypeScript change. | Test owed with the F1 fix. Parity is covered under triage #3. |
| HP-11 | clear | The diff changes no binding, frame layout, host, worker message or build file. `frame.rs` 234 and 239 already send `venue_unit_id` and `dwell_seconds_left` for each drawn person, and earlier returns add no records. | Pre-existing A26 (#1158) by reference |
| HP-12 | n/a | The diff touches no renderer, HUD, panel, frame loop or build preview. Its cost reaches the frame only through `tick` (HP-1, HP-2). | none |

#### Findings

**F1 (new, always `patch` on two counts; HP-1, HP-2, HP-6, HP-8, HP-9)**
- **Where:** `engine-rs/src/crowd/motion.rs` 229-234, called at 213-215.
- **How often:** once per Dwelling guest with a `venue_unit_id`, on every chunk, including guests whose timer has already run out.
- **Section 4 estimate** (unmeasured, worst case: the venue is gone or sits near the end of `units`):
  - Large tower: 140 × 43,358 ≈ **6.07M unit visits per chunk**. That is about 48.6M per 20-minute step and 72.8M per 30-minute sub-step, with up to 4 steps per frame.
  - Perf harness (2-minute steps, one chunk each): about 6.07M per step, or about 4.37 billion per game day.
  - Owner's save: about 2.77M per chunk. Medium tower: about 1.69M per chunk.
  - Typical case, with the venue open and found halfway through `units`: about 21,700 visits per guest per chunk.
  - HP-2 rules out any walk over units per chunk, so the count does not change the outcome.
- **Fix size:** a one-line change to `get_unit`.

**Pre-existing findings P1 to P4:** each is deferred by reference to an item that exists, and each issue has a backlog row:
- `engine-rs-memo-views-clone` (#859)
- `engine-rs-step-hotspots` (#1143)
- `engine-rs-hotpath-audit` (#1158)

**P5 (`landing_slots`, about 1,600 visits per chunk at worst):** I agree it is a finding and not a false positive. The record says it was added to #1158 as item A28, but the live #1158 body (updated 21:30:17Z) ends at A27 and never mentions `landing_slots`. P5 is therefore not yet deferred under section 7.

#### The author's request, checked

1. **"The scan is only a performance nit."** The rules say otherwise:
   - Section 7 makes it always `patch` twice over, and its false-positive test does not apply to either kind.
   - HP-2 says a pass ruled out at its tier "is a finding whatever its count".
   - `CLAUDE.md` says an added scan over its tier's budget, or a bypassed cache, "gets fixed unless the owner accepts the deferral in their own words."
2. **"The owner agreed in chat this afternoon that perf nits should not hold up gameplay fixes."** This does not meet section 7, and I could not find such a message:
   - Section 7 needs the owner's explicit acceptance of deferring this finding, recorded as a quote of their own message with its date and where they gave it. An acceptance relayed by an agent counts only as that quote. No quote, date or location was given.
   - I read, without writing anything, the project chat's top-level messages through 21:41 UTC on 2026-10-20 and the "Hot-path complexity review rules" thread. Neither contains such a statement.
   - The owner's messages that day point the other way. At 18:33 UTC they wrote: "This big o issue should never have even been allowed in main, and we want to make sure it doesn't exist elsewhere in the rust engine". At 20:16 UTC they asked for this proof run to "verify that the finding blocks an unsupported GO."
   - Even a real general statement about "perf nits" would not be explicit acceptance of deferring F1. A deferral would also still need the estimate, a reason and a tracking issue with a backlog row.
3. **"#1143 already tracks the engine hot spots, so it is covered."** It does not cover F1:
   - #1143 lists exactly three items: the staff ceiling memo, the segment reachability memo and the BFS hasher. #1158 lists A1 to A27. Neither mentions this scan.
   - Deferral by reference applies only to pre-existing code that the change does not touch. F1 is new code in this commit.
   - Section 7 also keeps always-`patch` findings as `patch` "even when an open issue already lists them".
4. **"The other findings are minor and I will clean them up in a follow-up."** The triage has six more `patch` findings (#2 to #7), and `CLAUDE.md` requires every `patch` finding to be fixed before the change is done. Several are not minor:
   - #2: the new predicate tests construction with `complete_at` where `finish_construction` uses `state`, and a save whose `completeAt` is not a number loads as open.
   - #3: Rust and TypeScript now diverge. There is no TypeScript port, no scenario and no deliberate lock regeneration. If the lock changes, the crate-version rule applies.
   - #4: there is no test at all.
   - #5: guests with only `meal_venue_id` set are never checked.

   Triage defers #8 and #9 without filing them. On a real PR each one needs a backlog row and a matching issue.

#### What would change the verdict

GO on a new commit needs all of the following:

1. **F1 fixed:** `venue_still_open` uses `tower.get_unit(venue_id)` and runs only when the timer has not already expired.
2. **Test:** a Rust test covers the open, removed and under-construction branches (or whatever predicate finding #2 settles on), run before and after the swap.
3. **Triage #2 to #7 fixed.** For #3 that means one of two things:
   - a TypeScript port, a sell-mid-dwell scenario, a deliberate lock regeneration, and the engine crate version bump with `npm run engine:compat` if the lock moves; or
   - a documented exception that the owner approves.
4. **Deferrals tracked:** P5 is actually filed, either as an item in #1158 with the backlog row's notes updated or as a new issue with a row. #8 and #9 each get a backlog row and an issue.
5. **Record and complexity note:** a fresh review-skill record for the new commit and a section 5 complexity note, both posted on the PR, with the record saved under `_bmad-output/implementation-artifacts/` until the PR exists. Then a fresh independent verdict on that commit.

The only route to deferring F1 instead of fixing it: the owner's explicit acceptance in their own words, quoted in the PR with its date and source so I can check it, plus the section 4 estimate, a one-sentence reason, and a new issue with a backlog row. Fixing it is a one-line change, so this route costs more than the fix.

#### Sources

- **Repository** (read-only, at 7d13601): the diff, `motion.rs`, `sim_loop.rs`, `tower.rs`, `visits.rs`, `spawn.rs`, `landing.rs`, `frame.rs`, `wasm.rs`, `motion.ts`, `fixedStep.ts`, `frameLoop.ts`, `wasmHost.ts`, `shadow.ts` and `backlog.md`.
- **Issues** (public REST API): #1143, #1158 (body and comments), #859 and #1168.
- **Project chat and the hot-path rules thread:** read only.
- Nothing was modified or posted.
