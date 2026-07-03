# Agent & contributor guide

Conventions for anyone (human or AI agent) working in this repository.

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
The quality gates and code-review conventions below still apply on top of any
BMAD workflow — BMAD organizes the work; it doesn't replace `npm test` or
self-review before pushing.

## Language & style

- **Use American English everywhere** — code comments, identifiers, strings,
  commit messages, UI copy, and documentation. For example: `color` (not
  `colour`), `center` (not `centre`), `behavior` (not `behaviour`), `recognize`
  (not `recognise`), `story`/`stories` for floors (not `storey`/`storeys`).
- Match the surrounding code's formatting, naming, and comment density.
- Keep the simulation engine (`src/engine/`) free of DOM/rendering concerns so it
  stays deterministic and unit-testable.

## Architecture

- `src/engine/` — pure game simulation (no DOM). Deterministic; covered by tests.
  `Simulation` is the orchestrator; cohesive subsystems live in their own
  modules (`ElevatorDispatch`, `EventSystem`, `EconomySystem`, `Crowd`) and
  depend on the narrow `SimContext` interface so each is testable on its own.
- `src/render/` — canvas rendering and pixel-art sprites. Reads engine state,
  never mutates it.
- `src/ui/` — DOM controls (palette, status bar, dialogs). Uses native
  `<dialog>` for modals.
- `src/audio/`, `src/storage/` — sound and save/load, independent of rendering.
- `src/main.ts` — wires everything together (input, game loop).

## Quality gates (run before pushing)

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest run
npm run build       # production build must succeed
```

CI (`.github/workflows/test.yml`) runs all of the above on every PR.

## Code review

- **Self-review before pushing.** Read your own diff end-to-end with a
  reviewer's eye — correctness (wrong conditions, off-by-one, null/undefined,
  missing `await`, broken call sites) and cleanup (duplication, dead code,
  needless complexity) — and fix what you find before opening or updating a PR.
  Treat it as running `/code-review` on yourself; don't outsource the first
  pass to the bots.
- **Deep review in the same session that writes the code — not "later,
  before merge".** Green CI is necessary but not sufficient — never merge on a
  passing pipeline alone. The session (human or agent) that authors a
  non-trivial change runs the full adversarial review itself, before pushing or
  immediately after opening/updating the PR, while the context is still loaded.
  Deferring it to a hypothetical pre-merge step is how it gets skipped:
  sessions end, and no later session picks it up. A PR is not "done" —
  don't report it as finished — until the review has run and its confirmed
  findings are fixed and re-verified on the branch.
  - **MANDATORY: the deep review IS running the BMGD/BMAD review skill —
    `/gds-code-review` for gameplay/engine work, `/bmad-code-review` for
    anything else (storage, persistence, tooling, UI plumbing).** That skill's
    parallel adversarial layers (Blind Hunter → Edge Case Hunter → Acceptance
    Auditor, then triage) ARE the deep review. A self-read, a generic
    `/code-review`, or an ad-hoc subagent pass does **not** satisfy this and
    must not be reported as "the deep review" — actually invoke the skill,
    let it triage, then fix every `patch` finding and record every `defer`
    finding in `_bmad-output/implementation-artifacts/deferred-work.md`. This
    applies to **every** non-trivial change, including the save/persistence and
    infra work where it's easy to assume "it's just plumbing."
  - Bring in the other agents relevant to the change rather than reviewing solo:
  - **Cloud Dragonborn** (`gds-agent-game-architect`) / **Winston**
    (`bmad-agent-architect`) for engine, data-model, or structural changes;
  - **Samus Shepard** (`gds-agent-game-designer`) for mechanics, balance, and
    player-feel (e.g. economy, ratings, events);
  - **Sally** (`bmad-agent-ux-designer`) for UI/UX and audio-feel changes;
  - `/security-review` for anything touching untrusted input, saves/`.TWR`
    import, or persistence.

  For larger or higher-risk changes, convene several of these as a party
  (`bmad-party-mode`) so the perspectives challenge each other. Fold every
  finding worth acting on back into the branch, re-run the quality gates, and
  resolve the review threads before merging.
- Codex re-reviews automatically on every push. **Copilot does not** — its
  review is a one-shot snapshot, so after pushing new commits to a PR you must
  **re-request a review from Copilot** to get it to look at the latest changes
  (GitHub UI: the ↻ next to Copilot under Reviewers, or
  `request_copilot_review` via the GitHub MCP tools / `gh pr edit`).
- Resolve a review thread only once its finding is actually addressed in code —
  and then actually **mark it Resolved** (`resolve_review_thread` / the
  "Resolve conversation" button). A reply alone does not clear the thread, and
  unresolved threads block merge under branch protection.

## Merging PRs

- Default to a standard **merge commit** when merging a PR to `main`. It keeps
  the branch's individual commits in history and lets the same branch keep
  building cleanly afterward (a plain fast-forwardable reset, no rewrite).
- **Don't squash-merge to `main`** unless there's a real reason (e.g. a branch
  full of throwaway WIP commits not worth keeping). Squashing rewrites the
  branch into a single commit — it loses granular history and forces awkward
  force-resets of the branch for any follow-up work.

## Gameplay model notes

- Facilities are defined in `src/engine/facilities.ts`. Each has a `width` (in
  tiles) and optional `floors` (height in storeys; e.g. the cinema is 2).
- `basement: true` facilities (parking, recycling, metro) may only be built
  underground; the metro spans a whole basement floor.
- The tower grid is two-layered: a structural layer (floor/lobby) and a room
  layer that sits on top, exactly like the original SimTower corridor model.
