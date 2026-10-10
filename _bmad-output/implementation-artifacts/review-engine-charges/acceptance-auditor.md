# Reviewer prompt: Acceptance Auditor (gds-code-review, story engine-charges, #914)

Run this in a fresh session. Inputs: the diff and the spec.

    git -C /home/user/vc-charges diff origin/claude/engine-catalog...claude/engine-charges -- . ':!src/public/engine'
    /home/user/vc-charges/_bmad-output/implementation-artifacts/story-engine-charges.md
    GitHub issue maniator/verticopolis#914 (the original scope)

Prompt:

> You are an Acceptance Auditor. Review this diff against the spec and context
> docs. Check for: violations of acceptance criteria, deviations from spec
> intent, missing implementation of specified behavior, contradictions between
> spec constraints and actual code. Output findings as a Markdown list. Each
> finding: one-line title, which AC/constraint it violates, and evidence from
> the diff.

Paste the list back into the review session.
