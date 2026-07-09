---
title: 'Retail subtypes + facility visual variety + commercial venue inspector'
type: 'feature'
created: '2026-07-09'
status: 'draft'
context:
  - '{project-root}/CLAUDE.md'
  - '{project-root}/docs/canon/tdt-format.md'
---

<frozen-after-approval reason="human-owned intent, do not modify unless human renegotiates">

## Intent

**Problem:** Three overlapping canon gaps.
1. `retail-subtypes` (backlog P3): the 1994 game has 5 restaurants, 5 fast-foods, and 11 shops as canon named variants (`docs/canon/tdt-format.md` §7); our engine has none, and TDT import/export silently drops the variant byte.
2. `facility-visual-variety` (backlog P3): same-kind rooms all render identically today. Owner observation: 1994 has subtle per-unit visual variation.
3. `commercial-venue-inspector` (backlog P2): the 1994 commercial inspector shows subtype name + Today's Patronage + Yesterday's Profit + reasoning + weather modifier line. Ours shows generic rent/satisfaction.

**Approach:** Ship all three in one PR because they share a data seam (`Unit.subtype` on retail) and a design principle (cosmetic-first, economy stays untouched). One `Unit.subtype?: string` field carries the canon variant name; a new `patronageToday/Yest`, `profitToday/Yest` per-venue counters back the inspector. `Simulation.build` rolls a subtype from the seeded RNG for shop/fastFood/restaurant only, short-circuiting for non-retail kinds so a Classic tower stays byte-identical. Legacy units stay generic (no re-roll on load). TDT import adopts the variant byte; export writes it into both the unit-record and retail-table slots. The render layer reads `u.subtype` (retail) or `hash(u.id) mod N` (office/hotel*/condo) to pick a cosmetic palette variant -- deterministic, no engine impact. The inspector's commercial card grows patronage/profit/reasoning/weather lines for shop/fastFood/restaurant only.

## Boundaries & Constraints

