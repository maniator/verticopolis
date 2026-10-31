import { html, type TemplateResult } from "lit-html";
import type { EnginePort, PortRecord } from "../simport/enginePort";
import { VACATE_REASON_TEXT, type VacateReason } from "../engine/types";

/**
 * Rust and TypeScript already answer unitFacts() with the same diagnostic
 * decisions. The inspector/editor need only turn those facts into copy; they
 * must not reconstruct a TypeScript Simulation to diagnose a Rust tower.
 *
 * These are presentation strings, not gameplay rules. Keep them aligned with
 * facilityDiagnostics/gripeCopy (the TypeScript card) until those two callers
 * can use a single shared facts-to-copy presenter.
 */
interface Layout {
  records: { unitFacts: string[] };
  accessLines: string[];
  noRateLines: string[];
  modes: string[];
  bindings: string[];
  vacateReasons: string[];
}

const bad = "var(--bad)";
const good = "var(--good)";
function line(copy: string, color?: string): TemplateResult {
  return color ? html`<div style="color:${color}">${copy}</div>` : html`<div>${copy}</div>`;
}

function lobbyFix(floor: number, sinking: boolean, onSlot: boolean, needsSupport: boolean, clearFirst: boolean): string {
  if (sinking) {
    if (onSlot) return `This unit sits on the empty sky lobby slot; move it, clear the story, and build the lobby on floor ${floor} to anchor the block.`;
    if (needsSupport) return `Build floors up to ${floor - 1}, then put the sky lobby on floor ${floor} to lift these tenants.`;
    if (clearFirst) return `Clear floor ${floor} and build the sky lobby there to lift these tenants.`;
    return `Build the sky lobby on floor ${floor} to lift these tenants.`;
  }
  if (onSlot) return "This unit sits on the sky lobby slot itself; a lobby here, once it moves and the story is cleared, would lift the block.";
  if (needsSupport) return `A sky lobby on floor ${floor} would lift it (build floors up to ${floor - 1} first; the slot story itself stays clear for the lobby).`;
  if (clearFirst) return `A sky lobby on floor ${floor} would lift it (clear that floor first).`;
  return `A sky lobby on floor ${floor} would lift it.`;
}

