# Engine package design review handoff, 2026-10-16

Status: planning-only repair complete, mandatory parallel review pending. Recovered from an uncommitted Codex worktree and pushed by the WS-B evidence thread on 2026-10-20.
PR: #1047, existing branch `claude/engine-set-design-985`.
Baseline: `e114ea0d222a15dd13ff54b3b8f17d4cd10cc2da`.
Worktree: `.worktrees/wasm-offline`, local branch `codex/wasm-offline-review`.
Claim: https://github.com/maniator/verticopolis/pull/1047#issuecomment-6222718484

The owner requested planning-only fixes in comment 6219595403. No application,
engine, version, CI or rendering code changes have been made. #985 stays open.

## Existing inline findings and proposed resolution

| Comment | Finding | Updated design section |
| --- | --- | --- |
| 4286018917 | Validate served file entries, even when the package string is preserved | 5.3 steps 4 and 5: strict fields, canonical digest and actual byte comparison |
| 4286018929 | Bound BUILD.json before buffering | 5.3 step 3: fixed 16 KiB stream cap, header-independent counting and cancellation |
| 4286018939 | Late import/init after timeout | 5.3: terminal attempt/deadline guards, late-result disposal, no publication or host attachment; already-started initialization cannot be cancelled |
| 4286018949 | HTTP 404 versus malformed record classification | 5.3: HTTP failure is load-failed; invalid successful response is mismatch |
| 4286018957 | Repair an existing corrupt cache without a newer worker | 5.4: explicit online repair deletes only engine precache keys and preserves saves; no promise Reload alone repairs corruption |
| 4286018963 | Missing browser eviction proof | 6.2 spec 7: same-build refill, offline refusal, reconnect recovery, changed-deploy refusal and whole-precache loss |
| 4286018969 | Incomplete CI filters | 7: correctness offline job runs on every PR and main push without path filtering |
| 4286026728 | Unsupported backlog type | This PR no longer adds a #1046 row. The Phase 2 plan PR (#1080) restores it as `design-decision` |
| 4296755130 | Policy for all reasons and both builds | 5.4: complete reason/copy/retry matrix, including existing save-writer compatibility policy |
| 4296755138 | First install differs from an update race | 6.2 spec 9: fresh registration, no controller, no mismatched cached bytes, partial-cache allowance and later offline recovery |

The HTTP fixture server replaces speculative browser routing of worker
requests. Every response snapshots its deployment root on arrival.

## Mandatory review inputs

Run the actual `bmad-code-review` workflow on #1047, covering the design and
backlog diff. The skill/defaults, config, project context and CLAUDE.md were
read; there are no team/user code-review overrides. The Python resolver could
not start through WindowsApps, so its documented manual merge fallback was
used. There are no prepend/append activation steps or on_complete action.

Prepared repair diff: `offline-design-review-input.diff` beside this file
(local handoff input, regenerate if the patch changes). Review mode: full.
Acceptance context: #985 criterion 5 and release-blocker rule, owner comment
6219595403, the ten inline findings above, and the design's section 10 owner
decisions. The design is the spec itself, so this review must not require
implementation or claim that offline proof already exists.

The team's four concurrent implementation slots were occupied. The lead
will free slots and run the three prescribed layers with fresh contexts:
Blind Hunter invokes `bmad-review-adversarial-general` with diff only;
Edge Hunter invokes `bmad-review-edge-case-hunter` with diff and project read
access; Acceptance Auditor receives diff and the stated acceptance context.
Triage and fix every patch finding before pushing. No deep-review completion
is claimed at this checkpoint. No review thread has been resolved yet.

## Related issue audit and next work

- #985: #993, #1004, #1037 and #1038 merged earlier offline/audio coverage.
  #1047 covers only the approved criterion-5 design. Implementation, corrupt
  cache and eviction proof remain required. Performance startup measurement
  belongs to the separate performance session, coordinated by the lead.
- #963: open, no issue comments/claims, no web implementation PR found in
  its timeline or diagnostics PR search, and no matching branch in the full
  GitHub branch inventory. Main lacks diagnostics.ts. #1058 and #1059 refer
  to a prior review that appears unpublished. Coordinate engine identity API
  ownership before implementing UI diagnostics. Lead owns #1059.
- #1058: deferred worker identity support; depends on #963 identity schema
  and diagnostics plumbing. Experimental worker is measurement-only today.
- #880: current packageHash.ts already ignores dotfiles, backups, symlinks
  and nested build output, with existing tests. Raw file bytes still change
  the hash on CRLF conversion and no .gitattributes pins LF. Remaining fix
  needs a CRLF regression test while preserving binary include bytes. This
  issue has not been claimed by this workstream.
- #978: current hash explicitly documents unsupported out-of-crate path
  modules, Cargo path dependencies and external build-script reads. Current
  Cargo manifest has no path dependencies and there is no build.rs. The issue
  remains an open conditional follow-up, not evidence of a current stale
  package. This workstream has not claimed or modified it.

## Validation and continuation

`git diff --check` passed after the design repair. The focused backlog mirror
test passed all five tests (Vitest unit project). Its first sandbox run failed
before test collection on an EPERM temporary-file rename; an escalated rerun
passed in 10.51 seconds. No
runtime test, offline proof, release readiness, merge or performance sign-off
is claimed for this planning-only change.

Continue by reviewing the full PR against current main, triaging all layers,
then pushing the existing PR branch without rewriting unrelated commits.
Reply to and resolve addressed threads, re-request Copilot/Codex, and inspect
checks on the exact new head. Keep #985 open until implementation and CI proof
merge. Do not modify rendering PRs #817, #831 or #1039, or publish 3.0.0.
