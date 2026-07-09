---
title: 'Retail subtypes: canon variant names on shops, fast food, and restaurants'
type: 'feature'
created: '2026-07-09'
status: 'in-review'
baseline_commit: '3c6d59c'
context:
  - '{project-root}/CLAUDE.md'
  - '{project-root}/docs/canon/tdt-format.md'
---

<frozen-after-approval reason="human-owned intent, do not modify unless human renegotiates">

## Intent

**Problem:** The 1994 SimTower has 5 named restaurants, 5 fast-foods, and 11 shops as canon variants (`docs/canon/tdt-format.md` §7). Verticopolis has none: every restaurant is "Restaurant," every shop is "Shop," and the TDT import silently drops the variant byte while the export writes zero. Two direct consequences: a real 1994 save round-trips without its retail variety, and the inspector title stays generic where the original names each unit ("Chinese Cafe" not "Fast Food").

**Approach:** Add `Unit.subtype?: string` on shop, fast food, and restaurant units. `Simulation.build` rolls a subtype from the seeded RNG at placement time, gated to those three kinds so Classic towers whose diet skips retail see zero new RNG draws (byte-identical rent and event streams). Legacy units without `subtype` load unchanged. TDT import adopts the canon variant byte via a whitelist against the §7 name lists; export writes the byte in both the unit record and the retail table. The inspector title reads the subtype name when present; a "Change variety" reroll action lets the player pick a new one. Subtype is cosmetic-only; nothing in `EconomySystem`, `Crowd`, `traffic.ts`, or the star-rating path reads it. Two follow-ups (procedural office/hotel/condo visual variety, and the patronage/profit inspector panel) are deferred, both blocked on the `Unit.subtype` seam that this PR lands.

## Boundaries & Constraints

**Always:**
- Subtype is cosmetic-only. Pinned by a runtime economy-invariance test.
- Subtype rolls ONCE at build time from `sim.rng`, and only for shop / fastFood / restaurant. Short-circuit BEFORE the RNG draw for other kinds so a Classic office-only tower stays byte-identical.
- Legacy save units without `subtype` load with `subtype === undefined`; no re-roll on load. Follows the `filmPolicy` optional-field seam.
- Reroll always picks a name different from the current when the kind has more than one variant (all three kinds do).
- American English, no em-dashes in new prose. `src/engine/` stays DOM-free.

**Ask First:**
- Reading `subtype` outside the render layer, the inspector, and the TDT import/export.
- Bumping `SAVE_VERSION` (this PR uses the optional-field seam and MUST NOT bump).
- Changing anything about `trafficAppeal()` or the weather-modulation model.

**Never:**
- No build-palette picker for subtypes.
- No render layer changes in THIS PR (deferred to `facility-visual-variety`).
- No patronage / profit tracking in THIS PR (deferred to `commercial-venue-inspector`).
- No screenshot workflow marker (no rendering change).

## I/O & Edge-Case Matrix

| Scenario | State / action | Expected behavior |
|----------|----------------|-------------------|
| Build shop | `sim.build("shop", floor, x)` | Placed. `unit.subtype` is one of the 11 canon shop names, drawn from `sim.rng`. Same seed produces the same subtype. |
| Build fast food | `sim.build("fastFood", floor, x)` | Placed. `unit.subtype` is one of the 5 canon fast-food names. |
| Build restaurant | `sim.build("restaurant", floor, x)` | Placed. `unit.subtype` is one of the 5 canon restaurant names. |
| Build non-retail | `sim.build("office", floor, x)` or any non-retail kind | Placed. `unit.subtype === undefined`. RNG NOT drawn (Classic stream byte-identical). |
| Reroll | Player clicks "Change variety" on a picked retail unit | `sim.rerollSubtype(id)` picks a canon name different from the current, drawn from `sim.rng`. |
| Legacy save load | Old save without any `subtype` field | Units load with `subtype === undefined`. Inspector shows the generic name. No re-roll. |
| Garbage subtype on load | Save has `subtype: "Not a real name"` on a shop | Whitelist coerce drops the value, `subtype === undefined`, no throw. |
| TDT import | `.TDT` retail unit with variant byte v | Imported unit has `subtype === CANON_ORDER[kind][v]`. Out-of-range v maps to `undefined`. |
| TDT export | Save with retail units carrying `subtype` | Both TDT unit-record byte 17 and the retail-table slot carry the canon index. Header `commercialCount` unchanged. |
| Inspector title | Picked retail unit with subtype | Title reads the subtype name ("Chinese Cafe"). |
| Inspector title | Picked retail unit without subtype (legacy) | Title reads the generic `FACILITIES[kind].name` ("Fast Food"). |
| Economy invariance | Two towers, identical seeds, one forced-subtype "Chinese Cafe" and one "Hamburger Stand" on the same unit | `sim.money` and every `u.pendingIncome` match byte-identical after N ticks. |

