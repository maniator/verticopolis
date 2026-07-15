import type { Simulation } from "../Simulation";

import { REAL_WORLD } from "../calendar";

import { rentOf, rentConfig } from "../econConfig";

import { householdPrice } from "../gameRules";

import { subtypeListFor } from "../retailSubtypes";
import { FACILITIES, isHotelKind } from "../facilities";
import type { FacilityKind, Unit, VacateReason } from "../types";

import { VACATE_REASON_TEXT } from "../types";

import { VACATE_NOTICE_MINUTES } from "./constants";

/** Vacate, move-in, subtype churn for the Simulation, as friend functions taking the
 * instance. Extracted from `Simulation.ts`; the class keeps thin delegations. */

export function vacate(sim: Simulation, u: Unit, reason: VacateReason): void {
  // The 1994 buy-back sting: when an OWNER leaves a sold condo, you don't just
  // lose a tenant, you repurchase the unit at what it sold for and hold it as
  // empty inventory to sell again. (A never-sold condo just goes back on the
  // market at no cost.) Charging the full sale price makes losing an owner to
  // sustained neglect genuinely hurt, exactly as it did in the original, and
  // resetting everOccupied lets the repurchased unit re-sell. Do this BEFORE the
  // everOccupied reset below reads it.
  // householdPrice reverses the sale exactly, the size-scaled price in Modern
  // (the household is still set here, before the reset below), the flat asking
  // price in Classic (residents undefined). 0 for anything that wasn't an owned
  // condo (offices, never-sold condos: they cost nothing back).
  let buyback = 0;
  if (u.kind === "condo" && u.everOccupied) {
    buyback = householdPrice(rentOf(u), u.residents);
    sim.money -= buyback;
    sim.recordMoney("condos", -buyback);
  }
  u.state = "empty";
  u.occupants = 0;
  // Return the unit to market by clearing the "currently leased/sold" flag, a
  // repurchased condo can then sell fresh, a vacated office re-lease. But
  // `vacate()` is ALSO the path a miserable HOTEL room loses its guest (the F25
  // branch in updateSatisfaction), and for a hotel everOccupied means "ever
  // booked" and must survive turnover (it's tracked by `state`, not this flag),
  // so never clear it for hotels, or a previously-booked room would read as
  // brand new. `residents` is a condo-only field, so clearing it is a no-op
  // elsewhere and keeps a re-sold condo drawing a fresh household.
  if (!isHotelKind(u.kind)) u.everOccupied = false;
  u.residents = undefined;
  // A condo returning to market re-lists in the CURRENT band: clamp away any
  // legacy/out-of-band asking price it carried while sold (e.g. a $240k
  // old-max), so it can't re-sell above the current ceiling, or, in Modern,
  // above it after household scaling. The buy-back charge above already used
  // the pre-clamp price, so it still mirrors the historical sale.
  if (u.kind === "condo" && u.rent !== undefined) {
    const band = rentConfig("condo")!;
    u.rent = Math.max(band.min, Math.min(band.max, u.rent));
  }
  u.label = FACILITIES[u.kind].name;
  u.vacateReason = undefined;
  u.vacateAt = undefined;
  // One toast per departure. A bought-back owner's line carries the cost and
  // the cause together; every other tenant just gets the plain "left" notice.
  sim.emit(
    buyback > 0
      ? `The owner left ${FACILITIES[u.kind].name} on ${sim.floorLabel(u.floor)} (${VACATE_REASON_TEXT[reason]}). You bought it back for $${buyback.toLocaleString()}.`
      : `A tenant left ${FACILITIES[u.kind].name} on ${sim.floorLabel(u.floor)} (${VACATE_REASON_TEXT[reason]}).`,
    "bad",
  );
}

