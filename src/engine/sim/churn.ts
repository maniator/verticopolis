import type { Simulation } from "../Simulation";

import { REAL_WORLD } from "../calendar";

import { rentOf, rentConfig } from "../econConfig";

import { householdPrice, snapToLadder } from "../gameRules";

import { subtypeListFor } from "../retailSubtypes";
import { FACILITIES, isHotelKind, isLeaseAmenityKind } from "../facilities";
import { isRentalKind } from "../residentialRentals";
import { rollHousehold } from "../households";
import { segAt } from "../tower/segments";
import type { FacilityKind, Unit, VacateReason } from "../types";

import { VACATE_REASON_TEXT } from "../types";

import { VACATE_NOTICE_MINUTES } from "./constants";

import { buildSatisfactionContext, wouldEvictFreshTenant, type SatisfactionContext } from "./satisfactionStep";
import { foldOriginDemand } from "./demand";
import { servingTransportKindsAt } from "./gripe";

/** Vacate, move-in, subtype churn for the Simulation, as friend functions taking the
 * instance. Extracted from `Simulation.ts`; the class keeps thin delegations. */

/** The congestion churn warning names the transport that is actually crowded
 *  (#699), through the same classifier as the inspector's gripe line so the
 *  toast and the card can never disagree. "Add cars" holds only where a
 *  passenger elevator stops at the floor; a walkway-only floor gets the honest
 *  lever (capacity), because there are no cars to add on a floor no elevator
 *  stops at. */