/** Create once per engine port, not once per hover or render frame. */
export function createPortUnitDiagnostics(port: Pick<EnginePort, "viewLayout" | "unitFacts">): (id: number) => TemplateResult[] {
  const layout = JSON.parse(port.viewLayout()) as Layout;
  const slots = new Map(layout.records.unitFacts.map((name, i) => [name, i]));
  const at = (r: PortRecord, name: string): number => r[slots.get(name) ?? -1];
  const named = (values: readonly string[], code: number): string | undefined =>
    Number.isSafeInteger(code) && code >= 0 ? values[code] : undefined;

  /** An engine-reported cause, rendered without recomputing any drain. */
  const gripe = (r: PortRecord, prefix: "gripe" | "leaseGripe"): string | undefined => {
    if (at(r, prefix) !== 1) return undefined;
    const cause = named(layout.vacateReasons, at(r, `${prefix}Cause`));
    if (cause === "rent") return "the rent is above the going rate. Lower it to keep them.";
    if (cause === "noise") {
      const adjacent = at(r, `${prefix}Adjacent`) === 1;
      const club = at(r, `${prefix}Club`) === 1;
      if (adjacent && club) {
        return "a noisy neighbor and a nearby nightclub. A lobby tile between the same-floor source and this unit shields the neighbor; the nightclub's beat also carries between floors, so put more floors between it and this unit too.";
      }
      if (club) {
        return "a nightclub too close by. A lobby tile shields same-floor noise, but its beat also carries between floors; put more floors between this unit and the nightclub (move either one).";
      }
      return "a noisy neighbor. An office or commercial venue sits too close; a lobby tile between them shields it.";
    }
    if (cause === "congestion") {
      const binding = named(layout.bindings, at(r, `${prefix}Binding`));
      const elevatorHere = at(r, `${prefix}ElevatorHere`) === 1;
      if (binding === "elevator") return "crowded elevators. Add cars or a parallel shaft to this block.";
      if (binding === "none") return "overcrowded vertical transport. Add capacity to this block.";
      if (binding === "walkways") {
        return elevatorHere
          ? "crowded stairs and escalators. They are jammed by the other floors they serve; give those floors better elevator service, or add more stairs and escalators."
          : "crowded stairs and escalators. Add more of them, or give this floor an elevator stop.";
      }
      if (binding === "stairs") {
        return elevatorHere
          ? "crowded stairs. They are jammed by the other floors they serve; give those floors better elevator service, or add another stair column."
          : "crowded stairs. Add another stair column, or give this floor an elevator stop.";
      }
      if (binding === "escalator") {
        return elevatorHere
          ? "crowded escalators. They are jammed by the other floors they serve; give those floors better elevator service, or add another escalator."
          : "crowded escalators. Add another escalator, or give this floor an elevator stop.";
      }
      return undefined; // Incomplete facts must never produce invented advice.
    }
    if (cause === "unmetDemand") {
      if (at(r, `${prefix}Coverage`) === 0) {
        return at(r, `${prefix}FloorReachable`) === 1
          ? "shops and restaurants exist, but none of them are reachable from here. Reconnect your retail: shoppers only patronize venues they can actually reach from the lobby."
          : undefined; // The access line already explains an unreachable floor.
      }
      return "too few shops and restaurants for the tower's crowds. Add venues on any connected floor: retail is shared tower-wide.";
    }
    // access, transportFar and lobbyFar have their own diagnostic lines.
    return undefined;
  };

  return (id: number): TemplateResult[] => {
    const r = port.unitFacts(id);
    if (r.length < layout.records.unitFacts.length || at(r, "id") !== id) return [];
    const out: TemplateResult[] = [];
    const access = named(layout.accessLines, at(r, "access"));
    if (access === "notConnected") out.push(line("Access: not connected. No elevator or stair reaches this floor.", bad));
    else if (access === "cutOff") out.push(line("Access: no way to transportation from here. A gap cuts this section of the floor off from the elevators and stairs. Bridge the gap, or add a stair or elevator that reaches this section.", bad));
    else if (access === "reachable") out.push(line("Access: reachable from the lobby.", good));
    else if (access === "noRoute") out.push(line("Access: no route. The only way to this floor is a stairway or escalator climb longer than anyone will make, so no one travels here. Add an elevator that reaches it.", bad));

    const rate = named(layout.noRateLines, at(r, "noRate"));
    if (rate === "occupied") out.push(line("No Rate: the tenant stays, pays nothing, and still counts toward stars."));
    else if (rate === "offMarket") out.push(line("Off the market: No Rate. No one moves in until you set a rate."));

    if (at(r, "farWalk") === 1) {
      out.push(line("Long walk to transport. Tenants tire of the hike. Put a stairway, escalator, or passenger elevator within reach.", bad));
    }
    if (at(r, "lobby") === 1) {
      const sinking = at(r, "sinking") === 1;
      const mode = named(layout.modes, at(r, "modeCode"));
      const distance = mode === "modern" ? `: ${at(r, "lobbyDistance")} floors` : "";
      const opening = sinking ? "Too far from any lobby" : "Far from the nearest lobby";
      if (at(r, "slot") !== 1) {
        out.push(line(sinking
          ? `${opening}${distance}. Satisfaction sinks until tenants give notice, and no closer sky lobby slot exists this high in the tower.`
          : `${opening}${distance}. Satisfaction is capped here, so it never tops out; no closer sky lobby slot exists this high in the tower.`,
        sinking ? bad : undefined));
      } else {
        const fix = lobbyFix(at(r, "slotFloor"), sinking, at(r, "onSlot") === 1, at(r, "needsSupport") === 1, at(r, "clearFirst") === 1);
        out.push(line(`${opening}${distance}. ${sinking ? "Satisfaction sinks until tenants give notice." : "Satisfaction is capped here, so it never tops out."} ${fix}`, bad));
      }
    }

    const main = gripe(r, "gripe");
    if (main) out.push(line(`Main gripe: ${main}`, bad));

    if (at(r, "wontLease") === 1) {
      const cause = gripe(r, "leaseGripe");
      const carry = at(r, "carry");
      const lead = cause
        ? `Won't lease: ${cause}`
        : "Won't lease: a new tenant here would soon give notice. Fix the flagged problem to fill it.";
      const cost = Number.isFinite(carry) && carry > 0
        ? ` It still costs about $${carry.toLocaleString()} a month to hold empty, so fix the cause or bulldoze it to stop the loss.`
        : "";
      out.push(line(lead + cost, bad));
    }

    if (at(r, "notice") === 1) {
      const reason = named(layout.vacateReasons, at(r, "noticeReason")) as VacateReason | undefined;
      const explanation = reason && VACATE_REASON_TEXT[reason];
      if (explanation) {
        const minutes = at(r, "minutesLeft");
        let left = "any moment now";
        if (minutes >= 1440) left = `in under ${Math.ceil(minutes / 1440)} day(s)`;
        else if (minutes > 0) left = `in under ${Math.ceil(minutes / 60)} hour(s)`;
        if (reason === "relocation") {
          out.push(line(`${explanation}. Leaves ${left}.`, bad));
          out.push(line("A life event, so you cannot keep them. You buy the unit back and re-list it (it re-sells once it is well placed)."));
        } else {
          out.push(line(`Giving notice: ${explanation}. Leaves ${left}.`, bad));
          out.push(line(`Fix the cause and get satisfaction to ${Math.round(at(r, "keepAt") * 100)}% to keep them (now ${Math.round(at(r, "noticeSatisfaction") * 100)}%).`));
        }
      }
    }
    return out;
  };
}
