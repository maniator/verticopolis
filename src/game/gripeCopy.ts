import type { Simulation } from "../engine/Simulation";
import type { Unit, VacateReason } from "../engine/types";
import { unmetCoverage, dominantGripe } from "../engine/sim/gripe";
import { buildSatisfactionContext, wouldEvictFreshTenant } from "../engine/sim/satisfactionStep";
import { rentOf } from "../engine/econConfig";

/**
 * Plain-language phrasing for the pre-notice "Main gripe" inspector line. Only
 * the drains WITHOUT a dedicated diagnostic line on the card are named here:
 * access ("not connected" / "too far"), the office long-walk (W1), and very-far
 * lobby distance already have their own actionable lines, and a relocation is a
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

/** The "noise" gripe names the RIGHT remedy per source. `dominantGripe` attributes
 *  an adjacent office/commercial source (`noiseAfflicted`) BEFORE the cross-floor
 *  nightclub halo, so when the unit is not noise-afflicted the "noise" cause is the
 *  nightclub thump, which is keyed on floor distance and a lobby tile does NOT
 *  shield. Naming the lobby-tile fix there would send the player on a fix that
 *  never restores leasing. */
function noiseGripeText(sim: Simulation, u: Unit): string {
  return sim.noiseAfflicted(u)
    ? "a noisy neighbor. An office or commercial venue sits too close; a lobby tile between them shields it."
    : "a nightclub too close by. Its noise carries between floors, so a lobby tile will not block it; move the nightclub or the home to put more floors between them.";
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
function unmetDemandGripeText(sim: Simulation, u: Unit): string | undefined {
  if (unmetCoverage(sim.demandMap(), u) === 0) {
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
export function gripeLineText(sim: Simulation, u: Unit, gripe: VacateReason): string | undefined {
  if (gripe === "unmetDemand") return unmetDemandGripeText(sim, u);
  if (gripe === "noise") return noiseGripeText(sim, u);
  return GRIPE_TEXT[gripe];
}

/**
 * The inspector's "Won't lease" line for an EMPTY, on-market, reachable
 * condo/office the move-in sustainability gate holds vacant (a fresh tenant here
 * would erode below the leave bar and give notice again), or null when the unit
 * would fill. The empty-unit mirror of the "Main gripe" line: it names WHY no one
 * leases the spot so a perpetual vacancy reads as an actionable placement problem
 * instead of a mystery. Like "Main gripe" it spells out only the causes WITHOUT a
 * dedicated diagnostic line (congestion, over-market rent, noise, unmet demand);
 * access, the office long-walk, and very-far lobby distance keep their own
 * actionable lines on the card, so for those the line just says a tenant would
 * give notice and points to the flagged problem. Gated on the SAME predicate
 * `attemptMoveIns` uses, so the card and the move-in decision can never disagree;
 * unreachable and off-market units are excluded (their own lines tell that
 * story), matching the engine, which never reaches the gate for them.
 */
export function wontLeaseText(sim: Simulation, u: Unit): string | null {
  if (
    !(u.kind === "office" || u.kind === "condo") ||
    u.state !== "empty" ||
    u.noRate ||
    !sim.tower.isFloorServed(u.floor) ||
    !sim.floorReachable(u.floor) ||
    !wouldEvictFreshTenant(sim, u, buildSatisfactionContext(sim, true))
  ) {
    return null;
  }
  // Name the cause the GATE actually held the spot for, which excludes congestion
  // (the gate context neutralizes it). Passing cong = 0 to dominantGripe skips the
  // congestion tier so the line never tells the player to "add cars" when adding
  // cars would not fill the spot; the structural cause the neutralized gate caught
  // (noise, far walk, lobby distance, rent, unmet demand) wins instead.
  const gripe = dominantGripe(sim, u, undefined, 0);
  const text = gripe ? gripeLineText(sim, u, gripe) : undefined;
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
