import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { GRID, FACILITIES } from "../../engine/facilities";
import type { Unit } from "../../engine/types";

/** FAQ-parity (complete) tests: the canon star ladder, office noise, the
 * hotel-population rule and the VIP-in-suite gate. */

const W = GRID.width;
const C = Math.floor(W / 2);

function lay(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = C; x < W; x++) sim.tower.place(kind, floor, x);
  for (let x = C - 1; x >= 0; x--) sim.tower.place(kind, floor, x);
}
/** Fabricate `target` occupant-population of occupied offices across full floors. */
function towerWithPop(seed: number, target: number): Simulation {
  const sim = Simulation.newGame(seed);
  sim.money = 1e12;
  lay(sim, "lobby", 1);
  let pop = 0;
  let f = 2;
  while (pop < target && f <= 100) {
    lay(sim, "floor", f);
    for (let x = 0; x + 9 <= W && pop < target; x += 9) {
      const r = sim.tower.place("office", f, x);
      if (r.ok) {
        sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
        pop += FACILITIES.office.population;
      }
    }
    f++;
  }
  return sim;
}

describe("Canon star ladder (FAQ)", () => {
  it("4★ requires Medical + Recycling DEMAND MET + >1 Suite + a favorable VIP", () => {
    const sim = towerWithPop(1, 5200);
    sim.star = 3;
    const top = sim.tower.highestFloor + 1;
    lay(sim, "floor", top);
    sim.tower.place("medical", top, 0);
    sim.tower.place("security", top, 60);
    sim.evaluateStar();
    expect(sim.star).toBe(3); // blocked: no recycling / suites / VIP yet

    // Add the missing amenities — but only ONE recycling center for 5,200
    // population (a center processes ~2,500): demand unmet, still blocked.
    lay(sim, "floor", 0);
    lay(sim, "floor", -1);
    sim.tower.place("recycling", -1, 0);
    sim.tower.place("hotelSuite", top, 20);
    sim.tower.place("hotelSuite", top, 40);
    sim.vipFavorable = true;
    expect(sim.recyclingDemandMet()).toBe(false); // 5,200 pop > 2,500 capacity
    sim.evaluateStar();
    expect(sim.star).toBe(3); // canon: recycling DEMAND met, not merely built

    // Two more centers (7,500 capacity ≥ 5,200 pop) satisfy the demand.
    sim.tower.place("recycling", -1, 20);
    sim.tower.place("recycling", -1, 40);
    expect(sim.recyclingDemandMet()).toBe(true);
    sim.evaluateStar();
    expect(sim.star).toBe(4);
  });

  it("5★ requires a Metro Station", () => {
    const sim = towerWithPop(2, 10200);
    sim.star = 4;
    sim.vipFavorable = true;
    const top = sim.tower.highestFloor + 1;
    lay(sim, "floor", top);
    sim.tower.place("medical", top, 0);
    sim.tower.place("security", top, 60);
    for (let fl = 0; fl >= -5; fl--) lay(sim, "floor", fl);
    // 10,200 population needs five ~2,500-capacity centers (demand met).
    for (let i = 0; i < 5; i++) sim.tower.place("recycling", -2, i * 20); // each spans -2/-1
    sim.tower.place("hotelSuite", top, 20);
    sim.tower.place("hotelSuite", top, 40);
    sim.evaluateStar();
    expect(sim.star).toBe(4); // pop is there, but no Metro → capped at 4

    expect(sim.tower.place("metro", -5, 0).ok).toBe(true); // 3-floor metro at -5/-4/-3
    sim.evaluateStar();
    expect(sim.star).toBe(5);
  });
});

