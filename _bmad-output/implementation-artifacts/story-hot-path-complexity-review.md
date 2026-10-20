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
#1139; review did not. On the large perf tower (43,358 units, about 38,000 of
them floor and lobby tiles) `pick_x` alone walked every unit for each spawned
person, and on the owner's Modern save `max_staff_for` still takes about a
quarter of the bare step after #1139.

The rule missed them for reasons the text itself explains:

- It named only TypeScript idioms (`.find` / `.filter` / `.some`). A Rust
  `iter().filter().count()` inside a helper did not match.
- It asked for "new" nested scans. A port re-adds every line, but reviewers read
  a faithful port of an existing algorithm as "not new".
- It looked at syntactic nesting in the diff. The scans sat inside helpers
  (`max_staff_for`, `room_units`, `pick_x`), called from loops in other files,
  so the per-person multiplier was invisible to a diff-only layer (Blind
  Hunter has no project access by design).
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
    the checklist changes, not the finding.

## Constraints

- Docs and review tooling only: no engine code, no version bump (nothing a
  player notices).
- Does not touch PR #1139, the PC benchmark, the 3.0 release gates or the
  engine-flip authorization.
- No closing keywords for #1051, #1139 or #1143.

## Files

- New: `docs/performance/hot-path-review.md`, `_bmad/custom/gds-code-review.toml`,
  `_bmad/custom/bmad-code-review.toml`, this story.
- Updated (short summary plus link): `CLAUDE.md`, `AGENTS.md`,
  `CONTRIBUTING.md`, `_bmad-output/project-context.md`,
  `.github/copilot-instructions.md`, `.github/skills/engine-parity-review/SKILL.md`,
  `.github/PULL_REQUEST_TEMPLATE.md`, `_bmad-output/implementation-artifacts/backlog.md`.

## Out of scope

- Any engine optimization. The audit issue lists them; #1143 already tracks the
  three largest after #1139.
- Editing the installer-owned skill files under `.claude/skills/` and
  `.agents/skills/` (they are regenerated on install; the team override is the
  supported hook).
