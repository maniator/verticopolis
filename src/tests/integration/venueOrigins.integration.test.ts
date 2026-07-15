import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { Clock } from "../../engine/Clock";
import { attendanceCap, syncAttendanceOccupants, FACILITIES, GRID } from "../../engine/facilities";
import { spawnFloors } from "../../engine/crowd/spawn";
import {
  pushVenueVisitOptions,
  spawnVenueVisit,
  WEDDING_ARRIVAL_START,
} from "../../engine/crowd/visits";
import type { Unit } from "../../engine/types";

/**
 * Visit-origin matrix + weekend wedding regression suite, the sibling of
 * venueAttendance.integration.test.ts (split for the file-size ceiling).
 * Guards:
 *   - The per-venue origin rows (outside / condo / office / hotel) produce
 *     exactly their options, and room-origin visitors thin their rooms.
 *   - Wedding guests are weekend-midday, outside-origin only, and an
 *     unreachable hall receives nobody.
 */

function setClock(sim: Simulation, hour: number, day = 0): void {
  sim.clock = new Clock((day * 24 + hour) * 60, sim.clock.calendar);
}

/** Lobby + floors 2..5, an elevator serving 1..5, a tenanted two-story party
 *  hall on floor 2, and an occupied (asleep) hotel single on floor 4. */
