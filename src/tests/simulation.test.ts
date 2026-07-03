import { describe, it, expect } from "vitest";
import { Simulation, ECON, VACATE_RESCIND } from "../engine/Simulation";
import { ElevatorDispatch } from "../engine/ElevatorDispatch";
import { FACILITIES, GRID } from "../engine/facilities";

describe("Rent / price controls", () => {
  it("steps and clamps a unit's price within its band", () => {
    const sim = Simulation.newGame(1);
    const x0 = Math.floor(GRID.width / 2);
    for (let i = 0; i < 12; i++) sim.tower.place("floor", 2, x0 + i);
    sim.buildTransport("elevatorStandard", x0, 1, 2);
    const r = sim.tower.place("office", 2, x0 + 1);
    const id = r.unitId!;
    expect(sim.adjustRent(id, 1)).toBe(ECON.rent.office.default + ECON.rent.office.step);
    // Spamming up clamps to the band maximum, never beyond.
    for (let i = 0; i < 50; i++) sim.adjustRent(id, 1);
    expect(sim.tower.units.find((u) => u.id === id)!.rent).toBe(ECON.rent.office.max);
    for (let i = 0; i < 50; i++) sim.adjustRent(id, -1);
    expect(sim.tower.units.find((u) => u.id === id)!.rent).toBe(ECON.rent.office.min);
  });

  it("won't change a condo's price once it has sold", () => {
    const sim = Simulation.newGame(1);
    const x0 = Math.floor(GRID.width / 2);
    for (let i = 0; i < 20; i++) sim.tower.place("floor", 2, x0 + i);
    sim.buildTransport("elevatorStandard", x0, 1, 2);
    const r = sim.tower.place("condo", 2, x0 + 1);
    const u = sim.tower.units.find((x) => x.id === r.unitId)!;
    expect(sim.adjustRent(u.id, 1)).not.toBeNull(); // adjustable while unsold
    u.everOccupied = true; // now sold
    expect(sim.adjustRent(u.id, 1)).toBeNull();
  });

  it("over-pricing an office erodes its satisfaction vs the going rate (real retention cost)", () => {
    const sim = builtTower(3); // serviced office tower (elevator to floor 2)
    const x0 = Math.floor(GRID.width / 2) - 20;
    sim.build("office", 2, x0); // charges the default rent
    sim.build("office", 2, x0 + 10); // gouged to the cap
    const ua = sim.tower.unitAt(2, x0)!;
    const ub = sim.tower.unitAt(2, x0 + 10)!;
    for (const u of [ua, ub]) {
      u.state = "occupied";
      u.satisfaction = 1;
    }
    ub.rent = ECON.rent.office.max;
    for (let i = 0; i < 8; i++) sim.tick(60); // a handful of in-game hours
    expect(ub.satisfaction).toBeLessThan(ua.satisfaction);
  });
});

/** Build a serviced office tower with `n` offices on floor 2. */
function builtTower(seed = 7): Simulation {
  const sim = Simulation.newGame(seed);
  const x0 = Math.floor(GRID.width / 2) - 20;
  // Floor 2 structure.
  for (let i = 0; i < 40; i++) sim.tower.place("floor", 2, x0 + i);
  // Elevator linking ground to floor 2.
  sim.buildTransport("elevatorStandard", x0, 1, 2);
  return sim;
}

