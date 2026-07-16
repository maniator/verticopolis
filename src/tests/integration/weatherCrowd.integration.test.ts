import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { Tower } from "../../engine/Tower";
import { Clock } from "../../engine/Clock";
import { RNG } from "../../engine/rng";
import { EconomySystem } from "../../engine/EconomySystem";
import { MODERN_RULES } from "../../engine/gameRules";
import { FACILITIES } from "../../engine/facilities";
import type { FacilityKind, WeatherKind } from "../../engine/types";

/**
 * Weather shapes the actual crowd (#430). Before this, weather touched commerce
 * only through the `rainMult` income multiplier in `collectTrafficIncome`; the
 * crowd itself was weather-blind, so the visible people and the attendance-venue
 * fill stayed full in the rain while the money quietly dropped. Now rain thins
 * the people actually out and about at the spawn layer (`GameRules.rainCrowdFactor`
 * on the spawn accumulator, which draws no RNG), so an attendance house fills less
 * because fewer people show up. To avoid double-counting the weather now that
 * attendance income reads the live fill (#424), `rainMult` is dropped for
 * attendance venues (cinema, party hall); retail keeps it, since retail income is
 * statistical and does not read the drawn crowd.
 *
 * These are the two magnitudes the game actually observes: a thinner drawn crowd
 * (Test A), and the economy consequence (Test C: retail still pays the rain
 * multiplier, attendance no longer does). Test B ties them together end to end.
 */

const CLEAR_DAY = 3; // weatherFor(3) === "clear"
const RAIN_DAY = 10; // weatherFor(10) === "rain"; 7 days after CLEAR_DAY, so same weekday phase

const W = 40;
/** Floors 2-3 are left as clear slab so a two-story cinema (width 31) has room;
 *  the crowd sources (offices, condos) sit on 4..7. */
const SOURCE_FLOORS = [4, 5, 6, 7];

/** A modern tower with occupied offices and condos on floors 4..7 and one
 *  elevator spanning the tower, so the spawn layer has commuters and residents to
 *  move. Modern mode gives the realWorld 7-day calendar, so two days a week apart
 *  share a weekday phase and only the weather differs. Floors 2-3 stay clear for
 *  the cinema the end-to-end test drops in. */
