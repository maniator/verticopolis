---
id: SPEC-stranded-floor-move-ins
companions:
  - ../../project-context.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability only: consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Stranded-floor move-ins: gate tenancy on the two-ride rule

## Why

A pain to solve, and a parity fix. Tenant move-ins (`attemptMoveIns`, `src/engine/Simulation.ts:1684`) gate on `Tower.isFloorServed` (pure structural connectivity through any number of transfers) instead of `Simulation.floorReachable`, the ratified two-elevator-ride rule (`Crowd.MAX_RIDES = 2`) that decides whether a commuter can ever physically travel to a floor. A floor connected only via 3+ rides is "served" but draws no people, and the engine already knows it: commercial visitor income is gated on the two-ride check (quarterly office rent deliberately keeps the weaker served-floor gate for tenants in place), and the inspector prints "Access: too far. 3+ rides from the lobby, so no one travels here." Yet the game sells condos there anyway. Condos are the worst offender because their income is a one-time lump sum banked at move-in with no downstream $0 to correct it, and their residents count toward population and star rating. Proof in a player save (SixSeven): elevator chain 1–15 / 15–30 / 30–44 with no express, floors 31–44 served but three rides out, 56 condos sold for $10.84M with 168 phantom residents in the census.

## Capabilities

- **CAP-1: Move-ins respect the two-ride rule**
  - **intent:** No tenant (office firm, condo household, hotel guest) moves into a unit on a floor a commuter cannot reach from the ground lobby within two transport rides.
  - **success:** In `attemptMoveIns`, every tenant kind is additionally gated on `floorReachable` at one shared point after the existing cheap checks. In a fixture tower whose third elevator leg makes floors 3+ rides out, an empty condo there never sells across a simulated week of hourly ticks; an office there never leases; a hotel room there never fills. After adding an express elevator that puts the floor within two rides, the same condo can sell.

- **CAP-2: Bounded cost for the gate**
  - **intent:** The new gate adds at most one bounded (≤2-ride) BFS per distinct candidate floor per hourly `attemptMoveIns` pass, never per unit.
  - **success:** The reachability verdict is memoized in a per-pass lazy map keyed by floor; the BFS runs only for floors that already pass `isFloorServed`. No new revision-keyed cache is introduced (Crowd's adjacency graph is already cached by `tower.revision`).

- **CAP-3: The player is told why nothing moves in**
  - **intent:** A player whose empty rentable units sit on a 3+-ride floor gets the daily stranded advisory, not silence: today `nudgeStranded` only covers floors with occupied units, so the exact tower this fix creates (empty, unsellable) draws no feedback.
  - **success:** The daily nudge fires when any floor carrying tenant-capable units (empty included) is served but not two-ride reachable, with copy that no longer says "leased" (it now also covers empty space) and stays log-only ("info", never a toast) with the existing edge-trigger latch. The stats-modal "stranded floors" row keeps its current leased-only meaning. A test asserts the nudge fires for a floor of empty condos and does not repeat while the condition persists.

## Constraints

- **Existing saves are untouched.** No retroactive eviction, no buy-back charge, no census correction for already-sold condos on stranded floors; the fix is demand-side only (pressure, not eviction, the parking-penalty doctrine). No save-field changes, no migration, no `SAVE_VERSION` bump. A test asserts sold condos in a loaded save stay sold and occupied.
- **Mode-agnostic:** identical behavior in Classic and Modern; no per-mode branching in the gate.
- `src/engine/` stays free of DOM/rendering; nudge copy is emitted through the existing `emit` log channel.
- The stats-modal stranded count and the per-unit inspector access line keep their current semantics; only the nudge's candidate set widens (two-scope `strandedFloors`, or equivalent, so the diagnostic and the nudge each keep a single meaning).
- Quality gates green before push (`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`); patch bump to `package.json` `version` (player-noticeable behavior fix); `/gds-code-review` in-session is mandatory (engine/gameplay invariant).

## Non-goals

- **Changing `Crowd.MAX_RIDES`** or any part of the routing model: the two-ride cap is ratified canon.
- **Retroactive correction of existing towers**: phantom residents and banked sale money in old saves stay; the remedy in-fiction is the player building an express elevator to a sky lobby.
- **Editor-panel third access state** ("Elevator access: Yes/No" gaining a "too far" variant): a new UI surface, backlogged, not smuggled into this fix.
- **Express-elevator suggestions or auto-building**: the game informs; it does not plan the tower.

## Success signal

Load the SixSeven save (or its fixture equivalent): the 56 previously-sold condos stay sold, but not one more unit on floors 31–44 ever leases, sells, or fills, and the daily log tells the player why. Build the express elevator to the floor-30 sky lobby, and move-ins on 31–44 resume. The inspector's "no one travels here" line and the sales ledger stop contradicting each other.

## Assumptions

- The nudge widening reuses the existing daily cadence and latch in `nudgeStranded` (only its candidate set and copy change); no new advisory channel is introduced.
- `floorReachable` on the ground floor and basement floors behaves as today (`floor === 1` short-circuits true; basements host no tenant kinds per `NO_BASEMENT_KINDS`), so the gate needs no basement special-casing.
