import { describe, it, expect } from "vitest";
import { Simulation, ECON, VACATE_RESCIND } from "../../engine/Simulation";
import { ElevatorDispatch } from "../../engine/ElevatorDispatch";
import { FACILITIES, GRID } from "../../engine/facilities";
import type { FacilityKind, SerializedUnit, Unit } from "../../engine/types";
import { isOperational } from "../../engine/types";
import { SHOP_SUBTYPES } from "../../engine/retailSubtypes";

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
    for (let f = 2; f <= 14; f++) for (let i = 0; i < 24; i++) sim.tower.place("floor", f, x0 + i);
    // Thirteen single-floor stair flights chained 1→14, staggered so the 8-wide
    // shafts never overlap. Reachability (components) and routing (BFS) must agree.
    for (let f = 1; f <= 13; f++) {
      const r = sim.tower.placeTransport("stairs", x0 + (f % 3) * 8, f, f + 1);
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
    // …then the service elevator covering the same hop (clear of the 8-wide stairs).
    expect(sim.tower.placeTransport("elevatorService", x0 + 16, 2, 5).ok).toBe(true);
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
    expect(sim.buildTransport("elevatorStandard", x0, 1, 6).ok).toBe(true);
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
    expect(sim.buildTransport("elevatorStandard", x0, 1, 6).ok).toBe(true);
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

  it("extends a shaft up past the built structure, auto-laying the floor behind it", () => {
    const sim = base(2); // structure exists on floors 2..10 only
    const x0 = Math.floor(GRID.width / 2) - 20;
    expect(sim.buildTransport("elevatorStandard", x0, 1, 6).ok).toBe(true);
    const t = sim.tower.transports[0];
    expect(sim.tower.resizeTransport(t.id, 1, 10).ok).toBe(true); // up to built structure
    expect(t.top).toBe(10);
    // Extending into empty sky above the tower now brings the floor with it:
    // floor 11 rests on floor 10, and plain floor is laid across the shaft's
    // own 4-tile footprint (the standard elevator's width).
    const up = sim.tower.resizeTransport(t.id, 1, 11);
    expect(up.ok).toBe(true);
    expect(up.floorTilesCreated).toBe(4);
    expect(t.top).toBe(11);
    for (let i = 0; i < 4; i++) expect(sim.tower.structureKindAt(11, x0 + i)).toBe("floor");
  });

  it("refuses an extend whose new floor can never be fully supported (no floating in sky)", () => {
    // A width-4 shaft standing over a ONE-tile column: the shaft is served
    // (any tile under it is built), but extending up would float the three
    // outer tiles of the new floor, since only the shaft's own column has
    // structure below. The auto-floor refuses rather than lay a partial,
    // floating floor, and leaves nothing behind.
    const sim = Simulation.newGame(2);
    const c = Math.floor(GRID.width / 2) - 20; // the starter lobby's left edge (floor 1 is lobby here)
    for (let f = 2; f <= 6; f++) expect(sim.tower.place("floor", f, c).ok).toBe(true); // a 1-wide column on the lobby
    expect(sim.buildTransport("elevatorStandard", c, 1, 6).ok).toBe(true); // width 4 over a 1-wide column
    const t = sim.tower.transports.find((tr) => tr.x === c)!;
    const up = sim.tower.resizeTransport(t.id, 1, 7); // floor 7: tile c rests on 6, but c+1..c+3 float
    expect(up.ok).toBe(false);
    expect(t.top).toBe(6); // unchanged
    expect(sim.tower.structureKindAt(7, c)).toBeUndefined(); // the one supportable tile was rolled back too
  });

  it("auto-lays multiple floors when an extend jumps several floors up at once", () => {
    const sim = base(2); // structure on floors 2..10
    const x0 = Math.floor(GRID.width / 2) - 20;
    expect(sim.buildTransport("elevatorStandard", x0, 1, 10).ok).toBe(true); // already spans the built structure
    const t = sim.tower.transports[0];
    // A drag can jump several floors in one resize: floors 11, 12, 13 are all
    // open sky, and each rests on the one below it (11 on 10, 12 on 11, ...),
    // so the whole run auto-floors in support order.
    const up = sim.tower.resizeTransport(t.id, 1, 13);
    expect(up.ok).toBe(true);
    expect(up.floorTilesCreated).toBe(3 * 4); // three stories, four tiles each
    for (let fl = 11; fl <= 13; fl++)
      for (let i = 0; i < 4; i++) expect(sim.tower.structureKindAt(fl, x0 + i)).toBe("floor");
  });

  it("completes a PARTIAL floor behind the shaft on extend (fills the missing columns)", () => {
    // A newly-served floor with structure under only SOME of the shaft columns
    // used to pass the any-tile served check and leave the shaft floating over
    // the empty columns. The extend now fills those columns too.
    const sim = base(2); // floors 2..10 at x0, width 20
    const x0 = Math.floor(GRID.width / 2) - 20;
    expect(sim.buildTransport("elevatorStandard", x0, 1, 10).ok).toBe(true); // width 4 over the full block
    const t = sim.tower.transports[0];
    // Hand-build only two of the four shaft columns on floor 11 (they rest on
    // floor 10). The other two are open sky.
    expect(sim.tower.place("floor", 11, x0).ok).toBe(true);
    expect(sim.tower.place("floor", 11, x0 + 1).ok).toBe(true);
    const up = sim.tower.resizeTransport(t.id, 1, 11);
    expect(up.ok).toBe(true);
    expect(up.floorTilesCreated).toBe(2); // only the two missing columns
    // All four columns of floor 11 are now floored: no floating shaft cell.
    for (let i = 0; i < 4; i++) expect(sim.tower.structureKindAt(11, x0 + i)).toBe("floor");
  });

  it("auto-lays the floor when an elevator extends DOWN into the basement", () => {
    const sim = base(2); // floors 2..10 at x0; floor 1 is the starter lobby
    const x0 = Math.floor(GRID.width / 2) - 20;
    expect(sim.buildTransport("elevatorStandard", x0, 1, 6).ok).toBe(true);
    const t = sim.tower.transports[0];
    // Extend down to B2 (floor -1). Floor 0 hangs off floor 1 above, floor -1
    // hangs off floor 0: the basement floors auto-lay top-down in support order.
    const down = sim.tower.resizeTransport(t.id, -1, 6);
    expect(down.ok).toBe(true);
    expect(t.bottom).toBe(-1);
    for (const fl of [0, -1])
      for (let i = 0; i < 4; i++) expect(sim.tower.structureKindAt(fl, x0 + i)).toBe("floor");
  });

  it("refuses to auto-floor through an unbuilt sky-lobby story, asking for the lobby first", () => {
    // A sky-lobby floor (15) is a player-placed concourse: the auto-floor must
    // not pollute it with plain floor (which would also block the sky lobby the
    // player still has to place). So extending through an unbuilt floor 15
    // refuses and names the fix, instead of auto-committing a lobby or laying
    // plain floor there.
    const sim = Simulation.newGame(2);
    const x0 = Math.floor(GRID.width / 2) - 20;
    for (let f = 2; f <= 14; f++) for (let i = 0; i < 4; i++) expect(sim.tower.place("floor", f, x0 + i).ok).toBe(true);
    expect(sim.buildTransport("elevatorStandard", x0, 1, 14).ok).toBe(true);
    const t = sim.tower.transports[0];
    const up = sim.tower.resizeTransport(t.id, 1, 15); // floor 15 is an unbuilt sky lobby
    expect(up.ok).toBe(false);
    expect(up.reason).toBe("Build the sky lobby on floor 15 first, then extend through it.");
    expect(t.top).toBe(14); // unchanged
    expect(sim.tower.structureKindAt(15, x0)).toBeUndefined(); // nothing laid on the concourse
    // Once the player places the sky lobby on 15, the extend goes through.
    for (let i = 0; i < 4; i++) expect(sim.tower.place("lobby", 15, x0 + i).ok).toBe(true);
    const up2 = sim.tower.resizeTransport(t.id, 1, 15);
    expect(up2.ok).toBe(true);
    expect(t.top).toBe(15);
  });

  it("caps cars per elevator type", () => {
    const sim = base(3);
    sim.star = 3; // service unlocks at 2★, express at 3★
    const x0 = Math.floor(GRID.width / 2) - 20;
    // Canon: every elevator kind caps at 8 cars per shaft — service is not an
    // exception (it is a staff-only standard elevator).
    const cases: [FacilityKind, number][] = [
      ["elevatorStandard", 8],
      ["elevatorService", 8],
      ["elevatorExpress", 8],
    ];
    // Walk a cursor across the lot, spacing each shaft by its own real width
    // (plus a 1-tile gap) so the test never overlaps if an elevator width ever
    // changes — the behavior under test is car caps, not geometry.
    let x = x0;
    cases.forEach(([kind, max], i) => {
      expect(sim.buildTransport(kind, x, 1, 6).ok).toBe(true);
      // Assert the build actually appended THIS kind's shaft — otherwise a
      // silently-dropped placement would let us re-select a prior (already
      // 8-car) shaft and pass vacuously.
      expect(sim.tower.transports.length).toBe(i + 1);
      const t = sim.tower.transports[i];
      expect(t.kind).toBe(kind);
      sim.tower.setCars(t.id, 99);
      expect(t.cars).toBe(max);
      x += FACILITIES[kind].width + 1;
    });
  });

  it("computes capacity and congestion from transports", () => {
    const sim = base(4);
    const x0 = Math.floor(GRID.width / 2) - 20;
    expect(sim.buildTransport("elevatorStandard", x0, 1, 6).ok).toBe(true);
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

describe("Auto-floor bridge between modules", () => {
  it("fills the floor gap between two rooms on the same story", () => {
    const sim = Simulation.newGame(7); // starter floor-1 lobby spans [x0, x0+40)
    sim.money = 10_000_000;
    const x0 = Math.floor(GRID.width / 2) - 20;
    expect(sim.build("office", 2, x0).ok).toBe(true); // A: [x0, x0+9)
    expect(sim.tower.structureKindAt(2, x0 + 11)).toBeUndefined(); // gap is bare
    expect(sim.build("office", 2, x0 + 15).ok).toBe(true); // B: [x0+15, x0+24)
    // The six-tile gap [x0+9, x0+15) is now plain floor, joining A to B.
    for (let i = 9; i < 15; i++) expect(sim.tower.structureKindAt(2, x0 + i)).toBe("floor");
    // Tiles beyond the neighbors are untouched (bridge only spans the gap).
    expect(sim.tower.structureKindAt(2, x0 + 30)).toBeUndefined();
  });

  it("bridges symmetrically when the second room lands to the left", () => {
    const sim = Simulation.newGame(7);
    sim.money = 10_000_000;
    const x0 = Math.floor(GRID.width / 2) - 20;
    sim.build("office", 2, x0 + 15); // placed first
    expect(sim.build("office", 2, x0).ok).toBe(true); // now to its left
    for (let i = 9; i < 15; i++) expect(sim.tower.structureKindAt(2, x0 + i)).toBe("floor");
  });

  it("charges for the bridge floor and blocks placement when it can't be afforded", () => {
    const sim = Simulation.newGame(7);
    sim.money = 10_000_000;
    const x0 = Math.floor(GRID.width / 2) - 20;
    sim.build("office", 2, x0); // A
    const can = sim.canBuild("office", 2, x0 + 15);
    // Office + the 9 floors under it + the 6 bridge floors to reach A.
    expect(can.cost).toBe(FACILITIES.office.cost + (9 + 6) * FACILITIES.floor.cost);
    sim.money = can.cost - 1; // one dollar short of the whole run
    expect(sim.build("office", 2, x0 + 15).ok).toBe(false);
    expect(sim.money).toBe(can.cost - 1); // nothing charged, nothing built
    expect(sim.tower.structureKindAt(2, x0 + 11)).toBeUndefined();
    // With exactly enough, it goes in and the money math ties out.
    sim.money = can.cost;
    expect(sim.build("office", 2, x0 + 15).ok).toBe(true);
    expect(sim.money).toBe(0);
  });

  it("leaves a lone room with only its own floor (no neighbor, no bridge)", () => {
    const sim = Simulation.newGame(7);
    sim.money = 10_000_000;
    const x0 = Math.floor(GRID.width / 2) - 20;
    const before = sim.money;
    expect(sim.build("office", 2, x0).ok).toBe(true);
    const cost = FACILITIES.office.cost + FACILITIES.office.width * FACILITIES.floor.cost;
    expect(before - sim.money).toBe(cost); // no extra bridge tiles charged
    expect(sim.tower.structureKindAt(2, x0 + 12)).toBeUndefined();
  });

  it("fills the gap between two sky lobbies with lobby tiles, not floor", () => {
    const sim = Simulation.newGame(7);
    sim.money = 10_000_000;
    const x0 = Math.floor(GRID.width / 2) - 20;
    const lf = GRID.lobbyInterval; // 15, a sky-lobby floor
    // Raise a support column to floor 14 but leave floor 15 empty.
    for (let fl = 2; fl < lf; fl++) {
      for (let i = 0; i < 10; i++) sim.tower.place("floor", fl, x0 + i);
    }
    expect(sim.build("lobby", lf, x0).ok).toBe(true); // A at x0
    expect(sim.build("lobby", lf, x0 + 7).ok).toBe(true); // B at x0+7
    // The gap [x0+1, x0+7) is lobby (matching substrate), never plain floor.
    for (let i = 1; i < 7; i++) expect(sim.tower.structureKindAt(lf, x0 + i)).toBe("lobby");
  });

  it("bridges a plain floor tool across a gap to a neighboring floor", () => {
    const sim = Simulation.newGame(7);
    sim.money = 10_000_000;
    const x0 = Math.floor(GRID.width / 2) - 20;
    expect(sim.build("floor", 2, x0).ok).toBe(true);
    expect(sim.build("floor", 2, x0 + 6).ok).toBe(true); // dropped six tiles away
    // Owner-requested: dropping a floor tile a few cells from another floor
    // fills the gap, exactly like the room/lobby bridge. The five-tile gap
    // [x0+1, x0+6) is now plain floor.
    for (let i = 1; i < 6; i++) expect(sim.tower.structureKindAt(2, x0 + i)).toBe("floor");
  });

  it("charges floor tiles for a floor-tool bridge and blocks one that can't be afforded", () => {
    const sim = Simulation.newGame(7);
    sim.money = 10_000_000;
    const x0 = Math.floor(GRID.width / 2) - 20;
    expect(sim.build("floor", 2, x0).ok).toBe(true); // the neighbor to bridge back to
    const can = sim.canBuild("floor", 2, x0 + 6);
    // The placed tile plus the five gap tiles, all at floor cost.
    expect(can.cost).toBe(6 * FACILITIES.floor.cost);
    sim.money = can.cost - 1; // a dollar short of the whole run
    expect(sim.build("floor", 2, x0 + 6).ok).toBe(false);
    expect(sim.tower.structureKindAt(2, x0 + 3)).toBeUndefined(); // nothing laid
    sim.money = can.cost;
    expect(sim.build("floor", 2, x0 + 6).ok).toBe(true);
  });

  it("bridges a floor tool on the GROUND, rescuing a placement that isn't yet connected", () => {
    const sim = Simulation.newGame(7); // starter floor-1 lobby spans [x0, x0+40)
    sim.money = 10_000_000;
    const x0 = Math.floor(GRID.width / 2) - 20;
    // A floor tile right at the lobby's edge connects normally (adjacent to the
    // lobby structure). A second floor five tiles further out is NOT adjacent to
    // anything, but the bridge back to the first rescues it (ground-floor
    // horizontal support), filling the gap with floor. A floor never stitches
    // into the lobby itself (substrate mismatch), so the bridge stops at the
    // first floor neighbor.
    expect(sim.build("floor", 1, x0 + 40).ok).toBe(true); // touches the lobby edge
    expect(sim.build("floor", 1, x0 + 45).ok).toBe(true); // five-tile gap, rescued
    for (let i = 41; i < 45; i++) expect(sim.tower.structureKindAt(1, x0 + i)).toBe("floor");
  });

  it("bridges a floor tool in the BASEMENT, rescuing a detached tile the same as the ground", () => {
    const sim = Simulation.newGame(7); // starter floor-1 lobby spans [x0, x0+40)
    sim.money = 10_000_000;
    const x0 = Math.floor(GRID.width / 2) - 20;
    // A B1 (floor 0) tile under the lobby's edge hangs off the lobby above it and
    // connects normally. A second B1 tile a few cells BEYOND the lobby span is
    // not adjacent to anything and has no structure above it, so it fails the
    // plain support check. But a basement uses the same horizontal (flank)
    // support as the ground, so the bridge back to the first tile rescues it,
    // just as on floor 1 (regression for the floor-1-only rescue gate).
    expect(sim.build("floor", 0, x0 + 38).ok).toBe(true); // under the lobby, supported from above
    expect(sim.build("floor", 0, x0 + 45).ok).toBe(true); // past the lobby, detached, rescued by the bridge
    for (let i = 39; i < 45; i++) expect(sim.tower.structureKindAt(0, x0 + i)).toBe("floor");
  });

  it("bridges to the nearest neighbor even across a wide gap (no distance cap)", () => {
    const sim = Simulation.newGame(7);
    sim.money = 10_000_000;
    const x0 = Math.floor(GRID.width / 2) - 20;
    sim.build("office", 2, x0); // A: [x0, x0+9)
    expect(sim.build("office", 2, x0 + 30).ok).toBe(true); // B: [x0+30, x0+39)
    // The whole 21-tile gap fills; bridging is nearest-neighbor, not capped.
    for (let i = 9; i < 30; i++) expect(sim.tower.structureKindAt(2, x0 + i)).toBe("floor");
  });

  it("bridges identically in Modern mode (mode-agnostic, like auto-floor-under-room)", () => {
    const sim = Simulation.newGame(7, "modern");
    sim.money = 10_000_000;
    const x0 = Math.floor(GRID.width / 2) - 20;
    sim.build("office", 2, x0);
    expect(sim.build("office", 2, x0 + 15).ok).toBe(true);
    for (let i = 9; i < 15; i++) expect(sim.tower.structureKindAt(2, x0 + i)).toBe("floor");
  });

  it("bridges a basement gap with floor (the ground/basement outward-fill path)", () => {
    const sim = Simulation.newGame(7); // floor-1 lobby (support from above) spans [x0, x0+40)
    sim.money = 10_000_000;
    sim.star = 3; // parking unlocks at 3 stars
    const x0 = Math.floor(GRID.width / 2) - 20;
    expect(sim.build("parking", 0, x0).ok).toBe(true); // A: [x0, x0+4)
    expect(sim.build("parking", 0, x0 + 10).ok).toBe(true); // B: [x0+10, x0+14)
    // The basement gap [x0+4, x0+10) fills with floor, hanging off floor 1 above.
    for (let i = 4; i < 10; i++) expect(sim.tower.structureKindAt(0, x0 + i)).toBe("floor");
  });

  it("charges lobby tiles for a lobby bridge and blocks one that can't be afforded", () => {
    const sim = Simulation.newGame(7);
    sim.money = 10_000_000;
    const x0 = Math.floor(GRID.width / 2) - 20;
    const lf = GRID.lobbyInterval; // 15
    for (let fl = 2; fl < lf; fl++) {
      for (let i = 0; i < 12; i++) sim.tower.place("floor", fl, x0 + i);
    }
    sim.build("lobby", lf, x0); // A
    const can = sim.canBuild("lobby", lf, x0 + 7);
    // Lobby B plus the six lobby tiles bridging back to A, all at lobby price.
    expect(can.cost).toBe(FACILITIES.lobby.cost * (1 + 6));
    sim.money = can.cost - 1;
    expect(sim.build("lobby", lf, x0 + 7).ok).toBe(false); // unaffordable, so refused
    expect(sim.tower.structureKindAt(lf, x0 + 3)).toBeUndefined();
    sim.money = can.cost;
    expect(sim.build("lobby", lf, x0 + 7).ok).toBe(true);
    expect(sim.money).toBe(0);
  });

  it("bridges every story of a stacked multi-story facility above ground", () => {
    const sim = Simulation.newGame(7);
    sim.money = 20_000_000;
    sim.star = 3; // cinema unlocks at 3 stars
    const x0 = Math.floor(GRID.width / 2) - 20;
    // Solid support up to floor 4 across both cinema footprints and the gap.
    for (let fl = 1; fl <= 4; fl++) {
      for (let i = 0; i < 65; i++) sim.tower.place("floor", fl, x0 + i);
    }
    expect(sim.build("cinema", 5, x0).ok).toBe(true); // A: floors 5-6, [x0, x0+31)
    expect(sim.build("cinema", 5, x0 + 34).ok).toBe(true); // B: floors 5-6, [x0+34, x0+65)
    // Both walkways bridge: floor 6's gap rests on the floor-5 gap this fill lays.
    for (const fl of [5, 6]) {
      for (let i = 31; i < 34; i++) expect(sim.tower.structureKindAt(fl, x0 + i)).toBe("floor");
    }
  });

  it("bridges a detached ground concourse lobby with lobby tiles", () => {
    const sim = Simulation.newGame(7); // starter ground lobby spans [x0, x0+40)
    sim.money = 10_000_000;
    const x0 = Math.floor(GRID.width / 2) - 20;
    // A ground tile this far from the concourse can't stand alone today; the
    // lobby bridge is what connects it. Dropped 5 tiles past the concourse edge.
    expect(sim.tower.structureKindAt(1, x0 + 42)).toBeUndefined(); // gap bare before
    expect(sim.build("lobby", 1, x0 + 45).ok).toBe(true);
    // The gap [x0+40, x0+45) fills with LOBBY (not floor), joining the concourse,
    // and the dropped tile itself is a lobby.
    for (let i = 40; i <= 45; i++) expect(sim.tower.structureKindAt(1, x0 + i)).toBe("lobby");
  });

  it("charges a ground lobby bridge at lobby price and blocks an unaffordable drop", () => {
    const sim = Simulation.newGame(7);
    sim.money = 10_000_000;
    const x0 = Math.floor(GRID.width / 2) - 20;
    const can = sim.canBuild("lobby", 1, x0 + 45);
    // The dropped lobby plus the 5 lobby tiles bridging to the concourse.
    expect(can.cost).toBe(FACILITIES.lobby.cost * (1 + 5));
    sim.money = can.cost - 1;
    expect(sim.build("lobby", 1, x0 + 45).ok).toBe(false); // whole run unaffordable
    expect(sim.tower.structureKindAt(1, x0 + 42)).toBeUndefined(); // nothing laid
    expect(sim.money).toBe(can.cost - 1); // nothing charged
    sim.money = can.cost;
    expect(sim.build("lobby", 1, x0 + 45).ok).toBe(true);
    expect(sim.money).toBe(0);
  });

  it("still refuses a lobby with no reachable lobby neighbor (bridge rescue is narrow)", () => {
    const sim = Simulation.newGame(7);
    sim.money = 10_000_000;
    const x0 = Math.floor(GRID.width / 2) - 20;
    // Floor 7 is not a lobby floor and has no lobby to bridge to: the rescue must
    // not fire, so this stays refused (a lobby can't float onto a plain story).
    expect(sim.build("lobby", 7, x0).ok).toBe(false);
    expect(sim.tower.structureKindAt(7, x0)).toBeUndefined();
  });

  it("does not rescue an unsupported sky lobby (bridge can't substitute for vertical support)", () => {
    // The rescue is ground-only: a sky-lobby tile without floor-14 support below
    // it stays refused, because laying an adjacent lobby bridge does not build
    // that vertical support. Guard against the Codex-flagged regression where a
    // sky lobby with a neighbor plus a supported gap tile would sneak through.
    const sim = Simulation.newGame(7);
    sim.money = 10_000_000;
    const x0 = Math.floor(GRID.width / 2) - 20;
    const lf = GRID.lobbyInterval; // 15
    // Build a supported neighbor A at x0 (column supported by floors 2..14).
    for (let fl = 2; fl < lf; fl++) {
      for (let i = 0; i < 8; i++) sim.tower.place("floor", fl, x0 + i);
    }
    expect(sim.build("lobby", lf, x0).ok).toBe(true); // A: [x0, x0+1)
    // Target B at x0+10 has NO floor 14 under it. The rescue must not fire.
    expect(sim.build("lobby", lf, x0 + 10).ok).toBe(false);
    // Nothing was laid: no orphan bridge tiles, no B.
    expect(sim.tower.structureKindAt(lf, x0 + 10)).toBeUndefined();
    expect(sim.tower.structureKindAt(lf, x0 + 5)).toBeUndefined();
  });

  it("drains a right-side basement bridge in one pass (no O(gap²) retries)", () => {
    // The right-side outward-fill regression Copilot flagged: for a
    // ground/basement bridge whose neighbor is to the RIGHT, the plan must emit
    // tiles from the neighbor inward so each rests on the last, not primary-side
    // outward (which would need O(gap²) retry passes). Pin it: a wide gap fills
    // completely, so if the retry loop ever regresses we would leave holes.
    const sim = Simulation.newGame(7);
    sim.money = 10_000_000;
    sim.star = 3;
    const x0 = Math.floor(GRID.width / 2) - 20;
    // Two parking spaces in the basement, B on the RIGHT with a wide gap.
    sim.build("parking", 0, x0); // A: [x0, x0+4)
    expect(sim.build("parking", 0, x0 + 20).ok).toBe(true); // B: [x0+20, x0+24)
    for (let i = 4; i < 20; i++) expect(sim.tower.structureKindAt(0, x0 + i)).toBe("floor");
  });
});

describe("Sky-lobby canon: player-triggered claim + lobby permanence", () => {
  // Build a tower up to the story just below the target sky-lobby floor so the
  // sky lobby has direct support from the story below. Uses tower.place (not
  // sim.build) so the fixture stays a low-level test setup, not a game action.
  function towerToFloor(sim: Simulation, top: number): number {
    const x0 = Math.floor(GRID.width / 2) - 20;
    sim.money = 1e12;
    for (let f = 2; f <= top; f++) for (let i = 0; i < 40; i++) sim.tower.place("floor", f, x0 + i);
    return x0;
  }

  it("claims a sky-lobby floor the moment a lobby lands on it", () => {
    const sim = Simulation.newGame(7);
    const x0 = towerToFloor(sim, 14);
    // Floor 15 is unclaimed to start: floorHasLobby is false.
    expect(sim.tower.floorHasLobby(15)).toBe(false);
    expect(sim.build("lobby", 15, x0).ok).toBe(true);
    expect(sim.tower.floorHasLobby(15)).toBe(true);
    // Once claimed, adding a plain floor tile anywhere on that story is refused.
    const r = sim.build("floor", 15, x0 + 20);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("Sky lobbies are concourses. Only lobby tiles go here.");
  });

  it("refuses a single-story room on a claimed sky-lobby floor", () => {
    const sim = Simulation.newGame(7);
    const x0 = towerToFloor(sim, 14);
    sim.star = 5;
    sim.buildTransport("elevatorStandard", x0 + 20, 1, 15);
    expect(sim.build("lobby", 15, x0).ok).toBe(true); // claim floor 15
    const r = sim.build("office", 15, x0 + 20); // single-story room on the claimed story
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("This room would sit on a sky lobby. Move it up or down a story.");
  });

  it("refuses a multi-story room whose span crosses a claimed sky-lobby floor", () => {
    const sim = Simulation.newGame(7);
    const x0 = towerToFloor(sim, 14);
    sim.star = 5; // unlock cinema
    sim.buildTransport("elevatorStandard", x0 + 20, 1, 15);
    expect(sim.build("lobby", 15, x0).ok).toBe(true); // claim floor 15
    // Cinema is 2 stories tall (footprint spans floor+0 and floor+1). Placing
    // it at floor 14 would put its upper story on the claimed floor 15.
    const r = sim.build("cinema", 14, x0 + 5);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("This room would sit on a sky lobby. Move it up or down a story.");
  });

  it("refuses a sky lobby on a floor that already carries rooms", () => {
    const sim = Simulation.newGame(7);
    const x0 = towerToFloor(sim, 15); // includes plain floor on 15, no rooms yet
    sim.star = 5;
    sim.buildTransport("elevatorStandard", x0 + 20, 1, 15); // service floor 15 so office builds
    sim.tower.place("office", 15, x0); // room on floor 15 while it's unclaimed
    const r = sim.build("lobby", 15, x0 + 20);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("Clear the floor tiles or rooms here first, then place your sky lobby.");
  });

  it("refuses a sky lobby over plain floor tiles too (lay lobbies first, or clear the tiles)", () => {
    // The exact silent-degradation mode that rotted the phase2 endgame fixture:
    // floor tiles laid across a sky-lobby floor, then a lobby placed on top.
    // Every tile of the lobby must be refused, loudly, so a fixture (or player)
    // that skips checking ok ends up with NO sky lobby rather than a partial one.
    const sim = Simulation.newGame(7);
    const x0 = towerToFloor(sim, 15); // lays plain floor tiles up through 15
    const r = sim.build("lobby", 15, x0);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("Clear the floor tiles or rooms here first, then place your sky lobby.");
    expect(sim.tower.floorHasLobby(15)).toBe(false);
  });

  it("does not restrict a plain floor on an unclaimed sky-lobby floor", () => {
    const sim = Simulation.newGame(7);
    const x0 = towerToFloor(sim, 14); // support up through floor 14, floor 15 empty
    expect(sim.tower.floorHasLobby(15)).toBe(false); // unclaimed sky-lobby floor
    // A plain floor tile on an unclaimed sky-lobby floor is allowed (the rule
    // only fires once a lobby has actually claimed the story).
    expect(sim.build("floor", 15, x0).ok).toBe(true);
  });

  it("does not fire on ground floor 1 (the concourse keeps its rules)", () => {
    const sim = Simulation.newGame(7); // ground concourse pre-seeded with lobby
    const x0 = Math.floor(GRID.width / 2) - 20;
    // Floor 1 has a lobby (from newGame), but adding more plain floor tiles on
    // it is still allowed, unlike a claimed sky-lobby floor.
    expect(sim.build("floor", 1, x0 + 40).ok).toBe(true);
  });

  it("refuses to bulldoze a lobby tile at any floor (1994 canon: lobbies are permanent)", () => {
    const sim = Simulation.newGame(7); // starter lobby on floor 1
    const x0 = Math.floor(GRID.width / 2) - 20;
    const lobby = sim.tower.unitAt(1, x0);
    expect(lobby?.kind).toBe("lobby");
    const reason = sim.tower.removalReason(lobby!.id);
    expect(reason).toBe("Lobby tiles are permanent. The 1994 game does not let you remove them.");
    // sellAt on the lobby fails silently (no refund, tile stays).
    const before = sim.money;
    expect(sim.sellAt(1, x0)).toBe(false);
    expect(sim.money).toBe(before);
    expect(sim.tower.unitAt(1, x0)?.kind).toBe("lobby");
  });

  it("still allows internal engine callers to remove a lobby (bridge / auto-floor rollback)", () => {
    // Rollback paths call tower.removeUnit(id) directly, bypassing removalReason.
    // Pin the bypass so the sky-lobby-canon guard cannot break internal rollback.
    const sim = Simulation.newGame(7);
    const x0 = Math.floor(GRID.width / 2) - 20;
    const id = sim.tower.unitAt(1, x0)!.id;
    expect(sim.tower.removeUnit(id)).toBeDefined();
    expect(sim.tower.unitAt(1, x0)).toBeUndefined();
  });

  it("enforces the placement rule identically in Classic and Modern", () => {
    for (const mode of ["classic", "modern"] as const) {
      const sim = Simulation.newGame(7, mode);
      const x0 = towerToFloor(sim, 14);
      expect(sim.build("lobby", 15, x0).ok).toBe(true);
      const r = sim.build("floor", 15, x0 + 20);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("Sky lobbies are concourses. Only lobby tiles go here.");
    }
  });

  it("gates the preview-reason hover surface by mode (Modern true, Classic false)", () => {
    const classic = Simulation.newGame(7, "classic");
    const modern = Simulation.newGame(7, "modern");
    expect(classic.rules.showsPreviewReason).toBe(false);
    expect(modern.rules.showsPreviewReason).toBe(true);
  });

  it("hands the tower the mode's rule-set, so escalator placement follows the mode", () => {
    const classic = Simulation.newGame(7, "classic");
    const modern = Simulation.newGame(7, "modern");
    expect(classic.tower.rules).toBe(classic.rules);
    expect(modern.tower.rules).toBe(modern.rules);
    // Build the same second story on the seeded ground-lobby strip.
    const x0 = Math.floor(GRID.width / 2) - 20;
    for (const sim of [classic, modern]) {
      for (let i = 0; i < 20; i++) sim.tower.place("floor", 2, x0 + i);
      expect(sim.tower.place("office", 2, x0).ok).toBe(true);
    }
    // Same layout, same gesture: Classic refuses (1994 canon), Modern builds.
    expect(classic.tower.validateTransport("escalator", x0 + 12, 1, 2).ok).toBe(false);
    expect(modern.tower.validateTransport("escalator", x0 + 12, 1, 2).ok).toBe(true);
  });
});

// Pinned golden subtype sequences per seed for the determinism test below.
// Any change here means the RNG stream shifted (a wasted draw, a Mulberry32
// constant change, a fixture reorder), not that the subtype list itself moved.
const SEED_11_SUBTYPES = ["Boutique", "Boutique", "Electronics"] as const;
const SEED_42_SUBTYPES = ["Electronics", "Drug Store", "Post Office"] as const;

describe("Retail subtypes: build roll, RNG discipline, reroll, and cosmetic invariant", () => {
  // Build one shop / fastFood / restaurant against a served tower and return
  // the placed unit. Uses sim.build (the roll seam is inside sim.build) so
  // every test exercises the real gesture path.
  function buildOne(sim: Simulation, kind: FacilityKind, x: number): Unit {
    sim.money = 1e12;
    sim.star = 5;
    const r = sim.build(kind, 2, x);
    expect(r.ok).toBe(true);
    const u = sim.tower.unitAt(2, x);
    if (!u) throw new Error("placement failed");
    return u;
  }

  it("assigns a canon subtype to every new shop, fast food, and restaurant", () => {
    // builtTower serves floor 2 across [x0, x0+40); a restaurant is 24 wide so
    // each kind gets its own tower to keep spans in range.
    const buildKind = (kind: FacilityKind): Unit => {
      const s = builtTower(11);
      return buildOne(s, kind, Math.floor(GRID.width / 2) - 20);
    };
    expect(typeof buildKind("shop").subtype).toBe("string");
    expect(typeof buildKind("fastFood").subtype).toBe("string");
    expect(typeof buildKind("restaurant").subtype).toBe("string");
  });

  it("leaves subtype undefined on non-retail kinds (no wasted RNG draw)", () => {
    const sim = builtTower(11);
    const x0 = Math.floor(GRID.width / 2) - 20;
    const office = buildOne(sim, "office", x0);
    expect(office.subtype).toBeUndefined();
  });

  it("is deterministic across seeds: same seed produces the same subtype sequence", () => {
    const build3 = (seed: number): [string?, string?, string?] => {
      const sim = builtTower(seed);
      const x0 = Math.floor(GRID.width / 2) - 20;
      return [
        buildOne(sim, "shop", x0).subtype,
        buildOne(sim, "shop", x0 + 12).subtype,
        buildOne(sim, "shop", x0 + 24).subtype,
      ];
    };
    // Same-seed determinism: two runs of the same seed produce identical
    // subtype sequences.
    expect(build3(11)).toEqual(build3(11));
    // Pinned golden sequences per seed: any RNG-stream change (a wasted draw
    // earlier in the build path, a different Mulberry32 constant, a reordered
    // fixture) would shift these deterministically, no flake window.
    expect(build3(11)).toEqual([SEED_11_SUBTYPES[0], SEED_11_SUBTYPES[1], SEED_11_SUBTYPES[2]]);
    expect(build3(42)).toEqual([SEED_42_SUBTYPES[0], SEED_42_SUBTYPES[1], SEED_42_SUBTYPES[2]]);
  });

  it("byte-identical Classic RNG stream when no retail is built (short-circuit gate)", () => {
    // Build N non-retail units, then draw a WITNESS value from sim.rng. A
    // regression that added even one wasted RNG draw during a non-retail build
    // would visibly shift the witness. The golden number is captured on a
    // fresh, no-retail scenario the first time this test runs; the seed and
    // build sequence are pinned so it's reproducible.
    const witness = (): number => {
      const sim = builtTower(3);
      const x0 = Math.floor(GRID.width / 2) - 20;
      buildOne(sim, "office", x0);
      buildOne(sim, "office", x0 + 12);
      buildOne(sim, "condo", x0 + 24);
      return sim.rng.int(0, 1_000_000_000);
    };
    // Deterministic: same-seed, same-script gives the same witness.
    expect(witness()).toBe(witness());
    // Pinned golden number: recorded on the first green run of this test with
    // the short-circuit in place. If this drifts, a non-retail build path
    // started drawing from sim.rng and the guarantee is broken.
    expect(witness()).toBe(720226784);
  });

  it("rerollSubtype picks a different canon name from the current on every call", () => {
    const sim = builtTower(11);
    const x0 = Math.floor(GRID.width / 2) - 20;
    const shop = buildOne(sim, "shop", x0);
    const first = shop.subtype!;
    // 20 rerolls: each result must be a canon name AND different from the
    // preceding subtype (the "guarantee different from current" contract).
    let prev = first;
    for (let i = 0; i < 20; i++) {
      const next = sim.rerollSubtype(shop.id);
      expect(typeof next).toBe("string");
      expect(next).not.toBe(prev);
      expect(SHOP_SUBTYPES.includes(next as (typeof SHOP_SUBTYPES)[number])).toBe(true);
      prev = next!;
    }
  });

  it("rerollSubtype from a legacy (undefined) unit can reach every canon variant, including the last", () => {
    // A legacy retail unit loads with subtype === undefined. Reroll must be
    // able to land on ANY canon name, including the last entry in the list.
    // Pin the last shop variant ("Sports Gear") specifically because the
    // earlier off-current index math left it unreachable when currentIdx = -1.
    const sim = builtTower(11);
    const x0 = Math.floor(GRID.width / 2) - 20;
    const shop = buildOne(sim, "shop", x0);
    const reached = new Set<string>();
    for (let i = 0; i < 400; i++) {
      shop.subtype = undefined; // simulate a legacy unit before every reroll
      const next = sim.rerollSubtype(shop.id);
      if (next !== undefined) reached.add(next);
    }
    // With 11 shop variants and 400 uniform-random rolls, every entry is
    // reached with overwhelming probability (missing 1 = (10/11)^400, negligible).
    expect(reached.size).toBe(SHOP_SUBTYPES.length);
    expect(reached.has(SHOP_SUBTYPES[SHOP_SUBTYPES.length - 1])).toBe(true);
  });

  it("rerollSubtype is a no-op on non-retail kinds", () => {
    const sim = builtTower(11);
    const x0 = Math.floor(GRID.width / 2) - 20;
    const office = buildOne(sim, "office", x0);
    expect(sim.rerollSubtype(office.id)).toBeUndefined();
    expect(office.subtype).toBeUndefined();
  });

  it("cosmetic invariant: same seed + differing subtypes on retail leaves the economy byte-identical", () => {
    // Two towers, identical seeds and identical build scripts (both include a
    // fast-food unit). Force each to a DIFFERENT subtype after build; run for
    // several weeks; assert money and per-unit pendingIncome match. This pins
    // that no economy path reads Unit.subtype.
    const drive = (force: string): { money: number; pending: number[] } => {
      const sim = builtTower(11);
      const x0 = Math.floor(GRID.width / 2) - 20;
      buildOne(sim, "office", x0);
      const ff = buildOne(sim, "fastFood", x0 + 12);
      ff.subtype = force; // pin the variant
      for (let i = 0; i < 24 * 14; i++) sim.tick(60);
      const pending = sim.tower.units.map((u) => u.pendingIncome ?? 0);
      return { money: sim.money, pending };
    };
    const a = drive("Chinese Cafe");
    const b = drive("Hamburger Stand");
    expect(a.money).toBe(b.money);
    expect(a.pending).toEqual(b.pending);
  });

  it("round-trip: subtype survives serialize + deserialize", () => {
    const sim = builtTower(11);
    const x0 = Math.floor(GRID.width / 2) - 20;
    const shop = buildOne(sim, "shop", x0);
    const before = shop.subtype!;
    const wire = sim.serialize();
    const revived = Simulation.deserialize(wire);
    const revivedShop = revived.tower.unitAt(2, x0);
    expect(revivedShop?.subtype).toBe(before);
  });

  it("whitelist coerce: hand-edited garbage in the save drops subtype to undefined", () => {
    const sim = builtTower(11);
    const x0 = Math.floor(GRID.width / 2) - 20;
    buildOne(sim, "shop", x0);
    const wire = sim.serialize();
    // Force a bogus subtype on the shop record in the wire format.
    const doc = JSON.parse(JSON.stringify(wire));
    for (const u of doc.units as SerializedUnit[]) {
      if (u.kind === "shop") u.subtype = "Not A Canon Variant";
    }
    const revived = Simulation.deserialize(doc);
    const revivedShop = revived.tower.unitAt(2, x0);
    expect(revivedShop?.subtype).toBeUndefined();
  });

  it("legacy save without subtype: units load as generic (no re-roll on load)", () => {
    const sim = builtTower(11);
    const x0 = Math.floor(GRID.width / 2) - 20;
    buildOne(sim, "shop", x0);
    const wire = sim.serialize();
    const doc = JSON.parse(JSON.stringify(wire));
    // Strip every subtype field to simulate a save that predates this feature.
    for (const u of doc.units as SerializedUnit[]) {
      delete u.subtype;
    }
    const revived = Simulation.deserialize(doc);
    const revivedShop = revived.tower.unitAt(2, x0);
    expect(revivedShop?.subtype).toBeUndefined();
  });
});

describe("Commercial-venue inspector: patronage/profit accumulation, rollover, save shape", () => {
  function buildOne(sim: Simulation, kind: FacilityKind, x: number): Unit {
    sim.money = 1e12;
    // Star 3 unlocks the shop / cinema / party hall this suite builds. Drop it
    // back to 1 right after the build so the tick loop stays BELOW the 2-star
    // random-event threshold (`EventSystem.maybeRandomEvent` returns early under
    // 2 stars): no fire or bomb can ever fire, so no emergency can gut a venue
    // and reset the fields under test, whatever the RNG stream does. Star is only
    // gated at build time, not during ticks, and retail traffic income does not
    // read the star, so the drop is inert for what these tests measure.
    sim.star = 3;
    const r = sim.build(kind, 2, x);
    expect(r.ok).toBe(true);
    const u = sim.tower.unitAt(2, x);
    if (!u) throw new Error("placement failed");
    sim.star = 1;
    return u;
  }

  it("accumulates today's patronage and profit on retail units through the trading hours", () => {
    const sim = builtTower(11);
    const x0 = Math.floor(GRID.width / 2) - 20;
    const shop = buildOne(sim, "shop", x0);
    // Advance a full day so the shop trades through its whole open window.
    for (let i = 0; i < 24; i++) sim.tick(60);
    // Note: onDay fires when the clock crosses midnight, resetting today into
    // yesterday. We assert yesterday's slot is populated instead.
    expect(shop.patronageYest ?? 0).toBeGreaterThan(0);
    expect(shop.profitYest ?? 0).toBeGreaterThan(0);
  });

  it("keeps an operational but idle venue as 'no data' through midnight, never a false 0", () => {
    // An operational shop that never draws a customer all day (here stranded by
    // removing every transport, so its floor is unreachable) must NOT wake to a
    // defined patronageYest = 0 at the rollover: that would read as a red "very
    // few customers" verdict on a venue that simply never had a trading day. Its
    // fields stay undefined so the inspector keeps saying "just opened".
    const sim = builtTower(11);
    const x0 = Math.floor(GRID.width / 2) - 20;
    const shop = buildOne(sim, "shop", x0);
    for (const t of [...sim.tower.transports]) sim.tower.removeTransport(t.id); // strand the floor
    // Cross two midnights so construction finishes (the shop turns operational)
    // and at least one rollover runs while it is idle.
    for (let i = 0; i < 48; i++) sim.tick(60);
    expect(isOperational(shop)).toBe(true);
    expect(shop.patronageToday).toBeUndefined();
    expect(shop.patronageYest).toBeUndefined();
    expect(shop.profitYest).toBeUndefined();
  });

  it("leaves patronage/profit undefined on non-retail kinds (cinema, partyHall, office)", () => {
    // Office draws no traffic income at all; cinema and partyHall DO earn
    // foot-traffic income (the loop processes them), but neither carries a canon
    // subtype, so `isRetail` is false and none of the three ever accrues the
    // retail fields. Each gets its own tower because a 31-wide cinema and a
    // 24-wide party hall don't share one floor.
    for (const kind of ["office", "cinema", "partyHall"] as const) {
      const sim = builtTower(11);
      const x0 = Math.floor(GRID.width / 2) - 20;
      const u = buildOne(sim, kind, x0);
      for (let i = 0; i < 24; i++) sim.tick(60);
      expect(u.patronageToday, kind).toBeUndefined();
      expect(u.patronageYest, kind).toBeUndefined();
      expect(u.profitToday, kind).toBeUndefined();
      expect(u.profitYest, kind).toBeUndefined();
    }
  });

  it("rolls today into yesterday and resets today at day change", () => {
    const sim = builtTower(11);
    const x0 = Math.floor(GRID.width / 2) - 20;
    const shop = buildOne(sim, "shop", x0);
    // Sim starts at 07:00. Advance 8 hours -> 15:00, well inside the trading
    // window and before midnight, so today's slot is real and yesterday's is
    // still undefined (no rollover yet).
    for (let i = 0; i < 8; i++) sim.tick(60);
    const midToday = shop.patronageToday ?? 0;
    expect(midToday).toBeGreaterThan(0);
    expect(shop.patronageYest).toBeUndefined();
    // Advance 24 more hours: 15:00 -> next-day 15:00, crossing exactly one
    // midnight so onDay fires exactly once. Yesterday captures the previous
    // full day; today has been reset and started earning again.
    for (let i = 0; i < 24; i++) sim.tick(60);
    expect(shop.patronageYest ?? 0).toBeGreaterThan(0);
    // Today's counter starts at 0 after the rollover; trading between the
    // 00:00 rollover and 15:00 the next day fills it partially, but it must
    // be strictly less than a full trading day's yesterday.
    expect(shop.patronageToday ?? 0).toBeLessThan(shop.patronageYest ?? 0);
  });

  it("cosmetic invariant: money + pendingIncome unchanged when patronage/profit are read only from render", () => {
    // Two towers, identical seed and script. One runs on the shipped code
    // (accumulators active); the other has its accumulators forcibly cleared
    // every hour. If any economy path READ the accumulators, this would drift.
    const drive = (clearEveryHour: boolean): { money: number; pending: number[] } => {
      const sim = builtTower(11);
      const x0 = Math.floor(GRID.width / 2) - 20;
      buildOne(sim, "office", x0);
      buildOne(sim, "shop", x0 + 12);
      for (let i = 0; i < 24 * 7; i++) {
        sim.tick(60);
        if (clearEveryHour) {
          for (const u of sim.tower.units) {
            u.patronageToday = undefined;
            u.patronageYest = undefined;
            u.profitToday = undefined;
            u.profitYest = undefined;
          }
        }
      }
      const pending = sim.tower.units.map((u) => u.pendingIncome ?? 0);
      return { money: sim.money, pending };
    };
    const withAccum = drive(false);
    const cleared = drive(true);
    expect(cleared.money).toBe(withAccum.money);
    expect(cleared.pending).toEqual(withAccum.pending);
  });

  it("round-trip: patronage/profit fields survive serialize + deserialize", () => {
    const sim = builtTower(11);
    const x0 = Math.floor(GRID.width / 2) - 20;
    const shop = buildOne(sim, "shop", x0);
    for (let i = 0; i < 26; i++) sim.tick(60); // cross midnight to populate yesterday
    const t = shop.patronageToday ?? 0;
    const y = shop.patronageYest ?? 0;
    const p = shop.profitYest ?? 0;
    const wire = sim.serialize();
    const revived = Simulation.deserialize(wire);
    const revivedShop = revived.tower.unitAt(2, x0)!;
    expect(revivedShop.patronageToday).toBeCloseTo(t);
    expect(revivedShop.patronageYest).toBeCloseTo(y);
    expect(revivedShop.profitYest).toBeCloseTo(p);
  });

  it("whitelist coerce: fields leaked onto a non-retail kind drop to undefined on load", () => {
    const sim = builtTower(11);
    const x0 = Math.floor(GRID.width / 2) - 20;
    buildOne(sim, "office", x0);
    const wire = sim.serialize();
    const doc = JSON.parse(JSON.stringify(wire));
    // Force the fields onto the office record (as a forged save might do).
    for (const u of doc.units as SerializedUnit[]) {
      if (u.kind === "office") {
        u.patronageToday = 999;
        u.profitYest = 999;
      }
    }
    const revived = Simulation.deserialize(doc);
    const office = revived.tower.unitAt(2, x0)!;
    expect(office.patronageToday).toBeUndefined();
    expect(office.profitYest).toBeUndefined();
  });

  it("whitelist coerce: NaN / Infinity forgery clamps to 0", () => {
    const sim = builtTower(11);
    const x0 = Math.floor(GRID.width / 2) - 20;
    buildOne(sim, "shop", x0);
    const wire = sim.serialize();
    const doc = JSON.parse(JSON.stringify(wire));
    for (const u of doc.units as SerializedUnit[]) {
      if (u.kind === "shop") {
        u.patronageToday = Number.NaN;
        u.profitYest = Number.POSITIVE_INFINITY;
      }
    }
    const revived = Simulation.deserialize(doc);
    const shop = revived.tower.unitAt(2, x0)!;
    expect(shop.patronageToday).toBe(0);
    expect(shop.profitYest).toBe(0);
  });
});