function populatedTower(seed: number, sourceFloors: number[] = SOURCE_FLOORS): Simulation {
  const sim = new Simulation(seed, "modern", "realWorld");
  sim.money = 500_000_000;
  sim.star = 5;
  for (let x = 0; x < W; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
  for (let f = 2; f <= 7; f++) {
    for (let x = 0; x < W; x++) expect(sim.tower.place("floor", f, x).ok).toBe(true);
  }
  expect(sim.tower.placeTransport("elevatorStandard", 0, 1, 7).ok).toBe(true);
  for (const f of sourceFloors) {
    const office = sim.tower.place("office", f, 0);
    expect(office.ok, office.reason).toBe(true);
    const condo = sim.tower.place("condo", f, 12);
    expect(condo.ok, condo.reason).toBe(true);
  }
  for (const u of sim.tower.units) {
    if (u.kind === "office") {
      u.state = "occupied";
      u.occupants = FACILITIES.office.population;
    } else if (u.kind === "condo") {
      u.state = "occupied";
      u.occupants = FACILITIES.condo.population;
    }
  }
  return sim;
}

/** Drive the spawn cadence only (no motion, so nobody despawns) for a fixed
 *  span of crowd-seconds at a fixed clock, and return how many people the tower
 *  put on the move. With motion held out, `people.length` is exactly the number
 *  spawned, an isolated read of the spawn rate. */
function spawnedOver(sim: Simulation, clock: Clock, seconds: number): number {
  const DT = 1;
  // Pass sim.weather exactly as the production loop does, so this exercises the
  // single authoritative weather source the crowd and economy share.
  for (let s = 0; s < seconds; s += DT) sim.crowd.spawn(DT, sim.tower, clock, sim.weather);
  return sim.crowd.people.length;
}

describe("rain thins the drawn crowd (#430)", () => {
  it("spawns fewer people on a rainy day than a clear one, same hour and weekday", () => {
    const clearSim = populatedTower(4242);
    const rainSim = populatedTower(4242); // identical seed → identical crowd RNG start
    clearSim.weather = Simulation.weatherFor(CLEAR_DAY); // "clear"
    rainSim.weather = Simulation.weatherFor(RAIN_DAY); // "rain"
    expect(clearSim.weather).toBe("clear"); // pin the day choices these fixtures rely on
    expect(rainSim.weather).toBe("rain");
    const cal = clearSim.clock.calendar;
    // 08:00 morning rush on each day. Seven days apart, so the weekday phase (and
    // thus the spawn time-rate) is identical; only the weather differs.
    const clearClock = new Clock((CLEAR_DAY * 24 + 8) * 60, cal);
    const rainClock = new Clock((RAIN_DAY * 24 + 8) * 60, cal);
    expect(clearClock.isWeekend).toBe(rainClock.isWeekend); // isolate weather from the weekend rate

    const SECONDS = 90;
    const clearCount = spawnedOver(clearSim, clearClock, SECONDS);
    const rainCount = spawnedOver(rainSim, rainClock, SECONDS);

    // A meaningful sample on the clear day, strictly thinner in the rain, and not
    // wiped out (people still travel, just fewer of them). Well under MAX_PEOPLE so
    // neither run is clipped by the cap (which would flatten the comparison).
    expect(clearCount).toBeGreaterThan(20);
    expect(clearCount).toBeLessThan(140);
    expect(rainCount).toBeLessThan(clearCount);
    expect(rainCount).toBeGreaterThan(clearCount * 0.4);
  });

  it("thins on the passed weather, not the clock's day-hash (one source shared with the economy)", () => {
    // Hold the clock on a single clear-by-hash day and vary ONLY the weather value
    // the loop passes in. The crowd must thin when told it is raining, proving it
    // reads the authoritative `sim.weather` (the same value the income loop reads),
    // never a second derivation off `weatherFor(clock.day)` that could disagree.
    const rainForced = populatedTower(4242);
    rainForced.weather = "rain";
    const clearForced = populatedTower(4242);
    clearForced.weather = "clear";
    const cal = clearForced.clock.calendar;
    const clock = new Clock((CLEAR_DAY * 24 + 8) * 60, cal); // a clear day by the hash
    expect(Simulation.weatherFor(CLEAR_DAY)).toBe("clear"); // so only the passed value differs
    const SECONDS = 90;
    const rainCount = spawnedOver(rainForced, clock, SECONDS);
    const clearCount = spawnedOver(clearForced, clock, SECONDS);
    expect(clearCount).toBeGreaterThan(20);
    expect(rainCount).toBeLessThan(clearCount);
  });
});

/** Single-venue traffic-income harness (mirrors commercialDemandPools' sanctioned
 *  SimContext): drive `collectTrafficIncome` once with a fixed noon clock and a
 *  freshly seeded RNG, so the per-hour take is a clean, reproducible function of
 *  the weather alone. Modern rules so a lone venue clears the demand floor and
 *  earns a nonzero baseline even with no surrounding population. */
function venueHourIncome(
  kind: FacilityKind,
  weather: WeatherKind,
  opts: { customersIn?: number } = {},
): number {
  const tower = new Tower();
  tower.rules = MODERN_RULES;
  // Assert every dependent placement lands (AGENTS.md fixture rule): a silently
  // refused lobby/floor/elevator would degrade the tower and let the income
  // assertions pass for the wrong reason.
  for (let x = 0; x < W; x++) expect(tower.place("lobby", 1, x).ok).toBe(true);
  for (let x = 0; x < W; x++) expect(tower.place("floor", 2, x).ok).toBe(true);
  // Floor 3 gives headroom for a two-story venue (cinema).
  for (let x = 0; x < W; x++) expect(tower.place("floor", 3, x).ok).toBe(true);
  const ev = tower.placeTransport("elevatorStandard", 0, 1, 3);
  expect(ev.ok, ev.reason).toBe(true);
  const r = tower.place(kind, 2, 5);
  expect(r.ok, r.reason).toBe(true);
  const venue = tower.units.find((u) => u.id === r.unitId)!;
  venue.state = "occupied";
  if (opts.customersIn !== undefined) venue.customersIn = opts.customersIn;
  let money = 0;
  const ctx = {
    tower,
    clock: new Clock(12 * 60), // noon: both fast food and cinema are open
    rng: new RNG(1), // same seed every call, so the trafficFactor draw is identical
    weather,
    get money() {
      return money;
    },
    set money(v: number) {
      money = v;
    },
    star: 5,
    rules: MODERN_RULES,
    emit: () => {},
    hasAny: (k: FacilityKind) => tower.units.some((u) => u.kind === k),
    hasOperational: (k: FacilityKind) =>
      tower.units.some((u) => u.kind === k && u.state !== "construction" && u.state !== "fire"),
    floorLabel: (f: number) => `${f}`,
  };
  const econ = new EconomySystem(ctx);
  econ.collectTrafficIncome();
  // pendingIncome holds the sub-dollar remainder; add it back so a small
  // single-hour take is measured to the fraction, not truncated to whole dollars.
  return money + (venue.pendingIncome ?? 0);
}

describe("rain's economy channel is one source of truth per venue kind (#430)", () => {
  it("retail still pays the rain multiplier (its income is statistical, not crowd-read)", () => {
    // Fast food takes the harshest canon hit: 0.5 (no metro) x 0.6 fast-food bite.
    const clear = venueHourIncome("fastFood", "clear");
    const rain = venueHourIncome("fastFood", "rain");
    expect(clear).toBeGreaterThan(0);
    expect(rain).toBeLessThan(clear);
    expect(rain).toBeCloseTo(clear * 0.5 * 0.6, 6);
  });

  it("attendance venues no longer pay the rain multiplier (the thinner crowd is their only rain channel)", () => {
    // A cinema at a fixed fill earns the same in rain as in clear: with rainMult
    // dropped for attendance, the ONLY way weather reaches it is a smaller
    // customersIn, which the spawn-layer thinning produces (Tests A and B). Holding
    // the fill fixed here isolates the economy half: no double-count remains.
    const cap = FACILITIES.cinema.attendance!;
    const clear = venueHourIncome("cinema", "clear", { customersIn: cap });
    const rain = venueHourIncome("cinema", "rain", { customersIn: cap });
    expect(clear).toBeGreaterThan(0);
    expect(rain).toBe(clear);
  });
});

describe("attendance fill follows the thinner crowd end to end (#430)", () => {
  it("a cinema draws a smaller audience over a rainy afternoon than a clear one", () => {
    // Cumulative fill (person-minutes) over the window, not the peak: a big enough
    // audience saturates the 30-seat cap on both days, so the peak is a poor
    // signal, but a rainy house fills SLOWER, so it accumulates fewer occupied
    // seat-minutes across the afternoon. That integral is the observable the issue
    // cares about (the audience the art draws), and it moves monotonically with the
    // spawn rate.
    const attendanceMinutes = (day: number): number => {
      // A single office+condo source (floor 4): a small enough audience that the
      // 30-seat house does not pin at its cap the whole window, so the fill rate,
      // not the cap, is the binding constraint and the weather signal shows. A
      // large audience would saturate both days and mask it.
      const sim = populatedTower(909, [4]);
      // A reachable, open two-story cinema (floors 2-3) drawing on that crowd.
      const c = sim.tower.place("cinema", 2, 4);
      expect(c.ok, c.reason).toBe(true);
      const cinema = sim.tower.units.find((u) => u.id === c.unitId)!;
      cinema.state = "occupied";
      sim.clock = new Clock((day * 24 + 12) * 60, sim.clock.calendar); // start at noon, cinema open
      sim.weather = Simulation.weatherFor(day); // keep the whole sim's weather consistent with the day
      let seatMinutes = 0;
      // Four open afternoon hours; integrate the live house minute by minute.
      for (let m = 0; m < 4 * 60; m++) {
        sim.tick(1);
        seatMinutes += cinema.customersIn ?? 0;
      }
      return seatMinutes;
    };
    const clearMinutes = attendanceMinutes(CLEAR_DAY);
    const rainMinutes = attendanceMinutes(RAIN_DAY);
    expect(clearMinutes).toBeGreaterThan(0); // the house does draw an audience on a clear day
    expect(rainMinutes).toBeLessThan(clearMinutes); // and a smaller one in the rain
  });
});
