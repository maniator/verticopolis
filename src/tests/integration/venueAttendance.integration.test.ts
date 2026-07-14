import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { Clock } from "../../engine/Clock";
import { Crowd } from "../../engine/Crowd";
import { attendanceCap, censusCount, syncAttendanceOccupants, FACILITIES, GRID } from "../../engine/facilities";
import { spawnFloors } from "../../engine/crowd/spawn";
import {
  pushVenueVisitOptions,
  spawnVenueVisit,
  WEDDING_ARRIVAL_START,
} from "../../engine/crowd/visits";
import type { Unit } from "../../engine/types";

/**
 * Venue people-routing regression suite (gdd-venue-people-routing-2026-07-14).
 * Guards the load-bearing invariants:
 *   - Attendance (customersIn on cinema / party hall / wedding hall) is
 *     census-inert: totalPopulation and censusCount never read it.
 *   - The occupants mirror follows the tally, survives presence passes, and
 *     resets to 0 on save/load (transient, like the tally it mirrors).
 *   - Party hall receives routed evening visitors (lobby + hotel mingle);
 *     closed or unreachable halls receive nobody.
 *   - Wedding guests are weekend-midday only.
 *   - A blockbuster cinema contributes its visit option twice.
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
  const hallUnit = sim.tower.getUnit(hall.unitId!)!;
  hallUnit.state = "occupied"; // the traffic loop stamps this on the first open hour; pin it for determinism
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

describe("attendance ledger is census-inert", () => {
  it("customersIn on attendance venues never enters censusCount or totalPopulation", () => {
    const sim = partyHallTower();
    const hall = hallOf(sim);
    const before = sim.tower.totalPopulation();
    hall.customersIn = 5;
    syncAttendanceOccupants(hall);
    expect(hall.occupants).toBe(5);
    expect(censusCount(hall)).toBe(0); // population-0 kind: the tally never counts
    expect(sim.tower.totalPopulation()).toBe(before);
  });

  it("catalog attendance caps exist exactly for the three entertainment venues", () => {
    expect(attendanceCap("cinema")).toBe(30);
    expect(attendanceCap("partyHall")).toBe(20);
    expect(attendanceCap("weddingHall")).toBe(12);
    expect(attendanceCap("fastFood")).toBeUndefined();
    expect(attendanceCap("office")).toBeUndefined();
  });

  it("save/load resets the occupants mirror with the transient tally", () => {
    const sim = partyHallTower();
    const hall = hallOf(sim);
    hall.customersIn = 7;
    syncAttendanceOccupants(hall);
    const restored = Simulation.deserialize(sim.serialize());
    const back = restored.tower.units.find((u) => u.kind === "partyHall")!;
    expect(back.customersIn).toBeUndefined();
    expect(back.occupants).toBe(0);
  });

  it("updatePresence preserves the mirror instead of stamping population 0", () => {
    const sim = partyHallTower();
    const hall = hallOf(sim);
    hall.customersIn = 3;
    syncAttendanceOccupants(hall);
    setClock(sim, 20);
    sim.updatePresence();
    expect(hall.occupants).toBe(3); // occupied attendance venue: mirror wins
  });
});

describe("party hall receives routed evening visitors", () => {
  it("evening visitors spawn, arrive, register attendance, and the mirror follows", () => {
    const sim = partyHallTower();
    setClock(sim, 18);
    const hall = hallOf(sim);
    let sawVisitor = false;
    let sawAttendance = false;
    for (let m = 0; m < 240 && !(sawVisitor && sawAttendance); m++) {
      sim.tick(1);
      if (sim.crowd.people.some((p) => p.mealVenueId === hall.id)) sawVisitor = true;
      if ((hall.customersIn ?? 0) > 0) {
        sawAttendance = true;
        expect(hall.occupants).toBe(hall.customersIn); // mirror in step
      }
    }
    expect(sawVisitor).toBe(true);
    expect(sawAttendance).toBe(true);
  });

  it("hotel guests mingle: a hotel-origin visitor thins their room", () => {
    const sim = partyHallTower();
    setClock(sim, 18);
    const hall = hallOf(sim);
    const room = sim.tower.units.find((u) => u.kind === "hotelSingle")!;
    let sawMingle = false;
    for (let m = 0; m < 360 && !sawMingle; m++) {
      sim.tick(1);
      if (sim.crowd.people.some((p) => p.mealVenueId === hall.id && p.originUnitId === room.id)) {
        sawMingle = true;
        expect(room.outForMeal ?? 0).toBeGreaterThan(0);
      }
    }
    expect(sawMingle).toBe(true);
  });

  it("a closed party hall (outside 17:00-24:00) contributes no visit options", () => {
    const sim = partyHallTower();
    setClock(sim, 10);
    const floors = spawnFloors(sim.tower, sim.clock);
    expect(floors.venuesByKind.partyHall).toBeUndefined(); // binned only while open
    const options: Array<() => void> = [];
    pushVenueVisitOptions(sim.crowd, sim.tower, sim.clock, floors, options);
    expect(options.length).toBe(0);
  });

  it("a full house (attendance cap reached) accepts no further spawns", () => {
    const sim = partyHallTower();
    setClock(sim, 18);
    const hall = hallOf(sim);
    hall.customersIn = attendanceCap("partyHall")!;
    syncAttendanceOccupants(hall);
    const floors = spawnFloors(sim.tower, sim.clock);
    spawnVenueVisit(sim.crowd, sim.tower, "partyHall", floors.venuesByKind.partyHall!, floors, 18, 1);
    expect(sim.crowd.people.length).toBe(0);
  });

  it("an unreachable party hall (no transport) receives nobody", () => {
    const sim = new Simulation(2024, "modern", "realWorld");
    sim.money = 10_000_000;
    sim.star = 1;
    for (let x = 0; x < 40; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    for (let f = 2; f <= 3; f++) {
      for (let x = 0; x < 40; x++) expect(sim.tower.place("floor", f, x).ok).toBe(true);
    }
    const hall = sim.tower.place("partyHall", 2, 0);
    expect(hall.ok).toBe(true);
    sim.tower.getUnit(hall.unitId!)!.state = "occupied";
    setClock(sim, 18);
    const floors = spawnFloors(sim.tower, sim.clock);
    spawnVenueVisit(sim.crowd, sim.tower, "partyHall", floors.venuesByKind.partyHall!, floors, 18, 1);
    expect(sim.crowd.people.length).toBe(0); // route() is null: no person, no tally
    expect(hallOf(sim).customersIn ?? 0).toBe(0);
  });
});

describe("cinema attendance", () => {
  /** Party-hall fixture plus a tenanted two-story cinema on floor 2. */
  function cinemaTower(): Simulation {
    const sim = new Simulation(2024, "modern", "realWorld");
    sim.money = 10_000_000;
    sim.star = 1;
    for (let x = 0; x < 40; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    for (let f = 2; f <= 3; f++) {
      for (let x = 0; x < 40; x++) expect(sim.tower.place("floor", f, x).ok).toBe(true);
    }
    expect(sim.tower.placeTransport("elevatorStandard", 36, 1, 3).ok).toBe(true);
    const cin = sim.tower.place("cinema", 2, 0);
    expect(cin.ok).toBe(true);
    sim.tower.getUnit(cin.unitId!)!.state = "occupied";
    return sim;
  }

  it("daytime visitors register attendance and the mirror follows", () => {
    const sim = cinemaTower();
    setClock(sim, 14);
    const cin = sim.tower.units.find((u) => u.kind === "cinema")!;
    let sawAttendance = false;
    for (let m = 0; m < 240 && !sawAttendance; m++) {
      sim.tick(1);
      if ((cin.customersIn ?? 0) > 0) {
        sawAttendance = true;
        expect(cin.occupants).toBe(cin.customersIn);
      }
    }
    expect(sawAttendance).toBe(true);
  });

  it("a blockbuster cinema contributes its visit option twice", () => {
    const sim = cinemaTower();
    setClock(sim, 14);
    const cin = sim.tower.units.find((u) => u.kind === "cinema")!;
    const floors = spawnFloors(sim.tower, sim.clock);
    const plain: Array<() => void> = [];
    pushVenueVisitOptions(sim.crowd, sim.tower, sim.clock, floors, plain);
    expect(plain.length).toBe(1);
    const crowd = new Crowd(7);
    crowd.blockbusters = new Set([cin.id]);
    const boosted: Array<() => void> = [];
    pushVenueVisitOptions(crowd, sim.tower, sim.clock, floors, boosted);
    expect(boosted.length).toBe(2);
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
