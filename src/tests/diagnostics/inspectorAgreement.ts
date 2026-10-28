import type { Simulation } from "../../engine/Simulation";
import { VACATE_REASON_TEXT, type Unit } from "../../engine/types";
import { facilityDiagnostics } from "../../game/facilityDiagnostics";
import { gripeLineText } from "../../game/gripeCopy";
import type { DiagnosticFacts, GripeFacts, LobbyFacts, NoticeFacts } from "./tsDiagnosticFacts";

/** A lit template as text: its static parts with each value spliced in. */
function text(v: unknown): string {
  if (Array.isArray(v)) return v.map(text).join("");
  if (v && typeof v === "object" && "strings" in v && "values" in v) {
    const t = v as { strings: readonly string[]; values: readonly unknown[] };
    return t.strings.map((s, i) => s + (i < t.values.length ? text(t.values[i]) : "")).join("");
  }
  return v === null || v === undefined ? "" : String(v);
}

const ACCESS_LINE = {
  notConnected: "Access: not connected.",
  cutOff: "Access: no way to transportation from here.",
  reachable: "Access: reachable from the lobby.",
  noRoute: "Access: no route.",
} as const;

/** The opening of a cause's copy as the facts decide it, or undefined when
 *  the facts say the copy stays silent (unmet demand on a floor no rider
 *  reaches, which the access line already names). Causes with no facts to
 *  branch on read the copy itself. A congestion fact with no binding the copy
 *  knows gets a phrase no card prints, so the check flags it. */
function gripeOpening(sim: Simulation, u: Unit, g: GripeFacts): string | undefined {
  switch (g.cause) {
    case "congestion": {
      const jammed = g.elevatorHere ? " They are jammed by the other floors they serve" : "";
      if (g.binding === "elevator") return "crowded elevators.";
      if (g.binding === "none") return "overcrowded vertical transport.";
      if (g.binding === "walkways") return `crowded stairs and escalators.${jammed || " Add more of them"}`;
      if (g.binding === "stairs") return `crowded stairs.${jammed || " Add another stair column"}`;
      if (g.binding === "escalator") return `crowded escalators.${jammed || " Add another escalator"}`;
      return `(a congestion fact with binding ${String(g.binding)})`;
    }
    case "noise":
      if (g.adjacent && g.club) return "a noisy neighbor and a nearby nightclub.";
      if (g.club) return "a nightclub too close by.";
      return "a noisy neighbor. An office";
    case "unmetDemand":
      if (g.coverage === 0) return g.floorReachable ? "shops and restaurants exist, but none of them are reachable" : undefined;
      return "too few shops and restaurants";
    default:
      return gripeLineText(sim, u, g.cause);
  }
}

/** The sky lobby advice each slot case prints, in the sinking or capped band. */
function slotAdvice(lobby: LobbyFacts): string | undefined {
  const s = lobby.slot;
  if (!s) return undefined;
  if (lobby.sinking) {
    if (s.onSlot) return `sits on the empty sky lobby slot; move it, clear the story, and build the lobby on floor ${s.floor}`;
    if (s.needsSupport) return `Build floors up to ${s.floor - 1}, then put the sky lobby on floor ${s.floor}`;
    if (s.clearFirst) return `Clear floor ${s.floor} and build the sky lobby there`;
    return `Build the sky lobby on floor ${s.floor} to lift`;
  }
  if (s.onSlot) return "sits on the sky lobby slot itself";
  if (s.needsSupport) return `A sky lobby on floor ${s.floor} would lift it (build floors up to ${s.floor - 1} first`;
  if (s.clearFirst) return `A sky lobby on floor ${s.floor} would lift it (clear that floor first).`;
  return `A sky lobby on floor ${s.floor} would lift it.`;
}

