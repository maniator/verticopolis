---
title: 'Sky-lobby canon: player-triggered claim + lobby permanence'
type: 'feature'
created: '2026-07-09'
status: 'in-review'
baseline_commit: '32096d7'
context:
  - '{project-root}/CLAUDE.md'
---

<frozen-after-approval reason="human-owned intent, do not modify unless human renegotiates">

## Intent

**Problem:** Sky-lobby floors (every 15th story: 15, 30, 45, 60, 75, 90) have no special enforcement today. A player can carpet floor 15 with plain floor tiles and drop offices on it while the express-elevator plumbing (`isLobbyFloor`, `syncExpressStopsForFloor`) still treats it as a sky-lobby anchor. That is a canon violation and a live bug: express stops point at a phantom lobby. Symmetrically, in the 1994 game a lobby tile cannot be bulldozed at all, but today `Tower.removalReason` only guards structural integrity, so a lobby with nothing above it can be sold.

**Approach:** Ship the canon-faithful sky-lobby experience in one PR: two paired rules that together match 1994 behavior. (1) Player-triggered claim: a sky-lobby floor is "claimed" iff any lobby tile exists on it (derived, not stored). On a claimed floor, plain floors and rooms are refused; conversely, a lobby is refused on a sky-lobby floor that already carries non-lobby content. Ground floor 1 is out of scope. (2) Lobby permanence: no lobby tile can be removed by player action, at any story. Internal engine rollbacks that call `removeUnit` directly are unaffected. Legacy saves are grandfathered. Rule is mode-agnostic; a hover-time refusal reason on the invalid preview is Modern-only, gated through a `sim.rules` method to keep mode logic centralized.

## Boundaries & Constraints

**Always:**
- Claim is derived from `floorHasLobby(floor)`, never stored.
- Rule enforcement is identical in Classic and Modern (mode-agnostic).
- New refusal reasons are American English, no em-dashes.
- `src/engine/` stays DOM-free.

**Ask First:**
- Any change to `syncExpressStopsForFloor` semantics (it already fires on the first lobby tile transition; do not add a second firing path).
- Any scattered `mode === "modern"` check outside `src/engine/gameRules.ts` (use a rule method).

**Never:**
- No migration of legacy mixed floors.
- No enforcement on ground floor 1 (`coversGroundFloor` already blocks rooms there).
- No new event log line for the claim transition.
- No screenshot workflow marker (zero rendering surface).

## I/O & Edge-Case Matrix

| Scenario | State + action | Expected behavior |
|----------|----------------|-------------------|
| Floor on claimed sky-lobby | floor 15 has a lobby; place `floor` at (15, x) | `{ok:false, reason:"Sky lobbies are concourses. Only lobby tiles go here."}` |
| Single-story room on claimed sky-lobby | floor 15 has a lobby; place office at (15, x) | `{ok:false, reason:"This room would sit on a sky lobby. Move it up or down a story."}` |
| Multi-story room crossing claimed sky-lobby | floor 15 has a lobby; place cinema at floor 14 (spans 14 to 15) | Same refusal as above |
| Lobby on mixed sky-lobby | floor 15 has plain floor tiles or rooms; place `lobby` at (15, x) | `{ok:false, reason:"Clear the floor tiles or rooms here first, then place your sky lobby."}` |
| Lobby on bare sky-lobby with support | floor 15 is empty, floor 14 supports; place `lobby` at (15, x) | Placed. Floor 15 now claimed. Existing `syncExpressStopsForFloor` fires on first lobby tile. |
| Bulldoze a lobby | player Sell or Bulldoze on a lobby | Refused: `"Lobby tiles are permanent. The 1994 game does not let you remove them."` Silent on drag-bulldoze (existing `quiet`). |
| Ground concourse | any placement at floor 1 | Unchanged (existing `coversGroundFloor` handles rooms; plain floors on ground still allowed). |
| Legacy save with mixed floor 15 | loaded save has lobby at (15, 10) and floor at (15, 200) | State preserved. New placements on that story enforce. |
| Modern preview hover | Modern mode; hover a refused placement | Existing hover inspector shows the refusal reason string. |
| Classic preview hover | Classic mode; hover a refused placement | No hover reason (canon-faithful pedagogy); reason still shown on click via toast. |

</frozen-after-approval>

## Code Map