describe("Hotel population counts while climbing up through 4★ (FAQ)", () => {
  it("hotel guests count for the rating below 4★ but not at/above it", () => {
    const sim = Simulation.newGame(3);
    sim.money = 1e12;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    // 50 occupied single-hotel rooms = 50 guests (no offices).
    for (let i = 0, x = 0; i < 50 && x + 4 <= W; i++, x += 4) {
      const r = sim.tower.place("hotelSingle", 2, x);
      if (r.ok) sim.tower.units.find((u) => u.id === r.unitId)!.state = "asleep";
    }
    sim.star = 3;
    expect(sim.ratingPopulation()).toBeGreaterThan(0); // hotels count while climbing to 4★
    sim.star = 4;
    expect(sim.ratingPopulation()).toBe(0); // hotels excluded once at 4★
  });

  it("a 3★ tower can't leap to 5★ on hotel guests in one evaluateStar tick", () => {
    // Offices give ~5,400 occupant population: past the 4★ bar (5,000), short of
    // the 5★ bar (10,000). Hotel suites then pad the raw head count over 10,000.
    const sim = towerWithPop(7, 5400);
    sim.star = 3;
    const occupantPop = sim.tower.totalPopulation();
    expect(occupantPop).toBeGreaterThanOrEqual(5000);
    expect(occupantPop).toBeLessThan(10000);

    // Fill floors above the offices with occupied suites until the raw census
    // (offices + hotels) clears the 10,000 5★ bar.
    let f = sim.tower.highestFloor + 1;
    while (sim.tower.totalPopulation() < 10200 && f <= 100) {
      lay(sim, "floor", f);
      for (let x = 0; x + FACILITIES.hotelSuite.width <= W && sim.tower.totalPopulation() < 10200; x += FACILITIES.hotelSuite.width) {
        const r = sim.tower.place("hotelSuite", f, x);
        if (r.ok) sim.tower.units.find((u) => u.id === r.unitId)!.state = "asleep";
      }
      f++;
    }
    expect(sim.tower.totalPopulation()).toBeGreaterThanOrEqual(10000); // raw census over the 5★ bar
    expect(sim.ratingPopulation()).toBeGreaterThanOrEqual(10000); // display read at 3★ still counts hotels

    // Satisfy every 4★ and 5★ GATE so only the population census can hold the
    // rating back: Medical, Security, Recycling demand met, 2 Suites, VIP, Metro.
    const top = f;
    lay(sim, "floor", top);
    sim.tower.place("medical", top, 0);
    sim.tower.place("security", top, 60);
    sim.vipFavorable = true;
    for (let fl = 0; fl >= -8; fl--) lay(sim, "floor", fl);
    for (let i = 0; i < 6; i++) sim.tower.place("recycling", -2, i * 20); // 15,000 capacity ≥ census
    expect(sim.recyclingDemandMet()).toBe(true);
    expect(sim.tower.place("metro", -8, 0).ok).toBe(true);

    // Gates are all met and the RAW head count is over 10,000 — but the non-hotel
    // occupant census is not, so the tower promotes only to 4★, never leaping to
    // 5★ on hotel guests.
    sim.evaluateStar();
    expect(sim.star).toBe(4);

    // Add real (non-hotel) residents past 10,000 occupants and 5★ follows.
    let g = sim.tower.highestFloor + 1;
    while (sim.ratingPopulation() < 10200 && g <= 100) {
      lay(sim, "floor", g);
      for (let x = 0; x + FACILITIES.office.width <= W && sim.ratingPopulation() < 10200; x += FACILITIES.office.width) {
        const r = sim.tower.place("office", g, x);
        if (r.ok) sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
      }
      g++;
    }
    // Recycling must still meet the now-larger census for the 4★ gate to hold.
    for (let i = 0; i < 4; i++) sim.tower.place("recycling", -4, i * 20);
    expect(sim.recyclingDemandMet()).toBe(true);
    sim.evaluateStar();
    expect(sim.star).toBe(5);
  });
});

describe("Office noise (FAQ): offices annoy adjacent hotels/condos", () => {
  it("a hotel within the office noise band loses satisfaction; one well beyond it does not", () => {
    const sim = Simulation.newGame(4);
    sim.money = 1e12;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    sim.buildTransport("elevatorStandard", C, 1, 2); // floor 2 served
    // Office at C (width 9 ⇒ right edge at C+9); a hotel immediately to its right
    // sits inside the canon 21-tile band, another placed ~40 tiles away is beyond
    // it (W2 widened the old 1-tile rule to the documented 21-segment buffer).
    sim.tower.place("office", 2, C);
    const noisy = sim.tower.place("hotelDouble", 2, C + 9);
    const quiet = sim.tower.place("hotelDouble", 2, C + 40);
    const a = sim.tower.units.find((u) => u.id === noisy.unitId)!;
    const b = sim.tower.units.find((u) => u.id === quiet.unitId)!;
    for (const u of [a, b]) { u.state = "asleep"; u.satisfaction = 1; }
    for (let i = 0; i < 6; i++) sim.tick(60);
    expect(a.satisfaction).toBeLessThan(b.satisfaction); // the in-band neighbor suffers
  });
});