describe("Simulation economy", () => {
  it("starts with the correct money and one star", () => {
    const sim = Simulation.newGame();
    expect(sim.money).toBe(ECON.startingMoney);
    expect(sim.star).toBe(1);
  });

  it("charges for building and refunds on sell", () => {
    const sim = Simulation.newGame();
    const before = sim.money;
    const res = sim.build("floor", 2, Math.floor(GRID.width / 2) - 20);
    expect(res.ok).toBe(true);
    expect(sim.money).toBe(before - 500);
    sim.sellAt(2, Math.floor(GRID.width / 2) - 20);
    expect(sim.money).toBe(before - 500 + 250);
  });

  it("auto-lays a room's floor when placed against the tower", () => {
    const sim = Simulation.newGame(7); // starter lobby on floor 1
    const x0 = Math.floor(GRID.width / 2) - 20;
    const before = sim.money;
    // No floor on level 2 yet — drop an office straight above the lobby.
    const r = sim.build("office", 2, x0);
    expect(r.ok).toBe(true);
    expect(sim.tower.unitAt(2, x0)?.kind).toBe("office");
    expect(sim.tower.hasStructure(2, x0)).toBe(true); // floor was created
    // Charged for the office plus the floor tiles it laid.
    const cost = FACILITIES.office.cost + FACILITIES.office.width * FACILITIES.floor.cost;
    expect(before - sim.money).toBe(cost);
  });

  it("refuses to sell a floor that supports the story above", () => {
    const sim = Simulation.newGame();
    const x0 = Math.floor(GRID.width / 2) - 20;
    sim.build("floor", 2, x0);
    sim.build("floor", 3, x0);
    const before = sim.money;
    expect(sim.sellAt(2, x0)).toBe(false); // floor 3 rests on it — no refund
    expect(sim.money).toBe(before);
    // Top-down works: clear floor 3, then floor 2 sells fine.
    expect(sim.sellAt(3, x0)).toBe(true);
    expect(sim.sellAt(2, x0)).toBe(true);
  });

  it("won't build a room floating in midair", () => {
    const sim = Simulation.newGame(7);
    const r = sim.build("office", 6, 5); // far from the starter lobby
    expect(r.ok).toBe(false);
  });

  it("rejects floating overhangs above ground (no diagonal stacking)", () => {
    const sim = Simulation.newGame(7);
    const x0 = Math.floor(GRID.width / 2) - 20;
    for (let i = 0; i < 30; i++) sim.tower.place("floor", 2, x0 + i);
    // Office on floor 3 sitting fully on floor 2 → fine (auto-floors level 3).
    expect(sim.build("office", 3, x0).ok).toBe(true);
    // Office on floor 3 hanging off the right end of floor 2 → rejected.
    expect(sim.canBuild("office", 3, x0 + 28).ok).toBe(false);
  });

  it("blocks building when unaffordable", () => {
    const sim = Simulation.newGame();
    sim.money = 100;
    const res = sim.build("office", 1, 0);
    expect(res.ok).toBe(false);
  });

  it("locks facilities behind star ratings", () => {
    const sim = Simulation.newGame();
    expect(sim.isUnlocked("office")).toBe(true);
    expect(sim.isUnlocked("cinema")).toBe(false); // needs 3 stars
    sim.star = 3;
    expect(sim.isUnlocked("cinema")).toBe(true);
  });

  it("fills offices over time and collects quarterly rent", () => {
    const sim = builtTower(3);
    const x0 = Math.floor(GRID.width / 2) - 20;
    sim.build("office", 2, x0);
    sim.build("office", 2, x0 + 10);
    sim.build("office", 2, x0 + 20);
    const moneyAfterBuild = sim.money;
    // Run several simulated weekdays of hours.
    for (let i = 0; i < 24 * 14; i++) sim.tick(60);
    const occupied = sim.tower.units.filter(
      (u) => u.kind === "office" && u.state === "occupied",
    ).length;
    expect(occupied).toBeGreaterThan(0);
    // Money should have grown from collected rent over two weeks.
    expect(sim.money).toBeGreaterThan(moneyAfterBuild);
  });

  it("sells a condo once for a lump sum", () => {
    const sim = builtTower(5);
    const x0 = Math.floor(GRID.width / 2) - 20;
    sim.build("condo", 2, x0);
    const before = sim.money;
    // Force the resident in.
    const condo = sim.tower.units.find((u) => u.kind === "condo")!;
    (sim as any).moveIn(condo);
    expect(sim.money).toBe(before + ECON.rent.condo.default);
    expect(condo.everOccupied).toBe(true);
    // A second move-in does not re-sell.
    const mid = sim.money;
    (sim as any).moveIn(condo);
    expect(sim.money).toBe(mid);
  });
});

describe("Simulation ratings", () => {
  it("promotes to 2 stars when population crosses 300", () => {
    const sim = Simulation.newGame(9);
    // Fabricate population by marking many occupied offices.
    const x0 = Math.floor(GRID.width / 2) - 20;
    for (let f = 2; f <= 20; f++) {
      for (let i = 0; i < 40; i++) sim.tower.place("floor", f, x0 + i);
    }
    let placed = 0;
    for (let f = 2; f <= 20 && placed < 60; f++) {
      for (let i = 0; i + 9 <= 40 && placed < 60; i += 9) {
        const r = sim.tower.place("office", f, x0 + i);
        if (r.ok) {
          const u = sim.tower.units.find((uu) => uu.id === r.unitId)!;
          u.state = "occupied";
          placed++;
        }
      }
    }
    expect(sim.population).toBeGreaterThanOrEqual(300);
    sim.evaluateStar();
    expect(sim.star).toBeGreaterThanOrEqual(2);
  });

  it("gates 3 stars on having security", () => {
    const sim = Simulation.newGame(11);
    // Force a large population. Build in the connected region above the
    // starter lobby (centered near width/2).
    const x0 = Math.floor(GRID.width / 2) - 20;
    for (let f = 2; f <= 60; f++)
      for (let i = 0; i < 40; i++) sim.tower.place("floor", f, x0 + i);
    let placed = 0;
    for (let f = 2; f <= 60 && placed < 200; f++) {
      for (let i = 0; i + 9 <= 40 && placed < 200; i += 9) {
        const r = sim.tower.place("office", f, x0 + i);
        if (r.ok) {
          sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
          placed++;
        }
      }
    }
    expect(sim.population).toBeGreaterThanOrEqual(1000);
    sim.evaluateStar();
    expect(sim.star).toBe(2); // blocked at 2 without security
    sim.star = 2;
    // Security goes on a standard floor (lobbies are transit-only). Floors
    // above the office fill (52+) still have structure but no rooms.
    const sec = sim.tower.place("security", 55, x0);
    expect(sec.ok).toBe(true);
    sim.evaluateStar();
    expect(sim.star).toBeGreaterThanOrEqual(3);
  });
});

