# BMAD: Rust/WASM web cutover, remaining work and release gate

**Status:** Planning, reviewed 2026-10-13 against `main` at `87527a0` and reconciled at `316595a` (#953 merged). No implementation or cutover is
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

## 2. Where things stand (`main` at `316595a`, 2026-10-13)

| Area | On `main` | Open PR | Still owed |
| --- | --- | --- | --- |
| Engine authority | The engine alone ticks under `?engine=wasm` (switch story AC2) | none | Command answers still come from the TypeScript instance, which runs each command and relays it (switch story, "How it works"). See S9 |
| Clock | Rust `Clock` (`engine-rs/src/clock.rs`) owns game time while hosted; the frame view writes it back each frame | none | The step driver and day pace live in TypeScript (`src/engine/sim/fixedStep.ts`, `src/engine/timePacing.ts`, `src/game/frameLoop.ts`): #867 |
| Prices and rules | Engine-owned charges (#928, `a412060`); engine catalog with a digest lock, nested validation and charged-price tests (#930, `562f104`) | #960 (engine `canBuild` on the binding, one price source, #922); #956 (e2e: charges move money inside the engine) | The web UI still reads TypeScript tables (#921); build quote (#922); catalog second slice (#926) |
| Mutation surface | Player charge commands; the dual-run relay owns the raw ops | #950 (capacity events from the simulation layer, adds relay-only `towerSetCars` and `towerResizeTransport` with a guard test) | Tier every binding export and confine tier 3 (#946, #923) |
| Read model | `frameView`, `logSince`, elevator telemetry, housekeeping report, `catalog` | none | Binding getters, result shapes, typed arrays, structural snapshot (#868); inspector read models (#919) |
| Saves | Lone-surrogate repair in the engine (#941); web Unicode repair and the 32 MiB caps (#944); byte-exact engine writer (#949); engine encoder (#937); the web writes export and sync saves through `encodeVctower` under `?engine=wasm`, skipping saves past 8 MiB and latching off on a bad write (#953) | #958 (stop committing the built package; build it in CI and on deploy) | JavaScript number semantics for hand-edited saves (#858); RNG state 0 reload (#856); a rollback rule before any save-format bump (AD-5) |
| Gameplay events | Engine events (#903) and the web bridge (#938) | none | Pin fx sequences and counters across engines (#879); drain glue (#907); close-out of #873 |
| Tests | Conformance lock (22 scenario files, two of them refusal scenarios; refusal reasons are not pinned yet, S11), dual-run day gate, e2e on both engines (`chromium-wasm`), nightly fuzzer | #878 in progress | Vitest suites on WASM and the test-mapping table (#878); refusal reasons pinned (#865) |
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

- **AD-1** The engine answers commands; the instance only mirrors. Before the
  flip (owner, 2026-10-13).
- **AD-2** The step driver moves into the engine; no host keeps a game clock.
- **AD-3** Every binding export has a tier: player commands, restores, or
  relay and test ops. The UI reaches tier 1 only.
- **AD-4** Engine-owned, versioned read models; the UI formats only.
- **AD-5** One save codec; a format bump ships with a rollback rule.
- **AD-6** Gameplay events come from the engine only.
- **AD-7** The flip keeps the fallback; the dedicated Web Worker comes after
  the flip; parallel phases only after a measured profile.
- **AD-8** Restores boot the engine from engine-written bytes.

## 5. Implementation roadmap

Each story is its own branch and PR, reviewed with the skill CLAUDE.md
names (`/gds-code-review` for engine, host and save fidelity), with the
four quality gates green and the coverage floors held. Priority is this
plan's ordering for the flip; issue titles keep their backlog priority until
the owner changes them.

### Wave 1: land what is in flight

| # | Story | Issue | Priority | Modules | Acceptance criteria | Tests | Depends on |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S1 | Capacity events from the simulation layer in both engines | #906 (PR #950) | P2 | `src/engine/sim/capacity.ts`, `engine-rs/src/wasm.rs`, `src/dualrun/` | `capacity_changed` emitted from `Simulation` in both engines; bare tower edits silent; relay-only ops reachable from `src/dualrun/` only. An earlier head (`179f16d`) predated #930 and its binding lacked `catalog(mode)`; head `053ef8e` contains #930 and its package exports `catalog`. Recheck at merge that the package and the TypeScript declarations were regenerated together and `BUILD.json` matches | `towerRelayOps.guard.test.ts`, dual-run edits integration, gameplay emission tests; catalog digest and event conformance on the combined artifact | none |
| S2 | The web writes saves through the engine encoder (merged as #953; the scope question below stays open) | #935 | P2 | `src/storage/vctowerWriter.ts`, `src/bootstrap.ts` | Same bytes as the fflate writer on every fixture; first failure falls back and latches off. The timer autosave (`saveToAsync`) and `toTowerFile` keep their own writers in this PR; whether "one writer" (AD-5) later covers them is decided here or in a follow-up | Unit, boot, WASM-suite byte comparison; malformed engine output; saves at the 8 MiB and 32 MiB boundaries; a host that fails mid-session | none |
| S3 | Vitest suites on the WASM engine and the test-mapping table | #878 | P1 | `src/tests/`, `vite.config.ts`, mapping table | Suites green on both engines or each exclusion named with a reason; table complete for `src/engine/` | The suites themselves, the table's completeness test | S6 (for the six merge-per-tick timeouts the structural snapshot fixes) |

### Wave 2: host reliability and the read model

| # | Story | Issue | Priority | Modules | Acceptance criteria | Tests | Depends on |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S4 | Fall back to TypeScript on an engine throw, panic or boot stall | #874 | P1 for the flip | `src/wasmhost/`, `src/bootstrap.ts` | A throw or panic in a command, tick, undo or redo detaches and re-adopts the last merged save; the boot import has a timeout; refusals the instance accepted are reported | Fault-injection integration tests per path, including a trap during an exterminator booking; e2e with a forced trap | S5 (for the booking case) |
| S5 | Attach after an exterminator booking keeps its rooms | #902 | P2 | `engine-rs/src/load.rs`, the TypeScript loader and writer, `src/wasmhost/` | The booked room ids survive the save in both engines as an optional field the loaders default, with no save-version bump (a lock change); an engine build from before S5 loses an in-flight booking on rollback, which the exception register notes; an attach or a fallback mid-booking keeps the treatment | Integration test that attaches mid-booking; conformance | none |
| S6 | Binding read model and result shapes | #868 | P1 for the flip | `engine-rs/src/wasm.rs`, `src/wasmhost/` | `canBuild` with its quote, `isUnlocked`, `previewRentBatch`, full `callExterminator` result, unknown kind as a refusal; getters for stats and income; structural snapshot replaces the per-hour save merge | Unit tests per getter; the six merge-per-tick timeouts pass without `VC_WASM_SYNC=hour` | none |
| S7 | The web UI reads the engine catalog | #921, then #922, #926 | P1 (#921), P2 | `src/ui/`, `src/game/`, `engine-rs/src/catalog.rs` | No price, size or rule constant read from `src/engine/facilities.ts` by UI code; build quote from the engine | A source guard test; UI unit tests on catalog values; catalog lock | S6 |
| S8 | The step driver in the engine | #867 | P1 for the flip | `engine-rs/src/clock.rs` or a sibling module, `src/game/frameLoop.ts` | One engine call takes real seconds, speed, the steady-clock choice and a frozen flag (a blocking modal is open, which zeroes the carried debt as `frameLoop.ts` does today) and returns the steps it ran; the pace factor, catch-up cap, pause, the blocking-modal freeze and the step-mode carry drop move with it; a non-finite result drops the carried debt as in the TypeScript reference, and negative elapsed time gets one guard in both drivers; the debt lives on the engine handle outside the save and hash and resets on restore, a step-mode change and a game-mode change; the web host uses it under `?engine=wasm` | Dual-run day gate with the Rust driver matching every hour; 30, 60 and 144 Hz cadences give identical tick sequences; pause, resume, speed change and a long hitch fed straight to the driver (the renderer clamps frames over 200 ms before the host sees them, so the hitch test calls the driver directly) | S3 |

### Wave 3: one authority

| # | Story | Issue | Priority | Modules | Acceptance criteria | Tests | Depends on |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S9 | The engine answers commands; the instance mirrors | #954 | P1 | `src/wasmhost/wasmHost.ts`, `src/dualrun/mirror.ts`, `engine-rs/src/wasm.rs` | Under `?engine=wasm` every player command runs on the engine first and the caller gets the engine's result in one shape (`{ ok, reason?, delta? }` plus named fields); the instance skips a refused command; while hosted only the engine logs and emits events, refusal text comes from the engine's `reason`, and UI notices still reach the log through `emit`; a load or undo boots the engine from engine-written bytes (AD-8); a disagreement is reported and the engine's state wins | A test per command that the returned result is the engine's; a forced disagreement is reported; e2e on `chromium-wasm` | S4, S6 |
| S10 | Tier every binding export; confine tier 3 | #946, with #923 | P1 | `engine-rs/src/wasm.rs`, `src/dualrun/`, guard tests | Every export listed in one tier table, methods without a `js_name` included, host-loop ops (`tick`, `drainGameplayEvents`) allowed only in the host, the dual run and tests; a test that parses `wasm.rs` fails on an untiered export; a guard fails on a tier 3 call outside `src/dualrun/`, the host's suppressed frame sync in `src/wasmhost/`, the tooling in `scripts/`, the generated package in `src/public/engine/`, and tests (`src/tests/**`, `*.test.ts`, `e2e/**`), including writes to `sim.money` and calls to `tower.setCars` or `tower.resizeTransport` from UI and game code (`src/ui/`, `src/game/`, `src/render/`) that the mirror would relay; the TypeScript engine's own calls in `src/engine/` are its implementation and stay out of the guard's scope. Argument validation stays on #923 | Guard tests; boundary validation tests in both engines | S1, S9 |
| S11 | Refusal reasons and their order pinned | #865 | P2 | `conformance/`, runners | Scenario steps can pin `reason`; a refusals scenario covers the four-star gates | Conformance in both runners | none |
| S12 | Save edge cases | #858, #856 | P3 | `engine-rs/src/load.rs`, `src/storage/` | Hand-edited numbers load as the TypeScript loader reads them, or fail with the same message; a save at RNG state 0 reloads at state 0 | Loader table cases; round-trip tests | none |

### Wave 4: the flip

S12 and S14 are P3: if open at the flip, they go in the exception register.

| # | Story | Issue | Priority | Modules | Acceptance criteria | Tests | Depends on |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S13 | Performance baseline and budgets for the engine | #900 (with #905, #849 as found) | P2 | `e2e/` perf spec, `scripts/` | `npm run perf` compares each engine with its own baseline in CI; the late-game and 5,000+ population fixtures report tick time, cold load and heap for both engines | The perf spec on both engines | S6 |
| S14 | Analytics close-out: fx and counter pins, drain glue, #873 | #879, #907, #873 | P3 | `engine-rs/src/gameplay.rs`, `src/analyticsEngineBridge.ts` | A deliberate off-by-one at any fx or counter site fails a test in both engines; one typed drain; #873's remaining phases closed or split | Both engines' unit tests; the bridge's consent, session-swap and exactly-once tests | S1 |
| S16 | Engine package delivery: a content-hashed package URL or a version check, the precache decision, and a fallback-use signal | #945 | P1 for the flip | `src/wasmhost/startWasmHost.ts`, `vite.config.ts`, `scripts/vercel-build.sh` | An old cached shell never runs a newer package (or refuses it with the fallback); the offline rule is decided; each fallback and each engine-writer latch-off (S2) is counted in the host status and, with consent, in analytics | Unit tests for the version check; an e2e that serves a mismatched package; the existing hash guard stays | S2, S4 |
| S17 | UI version and engine identity in About, with Copy Diagnostics | #963 | P1 | `engine-rs/src/wasm.rs` (one identity call), `src/wasmhost/engineLabel.ts`, Help's About | The UI version and commit, the active engine (Rust/WASM, TypeScript default, or TypeScript fallback with its reason), and the engine's own versioned identity record (crate version, build hash, protocol, frame layout and save format versions, catalog and lock digests) read from the binding; mismatch and unavailable states from S16's check; works when the engine never loaded | Rust unit test pinning the record; UI tests for every state; a source guard against identity literals in TypeScript; e2e for loaded, failed and mismatched packages | S16 |
| S15 | The release gate, one release on the TypeScript default with the new instrument, then the flip as 3.0.0 | #945 | P1 | `package.json` (3.0.0), `src/wasmhost/engineChoice.ts`, `CLAUDE.md` | Every row in section 6 passes (on the candidate commit, or over its stated window), with the exception register attached; the CLAUDE.md source-of-truth line names `engine-rs` for gameplay rules, caps and tuning | The rows themselves | S2 to S11, S13, S16, S17 (S12 and S14 enter the exception register if open) |

### After the flip (not cutover blockers)

- **Dedicated Web Worker** (#908 step 1): the engine instance, the clock and
  command execution move into one worker; rendering and input stay on the
  main thread. Tests cover worker start and restart, stale messages,
  backpressure, step debt, pause and speed changes, background throttling,
  save and load, and replay. It helps responsiveness; simulation throughput
  stays the same.
- **Parallel phases** (#908 step 3): only after a measured phase profile,
  behind a cargo feature, with the serial step as the reference and the
  referee run with the feature on and off. Shared memory and cross-origin
  isolation costs are assessed before any WASM threads ship.
- **TDT through the engine on the web** (roadmap row 5: the binding already
  exports `importTdt` and `exportTdt`; the web wiring and the lock remain),
  **copy catalog** (row 6), **crate release** (#893), and **retirement** (row 7,
  `story-engine-retire-typescript`) after two releases on WASM.

## 6. Release gate for the default flip (#945)

Every row passes on the flip candidate's commit, except the two measured
over time: Seeded replay covers the 14 nights before the candidate, and
Reliability covers the release on the TypeScript default that precedes it.
Rows marked "proposed" are provisional (owner, 2026-10-13): they bind only
after their baselines and measurement methods are approved.

| Gate | Pass condition |
| --- | --- |
| Conformance | Every scenario matches in both runners; refusal reasons pinned (S11) |
| Dual run | A day on every fixture at every speed with no divergence, with the Rust step driver (S8) |
| Seeded replay | The nightly fuzzer plus a seeded random-command differential that compares full saves, money, logs and gameplay events at each hour; failing seeds kept and shrunk; no divergence over 14 nights |
| Analytics | Each gameplay event once per action on the engine; consent off sends nothing; a tower swap and a page hide drain exactly once (the #938 bridge tests on `chromium-wasm`) |
| Unit and integration | The vitest suites pass on the engine, or each exclusion is named in the mapping table (S3) |
| End to end | The `chromium-wasm` project is green, including a forced-trap fallback spec (S4) |
| Authority | No command answer comes from the instance (S9, #954); every export tiered and tier 3 confined (S10); the UI reads no TypeScript price or rule table (S7) |
| Saves | Every fixture and the loader table round-trip byte for byte through the engine; the 32 MiB cap and Unicode cases fail the same way in both engines |
| Performance (proposed) | Late-game fixture: Modern tick time no slower than TypeScript (roadmap rule); cold load within +500 ms of the TypeScript build; heap within 1.25x; a 5,000+ population fixture within the TypeScript engine's own `npm run perf` baseline (S13) |
| Reliability (proposed) | One release on the TypeScript default with the engine instrument (S16's signal): over at least 1,000 engine sessions whose players consented to analytics (proposed minimum), engine fallback in under 0.1% of them, no engine-writer latch-off (#953), and every divergence report triaged to a cause |
| Rollback | A rehearsal flips the default back with the flag and loads saves written by the engine build |
| Deployment | S16 done: an old cached shell never runs a newer package, the offline rule is decided, and no deploy serves an engine package whose hash differs from the sources (today `scripts/vercel-build.sh`'s hash guard; with #958 every failed build fails the deploy) |
| Version identity | About and Copy Diagnostics show the UI version and commit, the active engine with any fallback reason, and the engine's identity record from the binding, including the mismatch and unavailable states (S17, #963) |
| Coverage | `vite.config.ts` floors and the Rust job's line floor hold |
| Sign-off | The owner approves with the exception register attached |

## 7. Owner decisions (2026-10-13) and remaining risks

Decided:

1. **Command authority before the flip.** The engine answers every command
   authoritatively before 3.0.0 (S9, #954); it is a flip gate.
2. **Thresholds are provisional.** The performance and reliability numbers in
   section 6 bind only after their baselines and measurement methods are
   approved (S13, S16).
3. **The engine owns game time.** The step driver and the day pace curve live
   in the crate (AD-2, S8, #867).
4. **3.0.0 is the major release**, subject to the compatibility policy the
   crate release publishes (#893). Retirement (roadmap row 7) is internal;
   the retirement story's AC5 ("major") is corrected when that story is next
   updated.
5. **CLAUDE.md moves to `engine-rs` during the cutover.** The line naming
   `src/engine/facilities.ts` as the source of truth for gameplay rules, caps
   and tuning is amended to name `engine-rs` in the flip PR (S15).

Still open (risks, no decision needed yet):

- **Offline play at the flip.** Decided (owner, 2026-10-13): the service
  worker precaches the engine package with the game shell for every player,
  so an installed game starts the engine offline (2.29.7, #945). Still open
  under S16: the version check for a shell cached before 2.29.7 (its worker
  never precached the engine, so until it updates it pairs its old shell with
  whatever engine the network serves), an e2e that serves a second deploy to
  exercise the update path, install interruption, and cache eviction.
- **Save format bumps.** The copy catalog (row 6) bumps the save version; it
  does not ship in the flip release, so a rollback can still read every save
  (AD-5).
- **Malformed saves.** The recommendation is to match the TypeScript
  loader's coercions (#858).

## 8. Issues

Reused: #865, #867, #868, #874, #878, #879, #893, #900, #902, #906, #907,
#908, #919, #921, #922, #923, #926, #935, #945, #946, #856, #858, #873.

New: #954 for S9 (engine-authoritative command answers) and #963 for S17
(UI version and engine identity in About, a pre-3.0.0 requirement). #945 (the release
gate) and #946 (binding export tiers) are extended.
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
- The owner's mainline reconciliation of 2026-10-13 (a section 10 added to
  the earlier draft) is folded in: #950 has since been rebased onto #930
  (head `053ef8e`) and S1 keeps the regeneration check, and #953's writer scope and boundary tests are
  in S2. #949 (byte-identical engine writer) is merged; routing live web
  saves through it is #953.
