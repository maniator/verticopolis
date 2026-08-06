# Isolated reviewer prompts: nested-ternary cleanup (2026-08-06)

Fallback per gds-code-review step 2: this agent session could not launch review
subagents, so the three reviewer prompts below were generated and then executed
sequentially in isolation by the same session (noted as a deviation; the session
is non-interactive, so separate-session paste-back was not available). The diff
under review is the staged change on `claude/nested-ternary-cleanup`
(17 files, +292/-117).

- `blind-hunter.md`: diff only, no spec, no project context.
- `edge-case-hunter.md`: diff plus project read access.
- `acceptance-auditor.md`: diff plus SPEC.md, audit.md, project-context.md.

Findings and triage are recorded in the spec memlog
(`_bmad-output/specs/spec-nested-ternary-cleanup/.memlog.md`) and the review
summary in the PR. This folder is evidence of the fallback, not a living doc.
