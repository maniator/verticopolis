import type { Simulation } from "../engine/Simulation";
import type { Unit, VacateReason } from "../engine/types";
import { unmetCoverage, dominantGripe, nearNightclub } from "../engine/sim/gripe";
import { buildSatisfactionContext, wouldEvictFreshTenant } from "../engine/sim/satisfactionStep";
import { rentOf } from "../engine/econConfig";
import { isHotelKind } from "../engine/facilities";
import { isRentalKind } from "../engine/residentialRentals";

/**
 * Plain-language phrasing for the pre-notice "Main gripe" inspector line. Only
 * the drains WITHOUT a dedicated diagnostic line on the card are named here:
 * access ("not connected" / "too far"), the long-walk line (W1, office and rental
 * Apartment), and very-far lobby distance already have their own actionable
 * lines, and a relocation is a
 * life event, so those causes map to nothing and the gripe line stays off
 * (deferring to the dedicated line). Congestion, over-market rent, noise, and
 * unmet local retail demand (#395) have no such line, so they surface here.
 * Each string names the lever the player can pull.
 */
const GRIPE_TEXT: Partial<Record<VacateReason, string>> = {
  congestion: "crowded elevators. Add cars or a parallel shaft to this block.",
  rent: "the rent is above the going rate. Lower it to keep them.",
  // "noise" is resolved by noiseGripeText (the remedy differs by source); it stays
  // out of this table so a bare lookup can never return the wrong advice.
};

/** The "noise" gripe names the RIGHT remedy per source. The nightclub halo is
 *  cross-floor and a lobby tile NEVER shields it (it is keyed on floor distance),
 *  but it penalizes ONLY condos and hotels: an office feels no nightclub halo, so
 *  its "noise" is always an adjacent same-floor source and it takes the lobby-tile
 *  remedy regardless of any nearby club (recommending the player move an unrelated
 *  nightclub, and calling the office a "home", would both be wrong). For a condo or
 *  hotel with a club in halo range the club's relocation remedy holds even when the
 *  club also sits within same-floor range and makes the unit noiseAfflicted. */
function noiseGripeText(sim: Simulation, u: Unit): string {
  const adjacent = sim.noiseAfflicted(u); // a same-floor office/commercial source, lobby-shieldable
  // The Apartment joined the club's negative halo in D18, so it needs the club's
  // remedy too. Without it the copy printed the lobby-tile fix, which is the one
  // remedy that cannot work on a cross-floor halo (#684). The Studio stays out:
  // it is not in the halo, so a nearby club is not its cause.
  const club = (u.kind === "condo" || isHotelKind(u.kind) || u.kind === "rentalApartment") && nearNightclub(sim, u); // cross-floor halo, not shieldable
  if (adjacent && club) {
    // Both channels can be at work and either can be the binding cause, so present
    // both remedies rather than blaming one: a lobby tile shields the same-floor
    // source, and moving the nightclub (or the unit) addresses the cross-floor beat.
    return "a noisy neighbor and a nearby nightclub. A lobby tile between the same-floor source and this unit shields the neighbor; the nightclub's beat also carries between floors, so put more floors between it and this unit too.";
  }
  if (club) {
    return "a nightclub too close by. A lobby tile shields same-floor noise, but its beat also carries between floors; put more floors between this unit and the nightclub (move either one).";
  }
  return "a noisy neighbor. An office or commercial venue sits too close; a lobby tile between them shields it.";
}

/** The unmet-demand gripe (#395) names which of its causes actually holds,
 *  because the demand model is lobby-anchored and tower-uniform: a tenant that
 *  reaches NO retail while the tower has some needs a connection, while a
 *  tenant that reaches plenty of oversubscribed retail needs more venues built
 *  on any connected floor (a shop on floor 5 helps floor 82 exactly as much as
 *  one next door; the old single string prescribed "near this floor", a
 *  locality the model does not carry). Both gripe reads share one synchronous
 *  render, so `sim.demandMap()` here is a guaranteed memo hit on the same map
 *  `dominantGripe` just read, never a rescan. */
function unmetDemandGripeText(sim: Simulation, u: Unit, coverage?: number | null): string | undefined {
  // For an empty gate candidate the caller passes the CANDIDATE-aware coverage (the
  // unit is not an origin in the real memoized map, where this would read null and
  // mis-prescribe "add venues" for stranded retail). The occupied "Main gripe"
  // caller passes nothing and reads the shared memoized map, where the tenant IS an
  // origin.
  const cov = coverage !== undefined ? coverage : unmetCoverage(sim.demandMap(), u);
  if (cov === 0) {
    // Coverage 0 also covers a tenant whose OWN floor is unreachable: its people
    // can reach nothing however well the shops are wired, and that cause already
    // has the dedicated red "Access: no route" line, so the gripe
    // line stays silent for it (the defer-to-the-dedicated-line rule above)
    // instead of telling the player to fix retail that is not broken.
    if (!sim.floorReachable(u.floor)) return undefined;
    return "shops and restaurants exist, but none of them are reachable from here. Reconnect your retail: shoppers only patronize venues they can actually reach from the lobby.";
  }
  // Every other value the gripe can carry (coverage in (0, 0.5), or a null
  // read from a hand-built context) is the capacity shortfall: more retail,
  // anywhere connected, always helps a griping tower.
  return "too few shops and restaurants for the tower's crowds. Add venues on any connected floor: retail is shared tower-wide.";
}

/** The "Main gripe" line's text for an attributed cause, or undefined when the
 *  cause defers to a dedicated diagnostic line on the card. An explicit ladder
 *  so each case reads on its own (review nit on the former nested ternary). */
export function gripeLineText(
  sim: Simulation,
  u: Unit,
  gripe: VacateReason,
  unmetCov?: number | null,
): string | undefined {
  if (gripe === "unmetDemand") return unmetDemandGripeText(sim, u, unmetCov);
  if (gripe === "noise") return noiseGripeText(sim, u);
  return GRIPE_TEXT[gripe];
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
    !(u.kind === "office" || u.kind === "condo" || isRentalKind(u.kind)) ||
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
  // EXCEPT for rentals, which the engine excludes from the coverage drain on both
  // the live and gate paths (#661). The gate registers every probe as an origin,
  // rentals included, so computing the flag here would manufacture a true one for a
  // kind the sim never drains that way and blame a rental vacancy on "too few
  // shops". Mirroring the engine's coverage guard keeps the two in step.
  const coverageKind = !isRentalKind(u.kind);
  const cov = coverageKind && ctx.demandMap ? unmetCoverage(ctx.demandMap, u) : null;
  const unmetDrain = cov === null ? null : sim.rules.unmetDemandDrain(cov);
  const unmetActive = unmetDrain !== null && (unmetDrain.erosion > 0 || unmetDrain.cap < 1);
  const gripe = dominantGripe(sim, u, undefined, 0, undefined, undefined, undefined, unmetActive);
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
  const overhead = sim.rules.operatingOverheadPerUnit();
  const holdTax = u.kind === "condo" ? Math.ceil(rentOf(u) * sim.rules.condoHoldTaxRate()) : 0;
  const carry = overhead + holdTax;
  if (carry <= 0) return "";
  return ` It still costs about $${carry.toLocaleString()} a month to hold empty, so fix the cause or bulldoze it to stop the loss.`;
}
