---
story: engine-charges
status: review
depends_on: engine-wasm-switch
---

# Story: engine-owned charges for cars, extends and sales

GitHub issue #914, backlog row `engine-charges`.

## Why

Several money rules lived in the web UI. The editor and the bulldozer moved
the tower with the raw edits (`Tower.setCars`, `Tower.resizeTransport`,
`Tower.removeUnit`, `Tower.removeTransport`) and then wrote `sim.money`
themselves:

| Action | Where the UI charged | Rule |
| --- | --- | --- |
| Add a car | `src/game/editorActions.ts` | pays `ECON.addCarCost` (40,000), refused when short |
| Remove a car | `src/game/editorActions.ts` | refunds `carResaleRefund()`, half the add cost |
| Extend a shaft (drag) | `src/game/editorActions.ts` | pays `transportFloorCost` per floor past the gesture's high-water mark, clamped to the budget (`extendBill`) |
| Extend a shaft (buttons) | `src/game/editorActions.ts` | pays one `transportFloorCost` |
| Sell or bulldoze a unit | `src/game/buildActions.ts` | refunds half the cost, zero for a gutted unit |
| Sell or bulldoze a shaft | `src/game/buildActions.ts` | refunds half the cost |

The web game was correct on both engines, because the WASM host relayed each
money write as `setMoney`. The problem was ownership: any other frontend
(the native client's editor first) would have had to copy these rules and
send a raw money write. The engine already had `sellAt` with the same refund
rule plus the Wedding Hall VIP cancel, but the editor never called it, so the
two paths could drift.

## Acceptance criteria

1. **AC1 Engine commands in both engines.** `addCar(id)` and `removeCar(id)`
   check the car limit and the balance, charge or refund, and return
   `{ ok, reason?, delta }`. `extendTransport(id, end, targetFloor, hwm?)`
   bills each floor past the mark at `transportFloorCost` with the
   `extendBill` budget clamp and returns `added` too. `sell(id)` removes a
   unit or a shaft by id and pays the resale: zero for a gutted unit,
   refused while a unit burns or holds up the story above, and the last
   Wedding Hall's sale cancels a pending VIP inspection. `sellAt`'s room
   branch now runs through the same `sellUnit` path. The raw `setCars`,
   `resizeTransport`, `removeUnit` and `removeTransport` stay for loaders
   and tests.
2. **AC2 WASM binding and relay.** `engine-rs/src/wasm.rs` exports `sell`,
   `addCar`, `removeCar` and `extendTransport` (JSON results), the binding
   check lists them, and the mirror relay reports each as its own command
   (`sell`, `addCar`, `removeCar`, `extendTransport`), so a hosted tower
   sends no `setMoney` for these actions.
3. **AC3 UI moves over.** The editor's car and extend actions and the
   bulldozer's and editor's sell call the commands. Toasts, sounds and
   telemetry stay in the UI. The burning-unit toast keeps the player's own
   verb ("sell" or "bulldoze"); the load-bearing refusal now comes back as
   the command's reason, with the same text. The silent car-cap check and
   the silent drag refusals are unchanged. `BuildActions.canAfford` had no
   callers left and went.
4. **AC4 Lock.** The conformance digests do not move (the scenarios use the
   raw commands and `sellAt`, whose behavior is unchanged). Unit tests in
   both engines (`src/engine/sim/charges.test.ts`,
   `engine-rs/src/charges.rs`) cover each charge and refund, a refused add
   when short of money, the extend clamp and high-water mark, the gutted
   zero refund, the fire and load-bearing refusals, the VIP cancel, and
   `sellAt` matching `sell`. The mirror test pins the four new commands and
   a WASM host test shows adding a car deducts 40,000 in the engine through
   the command path, with no money write from the host. The
   `chromium-wasm` e2e project runs the same commands in a browser.

## Out of scope

- The prices themselves as read-only catalog fields (#913).
- New conformance scenario ops for the commands; the unit tests in both
  engines hold the rules, and the dual run compares every hour.

## Notes

- The eager Wedding Hall VIP cancel on the editor path is not visible to a
  player: `checkVip` already cancelled a pending inspection at the next day
  boundary when no hall stood. It only moves `vipVisitDay` earlier in the
  save.
- A free shrink reports `delta` as `+0` in both engines (`0 - cost`), so
  the JSON the binding writes never spells `-0`.
- Stacked on the catalog story (#913, `claude/engine-catalog`): the commands
  charge through its shared price items (`ECON.addCarCost`,
  `ECON.transportFloorCost`, `carResaleRefund`, `GUTTED_RESALE_REFUND` in
  TypeScript; `econ::{ADD_CAR_COST, TRANSPORT_FLOOR_COST,
  GUTTED_RESALE_REFUND, car_resale_refund}` in Rust) rather than copies, and
  the editor's "Scrap value" readout reads `GUTTED_RESALE_REFUND` too. The
  catalog hashes the referee checks do not move.
- No version bump: nothing a player sees changes (CONTRIBUTING.md,
  Versioning, internal-only work).

## Review

Recorded in the dev agent record below as the rounds run.

## Dev agent record