function partyHallTower(): Simulation {
  const sim = new Simulation(2024, "modern", "realWorld");
  sim.money = 10_000_000;
  sim.star = 1; // gate random fires out of multi-hour loops
  for (let x = 0; x < 40; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
  for (let f = 2; f <= 5; f++) {
    for (let x = 0; x < 40; x++) expect(sim.tower.place("floor", f, x).ok).toBe(true);
  }
  expect(sim.tower.placeTransport("elevatorStandard", 36, 1, 5).ok).toBe(true);
  const hall = sim.tower.place("partyHall", 2, 0);
  expect(hall.ok).toBe(true);
  sim.tower.getUnit(hall.unitId!)!.state = "occupied";
  const hotel = sim.tower.place("hotelSingle", 4, 0);
  expect(hotel.ok).toBe(true);
  const room = sim.tower.getUnit(hotel.unitId!)!;
  room.state = "asleep"; // evening guest, in their room
  room.occupants = FACILITIES.hotelSingle.population;
  return sim;
}

function hallOf(sim: Simulation): Unit {
  return sim.tower.units.find((u) => u.kind === "partyHall")!;
}

describe("visit origin matrix", () => {
  it("party hall options: outside always, hotel when guests exist, condo when residents exist", () => {
    const sim = partyHallTower(); // hotel yes, condo no
    setClock(sim, 18);
    let floors = spawnFloors(sim.tower, sim.clock);
    const withoutCondo: Array<() => void> = [];
    pushVenueVisitOptions(sim.crowd, sim.tower, sim.clock, floors, withoutCondo);
    expect(withoutCondo.length).toBe(2); // outside + hotel
    const condo = sim.tower.place("condo", 5, 0);
    expect(condo.ok).toBe(true);
    const home = sim.tower.getUnit(condo.unitId!)!;
    home.state = "occupied";
    home.occupants = 3;
    floors = spawnFloors(sim.tower, sim.clock);
    const withCondo: Array<() => void> = [];
    pushVenueVisitOptions(sim.crowd, sim.tower, sim.clock, floors, withCondo);
    expect(withCondo.length).toBe(3); // outside + condo + hotel
  });

  it("cinema options: outside plus the staffed-office matinee row", () => {
    const sim = new Simulation(2024, "modern", "realWorld");
    sim.money = 10_000_000;
    sim.star = 1;
    for (let x = 0; x < 60; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    for (let f = 2; f <= 3; f++) {
      for (let x = 0; x < 60; x++) expect(sim.tower.place("floor", f, x).ok).toBe(true);
    }
    expect(sim.tower.placeTransport("elevatorStandard", 56, 1, 3).ok).toBe(true);
    const cin = sim.tower.place("cinema", 2, 0);
    expect(cin.ok).toBe(true);
    sim.tower.getUnit(cin.unitId!)!.state = "occupied";
    setClock(sim, 14); // weekday matinee hour, office staffed
    let floors = spawnFloors(sim.tower, sim.clock);
    const outsideOnly: Array<() => void> = [];
    pushVenueVisitOptions(sim.crowd, sim.tower, sim.clock, floors, outsideOnly);
    expect(outsideOnly.length).toBe(1); // outside
    const office = sim.tower.place("office", 3, 40);
    expect(office.ok).toBe(true);
    const desk = sim.tower.getUnit(office.unitId!)!;
    desk.state = "occupied";
    desk.occupants = FACILITIES.office.population;
    floors = spawnFloors(sim.tower, sim.clock);
    const withOffice: Array<() => void> = [];
    pushVenueVisitOptions(sim.crowd, sim.tower, sim.clock, floors, withOffice);
    expect(withOffice.length).toBe(2); // outside + office matinee
  });

  it("office workers catch a matinee: an office-origin visitor thins the office", () => {
    const sim = new Simulation(2024, "modern", "realWorld");
    sim.money = 10_000_000;
    sim.star = 1;
    for (let x = 0; x < 60; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    for (let f = 2; f <= 3; f++) {
      for (let x = 0; x < 60; x++) expect(sim.tower.place("floor", f, x).ok).toBe(true);
    }
    expect(sim.tower.placeTransport("elevatorStandard", 56, 1, 3).ok).toBe(true);
    const cin = sim.tower.place("cinema", 2, 0);
    expect(cin.ok).toBe(true);
    const house = sim.tower.getUnit(cin.unitId!)!;
    house.state = "occupied";
    const office = sim.tower.place("office", 3, 40);
    expect(office.ok).toBe(true);
    const desk = sim.tower.getUnit(office.unitId!)!;
    desk.state = "occupied";
    desk.occupants = FACILITIES.office.population;
    setClock(sim, 13);
    let sawWorker = false;
    for (let m = 0; m < 360 && !sawWorker; m++) {
      sim.tick(1);
      if (sim.crowd.people.some((p) => p.mealVenueId === house.id && p.originUnitId === desk.id)) {
        sawWorker = true;
        expect(desk.outForMeal ?? 0).toBeGreaterThan(0);
      }
    }
    expect(sawWorker).toBe(true);
  });

  it("residents go out: a condo-origin visitor thins their home", () => {
    const sim = partyHallTower();
    const condo = sim.tower.place("condo", 5, 0);
    expect(condo.ok).toBe(true);
    const home = sim.tower.getUnit(condo.unitId!)!;
    home.state = "occupied";
    home.occupants = 3;
    setClock(sim, 18);
    const hall = hallOf(sim);
    let sawResident = false;
    for (let m = 0; m < 360 && !sawResident; m++) {
      sim.tick(1);
      if (sim.crowd.people.some((p) => p.mealVenueId === hall.id && p.originUnitId === home.id)) {
        sawResident = true;
        expect(home.outForMeal ?? 0).toBeGreaterThan(0);
      }
    }
    expect(sawResident).toBe(true);
  });
});

describe("weekend wedding", () => {
  /** A floor-100 tower: lobby, a 20-tile support stack to the roof, one
   *  express serving every floor, and the wedding hall at GRID.maxFloor. */
  function weddingTower(): Simulation {
    const sim = new Simulation(2024, "modern", "realWorld");
    sim.money = 100_000_000;
    sim.star = 1;
    for (let x = 0; x < 40; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    for (let f = 2; f <= GRID.maxFloor; f++) {
      for (let x = 0; x < 20; x++) expect(sim.tower.place("floor", f, x).ok).toBe(true);
    }
    expect(sim.tower.placeTransport("elevatorExpress", 17, 1, GRID.maxFloor).ok).toBe(true);
    const hall = sim.tower.place("weddingHall", GRID.maxFloor, 0);
    expect(hall.ok).toBe(true);
    return sim;
  }

  it("weekday middays spawn no wedding guests", () => {
    const sim = weddingTower();
    setClock(sim, WEDDING_ARRIVAL_START, 0); // Monday
    const hall = sim.tower.units.find((u) => u.kind === "weddingHall")!;
    for (let m = 0; m < 180; m++) {
      sim.tick(1);
      expect(sim.crowd.people.some((p) => p.mealVenueId === hall.id)).toBe(false);
    }
    expect(hall.customersIn ?? 0).toBe(0);
  });

  it("weekend middays spawn guests who register at the hall", () => {
    const sim = weddingTower();
    setClock(sim, WEDDING_ARRIVAL_START, 5); // Saturday
    const hall = sim.tower.units.find((u) => u.kind === "weddingHall")!;
    let sawGuestTrip = false;
    let sawAttendance = false;
    for (let m = 0; m < 300 && !sawAttendance; m++) {
      sim.tick(1);
      if (sim.crowd.people.some((p) => p.mealVenueId === hall.id)) sawGuestTrip = true;
      if ((hall.customersIn ?? 0) > 0) {
        sawAttendance = true;
        expect(hall.occupants).toBe(hall.customersIn);
        expect(hall.customersIn!).toBeLessThanOrEqual(attendanceCap("weddingHall")!);
      }
    }
    expect(sawGuestTrip).toBe(true);
    expect(sawAttendance).toBe(true);
  });

  it("wedding guests come from outside only, even with residents and hotel guests present", () => {
    const sim = weddingTower();
    const condo = sim.tower.place("condo", 2, 0);
    expect(condo.ok).toBe(true);
    const home = sim.tower.getUnit(condo.unitId!)!;
    home.state = "occupied";
    home.occupants = 3;
    const hotel = sim.tower.place("hotelSingle", 3, 0);
    expect(hotel.ok).toBe(true);
    const room = sim.tower.getUnit(hotel.unitId!)!;
    room.state = "asleep";
    room.occupants = FACILITIES.hotelSingle.population;
    setClock(sim, WEDDING_ARRIVAL_START, 5); // Saturday, inside the window
    const floors = spawnFloors(sim.tower, sim.clock);
    expect(floors.condoFloors.length).toBeGreaterThan(0);
    expect(floors.hotelFloors.length).toBeGreaterThan(0);
    const options: Array<() => void> = [];
    pushVenueVisitOptions(sim.crowd, sim.tower, sim.clock, floors, options);
    expect(options.length).toBe(1); // the outside row is the whole wedding matrix
  });

  it("an unreachable wedding hall receives nobody", () => {
    const sim = new Simulation(2024, "modern", "realWorld");
    sim.money = 100_000_000;
    sim.star = 1;
    for (let x = 0; x < 40; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    for (let f = 2; f <= GRID.maxFloor; f++) {
      for (let x = 0; x < 20; x++) expect(sim.tower.place("floor", f, x).ok).toBe(true);
    }
    // No express: floor 100 is unreachable from the ground lobby.
    const hall = sim.tower.place("weddingHall", GRID.maxFloor, 0);
    expect(hall.ok).toBe(true);
    setClock(sim, WEDDING_ARRIVAL_START, 5); // Saturday, inside the window
    const floors = spawnFloors(sim.tower, sim.clock);
    expect(floors.venuesByKind.weddingHall?.length).toBe(1); // binned (it exists)...
    spawnVenueVisit(sim.crowd, sim.tower, "weddingHall", floors.venuesByKind.weddingHall!, floors, WEDDING_ARRIVAL_START, "outside");
    expect(sim.crowd.people.length).toBe(0); // ...but no route means no guest
    expect(sim.tower.units.find((u) => u.kind === "weddingHall")!.customersIn ?? 0).toBe(0);
  });

  it("updatePresence keeps a mid-wedding house on the never-tenanted (empty) hall", () => {
    const sim = weddingTower();
    const hall = sim.tower.units.find((u) => u.kind === "weddingHall")!;
    expect(hall.state).toBe("empty"); // never tenanted by design
    hall.customersIn = 6;
    syncAttendanceOccupants(hall);
    setClock(sim, 12, 5);
    sim.updatePresence();
    expect(hall.occupants).toBe(6);
  });
});
