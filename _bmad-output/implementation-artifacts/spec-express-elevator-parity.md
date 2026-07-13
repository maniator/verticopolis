---
title: 'Express elevator parity: 6-tile footprint, lobby-locked stops, see-through shaft'
type: 'bugfix'
created: '2026-07-13'
status: 'done'
context: []
baseline_commit: 'e0bd1d1a885096e062f57cf7aef6087c5700aebe'
---

<frozen-after-approval reason="human-owned intent, do not modify unless human renegotiates">

## Intent

**Problem:** Three Express Elevator parity breaks vs the real 1994 SimTower, all owner-reported and harness-verified. (1) Our catalog gives the express a 4-tile footprint, but the retail game builds it **6 tiles** wide (standard and service are correctly 4). Because the TDT format carries no width field, an exported tower reconstructs the express at the game's own 6-tile footprint, so a too-tight layout the player built here loses shafts on load. (2) Our editor lets the player make an express stop at any/every floor; the real game locks an express to **lobbies and sky lobbies only** (floors 1, 15, 30, 45, 60, 75, 90). (3) We draw the express shaft as an **opaque** dark column (like a standard); the retail game draws it **see-through**, a glass shaft you see the rooms and people through (harness pixel check: standard column 96% dark / 0% colorful; express column 48% dark / 19% colorful, statistically identical to a plain office floor behind it).

**Approach:** Set `elevatorExpress.width` to 6; the existing v5 `widenLegacyElevatorShafts` re-heal migration then widens every legacy 4-wide express to 6 on load, shifting it minimally to fit and grandfathering a boxed-in shaft at 4 (no relocation, no overlap, no drop). Lock express stops in the engine (`setStop`/`clearStops`) and hide the free stop-config UI for an express, while standard/service keep their per-floor skip config (canon, via the TDT serviced-floors bitmap). In the renderer, draw the express shaft backing translucent (glass) instead of the opaque fill, keeping its rails, motor caps, lobby stop lines and car.

## Boundaries & Constraints

**Always:** `src/engine/*` stays DOM-free. The TDT exporter reconstructs footprint from `FACILITIES[kind].width`, so a 6-wide express must round-trip and must not overlap in the exporter's collision check. Standard and service elevators KEEP `Configure stops…` / `All stops` (real-game feature). The widen migration HEALS not HARMS: never leave an overlapping/off-lot/dropped express, never relocate a boxed-in shaft far. American English, no em-dashes in new prose. All four quality gates green.

**Ask First:** Any change that would RELOCATE a boxed-in express to a distant free column (rather than keep it legacy 4-wide), the migration must not do this without human sign-off.

**Never:** No SAVE_VERSION bump: the v5 re-heal is idempotent and already re-runs on every v5 load (verified). Do not change standard/service width (4 is correct) or their stop config. Do not decompile game binaries.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh express | player places an express | shaft is 6 tiles wide; standard/service still 4 | N/A |
| Legacy express, room to grow | v5 save, express saved width 4, free space beside it | migration widens to 6, shifting x by 0-2 to fit | N/A |
| Legacy express, boxed in | v5 save, express width 4, both sides occupied | kept at legacy 4-wide, tower stays valid | no overlap/off-lot ever emitted |
| Express non-lobby stop (engine) | `setStop(expressId, floor=7, true)` | rejected; floor 7 stays skipped | returns false |
| Forged express stop (import) | TDT/save whose express bitmap encodes a non-lobby stop | coerced to lobby-only on import/deserialize | trust-boundary defense |
| Express clearStops | `clearStops(expressId)` | restores lobby-only stops (like setExpressStops), NOT all floors | N/A |
| Express in editor | inspector open on an express | no "All stops" / free per-floor config offered; info reads "lobbies and sky lobbies" | N/A |
| Standard/service stops | `setStop`/`allstops` on a standard | unchanged: any floor may be skipped/restored | N/A |
| Express shaft over rooms | render an express shaft with rooms behind it | rooms/people show THROUGH (translucent glass backing); rails/caps/lobby lines/car still drawn | N/A |
| Standard/service shaft | render a standard/service shaft | opaque dark backing, unchanged | N/A |

