import type { Simulation } from "../engine/Simulation";
import type { Unit, VacateReason } from "../engine/types";
import { unmetCoverage } from "../engine/sim/gripe";

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
  noise: "a noisy neighbor. An office or commercial venue sits too close; a lobby tile between them shields it.",
};

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
  return GRIPE_TEXT[gripe];
}
