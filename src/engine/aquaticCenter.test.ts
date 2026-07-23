import { describe, it, expect } from "vitest";
import { Simulation } from "./Simulation";
import { Clock } from "./Clock";
import { GRID, FACILITIES } from "./facilities";
import { isCommercialKind, isOpenAt, attendanceCap } from "./facilityPredicates";
import { censusCount, syncAttendanceOccupants } from "./census";
import { ECON } from "./econConfig";

/**
 * Aquatic Center: a Track-2 showpiece from the Modern Expansion GDD. Unlike the
 * footfall venues (Nightclub/Spa/Sky Bar) it is a two-story ATTENDANCE venue like
 * the cinema and party hall: a real crowd travels to it, swims for a while, and
 * leaves, so its income tracks how full it is (`customersIn / cap`) and it leans
 * on the tower's transport. Modern-gated: Classic never has one, so Classic stays
 * pixel-faithful and its golden hash is untouched (no aquatic center in the table
 * or the fixtures).
 */

function lay(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = 0; x < GRID.width; x++) sim.tower.place(kind, floor, x);
}

/** Lobby + floors 2..top, an elevator at column 0 serving 1..top, and a tenanted
 *  two-story aquatic center on floor 2 (it occupies floors 2-3). */
function poolTower(top = 4): { sim: Simulation; pool: ReturnType<Simulation["tower"]["getUnit"]> } {
  const sim = new Simulation(2024, "modern", "realWorld");
  sim.money = 10_000_000;
  sim.star = 5;
  lay(sim, "lobby", 1);
  for (let f = 2; f <= top; f++) lay(sim, "floor", f);
  expect(sim.tower.placeTransport("elevatorStandard", 0, 1, top).ok).toBe(true);
  const r = sim.tower.place("aquaticCenter", 2, 4); // width 28: clear of the shaft at column 0
  expect(r.ok, r.reason).toBe(true);
  const pool = sim.tower.getUnit(r.unitId!)!;
  pool.state = "occupied"; // the traffic loop stamps this on the first open hour; pin it
  return { sim, pool };
}

describe("Aquatic Center", () => {
  it("is a Modern-only two-story attendance venue", () => {
    expect(FACILITIES.aquaticCenter.modernOnly).toBe(true);
    expect(FACILITIES.aquaticCenter.category).toBe("entertainment");
    expect(FACILITIES.aquaticCenter.floors).toBe(2);
    expect(FACILITIES.aquaticCenter.population).toBe(0); // attendance venues are census-inert
    expect(attendanceCap("aquaticCenter")).toBe(24);
    expect(ECON.dailyTrafficIncome.aquaticCenter).toBeGreaterThan(0);
    expect(ECON.classicDailyTrafficIncome.aquaticCenter).toBeUndefined();
    // A destination people travel to, not passing trade: like the party hall it is
    // NOT a commercial kind, so it takes no lobby-proximity income penalty.
    expect(isCommercialKind("aquaticCenter")).toBe(false);
  });

  it("gates behind its star: locked below minStar, never in Classic", () => {
    const modern = Simulation.newGame(1, "modern");
    modern.star = FACILITIES.aquaticCenter.minStar - 1;
    expect(modern.isUnlocked("aquaticCenter")).toBe(false);
    modern.star = FACILITIES.aquaticCenter.minStar;
    expect(modern.isUnlocked("aquaticCenter")).toBe(true);
    const classic = Simulation.newGame(1, "classic");
    classic.star = 5;
    expect(classic.isUnlocked("aquaticCenter")).toBe(false);
  });

  it("keeps long daytime hours (open 8am to 10pm)", () => {
    expect(isOpenAt("aquaticCenter", 7)).toBe(false); // before opening
    expect(isOpenAt("aquaticCenter", 8)).toBe(true); // opens 8am
    expect(isOpenAt("aquaticCenter", 15)).toBe(true); // afternoon: open
    expect(isOpenAt("aquaticCenter", 22)).toBe(false); // closes at 10pm
  });

  it("keeps its live attendees census-inert (population 0), mirrored into occupants", () => {
    const { sim, pool } = poolTower();
    const before = sim.tower.totalPopulation();
    pool!.customersIn = 10;
    syncAttendanceOccupants(pool!);
    expect(pool!.occupants).toBe(10); // the interior art reads the live count
    expect(censusCount(pool!)).toBe(0); // but population 0 keeps it out of the census
    expect(sim.tower.totalPopulation()).toBe(before);
  });

  it("earns from how full it is: nothing empty, more as it fills, capped at a sold-out house", () => {
    // Same seed and identical build order, so the sole venue draws the same seeded
    // traffic factor in every run; only the live fill differs.
    const income = (customersIn: number): number => {
      const { sim, pool } = poolTower();
      pool!.customersIn = customersIn;
      syncAttendanceOccupants(pool!);
      sim.clock = new Clock(12 * 60, sim.clock.calendar); // noon: the pool is open
      const before = sim.money;
      for (let i = 0; i < 12; i++) sim.economy.collectTrafficIncome();
      return sim.money - before;
    };
    const cap = attendanceCap("aquaticCenter")!;
    expect(income(0)).toBe(0); // an empty house earns nothing
    const half = income(Math.floor(cap / 2));
    const full = income(cap);
    expect(half).toBeGreaterThan(0);
    expect(full).toBeGreaterThan(half); // a fuller house earns more
    expect(income(cap * 2)).toBe(full); // over-full never beats sold-out (frac clamps to 1)
  });

  it("is not a dead venue: routed visitors travel to it and register attendance", () => {
    // The critical wiring test. Without the VISIT_ORIGINS row and the
    // pushVenueVisitOptions block, the pool would draw nobody even though its art
    // and income are wired. Tick a live sim through open hours and watch a visitor
    // route to the pool and fill customersIn.
    const { sim, pool } = poolTower(5);
    // A hotel guest on floor 4 is one eligible origin (residents/street are others).
    const hotel = sim.tower.place("hotelSingle", 4, 4);
    expect(hotel.ok).toBe(true);
    const room = sim.tower.getUnit(hotel.unitId!)!;
    room.state = "asleep";
    room.occupants = FACILITIES.hotelSingle.population;
    sim.clock = new Clock(12 * 60, sim.clock.calendar); // midday: the pool is open
    let sawVisitor = false;
    let sawAttendance = false;
    for (let m = 0; m < 360 && !(sawVisitor && sawAttendance); m++) {
      sim.tick(1);
      if (sim.crowd.people.some((p) => p.mealVenueId === pool!.id)) sawVisitor = true;
      if ((pool!.customersIn ?? 0) > 0) {
        sawAttendance = true;
        expect(pool!.occupants).toBe(pool!.customersIn); // the mirror stays in step
      }
    }
    expect(sawVisitor).toBe(true);
    expect(sawAttendance).toBe(true);
  });
});
