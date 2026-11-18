# The CI pipeline

What runs on a pull request, what has to pass before it merges, and how a
release reaches players. The workflow files in `.github/workflows/` are the
source of truth; each opens with a comment that says why it is shaped the way
it is. Counts that change often (shards, jobs) are left to those files.

## On a pull request

```mermaid
flowchart TD
    PR["Push to a pull request"] --> Test["Test CI (test.yml)"]
    PR --> Rust["Rust engine (engine-rs.yml)"]
    PR --> Drift["Screenshot drift check (pr-drift-check.yml)"]
    PR --> Other["Windows smoke · Help site · Engine docs<br/>Engine bench · PR template · Milestone"]

    Test --> Lane{"changes job:<br/>which lane?"}
    Lane -->|full| Fast["test: lint, typecheck, unit + coverage, build,<br/>versions and change notes"]
    Lane -->|full| EngineLegs["test-engine (unit) · (port-kit)<br/>test-engine (host) shards"]
    Lane -->|full| Wasm["engine-wasm: engine package (cached by source hash)<br/>+ the tooling build"]
    Wasm --> E2E["e2e-serial: visual baselines, perf gate"]
    Wasm --> E2EG["e2e-general shards<br/>(split by measured time)"]

    Rust --> RustJobs["rust · rust-lint · rust-coverage<br/>wasm-binding · fuzz-corpus · consumer"]
    Drift --> Shoot["shoot jobs: shards packed by render time,<br/>each shard rendered twice and byte-compared"]
    Shoot --> Verify["verify-drift: the gallery must match"]
```

**Required checks** (branch rules on `main`): `test`, `test-engine (unit)`,
`test-engine (port-kit)`, `test-engine (host)`, `e2e-serial`, `e2e-general`,
`engine-rs` and `drift-gate`. Each sharded job reports through one result
job with the required name, so a shard count can change without touching the
branch rules.

### Test CI (`test.yml`)

- **Lanes.** The `changes` job sorts the pull request's files with
  `scripts/pr-lane.ts` (rules in `src/build/prLane.ts`). A docs-only change
  takes the prose lane (unit tests and the build without coverage); an
  engine-only change skips lint, typecheck, the plain unit run and the build. Cargo
  files, the binding, package and lock files, the conformance suite and
  `test.yml` always take the full lane, and so does a release branch. A
  skipped job still reports success, so every required check has a status.
- **The engine package.** `engine-wasm` restores the WASM package from the
  Actions cache by the engine's source hash, or builds it on a miss
  (`.github/actions/engine-wasm`), builds the tooling app once, and hands
  both to the browser jobs as artifacts.
- **Browser suites.** Both run in the pinned Playwright image (the tag comes
  from the Playwright version in `package-lock.json`). `e2e-serial` runs the
  pixel baselines and the perf gate with one worker. `e2e-general` runs the
  rest in shards, one worker each, with the spec files split by the measured
  seconds in `src/tests/ci/e2eShardSeconds.json` (`scripts/e2e-shards.ts`).
  When specs are added the plan step prints a notice naming the unmeasured
  ones; refresh the table with `node scripts/e2e-shards.ts measure` over one
  run's shard logs, or the shards drift apart and the slowest one sets the
  run's time.

### Rust engine (`engine-rs.yml`)

Runs when the crate, the conformance suite or one of the listed binding and
host files changes (its `paths` list). `rust` runs `cargo test` and the
conformance referee, `rust-lint` runs `cargo fmt --check` and
`cargo clippy -D warnings`, `rust-coverage` holds the line floor
(`cargo llvm-cov`), `wasm-binding` builds the package, `fuzz-corpus` replays
the pinned fuzz entries natively and through WASM, and `consumer` packages
the crate and builds a small host against it. `engine-rs` is the result job.

### Screenshot drift check (`pr-drift-check.yml`)

Runs when a path the gallery depends on changes. It calls
`screenshot-capture.yml`, which renders every scene in
`scripts/screenshot-scenes.ts` twice from two independent builds in the pinned
image and fails on any byte difference, then compares the result with the
committed `docs/screenshots/`. The scenes are grouped into shards
(`scripts/screenshot-shards.ts`, one shard per feature). The shards are packed
into a few `shoot` jobs by their measured render time (`node
scripts/screenshot-shards.ts jobs`, longest first, as the browser suite is
split); each shard keeps its own scenes, its own two-build check and its own
output folder, and the drift check merges the jobs' uploads before it
compares. Drift fails `drift-gate`; approving the `commit-on-approval` job
commits the regenerated gallery to the branch. See
[docs/screenshots.md](../screenshots.md).

### The others

- **Windows smoke**: the TypeScript tests on Windows, for path and shell
  differences. Not required.
- **Help site** and **Engine docs**: build the two Starlight sites when their
  sources change. Engine docs also deploys docs.verticopolis.com from `main`,
  and **Docs preview** publishes a per-PR preview.
- **Engine bench**: the hour-boundary tick bench on a pull request that
  touches the engine, and weekly.
- **PR template** checks the description keeps every heading of
  `.github/PULL_REQUEST_TEMPLATE.md`; **Milestone** sets the pull request's
  milestone.
- **PR-Agent** runs only when a collaborator comments `/review` or `/improve`
  ([pr-agent.md](./pr-agent.md)).

## Nightly and on demand

- `engine-fuzz.yml`: the differential fuzz (native against WASM).
- `tdt-fuzz.yml`: the `.TDT` codec fuzz.
- `update-visual-baselines.yml`, `update-perf-baseline.yml`: mint baselines in
  the pinned image when a commit message asks.
- `analytics-report.yml`: the PostHog report.
- `screenshot-approval-reaper.yml`: cancels drift-check runs parked on a closed
  pull request.

## From main to players

```mermaid
flowchart LR
    Main["Merge to main"] --> Staging["staging-mirror.yml<br/>staging.verticopolis.com"]
    Main --> Cut["Cut release (release-pr.yml)<br/>run by hand, with the owner's OK"]
    Cut --> RPR["release/x.y.z PR<br/>npm run release: versions, changelogs"]
    RPR -->|merge| Tag["release-tag.yml<br/>v-tag and/or engine-v tag"]
    Tag --> GHR["github-release.yml<br/>release notes, web build zip"]
    GHR --> Atlas["sprite-atlas.yml"]
    Tag --> Deploy["deploy-production.yml<br/>vercel build --prod, then checks version.json"]
    Tag -.->|"when ENGINE_REGISTRY_PUBLISH is on"| Publish["engine-publish.yml<br/>crates.io and npm"]
```

Vercel builds a preview for every branch; production deploys only from a
release tag. The rules for change notes, version levels and the release PR
are in [CONTRIBUTING.md](../../CONTRIBUTING.md) → Versioning.