describe("VIP stay (FAQ): only in a suite, gates the favorable review", () => {
  /** A served suite hotel, optionally with the canon one-space-per-suite parking. */
  function suiteTower(withParking: boolean): { sim: Simulation; suite: Unit } {
    const sim = Simulation.newGame(5);
    sim.money = 1e12;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    sim.buildTransport("elevatorStandard", C, 1, 2);
    sim.star = 3;
    if (withParking) {
      lay(sim, "floor", 0);
      sim.tower.place("parkingRamp", 0, C);
      sim.tower.place("parking", 0, C + 16); // one working space chained flush to the 16-wide ramp
    }
    const r = sim.tower.place("hotelSuite", 2, 0);
    expect(r.ok).toBe(true); // fail loudly here, not with a null deref later
    const suite = sim.tower.units.find((u) => u.id === r.unitId);
    expect(suite).toBeDefined();
    return { sim, suite: suite! };
  }

  it("a well-run served suite WITH its parking space earns a favorable VIP review", () => {
    const { sim, suite } = suiteTower(true);
    expect(sim.vipFavorable).toBe(false);
    expect(sim.vipVisits).toBe(0);
    for (let i = 0; i < 15; i++) sim.tick(60); // 07:00 → 22:00 (past the 08:00 checkout)
    suite.state = "asleep"; // a guest checks into the suite for the night
    suite.satisfaction = 1;
    for (let i = 0; i < 3; i++) sim.tick(60); // 22:00 → 01:00, crossing midnight (the VIP check)
    expect(sim.vipFavorable).toBe(true);
    expect(sim.vipVisits).toBe(1); // the favorable stay is a counted visit
    // Once the review is earned the VIP stops calling: another night with a
    // guest in the suite adds no further visits.
    suite.state = "asleep";
    suite.satisfaction = 1;
    for (let i = 0; i < 24; i++) sim.tick(60);
    expect(sim.vipVisits).toBe(1);
  });

  it("canon: no parking space per suite → the VIP drives off, no review", () => {
    const { sim, suite } = suiteTower(false);
    for (let i = 0; i < 15; i++) sim.tick(60);
    suite.state = "asleep";
    suite.satisfaction = 1;
    for (let i = 0; i < 3; i++) sim.tick(60);
    expect(sim.suiteParkingShort()).toBe(true);
    expect(sim.vipFavorable).toBe(false); // blocked purely by the missing space
    // The drive-off still counts as a visit the player was told about, and the
    // counter rides the 5-day nag throttle: the very next night's failed visit
    // does not add another.
    expect(sim.vipVisits).toBe(1);
    suite.state = "asleep";
    suite.satisfaction = 1;
    for (let i = 0; i < 24; i++) sim.tick(60); // crosses the next midnight
    expect(sim.vipVisits).toBe(1);
  });
});

