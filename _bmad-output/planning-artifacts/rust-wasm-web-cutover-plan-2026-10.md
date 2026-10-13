# BMAD: Rust/WASM web cutover, remaining work and release gate

**Status:** Draft planning proposal; no implementation or cutover authorized.  
**Scope:** Public `verticopolis` Rust engine + TypeScript web host.  
**Decision:** Do not remove the TypeScript engine or its fallback until the measurable gates below pass.

## 1. Problem and desired outcome

Verticopolis has two implementations of gameplay behavior: the original TypeScript `src/engine` and Rust `engine-rs`. The goal is one authoritative, portable Rust simulation powering WASM/web and other future clients, without gameplay, economic rules or analytics duplicated in the frontends. Presentation and platform delivery remain frontend responsibilities.

This document is a **BMAD-style planning input** for product/architecture review and story breakdown, not a claim that the full codebase has been audited or tests executed. Verify every gap against current `main` before implementation. Existing issues should be extended instead of duplicated.

## 2. Evidence and constraints

- TypeScript `src/engine/Simulation.ts` exposes gameplay and read APIs including `stats()`, `incomeBreakdown()`, `previewRentBatch()`, `isUnlocked()`, `canBuild()`, and event draining.
- Rust organizes functionality across `sim.rs`, `sim_loop.rs`, `events.rs`, `gameplay.rs`, `economy.rs`, etc. Missing same-named methods in `sim.rs` alone **do not** prove missing behavior.
- WASM `engine-rs/src/wasm.rs` exposes commands, snapshots, event draining, telemetry, TDT and save encoding, but does not expose `stats()` and `incomeBreakdown()` under those names. Determine the intended read-model equivalents rather than recreating simulation logic in TS.
- WASM also exposes low-level mutations (`setMoney`, `setCars`, `resizeTransport`, `removeUnit`, `removeTransport`) alongside engine-owned charge commands. Audit and separate privileged restoration/debug operations from player actions.
- `src/dualrun/mirror.ts` and `shadow.ts` compare canonical state/crowd views, which are necessary but insufficient for UI-only behavior, error messages, save prose, analytics and host lifecycle.

## 3. Requirements

**FR1 Single engine:** All gameplay, prices, unlocking, time progression, RNG, event eligibility, building, rent, emergencies and refunds are computed by Rust. Web clients only send commands and render authoritative results.

**FR2 Behavioral parity:** Existing web player journeys retain outcomes, refusal reasons, logs, state transitions and undo/redo behavior, including classic/modern modes and migrated towers.

**FR3 Persistence:** Existing web `.vctower` files and supported legacy saves import and round-trip through WASM; malformed, oversized, corrupted and Unicode edge cases fail safely and consistently. No silent data loss.

**FR4 Frontend contract:** Web UI can obtain all necessary build previews, catalog/unlock state, income breakdown, stats, logs, analytics events, frame and structural data from a documented, versioned engine read model. No UI-only recreation of engine decisions.

**FR5 Performance and reliability:** Deterministic fixed-step simulation, frame-rate-independent gameplay, bounded memory, existing WASM-host lifecycle recovery, robust cancellation/attach/detach and observable failure reporting. A new dedicated Web Worker and its worker-specific recovery tests are post-cutover follow-up work under D2/#908, not a prerequisite for the web engine switch.

**FR6 Cross-platform parity:** Same public engine crate and compatible saves/commands for WASM/web and future engine consumers. A change to shared rules must pass both host gates.

## 4. Epics and stories, in dependency order

### Epic A: Contract inventory and source-level parity (P1; prerequisite)

**A1** Inventory all TypeScript `Simulation`/`Tower` public methods, reads and direct writes and map each to a Rust engine implementation and WASM API, recording `implemented`, `equivalent read model`, `host-only`, `missing`, or `intentionally deprecated`. Explicitly inspect `stats()`, `incomeBreakdown()`, `canBuild()`, `isUnlocked()`, rent previews, building refusal details and structural views. Deliver a checked-in matrix with file references, owner and tests.

**A2** Audit engine rules in modules rather than comparing filenames: simulation clock, demand, economy, elevators/dispatch, occupancy/crowd, events, milestones, parking, services, RNG, construction, rent, and all game modes. Capture intentional differences as approved product decisions.