</frozen-after-approval>

## Code Map

- `src/engine/types.ts:213-264`: add `subtype?: string` to `Unit`. Model on `filmPolicy?` at line 261.
- `src/engine/retailSubtypes.ts` NEW: canon name lists (§7 order) and three helpers:
  - `RESTAURANT_SUBTYPES = ["English Pub", "French", "Chinese", "Sushi Bar", "Steak House"]`
  - `FASTFOOD_SUBTYPES = ["Japanese Soba", "Chinese Cafe", "Hamburger Stand", "Ice Cream", "Coffee Shop"]`
  - `SHOP_SUBTYPES = ["Men's Clothing", "Pet Store", "Flower Shop", "Book Store", "Drug Store", "Boutique", "Electronics", "Bank", "Hair Salon", "Post Office", "Sports Gear"]`
  - `subtypeListFor(kind): readonly string[] | null` (null gates the short-circuit).
  - `subtypeIndex(kind, name): number | -1` for TDT export.
  - `canonicalSubtype(kind, name): string | undefined` for load / TDT import whitelist coerce.
- `src/engine/Simulation.ts:466-539` `build`: after `tower.place` returns `unitId` at line 488, roll subtype via a new private `rollRetailSubtype`. Short-circuit BEFORE the RNG draw when `subtypeListFor(kind)` is null. Model: `rollCondoRelocations` short-circuit at Simulation.ts:1460.
- `src/engine/Simulation.ts` NEW `rerollSubtype(id): { ok: boolean; subtype?: string }`: picks a canon name different from the current, draws from `sim.rng`, short-circuits non-retail.
- `src/engine/Simulation.ts:2439-2467` `serializeUnit`: extend destructure; sparse-write `subtype` like `filmPolicy`.
- `src/engine/Simulation.ts:2233+` `deserialize`: whitelist-coerce `subtype` via `canonicalSubtype(kind, raw)`. Model: `filmPolicy` at Simulation.ts:2297-2300.
- `src/storage/tdtFormat.ts:521-535`: parse the retail-table's per-slot variant byte into `TdtTail` (add `retailVariants: Uint8Array`, length 512, `0xFF` empty).
- `src/storage/tdtFormat.ts:150-165, line 394`: `TdtTenant.subtype` is ALREADY parsed from unit-record byte 17 (§4). Use it as the authoritative import source (canon doc says §4 has stronger evidence than §7).
- `src/storage/tdtImport.ts:578-583`: assign `unit.subtype = canonicalSubtype(kind, LIST[t.subtype])`. Out-of-range v maps to undefined.
- `src/storage/tdtImport.ts:1198`: reword the "retail varieties aren't imported yet" line.
- `src/storage/tdtExport.ts:513`: replace `u8(0)` with `subtypeIndex(u.kind, u.subtype)` (falls back to 0 for absent).
- `src/storage/tdtExport.ts:539-542`: populate the retail-table row per emitted shop / fastFood / restaurant with `{floor, status: 0, variant}`.
- `src/game/inspector.ts:190`: title reads `u.subtype ?? f.name` (retail with subtype gets the specific name; legacy falls back).
- `src/game/editorActions.ts:138-234`: add `"changeVariety"` to `UNDO_LABELS`; new branch calls `sim.rerollSubtype(u.id)`. Model: `filmPolicy` cycle at 154, 176-181.
- `src/ui/editorHtml.ts:~101`: "Change variety" button on retail editor cards only. Model: film-policy button precedent.
- `src/tests/canon.test.ts`: pin the three lists match §7 length + order.
- `src/tests/simulation.test.ts` new `Retail subtypes` block: same-seed determinism, retail gets a subtype, non-retail undefined, byte-identical Classic RNG when no retail (money + pendingIncome + `towerStateSig`), reroll picks a different name and coverage.
- `src/tests/simulation.test.ts` economy-invariance test: two towers same seed, one fast-food unit forced to different subtypes each, N ticks, money and pendingIncome match byte-identical.
- `src/tests/tdtImport.test.ts:86-96`: fixture writes `subtype: 3` on a shop, assert `unit.subtype === SHOP_SUBTYPES[3]`.
- `src/tests/tdtExport.test.ts:569+`: round-trip. `buildTDT` then `parseTDT`, assert both byte 17 and retail-slot carry the canon index.
- `src/tests/economyDepth.test.ts`: mirror the `filmPolicy` round-trip test at economyDepth.test.ts:112-124 for `subtype` (round-trip + garbage coerce).
- `_bmad-output/implementation-artifacts/backlog.md`: close `retail-subtypes`; update the `tdt-importer` deferral about retail-subtype adoption. Leave `facility-visual-variety` and `commercial-venue-inspector` open (in the Deferral inbox as PR-B).
- `package.json`: bump minor.

