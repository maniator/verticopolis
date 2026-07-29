import type { SimContext } from "../SimContext";
import type { LedgerCat } from "../Ledger";
import { isTenanted } from "../types";
import { rentOf } from "../econConfig";
import { ledgerCatFor } from "../Ledger";
import { isRentalKind } from "../residentialRentals";
import { unitReachable } from "../sim/demand";
import { REAL_WORLD } from "../calendar";

/**
 * Monthly rent from Modern rental living (Studio & Apartment). A free function
 * (not an `EconomySystem` method) so that class stays under the size ceiling,
 * mirroring the `economy/housekeeping.ts` split. Called from the monthly block
 * in `onDay` on the maintenance-period cadence, distinct from the office's
 * quarterly `collectRent`.
 *
 * A vacant unit is not `isTenanted`, so it is skipped and earns nothing (it
 * still pays operating overhead via `isOverheadKind`, the GDD's "vacant =
 * carrying cost"). Banked to the residential ledger line, like the condo.
 *
 * Reachability goes through the shared {@link unitReachable}, the same decision
 * the demand pool and the traffic-income loop use, so a home on a stranded run
 * of a gap-split floor earns nothing. The floor-level `isFloorServed` would say
 * yes there and keep banking rent for a tenant nobody can reach, while the
 * satisfaction path (segment-aware since #647) erodes that same tenant out.
 */
export function collectMonthlyRent(sim: SimContext): void {
  // Summed per ledger category rather than banked under one literal kind: both
  // rentals map to the residential line today, and this stays honest the day a
  // dedicated rentals category lands.
  const byCat = new Map<LedgerCat, number>();
  let sum = 0;
  let n = 0;
  for (const u of sim.tower.units) {
    if (!isRentalKind(u.kind) || !isTenanted(u) || !unitReachable(sim, u.floor, u.x)) continue;
    const rent = rentOf(u);
    sum += rent;
    n += 1;
    const cat = ledgerCatFor(u.kind) ?? "upkeep";
    byCat.set(cat, (byCat.get(cat) ?? 0) + rent);
  }
  // Same per-in-game-day invariance `payMaintenance` and the office `collectRent`
  // hold: this runs on the maintenance-period cadence, so a canon-calendar tower
  // (period 3 days) collects ten times as often as a real-world one (30) and must
  // scale the amount to match, or the calendar toggle would multiply rental income
  // tenfold. Structurally the constant, never a bare 30, so it cannot drift.
  const scale = sim.clock.calendar.maintPeriodDays / REAL_WORLD.maintPeriodDays;
  const amt = Math.round(sum * scale);
  if (amt <= 0) return;
  sim.money += amt;
  for (const [cat, catSum] of byCat) sim.recordMoney?.(cat, Math.round(catSum * scale));
  sim.emit(`Monthly rent collected: $${amt.toLocaleString()} (${n} rental${n > 1 ? "s" : ""}).`, "money");
}