</frozen-after-approval>

## Code Map

- `src/engine/facilities.ts` -- `elevatorExpress.width` 4->6 (the one catalog change); comment cites the harness measurement.
- `src/engine/saveMigration.ts` -- `widenLegacyElevatorShafts` (v5 re-heal) ALREADY widens elevators to `FACILITIES[kind].width`, shifting 0..(canonW-w) to fit, keeping boxed-in legacy. It is kind-agnostic over elevators, so express 4->6 rides it for free; just verify + test. No moved-count / bulletin plumbing (party-cut, see Design Notes).
- `src/engine/Tower.ts` -- `setStop` (~1041) reject a non-lobby stop for an express; `clearStops` route express to `setExpressStops` (lobby-only). `setExpressStops`/`lobbyFloors`/`isLobbyFloor` already exist to reuse.
- `src/storage/tdtImport.ts` and/or `src/engine/Simulation.ts` deserialize -- coerce an express's stops to lobby-only at the trust boundary (import writes `skipFloors` directly, bypassing `setStop`), so a forged/foreign save can't smuggle a non-lobby express stop past the engine invariant.
- `src/ui/editorHtml.ts` (~160-172) -- for an express, drop the `All stops` button and the free `Configure stops…`; show a lobbies-only info line. Standard/service keep both buttons.
- `src/game/editorActions.ts` (~225-234) -- `allstops`/`stops` handlers: for an express these are no longer reachable from the UI; `clearStops` is now express-safe regardless.
- `src/tests/elevatorWidthMigration.test.ts` -- pins express width to 4 (line 52) and builds a width-4 express fixture; update to 6 + assert the widen-and-move and boxed-in branches.
- `src/render/sprites/transport.ts` (~70-116) -- the elevator branch fills the shaft backing OPAQUE (`shade(f.color,-34)` at line 72-73) for all kinds. For express, use a translucent glass backing so rooms show through; keep rails, motor caps, lobby stop lines, floor numbers, and the car.
- `src/tests/gameControllersCoverage.test.ts` (~479) -- `allstops` on an express must NOT restore non-lobby stops; reconcile.
- Screenshot/visual baselines change (express now see-through): regenerate via the pinned Docker / CI markers (`[update-screenshots]` / `[update-baselines]`) at merge, never a host browser.

## Tasks & Acceptance

**Execution:**
- [x] `src/engine/facilities.ts` -- set `elevatorExpress.width: 6`, update the comment to cite the harness measurement (standard/service 4, express 6).
- [x] `src/engine/saveMigration.ts` -- confirm (with a test) `widenLegacyElevatorShafts` widens express 4->6, shifts 0..2 to fit, and keeps a boxed-in express at 4. No new plumbing.
- [x] `src/engine/Tower.ts` -- `setStop`: if `t.kind === "elevatorExpress"` and the requested stop is a non-endpoint non-lobby floor, reject (keep it skipped). `clearStops`: for an express call the lobby-only path (`setExpressStops`) instead of emptying `skipFloors`.
- [x] `src/storage/tdtImport.ts` / `src/engine/Simulation.ts` deserialize -- coerce an express's stops to lobby-only at the trust boundary (endpoints exempt), so a forged non-lobby express stop can't bypass the engine invariant via the direct-`skipFloors` import path.
- [x] `src/ui/editorHtml.ts` -- express branch shows a lobbies-only info line and no free stop-config buttons; standard/service unchanged.
- [x] `src/game/editorActions.ts` -- ensure no express path can add non-lobby stops; keep standard/service behavior.
- [x] `src/render/sprites/transport.ts` -- draw the express shaft backing as translucent glass (rooms visible through) instead of the opaque fill; standard/service stay opaque. Keep rails, motor caps, lobby stop lines, floor numbers, car. Visual baselines regenerate via CI markers at merge.
- [x] `src/tests/elevatorWidthMigration.test.ts`, `src/tests/gameControllersCoverage.test.ts` -- update the pins; add tests for a 6-wide fresh express, the widen-and-move + boxed-in migration branches, the express lobby-stop lock (engine + forged-import coercion), and standard/service stops still free.
- [x] `package.json` -- minor version bump (player-facing parity + visible width change).

