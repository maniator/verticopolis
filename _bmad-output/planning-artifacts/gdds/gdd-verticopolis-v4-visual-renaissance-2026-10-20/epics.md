# Verticopolis 4.0: Visual Renaissance
## Epics and stage-level acceptance criteria

**Status:** planning proposal, owner-gated. Structured using the repository's `gds-gdd` epic summary and `gds-create-epics-and-stories` vocabulary. These are **stage/epic issues**, not implementation-ready sprint stories. Run detailed BMGD solutioning, implementation-readiness, and story refinement after the architectural and art gates.

### Scheduling and ownership
- No stage implementation starts before the explicit owner release from the v3.0 Rust cutover/stabilization. Planning artifacts and GitHub tracking only before that release.
- 4A and exploratory 4B research may be planned in parallel, but the production art pipeline and the 4C renderer architecture must follow the 4A decision. Owner must approve prototype artwork before batch authoring in 4D.
- Current priority is **P3/backlog**, with **no assignees** and no sprint commitment. Reprioritize when 3.0 exits its release gate.
- Stages are ordered dependencies unless this page explicitly says otherwise; do not create duplicate work for older design and visual-parity issues.
- All gameplay-visible work follows `gds-code-review`; renderer tooling/UI-heavy infrastructure also follows `bmad-code-review`, including `docs/performance/hot-path-review.md` HP-1 through HP-12 where applicable.
- A stage ending with an unresolved gate cannot be treated as complete, even if its code is merged.

### Cross-cutting definition of done
1. Rust authoritative simulation unchanged, conformance and save/replay checks green; no gameplay logic in presentation.
2. Versioned portable asset inputs, checksum/provenance, validated license metadata and deterministic renderer outputs.
3. The four standard web checks (`typecheck`, `lint`, `test`, `build`), relevant Rust/Godot checks, E2E and visual baselines run.
4. Normal and reduced-motion behavior, day/night, keyboard, pointer and touch, mobile layout, and WebGL loss/recovery covered.
5. Visual changes use owner-approved references and pinned Playwright baselines; intentional pixel differences documented with before/after comparisons.
6. No new paid tools, commissions, licenses or subscriptions, and no outside art with unclear permission.
7. Each PR contains small meaningful commits, a hot-path complexity record for affected files, regression tests, evidence and an issue reference.

## 4A. Renderer audit, bake-off and binding decision
**Purpose:** determine whether to keep Excalibur, adopt PixiJS, or justify a different web rendering backend. No predetermined migration.

**Work packages**
- A1. Document current browser rendering facts, actors, region compositor, dirty-region scheduling, GPU uploads, generated sprites, atlas export, camera/input, overlays, context restore and PWA behavior.
- A2. Define a frontend read-only Rust-host projection/renderer adapter contract compatible with the v3 Rust facade. No direct `Simulation` retention on the healthy path.
- A3. Prototype Excalibur and PixiJS on **the same** small, medium and large tower fixtures, viewport/camera paths, lighting transitions, zooms, 2D assets, animations and hit-tests. Include phone-class profiles and the owner desktop protocol.
- A4. Partition frame time into authoritative Rust/WASM state update, host transfer/read projection, texture/bake/upload, GPU render, input/overlay and DOM UI; compare median, 1% lows, long tasks, memory, load, battery/thermal proxy where feasible.
- A5. Record reproducible commands, environment, raw runs, baseline noise, statistical decision bands, bundle/PWA sizes, GL recovery, maintenance complexity, and owner decision record.

**Acceptance**
- Benchmarks use paired runs and the same authoritative input/data, not different simulations or different art.
- No unsupported FPS win claims. A renderer migration only proceeds if measured benefits on important fixtures outweigh migration, compatibility and maintenance costs.
- Explicit **keep Excalibur** pathway if PixiJS does not win.
- Explicit review of Phaser/Godot-web only on evidence of a use case current finalists cannot meet.
- Owner approves an Architecture Decision Record before 4C. The existing `docs/performance/benchmark-protocol.md` remains the starting point; no quiet relaxation of 3.0 gates.