describe("Construction time", () => {
  it("puts new rooms under construction, then opens them on the global clock", () => {
    const sim = Simulation.newGame(7);
    const x0 = Math.floor(GRID.width / 2) - 20;
    for (let i = 0; i < 12; i++) sim.tower.place("floor", 2, x0 + i);
    const res = sim.build("office", 2, x0);
    expect(res.ok).toBe(true);
    const u = sim.tower.units.find((uu) => uu.kind === "office")!;
    expect(u.state).toBe("construction");
    expect(u.completeAt).toBeGreaterThan(sim.clock.minutes);
    // Advance past the construction window.
    for (let i = 0; i < 12; i++) sim.tick(60);
    expect(u.state).not.toBe("construction");
  });

  it("does not delay structural floors/lobbies", () => {
    const sim = Simulation.newGame(1);
    const x0 = Math.floor(GRID.width / 2) - 20;
    const r = sim.build("floor", 2, x0);
    expect(r.ok).toBe(true);
    const f = sim.tower.units.find((u) => u.kind === "floor" && u.floor === 2)!;
    expect(f.state).not.toBe("construction");
  });
});

describe("Hotel housekeeping", () => {
  function hotelTower(seed = 4): Simulation {
    const sim = Simulation.newGame(seed);
    const x0 = Math.floor(GRID.width / 2) - 20;
    for (let i = 0; i < 20; i++) sim.tower.place("floor", 2, x0 + i);
    sim.buildTransport("elevatorStandard", x0, 1, 2);
    return sim;
  }

  it("marks rooms dirty on checkout and needs housekeeping to clean", () => {
    const sim = hotelTower(4);
    sim.star = 2;
    const x0 = Math.floor(GRID.width / 2) - 20;
    const r = sim.tower.place("hotelDouble", 2, x0);
    const room = sim.tower.units.find((u) => u.id === r.unitId)!;
    room.state = "asleep";
    // Advance one day → checkout runs at midnight, no housekeeping built.
    for (let i = 0; i < 24; i++) sim.tick(60);
    expect(room.state).toBe("dirty");
    expect(sim.dirtyRooms()).toBe(1);
  });

  it("cleans dirty rooms when housekeeping exists", () => {
    const sim = hotelTower(6);
    sim.star = 2;
    const x0 = Math.floor(GRID.width / 2) - 20;
    const r = sim.tower.place("hotelDouble", 2, x0);
    sim.tower.place("housekeeping", 2, x0 + 8);
    const room = sim.tower.units.find((u) => u.id === r.unitId)!;
    room.state = "dirty";
    // Run past the 8:00 shift start (the clock opens at 7:00) into mid-day, so
    // the housekeeper has walked over — but stop before the NEXT checkout
    // re-dirties a re-let room.
    for (let i = 0; i < 6; i++) sim.tick(60);
    expect(room.state).not.toBe("dirty");
  });

  it("rooms stay dirty until a housekeeper actually arrives — cleaning is never instant", () => {
    const sim = hotelTower(12);
    sim.star = 2;
    const x0 = Math.floor(GRID.width / 2) - 20;
    const r = sim.tower.place("hotelDouble", 2, x0);
    sim.tower.place("housekeeping", 2, x0 + 8); // same floor: no ride needed
    const room = sim.tower.units.find((u) => u.id === r.unitId)!;
    room.state = "dirty";
    // One tick reaches the 8:00 shift start (the clock opens at 7:00): dispatch
    // sends a housekeeper, but the room is still dirty — nobody's arrived yet.
    sim.tick(60);
    expect(room.state).toBe("dirty");
    expect(sim.crowd.people.some((p) => p.staff)).toBe(true);
    // The next hour of simulation walks them to the room; arrival cleans it.
    sim.tick(60);
    expect(room.state).toBe("empty");
  });

  it("a well-kept hotel never seeds cockroaches (spread only from overnight leftovers)", () => {
    const sim = hotelTower(21);
    sim.star = 2;
    const x0 = Math.floor(GRID.width / 2) - 20;
    const a = sim.tower.place("hotelSingle", 2, x0);
    const b = sim.tower.place("hotelSingle", 2, x0 + 4); // adjacent
    sim.tower.place("housekeeping", 2, x0 + 8);
    for (const r of [a, b]) sim.tower.units.find((u) => u.id === r.unitId)!.state = "asleep";
    // Three full days: rooms go dirty each 8:00, housekeepers clean them the
    // same morning — roaches must never spread from a hotel that keeps up.
    for (let i = 0; i < 24 * 3; i++) sim.tick(60);
    expect(sim.log.some((l) => l.text.includes("Cockroaches"))).toBe(false);
  });

  it("a crew built after the 8:00 checkout still works the same day", () => {
    const sim = hotelTower(22);
    sim.star = 2;
    const x0 = Math.floor(GRID.width / 2) - 20;
    const r = sim.tower.place("hotelDouble", 2, x0);
    const room = sim.tower.units.find((u) => u.id === r.unitId)!;
    room.state = "dirty";
    // Past the shift start with no crew anywhere: nothing can clean.
    for (let i = 0; i < 3; i++) sim.tick(60); // 7:00 → 10:00
    expect(room.state).toBe("dirty");
    // Build housekeeping mid-shift; the next hourly dispatch picks it up.
    sim.tower.place("housekeeping", 2, x0 + 8);
    for (let i = 0; i < 3; i++) sim.tick(60);
    expect(room.state).toBe("empty");
  });

  it("housekeepers need a staff route — a passenger elevator alone won't do", () => {
    const sim = hotelTower(8);
    sim.star = 2;
    const x0 = Math.floor(GRID.width / 2) - 20;
    for (let f = 3; f <= 5; f++) for (let i = 0; i < 20; i++) sim.tower.place("floor", f, x0 + i);
    sim.tower.resizeTransport(sim.tower.transports[0].id, 1, 5); // passenger elevator to 5
    const r = sim.tower.place("hotelDouble", 5, x0);
    sim.tower.place("housekeeping", 2, x0 + 8); // crew stationed 3 floors below
    const room = sim.tower.units.find((u) => u.id === r.unitId)!;
    room.state = "dirty";
    // Staff won't ride the passenger elevator: the room stays dirty and the
    // player is told why.
    for (let i = 0; i < 25; i++) sim.tick(60);
    expect(room.state).toBe("dirty");
    expect(sim.log.some((l) => l.text.includes("Housekeeping can't reach"))).toBe(true);
    // A service elevator linking the crew's floor to the room's floor fixes it:
    // the next day-shift dispatch rides a housekeeper up. (Stop mid-day, before
    // the following checkout re-dirties a re-let room.)
    sim.buildTransport("elevatorService", x0 + 14, 2, 5);
    for (let i = 0; i < 20; i++) sim.tick(60);
    expect(room.state).not.toBe("dirty");
  });

  it("staff routing has no leg cap — a long stairs chain matches staffConnected", () => {
    const sim = hotelTower(23);
    sim.star = 2;
    const x0 = Math.floor(GRID.width / 2) - 20;
    for (let f = 3; f <= 14; f++) for (let i = 0; i < 20; i++) sim.tower.place("floor", f, x0 + i);
    // Thirteen single-floor stair flights chained 1→14, staggered so shafts
    // never overlap. Reachability (components) and routing (BFS) must agree.
    for (let f = 1; f <= 13; f++) {
      const r = sim.tower.placeTransport("stairs", x0 + (f % 3) * 6, f, f + 1);
      expect(r.ok).toBe(true);
    }
    expect(sim.tower.staffConnected(1, 14)).toBe(true);
    expect(sim.crowd.staffRoute(sim.tower, 1, 14)).not.toBeNull();
  });

  it("housekeepers prefer the service elevator over equal-length stairs", () => {
    const sim = hotelTower(41);
    sim.star = 2;
    const x0 = Math.floor(GRID.width / 2) - 20;
    for (let f = 3; f <= 5; f++) for (let i = 0; i < 20; i++) sim.tower.place("floor", f, x0 + i);
    // Stairs built FIRST (the tie-break used to favor build order)…
    expect(sim.tower.placeTransport("stairs", x0 + 6, 2, 3).ok).toBe(true);
    // …then the service elevator covering the same hop.
    expect(sim.tower.placeTransport("elevatorService", x0 + 12, 2, 5).ok).toBe(true);
    const service = sim.tower.transports.find((t) => t.kind === "elevatorService")!;
    const route = sim.crowd.staffRoute(sim.tower, 2, 3);
    expect(route?.shafts[0]).toBe(service.id); // rides, not climbs
  });

  it("warns once a day when housekeeping is over capacity", () => {
    const sim = hotelTower(42);
    sim.star = 2;
    const x0 = Math.floor(GRID.width / 2) - 20;
    // Widen the ground outward, then floor 2 above it, and fill floor 2 with
    // more singles than one crew's daily 20.
    for (let i = x0 + 40; i < x0 + 60; i++) sim.tower.place("lobby", 1, i);
    for (let i = x0 - 1; i >= x0 - 60; i--) sim.tower.place("lobby", 1, i);
    for (let i = -60; i < 60; i++) sim.tower.place("floor", 2, x0 + i);
    sim.tower.place("housekeeping", 2, x0 - 60);
    let placed = 0;
    for (let x = x0 - 50; placed < 24 && x + 4 <= x0 + 60; x += 4) {
      if (sim.tower.place("hotelSingle", 2, x).ok) placed++;
    }
    expect(placed).toBe(24);
    for (const u of sim.tower.units) if (u.kind === "hotelSingle") u.state = "dirty";
    for (let i = 0; i < 12; i++) sim.tick(60); // through the day shift
    expect(sim.log.some((l) => l.text.includes("Housekeeping is at capacity"))).toBe(true);
  });

  it("staff calls are shaft-scoped — only the shaft the staffer uses responds", () => {
    const sim = hotelTower(31);
    sim.star = 2;
    const x0 = Math.floor(GRID.width / 2) - 20;
    for (let f = 3; f <= 5; f++) for (let i = 0; i < 20; i++) sim.tower.place("floor", f, x0 + i);
    // Two service shafts sharing every stop floor.
    expect(sim.tower.placeTransport("elevatorService", x0 + 6, 1, 5).ok).toBe(true);
    expect(sim.tower.placeTransport("elevatorService", x0 + 12, 1, 5).ok).toBe(true);
    const shafts = sim.tower.transports.filter((t) => t.kind === "elevatorService");
    // One housekeeper, routed over exactly one shaft, standing at floor 3
    // waiting for its car.
    expect(sim.crowd.spawnStaff(sim.tower, 3, 5, x0 + 2, 12345)).toBe("sent");
    const p = sim.crowd.people.find((q) => q.staff)!;
    p.state = "waiting";
    const calls = sim.crowd.elevatorCalls(sim.tower);
    expect([...calls.hall.keys()]).toEqual([p.shaftId]); // keyed to that shaft only
    // Dispatch: the used shaft's car answers; the other stays idle at ground.
    const used = shafts.find((t) => t.id === p.shaftId)!;
    const other = shafts.find((t) => t.id !== p.shaftId)!;
    sim.tower.setCars(used.id, 1);
    sim.tower.setCars(other.id, 1);
    const dispatch = new ElevatorDispatch();
    for (let i = 0; i < 4; i++) dispatch.update(sim.tower, 2, 1, sim.crowd.elevatorCalls(sim.tower));
    expect(used.carPositions[0]).toBeGreaterThan(1);
    expect(Math.abs(other.carPositions[0] - 1)).toBeLessThan(0.01);
  });

  it("tenants never route over service elevators", () => {
    const sim = hotelTower(9);
    const x0 = Math.floor(GRID.width / 2) - 20;
    for (let f = 3; f <= 5; f++) for (let i = 0; i < 20; i++) sim.tower.place("floor", f, x0 + i);
    sim.star = 2;
    sim.buildTransport("elevatorService", x0 + 14, 1, 5);
    // The service shaft is not a passenger route and doesn't serve floors…
    expect(sim.crowd.route(sim.tower, 1, 5)).toBeNull();
    expect(sim.tower.isFloorServed(5)).toBe(false);
    // …but the passenger elevator is.
    sim.tower.resizeTransport(sim.tower.transports[0].id, 1, 5);
    expect(sim.crowd.route(sim.tower, 1, 5)).not.toBeNull();
    expect(sim.tower.isFloorServed(5)).toBe(true);
  });
});

