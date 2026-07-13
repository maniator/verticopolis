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

**Always:** The two signals stay separate. The hard check diffs run a vs run b against EACH OTHER (never the committed set), so it stays valid as `main` drifts under the PR, and it gates the commit: only a set that passed a==b can ever be committed. The commit job targets a protected Environment (`screenshot-approval`) so it CANNOT run without an explicit human approval; it commits only the run-a assembled gallery (identical to update-screenshots' output) with `GITHUB_TOKEN` + the same rebase-retry push. Reuse `scripts/screenshot-shards.ts` (`matrix`/`print`/`verify`) and the pinned-image resolution. Path-gate to render-affecting changes. Least privilege: `contents: write` (commit), `pull-requests: write` (a pointer comment); nothing more.

**Ask First:** Making the hard check a REQUIRED status check (needs the always-run-then-skip pattern or a path-filtered required check hangs "pending"). Refactoring `update-screenshots.yml` into a shared `workflow_call`/composite for the capture+commit (the DRY endgame).

**Never:** Do not conflate the two signals ("differs from committed = red X" is the boy-who-cried-wolf trap). Do not commit the regenerated set WITHOUT the environment approval (an unconfigured environment must be treated as a setup error, see Design Notes, not a licence to auto-commit). Do not weaken or edit `update-screenshots.yml`. Do not sample or drop scenes (coverage `verify` still gates).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unrelated PR | no render-affecting paths changed | capture does not run (path gate); no gate, no commit | N/A |
| Deterministic, pixels match committed | render paths touched, a==b, no drift | hard check green; commit job skipped (no drift) | N/A |
| Deterministic, pixels changed, NOT approved | a==b, drift vs committed, author has not approved | hard check green; commit job waits in "Waiting for review"; nothing committed | stays pending until approved/rejected |
| Deterministic, pixels changed, APPROVED | author clicks Approve on the `screenshot-approval` env | same run commits the run-a gallery to the PR branch (GITHUB_TOKEN, rebase-retry) | N/A |
| Nondeterministic | run a != run b for some shard | hard check FAILS naming the shard; commit job never reached | `::error::`, exit non-zero |

</frozen-after-approval>

## Code Map

- `.github/workflows/pr-drift-check.yml` -- NEW. `resolve-image` (coverage `verify` + shard `matrix` + pinned image, mirrors update-screenshots), `shoot` matrix `run:[a,b] x shard` (render each shard via `ONLY=`, upload its rendered set), `verify` (per-shard run-a vs run-b: hard fail on nondeterminism; also assemble run-a and diff vs committed to set a `has_drift` output), `commit-on-approval` (`environment: screenshot-approval`, `if: needs.verify.outputs.has_drift == 'true'`; rebuild run-a gallery, commit + push to the PR branch).
- `scripts/screenshot-shards.ts` -- read-only reuse: `matrix`, `print <shard>`, `verify`. No change.
- `.github/workflows/update-screenshots.yml` -- reference only; its capture + `verify-and-commit` are mirrored here, NOT edited.
- `_bmad-output/implementation-artifacts/backlog.md` -- design of record; mark this followup done.

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

## Design Notes

Approval mechanism: a job with `environment: screenshot-approval` cannot start until a required reviewer approves it in the Actions UI, so the gate is native GitHub, same-run, one click. PREREQUISITE (repo setting, one-time): create that Environment with the maintainer as a required reviewer. If the environment does not exist or has no reviewer, the gate does NOT gate and the job would commit unreviewed; the workflow must not silently auto-commit, so treat a missing/unprotected environment as a configuration error to fix, not a fallback. The `if: has_drift` guard means the approval prompt only appears when there is actually something to commit (no gate on no-drift PRs).

GITHUB_TOKEN is deliberate for the commit: its push does not re-trigger workflows, which both avoids a drift-check loop and is fine here (the maintainer can re-approve/re-run the PR's other checks on the bot commit).

Reuse vs DRY: v1 mirrors update-screenshots' capture + `verify-and-commit` rather than editing that just-merged workflow ("do not weaken"). The shared partition/coverage brain (`screenshot-shards.ts`) is genuinely reused. A `workflow_call`/composite that both consume is the DRY endgame (Ask First).

Required-check pitfall: a path-filtered workflow that is also a required check hangs "pending" on skipped PRs. If the hard check is made required, drop the top-level `paths:` filter and gate internally (a `changes` job outputs a boolean; a final always-run job reports success when skipped). v1 keeps the simple `paths:` filter and is not required.

Concurrency: `group: pr-drift-${{ github.event.pull_request.number }}`, `cancel-in-progress: true` (a new push supersedes a run still waiting at the gate; the new push has new pixels anyway).

## Verification

**Commands:**
- `node scripts/screenshot-shards.ts verify` -- expected: exit 0 (the reused brain still covers every scene).
- `npm run typecheck && npm run lint && npm test && npm run build` -- expected: all green (no app code touched).
- YAML sanity: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/pr-drift-check.yml'))"`.
- End-to-end proof comes from the workflow on this PR: the hard check must go green (deterministic); since this PR adds no screenshots, `has_drift` is false and no approval gate appears.
