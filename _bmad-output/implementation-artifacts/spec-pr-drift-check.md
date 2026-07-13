---
title: 'Screenshot drift-check on pull requests (approval-gated)'
type: 'chore'
created: '2026-07-13'
status: 'done'
baseline_commit: 'bcbe217'
context: ['{project-root}/_bmad-output/implementation-artifacts/backlog.md']
---

<frozen-after-approval reason="human-owned intent: do not modify unless human renegotiates">

## Intent

**Problem:** The screenshot determinism guard only runs when someone deliberately regenerates the gallery (`update-screenshots.yml`, marker push). A PR that adds a wall-clock read to the engine render path can merge green and only surface churn on the next nightly regen: exactly the leak PR #188 chased. And when a PR legitimately changes pixels, the author must remember to do a separate marker push to refresh the committed set. Sharding (PR #198) made a full two-run generation cheap (~6-8 min), so both can move onto the PR.

**Approach:** A `pull_request` workflow that reuses the sharded two-run capture and reports TWO separated signals: (1) a HARD FAIL when the generator disagrees with itself (run a vs run b differ per shard: nondeterminism, always a bug); and (2) when the freshly generated set differs from the committed set, a one-click APPROVAL GATE (a GitHub Environment with a required reviewer) that, on the author's approval, commits the just-generated (pinned-container) gallery straight to the PR branch in the SAME run: no separate marker push, no second workflow run.

## Boundaries & Constraints

**Always:** The two signals stay separate. The hard check (in the SHARED reusable capture) renders every shard TWICE and diffs the two renders against EACH OTHER (never the committed set), so it stays valid as `main` drifts under the PR, and it gates the commit: only a set proven deterministic can ever be committed. The commit job targets a protected Environment (`screenshot-approval`) so it CANNOT run without an explicit human approval; it commits only the verified assembled gallery with `GITHUB_TOKEN` + a fast-forward-guarded push. The sharded, self-verifying capture is a reusable `workflow_call` (`screenshot-capture.yml`) shared by BOTH this workflow and `update-screenshots.yml`, so they never drift on how pixels are generated or how nondeterminism is caught. Reuse `scripts/screenshot-shards.ts` (`matrix`/`print`/`verify`) and the pinned-image resolution. Path-gate to render-affecting changes. Least privilege: read-only by default, `contents: write` only on the commit job, `pull-requests: write` only on the comment job; PR-code-running jobs use `persist-credentials: false`.

**Ask First:** Making the hard check a REQUIRED status check (needs the always-run-then-skip pattern or a path-filtered required check hangs "pending").

**Never:** Do not conflate the two signals ("differs from committed = red X" is the boy-who-cried-wolf trap). Do not commit the regenerated set WITHOUT the environment approval (an unconfigured environment must be treated as a setup error, see Design Notes, not a license to auto-commit). Do not weaken the determinism guard (single render, or a subset of scenes). Do not sample or drop scenes (coverage `verify` still gates).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unrelated PR | no render-affecting paths changed | capture does not run (path gate); no gate, no commit | N/A |
| Deterministic, pixels match committed | render paths touched, a==b, no drift | hard check green; commit job skipped (no drift) | N/A |
| Deterministic, pixels changed, NOT approved | a==b, drift vs committed, author has not approved | hard check green; commit job waits in "Waiting for review"; nothing committed | stays pending until approved/rejected |
| Deterministic, pixels changed, APPROVED | author clicks Approve on the `screenshot-approval` env | same run commits the run-a gallery to the PR branch (GITHUB_TOKEN, rebase-retry) | N/A |
| Nondeterministic | a shard's two renders differ | shared capture FAILS naming the shard; drift + commit jobs never reached | `::error::`, exit non-zero |

</frozen-after-approval>

## Code Map

