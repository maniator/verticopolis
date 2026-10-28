import { describe, it, expect } from "vitest";
import { Simulation } from "../Simulation";
import { rampUnits, roomUnits } from "./rooms";
import type { FacilityKind } from "../types";
import { isStructural } from "./towerTopology";
import { ensureStarterLobby, lay, layTile, placeUnit, MID } from "../../tests/fixtures/towerFixtures";
import { atEngineFrameCadence, refreshFromEngine } from "../../tests/parity/typescriptOnly";

function towerWithRooms(): Simulation {
  const sim = Simulation.newGame(7, "classic");
  sim.money = 1e9;
  ensureStarterLobby(sim);
  for (let x = MID - 20; x < MID + 20; x++) layTile(sim, "floor", 2, x);
  return sim;
}

describe("roomUnits", () => {
  it("is every non-structure unit, in tower.units order", () => {
    const sim = towerWithRooms();
    placeUnit(sim, "office", 2, MID);
    placeUnit(sim, "office", 2, MID + 10);
    const expected = sim.tower.units.filter((u) => !isStructural(u.kind));
    expect(roomUnits(sim.tower)).toEqual(expected);
    expect(roomUnits(sim.tower).some((u) => u.kind === "floor" || u.kind === "lobby")).toBe(false);
  });

  it("returns the cached list until the tower changes, then picks up a build and a bulldoze", () => {
    const sim = towerWithRooms();
    const a = placeUnit(sim, "office", 2, MID);
    const first = roomUnits(sim.tower);
    expect(roomUnits(sim.tower)).toBe(first);

    const b = placeUnit(sim, "office", 2, MID + 10);
    const afterBuild = roomUnits(sim.tower);
    expect(afterBuild).not.toBe(first);
    expect(afterBuild.map((u) => u.id)).toEqual([a.id, b.id]);

    sim.tower.removeUnit(a.id);
    expect(roomUnits(sim.tower).map((u) => u.id)).toEqual([b.id]);
  });

  it("rebuilds when the same tower's unit array is replaced", () => {
    const sim = towerWithRooms();
    placeUnit(sim, "office", 2, MID);
    const before = roomUnits(sim.tower);
    sim.tower.units = sim.tower.units.filter((u) => u.kind !== "office");
    expect(roomUnits(sim.tower)).not.toBe(before);
    expect(roomUnits(sim.tower)).toEqual([]);
  });

  it("hands out a frozen list, so no caller can corrupt the shared cache", () => {
    const sim = towerWithRooms();
    placeUnit(sim, "office", 2, MID);
    expect(Object.isFrozen(roomUnits(sim.tower))).toBe(true);
  });

  it("restores a legacy occupant count on a structure tile to 0 on load, and keeps a room's", () => {
    const sim = towerWithRooms();
    const office = placeUnit(sim, "office", 2, MID);
    const data = sim.serialize();
    for (const kind of ["floor", "lobby"]) {
      (data.units.find((u) => u.kind === kind) as { occupants: number }).occupants = 7;
    }
    (data.units.find((u) => u.id === office.id) as { occupants: number }).occupants = 4;
    const loaded = Simulation.deserialize(data);
    expect(loaded.tower.units.filter((u) => isStructural(u.kind)).every((u) => u.occupants === 0)).toBe(true);
    expect(loaded.tower.getUnit(office.id)!.occupants).toBe(4);
  });

  it("loads every structure tile `empty` at satisfaction 1, and keeps a room's saved state", () => {
    const sim = towerWithRooms();
    const office = placeUnit(sim, "office", 2, MID);
    const data = sim.serialize();
    for (const kind of ["floor", "lobby"]) {
      const tile = data.units.find((u) => u.kind === kind) as { state: string; satisfaction: number } | undefined;
      expect(tile).toBeDefined();
      tile!.state = "occupied";
      tile!.satisfaction = 0.3; // what the old hourly sweep left on a migrated tile
    }
    const room = data.units.find((u) => u.id === office.id) as { state: string; satisfaction: number };
    room.state = "occupied";
    room.satisfaction = 0.3;
    const loaded = Simulation.deserialize(data);
    for (const u of loaded.tower.units.filter((u) => isStructural(u.kind))) {
      expect(u.state).toBe("empty");
      expect(u.satisfaction).toBe(1);
    }
    expect(loaded.tower.getUnit(office.id)!.state).toBe("occupied");
    expect(loaded.tower.getUnit(office.id)!.satisfaction).toBe(0.3);
  });

  it("serves a freshly loaded tower its own list", () => {
    const sim = towerWithRooms();
    placeUnit(sim, "office", 2, MID);
    roomUnits(sim.tower);
    const loaded = Simulation.deserialize(sim.serialize());
    expect(roomUnits(loaded.tower).map((u) => u.kind)).toEqual(["office"]);
  });
});