**Acceptance Criteria:**
- Given a fresh tower, when the player places an express, then its footprint is 6 tiles and standard/service stay 4.
- Given a v5 save with a 4-wide express and adjacent free space, when it loads, then the express is 6 wide, still on-lot, non-overlapping, and shifted by at most 2 tiles.
- Given a v5 save whose 4-wide express is boxed in on both sides, when it loads, then the express stays 4 wide and the tower has no overlap or off-lot shaft.
- Given an express, when the engine or editor tries to enable a non-lobby stop, then it is refused and only lobby/sky-lobby floors (plus endpoints) ever stop.
- Given a standard/service elevator, when the player uses Configure stops / All stops, then per-floor skipping still works exactly as before.
- Given a 6-wide express, when the tower is exported to TDT and re-imported, then it round-trips at 6 with zero importer warnings.
- Given an express shaft with rooms behind it, when it renders, then the rooms show through the shaft (translucent glass), while a standard/service shaft over the same rooms stays opaque.

## Design Notes

The widen migration already exists and is the crux, so the width change is nearly a one-liner. `widenLegacyElevatorShafts` (saveMigration.ts) builds a post-coercion footprint per transport, and for any elevator whose stored width is below its catalog width it tries `x - shift` for `shift` in `0..(canonW - w)` and takes the first that fits (on-lot, no collision), else keeps the legacy footprint. For express that is `shift` in `0..2`: grow right, then nudge left up to 2, then keep 4. This is precisely the owner's "move appropriately, else keep and don't break the tower." No SAVE_VERSION bump: the v5 branch re-runs the heal on every load and is idempotent (`if (fp.w >= canonW) return t`).

Stops: `setExpressStops` already computes the lobby-only skip list, so `clearStops` for an express just calls it. The lock belongs in the engine (`setStop`) so the invariant holds against any caller, with the UI merely not offering the illegal action. Import is the one door that bypasses `setStop` (it writes `skipFloors` directly), so the same invariant must be re-asserted there or a forged/foreign save smuggles a non-lobby express stop past it (the noRate-on-a-shop class of hole).

Cross-build behavior (known-safe, do not "fix"): no SAVE_VERSION bump. The width is the same field, not a format change, and the v5 `widenLegacyElevatorShafts` re-heal is idempotent (`fp.w >= canonW` skips a done shaft). A save stamped on this build carries a 6-wide express; an OLDER build loading it clamps the width back to 4 via the "widths only ever grew, above-catalog is forged" rule, then this build re-widens it on the next open. Graceful degrade, not corruption.

Party-cut (2026-07-13): the per-load "N shafts widened" bulletin was cut. The standard 3->4 widen has always been silent, so an express-only note would be inconsistent favoritism (worse than consistent silence). A single general note covering ALL widen-migration moves is its own change, tracked in the backlog's `e1c-migration` transparency row.

## Verification

**Commands:**
- `npx tsc --noEmit` -- expected: exit 0
- `npm run lint` -- expected: exit 0
- `npx vitest run elevatorWidthMigration gameControllersCoverage tdtExport tdtImport` -- expected: all green
- `npm test` -- expected: all suites green
- `npm run build` -- expected: exit 0

**Manual checks:**
- Harness SECOND-CONFIRM of the 6 (party-required before merge): build an express with a room placed flush beside it, export, load in the retail game, and confirm the express occupies exactly 6 tiles by the gap to the room (a second method beyond the pixel-calibration measurement).
- Harness (owner runs after): a freshly placed express loads 6 wide in the retail game; an old 4-wide-express save loads widened with the tower intact; an express offers no non-lobby stops.
