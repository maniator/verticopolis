# Copilot Instructions

## Use BMAD-METHOD

This repo ships **BMAD-METHOD** skills and agents that are available to you,
GitHub Copilot, under `.agents/skills/` (89 skills) and `.github/agents/*.agent.md`
(custom agents for BMM, CIS, and BMGD). **Default to BMAD for non-trivial work**
(planning, design, building, and review) instead of ad-hoc edits. The full
routing guide (which skill/agent for which phase, and the BMGD game-dev flow that
fits this project) lives in [`AGENTS.md`](../AGENTS.md) under "Use BMAD-METHOD for
non-trivial work." Start with the `bmad-help` agent if you're unsure where to begin.

## Project Context

This is **Verticopolis**: a from-scratch, browser-native clone of the classic
**SimTower** (1994). Build a high-rise floor by floor, wire it with elevators,
attract tenants, keep them happy, and climb the star ratings to a **TOWER**.

It is a single **TypeScript** application (not multiple implementations) built on
the **[Excalibur.js](https://excaliburjs.com/)** game engine, bundled with
**Vite**, and tested with **Vitest**. Every sprite is drawn procedurally in code
(there are no external art assets), and the soundtrack is generated via WebAudio.

## Architecture

The codebase is layered, and the layering is load-bearing. Keep it intact:

- `src/engine/`: **pure game simulation, no DOM or rendering.** Deterministic and
  unit-tested. `Simulation` is the orchestrator; cohesive subsystems live in their
  own modules (`ElevatorDispatch`, `EventSystem`, `EconomySystem`, `Crowd`,
  `Tower`, `Clock`) and depend on the narrow `SimContext` interface so each is
  testable in isolation. Facilities are defined in `facilities.ts`; the RNG
  (`rng.ts`) is seeded for determinism, so don't reach for `Math.random()` here.
- `src/render/`: canvas rendering and pixel-art sprites (incl. `render/excalibur/`).
  Reads engine state, **never mutates it.**
- `src/ui/`: DOM controls (palette, status bar, dialogs); uses native `<dialog>`.
- `src/audio/`, `src/storage/`: sound and save/load, independent of rendering.
- `src/main.ts`: wires everything together (input, game loop).
- `src/tests/`: Vitest suites covering the engine.

**Golden rule:** keep `src/engine/` free of DOM/rendering concerns so it stays
deterministic and testable. Rendering and UI read engine state; they don't drive it.

## Scripts

```bash
npm run dev          # Vite dev server
npm run build        # production build to dist/
npm test             # Vitest suite
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run screenshots  # build + headless screenshot capture into docs/screenshots
```

## Quality gates (run before pushing)

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

CI (`.github/workflows/test.yml`) runs all of the above on every PR. When you push
new commits to a PR, **re-request a Copilot review**. Copilot reviews are one-shot
snapshots and won't pick up later commits on their own.

## GitHub PR Review: BMGD/BMAD review method

Run this repo's mandatory deep review on **every** PR. GitHub always applies this
file (`.github/copilot-instructions.md`) to Copilot code review, so this overlay
**is** the review method. Reproduce the behavior of the BMGD/BMAD review skills;
don't claim a skill was invoked:

- **Route by changed files:** apply the `gds-code-review` lens to gameplay/engine
  work (`src/engine/`, `src/render/`, mechanics, economy, ratings, events,
  elevators, facilities, RNG) and the `bmad-code-review` lens to everything else
  (storage/persistence, tooling, build/CI, UI plumbing, docs). A
  **mixed diff** runs both, each scoped to the files it owns; when one judgment is
  needed, default to the gameplay/engine lens if any such file is touched.
- **Run the adversarial layers:** Blind Hunter → Edge Case Hunter → Acceptance
  Auditor, then a `bmad-party-mode` synthesis over only the personas the diff
  implicates.
- **Deepen from the real skill when useful.** The repo is checked out, so you can
  read the full method even though the loader dropped it (see the maintainer note
  below): open `.agents/skills/gds-code-review/SKILL.md` for a gameplay/engine
  diff, or `.agents/skills/bmad-code-review/SKILL.md` otherwise, plus their
  `steps/*.md`, and follow them. You **cannot** run their scripts (no shell) or
  spawn their subagents (you are a single, read-only agent), so apply the steps
  inline yourself rather than invoking anything.
- **Apply the review dimensions in the “Code review” section below,** scoped to
  the implicated lenses. Prefer a few high-signal findings over filler.
- **Include in every review (ideally as the last line) the exact marker**
  `Reviewed against Verticopolis conventions (.github/copilot-instructions.md).`
  so it stays reliably searchable as confirmation this overlay was applied, even
  if a template or postamble appends text after it.

> **Maintainer note: why there is no `.github/skills` review skill.** Copilot
> code review *can* load agent skills from `.github/skills/`, but this repo
> commits the full BMGD/BMAD skill library under `.claude/skills/` and
> `.agents/skills/` (~515 files each). Copilot's skill loader has a ~508-file
> budget those trees blow past, so it drops **all** base-branch skills for safety.
> A `.github/skills/code-review` skill can't load here. The reviewer's run log
> states it outright:
>
> ```
> [skills] Materialization aborted (convention .claude/skills has 515 files,
>   exceeds remaining MAX_SKILL_FILE_COUNT budget (508)); dropping all
>   base-branch skills for safety.
> [skills] session=github/copilot-code-review ... configuredDirectories=0
> [skills] session=github/copilot-code-review SDK reported 0 skills loaded
> ```
>
> This overlay is the mechanism by design; don't re-add a review skill expecting
> it to load. (Investigated 2026-07-06: verticopolis ships both the `bmad-*` and
> `gds-*` families, ~515 files per convention; a bmad-only install lands ~256,
> under budget.)

## Code review

Reviews here are expected to be **deep, not a surface skim**. A green pipeline is
never enough to merge. On every review, look across *all* of these dimensions, not
just the obvious lines in the diff, and flag anything CI wouldn't catch:

- **Correctness & edge cases:** wrong conditions, off-by-one, null/undefined,
  floor/boundary ranges, missing guards, broken call sites, multi-floor/basement
  edge placements.
- **Engine purity & determinism:** `src/engine/` must stay DOM/render-free and
  deterministic (no `Date.now`/`Math.random`/wall-clock in the sim); rendering
  reads engine state and never mutates it.
- **Gameplay balance & player-feel:** economy, ratings, and emergency tuning
  (fires, bombs, events) should be fair across the star curve and match the
  SimTower parity model; watch for dead spots and exploits.
- **Security:** untrusted input (saves, persistence) must degrade
  gracefully and never crash or trust foreign data.

See [`CONTRIBUTING.md`](../CONTRIBUTING.md) → "Code review" for the
deep-review-before-merge policy every change must meet;
[`AGENTS.md`](../AGENTS.md) → "Code review: the agent workflow" adds the
BMAD/BMGD review skill plus the relevant architect / designer / UX / security
agents, convened as a party for larger changes.

## Conventions

- **American English everywhere:** code, comments, identifiers, strings, commit
  messages, UI copy. Note: `story`/`stories` for floors (not `storey`/`storeys`).
- **No em-dashes in prose.** Use commas, colons, parentheses, or separate sentences instead; en-dashes for numeric ranges (`2–5`, floors `30–60`) are fine. Skip the "X, not Y" emphatic-restatement pattern and AI marketing vocabulary (leverage, seamless, robust, comprehensive, elevate, streamline, and the like). Keep copy plain, human, and grammatically correct.
- Match the surrounding code's formatting, naming, and comment density.
- Adding a facility/room type? Start in `src/engine/facilities.ts`, then thread it
  through rendering and UI. Don't special-case it in the render layer.

[`CONTRIBUTING.md`](../CONTRIBUTING.md) is the canonical contributor guide (dev
setup, quality gates, architecture, versioning, merge policy, code-review
expectations); [`AGENTS.md`](../AGENTS.md) adds the agent layer on top (BMAD
workflow, gameplay model, the mandatory review skill). When this file and those
disagree, **they win**. Prefer updating them over duplicating detail here.
