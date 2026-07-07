# Agent guide

Conventions specific to AI agents working in this repository. The **shared
contributor conventions — dev setup, quality gates, the two test tiers and
coverage floors, architecture (including the Classic vs Modern rule-set
strategy and the two-layer tower grid), versioning, code review, and merging —
live in [CONTRIBUTING.md](./CONTRIBUTING.md)**. Read it first; this file adds only
what's specific to running the BMAD/BMGD agent workflows on top of those
conventions.

## Use BMAD-METHOD for non-trivial work

This repo has **BMAD-METHOD** (BMM core + CIS + BMGD) installed. Default to its
agents and workflows for anything beyond a one-line tweak — planning, design,
building, and review. The skills are available to **both Claude Code**
(`.claude/skills/`, invoke as `/bmad-*` / `/gds-*` / `/bmad-cis-*`) **and GitHub
Copilot** (`.agents/skills/` + custom agents in `.github/agents/*.agent.md`).
When unsure where to start, run **`bmad-help`** and let it route you.

Follow the lifecycle — each phase feeds the next. Don't jump to code for a
feature that hasn't been specced; don't spec when a quick fix will do.

**BMM — software lifecycle (use for app/engine work):**

| Phase | When | Skill(s) |
| --- | --- | --- |
| Analysis | Frame an idea, research, or brainstorm before committing | `bmad-brainstorming`, `bmad-product-brief`, `bmad-prfaq`, `bmad-market-research` / `bmad-domain-research` / `bmad-technical-research`; agent **Mary** (`bmad-agent-analyst`) |
| Planning | Turn the "what" into a PRD / UX spec | `bmad-prd` (create·edit·validate), `bmad-ux`; agents **John** (`bmad-agent-pm`), **Sally** (`bmad-agent-ux-designer`) |
| Solutioning | Move from "what" to "how" | `bmad-architecture`, `bmad-create-epics-and-stories`, `bmad-check-implementation-readiness`; agent **Winston** (`bmad-agent-architect`) |
| Implementation | Build, review, and ship a story | `bmad-sprint-planning` → `bmad-create-story` → `bmad-dev-story` → `bmad-code-review` → `bmad-retrospective`; agent **Amelia** (`bmad-agent-dev`) |
| Anytime | Small change, bug, or orientation | `bmad-quick-dev` (intent→code in one pass), `bmad-investigate` (debug/trace), `bmad-correct-course` (mid-sprint pivots), `bmad-document-project`, `bmad-generate-project-context` |

**BMGD — game design & dev (this is a game; prefer these for gameplay work):**
`gds-create-game-brief` → `gds-gdd` (Game Design Document) → `gds-game-architecture`
→ `gds-create-epics-and-stories` → `gds-dev-story` → `gds-code-review`. Also
`gds-brainstorm-game`, `gds-create-narrative`, `gds-playtest-plan`,
`gds-quick-dev`. Agents: **Samus Shepard** (`gds-agent-game-designer`), **Cloud
Dragonborn** (`gds-agent-game-architect`), **Link Freeman** (`gds-agent-game-dev`),
**Indie** (`gds-agent-game-solo-dev`).

**CIS — creative intelligence (ideation, framing, comms):** reach for these when
you need to generate or shape ideas rather than implement them —
`bmad-cis-design-thinking`, `bmad-cis-innovation-strategy`,
`bmad-cis-problem-solving`, `bmad-cis-storytelling`. Coaches: **Carson**
(brainstorming), **Dr. Quinn** (problem-solving), **Maya** (design thinking),
**Victor** (innovation), **Sophia** (storytelling), **Caravaggio** (presentations).

BMAD planning/implementation artifacts are written under `_bmad-output/`.
The quality gates and code-review conventions in
[CONTRIBUTING.md](./CONTRIBUTING.md) still apply on top of any BMAD workflow —
BMAD organizes the work; it doesn't replace `npm test` or self-review before
pushing.

## Code review — the agent workflow

Follow [CONTRIBUTING.md](./CONTRIBUTING.md) → **Code review** for the review
requirements every change must meet (self-review, no Big-O regressions on hot
paths, the deep adversarial review before merge, re-requesting Copilot, and
resolving review threads). On top of that, in an agent session:

- **MANDATORY: the deep review IS running the BMGD/BMAD review skill —
  `/gds-code-review` for gameplay/engine work, `/bmad-code-review` for anything
  else (storage, persistence, tooling, UI plumbing).** That skill's parallel
  adversarial layers (Blind Hunter → Edge Case Hunter → Acceptance Auditor, then
  triage) ARE the deep review. A self-read, a generic `/code-review`, or an
  ad-hoc subagent pass does **not** satisfy this and must not be reported as "the
  deep review" — actually invoke the skill, let it triage, then fix every
  `patch` finding and record every `defer` finding in
  `_bmad-output/implementation-artifacts/backlog.md`. This applies to **every**
  non-trivial change, including save/persistence and infra work where it's easy
  to assume "it's just plumbing."
- **Bring in the agents relevant to the change** rather than reviewing solo:
  - **Cloud Dragonborn** (`gds-agent-game-architect`) / **Winston**
    (`bmad-agent-architect`) for engine, data-model, or structural changes;
  - **Samus Shepard** (`gds-agent-game-designer`) for mechanics, balance, and
    player-feel (e.g. economy, ratings, events);
  - **Sally** (`bmad-agent-ux-designer`) for UI/UX and audio-feel changes;
  - `/security-review` for anything touching untrusted input, saves/`.TWR`
    import, or persistence.

  For larger or higher-risk changes, convene several of these as a party
  (`bmad-party-mode`) so the perspectives challenge each other.
- The full canon and rationale for the hot-path performance rules live in
  `_bmad-output/project-context.md` (Performance section).

## Gameplay model notes

- Facilities are defined in `src/engine/facilities.ts`. Each has a `width` (in
  tiles) and optional `floors` (height in storeys; e.g. the cinema is 2).
- `basement: true` facilities (parking, recycling, metro) may only be built
  underground; the metro spans a whole basement floor.
- The tower grid is two-layered: a structural layer (floor/lobby) and a room
  layer that sits on top, exactly like the original SimTower corridor model.