- `src/engine/Tower.ts:307` `canPlace` structural branch: add "floor on claimed sky-lobby" and "lobby on mixed sky-lobby" refusals inside the `isStructural(kind)` block.
- `src/engine/Tower.ts:271` `roomPlacementReason` per-story loop (Tower.ts:297 to 303): add "room on claimed sky-lobby" refusal after the existing `spanHasLobby` check.
- `src/engine/Tower.ts:913` `floorHasLobby(floor)`: the O(1) `lobbyTiles` read used to compute claimed.
- `src/engine/Tower.ts:751` `removalReason(id)`: add "lobby tiles are permanent" refusal FIRST (before the structural-integrity check), so canon wins over the generic message.
- `src/engine/gameRules.ts`: add `showsPreviewReason: boolean` to `GameRules`, false in `CLASSIC_RULES`, true in `MODERN_RULES`.
- `src/engine/Simulation.ts:397` `canBuild`: no signature change; new reasons flow through the existing `reason` field.
- `src/main.ts:795` `updateBuildPreview`: when `canBuild` returns `!ok` and `sim.rules.showsPreviewReason`, thread the reason into the hover inspector tooltip (existing DOM surface, main.ts:116).
- `src/render/excalibur/TowerEngine.ts:230` `preview` shape: extend with `reason?: string`; render layer stays presentation-only.
- `src/game/buildActions.ts:174` `tryRemoveUnit`: no code change; the new refusal from `removalReason` surfaces automatically as the toast, and the `quiet` drag path stays silent.
- `src/tests/simulation.test.ts`: new describe block covering the matrix.
- `e2e/auto-floor.spec.ts`: extend with the sky-lobby-canon refusals via the real `game.build` and `game.build.bulldozePicked` paths.
- `_bmad-output/implementation-artifacts/backlog.md`: no new deferrals. If any prior entry lists sky-lobby permanence as pending, mark it closed.
- `package.json`: bump `1.14.2` to `1.16.0` (minor, new player-facing rule).

## Tasks & Acceptance

**Execution:**
- [x] `src/engine/Tower.ts`: add `isSkyLobbyFloor(floor)` helper (`floor >= 2 && floor % GRID.lobbyInterval === 0`). Wire the two structural refusals in `canPlace`, the room refusal in `roomPlacementReason`, and the lobby-permanence refusal (first) in `removalReason`.
- [x] `src/engine/gameRules.ts`: add `showsPreviewReason` to both rule objects.
- [x] `src/render/excalibur/TowerEngine.ts`: extend `preview` with `reason?: string`.
- [x] `src/main.ts`: in `updateBuildPreview`, populate `preview.reason` from `canBuild().reason` only when `sim.rules.showsPreviewReason`; keep Classic path untouched.
- [x] `src/tests/simulation.test.ts`: new describe covering each matrix row plus mode-agnostic parity and the internal-rollback invariant (direct `tower.removeUnit` on a lobby id still works, used by `ensureFloorUnder` and bridge rollback).
- [x] `e2e/auto-floor.spec.ts`: extend with player-facing sky-lobby refusals through `game.build.tryBuild`; assert `game.sim.rules.showsPreviewReason` in each mode.
- [x] `package.json`: bump to `1.16.0`.

**Acceptance Criteria:**
- Given floor 15 has one lobby tile, when the player places a plain floor tile on floor 15, then `sim.build("floor", 15, x)` returns `{ok:false}` with the concourse reason and money is unchanged.
- Given floor 15 has one lobby tile, when the player places a cinema at floor 14 (spans 14 to 15), then `sim.build` returns `{ok:false}` with the "would sit on a sky lobby" reason.
- Given floor 15 has plain floor tiles or rooms, when the player places a lobby on floor 15, then `sim.build` returns `{ok:false}` with the "clear the floor tiles or rooms first" reason.
- Given a placed lobby tile at any floor, when the player calls `sim.sellAt` or `game.build.bulldozePicked` on it, then removal is refused and the tile stays.
- Given internal engine code calls `tower.removeUnit(lobbyId)` directly (rollback path), then removal still succeeds (bypass is intentional; invariant preserved).
- Given a Classic tower, then `sim.rules.showsPreviewReason === false`. Given Modern on the same refusal, then it is true and the hover inspector shows the reason.
- All four quality gates pass: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

## Design Notes

**Claim is derived, not stored.** `floorHasLobby(floor)` is already O(1). A stored flag would double-book and drift on legacy loads.

**Rule method vs. mode check.** `gameRules.ts:6-22` explicitly rejects scattered `mode === "modern"`. Even the UI-only hover gate goes through `showsPreviewReason` so the strategy stays the single source of truth.

**Removal ordering.** Check `u.kind === "lobby"` FIRST in `removalReason`, so the canon reason wins over the generic structural message when both would apply.

**Grandfathering.** Legacy mixed floors are not mutated on load. `canBuild` refuses NEW compounding placements. The player can slowly clear plain floors and rooms (they remain removable); existing lobbies stay by design.

## Verification

**Commands:**
- `npm run typecheck` -- expected: clean.
- `npm run lint` -- expected: clean.
- `npm test` -- expected: green, new suite included.
- `npm run build` -- expected: succeeds.
- `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test e2e/auto-floor.spec.ts` -- expected: all e2e green.
