# Contributing to Verticopolis

Verticopolis is an unofficial, from-scratch homage to the 1994 game *SimTower* —
a browser-native high-rise builder written in TypeScript, with its own code and
art. It is not affiliated with or derived from the original; the canon it mirrors
is behavior, not assets.

This file is the human-facing quick start: how to run the app, the gates your
change must pass, and — in depth — how testing and coverage work. It is a
companion to two deeper documents, not a replacement:

- **[AGENTS.md](./AGENTS.md)** — the full contributor guide: architecture,
  versioning, and review conventions. Read it for anything beyond a one-line
  tweak.
- **[CLAUDE.md](./CLAUDE.md)** — the short list of non-negotiables.

When those two disagree with this file on a rule, they win — this page points at
them rather than restating them.

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

## Code review

Every non-trivial change gets a **deep, adversarial review** before it merges —
green CI is necessary but not sufficient. Fix the blocking findings and track the
rest. See [AGENTS.md](./AGENTS.md) → **Code review** for the full protocol
(including resolving bot review threads).

## Conventions

- **American English everywhere** — comments, identifiers, strings, commit
  messages, and UI copy (`color`, `center`, `behavior`; `story`/`stories` for
  floors).
- **Keep `src/engine/` free of DOM/rendering** so the simulation stays
  deterministic and unit-testable.
- **Bump `package.json` `version` on any player-facing change** (minor for a new
  player-facing capability, patch for a player-noticeable fix/behavior change;
  internal-only work needs no bump). It is injected as `__APP_VERSION__` and
  anchors the update flow. See [AGENTS.md](./AGENTS.md) → **Versioning**.
- **Show visual/gameplay changes with real screenshots** in the PR's
  *Screenshots / recordings* section — committed images, not prose descriptions.
  See [docs/screenshots.md](./docs/screenshots.md) for how to capture, commit,
  and embed them.
- **Merge commits only** to `main` (never squash unless there's a real reason).
- **Resolve Copilot/Codex review threads** once addressed — actually mark each
  thread Resolved; a reply alone doesn't clear it, and unresolved threads block
  merge under branch protection.

## License

Verticopolis is licensed in two parts: the **source code** under the **MIT
License** ([`LICENSE`](./LICENSE)), and the original **art and audio assets**
under **CC BY 4.0** ([`ASSETS-LICENSE`](./ASSETS-LICENSE.md)). By contributing,
you agree to license your code contributions under MIT and any asset
contributions under CC BY 4.0. It is an unofficial homage to SimTower (1994),
ships no original-game assets, and is not affiliated with Maxis / OPeNBooK /
Vivarium.

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

For the deeper architecture notes (the Classic vs. Modern rule-set strategy, the
two-layer tower grid, performance rules on hot paths), see
[AGENTS.md](./AGENTS.md) → **Architecture**.
