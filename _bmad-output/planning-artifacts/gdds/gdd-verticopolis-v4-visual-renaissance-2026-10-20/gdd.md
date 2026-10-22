---
title: Verticopolis 4.0 Visual Renaissance
game_type: simulation (tycoon / management)
platforms: [web, PWA, native Godot]
created: 2026-10-20
updated: 2026-10-20
status: proposed
release: 4.0.0
scope: visual presentation only
art_budget_usd: 0
---

# Verticopolis 4.0: Visual Renaissance
**GitHub tracking:** [v4.0 umbrella #1189](https://github.com/maniator/verticopolis/issues/1189), [draft planning PR #1188](https://github.com/maniator/verticopolis/pull/1188). Stage issues: [4A #1190](https://github.com/maniator/verticopolis/issues/1190), [4B #1191](https://github.com/maniator/verticopolis/issues/1191), [4C #1192](https://github.com/maniator/verticopolis/issues/1192), [4D #1193](https://github.com/maniator/verticopolis/issues/1193), [4E #1194](https://github.com/maniator/verticopolis/issues/1194), [4F #1195](https://github.com/maniator/verticopolis/issues/1195).

Game design document, planning proposal. Structured using the repository's `gds-gdd` workflow and existing Game Dev Studio canon. **No implementation or release authorization is implied.**

## Executive summary

### Core concept
Keep the same deterministic Rust simulation and SimTower-inspired, side-on tower-building game, while making the world more detailed, legible and alive. Improve visual feedback for a player inspecting a real running tower, rather than replacing simulation truth with decorative fiction.

**Release separation:** 3.0 establishes the authoritative Rust engine and host boundary. 4.0 revises the artwork, game renderer and presentation. The 4.0 implementation is **blocked until the owner explicitly opens work after the 3.0 stabilization gates**. Planning can proceed earlier.

### Players and goals
Primary audience: existing Verticopolis players, including fans of the 1994 SimTower who care about a dense, believable miniature building. Secondary audience: new simulation/management players using desktop browsers, mobile/PWA or the native Godot client.

A player should:
1. Recognize office, hotel, residence, retail, services and transport at ordinary play zoom.
2. Understand empty, occupied, closed, dirty, stressed, burning and under-construction states without searching menus.
3. Enjoy looking closer at original, varied furniture, characters, signage and environment animation.
4. Experience equal or better responsiveness on representative large towers.

### Four visual pillars
1. **Read the building first.** Dark structure, discernible room boundaries, strong venue silhouettes, distinct but controlled accents.
2. **Detail survives scale.** Furnished miniature interiors with intentional texture and lighting that still read at half zoom, not visual noise.
3. **Life reflects engine truth.** Visible occupancy, queues, elevator riders, time-of-day, staff and emergencies agree with the Rust state. Cosmetic loops never imply extra simulated entities.
4. **One art language, multiple hosts.** Web and Godot share versioned atlases, asset semantics, animation data, licenses and test samples, without forcing both to use the same renderer.

## Existing canon and non-regression contract

This is a **successor**, not a replacement, to:
- `_bmad-output/planning-artifacts/gdds/gdd-verticopolis-2026-08-09-visual-parity/gdd.md` and its `decision-log.md`, including measured retail references, the 4.5:1 geometry, restrained palette and disciplined image density.
- `_bmad-output/planning-artifacts/design/gdd-pixel-art-overhaul-2026-07-14.md` and `arch-pixel-art-overhaul-2026-07-14.md`, which already delivered an earlier original pixel-art enrichment.
- `docs/design-system.md`, which defines the Windows 3.1-inspired UI and accessibility grammar.
- `docs/atlas.md`, `src/render/atlas/**` and the tagged, reproducible atlas release pipeline.
- `docs/performance/hot-path-review.md` and the release 3.0 WASM performance gates.

As verified on 2026-10-20, `src/render/scale.ts` already has `TILE = 10`, `FLOOR = 45`, and texture-safe shaft bands. **Do not re-open this implemented geometry work** or conflate the legacy art redesign with 4.0.

Keep Classic and Modern gameplay semantics and all gameplay conformance hashes unchanged for the same loaded states. A possible **Legacy / Enhanced artwork preference** must never change the existing `classic` / `modern` *simulation* mode. Preserving a separate visual preset is a proposal, subject to memory/performance feasibility and owner approval.

## Core gameplay and progression
No gameplay change. Players still construct floors, place facilities, adjust prices and elevators, manage service capacity and watch their tower grow. Building, inspect, selection, camera, zoom, undo and controls retain their meanings. Ratings, win/loss, economy, event decisions and save rules remain under the Rust engine.

Visual changes should improve that loop: place, inspect, understand why a room succeeds or fails, adjust it, and see the consequence.

## Simulation-specific design
- Draw room occupants from the authoritative presentation projection, never synthesized headcount. Cosmetic animation may reposition existing figures.
- Represent travelers, queues and car occupancy from engine data. No invented passengers or productive workers.
- Differentiate closed shops, vacancies, construction, disasters and operational warning cues in addition to decorative lighting.
- Preserve structural versus tenant layers, shaft seams, multi-floor venues, basements and hit-testing geometry.
- Give rooms a visual identity across day and night, zoom, color-blind-relevant cues, and reduced-motion settings.
- Use depth layers deliberately: shell/background, furniture/people, foreground trim, optional effects. No universal filter that destroys the distinctive SimTower-like density.

## Art direction

**Enhanced side-view pixel art**, original to Verticopolis. The 1994 game is a *visual-reference benchmark*, never a source of extracted or copied sprites. Preserve an unmistakable cross-section, grid discipline and dark architectural anchors. Make furnishing and characters richer with selectively animated details and more varied layouts, particularly the common office/condo/hotel rooms that dominate large towers.

The exact look must pass an **owner-approved five-facility art prototype** before all kinds are redrawn: office, condo, hotel, restaurant and elevator, each in several states. Compare with the existing renderer at matching camera/zoom. The owner previously required room-art approval; carry that requirement forward.

**Art budget:** $0 in new paid tools, commissions, subscriptions or asset licenses for the 4.0 plan. Use original work, existing procedural sources, permissively licensed assets with recorded provenance, and free tools. AI concepts can support exploration; generated samples require curation and originality review before entering an asset pack. Free external assets do not automatically fit the art direction or license policy. Any later spend requires a separate explicit owner decision and is outside this scope.

**Audio:** preserve current music and gameplay audio unless a separate, approved visual-feedback change needs an existing sound hook. No soundtrack overhaul in 4.0.

## Player experience and accessibility
- Desktop, phone and PWA maintain full interaction parity and accessible controls.
- Honor reduced motion, screen-reader descriptions, contrast, keyboard focus, touch targets and existing state cues.
- Show a readable overview at low zoom and richer interior details at close zoom. Avoid tiny controls for mobile.
- Improve panels incrementally under the existing UI architecture and design tokens; no blanket framework migration without evidence.
- Keep visible errors and overlays distinguishable from decorative glow and particles.

## Technical and asset requirements, outcome level
- Rust remains the single simulation authority on healthy 3.0 hosts. The rendering layer consumes a versioned read projection and issues commands through the host. It never keeps a second authoritative TypeScript `Simulation`.
- A renderer bake-off must compare **existing Excalibur against PixiJS** using equivalent art, geometry, culling and input. Phaser or Godot web can be added only if a measured reason justifies the comparison. A migration is **not assumed**.
- Reuse and extend the existing atlas exporter, manifest, animations, layers, normal maps and pinned visual toolchain before designing a new asset pipeline. For authored sources, keep canonical editable art files and reproducible exported packs; the current procedural format remains usable.
- Measure performance in the real browser, with separated Rust/WASM and renderer times. Include large towers, phone-class devices, zoom, lighting flips, viewport pans, context loss/recovery, load and memory pressure. Baselines and pass thresholds are ratified during 4A, not guessed here.
- Version the art/animation contract, validate content hashes and licenses, and let web and Godot reject incompatible packs clearly.
- No requirement for paid software, commercial art or GPU-only features unavailable to the supported fallback profile.

## Development epics
Detailed gates and acceptance criteria: `epics.md`.

| Stage | Scope | Gate |
| --- | --- | --- |
| 4A | Renderer audit, fair benchmark and architectural decision | Owner approves measured choice |
| 4B | Art direction, five-facility prototype and portable asset pipeline | Owner approves actual room designs and $0 provenance |
| 4C | Production rendering integration, conditional migration | Interaction parity and no gameplay state duplication |
| 4D | Full facility, actor and environmental art pass | State-complete visual inventory |
| 4E | UI, inspector and responsive presentation polish | Accessibility and control parity |
| 4F | Performance, visual QA, compatibility and release | Measured release gate and owner approval |

## Definition of success
- Art prototypes judged better than current rooms by the owner at actual play zoom, and distinct from copied SimTower assets.
- All cataloged facility/state combinations covered, including night, vacancy, construction, disasters and service cues.
- No divergence in gameplay conformance, save round trips or host command behavior.
- No material regression to baseline median/low-tail frame pacing or memory on the tested hardware. Exact statistically credible pass bands agreed in 4A, before the comparison is interpreted.
- Browser and Godot load the same versioned art vocabulary; any platform-specific divergence is explicitly documented.
- Existing integration, accessibility, screenshot and coverage gates pass.

## Out of scope
- New economy, progression, facilities, disasters, seasons or simulation mechanics.
- Extracting original SimTower artwork or other third-party copyrighted game assets.
- Converting all platforms to Godot, committing to PixiJS before benchmarking, or replacing the Rust simulation.
- Starting this implementation in parallel with unsettled v3.0 Rust authority and performance work.
- Paid artwork or introducing hidden subscription dependencies.

## Assumptions and owner decisions
- [ASSUMPTION] A single asset spec can cover browser and Godot without forcing identical material/shader effects; prototype to validate.
- [ASSUMPTION] Excalibur can remain an acceptable 4.0 choice if a bake-off finds no meaningful advantage in a migration.
- [NOTE FOR DESIGNER] Decide whether legacy art should remain as a runtime choice after the memory and shipping cost is measured.
- [NOTE FOR DESIGNER] Sign off on the five prototype rooms and the 4A benchmark/renderer decision before major implementation.
- [NOTE FOR DESIGNER] Any nonzero art purchase is blocked unless explicitly approved later.

## Source references
- `docs/atlas.md` and `src/render/atlas/`
- `src/render/excalibur/{TowerEngine,towerRegions,towerScene,towerReconcile}.ts`
- `_bmad-output/planning-artifacts/gdds/gdd-verticopolis-2026-08-09-visual-parity/`
- `_bmad-output/planning-artifacts/design/{gdd-pixel-art-overhaul-2026-07-14.md,arch-pixel-art-overhaul-2026-07-14.md}`
- `_bmad-output/planning-artifacts/design/ui-rendering-engine-2026-07-14/`
- `docs/performance/hot-path-review.md` and `docs/performance/benchmark-protocol.md`
- `AGENTS.md` and `CLAUDE.md`
