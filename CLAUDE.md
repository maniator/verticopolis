# CLAUDE.md

**[CONTRIBUTING.md](./CONTRIBUTING.md) is the contributor guide — read it.** It
is the source of truth for dev setup, quality gates, testing & coverage,
architecture, versioning, code review, and merging. **[AGENTS.md](./AGENTS.md)**
adds the agent-specific layer on top: the BMAD/BMGD workflow and the mandatory
review skill. The BMAD agent rules live in `_bmad-output/project-context.md`.

## Non-negotiables (don't skip these)

- **Every non-trivial change gets a deep review — and the deep review IS running
  the BMGD/BMAD review skill in the same session: `/gds-code-review` for
  gameplay/engine work, `/bmad-code-review` for everything else (storage,
  persistence, tooling, UI plumbing).** Its adversarial layers (Blind Hunter →
  Edge Case Hunter → Acceptance Auditor → triage) are the review. A self-read or
  a generic `/code-review` does **not** satisfy it. Fix every `patch` finding and
  record every `defer` finding in
  `_bmad-output/implementation-artifacts/backlog.md`. A PR is not "done"
  until the skill has run and its confirmed findings are fixed and re-verified.
  This holds **even for small or test-only changes** that touch engine/gameplay
  invariants (e.g. build caps, transport pooling, economy math) — green quality
  gates are **not** a substitute for the review skill, and "the diff is tiny" is
  not an exemption.
- **Quality gates before pushing:** `npm run typecheck`, `npm run lint`,
  `npm test`, `npm run build` — all green.
- **American English everywhere;** keep `src/engine/` free of DOM/rendering.
- **Bump `package.json` `version` on any player-facing change** (minor for a new
  player-facing capability, patch for a player-noticeable fix/behavior change;
  internal-only work needs none). It's injected as `__APP_VERSION__` on the splash
  and anchors the update flow, so a missing bump misreports the build. See
  [CONTRIBUTING.md](./CONTRIBUTING.md) → **Versioning**.
- **Merge commits only** to `main` (never squash). Commit/push only when asked.
- **Resolve Copilot/Codex PR review threads** once addressed — actually mark
  each thread **Resolved** (`resolve_review_thread`). A reply alone does NOT
  clear it, and unresolved threads block merge under branch protection.

## Canon reference (don't re-derive from memory)

- **Per-tower build caps live in `src/engine/facilities.ts`** (`BUILD_CAPS`,
  `POOLED_CAPS`, `MAX_CARS`, `maxSpanFor`) and are enforced in one place,
  `Tower.capReason`. That file is the single source of truth — mirror the 1994
  original there, not from recollection.
- **Transport pooling matches the original and is deliberate:** all three
  elevator kinds (standard + service + express) share **one 24-shaft pool** —
  express is **not** counted separately. Stairs + escalators share a separate
  **64-link pool**. Cars/shaft: 8 for every elevator kind (service included — it
  is a staff-only standard elevator, not a reduced one). Spans: standard &
  service 30 floors, express the whole tower, stairs/escalators a fixed 2 floors.
  Do not "fix" express out of the elevator pool — that would break canon.
