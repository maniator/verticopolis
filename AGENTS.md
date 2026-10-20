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
The Rust engine in `engine-rs/` follows these rules with no grandfathered
comments, plus the 500-line file ceiling (see CONTRIBUTING "Conventions").

## Use BMAD-METHOD for non-trivial work

This repo has **BMAD-METHOD** (BMM core + CIS + BMGD) installed. Default to its
agents and workflows for anything beyond a one-line tweak: planning, design,
building, and review. The skills are available to **both Claude Code**
(`.claude/skills/`, invoke as `/bmad-*` / `/gds-*` / `/bmad-cis-*`) **and GitHub
Copilot** (`.agents/skills/` + custom agents in `.github/agents/*.agent.md`).
When unsure where to start, run **`bmad-help`** and let it route you.

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

## Claim an issue before you start it

Several agent sessions often run at once, and two of them can pick up the same
issue. On 2026-10-10 that happened twice: #925 and #930 both built the catalog
for #913, and #929 and #928 both built the engine-owned charges for #914. Each
pair took the same approach, and two of the four PRs were closed. To stop that:

1. **Look before you branch.** Search the open PRs and remote branches for the
   issue number (and the issue's own comments) before writing any code. If
   another session already has an open PR or a claim comment on it, stop and
   ask the user instead of starting a parallel version.
2. **Claim it.** If nothing is there, comment on the issue right away with the
   branch name and the session link, then push the branch and open a draft PR
   as soon as it has its first commit. The draft PR's `Closes #N` line is the
   claim other sessions will find.
3. **Fold a duplicate into the survivor.** If you find a duplicate after the
   fact, keep the PR that is further along, carry anything the other one has
   that it lacks (a finding, a test, a refactor) to that PR or its follow-up
   issue, and close the other with a comment that points to where its ideas
   went.

## Code review: the agent workflow

Follow [CONTRIBUTING.md](./CONTRIBUTING.md) → **Code review** for the review
requirements every change must meet (self-review, the hot-path complexity
review, the deep adversarial review before merge, re-requesting Copilot, and
resolving review threads). On top of that, in an agent session:

- **MANDATORY: the deep review IS running the BMGD/BMAD review skill:
  `/gds-code-review` for gameplay/engine work, `/bmad-code-review` for anything
  else (storage, persistence, tooling, UI plumbing).** That skill's parallel
  adversarial layers (Blind Hunter → Edge Case Hunter → Acceptance Auditor, plus
  the Hot-Path Auditor on a hot-path diff, then triage) ARE the deep review. A self-read, a generic `/code-review`, or an
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
- **Hot-path complexity review.** The checklist is
  [`docs/performance/hot-path-review.md`](./docs/performance/hot-path-review.md).
  The team overrides `_bmad/custom/gds-code-review.toml` and
  `_bmad/custom/bmad-code-review.toml` load it into both review skills, which
  add a Hot-Path Auditor layer (diff plus repository access) on a hot-path diff
  and print one record row per checklist item, which goes on the PR as a
  comment; a review without that record does not count as the deep review.
  Triage a hot-path finding as `patch` or `defer` under its section 7, never
  `dismiss` because the code was inherited.
  When porting engine code, compare the TypeScript's caches first (HP-8) and
  put the complexity note in the PR. Copilot and Codex reviewing a PR here
  apply the checklist inline and are asked to print the same record (see
  Review guidelines below), and an independent reviewer's GO or CONDITIONAL GO
  needs it. The surrounding canon lives in
  `_bmad-output/project-context.md` (Performance section).

## Review guidelines

For any reviewer that reads this file, Codex included: on a diff that touches a
hot-path surface (section 1 of
[`docs/performance/hot-path-review.md`](./docs/performance/hot-path-review.md)),
apply items HP-1 to HP-12, trace callers in the repository, and print the
section 6 record with one row per item. Report pre-existing findings too,
marking each one `patch` or `defer` under section 7 (for a pre-existing one,
name the open issue that lists it, if any); the author resolves them. A
review skill run posts the record on the PR.

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
