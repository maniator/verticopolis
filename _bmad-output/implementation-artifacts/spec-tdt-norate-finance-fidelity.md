---
title: 'TDT round-trip fidelity: No-Rate rent state + lastQuarterMoney export'
type: 'feature'
created: '2026-07-12'
status: 'done'
baseline_commit: '8ff1bfb'
context:
  - '{project-root}/docs/canon/tdt-format.md'
  - '{project-root}/_bmad-output/planning-artifacts/design/gdd-classic-modern-pricing-roadmap-2026-07-08.md'
---

<frozen-after-approval reason="human-owned intent, do not modify unless human renegotiates">

## Intent

**Problem:** Diffing our TDT round-trip against real 1994 SimTower saves (`tools/simtower/`) confirmed two fidelity gaps: (1) rent class 4 "No Rate" (a unit deliberately off the rental market, charging nothing) collapses to class 2 "Average" because the engine has no No-Rate state, and (2) the header `lastQuarterMoney` field (0x10) that the real game populates is exported as 0.

**Approach:** Add a minimal real No-Rate unit state that earns $0 and round-trips class 4 both ways, and snapshot the balance at each quarter rollover so the exporter can write `lastQuarterMoney`. Both ride existing optional-field save seams (no `SAVE_VERSION` bump). This is the round-trip slice of the already-specced `pricing-split` and `finance-1010` features; the full Classic rent dropdown and the finance-window UI stay out of scope.

## Boundaries & Constraints

**Always:** Parity with SimTower 1994 (No Rate is canon). `Unit.rent` stays a raw number; No Rate is a separate flag, not a sentinel in `rent`. Keep `src/engine/` DOM-free. Route all rent income through the existing `rentOf(u)` chokepoint. Persist new fields via the write-when-set optional-field seam (like `filmPolicy`/`subtype`) with a legacy default, so old saves load unchanged and no `SAVE_VERSION` bump is needed. Deterministic + headless-testable. American English, no em-dashes in new prose.

**Ask First:** If a No-Rate condo selling for $0 (asking price 0) turns out to need special handling beyond "sells for $0", surface it rather than inventing a rule. If reconstructing `lastQuarterMoney` from the Ledger proves preferable to a stored snapshot, confirm before choosing derive-over-store.

**Never:** No full Classic/Modern rent dropdown UI (that is `pricing-split`, P1). No finance-window UI (that is `finance-1010`). Do not populate `otherIncome` (0x08) or `constructionCosts` (0x0C): both were 0 even in the real saves we diffed; leave them 0. Do not add a `SAVE_VERSION` bump. Do not let `rent` hold a magic 0/-1.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Import No-Rate unit | TDT unit-record rent class = 4, priced kind | `u.noRate = true`; `rent` left at default (undefined) | Non-priced kind: ignore class 4, no flag |
| Export No-Rate unit | `u.noRate === true` | Unit-record rent class byte = 4 | — |
| Round-trip | class 4 → import → export | class 4 preserved (was: became 2) | — |
| No-Rate income | office/hotel/condo with `noRate` | `rentOf(u)` returns 0; no rent/sale/hold-tax revenue | — |
| Reprice a No-Rate unit | player adjusts price up/down | `noRate` cleared; unit back on market at new price | — |
| lastQuarterMoney export | sim has snapshot from a past quarter | header 0x10 = round(snapshot/100), i32 clamped | No snapshot yet (fresh tower): write 0 |
| Legacy save load | `.vctower` with no `noRate`/`lastQuarterMoney` | loads as on-market / no snapshot; no migration | — |

</frozen-after-approval>

## Code Map

- `src/engine/types.ts` -- `Unit`/`SerializedUnit` (add `noRate?: boolean`); `SerializedGame` (add `lastQuarterMoney?: number`).
- `src/engine/econConfig.ts` -- `rentOf(u)` (~89): the single income chokepoint; return 0 when `noRate`.
- `src/engine/Simulation.ts` -- `priceUnit`/`adjustRent` (~1793) clear `noRate`; quarter-rollover tick (~901) snapshots `this.lastQuarterMoney = this.money`; `serializeUnit` (~2687) + `serialize`/`deserialize` seam + the exhaustiveness guard (~2662).
- `src/engine/saveMigration.ts` -- confirm no bump; new fields are optional-default.
- `src/storage/tdtImport.ts` -- rent-class application (~588): class 4 on a priced kind sets `noRate`.
- `src/storage/tdtExport.ts` -- `classFromRent`/tenant gather (~127): emit 4 when `noRate`; header emission (~490): write `lastQuarterMoney`.
- `src/ui/editorHtml.ts` / inspector -- display "No Rate" read-only (no setter here).