describe("Events & amounts (FAQ Cluster B)", () => {
  it("rain depresses commercial income vs a clear day", () => {
    function dayIncome(weather: "clear" | "rain"): number {
      const sim = Simulation.newGame(7);
      sim.money = 1e12;
      sim.star = 3;
      lay(sim, "lobby", 1);
      lay(sim, "floor", 2);
      sim.buildTransport("elevatorStandard", C, 1, 2);
      const r = sim.tower.place("fastFood", 2, 0);
      sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
      sim.weather = weather; // stays fixed within the day (no day boundary crossed)
      const before = sim.money;
      for (let i = 0; i < 10; i++) sim.tick(60); // 07:00→17:00, fast food open
      return sim.money - before;
    }
    expect(dayIncome("rain")).toBeLessThan(dayIncome("clear"));
  });

  it("a cinema carries a recurring film-booking cost, per its maintenance period", () => {
    const sim = Simulation.newGame(8);
    sim.money = 1e9;
    sim.star = 3;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    lay(sim, "floor", 3);
    expect(sim.tower.place("cinema", 2, 0).ok).toBe(true); // spans floors 2–3
    const before = sim.money;
    // The film booking is charged once per maintenance period, scaled to keep
    // per-in-game-day upkeep calendar-invariant (Classic's canon 3-day period,
    // 1/10 of a real-world 30-day charge, ten times as often).
    const scale = sim.clock.calendar.maintPeriodDays / 30;
    sim.tick(60 * 24); // crosses the first day, maintenance runs
    expect(before - sim.money).toBeGreaterThanOrEqual(Math.round(150_000 * scale));
  });

  it("an unguarded bomb levels several rooms across ~5 floors", () => {
    const sim = Simulation.newGame(9);
    sim.money = 1e9;
    sim.star = 4;
    const x0 = C - 20;
    for (let f = 2; f <= 8; f++) {
      lay(sim, "floor", f);
      for (let i = 0; i < 4; i++) {
        const r = sim.tower.place("office", f, x0 + i * 9);
        if (r.ok) sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
      }
    }
    const liveBefore = sim.tower.units.filter((u) => u.kind === "office" && u.state === "occupied").length;
    sim.bombThreat(); // no security built
    const liveAfter = sim.tower.units.filter((u) => u.kind === "office" && u.state === "occupied").length;
    expect(liveBefore - liveAfter).toBeGreaterThan(1); // more than a single room destroyed
  });

  it("buried treasure is worth about half a million", () => {
    const sim = Simulation.newGame(42);
    sim.money = 1e9;
    sim.star = 3;
    for (let x = 0; x < 60; x++) sim.tower.place("floor", 0, C - 30 + x);
    for (let i = 0; i + 6 <= 60; i += 6) sim.build("parking", 0, C - 30 + i); // distinct fresh tiles
    const treasure = sim.log.find((e) => e.text.toLowerCase().includes("treasure"));
    expect(treasure).toBeDefined();
    const amount = Number(treasure!.text.replace(/[^0-9]/g, ""));
    expect(amount).toBeGreaterThanOrEqual(400_000);
  });
});

describe("Office parking demand (FAQ): offices want parking from 3★", () => {
  function occupiedFill(withParking: boolean): number {
    const sim = Simulation.newGame(123);
    sim.money = 1e12;
    lay(sim, "lobby", 1);
    for (let f = 2; f <= 4; f++) lay(sim, "floor", f);
    sim.buildTransport("elevatorStandard", W - 6, 1, 4);
    sim.tower.setCars(sim.tower.transports[0].id, 8);
    // Pre-occupy a block of offices on floor 2 to create real parking demand.
    for (let x = 0; x + 9 <= 180; x += 9) {
      const r = sim.tower.place("office", 2, x);
      if (r.ok) sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
    }
    // Empty offices on floors 3–4 are the ones that will (or won't) fill.
    for (let f = 3; f <= 4; f++) for (let x = 0; x + 9 <= 180; x += 9) sim.tower.place("office", f, x);
    sim.star = 3;
    if (withParking) {
      lay(sim, "floor", 0);
      sim.tower.place("parkingRamp", 0, 0); // 16-wide ramp; spots must chain to it
      for (let x = 16; x + 4 <= W; x += 4) sim.tower.place("parking", 0, x); // ample parking, flush chain
    }
    for (let i = 0; i < 12; i++) sim.tick(60); // a Monday's working hours
    return sim.tower.units.filter((u) => u.kind === "office" && u.floor >= 3 && u.state === "occupied").length;
  }
  it("ample parking fills new offices faster than none (same seed)", () => {
    expect(occupiedFill(true)).toBeGreaterThan(occupiedFill(false));
  });
});

describe("Interactive event choices (FAQ): fire rescue / bomb ransom", () => {
  it("offers a paid choice the player can accept (pays exactly the quoted cost)", () => {
    const sim = Simulation.newGame(1);
    sim.money = 1e9;
    sim.star = 4; // enables both fire and bomb-threat rolls
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    sim.buildTransport("elevatorStandard", C, 1, 2);
    for (let x = 0; x + 9 <= 180; x += 9) sim.tower.place("office", 2, x); // flammable rooms

    let guard = 0;
    while (!sim.pendingChoice && guard++ < 600) sim.tick(60 * 24);
    expect(sim.pendingChoice).not.toBeNull();
    const cost = sim.pendingChoice!.cost; // 500k (fire rescue) or 300k (ransom)
    const before = sim.money;
    sim.resolveChoice("accept");
    expect(before - sim.money).toBe(cost);
    expect(sim.pendingChoice).toBeNull();
  });
});

import { STAR_THRESHOLDS, TOWER_POPULATION } from "../../engine/facilities";

