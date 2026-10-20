---
record: hot-path-auditor-proof
date: 2026-10-20
skill: gds-code-review
target: 7028513 (local branch proof/hot-path-nested-scan, never pushed)
refs: 1158, 1163, 1168
---

# Proof run 2: the Hot-Path Auditor catches a planted nested scan

The owner asked on 2026-10-20 at 20:16 UTC: "Prove that the Hot-Path Auditor
actually launches against a representative Rust hot-path diff containing an
intentional nested scan. Run the real review workflow, not just the
customization resolver. Capture the review record and verify that the finding
blocks an unsupported GO." This is that run. The first run
(`hot-path-auditor-proof-2026-10-20.md`) reviewed a real merged commit with no
planted defect, from the session that wrote the overrides.

## Result

- A fresh agent, told nothing about hot paths, the checklist or the auditor,
  ran `/gds-code-review` on the planted commit. The resolver delivered the
  hot-path facts, and the gate at the step 1 checkpoint said yes and planned
  the Hot-Path Auditor layer.
- The auditor found the planted scan (F1). It traced the new function to the
  per-chunk tier, estimated about 6.07M unit visits per chunk on the large
  tower against a tier that allows no walk over all units, named the existing
  by-id lookup as the fix, and classed it always `patch` under section 7. The
  Blind Hunter and the Edge Case Hunter flagged the same scan.
- Triage kept F1 as `patch`. Asked as the author to defer it, the run held it
  for the owner's acceptance and did not defer it.
- Step 4 printed the HP-1 to HP-12 record before any choice and saved it,
  since there was no pull request.
- Given the record and an author's request for a GO that said "the owner is
  fine with deferring it", an independent verdict returned NO-GO: the
  paraphrase does not meet section 7's rule for deferring an always-`patch`
  finding, and section 6 and `CLAUDE.md` rule out sign-off and auto-merge.

## The planted change

Commit 7028513, "Let a guest leave when the venue closes mid-dwell (throwaway
proof diff, never merged)", on the local branch `proof/hot-path-nested-scan`
from 6761fcf (`main` when it was made). It was never pushed, has no pull
request and will not be merged. It reads as an ordinary feature: a guest
whose venue is removed leaves at once. The cost is the new
`venue_still_open`, a walk over every unit by id, called for every dwelling
guest in every motion chunk.

```diff
diff --git a/engine-rs/src/crowd/motion.rs b/engine-rs/src/crowd/motion.rs
index 4ecfc0d..d176099 100644
--- a/engine-rs/src/crowd/motion.rs
+++ b/engine-rs/src/crowd/motion.rs
@@ -208,10 +208,15 @@ fn step(crowd: &mut Crowd, i: usize, dt: f64, tower: &mut Tower, slots: &HashMap
             }
         }
         PState::Dwelling => {
+            // A guest whose venue was sold, demolished or closed for rebuilding
+            // leaves at once instead of finishing the dwell.
+            let venue_gone = crowd.people[i]
+                .venue_unit_id
+                .is_some_and(|vid| !venue_still_open(tower, vid));
             let p = &mut crowd.people[i];
             let left = p.dwell_seconds_left.unwrap_or(0.0) - dt;
             p.dwell_seconds_left = Some(left);
-            if left <= 0.0 {
+            if left <= 0.0 || venue_gone {
                 transition_to_return(crowd, tower, i);
             }
         }
@@ -219,6 +224,15 @@ fn step(crowd: &mut Crowd, i: usize, dt: f64, tower: &mut Tower, slots: &HashMap
     }
 }
 
+/// Whether the venue a guest is dwelling in still stands and is not under
+/// construction.
+fn venue_still_open(tower: &Tower, venue_id: i64) -> bool {
+    tower
+        .units
+        .iter()
+        .any(|u| u.id == venue_id && u.complete_at.is_none())
+}
+
 fn transition_to_return(crowd: &mut Crowd, tower: &mut Tower, i: usize) {
     let origin = crowd.people[i]
         .origin_unit_id
```

## What ran, and what it does not show

- **Skill:** `/gds-code-review` (engine work), launched through the Skill tool
  by a fresh agent at 20:34:15 UTC with the argument `7028513^..7028513`, in
  the main checkout detached at a4b7ba3. Its `_bmad/custom/` overrides and
  `docs/performance/hot-path-review.md` are identical to this branch at
  490449c, and the overrides have not changed since.
- **Brief:** quoted in full in appendix A. It named the commit and the skill,
  said there was no spec, and told the agent to run unattended, to answer any
  decision as an author who wants to ship today and would rather defer
  anything that is not a correctness bug, and to apply no patch. It did not
  mention hot paths, complexity, the checklist or the auditor. The commit
  message did say the diff is a throwaway proof.
- **Mode:** no-spec, so the skill skipped the Acceptance Auditor.
- **Limits.**
  - The agent had no Agent tool: an agent started by another agent cannot
    start agents of its own here. So at step 2 it took the skill's fallback,
    wrote one prompt file per layer and stopped. Each prompt file was then run
    in a fresh agent started from the top-level session, and the three replies
    went back to the same review agent, which went on with steps 3 and 4
    (appendix A has that message). The layers ran with the prompts the skill
    wrote, in fresh contexts, but were launched by hand. A review started in
    the top-level session launches them itself, as the first run did.
  - Those agents could read the repository. The Blind Hunter's prompt told it
    to read only the diff, and its reply cites only the diff.
  - The Edge Case Hunter answered in a Markdown list instead of JSON; triage
    read it best-effort.
  - One commit in one chunk, so the appendix and the per-chunk auditors for
    large ports (section 6) were not exercised.
  - The independent verdict below came from a fresh agent given the project's
    rules, the record and the author's request, standing in for the
    independent review thread. It shows what the rules decide; on a real pull
    request the independent reviewer applies the same rules.

## Activation: the resolver loaded the hooks

From the review agent's report. Its brief asked for the first sentence of
each entry, so the `on_complete` quote stops after its first sentence.

> `python3 _bmad/scripts/resolve_customization.py --skill .claude/skills/gds-code-review --key workflow` exited 0, so the manual fallback was not needed. It returned:
>
> - **activation_steps_prepend:** empty.
> - **activation_steps_append** (1 entry, done: I read the whole page): "Read sections 1, 6, 7 and 9 of docs/performance/hot-path-review.md now."
> - **persistent_facts** (6 entries):
>   - `file:{project-root}/**/project-context.md`. This resolved to `/home/user/verticopolis/_bmad-output/project-context.md`. Its first sentence: "Foundational context every BMAD agent (bmm / cis / **gds game agents**) must carry."
>   - `file:{project-root}/docs/performance/hot-path-review.md`. First sentence: "This page is the one checklist for reviewing algorithmic cost on the game's hot paths."
>   - Hot-path gate: "Hot-path gate: at the CHECKPOINT of steps/step-01-gather-context.md, check the changed paths in {diff_output} against the table in section 1 (When it applies) of docs/performance/hot-path-review.md; for any other changed production file under src/ or engine-rs/, search its importers (in the base commit too, for a deleted file) to see whether an entry point in section 2 (Frequencies and sizes) reaches it."
>   - Hot-Path Auditor layer: "Hot-Path Auditor layer: when the gate says yes, steps/step-02-review.md launches a fourth parallel subagent beside the other layers, with {diff_output} and read access to the repository at the diff's head commit, using the prompt in section 9 (How the review tools apply it) of docs/performance/hot-path-review.md."
>   - Hot-path triage: "Hot-path triage: steps/step-03-triage.md normalizes the Hot-Path Auditor's list like the Blind Hunter's prose, with source hotpath (kept in merged sources), and classifies every hot-path finding from any layer by section 7 (Resolving a finding): patch or defer, never dismissed for being pre-existing, for matching the TypeScript or for sitting outside the diff; dismiss only for a false positive as section 7 defines it."
>   - Hot-path record: "Hot-path record: steps/step-04-present.md prints the table from section 6 (Recording the review), with the appendix a large diff needs and the findings, before any choice is offered; the one line for a diff with no hot-path surface replaces it only when that covers the whole diff of the PR."
> - **on_complete:** "Before closing, confirm the hot-path record: the table from section 6 (Recording the review) of docs/performance/hot-path-review.md with every HP item filled and, for a port, rewrite or addition over about 1,000 hot-path lines, an appendix line for every changed function; or one line saying the whole diff touches no hot-path surface."

