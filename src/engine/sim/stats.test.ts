import { describe, it, expect } from "vitest";
import { censusCount } from "../census";
import { Simulation } from "../Simulation";
import { GRID } from "../facilitiesData";
import { FACILITIES, isHotelKind } from "../facilities";
import { roomUnits } from "../tower/rooms";
import type { FacilityKind, Unit, UnitState } from "../types";
import { isPresent, isTenanted } from "../types";
import { stats } from "./stats";

/** `stats()` as it was before it read the rooms list, walking every unit,
 *  with the population summed over every unit as well, so no memoized list
 *  stands behind either side. */
function walkedStats(sim: Simulation) {
  const c = { offices: 0, occupiedOffices: 0, condos: 0, soldCondos: 0, hotelRooms: 0, occupiedHotel: 0, dirty: 0, shops: 0, restaurants: 0, vacant: 0, vacantNoRate: 0, parkingSpaces: 0, population: 0 };
  for (const u of sim.tower.units) {
    if (isPresent(u)) c.population += censusCount(u);
    if (u.kind === "office") {
      c.offices++;
      if (isTenanted(u)) c.occupiedOffices++;
      if (u.state === "empty") {
        c.vacant++;
        if (u.noRate) c.vacantNoRate++;
      }
    } else if (u.kind === "condo") {
      c.condos++;
      if (u.everOccupied) c.soldCondos++;
    } else if (isHotelKind(u.kind)) {
      c.hotelRooms++;
      if (u.state === "asleep") c.occupiedHotel++;
      if (u.state === "dirty") c.dirty++;
    } else if (u.kind === "shop") c.shops++;
    else if (u.kind === "restaurant" || u.kind === "fastFood") c.restaurants++;
    else if (u.kind === "parking") c.parkingSpaces++;
  }
  return c;
}

const STATES: UnitState[] = ["construction", "empty", "occupied", "moving_in", "vacating", "asleep", "dirty", "infested", "fire", "gutted"];
const KINDS: FacilityKind[] = ["office", "condo", "hotelSingle", "hotelDouble", "hotelSuite", "shop", "restaurant", "fastFood", "cinema", "parking", "security", "medical"];

/** Whether `stats()` counts a kind, by the same tests it uses. */
const counted = (k: FacilityKind) => k === "office" || k === "condo" || isHotelKind(k) || k === "shop" || k === "restaurant" || k === "fastFood" || k === "parking";

/** A lobby, ten floors above it and four below (floors 0 to -3), holding
 *  four of every kind the census counts, plus kinds it skips. A kind the
 *  upper floors refuse (parking) goes below, on its own cursor. */
function tower(): Simulation {
  const sim = new Simulation(7);
  const t = sim.tower;
  for (let x = 0; x < GRID.width; x++) t.place("lobby", 1, x);
  for (let f = 2; f <= 11; f++) for (let x = 0; x < GRID.width; x++) t.place("floor", f, x);
  for (let f = 0; f >= -3; f--) for (let x = 0; x < GRID.width; x++) t.place("floor", f, x);
  let floor = 2;
  let x = 0;
  let below = 0;
  for (const kind of KINDS) {
    const w = FACILITIES[kind].width;
    for (let n = 0; n < 4; n++) {
      if (x + w > GRID.width) {
        floor++;
        x = 0;
      }
      expect(floor, "the upper floors are full").toBeLessThanOrEqual(11);
      const placed = t.place(kind, floor, x);
      if (placed.ok) x += w;
      else {
        expect(t.place(kind, -1, below).ok, `${kind}: ${placed.reason}`).toBe(true);
        below += w;
      }
    }
  }
  return sim;
}

describe("stats() reads the rooms list", () => {
  it("counts what the walk over every unit counted, in every state", () => {
    for (const kind of Object.keys(FACILITIES) as FacilityKind[]) if (counted(kind)) expect(KINDS, kind).toContain(kind);
    const sim = tower();
    for (const kind of KINDS) expect(roomUnits(sim.tower).filter((u) => u.kind === kind).length, kind).toBe(4);
    const rooms = sim.tower.units.filter((u: Unit) => u.kind !== "floor" && u.kind !== "lobby");
    // Four laps of the states, each lap with its own pair of flags, so every
    // room meets every state with every noRate and everOccupied pairing (a
    // sold condo standing empty, an unrated office that is let).
    for (let round = 0; round < STATES.length * 4; round++) {
      const lap = Math.floor(round / STATES.length);
      rooms.forEach((u, i) => {
        u.state = STATES[(i + round) % STATES.length];
        u.noRate = (i + lap) % 2 === 0;
        u.everOccupied = (i + (lap >> 1)) % 2 === 0;
        u.residents = (i * 7 + round) % 9;
        u.customersIn = (i + 2 * round) % 5;
      });
      expect(stats(sim)).toMatchObject(walkedStats(sim));
      expect(stats(sim).population).toBe(sim.population);
    }
    expect(walkedStats(sim).population).toBeGreaterThan(0);
  });

  it("follows a room removed and placed again, at each changed unit count", () => {
    const sim = tower();
    for (const u of sim.tower.units) if (u.kind === "office") u.state = "occupied";
    expect(stats(sim)).toMatchObject(walkedStats(sim));
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    expect(sim.tower.removeUnit(office.id)).toBeDefined();
    const removed = stats(sim);
    expect(removed).toMatchObject(walkedStats(sim));
    expect(removed.offices).toBe(3);
    expect(sim.tower.place("office", office.floor, office.x).ok).toBe(true);
    const placed = stats(sim);
    expect(placed).toMatchObject(walkedStats(sim));
    expect(placed.offices).toBe(4);
  });

  it("follows a room swapped for another kind at the same unit count", () => {
    const sim = tower();
    for (const u of sim.tower.units) if (u.kind === "office") u.state = "occupied";
    expect(stats(sim).offices).toBe(4); // the rooms list is now memoized
    const count = sim.tower.units.length;
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    expect(sim.tower.removeUnit(office.id)).toBeDefined();
    expect(sim.tower.place("hotelDouble", office.floor, office.x).ok).toBe(true);
    // No read in between and the same unit count: only the revision tells
    // the list it is out of date.
    expect(sim.tower.units.length).toBe(count);
    const swapped = stats(sim);
    expect(swapped).toMatchObject(walkedStats(sim));
    expect(swapped).toMatchObject({ offices: 3, occupiedOffices: 3, hotelRooms: 13 });
  });
});