describe("Transport editing", () => {
  function base(seed = 1): Simulation {
    const sim = Simulation.newGame(seed);
    const x0 = Math.floor(GRID.width / 2) - 20;
    for (let f = 2; f <= 10; f++) for (let i = 0; i < 20; i++) sim.tower.place("floor", f, x0 + i);
    return sim;
  }

  it("adds and removes elevator cars within bounds", () => {
    const sim = base(1);
    const x0 = Math.floor(GRID.width / 2) - 20;
    sim.buildTransport("elevatorStandard", x0, 1, 6);
    const t = sim.tower.transports[0];
    const start = t.cars;
    expect(sim.tower.setCars(t.id, start + 1)).toBe(true);
    expect(t.cars).toBe(start + 1);
    expect(t.carPositions.length).toBe(t.cars);
    sim.tower.setCars(t.id, 99);
    expect(t.cars).toBe(8); // clamped
    sim.tower.setCars(t.id, 0);
    expect(t.cars).toBe(1); // clamped
  });

  it("resizes a transport; rooms no longer block extension (shaft overlaps them)", () => {
    const sim = base(2);
    const x0 = Math.floor(GRID.width / 2) - 20;
    sim.buildTransport("elevatorStandard", x0, 1, 6);
    const t = sim.tower.transports[0];
    const ok = sim.tower.resizeTransport(t.id, 1, 8);
    expect(ok.ok).toBe(true);
    expect(t.top).toBe(8);
    // A room directly in the shaft column used to block extension; it now
    // overlaps and the shaft simply draws in front of it.
    sim.tower.place("office", 9, x0);
    const overRoom = sim.tower.resizeTransport(t.id, 1, 9);
    expect(overRoom.ok).toBe(true);
    expect(t.top).toBe(9);
  });

  it("lets a new shaft be placed over a room", () => {
    const sim = base(2);
    const x0 = Math.floor(GRID.width / 2) - 20;
    sim.tower.place("office", 3, x0); // a room sitting in the shaft column
    const res = sim.buildTransport("elevatorStandard", x0, 1, 6);
    expect(res.ok).toBe(true);
  });

  it("won't extend a shaft into floors with no structure (no floating in sky)", () => {
    const sim = base(2); // structure exists on floors 2..10 only
    const x0 = Math.floor(GRID.width / 2) - 20;
    sim.buildTransport("elevatorStandard", x0, 1, 6);
    const t = sim.tower.transports[0];
    expect(sim.tower.resizeTransport(t.id, 1, 10).ok).toBe(true); // up to built structure
    expect(t.top).toBe(10);
    expect(sim.tower.resizeTransport(t.id, 1, 11).ok).toBe(false); // floor 11 is empty sky
    expect(t.top).toBe(10); // unchanged
  });

  it("caps cars per elevator type", () => {
    const sim = base(3);
    sim.star = 2; // service elevator unlocks at 2 stars
    const x0 = Math.floor(GRID.width / 2) - 20;
    sim.buildTransport("elevatorService", x0, 1, 6);
    const t = sim.tower.transports[0];
    expect(t).toBeDefined();
    sim.tower.setCars(t.id, 99);
    expect(t.cars).toBe(4); // service elevators max 4 cars
  });

  it("computes capacity and congestion from transports", () => {
    const sim = base(4);
    const x0 = Math.floor(GRID.width / 2) - 20;
    sim.buildTransport("elevatorStandard", x0, 1, 6);
    const t = sim.tower.transports[0];
    sim.tower.setCars(t.id, 2);
    expect(sim.transportCapacity(t)).toBe(2 * 21);
    // With no occupants, congestion is zero; with people and no lift, high.
    expect(sim.congestion()).toBe(0);
  });

  it("express stops skip non-lobby floors and unserve them", () => {
    const sim = base(5);
    const x0 = Math.floor(GRID.width / 2) - 20;
    sim.buildTransport("elevatorStandard", x0, 1, 8);
    const t = sim.tower.transports[0];
    expect(sim.tower.isFloorServed(3)).toBe(true);
    // Only floor 1 (ground) is a lobby; express keeps bottom & top, skips the rest.
    sim.tower.setExpressStops(t.id);
    expect(sim.tower.stopsAt(t, 8)).toBe(true); // top kept (connected)
    expect(sim.tower.stopsAt(t, 3)).toBe(false); // skipped
    expect(sim.tower.isFloorServed(3)).toBe(false);
    expect(sim.tower.isFloorServed(8)).toBe(true);
    sim.tower.clearStops(t.id);
    expect(sim.tower.isFloorServed(3)).toBe(true);
  });
});

