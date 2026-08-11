# Agent guide

Conventions specific to AI agents working in this repository. The **shared
contributor conventions (dev setup, quality gates, the two test tiers and
coverage floors, architecture (including the Classic vs Modern rule-set
strategy and the two-layer tower grid), versioning, code review, and merging)
live in [CONTRIBUTING.md](./CONTRIBUTING.md)**. Read it first; this file adds only
what's specific to running the BMAD/BMGD agent workflows on top of those
conventions.

One style rule is repeated here because agents are its main offenders:
**no em-dashes in prose** (player-facing copy, docs, comments, commit and PR
text) in anything new you write. Use commas, colons, parentheses, or separate
sentences instead. Two standing exceptions: en-dashes in numeric ranges
(`2–5`, floors `30–60`), and the standalone "—" empty-value placeholder glyphs
in the stats/editor panels. Existing `src/` code comments are grandfathered;
don't sweep them, but don't add new em-dashes either. Skip the "X, not Y"
emphatic-restatement pattern and AI marketing vocabulary. Keep copy plain,
human, and grammatically correct.

## Use BMAD-METHOD for non-trivial work

This repo has **BMAD-METHOD** (BMM core + CIS + BMGD) installed. Default to its
agents and workflows for anything beyond a one-line tweak: planning, design,
building, and review. The skills are available to **both Claude Code** (invoke
as `/bmad-*` / `/gds-*` / `/bmad-cis-*`) **and GitHub Copilot** (plus the custom
agents in `.github/agents/*.agent.md`). When unsure where to start, run
**`bmad-help`** and let it route you.

**One tree, two paths.** The skills live once, in `.agents/skills/`.
`.claude/skills` is a committed symlink to it, because Claude Code only
discovers project skills under `.claude/skills/` and Copilot's agent files
address them as `.agents/skills/`. Edit files under `.agents/skills/`; never
re-add a second physical copy. On Windows, clone with symlink support enabled
(`git clone -c core.symlinks=true`, which needs Developer Mode or an elevated
shell) or Git writes `.claude/skills` as a text file and Claude Code will find
no project skills.

Follow the lifecycle; each phase feeds the next. Don't jump to code for a
feature that hasn't been specced; don't spec when a quick fix will do.

**BMM: software lifecycle (use for app/engine work):**

| Phase | When | Skill(s) |
| --- | --- | --- |
| Analysis | Frame an idea, research, or brainstorm before committing | `bmad-brainstorming`, `bmad-product-brief`, `bmad-prfaq`, `bmad-market-research` / `bmad-domain-research` / `bmad-technical-research`; agent **Mary** (`bmad-agent-analyst`) |
| Planning | Turn the "what" into a PRD / UX spec | `bmad-prd` (create·edit·validate), `bmad-ux`; agents **John** (`bmad-agent-pm`), **Sally** (`bmad-agent-ux-designer`) |
| Solutioning | Move from "what" to "how" | `bmad-architecture`, `bmad-create-epics-and-stories`, `bmad-check-implementation-readiness`; agent **Winston** (`bmad-agent-architect`) |
| Implementation | Build, review, and ship a story | `bmad-sprint-planning` → `bmad-create-story` → `bmad-dev-story` → `bmad-code-review` → `bmad-retrospective`; agent **Amelia** (`bmad-agent-dev`) |
| Anytime | Small change, bug, or orientation | `bmad-quick-dev` (intent→code in one pass), `bmad-investigate` (debug/trace), `bmad-correct-course` (mid-sprint pivots), `bmad-document-project`, `bmad-generate-project-context` |

**BMGD: game design & dev (this is a game; prefer these for gameplay work):**
`gds-create-game-brief` → `gds-gdd` (Game Design Document) → `gds-game-architecture`
→ `gds-create-epics-and-stories` → `gds-dev-story` → `gds-code-review`. Also
`gds-brainstorm-game`, `gds-create-narrative`, `gds-playtest-plan`,
`gds-quick-dev`. Agents: **Samus Shepard** (`gds-agent-game-designer`), **Cloud
Dragonborn** (`gds-agent-game-architect`), **Link Freeman** (`gds-agent-game-dev`),
**Indie** (`gds-agent-game-solo-dev`).