**A2a Clock ownership and scheduling:** Document the authoritative Rust `Clock` in `engine-rs/src/clock.rs`, its ownership by `Simulation` in `sim.rs`, and advancement/hour/day hooks in `sim_loop.rs`. The web host schedules elapsed-time tick requests and controls pause/resume/speed; it must not maintain a competing authoritative game clock or apply gameplay time rules. Verify the WASM host's fixed-step accumulator, tick-size caps, speed multipliers, background-tab throttling, pause/resume, save/load time restoration, and deterministic replay at different rendering frame rates. Add tests proving equal game-time advancement and identical hour/day effects for the same command/tick sequence, with no skipped or duplicated boundaries.

**A3** Inventory every web and future clients mutation path; classify commands as player-facing or privileged restore/debug. Guard raw setters and prove that money, removal, car and extension charges cannot be bypassed through UI routes. See #923.

### Epic B: Automated parity and compatibility (P1; prerequisite)

**B1** Run the original TS unit and integration suites against the WASM-backed implementation; convert uncovered tests and track results under #878. Preserve exact refusal/error shapes, text and ordering where player-observable.

**B2** Differential long-run seeded tests: execute identical randomized command sequences in TS and Rust; compare full serialized saves, crowd, money, ledger, logs and emitted gameplay events, not only hashed state views. Persist and minimize failing seeds. Include boundary-hour, day/month, classic/modern and rare-event scenarios.

**B3** Cross-format save fixtures: TS -> WASM -> TS, plus legacy migrations, founder state, malformed UTF-8, lone surrogate escapes, duplicate/colliding repaired keys, nonfinite/JS numeric coercions and 32 MiB limit. Treat merged PR #944 as a tested baseline, not pending work; extend coverage under #858 and the remaining durability/recovery tasks.

