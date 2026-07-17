import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";
import { HK_ROOMS_PER_CREW, INFEST_DAYS } from "../../engine/economy/housekeeping";
import type { FacilityKind, GameMode, Unit } from "../../engine/types";

/**
 * The cockroach infestation lifecycle and its recovery paths (see
 * `gdd-cockroach-infestation-2026-07-16.md`): a hotel room dirty past
 * {@link INFEST_DAYS} days turns `infested` (housekeeping can no longer clean
 * it), Classic recovers only by bulldozing, and Modern adds a paid exterminator.
 */

const X0 = Math.floor(GRID.width / 2) - 20;

/** A floor-2 tower with room to place hotel rooms + a housekeeping crew, served
 *  by a passenger elevator. Star 2 so hotels are unlocked. */
function hotelTower(seed: number, mode: GameMode = "classic"): Simulation {
  const sim = Simulation.newGame(seed, mode);
  sim.star = 2;
  for (let i = 0; i < 30; i++) {
    expect(sim.tower.place("floor", 2, X0 + i).ok, `place(floor, 2, ${X0 + i}) failed`).toBe(true);
  }
  expect(sim.buildTransport("elevatorStandard", X0, 1, 2).ok, "buildTransport(elevatorStandard) failed").toBe(true);
  return sim;
}

function placeHotel(sim: Simulation, x: number, kind: FacilityKind = "hotelSingle"): Unit {
  const r = sim.tower.place(kind, 2, x);
  expect(r.ok, `place(${kind}, 2, ${x}) failed: ${r.reason ?? "unknown"}`).toBe(true);
  return sim.tower.units.find((u) => u.id === r.unitId)!;
}

const infestedCount = (sim: Simulation): number =>
  sim.tower.units.filter((u) => u.state === "infested").length;

describe("Cockroach infestation lifecycle", () => {
  it("a hotel room left dirty escalates to infested after INFEST_DAYS", () => {
    const sim = hotelTower(1);
    const room = placeHotel(sim, X0);
    room.state = "dirty";
    // Each daily checkout ages the dirty clock; with no housekeeping the room is
    // never cleaned. It survives the first INFEST_DAYS-1 checkouts, then turns.
    for (let d = 0; d < INFEST_DAYS - 1; d++) {
      sim.economy.hotelCheckout();
      expect(room.state).toBe("dirty");
    }
    sim.economy.hotelCheckout();
    expect(room.state).toBe("infested");
  });

  it("dirty and infested rooms are never booked (only clean empty rooms re-let)", () => {
    const sim = hotelTower(2);
    const dirtyRoom = placeHotel(sim, X0);
    const infRoom = placeHotel(sim, X0 + 20); // far apart: no spread between them
    dirtyRoom.state = "dirty";
    infRoom.state = "infested";
    // Two days of evening move-in attempts: a booking would flip a room to `asleep`.
    for (let i = 0; i < 24 * 2; i++) sim.tick(60);
    expect(dirtyRoom.state).not.toBe("asleep");
    expect(infRoom.state).not.toBe("asleep");
  });

  it("housekeeping can no longer clean an infested room", () => {
    const sim = hotelTower(3);
    const room = placeHotel(sim, X0);
    sim.tower.place("housekeeping", 2, X0 + 10); // same floor: trivially in reach
    room.state = "infested";
    for (let i = 0; i < 24; i++) sim.tick(60); // a full day of dispatch
    expect(room.state).toBe("infested");
  });

  it("an infested room spreads cockroaches to an adjacent clean room", () => {
    const sim = hotelTower(4);
    const a = placeHotel(sim, X0);
    const b = placeHotel(sim, X0 + a.width); // directly adjacent along the run
    a.state = "infested";
    b.state = "empty";
    sim.economy.hotelCheckout(); // beforeCheckout spreads from the infested room
    expect(b.state).toBe("dirty");
  });

  it("an infested room on an unserved floor stays infested (never self-clears for free)", () => {
    const sim = hotelTower(14);
    // A floor no elevator reaches: an unserved floor, where a non-dormant room's
    // satisfaction erodes to 0 and the hotel would self-vacate to a clean empty.
    for (let i = 0; i < 10; i++) {
      expect(sim.tower.place("floor", 3, X0 + i).ok, `place(floor, 3, ${X0 + i}) failed`).toBe(true);
    }
    const r = sim.tower.place("hotelSingle", 3, X0);
    expect(r.ok, `place(hotelSingle, 3, ${X0}) failed: ${r.reason ?? "unknown"}`).toBe(true);
    const room = sim.tower.units.find((u) => u.id === r.unitId)!;
    room.state = "infested";
    room.satisfaction = 0; // already at the floor the erosion would drive it to
    for (let i = 0; i < 24; i++) sim.tick(60);
    expect(room.state).toBe("infested"); // dormant: skipped by the vacate path
  });

  it("an infested room can be bulldozed (the Classic fix)", () => {
    const sim = hotelTower(15);
    const room = placeHotel(sim, X0);
    room.state = "infested";
    expect(sim.sellAt(room.floor, room.x)).toBe(true);
    expect(sim.tower.units.some((u) => u.id === room.id)).toBe(false);
  });
});

