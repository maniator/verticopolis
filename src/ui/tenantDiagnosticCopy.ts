import type { VacateReason } from "@verticopolis/components/shared/types";
import { VACATE_REASON_TEXT } from "@verticopolis/components/shared/vacateReasonText";
import { floorLabel } from "./floorLabel";
import { groupDigits } from "@verticopolis/components/windows/format";

/**
 * Player-facing language for facts already decided by the active engine.
 * This module has no Simulation, engine rules, or queries. Both the legacy
 * TypeScript card and the Rust port adapter use these copy functions.
 *
 * `advises` is the catalog's `rules.advisesFixes` (#549): Modern says what to
 * do about a problem as well as what it is, and Classic names the cause only,
 * the way the 1994 game's inspector did.
 */
export interface GripeCopyFacts {
  cause: string;
  /** The catalog's `rules.advisesFixes`: add what to do about it. */
  advises: boolean;
  binding?: string;
  elevatorHere?: boolean;
  adjacent?: boolean;
  club?: boolean;
  coverage?: number | null;
  floorReachable?: boolean;
  /** With an elevator binding: the passenger elevator stopping here with the
   *  most room for cars, or absent when every one is full (#2251). */
  roomyShaft?: RoomyShaftCopy;
}

/** A shaft that can take more cars, as the advice names it. */
export interface RoomyShaftCopy {
  name: string;
  bottom: number;
  top: number;
  cars: number;
  maxCars: number;
}

/** Elevator congestion advice: cars on a shaft with room come first, since a
 *  car is cheaper than a shaft and needs no new column (#2251). */
function crowdedElevatorCopy(s: RoomyShaftCopy | undefined): string {
  if (!s)
    return "crowded elevators. Every elevator stopping here already runs all its cars; add a parallel shaft to this block.";
  const floors = `${floorLabel(s.bottom)}–${floorLabel(s.top)}`;
  return `crowded elevators. The ${s.name.toLowerCase()} on floors ${floors} runs ${s.cars} of ${s.maxCars} cars; add cars to it before building a parallel shaft.`;
}

/** A service coverage (0 to 1) as a whole percent, or "too little" when the
 *  engine sent none (an absent slot decodes as NaN). */
function shareOf(coverage: number | null | undefined): string {
  return typeof coverage === "number" && Number.isFinite(coverage) ? `${Math.floor(coverage * 100)}%` : "too little";
}