describe("Deep-review regressions (must not come back)", () => {
  it("D1: cockroaches spread even with ZERO housekeeping (worst case isn't immune)", () => {
    const sim = Simulation.newGame(1);
    sim.money = 1e9;
    sim.star = 3;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    sim.buildTransport("elevatorStandard", C, 1, 2);
    const a = sim.tower.place("hotelDouble", 2, 0);
    const b = sim.tower.place("hotelDouble", 2, 6); // adjacent (double is 6 wide)
    const r1 = sim.tower.units.find((u) => u.id === a.unitId)!;
    const r2 = sim.tower.units.find((u) => u.id === b.unitId)!;
    r1.state = "dirty"; // no housekeeping anywhere
    for (let i = 0; i < 24; i++) sim.tick(60);
    expect(r2.state).toBe("dirty"); // infestation spread from r1 → r2
  });

  it("D25: a condo next to an office is worn down by noise and eventually gives notice + moves out", () => {
    const sim = Simulation.newGame(2, "modern"); // noise EVICTION is the Modern churn feature (Classic caps, never evicts)
    sim.money = 1e9;
    sim.star = 1; // 1★ → no random fire/bomb events, isolating the noise effect
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    sim.buildTransport("elevatorStandard", C, 1, 2);
    sim.tower.place("office", 2, 0);
    const cr = sim.tower.place("condo", 2, 9); // immediately right of the office
    const condo = sim.tower.units.find((u) => u.id === cr.unitId)!;
    condo.state = "occupied";
    condo.everOccupied = true;
    condo.satisfaction = 1;
    // The annoyance ceiling bites at once (≤0.6) and the unit reddens, but a
    // sold condo is an owner and erodes at the gentler condo rate, so it takes
    // ≈ a week of SUSTAINED, unaddressed adjacency to go on notice — attributed
    // to noise, the canon "office neighbor is too noisy" complaint. (A neighbor
    // removed in time is absorbed and never evicts — see the stickiness test.)
    let onNotice = false;
    for (let i = 0; i < 24 * 8 && !onNotice; i++) {
      sim.tick(60);
      // Cast defeats TS control-flow narrowing from the `state = "occupied"`
      // assignment above — `sim.tick` mutates it, but the compiler can't see that.
      onNotice = (condo.state as string) === "vacating";
    }
    expect(onNotice).toBe(true);
    expect(condo.vacateReason).toBe("noise");
    // Left unaddressed, the notice runs out and the tenant leaves for good. (The
    // now-empty, well-served unit may re-let to a fresh resident afterward, so we
    // assert the departure actually fired via its toast, not the transient state.)
    for (let i = 0; i < 24 * 3; i++) sim.tick(60);
    expect(sim.log.some((e) => /(A tenant|The owner) left .*a noisy neighbor nearby/.test(e.text))).toBe(true);
  });

  it("D25b: removing the noisy office lets a condo on notice recover and stay", () => {
    const sim = Simulation.newGame(2, "modern"); // noise recovery from the Modern erosion mechanic
    sim.money = 1e9;
    sim.star = 1;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    sim.buildTransport("elevatorStandard", C, 1, 2);
    const or = sim.tower.place("office", 2, 0);
    const office = sim.tower.units.find((u) => u.id === or.unitId)!;
    const cr = sim.tower.place("condo", 2, 9);
    const condo = sim.tower.units.find((u) => u.id === cr.unitId)!;
    condo.state = "occupied";
    condo.everOccupied = true;
    condo.satisfaction = 1;
    // Wear it onto notice over ≈ a week (cast defeats narrowing from `state =
    // "occupied"`).
    for (let i = 0; i < 24 * 8 && (condo.state as string) !== "vacating"; i++) sim.tick(60);
    expect(condo.state).toBe("vacating");
    // …then fix the cause: remove the office. Noise gone → satisfaction recovers
    // and the tenant rescinds before the notice window elapses.
    sim.tower.removeUnit(office.id);
    for (let i = 0; i < 24; i++) sim.tick(60);
    expect(condo.state).toBe("occupied");
    expect(condo.vacateReason).toBeUndefined();
  });

  it("D25c: a sold condo is sticky; a transient noisy neighbor annoys but never evicts an owner", () => {
    const sim = Simulation.newGame(2, "modern"); // sold-condo stickiness under the Modern noise erosion
    sim.money = 1e9;
    sim.star = 1;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    sim.buildTransport("elevatorStandard", C, 1, 2);
    const or = sim.tower.place("office", 2, 0);
    const office = sim.tower.units.find((u) => u.id === or.unitId)!;
    const cr = sim.tower.place("condo", 2, 9); // immediately right of the office
    const condo = sim.tower.units.find((u) => u.id === cr.unitId)!;
    condo.state = "occupied";
    condo.everOccupied = true;
    condo.satisfaction = 1;
    // Four days of noise — well inside the ≈ week-long condo fuse. The owner is
    // annoyed (satisfaction sinks below the cap, so the unit reddens) but an
    // owner is not a lessee: it never goes on notice over a transient neighbor.
    for (let i = 0; i < 24 * 4; i++) {
      sim.tick(60);
      expect(condo.state as string).toBe("occupied"); // never once put on notice
    }
    expect(condo.satisfaction).toBeLessThan(0.6); // genuinely annoyed, well below full
    // Remove the office in time and the owner recovers fully — no churn.
    sim.tower.removeUnit(office.id);
    for (let i = 0; i < 24; i++) sim.tick(60);
    expect(condo.state).toBe("occupied");
    expect(condo.satisfaction).toBeGreaterThan(0.9); // recovered to happy
  });

  it("D10: buried treasure is capped per tower (no basement parking farm)", () => {
    const sim = Simulation.newGame(42);
    sim.money = 1e9;
    sim.star = 3;
    for (let fl = 0; fl >= -3; fl--) for (let x = 0; x < W; x++) sim.tower.place("floor", fl, x);
    for (let fl = 0; fl >= -3; fl--) for (let x = 0; x + 6 <= W; x += 6) sim.build("parking", fl, x);
    const treasures = sim.log.filter((e) => e.text.toLowerCase().includes("treasure")).length;
    expect(treasures).toBeGreaterThan(0);
    expect(treasures).toBeLessThanOrEqual(3); // capped
  });

  it("D24: an unresolved event choice survives save/reload (no bomb save-scum)", () => {
    const sim = Simulation.newGame(1);
    sim.money = 1e9;
    sim.star = 4;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    sim.buildTransport("elevatorStandard", C, 1, 2);
    for (let x = 0; x + 9 <= 180; x += 9) sim.tower.place("office", 2, x);
    let guard = 0;
    while (!sim.pendingChoice && guard++ < 600) sim.tick(60 * 24);
    expect(sim.pendingChoice).not.toBeNull();
    const reloaded = Simulation.deserialize(sim.serialize());
    expect(reloaded.pendingChoice).not.toBeNull();
    expect(reloaded.pendingChoice!.kind).toBe(sim.pendingChoice!.kind);
  });

  it("D14: the star ladder is internally consistent (5★ ≤ TOWER target, both within the lot)", () => {
    expect(STAR_THRESHOLDS[5]).toBeLessThanOrEqual(TOWER_POPULATION); // 5★ reachable before TOWER
    expect(TOWER_POPULATION).toBeLessThanOrEqual(15100); // within the widened lot's measured ceiling (~15,066)
  });
});

