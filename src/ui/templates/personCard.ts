import { html, type TemplateResult } from "lit-html";
import { keyed } from "lit-html/directives/keyed.js";
import { catalogFacility, type Catalog } from "../../catalog/catalogTypes";
import { isHotelKind } from "../../presentation/viewKinds";
import type { FacilityKind } from "../../shared/types";
import type { PersonDetail, ShiftStep, TripPlace } from "../../simport/personCards";
import { floorTag } from "../format";

/**
 * The person card (#2092): who a walking person is, why they are out, where
 * the leg they are on began and where it ends, what they are doing and how
 * long they have waited. A pure function of the card the engine answered;
 * the words are the frontend's. It shares the editor card's window (title
 * bar, ✕, drag), so a phone shows it docked like any other card.
 */

/** How a person feels about their wait, as their figure shows it. */
export type PersonMood = "content" | "impatient" | "fedUp";

export interface PersonCardInput {
  /** The last card the engine answered. */
  person: PersonDetail;
  /** True once the engine no longer knows them: they reached the end of
   *  their trip and went inside, or walked out of the tower. `person` is
   *  then the last card it answered, which says which (`goneWords`). */
  gone: boolean;
  catalog: Catalog;
  /** The kind of `person.shaftId`, when it still stands. */
  shaftKind: FacilityKind | null;
  mood: PersonMood;
  following: boolean;
}

/** The edit actions the card's buttons send. */
export const PERSON_FOLLOW_ACTION = "person:follow";

const MOOD_WORDS: Readonly<Record<PersonMood, string>> = {
  content: "Calm",
  impatient: "Getting impatient",
  fedUp: "Fed up",
};

const SHIFT_WORDS: Readonly<Record<ShiftStep, string>> = {
  in: "Arriving for a shift",
  base: "Waiting for a room to clean",
  job: "Cleaning hotel rooms",
  free: "Between rooms",
  home: "Heading back to the housekeeping room",
  out: "Going home after the shift",
};

const isHome = (kind: FacilityKind): boolean => kind === "condo" || kind === "rentalStudio" || kind === "rentalApartment";

/** The kind of the room a person belongs to, when the trip names it. */
function ownRoom(p: PersonDetail): FacilityKind | null {
  // An outing heads back to their own room, and coming home or in to work
  // ends at it; every other trip starts there.
  const endsAtOwn = (p.returning && (p.purpose === "meal" || p.purpose === "visit")) || p.purpose === "returnHome" || p.purpose === "toWork";
  const own = endsAtOwn ? p.to : p.from;
  return own.place === "room" ? own.kind : null;
}

/** The card's title: the person's role. A future Modern name takes this slot. */
export function personRole(p: PersonDetail): string {
  if (p.staff) return "Housekeeper";
  if (p.purpose === "schoolRun") return "Parent";
  const own = ownRoom(p);
  if (own === "office") return "Office worker";
  if (own && isHotelKind(own)) return "Hotel guest";
  if (own && isHome(own)) return "Resident";
  switch (p.purpose) {
    case "toWork":
    case "fromWork":
    case "salesCall":
      return "Office worker";
    case "leaveHome":
    case "returnHome":
      return "Resident";
    default:
      return "Visitor";
  }
}

/** Why they are out. */
export function personWhy(p: PersonDetail): string {
  switch (p.purpose) {
    case "toWork":
      return "Coming in to work";
    case "fromWork":
      return "Heading home from work";
    case "leaveHome":
      return "Heading out for the day";
    case "returnHome":
      return "Coming home";
    case "toVenue":
      return "Coming in to shop or eat";
    case "fromVenue":
      return "Leaving after a visit";
    case "meal":
      return p.returning ? "Heading back after a meal" : "Going out to eat";
    case "visit":
      return p.returning ? "Heading back after a visit" : "Going out for a visit";
    case "schoolRun":
      return p.from.place === "room" ? "Taking the kids to school" : "Back from the school run";
    case "salesCall":
      return "Off on a sales call";
    case "housekeeping":
      return p.shift ? SHIFT_WORDS[p.shift] : "On shift";
    default:
      return "Out and about";
  }
}

