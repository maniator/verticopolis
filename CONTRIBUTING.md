# Contributing to Verticopolis

Verticopolis is an unofficial, from-scratch homage to the 1994 game *SimTower*:
a browser-native high-rise builder written in TypeScript, with its own code and
art. It is not affiliated with or derived from the original; the canon it mirrors
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
```

`npm run dev` serves the game with HMR (the service worker is disabled in dev so
it can't cache-poison reloads). `npm run build` must succeed. It is one of the
quality gates below.

## Quality gates

Run all four before pushing; they must be green. CI
(`.github/workflows/test.yml`) runs the same on every PR that touches
TypeScript, tooling or shared files. Two narrower lanes skip what a change
cannot reach (`src/build/prLane.ts` holds the rules): a PR that changes only
`engine-rs/` sources skips lint, typecheck, the build and the plain unit run
(the Rust workflow tests the crate, and the browser, parity and integration
checks still run), and a PR that changes only docs, planning files or
`.changes` notes runs the unit tests and the build without coverage. Cargo
files, the binding (`engine-rs/src/wasm*`, `frame.rs`), package and lock files, the
conformance suite and `test.yml` always run everything, and a PR that touches
no engine path already skips the Rust workflow's jobs. Every required check
still reports a result on a skipped lane.

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint src
npm test            # vitest run (Tier-1 unit tests)
npm run build       # production build must succeed
```

`npm run test:coverage` (`vitest run --coverage`) is the **CI coverage gate**. It
enforces the coverage floors described below and fails the build if any floor
is breached. Run it locally when you touch measured code. CI runs it without
`src/tests/integration/condoRelocationEngine.integration.test.ts` and
`src/tests/integration/roomCountsEngine.integration.test.ts`, which have their
own step without coverage (the 30-year condo run and the every-step
room-count walk are too slow under coverage on a shared runner); `npm test`
still runs everything.

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

## Testing & coverage

Verticopolis has **two test tiers**:

