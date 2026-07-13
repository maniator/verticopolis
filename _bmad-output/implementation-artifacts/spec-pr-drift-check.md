---
title: 'Screenshot drift-check on pull requests'
type: 'chore'
created: '2026-07-13'
status: 'draft'
context: ['{project-root}/_bmad-output/implementation-artifacts/backlog.md']
---

<frozen-after-approval reason="human-owned intent: do not modify unless human renegotiates">

## Intent

**Problem:** The screenshot determinism guard only runs when someone deliberately regenerates the gallery (`update-screenshots.yml`, marker push). A PR that adds a wall-clock read to the engine render path can merge green and only surface churn on the next nightly regen, which is exactly the leak PR #188 spent hours chasing. Sharding (PR #198) made a full two-run generation cheap enough (~6-8 min) to move the guard left, onto the PR itself.

**Approach:** A new `pull_request` workflow that reuses the sharded two-run capture and reports TWO clearly separated signals: (1) a HARD FAIL when the generator disagrees with itself (run a vs run b differ per shard: nondeterminism, always a bug), and (2) an ADVISORY-only note when the freshly generated set differs from the committed set ("this PR changes N screenshots, regenerate with a `[update-screenshots]` marker push"). The advisory is expected on real UI PRs and must never be a red X.

## Boundaries & Constraints

**Always:** The two signals stay separate with separate verdicts. The hard check compares run a vs run b against EACH OTHER (never against the committed set), so it stays valid as `main` drifts under the PR. The advisory (generated vs committed) is non-blocking: it posts/updates a PR comment or a neutral check and NEVER fails the workflow. Reuse `scripts/screenshot-shards.ts` (`matrix`/`print`/`verify`) and the pinned-image resolution as the shared partition/coverage brain. Path-gate the run to render-affecting changes so unrelated PRs are not charged the ~7 min. Least privilege: `contents: read`, `pull-requests: write` only.

**Ask First:** Marking the hard check a REQUIRED status check in branch protection (needs the always-run-then-skip pattern first, see Design Notes, or a path-filtered required check hangs "pending" forever). Refactoring `update-screenshots.yml` into a shared `workflow_call` capture (cleaner DRY, but re-touches the just-merged workflow).

**Never:** Do not conflate the two signals: "differs from committed = fail" is the boy-who-cried-wolf trap (every legit sprite tweak goes red, people learn to ignore red, a real leak lands unnoticed). Do not auto-commit or regenerate the committed gallery on a PR (that stays `update-screenshots.yml`'s marker job). Do not weaken or edit `update-screenshots.yml`. Do not sample or drop scenes to go faster (coverage `verify` still gates).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unrelated PR | no render-affecting paths changed | workflow does not run the capture (path gate); no comment | N/A |
| Deterministic PR, no pixel change | render paths touched, generator stable, pixels match committed | hard check passes; advisory says "no screenshot drift" (or no comment) | N/A |
| Deterministic UI PR | pixels intentionally changed, but run a == run b | hard check PASSES (green); advisory comment "N screenshots would change, regen with [update-screenshots]" | never fails |
| Nondeterministic PR | run a != run b for some shard | hard check FAILS naming the shard/shot; workflow red | `::error::`, exit non-zero |
| Advisory tooling error | comment API fails | log a warning; workflow still succeeds (advisory is best-effort) | swallow, do not fail |

</frozen-after-approval>

## Code Map

- `.github/workflows/pr-drift-check.yml` -- NEW. The PR workflow: `resolve-image` (coverage `verify` + shard `matrix` + pinned image, mirrors update-screenshots), `shoot` matrix `run:[a,b] x shard` (render each shard via `ONLY=`, upload its rendered set AND its per-shard committed-drift file list), `report` (per-shard a-vs-b diff = hard fail; sum committed-drift = advisory comment; no commit).
- `scripts/screenshot-shards.ts` -- read-only reuse: `matrix`, `print <shard>`, `verify`. No change.
- `.github/workflows/update-screenshots.yml` -- reference only; the capture structure is mirrored here, NOT edited.
- `_bmad-output/implementation-artifacts/backlog.md` -- the party-vetted design of record; mark this followup done.

## Tasks & Acceptance

**Execution:**
- [ ] `.github/workflows/pr-drift-check.yml` -- add the `pull_request` workflow (path-gated), `resolve-image` + `shoot` (two-run x shard, reusing `screenshot-shards.ts`), and a `report` job that hard-fails on any per-shard run-a != run-b and posts a non-blocking sticky advisory comment when the generated set differs from committed.
- [ ] `report` advisory -- update a single sticky comment (find by a hidden marker, edit in place) so repeated pushes do not spam; when drift is zero, either say so or remove the note.
- [ ] `_bmad-output/implementation-artifacts/backlog.md` -- move the "Drift-check on every PR" followup to done.

**Acceptance Criteria:**
- Given a PR that touches `src/render/**` or `scripts/screenshot*` and the generator is deterministic, when CI runs, then the hard check is green even if pixels changed, and (if pixels changed) a single advisory comment names the count and the `[update-screenshots]` remedy.
- Given a PR that introduces nondeterminism (a wall-clock read in the render path), when CI runs, then the hard check fails naming the differing shard, and nothing is committed.
- Given a PR that touches no render-affecting paths, when CI runs, then the capture is skipped and no advisory comment is posted.
- Given the advisory comparison finds drift, when it reports, then the workflow conclusion is still success (the advisory never turns the PR red).

## Design Notes

Reuse vs DRY: v1 mirrors update-screenshots' `resolve-image` + `shoot` rather than editing that just-merged, heavily-reviewed workflow (the "do not weaken" constraint). The shared partition/coverage brain (`screenshot-shards.ts`) is genuinely reused, so the two workflows cannot drift on WHICH scenes exist or how they shard. A later `workflow_call` refactor (one capture consumed by both) is the DRY endgame and is listed under Ask First.

Per-shard, each `shoot` job stages its rendered PNGs (for the a-vs-b hard diff, same `find -newer` approach as update-screenshots) and also records `git diff --name-only -- docs/screenshots` (generated vs the checked-out committed set) as that shard's advisory drift list. `report` downloads both: `diff -rq` run-a vs run-b per shard for the hard verdict, and unions the drift lists for the advisory count.

Required-check pitfall: a path-filtered workflow that is ALSO a required status check hangs "pending" on PRs that skip it. If the hard check is ever made required, drop the top-level `paths:` filter and gate internally (a `changes` job diffs base...head and outputs a boolean; capture jobs `if: needs.changes.outputs.render == 'true'`; a final always-run job reports success when skipped). v1 keeps the simple top-level `paths:` filter and is not required, so the pitfall does not bite yet.

Concurrency: `group: pr-drift-${{ github.event.pull_request.number }}`, `cancel-in-progress: true` (a new push supersedes the old run; unlike the commit workflow, there is nothing to serialize).

## Verification

**Commands:**
- `node scripts/screenshot-shards.ts verify` -- expected: exit 0 (the reused brain still covers every scene).
- `npm run typecheck && npm run lint && npm test && npm run build` -- expected: all green (no app code touched; workflow + backlog only).
- YAML sanity: parse `.github/workflows/pr-drift-check.yml` (e.g. `python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))"`).
- End-to-end proof comes from the workflow itself on this PR: the hard check must go green (deterministic) and, since this PR adds no screenshots, the advisory must report no drift.
