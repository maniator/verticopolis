# 4A Renderer bake-off: architecture study charter

**Status:** proposal, not an Architecture Decision Record and not an implemented BMAD architecture workflow.
**Owner decision needed:** selection or rejection of a web renderer switch after measured evidence.
**Related:** `gdd.md`, `epics.md`, `decision-log.md`.

## Question
Can a switch away from Excalibur improve large-tower frame pacing, texture handling, cold load and production art workflow **enough** to justify its cost, without disturbing Rust simulation authority or the browser UI?

## Current evidence, not assumptions
- Web runtime: Excalibur 0.32, with WebGL backing when available. `src/render/excalibur/TowerEngine.ts` owns camera, hit testing, scene, animation clock and draw.
- `src/render/excalibur/towerRegions.ts` materializes cached canvases per occupied region, schedules repaint via dirty flags and drains a limited number each frame; `towerSyncSchedule.ts` avoids sharing costly hourly work and region refresh in the same frame where feasible.
- Some elements intentionally paint each frame (sky and UI overlays). Dynamic actors have their own update and culling paths; some shared figures and cars are baked and cached.
- `src/render/atlas` and `docs/atlas.md` already provide a build-time atlas pipeline, animations/layers, normal maps, verified deterministic archives and cross-frontend manifest.
- The Rust/WASM host's own transfer/read-projection cost is under active 3.0 work. Large WASM-to-TS synchronization costs cannot be attributed to Excalibur.
- `src/render/scale.ts` is already `10x45`. Texture-size safety and existing pixel-art parity are current invariants.
- Existing visual reference measurements in the August 2026 GDD are single-sample historical evidence, not fresh v4 benchmark results.

## Candidate matrix

| Candidate | Pros to test | Disadvantages to test | Decision |
| --- | --- | --- | --- |
| **Excalibur (incumbent)** | Existing proven input, camera, culling, tile/region rendering; lowest migration cost | Canvas-based texture uploads and actors might limit richer layered animations | Keep as credible default |
| **PixiJS** | Dedicated fast 2D rendering, spritesheet batching, layered scene control | Own controller/hit-test loop and UI integration; possible portability and migration costs | Main challenger |
| **Phaser** | Mature 2D tooling and asset handling | Duplicates framework features the Rust host and UI already own | Only if finalist evidence requires |
| **Godot Web** | Shared visual technology with native Godot | Different browser download/runtime/compatibility characteristics | Exploratory only, not assumed |
| **Custom WebGL/WebGPU** | Fine-grained optimizations | Significant ownership and device-support risk | Not the initial solution |

No claimed speedups until comparable runs exist.

## Required experiment
1. Freeze v3.0 simulation host revision and a common read-only renderer projection. Every candidate uses the *same* authoritative input and events, not a different tick implementation.
2. Reproduce a test scene from a single seed/save and common atlas. Fixtures: small, medium, large and the largest representative 40k-plus-unit tower when available; include common high occupancy, underground layouts, dozens of shaft/region segments and mixed room states.
3. Deterministic visual sequences at 1x/4x sim speeds, pan, zoom in/out, building placement/preview, day/night and hourly lighting flip, cinematic effects, crowd/transport and idle camera. Browser/PWA and mobile-class profiles.
4. Run identical scene pixel dimensions, device scale, sampling/filtering, atlas pages, frame update frequency and culling policy. Document any unavoidable deviations before interpreting results.
5. Measure separately: engine tick, JS/WASM boundary, projection update, scene reconciliation, canvas rasterization, GPU texture upload, GPU draw, event/input, HUD, end-to-end frame pacing (median, p95, p99, 1% low), main thread long tasks, memory high-water, cold start, download, and context-recovery errors.
6. Pair runs with warmups, order randomization, multiple repetitions and raw machine/browser/driver metadata; compare after accounting for noise. Use `docs/performance/benchmark-protocol.md` as a base and document any new metric definitions. No opportunistic benchmark changes after observing a preferred result.
7. Verify web test parity and accessible input/gesture behavior. Test failed WebGL/WebGPU support and deliberate GPU context loss.
8. Record migration size estimate including changes to `towerScene`, `towerRegions`, hit-testing, UI overlays, screenshot pipeline, asset loader, PWA and Godot asset parity.

### Measurable gate requirements
- Declare pass thresholds before comparison runs for at least: median/p95/p99 frame time, 1% low FPS, memory high-water mark, cold-start time and bundle/download deltas.
- Publish a per-fixture pass/fail table for each candidate, plus one overall recommendation that cites the threshold table.
- Include the raw runs and environment metadata with each result set so a reviewer can reproduce the same decision.

## Outputs
- `baseline-inventory.md`: source and profiler map with current bottlenecks and known limitations.
- `benchmark-protocol.md`: reproducible commands, fixtures, devices, workload, pass thresholds and raw artifacts.
- `results.md`: each host's measured results; distinguish render time and Rust-host time.
- `ADR.md`: decision, cost/benefits, alternatives, rollback, compatibility and owner approval, including an explicit "stay on Excalibur" outcome.
- A scoped implementation story plan **only after** the ADR.

Those outputs are future 4A deliverables, not files claimed present today.

## Decision rules
- **Keep Excalibur** if it meets 4.0's art and frame/memory targets and alternatives offer no material measurable gain after factoring migration risk.
- **Switch to PixiJS** only if it wins important real workloads *and* preserves input/overlay/mobile behavior with a maintainable adapter.
- **Retain the existing browser UI** throughout the renderer spike. A DOM framework migration is not part of this decision.
- **No incompatible save migration** for an art or renderer backend change.
- Authoritative engine events and visible states must be projected, never simulated again in JS/Godot.
- Stage 4A is complete only with an owner-approved ADR and reproducible supporting evidence.

## Budget and exit conditions
No purchased art, libraries, paid benchmark services or new recurring expenses. Open source dependencies undergo license/security review.

**Stop:** if 3.0 architecture is not stable, the compared renderers use unequal workloads, WebGL recovery fails, the data is noisy enough to obscure a result, or the prototype violates gameplay conformance. Record the blocker; do not declare a winner.
