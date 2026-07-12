import { describe, it, expect } from "vitest";
import { Simulation } from "../engine/Simulation";
import { GRID } from "../engine/facilities";

const W = GRID.width;
const C = Math.floor(W / 2);

/**
 * Phase 2 (BMAD review F4 + spatial model) tests. Behavior changes land behind
 * `simModel: "v1" | "v2"`; v1 is the shipped, suite-pinned model and v2 is built
 * up step by step. Step 1 here: the real hourly clock.
 */

describe("F4 / Step 1 — v2 integrates per hour; v1 keeps the sampled behavior", () => {
  it("v1 fires onHour at most once for a multi-hour tick (the documented sampling)", () => {
    const sim = Simulation.newGame(1); // starts Mon 07:00
    sim.simModel = "v1"; // pin the legacy sampled model (v2 is now the default)
    sim.tick(60 * 5); // 07:00 -> 12:00
    expect(sim.hourTicks).toBe(1); // sampled: one onHour despite 5 hours elapsing
    expect(sim.clock.day).toBe(0);
  });

  it("v2 fires onHour once per elapsed hour and onDay per elapsed day", () => {
    const sim = Simulation.newGame(1);
    sim.simModel = "v2";
    sim.tick(60); // warm-up so lastHour settles on the current hour boundary
    const base = sim.hourTicks;
    const day0 = sim.clock.day;

    sim.tick(60 * 5); // 5 more hours
    expect(sim.hourTicks - base).toBe(5);

    sim.tick(60 * 24); // a full further day
    expect(sim.hourTicks - base).toBe(5 + 24);
    expect(sim.clock.day).toBe(day0 + 1);
  });

  it("v2 advances the same total game time as v1 (sub-stepping is exact)", () => {
    const a = Simulation.newGame(2);
    a.simModel = "v1";
    const b = Simulation.newGame(2);
    b.simModel = "v2";
    a.tick(247); // arbitrary, not hour-aligned
    b.tick(247);
    expect(b.clock.minutes).toBe(a.clock.minutes);
  });
});

describe("F3 / Step 2 — spatial congestion (v2): layout and parallel shafts matter", () => {
  function lay(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
    for (let x = C; x < W; x++) sim.tower.place(kind, floor, x);
    for (let x = C - 1; x >= 0; x--) sim.tower.place(kind, floor, x);
  }
  /** A v2 tower with a full-width ground lobby and floors 2..top, no transport. */
  function clusterTower(seed: number, top: number): Simulation {
    const sim = Simulation.newGame(seed);
    sim.simModel = "v2";
    sim.money = 1_000_000_000;
    lay(sim, "lobby", 1);
    for (let f = 2; f <= top; f++) lay(sim, "floor", f);
    return sim;
  }
  function fillFloor(sim: Simulation, floor: number, count: number): void {
    let placed = 0;
    for (let x = 0; x + 9 <= W && placed < count; x += 9) {
      const r = sim.tower.place("office", floor, x);
      if (r.ok) {
        sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
        placed++;
      }
    }
  }

  it("adding a parallel shaft relieves a congested band", () => {
    const sim = clusterTower(1, 10);
    for (let f = 2; f <= 10; f++) fillFloor(sim, f, 18); // a packed 9-floor band on one shaft
    sim.buildTransport("elevatorStandard", W - 6, 1, 10);
    sim.tower.setCars(sim.tower.transports[0].id, 1); // deliberately weak
    const before = sim.congestionAt(8);
    expect(before).toBeGreaterThan(1); // the band overwhelms one weak shaft

    sim.buildTransport("elevatorStandard", W - 12, 1, 10); // a second parallel shaft
    sim.tower.setCars(sim.tower.transports[1].id, 1);
    const after = sim.congestionAt(8);
    expect(after).toBeLessThan(before * 0.6); // load splits across shafts → ~halved
  });

  it("a distant cluster on its own shaft does not raise another cluster's congestion", () => {
    const sim = clusterTower(2, 30);
    // Shaft A serves the low band (1..10), shaft B serves the high band (10..30),
    // transferring at floor 10. They overlap only at floor 10 (no offices there).
    sim.buildTransport("elevatorStandard", W - 6, 1, 10);
    sim.tower.setCars(sim.tower.transports[0].id, 1);
    sim.buildTransport("elevatorStandard", W - 12, 10, 30);
    sim.tower.setCars(sim.tower.transports[1].id, 1);

    for (let f = 2; f <= 9; f++) fillFloor(sim, f, 18); // cluster A (served by A only)
    const aAlone = sim.congestionAt(8);

    for (let f = 11; f <= 30; f++) fillFloor(sim, f, 18); // cluster B (served by B only)
    const aAfter = sim.congestionAt(8);

    // The old single global scalar would have jumped when cluster B filled in;
    // the spatial model leaves floor 8 (served only by shaft A) unchanged.
    expect(aAfter).toBeCloseTo(aAlone, 5);
    expect(sim.congestionAt(25)).toBeGreaterThan(0); // cluster B is genuinely loaded
  });
});

