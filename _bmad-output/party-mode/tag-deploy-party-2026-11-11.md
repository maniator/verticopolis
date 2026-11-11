# Party round: production deploys from release tags (#1882), 2026-11-11

Room: Winston (architect), Amelia (dev), Vex (security), Grumbal (adversary),
Boundary (edge cases), John (PM). One lean session-mode round.

## The exchange (abridged)

🏗️ **Winston:** One workflow, `deploy-production.yml`, takes a release tag on
`workflow_dispatch`. `release-tag.yml` dispatches it the moment it tags. A
redeploy or a rollback is the same button with an older tag, so production has
exactly one road.

😤 **Grumbal:** And the morning this merges, `vercel.json` turns off the git
deploy for `main`. If the three secrets are not in yet, the next release merge
tags, dispatches, and production quietly stays on the old build. That is the
3am page. The job fails red on a missing secret, naming it, and the PR does not
merge before the owner adds them.

🔒 **Vex:** `VERCEL_TOKEN` is an account token. It lives in a `production`
environment limited to `main`, the workflow has no `pull_request` trigger of
any kind, the CLI is pinned to an exact version, checkout keeps no
credentials, and the token goes only to the three Vercel steps. And check the
tag: anyone with write can push `v9.9.9` at a random commit and press the
button. The commit must be on `main` and must be a release commit.

📋 **John:** Which is the version gate we already have. Why invent a second
definition of "a release commit"?

💻 **Amelia:** Right: run `scripts/vercel-ignore-build.sh` with
`VERCEL_ENV=production` against the tag's checkout. It already refuses a
commit that holds release notes or leaves both versions as its parent had
them. Exit 1 means build. So the issue's "keep or retire the gate" answers
itself: keep it, and the tag path is where it now runs.

🌶️ **Boundary:** Crate-only releases. `npm run release` can raise the crate
and leave the app, and today's gate deploys those because the web bundle
carries the engine. No `v` tag then. The deploy has to take `engine-v<x.y.z>`
too, checking `engine-rs/Cargo.toml` instead of `package.json`.

😤 **Grumbal:** And it cannot dispatch before that tag exists, so a crate-only
deploy waits for the crate release step. A failed pack holds production.

🌶️ **Boundary:** Acceptable if it is said out loud: re-run, or dispatch by
hand. Two release merges a minute apart: one `production-deploy` concurrency
group, no cancel, so they run in order. GitHub drops a middle pending run in
favor of the newest; newest wins is what we want anyway.

🏗️ **Winston:** Previews stay on Vercel's git integration:
`git.deploymentEnabled: { "main": false }` turns off only `main`. The ignore
script keeps skipping previews that change nothing deployable.

📋 **John:** "Never claim it shipped without verifying." After the deploy,
read `https://verticopolis.com/version.json` until its `sha` is the tag's
commit, and fail the job if it never is.

💻 **Amelia:** The build itself is `vercel build --prod`, which runs
`vercel.json`'s `installCommand` and `buildCommand`, so `scripts/vercel-build.sh`
builds the WASM engine with the pinned toolchain exactly as Vercel does today.
No second copy of the build steps.

🔒 **Vex:** One more: a guard test so nobody adds `pull_request_target` to the
deploy workflow, unpins the CLI, or turns the `main` git deploy back on
without a red test.

## Decisions

1. New `deploy-production.yml`: `workflow_dispatch` with a `tag` input
   (`v<x.y.z>` or `engine-v<x.y.z>`), `environment: production`, concurrency
   group `production-deploy` without cancel.
2. The job checks the tag (form, tag commit equals checkout, version matches
   the file it names, commit reachable from `main`) and runs the existing gate
   (`VERCEL_ENV=production bash scripts/vercel-ignore-build.sh` must exit 1).
3. It fails with a named error when `VERCEL_TOKEN`, `VERCEL_ORG_ID` or
   `VERCEL_PROJECT_ID` is missing.
4. Vercel CLI pinned exactly (`vercel@65.4.0`); `vercel pull`, `vercel build
   --prod`, `vercel deploy --prebuilt --prod`.
5. Verify: poll production `version.json` until `sha` matches the tag commit.
6. `release-tag.yml` dispatches it after tagging an app version, or after the
   crate release when only the crate moved.
7. `vercel.json`: `git.deploymentEnabled.main = false`; previews unchanged.
8. Keep the version gate; it now runs inside the deploy job.
9. A guard test pins the security invariants.
10. Owner action before merge: add the three secrets (a `production`
    environment limited to `main` is recommended).
