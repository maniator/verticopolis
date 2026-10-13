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
- PR #903 fit: #903 merged first, so this change carries the seam. The
  TypeScript tower reports `capacity_changed` from `setCars` and
  `resizeTransport`, which these commands call; the Rust commands call
  `Simulation::set_cars` / `resize_transport` for the same event.
  `facility_removed` moved from `sellAt` into `removeFacility` in both
  engines, with its method, so the bulldozer reports `bulldoze` (closing
  #901). The lock pins the charges scenario's events in both engines.

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

### Round 2 (confirming pass on the round-1 fixes)

- [x] [Review][Patch] A refused charge op was not held to a zero delta, and the TS runner's delta check had no test; the Rust mismatch case meant for round 1 had not landed [chargeOps.ts, scenario.rs]: both runners check the money first, then a refusal's zero delta, then the copy; `chargeOps.test.ts` and the Rust test drive each branch.
- [x] [Review][Patch] `conformance/README.md` did not list the four ops or the delta rule; `engine-rs/README.md` did not map `charges.rs`.
- [x] [Review][Patch] Doc fixes: `sellAt` called itself a bulldoze in both engines; the shared id counter was unstated in Rust; `charges.ts` lacked the #903 event note; `extendTransport` did not say a part-paid request succeeds as far as it got; an unexplained money poke in the dual-run test.
- [x] [Review][Patch] No Rust test of `sell_at` on a burning room [charges_tests.rs].
- [x] [Review][Patch] The story did not name the TypeScript `sellAt` conflict with #903; the #346 row named a TS-only method for both engines.
- Dismissed (8): a double relay through the mirror (the depth guard is verified, and the dual-run edits test runs in CI under `VC_REQUIRE_WASM=1`); `sellAt` now consulting `removalReason` for rooms (it only ever refuses floor and lobby tiles); `setCars` refusing for some other reason (it only refuses a clamp to the same count); the drag mark holding the old sim until the next drag; undo captures left open on early returns (the existing pattern, a no-op later); import order (lint is clean); syncing #346's issue body (informational); the two runners' check order (now the same).

### Round 3 (confirming pass)

- Edge Case Hunter and Acceptance Auditor: no findings.
- [x] [Review][Patch] Nothing pinned the extend command's tower-refusal copy across engines [charges_tests.rs, engine-charges-classic.json]: both unit tests pin "Transport shafts cannot overlap.", and the scenario adds a drag below the basement refused with "Outside the buildable range." (a refusal moves nothing, so the lock is unchanged).

### Rounds 4 and 5 (confirming passes)

- Round 4: all three layers clean on the round-3 fix.
- Round 5: Blind Hunter and Edge Case Hunter clean (the Blind Hunter's "missing lock" was the review diff leaving out `expected.json` on purpose; the lock holds the new scenario).
- [x] [Review][Patch] Comments in `checkVip` and a Wedding Hall test still said the editor and bulldozer call `tower.removeUnit` directly [src/engine/sim/events.ts, reviewFixes.integration.test.ts]: reworded to name raw `tower.removeUnit` callers (comment-only; no em-dash added).

### Round 6 (confirming pass)

- All three layers clean on the round-5 fix. The repo sweep for stale claims found two comment-only nits, both fixed: the `resaleRefund` doc said the UI paid the refund, and the VIP guard's comment named "a loader" as a raw `tower.removeUnit` caller (the real case is a save loaded with a stale visit day).

### Round 7 (the #903 seam, after the rebase onto #903)

- Edge Case Hunter: clean. Every charge path emits in both engines only when the edit lands, in the same order and payload; no raw caller in `src/game`, `src/ui` or `src/render` remains; the mirror's depth guard records each command once.
- [x] [Review][Patch] The dual-run drag only checked `ok` and a zero delta, which a refusal also satisfies [dualRunEdits.integration.test.ts]: each step now pins `top`, `added` and `delta`.
- [x] [Review][Patch] TypeScript `removeFacility` read the unit's kind and state after `removeUnit`; it now reads them first, as the Rust port does [src/engine/sim/charges.ts].
- [x] [Review][Patch] TypeScript `RemovalMethod` was its own union; it is now the catalog's generated `GameplayRemovalMethod` [src/engine/sim/charges.ts].
- [x] [Review][Patch] Stale records: the #873 and #906 backlog rows still described the pre-#914 wiring (#906 now names the charge commands as callers that must move with the emission); the PR body still said "whichever lands second" and did not close #901.
- [x] [Review][Defer] The dual-run mirror normalizes `id` and `targetFloor` but not the mark's ends: added to `charge-command-input-trust` (#923).
- Dismissed (7): a refused add or remove maps any `setCars` failure to fixed copy (the commands check every reason the tower refuses first); a broke player hears "Not enough money." before the tower's own refusal (the old button's order, kept on purpose); the drag mark is bound to the `Simulation`, not its tower (nothing assigns a new tower to a live sim; the WASM host merges the engine's state of the same game into the same tower, so the mark still describes it); the scenario's gutted sale pins its zero refund only through the state hash (the unit tests pin it directly, and both engines are held to the hash); `charges.rs` holds its own copies of the two prices (Rust has no `ECON` table for them, and the lock pins every charge); a refused Sell is silent (the only refusal is a vanished facility); bulldozing a floor tile under a shaft is not refused (pre-existing `removalReason` behavior, outside this story).

### Round 8 (confirming pass)

- All three layers clean on the round-7 fixes. The Blind Hunter's three optional nits were dismissed: the drag's middle step implies `added: 0` through its zero delta; the `down` end and a part-paid clamp are covered by the scenario and both engines' unit tests; the refusal verb comes from the catalog's two-value enum. The Acceptance Auditor's process notes were done outside the diff: issue #923's body gained the mirror item and #906's fix shape now names the charge commands.

## Go/no-go

2026-10-11, party: game design (Samus), game architecture (Cloud),
implementation and test (Link), architecture (Winston), the adversary
(Grumbal), and a SimTower veteran (Hiro). The evidence on the table, head
`24975d4` rebased onto `main` at #934:

- Required CI green on the head, the two WASM capture and parity rows
  included (they were red on the older base and pass after the rebase).
- Copilot reviewed the head with 0 findings and asks for a human sign-off on
  the two-engine parity seam. Codex is out of quota.
- `npm run test:wasm:parity` (not run by CI) on the head: 9 failed, 4201
  passed. On `main` at #934: the same 9 tests failed, 4170 passed. The 9 are
  the known pre-existing set (commuteStress x2, fixedStep x4, rentalCrowd x2,
  rooms); the branch adds 31 passing tests and no failure.
- The conformance lock gains only `engine-charges-classic`; every existing
  hash is unchanged.

**Verdict: GO**, on these merge conditions:

1. A human sign-off from the owner, which Copilot asks for and no agent can
   give.
2. Copilot clean and required CI green on the final head (the docs-only push
   carrying this section re-runs both).
3. A merge commit, never a squash.
4. **The #903 seam is absorbed by whichever PR lands second.** The panel
   expected #903 to rebase onto this one; #903 merged first instead (main at
   `13db1bc`), so this PR took the seam on its rebase:
   - Rust `add_car`, `remove_car` and `extend_transport` call
     `Simulation::set_cars` and `Simulation::resize_transport`, so a charged
     edit reports `capacity_changed` as the TypeScript tower already does.
     The tripwire held: with the events hash in the lock, the referee would
     fail on any drift between the engines.
   - `facility_removed` moved from `sellAt` into `removeFacility` in both
     engines, with its method, so the editor's Sell and the bulldozer report
     it (`bulldoze` included), closing #901. The catalog's wording for both
     events says so. `charges.rs` uses the catalog's `RemovalMethod` instead
     of its own copy.
   - The lock was rewritten by the writer: `engine-charges-classic` gains its
     `events` hashes, its `state` and `crowd` hashes are unchanged, and no
     other scenario moved. Both engines carry a test for the events each
     charge reports and for silence on a refusal.
5. The WASM-hosted Playwright check that a charge makes no `setMoney` write
   is a follow-up PR from the session that closed #929, after this merges;
   it is not a merge condition here.
