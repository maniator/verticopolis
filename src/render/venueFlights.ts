/**
 * Which stairways and escalators wind (party findings
 * `_bmad-output/party-mode/venue-flights-party-findings-2026-11-14.md`).
 *
 * In Modern, a one-story flight that stands right beside a venue (a cinema, a
 * party hall, the metro station or an aquatic center) is drawn as a spiral
 * staircase or a switchback escalator, the look a flight out of a tall lobby
 * already has. The catalog says whether the mode draws it
 * (`rules.venueFlights`); Classic draws every one-story flight straight, as
 * SimTower did.
 *
 * This is drawing only. The flight links the same two floors, takes the same
 * slot in the flight pool and counts the same against the walk limit, and
 * nothing about it is saved: the look follows from the flight and the rooms
 * beside it, so it changes the moment a venue is built or bulldozed.
 */
import type { FacilityKind } from "../shared/types";
import type { TransportView, UnitView } from "../simport/view";

/** The venues a flight winds beside: the halls a crowd arrives at. The
 *  recycling center is two stories as well, but it is back of house. Art
 *  direction, like a facility's color; how tall each one is comes from the
 *  catalog. */
const VENUE_KINDS: ReadonlySet<FacilityKind> = new Set<FacilityKind>(["cinema", "partyHall", "metro", "aquaticCenter"]);

/** Whether a room of `kind` is a venue a flight winds beside. */
export function isVenue(kind: FacilityKind): boolean {
  return VENUE_KINDS.has(kind);
}

/** The wall-to-wall extent of one venue: its stories and its columns. */
export interface VenueBox {
  /** Its bottom story. */
  readonly floor: number;
  /** Its top story. */
  readonly top: number;
  /** Its left column. */
  readonly x: number;
  /** One past its right column. */
  readonly right: number;
}

/** The box `u` fills, `stories` high. */
export function venueBox(u: Pick<UnitView, "floor" | "x" | "width">, stories: number): VenueBox {
  return { floor: u.floor, top: u.floor + stories - 1, x: u.x, right: u.x + u.width };
}

type Flight = Pick<TransportView, "kind" | "x" | "width" | "bottom" | "top">;

/** Whether `t` is a one-story stairway or escalator standing beside `v`: it
 *  touches the venue's left or right wall, and both of its floors are inside
 *  the venue's stories, so it climbs alongside the venue the whole way. */
export function besideVenue(t: Flight, v: VenueBox): boolean {
  if (t.kind !== "stairs" && t.kind !== "escalator") return false;
  if (t.top - t.bottom !== 1) return false;
  if (t.bottom < v.floor || t.top > v.top) return false;
  return t.x + t.width === v.x || t.x === v.right;
}

/** Fills `out` with the ids of the flights in `transports` that wind beside
 *  one of `venues`, and returns it. Runs once per scene sync, never per frame:
 *  a tower holds at most 64 flights and a few dozen venues. */
export function windingFlights(transports: ReadonlyArray<TransportView>, venues: ReadonlyArray<VenueBox>, out: Set<number>): Set<number> {
  out.clear();
  if (venues.length === 0) return out;
  for (const t of transports) {
    for (const v of venues) {
      if (besideVenue(t, v)) {
        out.add(t.id);
        break;
      }
    }
  }
  return out;
}