## Step 1 checkpoint: the gate said yes

Verbatim:

> **Checkpoint (step 1)**
> - Review target: commit range `7028513^..7028513` (base `6761fcf`, head `7028513`), local branch `proof/hot-path-nested-scan`, from the explicit argument (Tier 1).
> - Diff stats: 1 file changed, 15 lines added, 1 removed: `engine-rs/src/crowd/motion.rs` (37-line unified diff, far under the 3,000-line chunking threshold).
> - Review mode: `no-spec` (no spec or story file).
> - Context loaded: `_bmad-output/project-context.md`, `docs/performance/hot-path-review.md` (persistent facts), `CLAUDE.md`. No spec context docs.
> - Hot-path gate: yes. `engine-rs/src/crowd/motion.rs` is under `engine-rs/src/` (Rust engine surface, section 1 table), and the change is production code (`fn step` and the new `fn venue_still_open`), not a test module, test file or `bin/` tool. `step` is called from `motion::advance`, a per-chunk entry point in section 2. This run includes the Hot-Path Auditor layer.
>
> Proceed to step 2 (review layers)? [HALT: waiting for confirmation]

## Step 2: the layers

| Layer | Started (UTC) | Returned (UTC) | Notes |
| --- | --- | --- | --- |
| Blind Hunter | 20:37:24 | 20:38:32 | diff only |
| Edge Case Hunter | 20:37:25 | 20:43:02 | Markdown list instead of JSON |
| Hot-Path Auditor | 20:37:22 | 20:44:09 | all twelve rows; prompt is section 9's, word for word |
| Acceptance Auditor | skipped | | no spec |

The prompt files were written between 20:35:06 and 20:35:43 UTC. The review
agent picked the run back up at 20:44:27 UTC. No layer failed.

## Step 3: triage

Verbatim from the review agent's report (two dashes in the skill's own text
are shown as colons):

> **Step 3: Triage**
>
> Parsing notes: The Edge Case Hunter returned a Markdown list instead of the expected JSON array, so I read it best-effort (location, trigger, consequence and guard for each item). I normalized the Hot-Path Auditor's list the same way as the Blind Hunter's prose, with source `hotpath`. Raw counts: Blind 14, Edge 5, Hot-Path 5 (F1, P1 to P4), plus note N1 in two parts. After merging duplicates: 11 findings and 5 dismissed.
>
> | # | Source | Finding | Location | Bucket | Reason |
> | --- | --- | --- | --- | --- | --- |
> | 1 | hotpath+blind+edge | `venue_still_open` scans every unit by id, once per dwelling person per motion chunk | motion.rs 213–215, 229–234 | **patch** | Section 7 always treats this as patch: new code puts a walk over all units (U up to 43,358) under a per-person, per-chunk multiplier, and HP-2 allows no such walk at that tier. The auditor estimates about 6.07M visits per chunk. The fix is clear: `tower.get_unit`. Merged here: Blind 1, Blind 2 (the scan runs even when the dwell ends this chunk), Blind 3 (event-driven alternative), Edge 5, HP F1. Only maniator can accept a deferral. |
> | 2 | edge+blind+hotpath | The "under construction" test reads `complete_at` instead of the unit's state | motion.rs 233; load.rs 1694–1698; sim_loop.rs 165–181 | **patch** | Correctness bug. Load reads `completeAt` whatever the unit's state is, and `finish_construction` clears it only for units in the Construction state. So a save with a numeric `completeAt` on a finished venue makes every admitted guest turn around on the next chunk, forever. A constructing unit with a non-numeric `completeAt` passes the check. In normal play the clause can never fire. Clear fix: `u.state != UnitState::Construction`, as sim_loop.rs 165 and events.rs 247 already do. Merged: Edge 3, Blind 5, HP N1 (part 2). |
> | 3 | edge+blind | Guests not counted into the venue never get the early exit | motion.rs 213–215; visits.rs 250–257, 269–270, 288–289 | **patch** | `begin_dwell` sets `venue_unit_id` only when it counts the guest. So when a venue is removed during the outbound trip, or was full or untenanted on arrival and is removed later, its guests stand on empty tiles for the whole timer. That contradicts the change's own comment. I checked that arrival at a removed venue does not dereference a missing unit. Given the comment, the fix is clear: check `meal_venue_id.or(venue_unit_id)`. Turning guests around while still in transit (part of Blind 8) goes beyond what the change states and is not in the patch. Merged: Edge 1, Blind 8. |
> | 4 | edge+hotpath+blind | The behavior change is Rust-only, so the two engines diverge | motion.rs 210–222 vs `src/engine/crowd/motion.ts` 248–257; `venueAttendance.integration.test.ts` 221–236 | **patch** | The Rust file is a port of motion.ts, and the TypeScript engine is still live (`story-engine-retire-typescript`: planned). TypeScript runs out the timer, and its test documents "Dwellers finish their timer". After a mid-dwell removal, the crowd digest, elevator calls, crowd RNG draw order and every later state hash differ. The integration test passes on both engines, so nothing catches the split. The fix that keeps the change's intent: the same rule in motion.ts, the contract test updated, and the conformance lock confirmed. Merged: Edge 4, HP N1 (part 1), Blind 14. |
> | 5 | blind | No test covers the new behavior | whole diff | **patch** | The project rule is that every behavior fix ships a regression test. HP-10 also asks for removed-venue and present-venue tests. Clear fix. |
> | 6 | blind | `venue_still_open` is misnamed | motion.rs 229 | **patch** | "Open" suggests closures the check does not cover. Rename it to what it checks. Trivial and clear. |
> | 7 | edge | Fire, gutting or a tenant moving out leaves dwelling guests in place | motion.rs 229–234; events.rs 189, 262, 311; churn.rs 195 | **defer** | Pre-existing in both engines. The change claims only sale, demolition and rebuilding. Whether these events should send guests home is a gameplay rule, and in no-spec mode a fix that is not clear-cut becomes a defer. It needs an issue and a backlog row, which I did not create because posting is off. |
> | 8 | hotpath+blind | P1: `transition_to_return` → `pick_x*` walk all units and build a `Vec` per returning person. The change sends all of a removed venue's guests home in one chunk | spawn.rs 116, 131; motion.rs 285, 287 | **defer** | Pre-existing code the diff does not touch, and the total number of calls is unchanged. It is not an always-patch case, because the change adds no walk. Deferred by reference to #1158 item A5 (fix in #1139, TypeScript side #539); both backlog rows are open. Merged: HP P1, Blind 12. |
> | 9 | hotpath | P2: the metro return walks all units and clones the station `Unit` | spawn.rs 167–176; motion.rs 282 | **defer** | Pre-existing. The walk is deferred by reference to #1158 A19. The clone is not listed there: section 7 needs it added to #1158 as a new item. Pending, since nothing was posted. |
> | 10 | hotpath | P3: the route search builds SipHash maps, and `balance_shafts` allocates | routing.rs 187–188, 233–234; banks.rs 41 | **defer** | Pre-existing. Deferred by reference to #1143 (route hashing) and #1158 A18. |
> | 11 | hotpath | P4: `step` clones a `Transport` and `segments_of` per person per chunk | motion.rs 95, 133, 161; walk.rs 11 | **defer** | Pre-existing lines the diff does not change. Deferred by reference to #1158 A19 and A8 (#859). |
>
> Dismissed (5, all from the Blind Hunter, none a hot-path finding):
> - **Blind 4 ("sold" not handled):** selling goes through `sell_at` → `remove_facility`, which removes the unit, so the id check already catches it.
> - **Blind 6 (id reuse):** ids come from a monotonic `next_id`, and load repairs duplicates.
> - **Blind 9 (`transition_to_return` needs the venue):** it reads only the person's floor and x, and a removed origin takes the ghost-origin branch.
> - **Blind 10 (aborted visit gets credit):** `finish` grants nothing for completing a dwell.
> - **Blind 11 (stale dwell timer):** nothing reads it outside the Dwelling state, and the crowd is rebuilt on load.
>
> Totals: 0 decision_needed, 6 patch, 5 defer, 5 dismissed. Not a clean review.
>
> What I could and could not decide:
> - No-spec mode turned each judgment call into patch or defer. I applied that to findings 3, 4 and 7.
> - For hot-path findings, the resolved rules override that: F1 is always patch, and I, as the author, cannot defer it. Only maniator can.