/** One end of the leg in words. */
export function placeWords(t: TripPlace, catalog: Catalog): string {
  switch (t.place) {
    case "room":
      return `${catalogFacility(catalog, t.kind).name}, floor ${floorTag(t.floor)}`;
    case "floor":
      return `Floor ${floorTag(t.floor)}`;
    case "lobby":
      return t.floor === 1 ? "Outside, through the lobby" : `Sky lobby, floor ${floorTag(t.floor)}`;
    case "metro":
      return "Outside, by Metro";
    default:
      return "—";
  }
}

/** What they are doing this moment. */
export function personNow(p: PersonDetail, shaftName: string | null): string {
  const shaft = shaftName ? `the ${shaftName}` : null;
  switch (p.state) {
    case "toShaft":
      return shaft ? `Walking to ${shaft}` : "Walking";
    case "waiting":
      return shaft ? `Waiting for ${shaft}` : "Waiting";
    case "riding":
      return shaft ? `Riding ${shaft}` : "Riding";
    case "climbing":
      return shaft ? `Taking ${shaft}` : "Climbing";
    case "dwelling":
      if (p.staff) return "Cleaning a room";
      return p.purpose === "meal" ? "Eating" : "Staying a while";
    case "done":
      return "Leaving the tower";
    default:
      return "Walking";
  }
}

/** What became of someone the engine has let go, from the last card it
 *  answered: the Now row and the note under it. A trip ends where the
 *  person stood, so the end on their floor is where they went. Reaching a
 *  room or a floor means they went inside; only the ground lobby and the
 *  Metro lead out of the tower. Someone who turned back went back to where
 *  they set out from. */
export function goneWords(p: PersonDetail, catalog: Catalog): { now: string; note: string } {
  const left = { now: "Left the tower", note: "They left the tower." };
  const onFloor = (t: TripPlace): boolean => t.place !== "none" && t.floor === p.floor;
  const leadsOut = (t: TripPlace): boolean => t.place === "metro" || (t.place === "lobby" && t.floor === 1);
  if (onFloor(p.to)) {
    if (leadsOut(p.to)) return left;
    return { now: p.to.place === "room" ? "Went inside" : "Arrived", note: `They reached ${placeWords(p.to, catalog)}.` };
  }
  if (onFloor(p.from) && !leadsOut(p.from)) {
    return { now: "Went back", note: `They went back to ${placeWords(p.from, catalog)}.` };
  }
  return left;
}

const kv = (label: string, value: string, field: string): TemplateResult =>
  html`<span class="k">${label}</span><span class="v" data-field=${field}>${value}</span>`;

export function personCardTemplate(input: PersonCardInput): TemplateResult {
  const { person: p, catalog, gone } = input;
  const shaftName = input.shaftKind ? catalogFacility(catalog, input.shaftKind).name : null;
  const end = gone ? goneWords(p, catalog) : null;
  const rows = [
    kv("Why", personWhy(p), "why"),
    kv(p.staff ? "Works from" : "From", placeWords(p.from, catalog), "from"),
    kv(p.staff ? "Heading to" : "To", placeWords(p.to, catalog), "to"),
    kv("Now", end ? end.now : personNow(p, shaftName), "now"),
    kv("Waited", `${Math.round(p.tripWaitMinutes)} min this trip`, "waited"),
    kv("Mood", MOOD_WORDS[input.mood], "mood"),
  ];
  const follow = end
    ? html`<div class="ed-row"><span class="ed-note" data-field="gone">${end.note}</span></div>`
    : html`<div class="ed-row">
        <button type="button" class="btn" data-edit=${PERSON_FOLLOW_ACTION}>
          ${input.following ? "Stop following" : "Follow"}
        </button>
      </div>`;
  return html`${keyed(
    `person:${p.id}`,
    html`<h4 class="win-title">${personRole(p)}<button type="button" class="ed-close btn xs" aria-label="Close">✕</button></h4>
      <div class="ed-stats kv">${rows}</div>
      ${follow}`,
  )}`;
}