describe("Simulation time", () => {
  it("advances the clock and tracks days", () => {
    const sim = Simulation.newGame();
    const startDay = sim.clock.day;
    sim.tick(60 * 24);
    expect(sim.clock.day).toBe(startDay + 1);
  });

  it("evicts tenants from unreachable floors after a notice period", () => {
    const sim = Simulation.newGame(2);
    const x0 = Math.floor(GRID.width / 2) - 20;
    // Floor 5 with an office but NO transport reaching it.
    for (let f = 2; f <= 5; f++)
      for (let i = 0; i < 12; i++) sim.tower.place("floor", f, x0 + i);
    const r = sim.tower.place("office", 5, x0);
    const office = sim.tower.units.find((u) => u.id === r.unitId)!;
    office.state = "occupied";
    office.satisfaction = 0.2;
    // A day of hours bleeds satisfaction to zero and puts the tenant ON NOTICE
    // (the recoverable grace window) — not gone yet, with the cause attributed.
    for (let i = 0; i < 24; i++) sim.tick(60);
    expect(office.state).toBe("vacating");
    expect(office.satisfaction).toBe(0);
    expect(office.vacateReason).toBe("access");
    // Riding out the notice period with the floor still unreachable → they leave.
    for (let i = 0; i < 24 * 3; i++) sim.tick(60);
    expect(office.state).toBe("empty");
    expect(sim.log.some((e) => /A tenant left .*no route to the lobby/.test(e.text))).toBe(true);
  });

  it("a tenant on notice rescinds when access is restored in time", () => {
    const sim = Simulation.newGame(2);
    const x0 = Math.floor(GRID.width / 2) - 20;
    for (let f = 1; f <= 5; f++)
      for (let i = 0; i < 12; i++) sim.tower.place(f === 1 ? "lobby" : "floor", f, x0 + i);
    const r = sim.tower.place("office", 5, x0);
    const office = sim.tower.units.find((u) => u.id === r.unitId)!;
    office.state = "occupied";
    office.satisfaction = 0.2;
    // No transport yet → satisfaction craters and the tenant gives notice.
    for (let i = 0; i < 24; i++) sim.tick(60);
    expect(office.state).toBe("vacating");
    // Connect the floor; satisfaction recovers inside the window and they stay.
    const t = sim.buildTransport("elevatorStandard", x0 + 11, 1, 5);
    expect(t.ok).toBe(true);
    sim.tower.setCars(sim.tower.transports[sim.tower.transports.length - 1].id, 4);
    for (let i = 0; i < 24; i++) sim.tick(60);
    expect(office.state).toBe("occupied");
    expect(office.vacateReason).toBeUndefined();
  });

  it("rescinding is silent and does not spam a good/bad toast pair", () => {
    const sim = Simulation.newGame(2);
    const x0 = Math.floor(GRID.width / 2) - 20;
    for (let f = 1; f <= 5; f++)
      for (let i = 0; i < 12; i++) sim.tower.place(f === 1 ? "lobby" : "floor", f, x0 + i);
    const r = sim.tower.place("office", 5, x0);
    const office = sim.tower.units.find((u) => u.id === r.unitId)!;
    office.state = "occupied";
    office.satisfaction = 0.2;
    for (let i = 0; i < 24; i++) sim.tick(60);
    expect(office.state).toBe("vacating");
    expect(sim.buildTransport("elevatorStandard", x0 + 11, 1, 5).ok).toBe(true);
    sim.tower.setCars(sim.tower.transports[sim.tower.transports.length - 1].id, 4);
    for (let i = 0; i < 24; i++) sim.tick(60);
    expect(office.state).toBe("occupied");
    // "Silence when correct": recovering emits no toast, so a unit that flaps
    // around the threshold can never spam alternating notice/stay messages.
    expect(sim.log.some((e) => /staying|conditions improved/i.test(e.text))).toBe(false);
    expect(sim.log.filter((e) => /gave notice/i.test(e.text)).length).toBe(1);
  });

  it("batches a mass move-out into one notice toast, not one per unit", () => {
    const sim = Simulation.newGame(2);
    const x0 = Math.floor(GRID.width / 2) - 20;
    // Four offices on an unreachable floor, all equally unhappy → they bottom
    // out on the same tick and should raise a single aggregated alarm.
    for (let f = 2; f <= 5; f++) for (let i = 0; i < 40; i++) sim.tower.place("floor", f, x0 + i);
    const offices = [0, 9, 18, 27].map((dx) => {
      const r = sim.tower.place("office", 5, x0 + dx);
      const u = sim.tower.units.find((uu) => uu.id === r.unitId)!;
      u.state = "occupied";
      u.satisfaction = 0.2;
      return u;
    });
    for (let i = 0; i < 24; i++) sim.tick(60);
    expect(offices.every((u) => u.state === "vacating")).toBe(true);
    const noticeToasts = sim.log.filter((e) => /gave notice/i.test(e.text));
    expect(noticeToasts.length).toBe(1);
    expect(noticeToasts[0].text).toMatch(/4 tenants gave notice/);
  });

  it("a unit only stabilized below the 0.40 rescind bar still evicts (stabilized ≠ fixed)", () => {
    const sim = Simulation.newGame(2);
    const x0 = Math.floor(GRID.width / 2) - 20;
    for (let f = 1; f <= 5; f++)
      for (let i = 0; i < 12; i++) sim.tower.place(f === 1 ? "lobby" : "floor", f, x0 + i);
    expect(sim.buildTransport("elevatorStandard", x0 + 11, 1, 5).ok).toBe(true);
    sim.tower.setCars(sim.tower.transports[sim.tower.transports.length - 1].id, 4);
    const r = sim.tower.place("office", 5, x0);
    const office = sim.tower.units.find((u) => u.id === r.unitId)!;
    // On notice, notice window elapsed, nursed back ABOVE the old 0.25 bar but
    // still BELOW the new 0.40 one: under the retune this must still leave.
    office.state = "vacating";
    office.vacateReason = "access";
    office.satisfaction = 0.3;
    office.vacateAt = 0;
    expect(0.3).toBeGreaterThan(0.25); // would have rescinded under the old rule
    expect(0.3).toBeLessThan(VACATE_RESCIND); // but 0.30 < 0.40, so it doesn't now
    sim.tick(60);
    expect(office.state).toBe("empty");
  });
});