**Always:**
- Subtype is COSMETIC-ONLY. Nothing in `EconomySystem`, `Crowd`, `traffic.ts`, or the star-rating path may read `subtype`. Pinned by a runtime economy-invariance test.
- Subtype is chosen ONCE at build time from `sim.rng`; it's the only new RNG draw and it's gated to shop/fastFood/restaurant, so Classic towers whose diet excludes retail stay byte-identical (Classic's rent stream matches the `condoRelocationChance` and `sellCondo` precedent for gated draws).
- Procedural office/hotel/condo variant is derived from `hash(u.id)` at render time, never stored. Same seed to same-`id` mapping on every reload.
- Legacy save units without `subtype` render generic (no re-roll on load). Same rule for missing patronage/profit fields: default to 0.
- All new prose is American English, no em-dashes. `src/engine/` stays DOM-free.

**Ask First:**
- Adding `subtype` reads outside the render + inspector + TDT surfaces.
- Changing `trafficAppeal()` in `EconomySystem` (the subagent confirmed rain modulation lives in `collectTrafficIncome`, not `trafficAppeal`, and the spec keeps both intact).
- Any change to `SAVE_VERSION`. This work uses the optional-field seam like `filmPolicy` and does NOT bump it.

**Never:**
- No build-palette picker for subtypes. They're flavor, not a player choice at build time.
- No visual variant for elevators/stairs/parking/service (transports and utilities keep canonical rendering).
- No render-time RNG. Every render decision is derived from stable state (`u.id`, `u.subtype`, `u.state`).
- No screenshot workflow marker in this PR (visual variety WILL move `docs/screenshots/**` pixels; regenerate via `[update-screenshots]` in the merge commit or as a follow-up).

## I/O & Edge-Case Matrix

| Scenario | State / action | Expected behavior |
|----------|----------------|-------------------|
| Build shop | `sim.build("shop", floor, x)` | Placed. `unit.subtype` is one of the 11 canon shop names, drawn from `sim.rng`. Same seed to same subtype. |
| Build fast food | `sim.build("fastFood", floor, x)` | Placed. `unit.subtype` is one of the 5 canon fast-food names. |
| Build restaurant | `sim.build("restaurant", floor, x)` | Placed. `unit.subtype` is one of the 5 canon restaurant names. |
| Build non-retail | `sim.build("office" or any other kind, floor, x)` | Placed. `unit.subtype === undefined`. RNG NOT drawn (byte-identical Classic stream). |
| Reroll variety | Player clicks "Change variety" on a picked retail unit | `sim.rerollSubtype(id)` picks a new canon name from `sim.rng`, guaranteed different from the current one. |
| Legacy save load | Old save has retail units without `subtype` | Units load with `subtype === undefined`. Inspector shows the generic name. Render shows the pre-variety look. No re-roll. |
| TDT import | `.TDT` retail unit at floor F, variant byte v | Imported unit has `subtype === CANON_ORDER[kind][v]`. Falls back to `undefined` if v is out of range. |
| TDT export | Save with retail units carrying `subtype` | TDT unit-record byte 17 AND retail-table slot both carry the variant index. Header `commercialCount` unchanged (already correct). |
| Inspector title | Picked retail unit with subtype | Title reads the subtype name ("Chinese Cafe"), not "Fast Food". |
| Inspector title | Picked retail unit without subtype (legacy) | Title reads the generic `FACILITIES[kind].name`. |
| Inspector patronage | Picked retail unit, mid-afternoon | Today's Patronage line shows the running count. Yesterday's Profit shows the prior day's take. |
| Inspector weather | Weather is "rain", picked retail unit | "Rain might cause fewer customers." line appears. Cleared / cloudy: line absent. |
| Reasoning tier | Patronage vs kind baseline | 3 tiers, colored: "Business is booming" (green), "Business is average" (neutral), "Very few customers" (red). |
| Daily rollover | Midnight tick | `patronageYest = patronageToday; patronageToday = 0` (same for profit) for shop/fastFood/restaurant only. |
| Render variety (retail) | Two shops on the same floor with different subtypes | Two different color palettes. |
| Render variety (office) | Two offices with different `id` | Two different palette picks, deterministic from `hash(u.id)`, no `subtype` field involved. |
| Economy invariance | Two towers, identical seeds, forced to different subtypes | `sim.money` and every `u.pendingIncome` are byte-identical after N ticks. |

</frozen-after-approval>

## Code Map

**Engine model:**
- `src/engine/types.ts:213-264` `Unit` interface -- add `subtype?: string`, `patronageToday?: number`, `patronageYest?: number`, `profitToday?: number`, `profitYest?: number`. Follow `filmPolicy?` at line 261 as the optional-field pattern.
- `src/engine/types.ts:299-307` `SerializedUnit` -- inherits automatically via `Omit`; sparse-write comment stands.
- `src/engine/Simulation.ts:466-539` `build(kind, floor, x)` -- right after `tower.place` returns `res.unitId` at line 488, roll the subtype for retail kinds via a new private `rollRetailSubtype(unit)` helper. Short-circuit BEFORE the RNG draw when kind is not retail, mirroring `rollCondoRelocations` at Simulation.ts:1444-1473.
- `src/engine/Simulation.ts:2439-2467` `serializeUnit` -- extend the destructure to include the 5 new fields; add `if (subtype !== undefined) out.subtype = subtype` and `if (X !== 0) out.X = X` for each numeric.
- `src/engine/Simulation.ts:2233+` `deserialize` -- use existing `num(v, fallback)` at Simulation.ts:2223 for the numeric fields; whitelist-coerce `subtype` against the canon set (drop unrecognized strings, matching `filmPolicy` at Simulation.ts:2297-2300).
- `src/engine/Simulation.ts` NEW public method `rerollSubtype(id: number): boolean` -- for the inspector "Change variety" action. Draws from `sim.rng`, guarantees a different name than the current when the kind has more than one variant.
- `src/engine/EconomySystem.ts:88-170` `collectTrafficIncome` -- near the `u.pendingIncome += hourly` accumulator at line 161, also accumulate `u.patronageToday` (customers this hour derived from `hourly / dailyPerCustomer` or a simpler count-per-hour) and `u.profitToday += earned` at line 165. Reads NO `subtype`.
- `src/engine/Simulation.ts:841-869` `onDay` -- new pass over the units array: for shop/fastFood/restaurant, roll `patronageYest = patronageToday ?? 0; patronageToday = 0` and the same for profit. Runs once per day rollover.
- `src/engine/retailSubtypes.ts` (NEW small module) -- canonical name lists in `docs/canon/tdt-format.md` §7 order:
  - `RESTAURANT_SUBTYPES = ["English Pub", "French", "Chinese", "Sushi Bar", "Steak House"]` (5)
  - `FASTFOOD_SUBTYPES = ["Japanese Soba", "Chinese Cafe", "Hamburger Stand", "Ice Cream", "Coffee Shop"]` (5)
  - `SHOP_SUBTYPES = ["Men's Clothing", "Pet Store", "Flower Shop", "Book Store", "Drug Store", "Boutique", "Electronics", "Bank", "Hair Salon", "Post Office", "Sports Gear"]` (11)
  - `subtypeListFor(kind): readonly string[] | null`, `subtypeIndex(kind, name): number | -1`, `canonicalSubtype(kind, name)` for the whitelist coerce.

**TDT format / import / export:**
- `src/storage/tdtFormat.ts:521-535` parser skips the retail-table's variant byte today; extend `TdtTail`/`TdtTower` to expose per-slot variants (either widen `retailRows` from a count into per-slot records, or add `retailVariants: Uint8Array`).
- `src/storage/tdtImport.ts:578-583` `pushUnit(kind, ...)` for retail -- assign `unit.subtype = canonicalSubtype(kind, RESTAURANT/FF/SHOP[t.subtype])` (whitelist maps invalid v to `undefined`). Update the "retail varieties aren't imported yet" line at `src/storage/tdtImport.ts:1198`.
- `src/storage/tdtExport.ts:513` writes `u8(0)` in the floor-map tenant record -- replace with the canon index of `u.subtype` (0 when absent).
- `src/storage/tdtExport.ts:539-542` writes the 512-slot retail table entirely empty (`0xFF`) -- populate one row per emitted shop/fastFood/restaurant with `{floor, status: 0, variant: subtypeIndex}`. Respect the 512-slot clamp already in `tdtExport.ts:473`.

**Inspector UI:**
- `src/game/inspector.ts:84-202` unit branch -- inject subtype into the title at line 190 (`f.name` becomes the subtype name for retail with a fallback). Add before the "Satisfaction:" line at inspector.ts:201: "Today's Patronage" with the running count + a colored bar (yellow/red idiom like the parking demand line at inspector.ts:39-43), "Yesterday's Profit" ($), a one-line reasoning ("Business is booming" / average / very few), and (only when `sim.weather === "rain"`) "Rain might cause fewer customers."
- `src/game/editorActions.ts:138-234` -- add `"changeVariety"` to `UNDO_LABELS` at line 142; new branch calls `sim.rerollSubtype(u.id)`. Model on the `filmPolicy` cycle at lines 154, 176-181.
- `src/ui/editorHtml.ts:~101` -- add a "Change variety" button on retail unit editor cards; mirror the film-policy button precedent.
- `src/ui/UI.ts:543-557` `showInspector` -- no code change; the injected HTML keeps its single `<h4 class="win-title">` at the top so the mobile ✕ still attaches.

**Render layer:**
- `src/render/excalibur/TowerEngine.ts:1422-1470` -- extend the sprite-cache `sig` at line 1444 with `u.subtype` (retail) or the `hash(u.id)` variant index (office/hotel*/condo). Cache invalidates when subtype rerolls.
- `src/render/excalibur/pixelSprites.ts:42-47` `hash(u.id)` -- the model. Follow the existing `condo` wall-color idiom at pixelSprites.ts:267 for office/hotel/condo palette variants. Retail sprites at pixelSprites.ts:374/398/429 already use `hash(u.id)`; switch those to read `u.subtype` first (canonical palette per subtype) with `hash(u.id)` as the legacy fallback (subtype === undefined).
- No new caches; the per-actor `ex.Canvas` at TowerEngine.ts:1631-1663 is already keyed by `sig`.

**Tests:**
- `src/tests/canon.test.ts:26+` -- new describe pins the three subtype lists match §7 canon order (length + names).
- `src/tests/simulation.test.ts` (new describe `"Retail subtypes"`) -- determinism (same seed to same sequence), build-path presence (retail gets subtype, non-retail undefined), Classic RNG byte-identical when no retail is built, reroll guaranteed different.
- `src/tests/simulation.test.ts` (new describe `"Retail patronage rollover"`) -- build a shop, tick hours, assert `patronageToday` grows and `profitToday` grows; call `onDay`, assert `patronageYest / profitYest` receive the yesterday values and today is reset to 0.
- `src/tests/simulation.test.ts` NEW ECONOMY-INVARIANCE test -- two towers with same seed, one forced-subtype "Chinese Cafe" and one "Hamburger Stand" on the same unit; run N ticks; assert `sim.money` and every `u.pendingIncome` match byte-identical.
- `src/tests/tdtImport.test.ts:86-96` -- extend the retail fixture to place a shop with `subtype: 3`; assert `unit.subtype === SHOP_SUBTYPES[3]`.
- `src/tests/tdtExport.test.ts:569+` -- round-trip: serialize a save with retail subtypes; buildTDT; parseTDT; assert unit-record byte 17 and retail-slot bytes match the input.
- `src/tests/economyDepth.test.ts` -- mirror the `filmPolicy` round-trip at economyDepth.test.ts:112-124 for subtype (round-trip + garbage coercion) and for the numeric patronage/profit fields (default 0 when omitted).

**Version + backlog:**
- `package.json`: bump minor (owner-visible: subtype names + patronage/profit lines + visual variety).
- `_bmad-output/implementation-artifacts/backlog.md`: mark `retail-subtypes`, `facility-visual-variety`, and `commercial-venue-inspector` as shipped in this version. Update the `tdt-importer` deferral line about "retail-subtype adoption" as closed.

## Tasks & Acceptance

**Execution (dependency order: engine, then TDT, then inspector, then render, then tests, then docs):**
- [ ] `src/engine/retailSubtypes.ts` -- canon lists + helpers.
- [ ] `src/engine/types.ts` -- add optional fields to `Unit`.
- [ ] `src/engine/Simulation.ts` -- subtype roll in `build`, whitelist coerce in `deserialize`, sparse write in `serializeUnit`, new `rerollSubtype(id)` public method, daily rollover in `onDay`.
- [ ] `src/engine/EconomySystem.ts` -- accumulate `patronageToday` + `profitToday` in `collectTrafficIncome`.
- [ ] `src/storage/tdtFormat.ts` -- parse the retail table's per-slot variant byte into `TdtTail`.
- [ ] `src/storage/tdtImport.ts` -- adopt the variant on retail units via whitelist coerce; update `couldNotBring` message.
- [ ] `src/storage/tdtExport.ts` -- write the unit-record byte 17 AND the retail-table rows from `u.subtype`.
- [ ] `src/game/inspector.ts` -- subtype title, patronage/profit lines, reasoning tier, rain modifier.
- [ ] `src/game/editorActions.ts` + `src/ui/editorHtml.ts` -- "Change variety" action + button (retail only).
- [ ] `src/render/excalibur/TowerEngine.ts` + `src/render/excalibur/pixelSprites.ts` -- subtype-keyed retail palettes; procedural office/hotel*/condo palette variants derived from `hash(u.id)`.
- [ ] Tests as listed in the Code Map.
- [ ] `package.json` -- bump minor.
- [ ] `_bmad-output/implementation-artifacts/backlog.md` -- close the three items; update the TDT deferral.

**Acceptance Criteria:**
- Given a fresh Classic tower with seed 42, when the player builds three shops in a row via `sim.build`, then each carries a `subtype` from `SHOP_SUBTYPES`, and repeating the same builds against a fresh Classic seed 42 produces the same subtype sequence.
- Given a fresh Classic tower with seed 42 that ONLY builds offices/hotels/condos (no retail), when serialized after N ticks, then `sim.money`, every unit's `pendingIncome`, and the ledger totals are byte-identical to a pre-feature build (RNG stream preserved via short-circuit).
- Given two identical towers, when one is forced to `subtype = "Chinese Cafe"` and the other to `"Hamburger Stand"` on every fast-food unit and both run N ticks, then `sim.money` and every `u.pendingIncome` match byte-identical.
- Given a picked shop with `subtype`, when the inspector shows, then the title reads the subtype name (not "Shop"), and lines for Today's Patronage, Yesterday's Profit, a reasoning tier, and (only in rain) the rain modifier all render.
- Given the player clicks "Change variety" on a shop, when the action fires, then `sim.rerollSubtype(id)` picks a different canon shop name and the inspector updates.
- Given a legacy save without any `subtype` field, when loaded, then units load with `subtype === undefined`, the inspector shows generic names, and the render layer picks a stable per-`id` palette variant (no crash, no re-roll).
- Given a `.TDT` save with retail units carrying variant byte v, when imported, then `unit.subtype === SUBTYPES[kind][v]`; when re-exported, then both the unit-record byte 17 and the retail-table slot carry v.
- Given all four quality gates run (typecheck, lint, test, build), all are green; the e2e suite is green.

## Design Notes

**Why one PR.** The three backlog items share a data seam (`Unit.subtype`) and a design principle (cosmetic-only, economy untouched). Splitting would either duplicate the TDT wiring (subtypes shipped first, then re-touched for the inspector) or serialize the patronage counters twice (added for the inspector, then re-touched for the export). Shipping together also keeps the migration story simple: one `SAVE_VERSION`-neutral hop.

**Byte-identical Classic RNG.** The subtype roll draws from `sim.rng`. Classic towers that build no retail must see zero draws so their event/rent stream stays deterministic. Gate: check `subtypeListFor(kind)` returns non-null BEFORE calling `rng.int/pick`. Mirror the `rollCondoRelocations` pattern at Simulation.ts:1460 (short-circuit chance <= 0 before the draw).

**Reasoning tiers.** Simple 3-tier thresholds on `patronageToday / expectedPerDay(kind)`. Below 0.5: "Very few customers." 0.5-1.2: "Business is average." Above 1.2: "Business is booming." Kind-specific baselines derived from `dailyTrafficIncome` divided by an assumed per-customer spend, or a fixed baseline table.

**Procedural palette count.** For office/hotel*/condo, start with 3-4 palette shades keyed off `FACILITIES[kind].color` (lighten/darken). Small enough that the cache doesn't explode; large enough for visible variety.

**Weather line and `trafficAppeal`.** `trafficAppeal()` does NOT factor weather today; rain enters via a per-unit `rainMult` inside `collectTrafficIncome` (subagent finding). Keep the economy behavior as-is. The inspector line is descriptive, not a hint of a mechanic change.

## Verification

**Commands:**
- `npm run typecheck` -- expected: clean.
- `npm run lint` -- expected: clean.
- `npm test` -- expected: all green including the new suites.
- `npm run build` -- expected: succeeds.
- `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test` -- expected: e2e green.
