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
   indexes for the function and its callees are listed and ported, or the PR
   says why not.
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
  engine-flip authorization.
- No closing keywords for #1051, #1139 or #1143.

## Files

- New: `docs/performance/hot-path-review.md`, `_bmad/custom/gds-code-review.toml`,
  `_bmad/custom/bmad-code-review.toml`, `src/tests/hotPathReview.guard.test.ts`
  (keeps the page's sections, the overrides and the summaries in step, and
  runs the resolver), this story.
- Updated (short summary plus link): `CLAUDE.md`, `AGENTS.md`,
  `CONTRIBUTING.md`, `_bmad-output/project-context.md`,
  `.github/copilot-instructions.md`, `.github/skills/engine-parity-review/SKILL.md`,
  `.github/PULL_REQUEST_TEMPLATE.md`, `_bmad-output/implementation-artifacts/backlog.md`
  (rows for #1158 and for #1143, which had none).

## Out of scope

- Any engine optimization. The audit issue lists them; #1143 already tracks the
  three largest after #1139.
- Editing the installer-owned skill files under `.claude/skills/` and
  `.agents/skills/` (they are regenerated on install; the team override is the
  supported hook).

## Review record

**Round 1, `/gds-code-review`** (Blind Hunter, Edge Case Hunter, Acceptance
Auditor; the hot-path gate found no hot-path surface in this diff, so no
Hot-Path Auditor). About 40 findings after deduplication, all `patch` and all
applied; no `defer`, no `decision_needed`. The main ones:

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
