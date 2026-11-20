# Contributing to Verticopolis

Verticopolis is an unofficial, from-scratch homage to the 1994 game *SimTower*:
a browser-native high-rise builder with its own code and art. The simulation
is a Rust engine compiled to WebAssembly, built and published from
[Verticopolis/engine](https://github.com/Verticopolis/engine); the rendering,
audio and engine host come from
[Verticopolis/components](https://github.com/Verticopolis/components); this
repository is the game around them (UI, storage, the app shell, the player's
manual), in TypeScript. It is not affiliated with or derived from the original; the canon it mirrors
is behavior, not assets.

This is the contributor guide, the source of truth for how work gets done here:
running the app, the gates every change must pass, the testing & coverage model,
the architecture you're building within, how versioning works, and how changes
get reviewed and merged. Read the relevant section before anything beyond a
one-line tweak.

## Getting started

You need Node matching **[`.nvmrc`](./.nvmrc)** (currently `26.13.0`;
`package.json` `engines` requires `26.x`). With `nvm`:

```bash
nvm use            # picks up .nvmrc
npm install
npm run dev        # Vite dev server on http://localhost:5173
npm run build      # production build into dist/
npm run preview    # serve that build on http://localhost:4173
```

`npm run dev` serves the game with HMR (the service worker is disabled in dev so
it can't cache-poison reloads). `npm run build` must succeed. It is one of the
quality gates below.

Add `?debug=fps` to the game's URL (on a dev server, a preview or the live
site) for a small frame statistics overlay in the bottom-left corner: frames
per second, frame, update and draw time, and Excalibur's draw calls and drawn
images for the last frame. It is a DOM box, so it adds nothing to the draw
calls it counts, and it loads as its own chunk only when the flag is on.
`?debug=all` turns on every debug flag (`src/debugFlags.ts`). On a dev server,
a branch preview or staging, `localStorage.setItem("vc-debug", "fps")` in the
console keeps the overlay on across reloads without the query string
(`removeItem` turns it off); production ignores the stored key.

## Quality gates

Run all four before pushing; they must be green. CI
(`.github/workflows/test.yml`) runs the same on every PR that touches
TypeScript, tooling or shared files. Two narrower lanes skip what a change
cannot reach (`src/build/prLane.ts` holds the rules): a PR that changes only
docs, planning files or `.changes` notes runs the unit tests and the build
without coverage, and a PR that changes only CI metadata runs nothing.
Package and lock files (which pin the engine and components) and `test.yml`
always run everything. Every required check still reports a result on a
skipped lane.

```bash
npm run typecheck   # tsc --noEmit, then the api/ project, then scripts/ and tools/, then e2e/ and the Vite and Playwright configs
npm run lint        # eslint src api
npm run format:check  # Prettier; `npm run format` rewrites the files
npm test            # vitest run (Tier-1 unit tests)
npm run build       # production build must succeed
```

`npm run test:coverage` (`vitest run --coverage`) is the **CI coverage gate**. It
enforces the coverage floors described below and fails the build if any floor
is breached. Run it locally when you touch measured code. CI runs it without
`src/tests/integration/condoRelocationEngine.integration.test.ts` and
`src/tests/integration/roomCountsEngine.integration.test.ts`, which have their
own step without coverage (the 30-year condo run and the every-step
room-count walk are too slow under coverage on a shared runner), and splits
the rest across four runners whose reports the `test` job merges before it
applies the floors; `npm test` still runs everything.

Workflow YAML and test-runner configuration are configuration, not behavior.
Do not create standalone test files, or add assertions to existing tests, that
read `.github/workflows/*.yml`, `playwright.config.ts`, `vite.config.ts` /
Vitest settings, or other CI/test configuration just to match source text,
regular expressions, filenames, step names, job blocks, worker counts, flags,
or snapshots. These checks duplicate the configuration, can pass when it
behaves incorrectly, and break on harmless refactors. Do not move the same
source-text assertion to another file to satisfy a review.

Verify workflow/config changes with the actual tools and observed behavior:
use a workflow-aware linter such as `actionlint` for YAML, inspect resolved
Playwright/Vitest settings and test discovery where relevant, and run the real
CI jobs to check pass/skip counts, artifacts, coverage and timings. Test
executable helpers, validators and runtime behavior directly when they have a
real contract. Do not add a config-text guard merely because a PR description
promised one; correct the description instead. Do not remove existing tests
as incidental cleanup; review any existing source-text guards separately.

**No new guard tests** (owner, 2026-11-14). Do not add a `*.guard.test.ts`
file, or any other meta-test that scans source, workflow or configuration
files instead of exercising behavior. The guards already in `src/tests/` stay
until each is reviewed on its own; adding an entry to an existing guard's
allowlist or shrinking its ratchet is fine. A new rule goes in a review
checklist, a lint rule or a test of the code it governs.

## Testing & coverage

Verticopolis has **two test tiers**:

- **Tier-1: vitest** (`npm test`, i.e. `vitest run`). Fast, headless, run under a
  **happy-dom** environment. Covers the game controllers, UI logic, sprites,
  audio and storage, and (in the integration project) the Rust engine through
  its WASM binding. The engine's own rules are Rust tests in
  Verticopolis/engine. The suite has generous
  timeouts (30s) because a few tests drive many in-game days of the full
  simulation over a tall tower. It is split by filename into two **vitest
  projects** (`vite.config.ts` `test.projects`):
  - **unit** (`*.test.ts`): sits next to the module it covers (`foo.ts` +
    `foo.test.ts`) and mocks its collaborators, the engine included (see
    **What every test must do** below). `npm run test:unit` runs only these.
  - **integration** (`*.integration.test.ts`): drives several modules or a whole
    `Sim`/`Tower` (golden-master round-trips, playthroughs, subsystem flows).
    These typically live under `src/tests/integration/`, but the `.integration`
    suffix (not the directory) is what assigns the tier: the two projects split
    on filename, so a `*.integration.test.ts` anywhere under `src/` runs in this
    tier and never in unit, and the pair covers every test with no gap.
    `npm run test:integration` runs only these.
    The engine comes from npm, pinned in `package.json`: `@verticopolis/engine`
    is the player build the game ships, and the same package carries
    `@verticopolis/engine/tooling` (the build with the binding's tier 3 test
    ops, which `npm run dev`, a `VC_TOOLING=1` build and the WASM suites use)
    and `@verticopolis/engine/conformance` (the conformance scenarios, their
    pinned hashes, the catalog digests and the fixtures). `npm install` copies
    the player build into `src/public/engine/` (`scripts/engine-install.ts`),
    which is build output and is not checked in. The conformance suite runs
    in this tier: `conformanceWasm.integration.test.ts` replays every
    scenario of the installed conformance package on the installed engine and
    must reproduce its hashes, so the engine the game pins is the one the
    lock describes. The lock, the engine's goldens, its fuzzers and its Rust
    tests live in Verticopolis/engine, which owns every simulation rule (see
    its CONTRIBUTING.md); the rendering, audio, binding and host modules come
    from `@verticopolis/components`. To move the game to a new engine, raise
    the `@verticopolis/engine` pin in `package.json` and run `npm install`;
    the suites check the rest.

    Every build (`npm run build`, a dev serve and the deploy alike) runs the
    WASM engine alone, with no fallback: an engine that cannot start stops the
    game with a message. `npm run build` refuses a build without the engine
    package (its precache check, `scripts/verify-precache.ts`), and
    `VC_ALLOW_NO_ENGINE=1 npm run build` is a deliberate build without it (it
    cannot run the game; it exists for tooling that never boots one). Its
    postbuild check (`scripts/verify-engine-bundle.ts`) reads the emitted
    sourcemaps and fails a build that ships test code, a production build
    that ships the harnesses' tower (#921), and a build that does not
    precache the engine package. A Vercel preview keeps the restored
    `node_modules` when it is exactly the tree `npm ci` left for the same
    lockfile, Node and npm (`scripts/vercel-install.sh`); every other build
    runs `npm ci`. See `docs/performance/player-bundle.md` for what ships and
    why.

    **Suites on the engine port.** A converted suite does not build a
    `Simulation` and poke it. It declares itself with `describeEngines`
    (`src/tests/portKit/portSim.ts`) and drives one `PortSim` per test: port
    commands (`build`, `buildTransport`, `tick`), the tooling-only members
    (`startFire`, `bombThreat`, `setMoney`), and reads from `sim.state`, a
    read-only copy of the engine's own save. A fixture's raw tower edits go
    through `sim.setup(draft => ...)`, which opens the save as a draft, edits
    it and loads it back, and works only before the first tick since a load.
    The body runs on the Rust engine.
    List a converted file in `src/tests/portKit/converted.txt` (a guard checks
    the list), and `npm run test:port` (part of `npm run test:wasm`) runs it
    with the Rust leg required. Without the engine package the Rust leg skips.

    **The suites on the WASM engine.** `npm run test:wasm` runs the suites
    that start the Rust engine themselves (conformance, the goldens' Rust
    legs, the telemetry and log-text comparisons, perf comparison) with the
    engine package required. CI runs it
    once per PR in three shards, reported as the required
    `test-engine (host)` check; the
    `test-engine (unit)` leg runs the unit tests with the package
    required, so the package's own tests run instead of skipping. The Rust
    workflow uses its own `on.push.paths` list to select PR engine jobs, so
    there is no second independent list or YAML snapshot test.

  `npm test` (`vitest run`) runs **both** projects and is the CI gate. Coverage
  stays a single root-level measurement across both projects (see Coverage
  floors below), so the ratchet still scores the whole app. Colocation is rolling
  out per area, so many unit tests still live under `src/tests/` today; write new
  ones next to their source.
- **Tier-2: Playwright end-to-end** (`e2e/*.spec.ts`). Drives the **real, built
  app** in a live browser (Chromium via `vite preview`), reaching into the game
  through the `window.game` tooling API. That handle exists only in dev serves
  and `VC_TOOLING=1` builds; a production build compiles it away so shipped
  sessions carry no console handle into the sim. Run it with `npm run e2e`
  after a tooling build (`VC_TOOLING=1 npm run build`). Against a production
  build the run stops at once in its global setup (`e2e/global-setup.ts`) with
  a message naming `VC_TOOLING=1`, instead of every spec timing out.
  There is one build and two Playwright projects, split by how the specs need
  the machine (see [`playwright.config.ts`](./playwright.config.ts)):
  `chromium-serial` holds the pinned visual/perf checks (`engineIdentity`,
  `engineStatusRows`, `visual`, `perf`, `overviewMapPerf`) and runs with one worker, as
  the `e2e-serial` job; `chromium` holds the general browser regression suite,
  including `e2e/engineBoot.spec.ts` (boot, failures and offline start), and CI
  runs it as the `e2e-general` job, in eight shards on eight runners. The spec
  files are split by measured time (`scripts/e2e-shards.ts`, with the seconds
  in `src/tests/ci/e2eShardSeconds.json`); a new spec counts six seconds a test
  until the table is refreshed with `node scripts/e2e-shards.ts measure` over
  one run's shard logs. The first shard also runs the negative bundle canary,
  and the shard that runs `milestones.spec.ts` uploads the milestone
  screenshots (`milestone-screenshots`). `npm run e2e` runs both locally; pass
  `--project=chromium` or `--project=chromium-serial` for one.
  The suite runs on the Rust engine only, and so does the perf gate, whose
  baseline is the Rust engine's.
  Specs cover boot/integration, milestones, a full win, and visual baselines.
  See [`playwright.config.ts`](./playwright.config.ts) for how visual baselines
  are minted by CI (local runs smoke the flows but skip pixel comparison unless
  `PW_VISUAL=1`).

### Regenerating screenshot drift and visual baselines locally

Canonical screenshots may be regenerated locally, but only inside the same
Playwright Docker image CI uses. The image tag is derived from the exact
Playwright version in `package-lock.json`, so local output uses the same Chromium
and system fonts as the drift and visual-baseline workflows.

Docker is required. Start from the repository root and resolve the pinned image:

```bash
PW_VERSION="$(
  node -e "
    const lock = require('./package-lock.json');
    const pkg = require('./package.json');
    const installed = lock.packages && lock.packages['node_modules/playwright'];
    process.stdout.write(
      (installed && installed.version) ||
      pkg.devDependencies.playwright.replace(/[^0-9.]/g, '')
    );
  "
)"
PW_IMAGE="mcr.microsoft.com/playwright:v${PW_VERSION}-jammy"
```

The Playwright image ships an older Node than the repository requires, so each
command below installs the version from `.nvmrc` inside the disposable container.
`node_modules` stays in a Docker volume, `dist/` stays in a temporary filesystem,
and only the regenerated PNGs are written back to the working tree.

To regenerate the committed `docs/screenshots/**` gallery and review its drift:

```bash
docker run --rm --ipc=host \
  -e CI=1 -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
  -v "$PWD:/work" -w /work \
  --mount type=volume,src=verticopolis-node-modules,dst=/work/node_modules \
  --tmpfs /work/dist:exec \
  "$PW_IMAGE" bash -lc '
    set -euo pipefail
    npm install --global n >/dev/null
    n "$(cat .nvmrc)" >/dev/null
    hash -r
    export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
    PW_CHROME="$(
      ls -d /ms-playwright/chromium-*/chrome-linux*/chrome 2>/dev/null | head -1
    )"
    export PW_CHROME
    test -x "$PW_CHROME" || { echo "Pinned Chromium was not found."; exit 1; }
    npm ci
    npm run screenshots
    chown -R "$HOST_UID:$HOST_GID" docs/screenshots 2>/dev/null || true
  '
git status --short -- docs/screenshots
git diff --stat -- docs/screenshots
```

For the exact twice-render determinism check used by the drift workflow, replace
`npm run screenshots` in that container command with:

```bash
node scripts/screenshot-determinism-check.ts --all
```

To regenerate `e2e/visual.spec.ts-snapshots` in the same pinned image (its
`npm run build` needs the engine packages, which `npm install` on the host
puts in `src/public/engine/` and `node_modules/@verticopolis/engine/tooling/`
for a `VC_TOOLING=1` build; see the engine note above):

```bash
docker run --rm --ipc=host \
  -e CI=1 -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
  -v "$PWD:/work" -w /work \
  --mount type=volume,src=verticopolis-node-modules,dst=/work/node_modules \
  --tmpfs /work/dist:exec \
  "$PW_IMAGE" bash -lc '
    set -euo pipefail
    npm install --global n >/dev/null
    n "$(cat .nvmrc)" >/dev/null
    hash -r
    export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
    npm ci
    VC_TOOLING=1 npm run build
    npx playwright test e2e/visual.spec.ts --update-snapshots
    chown -R "$HOST_UID:$HOST_GID" e2e/visual.spec.ts-snapshots 2>/dev/null || true
  '
git status --short -- e2e/visual.spec.ts-snapshots
git diff --stat -- e2e/visual.spec.ts-snapshots
```

Review every changed image before committing it. The CI routes remain available:
approve `pr-drift-check`'s `commit-on-approval` job for the docs gallery, or push
a head commit containing `[update-baselines]` for the Playwright baselines.
A plain host `npm run screenshots` is still preview-only because host Chromium
and font rasterization may differ from the pinned image. See
[`docs/screenshots.md`](./docs/screenshots.md) for the workflow details.

The gallery and the Playwright visual baselines are both the Rust engine's
(#1353), one set of images each. The gallery generator hosts the tower on the
WASM engine, and it needs the engine package (`npm install`). The
baselines are minted and compared on the `chromium-serial` project, in `npm run
e2e` and in `update-visual-baselines`.

### What every test must do

A test earns its place by failing when the code it names breaks. PR #1923
showed the failure mode: "unit" tests replayed recorded engine answers through
a stand-in port and asserted the recorded values back, so they passed whatever
the code under test did. The rules:

- **A unit test mocks the engine.** It stands in for the engine port (or any
  collaborator) with `vi.fn` spies. JSON fixtures are allowed only as the
  canned answers those spies return. The test asserts the calls the code made
  (`toHaveBeenCalledWith`) and what the code did with the answers: the state
  it left, the value it returned, the DOM it drew. It never starts the Rust
  engine.
- **A check that needs the real engine is an integration test**
  (`*.integration.test.ts`, listed in `test:wasm:host` when it needs the
  package) **or a Rust test** in Verticopolis/engine.
- **No recorded engine answers.** Never capture what the engine said and replay
  it as a stand-in engine, and never refresh a unit test's fixtures from a live
  engine. (The conformance locks and catalog digests are written from the Rust
  engine on purpose: they pin the engine itself, checked in the integration
  tier.) A
  value a test pins comes from the rule it checks (the 1994 original, the
  catalog, a hand-worked example). A value captured from a past run of the
  same code checks nothing.
- **Every test asserts what its name promises.** A test named for a behavior
  checks that behavior. "Does not throw" is enough only for a test whose name
  says so (a "never throws" contract). Asserting that a mock returned what the
  test told it to return checks nothing.

`src/tests/testHonesty.guard.test.ts` holds the parts a machine can check: no
unit test reaches a module that starts a real engine (directly or through test
fixtures), no `recordings` directory or `*:record` script, and no `it`/`test`
in the unit, integration or e2e tiers without an assertion. Its allowlist,
`src/tests/testHonesty.allow.txt`, only shrinks, and each line carries its
reason. The rest is review work:
the review skills, Copilot and PR-Agent check it on every PR.

### Coverage floors

Coverage is enforced as a **ratchet**, not a vanity number. It can't rot below
the agreed floors. Floors are measured over the whole app (not just the strong
engine layer), so the report can't overstate coverage by scoping to the parts
that are easy to test.

- **Global floor:** 93% statements / 94% lines / 94% functions / 86% branches,
  aggregated over the measured set (`coverage.thresholds` in
  [`vite.config.ts`](./vite.config.ts)).
The renderer, the sprites and the audio graph, which had their own per-file
floors here, live in Verticopolis/components now and keep their floors there.

### What is excluded from unit coverage, and why

Only the code that genuinely **cannot run headless** is excluded. It is not
untested. It is **unit-exempt, integration-covered**, exercised by the Tier-2
e2e specs (e.g. `e2e/integration.spec.ts` boots it in a real browser):

- **`src/main.ts`**: the composition root. Its constructor boots the WebGL
  renderer from `@verticopolis/components`, so `new GameApp()` can't run under
  happy-dom. Its testable *logic* lives in the measured `src/game/*`
  controllers.

Also excluded are non-product tooling entry points that are build/dev plumbing,
not game logic: the gallery/preview pages (`src/gallery.ts`,
`src/preview.ts`), the PWA bootstrap (`src/pwa.ts`), the harnesses' tower
(`src/game/toolingTower.ts` and `toolingSim.ts`, which drive the Rust engine
package the coverage run does not build; their tests run on the `test-engine (unit)` leg,
and the e2e specs and the screenshot gallery drive them),
plus the usual non-code (`*.d.ts`, `*.config.*`), fixtures (`*.fixture.ts`)
and the tests themselves.

### What you might assume is untestable but ISN'T

These layers were once waved off as "device-only." They are unit-tested here, so
**follow the pattern** rather than adding new exclusions:

- **Pure logic extracted out of an untestable shell** into a measured module and
  tested there, e.g. `pwa.ts`'s payload sanitizer lives in
  `src/pwaUpdateInfo.ts` (`src/pwaUpdateInfo.test.ts`).

The full coverage configuration (floors, includes, excludes) lives in
[`vite.config.ts`](./vite.config.ts).

## Architecture

For a visual tour (layer diagram, the frame loop, the engine subsystems, input
flow, and persistence) see **[ARCHITECTURE.md](./ARCHITECTURE.md)** (Mermaid
diagrams). The prose conventions below are the source of truth.

- **`@verticopolis/components`**: the canvas renderer and pixel-art sprites
  (`render/`), the audio (`audio/`), the catalog handle (`catalog/`), the
  engine binding and hosts (`binding/`, `host/`, `port/`), shared types and the
  window chrome styles. The game imports them by subpath. The renderer reads
  engine state and never mutates it.
- **`src/ui/`**: DOM controls (palette, status bar, dialogs), using native
  `<dialog>` for modals. The `UI` class is a thin shell over friend-modules that
  take the instance: the lit-html template bodies (`templates/`), the dialog
  controllers (`uiDialogs`), the editor/inspector panels (`uiPanels`), the
  status/log pump (`uiStatus`), and the palette build (`uiPalette`).
- **`src/storage/`**: save and load, independent of rendering.
- **`src/main.ts`**: the composition root that wires input, engine, and the
  game loop together.

Code reads the catalog through the catalog handle (`towerCatalog`,
`catalogTypes`, `@verticopolis/components/catalog/*`), the frame view
(`@verticopolis/components/host/frameView`) or an engine query (#868).

The tower grid is **two-layered**: a structural layer (floor/lobby) with a room
layer sitting on top, exactly like the original SimTower corridor model.

### Classic vs Modern rule-sets

A tower is founded under an immutable `GameMode` (`classic` | `modern`), chosen
once at creation and persisted. Behavior the two modes disagree on belongs
behind the mode's rule methods in the Rust engine (`engine-rs/src/rules/` in
Verticopolis/engine), which the simulation calls. In this repository,
`src/tests/modeBranch.guard.test.ts` fails a new inline test of the mode in
the TypeScript, and `src/tests/modeBranch.ratchet.txt` lists the old ones,
which only go down. Move such a test into the catalog when you change that
code, and lower its line in the same PR.

**Tripwire: don't let mode logic smear.** Map the mode to behavior in one
place, a rule method. Never write
mode-specific *logic* inline (an `if` on the mode that computes something) in a
subsystem. Add a rule method instead. The web UI does not decide a mode rule
from the mode's name either: when it needs one (whether the stats panel shows
households, whether the build preview names a refusal), the engine states it in
the catalog, from the engine's own rule method, and the UI reads it there. A
few UI choices still key on the mode's name; #1621 tracks them, and each moves
to the catalog when it next changes. Showing the mode's own name (the tower
badge, a save slot's chip) is presentation and fine. Name new
rule-driven modules after the **mechanic** (e.g. condo households), never after
the mode, so a future feature isn't forced into the wrong drawer. Data-driven
reads that already return the right value in both modes (e.g. `residentCount`,
which reads a unit's stored household) stay plain accessors. They're not
decisions, so they don't need a rule method.

## Versioning

The app version lives in `package.json` (`version`) and is injected at build
time as `__APP_VERSION__` (see `vite.config.ts`). It's shown on the splash and
is the anchor the PWA update flow reports against. It is **not** auto-derived, so
it only moves if a change moves it.

A feature PR never edits a version. It records the tier in a change note, and
a release PR raises the versions (see "Change notes and the release PR" below).
That release step runs `npm version <level> --no-git-tag-version`, which also
updates **`package-lock.json`** in lockstep (a stale lockfile breaks `npm ci`
and misreports the build). A CI guard, `src/tests/versionLockSync.test.ts`,
fails the moment the two drift.

Every release becomes a GitHub release on its own. When a release PR merges,
`.github/workflows/release-tag.yml` tags the merge commit `v<version>` and
dispatches `.github/workflows/github-release.yml` on that tag, which publishes
the release with the version's player notes. A maintainer can still tag a
commit by hand (`git tag v2.30.0 <commit> && git push origin v2.30.0`), or run
"GitHub release" from the Actions tab with "Use workflow from" set to the tag.
Either way the run checks out its own tag and no other ref. It publishes when
the tag has no published release and leaves a published one alone. The
sprite atlas is baked and released from Verticopolis/components, which holds
the art.

**Declare the tier in the same PR as any player-facing change.** The tier is keyed
to one question: would a player notice anything different?

- **major** (`X.0.0`): the save format or compatibility breaks (an old tower
  would no longer load), or a deliberate headline/milestone release. Rare and
  intentional, never incidental.
- **minor** (`x.Y.0`): something new a player can use or see: a feature, a
  new room, setting or tool, or a balance shift.
- **patch** (`x.y.Z`): a bug fix or a behavior correction with nothing new
  added, even one a player notices (a room that drew the wrong people, a
  wrong figure, a hotfix to an already-shipped release).
- **no bump**: internal-only work with no player-observable effect at all (pure
  refactor, identical-behavior perf, tests, docs, tooling, CI).

The owner set this split on 2026-11-14, replacing the earlier "minor for any
visible change" rule: a fix stays a patch however visible it is, and minor is
kept for new features.

A player-facing change whose note says `app: none` (or has no note) is a review
finding: the splash (and the update prompt's build-id line) would otherwise
misreport the build as unchanged. One note per PR, not per commit.

### Change notes and the release PR

Every PR that changes a deployed path (anything `scripts/vercel-ignore-build.sh
--classify` calls "build") adds one file, `.changes/<branch-slug>.md`, with the
app tier and the changelog lines. The format and its rules are
in [`.changes/README.md`](./.changes/README.md). The file is named after the
branch, so two open PRs never edit the same line and never conflict over a
version. A note already on `main` belongs to the PR that merged it, so a
follow-up from the same branch name adds `.changes/<branch-slug>-2.md` (the
version check refuses an edit to a pending note outside a release PR).

Credit the people outside the project who helped. When a PR comes from a
community author, fixes an issue someone outside the project reported, or
uses someone's testing, its note adds a `## Contributors` line naming them
and what they did. The release lists those credits under the version's notes
on the GitHub release and on the help site's release notes page.

The release driver cuts a release:

1. Branch `release/<version>` off an up-to-date `main`.
2. Run `npm run release` (or `npm run release -- --app 3.0.0` for a headline
   release). It raises the app version by the highest pending `app` level,
   and writes the `CHANGELOG.md` section from the Player lines. It deletes
   the notes.
3. Trim the player lines to the few that matter (the prompt shows three),
   commit, and open the PR. It merges like any other PR, and its merge tags
   and publishes the GitHub releases.

A release consumes every pending note. If another note lands on `main` first,
cut it again from the new `main`, and never merge `main` into it. For a
release the **Cut release** workflow made, close its PR, delete its branch and
run the workflow again (it refuses a branch name that already exists, and the
version may have moved). For a hand-cut one, `git reset --hard origin/main` on
the release branch, run `npm run release` again, push with
`--force-with-lease`, and rename the branch if the version changed.

Rules for the release PR:

- **One release PR at a time.** Check that none is open before cutting one.
- **Pending notes wait while it is open.** A PR that adds a `.changes` note
  does not merge until the release lands; turn its auto-merge off meanwhile.
- **Check `main` is green first.** Two PRs can each pass a check (the
  500-line ceiling, say) and break it together once both are on `main`.
- **Screenshots never change on a release branch.** Drift that shows up only
  there is a bug to fix on `main`, never something to approve on the release.

CI's "Versions and change notes" step in the lint and build job (`npm run
version:check` locally, after committing) holds both sides to this: a feature
PR keeps every version line and changelog heading as `main` has them, keeps
`main`'s pending notes and adds a note when it changes a deployed path. A
release PR raises each version by exactly its notes' highest level (the app may
go to a later version the driver names), consumes every note and changes
nothing but the release files.

**Production waits for the release PR.** While a pending note has a level other
than `none`, `scripts/vercel-ignore-build.sh` skips the production deploy, so a
player never gets new behavior under the old version and the old "What's new"
notes. Previews still build. The release merge deletes the notes, builds, and
ships everything pending as one numbered build. Production deploys only on a
release merge: a push to `main` whose commit leaves the app version as its
parent had it is skipped, even with no note pending.

**Production deploys from the release tag.** Vercel's git integration builds
previews only (`vercel.json` turns it off for `main`). When `release-tag.yml`
tags a release merge it dispatches **Deploy production**
(`.github/workflows/deploy-production.yml`) with the `v<version>` tag. That run checks
the tag is a release on `main`, runs the gate above against its commit, builds
with `vercel build --prod` (which runs `scripts/vercel-build.sh`, engine
included) and deploys the prebuilt output, then waits until the production
domain points at that new deployment and its `/version.json` reports the tag's
commit (a redeploy of the live release serves the same `version.json`, so the
domain check is what proves it switched). To redeploy, run **Deploy production**
from the Actions tab with the release tag. A run for an older release than the
one on `main` deploys nothing unless its `rollback` box is ticked, so a slow
automatic run never puts an older release over a newer one. Each production
deployment carries its release tag and commit as Vercel metadata, so for an
instant rollback without a rebuild, find the release with
`vercel ls --prod --meta release=v<version>` and `vercel promote` its URL (the
Deploy production run's summary prints that command for its own deployment). An
app release also gets the deployed web build attached as
`verticopolis-web-<version>.zip` with its SHA-256 checksum and
`verticopolis-web-<version>.SHA256SUMS`, one checksum per file. Before a deploy passes, it checks
every file production serves (source maps aside, which production does not
serve publicly) against that list, so the live site is byte for byte the
release's build; `sha256sum -c` against the list checks a download the same
way. It
needs the `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` secrets in
the `production` environment and fails, naming the missing one, without them.

**Staging.** `staging.verticopolis.com` shows `main` before it ships.
`.github/workflows/staging-mirror.yml` force-pushes `main`'s tip to the
`staging` branch on every push, and Vercel builds it as a preview in the
project's `staging` environment (team members only, no service worker, and
its own saves). `staging` is a mirror: never commit to it or open a pull
request from it, since the next push to `main` overwrites it.

**Cutting the release.** Run the **Cut release** workflow (`release-pr.yml`)
from the Actions tab, with an app version such as `3.0.0` for a headline
release or empty for the levels the notes ask for. It runs `npm run release`
and opens the release PR with the workflow token, which starts no checks on
its own, so start them with the run button on that PR when GitHub shows one,
or else close and reopen the PR. `npm run release` on a local
`release/<version>` branch still works the same way.

### The engine and the components

The engine and the components have versions, changelogs and release lanes of
their own, in their own repositories:
[Verticopolis/engine](https://github.com/Verticopolis/engine) (the
`verticopolis-engine` crate on crates.io and `@verticopolis/engine` on npm,
with its tooling and conformance packages on each engine release) and
[Verticopolis/components](https://github.com/Verticopolis/components)
(`@verticopolis/components` on npm). A change to a simulation rule, the
binding, the renderer or the audio lands there, under that repository's
CONTRIBUTING.md, and reaches the game when a PR here raises the pin in
`package.json`. A pin move is an ordinary feature PR with a change note: the
app tier is what a player would notice from the new engine or components, and
at least `patch`, since the game players run changes (owner, 2026-11-19;
`npm run version:check` enforces it).

The engine is one pin, `@verticopolis/engine`: its tooling build
(`tooling/`) and its conformance suite (`conformance/`) ship inside the same
package, so the suites always check the engine the game ships against that
release's own conformance lock.

### The changelog, and the update label

`CHANGELOG.md` is for players, one section per app version. The engine's
changelog is `engine-rs/CHANGELOG.md` in Verticopolis/engine, and the
components keep theirs in their repository. Classify a change by what a
player would notice: an engine fix a player can feel gets a Player line in
the note of the PR that moves the pin.

The update prompt labels each update **Game update**, **Engine update** or
**Game and engine update**, with a line such as "Rust engine 0.24.0 → 0.25.0"
when the engine changed. Nobody writes the label. The build hashes the shell
(all of `src` outside tests and the engine package) and records the engine
package's crate version and sources hash. `dist/version.json` carries them
(`shell`, `engine`), the running client compares its own
(`__BUILD_FINGERPRINT__`), and `classifyUpdate` in `src/pwaUpdateInfo.ts`
picks the label. An older build with no fingerprint shows the plain prompt.

### Player notes (what the update prompt shows players)

The build emits `dist/version.json` (`{ version, sha, notes }`) that the running
client fetches when a new build is waiting; the update modal shows a muted
`Build <version> · <sha>` line **when that fetch succeeds** (it degrades gracefully:
the line is omitted if `version.json` can't be fetched or lacks a version, and
the `· <sha>` half is dropped when the sha is `unknown`), plus a short
**"What's new"** list only when `notes` is non-empty.

`notes` is read at build time from **`CHANGELOG.md`**: the `## <version>` section
whose version matches `package.json` `version` (see `changelogNotes` in
`vite.config.ts`, backed by the pure, unit-tested `notesForVersion` in
`src/changelog.ts`). It parses the file with CommonMark (`marked`, a build-time
devDependency, so nothing ships to the browser) and returns the section's bullets
as **plain text**: markdown is flattened (`**bold**` becomes `bold`, a link keeps
its label and drops the URL), so no markup reaches the update modal and that
reload-critical surface keeps lit's auto-escaping with no HTML-injection lane. A
committed file is used rather than git commit trailers because releases land on
`main` as **merge commits**, and a merge commit's message carries none of the
branch commits' trailers, so a trailer harvest would silently drop the note. The
file is always present at the exact commit the deploy builds.

The build also writes `releases`: the notes of this version and the versions
before it, newest first, ten versions with notes at most (`recentReleaseNotes` in
`src/changelog.ts`). The running client shows the versions newer than the one it
runs, or than the newest version an earlier prompt already showed
(`notesSinceRunning` in `src/pwaUpdateInfo.ts`), so a player who skipped versions
sees all of them and nobody sees a version's notes twice. Two or more versions
go in a "What's new since <version>" log that scrolls on its own once it is
long. So don't repeat an earlier version's headline in a later version's notes:
the prompt already carries it to a player who skipped it.

Cadence: one curated block **per player-noticeable release** (per PR, not per
commit). Fewer lines beat more, and a release that is a patch or internal-only
gets none, just the build-id line. The prompt shows every line of a release
whole: up to three as a plain list, more in a log that scrolls in place. A
release may carry up to `MAX_NOTES` lines of up to `MAX_NOTE_LEN` characters
each (`src/pwaUpdateInfo.ts`); `src/changelog.test.ts` fails the release PR
whose notes would not fit whole. Curation is the point: the modal is a "here's
what's new, get back in" moment, not a patch-note viewer.

For a player-facing change, write the lines under `## Player` in the PR's change
note. The release PR gathers them into a section at the top of `CHANGELOG.md`:

```
## 1.51.0

- Modern towers now draw families of two to five.
```

House style for each line (it goes straight in front of players):

- **Player outcome, not mechanism.** Name a thing they know (Elevators, Condos,
  Modern towers) and what changed for them. Not `spawnFamily()`, not file/PR refs.
- **One short line**, present tense, ends with a period. Calm voice, matching the
  game ("New tower founded. Good luck!"). No hype.
- **Only genuinely player-facing changes earn one.** Internal refactors, perf, and
  tooling get **no** line; leave the section without bullets and that build simply
  shows the build-id line.
- At most **3** are shown in the modal; keep to the few that matter.

Good vs. bad:

| Change | ❌ mechanism | ✅ player outcome |
|---|---|---|
| Modern households | `Modern mode: emit 2–5-person Household entities` | Modern towers now draw families of two to five. |
| Elevator dispatch fix | `Fix express-shaft pooling regression` | Elevators pick up waiting riders more reliably. |

## Code review

Green CI is necessary but **not** sufficient. Never merge on a passing pipeline
alone.

- **Self-review before pushing.** Read your own diff end-to-end with a reviewer's
  eye: correctness (wrong conditions, off-by-one, null/undefined, missing
  `await`, broken call sites), cleanup (duplication, dead code, needless
  complexity), and **algorithmic complexity** (below). Fix what you find
  before opening or updating a PR.
- **Hot paths get a complexity review.** The checklist is
  [`docs/performance/hot-path-review.md`](./docs/performance/hot-path-review.md).
  It covers Rust, TypeScript, the WASM binding, the hosts, simulation ticks,
  rendering and the other surfaces its section 1 lists, and ported, rewritten,
  moved or inherited code as much as new code. Trace each changed function's
  callers to an entry point (its section 2); a whole-collection walk, clone,
  sort or rebuilt map under one of its multipliers is a finding in either
  language, helpers included. A significant change (its section 5) carries the
  complexity note in the PR, and the review posts the page's section 6 record
  on the PR. A finding is fixed, or deferred with evidence and a tracked issue,
  and never dismissed because it existed before; it is dismissed only as a
  false positive (section 7): code no entry point reaches, or work whose
  written estimate fits the tier's budget. That test does not apply to an
  added, ported or rewritten scan over its tier's budget, or a cache dropped,
  removed or bypassed outside the two cases HP-8 allows (an equivalent the
  record names, or the query itself gone): those get fixed unless the owner
  accepts the deferral in their own words.
- **Deep, adversarial review before merge, never deferred to "later."** The change gets a full
  adversarial review while its context is still loaded (before pushing, or
  immediately after opening/updating the PR), not left to a hypothetical
  pre-merge step that never happens. A PR is not "done" until that review has run
  and its confirmed findings are fixed and re-verified on the branch.
- **Outside reviewers.** Copilot's review is a one-shot snapshot, so after
  pushing new commits **re-request a review from Copilot** (the ↻ next to
  Copilot under Reviewers). PR-Agent runs only on request: comment `/review`
  and `/improve` once per round ([`docs/ci/pr-agent.md`](./docs/ci/pr-agent.md)).
- **When the outside reviewers are down,** the bar does not drop. The review
  skill runs in a loop until a full pass finds nothing to fix, and the
  stand-in review skill (`.claude/skills/stand-in-pr-review/`) reports on the
  PR the way Copilot would. The review comes from someone other than the PR's
  author. [AGENTS.md](./AGENTS.md) → Code review has the steps.
- **Resolve Copilot/Codex review threads** once the finding is actually addressed
  in code, and then actually **mark each thread Resolved** ("Resolve
  conversation"). A reply alone does not clear the thread, and unresolved threads
  block merge under branch protection.

## Conventions

- **American English everywhere:** comments, identifiers, strings, commit
  messages, and UI copy (`color`, `center`, `behavior`; `story`/`stories` for
  floors).
- **No em-dashes in prose** (player-facing copy, docs, comments, commit and PR
  text) in anything new you write. Use commas, colons, parentheses, or separate
  sentences instead. Two standing exceptions: en-dashes in numeric ranges
  (`2–5`, floors `30–60`), and the standalone "—" empty-value placeholder glyphs
  in the stats/editor panels. Existing `src/` code comments are grandfathered;
  don't sweep them, but don't add new em-dashes either. Skip the "X, not Y"
  emphatic-restatement pattern and AI marketing vocabulary (leverage, seamless,
  robust, comprehensive, elevate, streamline, and the like). Keep copy plain,
  human, and grammatically correct.
- **Game logic lives in the Rust engine.** Rules, caps, prices, tuning and
  every gameplay calculation belong in the engine (Verticopolis/engine); the
  web game reads them
  through the catalog and the frame and never keeps its own copy.
- **Help and analytics change in the same PR.** A change players can see
  updates the manual in `help-site/` (in its 1990s manual style) and, when it
  adds or changes something players do, the analytics: the events in
  [`docs/analytics-data-map.md`](./docs/analytics-data-map.md) and the
  dashboard tiles that read them.
- **500 lines per file.** `src/tests/fileSize.guard.test.ts` caps TypeScript
  files (`.ts`, `.tsx`) in `src/` and `scripts/` at 500 lines, counted as
  Prettier lays them out. Test files (`*.test.ts`) are exempt (owner,
  2026-11-20). Files already over it sit on a shrink-only ratchet
  (`src/tests/fileSize.ratchet.txt`): split them, never add to them. The
  files Prettier's first pass pushed over were added once, by the owner's
  choice, when Prettier was set up.
- **Show visual/gameplay changes with real screenshots** in the PR's
  *Screenshots / recordings* section: committed images, not prose descriptions.
  See [docs/screenshots.md](./docs/screenshots.md) for how to capture, commit,
  and embed them. Canonical `docs/screenshots/**` and
  `e2e/visual.spec.ts-snapshots` pixels must come from the pinned Playwright
  Docker image. Use the local container commands under Testing & coverage, or
  use the CI refresh routes documented there. A plain host
  `npm run screenshots` remains preview-only and its output must not be committed.
- **Merge to `main` with a merge commit. Never squash-merge.** A standard
  merge commit keeps the branch's individual commits in history and lets the
  branch keep building cleanly afterward; squash-merging rewrites the branch into
  one commit and forces awkward force-resets for follow-up work. Squashing or
  otherwise tidying your *own* branch/PR history before it merges is fine. The
  rule is only about the merge **into `main`**.
- **Rebase onto `main`, never merge `main` in.** Rebase a branch when its PR
  opens and again right before it merges, fold fixups into the commits they
  fix, push with `--force-with-lease` and let CI run again. Fetch first: the
  branch may have been rebased in the GitHub UI.
- **Arm auto-merge as soon as the PR is signed off.** Once the review is
  done and its findings are fixed on a branch rebased onto the latest `main`,
  arm auto-merge with the merge-commit method and let it wait for CI: it
  merges only when every required check passes. If a check fails or a new
  finding comes in, turn auto-merge off and fix it first. No merge
  queue is in use today; `test.yml` still answers the
  `merge_group` event so the queue can be turned back on without workflow
  changes.

## Where things live

| Path | What |
| --- | --- |
| `@verticopolis/engine` (npm) | The simulation, built from [Verticopolis/engine](https://github.com/Verticopolis/engine): the Rust engine compiled to WebAssembly, the only engine the game runs. It owns the rules, caps and tuning, the catalog the UI reads, saves and `.TDT`, and undo. Its tooling and conformance packages come from the same engine release. |
| `@verticopolis/components` (npm) | Rendering, sprites, audio, the engine binding and hosts, the catalog handle and shared types, built from [Verticopolis/components](https://github.com/Verticopolis/components). |
| `src/game/` | Game controllers: the testable logic behind the composition root. |
| `src/ui/` | DOM controls: palette, status bar, native `<dialog>` modals. The `UI` shell delegates to friend-modules: `templates/` (lit-html bodies), `uiDialogs`, `uiPanels`, `uiStatus`, `uiPalette`. |
| `src/storage/` | Save/load, the `VCZ1:` storage container, `.vctower` file handling. Who owns what, and every path: [`docs/architecture/save-paths.md`](./docs/architecture/save-paths.md). |
| `api/` | Vercel serverless functions, with their own `tsconfig.json` (typecheck and lint cover them). |
| `scripts/`, `tools/` | Build, release, screenshot and perf scripts, and the SimTower harness in `tools/simtower/`. `scripts/tsconfig.json` type-checks both under `npm run typecheck`; lint does not cover them yet. |
| `help-site/` | The player manual (Astro + Starlight), served at help.verticopolis.com. Its own npm project: `npm run typecheck --prefix help-site` (`astro check`) type-checks its TypeScript and its `.astro` components after `npm ci` in both, and the Help site workflow runs it. |
| `src/main.ts` | Composition root: wires input, engine, and the game loop. |
| `src/tests/` | Vitest fixtures, integration suites (`*.integration.test.ts`) and the repository-wide guard tests; unit tests colocate next to their source. |
| `e2e/` | Tier-2 Playwright end-to-end specs. `e2e/tsconfig.json` type-checks them with `vite.config.ts` and `playwright.config.ts` under `npm run typecheck`. |
| `docs/` | Contributor docs: the architecture pages (`docs/architecture/`, start at its [README](./docs/architecture/README.md)), `screenshots.md`, and the performance and analytics references. |
| `.github/workflows/` | CI and release automation. What runs on a pull request and why: [`docs/ci/pipeline.md`](./docs/ci/pipeline.md). |

## License

Verticopolis is licensed in two parts: the **source code** under the **MIT
License** ([`LICENSE`](./LICENSE)), and the original **art and audio assets**
under **CC BY 4.0** ([`ASSETS-LICENSE`](./ASSETS-LICENSE.md)). By contributing,
you agree to license your code contributions under MIT and any asset
contributions under CC BY 4.0. It is an unofficial homage to SimTower (1994),
ships no original-game assets, and is not affiliated with Maxis / OPeNBooK /
Vivarium.