export function gripeCopy(f: GripeCopyFacts): string | undefined {
  /** The cause alone in Classic; the cause and its fix in Modern. */
  const said = (cause: string, withFix: string): string => (f.advises ? withFix : cause);
  if (f.cause === "rent")
    return said("the rent is above the going rate.", "the rent is above the going rate. Lower it to keep them.");
  if (f.cause === "noise") {
    if (f.adjacent && f.club) {
      return said(
        "a noisy neighbor and a nearby nightclub.",
        "a noisy neighbor and a nearby nightclub. A lobby tile between the same-floor source and this unit shields the neighbor; the nightclub's beat also carries between floors, so put more floors between it and this unit too.",
      );
    }
    if (f.club) {
      return said(
        "a nightclub too close by.",
        "a nightclub too close by. A lobby tile shields same-floor noise, but its beat also carries between floors; put more floors between this unit and the nightclub (move either one).",
      );
    }
    return said(
      "a noisy neighbor. An office or commercial venue sits too close.",
      "a noisy neighbor. An office or commercial venue sits too close; a lobby tile between them shields it.",
    );
  }
  if (f.cause === "congestion") {
    if (f.binding === "elevator") return said("crowded elevators.", crowdedElevatorCopy(f.roomyShaft));
    if (f.binding === "none")
      return said("overcrowded vertical transport.", "overcrowded vertical transport. Add capacity to this block.");
    if (f.binding === "walkways") {
      return f.elevatorHere
        ? said(
            "crowded stairs and escalators, jammed by the other floors they serve.",
            "crowded stairs and escalators. They are jammed by the other floors they serve; give those floors better elevator service, or add more stairs and escalators.",
          )
        : said(
            "crowded stairs and escalators.",
            "crowded stairs and escalators. Add more of them, or give this floor an elevator stop.",
          );
    }
    if (f.binding === "stairs") {
      return f.elevatorHere
        ? said(
            "crowded stairs, jammed by the other floors they serve.",
            "crowded stairs. They are jammed by the other floors they serve; give those floors better elevator service, or add another stair column.",
          )
        : said("crowded stairs.", "crowded stairs. Add another stair column, or give this floor an elevator stop.");
    }
    if (f.binding === "escalator") {
      return f.elevatorHere
        ? said(
            "crowded escalators, jammed by the other floors they serve.",
            "crowded escalators. They are jammed by the other floors they serve; give those floors better elevator service, or add another escalator.",
          )
        : said(
            "crowded escalators.",
            "crowded escalators. Add another escalator, or give this floor an elevator stop.",
          );
    }
    return undefined;
  }
  if (f.cause === "unmetDemand") {
    if (f.coverage === 0) {
      return f.floorReachable
        ? said(
            "shops and restaurants exist, but none of them are reachable from here.",
            "shops and restaurants exist, but none of them are reachable from here. Reconnect your retail: shoppers only patronize venues they can actually reach from the lobby.",
          )
        : undefined;
    }
    return said(
      "too few shops and restaurants for the tower's crowds.",
      "too few shops and restaurants for the tower's crowds. Add venues on any connected floor: retail is shared tower-wide.",
    );
  }
  if (f.cause === "trash") {
    const cause = `trash piling up: recycling handles ${shareOf(f.coverage)} of the tower.`;
    return said(cause, `${cause} Build another Recycling Center.`);
  }
  const parkingFix = "Add parking spaces chained to a ramp; basements can run wider than the tower above.";
  if (f.cause === "homeParking") {
    const cause = `too little parking: the spaces left after hotel suites cover ${shareOf(f.coverage)} of what offices and homes need.`;
    return said(cause, `${cause} ${parkingFix}`);
  }
  if (f.cause === "parking") {
    const cause = `too little parking: the spaces left after hotel suites cover ${shareOf(f.coverage)} of the office workers.`;
    return said(cause, `${cause} ${parkingFix}`);
  }
  // Access, long walk and lobby distance use dedicated diagnostic lines.
  return undefined;
}

export function lobbyFixCopy(
  floor: number,
  sinking: boolean,
  onSlot: boolean,
  needsSupport: boolean,
  clearFirst: boolean,
): string {
  if (sinking) {
    if (onSlot)
      return `This unit sits on the empty sky lobby slot; move it, clear the story, and build the lobby on floor ${floor} to anchor the block.`;
    if (needsSupport)
      return `Build floors up to ${floor - 1}, then put the sky lobby on floor ${floor} to lift these tenants.`;
    if (clearFirst) return `Clear floor ${floor} and build the sky lobby there to lift these tenants.`;
    return `Build the sky lobby on floor ${floor} to lift these tenants.`;
  }
  if (onSlot)
    return "This unit sits on the sky lobby slot itself; a lobby here, once it moves and the story is cleared, would lift the block.";
  if (needsSupport)
    return `A sky lobby on floor ${floor} would lift it (build floors up to ${floor - 1} first; the slot story itself stays clear for the lobby).`;
  if (clearFirst) return `A sky lobby on floor ${floor} would lift it (clear that floor first).`;
  return `A sky lobby on floor ${floor} would lift it.`;
}