import { ECON } from "../../engine/econConfig";

describe("Fine FAQ mechanics", () => {
  it("≤2-ride limit: a trip needing 3 rides doesn't route; a 2-ride trip does", () => {
    const sim = Simulation.newGame(1);
    sim.money = 1e12;
    const x0 = C - 15;
    for (let x = x0; x < x0 + 30; x++) sim.tower.place("lobby", 1, x);
    for (let f = 2; f <= 45; f++) for (let x = x0; x < x0 + 30; x++) sim.tower.place("floor", f, x);
    sim.tower.placeTransport("elevatorStandard", x0, 1, 15);       // A
    sim.tower.placeTransport("elevatorStandard", x0 + 6, 15, 30);  // B (transfer at 15)
    sim.tower.placeTransport("elevatorStandard", x0 + 12, 30, 45); // C (transfer at 30)
    expect(sim.crowd.route(sim.tower, 1, 25)).not.toBeNull(); // A→15, B→25 = 2 rides
    expect(sim.crowd.route(sim.tower, 1, 40)).toBeNull();     // would need A→15→30→40 = 3 rides
  });

  it("blockbuster vs average film: two-tier booking cost exists and both occur", () => {
    expect(ECON.cinemaBookingBlockbuster).toBeGreaterThan(ECON.cinemaBookingMonthly);
    // Classic on purpose: this isolates the cinema BOOKING mechanic (which exists
    // in both modes) from the Modern-only operating overhead, so the assertion
    // reads the booking cost alone rather than folding in an unrelated sink.
    const sim = Simulation.newGame(3);
    // This test only exercises the recurring booking economy (no crowd/spatial
    // sim), so run the lighter v1 model (one step per tick instead of 24 hourly
    // sub-steps) which keeps a year-long loop well under the CI timeout.
    sim.simModel = "v1";
    sim.money = 1e12;
    sim.star = 1; // star 1 gates random fires (which would gut the lone cinema); this
    // test only exercises the recurring booking economy, which is star-independent.
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    lay(sim, "floor", 3);
    sim.tower.place("cinema", 2, 0); // in Classic the cinema's only recurring cost is the film booking
    for (let d = 0; d < 365; d++) sim.tick(60 * 24);
    // The booking is the tower's only upkeep here, so the maintenance charge IS
    // the booking, scaled to the calendar's period (Classic's canon 3-day period
    // is 1/10). The maintenance log entry reads "Monthly maintenance paid" under
    // real-world and "Maintenance paid" under canon; match either so the filter
    // stays calendar-agnostic if the sim ever runs this fixture on real-world.
    const scale = sim.clock.calendar.maintPeriodDays / 30;
    const bookings = sim.log
      .filter((e) => /maintenance paid/i.test(e.text))
      .map((e) => Number(e.text.replace(/[^0-9]/g, "")));
    expect(bookings.some((c) => c === Math.round(ECON.cinemaBookingBlockbuster * scale))).toBe(true); // some blockbuster periods
    expect(bookings.some((c) => c === Math.round(ECON.cinemaBookingMonthly * scale))).toBe(true); // some average periods
  });

  it("strict parking alignment: only ramp-chained spaces function", () => {
    const sim = Simulation.newGame(4);
    sim.money = 1e12;
    const x0 = C - 20; // start inside the seeded centre lobby so the strip connects
    for (let x = x0; x < x0 + 140; x++) sim.tower.place("lobby", 1, x);
    for (let x = x0; x < x0 + 140; x++) sim.tower.place("floor", 0, x);
    // No ramp yet → nothing functions.
    sim.tower.place("parking", 0, x0 + 16);
    expect(sim.tower.functionalParkingSpots()).toBe(0);
    // Ramp at x0..x0+15, a chain of two flush spaces (x0+16, x0+20), plus an isolated one.
    sim.tower.place("parkingRamp", 0, x0);
    sim.tower.place("parking", 0, x0 + 20);
    sim.tower.place("parking", 0, x0 + 120); // gap → dead X, not connected
    expect(sim.tower.functionalParkingSpots()).toBe(2); // the two chained spaces, not the isolated one
  });
});