**CIS: creative intelligence (ideation, framing, comms).** Reach for these when
you need to generate or shape ideas rather than implement them:
`bmad-cis-design-thinking`, `bmad-cis-innovation-strategy`,
`bmad-cis-problem-solving`, `bmad-cis-storytelling`. Coaches: **Carson**
(brainstorming), **Dr. Quinn** (problem-solving), **Maya** (design thinking),
**Victor** (innovation), **Sophia** (storytelling), **Caravaggio** (presentations).

BMAD planning/implementation artifacts are written under `_bmad-output/`.
The quality gates and code-review conventions in
[CONTRIBUTING.md](./CONTRIBUTING.md) still apply on top of any BMAD workflow.
BMAD organizes the work; it doesn't replace `npm test` or self-review before
pushing.

## Code review: the agent workflow

Follow [CONTRIBUTING.md](./CONTRIBUTING.md) → **Code review** for the review
requirements every change must meet (self-review, no Big-O regressions on hot
paths, the deep adversarial review before merge, re-requesting Copilot, and
resolving review threads). On top of that, in an agent session:

- **MANDATORY: the deep review IS running the BMGD/BMAD review skill:
  `/gds-code-review` for gameplay/engine work, `/bmad-code-review` for anything
  else (storage, persistence, tooling, UI plumbing).** That skill's parallel
  adversarial layers (Blind Hunter → Edge Case Hunter → Acceptance Auditor, then
  triage) ARE the deep review. A self-read, a generic `/code-review`, or an
  ad-hoc subagent pass does **not** satisfy this and must not be reported as "the
  deep review". Actually invoke the skill, let it triage, then fix every
  `patch` finding and record every `defer` finding in
  `_bmad-output/implementation-artifacts/backlog.md`. This applies to **every**
  non-trivial change, including save/persistence and infra work where it's easy
  to assume "it's just plumbing."
- **Keep the backlog-to-GitHub mirror true.** When triage folds a defer into a
  curated backlog row, create its GitHub issue and record the number in the
  row's `GH` column; when a row finishes, close its issue and clear the cell.
  Never write "tracked in the backlog" into a spec or GDD without a real row.
  The rule lives in the backlog's "How items flow" section and
  `src/tests/backlogIssueMirror.test.ts` fails the suite when a row half
  drifts.
- **If the automated PR reviewers are down, loop the review skill until it's
  clean.** With Copilot/Codex unavailable, the deep review skill has to stand
  in for the outside reviewer. First request the review as usual, then confirm
  from the PR's checks and review status that the outside review is genuinely
  unavailable (errored or never started), not merely pending; if it ran and is
  only pending, wait for it. If one of the two reviewers can still review, use
  it; only stand in when neither Copilot nor Codex can. Only loop where the
  change would already need the deep review: the non-trivial-change bar still
  applies, so a trivial change just waits for the bots to return (ask the user
  if that wait blocks something). Run the BMGD/BMAD review skill
  (`/gds-code-review` or `/bmad-code-review`, per the same gameplay-vs-plumbing
  split, both when the change spans both) over the whole change, fix every
  `patch` finding, record every `defer` in the backlog, then re-run the skill
  on the updated diff. Keep cycling until a full pass surfaces no new `patch`
  findings; one clean run straight after a fix round is not enough on its own,
  since each fix can open the next finding, so take one more confirming pass.
  If it does not converge after a couple of rounds, a `patch` finding needs
  human judgment you cannot settle, or the reviewers stay down once the change
  is clean, stop and ask the user instead of looping forever or merging solo.
  Copilot/Codex being offline never lowers the bar or unblocks merge; note it
  on the PR, re-request them, and resolve their threads as usual once they
  return.
- **Bring in the agents relevant to the change** rather than reviewing solo:
  - **Cloud Dragonborn** (`gds-agent-game-architect`) / **Winston**
    (`bmad-agent-architect`) for engine, data-model, or structural changes;
  - **Samus Shepard** (`gds-agent-game-designer`) for mechanics, balance, and
    player-feel (e.g. economy, ratings, events);
  - **Sally** (`bmad-agent-ux-designer`) for UI/UX and audio-feel changes;
  - `/security-review` for anything touching untrusted input, saves, or
    persistence.

  For larger or higher-risk changes, convene several of these as a party
  (`bmad-party-mode`) so the perspectives challenge each other.
