import { describe, expect, it } from "vitest";
import { Simulation } from "../engine/Simulation";
import { roomUnits, structureRuns } from "../engine/tower/rooms";
import { mergeSimulation } from "./merge";

/** A tower with a lobby row, two offices and a shaft, ticked a little. */
function tower(seed: number): Simulation {
  const sim = Simulation.newGame(seed, "classic");
  sim.money = 1e9;
  for (let x = 170; x < 200; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
  expect(sim.build("office", 2, 175).ok).toBe(true);
  expect(sim.build("office", 2, 186).ok).toBe(true);
  expect(sim.buildTransport("stairs", 170, 1, 2).ok).toBe(true);
  return sim;
}

const withoutLog = (save: ReturnType<Simulation["serialize"]>) => {
  const { log: _log, ...rest } = save as typeof save & { log?: unknown };
  return rest;
};

describe("mergeSimulation", () => {
  it("makes the target serialize as the fresh instance while every held object keeps its identity", () => {
    const target = tower(5);
    const fresh = tower(5);
    fresh.tick(180);
    expect(fresh.build("office", 3, 175).ok).toBe(true);
    fresh.tower.towerName = "Merged";
    fresh.money = 123456;
    const heldTower = target.tower;
    const heldUnit = target.tower.units[0];
    const heldTransport = target.tower.transports[0];
    const heldUnits = target.tower.units;
    const heldById = target.tower.byId;
    const heldClock = target.clock;
    const founder = target.founder;

    const targetLog = [...target.log];
    const targetLogSeq = target.logSeq;
    mergeSimulation(target, Simulation.deserialize(fresh.serialize()), { revision: 99, mealOverlayRevision: 3 });

    // Everything the save carries follows the fresh instance, except the log
    // and its cursor, which the frame sync appends on its own.
    expect(withoutLog(target.serialize())).toEqual(withoutLog(fresh.serialize()));
    expect(target.log).toEqual(targetLog);
    expect(target.logSeq).toBe(targetLogSeq);
    expect(target.tower).toBe(heldTower);
    expect(target.tower.units).toBe(heldUnits);
    expect(target.tower.byId).toBe(heldById);
    expect(target.clock).toBe(heldClock);
    expect(target.tower.units[0]).toBe(heldUnit);
    expect(target.tower.transports[0]).toBe(heldTransport);
    expect(target.tower.byId.get(heldUnit.id)).toBe(heldUnit);
    expect(target.tower.units.length).toBe(fresh.tower.units.length);
    expect(target.tower.revision).toBe(99);
    expect(target.tower.mealOverlayRevision).toBe(3);
    expect(target.founder).toBe(founder);
    expect(target.clock.minutes).toBe(fresh.clock.minutes);
    expect(target.tower.towerName).toBe("Merged");
  });

  it("drops a unit the fresh instance no longer has and keeps the crowd", () => {
    const target = tower(9);
    const fresh = tower(9);
    const gone = fresh.tower.units.find((u) => u.kind === "office")!;
    fresh.tower.removeUnit(gone.id);
    target.crowd.people.push({ id: 1, seed: 1, state: "toDest", floor: 1, fy: 0, x: 170, floors: [], originFloor: 1, shafts: [], leg: 0, shaftId: null, carIndex: null, destX: 170, wait: 0, tripWait: 0, age: 0, linger: 0 });
    mergeSimulation(target, Simulation.deserialize(fresh.serialize()), { revision: 1, mealOverlayRevision: 0 });
    expect(target.tower.byId.has(gone.id)).toBe(false);
    expect(target.tower.units.some((u) => u.id === gone.id)).toBe(false);
    expect(target.crowd.people.length).toBe(1);
    expect(withoutLog(target.serialize())).toEqual(withoutLog(fresh.serialize()));
  });

  it("drops the per-revision room list and structure runs, even when the revision repeats over other units", () => {
    const target = tower(5);
    const fresh = tower(5);
    // Other units at the same count: a lobby tile moved, an office replaced.
    fresh.tower.removeUnit(fresh.tower.unitAt(1, 170)!.id);
    expect(fresh.build("lobby", 1, 200).ok).toBe(true);
    const office = fresh.tower.units.find((u) => u.kind === "office" && u.x === 186)!;
    fresh.tower.removeUnit(office.id);
    expect(fresh.build("office", 2, 186).ok).toBe(true);
    expect(fresh.tower.units.length).toBe(target.tower.units.length);
    const [rooms, runs] = [roomUnits(target.tower), structureRuns(target.tower)];
    // What the engine reports after a fresh load can repeat the held revision.
    mergeSimulation(target, Simulation.deserialize(fresh.serialize()), { revision: target.tower.revision, mealOverlayRevision: 0 });
    expect(roomUnits(target.tower).map((u) => u.id)).toEqual(roomUnits(fresh.tower).map((u) => u.id));
    expect(roomUnits(target.tower).map((u) => u.id)).not.toEqual(rooms.map((u) => u.id));
    expect(structureRuns(target.tower)).toEqual(structureRuns(fresh.tower));
    expect(structureRuns(target.tower)).not.toEqual(runs);
  });

  it("drops the room list when only a room's id changed under a repeated revision", () => {
    const target = tower(5);
    const fresh = tower(5);
    // The office at 186 is the last unit, so a new one built where it stood
    // takes its place in the array: same kind, floor, x and width, new id.
    const old = fresh.tower.units[fresh.tower.units.length - 1];
    expect([old.kind, old.floor, old.x]).toEqual(["office", 2, 186]);
    fresh.tower.removeUnit(old.id);
    expect(fresh.build("office", 2, 186).ok).toBe(true);
    const replaced = fresh.tower.units[fresh.tower.units.length - 1];
    expect(fresh.tower.units.length).toBe(target.tower.units.length);
    expect([replaced.kind, replaced.floor, replaced.x, replaced.width]).toEqual([old.kind, old.floor, old.x, old.width]);
    expect(replaced.id).not.toBe(old.id);
    const rooms = roomUnits(target.tower);
    mergeSimulation(target, Simulation.deserialize(fresh.serialize()), { revision: target.tower.revision, mealOverlayRevision: 0 });
    expect(roomUnits(target.tower)).not.toBe(rooms);
    expect(roomUnits(target.tower).map((u) => u.id)).toEqual(roomUnits(fresh.tower).map((u) => u.id));
  });

  it("keeps the room list and structure runs over a merge that moved neither the revision nor the units", () => {
    const target = tower(5);
    const fresh = tower(5);
    fresh.tick(60);
    expect(fresh.tower.units.map((u) => u.id)).toEqual(target.tower.units.map((u) => u.id));
    const [rooms, runs] = [roomUnits(target.tower), structureRuns(target.tower)];
    // An hourly merge: the engine's hour pass ran and nothing was built.
    mergeSimulation(target, Simulation.deserialize(fresh.serialize()), { revision: target.tower.revision, mealOverlayRevision: 0 });
    expect(roomUnits(target.tower)).toBe(rooms);
    expect(structureRuns(target.tower)).toBe(runs);
    // A moved revision drops both, even over the same units.
    mergeSimulation(target, Simulation.deserialize(fresh.serialize()), { revision: target.tower.revision + 1, mealOverlayRevision: 0 });
    expect(roomUnits(target.tower)).not.toBe(rooms);
    expect(structureRuns(target.tower)).not.toBe(runs);
    expect(roomUnits(target.tower)).toEqual(rooms);
  });

  it("gives the HUD the merged rooms at the same unit count and the revision the rooms list was read at", () => {
    const target = tower(11);
    const fresh = tower(11);
    expect(target.stats().offices).toBe(2);
    const rooms = roomUnits(target.tower);
    expect(roomUnits(target.tower)).toBe(rooms); // memoized, so only a drop refreshes it
    const [revision, count] = [target.tower.revision, target.tower.units.length];
    // An office becomes a hotel room, so the unit count holds, and the merge
    // brings back the revision the list was read at: neither key moves.
    const office = fresh.tower.units.find((u) => u.kind === "office")!;
    expect(fresh.tower.removeUnit(office.id)).toBeDefined();
    expect(fresh.tower.place("hotelDouble", office.floor, office.x).ok).toBe(true);
    expect(fresh.tower.units.length).toBe(target.tower.units.length);
    for (const u of fresh.tower.units) {
      if (u.kind === "office") u.state = "occupied";
      if (u.kind === "hotelDouble") u.state = "asleep";
    }
    const save = fresh.serialize();
    mergeSimulation(target, Simulation.deserialize(save), { revision, mealOverlayRevision: 0 });
    expect([target.tower.revision, target.tower.units.length]).toEqual([revision, count]);
    const hud = target.stats();
    expect(hud).toEqual(Simulation.deserialize(save).stats());
    expect(hud).toMatchObject({ offices: 1, occupiedOffices: 1, hotelRooms: 1, occupiedHotel: 1 });
    expect(hud.population).toBeGreaterThan(0);
    expect(hud.population).toBe(target.population);
  });

  it("gives the HUD the rooms' merged states over a merge that kept the room list", () => {
    const target = tower(5);
    const fresh = tower(5);
    const before = target.stats(); // the HUD's counts are kept from this read on
    for (const u of fresh.tower.units) if (u.kind === "office") u.state = "occupied";
    const rooms = roomUnits(target.tower);
    // An hourly merge that moved neither the revision nor the units: the room
    // list stays, and only the rooms' fields change, none of them marked.
    mergeSimulation(target, Simulation.deserialize(fresh.serialize()), { revision: target.tower.revision, mealOverlayRevision: 0 });
    expect(roomUnits(target.tower)).toBe(rooms);
    const hud = target.stats();
    expect(hud).toEqual(Simulation.deserialize(fresh.serialize()).stats());
    expect(hud.occupiedOffices).toBe(before.occupiedOffices + 2);
  });
});