describe("Canon-numbers review regressions (must not come back)", () => {
  it("m1: the whole-lot Metro spans the full lot width", () => {
    expect(FACILITIES.metro.width).toBe(GRID.width); // must track any GRID.width change
  });

  it("M2: stacked parking with no ramp between floors does NOT connect", () => {
    const sim = Simulation.newGame(4);
    sim.money = 1e12;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 0);
    lay(sim, "floor", -1);
    lay(sim, "floor", -2);
    // Ramp + one chained space on B2; a space on B1 directly above the B2 space
    // but with NO ramp on B1 — it must stay a dead X (cars need a ramp to climb).
    sim.tower.place("parkingRamp", -2, C);
    sim.tower.place("parking", -2, C + 6);
    sim.tower.place("parking", -1, C + 6);
    expect(sim.tower.functionalParkingSpots()).toBe(1); // only the ramp-chained B2 space
  });

  it("M3: blockbuster bookings survive save/reload", () => {
    const sim = Simulation.newGame(3);
    sim.money = 1e12;
    sim.star = 1; // keep random events (fire) out of the way
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    lay(sim, "floor", 3);
    sim.tower.place("cinema", 2, 0); // spans 2–3
    // Advance month-by-month until a blockbuster is booked.
    let guard = 0;
    while ((sim.serialize().blockbusters ?? []).length === 0 && guard++ < 48) sim.tick(60 * 24 * 31);
    const before = sim.serialize().blockbusters ?? [];
    expect(before.length).toBeGreaterThan(0);
    const reloaded = Simulation.deserialize(sim.serialize());
    expect(reloaded.serialize().blockbusters ?? []).toEqual(before); // boost preserved, not silently dropped
  });
});