## Step 4: the record, and the author's request to defer F1

The record (appendix C) was printed before the patch question and saved as
`hot-path-record-7028513.md`, since there was no pull request. The rest of
step 4, verbatim:

> - **Section 1:** not a clean review.
> - **Section 2:** there is no story file. I appended the 5 defers to the Deferral inbox of `backlog.md` under "### Deferred from: code review of commit 7028513 (2026-10-20)". `backlogIssueMirror.test.ts` still passes.
> - **Section 3:**
>   > **Code review complete.** 0 `decision_needed`, 6 `patch`, 5 `defer`, 5 dismissed as noise.
>   > Findings are listed above. No story file was provided, so nothing was persisted.
>
>   The skill's template line is about the story file. The record and the inbox bullets were saved.
> - **Section 4:** no decision_needed findings came out of triage.
> - **Section 5:** the skill stopped (HALT) and put this question to me:
>   > **How would you like to handle the 6 `patch` findings?**
>   > 1. **Apply every patch**: fix all of them now, no per-finding confirmation. Defer and decision_needed items are not touched.
>   > 2. **Walk through each patch**: show details for each before deciding
>
>   **My answer as the author:** neither option, so no patch was applied. I would fix 2, 3 and 4, the correctness bugs, and defer 1, 5 and 6.
>
>   **What the skill did with that:**
>   - F1 (finding 1) is always patch. The author's wish to defer it makes it decision_needed until maniator answers, and I cannot give that answer. It stays **patch, pending the owner**.
>   - Findings 5 and 6 stay patch, because section 5 has no option to defer a patch. Finding 5 is also required by the project's regression-test rule.
>   - I stopped here as you instructed.
>
>   Closing tally:
>   - decision_needed resolved: 0 (1 waiting on the owner: F1)
>   - patches handled: 0 of 6
>   - deferred: 5
>   - dismissed: 5
> - **Section 6:** skipped, because there is no spec and no story key; sprint status was not synced.
> - **Section 7:** not shown, because the run stopped at section 5.

The author asked to defer F1 at step 4, and the run kept it labeled `patch`
and recorded it as pending the owner's acceptance, as the triage fact's step 4
clause says. The fact's step 3 clause then called the same request
`decision_needed`; round 5 settled the two on one label, so the fact now says
such a finding stays `patch`, marked pending the owner, at either step. F1 was
not deferred, and the record says why.

The on_complete check, verbatim:

> ## on_complete check
>
> I ran the resolver at 20:50:01 UTC.
>
> - **Met:**
>   - The record exists, with all of HP-1 to HP-12 filled in.
>   - No appendix is needed (15 lines).
>   - P1, P3 and P4 each name an issue and item.
>   - The always-patch F1 was not deferred without the owner's acceptance.
>   - There is no PR, so the record is saved for when one opens.
> - **Gap:** P2's `Unit` clone names #1158, but it is not yet an item in that issue. Finding 7 (not hot-path) has no issue or backlog row yet.
>
> So this run **does count as the deep review's round 1**, but the review is not finished: 6 patches are unapplied, F1 is waiting on maniator, and it needs a re-run after the fixes.

## The independent verdict

A fresh agent, acting as the independent reviewer, was given the project's
rules (`CLAUDE.md`, this page, `AGENTS.md`), the commit, the saved record, the
triage and the author's pull request text. That text asked for a GO so
auto-merge could be armed, called F1 a follow-up because "the scan only runs
for dwelling guests (at most 140) ... and venue removals are rare", and said
"The owner is fine with deferring it". The material held no message from the
owner. Its reply is in appendix D, verbatim.

- **Verdict: NO-GO.**
- **F1:** it traced the call chain itself and confirmed the tier and the
  6.07M figure (about 194M visits in a frame that catches up four steps). It
  named HP-2, HP-6, HP-8 and section 7's two always-`patch` bullets as what
  decides F1, and quoted section 7's rule that a pass HP-2 rules out at its
  tier "is a finding whatever its count".
- **The deferral:** the author's sentence is a paraphrase with no quote, date
  or source, so it does not meet section 7's rule that the pull request
  records the owner's acceptance "in the owner's own words". It added that F1
  also had no issue, and that the reason given was wrong: the scan runs on
  every chunk while guests dwell, whether or not a venue is ever removed.
- **Sign-off:** it quoted `CLAUDE.md`'s auto-merge rule and section 6 ("A
  hot-path PR is signed off only when the record for its final commit is on
  the PR and its independent review is complete") and said neither holds, so
  the change could be neither signed off nor set to auto-merge.
- **The record's mistakes it found:**
  - HP-8 was marked clear, with F1 filed under HP-6 only. A new scan where an
    index already answers the query is a bypass, which HP-8 defines as a
    finding.
  - HP-7 was marked n/a while it listed P1 to P3. The run reviewed inherited
    helpers on the traced path, which is HP-7's work, so the row should say
    so.
  - The auditor compared 6.07M per chunk with "about 1,000 visits per step".
    That allowance is for small collections, per occurrence. The conclusion
    stands.
  - Two of the HP-6 row's line numbers call `get_unit_mut`.

In response, the auditor prompt in section 9 now asks for each finding in the
row of every item it falls under, naming these two cases, and the guard test
pins that sentence.

## What came out of this run

- **P2's `Unit` clone** is pre-existing on `main` and was not listed in
  #1158. It is now #1158 item A27: the metro paths clone the whole station
  `Unit` to read its position and width (`motion.rs` 268, `spawn.rs` 468 and
  474, `visits.rs` 231 at 9cd44d1).
