import type { Simulation } from "../engine/Simulation";
import type { Unit, VacateReason } from "../engine/types";
import { unmetCoverage, dominantGripe, nearNightclub, servingTransportKindsAt, bindingTransportClassAt } from "../engine/sim/gripe";
import { buildSatisfactionContext, wouldEvictFreshTenant } from "../engine/sim/satisfactionStep";
import { unitPrice } from "../ui/catalogPricing";
import { towerCatalog } from "../engine/towerCatalog";
import { isHotelKind, isLeaseAmenityKind, isUnmetDemandKind } from "../engine/facilities";
import { isRentalKind } from "../engine/residentialRentals";
import { gripeCopy as displayGripe, type GripeCopyFacts } from "../ui/tenantDiagnosticCopy";

/**
 * Legacy TypeScript engine adapter. Read the explanation facts once from the
 * simulation and send them to the SAME pure presenter used by the Rust port.
 * The Rust inspector never instantiates a TypeScript Simulation.
 */
export function gripeLineText(
  sim: Simulation,
  u: Unit,
  gripe: VacateReason,
  unmetCov?: number | null,
): string | undefined {
  const facts: GripeCopyFacts = { cause: gripe };
  if (gripe === "congestion") {
    facts.binding = bindingTransportClassAt(sim, u.floor);
    if (facts.binding === "stairs" || facts.binding === "escalator" || facts.binding === "walkways") {
      facts.elevatorHere = servingTransportKindsAt(sim, u.floor).elevator;
    }
  } else if (gripe === "noise") {
    facts.adjacent = sim.noiseAfflicted(u);
    facts.club = (u.kind === "condo" || isHotelKind(u.kind) || u.kind === "rentalApartment") && nearNightclub(sim, u);
  } else if (gripe === "unmetDemand") {
    const cov = unmetCov !== undefined ? unmetCov : unmetCoverage(sim.demandMap(), u);
    facts.coverage = cov;
    if (cov === 0) facts.floorReachable = sim.floorReachable(u.floor);
  }
  return displayGripe(facts);
}

/**
 * The inspector's "Won't lease" line for an EMPTY, on-market, reachable
 * condo/office/rental the move-in sustainability gate holds vacant (a fresh tenant here
 * would erode below the leave bar and give notice again), or null when the unit
 * would fill. The empty-unit mirror of the "Main gripe" line: it names WHY no one
 * leases the spot so a perpetual vacancy reads as an actionable placement problem
 * instead of a mystery. Like "Main gripe" it spells out only the causes WITHOUT a
 * dedicated diagnostic line (congestion, over-market rent, noise, unmet demand);
 * access, the long-walk line (office and rental Apartment), and very-far lobby
 * distance keep their own
 * actionable lines on the card, so for those the line just says a tenant would
 * give notice and points to the flagged problem. Gated on the SAME predicate
 * `attemptMoveIns` uses, so the card and the move-in decision can never disagree;
 * unreachable and off-market units are excluded (their own lines tell that
 * story), matching the engine, which never reaches the gate for them.
 *
 * The rental kinds are here because the gate holds them too: an Apartment or
 * Studio dropped in a bad spot stays vacant just like a condo, so without this
 * line that vacancy is the silent mystery the gate exists to explain. Reads
 * `positionReachable`, the segment-aware predicate `attemptMoveIns` switched to
 * in #647, so a unit stranded on a disconnected run of a gap-split floor keeps
 * its own "no way to transportation" line instead of a gate verdict the engine
 * never actually reached.
 */
export function wontLeaseText(sim: Simulation, u: Unit): string | null {
  if (
    !(u.kind === "office" || u.kind === "condo" || isLeaseAmenityKind(u.kind) || isRentalKind(u.kind)) ||
    u.state !== "empty" ||
    u.noRate ||
    !sim.tower.isFloorServed(u.floor) ||
    !sim.positionReachable(u.floor, u.x)
  ) {
    return null;
  }
  // One shared gate context so the verdict AND the cause read the same
  // candidate-aware demand: wouldEvictFreshTenant registers this empty unit as a
  // demand origin and sets the candidate-aware share on ctx.demandMap.
  const ctx = buildSatisfactionContext(sim, true);
  if (!wouldEvictFreshTenant(sim, u, ctx)) return null;
  // Name the cause the GATE actually held the spot for, which excludes congestion
  // (the gate context neutralizes it). Passing cong = 0 to dominantGripe skips the
  // congestion tier so the line never tells the player to "add cars" when adding
  // cars would not fill the spot; the structural cause the neutralized gate caught
  // (noise, far walk, lobby distance, rent, unmet demand) wins instead. The
  // unmet-demand flag is computed from the SAME candidate-aware demand the gate
  // used (the empty unit is now a registered origin), so a spot gated only by a
  // retail shortage attributes "too few shops" instead of falling to the generic
  // line, where dominantGripe would otherwise read the real map that omits it.
  // EXCEPT for the forgiving Studio and the lease amenities (#667), which the
  // coverage drain never reads, so computing the flag here would manufacture a
  // cause the sim never applies and blame a vacancy on "too few shops". The
  // Apartment is a real demand origin now (#661) and carries the drain on both
  // the live and gate paths, so it reads coverage like a condo. Mirroring the
  // engine's coverage guard keeps the two in step.
  const coverageKind = isUnmetDemandKind(u.kind);
  const cov = coverageKind && ctx.demandMap ? unmetCoverage(ctx.demandMap, u) : null;
  const unmetDrain = cov === null ? null : sim.rules.unmetDemandDrain(cov);
  const unmetActive = unmetDrain !== null && (unmetDrain.erosion > 0 || unmetDrain.cap < 1);
  // The coverage rides along too (#548): the empty candidate is not an origin
  // in the real memoized map, so without it the harshest-drain comparison would
  // read null coverage and silently hand the tier back to noise, and this card
  // would blame a noisy neighbor for a spot the gate held over a retail
  // shortage while the occupied unit next door names the shortage.
  const gripe = dominantGripe(sim, u, undefined, 0, undefined, undefined, undefined, unmetActive, cov);
  const text = gripe ? gripeLineText(sim, u, gripe, cov) : undefined;
  const lead = text
    ? `Won't lease: ${text}`
    : "Won't lease: a new tenant here would soon give notice. Fix the flagged problem to fill it.";
  return `${lead}${carryingCostNote(sim, u)}`;
}

/** The spec's "fix it or raze it" carrying-cost telegraph: while a gated spot sits
 *  empty it still bleeds its holding cost, so name it and the bulldoze escape, not
 *  just the placement problem. Modern operating overhead falls on any held office or
 *  unsold condo, and an unsold condo also pays hold tax scaled to its asking price
 *  (`EconomySystem.payMaintenance`). Classic has neither sink (both rates 0), so an
 *  empty spot there costs nothing to hold and the note is omitted. */
function carryingCostNote(sim: Simulation, u: Unit): string {
  const catalog = towerCatalog(sim);
  const overhead = catalog.economy.overheadPerUnitMonthly;
  const holdTax = u.kind === "condo" ? Math.ceil(unitPrice(catalog, u) * catalog.economy.condoHoldTaxRate) : 0;
  const carry = overhead + holdTax;
  if (carry <= 0) return "";
  return ` It still costs about $${carry.toLocaleString()} a month to hold empty, so fix the cause or bulldoze it to stop the loss.`;
}