**Dependencies:** released/stable v3 host facade and conformance. Planning and small nonshipping benchmarks may be drafted earlier, but production changes are gated.

## 4B. Art bible, prototype and reproducible assets
**Purpose:** ratify a visually stronger, original room language and asset delivery format at $0 cost.

**Work packages**
- B1. Inventory current facility kinds, subtypes, states, animation cycles, actor variants, overlays, SVG/Canvas painters, authored references and atlas coverage. Annotate previously completed 2026 pixel work so it is not repeated.
- B2. Write art bible: structure/value scale, reserved visual-semantic colors, room silhouettes, furnishing density, depth layers, light/dark scenes, level-of-detail and pixel-grid rules, including the **10x45** geometry already in code.
- B3. Produce an owner-review sheet and integrated sample for **office, condo, hotel, restaurant and elevator**, each with occupancy variants, lighting and warning cues; compare at useful zoom levels against 3.0 and the 1994 measured style criteria.
- B4. Extend existing versioned atlas tooling to import free authored source sprites where they improve the result. Preserve procedural recipes for useful variation. Define optional animation declarations, state mapping, deterministic packing, 1x/2x/4x texture constraints, checksums, schema migrations and manifest validation.
- B5. Validate actual browser and Godot readers against shared fixture assets, animation state, night/day selection, old-pack rejection and a reproducible toolchain. Document art contribution rules, provenance/licensing, review and allowed software.

**Acceptance**
- Owner explicitly approves the example room designs **before full catalog reauthoring**.
- Full provenance manifest for imported art, including author, license, source URL and transformed source file; if no third-party art is used, record that.
- Rebuilds reproduce known atlas manifests and exports in the pinned build environment.
- Art assets render correctly in the browser and the native Godot proof host. No dependency on paid art.
- Maintain a clear boundary between asset version, save version and simulation game mode.

**Dependencies:** stage 4A technical constraints and owner prototype approval. Do not replace `docs/atlas.md` without preserving existing consumers.

## 4C. Renderer and presentation contract rollout
**Purpose:** implement the chosen backend while preserving interactions and performance.

**Work packages**
- C1. Define narrow renderer interfaces for world projection, revisions/deltas, camera transforms, viewport culling, scene composition, input hit testing, selection, construction previews, overlays and context recovery.
- C2. Integrate selected renderer behind an opt-in feature switch with deterministic fixture tests. If Excalibur wins, migrate the art source and scene layering without introducing Pixi.
- C3. Draw static atlas-backed region layers and dynamic actors separately. Keep static texture uploads bounded on lighting changes and edits, and avoid full-scene rebuilds after each sim frame.
- C4. Preserve existing browser shell, lit-html DOM and UI controls until explicit 4E changes. No redundant gameplay authority or duplicate save state in a renderer.
- C5. Test camera/zoom, drag and paint, mobile gestures, keyboard navigation, full-screen resize, browser hidden/restore, GPU context loss and fallback.

**Acceptance**
- Existing save imports, commands and telemetry meanings unchanged.
- Browser screenshots and accessibility/regression suite green after expected baseline updates.
- No broad API change to the Rust crate solely for visual effects; read-only fields, if needed, reviewed as versioned contracts.
- The migration can be disabled or rolled back without converting player saves.
- Memory, frame pacing and cold-load thresholds from 4A met on reference machines.

**Dependencies:** 4A ADR and 4B asset/format approval.

## 4D. Facility, inhabitants and environmental animation
**Purpose:** complete the visual content promised by the ratified 4B bible.

**Work packages**
- D1. Prioritize recurring office, condo and hotel motifs, then food/retail, service, entertainment, lobbies, stairs/elevators and transport, then exterior scenery and events.
- D2. Complete the facility × state × subtype × time-of-day inventory. Record primary silhouettes at low zoom, close-up detail and unique behavioral/read-only visual cues.
- D3. Add reusable character poses and cosmetic cycles for working, walking, dining, cleaning and waiting where the simulation supports them, with reduced-motion and culling.
- D4. Include occupancy, closed/vacant/dirty/infested/under-construction/burning/gutted states as supported by the actual catalog; don't invent new engine states.
- D5. Keep visual checks across night/lit, different view positions and large-tower patterns to avoid identical rooms or geometry-seed seams.

