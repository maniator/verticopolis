# CLAUDE.md

**The full agent guide is [AGENTS.md](./AGENTS.md) — read it.** It covers the
BMAD/BMGD workflow, architecture, quality gates, and review conventions. The
BMAD agent rules live in `_bmad-output/project-context.md`.

## Non-negotiables (don't skip these)

- **Every non-trivial change gets a deep review — and the deep review IS running
  the BMGD/BMAD review skill in the same session: `/gds-code-review` for
  gameplay/engine work, `/bmad-code-review` for everything else (storage,
  persistence, tooling, UI plumbing).** Its adversarial layers (Blind Hunter →
  Edge Case Hunter → Acceptance Auditor → triage) are the review. A self-read or
  a generic `/code-review` does **not** satisfy it. Fix every `patch` finding and
  record every `defer` finding in
  `_bmad-output/implementation-artifacts/deferred-work.md`. A PR is not "done"
  until the skill has run and its confirmed findings are fixed and re-verified.
- **Quality gates before pushing:** `npm run typecheck`, `npm run lint`,
  `npm test`, `npm run build` — all green.
- **American English everywhere;** keep `src/engine/` free of DOM/rendering.
- **Merge commits only** to `main` (never squash). Commit/push only when asked.
- Resolve Copilot/Codex PR review threads before merging.
