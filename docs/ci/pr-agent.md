# PR-Agent on Verticopolis

PR-Agent runs as a GitHub Action with OpenAI. The workflow is
`.github/workflows/pr-agent.yml`; repo policy is in `.pr_agent.toml`.

## Configuration and credential

Create the repository **Actions secret** `OPENAI_KEY` at
`Settings → Secrets and variables → Actions → Repository secrets`.
Store the OpenAI **API** key value there, never in this repository.
`GITHUB_TOKEN` comes from GitHub Actions and needs no additional secret.
API usage is billed under the OpenAI API project, independently of any
ChatGPT subscription. No OpenAI organization ID or other variable is required.

## How to use

- Automatic review on PR opened, reopened, ready-for-review, or updated
  (including fork PRs). Drafts and bot-originated events are skipped.
- Trusted repo owners, members and collaborators can comment `/review` to
  request another review, `/improve` for **committable inline suggestions**,
  `/ask "question"` for focused PR analysis, and `/describe` on demand.
- `/improve` **proposes changes for a human to apply**; it does not push
  changes to the branch. This workflow runs in restricted mode and never
  checks out, installs or executes untrusted PR code.
- Auto-describe and auto-improve are deliberately disabled to minimize
  cost and avoid rewriting manually maintained PR descriptions.
- PR-Agent complements, and does not replace, Rust/test/coverage CI,
  independent reviews, Copilot or Codex.

## Review scope and generated test data

Routine reviews assess the **scope of the individual PR**, not everything in
a linked parent issue. Many Verticopolis features are delivered in staged PRs.
PR-Agent's automated full-ticket compliance check is disabled because it can
mislabel a preparatory PR "Partially compliant" even when the PR meets its
stated deliverables. The code review, security analysis, tests assessment,
failure modes, priority files and merge recommendation remain enabled.

For a PR that really **claims to close the whole ticket**, an authorized
collaborator can explicitly request ticket analysis with
`/review --pr_reviewer.require_ticket_analysis_review=true`.
Only use this for a complete-ticket PR. A link like "Part of #1421" or
"Follow-up: #1421" should not be read as a claim to complete that issue.
Even an explicit ticket review is advisory; a human verifies acceptance
criteria and required evidence.

Generated golden snapshots (including `frame-days.json`, `port-edits.json`,
and the card-text output files) are excluded from the model's diff context to
keep large artifacts from crowding out source code. The golden **generators,
test assertions, and integration tests are still reviewed**. Excluding a
snapshot does not delete it from the PR or remove its tests from CI.
Reviewers should separately inspect any intentional golden update and
confirm its generator and both engine-specific checks.

Large PRs can still be chunked (up to three model calls), and a chunk may see
only part of the diff. The review's coverage footer identifies actual
omissions. A reviewer must not confuse a file omitted from model context
with a missing source file or use pending CI alone as a code defect. Check
CI and relevant files directly before making a GO/NO-GO decision.

## Verification

Merge the setup PR, then open or update a non-draft PR and inspect the
`PR Agent (OpenAI)` workflow and its GitHub comments. For an existing PR,
post `/review` as a trusted collaborator to request a fresh run.
If the secret is absent/misnamed or its API project lacks model access
or billing, the Action will fail. Check the run logs without sharing keys.
PR-Agent is currently pinned to Docker image `0.49.0-github_action`;
upgrades should be deliberate, reviewed PRs.

Sources: https://docs.pr-agent.ai/installation/github/
and https://docs.pr-agent.ai/usage-guide/automations_and_usage/