**Acceptance**
- Every catalogued facility/state combination has a reviewed result or a documented fallback.
- Rendered occupant counts match authoritative projection. No fake crowds or extra riders.
- All new artwork is license-verified and within the $0 art budget.
- Owner signs off major art batches; preserve visible before/after documentation.
- No frame-wide redraw caused by an individual animated room.

**Dependencies:** 4B approved art samples and 4C supported runtime renderer.

## 4E. UI/UX presentation and responsive polish
**Purpose:** bring the rest of the interface into visual consistency without changing player controls or the product's identity.

**Work packages**
- E1. Audit the existing `docs/design-system.md` and lit-html components, including inspector, editor, tower stats, notifications, build palette and mobile controls.
- E2. Propose focused improvements to readability, hierarchy, information density, action feedback and touch usability, respecting the established retro window language.
- E3. Keep keyboard/screen-reader semantics, focus behavior, high-contrast or semantic state cues, and reduced motion.
- E4. Define which presentation tokens and media can be shared with native Godot without assuming identical DOM/Godot scene trees.

**Acceptance**
- No regression in usability, inputs, event resolution or functional UI copy.
- Dedicated mobile/desktop E2E interactions and accessibility checks.
- No DOM full-subtree rebuild per frame. No unnecessary UI framework replacement.
- Owner approves UI concept samples prior to sweeping style changes.

**Dependencies:** stable 4C rendering shell; portions of this may proceed alongside 4D after 4C gate.

## 4F. Visual/performance QA and release decision
**Purpose:** make 4.0 a measured release rather than a pretty screenshot.

**Work packages**
- F1. Build and run deterministic visual fixtures across states, Classic/Modern simulation, save loads, responsive sizes, light/dark and supported presentation presets.
- F2. Pair test against v3.0 renderer benchmarks on the owner desktop and supported phone profiles, including startup, pan/zoom, high occupancy, hourly light flip, large import, context loss and asset memory peaks.
- F3. Compare native Godot presentation semantics and atlas manifest versions against web fixtures, without claiming bit-for-bit platform raster parity.
- F4. Complete licensing/attribution/security audit, offline PWA pre-cache/update audit and graphics fallback/recovery tests.
- F5. Produce release notes, before/after captures, known limitations and explicit owner launch approval.

**Acceptance**
- 3.0 gameplay engine conformance still passes exactly.
- Frame-time and memory thresholds ratified in 4A met, or a separately documented, explicit owner waiver; no unspecified "close enough".
- Visual snapshots and E2E checks green through the pinned Playwright flow, with native smoke tests for shared art.
- Compatible saves, no lost towers; fallback for unsupported graphics or asset-pack corruption is explained.
- All six stages closed only with evidence and approved cross-host results.

## Decisions deferred, never assumed
- Backend selection; whether the browser stays on Excalibur or changes to PixiJS.
- Whether to ship a Legacy Art preference versus replacing all appearances with Enhanced Art.
- Specific art colors and sprite animations after review of the five-facility prototype.
- Native parity level beyond matching states and asset specs, if shaders differ.
- Benchmark noise band and 4.0 floor, set from actual baseline in 4A.

## Related existing issues and documents
- Current v3 authority gate: [#945](https://github.com/maniator/verticopolis/issues/945).
- Existing atlas work: [#909](https://github.com/maniator/verticopolis/issues/909), [`docs/atlas.md`](../../../../docs/atlas.md).
- Proposed raster-source approach: [#643](https://github.com/maniator/verticopolis/issues/643); assess as prior work, avoid creating a competing implementation issue.
- Prior visual parity: [August 2026 GDD](../gdd-verticopolis-2026-08-09-visual-parity/gdd.md).
