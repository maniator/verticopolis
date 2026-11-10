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

## Heavy review on request

PR-Agent carries the heavy review pass, so Claude sessions spend fewer tokens
on it (owner, 2026-11-10). For a non-trivial PR, the author or reviewer
comments `/review` and `/improve` on the PR as two separate comments. Each
command runs in its own concurrency group, so both finish, and a later push
cancels only the automatic review. The review skill then runs one lean pass
of its layers in the same session, without a subagent per layer, and triages
PR-Agent's findings with its own: `patch` findings get fixed and `defer`
findings go to the backlog, as before. Request the pair once per review round,
on the head under review, and wait for the workflow run instead of polling.
The workflow matches the command at the start of the comment, so a Claude
comment keeps its attribution footer after it.

## Review scope, evidence and generated test data

Routine reviews assess the **deliverables of each PR**, not the entire parent
tracking issue. PR #1821 exposed misleading PR-Agent output: a preparatory
change was graded `Partially compliant` with #1421 even though it did not
claim to close the ticket, and files omitted from large-diff review chunks
were treated as missing. A generated golden contributed about 100 KB of diff
context across three model calls. This is a model-context/assessment limitation,
not evidence that the files were absent.

The settings in `.pr_agent.toml` address this without disabling code review:

- Automatic full-ticket compliance analysis is off. For a PR genuinely
  completing an entire ticket, an authorized collaborator may explicitly
  request `/review --pr_reviewer.require_ticket_analysis_review=true`.
  `description_issue_regex` handles bare issue references in descriptions,
  but not every source of ticket context. Branch-name ticket extraction is
  disabled too; title and explicit issue URLs may still supply ticket context
  during an opt-in analysis. Such analysis remains advisory.
- Generated golden snapshots (`frame-days.json`, `port-edits.json` and the
  card-text outputs) are excluded from the AI's diff context so the **source
  generators, assertions, Rust/WASM checks, TypeScript referee, and other
  tests** have priority. These files remain in GitHub, and their committed
  values remain checked by CI. Model review does **not** validate the
  excluded serialized values; intentional golden changes need human review.
- Large diffs may be split across **up to five model calls**, which can cost
  more. The coverage footer should report files the model could not inspect.
  An uninspected file is not a missing file. Compare with GitHub's changed-file
  list rather than relying on an individual chunk's omissions.
- A merge recommendation is review advice, **not CI status or approval**.
  Only actual defects warrant a changes-required result; specific unresolved
  risks or incomplete inspection can justify needs-review.

**Verification after merge:** request `/review` on #1821 (if still open) or
another representative large, staged PR. Confirm it no longer grades the full
parent issue, does not claim present source/test files are missing, preserves
security and code findings, and clearly reports any coverage exclusions. The
Action reads its normal configuration from the **default branch**, so a
review on the configuration PR before merge cannot prove the new settings
are active. No workflow/config text-assertion tests are added; review the
actual Action result instead.

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