## Tasks & Acceptance

**Execution (dependency order: engine, then TDT, then inspector, then tests, then docs):**
- [x] `src/engine/retailSubtypes.ts`: canon lists + three helpers.
- [x] `src/engine/types.ts`: add `subtype?: string` to `Unit`.
- [x] `src/engine/Simulation.ts`: `build` calls the gated subtype roll; new `rerollSubtype` public method; `serializeUnit` sparse-writes subtype; `deserialize` whitelist-coerces subtype.
- [x] `src/storage/tdtFormat.ts`: parse the retail-table per-slot variant byte into `TdtTail`.
- [x] `src/storage/tdtImport.ts`: adopt `subtype` on retail units via whitelist; update the "retail varieties aren't imported" message.
- [x] `src/storage/tdtExport.ts`: write the unit-record byte 17 AND populate the retail-table rows from `u.subtype`.
- [x] `src/game/inspector.ts`: use `subtype` for the title when present.
- [x] `src/game/editorActions.ts` + `src/ui/editorHtml.ts`: "Change variety" action + button (retail only).
- [x] Tests as listed in the Code Map.
- [x] `package.json`: bump minor.
- [x] `_bmad-output/implementation-artifacts/backlog.md`: close `retail-subtypes`; update the TDT deferral line.

**Acceptance Criteria:**
- Given a fresh Classic tower with seed 42, when three shops are built via `sim.build`, then each carries a `subtype` from `SHOP_SUBTYPES`, and repeating the sequence against a fresh Classic seed 42 produces the identical subtype triple.
- Given a fresh Classic tower with seed 42 that builds only offices, condos, and hotels for N ticks, when compared to a pre-feature build of the same seed and script, then `sim.money`, every unit's `pendingIncome`, and `towerStateSig(sim.tower)` are byte-identical (pins the RNG short-circuit).
- Given two identical Classic towers with the same seed, when one fast-food unit is forced to `subtype = "Chinese Cafe"` and the other to `"Hamburger Stand"` and both run N ticks, then `sim.money` and every `u.pendingIncome` match byte-identical (pins the cosmetic-only invariant).
- Given a picked retail unit with `subtype`, when the inspector renders, then the title reads the subtype name and the mobile ✕ still attaches (single `<h4 class="win-title">` preserved).
- Given the player invokes "Change variety" on a retail unit, when the action fires, then `sim.rerollSubtype(id)` picks a canon name different from the current one and the inspector title updates.
- Given a legacy save with no `subtype` on any unit, when loaded, then every unit has `subtype === undefined`, no re-roll occurs, and the inspector shows generic names.
- Given a save with `subtype: "Not a real variant"` on a shop, when loaded, then the shop's `subtype` is `undefined`, no throw.
- Given a `.TDT` file with a shop carrying variant byte 3, when imported, then `unit.subtype === SHOP_SUBTYPES[3]`; when re-exported, both the unit-record byte 17 and the retail-table slot carry byte 3.
- Given all four quality gates run (`typecheck`, `lint`, `test`, `build`), then all are green; the e2e suite is green.

## Design Notes

**Byte-identical Classic RNG.** The new draw is gated by `subtypeListFor(kind) === null`, which short-circuits every non-retail kind BEFORE `sim.rng` is touched. Mirrors `rollCondoRelocations` at Simulation.ts:1460 and is pinned by the "no retail, byte-identical" test.

**TDT dual-source truth.** Canon doc §4 (unit-record byte 17) has stronger evidence than §7 (retail table slot). Import reads §4; export writes both so any downstream reader gets the same variant.

## Verification

**Commands:**
- `npm run typecheck`: expected clean.
- `npm run lint`: expected clean.
- `npm test`: expected all green, new suites included.
- `npm run build`: expected succeeds.
- `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test`: expected e2e green (no e2e change in PR-A; run existing suite as a smoke test).
