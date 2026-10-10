---
story: engine-catalog
status: in review
depends_on: engine-wasm-binding
---

# Story: one catalog API in the engine

GitHub issue #913, backlog row `engine-catalog`.

## Why

Every frontend needs the same reference data to draw a build menu, a price
label or a placement ghost. The Rust crate held it across `facilities.rs`,
`econ.rs`, `rules.rs` and the build code, the binding exported none of it,
and the web UI imports the TypeScript `FACILITIES` and economy tables
directly, so those reads break when the TypeScript engine retires (roadmap
row 7) and a native frontend has to know the crate's internals.

## Acceptance criteria

1. **AC1 `engine::catalog`.** `catalog(mode) -> Catalog` (serde, camelCase
   keys) returns per facility kind, in catalog order, the prices, sizes,
   star gates, population, build rules, caps and pools, transport limits
   and rent rules listed under "What landed", resolved for the mode; the
   world constants a placement check reads; and the economy constants the
   UI shows. Each value reads the source the simulation reads. No existing
   behavior changes. Values a frontend still cannot read from the catalog
   (Modern rent on the canon calendar, varying population, starting cars,
   the housekeeping, census and topology constants the UI imports, and the
   home of the `Catalog` type) are the second slice, #926.
2. **AC2 The same catalog from TypeScript.** `catalogFor(mode)` in
   `src/engine/catalog.ts`, pure and DOM-free, built from the TypeScript
   tables with the same keys and order.
3. **AC3 The lock.** `conformance/catalog.json` pins each mode's canonical
   hash, written by the TypeScript test under `VC_CONFORMANCE_UPDATE=1`
   (refused in CI) and checked by the Rust referee and a Rust unit test. No
   scenario or loader digest moves.
4. **AC4 The binding.** The static `Engine.catalog(mode)` returns the JSON;
   `engine.d.ts` is regenerated and `src/dualrun/binding.ts` types it
   (`readCatalog`, `Catalog`); a WASM suite compares it with `catalogFor`
   in both modes.
5. **Deferred: AC5 the web UI moves over** (issue scope item 4). The UI's
   reads stay on the TypeScript tables until the TypeScript retirement; the
   backlog row stays open for it.

## What landed

- `engine-rs/src/catalog.rs`: `Catalog { mode, facilities, world, economy }`,
  `catalog`, `catalog_json`, `catalog_digest`, `pinned_digests`, and the
  re-exported placement-dependent formulas `transport_build_cost` and
  `household_price`.
- Facility rows: key, name, category, width, floors, cost, minStar,
  population, attendance, modernOnly, available, transport, staffOnly,
  basement, noBasement, onlyFloor, groundFloorKind, commercial, openHours,
  buildMinutes, resaleRefund, buildCap, capPool, maxSpan, fixedSpan,
  maxCars, carCapacity, floorCost, subtypes, dailyIncome, trafficBaseline,
  spendPerCustomer, rent (cadence, shape, default, ladder, band, noRate,
  lockedOnceSold, household). World: lotWidth, minFloor, maxFloor,
  groundFloor, lobbyInterval, lobbyFloors, skyLobbyFloors,
  escalatorsOnOfficeFloors, autoBridgeToggleable, previewShowsReason.
  Economy: addCarCost, carResaleRefund, transportFloorCost,
  guttedResaleRefund.
- Small source moves so the catalog and the simulation share one value,
  behavior unchanged: `econ::{ADD_CAR_COST, TRANSPORT_FLOOR_COST,
  GUTTED_RESALE_REFUND, car_resale_refund, transport_floor_cost,
  transport_cost_for_span, transport_build_cost}` (the build path charges
  through `transport_cost_for_span`, as the TypeScript `buildTransport`
  does through `transportCostForSpan`; `transport_build_cost` is the
  checked quote), `GameMode::{shows_preview_reason,
  allows_escalator_on_office_floors, has_variant_households}`,
  `Category::as_str`, `rent::{PriceOptions, price_options, price_neutral}`
  and `churn::HOUSEHOLD_SIZES` made public, `facilities::{GROUND_FLOOR,
  WEDDING_HALL_FLOOR, is_available_in_mode, max_cars_entry}`, and the
  wedding hall floor check reads `WEDDING_HALL_FLOOR`.
- `src/engine/catalog.ts` (`catalogFor`); `GUTTED_RESALE_REFUND`,
  `transportFloorCost`, `transportCostForSpan` and `transportBuildCost` in
  `econConfig.ts`; `GRID.groundFloor` and `WEDDING_HALL_FLOOR` in
  `facilitiesData.ts`; `isAvailableInMode` in `facilityPredicates.ts`.
- The lock, the referee check, the binding, the docs (`engine-rs/README.md`
  "Catalog", `conformance/README.md` "The catalog lock").

## Not in the catalog

