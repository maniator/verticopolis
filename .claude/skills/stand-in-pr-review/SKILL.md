---
name: stand-in-pr-review
description: 'Pull request review run the way the Copilot review runs on this repo. Any Claude thread or agent reviewing a PR runs it whenever Copilot review is down (rate-limited, errored, never started), in addition to gds-code-review or bmad-code-review, never instead of them. Also use when asked to stand in for Copilot, to give a GO on a PR, or to review a PR "like Copilot would". Copilot itself follows .github/copilot-instructions.md and does not load this skill.'
---

# Stand-in PR review

Copilot's review here follows `.github/copilot-instructions.md`. Its Action
logs show how it runs that method: it builds the head, reads the instruction
files, has three reviewers pass over the diff with a review skill each, and
then a final pass votes on their findings and checks the earlier threads. This
skill repeats that shape in one session, so a stand-in review finds the same
kinds of problems and reads the same way on the PR.

`CLAUDE.md` and `AGENTS.md` say when it runs: whenever Copilot's review is
down, every reviewer runs it alongside the BMGD/BMAD review skill
(`gds-code-review` or `bmad-code-review`). That skill's run still owns the
`patch` and `defer` triage and the backlog rows; this one adds the Copilot
shape and the way the review is reported on the PR. It adds no rules of its
own. `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md` and
`docs/performance/hot-path-review.md` still decide what is required, and the
merge rules (who arms, when) stay where they are.

## 1. Gather

1. Review the PR's exact head commit, by SHA. Read `CLAUDE.md`, `AGENTS.md`
   and `.github/copilot-instructions.md` if they are not already loaded.
2. Read two diffs: the full diff from the merge base, and, on a re-review, the
   diff from the head your last verdict named. Read the second one first.
3. Read the PR body, the commit list (`pulls/<n>/commits`) and every review
   thread, resolved or not.

## 2. Load the review skill

Use the rule in steps 1 and 2 of `.github/copilot-instructions.md`:
`gds-code-review` for gameplay and engine paths, `bmad-code-review` for the
rest, gds for a mixed diff, and `engine-parity-review` as a checklist on top
when the diff touches `src/engine/`, `engine-rs/`, `conformance/` or the save
loaders. Run its three lenses yourself: Blind Hunter on the diff alone, Edge
Case Hunter with the repository open, and Acceptance Auditor against the PR
body and its issue. If you already ran that skill on this head commit, reuse
its lens output here rather than running it a second time.

## 3. Vote on findings

Treat the three lenses as three reviewers. The vote decides only which
findings get their own inline comment, the way Copilot's do. Post a high
finding (a wrong result, a crash, lost data, a save or canon break) inline
when any one lens raises it, and a low or medium finding inline when at least
two lenses would raise it. Mention the rest once in the summary as optional.

The vote never drops a required fix. Every `patch` and `defer` from the
BMGD/BMAD triage is still reported on the PR, inline or listed in the review
summary, whatever its vote count, since `CLAUDE.md` requires every `patch`
fixed and every `defer` recorded.

## 4. Check what Copilot most often catches here

- The PR body, a CHANGELOG line or a doc comment describes behavior the code
  does not have, or a claim has no test that would fail without it.
- Text that disagrees with a sibling doc, an earlier summary or the code.
- A new allocation or rebuild on a frequent path (per frame, per tick, on a
  cache miss).
- Behavior that rests on incidental order, such as object key order.
- A fixture that builds a tower without asserting that each placement worked.
- A scan or wait loop that keeps going after it has what it needs.
- A newer CSS or web feature with no fallback line.
- A TypeScript leg and a Rust leg that accept or refuse different inputs.
- Readability rules from `CLAUDE.md`: named flags, no new em-dashes, American
  English.

## 5. Hot path

If the diff touches any section 1 surface of
`docs/performance/hot-path-review.md`, print the section 6 table for the
reviewed commit, one row per HP item, each finding marked `patch` or `defer`.
This table is the independent reviewer's record. A one-line "no hot-path
surface" note from the author does not replace it when a surface is touched.

## 6. Report on the PR

1. Post each finding as an inline review comment on its line. Give its
   severity, the failure it leads to and a concrete fix. Submit them together
   as one review on the exact head commit.
2. On a later head, check each earlier thread against the new code before
   calling it fixed. Resolve a thread only when the fix is in the code.
3. Check the history (logical commits, no fixup or merge-from-main commits)
   and the version, as `CLAUDE.md` and CONTRIBUTING.md (Versioning) set it: a
   player-facing change takes the next app version above `main`'s just before
   merge, internal-only work takes none, and an engine contract change (the
   binding, the save, frame layout or catalog, the conformance lock) also
   raises the crate version in `engine-rs/Cargo.toml` and both lockfiles,
   checked with `npm run engine:compat`.
4. End with a verdict that names the head SHA: GO, CONDITIONAL GO with each
   condition listed, or NO-GO. Then the closing line
   `Reviewed against Verticopolis conventions (.github/copilot-instructions.md).`
