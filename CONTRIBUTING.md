# Contributing to Verticopolis

Verticopolis is an unofficial, from-scratch homage to the 1994 game *SimTower* —
a browser-native high-rise builder written in TypeScript, with its own code and
art. It is not affiliated with or derived from the original; the canon it mirrors
is behavior, not assets.

This is the contributor guide — the source of truth for how work gets done here:
running the app, the gates every change must pass, the testing & coverage model,
the architecture you're building within, how versioning works, and how changes
get reviewed and merged. Read the relevant section before anything beyond a
one-line tweak.

## Getting started

You need Node matching **[`.nvmrc`](./.nvmrc)** (currently `22.22.0`;
`package.json` `engines` requires `>=22.12.0`). With `nvm`:

```bash
nvm use            # picks up .nvmrc
npm install
npm run dev        # Vite dev server on http://localhost:5173
npm run build      # production build into dist/
```

`npm run dev` serves the game with HMR (the service worker is disabled in dev so
it can't cache-poison reloads). `npm run build` must succeed — it is one of the
quality gates below.

## Quality gates

Run all four before pushing; they must be green. CI
(`.github/workflows/test.yml`) runs the same on every PR.

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint src
npm test            # vitest run (Tier-1 unit tests)
npm run build       # production build must succeed
```

`npm run test:coverage` (`vitest run --coverage`) is the **CI coverage gate** —
it enforces the coverage floors described below and fails the build if any floor
is breached. Run it locally when you touch measured code.

## Testing & coverage

Verticopolis has **two test tiers**:

- **Tier-1 — vitest unit tests** (`src/tests/**/*.test.ts`). Fast, headless, run
  under a **happy-dom** environment (formerly jsdom). This is what `npm test`
  runs. It covers the engine, game controllers, UI logic, sprites, audio, and
  storage. The suite has generous timeouts (30s) because a few tests drive many
  in-game days of the full simulation over a tall tower.
- **Tier-2 — Playwright end-to-end** (`e2e/*.spec.ts`). Drives the **real, built
  app** in a live browser (Chromium via `vite preview`), reaching into the game
  through the public `window.game` API. Run it with `npm run e2e` after a build.
  Specs cover boot/integration, milestones, a full win, and visual baselines.
  See [`playwright.config.ts`](./playwright.config.ts) for how visual baselines
  are minted by CI (local runs smoke the flows but skip pixel comparison unless
  `PW_VISUAL=1`).

### Coverage floors

Coverage is enforced as a **ratchet**, not a vanity number — it can't rot below
the agreed floors. Floors are measured over the whole app (not just the strong
engine layer), so the report can't overstate coverage by scoping to the parts
that are easy to test.

- **Global floor:** 85% statements / 85% lines / 80% functions / 80% branches,
  aggregated over the measured set.
- **Per-file floors** for the render and audio layers (the sprite painters, the
  pixel-sprite code, and `ToneAudioEngine`). These exist so a single weak file
  **can't hide behind strong siblings** — there is no cross-file masking. Draw
  code carries deliberately **lower BRANCH floors** because visual variants a spy
  2D context can't judge are the job of the Tier-2 Playwright visual tier, not
  the unit tier.

### What is excluded from unit coverage — and why

Only the code that genuinely **cannot run headless** is excluded. It is not
untested — it is **unit-exempt, integration-covered**, exercised by the Tier-2
e2e specs (e.g. `e2e/integration.spec.ts` boots it in a real browser):

- **`src/main.ts`** — the composition root. Its constructor boots the WebGL
  `TowerEngine`, so `new GameApp()` can't run under happy-dom. Its testable
  *logic* lives in the measured `src/game/*` controllers.
- **`src/render/excalibur/**`** — the Excalibur/WebGL engine wrapper.

Also excluded are non-product tooling entry points that are build/dev plumbing,
not game logic: the gallery/preview/excalibur pages (`src/gallery.ts`,
`src/preview.ts`, `src/excalibur-main.ts`) and the PWA bootstrap (`src/pwa.ts`),
plus the usual non-code (`*.d.ts`, `*.config.*`) and the tests themselves.

### What you might assume is untestable but ISN'T

These layers were once waved off as "device-only." They are unit-tested here, so
**follow the pattern** rather than adding new exclusions:

- **Procedural sprite painters** are driven against a **spy 2D context**
  (`src/tests/sprites.test.ts`) — the draw calls are asserted without a real
  canvas.
- **The Web-Audio engine's** real control flow runs against a **mocked Tone.js +
  a fake `AudioContext`** (`src/tests/toneAudioEngineGraph.test.ts`), with its
  inert-without-audio contract pinned separately
  (`src/tests/toneAudioEngine.test.ts`).
- **Pure logic extracted out of an untestable shell** into a measured module and
  tested there — e.g. `pwa.ts`'s payload sanitizer lives in
  `src/pwaUpdateInfo.ts` (`src/tests/pwaUpdateInfo.test.ts`).

The full coverage configuration (floors, includes, excludes) lives in
[`vite.config.ts`](./vite.config.ts).

## Architecture

For a visual tour — layer diagram, the frame loop, the engine subsystems, input
flow, and persistence — see **[ARCHITECTURE.md](./ARCHITECTURE.md)** (Mermaid
diagrams). The prose conventions below are the source of truth.

- **`src/engine/`** — pure game simulation (no DOM). Deterministic and heavily
  unit-tested. `Simulation` is the orchestrator; cohesive subsystems live in
  their own modules (`ElevatorDispatch`, `EventSystem`, `EconomySystem`, `Crowd`)
  and depend on the narrow `SimContext` interface so each is testable on its own.
  Per-tower build caps and rule-sets live here (`facilities.ts`, `gameRules.ts`).
- **`src/render/`** — canvas rendering and pixel-art sprites. Reads engine state,
  never mutates it.
- **`src/ui/`** — DOM controls (palette, status bar, dialogs), using native
  `<dialog>` for modals.
- **`src/audio/`, `src/storage/`** — sound and save/load, independent of
  rendering.
- **`src/main.ts`** — the composition root that wires input, engine, and the
  game loop together.

The tower grid is **two-layered**: a structural layer (floor/lobby) with a room
layer sitting on top, exactly like the original SimTower corridor model.

### Classic vs Modern rule-sets (`src/engine/gameRules.ts`)

A tower is founded under an immutable `GameMode` (`classic` | `modern`), chosen
once at creation and persisted. **All** behavior the two modes disagree on lives
behind the `GameRules` strategy object (`CLASSIC_RULES` / `MODERN_RULES`); the
`Simulation` holds a `readonly rules` and calls `this.rules.<x>()`.

**Tripwire — don't let mode logic smear.** The mode string is mapped to behavior
in exactly one place (`makeRules`). Never write mode-specific *logic* inline
(`if (sim.mode === "modern") { …compute… }`) in a subsystem — add a method to
`GameRules` and implement it in both rule-sets instead. Reading `sim.mode` /
`sim.rules.hasVariantHouseholds` for pure **presentation** (a toast string, a UI
section toggle) is fine; branching **engine logic** on it is the smell. Name new
rule-driven modules after the **mechanic** (e.g. condo households), never after
the mode, so a future feature isn't forced into the wrong drawer. Data-driven
reads that already return the right value in both modes (e.g. `residentCount`,
which reads a unit's stored household) stay plain accessors — they're not
decisions, so they don't belong in `GameRules`.

## Versioning

The app version lives in `package.json` (`version`) and is injected at build
time as `__APP_VERSION__` (see `vite.config.ts`) — it's shown on the splash and
is the anchor the PWA update flow reports against. It is **not** auto-derived, so
it only moves if a change moves it.

**Bump `version` in the same PR as any player-facing change**, semver by player
impact:

- **minor** (`x.Y.0`) — a new player-facing capability (e.g. a Modern-mode
  feature, a new facility, a new screen).
- **patch** (`x.y.Z`) — a player-noticeable bug fix or behavior/balance change
  (economy tuning, an evict rule, a visible UI fix).
- **no bump** — internal-only work with no player-visible effect: pure refactor,
  perf with identical behavior, tests, docs, tooling, CI.

A player-facing change that ships **without** a version bump is a review finding:
the splash — and the update prompt's build-id line — would otherwise misreport the
build as unchanged. When two open PRs both bump, whoever merges second rebases and
re-bumps. (Bump once per PR, not per commit.)

### `Player-note:` — what the update prompt shows players

The build emits `dist/version.json` (`{ version, sha, notes }`) that the running
client fetches when a new build is waiting; the update modal shows a muted
`Build <version> · <sha>` line **when that fetch succeeds** (it degrades gracefully
— the line is omitted if `version.json` can't be fetched or lacks a version, and
the `· <sha>` half is dropped when the sha is `unknown`), plus a short
**"What's new"** list only when `notes` is non-empty.

`notes` is harvested from an **optional `Player-note:` git commit trailer** — so a
build only announces something when a commit deliberately said so, and a plumbing
build stays silent (never a stale or invented changelog). Add one when, and only
when, a change is something a player would actually notice:

```
feat(rules): add Modern GameMode with variant household sizes

Player-note: Modern towers now draw families of two to five.
```

House style for the trailer text (it goes straight in front of players):

- **Player outcome, not mechanism.** Name a thing they know (Elevators, Condos,
  Modern towers) and what changed for them. Not `spawnFamily()`, not file/PR refs.
- **One short line**, present tense, ends with a period. Calm voice, matching the
  game ("New tower founded. Good luck!") — no hype.
- **Only genuinely player-facing changes earn one.** Internal refactors / perf /
  tooling get **no** trailer; that build simply shows the build-id line.
- At most **3** are shown in the modal; keep to the few that matter.

Good vs. bad:

| Change | ❌ mechanism | ✅ player outcome |
|---|---|---|
| Modern households | `Modern mode: emit 2–5-person Household entities` | Modern towers now draw families of two to five. |
| Elevator dispatch fix | `Fix express-shaft pooling regression` | Elevators pick up waiting riders more reliably. |

> Status: the modal renders `notes` today; the automatic harvest of `Player-note:`
> trailers into `version.json` at build time is wired when the first player-facing
> feature needs it. Write the trailers now regardless — they're just commit
> metadata and cost nothing until then.

## Code review

Green CI is necessary but **not** sufficient — never merge on a passing pipeline
alone.

- **Self-review before pushing.** Read your own diff end-to-end with a reviewer's
  eye — correctness (wrong conditions, off-by-one, null/undefined, missing
  `await`, broken call sites), cleanup (duplication, dead code, needless
  complexity), and **algorithmic complexity** (below) — and fix what you find
  before opening or updating a PR.
- **No Big-O regressions on hot paths.** The tick loop and render/UI refresh run
  over the whole tower every step, and towers get large (hundreds of units,
  dozens of shafts, ~100 floors, thousands of person-trips). Look entities up by
  id via `Tower.getUnit` / `getTransport` — never `units.find` / `transports.find`
  — hoist tower-wide facts out of per-unit/per-person loops, keep running counters
  instead of re-scanning, and memoize per-`revision` work. A new `.find` /
  `.filter` / `.some` nested in a loop over another collection on a per-tick or
  per-frame path is a review-blocking finding, the same as a correctness bug.
- **Deep, adversarial review before merge — not "later."** The change gets a full
  adversarial review while its context is still loaded (before pushing, or
  immediately after opening/updating the PR), not deferred to a hypothetical
  pre-merge step that never happens. A PR is not "done" until that review has run
  and its confirmed findings are fixed and re-verified on the branch.
- **Codex re-reviews automatically on every push; Copilot does not.** Copilot's
  review is a one-shot snapshot, so after pushing new commits to a PR you must
  **re-request a review from Copilot** to get it to look at the latest changes
  (the ↻ next to Copilot under Reviewers).
- **Resolve Copilot/Codex review threads** once the finding is actually addressed
  in code — and then actually **mark each thread Resolved** ("Resolve
  conversation"). A reply alone does not clear the thread, and unresolved threads
  block merge under branch protection.

## Conventions

- **American English everywhere** — comments, identifiers, strings, commit
  messages, and UI copy (`color`, `center`, `behavior`; `story`/`stories` for
  floors).
- **Keep `src/engine/` free of DOM/rendering** so the simulation stays
  deterministic and unit-testable.
- **Show visual/gameplay changes with real screenshots** in the PR's
  *Screenshots / recordings* section — committed images, not prose descriptions.
  See [docs/screenshots.md](./docs/screenshots.md) for how to capture, commit,
  and embed them.
- **Merge to `main` with a merge commit — never a squash-merge.** A standard
  merge commit keeps the branch's individual commits in history and lets the
  branch keep building cleanly afterward; squash-merging rewrites the branch into
  one commit and forces awkward force-resets for follow-up work. Squashing or
  otherwise tidying your *own* branch/PR history before it merges is fine — the
  rule is only about the merge **into `main`**.

## Where things live

| Path | What |
| --- | --- |
| `src/engine/` | Pure game simulation — no DOM, deterministic, heavily unit-tested. `Simulation` orchestrates subsystems (`ElevatorDispatch`, `EventSystem`, `EconomySystem`, `Crowd`). Build caps and rule-sets live here (`facilities.ts`, `gameRules.ts`). |
| `src/game/` | Game controllers — the testable logic behind the composition root. |
| `src/render/` | Canvas rendering and pixel-art sprites (`sprites.ts`, `sprites/**`, `pixelSprites.ts`). Reads engine state, never mutates it. |
| `src/render/excalibur/` | The Excalibur/WebGL engine wrapper (unit-exempt, e2e-covered). |
| `src/ui/` | DOM controls — palette, status bar, native `<dialog>` modals. |
| `src/audio/` | Sound (`ToneAudioEngine.ts`), independent of rendering. |
| `src/storage/` | Save/load, `.TWR` import. |
| `src/main.ts` | Composition root — wires input, engine, and the game loop. |
| `src/tests/` | Tier-1 vitest unit tests + fixtures. |
| `e2e/` | Tier-2 Playwright end-to-end specs. |
| `docs/` | Contributor docs, including `screenshots.md`. |

## License

Verticopolis is licensed in two parts: the **source code** under the **MIT
License** ([`LICENSE`](./LICENSE)), and the original **art and audio assets**
under **CC BY 4.0** ([`ASSETS-LICENSE`](./ASSETS-LICENSE.md)). By contributing,
you agree to license your code contributions under MIT and any asset
contributions under CC BY 4.0. It is an unofficial homage to SimTower (1994),
ships no original-game assets, and is not affiliated with Maxis / OPeNBooK /
Vivarium.