export function attemptMoveIns(sim: Simulation): void {
  const weekend = sim.clock.isWeekend;
  // From 3★, office workers demand parking (canon). When the tower is short on
  // parking, fewer firms will move in, demand pressure, not eviction, so it
  // never destabilizes a built-out tower.
  const parkingPenalty = sim.officeParkingShort() ? 0.5 : 1;
  // Per-pass memo for the ≤2-ride BFS in floorReachable: many empty units
  // share a floor, and the verdict can't change mid-pass. Lives only for
  // this call; Crowd's adjacency graph is the layer cached by revision.
  const reachMemo = new Map<number, boolean>();
  const reachable = (floor: number): boolean => {
    let hit = reachMemo.get(floor);
    if (hit === undefined) {
      hit = sim.floorReachable(floor);
      reachMemo.set(floor, hit);
    }
    return hit;
  };
  // One set read per pass instead of a per-unit delegation chain; the set is
  // already revision-memoized (tower/routing.ts servedFloors).
  const servedSet = sim.tower.servedFloors();
  for (const u of sim.tower.units) {
    if (u.state !== "empty") continue;
    // Off-market ("No Rate"): the unit is deliberately not for rent/sale, so it
    // attracts no tenants and never seats one at $0 (which would stamp rent 0,
    // set everOccupied, and, for a condo, lock the sold-reprice gate forever).
    if (u.noRate) continue;
    const f = FACILITIES[u.kind];
    if (f.population === 0 && !isHotelKind(u.kind)) continue; // non-tenant facility
    if (!servedSet.has(u.floor)) continue; // nobody moves to an unreachable floor
    // Two-ride rule: a served floor 3+ rides from the lobby draws no
    // commuters (Crowd.MAX_RIDES), so nobody can arrive to buy, lease, or
    // check in. Same gate for every tenant kind; commercial visitor income
    // already honors it (EconomySystem.collectTrafficIncome), this makes
    // move-ins agree. (Quarterly office rent still gates on isFloorServed
    // only, a deliberate grandfather for tenants already in place.)
    if (!reachable(u.floor)) continue;

    const demand = sim.demandFactor(u);
    if (u.kind === "office") {
      if (!weekend && sim.rng.chance(0.25 * demand * parkingPenalty)) sim.moveIn(u);
    } else if (u.kind === "condo") {
      if (sim.rng.chance(0.18 * demand)) sim.moveIn(u);
    } else if (isHotelKind(u.kind)) {
      // Hotel rooms fill in the evening only and must be clean.
      if (sim.clock.isEvening() && sim.rng.chance(0.5 * demand)) {
        u.state = "asleep";
        u.everOccupied = true;
        sim.moveInsToday.rooms++;
      }
    }
  }
}

/** Monthly, Modern-only: a sold condo's household may relocate on its own, a
 *  life event (a job move, an upsize or downsize) unrelated to how well the
 *  tower serves it, so it can fire even on a perfectly happy condo. The chance
 *  scales with family size (bigger families are a bigger flight risk). Classic
 *  returns 0 and never rolls: the `<= 0` guard short-circuits BEFORE any RNG
 *  draw, so a Classic tower's seeded stream is byte-identical to one without
 *  this feature. A relocation enters the standard `vacating` notice with a
 *  non-rescindable "relocation" reason; when the notice elapses the existing
 *  buy-back reclaims the unit at its household-scaled price and re-lists it. */
export function rollCondoRelocations(sim: Simulation): void {
  const days = Math.ceil(VACATE_NOTICE_MINUTES / (24 * 60));
  for (const u of sim.tower.units) {
    // Only a currently-owned condo can relocate: `state === "occupied"` excludes
    // a bought-back/empty unit (vacate() also clears everOccupied) and a unit
    // mid-disaster (fire/gutted) or already on a notice, so a phantom "household
    // relocating" can never land on a unit with no household in place.
    if (u.kind !== "condo" || u.state !== "occupied" || !u.everOccupied) continue;
    // The rule returns a per-30-day-month chance, but this roll fires on the
    // maintenance tick, which rides the calendar's period. Scale by
    // maintPeriodDays/30 so the per-in-game-day relocation rate is invariant to
    // the calendar (real-world = 30 → ×1). Classic returns 0 and still
    // short-circuits BEFORE the RNG draw, so its seeded stream is untouched.
    const chance =
      sim.rules.condoRelocationChance(u.residents) *
      (sim.clock.calendar.maintPeriodDays / REAL_WORLD.maintPeriodDays);
    if (chance <= 0 || !sim.rng.chance(chance)) continue;
    u.state = "vacating";
    u.vacateReason = "relocation";
    u.vacateAt = sim.clock.minutes + VACATE_NOTICE_MINUTES;
    sim.emit(
      `A household in ${FACILITIES[u.kind].name} on ${sim.floorLabel(u.floor)} is relocating. They leave in under ${days} day(s); you buy the unit back to re-sell.`,
      // "bad" so the advance warning actually TOASTS: the UI toasts only
      // good/bad log entries; "info" is bulletin-only, which would swallow the
      // heads-up. The non-blaming framing lives in the wording, not the color,
      // matching how the neglect notices surface.
      "bad",
    );
  }
}

/**
 * Draw a canon retail variant name from `sim.rng` for the given kind, or
 * undefined when the kind carries no canon subtype. Short-circuits BEFORE
 * touching the RNG for every non-retail kind so a Classic tower whose diet
 * skips retail stays byte-identical (the `subtypeListFor(kind) === null`
 * branch never observes `this.rng`). Mirrors the `rollCondoRelocations`
 * short-circuit above where `chance <= 0` returns pre-draw.
 */
