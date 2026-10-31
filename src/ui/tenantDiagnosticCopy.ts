import type { VacateReason } from "../engine/types";
import { VACATE_REASON_TEXT } from "../shared/vacateReasonText";

/**
 * Player-facing language for facts already decided by the active engine.
 * This module has no Simulation, engine rules, or queries. Both the legacy
 * TypeScript card and the Rust port adapter use these copy functions.
 */
export interface GripeCopyFacts {
  cause: string;
  binding?: string;
  elevatorHere?: boolean;
  adjacent?: boolean;
  club?: boolean;
  coverage?: number | null;
  floorReachable?: boolean;
}

export function gripeCopy(f: GripeCopyFacts): string | undefined {
  if (f.cause === "rent") return "the rent is above the going rate. Lower it to keep them.";
  if (f.cause === "noise") {
    if (f.adjacent && f.club) {
      return "a noisy neighbor and a nearby nightclub. A lobby tile between the same-floor source and this unit shields the neighbor; the nightclub's beat also carries between floors, so put more floors between it and this unit too.";
    }
    if (f.club) {
      return "a nightclub too close by. A lobby tile shields same-floor noise, but its beat also carries between floors; put more floors between this unit and the nightclub (move either one).";
    }
    return "a noisy neighbor. An office or commercial venue sits too close; a lobby tile between them shields it.";
  }
  if (f.cause === "congestion") {
    if (f.binding === "elevator") return "crowded elevators. Add cars or a parallel shaft to this block.";
    if (f.binding === "none") return "overcrowded vertical transport. Add capacity to this block.";
    if (f.binding === "walkways") {
      return f.elevatorHere
        ? "crowded stairs and escalators. They are jammed by the other floors they serve; give those floors better elevator service, or add more stairs and escalators."
        : "crowded stairs and escalators. Add more of them, or give this floor an elevator stop.";
    }
    if (f.binding === "stairs") {
      return f.elevatorHere
        ? "crowded stairs. They are jammed by the other floors they serve; give those floors better elevator service, or add another stair column."
        : "crowded stairs. Add another stair column, or give this floor an elevator stop.";
    }
    if (f.binding === "escalator") {
      return f.elevatorHere
        ? "crowded escalators. They are jammed by the other floors they serve; give those floors better elevator service, or add another escalator."
        : "crowded escalators. Add another escalator, or give this floor an elevator stop.";
    }
    return undefined;
  }
  if (f.cause === "unmetDemand") {
    if (f.coverage === 0) {
      return f.floorReachable
        ? "shops and restaurants exist, but none of them are reachable from here. Reconnect your retail: shoppers only patronize venues they can actually reach from the lobby."
        : undefined;
    }
    return "too few shops and restaurants for the tower's crowds. Add venues on any connected floor: retail is shared tower-wide.";
  }
  // Access, long walk and lobby distance use dedicated diagnostic lines.
  return undefined;
}

export function lobbyFixCopy(floor: number, sinking: boolean, onSlot: boolean, needsSupport: boolean, clearFirst: boolean): string {
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

export function lobbyWarningCopy(f: {
  sinking: boolean;
  mode: string;
  distance: number;
  slotFloor?: number;
  onSlot?: boolean;
  needsSupport?: boolean;
  clearFirst?: boolean;
}): string {
  const distance = f.mode === "modern" ? `: ${f.distance} floors` : "";
  const opening = f.sinking ? "Too far from any lobby" : "Far from the nearest lobby";
  if (f.slotFloor === undefined) {
    return f.sinking
      ? `${opening}${distance}. Satisfaction sinks until tenants give notice, and no closer sky lobby slot exists this high in the tower.`
      : `${opening}${distance}. Satisfaction is capped here, so it never tops out; no closer sky lobby slot exists this high in the tower.`;
  }
  const fix = lobbyFixCopy(f.slotFloor, f.sinking, Boolean(f.onSlot), Boolean(f.needsSupport), Boolean(f.clearFirst));
  return `${opening}${distance}. ${f.sinking ? "Satisfaction sinks until tenants give notice." : "Satisfaction is capped here, so it never tops out."} ${fix}`;
}

export function accessCopy(state: string): { text: string; bad: boolean } | undefined {
  switch (state) {
    case "notConnected": return { text: "Access: not connected. No elevator or stair reaches this floor.", bad: true };
    case "cutOff": return { text: "Access: no way to transportation from here. A gap cuts this section of the floor off from the elevators and stairs. Bridge the gap, or add a stair or elevator that reaches this section.", bad: true };
    case "reachable": return { text: "Access: reachable from the lobby.", bad: false };
    case "noRoute": return { text: "Access: no route. The only way to this floor is a stairway or escalator climb longer than anyone will make, so no one travels here. Add an elevator that reaches it.", bad: true };
    default: return undefined;
  }
}

export function noRateCopy(state: string): string | undefined {
  if (state === "occupied") return "No Rate: the tenant stays, pays nothing, and still counts toward stars.";
  if (state === "offMarket") return "Off the market: No Rate. No one moves in until you set a rate.";
  return undefined;
}

export const FAR_WALK_COPY = "Long walk to transport. Tenants tire of the hike. Put a stairway, escalator, or passenger elevator within reach.";

export function wontLeaseCopy(cause: string | undefined, carry: number): string {
  const lead = cause
    ? `Won't lease: ${cause}`
    : "Won't lease: a new tenant here would soon give notice. Fix the flagged problem to fill it.";
  const cost = Number.isFinite(carry) && carry > 0
    ? ` It still costs about $${carry.toLocaleString()} a month to hold empty, so fix the cause or bulldoze it to stop the loss.`
    : "";
  return lead + cost;
}

export function noticeCopy(f: {
  reason: VacateReason;
  minutesLeft: number;
  satisfaction: number;
  keepAt: number;
}): string[] {
  const reason = VACATE_REASON_TEXT[f.reason];
  let left = "any moment now";
  if (f.minutesLeft >= 1440) left = `in under ${Math.ceil(f.minutesLeft / 1440)} day(s)`;
  else if (f.minutesLeft > 0) left = `in under ${Math.ceil(f.minutesLeft / 60)} hour(s)`;
  if (f.reason === "relocation") {
    return [
      `${reason}. Leaves ${left}.`,
      "A life event, so you cannot keep them. You buy the unit back and re-list it (it re-sells once it is well placed).",
    ];
  }
  return [
    `Giving notice: ${reason}. Leaves ${left}.`,
    `Fix the cause and get satisfaction to ${Math.round(f.keepAt * 100)}% to keep them (now ${Math.round(f.satisfaction * 100)}%).`,
  ];
}