describe("rampUnits", () => {
  function towerWithBasement(): Simulation {
    const sim = Simulation.newGame(13);
    sim.money = 1e12;
    sim.star = 3; // parking unlocks at 3 stars
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    lay(sim, "floor", 0);
    return sim;
  }

  it("lists the ramps in tower.units order, cached until the tower changes", () => {
    const sim = towerWithBasement();
    const a = placeUnit(sim, "parkingRamp", 0, MID);
    placeUnit(sim, "parking", 0, MID + 16);
    placeUnit(sim, "office", 2, MID);
    const b = placeUnit(sim, "parkingRamp", 0, MID - 40);
    const first = rampUnits(sim.tower);
    expect(first).toEqual(sim.tower.units.filter((u) => u.kind === "parkingRamp"));
    expect(first.map((u) => u.id)).toEqual([a.id, b.id]);
    expect(rampUnits(sim.tower)).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);

    sim.tower.removeUnit(a.id);
    expect(rampUnits(sim.tower).map((u) => u.id)).toEqual([b.id]);
    const c = placeUnit(sim, "parkingRamp", 0, MID + 40);
    expect(rampUnits(sim.tower).map((u) => u.id)).toEqual([b.id, c.id]);
  });

  it("rebuilds when the tower changes but its unit count does not", () => {
    const sim = towerWithBasement();
    const a = placeUnit(sim, "parkingRamp", 0, MID);
    const before = rampUnits(sim.tower);
    const length = sim.tower.units.length;
    // A bulldoze and a rebuild between two reads: same count, new revision.
    sim.tower.removeUnit(a.id);
    const b = placeUnit(sim, "parkingRamp", 0, MID);
    expect(sim.tower.units.length).toBe(length);
    expect(rampUnits(sim.tower)).not.toBe(before);
    expect(rampUnits(sim.tower).map((u) => u.id)).toEqual([b.id]);
  });

  it("keeps a ramp that is not working, and the parking set reads its state live", () => {
    const sim = towerWithBasement();
    const ramp = placeUnit(sim, "parkingRamp", 0, MID);
    placeUnit(sim, "parking", 0, MID + 16);
    expect(sim.tower.functionalParkingSet().size).toBe(1);
    const revision = sim.tower.revision;
    // A fire changes the state without bumping the revision.
    ramp.state = "fire";
    expect(sim.tower.revision).toBe(revision);
    expect(rampUnits(sim.tower)).toEqual([ramp]);
    expect(sim.tower.functionalParkingSet().size).toBe(0);
    ramp.state = "empty";
    expect(sim.tower.functionalParkingSet().size).toBe(1);
  });

  it("serves a freshly loaded tower its own ramps and the same parking set", () => {
    const sim = towerWithBasement();
    placeUnit(sim, "parkingRamp", 0, MID);
    placeUnit(sim, "parking", 0, MID + 16);
    placeUnit(sim, "parkingRamp", 0, MID - 40);
    const warm = rampUnits(sim.tower);
    const loaded = Simulation.deserialize(sim.serialize());
    expect(rampUnits(loaded.tower)).not.toBe(warm);
    expect(rampUnits(loaded.tower).map((u) => u.id)).toEqual(warm.map((u) => u.id));
    expect([...loaded.tower.functionalParkingSet()]).toEqual([...sim.tower.functionalParkingSet()]);
  });
});

describe("roomUnits on a real tower", () => {
  it("leaves the census unchanged: totalPopulation equals a full scan of every unit", async () => {
    atEngineFrameCadence("360 ticks on a 12,000-unit fixture, with a merge before each census check");
    const { inflateSync } = await import("fflate");
    const { default: text } = await import("../../../conformance/fixtures/sixseven_2.vctower?raw");
    const { censusCount } = await import("../facilities");
    const { isPresent } = await import("../types");
    const b64 = text.slice(text.indexOf("\n") + 1).trim();
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const raw = JSON.parse(new TextDecoder().decode(inflateSync(bytes)));
    const rawStructure = raw.units.filter((u: { kind: FacilityKind }) => isStructural(u.kind)).length;
    const sim = Simulation.deserialize(raw);
    // Its v5-to-v6 migration paves new floor tiles under party halls; they, like all structure, load `empty`.
    expect(sim.tower.units.filter((u) => isStructural(u.kind)).length).toBeGreaterThan(rawStructure);
    expect(sim.tower.units.filter((u) => isStructural(u.kind)).every((u) => u.state === "empty")).toBe(true);
    for (let i = 0; i < 6; i++) {
      for (let m = 0; m < 60; m++) sim.tick(2);
      refreshFromEngine(sim);
      let full = 0;
      for (const u of sim.tower.units) if (isPresent(u)) full += censusCount(u);
      expect(sim.tower.totalPopulation()).toBe(full);
    }
  });
});