/** The countdown the card prints for a notice's minutes left. */
function leaves(n: NoticeFacts): string {
  if (n.minutesLeft >= 24 * 60) return `in under ${Math.ceil(n.minutesLeft / (24 * 60))} day(s)`;
  if (n.minutesLeft > 0) return `in under ${Math.ceil(n.minutesLeft / 60)} hour(s)`;
  return "any moment now";
}

/**
 * Binds the facts reference (`tsDiagnosticFacts`) to the inspector it stands
 * for: the card `facilityDiagnostics` renders for the same unit, at the same
 * moment, must show each tenant line exactly when the facts carry its
 * section and the copy prints it (the "Main gripe" line stays silent for a
 * cause another line already names), and the copy each line prints must be
 * the one the facts' fields choose: the lobby distance and slot advice, the
 * gripe's binding, elevator stop, noise sources and coverage, the won't-lease
 * cause and carrying cost, the notice's countdown and percentages. Without
 * this, a gate or a copy branch that changes in the inspector would leave the
 * reference and the Rust getter agreeing with each other and not with the
 * card. Returns the disagreements, empty when there are none.
 */
export function inspectorDisagreements(sim: Simulation, u: Unit, f: DiagnosticFacts): string[] {
  const card = text(facilityDiagnostics(sim, u));
  const out: string[] = [];
  const shows = (what: string, expected: boolean, phrase: string) => {
    if (card.includes(phrase) !== expected) out.push(`${what}: the card ${expected ? "lacks" : "shows"} "${phrase}"`);
  };
  for (const [state, phrase] of Object.entries(ACCESS_LINE)) shows(`access ${state}`, f.access === state, phrase);
  shows("noRate occupied", f.noRate === "occupied", "No Rate: the tenant stays");
  shows("noRate offMarket", f.noRate === "offMarket", "Off the market: No Rate.");
  shows("farWalk", f.farWalk === true, "Long walk to transport.");
  shows("lobby sinking", f.lobby?.sinking === true, "Too far from any lobby");
  shows("lobby capped", f.lobby !== undefined && !f.lobby.sinking, "Far from the nearest lobby");
  shows("lobby slot", f.lobby !== undefined && f.lobby.slot === null, "no closer sky lobby slot exists");
  if (f.lobby) {
    const modern = sim.rules.mode === "modern";
    const lead = f.lobby.sinking ? "Too far from any lobby" : "Far from the nearest lobby";
    shows("lobby distance", true, modern ? `${lead}: ${f.lobby.distance} floors.` : `${lead}.`);
    const advice = slotAdvice(f.lobby);
    if (advice) shows("lobby slot advice", true, advice);
  }
  const gripeLine = f.gripe ? gripeOpening(sim, u, f.gripe) : undefined;
  if (gripeLine) shows("gripe", true, `Main gripe: ${gripeLine}`);
  else shows("gripe", false, "Main gripe:");
  shows("wontLease", f.wontLease !== undefined, "Won't lease:");
  if (f.wontLease) {
    const g = f.wontLease.gripe;
    const cause = g ? gripeOpening(sim, u, g) : undefined;
    shows("wontLease cause", true, cause ? `Won't lease: ${cause}` : "Won't lease: a new tenant here would soon give notice.");
    // Formatted as `carryingCostNote` formats it, so the two agree in any locale.
    const carry = f.wontLease.carry;
    shows("wontLease carry", carry > 0, carry > 0 ? `It still costs about $${carry.toLocaleString()} a month to hold empty` : "a month to hold empty");
  }
  if (f.notice) {
    shows("notice", true, `${VACATE_REASON_TEXT[f.notice.reason]}. Leaves ${leaves(f.notice)}.`);
    const keep = `to ${Math.round(f.notice.keepAt * 100)}% to keep them (now ${Math.round(f.notice.satisfaction * 100)}%)`;
    shows("notice keep", f.notice.reason !== "relocation", keep);
  } else {
    shows("notice", false, ". Leaves ");
  }
  return out;
}
