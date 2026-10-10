# Story: engine-owned charges (#914)

Status: review

## Story

As the owner of a second frontend (the native Godot client), I want the engine
to charge and refund for car edits, shaft extensions and removals, so that a
frontend relays engine commands and never copies the money rules.

## Acceptance criteria (from #914)

1. Both engines have `addCar(id)` and `removeCar(id)`, which check the car limit
   and the balance, charge or refund, and return a result with a reason.
2. Both engines have a billed extension that charges per added floor with the
   `extendBill` budget clamp.
3. Sell and bulldoze go through one engine removal command that pays the refund.
4. The raw `setCars` and `resizeTransport` stay free for loaders and tests.
5. The WASM binding exports the commands and the dual-run mirror relays them.
6. The editor and the bulldozer call the commands; toasts and sounds stay in the UI.
7. Existing conformance digests are unchanged; tests in both engines cover each
   charge and refund, including a refused add when short of money and the
   gutted-unit zero refund.

## What landed

- `src/engine/sim/charges.ts` and `engine-rs/src/charges.rs`: `addCar`,
  `removeCar`, `extendTransport(id, end, targetFloor, hwm?)` and
  `removeFacility(id, "sell" | "bulldoze")`, each returning
  `{ ok, reason?, delta }` (the extension adds `bottom`, `top`, `added`).
  Refusal copy: "Not enough money.", "This elevator has all the cars it can
  hold.", "An elevator needs at least one car.", "Only elevators have cars.",
  "Only elevators can be extended.", "That elevator is gone.", "That facility
  is gone.", the burning-unit line with the gesture's verb, and the tower's own
  removal reasons.
- `sellAt` in both engines picks the id by its old rule and pays through
  `removeFacility`, so there is one refund path (Wedding Hall VIP cancel included).
- WASM: `addCar`, `removeCar`, `extendTransport` (hwm as JSON text or null),
  `removeFacility`. Mirror ops of the same names; the shadow charges for itself.
- UI: `EditorActions` and `BuildActions` call the commands; `canAfford` is gone.
  The drag's high-water mark is bound to the sim it was taken on.
- Lock: new scenario `engine-charges-classic` with four new ops in both runners
  (`addCar`, `removeCar`, `extendTransport`, `removeFacility`), each optionally
  pinning its refusal copy and always checking that the balance moved by the
  reported delta. Every existing digest is unchanged.
- PR #903 fit: in TypeScript, #903 emits `capacity_changed` from `Tower.setCars`
  and `resizeTransport`, which these commands call, so charged edits report
  with no change. In Rust the commands call the tower directly; once #903 lands
  they switch to `Simulation::set_cars` / `resize_transport`, and
  `removeFacility` can emit `facility_removed` with its method (closing #901's
  gap: the bulldozer's removals now go through an engine command).

## Review Findings

### Round 1 (`/gds-code-review`: Blind Hunter, Edge Case Hunter, Acceptance Auditor)

- [x] [Review][Patch] `scenario.ts` over the 500-line cap, failing `npm test` [src/tests/conformance/scenario.ts]: charge ops moved to `chargeOps.ts`.
- [x] [Review][Patch] `charges.rs` at 566 lines [engine-rs/src/charges.rs]: tests moved to `charges_tests.rs`.
- [x] [Review][Patch] A drag's high-water mark survived a tower swap mid-drag, so a load or undo could grow a same-id shaft for free [src/game/editorActions.ts]: the mark is bound to its sim; regression test added.
- [x] [Review][Patch] A refused transport Sell or bulldoze still played the sale and cleared the selection [src/game/buildActions.ts]: `removeTransportWithRefund` returns whether it landed.
- [x] [Review][Patch] The `down` end was untested in both engines, and Rust `extend_bill` had no direct vectors [charges.test.ts, charges_tests.rs]: shared vectors and down cases in both, plus a down drag in the scenario.
- [x] [Review][Patch] Scenario charge ops never checked `delta` [chargeOps.ts, scenario.rs]: the balance must move by exactly the reported delta in both runners.
- [x] [Review][Patch] Misleading budget-clamp comment [engine-rs/src/charges.rs]; weak dual-run assertions [dualRunEdits.integration.test.ts]; no note on how the commands meet #903's wrappers [engine-rs/src/charges.rs].
- [x] [Review][Defer] Charge-command arguments are trusted at the boundary (NaN or fractional floors and marks, unknown enum strings, an inflated caller mark) [charges.ts, wasm.rs]: deferred, the same trust every relayed command has today. Row `charge-command-input-trust` (#923).
- Dismissed (10): NaN money (not a reachable state); an over-cap shaft selling several cars (load clamps cars in both engines); an empty undo step after a tower-refused extend (unchanged from before); comparing the refusal copy to pick the UI feedback; the `"ok" in t` narrowing; the `sellAt` room rule (`is_structural` is exactly floor or lobby); the extend's free floor (watch row #346); `null` hwm pairing (both loaders reject null first); the version bump (the only changed feedback is behind disabled buttons); `Simulation.ts` re-export collapse (the same change #903 makes).