describe("F15 / Step 3 — service coverage radius (v2): placement matters", () => {
  function tallTower(seed: number): Simulation {
    const sim = Simulation.newGame(seed);
    sim.simModel = "v2";
    sim.money = 1_000_000_000;
    for (let x = C; x < W; x++) sim.tower.place("lobby", 1, x);
    for (let x = C - 1; x >= 0; x--) sim.tower.place("lobby", 1, x);
    for (let f = 2; f <= 100; f++)
      for (let x = C; x < W; x++) sim.tower.place("floor", f, x);
    return sim;
  }

  it("a fire is contained faster near a station than far from it (v2)", () => {
    const sim = tallTower(1);
    sim.tower.place("security", 2, C); // ground-level security only
    sim.tower.place("medical", 2, C + 8);
    const near = sim.fireContainmentChance(3); // within radius
    const far = sim.fireContainmentChance(100); // a floor-100 fire, far away
    expect(near).toBeGreaterThan(far);
    expect(near).toBeCloseTo(1.0, 5); // base 0.50 + security 0.2 + medical 0.3
    expect(far).toBeCloseTo(0.5, 5); // base only — neither covers floor 100
  });

  it("v1 keeps tower-wide coverage (one station protects everywhere)", () => {
    const sim = tallTower(2);
    sim.simModel = "v1";
    sim.tower.place("security", 2, C);
    sim.tower.place("medical", 2, C + 8);
    expect(sim.fireContainmentChance(3)).toBeCloseTo(sim.fireContainmentChance(100), 5);
  });

  it("distributing stations up a tall tower restores full coverage (why the 10-cap bites)", () => {
    const sim = tallTower(3);
    for (let f = 5; f <= 95; f += 15) sim.tower.place("security", f, C); // ~7 stations
    // Every occupied band now has a station within the security radius.
    expect(sim.fireContainmentChance(10)).toBeGreaterThan(0.5);
    expect(sim.fireContainmentChance(90)).toBeGreaterThan(0.5);
  });

  it("fire-defense visibly lowers how often fires break out", () => {
    const sim = tallTower(1);
    const bare = sim.fireIgnitionChance();
    expect(bare).toBeCloseTo(0.025, 5); // base daily chance with no defense

    expect(sim.tower.place("security", 2, C).ok).toBe(true);
    const withSecurity = sim.fireIgnitionChance();
    expect(withSecurity).toBeCloseTo(0.025 * 0.45, 5);
    // Security more than halves the fire rate — building it is clearly worth it.
    expect(withSecurity).toBeLessThan(bare * 0.5);

    expect(sim.tower.place("medical", 2, C + 8).ok).toBe(true);
    const withBoth = sim.fireIgnitionChance();
    expect(withBoth).toBeCloseTo(0.025 * 0.45 * 0.5, 5);
    expect(withBoth).toBeLessThan(withSecurity);
  });

  it("a Security office that is still under construction or on fire does not protect", () => {
    const sim = tallTower(1);
    const bare = sim.fireIgnitionChance();
    const placed = sim.tower.place("security", 2, C);
    expect(placed.ok).toBe(true);
    const sec = sim.tower.units.find((u) => u.id === placed.unitId)!;

    sec.state = "construction"; // not finished → no protection yet
    expect(sim.fireIgnitionChance()).toBeCloseTo(bare, 5);

    sec.state = "fire"; // the station itself is ablaze → no protection
    expect(sim.fireIgnitionChance()).toBeCloseTo(bare, 5);

    sec.state = "empty"; // operational again → protection returns
    expect(sim.fireIgnitionChance()).toBeLessThan(bare);
  });
});