- The full canon and rationale for the hot-path performance rules live in
  `_bmad-output/project-context.md` (Performance section).

## Testing discipline: shift-left and regression

These rules sit on top of the two test tiers in
[CONTRIBUTING.md](./CONTRIBUTING.md) → **Testing & coverage**:

- **Every bug fix ships a regression test that pins the failure.** Reproduce
  the reported behavior in a test that would fail on the pre-fix engine and
  passes after. Cover the state shifts around the fix (the condition
  appearing, clearing, and relapsing), not just the steady state. A fix
  without its regression test is not done.
- **Shift tests left: pin each invariant at the cheapest tier that can catch
  it.** When a defect surfaces in a heavy integration run (a multi-day
  simulated tower, an e2e spec) or in a player save, do not leave the only
  guard there. Add a small unit test that fails in milliseconds on the same
  root cause. Heavy scenario tests are canaries; they are not a substitute
  for unit guards on the invariant itself.
- **Fixtures must assert their own construction.** Every `place` / `build` /
  `placeTransport` call a test's claim depends on must check `ok` (or assert
  the resulting count). A fixture that silently degrades tests a different
  tower than the one described, and its green result is a lie. When a fixture
  encodes a topology claim (served, reachable, stranded, zoned), assert the
  claim directly before running the scenario. Precedent: the phase2 endgame
  tower shipped for months with no sky lobbies and no express elevators
  because nothing checked `ok`, and it kept passing for the wrong reason.

## Docker housekeeping: clean up after yourself

Agent runs that spin up Docker (most often the pinned Playwright screenshot
container, see [CONTRIBUTING.md](./CONTRIBUTING.md) → **Screenshots**) leave
cruft that never shrinks on its own: a stopped container per run, dangling image
layers, and build cache. Left unattended it balloons the WSL data disk
(`docker_data.vhdx`), which has already filled a contributor's system drive once
(308 GB of leftovers). So clean up after any run that used Docker:

- **Prefer self-cleaning containers: `docker run --rm ...`** so the container
  deletes itself when it exits, and give it a known `--name` so you can find it
  if it does not. For the pinned Playwright container this is the common case
  and the whole cleanup, no pruning needed.
- **Remove your run's own artifacts by name or ID**, not with a blanket prune:
  `docker rm -f <name>` for a container the run left behind, `docker rmi
  <image>` for an image the run built. The daemon is shared with the rest of
  your machine, so target what this run created rather than everything unused.
- **Blanket `prune` is daemon-wide: only run it on a dedicated dev box, and
  never in CI or on a shared host.** `docker container prune`, `image prune`,
  and `builder prune` remove *all* stopped containers, *all* dangling images,
  and *all* unused build cache, which can wipe another project's stopped
  container or still-useful cache. Where that is acceptable (a personal machine
  used only for this repo) it is the quickest way to reclaim space; a guarded,
  personal-settings hook is a better home for it than a repo-wide default. Even
  then keep it to plain `prune`: no `-a` (spares tagged images, so the pinned
  Playwright image is not re-pulled) and no `--volumes` (spares named volumes,
  which can hold data).
- **A wedged Docker CLI (hangs a minute or more when its disk is overstuffed)
  is a human-confirmed recovery, not an automatic step.** The filesystem-level
  reset (stop Docker Desktop, `wsl --shutdown`, delete `docker_data.vhdx` so
  Docker recreates an empty one) destroys **every** image, container, and named
  volume on the machine, so treat it as a last resort: back up anything you need
  first (Docker's backup-and-restore guidance covers exporting volumes) and get
  a human to confirm before deleting the disk.

## Gameplay model notes

- Facilities are defined in `src/engine/facilities.ts`. Each has a `width` (in
  tiles) and optional `floors` (height in stories; e.g. the cinema is 2).
- `basement: true` facilities (parking, recycling, metro) may only be built
  underground; the metro spans a whole basement floor.
- The tower grid is two-layered: a structural layer (floor/lobby) and a room
  layer that sits on top, exactly like the original SimTower corridor model.
