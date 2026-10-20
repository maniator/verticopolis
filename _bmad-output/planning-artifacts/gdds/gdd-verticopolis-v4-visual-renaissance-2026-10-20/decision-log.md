# Decision log: Verticopolis 4.0 Visual Renaissance

**GitHub tracking:** [v4.0 umbrella #1189](https://github.com/maniator/verticopolis/issues/1189), [draft planning PR #1188](https://github.com/maniator/verticopolis/pull/1188). Stage issues: [4A #1190](https://github.com/maniator/verticopolis/issues/1190), [4B #1191](https://github.com/maniator/verticopolis/issues/1191), [4C #1192](https://github.com/maniator/verticopolis/issues/1192), [4D #1193](https://github.com/maniator/verticopolis/issues/1193), [4E #1194](https://github.com/maniator/verticopolis/issues/1194), [4F #1195](https://github.com/maniator/verticopolis/issues/1195).

**Created:** 2026-10-20
**Status:** initial owner direction recorded; implementation and renderer decisions pending
**Companions:** `gdd.md`, `epics.md`, `renderer-bakeoff-charter.md`

## Owner direction (2026-10-20)

| ID | Decision and source | Status |
| --- | --- | --- |
| V4-D1 | Verticopolis **3.0** is the Rust/WASM engine cutover, **4.0** is the visual overhaul. | Owner-directed |
| V4-D2 | The original SimTower's visual richness is a reference. Improving the detailed miniature interiors matters more than changing gameplay. | Owner-directed |
| V4-D3 | Investigate whether runtime procedural drawing is a cost, and whether a more suitable web renderer or authored graphics improves performance and appearance. No forced technology switch. | Owner-directed question; architecture open |
| V4-D4 | **No money available for art.** Plan around a $0 new-art budget, free tools and freely redistributable original or permissioned assets. | Owner-directed |
| V4-D5 | Use the repository's BMAD/BMGD conventions; plan stages, issue structure and labels. | Owner-directed |
| V4-D6 | Existing v3 work remains the priority; 4.0 planning must not begin implementation or assign work without later approval. | Planning boundary inferred from version sequence; owner to ratify sprint start |

## Existing project decisions preserved

- Prior GDD from 2026-08-09 measured the 1994 reference and specified 4.5:1 grid, muted architecture, dark structural tones, clear seams, disciplined density and owner approval for redesigned rooms. As of 2026-10-20, `src/render/scale.ts` **already has 10x45**.
- Prior July pixel-art overhaul improved procedural interiors. 4.0 targets a *subsequent generation* of authored and procedural assets, and must not duplicate finished tickets.
- `docs/atlas.md` already specifies reproducible versioned atlases, 1x/2x/4x output, layers, animations, normals and cross-frontend distribution.
- `src/render/excalibur/towerRegions.ts` already caches region canvases with dirty-budget updates. No blanket assertion that procedural drawing currently dominates FPS is supported.
- `docs/design-system.md` defines existing Windows-style UI identity; refinements must be deliberate and tested.
- `verticopolis-native` uses Godot with the Rust crate; reusable *assets and state*, rather than one renderer everywhere, is the provisional integration direction.

## Proposed decisions requiring evidence and owner approval

| ID | Proposal | What settles it | Gate |
| --- | --- | --- | --- |
| V4-P1 | Select Excalibur or PixiJS for browser rendering, with other options only if necessary. | Reproducible comparable benchmark and migration-cost ADR. | 4A |
| V4-P2 | Approve an Enhanced pixel-art direction. | Actual room prototypes in running game, normal play and close zoom. | 4B |
| V4-P3 | Extend existing atlas pipeline for externally authored source files. | Rebuildable manifest and both web/Godot proof consumers. | 4B |
| V4-P4 | Consider a distinct Legacy Art visual preference. | Memory/PWA cost, maintenance and user-value measurement. | 4B/4C |
| V4-P5 | Ratify statistical pass bands and device/fixture matrix for 4.0. | Repeatable v3 baseline measurements on target systems. | 4A |
| V4-P6 | Approve 4.0 implementation start. | v3.0 stabilized, scoped story plan reviewed and owner go-ahead. | Release |

## Risks to revisit
1. Render migration cost overwhelms art wins while Rust cutover is still shifting host interfaces.
2. Asset detail causes atlas memory pressure, slow startup, PWA download expansion, stutter during GPU uploads or mobile WebGL context loss.
3. Cross-frontend visual parity fails because WebGL and Godot blend, sample and animate differently.
4. Cosmetic animation accidentally fakes occupancy or affects authoritative Rust values.
5. Low-quality or incompatible free assets make the visual style incoherent; sources may require attribution or forbid redistribution.
6. Screenshots are approved at close zoom but unreadable at the zoom players normally use.

## Next decisions and artifact handoff
Review `gdd.md`, `epics.md` and `renderer-bakeoff-charter.md`. The next formal BMAD/BMGD steps after approval are a 4A Architecture Decision Record, a full game architecture pass where needed, implementation-ready stories via `gds-create-epics-and-stories` and `gds-check-implementation-readiness`. Track stage-level work in GitHub; do not claim a completed full nine-step architecture workflow from this planning proposal.

**No 4.0 coding, asset purchase, agent assignment, PR merge or renderer selection was authorized by these notes.**
