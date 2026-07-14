import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { Clock } from "../../engine/Clock";
import { Crowd } from "../../engine/Crowd";
import { attendanceCap, censusCount, syncAttendanceOccupants, ALL_KINDS, FACILITIES, GRID } from "../../engine/facilities";
import { spawnFloors } from "../../engine/crowd/spawn";
import { dwellSecondsRange, EAT_SECONDS_MIN, EAT_SECONDS_MAX, CROWD_SECONDS_PER_MINUTE } from "../../engine/crowd/person";
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

  it("ratingPopulation and spatialCongestionByFloor are identical with and without attendees", () => {
    const sim = partyHallTower();
    const hall = hallOf(sim);
    const ratingBefore = sim.ratingPopulation();
    const congBefore = [...sim.spatialCongestionByFloor().entries()].sort();
    hall.customersIn = 5;
    syncAttendanceOccupants(hall);
    expect(sim.ratingPopulation()).toBe(ratingBefore);
    expect([...sim.spatialCongestionByFloor().entries()].sort()).toEqual(congBefore);
  });

  it("the occupants mirror feeds no statistical elevator demand (attendees already place real calls)", () => {
    const sim = partyHallTower();
    const hall = hallOf(sim);
    hall.customersIn = attendanceCap("partyHall")!;
    syncAttendanceOccupants(hall);
    expect(hall.occupants).toBeGreaterThan(0);
    sim.elevators.accumulate(sim.tower, 10, 1.45);
    // The hall sits alone on floor 2: a full house must not raise the
    // statistical waiting estimate there (the drawn visitors' hall calls are
    // the only demand attendance may create).
    expect(sim.elevators.waitingAt(2)).toBe(0);
  });

  it("every kind with an attendance cap has catalog population 0 (mutual exclusivity)", () => {
    for (const kind of ALL_KINDS) {
      if (FACILITIES[kind].attendance !== undefined) {
        expect(FACILITIES[kind].population, `${kind} must stay census-inert`).toBe(0);
        expect(FACILITIES[kind].attendance).toBeGreaterThan(0);
      }
    }
  });

  it("dwell windows: attendance kinds get their showing/party/wedding spans, meals keep 30-60", () => {
    const m = CROWD_SECONDS_PER_MINUTE;
    expect(dwellSecondsRange("cinema")).toEqual({ min: 90 * m, max: 120 * m });
    expect(dwellSecondsRange("partyHall")).toEqual({ min: 60 * m, max: 120 * m });
    expect(dwellSecondsRange("weddingHall")).toEqual({ min: 120 * m, max: 180 * m });
    expect(dwellSecondsRange("fastFood")).toEqual({ min: EAT_SECONDS_MIN, max: EAT_SECONDS_MAX });
    expect(dwellSecondsRange(undefined)).toEqual({ min: EAT_SECONDS_MIN, max: EAT_SECONDS_MAX });
  });

  it("the mirror writes 0 onto a non-operational venue even while the tally drains", () => {
    const sim = partyHallTower();
    const hall = hallOf(sim);
    hall.customersIn = 4;
    syncAttendanceOccupants(hall);
    expect(hall.occupants).toBe(4);
    hall.state = "gutted"; // fire aftermath while attendees were inside
    syncAttendanceOccupants(hall); // a departing attendee's decrement path re-syncs
    expect(hall.occupants).toBe(0); // no audience art on a ruin
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

  it("hotel guests mingle: a hotel-origin visitor thins their room, with no hotel census split", () => {
    const sim = partyHallTower();
    setClock(sim, 18);
    const hall = hallOf(sim);
    const room = sim.tower.units.find((u) => u.kind === "hotelSingle")!;
    let sawMingle = false;
    for (let m = 0; m < 360 && !sawMingle; m++) {
      sim.tick(1);
      // Attendance venues never track the hotel-origin census split: the
      // tally is census-inert, so there is nothing to exclude at 4 stars.
      expect(hall.hotelCustomersIn ?? 0).toBe(0);
      if (sim.crowd.people.some((p) => p.mealVenueId === hall.id && p.originUnitId === room.id)) {
        sawMingle = true;
        expect(room.outForMeal ?? 0).toBeGreaterThan(0);
      }
    }
    expect(sawMingle).toBe(true);
  });

  it("the house fills and drains: attendance returns to zero after closing", () => {
    const sim = partyHallTower();
    setClock(sim, 18);
    const hall = hallOf(sim);
    let peak = 0;
    // 18:00 through 04:00 next day: spawns stop binning at the 24:00 close,
    // the longest dwell (120 game-min) plus the ride home fits well inside.
    for (let m = 0; m < 600; m++) {
      sim.tick(1);
      peak = Math.max(peak, hall.customersIn ?? 0);
    }
    expect(peak).toBeGreaterThan(0);
    expect(hall.customersIn ?? 0).toBe(0);
    expect(hall.occupants).toBe(0);
  });

  it("a lobby-origin visitor's return leg targets their spawn floor (floor 1)", () => {
    const sim = partyHallTower();
    setClock(sim, 18);
    const hall = hallOf(sim);
    let returner: (typeof sim.crowd.people)[number] | undefined;
    for (let m = 0; m < 600 && !returner; m++) {
      sim.tick(1);
      returner = sim.crowd.people.find(
        (p) => p.mealVenueId === hall.id && p.originUnitId === undefined && p.returning,
      );
    }
    expect(returner).toBeDefined();
    expect(returner!.floors[returner!.floors.length - 1]).toBe(1);
  });

  it("mid-dwell bulldoze: the hall is removed while attended, everyone winds down cleanly", () => {
    const sim = partyHallTower();
    setClock(sim, 18);
    const hall = hallOf(sim);
    let counted = false;
    for (let m = 0; m < 360 && !counted; m++) {
      sim.tick(1);
      counted = (hall.customersIn ?? 0) > 0;
    }
    expect(counted).toBe(true);
    sim.tower.removeUnit(hall.id);
    // Dwellers finish their timer, the guarded decrement no-ops on the gone
    // unit, and every visitor despawns without an exception.
    for (let m = 0; m < 500; m++) sim.tick(1);
    expect(sim.crowd.people.some((p) => p.mealVenueId === hall.id)).toBe(false);
  });

  it("give-up balance: losing the only elevator mid-visit still drains the tally to zero", () => {
    const sim = partyHallTower();
    setClock(sim, 18);
    const hall = hallOf(sim);
    let counted = false;
    for (let m = 0; m < 360 && !counted; m++) {
      sim.tick(1);
      counted = (hall.customersIn ?? 0) > 0;
    }
    expect(counted).toBe(true);
    const shaft = sim.tower.transports[0];
    sim.tower.removeTransport(shaft.id);
    // Return routes now fail (finish() fires straight from the dwell) and
    // in-transit visitors hit the give-up valve; every path decrements.
    for (let m = 0; m < 600; m++) sim.tick(1);
    expect(hall.customersIn ?? 0).toBe(0);
    expect(hall.occupants).toBe(0);
  });

  it("the traffic loop itself tenants a reachable hall at opening time (no hand stamping)", () => {
    const sim = partyHallTower();
    const hall = hallOf(sim);
    hall.state = "empty"; // undo the fixture pin: the real loop must do it
    setClock(sim, 16);
    for (let m = 0; m < 120; m++) sim.tick(1); // crosses the 17:00 open
    expect(hall.state).toBe("occupied");
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
    spawnVenueVisit(sim.crowd, sim.tower, "weddingHall", floors.venuesByKind.weddingHall!, floors, WEDDING_ARRIVAL_START, 1);
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
