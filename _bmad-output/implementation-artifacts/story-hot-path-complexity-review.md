---
story: hot-path-complexity-review
status: in-progress
issue: 1158
refs: 1051, 1139, 1143
---

# Story: a hot-path complexity review that would have caught the Rust port's scans

## Why

The repository already had a mandatory hot-path rule (CONTRIBUTING.md, Code
review; project-context.md, Performance). The Rust port (#857) still shipped
per-person and per-step scans of every unit in the tower, and dropped three
TypeScript memos that predate it (`roomUnits` from #852, the noise memo from
#403, and the staff ceiling from #469). Profiling found them in #1051 and
#1139, after review had passed them. On the large perf tower (43,358 units,
40,458 of them floor and lobby tiles) `pick_x` alone walked every unit for each
spawned person, and on the owner's Modern save `max_staff_for` still took about
a quarter of the bare step after #1139 (cloud profile at ab49f86, 2026-10-20).

The rule missed them for reasons the text itself explains:

- It named only TypeScript idioms (`.find` / `.filter` / `.some`). A Rust
  `iter().filter().count()` inside a helper did not match.
- It asked for "new" nested scans. A port re-adds every line, but reviewers read
  a faithful port of an existing algorithm as "not new".
- It looked at syntactic nesting in the diff. The scans sat inside helpers
  (`max_staff_for`, `room_units`, `pick_x`), a few calls below the loops that
  multiplied them, so nothing in the diff showed the per-person multiplier, and
  the diff-only layer (Blind Hunter) has no project access by design.
- Nothing asked the reviewer to compare against the TypeScript's existing
  optimizations. A Rust comment recorded the noise memo as skipped ("the
  TypeScript memo is pure") and no review challenged it.
- A cost finding could be deferred without a measurement (#859 went to P3 with
  "parity unaffected").
- The review skills carried no performance layer and no per-item record, so a
  review could "apply" the rule by mentioning it.

## Acceptance criteria

1. **AC1 One canonical checklist.** `docs/performance/hot-path-review.md` holds
   the checklist. Every other doc links to it and keeps at most a short summary.
2. **AC2 Scope.** The checklist applies to Rust, TypeScript, the WASM binding,
   the worker and main-thread hosts, simulation ticks and rendering, and to
   ports and rewrites of any of them.
3. **AC3 Inherited code.** Ported or rewritten code is reviewed as new code.
   "Same algorithm as before" and "no new regression" are not passing answers.
4. **AC4 Transitive call paths.** The reviewer names each changed function's
   callers up to a hot entry point and records the effective multiplier.
5. **AC5 Scans and idioms.** The checklist names full-collection scans inside
   per-person, per-unit, per-floor, per-transport, per-tick and per-frame
   work, and lists the Rust idioms (iterators, `position`, `contains`,
   `collect`, clones, sorts, map construction, default hashing) next to the
   TypeScript ones.
6. **AC6 Remedies.** Indexing, loop hoisting, incremental counters,
   revision-keyed caches and borrowed views are listed as the expected fixes.
7. **AC7 TypeScript comparison.** Before porting, the TypeScript memos and
   indexes for the function and its callees are listed and ported, or replaced
   by a named Rust structure that answers the same query at the same cost or
   less; anything else is a finding (tightened in the follow-up, F3).
8. **AC8 PR complexity note.** Significant engine changes carry collection
   sizes, call frequency, complexity before and after, and the justification
   for any remaining repeated scan. The PR template asks for it.
9. **AC9 Guardrails.** Optimizations keep iteration order, RNG consumption,
   event order, gameplay parity and save bytes. Cache invalidation covers
   structural edits, loads and every non-structural input.
10. **AC10 Resolution.** A hot-path finding is fixed or deferred with evidence
    and a tracked issue. "It existed before" never dismisses it.
11. **AC11 Enforced in the review skills.** `/gds-code-review` and
    `/bmad-code-review` load the checklist through team overrides in
    `_bmad/custom/`, run a Hot-Path Auditor layer with project access when the
    diff touches a hot-path surface, and print a per-item record. The Copilot
    overlay and the engine parity skill carry the same requirement. The
    independent reviewer's verdict requires the record.
12. **AC12 Audit issue.** A GitHub issue, linked to #1051 and #1139,
    inventories the Rust engine and host hot paths with location, frequency,
    sizes, complexity, TypeScript behavior, evidence, proposed fix, risks,
    priority and owner, plus how each finding got past review. It is an
    inventory only: fixes go in their own issues and PRs. A backlog row mirrors
    it.
13. **AC13 Checked against the sweep.** Every audit finding maps to a
    checklist item that would have caught it. A finding no item catches means
    the checklist must change until it catches it.

## Constraints

- Docs and review tooling only: no engine code, no version bump (nothing a
  player notices).
- Does not touch PR #1139, the PC benchmark, the 3.0 release gates or the
  engine-flip authorization. For the PRs open when the page merged, the owner's
  decision of 2026-10-20, 20:16 UTC (quoted on #1168) applies: #1139 keeps its
  independent review's GO at 3fa30a8c for the code it covered, #1092, #1157
  and #1068 get a proportional review, and every other PR gets the checklist
  on its next review.
- No closing keywords for #1051, #1139 or #1143.

## Files

- New: `docs/performance/hot-path-review.md`, `_bmad/custom/gds-code-review.toml`,
  `_bmad/custom/bmad-code-review.toml`, `_bmad/custom/gds-quick-dev.toml`,
  `_bmad/custom/bmad-quick-dev.toml`, `src/tests/hotPathReview.guard.test.ts`
  with `src/tests/hotPathReview.rules.ts` (pins the page's sections, section 1
  surfaces, record rows and the clauses the overrides cite, the overrides and
  the step anchors they name, and the `CLAUDE.md` auto-merge rule, and runs the
  resolver; for the other summaries it checks only their links), this story,
  and the proof
  records `hot-path-auditor-proof-2026-10-20.md` and
  `hot-path-auditor-proof-nested-scan-2026-10-20.md`.
- Updated (short summary plus link): `CLAUDE.md`, `AGENTS.md`,
  `CONTRIBUTING.md`, `_bmad-output/project-context.md`,
  `.github/copilot-instructions.md`, `.github/skills/engine-parity-review/SKILL.md`,
  `.github/PULL_REQUEST_TEMPLATE.md`, `_bmad-output/implementation-artifacts/backlog.md`
  (rows for #1158 and #1143, which had none, and in the follow-up for #1166
  and #1170).

## Out of scope

- Any engine optimization. The audit issue lists them; #1143 already tracks the
  three largest after #1139.
- Editing the installer-owned skill files under `.claude/skills/` and
  `.agents/skills/` (they are regenerated on install; the team override is the
  supported hook).

## Review record

**Round 1, `/gds-code-review`** (Blind Hunter, Edge Case Hunter, Acceptance
Auditor; the hot-path gate found no hot-path surface in this diff, so no
Hot-Path Auditor). About 40 findings after deduplication: two dismissed (listed
at the end of this round), the rest `patch`, all applied; no `defer`, no
`decision_needed`. The main ones:

- Facts: the large tower has 40,458 floor and lobby tiles and 2,900 rooms
  (measured), steps are 1 to 20 game minutes (`quantumFor`), the Rust entry
  point is `Simulation::advance_step`, and the public id accessors are
  `get_unit` / `get_transport`.
- Skill hooks: the gate ran as an activation step before any diff existed,
  the step numbers collided with SKILL.md's activation steps, and nothing
  covered the subagent fallback, the auditor's Markdown output, the
  always-patch rule in triage, or a failed auditor at the status update. The
  hooks now name the step files and cover each case, and
  `src/tests/hotPathReview.guard.test.ts` runs the resolver and fails if the
  hooks or the page's sections drift.
- Scope: the trigger list missed per-frame and periodic code (analytics,
  audio, autosave, the engine build profile), the auditor prompt traced callers
  only inside the engines, and route searches were not named as walks.
- Rules: HP-2 now gives one budget per tier, the multiplier list lives only in
  HP-2, "bounded and small" needs a written estimate and a threshold, a finding
  an open issue already lists is deferred by reference, and an owner-accepted
  deferral of an always-patch finding is `decision_needed`.
- Enforcement: the independent reviewer, Copilot and Codex are named in the
  summaries, and a review of a hot-path diff without the record gives no GO
  and no sign-off.
- Records: the HP-8 table gained the id indexes, the staff counter, the
  per-pass caches and a Rust status column; #1143 gained the backlog row it
  lacked; #1158 gained risks and missing fields on every finding and two
  corrected item mappings (A9, A19).
- Prose: two "X, not Y" sentences rewritten, and the summaries trimmed.

Dismissed: the TOML merge replacing base facts (the resolver appends; checked
on all four skill copies), and a CI check that scans review comments for the
record (the sign-off rule in `CLAUDE.md` covers it without new tooling).

**Round 2, `/bmad-code-review`** (Blind Hunter, Edge Case Hunter, Acceptance
Auditor on the fixed diff; no hot-path surface, so no Hot-Path Auditor). 27
findings after deduplication, all `patch` and all applied; none deferred or
dismissed. The main ones:

- Rules that disagreed: section 7's false-positive threshold now matches the
  HP-2 tier budgets, and HP-2 gained a wall-clock budget; the always-`patch`
  rule covers moved code and wins over defer by reference, which needs an open
  issue that already has a backlog row; HP-10 and the HP-8 table now agree on
  `demandMemo` and on where a cache resets on load; HP-5 limits container swaps
  to maps that are never iterated.
- Scope: section 1 names the app shell (`src/main.ts` and the root modules the
  frame loop imports) and leaves tests out; HP-11 covers the engine build;
  HP-2 adds per segment and per car; drawn people include housekeepers, who
  skip `MAX_PEOPLE`; HP-8 gained the tile indexes and the car riders counter.
- Process: a PR opened before the page merged keeps its review; the owner and
  where their acceptance is recorded are named; Copilot and Codex are asked for
  the record, and a hot-path sign-off needs a record on the PR from the skill or
  the independent reviewer; `AGENTS.md` gained the `## Review guidelines`
  section Codex reads; the quick-dev skills gained overrides that keep a
  hot-path finding out of `reject` and send the change to the deep review.
- Hooks: an auditor reply without the full table now counts as a failed layer
  at step 2, so step 3 cannot announce a clean review; the gate searches the
  importers of changed files outside the table; the overrides cite each section
  by number and name, and the guard test checks every cite, every fact, the
  auditor prompt and the step-file anchors, and fails in CI instead of skipping
  when Python lacks `tomllib`.
- Summaries: `CLAUDE.md`, `CONTRIBUTING.md`, the Copilot overlay and the PR
  template now match the page's scope, tiers, significance rule and the layer
  order; section 8 is retitled for what it lists.

**After merge.** #1163 merged by auto-merge at 19:49Z (6761fcf), before round 3
and the independent review finished. The rest went into a follow-up PR.

**Round 3, `/bmad-code-review`** (confirming pass on 08e2a11; no hot-path
surface, so no Hot-Path Auditor). About 21 findings, all `patch`, applied in
the follow-up; none deferred. The main ones:

- Scope: section 1 names the test files that are not hot paths (Rust
  `*_tests.rs` and `#[cfg(test)]` included) and counts code a PR removes;
  section 2 maps the TypeScript entry points and says "per tick" means per
  step; the 26% figure is labeled a cloud estimate.
- Rules: HP-2's wall-clock budget names the HUD, audio and autosave;
  section 5's "significant" covers wall-clock paths and cache changes;
  section 7's always-`patch` rule covers rewrites, and owner acceptance is
  recorded on the PR in spec and no-spec mode alike.
- Hooks: the triage fact sends a non-owner's wish to defer an always-`patch`
  finding back to `patch`, the record fact posts the record on the PR, the gate
  ignores test files, and the quick-dev facts cover the one-shot route.
- Guard: CRLF and TOML comments no longer fool it, the cite regex takes
  two-digit sections, each fact must carry the words that make it bite, and
  the auditor prompt is read across its wrapped lines.

**Independent review after merge** (review 5590890213 on #1163, CONDITIONAL GO
at 08e2a11, follow-ups F1 to F10). All ten are in the follow-up:

- F1: whoever runs the review skill posts the record on the PR at step 4 of
  every round and edits it once the fixes are in; the independent reviewer
  puts its table in each verdict. Per the owner's decision, a hot-path PR is
  signed off only when the record for its final commit and a posted
  independent verdict are both on the PR. A reviewer still running has not
  finished, so auto-merge stays off (`CLAUDE.md`).
- F2: the owner decided the scope at 20:16 UTC (quoted on #1168): #1139 keeps
  its GO at 3fa30a8c for the code that review covered, a docs-only results
  commit does not restart it, and new hot-path changes on it are reviewed;
  #1092, #1157 and #1068 get a review in proportion to what they change, with
  no invented findings and no unrelated refactoring; no other PR is exempt.
- F3: HP-8 no longer lets a sentence in the PR excuse a dropped cache, and it
  covers removing or bypassing a cache outside a port. A cache may go only
  when a named structure replaces it or every caller goes with it (as the
  TypeScript engine's retirement will). The engine parity skill and AC7 say
  the same.
- F4: a move changes only where code lives (identical lines apart from
  visibility, imports and module paths); its findings count as pre-existing,
  and any other change to a moved function makes it a rewrite.
- F5: a port, rewrite or addition over about 1,000 hot-path lines gets a
  per-function appendix and one auditor per chunk, each given the whole diff
  for context; the overrides ask for the appendix, and a missing one is a
  failed layer.
- F6: a pass counts items times work per item, per occurrence of its tier,
  never averaged. Small collections (floors, shafts, links, the drawn crowd)
  fit any tier under about 1,000 visits per occurrence; one per-step pass over
  rooms (about 2,900) needs a stated reason; an hourly, daily or per-command
  pass may reach about 50,000, roughly one linear pass over the large tower's
  units. A pass HP-2 rules out at its tier is a finding whatever its count.
- F7: the triage fact overrides step 3's no-spec reclassification and its
  narrow `defer` definition for hot-path findings, and no step 4 choice can
  drop an always-`patch` finding without the owner. On both quick-dev routes
  an author's wish to defer one stops for the owner without reverting code.
- F8: the guard pins section 1's surfaces, paths and not-hot-path list, the
  clauses of section 1, HP-2, HP-8 and sections 6 and 7 the overrides cite,
  the auditor prompt as one blockquote, each override fact once inside
  `persistent_facts` with its load-bearing phrases, `on_complete`, the
  activation step, and the gds and bmad twins. Round 4's 22 mutations all
  fail it.
- F9: the owner of #1158 (its assignee, the maintainer) owns the HP-8 table
  between PRs. #1139 merged at 9cd44d1 while this follow-up was open, so the
  follow-up brings the table to that commit: `roomUnits` and `noiseMemo` are
  ported (`room_index`, `noise_memo`), a Rust-only row names
  `structural_tiles`, and #1158 marks A5 to A7 as landed.
- F10: the summaries name rewrites, point the Copilot overlay at section 1, drop
  the undated sizes from `project-context.md`, show all section 5 fields in the
  template, and ask Copilot to report findings for resolution.

**Round 4** (`/bmad-code-review` of the follow-up at e501606; Blind Hunter,
Edge Case Hunter and Acceptance Auditor). About 50 findings after
deduplication, all `patch` except four dismissed: TOML forms the guard
cannot read (multi-line and literal strings, inline arrays) and the bmad
step file's `decision-needed` spelling, which fail the guard loudly; and the
gds one-shot route's missing On Complete section, which the quick-dev fact
covers. The patches are the round 4 parts of F1 to F9 above, plus: the gate
runs on the whole diff before step 1 narrows it, searches a deleted file's
importers at the base, and reads the not-hot-path list from section 1; the
auditor reads the repository at the diff's head commit and is re-run once
before it counts as failed; a record made before the PR exists is saved and
posted when it opens, and a "no hot-path surface" line counts only for the
whole diff; owner acceptance must be in the owner's own words, since agents
post with the owner's account; the summaries and the story match the page;
and the first proof record now quotes the checkpoint and the auditor's reply
verbatim and labels its defers correctly.

**Proof run: a real hot-path review launches the auditor.** `/gds-code-review`
on a2d2cf8 (#1083, an engine commit touching `engine-rs/src/crowd/mod.rs`,
`engine-rs/src/wasm.rs` and `src/dualrun/`), with the merged overrides. The
gate said yes at the step 1 checkpoint and the Hot-Path Auditor ran beside the
Blind Hunter and the Edge Case Hunter, returning all twelve rows. Record and
triage: `hot-path-auditor-proof-2026-10-20.md`.

**Proof run 2: a planted nested scan is caught and blocks a GO.** A fresh
agent, told nothing about hot paths, ran `/gds-code-review` on a throwaway
local commit (7028513, never pushed) that adds a walk over every unit for each
dwelling guest in each motion chunk. The gate said yes, and the Hot-Path
Auditor found the scan with its tier, its estimate (about 6.07M unit visits
per chunk on the large tower) and the fix, classed always `patch`. Asked as
the author to defer it, the run held it for the owner. An independent verdict,
given the record and an author's request for a GO that paraphrased the
owner's consent, returned NO-GO under sections 6 and 7. That agent could not
start agents of its own, so the layers ran from the skill's fallback prompt
files in fresh agents. The verdict found the record had filed the scan under
HP-6 only and marked HP-7 n/a, so the auditor prompt now asks for each finding
in every row it falls under. The station `Unit` clone it found on `main` is
now #1158 A27. Record: `hot-path-auditor-proof-nested-scan-2026-10-20.md`.

**Round 5** (`/bmad-code-review` of the follow-up at 26a7653, after #1139 and
#1157 merged; Blind Hunter, Edge Case Hunter and Acceptance Auditor; the diff
touches no hot-path surface). About 55 findings before deduplication.
Dismissed: bare section cites (the guard pins the numbered headings),
`{implementation_artifacts}` being undefined (both configs define it),
pinning the exact fact count, harmless edits that fail the guard loudly, and a
merge of `main` changing the PR's callers (the PR that changes them reviews
them). The patches:
- sign-off names the independent reviewer, who is not Copilot or Codex, and
  needs a GO, or a CONDITIONAL GO whose conditions are met, on the final
  commit; a record and a verdict carry to a later commit only when the PR's
  own diff is unchanged and that reviewer confirms it on the PR;
- `CLAUDE.md` keeps auto-merge off on any PR, hot-path or not, while an
  independent review or a review-skill round is requested or running, which
  is the #1163 race;
- an always-`patch` finding the author wants deferred stays `patch`, pending
  the owner, in every mode, and the owner's acceptance is a quote of their own
  message that the independent reviewer checks against its source; an
  acceptance another agent relays counts only as that quote;
- the gate leaves once-per-session code to the auditor; the auditor's prompt
  gets the head commit, it reads the working tree for an uncommitted diff, a
  bare row, an unexplained n/a or a timeout counts as a failed layer, and a
  chunk auditor gets the list of changed files and functions;
- a hot-path defer needs an issue and a curated row in both skills, and
  quick-dev halts before acting on other findings;
- section 1 adds `vite.config.ts` and later toolchain files, a move allows
  formatting changes but not a changed path inside a body, chunks per step
  allow for a 30-minute `tick` sub-step, a visit is defined, and the HP-8
  table adds the housekeeping crew-order memo, `remove_unit`'s scan and the
  cost of a clone on read;
- the summaries name moves and cache removal outside a port, the template
  asks for the cache comparison and a link to the record, #1170 adds saves and
  the per-day and per-command tiers, and #1158 adds A27;
- the guard pins the new clauses, the record rows inside section 6, the
  not-hot-path list's bounds, an empty base `on_complete`, no prepend step and
  the `CLAUDE.md` rule.