function congestionChurnNote(sim: Simulation, floor: number): string {
  const serving = servingTransportKindsAt(sim, floor);
  const noun = serving.elevator
    ? "elevators"
    : serving.stairs && serving.escalator
      ? "stairs and escalators"
      : serving.stairs
        ? "stairs"
        : serving.escalator
          ? "escalators"
          : "vertical transport";
  const lever = serving.elevator ? "add cars" : "add capacity";
  return ` A new owner will buy in, but the crowded ${noun} will wear them down too until you ${lever}.`;
}

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
    // The buy-back mirrors the historical SALE price, which No Rate does not
    // rewrite: rentOf reads $0 for an off-market unit (an imported class-4
    // occupied condo), but losing that owner still costs the repurchase at
    // what the unit sold for (the stored price; the kind default when a
    // legacy record carries none), never a free walk-away.
    const salePrice = u.rent ?? rentConfig("condo")!.default;
    buyback = householdPrice(salePrice, u.residents);
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
  // A condo returning to market re-lists at a CURRENTLY legal price: snapped
  // onto the canon ladder in Classic, clamped into the band in Modern, so a
  // legacy/out-of-band asking price it carried while sold (e.g. a $240k
  // old-max) can't re-sell above the current ceiling, or, in Modern, above it
  // after household scaling. The buy-back charge above already used the
  // pre-normalized price, so it still mirrors the historical sale.
  if (u.kind === "condo" && u.rent !== undefined) {
    const priceShape = sim.rules.priceOptions("condo")!;
    if (priceShape.shape === "ladder") {
      u.rent = snapToLadder(priceShape.rungs, u.rent);
    } else {
      const band = rentConfig("condo")!;
      u.rent = Math.max(band.min, Math.min(band.max, u.rent));
    }
  }
  u.label = FACILITIES[u.kind].name;
  u.vacateReason = undefined;
  u.vacateAt = undefined;
  // One toast per departure. A bought-back owner's line carries the cost and the
  // cause together; every other tenant just gets the plain "left" notice. The
  // trailing note tells the player what becomes of the repurchased unit, and it
  // asks the move-in gate DIRECTLY rather than inferring from the recorded reason,
  // so it can never promise a re-sale the gate then refuses (nor claim a spot
  // stays empty that the gate will re-fill). The unit is empty and back on the
  // market at this point, so `wouldEvictFreshTenant` gives the exact re-sale
  // verdict: if the gate still holds it (a live structural drain: noise, far walk,
  // lobby distance, rent, unmet demand, possibly alongside the congestion that
  // triggered this eviction), it stays empty until that is fixed; otherwise it
  // re-sells, and only then does a congestion-caused eviction warrant the "the
  // crowding will keep wearing owners down" note (congestion is deliberately not
  // gated, so an under-elevatored tower keeps turning the unit over until cars are
  // added). A well-placed relocation just re-lists silently. A No Rate unit (an
  // imported off-market owned condo) is skipped by `attemptMoveIns` regardless of
  // the gate, so it stays empty until a rate is set, which is what the note must
  // say (not "fix the cause" or "a new owner will buy in").
  let buybackNote = "";
  if (buyback > 0) {
    buybackNote = u.noRate
      ? " It is off the market (No Rate); set a rate to sell it again."
      : wouldEvictFreshTenant(sim, u, buildSatisfactionContext(sim, true))
        ? " It stays empty until you fix the cause."
        : reason === "congestion"
          ? congestionChurnNote(sim, u.floor)
          : "";
  }
  sim.emit(
    buyback > 0
      ? `The owner left ${FACILITIES[u.kind].name} on ${sim.floorLabel(u.floor)} (${VACATE_REASON_TEXT[reason]}). You bought it back for $${buyback.toLocaleString()}.${buybackNote}`
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
  // One set read per pass instead of a per-unit delegation chain; the set is
  // already revision-memoized (tower/routing.ts servedFloors).
  const servedSet = sim.tower.servedFloors();
  // Per-pass memo for the segment-aware reachability probe: many empty units share
  // a segment, and the verdict can't change mid-pass. Keyed on the segment id (not
  // the floor), so a gap-split floor's runs memoize apart while a gap-free floor
  // is one key per floor, exactly the old per-floor memo. Lives only for this call;
  // the routing adjacency it consults is the layer cached by revision.
  const reachMemo = new Map<number, boolean>();
  const reachable = (floor: number, x: number): boolean => {
    const key = segAt(sim.tower, floor, x);
    let hit = reachMemo.get(key);
    if (hit === undefined) {
      hit = sim.positionReachable(floor, x);
      reachMemo.set(key, hit);
    }
    return hit;
  };
  // The move-in sustainability gate's context (halo floor-sets, congestion,
  // coverage), built ONCE and only if a condo/office candidate actually reaches
  // the gate, so a tower with none pays nothing. Same source of truth the
  // per-tick satisfaction update reads (spec-move-in-sustainability-gate).
  let satCtx: SatisfactionContext | null = null;
  // A condo/office/rental actually moving in this pass adds its demand to the
  // gate context's running pool (a hotel check-in folds inline at its own
  // branch below, which never calls moveIn), so a LATER candidate is judged
  // against the demand the earlier fills already created (the intra-pass half of
  // the batch-aware unmet-demand share; a candidate's own demand is folded in
  // inside wouldEvictFreshTenant). satCtx.demandMap exists once the first
  // coverage-kind candidate (isUnmetDemandKind) reaches the gate; a Studio or
  // lease amenity is gated without building it, so a fill before that point
  // skips the fold here, and the later map build counts the already-occupied
  // unit in its census instead. Either ordering counts each fill exactly once.
  const filled = (unit: Unit): void => {
    sim.moveIn(unit);
    if (satCtx?.demandMap) foldOriginDemand(satCtx.demandMap, sim, unit);
  };
  for (const u of sim.tower.units) {
    if (u.state !== "empty") continue;
    // Off-market ("No Rate"): the unit is deliberately not for rent/sale, so it
    // attracts no tenants and never seats one at $0 (which would stamp rent 0,
    // set everOccupied, and, for a condo, lock the sold-reprice gate forever).
    if (u.noRate) continue;
    const f = FACILITIES[u.kind];
    if (f.population === 0 && !isHotelKind(u.kind)) continue; // non-tenant facility
    if (!servedSet.has(u.floor)) continue; // nobody moves to an unreachable floor
    // Reachability: this branch runs after the servedSet check, so the floor IS
    // connected to the lobby; it still draws no commuters if the router cannot
    // reach it. Reachability is uncapped in both modes now (#503), so the only
    // served-but-unreachable case is Classic refusing a stair/escalator climb
    // past the walk budget (in Modern, served equals reachable). Nobody can
    // arrive to buy, lease, or check in.
    // Same gate for every tenant kind; commercial visitor income already honors
    // it (EconomySystem.collectTrafficIncome), this makes move-ins agree.
    // (Quarterly office rent still gates on isFloorServed only, a deliberate
    // grandfather for tenants already in place.) Segment-aware (#647): a unit on
    // a disconnected half of a gap-split floor never populates, even when a
    // sibling segment of the same floor is reachable. On a gap-free floor this is
    // exactly the old floorReachable gate, so a contiguous tower is unchanged.
    if (!reachable(u.floor, u.x)) continue;

    // Move-in sustainability gate (both modes): don't sell/lease a condo or
    // office into a spot whose own placement would just erode a fresh tenant
    // back below the leave bar, evict them, and re-list, an endless churn that
    // nets zero money but reads as a bug. If the spot can't hold a livable
    // tenant, it stays VACANT until the player fixes what's wrong (better
    // access, quieter neighbors, closer lobby), matching the 1994 original where
    // a badly placed office simply "rimangono vuoti". Consults the same
    // satisfactionStep the per-tick update runs, drawing no RNG, so a gated
    // candidate only skips its own move-in roll.
    // Rentals are lease tenants that erode on placement too (the Apartment on
    // noise/far-walk/lobby, the Studio gently on noise, and both on an over-market
    // rent), so a bad spot would just lease, churn out, and re-list forever without
    // this gate. The Apartment also carries the unmet-demand drain (#661:
    // rentals are demand origins); the forgiving Studio stays out of it. The lease amenities (fitnessClub/clinic) are gated
    // for the same reason (#667): they erode on unserved placement and on an
    // over-market rent (over * 0.07 outruns SERVED_RECOVERY past ~71% over), so
    // an ungated one at max rent would lease, erode out, and re-list forever.
    if (u.kind === "condo" || u.kind === "office" || isLeaseAmenityKind(u.kind) || isRentalKind(u.kind)) {
      satCtx ??= buildSatisfactionContext(sim, true); // gate judges placement, not transient congestion
      if (wouldEvictFreshTenant(sim, u, satCtx)) continue;
    }

    const demand = sim.demandFactor(u);
    if (u.kind === "office") {
      if (!weekend && sim.rng.chance(0.25 * demand * parkingPenalty)) filled(u);
    } else if (u.kind === "condo") {
      if (sim.rng.chance(0.18 * demand)) filled(u);
    } else if (u.kind === "fitnessClub" || u.kind === "clinic") {
      // Modern-only lease amenities, filled like an office (any day of the week).
      // Classic never reaches here: it holds neither kind, so no rng is drawn and
      // the Classic seeded stream is untouched.
      if (sim.rng.chance(0.22 * demand)) {
        sim.moveIn(u);
        // A club leasing mid-pass is a fitness-halo source immediately, so later
        // gated candidates in this same pass judge against the live halo instead
        // of the stale gather (the same running-context patch the hotel branch
        // applies to the demand pool below).
        if (u.kind === "fitnessClub" && satCtx && servedSet.has(u.floor)) satCtx.clubFloors.push(u.floor);
      }
    } else if (isRentalKind(u.kind)) {
      // Modern-only rental living: a vacant Studio/Apartment re-leases like an
      // office/condo, at a speed the player's rent sets (demandFactor). Classic
      // never reaches here (the kinds are modernOnly), so its seeded stream is
      // untouched. The Studio fills readily (cheap, forgiving); the Apartment a
      // touch slower (pickier), so a demanding tenant is meaningfully harder to keep.
      // Rentals are demand origins (#661), so a signed lease goes through
      // `filled` and its running-pool bookkeeping like a condo/office fill.
      const fillRate = u.kind === "rentalStudio" ? 0.22 : 0.16;
      if (sim.rng.chance(fillRate * demand)) filled(u);
    } else if (isHotelKind(u.kind)) {
      // Hotel rooms fill in the evening only and must be clean.
      if (sim.clock.isEvening() && sim.rng.chance(0.5 * demand)) {
        u.state = "asleep";
        u.everOccupied = true;
        sim.moveInsToday.rooms++;
        // A guest checking in mid-pass becomes a demand origin (computeDemandMap
        // counts asleep rooms), so raise the running pool too, or a condo/office
        // evaluated later in the same pass would be judged against stale coverage.
        if (satCtx?.demandMap) foldOriginDemand(satCtx.demandMap, sim, u);
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
      `A household in ${FACILITIES[u.kind].name} on ${sim.floorLabel(u.floor)} is relocating. They leave in under ${days} day(s); you buy the unit back and re-list it.`,
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
  if (u.kind === "fitnessClub") {
    u.everOccupied = true;
    u.label = gymName(sim);
    sim.moveInsToday.fitness++;
  }
  if (u.kind === "clinic") {
    u.everOccupied = true;
    u.label = clinicName(sim);
    sim.moveInsToday.clinic++;
  }
  if (isRentalKind(u.kind)) {
    // A rental leases (no sale, unlike the condo). The Apartment houses a varied
    // household (condo-style, so its population and churn scale with family size);
    // the Studio is a fixed single occupant.
    u.everOccupied = true;
    if (u.kind === "rentalApartment") u.residents = rollHousehold(sim.rng);
    sim.moveInsToday.rentals++;
  }
}

export function gymName(sim: Simulation): string {
  const a = ["Ironworks", "Summit", "Pulse", "Apex", "Vertex", "Kinetic", "Anvil", "Ascend", "Cobalt", "Momentum"];
  const b = ["Fitness", "Athletic Club", "Gym", "Strength", "Studio", "Wellness"];
  return `${sim.rng.pick(a)} ${sim.rng.pick(b)}`;
}

export function clinicName(sim: Simulation): string {
  const a = ["Cedar", "Riverside", "Parkview", "Meridian", "Grove", "Harbor", "Summit", "Bayside", "Elm", "Crestview"];
  const b = ["Clinic", "Health", "Medical", "Care", "Wellness Center", "Practice"];
  return `${sim.rng.pick(a)} ${sim.rng.pick(b)}`;
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
  if (m.fitness) parts.push(`${m.fitness} fitness club${m.fitness > 1 ? "s" : ""} leased`);
  if (m.clinic) parts.push(`${m.clinic} clinic${m.clinic > 1 ? "s" : ""} leased`);
  if (m.rentals) parts.push(`${m.rentals} rental${m.rentals > 1 ? "s" : ""} leased`);
  if (parts.length) sim.emit(`New tenants: ${parts.join(", ")}.`, "good");
  sim.moveInsToday = { offices: 0, condos: 0, rooms: 0, fitness: 0, clinic: 0, rentals: 0 };
}