import { TOWER_POPULATION, FACILITIES } from "../engine/facilities";

describe("F2 / Step 5 — honest v2 endgame: a served, well-zoned tower wins under the real hourly clock", () => {
  it("a properly-zoned tower reaches TOWER and does NOT mass-vacate under hourly simulation", () => {
    const sim = Simulation.newGame(1); // v2 by default
    sim.money = 1e12;
    const lay = (k: "floor" | "lobby", f: number) => {
      for (let x = C; x < W; x++) sim.tower.place(k, f, x);
      for (let x = C - 1; x >= 0; x--) sim.tower.place(k, f, x);
    };
    // Sky-lobby floors get LOBBY tiles, not floor tiles: a lobby can't be laid
    // over existing floor tiles ("Clear the floor tiles or rooms here first"),
    // so the old lay-floors-then-lobbies order silently left the tower with no
    // sky lobbies at all, and an express with nothing to stop at.
    const sky = [15, 30, 45, 60, 75, 90];
    const skyset = new Set(sky);
    lay("lobby", 1);
    for (let f = 2; f <= 100; f++) lay(skyset.has(f) ? "lobby" : "floor", f);
    for (let fl = 0; fl >= -2; fl--) lay("floor", fl); // 3 basement floors for the metro

    // Zoned transport, and every piece must actually land (this fixture used to
    // degrade silently: express is star-gated, so rank up BEFORE building).
    // Layout matters under honest per-floor congestion and the 79-tile walking
    // tolerance: 3 shaft GROUPS spread across the lot so no office is a long
    // walk from a lobby-connected shaft, one local per group per 15-floor band
    // (3 parallel locals per band), staggered so adjacent bands sharing a
    // sky-lobby endpoint never collide, plus 2 express shafts that stop at the
    // ground lobby, every sky lobby, and their own endpoints (endpoints always
    // stop, so floor 100 is served even without a lobby there), giving the
    // ≤2-ride hop to every band. 23 shafts, inside the 24-shaft pool.
    sim.star = 5;
    const addShaft = (kind: string, x: number, b: number, t: number) => {
      const r = sim.buildTransport(kind as never, x, b, t);
      expect(r.ok).toBe(true); // the fixture's zoning must actually land
      sim.tower.setCars(sim.tower.transports[sim.tower.transports.length - 1].id, 8);
    };
    addShaft("elevatorExpress", 350, 1, 100);
    addShaft("elevatorExpress", 356, 1, 100);
    const groups = [40, 187, 334];
    const bands: Array<[number, number]> = [[1, 15], [15, 30], [30, 45], [45, 60], [60, 75], [75, 90], [90, 100]];
    bands.forEach(([b, t], i) => {
      for (const g of groups) addShaft("elevatorStandard", g + (i % 2 ? 5 : 0), b, t);
    });
    // The zoning holds the two-ride rule everywhere: express to a sky lobby,
    // local to the floor. Nothing in this tower is stranded.
    for (let f = 2; f <= 100; f++) expect(sim.floorReachable(f)).toBe(true);

    // Services distributed up the tower (coverage radius), a metro, and offices.
    // Asserted like the shafts: the 5★ amenity gates and the congestion relief
    // depend on these actually landing (AGENTS.md, Testing discipline).
    expect(sim.tower.place("metro", -2, 0).ok).toBe(true);
    for (let f = 8; f <= 98; f += 15) expect(sim.tower.place("security", f, 60).ok).toBe(true);
    for (let f = 8; f <= 98; f += 24) expect(sim.tower.place("medical", f, 100).ok).toBe(true);

    let pop = 0;
    for (let f = 2; f <= 99 && pop < TOWER_POPULATION + 600; f++) {
      if (skyset.has(f)) continue;
      for (let x = 16; x + 9 <= 350 && pop < TOWER_POPULATION + 600; x += 9) {
        const r = sim.tower.place("office", f, x); // skips slots under shaft columns/services
        if (r.ok) {
          const u = sim.tower.units.find((uu) => uu.id === r.unitId)!;
          u.state = "occupied";
          u.everOccupied = true;
          pop += FACILITIES.office.population;
        }
      }
    }
    expect(sim.population).toBeGreaterThanOrEqual(TOWER_POPULATION);

    // Crown it and summon the VIP, then run several real days of hourly sim.
    // (Already 5★ from the transport unlock above. x=100 keeps the hall clear
    // of the center shaft group's column.)
    expect(sim.build("weddingHall", 100, 100).ok).toBe(true);
    const popBeforeRun = sim.population;
    for (let day = 0; day < 8 && !sim.evaluatedTower; day++) sim.tick(60 * 24);

    // Spatial congestion held: the tower did not bleed population under proper
    // hourly simulation (the whole point — v1 would have vacated an unserved
    // tower; a badly-zoned v2 tower would too).
    expect(sim.population).toBeGreaterThanOrEqual(TOWER_POPULATION);
    expect(sim.population).toBeGreaterThanOrEqual(popBeforeRun * 0.95);
    // And it won.
    expect(sim.evaluatedTower).toBe(true);
    expect(sim.star).toBe(6);
    // This is by far the heaviest test in the suite — it builds a full ~100-floor
    // tower and simulates 8 game-days hour-by-hour. Give it explicit headroom so
    // it doesn't skate the global 30s timeout under CI's slower, parallel load.
  }, 60_000);
});