## Tasks & Acceptance

**Execution:**
- [x] `src/engine/types.ts` -- add `Unit.noRate?: boolean` (doc: off-market, charges nothing; `undefined`/`false` = on market) and `SerializedGame.lastQuarterMoney?: number`; handle `noRate` in the `serializeUnit` omit/exhaustiveness table.
- [x] `src/engine/econConfig.ts` -- `rentOf` returns 0 when `u.noRate`, before the `rent ?? default` fallback.
- [x] `src/engine/Simulation.ts` -- clear `noRate` in `priceUnit` (any explicit reprice puts it on market); snapshot `lastQuarterMoney = money` at the quarter-rollover tick before `collectRent`; write it in `serializeUnit`/`serialize` when set and restore in `deserialize`.
- [x] `src/storage/tdtImport.ts` -- when the rent-class byte is 4 and the kind is priced, set `noRate` on the imported unit (leave `rent` default).
- [x] `src/storage/tdtExport.ts` -- carry `noRate` into the tenant record so its rent class emits 4; write `lastQuarterMoney` at header 0x10 (round/÷100, i32-clamped like `balance`).
- [x] `src/ui/editorHtml.ts` (or inspector) -- render "No Rate" where the price reads today (display only).
- [x] `src/tests/tdtImport.test.ts` / `tdtExport.test.ts` / `economy` test -- unit-test the I/O matrix rows (import class4→noRate, export noRate→class4, full round-trip, $0 income, reprice clears, lastQuarterMoney export, legacy load).
- [x] `package.json` -- bump version (player-facing: No-Rate units now earn $0 + display).

**Acceptance Criteria:**
- Given a real SimTower `.TDT` with No-Rate units, when imported then re-exported, then every unit's rent-class byte is byte-identical to the original (No Rate stays 4).
- Given a No-Rate office/hotel/condo, when the economy ticks, then it contributes $0 income and its `everOccupied`/occupancy behavior is otherwise unchanged.
- Given a No-Rate unit, when the player adjusts its price, then `noRate` clears and normal rent resumes.
- Given a tower that has crossed at least one quarter boundary, when exported, then header 0x10 equals the snapshotted last-quarter balance (÷100), and a fresh tower exports 0 there.
- Given a pre-existing `.vctower`, when loaded, then it behaves exactly as before (no field, no migration).

## Spec Change Log

- **2026-07-12 (implementation, real-save oracle):** The real-game byte-diff (`my_tower`/`mo`/`MYTP0`) showed the OBSERVED rent-class-4 gap is **non-priced kinds** (fastFood/security/housekeeping/retail carry class 4 = No Rate because they have no tenant rent), not priced units set off-market. Every real save has priced kinds (office/condo/hotels) at class 0-3 and every non-priced kind at class 4; none had a priced unit at class 4. The frozen Intent ("class 4 collapses to 2") covers this; the first implementation only handled the priced `noRate` flag. Amended: `classFromRent` returns 4 for kinds with no rent band, and the multi-story part emitters use the computed `rentClass` (not a hardcoded 2). The priced `noRate` flag stays (a real, here-unexercised, 1994 feature). Oracle after fix: my_tower rent-class diffs 8 -> 0. Out of scope / still lossy (documented): status bytes, retail subtype, the burned-shell rentClass (kept 2, a gutted marker the importer clears), and lobby/empty-floor paving records. KEEP: the single `rentOf` hook; the optional-field save seam; the real-save oracle as acceptance check.

## Design Notes

`rentOf` is the one function every income site reads (office `collectRent`, hotel `hotelCheckout`, condo sale, condo hold-tax), so gating it on `noRate` is the whole economic hook:

```ts
export function rentOf(u: Unit): number {
  if (u.noRate) return 0;              // off-market: charges nothing
  return u.rent ?? ECON.rent[u.kind]?.default ?? 0;
}
```

