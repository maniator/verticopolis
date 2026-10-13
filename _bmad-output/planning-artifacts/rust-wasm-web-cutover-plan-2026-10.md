# BMAD: Rust/WASM web cutover, remaining work and release gate

**Status:** Planning, reviewed 2026-10-13. No implementation or cutover is
authorized by this document.
**Scope:** The public Rust engine (`engine-rs/`), its WASM binding and the
web host (`src/wasmhost/`, `src/dualrun/`). Nothing else.
**Decision:** The TypeScript engine and its fallback stay until the release
gate in section 6 passes and the owner signs.

**Read with:** the roadmap this plan extends,
`architecture/architecture-engine-rust-port-2026-10-08.md` ("Order and
gates", rows 4, 4b, 5, 6 and 7); the cutover's invariants,
`architecture/architecture-rust-wasm-cutover-2026-10-13/ARCHITECTURE-SPINE.md`
(AD-1 to AD-8); and the readiness report,
`implementation-readiness-report-2026-10-13-rust-wasm-cutover.md`.

## 1. Outcome

One authoritative Rust simulation runs the web game. The web host sends
commands, reads engine results and draws them; it computes no price, rule,
refusal or game time of its own. Players notice nothing except the 3.0.0
milestone in the update flow.

This plan does not restate the roadmap. It records what is already on
`main`, what the roadmap's stories still owe, the gaps no story owned, and
the measurable gate for the default flip.

## 2. Where things stand (`main` at `404bb9c`, 2026-10-13)

| Area | On `main` | Open PR | Still owed |
| --- | --- | --- | --- |
| Engine authority | The engine alone ticks under `?engine=wasm` (switch story AC2) | none | Command answers still come from the TypeScript instance, which runs each command and relays it (switch story, "How it works"). See S9 |
| Clock | Rust `Clock` (`engine-rs/src/clock.rs`) owns game time while hosted; the frame view writes it back each frame | none | The step driver and day pace live in TypeScript (`src/engine/sim/fixedStep.ts`, `src/engine/timePacing.ts`, `src/game/frameLoop.ts`): #867 |
| Prices and rules | Engine-owned charges (#928, `a412060`); engine catalog with a digest lock, nested validation and charged-price tests (#930, `562f104`) | none | The web UI still reads TypeScript tables (#921); build quote (#922); catalog second slice (#926) |
| Mutation surface | Player charge commands; the dual-run relay owns the raw ops | #950 (capacity events from the simulation layer, adds relay-only `towerSetCars` and `towerResizeTransport` with a guard test) | Tier every binding export and confine tier 3 (#946, #923) |
| Read model | `frameView`, `logSince`, elevator telemetry, housekeeping report, `catalog` | none | Binding getters, result shapes, typed arrays, structural snapshot (#868); inspector read models (#919) |
| Saves | Unicode repair and 32 MiB caps (#941, #944); byte-exact engine writer (#949); engine encoder (#937) | #953 (the web writes through `encodeVctower` under `?engine=wasm`) | JavaScript number semantics for hand-edited saves (#858); RNG state 0 reload (#856); a rollback rule before any save-format bump (AD-5) |
| Gameplay events | Engine events (#903) and the web bridge (#938) | none | Pin fx sequences and counters across engines (#879); drain glue (#907); close-out of #873 |
| Tests | Conformance lock (19 scenarios), dual-run day gate, e2e on both engines (`chromium-wasm`), nightly fuzzer | #878 in progress | Vitest suites on WASM and the test-mapping table (#878); refusal reasons pinned (#865) |
| Host lifecycle | Attach, sync, detach, swap away from a trapped engine on load | none | Fallback on throw or panic, undo after a trap, boot timeout (#874); attach after an exterminator booking (#902) |
| Performance | TypeScript perf gate | none | WASM baseline (#900); stats cost (#905); hour-boundary cost (#849) |
| Engine consumers | Public crate and lock | none | Crate release with the lock and a semver policy (#893) |

## 3. Requirements

**FR1 One engine.** Rust computes all gameplay: prices, unlocks, game time,
RNG, event eligibility, building, rent, emergencies, refunds and every
command's answer. The web host sends commands and renders results (AD-1,
AD-2, AD-3).

**FR2 Behavioral parity.** Player journeys keep their outcomes, refusal
reasons and their order, log text, state transitions and undo/redo, in
Classic and Modern and for migrated towers.

**FR3 Persistence.** Existing `.vctower` files and supported legacy saves
load and round-trip through the engine. Malformed, oversized, corrupted and
Unicode edge cases fail the same way every time, with no silent loss (AD-5).

**FR4 Frontend contract.** The web UI reads build quotes, catalog and unlock
state, stats, income, logs, events, frame and structure from documented,
versioned engine read models, and recreates no engine decision (AD-4).

**FR5 Performance and reliability.** Deterministic fixed steps at any render
rate, bounded memory, recovery from an engine throw or panic without losing
the tower, and failures the player and the developer can see.

**FR6 Engine consumers.** One public crate with compatible saves, commands
and a published compatibility policy (#893).

**NFRs** carry numbers in the release gate (section 6): determinism (NFR1),
performance (NFR2), reliability and rollback (NFR3), analytics consent and
attribution (NFR4), and the coverage floors (NFR5).

## 4. Architecture decisions

The spine fixes eight invariants; each story below cites the ones it must
honor:

- **AD-1** The engine answers commands; the instance only mirrors.
- **AD-2** The step driver moves into the engine; no host keeps a game clock.
- **AD-3** Every binding export has a tier: player commands, restores, or
  relay and test ops. The UI reaches tier 1 only.
- **AD-4** Engine-owned, versioned read models; the UI formats only.
- **AD-5** One save codec; a format bump ships with a rollback rule.
- **AD-6** Gameplay events come from the engine only.
- **AD-7** The flip keeps the fallback; the dedicated Web Worker comes after
  the flip; parallel phases only after a measured profile.
- **AD-8** Restores boot the engine from engine-written bytes, never from a
  TypeScript re-serialization.

## 5. Implementation roadmap

Each story is its own branch and PR, reviewed with the skill CLAUDE.md
names (`/gds-code-review` for engine, host and save fidelity), with the
four quality gates green and the coverage floors held. Priority is this
plan's ordering for the flip; issue titles keep their backlog priority until
the owner changes them.

### Wave 1: land what is in flight

| # | Story | Issue | Priority | Modules | Acceptance criteria | Tests | Depends on |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S1 | Capacity events from the simulation layer in both engines | #906 (PR #950) | P2 | `src/engine/sim/capacity.ts`, `engine-rs/src/wasm.rs`, `src/dualrun/` | `capacity_changed` emitted from `Simulation` in both engines; bare tower edits silent; relay-only ops reachable from `src/dualrun/` only | `towerRelayOps.guard.test.ts`, dual-run edits integration, gameplay emission tests, conformance | none |
| S2 | The web writes saves through the engine encoder | #935 (PR #953) | P2 | `src/storage/vctowerWriter.ts`, `src/bootstrap.ts` | Same bytes as the fflate writer on every fixture; first failure falls back and latches off | Unit, boot, WASM-suite byte comparison | none |
| S3 | Vitest suites on the WASM engine and the test-mapping table | #878 | P1 | `src/tests/`, `vite.config.ts`, mapping table | Suites green on both engines or each exclusion named with a reason; table complete for `src/engine/` | The suites themselves, the table's completeness test | none |

### Wave 2: host reliability and the read model

| # | Story | Issue | Priority | Modules | Acceptance criteria | Tests | Depends on |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S4 | Fall back to TypeScript on an engine throw, panic or boot stall | #874 | P1 for the flip | `src/wasmhost/`, `src/bootstrap.ts` | A throw or panic in a command, tick, undo or redo detaches and re-adopts the last merged save; the boot import has a timeout; refusals the instance accepted are reported | Fault-injection integration tests per path; e2e with a forced trap | S3 |
| S5 | Attach after an exterminator booking keeps its rooms | #902 | P2 | `engine-rs/src/load.rs`, `src/wasmhost/` | The booked room ids survive the save, so an attach mid-booking matches the instance | Integration test that attaches mid-booking; conformance | none |
| S6 | Binding read model and result shapes | #868 | P1 for the flip | `engine-rs/src/wasm.rs`, `src/wasmhost/` | `canBuild` with its quote, `isUnlocked`, `previewRentBatch`, full `callExterminator` result, unknown kind as a refusal; getters for stats and income; structural snapshot replaces the per-hour save merge | Unit tests per getter; the six merge-per-tick timeouts pass without `VC_WASM_SYNC=hour` | S3 |
| S7 | The web UI reads the engine catalog | #921, then #922, #926 | P1 (#921), P2 | `src/ui/`, `src/game/`, `engine-rs/src/catalog.rs` | No price, size or rule constant read from `src/engine/facilities.ts` by UI code; build quote from the engine | A source guard test; UI unit tests on catalog values; catalog lock | S6 |
| S8 | The step driver in the engine | #867 | P1 for the flip | `engine-rs/src/clock.rs` or a sibling module, `src/game/frameLoop.ts` | One engine call takes real seconds, speed and the steady-clock choice and returns the steps it ran; the pace factor, catch-up cap and pause handling move with it; the debt lives on the engine handle outside the save and hash and resets on restore; the web host uses it under `?engine=wasm` | Dual-run day gate with the Rust driver matching every hour; 30, 60 and 144 Hz cadences give identical tick sequences; pause, resume, speed change and a 30-minute hitch | S3 |

### Wave 3: one authority

| # | Story | Issue | Priority | Modules | Acceptance criteria | Tests | Depends on |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S9 | The engine answers commands; the instance mirrors | #954 | P1 | `src/wasmhost/wasmHost.ts`, `src/dualrun/mirror.ts`, `engine-rs/src/wasm.rs` | Under `?engine=wasm` every player command runs on the engine first and the caller gets the engine's result in one shape (`{ ok, reason?, delta? }` plus named fields); the instance skips a refused command; while hosted only the engine logs and emits events; a load or undo boots the engine from engine-written bytes (AD-8); a disagreement is reported and the engine's state wins | A test per command that the returned result is the engine's; a forced disagreement is reported; e2e on `chromium-wasm` | S4, S6 |
| S10 | Tier every binding export; confine tier 3 | #946, with #923 | P1 | `engine-rs/src/wasm.rs`, `src/dualrun/`, guard tests | Every export listed in one tier table; a test that parses `wasm.rs` fails on an untiered export; a guard fails on a tier 3 call outside `src/dualrun/` and tests, including UI writes to `sim.money` and calls to `tower.setCars` or `tower.resizeTransport` that the mirror would relay; arguments validated at the boundary | Guard tests; boundary validation tests in both engines | S1, S9 |
| S11 | Refusal reasons and their order pinned | #865 | P2 | `conformance/`, runners | Scenario steps can pin `reason`; a refusals scenario covers the four-star gates | Conformance in both runners | none |
| S12 | Save edge cases | #858, #856 | P3 | `engine-rs/src/load.rs`, `src/storage/` | Hand-edited numbers load as the TypeScript loader reads them, or fail with the same message; a save at RNG state 0 reloads at state 0 | Loader table cases; round-trip tests | none |

### Wave 4: the flip

| # | Story | Issue | Priority | Depends on |
| --- | --- | --- | --- | --- |
| S13 | Performance baseline and budgets for the engine | #900 (with #905, #849 as found) | P2 | S6 |
| S14 | Analytics close-out: fx and counter pins, drain glue, #873 | #879, #907, #873 | P3 | S1 |
| S15 | The release gate, one release on the TypeScript default with the new instrument, then the flip as 3.0.0 | #945 | P1 | S3 to S14 |

### After the flip (not cutover blockers)

- **Dedicated Web Worker** (#908 step 1): the engine instance, the clock and
  command execution move into one worker; rendering and input stay on the
  main thread. Tests cover worker start and restart, stale messages,
  backpressure, step debt, pause and speed changes, background throttling,
  save and load, and replay. It improves responsiveness, not throughput.
- **Parallel phases** (#908 step 3): only after a measured phase profile,
  behind a cargo feature, with the serial step as the reference and the
  referee run with the feature on and off. Shared memory and cross-origin
  isolation costs are assessed before any WASM threads ship.
- **TDT in the crate** (roadmap row 5), **copy catalog** (row 6), **crate
  release** (#893), and **retirement** (row 7,
  `story-engine-retire-typescript`) after two releases on WASM.

## 6. Release gate for the default flip (#945)

Every row passes on the flip candidate's commit. Rows marked "proposed" need
the owner's numbers before the gate is binding.

| Gate | Pass condition |
| --- | --- |
| Conformance | Every scenario matches in both runners; refusal reasons pinned (S11) |
| Dual run | A day on every fixture at every speed with no divergence, with the Rust step driver (S8) |
| Unit and integration | The vitest suites pass on the engine, or each exclusion is named in the mapping table (S3) |
| End to end | The `chromium-wasm` project is green, including a forced-trap fallback spec (S4) |
| Authority | No command answer comes from the instance (S9, #954); every export tiered and tier 3 confined (S10); the UI reads no TypeScript price or rule table (S7) |
| Saves | Every fixture and the loader table round-trip byte for byte through the engine; the 32 MiB cap and Unicode cases fail the same way in both engines |
| Performance (proposed) | Late-game fixture: Modern tick time no slower than TypeScript (roadmap rule); cold load within +500 ms of the TypeScript build; heap within 1.25x; a 5,000+ population fixture holds the frame budget the perf gate already uses |
| Reliability (proposed) | One release on the TypeScript default with the engine instrument: engine fallback in under 0.1% of sessions that opt in, and no unexplained divergence report |
| Rollback | A rehearsal flips the default back with the flag and loads saves written by the engine build |
| Deployment | The engine package's precache and versioning rule decided (an offline first load, an old cached shell with a newer package); a failed Rust build fails the deploy |
| Coverage | `vite.config.ts` floors and the Rust job's line floor hold |
| Sign-off | The owner approves with the exception register attached |

## 7. Risks and decisions for the owner

1. **Command authority before the flip (S9).** Recommended as a flip gate,
   since 3.0.0 says the game runs on Rust (#954). The alternative is to ship the
   flip with the instance still answering and fix it before retirement.
2. **Performance and reliability numbers** in section 6 are proposals.
3. **Offline play at the flip.** The engine package is left out of the
   offline precache today; after the flip an offline first load would fall
   back to TypeScript, and after retirement there is nothing to fall back to.
4. **Save format bumps.** The copy catalog (row 6) bumps the save version;
   it should not ship in the flip release, so a rollback can still read every
   save (AD-5).
5. **Retirement version.** The roadmap calls retirement internal while the
   retirement story's AC5 says major; one of them changes.
6. **Malformed saves.** Match the TypeScript loader's coercions exactly (#858),
   or refuse with a message; the recommendation is to match.

## 8. Issues

Reused: #865, #867, #868, #874, #878, #879, #893, #900, #902, #906, #907,
#908, #919, #921, #922, #923, #926, #935, #945, #946, #856, #858, #873.

New: #954 for S9 (engine-authoritative command answers). #945 (the release
gate) and #946 (binding export tiers) are extended rather than duplicated.
All three carry backlog rows (`wasm-host-engine-answers`,
`wasm-cutover-release-gate`, `wasm-binding-export-tiers`).

## 9. What changed in this review

- #930 is merged (`562f104`); earlier text called it open. #928 merged as
  `a412060`.
- #938 and #944 are merged baselines; no second bridge or codec is planned.
- The dedicated Web Worker moved after the flip; its tests left the cutover
  gate.
- Epics A to E were folded into the roadmap's rows and the stories above, so
  there is one plan for one migration.
- The command-authority gap (S9) and the deployment rows of the gate are new.
