---
baseline_commit: 07a315e
---

# Story: Deploy production from release tags

Status: review

Grounds: issue #1882 (owner request, 2026-11-11, after 3.0.0 shipped). Design
settled in the party round
`_bmad-output/party-mode/tag-deploy-party-2026-11-11.md`. No epic; standalone
tooling story. Review: `/bmad-code-review` (CI and release plumbing).

## Story

As **the owner shipping Verticopolis releases**,
I want **production to deploy from a GitHub Actions job started by the release
tag, instead of Vercel's push-triggered git build**,
so that **production moves only when a release is tagged, every deploy is
visible and re-runnable in Actions, and a rollback is the same job run with an
older tag**.

## Acceptance Criteria

1. `vercel.json` turns off Vercel's git deploys for `main` only
   (`git.deploymentEnabled.main: false`); preview deploys from other branches
   keep working through the git integration and the Ignored Build Step.
2. A new workflow `.github/workflows/deploy-production.yml` runs only on
   `workflow_dispatch` with a `tag` input. It has no push, pull request or
   `pull_request_target` trigger.
3. The job accepts only `v<x.y.z>` or `engine-v<x.y.z>`, checks out
   `refs/tags/<tag>`, confirms HEAD is that tag's commit, confirms the version
   in `package.json` (app tag) or `engine-rs/Cargo.toml` (engine tag) matches,
   and confirms the commit is on `main`.
4. The job runs the existing release gate,
   `VERCEL_ENV=production bash scripts/vercel-ignore-build.sh`, and deploys only
   when it answers "build" (exit 1). A commit with pending release notes or no
   version change is refused.
5. A missing `VERCEL_TOKEN`, `VERCEL_ORG_ID` or `VERCEL_PROJECT_ID` fails the
   job with an error naming each missing secret.
6. It deploys with an exactly pinned Vercel CLI: `vercel pull --environment=production`,
   `vercel build --prod`, `vercel deploy --prebuilt --prod`. The build runs
   `vercel.json`'s `buildCommand`, so `scripts/vercel-build.sh` builds the WASM
   engine as the current deploy does.
7. After the deploy it waits until the production domain's alias points at the
   deployment this run made (Vercel API) and `https://verticopolis.com/version.json`
   reports the tag commit, and fails the job if that does not happen within a
   few minutes. The alias check matters for a redeploy of the live release,
   whose `version.json` does not change (owner, 2026-11-11).
8. The job runs in the `production` environment with a `production-deploy`
   concurrency group that does not cancel a running deploy. Checkout keeps no
   credentials and the token reaches only the Vercel steps.
9. `release-tag.yml` dispatches the deploy after it tags a new app version, and
   after the crate release when a release raised only the crate version.
10. No config-text guard test (CONTRIBUTING.md forbids tests that match
    workflow text). Verify by running the step scripts: bash syntax checks and
    the gate handler against fake gates that exit 0, 1 and 2.
11. CONTRIBUTING.md "Production waits for the release PR" and the
    `vercel-ignore-build.sh` header describe the new path. A change note with
    `app: none` (players see nothing different).

## Tasks / Subtasks

- [x] `vercel.json` git setting (AC 1)
- [x] `deploy-production.yml` (AC 2-8)
- [x] `release-tag.yml` dispatches (AC 9)
- [x] Verify the step scripts by running them (AC 10)
- [x] Docs and change note (AC 11)
- [x] Quality gates, `/bmad-code-review`, PR naming the owner's secret step

## Dev Notes

- Today: Vercel git integration builds every push; the dashboard's Ignored
  Build Step runs `scripts/vercel-ignore-build.sh`, whose production branch
  holds a commit with pending notes and skips one that changes no version
  (#1880). Preserve it: previews still use the whole script, and the deploy job
  reuses its production branch as the definition of a release commit.
- `release-tag.yml` creates `v<app>` with the workflow token and dispatches
  `github-release.yml` (a tag pushed by the workflow token starts no tag-push
  run). Copy that pattern. A crate-only release creates `engine-v<crate>` in
  its `gh release create` step, so the crate-only dispatch goes after it.
- `vite.config.ts` refuses `VC_TOOLING` and `VC_PUBLIC_DIR` when `VERCEL` is
  set; `vercel build` sets it, so those guards still hold.
- `version.json` carries `sha` from `git rev-parse --short HEAD`; compare it as
  a prefix of the full commit.
- Actions are pinned by SHA in this repo; reuse the existing checkout and
  setup-node pins.
- Vercel CLI `65.4.0` (released 2026-10-27, older than two weeks).
- Owner steps (cannot be done from a PR): add the three secrets, ideally as
  `production` environment secrets with the environment limited to `main`.
  The PR must not merge before they exist, or the next release will not reach
  production.

### References

- Issue #1882; Vercel guide linked there.
- `scripts/vercel-ignore-build.sh`, `.github/workflows/release-tag.yml`,
  `.github/workflows/github-release.yml`, `scripts/vercel-build.sh`.
- CONTRIBUTING.md, Versioning, "Production waits for the release PR".

## Dev Agent Record

### Completion Notes List

- `deploy-production.yml` checks the tag form, the tag commit, the version
  file it names and that `main` contains it (GitHub compare API), then runs
  the existing gate script; only exit 1 deploys. Tried locally: the gate exits
  1 at the v3.0.1 release merge and 0 at a non-release `main` commit.
- `vercel build` needs no token (checked with the pinned CLI on a throwaway
  project), so the build step runs without the secrets.
- `/bmad-code-review`, one lean pass (owner token rule), layers run inline:
  two patch findings fixed (the workflow header understated which steps see
  the secrets; the crate-only dispatch did not say how to recover from a
  failed crate release), one prose fix in the party record. No defer findings.
- Review round 2 (PR-Agent on #1939, and the owner): the config-text guard
  test broke the CONTRIBUTING.md workflow-test rule, so it was removed and the
  step scripts were exercised instead (gate exits 0 and 2 stop the job, 1
  goes ahead; the deploy URL is read from plain and JSON CLI output; tag forms
  are accepted and refused as intended). The owner noted a redeploy leaves
  `version.json` unchanged, so the final check now also requires the
  production alias to point at the new deployment.
- Codex (P2): a slow automatic dispatch for an older release could land after
  a newer one. The workflow now has a `check` job (no secrets) that ends green
  without deploying when main's app and crate versions differ from the tag's,
  unless the `rollback` input is ticked; the `deploy` job checks out the exact
  commit the check approved. Exercised: current release deploys, v3.0.0
  without rollback does not.
- Owner ask: tag deploys on Vercel for easy rollbacks. Each deployment now
  carries `release` and `commit` metadata (`--meta`, checked in the pinned
  CLI's help), and the run summary prints the `vercel promote` command.

### File List

- `.github/workflows/deploy-production.yml` (new)
- `.github/workflows/release-tag.yml`
- `vercel.json`
- `scripts/vercel-ignore-build.sh`
- `CONTRIBUTING.md`
- `.changes/claude-project-thread-kq7q2i.md` (new)
- `_bmad-output/party-mode/tag-deploy-party-2026-11-11.md` (new)
- `_bmad-output/party-mode/memories/installed/.memlog.md`
- `_bmad-output/implementation-artifacts/story-tag-deploys.md` (new)
