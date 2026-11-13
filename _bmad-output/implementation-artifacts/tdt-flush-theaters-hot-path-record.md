# Hot-Path Auditor record: flush theaters through a .TDT round trip

- Branch `claude/project-thread-66a3aq-2070`, against `origin/main` `cf91737`.
  Commit reviewed: `2e98a52` (the only commit with production code; the
  other commits on the branch add tests, the change note, this record and a
  backlog row). Part covered: the whole diff. No PR existed when the review
  ran, so whoever opens it posts this record there and links it from the
  template's Complexity section.
- Hot-path surface in the diff: `engine-rs/src/tdt/part_merge.rs`
  (`same_building` rewritten, `screen_beside_auditorium` added). Everything
  else in the diff is outside section 1: Rust tests
  (`engine-rs/src/tdt/theater_flush_tests.rs`, the `#[cfg(test)]` module of
  `part_merge.rs`, `engine-rs/tests/tdt_real_saves.rs`), the TypeScript
  integration test, the conformance lock and compat record, docs, the backlog
  and the change note. About 20 changed lines of hot-path code, so no appendix.
- Review run: `/gds-code-review`, one lean pass (Blind Hunter, Edge Case
  Hunter, Acceptance Auditor, Hot-Path Auditor) by the implementing agent.

## Section 6 table

| Item | Result | What was checked | Findings and resolution |
| --- | --- | --- | --- |
| HP-1 | clear | `screen_beside_auditorium` and `same_building` are called only from `components` (`part_merge.rs`), which `merge_parts` calls once per family and once per floor-window group; `merge_parts` is called only by `parse_tdt` (`tdt/parse.rs`), reached from `import_tdt` and the engine's `.TDT` load (`loadTdt` in the WASM binding). Tier: per command (a load), once per import. Loops in between: the pair loop over a family's parts in `components`. No per-frame, per-step, per-chunk or per-hour caller. | none |
| HP-2 | finding (1) | The predicate is constant work per pair (four integer compares and two type checks), the same order as before. The pair loop around it is O(n^2) over one family's parts. A game-written file holds at most 16 theaters (`build_cap` for `Kind::Cinema`), so at most 64 theater pieces and about 2,000 pair checks per import. A forged file can hold 256 tenants per floor, so the inherited pair loop is superlinear on hostile input. | F1 (pre-existing, inherited: the part merge is O(n^2) on a forged file, in code this PR changes only inside the predicate). Defer, pending a tracking issue: #884 (backlog row `tdt-lock-boundary-cases`) recorded it but was closed as completed on 2026-10-28 while its row still reads `open`, so it no longer tracks the item. Whoever opens the PR files a perf issue for it and adds a curated backlog row with that number (and trues up the `tdt-lock-boundary-cases` row) before merge, per section 7. Estimate: a forged file of 120 floors at 256 theater tenants each is about 30,700 parts and 4.7e8 pair checks in one import; a game-written file is about 2,000. |
| HP-3 | clear | No allocation added: the new helper takes two `&PartRecord` and returns a bool; `same_building` builds nothing. The existing `Vec`/`IndexMap` in `components` and `merge_parts` are unchanged. | none |
| HP-4 | n/a | The diff adds no sort; the existing `sort_by_key` per cluster in `merge_parts` is untouched. | none |
| HP-5 | clear | No container added or changed; `components` still groups with `IndexMap` (insertion order, deterministic). | none |
| HP-6 | n/a | No id lookup or removal in the changed code; it compares part records in place. | none |
| HP-7 | finding (1) | The rewritten predicate was reviewed as new; the inherited union-find pair loop it sits in is F1. | F1, deferred as above (tracking issue pending). |
| HP-8 | n/a | Not a port: the TypeScript `mergeParts` was deleted with the TypeScript engine (#1875); no cache, index or counter existed on this path in either engine, and none is dropped. | none |
| HP-9 | clear | F1's remedy: sort each family's parts by floor and left edge and union only neighbors in a sweep (overlaps within the story window, and the screen-to-auditorium edge match), which makes the pass O(n log n). | none |
| HP-10 | clear | Results checked unchanged where they should be: the nine real saves import the same theaters (`each_theater_arrives_whole_from_its_screen_and_auditorium_pieces`, plus every other real-save test), all 107 export cases and 174 of 175 import cases in `conformance/tdt-cases.json` replay unchanged, and the one moved case (`theatre-whole`, whose input now has its screens on the left as real saves do) was compared field by field with its old output: only the file-derived `seed` differs. Iteration order stays `IndexMap` insertion order, so the result is deterministic. | none |
| HP-11 | n/a | No WASM binding, host or build file changed; `engine.d.ts` and `compat-record.json`'s interface digest are unchanged (only `lockDigest` moved). | none |
| HP-12 | n/a | No rendering, frame loop or UI refresh code changed. | none |

## Other layers (triage)

- patch, fixed: the finished backlog row kept `#738` in its `GH` cell, which
  `src/tests/backlogIssueMirror.test.ts` rejects for a `done` row; the cell is
  now the placeholder and the note says the PR closes #738.
- patch, fixed before commit: the brief's count of 40 screen pieces in the
  real saves is 48 (24 theaters); the code comment, canon doc and backlog
  note say 48.
- dismissed: a lone screen piece with an auditorium only on its left now
  imports as two cinemas (7 and 24 wide) where it used to merge. No real save
  and no export of ours writes that layout, and the frozen `theatre-whole`
  case that did was synthetic; it now carries the real layout.
- dismissed: the TypeScript integration test sits in a ratcheted oversized
  file; the edit is net one line, and the new flush cases live in Rust.
- Confirming pass over the fixed diff: no new finding.
