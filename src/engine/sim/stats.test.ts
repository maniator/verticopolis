import { describe, it, expect } from "vitest";
import { Simulation } from "../Simulation";
import { GRID } from "../facilitiesData";
import { FACILITIES, isHotelKind } from "../facilities";
import { markRoom, roomUnits } from "../tower/rooms";
import type { FacilityKind, Unit, UnitState } from "../types";
import { walkedStats } from "../../tests/fixtures/walkedStats";
import { stats } from "./stats";

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

describe("stats() reads the kept room counts", () => {
  it("counts what the walk over every unit counted, in every state, recounting the marked rooms", () => {
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
        markRoom(sim.tower, u);
      });
      expect(stats(sim)).toMatchObject(walkedStats(sim));
      expect(stats(sim).population).toBe(sim.population);
    }
    expect(walkedStats(sim).population).toBeGreaterThan(0);
  });

  it("recounts only the rooms it is told about until the rooms list is rebuilt", () => {
    const sim = tower();
    const before = stats(sim);
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    const condo = sim.tower.units.find((u) => u.kind === "condo")!;
    office.state = "occupied";
    condo.everOccupied = true;
    // A read passes over no room, so a write nobody marked is not seen.
    expect(stats(sim)).toEqual(before);
    markRoom(sim.tower, office);
    expect(stats(sim)).toMatchObject({ occupiedOffices: before.occupiedOffices + 1, vacant: before.vacant - 1, soldCondos: before.soldCondos });
    sim.tower.revision++; // as a placement does, and as tooling does after a staged write
    expect(stats(sim)).toMatchObject({ ...walkedStats(sim), soldCondos: before.soldCondos + 1 });
  });

  it("ignores a mark on a structure tile and a mark before the first count", () => {
    const sim = tower();
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    office.state = "occupied";
    markRoom(sim.tower, office); // nothing is kept yet: the first read counts every room
    expect(stats(sim)).toMatchObject(walkedStats(sim));
    const tile = sim.tower.units.find((u) => u.kind === "floor")!;
    markRoom(sim.tower, tile);
    expect(stats(sim)).toMatchObject(walkedStats(sim));
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