describe("F25 / F27 / F36 — smaller review sweep", () => {
  it("F25: a hotel on an unreachable floor churns out under stress", () => {
    const sim = Simulation.newGame(5); // v2
    for (let x = C; x < W; x++) sim.tower.place("lobby", 1, x);
    for (let f = 2; f <= 5; f++) for (let x = C; x < W; x++) sim.tower.place("floor", f, x);
    sim.star = 2;
    const r = sim.tower.place("hotelDouble", 5, C); // floor 5, NO elevator → unserved
    const room = sim.tower.units.find((u) => u.id === r.unitId)!;
    room.state = "asleep";
    room.satisfaction = 0.3;
    for (let i = 0; i < 24; i++) sim.tick(60);
    expect(room.state).toBe("empty"); // gave up due to poor access (hotels churn now)
  });

  it("F36: a hotel suite houses 3 (canon), more than a double", () => {
    expect(FACILITIES.hotelSuite.population).toBe(3);
    expect(FACILITIES.hotelSuite.population).toBeGreaterThan(FACILITIES.hotelDouble.population);
  });

  it("F27: idle cars rest at the shaft's lobby floor", () => {
    const sim = Simulation.newGame(6);
    for (let x = C; x < W; x++) sim.tower.place("lobby", 1, x);
    for (let f = 2; f <= 10; f++) for (let x = C; x < W; x++) sim.tower.place("floor", f, x);
    sim.buildTransport("elevatorStandard", C, 1, 10); // serves the ground lobby (floor 1)
    for (let i = 0; i < 300; i++) sim.tick(1); // no demand
    const t = sim.tower.transports[0];
    expect(t.carPositions.every((p) => Math.abs(p - 1) < 0.5)).toBe(true); // rest at lobby (floor 1)
  });
});