export function rollRetailSubtype(sim: Simulation, kind: FacilityKind): string | undefined {
  const list = subtypeListFor(kind);
  if (list === null) return undefined;
  return sim.rng.pick(list);
}

/**
 * Reroll a placed retail unit's canon variant. Returns the new subtype on
 * success, or undefined when the id isn't a retail unit (non-retail kind
 * or a kind whose canon list is a single entry). The new name is
 * guaranteed different from the current one when the list has more than
 * one option. Called from the inspector's "Change variety" action.
 */
export function rerollSubtype(sim: Simulation, id: number): string | undefined {
  const u = sim.tower.getUnit(id);
  if (!u) return undefined;
  const list = subtypeListFor(u.kind);
  if (list === null || list.length < 2) return undefined;
  // Draw off-current: when the unit has a canon subtype to avoid, pick from
  // [0, list.length - 2] and skip past the current position, so the new
  // subtype is never the same as the one being replaced without rejection
  // sampling. When the unit has no current subtype (legacy retail unit, or
  // a whitelist-coerced away value) draw from the full range [0,
  // list.length - 1] so every canon variant is reachable, including the
  // last entry.
  const currentIdx = u.subtype === undefined ? -1 : list.indexOf(u.subtype);
  let idx: number;
  if (currentIdx < 0) {
    idx = sim.rng.int(0, list.length - 1);
  } else {
    idx = sim.rng.int(0, list.length - 2);
    if (idx >= currentIdx) idx += 1;
  }
  const next = list[idx];
  u.subtype = next;
  // Retail varieties draw differently, and the renderer only re-compares
  // room signatures on a sync trigger (hour flip, lighting flip, structural
  // or meal-overlay change). Bump the meal-overlay channel, the cheap
  // room-resync signal, so the reroll repaints immediately even on a paused
  // or quiet tower instead of waiting for the next unrelated trigger.
  sim.tower.bumpMealOverlayRevision();
  return next;
}

export function moveIn(sim: Simulation, u: Unit): void {
  u.state = "occupied";
  u.satisfaction = 1;
  // A fresh tenant carries no prior eviction, clear any leftover notice
  // bookkeeping so a recycled unit can never present stale departure data.
  u.vacateReason = undefined;
  u.vacateAt = undefined;
  if (u.kind === "condo" && !u.everOccupied) {
    u.everOccupied = true;
    // The rule-set decides who buys and for how much: Classic → flat 3 at the
    // asking price; Modern → a 2–5 person household that scales the price. The
    // asking price the player set still drives HOW FAST it sells (via move-in
    // demand); the rule-set decides WHAT it fetches and who moves in.
    const asking = rentOf(u);
    const { price, residents } = sim.rules.sellCondo(asking, sim.rng);
    if (residents !== undefined) u.residents = residents;
    // Stamp the asking price the sale was struck at, so a later buy-back mirrors
    // THIS price even if the kind's default moves in a future build (rentOf
    // would otherwise pick up the new default for an un-priced condo). A sold
    // condo can't be repriced, so this stays fixed for the unit's owned life.
    u.rent = asking;
    sim.money += price;
    sim.recordMoney("condos", price);
    sim.moveInsToday.condos++;
    const who = residents ? ` to a household of ${residents}` : "";
    sim.emit(`Condominium on ${sim.floorLabel(u.floor)} sold${who} for $${price.toLocaleString()}.`, "money");
  }
  if (u.kind === "office") {
    u.everOccupied = true;
    u.label = sim.companyName();
    sim.moveInsToday.offices++;
  }
}

export function companyName(sim: Simulation): string {
  const a = ["Apex", "Nimbus", "Vertex", "Cobalt", "Atlas", "Orion", "Pioneer", "Summit", "Delta", "Vista"];
  const b = ["Holdings", "Systems", "Partners", "Industries", "Group", "Labs", "Trading", "Capital"];
  return `${sim.rng.pick(a)} ${sim.rng.pick(b)}`;
}

/** One quiet log line summarising the day's tenancy churn, so the player feels
 *  the building filling up without a toast per individual tenant. */
export function reportMoveIns(sim: Simulation): void {
  const m = sim.moveInsToday;
  const parts: string[] = [];
  if (m.offices) parts.push(`${m.offices} office${m.offices > 1 ? "s" : ""} leased`);
  if (m.condos) parts.push(`${m.condos} condo${m.condos > 1 ? "s" : ""} sold`);
  if (m.rooms) parts.push(`${m.rooms} hotel room${m.rooms > 1 ? "s" : ""} booked`);
  if (parts.length) sim.emit(`New tenants: ${parts.join(", ")}.`, "good");
  sim.moveInsToday = { offices: 0, condos: 0, rooms: 0 };
}
