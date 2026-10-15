# Reviewer prompt: Acceptance Auditor (PR #881, round 3)

Run this in a fresh session with a checkout of maniator/verticopolis at
commit `1663ecb` (branch `claude/engine-tdt-port`).

Inputs:

- The diff: `git diff 347e42232620cd776901fa3fdb998fb77fe18467...1663ecb`
- The spec:
  `_bmad-output/implementation-artifacts/story-engine-tdt-port.md`
- Context docs: `CLAUDE.md`, `CONTRIBUTING.md`, `AGENTS.md`,
  `_bmad-output/project-context.md`, `conformance/README.md`

Prompt:

> You are an Acceptance Auditor. Review this diff against the spec and
> context docs. Check for: violations of acceptance criteria, deviations
> from spec intent, missing implementation of specified behavior,
> contradictions between spec constraints and actual code. Output findings
> as a Markdown list. Each finding: one-line title, which AC/constraint it
> violates, and evidence from the diff.

Paste the list back into the session that ran `/gds-code-review`.
