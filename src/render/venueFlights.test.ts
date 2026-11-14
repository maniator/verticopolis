import { describe, expect, it } from "vitest";
import { besideVenue, isVenue, venueBox, windingFlights } from "./venueFlights";
import type { TransportView } from "../simport/view";

const flight = (id: number, kind: TransportView["kind"], x: number, bottom: number, top: number, width = 8): TransportView => ({
  id, kind, x, width, bottom, top, cars: 0, carPositions: [], carDir: [],
});
// A two-story cinema on floors 2 and 3, columns 100 to 130.
const cinema = venueBox({ floor: 2, x: 100, width: 31 }, 2);

describe("which flights wind beside a venue", () => {
  it("names the venues a crowd arrives at, and not the back of house", () => {
    for (const k of ["cinema", "partyHall", "metro", "aquaticCenter"] as const) expect(isVenue(k), k).toBe(true);
    for (const k of ["recycling", "restaurant", "office", "lobby", "weddingHall"] as const) expect(isVenue(k), k).toBe(false);
  });

  it("takes the venue's stories from the height it is given", () => {
    expect(venueBox({ floor: -2, x: 50, width: 30 }, 3)).toEqual({ floor: -2, top: 0, x: 50, right: 80 });
  });

  it("winds a one-story flight touching either wall, inside the venue's stories", () => {
    expect(besideVenue(flight(1, "stairs", 92, 2, 3), cinema)).toBe(true);
    expect(besideVenue(flight(1, "escalator", 131, 2, 3), cinema)).toBe(true);
  });

  it("leaves a flight a tile away, or half beside it, straight", () => {
    expect(besideVenue(flight(1, "stairs", 91, 2, 3), cinema)).toBe(false);
    expect(besideVenue(flight(1, "stairs", 132, 2, 3), cinema)).toBe(false);
    // From the cinema's top story to the floor over it: only half beside it.
    expect(besideVenue(flight(1, "stairs", 92, 3, 4), cinema)).toBe(false);
    expect(besideVenue(flight(1, "stairs", 92, 1, 2), cinema)).toBe(false);
  });

  it("never touches an elevator or a flight out of a tall lobby", () => {
    expect(besideVenue(flight(1, "elevatorStandard", 92, 2, 3, 4), venueBox({ floor: 2, x: 96, width: 31 }, 2))).toBe(false);
    const metro = venueBox({ floor: -2, x: 50, width: 30 }, 3);
    expect(besideVenue(flight(1, "stairs", 42, -2, 0), metro)).toBe(false);
  });

  it("winds both flights of a stack beside the three-story metro", () => {
    const metro = venueBox({ floor: -2, x: 50, width: 30 }, 3);
    const low = flight(1, "escalator", 42, -2, -1);
    const high = flight(2, "stairs", 42, -1, 0);
    const above = flight(3, "stairs", 42, 0, 1);
    expect([...windingFlights([low, high, above], [metro], new Set())]).toEqual([1, 2]);
  });

  it("refills the set it is handed, so a bulldozed venue straightens its flights", () => {
    const out = new Set([9]);
    const stairs = flight(1, "stairs", 92, 2, 3);
    expect([...windingFlights([stairs], [cinema], out)]).toEqual([1]);
    expect(windingFlights([stairs], [], out).size).toBe(0);
  });
});