export function lobbyWarningCopy(f: {
  sinking: boolean;
  /** The catalog's `rules.advisesFixes`: add where a sky lobby would help. */
  advises: boolean;
  /** The catalog's `rules.quotesLobbyDistance`. */
  quotesDistance: boolean;
  distance: number;
  slotFloor?: number;
  onSlot?: boolean;
  needsSupport?: boolean;
  clearFirst?: boolean;
}): string {
  const distance = f.quotesDistance ? `: ${f.distance} floors` : "";
  const opening = f.sinking ? "Too far from any lobby" : "Far from the nearest lobby";
  const effect = f.sinking
    ? "Satisfaction sinks until tenants give notice."
    : "Satisfaction is capped here, so it never tops out.";
  if (!f.advises) return `${opening}${distance}. ${effect}`;
  if (f.slotFloor === undefined) {
    return f.sinking
      ? `${opening}${distance}. Satisfaction sinks until tenants give notice, and no closer sky lobby slot exists this high in the tower.`
      : `${opening}${distance}. Satisfaction is capped here, so it never tops out; no closer sky lobby slot exists this high in the tower.`;
  }
  const fix = lobbyFixCopy(f.slotFloor, f.sinking, Boolean(f.onSlot), Boolean(f.needsSupport), Boolean(f.clearFirst));
  return `${opening}${distance}. ${effect} ${fix}`;
}

/** `advises` is the catalog's `rules.advisesFixes`: add what to do about it. */
export function accessCopy(state: string, advises: boolean): { text: string; bad: boolean } | undefined {
  const said = (cause: string, fix: string): string => (advises ? `${cause} ${fix}` : cause);
  switch (state) {
    case "notConnected":
      return { text: "Access: not connected. No elevator or stair reaches this floor.", bad: true };
    case "cutOff":
      return {
        text: said(
          "Access: no way to transportation from here. A gap cuts this section of the floor off from the elevators and stairs.",
          "Bridge the gap, or add a stair or elevator that reaches this section.",
        ),
        bad: true,
      };
    case "reachable":
      return { text: "Access: reachable from the lobby.", bad: false };
    case "noRoute":
      return {
        text: said(
          "Access: no route. The only way to this floor is a stairway or escalator climb longer than anyone will make, so no one travels here.",
          "Add an elevator that reaches it.",
        ),
        bad: true,
      };
    default:
      return undefined;
  }
}

export function noRateCopy(state: string): string | undefined {
  if (state === "occupied") return "No Rate: the tenant stays, pays nothing, and still counts toward stars.";
  if (state === "offMarket") return "Off the market: No Rate. No one moves in until you set a rate.";
  return undefined;
}

/** The long-walk line; `advises` is the catalog's `rules.advisesFixes`. */
export function farWalkCopy(advises: boolean): string {
  const cause = "Long walk to transport. Tenants tire of the hike.";
  return advises ? `${cause} Put a stairway, escalator, or passenger elevator within reach.` : cause;
}

/** `advises` is the catalog's `rules.advisesFixes`: add what to do about it. */
export function wontLeaseCopy(cause: string | undefined, carry: number, advises: boolean): string {
  const unknown = "Won't lease: a new tenant here would soon give notice.";
  let lead = cause ? `Won't lease: ${cause}` : unknown;
  if (!cause && advises) lead += " Fix the flagged problem to fill it.";
  if (!(Number.isFinite(carry) && carry > 0)) return lead;
  const held = ` It still costs about $${groupDigits(carry)} a month to hold empty`;
  return lead + (advises ? `${held}, so fix the cause or bulldoze it to stop the loss.` : `${held}.`);
}

export function noticeCopy(f: {
  reason: VacateReason;
  /** The catalog's `rules.advisesFixes`: tell the player to fix the cause. */
  advises: boolean;
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
    f.advises
      ? `Fix the cause and get satisfaction to ${Math.round(f.keepAt * 100)}% to keep them (now ${Math.round(f.satisfaction * 100)}%).`
      : `They stay if satisfaction reaches ${Math.round(f.keepAt * 100)}% (now ${Math.round(f.satisfaction * 100)}%).`,
  ];
}

/** The amenity line (#1980): `name` is the venue whose halo lifts this room
 *  most (the catalog's name), `lift` how far it raises the ceiling a capped
 *  room is held to, from 0 to 1. */
export function amenityCopy(name: string, lift: number): string {
  return `Helped by a nearby ${name.toLowerCase()}: when noise, a far lobby or too few shops hold this room back, it can still be up to ${Math.round(lift * 100)}% happier.`;
}