**B4** Current WASM-host lifecycle tests: engine attach/detach (whether currently on the main thread or existing infrastructure), in-flight load, stale generation, errors, restart, undo/redo, context loss and exterminator-booking attach (#902). No empty-tower reset or unhandled stale engine handles. Dedicated-Web-Worker lifecycle and backpressure tests belong to the post-cutover D2/#908 implementation, not this prerequisite.

### Epic C: Complete and stabilize frontend APIs (P1; after A)

**C1** Close the read-model and build-quote gaps in #868 with a stable schema: frame, structure, queries, stats, income, build rules, preview/refusal reasons, logs and gameplay events. Avoid repeatedly serializing whole towers to derive simple UI data.

**C2** Reconcile catalog and engine-owned charges with public #930 and merged #928. Enforce shared price/build/unlock policy across both hosts.

**C3** Verify the merged engine-event analytics bridge (#873, merged PR #938): test deduplication, tower resets, event ordering, consent and suppression without attributing a new tower to an old funnel. Engine events remain provider-agnostic; the web forwards them to its analytics provider only.

**C4** Document API/version compatibility between public engine commit, WASM package and any published engine consumers; add compatibility CI that detects drift.

### Epic D: Performance, accessibility and production operations (P2; before broad rollout)

**D1** Measure WASM cold load, save/import/export latency, tick throughput, heap/memory, long sessions and 5,000+ population. Compare against TS baselines; track #900 and #908. Set explicit thresholds based on real devices.

**D2** Worker-ready boundary and post-cutover worker migration (#908): **Cutover prerequisite:** keep the Rust engine accessible through a DOM/React-independent, versioned command/read-model interface, with explicit lifecycle, cancellation, error and snapshot semantics. **First post-cutover follow-up:** move the existing single-threaded WASM engine instance, game clock and command/tick execution into one dedicated Web Worker; keep rendering and input on the main thread. Batch commands and snapshots, measure serialization/copying overhead, and evaluate transferable binary buffers only where profiling justifies them. Test worker startup/restart, stale messages, backpressure, fixed-step debt, pause/resume, speed changes, background-tab throttling, save/load, deterministic replay and UI responsiveness. A worker improves UI responsiveness but does not inherently increase simulation throughput. **Later optional optimization:** profile expensive independent phases before attempting Rust/WASM multithreading; retain a deterministic serial reference and verify RNG, ordering and state parity. Assess shared-memory/cross-origin-isolation requirements, browser support, fallback behavior and deployment costs before enabling threads. Do not make parallel WASM a cutover blocker without measured evidence.

**D3** Public engine consumer compatibility: verify the versioned engine contract, conformance fixtures and supported import/export behavior without depending on any unreleased client implementation.

**D4** Observe failures and implement feature-flagged gradual rollout, telemetry, safe rollback to TS, and explicit migration rollback constraints for saves written by newer Rust builds.

### Epic E: Cutover and retirement (P1 release decision; after A-D gates)

**E1** Ship internal WASM-only mode with TS comparison in CI, then opt-in canary. Record zero unexplained divergences in agreed deterministic coverage and meet performance/error budgets.

**E2** Publish a go/no-go report with links to tests, conformance artifacts, open exceptions, device measurements, save fixtures and rollback rehearsal. Explicit owner sign-off required.

**E3** Switch the default web engine only after E2; retain a temporary rollback lane. Remove TypeScript simulation implementation only in a later, separate PR after compatibility and telemetry observation.

## 5. Definition of done / release gate

- [ ] A1 parity matrix reviewed, all web API dependencies mapped; no unexplained missing feature.
- [ ] Original TS suites pass on WASM (#878), plus long-run differential and host lifecycle tests.
- [ ] Existing real user saves and synthetic edge cases round-trip without silent loss; migrations tested.
- [ ] No unguarded gameplay path bypasses Rust economic or construction rules.
- [ ] Web integration and public engine contract gates pass against the selected engine revision.
- [ ] Performance and memory targets recorded, CI green, test coverage thresholds maintained.
- [ ] Rollback demonstrated and approved; no untriaged P0/P1 cutover defect.
- [ ] Product owner approves cutover with a documented exception register.

## 6. Existing tracking / avoid duplicate work

Public: #878 WASM suite parity; #868 frontend read model; #858 save-number fidelity; #886 TDT parity; #900 WASM performance baseline; #902 host attach issue; #908 worker/performance; #923 command argument validation; #873 analytics; open PR #930 catalog and draft PR #950 simulation-layer capacity events; merged PR #938 analytics, merged PR #944 save Unicode/cap. Public PR #928 is closed; verify its merged commit rather than treating it as pending.


## 7. Risks, assumptions and open decisions

1. **Save format versioning:** what is the oldest supported save and how will Rust-written saves be rolled back to TS?
2. **Numeric and Unicode semantics:** does compatibility mean matching JS coercion and malformed inputs exactly, or refusing previously accepted malformed saves with explicit messaging?
3. **Read API ownership:** what data must Rust calculate versus what the frontend may aggregate purely for display?
4. **Privileged operations:** how should undo, import, migration, testing and debug paths access raw setters without weakening player-command invariants?
5. **Analytics privacy and provider boundaries:** confirm event schema, consent handling and attribution lifecycle before making Rust authoritative.
6. **Release split:** future client release acceptance is independent of the web cutover; the public engine's compatibility guarantees must remain documented.

## 8. BMAD execution handoff

Run BMAD product/architecture review on this proposal, confirm scope and acceptance thresholds, then break epics into appropriately small implementation stories with dependencies and explicit test evidence. Use the repo's `_bmad/bmm/config.yaml` paths: planning artifacts in `_bmad-output/planning-artifacts`, implementation artifacts in `_bmad-output/implementation-artifacts`. This proposal belongs in planning artifacts and must not be mistaken for completed implementation.

For coding agents: before implementation, restate requirements and flag missing/truncated instructions; make small meaningful commits; run relevant tests and CI coverage gates, restore coverage above required thresholds, and report the exact evidence and remaining exceptions. No giant all-in-one migration PR.

## 9. PR reconciliation update (2026-10-13)

This section supersedes older references to pending PRs elsewhere in this planning input. It is **public-engine/web-only** scope; no non-public repository topology or implementation details belong here.

- **Merged #938:** provider-agnostic gameplay analytics forwarding exists. Retain consent, session-swap and event-drain regression coverage; do not file a second bridge implementation.
- **Merged #944:** web save Unicode repair and 32 MiB reader/writer limits exist. Continue cross-engine pathological save, normalization collision, numeric and migration parity fixtures rather than recreating the codec.
- **Open #930:** catalog API, nested structural validation, parity digests and charged-price checks were added on its reviewed head `0bf96e43`. Test CI and Rust engine workflows were green on that head. The PR was subsequently rebased to `640219a9`, which GitHub reports mergeable, with fresh workflows still in progress at review time. Wait for those exact-head checks and verify the eventual merged tree before marking C2 delivered; do not treat this API as already on `main`.
- **Draft #950:** moves TypeScript `capacity_changed` emission to `Simulation` and introduces explicit bare-tower WASM calls for differential replay. Re-review after the final merge/base update. The new `towerSetCars` and `towerResizeTransport` exports must be classified and protected under A3: they bypass the simulation-layer event and player-facing charge paths. No new public mutation escape hatch should become a production UI route.
- **Open #943/#831/#817/#816:** rendering/atlas work is independent of the Rust simulation cutover except for canonical data contracts and render-performance baselines. Do not hold the engine cutover for unrelated art-review decisions.
- **Open #947:** this BMAD planning PR. Its current-wasm-host lifecycle/recovery tests are prerequisites; the dedicated Web Worker introduction and worker-specific tests remain post-cutover under D2/#908.
- **Public #948/#952:** workflow configuration and web notices are not part of engine-cutover implementation. Apply public-content boundary checks to any public automation/planning change; never import details from non-public projects into public PRs, commits, issues or documentation.

**Handoff:** Before implementing any story, refresh the public PR queue and merge SHAs; identify implemented, unmerged and genuinely missing work. Retest dependency interactions in the final merged tree. Every story should have a small diff, targeted tests, passing coverage thresholds and a concrete rollback or recovery path when relevant.

## 10. Mainline reconciliation after the 2026-10-13 merges

**Current public main snapshot:** `87527a06086e72412f01371cafbd304881672aa3`. This section supersedes the status claims in §§6 and 9; it does **not** imply that an open implementation PR or its tests have landed. Refresh the snapshot before any merge or implementation decision.

- **Merged #930, engine catalog:** The public Rust and TypeScript catalogs, versioned WASM catalog export, binding shape validation, charged-price tests and conformance digest lock are now on `main` (merge commit `562f1045`). Mark C2's *catalog implementation* as delivered; retain C2's read-model integration and cross-engine pin/consumer verification gates. Do not open a duplicate catalog issue.
- **Merged #949, engine byte-identical save encoder:** The engine's `.vctower` writer is byte-aligned with the web writer for the tested serialized/stamped save corpus (merge commit `1c2646b`). Do not confuse this with routing live web saves through WASM: that remains **open #953**.
- **Open #953, web save writer routing:** Proposed `?engine=wasm` path for `SaveGame.export` and `packSync`, with TypeScript fallback; asynchronous autosaves and existing `toTowerFile` conversion deliberately keep existing paths. Define whether one authoritative writer means full parity or just sync/export routing; run malformed writer output, byte equality, 8/32 MiB boundaries and degraded-host lifecycle tests before treating all web saves as engine-written.
- **Merged #938/#944:** Gameplay-event analytics and Unicode/save limits remain baseline code. Keep regression tests and avoid duplicate features.
- **Open #950 (P1 integration gate):** Simulation-layer `capacity_changed` and relay-only raw tower commands are internally coherent, and the new source guard constrains callers. However, inspected head `179f16d` predates merged #930: its generated JS/WASM build and TypeScript WASM declarations omit the `catalog(mode)` export now on `main`. Rebase, regenerate both APIs together, check `BUILD.json`/generated binding consistency, and run catalog digest **plus** event conformance against the combined artifact. Keep #923's broader raw mutation API policy as later hardening. No player edit should bypass the charged engine commands.
- **Open #943/#831/#817/#816:** Rendering and visual scale work continues independently of simulation cutover. Reference the merged frame/atlas contracts and avoid promoting art tasks into simulation blockers.
- **Merged #948:** The resulting committed party-mode customization is public-only and store-neutral; private-session orchestration is not in the public repository. Keep this boundary in future work.
- **Merged #952:** Public third-party license notices now have a tracked implementation backlog item (#951), not yet an implemented notice generator.

**Current cutover implications:** Run the A1 source/API matrix and deterministic replay against the merged catalog, save byte-alignment changes and latest public WASM binding, not the baseline reviewed before these merges. The new merged catalog and #953 change the compatibility inventory, but the engine cutover still requires D1 performance evidence, E2 sign-off and rollback rehearsal. The dedicated Worker remains post-cutover.
