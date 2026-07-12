import { describe, it, expect } from "vitest";
import { Simulation } from "../engine/Simulation";
import { FACILITIES } from "../engine/facilities";
import { Clock } from "../engine/Clock";

/**
 * Guards commercial venue occupant behavior:
 *   - A tenanted venue shows `f.population` as its ambient occupant count
 *     during open hours (for the renderer heatmap and lit-window sprite).
 *   - The same venue shows 0 outside its open hours so the heatmap goes dark
 *     after closing time.
 *   - Population values are differentiated by footprint:
 *     shop 20, fastFood 25, restaurant 35.
 */

function setHour(sim: Simulation, hour: number): void {
  // Avoid Clock(0): constructor treats 0 minutes as "use default start time"
  // (7am). Use 1 minute past midnight for hour 0; Math.floor(1/60) = 0.
  // Do not call with hour=0 expecting midnight and then tick to hour 1 --
  // call setHour(sim, 23) + triggerHour() instead to cross the 23->0 boundary.
  sim.clock = new Clock(hour * 60 || 1, sim.clock.calendar);
}

/** Advance the clock by one hour so onHour/updatePresence fires. */
function triggerHour(sim: Simulation): void {
  sim.tick(60);
}

/** Build a minimal tower with a single tenanted commercial venue.
 * Each call returns a fresh Simulation (lastHour=-1), so the first
 * triggerHour() always fires onHour regardless of the target hour. Do
 * not reuse a fixture for multiple setHour calls that land on the same
 * resulting hour — replace the clock but not lastHour, so onHour would
 * not fire a second time to that same hour.
 */
function venueFixture(kind: "fastFood" | "restaurant" | "shop"): {
  sim: Simulation;
  unit: import("../engine/types").Unit;
} {
  const sim = new Simulation(2024, "classic", "realWorld");
  sim.money = 5_000_000;
  for (let x = 0; x < 40; x++) sim.tower.place("lobby", 1, x);
  for (let f = 2; f <= 5; f++) for (let x = 0; x < 40; x++) sim.tower.place("floor", f, x);
  sim.tower.placeTransport("elevatorStandard", 4, 1, 5);
  const result = sim.tower.place(kind, 3, 0);
  const unit = sim.tower.units.find((u) => u.id === result.unitId)!;
  unit.state = "occupied";
  return { sim, unit };
}

// ---- Population values match footprint ----------------------------------------

describe("commercial venue population values are proportional to footprint", () => {
  it("shop has population 20", () => {
    expect(FACILITIES.shop.population).toBe(20);
  });

  it("fastFood has population 25", () => {
    expect(FACILITIES.fastFood.population).toBe(25);
  });

  it("restaurant has population 35", () => {
    expect(FACILITIES.restaurant.population).toBe(35);
  });

  it("all three are positive (gate for census inclusion)", () => {
    expect(FACILITIES.shop.population).toBeGreaterThan(0);
    expect(FACILITIES.fastFood.population).toBeGreaterThan(0);
    expect(FACILITIES.restaurant.population).toBeGreaterThan(0);
  });
});

// ---- Occupants during open hours ----------------------------------------------

describe("occupants equals f.population while venue is open", () => {
  it("fast food is open at 12:00 and shows its population", () => {
    const { sim, unit } = venueFixture("fastFood");
    setHour(sim, 11); // position just before target
    triggerHour(sim); // fires onHour -> updatePresence at hour 12
    expect(unit.occupants).toBe(FACILITIES.fastFood.population);
  });

  it("restaurant is open at 12:00 (lunch window) and shows its population", () => {
    const { sim, unit } = venueFixture("restaurant");
    setHour(sim, 11);
    triggerHour(sim);
    expect(unit.occupants).toBe(FACILITIES.restaurant.population);
  });

  it("shop is open at 14:00 and shows its population", () => {
    const { sim, unit } = venueFixture("shop");
    setHour(sim, 13);
    triggerHour(sim);
    expect(unit.occupants).toBe(FACILITIES.shop.population);
  });
});

// ---- Occupants while closed ---------------------------------------------------

describe("occupants is 0 while venue is closed, even when tenanted", () => {
  it("fast food is closed at 4:00 (before 7am open)", () => {
    const { sim, unit } = venueFixture("fastFood");
    setHour(sim, 3);
    triggerHour(sim);
    expect(unit.occupants).toBe(0);
  });

  it("restaurant is closed at 9:00 (between lunch and dinner windows)", () => {
    const { sim, unit } = venueFixture("restaurant");
    setHour(sim, 8);
    triggerHour(sim);
    expect(unit.occupants).toBe(0);
  });

  it("shop is closed at 22:00 (after 21:00 close)", () => {
    const { sim, unit } = venueFixture("shop");
    setHour(sim, 21);
    triggerHour(sim);
    expect(unit.occupants).toBe(0);
  });

  it("a tenanted-but-closed venue shows 0, not its population", () => {
    const { sim, unit } = venueFixture("restaurant");
    expect(unit.state).toBe("occupied");
    // Restaurant is only open 11-14 and 17-23; confirm zero at 3am.
    setHour(sim, 2);
    triggerHour(sim);
    expect(unit.occupants).toBe(0);
  });
});

// ---- Transition at boundary ---------------------------------------------------

describe("occupants flips at open/close hour boundaries", () => {
  it("fast food goes dark after 22:00 and lights up again at 7:00", () => {
    const { sim, unit } = venueFixture("fastFood");
    // Inside open window: 21:00 (22-1)
    setHour(sim, 20);
    triggerHour(sim); // now at hour 21
    expect(unit.occupants).toBe(FACILITIES.fastFood.population);

    // Past close: advance one more hour to 22:00
    triggerHour(sim);
    expect(unit.occupants).toBe(0);

    // Re-open at 7:00
    setHour(sim, 6);
    triggerHour(sim); // now at hour 7
    expect(unit.occupants).toBe(FACILITIES.fastFood.population);
  });
});