- `.github/workflows/screenshot-capture.yml` -- NEW, reusable (`workflow_call`). `resolve-image` (coverage `verify` + shard `matrix` + pinned image) + `shoot` (one job per shard: render the shard TWICE, diff the two renders, hard-fail on nondeterminism, upload the verified `shots-<shard>`). Read-only. Consumed by both callers.
- `.github/workflows/pr-drift-check.yml` -- NEW caller. `capture` (uses the reusable), `verify-drift` (assemble the verified sets over the PR's committed gallery, set `has_drift`, post the sticky comment), `commit-on-approval` (`environment: screenshot-approval`, `if: has_drift` + same-repo; rebuild + fast-forward-guarded push to the PR branch).
- `.github/workflows/update-screenshots.yml` -- REFACTORED to a caller. `capture` (uses the reusable, gated on the `[update-screenshots]` marker/dispatch) + `commit` (assemble + push on the branch). Its old inline capture + verify-and-commit are replaced by the shared capture; the marker trigger is kept.
- `scripts/screenshot-shards.ts` -- read-only reuse: `matrix`, `print <shard>`, `verify`. No change.
- `_bmad-output/implementation-artifacts/backlog.md` -- design of record; drift-check + keep-the-marker + the reuse decision.

## Tasks & Acceptance

**Execution:**
- [x] `.github/workflows/pr-drift-check.yml` -- add the path-gated `pull_request` workflow: `resolve-image` + `shoot` (two-run x shard, reusing `screenshot-shards.ts`), a `verify` job that hard-fails on any per-shard run-a != run-b and outputs `has_drift` (assembled run-a vs committed), and a `commit-on-approval` job gated on the `screenshot-approval` environment that commits the run-a gallery to the PR branch only when drift exists and a reviewer approves.
- [x] `commit-on-approval` -- assemble + commit reuses update-screenshots' verify-and-commit shape (rm-only-PNGs rebuild, `GITHUB_TOKEN`, 5x rebase-retry push); the `verify` job posts/updates one sticky PR comment (best-effort) pointing the author at the pending approval when drift is detected.
- [x] `_bmad-output/implementation-artifacts/backlog.md` -- drift-check followup updated to in-progress with the approval-gate design; the party decision to keep the `[update-screenshots]` marker recorded.

**Acceptance Criteria:**
- Given a PR that changes pixels and the generator is deterministic, when CI runs, then the hard check is green and a commit job waits for the author's one-click approval; on approval the regenerated gallery is committed to the PR branch in the same run (no marker push, no second run).
- Given a PR that introduces nondeterminism, when CI runs, then the hard check fails naming the differing shard and the commit job is never reached.
- Given a PR that changes pixels but is never approved, when CI finishes, then nothing is committed and the PR is not turned red by the drift alone.
- Given a PR touching no render-affecting paths, when CI runs, then the capture is skipped and no approval gate appears.

## Spec Change Log

- **2026-07-13, human renegotiation (party-vetted):** the frozen "Ask First: workflow_call refactor" and "Never: edit update-screenshots.yml" were both approved by the user, who asked to reuse the same capture jobs across both workflows. Amended: the sharded, self-verifying capture is now a reusable `workflow_call` (`screenshot-capture.yml`) that both `pr-drift-check.yml` and `update-screenshots.yml` call. A party round-table (Winston/Dana/Boundary/John/Grumbal) also converged on rendering each shard TWICE in one container (a/b-in-shard) instead of a `run:[a,b]` matrix: same determinism strength, half the `npm ci`+build overhead. KEEP across any re-derivation: the two signals stay separate; the determinism guard renders twice and byte-compares every shot; the commit is environment-approval-gated and never auto-commits; least-privilege per job with `persist-credentials:false` on PR-code jobs; the `[update-screenshots]` marker is retained. Also re-included `src/tests/fixtures/**` in the path gate (screenshot scenes load save fixtures) after a Codex finding.

## Design Notes

Approval mechanism: a job with `environment: screenshot-approval` cannot start until a required reviewer approves it in the Actions UI, so the gate is native GitHub, same-run, one click. PREREQUISITE (repo setting, one-time): create that Environment with the maintainer as a required reviewer. If the environment does not exist or has no reviewer, the gate does NOT gate and the job would commit unreviewed; the workflow must not silently auto-commit, so treat a missing/unprotected environment as a configuration error to fix, not a fallback. The `if: has_drift` guard means the approval prompt only appears when there is actually something to commit (no gate on no-drift PRs).

GITHUB_TOKEN is deliberate for the commit: its push does not re-trigger workflows, which both avoids a drift-check loop and is fine here (the maintainer can re-approve/re-run the PR's other checks on the bot commit).

Reuse vs DRY: the sharded, self-verifying capture is a reusable `workflow_call` (`screenshot-capture.yml`) that BOTH this workflow and `update-screenshots.yml` call, so there is one place that defines how pixels are generated and how nondeterminism is caught. The determinism guard renders each shard TWICE in the SAME container and diffs the two renders (a/b-in-shard), rather than a `run:[a,b]` matrix of separate jobs: same pinned image, so it is exactly as strong a guard, while halving the `npm ci` + build overhead (4 shard jobs, not 8). Wall-clock grows to ~2x the slowest shard's render (acceptable for a background check). If that ever bites, the follow-up is build-once + dep-cache, not more jobs.

Path fixtures: `!src/tests/**` excludes tests, but the screenshot scenes LOAD real save fixtures under `src/tests/fixtures/**` (the `migration` scene reads one), so those are re-included after the negation, or a fixture-only PR could change committed pixels with no check.

Required-check pitfall: a path-filtered workflow that is also a required check hangs "pending" on skipped PRs. If the hard check is made required, drop the top-level `paths:` filter and gate internally (a `changes` job outputs a boolean; a final always-run job reports success when skipped). v1 keeps the simple `paths:` filter and is not required.

Concurrency: `group: pr-drift-${{ github.event.pull_request.number }}`, `cancel-in-progress: true` (a new push supersedes a run still waiting at the gate; the new push has new pixels anyway).

## Verification

**Commands:**
- `node scripts/screenshot-shards.ts verify` -- expected: exit 0 (the reused brain still covers every scene).
- `npm run typecheck && npm run lint && npm test && npm run build` -- expected: all green (no app code touched).
- YAML sanity: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/pr-drift-check.yml'))"`.
- End-to-end proof comes from the workflow on this PR: the hard check must go green (deterministic); since this PR adds no screenshots, `has_drift` is false and no approval gate appears.