Colors, descriptions, labels and icons are presentation and stay with the
frontend. Values that depend on a live unit (a sold condo's household, a
shaft's span) ship as formula inputs plus the function. Charging for add
car, remove car, extend and sell stays in the UI for now; a separate story
(`engine-owned-charges`, #914, PR #928) moves those charges into engine
commands.

## Engine agreement

Both engines produced the same catalog on the first run in both modes: no
disagreement to resolve.

## Test record

- `conformanceCatalog.integration.test.ts`: both hashes, JSON round trip,
  catalog order, the CLAUDE.md canon caps, pools, spans and cars, no kind
  in both a cap table and a pool, open hours sampled on every minute of a
  day, rent per mode, the build path charging what `transportBuildCost`
  quotes for every transport kind (each floor and shaft build asserted),
  the quote equal to the build formula for every valid span, and NaN for
  every refused span.
- `conformanceWasmCatalog.integration.test.ts` (under `npm run test:wasm`):
  `Engine.catalog(mode)` strictly equals `catalogFor(mode)` in both modes;
  an unknown mode throws and the module stays usable.
- Rust: `catalog::tests` (pinned hashes, canon caps and pools looked up by
  key, no kind in both a cap table and a pool, open hours on every minute,
  rent per mode with the rung labels, transport cost against the build
  path for every transport kind, the quote against the formula, NaN for a
  refused span) and the binding's
  `the_catalog_crosses_as_json_and_refuses_an_unknown_mode`.
- Referee: every scenario ok, `catalog classic: ok`, `catalog modern: ok`;
  `conformance/expected.json` and `loader-cases.json` unchanged.
- Gates on the merged tree (origin/main 87ee50c): typecheck, lint, test,
  build, test:wasm, cargo fmt, the three clippy runs, both cargo test runs,
  the referee and the package hash test all green.

## Review round 1 (`/gds-code-review`)

Three layers ran on the PR #925 diff. Raw findings: Blind Hunter 16,
Acceptance Auditor 6, Edge Case Hunter 8. After dedupe and triage:

Patched (18):

1. Rust `no_rate` was inferred from the ladder's presence. `rent::
   PriceOptions` now carries the ladder's `no_rate` flag, as TypeScript's
   `opts.noRate` does, and both the catalog and `set_no_rate` read it.
2. Each field reads the one source the simulation uses: `max_cars` from
   `max_cars_entry` (the `MAX_CARS` table, which `max_cars()` also reads),
   the household block from `GameMode::has_variant_households` (the Rust
   counterpart of `rules.hasVariantHouseholds`, which the condo sale in
   `churn.rs` now consults), and `available` from `is_available_in_mode` /
   `isAvailableInMode`, the helper `is_unlocked` / `isUnlocked` and the
   build refusal share.
3. `floorCost` repeated the elevator branch of `transportBuildCost`; both
   now read `transportFloorCost(kind)` / `transport_floor_cost(kind)`.
4. `TRANSPORT_FLOOR_COST` (and `ECON.transportFloorCost`) now say the
   engine charges it only when a shaft is built; the web UI charges the
   extend, which #914 moves. "Per served floor" became "per floor of span
   (top minus bottom)" in `econ.rs`, `sim/build.ts` and the README.
5. `WEDDING_HALL_FLOOR` (`= MAX_FLOOR`) feeds the placement check and
   `onlyFloor` in both engines; the refusal text is unchanged.
6. `GROUND_FLOOR` / `GRID.groundFloor` replaces the literal 1 at the
   catalog sites and in the ground-floor coercion.
7. A test in both engines pins that no kind is in both `BUILD_CAPS` and a
   pool, with the reason in the field docs.
8. Rust catalog tests look rows up by key.
9. The transport-cost tests assert every floor and shaft build succeeds.
10. `transportBuildCost` returns NaN (TypeScript) / `f64::NAN` (Rust) for a
    non-transport kind, a span below 1 or above `maxSpanFor`, a fractional
    span (TypeScript), or a fixed-span walkway at the wrong span. The build
    path charges through the unchecked `transportCostForSpan`, so its
    affordability check and charge are unchanged for every request; tests
    check the quote equals that formula for every valid span of every
    transport kind and that each kind's build charges the quote.
11. Rust `rent()` reads the price options once and labels each rung by its
    level; a priced kind can no longer lose its rent row to a second
    lookup.
12. Open hours are whole hours by construction (`Clock.hour` floors the
    minute of the day, and Rust's `hour()` is an `i64`). The catalog docs
    say so, and a test in both engines walks every minute of a day and
    checks the open minutes fall on exactly the listed hours.
13. `conformanceCatalog.integration.test.ts` reads the lock only when it
    checks it, so a malformed lock no longer blocks its regeneration.
14. `.github/workflows/engine-rs.yml` path filters list both catalog test
    files (`src/engine/**` already covers `catalog.ts`).
15. The overlong binding paragraph in `engine-rs/README.md` is rewrapped.
16. AC1 is narrowed to what landed and points at #926.
17. Backlog: the #913 row is `in-progress` with its PR and what remains;
    rows for #926 and #914 landed.
18. This record.

Deferred: #926 (the values a frontend still cannot read, AC1 above); #914,
PR #928 (the UI's gutted-sell literal 0 in `src/game/buildActions.ts:220`,
which the engine-owned charges remove); #893 (the Rust lock test reads
`../conformance/catalog.json`, which shipping the lock inside the crate
must unwind).

Dismissed: the referee printing only the two hashes on a catalog mismatch.
The WASM suite compares the catalogs field by field, so a mismatch is
already diagnosable.

The catalog lock did not move: every patch changes how a value is read,
and no value changed, so `conformance/catalog.json`, the scenario lock and
`loader-cases.json` are unchanged.