describe("Simulation events", () => {
  /** A serviced tower with a single occupied office on floor 2. */
  function towerWithOffice(seed = 7) {
    const sim = builtTower(seed);
    const x0 = Math.floor(GRID.width / 2) - 20;
    sim.build("office", 2, x0);
    const office = sim.tower.units.find((uu) => uu.kind === "office")!;
    office.state = "occupied";
    office.everOccupied = true;
    return { sim, office };
  }

  it("a fire removes a unit's population and is eventually contained", () => {
    const { sim, office } = towerWithOffice(11);
    expect(sim.population).toBeGreaterThan(0);
    sim.startFire(); // only the office is flammable, so it ignites
    expect(office.state).toBe("fire");
    expect(sim.fires).toBe(1);
    expect(sim.population).toBe(0); // a burning unit houses nobody

    // Security + medical guarantee a fast, contained response.
    const x0 = Math.floor(GRID.width / 2) - 20;
    sim.star = 4;
    sim.tower.place("security", 2, x0 + 12);
    sim.tower.place("medical", 2, x0 + 22);
    let guard = 0;
    while (sim.fires > 0 && guard++ < 60) sim.tick(60 * 24); // one day per tick
    expect(sim.fires).toBe(0);
    // Contained now means DESTROYED (canon): the room is a gutted shell, not
    // repaired-and-re-let (no repair fee), so it never re-populates and earns nothing.
    expect(office.state).toBe("gutted");
    expect(sim.population).toBe(0);
  });

  it("security defuses a bomb threat cheaply; without it the tower pays dearly", () => {
    const x0 = Math.floor(GRID.width / 2) - 20;

    const safe = builtTower(5);
    safe.tower.place("security", 2, x0);
    const before1 = safe.money;
    safe.bombThreat();
    expect(safe.money).toBeGreaterThanOrEqual(before1 - 5_000);
    expect(safe.money).toBeLessThan(before1);

    const exposed = builtTower(5);
    const before2 = exposed.money;
    exposed.bombThreat();
    expect(exposed.money).toBeLessThanOrEqual(before2 - 15_000);
  });

  it("elevator cars travel toward floors with passenger demand", () => {
    const sim = Simulation.newGame(1);
    const x0 = Math.floor(GRID.width / 2) - 20;
    for (let f = 2; f <= 10; f++) for (let i = 0; i < 12; i++) sim.tower.place("floor", f, x0 + i);
    sim.buildTransport("elevatorStandard", x0, 1, 10);
    const t = sim.tower.transports[0];
    // The only demand above the lobby is a busy office on floor 8.
    const r = sim.tower.place("office", 8, x0);
    sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
    // Park a car at the bottom heading up.
    t.carPositions[0] = 1;
    t.carDir[0] = 1;
    let maxPos = 1;
    // Run through the working day so waiting passengers build on floor 8.
    for (let i = 0; i < 400; i++) {
      sim.tick(1);
      maxPos = Math.max(maxPos, t.carPositions[0]);
    }
    // The car climbs to serve the floor-8 office rather than bouncing randomly,
    // and never leaves its shaft.
    expect(maxPos).toBeGreaterThan(6);
    expect(maxPos).toBeLessThanOrEqual(8);
  });

  it("metro and parking relieve elevator congestion", () => {
    const sim = Simulation.newGame(3);
    const x0 = Math.floor(GRID.width / 2) - 20;
    for (let f = 2; f <= 20; f++) for (let i = 0; i < 30; i++) sim.tower.place("floor", f, x0 + i);
    sim.buildTransport("elevatorStandard", x0, 1, 20);
    const t = sim.tower.transports[0];
    sim.tower.setCars(t.id, 1);
    for (let f = 2; f <= 20; f++) for (let i = 0; i + 9 <= 30; i += 9) {
      const r = sim.tower.place("office", f, x0 + i);
      if (r.ok) sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
    }
    const before = sim.congestion();
    // A whole-floor basement metro adds major throughput. Lay B1 (floor 0)
    // outward from a supported tile so the full span connects, then dig it in.
    for (let fl = 0; fl >= -2; fl--) {
      for (let x = x0; x < GRID.width; x++) sim.tower.place("floor", fl, x);
      for (let x = x0 - 1; x >= 0; x--) sim.tower.place("floor", fl, x);
    }
    const metro = sim.tower.place("metro", -2, 0); // 3-floor metro (-2/-1/0)
    expect(metro.ok).toBe(true);
    const afterMetro = sim.congestion();
    expect(afterMetro).toBeLessThan(before);
  });

  it("excavating basement rooms can unearth treasure", () => {
    const sim = Simulation.newGame(42);
    sim.star = 3; // parking unlocks at 3★ (canon)
    sim.money = 10_000_000;
    const x0 = Math.floor(GRID.width / 2) - 20;
    // Lay a wide B1 (floor 0) slab, then dig 20 parking rooms into it.
    for (let i = 0; i < 120 && x0 + i < GRID.width; i++) sim.tower.place("floor", 0, x0 + i);
    let built = 0;
    for (let i = 0; i + 6 <= 120 && x0 + i + 6 <= GRID.width; i += 6) {
      if (sim.build("parking", 0, x0 + i).ok) built++;
    }
    expect(built).toBeGreaterThan(10);
    const treasure = sim.log.filter((e) => e.text.toLowerCase().includes("treasure"));
    expect(treasure.length).toBeGreaterThan(0);
  });
});
