import { describe, expect, it } from "vitest";
import { Simulation } from "../engine/Simulation";
import { markRoom, rampUnits, roomCounts, roomUnits, structureRuns } from "../engine/tower/rooms";
import { MID, lay, mustBuild, placeUnit } from "../tests/fixtures/towerFixtures";
import { mergeSimulation, mergeSimulationDelta } from "./merge";
import { TsEngine } from "../engine/port/tsEngine";
import { ViewReader } from "../simport/viewReader";
import { facilityFloors } from "../engine/facilities";
import { walkedStats } from "../tests/fixtures/walkedStats";

/** A tower with a lobby row, two offices and a shaft, ticked a little. */
function tower(seed: number, mode: "classic" | "modern" = "classic"): Simulation {
  const sim = Simulation.newGame(seed, mode);
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

  it("marks a room whose occupancy alone a merge rewrites, so the view the app reads follows it", () => {
    // The mirror host merges the engine's tower over the one the app's
    // engine watches; a merge that changes only what the view frame reads
    // must still reach the reader, which reads changed rooms by their marks.
    const target = tower(5);
    const office = target.tower.units.find((u) => u.kind === "office")!;
    office.state = "occupied";
    office.occupants = 0;
    const reader = new ViewReader(new TsEngine(target), facilityFloors);
    expect(reader.tower.getUnit(office.id)!.occupants).toBe(0);
    const fresh = Simulation.deserialize(target.serialize());
    fresh.tower.getUnit(office.id)!.occupants = 6;
    mergeSimulation(target, Simulation.deserialize(fresh.serialize()), { revision: target.tower.revision, mealOverlayRevision: 0 });
    expect(office.occupants).toBe(6);
    reader.update();
    expect(reader.tower.getUnit(office.id)!.occupants).toBe(6);
  });

  it("marks the rooms whose counted fields a merge rewrites, one field at a time, and keeps the HUD's counts when the room list stays", () => {
    // A save carries No Rate in Classic only, and a household only for a
    // sold condo in Modern, so each mode changes the fields it keeps.
    for (const mode of ["classic", "modern"] as const) {
      const target = tower(5, mode);
      expect(target.build("condo", 3, 175).ok).toBe(true);
      expect(target.build("fastFood", 4, 175).ok).toBe(true);
      const units = target.tower.units;
      const [office, other] = units.filter((u) => u.kind === "office");
      const condo = units.find((u) => u.kind === "condo")!;
      const venue = units.find((u) => u.kind === "fastFood")!;
      office.state = "empty";
      other.state = "empty";
      condo.state = "occupied";
      if (mode === "modern") {
        condo.everOccupied = true;
        condo.residents = 2;
      }
      venue.state = "occupied";
      venue.customersIn = 4;
      const counts = roomCounts(target.tower); // the HUD's counts are kept from this read on
      const rooms = roomUnits(target.tower);
      const unit = (sim: Simulation, id: number) => sim.tower.getUnit(id)!;
      // Each merge changes one counted field of one room. The first changes
      // nothing on purpose: the save does not carry a venue's customers, so
      // the merge takes them away.
      type Change = [string, (sim: Simulation) => void];
      const byMode: Change[] =
        mode === "classic"
          ? [
              ["noRate", (sim) => { unit(sim, other.id).noRate = true; }],
              ["everOccupied", (sim) => { unit(sim, condo.id).everOccupied = true; }],
            ]
          : [["residents", (sim) => { unit(sim, condo.id).residents = 3; }]];
      const changes: Change[] = [
        ["customersIn", () => {}],
        ["state", (sim) => { unit(sim, office.id).state = "occupied"; }],
        ...byMode,
      ];
      for (const [field, change] of changes) {
        const label = `${mode} ${field}`;
        const before = { ...target.stats() };
        const fresh = Simulation.deserialize(target.serialize());
        change(fresh);
        const save = fresh.serialize();
        mergeSimulation(target, Simulation.deserialize(save), { revision: target.tower.revision, mealOverlayRevision: 0 });
        expect(roomUnits(target.tower), label).toBe(rooms);
        expect(roomCounts(target.tower), `${label}: the same ledger, marked and not dropped`).toBe(counts);
        const hud = target.stats();
        expect(hud, label).toEqual(Simulation.deserialize(save).stats());
        expect(hud.population, label).toBe(target.population);
        expect(hud, `${label} moved a count`).not.toEqual(before);
      }
      // A later mark still lands in the kept ledger.
      venue.customersIn = 2;
      markRoom(target.tower, venue);
      expect(target.stats().population).toBe(target.population);
    }
  });

  it("marks the rooms an hourly delta rewrites, and keeps the HUD's counts", () => {
    const target = tower(5);
    for (const u of target.tower.units) if (u.kind === "office") u.state = "empty";
    const counts = roomCounts(target.tower); // the HUD's counts are kept from this read on
    const before = { ...target.stats() };
    const fresh = Simulation.deserialize(target.serialize());
    const [a, b] = fresh.tower.units.filter((u) => u.kind === "office");
    a.state = "occupied";
    b.noRate = true;
    const save = fresh.serialize();
    // The worker's delta: the changed unit records and every transport.
    const next = Simulation.deserialize(save);
    const units = [a.id, b.id].map((id) => next.tower.getUnit(id)!);
    mergeSimulationDelta(target, { rest: next, units, transports: next.tower.transports }, { revision: target.tower.revision, mealOverlayRevision: 0 });
    expect(roomCounts(target.tower), "the same ledger, marked and not dropped").toBe(counts);
    const hud = target.stats();
    expect(hud).toEqual(Simulation.deserialize(save).stats());
    expect(hud).toMatchObject({ occupiedOffices: before.occupiedOffices + 1, vacant: before.vacant - 1, vacantNoRate: before.vacantNoRate + 1 });
  });

  it("drops the room list when an hourly delta's record changes a unit's kind", () => {
    const target = tower(6);
    const rooms = roomUnits(target.tower);
    const before = { ...target.stats() };
    const next = Simulation.deserialize(target.serialize());
    // No engine sends this (a delta goes out only when the revision held),
    // but a record whose kind moved must not leave the room counted as it was.
    const office = next.tower.units.find((u) => u.kind === "office")!;
    office.kind = "condo";
    mergeSimulationDelta(target, { rest: next, units: [office], transports: next.tower.transports }, { revision: target.tower.revision, mealOverlayRevision: 0 });
    expect(roomUnits(target.tower)).not.toBe(rooms);
    expect(target.stats()).toMatchObject({ ...walkedStats(target), offices: before.offices - 1, condos: before.condos + 1 });
  });

  it("keeps the ramp index and the stop lists the congestion map reads in step with the engine", () => {
    // The render reads both every frame from the instance the host merges into.
    const target = parkingTower();
    const fresh = parkingTower();
    const shaft = target.tower.transports[0];
    const [oldRamp] = rampUnits(target.tower);
    expect(target.tower.stopsOf(shaft)).toEqual([0, 1, 2, 3, 4]);
    expect(target.tower.functionalParkingSet().size).toBe(1);
    // The engine rebuilds the ramp in place (a new id, the same unit count),
    // adds a second one, and drops a stop.
    fresh.tower.removeUnit(oldRamp.id);
    const rebuilt = placeUnit(fresh, "parkingRamp", 0, MID);
    const added = placeUnit(fresh, "parkingRamp", 0, MID - 40);
    expect(fresh.tower.setStop(shaft.id, 3, false)).toBe(true);
    const marks = { revision: fresh.tower.revision, mealOverlayRevision: fresh.tower.mealOverlayRevision };
    mergeSimulation(target, Simulation.deserialize(fresh.serialize()), marks);
    expect(rampUnits(target.tower).map((u) => u.id)).toEqual([rebuilt.id, added.id]);
    expect([...target.tower.functionalParkingSet()]).toEqual([...fresh.tower.functionalParkingSet()]);
    expect(target.tower.stopsOf(target.tower.transports[0])).toEqual([0, 1, 2, 4]);

    // And a bulldoze: the next merge drops the second ramp and restores the stop.
    const next = Simulation.deserialize(fresh.serialize());
    next.tower.removeUnit(added.id);
    expect(next.tower.setStop(shaft.id, 3, true)).toBe(true);
    mergeSimulation(target, Simulation.deserialize(next.serialize()), {
      revision: next.tower.revision,
      mealOverlayRevision: next.tower.mealOverlayRevision,
    });
    expect(rampUnits(target.tower).map((u) => u.id)).toEqual([rebuilt.id]);
    expect(target.tower.stopsOf(target.tower.transports[0])).toEqual([0, 1, 2, 3, 4]);
  });

  it("rebuilds the ramp index with the rooms list when the engine's revision repeats a kept one", () => {
    // The engine counts its revision from its own load, so it can hand back
    // one the lists were kept at while its units changed (#1253).
    const target = parkingTower();
    const fresh = parkingTower();
    const held = target.tower.revision;
    const [oldRamp] = rampUnits(target.tower);
    const rooms = roomUnits(target.tower);
    fresh.tower.removeUnit(oldRamp.id);
    const rebuilt = placeUnit(fresh, "parkingRamp", 0, MID);
    expect(fresh.tower.units.length).toBe(target.tower.units.length);
    mergeSimulation(target, Simulation.deserialize(fresh.serialize()), {
      revision: held,
      mealOverlayRevision: fresh.tower.mealOverlayRevision,
    });
    expect(target.tower.revision).toBe(held);
    expect(roomUnits(target.tower)).not.toBe(rooms);
    expect(rampUnits(target.tower).map((u) => u.id)).toEqual([rebuilt.id]);
    expect([...target.tower.functionalParkingSet()]).toEqual([...fresh.tower.functionalParkingSet()]);
  });
});

/** A tower with a parking ramp and a space beside it in the basement, and a
 *  shaft from the basement to floor 4. */
function parkingTower(): Simulation {
  const sim = Simulation.newGame(13);
  sim.money = 1e12;
  sim.star = 3; // parking unlocks at 3 stars
  lay(sim, "lobby", 1);
  for (const f of [0, 2, 3, 4]) lay(sim, "floor", f);
  placeUnit(sim, "parkingRamp", 0, MID);
  placeUnit(sim, "parking", 0, MID + 16);
  mustBuild(sim, "elevatorStandard", MID + 60, 0, 4);
  return sim;
}
