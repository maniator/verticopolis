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
   keys) returns per facility kind, in catalog order, every value the UI
   reads from engine tables, resolved for the mode; the world constants a
   placement check reads; and the economy constants the UI shows. Each
   value reads the source the simulation reads. No existing behavior changes.
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
  GUTTED_RESALE_REFUND, car_resale_refund, transport_build_cost}` (the
  build path now charges through `transport_build_cost`, as the TypeScript
  `buildTransport` does through `transportBuildCost`), `GameMode::
  {shows_preview_reason, allows_escalator_on_office_floors}`,
  `Category::as_str`, `rent::{price_options, price_neutral}` and
  `churn::HOUSEHOLD_SIZES` made public, and the wedding hall floor check
  reads `MAX_FLOOR`.
- `src/engine/catalog.ts` (`catalogFor`), `GUTTED_RESALE_REFUND` and
  `transportBuildCost` in `econConfig.ts`.
- The lock, the referee check, the binding, the docs (`engine-rs/README.md`
  "Catalog", `conformance/README.md` "The catalog lock").

## Not in the catalog

Colors, descriptions, labels and icons are presentation and stay with the
frontend. Values that depend on a live unit (a sold condo's household, a
shaft's span) ship as formula inputs plus the function. Charging for add
car, remove car, extend and sell stays in the UI for now; a separate story
moves those charges into engine commands.

## Engine agreement

Both engines produced the same catalog on the first run in both modes: no
disagreement to resolve.

## Test record

- `conformanceCatalog.integration.test.ts`: both hashes, JSON round trip,
  catalog order, the CLAUDE.md canon caps, pools, spans and cars, rent per
  mode, and the build path charging what `transportBuildCost` quotes.
- `conformanceWasmCatalog.integration.test.ts` (under `npm run test:wasm`):
  `Engine.catalog(mode)` strictly equals `catalogFor(mode)` in both modes;
  an unknown mode throws and the module stays usable.
- Rust: `catalog::tests` (pinned hashes, canon caps and pools, rent per
  mode, transport cost against the build path) and the binding's
  `the_catalog_crosses_as_json_and_refuses_an_unknown_mode`.
- Referee: every scenario ok, `catalog classic: ok`, `catalog modern: ok`;
  `conformance/expected.json` and `loader-cases.json` unchanged.
- Gates on the merged tree (origin/main 87ee50c): typecheck, lint, test,
  build, test:wasm, cargo fmt, the three clippy runs, both cargo test runs,
  the referee and the package hash test all green.