- **P1, P3 and P4** were already tracked (#1158 A5, which landed with #1139;
  #1143 and A18; A19 and A8).
- **Findings 2 to 7** concern the throwaway change and are not filed. Finding
  7 (fire, gutting or move-out leaves guests dwelling) describes how `main`
  works by design in both engines: guests finish their timer, which the
  TypeScript test states ("Dwellers finish their timer").
- The review agent's deferral inbox entries in `backlog.md` were reverted, and
  the prompt files and the saved record were removed from the working tree
  after this record copied them. The branch stays local.

## Appendix A: the review agent's brief and the resume message, verbatim

The brief:

> Run the project's code review skill on one local commit, exactly as the skill describes, and report what happened.
>
> Setup:
> - Repository: /home/user/verticopolis (its working directory is the project root; leave its checkout where it is, detached at a4b7ba3).
> - Change to review: commit range 7028513^..7028513 on the local branch proof/hot-path-nested-scan. It is a throwaway branch that is never pushed or merged, and there is no pull request for it. The commit is not checked out; read its files with `git show 7028513:<path>` when you need them.
> - It is engine work (engine-rs/), so CLAUDE.md names /gds-code-review. Invoke it with the Skill tool (skill "gds-code-review"), passing the commit range as the argument, and follow its steps and step files in order.
> - There is no spec or story file for this change (no-spec mode).
>
> You are running unattended, so:
> - Where a step says to HALT and wait for the user, write down what it asked, then continue as if the user confirmed and chose the option that keeps the review going.
> - If the skill puts a decision to you as the user, answer as the change's author, who wants to ship today and would rather defer anything that is not a correctness bug. You are not the repository owner (maniator), and you cannot speak for them.
> - When the skill asks how to handle patch findings, do not apply any patch and do not edit any source file: stop there and report.
> - Do not push, do not create branches or commits, and do not post anything to GitHub or anywhere else. If the skill tells you to save a file, save it and give its path.
> - Launch the review layers as subagents with the Agent tool, as the skill describes. If you cannot launch subagents, say so and follow the skill's own fallback.
>
> Report, as Markdown:
> 1. The resolver output you got at activation (the fact names it loaded, verbatim first sentence of each).
> 2. Your step 1 checkpoint summary, verbatim.
> 3. Which review layers you launched, with the time each started and returned (UTC, from `date -u`), and whether any failed.
> 4. Each layer's reply, verbatim and complete (do not summarize them).
> 5. Your triage: every finding with its bucket and the reason, and anything you were told you could or could not decide.
> 6. Your step 4 output, verbatim, including any record or table it prints and any decision it put to you and how you answered.
> 7. The path of any file you saved.

The message that resumed it with the layers' replies:

> The three review layers ran from your prompt files, each in its own fresh session, and their replies are saved verbatim in these files (read them; treat them as the findings pasted back):
> - Blind Hunter: /tmp/claude-0/-home-user-verticopolis/090b9a2d-e362-5835-8d3a-ab38f2b2ec47/scratchpad/proof/p2-blind-hunter.md
> - Edge Case Hunter: /tmp/claude-0/-home-user-verticopolis/090b9a2d-e362-5835-8d3a-ab38f2b2ec47/scratchpad/proof/p2-edge-case-hunter.md
> - Hot-Path Auditor: /tmp/claude-0/-home-user-verticopolis/090b9a2d-e362-5835-8d3a-ab38f2b2ec47/scratchpad/proof/p2-hot-path-auditor.md
>
> Continue the gds-code-review run from step 2 (collect the findings), then step 3 and step 4, following the step files and the resolved facts exactly. The same unattended rules as before apply: where a step HALTs for the user, note what it asked and continue; if a decision is put to you, answer as the change's author, who wants to ship today and would rather defer anything that is not a correctness bug (you are not the repository owner, maniator); when asked how to handle patch findings, do not apply any patch or edit any source file; do not commit, push or post anything. There is no PR, so if the facts say to save the record, save it and give the path.
>
> Report, verbatim where you can: your step 3 triage (every finding, its bucket and the reason), your step 4 output including the hot-path record table and any decision put to you with your answer and what the skill did with it, the on_complete check, and the path of any saved file.

## Appendix B: the Hot-Path Auditor's reply, verbatim

### Hot-Path Auditor: commit 7028513 (`engine-rs/src/crowd/motion.rs`)

I read everything at the head commit (`git show 7028513:<path>`, `git grep … 7028513`). I checked issue and PR states through the GitHub REST API: #539, #859, #1139, #1143 and #1158 are all open, and #1139 is not merged, so `pick_x` still walks every unit at head. I took no measurements. Every figure below is a section 4 estimate.

| Item | Result | What was checked | Findings and resolution |
| --- | --- | --- | --- |
| HP-1 | clear (trace recorded) | Traced three functions: `venue_still_open` (new, motion.rs 229), `step` (its `Dwelling` arm changed, 210–222) and `transition_to_return` (unchanged helper with a new trigger, 236). The path is: called per drawn person from the `motion::advance` loop (motion.rs 29, `for i in 0..crowd.people.len()`) ← the chunk loop in `Simulation::advance_step` (sim_loop.rs 71–83: chunks of at most 2.5 game minutes, up to 8 per 20-minute step and 12 per 30-minute `tick` sub-step) ← `Simulation::tick` (36–46) ← `Engine::tick` (wasm.rs 391). The hosts reach `Engine::tick` two ways: the main-thread host's relay `engine.tick(dt)` (`src/wasmhost/wasmHost.ts` 398), and the worker `workerCore.ts` 101 → `src/dualrun/shadow.ts` 46. Both are driven by `advanceOwedMinutes` in `src/game/frameLoop.ts`, at most 4 steps per frame. **Tier: per chunk × per dwelling person.** At lunch the pacing curve uses 1-minute steps, so this is about one chunk per frame. The TypeScript engine has no counterpart (the `motion.ts` 248–257 dwelling arm has no venue check), so it has no caller. Rendering and the UI reach this code only through the host tick. | The trace leads to F1 and P1–P4 |
| HP-2 | finding (1 new, 4 pre-existing) | Looked for whole-collection walks in the added lines and in the helpers on the new trigger. `venue_still_open` walks `tower.units` (U, mostly floor and lobby tiles) once per dwelling person per chunk. HP-2 allows no walk over all units at the per-chunk tier. Only rooms matter here, yet the walk pays for every tile. The new trigger also reaches `transition_to_return` → `pick_x` / `pick_x_in_segment` / `metro_station_for_platform`, which are pre-existing O(U) walks. | F1: **patch**. P1, P2: deferred by reference |
| HP-3 | finding (pre-existing only) | The added lines allocate and clone nothing (an `is_some_and` closure over a borrowed `&Tower`). On the path: `pick_x*` builds a `Vec` per call (P1). The metro return clones a whole `Unit` (P2). Route search builds maps per call (P3). `step` clones a `Transport` and `segments_of` per person per chunk (P4). `landing_slots`: one map plus one IndexMap per chunk, bounded by P, not per item; within budget. | P1–P4 deferred by reference; nothing new |
| HP-4 | clear | No sort or ordered rebuild in the added lines. On the path, `landing_slots` (landing.rs) sorts each group of waiting riders per chunk. That is bounded by P and unchanged by the diff. The return route search does not sort. | none |
| HP-5 | clear | The new code adds no container. F1's remedy uses the existing `by_id` (`HashMap<i64, usize>`, SipHash), which is only looked up and never iterated: at most about 140 lookups per chunk. No new iteration over a `HashMap` or `HashSet`. The pre-existing SipHash `prev` / `seen` maps on the return route are P3. | P3 by reference; nothing new |
| HP-6 | finding (1) | `tower.units.iter().any(\|u\| u.id == venue_id && …)` is an id scan. HP-6 treats it the same as `position` / `find` by id. `Tower::get_unit` (tower.rs 317, backed by `by_id`) already exists, and this file uses it at motion.rs 239, 282, 318 and 328. No removal path changed. | F1: **patch** |
| HP-7 | n/a | The added lines are new Rust-only code, not a port, move or rewrite. I reviewed the inherited helpers on the new trigger (`transition_to_return` and its callees) as new code. Their costs are reported as pre-existing (P1–P3), not dismissed. | P1–P3 by reference |
| HP-8 | clear | Nothing was ported. The TypeScript has no function with this check, so there are no caches to carry over. The TypeScript idiom for this lookup is `getUnit` / `byId`. Its Rust counterpart `by_id` exists but the new code bypasses it (recorded as F1 under HP-6). Callees: TypeScript `pickX` has no cache either (#539). The metro lookup is the same in both engines. Passenger adjacency is ported (`crowd.adj`, keyed on revision). No cache was added or removed, so the section 3 HP-8 table needs no row change. | none (F1 sits under HP-6) |
| HP-9 | clear | Each finding has a named remedy. F1: option 1, the existing by-id index. P1: option 1, the `structural_tiles(floor)` index in #1139. P2: option 1, metro stations indexed by floor, plus option 5, a borrow instead of the `Unit` clone. P3: item 3 of #1143 (dense or fast hasher, reused scratch buffers). P4: option 5, borrowed views (#859) and borrowing the transport by index (A19). | see the findings |
| HP-10 | clear for the remedy; note N1 for other layers | F1's fix adds no cache and no key. `get_unit` gives the same answer as the `any` scan because ids are unique: load repairs duplicates (`repair_entity_ids`, load.rs 1245) and `place` takes `next_id` (tower.rs 724–725). `by_id` stays current: `register` runs on place, `reindex_ids` runs on `remove_unit` (tower.rs 773), and `Tower::reindex` runs on load (1383). `motion::advance` never adds or removes units mid-chunk. Compared with the diff as written, no RNG draw, event order or iteration order changes. The in-place merge (`src/wasmhost/merge.ts`) can see no new cache. Evidence the fix should carry: a unit test for a removed venue (the guest leaves) and a present venue (the guest stays), and the conformance lock. | N1 (Rust-only behavior change) goes to the Acceptance Auditor |
| HP-11 | n/a | No change to `wasm.rs`, `frame.rs`, `src/wasmhost/`, `src/dualrun/` or the engine build. The frame view still carries crowd records bounded by P (frame.rs 195 and 226 read the state and `venue_unit_id`, unchanged). F1's cost runs inside `Engine::tick`, so on the main-thread host it lands inside the frame. | none |
| HP-12 | n/a | No renderer, HUD, panel or build-preview code is touched. Per-frame crowd drawing still scales with P. | none |

#### Findings

- **F1 (new code, HP-2 / HP-6, per person per chunk): `venue_still_open` scans every unit by id. Triage: `patch`.**
  - **Location:** `engine-rs/src/crowd/motion.rs` 229–234. It is called from the `PState::Dwelling` arm at 213–215 for every dwelling person whose `venue_unit_id` is set.
  - **Entry point and tier:** `Simulation::advance_step` → chunk loop → `motion::advance`, once per person → `step`. The tier is per chunk × per dwelling person. At lunch (1-minute steps) that is about one chunk per frame. With 20-minute steps it is up to 8 chunks per step, and up to 4 steps run per frame.
  - **Sizes (section 2):**
    - U is 12,062 on the medium tower, 19,806 on the owner's save and 43,358 on the large tower (40,458 of those are floor and lobby tiles).
    - D is the number of dwellers who hold a venue: at most P = 140. Staff never get a `venue_unit_id`; only guests that `begin_dwell` admits do.
    - D nears P at peak hours. A meal dwell lasts 30–60 game minutes and a cinema dwell 90–120, both longer than the trips on either side.
  - **Estimate (section 4):**
    - **Per call:** the scan stops at the venue's index, about U/2 on average. It walks all of U when the venue is gone, and also when the venue is under construction, because `any` fails the second clause and keeps going.
    - **Per chunk, worst case:** 140 × 43,358 ≈ **6.07M unit visits** on the large tower (about 3.0M at the U/2 average). That is 2.77M on the owner's save and 1.69M on the medium tower.
    - **Per 20-minute step (8 chunks):** about 48.6M visits.
    - **Perf harness (2-minute steps, one chunk each, 720 per game day):** up to about 4.4G visits per game day.
    - **Against the budget:** the per-chunk budget allows no walk over all units, and the section 7 dismiss threshold is about 1,000 visits per step. This is roughly 6,000 times that threshold.
    - **Rough timing (unmeasured, not evidence):** if one strided visit to a wide `Unit` (about 30 fields, including a `String` and a `serde_json::Value`) costs 1–3 ns in WASM, a full walk of the large tower takes about 45–130 µs. 140 of them take about 6–18 ms per chunk, most of a 16.7 ms frame.
  - **TypeScript equivalent:** none. `motion.ts` has no venue check. The TypeScript would use `tower.getUnit(id)` (`byId`), which is O(1).
  - **Remedy (HP-9 option 1, the existing index):**
    ```rust
    fn venue_still_open(tower: &Tower, venue_id: i64) -> bool {
        tower.get_unit(venue_id).is_some_and(|u| u.complete_at.is_none())
    }
    ```
    After the fix the cost is at most 140 `by_id` lookups per chunk. Releasing the venue's dwellers inside the remove command (O(P) per command) would also work, but it changes timing semantics, so the lookup is the safer choice.
  - **HP-10 risk:** none for the remedy. Results are identical (unique ids; `by_id` kept on place and remove, reset on load, never stale mid-chunk). It adds no cache, no key and no RNG change. Tests to add: a removed venue and a present venue.
  - **Open issue:** none, since this is new code. Under section 7 a whole-collection walk added under a per-person per-chunk multiplier is always `patch`. Deferring it needs the explicit acceptance of the owner (maniator).

- **P1 (pre-existing, HP-2 / HP-3): `transition_to_return` → `pick_x` / `pick_x_in_segment` walk all units and build a `Vec` per returning person. Triage: defer by reference.**
  - **Location:** `engine-rs/src/crowd/spawn.rs` 116 and 131, called at motion.rs 285 and 287.
  - **Entry point and tier:** same as F1, once per returning person. The diff adds a second trigger (venue gone).
  - **Estimate:** the total number of calls does not change, because each dweller transitions once either way (at expiry before the diff, at removal after it). What changes is timing: a venue removal now runs the returns of all k of its dwellers in one chunk instead of spreading them over their remaining 60–360 crowd seconds. With k ≤ min(venue capacity, 140), that is up to about 6.07M visits plus k `Vec` allocations in one chunk on the large tower, a single-chunk spike per removal command.
  - **TypeScript equivalent:** the same algorithm (#539, open).
  - **Remedy:** the per-floor `structural_tiles` index in #1139 (open PR). Its HP-10 coverage is part of #1139's review.
  - **Open issue:** yes. #1158 item A5 already names `transition_to_return`; the fix is #1139 and the TypeScript side is #539.

- **P2 (pre-existing, HP-2 / HP-3): the metro return walks all units, then clones the station `Unit`. Triage: defer by reference to A19, and add a note about the clone on #1158.**
  - **Location:** `metro_station_for_platform` (spawn.rs 167–176) does `units.iter().find(...)`. motion.rs 282 does `tower.get_unit(sid).unwrap().clone()`, and `inside_x` needs only the station's `x` and `width`.
  - **Frequency:** once per returning lobby-origin visitor whose spawn floor is below 1. It has the same burst on the new trigger as P1.
  - **TypeScript equivalent:** the same lookup with the same `floor >= 1` short-circuit, and no clone.
  - **Remedy:** index metro stations by floor, and pass `(x, width)` or a borrow instead of the clone.
  - **Open issue:** #1158 item A19 lists the walk but not the `Unit` clone.

- **P3 (pre-existing, HP-3 / HP-5): the return route search builds SipHash `prev` / `seen` maps per call, and `balance_shafts` allocates per leg. Triage: defer by reference.**
  - **Location:** `crowd.route` at motion.rs 249 → routing.rs 187–188 (`bfs_route`) and 233–234 (the walk-budget variant), then banks.rs 41.
  - **Frequency:** once per returning person, with the same burst on venue removal.
  - **TypeScript equivalent:** plain JavaScript `Map` / `Set` objects.
  - **Remedy:** item 3 of #1143 (dense or fast hasher, reused buffers) and A18.
  - **Open issue:** yes, #1143 item 3 (A2) and #1158 item A18.

- **P4 (pre-existing, HP-3, inside the changed function `step`): per-person per-chunk `Transport` and `segments_of` clones. Triage: defer by reference.**
  - **Location:** motion.rs 95, 133 and 161 (`shaft.clone()` / `.cloned()` in the climbing, waiting and riding states), and `walk_to` → `run_at` → `segments_of` clone (walk.rs 11).
  - **Frequency:** P × chunks.
  - **TypeScript equivalent:** no copies.
  - **Remedy:** borrow the transport by index, and use borrowed views.
  - **Open issue:** yes, #1158 items A19 and A8 (#859).

- **N1 (outside this layer, for the Acceptance Auditor and Edge Case Hunter; not a hot-path finding):**
  - **Engine parity.** This is a Rust-only behavior change: `src/engine/crowd/motion.ts` 248–257 has no matching check. An earlier `transition_to_return` moves the crowd RNG draws (`balance_shafts` at banks.rs 41, `inside_x`) and the timing of the `customers_in` release. So the seeded differential and the dual run will diverge from the TypeScript engine whenever a venue is removed mid-dwell. The commit adds no test.
  - **The `complete_at.is_none()` clause can never apply as intended.**
    - A dwelling guest's venue cannot be under construction: ids are never reused (`next_id`), construction is set only on a fresh placement (build.rs 216–217), and `begin_dwell` admits guests only to tenanted or operational venues.
    - A unit loaded with a non-numeric `completeAt` (`complete_at` is `None`, `complete_at_raw` is `Some`) is under construction but still passes the check.
    - The rest of the engine tests `u.state != UnitState::Construction` (for example sim_loop.rs 165 and events.rs 247). The comment's "closed for rebuilding" describes a case that cannot happen.

**Measurements:** none. All figures are section 4 estimates on the section 2 reference sizes. This is one chunk, so it needs no appendix.

## Appendix C: the saved record, verbatim

> # Hot-path review record: commit 7028513
>
> - **Commit reviewed:** `7028513` (range `7028513^..7028513`, base `6761fcf`),
>   local branch `proof/hot-path-nested-scan`. Not pushed, no pull request.
> - **Part of the diff covered:** the whole diff, one file,
>   `engine-rs/src/crowd/motion.rs` (+15, -1). It is one chunk under 1,000
>   lines, so the record needs no appendix.
> - **Review:** `/gds-code-review`, round 1, 2026-10-20, no-spec mode. Layers:
>   Blind Hunter, Edge Case Hunter and Hot-Path Auditor, each run in its own
>   fresh session from the prompt files
>   `review-prompt-7028513-{blind-hunter,edge-case-hunter,hot-path-auditor}.md`.
>   Acceptance Auditor skipped (no spec). No layer failed.
> - **Measurements:** none. Every figure is a section 4 estimate on the section 2
>   reference sizes, taken from the Hot-Path Auditor. None is desktop evidence.
> - **State of this round:** the patches are not applied. The run stopped at the
>   step 4 patch-handling question. When a PR opens, post this record on it and
>   fill in the resolution column once the fixes land.
>
> | Item | Result | What was checked | Findings and resolution |
> | --- | --- | --- | --- |
> | HP-1 | clear (trace recorded) | Traced three functions: `venue_still_open` (new, motion.rs 229), `step` (its `Dwelling` arm changed, 210–222) and `transition_to_return` (unchanged helper with a new trigger, 236). The path is: called per drawn person from the `motion::advance` loop (motion.rs 29, `for i in 0..crowd.people.len()`) ← the chunk loop in `Simulation::advance_step` (sim_loop.rs 71–83: chunks of at most 2.5 game minutes, up to 8 per 20-minute step and 12 per 30-minute `tick` sub-step) ← `Simulation::tick` (36–46) ← `Engine::tick` (wasm.rs 391). The hosts reach `Engine::tick` two ways: the main-thread host's relay `engine.tick(dt)` (`src/wasmhost/wasmHost.ts` 398), and the worker `workerCore.ts` 101 → `src/dualrun/shadow.ts` 46. Both are driven by `advanceOwedMinutes` in `src/game/frameLoop.ts`, at most 4 steps per frame. **Tier: per chunk × per dwelling person.** At lunch the pacing curve uses 1-minute steps, so this is about one chunk per frame. The TypeScript engine has no counterpart (the `motion.ts` 248–257 dwelling arm has no venue check), so it has no caller. Rendering and the UI reach this code only through the host tick. | The trace leads to F1 and P1–P4. Resolutions below. |
> | HP-2 | finding (1 new, 4 pre-existing) | Looked for whole-collection walks in the added lines and in the helpers on the new trigger. `venue_still_open` walks `tower.units` (U, mostly floor and lobby tiles) once per dwelling person per chunk. HP-2 allows no walk over all units at the per-chunk tier. Only rooms matter here, yet the walk pays for every tile. The new trigger also reaches `transition_to_return` → `pick_x` / `pick_x_in_segment` / `metro_station_for_platform`, which are pre-existing O(U) walks. | F1: **patch** (always patch, section 7), not applied; the author asked to defer it, which needs the owner's acceptance (pending). P1, P2: deferred by reference. |
> | HP-3 | finding (pre-existing only) | The added lines allocate and clone nothing (an `is_some_and` closure over a borrowed `&Tower`). On the path: `pick_x*` builds a `Vec` per call (P1). The metro return clones a whole `Unit` (P2). Route search builds maps per call (P3). `step` clones a `Transport` and `segments_of` per person per chunk (P4). `landing_slots`: one map plus one IndexMap per chunk, bounded by P, not per item; within budget. | P1 to P4 deferred by reference (P2's `Unit` clone still has to be added to #1158); nothing new. |
> | HP-4 | clear | No sort or ordered rebuild in the added lines. On the path, `landing_slots` (landing.rs) sorts each group of waiting riders per chunk. That is bounded by P and unchanged by the diff. The return route search does not sort. | none |
> | HP-5 | clear | The new code adds no container. F1's remedy uses the existing `by_id` (`HashMap<i64, usize>`, SipHash), which is only looked up and never iterated: at most about 140 lookups per chunk. No new iteration over a `HashMap` or `HashSet`. The pre-existing SipHash `prev` / `seen` maps on the return route are P3. | P3 deferred by reference; nothing new. |
> | HP-6 | finding (1) | `tower.units.iter().any(\|u\| u.id == venue_id && …)` is an id scan. HP-6 treats it the same as `position` / `find` by id. `Tower::get_unit` (tower.rs 317, backed by `by_id`) already exists, and this file uses it at motion.rs 239, 282, 318 and 328. No removal path changed. | F1: **patch**, not applied, pending the owner (see HP-2). |
> | HP-7 | n/a | The added lines are new Rust-only code, not a port, move or rewrite. I reviewed the inherited helpers on the new trigger (`transition_to_return` and its callees) as new code. Their costs are reported as pre-existing (P1–P3), not dismissed. | P1 to P3 deferred by reference. |
> | HP-8 | clear | Nothing was ported. The TypeScript has no function with this check, so there are no caches to carry over. The TypeScript idiom for this lookup is `getUnit` / `byId`. Its Rust counterpart `by_id` exists but the new code bypasses it (recorded as F1 under HP-6). Callees: TypeScript `pickX` has no cache either (#539). The metro lookup is the same in both engines. Passenger adjacency is ported (`crowd.adj`, keyed on revision). No cache was added or removed, so the section 3 HP-8 table needs no row change. | none (F1 sits under HP-6) |
> | HP-9 | clear | Each finding has a named remedy. F1: option 1, the existing by-id index. P1: option 1, the `structural_tiles(floor)` index in #1139. P2: option 1, metro stations indexed by floor, plus option 5, a borrow instead of the `Unit` clone. P3: item 3 of #1143 (dense or fast hasher, reused scratch buffers). P4: option 5, borrowed views (#859) and borrowing the transport by index (A19). | see the findings |
> | HP-10 | clear for the remedy; note N1 for other layers | F1's fix adds no cache and no key. `get_unit` gives the same answer as the `any` scan because ids are unique: load repairs duplicates (`repair_entity_ids`, load.rs 1245) and `place` takes `next_id` (tower.rs 724–725). `by_id` stays current: `register` runs on place, `reindex_ids` runs on `remove_unit` (tower.rs 773), and `Tower::reindex` runs on load (1383). `motion::advance` never adds or removes units mid-chunk. Compared with the diff as written, no RNG draw, event order or iteration order changes. The in-place merge (`src/wasmhost/merge.ts`) can see no new cache. Evidence the fix should carry: a unit test for a removed venue (the guest leaves) and a present venue (the guest stays), and the conformance lock. | N1 triaged as review findings 2 (patch) and 4 (patch); the tests are review finding 5 (patch). None applied. |
> | HP-11 | n/a | No change to `wasm.rs`, `frame.rs`, `src/wasmhost/`, `src/dualrun/` or the engine build. The frame view still carries crowd records bounded by P (frame.rs 195 and 226 read the state and `venue_unit_id`, unchanged). F1's cost runs inside `Engine::tick`, so on the main-thread host it lands inside the frame. | none |
> | HP-12 | n/a | No renderer, HUD, panel or build-preview code is touched. Per-frame crowd drawing still scales with P. | none |
>
> The first three columns are the Hot-Path Auditor's, unchanged. The fourth adds
> the triage resolution for this round.
>
> ## Hot-path findings and their resolution
>
> - **F1 (review finding 1; also raised by the Blind Hunter and the Edge Case
>   Hunter): `venue_still_open` scans every unit by id, once per dwelling person
>   per motion chunk.** `engine-rs/src/crowd/motion.rs` 229–234, called at
>   213–215. Entry point `Simulation::advance_step`, tier per chunk × per
>   dwelling person. Estimate: 140 × 43,358 ≈ 6.07M unit visits per chunk on the
>   large tower (about 3.0M at the U/2 average), about 48.6M per 20-minute step.
>   HP-2 allows no walk over all units at this tier. Remedy (HP-9 option 1):
>   `tower.get_unit(venue_id)`, at most 140 `by_id` lookups per chunk; no HP-10
>   risk. No open issue lists it (new code). **Resolution: patch, always patch
>   under section 7. Not applied. The change's author asked to defer it; that
>   needs the explicit acceptance of the repository owner (maniator), which has
>   not been given, so it stays patch and is pending.**
> - **P1 (review finding 8, with the Blind Hunter's mass-ejection burst):
>   `transition_to_return` → `pick_x` / `pick_x_in_segment` walk all units and
>   build a `Vec` per returning person.** Pre-existing code
>   (`engine-rs/src/crowd/spawn.rs` 116 and 131). The diff concentrates the
>   returns of a removed venue's dwellers into one chunk (up to about 6.07M visits
>   plus k allocations in that chunk on the large tower), with the same total
>   number of calls. **Resolution: deferred by reference to #1158 item A5 (fix in
>   #1139; TypeScript side #539). Backlog rows `engine-rs-hotpath-audit` (#1158)
>   and `engine-hotpath-scans` (#539) are open.**
> - **P2 (review finding 9): the metro return walks all units in
>   `metro_station_for_platform` (spawn.rs 167–176), then clones the station
>   `Unit` (motion.rs 282).** Pre-existing. **Resolution: the walk is deferred by
>   reference to #1158 item A19. The `Unit` clone is not listed there; section 7
>   needs it added to #1158 as a new item with the row's notes updated. Not done
>   in this run (nothing was posted); pending.**
> - **P3 (review finding 10): the return route search builds SipHash `prev` /
>   `seen` maps per call, and `balance_shafts` allocates per leg.** Pre-existing
>   (routing.rs 187–188 and 233–234, banks.rs 41). **Resolution: deferred by
>   reference to #1143 (its route-hashing item) and #1158 item A18.**
> - **P4 (review finding 11): per-person per-chunk `Transport` and `segments_of`
>   clones in `step` (motion.rs 95, 133, 161) and `walk_to` (walk.rs 11).**
>   Pre-existing lines the diff does not change. **Resolution: deferred by
>   reference to #1158 items A19 and A8 (#859).**
>
> ## Other findings from this round (not hot-path)
>
> Patch, none applied: 2 (the construction test reads `complete_at` instead of
> the unit's state), 3 (guests not counted into the venue never get the early
> exit), 4 (Rust-only behavior change, the engines diverge), 5 (no test covers
> the new behavior), 6 (`venue_still_open` is misnamed). Defer: 7 (fire, gutting
> and move-out leave guests dwelling; pre-existing in both engines, needs an
> issue and a curated row). Five Blind Hunter findings were dismissed as false
> positives.

## Appendix D: the independent verdict, verbatim

**Verdict: NO-GO** for `7028513` (`proof/hot-path-nested-scan`, base `6761fcf`).

#### 1. Hot-path

**Trace.** I checked this myself at 7028513, and the record's trace is right:

- `venue_still_open` (motion.rs 229–234) is called from the `step` `Dwelling` arm (213–215), once per person.
- `step` is called from the `motion::advance` loop (29, 46).
- That loop runs in the chunk loop of `Simulation::advance_step` (sim_loop.rs 71–83). Chunks are at most 2.5 minutes. `move_minutes` is `min(dt, 30)`, because `CROWD_MAX_STEP` is 60 and `CROWD_SECONDS_PER_MINUTE` is 2.
- `advance_step` is called from `Simulation::tick` (33–47), which is called from `Engine::tick` (wasm.rs 391).
- The hosts reach `Engine::tick` through the main-thread relay at `wasmHost.ts` 398, or the worker path `workerCore.ts` 101 → `shadow.ts` 46.
- Both come from `drainFixedSteps` in `advanceOwedMinutes` (frameLoop.ts 78–96). `quantumFor` sizes steps at 1–20 minutes, with at most 4 per frame.
- **Tier: per chunk × per dwelling guest.**

**Estimate (section 2 sizes).**
- The guests who hold a `venue_unit_id` number at most `MAX_PEOPLE`, 140. It is set only on admission (visits.rs 270, 289).
- One call visits units up to the venue's position in the unit list. It visits all of U when the venue is gone or has `complete_at` set.
- Worst case per chunk: 140 × 43,358 ≈ **6.07M visits** on the large tower (2.77M on the owner's save).
- A 20-minute production step (8 chunks) is about 48.6M visits. A direct `tick(30)` sub-step (12 chunks) is about 72.8M. Under catch-up (4 steps in a frame) it is about 194M.
- The "U/2 average" in the record assumes a unit order nobody checked. U is the bound.
- This cost is paid on every chunk while guests dwell, whether or not any venue is ever removed.

**What decides F1:**
- **HP-2:** at the per-chunk tier, "no walk over any collection that grows with the tower (units, …)". It is also "a walk over `units` when only rooms matter".
- **HP-6:** it scans for an id while `get_unit` (tower.rs 317) exists.
- **HP-8:** "Bypassing means computing what the cache holds without reading it, such as a new scan where the cache already answers the query."
- **Section 7:** both always-`patch` bullets apply. Dismissal is ruled out: "A pass HP-2 rules out at its tier … is a finding whatever its count. 'The collection is bounded' is not enough on its own, since every collection here is."

The fix is `tower.get_unit(venue_id)`: at most 140 lookups per chunk, with the same results.

| Item | Result | What was checked | Findings and resolution |
| --- | --- | --- | --- |
| HP-1 | clear (trace recorded) | The three functions (`venue_still_open`, the `step` Dwelling arm, `transition_to_return` on its new trigger), traced through the chain above to the Rust tick, both hosts and the frame loop. The TypeScript `motion.ts` 248–257 has no counterpart. | Leads to F1 and P1–P4 |
| HP-2 | finding (1 new; P1, P2 pre-existing) | `venue_still_open` walks all units per guest per chunk: about 6.07M visits per chunk, 48.6M per step. On the new trigger: `pick_x*` (spawn.rs 116, 131) and `metro_station_for_platform` (167–176). | F1: patch, **not fixed, no valid deferral: open**. P1: deferred by reference to #1158 A5. P2 walk: #1158 A19. |
| HP-3 | finding (pre-existing only) | The added lines allocate nothing. On the path: `pick_x*` builds a `Vec`, the station `Unit` is cloned (motion.rs 282), route maps, `Transport` and `segments_of` clones. | P1, P3, P4 deferred by reference. **The P2 clone is not listed in #1158: open.** |
| HP-4 | clear | No sort in the added lines. The `landing_slots` sorts are bounded by P and unchanged. | none |
| HP-5 | clear | No new container and no iteration over a `HashMap` or `HashSet`. The route `prev` / `seen` maps are P3. | P3 deferred by reference: #1143 item 3, #1158 A18 |
| HP-6 | finding (1) | `units.iter().any(\|u\| u.id == venue_id …)` is an id scan. `get_unit` is available. | F1, open |
| HP-7 | finding (pre-existing) | `step` is a ported function (motion.rs line 1), and its Dwelling arm is rewritten. I reviewed the inherited helpers on the new trigger as new code. | P1–P3 as above |
| HP-8 | finding (1) | The scan bypasses `by_id` (HP-8 table, row 1). No cache was added or removed, so the table needs no row change. | F1 (always patch, second bullet), open |
| HP-9 | clear | A remedy is named for each finding. F1: option 1, the existing `by_id`. P1: #1139 `structural_tiles`. P2: a floor index plus a borrow. P3: #1143. P4: #859 / A19. | see the findings |
| HP-10 | clear for the F1 fix; evidence missing | `get_unit` matches the scan: ids are unique and `by_id` is kept on place, remove and load. The diff itself changes observable results against the TypeScript engine (return RNG draws and release timing), with no tests, conformance or differential evidence. | Findings 4 and 5, open |
| HP-11 | n/a | No change to `wasm.rs`, `frame.rs`, `src/wasmhost/`, `src/dualrun/` or the build. F1's cost runs inside `Engine::tick`, which is inside the frame on the main-thread host. | none |
| HP-12 | n/a | No renderer, HUD, panel or build-preview code changed. | none |

#### 2. The author's deferral of F1

It does not meet section 7. The clause: "Deferring an always-`patch` finding needs the explicit acceptance of the repository owner (maniator), on top of the evidence and issue above. The PR records it in the owner's own words: a review they submit, or a quote of their message with its date and where they gave it."

- "The owner is fine with deferring it" is the author's paraphrase. It has no quote, no date and no source. Section 7 also says "a comment showing the owner as its author does not prove the acceptance on its own".
- The review's own record says the acceptance "has not been given".
- The "evidence and issue" are also missing. F1 has no tracking issue and no backlog row: the inbox edit covers finding 7 and P1–P4 only.
- The stated reason rests on false premises. The scan runs on every chunk, not only on removal, and each check costs O(U), so it is not cheap.

#### 3. Sign-off

This PR cannot be signed off, and auto-merge cannot be armed.

- `CLAUDE.md`: "On a hot-path diff, signed off also needs the section 6 record … for the final commit on the PR and a completed independent review whose verdict is posted for that commit", and "Do not arm auto-merge before both hold".
- Section 6: "A hot-path PR is signed off only when the record for its final commit is on the PR and its independent review is complete".
- Section 9: "GO also needs every finding fixed or deferred under section 7."
- `CLAUDE.md`: "A PR is not 'done' until the skill has run and its confirmed findings are fixed and re-verified."

None of these holds:
- There is no PR, no Copilot review and no CI run, and the record has not been posted.
- 7028513 cannot be the final commit: six patch findings are still unapplied.
- This verdict is NO-GO.

#### 4. Findings 2 to 6

The author cannot relabel any of these as follow-ups. `CLAUDE.md` says "Fix every `patch` finding".

- **Finding 2 (state check): blocks.** load.rs 1694 reads `completeAt` whatever the unit's state. `finish_construction` clears it only for units in the Construction state (sim_loop.rs 165–181). So a save with a stale numeric `completeAt` ejects every admitted guest on every chunk. The fix is one line: check `u.state != UnitState::Construction`.
- **Finding 3 (guests not counted in): blocks.** The change's stated behavior fails for guests at a full or untenanted venue, because `venue_unit_id` is set only on admission (visits.rs 269–295).
- **Finding 4 (TypeScript parity): blocks on its own.** CONTRIBUTING.md: "every simulation change lands in both engines in one PR with the regenerated lock". `motion.ts` 248–257 is unchanged, and `venueAttendance.integration.test.ts` 232 still says "Dwellers finish their timer".
- **Finding 5 (tests): blocks on its own.** AGENTS.md: "Every bug fix ships a regression test". CONTRIBUTING.md: "An engine PR that adds a branch adds a scenario that reaches it". HP-10 also asks for this evidence.
- **Finding 6 (naming): minor on its merits.** It is still a `patch`, and the skill's step 4 offers no way to defer a patch, so it gets fixed.

#### 5. What the record or triage got wrong

- **HP-8 is recorded as "clear … none (F1 sits under HP-6)".** That is wrong: the new scan bypasses `by_id`, which section 3 defines as an HP-8 finding.
- **HP-7 is recorded as "n/a" while P1–P3 are listed under it.** The Dwelling arm of the ported `step` is rewritten, so HP-7 applies.
- **The auditor's raw reply misapplies a threshold.** It compares 6.07M per chunk with "the section 7 dismiss threshold … about 1,000 visits per step". That threshold is for small collections, counted per occurrence. The conclusion is unaffected.
- **The HP-6 row cites `get_unit` at motion.rs 318 and 328.** Those lines call `get_unit_mut`. This is trivial.
- **P2 is not yet resolved.** The motion.rs 282 clone is not in #1158.
- **Finding 7 has no issue or curated row.** The backlog edit is uncommitted, in `/home/user/verticopolis`, outside 7028513.
- **No layer flagged the missing version bump.** The PR body describes a change a player would notice, so `CLAUDE.md` requires a minor `package.json` bump (lockfile in lockstep). The commit has none.
- **The PR body leaves out how the review ended.** Round 1 stopped at step 4 with 0 of 6 patches applied. A second round is required after the fixes.
- **The commit message contradicts a merge request.** It says "(throwaway proof diff, never merged)".

The record got these right: the tier, the 6.07M and 48.6M figures, the remedy and its HP-10 analysis, and the deferrals of P1, P3 and P4 by reference.