describe("Infested-room recovery: Classic vs Modern", () => {
  it("Classic has no exterminator: infested rooms are bulldoze-only", () => {
    const sim = hotelTower(5, "classic");
    expect(sim.rules.infestationRecovery()).toBeNull();
    const room = placeHotel(sim, X0);
    room.state = "infested";
    const res = sim.callExterminator();
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("unavailable");
    expect(room.state).toBe("infested"); // untouched
  });

  it("Modern exterminator charges up front and clears infested rooms the next day", () => {
    const sim = hotelTower(6, "modern");
    const a = placeHotel(sim, X0);
    const b = placeHotel(sim, X0 + 20); // far apart: no spread to muddy the count
    a.state = "infested";
    b.state = "infested";
    const before = sim.money;
    const res = sim.callExterminator();
    expect(res.ok).toBe(true);
    expect(res.rooms).toBe(2);
    expect(res.cost).toBe(5000 + 2000 * 2);
    expect(sim.money).toBe(before - (5000 + 2000 * 2));
    expect(sim.exterminationDueDay).toBeDefined();
    // Still infested until the crew arrives tomorrow (waiting still hurts).
    expect(a.state).toBe("infested");
    expect(b.state).toBe("infested");
    // Advance past the next morning's checkout: the treatment lands.
    for (let i = 0; i < 30; i++) sim.tick(60);
    expect(infestedCount(sim)).toBe(0);
    expect(a.state).toBe("empty");
    expect(b.state).toBe("empty");
  });

  it("clears only the rooms it was billed for, not an overnight-escalated wing", () => {
    const sim = hotelTower(13, "modern");
    const a = placeHotel(sim, X0);
    a.state = "infested";
    // A far-apart room one day short of infesting: it crosses the threshold
    // overnight, AFTER the exterminator was booked for just the one room.
    const b = placeHotel(sim, X0 + 20);
    b.state = "dirty";
    b.dirtyDays = INFEST_DAYS - 1;
    const res = sim.callExterminator();
    expect(res.rooms).toBe(1); // billed for the single infested room only
    for (let i = 0; i < 30; i++) sim.tick(60);
    expect(a.state).toBe("empty"); // the billed room was treated
    expect(b.state).toBe("infested"); // escalated after booking, not swept for free
  });

  it("the exterminator refuses with no infested rooms, too little money, or one already en route", () => {
    const sim = hotelTower(7, "modern");
    expect(sim.callExterminator().reason).toBe("none");
    const room = placeHotel(sim, X0);
    room.state = "infested";
    sim.money = 100; // can't afford the call-out
    const poor = sim.callExterminator();
    expect(poor.ok).toBe(false);
    expect(poor.reason).toBe("funds");
    expect(poor.cost).toBe(5000 + 2000); // still reported so the UI can say how much
    sim.money = 1_000_000;
    expect(sim.callExterminator().ok).toBe(true);
    expect(sim.callExterminator().reason).toBe("pending"); // a dispatch is already booked
  });
});

describe("Cockroach persistence and legibility", () => {
  it("the dirty-day clock and a booked exterminator survive a save/load", () => {
    const sim = hotelTower(8, "modern");
    const room = placeHotel(sim, X0);
    room.state = "dirty";
    room.dirtyDays = 2;
    sim.exterminationDueDay = sim.clock.day + 1;
    const restored = Simulation.deserialize(sim.serialize());
    const rr = restored.tower.units.find((u) => u.id === room.id)!;
    expect(rr.state).toBe("dirty");
    expect(rr.dirtyDays).toBe(2);
    expect(restored.exterminationDueDay).toBe(sim.clock.day + 1);
  });

  it("a hand-edited far-future exterminator due day is clamped so the tower can't be stranded", () => {
    const sim = hotelTower(18, "modern");
    const raw = sim.serialize();
    // A real booking only ever schedules resolution for the next day; forge a
    // huge future value the way a save editor could, then confirm the load
    // clamps it to at most clock.day + 1 (never a permanent "en route" state).
    (raw as { exterminationDueDay?: number }).exterminationDueDay = sim.clock.day + 9999;
    const restored = Simulation.deserialize(raw);
    expect(restored.exterminationDueDay).toBe(restored.clock.day + 1);
  });

  it("housekeepingCoverage reports crews, daily capacity, and room states", () => {
    const sim = hotelTower(9);
    const dirtyRoom = placeHotel(sim, X0);
    placeHotel(sim, X0 + 20);
    sim.tower.place("housekeeping", 2, X0 + 10);
    dirtyRoom.state = "dirty";
    const cov = sim.housekeepingCoverage();
    expect(cov.rooms).toBe(2);
    expect(cov.crews).toBe(1);
    expect(cov.dailyCapacity).toBe(HK_ROOMS_PER_CREW);
    expect(cov.outOfReach).toBe(0); // crew shares the rooms' floor
    expect(cov.dirty).toBe(1);
    expect(cov.infested).toBe(0);
  });
});