- **Tier-1: vitest** (`npm test`, i.e. `vitest run`). Fast, headless, run under a
  **happy-dom** environment (formerly jsdom). Covers the engine, game
  controllers, UI logic, sprites, audio, and storage. The suite has generous
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
    The engine conformance suite runs in this tier: scripted scenarios in
    `conformance/` whose checkpoint hashes are pinned in
    `conformance/expected.json` and checked on the Rust engine by
    `conformanceWasm.integration.test.ts`, which is also the only writer of
    the lock. A moved hash is a simulation change: regenerate the lock only on
    purpose, in the same PR. See
    [conformance/README.md](./conformance/README.md).

    **One engine, with a TypeScript reference.** `engine-rs/` is the engine the
    game runs (app 2.66.0, engine crate 1.0.0). It is a Rust port of
    `src/engine/`, which the shipped game no longer runs: the TypeScript engine
    stays only for the tests that still run it, until its code is deleted
    (#1875). The conformance lock, the goldens and the fuzz corpus are the
    Rust engine's own regression records, written by the Rust run and checked
    natively (`cargo run --release --features conformance --bin conformance`)
    and through the WASM binding from Node with
    `npm run wasm:build && npm run test:wasm`, which also holds the engine to
    the frame-day golden: a day on every fixture at every speed, played
    through the engine's own step driver, pinned every hour.
    The `.TDT` codec has one
    implementation, `engine-rs/src/tdt/`, and the TypeScript engine reads and
    writes `.TDT` files through the WASM package
    (`src/engine/port/tdtCodec.ts`). The same command runs the `.vctower`
    writer's test, `conformanceWasmVctower.integration.test.ts`, which writes
    every fixture with the engine and reads it back through the web game's
    readers. Every build runs the WASM engine alone
    (see below), with no TypeScript fallback. The served package
    (`src/public/engine/`) is build output and is not checked in: build it
    locally to run the game, with `bash scripts/build-engine-wasm.sh`
    on x86_64 Linux (it installs the pinned toolchain) or `npm run wasm:build`
    once the toolchain in engine-rs/README.md is installed. `npm run e2e`
    needs it too, since every spec runs on the WASM engine, and so does `npm run build`: its precache check
    (`scripts/verify-precache.ts`) refuses a build without the engine, so no
    build ships a silent TypeScript fallback. Without a Rust toolchain, run
    `VC_ALLOW_NO_ENGINE=1 npm run build` for a deliberate build without the
    engine (it cannot run the game, and a dev serve without the package stops on the engine failure screen; it exists for tooling that never boots one). A stale local build fails the unit test that checks its source
    hash. CI restores it from the
    Actions cache, keyed on the engine's source hash, and builds it once per
    engine change (`.github/actions/engine-wasm`); Vercel builds it on every
    deploy through `scripts/vercel-build.sh`. Every build (`npm run build`, a dev serve and the
    deploy alike) is the Rust-only build: the WASM engine is the only engine, the
    TypeScript step loop is swapped out (Vitest keeps the real loop), and an
    engine that cannot start stops the game with a message instead of
    falling back. Its postbuild check (`scripts/verify-engine-bundle.ts`)
    reads the emitted sourcemaps and fails a production build that ships any
    TypeScript engine module (#921). A `VC_TOOLING=1` build may ship only the
    modules `scripts/engine-bundle.allow.txt` lists, for the harnesses'
    hand-built tower, and fails when a listed one no longer ships (delete its
    line: the list only shrinks).
    `?engine=` and `vc.engine` are ignored. See
    `docs/performance/player-bundle.md` for what still ships and why. A simulation change lands in the
    Rust engine. The TypeScript engine changes only when the shared lock, a parity test or the
    catalog digest needs it (for example the catalog size and price tables both engines read), and
    the PR says why; no feature or fix is ported to it for its own sake. An engine PR that adds a branch adds a scenario that reaches it;
    the `rust-coverage` job (`cargo llvm-cov`, line floor in
    `engine-rs.yml`) is how review checks that, and the floor only moves up.
    The catalog every frontend reads (prices, sizes and build rules,
    `engine-rs/src/catalog.rs`) is pinned the same way by
    `conformance/catalog-digests.json` (the WASM suite,
    `conformanceWasm.integration.test.ts`, writes it with the same
    regeneration switch; a Rust test, the referee and the WASM suite check
    it), so a changed price or size moves that digest in the PR that changes
    it. The TypeScript reference's catalog is not pinned.
    Forged-save handling is pinned the same way by
    `conformance/loader-cases.json` (`loaderCases.integration.test.ts` writes
    it, a Rust test replays it), and the `.TDT` codec by
    `conformance/tdt-cases.json` (frozen; `cargo run --release --features conformance --bin tdt`
    and a Rust test replay it, and a changed `.TDT` byte moves a hash in the PR that changes it).
    The codec also has a Rust-only fuzz (`engine-rs/tests/tdt_fuzz.rs`):
    damaged copies of the nine real saves and forged towers must import,
    export and import again without a panic and reach a fixed point after one
    round trip. The pull-request run uses 8 seeds; `tdt-fuzz.yml` runs thousands
    each night and opens an issue on a failure. To replay one seed, from
    `engine-rs/`: `VC_TDT_FUZZ_FIRST=<seed> VC_TDT_FUZZ_SEEDS=1 cargo test
    --release --test tdt_fuzz`. A nightly differential fuzzer
    (`engine-fuzz.yml`) grows seeded random scenarios on the native Rust
    engine, replays each through the shipped WASM build in Node and
    compares the state, crowd and events hashes at checkpoints at least
    every in-game hour, then the money, the log, each field of the full
    save, and the fx sequences and emergency counters (which sit outside the
    hashed views), naming the first one that differs (`scripts/fuzz-compare.ts`; exit
    3 marks a harness failure, not a divergence). One seed in four grows a
    tall tower that fills the shaft and stair pools; every seed sets a cash
    profile once the tower is built, and cash can drop to zero or below mid-run. This is
    where a wasm32-only difference shows (a WASM trap is its own finding:
    exit 4, its own line in the summary, and a red night), and a scenario the
    engine refuses while growing it fails the night too. A divergence it
    finds is shrunk (`scripts/fuzz-shrink.ts`) and pinned in the fix PR as a
    corpus entry with its golden (`npx tsx scripts/fuzz-corpus.ts --update`
    pins the native run's records under `conformance/fuzz-corpus/goldens/`);
    the `fuzz-corpus` job then holds every entry's native run to its golden
    and the WASM run to the native one. Until #1875 the scenarios were also
    replayed on the TypeScript engine. A run summary names its seed range and the
    `seed_block` and `seed_offset` that replay it, the seeds that diverged,
    the seeds that timed out, and the time the WASM leg took. The nightly
    records the window key (`scripts/fuzz-key.ts`, a hash over the engine's
    sources and the pins that build it) and the runner image version, so two
    nights can be compared.

    **Suites on the engine port.** A converted suite does not build a
    `Simulation` and poke it. It names its engines with `describeEngines`
    (`src/tests/portKit/portSim.ts`) and drives one `PortSim` per test: port
    commands (`build`, `buildTransport`, `tick`), the tooling-only members
    (`startFire`, `bombThreat`, `setMoney`), and reads from `sim.state`, a
    read-only copy of the engine's own save. A fixture's raw tower edits go
    through `sim.setup(draft => ...)`, which opens the save as a draft, edits
    it and loads it back, and works only before the first tick since a load.
    The same body runs on the Rust engine and on `TsEngine`, so the Rust
    engine is the authority and the TypeScript reference keeps its coverage.
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
    required, so the package's own tests run instead of skipping. Until
    #1421 those legs also ran every suite with each `Simulation` hosted on
    the engine (story-engine-test-parity, #878); the hosted projects and the
    mirror host behind them are gone, and so are their per-test markers. The Rust
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
  after a tooling build (`VC_TOOLING=1 npm run build`).
  There is one build and two Playwright projects, split by how the specs need
  the machine (see [`playwright.config.ts`](./playwright.config.ts)):
  `chromium-serial` holds the pinned visual/perf checks (`engineIdentity`,
  `engineStatusRows`, `atlas`, `visual`, `perf`) and runs with one worker, as
  the `e2e-serial` job; `chromium` holds the general browser regression suite,
  including `e2e/engineBoot.spec.ts` (boot, failures and offline start), and CI
  runs it as the `e2e-general` job, in three shards on three runners. The
  first shard also runs the negative bundle canary, and the shard that runs
  `milestones.spec.ts` uploads the milestone screenshots
  (`milestone-screenshots`). `npm run e2e` runs both locally; pass
  `--project=chromium` or `--project=chromium-serial` for one.
  The suite runs on the Rust engine only, and so does the perf gate, whose
  baseline is the Rust engine's. Nothing runs the TypeScript engine end to end.
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
`npm run build` needs the engine package, and the image has no Rust toolchain,
so build `src/public/engine/` on the host first; see the engine note above):

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
WASM engine, and it needs the engine package (`npm run wasm:build`). The
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
  engine or the TypeScript reference engine.
- **A check that needs the real engine is an integration test**
  (`*.integration.test.ts`, listed in `test:wasm:host` when it needs the
  package) **or a Rust test** in `engine-rs/`.
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
in the unit, integration or e2e tiers and no Rust `#[test]` without an
assertion. Its allowlist,
`src/tests/testHonesty.allow.txt`, only shrinks, and each line carries its
reason. `tsEngineTests.guard.test.ts` separately holds the tests that still run
the TypeScript reference engine to a shrink-only list. The rest is review work:
the review skills, Copilot and PR-Agent check it on every PR.

### Coverage floors

Coverage is enforced as a **ratchet**, not a vanity number. It can't rot below
the agreed floors. Floors are measured over the whole app (not just the strong
engine layer), so the report can't overstate coverage by scoping to the parts
that are easy to test.

- **Global floor:** 85% statements / 85% lines / 80% functions / 80% branches,
  aggregated over the measured set.
- **Per-file floors** for the render and audio layers (the sprite painters, the
  pixel-sprite code, and the audio graph in `ToneAudioEngine`). These exist so a single weak file
  **can't hide behind strong siblings**. There is no cross-file masking. Draw
  code carries deliberately **lower BRANCH floors** because visual variants a spy
  2D context can't judge are the job of the Tier-2 Playwright visual tier, not
  the unit tier.

### What is excluded from unit coverage, and why

Only the code that genuinely **cannot run headless** is excluded. It is not
untested. It is **unit-exempt, integration-covered**, exercised by the Tier-2
e2e specs (e.g. `e2e/integration.spec.ts` boots it in a real browser):

- **`src/main.ts`**: the composition root. Its constructor boots the WebGL
  `TowerEngine`, so `new GameApp()` can't run under happy-dom. Its testable
  *logic* lives in the measured `src/game/*` controllers.
- **`src/render/excalibur/**`**: the Excalibur/WebGL engine wrapper.
- **`src/wasmhost/engineWorker.ts`**: the experimental worker host's Web
  Worker entry, the browser glue around `EngineWorkerCore`, which is measured
  in Node against the real package and a fake engine.
- **`src/render/atlas/browserEntry.ts`, `verify.ts`, `verifyExtras.ts`**: the
  sprite atlas bake's browser half (the page API the export drives and the
  pixel checks), which reads pixels back from a live canvas. The pipeline they
  call (bake, compose, lookup, archive) is measured in its own modules, and
  `e2e/atlas.spec.ts` runs them end to end.

Also excluded are non-product tooling entry points that are build/dev plumbing,
not game logic: the gallery/preview pages (`src/gallery.ts`,
`src/preview.ts`), the PWA bootstrap (`src/pwa.ts`), the harnesses' tower
(`src/game/toolingTower.ts` and `toolingSim.ts`, which drive the Rust engine
package the coverage run does not build; their tests run on the `test-engine (unit)` leg,
and the e2e specs and the screenshot gallery drive them),
plus the usual non-code (`*.d.ts`, `*.config.*`) and the tests themselves.

### What you might assume is untestable but ISN'T

These layers were once waved off as "device-only." They are unit-tested here, so
**follow the pattern** rather than adding new exclusions:

- **Procedural sprite painters** are driven against a **spy 2D context**
  (`src/render/sprites.test.ts`). The draw calls are asserted without a real
  canvas.
- **The Web-Audio engine's** real control flow runs against a **mocked Tone.js +
  a fake `AudioContext`** (`src/audio/toneAudioEngineGraph.test.ts`), with its
  inert-without-audio contract pinned separately
  (`src/audio/toneAudioEngine.test.ts`).
- **Pure logic extracted out of an untestable shell** into a measured module and
  tested there, e.g. `pwa.ts`'s payload sanitizer lives in
  `src/pwaUpdateInfo.ts` (`src/pwaUpdateInfo.test.ts`).

The full coverage configuration (floors, includes, excludes) lives in
[`vite.config.ts`](./vite.config.ts).

## Architecture

For a visual tour (layer diagram, the frame loop, the engine subsystems, input
flow, and persistence) see **[ARCHITECTURE.md](./ARCHITECTURE.md)** (Mermaid
diagrams). The prose conventions below are the source of truth.

- **`src/engine/`**: the TypeScript reference engine (no DOM), kept as a test
  referee until it is deleted; the game runs the Rust engine. Until the deletion,
  the shipped bundle still carries part of it, and the boot catalog check
  (`src/wasmhost/catalogCheck.ts`) runs its `catalogFor` (#921). Deterministic and
  heavily unit-tested. `Simulation` is the orchestrator; cohesive subsystems live in
  their own modules (`ElevatorDispatch`, `EventSystem`, `EconomySystem`, `Crowd`).
  The extracted `EventSystem` and `EconomySystem` depend only on the narrow
  `SimContext` interface, so each is testable on its own; `ElevatorDispatch` and
  `Crowd` operate on `Tower` directly. Per-tower build caps and rule-sets live
  in the Rust engine (`engine-rs/src/facilities.rs`, `engine-rs/src/rules.rs`),
  the source of truth for gameplay rules, caps and tuning; `facilities.ts` and
  `gameRules.ts` here keep the TypeScript copy, and the catalog digest holds
  what the catalog publishes equal in both.
- **`src/render/`**: canvas rendering and pixel-art sprites. Reads engine state,
  never mutates it.
- **`src/ui/`**: DOM controls (palette, status bar, dialogs), using native
  `<dialog>` for modals. The `UI` class is a thin shell over friend-modules that
  take the instance: the lit-html template bodies (`templates/`), the dialog
  controllers (`uiDialogs`), the editor/inspector panels (`uiPanels`), the
  status/log pump (`uiStatus`), and the palette build (`uiPalette`).
- **`src/audio/`, `src/storage/`**: sound and save/load, independent of
  rendering. Audio is a boot-time facade (`AudioEngine` in `Audio.ts`) that
  lazy-loads the live orchestrator (`ToneAudioEngine`), which drives the
  scene data and math
  (`toneScenes`), the composed music (`toneTracks`), the action jingles
  (`toneVoices`), percussion (`tonePercussion`), rain (`toneRain`), and the
  crowd and venue ambience (`toneCrowd*`); `audioAssets` lists the files it
  fetches. **[SOUNDS.md](./SOUNDS.md)** maps the audio modules, cues, and
  ambient layer, and explains how to add a cue.
- **`src/main.ts`**: the composition root that wires input, engine, and the
  game loop together.

No shipped file imports `src/engine/` at run time (#921): an ESLint rule
(`eslint.config.js`) refuses it everywhere outside the engine, the tests and
the tooling files it names, because the shipped game runs the Rust engine only
and retiring the TypeScript engine deletes that directory. Code reads the
catalog through the
catalog handle (`towerCatalog`, `catalogTypes`, which live in `src/catalog/` and
are not counted), the frame view (`src/wasmhost/frameView.ts`) or an
engine query (#868) instead. `src/tests/frontendEngineImports.guard.test.ts`
scans every non-test file under `src/` except the engine, the tests, and the
host and save code (`src/wasmhost/`, `src/dualrun/`, `src/storage/`), and pins
each file's other runtime engine imports in `frontendEngineImports.ratchet.txt`,
which holds only the tooling files the lint exempts; it also sees what the lint
cannot (a dynamic `import()`, a URL, a glob). The list shrinks: delete a module
from a file's line when the file stops importing it. It grows only with a
reason the PR states and a reviewer accepts.
A type-only import is not counted, so import a name you use only as a type with
`import type`.

The tower grid is **two-layered**: a structural layer (floor/lobby) with a room
layer sitting on top, exactly like the original SimTower corridor model.

### Classic vs Modern rule-sets (`engine-rs/src/rules.rs`)

A tower is founded under an immutable `GameMode` (`classic` | `modern`), chosen
once at creation and persisted. Behavior the two modes disagree on belongs
behind the mode's rule methods in the Rust engine (`impl GameMode` in
`engine-rs/src/rules.rs`), which the simulation calls (`self.mode.<x>()`). Some
older Rust subsystems still test the mode inline (`self.mode.is_modern()`, a
comparison with `GameMode::Classic`); move such a test behind a rule method
when you change that code. The TypeScript reference engine keeps its copy
behind the `GameRules` strategy object (`src/engine/gameRules.ts`,
`CLASSIC_RULES` / `MODERN_RULES`) until it is deleted.

**Tripwire: don't let mode logic smear.** Map the mode to behavior in one
place, a rule method (`makeRules` in the TypeScript copy). Never write
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
`.github/workflows/release-tag.yml` tags the merge commit `v<version>` for an
app version change and dispatches `.github/workflows/github-release.yml`, which
publishes the release with the version's player notes and then dispatches
`.github/workflows/sprite-atlas.yml` to bake the sprite atlas and attach it
(docs/atlas.md). The release never waits on the atlas. A crate version change gets its own `engine-v<version>`
release with that version's `engine-rs/CHANGELOG.md` section and the built
WASM package attached, never marked Latest, so a frontend can depend on the
crate at that tag or download the package. The same build goes to GitHub
Packages as `@maniator/verticopolis-engine` (installing it needs a GitHub
token, even though it is public). A maintainer can
still tag a commit by hand (`git tag v2.30.0 <commit> && git push origin
v2.30.0`). Only commits that contain the atlas exporter can get an atlas. A tag push runs
the release workflow file as it is at the tagged commit. A manual run (Actions,
"GitHub release" or "Sprite atlas", with the tag as input) uses the copy on the
branch or tag it runs from. The release workflow publishes when the tag has no
published release and leaves a published one alone; the atlas workflow attaches
the atlas when the release lacks it and only audits when it has it.

**Declare the tier in the same PR as any player-facing change.** The tier is keyed
to one question: would a player notice anything different?

- **major** (`X.0.0`): the save format or compatibility breaks (an old tower
  would no longer load), or a deliberate headline/milestone release. Rare and
  intentional, never incidental.
- **minor** (`x.Y.0`): the default player-facing bump. A player would notice
  something new or changed: a feature, a balance shift, or a visible fix.
- **patch** (`x.y.Z`): a fix-only follow-up or a re-deploy with no new
  player-facing capability (a hotfix to an already-shipped release).
- **no bump**: internal-only work with no player-observable effect at all (pure
  refactor, identical-behavior perf, tests, docs, tooling, CI).

The old "minor for a capability, patch for a fix" split is retired; it sorted
changes by how they were built rather than by what a player feels, so the
minor/patch line kept coming down to a judgment call. Sort by player impact
instead, and the question answers itself.

A player-facing change whose note says `app: none` (or has no note) is a review
finding: the splash (and the update prompt's build-id line) would otherwise
misreport the build as unchanged. One note per PR, not per commit.

### Change notes and the release PR

Every PR that changes a deployed path (anything `scripts/vercel-ignore-build.sh
--classify` calls "build") adds one file, `.changes/<branch-slug>.md`, with the
app tier, the crate tier and the changelog lines. The format and its rules are
in [`.changes/README.md`](./.changes/README.md). The file is named after the
branch, so two open PRs never edit the same line and never conflict over a
version. A note already on `main` belongs to the PR that merged it, so a
follow-up from the same branch name adds `.changes/<branch-slug>-2.md` (the
version check refuses an edit to a pending note outside a release PR).

The release driver cuts a release:

1. Branch `release/<version>` off an up-to-date `main`.
2. Run `npm run release` (or `npm run release -- --app 3.0.0` for a headline
   release). It raises the app version by the highest pending `app` level,
   writes the `CHANGELOG.md` section from the Player lines, and, when a note
   has a crate level, raises the crate in `engine-rs/Cargo.toml` and both
   `Cargo.lock` files, writes the `engine-rs/CHANGELOG.md` section from the
   Engine lines and runs `npm run engine:compat`. It deletes the notes.
3. Trim the player lines to the few that matter (the prompt shows three),
   commit, and open the PR. It merges like any other PR, and its merge tags
   and publishes the GitHub releases.

A release consumes every pending note. If another note lands on `main` first,
merge `main` in, reset the release files and run it again.

CI's "Versions and change notes" step in the test job (`npm run
version:check` locally, after committing) holds both sides to this: a feature
PR keeps every version line and changelog heading as `main` has them, keeps
`main`'s pending notes, adds a note when it changes a deployed path, and sets
`crate:` in its own note when it moves a pin in the compatibility record. A
release PR raises each version by exactly its notes' highest level (the app may
go to a later version the driver names), consumes every note and changes
nothing but the release files.

**Production waits for the release PR.** While a pending note has a level other
than `none`, `scripts/vercel-ignore-build.sh` skips the production deploy, so a
player never gets new behavior under the old version and the old "What's new"
notes. Previews still build. The release merge deletes the notes, builds, and
ships everything pending as one numbered build. Production deploys only on a
release merge: a push to `main` whose commit leaves the app and crate versions
as its parent had them is skipped, even with no note pending.

**Cutting the release.** Run the **Cut release** workflow (`release-pr.yml`)
from the Actions tab, with an app version such as `3.0.0` for a headline
release or empty for the levels the notes ask for. It runs `npm run release`
and opens the release PR with the workflow token, which starts no checks on
its own, so start them with the run button on that PR when GitHub shows one,
or else close and reopen the PR. `npm run release` on a local
`release/<version>` branch still works the same way.

### The engine crate version

`engine-rs/Cargo.toml` carries its own version, separate from the app's. It is
the answer to "which engine contract is this?": `engineIdentity()` reports it
and About will show it (#963 slice 3). The app version stays what players see.

**The crate version goes up with any of these** (the PR that moves one sets
`crate:` in its note, and the release PR raises the version):

- the conformance lock: `catalog-digests.json`, `events/catalog.json`,
  `expected.json`, `loader-cases.json` or `tdt-cases.json` under `conformance/`
  (a new fixture or scenario lands through `expected.json`, so it counts);
- `SAVE_VERSION`, or the oldest save version the engine loads;
- `FRAME_LAYOUT_VERSION`, `VIEW_LAYOUT_VERSION`, `CATALOG_VERSION` or
  `IDENTITY_SCHEMA` (the frame layout and the identity record's shape each
  have a pin table in `engine-rs/src/identity_tests.rs` that grows with the
  version, and the view layout has one in `engine-rs/src/view/layout_tests.rs`;
  the catalog version has none yet, see #1154);
- the binding's declaration, `src/dualrun/engine.d.ts`, outside comments.

An internal change that keeps all of these, such as a performance
optimization, needs no bump. The build hash (`sources` in the package's
`BUILD.json`) tells such builds apart. While the crate is 0.x, take a minor
bump for a save, frame or view layout, catalog, identity schema or interface change,
and a patch bump for a lock change on its own. Publishing is #893.

The crate version is independent of the app version: an app release never
requires a crate release, and the app's 3.0.0 does not wait for the crate.
Crate 1.0.0 (2026-10-30, the owner's call) marks that the shipped game runs on
this engine alone. Publishing the crate, shipping the conformance lock inside
it and writing the compatibility policy stay with #893; the bump rules after
1.0.0 are part of that policy, so #893 sets them, and until then the 0.x rules
above still say when a bump is due.

**How:** in the feature PR, set `crate:` and add an Engine line in its note,
then run `npm run engine:compat`. It rewrites `engine-rs/src/compat-record.json`
from the tree, fetches `origin/main`, and refuses a pin that moved from main's
record under an unchanged version unless a pending note declares a crate
level, a version that is not a later `x.y.z` release, or a main record it
cannot read. The record keeps the crate version main has, and the Rust identity
test still checks the recorded version constants against the code. The release
PR raises `version` in `engine-rs/Cargo.toml`, `engine-rs/Cargo.lock` and
`engine-rs/consumer/Cargo.lock` (CI builds the consumer with `--locked`) and
re-records, so `engineIdentity()` reports the new version. Two PRs that both
move the lock still meet in the record's `lockDigest`; whoever merges second
merges main in and re-records.

**What the guard sees and what it does not.** `src/tests/engineCompat.guard.test.ts`
recomputes the lock digest, the five version constants and a digest of
`engine.d.ts` (comments and spacing aside) and fails when one moved and the
record did not. It cannot see the Rust `pub` API, a JSON shape that the
declaration only describes in a doc comment (the `markers` and `commuteStress`
arguments, for example), or a field added through the save loader's optional
seam. A change like that still needs a bump; review owns it, and the backlog row
`engine-compat-coverage` tracks closing the gap. A record edited by hand in the
same PR also skips the main comparison, so a reviewer reads the record's diff.

### Two changelogs, and the update label

Two files, by audience. `CHANGELOG.md` is for players, one section per app
version. `engine-rs/CHANGELOG.md` is for people who build on the engine, one
section per crate version, and the release PR adds its section from the notes' Engine lines
(`src/tests/engineChangelog.guard.test.ts` fails otherwise). Classify a change
by what a player would notice, not by which layer changed: an engine fix a
player can feel gets a line in `CHANGELOG.md`; a contract-only change gets just
the crate entry.

The update prompt also labels each update **Game update**, **Engine update** or
**Game and engine update**, with a line such as "Rust engine 0.24.0 → 0.25.0"
when an engine changed. Nobody writes the label. The build hashes the shell (all
of `src` outside the engines, tests and the engine package) and records the
Rust crate version, the Rust sources hash and the TypeScript engine's sources
hash. `dist/version.json` carries them (`shell`, `engine`), the running client
compares its own (`__BUILD_FINGERPRINT__`), and `classifyUpdate` in
`src/pwaUpdateInfo.ts` picks the label. An older build with no fingerprint shows
the plain prompt.

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
gets none, just the build-id line. Curation is the point: the modal is a "here's
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
- **Codex re-reviews automatically on every push; Copilot does not.** Copilot's
  review is a one-shot snapshot, so after pushing new commits to a PR you must
  **re-request a review from Copilot** to get it to look at the latest changes
  (the ↻ next to Copilot under Reviewers).
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
- **Rust follows the same source rules.** The engine port in `engine-rs/` is held to
  the same conventions as the TypeScript, with no grandfathered comments:
  American English, no em-dashes (`src/tests/rustProse.guard.test.ts` keeps the
  Rust sources at zero), and the 500-line file ceiling that
  `src/tests/fileSize.guard.test.ts` enforces on `src/` and `scripts/` (it scans
  `.rs` files too, inline `#[cfg(test)]` modules included; today's oversized
  Rust files sit on the same shrink-only ratchet, `src/tests/fileSize.ratchet.txt`).
  The other gates have Rust counterparts: lint and typecheck map to `cargo fmt
  --check` and `cargo clippy -D warnings` (`engine-rs.yml`), and the engine
  boundary rules to `engine-rs/tests/independence.rs`, which keeps the simulation
  free of host access (files, network, console, clock; a few named referee
  functions may read fixtures) and the JavaScript binding inside `src/wasm.rs` and `src/wasm/`.
- **Keep `src/engine/` free of DOM/rendering** so the simulation stays
  deterministic and unit-testable.
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
- **Merges go through the merge queue.** Once a PR's checks are green,
  "Merge when ready" adds it to the queue, which tests the PR on top of the
  latest `main` and lands it with a merge commit only when the required checks
  pass there, so one merge cannot turn `main` red for every open PR. The
  required checks run on the queue's `merge_group` event too. To save
  minutes, a queue run skips the screenshot capture behind `drift-gate`,
  whose queue run passes on the PR run's result. The path filters in `test.yml` and `engine-rs.yml` read the
  queued change from the compare API.

## Where things live

| Path | What |
| --- | --- |
| `engine-rs/` | The simulation: the Rust engine, compiled to WebAssembly, and the only engine the game runs. No host access (`engine-rs/tests/independence.rs`), deterministic, tested with `cargo test`. It owns the rules, caps and tuning (`facilities.rs`, `rules.rs`), the catalog the UI reads (`catalog.rs`), saves and `.TDT`, and undo. Its module map and how to build, test and change it: [`engine-rs/README.md`](./engine-rs/README.md). |
| `src/simport/` | `EnginePort`, the one synchronous interface the game uses to call the engine, and the shared view reader that decodes the engine's frame. |
| `src/dualrun/`, `src/wasmhost/` | The WASM binding and its declaration (`engine.d.ts`); loading the engine package, its build metadata and the catalog checks. |
| `src/shared/` | Types and small helpers shared across the game. |
| `src/engine/` | The old TypeScript engine, kept only as a test reference while it is deleted. Not part of the shipped game; do not add a runtime import of it. |
| `src/game/` | Game controllers: the testable logic behind the composition root. |
| `src/render/` | Canvas rendering and pixel-art sprites (`sprites.ts`, `sprites/**`, `pixelSprites.ts`). Reads engine state, never mutates it. |
| `src/render/excalibur/` | The Excalibur/WebGL engine wrapper (unit-exempt, e2e-covered). |
| `src/ui/` | DOM controls: palette, status bar, native `<dialog>` modals. The `UI` shell delegates to friend-modules: `templates/` (lit-html bodies), `uiDialogs`, `uiPanels`, `uiStatus`, `uiPalette`. |
| `src/audio/` | Sound, independent of rendering: the `AudioEngine` facade (`Audio.ts`), `ToneAudioEngine` (orchestrator), `toneScenes` (data/math), `toneTracks` (music), `toneVoices` (jingles), `tonePercussion`, `toneRain`, the `toneCrowd*` ambience modules, and `audioAssets`. See [SOUNDS.md](./SOUNDS.md). |
| `src/storage/` | Save/load, the `VCZ1:` storage container, `.vctower` file handling. Who owns what, and every path: [`docs/architecture/save-paths.md`](./docs/architecture/save-paths.md). |
| `src/main.ts` | Composition root: wires input, engine, and the game loop. |
| `src/tests/` | Vitest fixtures, integration suites (`*.integration.test.ts`) and the repository-wide guard tests; unit tests colocate next to their source. |
| `conformance/` | The conformance lock and catalog digests the engine is held to. |
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