No-Rate is imported-only + repriceable for now (setting it from scratch is `pricing-split`'s dropdown); repricing always clears it, so an imported No-Rate unit is never a permanent trap. `lastQuarterMoney` is a genuine historical snapshot (not cleanly derivable: construction spend is not in the Ledger), so it is stored, not derived; the snapshot is the balance at the START of the current quarter (taken before `collectRent`), matching the real game's finance-window "Last Quarter's Balance".

## Verification

**Commands:**
- `npm run typecheck` -- expected: clean (the `serializeUnit` exhaustiveness guard forces `noRate` to be handled).
- `npx vitest run tdtImport tdtExport canon economy` -- expected: all green incl. the new round-trip + income + lastQuarterMoney tests.
- `npm run lint` -- expected: clean.

**Manual checks:**
- Real-game oracle (opt-in, local, needs ISO; never CI): import a real save with No-Rate units via `tools/simtower/tdt-to-vctower.ts`, re-export, and confirm the rent-class bytes now match and header 0x10 is populated.
- `lastQuarterMoney` ÷100 scale verified against a real save: `my_tower` header 0x10 = 16110, which decodes to $1,611,000. That is sensible next to its current balance ($1,673,000), so the ÷100 scale is correct (no code change from this check).

## Change Log (post-approval patches)

These are implementation patches from the adversarial review; the frozen Intent/Boundaries/I-O matrix above is unchanged.

- **Off-market move-in guard (parity / economic-inversion fix).** A No-Rate unit must stay off the market, not just earn $0. Without a guard, `demandFactor` computes `rentOf(u)/default = 0/default = 0` for a No-Rate unit and `clamp(2 - 0)` reads as the 1.6 MAXIMUM demand, so an empty No-Rate office or condo would fill or sell FASTEST while charging nothing; a $0 condo sale then stamps `rent = 0` and `everOccupied = true`, and the sold-condo reprice gate permanently blocks clearing `noRate` (a dead $0 asset). Fix: `attemptMoveIns` skips `u.noRate` units before the fill roll, and `demandFactor` returns 0 for a No-Rate unit as a defensive partner. Only priced office/condo/hotel reach this path.
- **Batch-clear scoping.** The `noRate` clear in `computeBatch` moved INSIDE the two branches where a reprice actually writes (`u.rent = undefined` / `storeRent`), so a unit the inner guard skipped (a sold `everOccupied` condo, a protected custom-priced unit) keeps its flag, matching `priceUnit`, which clears only after its sold-condo early return.
- **Deserialize coercion.** `noRate` is hardened at the save trust boundary (`noRate: u.noRate === true ? true : undefined`), like `everOccupied`/`filmPolicy`, so a forged `noRate: "no"` cannot park a unit at $0.

## Suggested Review Order

**No-Rate economic model**

- Entry point: the single $0 income chokepoint every rent path reads
  [`econConfig.ts:90`](../../src/engine/econConfig.ts#L90)

- The state itself: a flag kept separate from `rent` (never a magic number)
  [`types.ts:280`](../../src/engine/types.ts#L280)

- Off-market means off-market: No-Rate units draw zero move-in demand, stay vacant
  [`Simulation.ts:1766`](../../src/engine/Simulation.ts#L1766)

- Any explicit reprice returns the unit to market (single + batch paths)
  [`Simulation.ts:1820`](../../src/engine/Simulation.ts#L1820)

**TDT rent-class round-trip (class 4 = No Rate)**

- Non-priced kinds export class 4, matching the real game (the observed gap)
  [`tdtExport.ts:133`](../../src/storage/tdtExport.ts#L133)

- Priced No-Rate flag emits class 4; gather threads it per tenant
  [`tdtExport.ts:359`](../../src/storage/tdtExport.ts#L359)

- Import: class 4 on a priced kind sets the flag, leaves rent at default
  [`tdtImport.ts:594`](../../src/storage/tdtImport.ts#L594)

**lastQuarterMoney finance export**

- Snapshot the balance at the quarter rollover, before rent is collected
  [`Simulation.ts:913`](../../src/engine/Simulation.ts#L913)

- Write it at header 0x10, divided by 100 and i32-clamped like `balance`
  [`tdtExport.ts:503`](../../src/storage/tdtExport.ts#L503)

**Save seam + hardening**

- Serialize the snapshot; optional-field seam means no SAVE_VERSION bump
  [`Simulation.ts:2379`](../../src/engine/Simulation.ts#L2379)

- Deserialize coercion: only a literal `true` flags off-market (forged-save guard)
  [`Simulation.ts:2554`](../../src/engine/Simulation.ts#L2554)

**Peripherals**

- UI shows "No Rate" where the price reads (display only; no setter here)
  [`editorHtml.ts:63`](../../src/ui/editorHtml.ts#L63)

- Tests: rent-class round-trip + non-priced, off-market vacancy, batch-clear scoping, lastQuarterMoney, legacy load
  [`tdtExport.test.ts`](../../src/tests/tdtExport.test.ts)
