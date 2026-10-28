import { describe, expect, it } from "vitest";
import { Simulation } from "../engine/Simulation";
import { KIND_CODES, codeOf } from "../engine/port/layout";
import { TsEngine } from "../engine/port/tsEngine";
import { roomUnits } from "../engine/tower/rooms";
import { ViewReader } from "./viewReader";

/**
 * The shared reader over `TsEngine` alone, in the `unit` project, so the
 * reader is covered where no WASM package is built. The integration test
 * (`viewReader.integration.test.ts`) holds it to the Rust engine too.
 */

const code = (kind: string): number => codeOf(KIND_CODES, kind);

function engine(): TsEngine {
  const sim = Simulation.newGame(5, "modern");
  sim.money = 1e8;
  sim.star = 3;
  for (let x = 160; x < 280; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
  for (const floor of [2, 3]) for (let x = 160; x < 280; x++) expect(sim.build("floor", floor, x).ok).toBe(true);
  expect(sim.build("office", 2, 170).ok).toBe(true);
  expect(sim.build("fastFood", 2, 190).ok).toBe(true);
  expect(sim.build("hotelSingle", 3, 170).ok).toBe(true);
  expect(sim.buildTransport("elevatorStandard", 162, 1, 3).ok).toBe(true);
  return new TsEngine(sim);
}

const plain = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

describe("ViewReader over TsEngine", () => {
  it("decodes the rooms, the structure and the header the simulation holds", () => {
    const e = engine();
    const r = new ViewReader(e);
    const rooms = roomUnits(e.sim.tower);
    expect(r.rooms.map((u) => [u.id, u.kind, u.floor, u.x, u.width, u.label])).toEqual(rooms.map((u) => [u.id, u.kind, u.floor, u.x, u.width, u.label]));
    expect(r.structure.map((s) => [s.kind, s.floor, s.x, s.count])).toEqual([
      ["lobby", 1, 160, 120],
      ["floor", 2, 160, 120],
      ["floor", 3, 160, 120],
    ]);
    expect([r.header.money, r.header.star, r.header.mode, r.header.pendingChoice]).toEqual([e.sim.money, 3, "modern", null]);
    expect(r.tower.transports.map((t) => [t.kind, t.bottom, t.top, t.cars])).toEqual([["elevatorStandard", 1, 3, 1]]);
    for (let i = 0; i < 6; i++) {
      e.tick(60);
      r.update();
    }
    expect(r.header.minutes).toBe(e.sim.clock.minutes);
    expect(r.crowd.people.length).toBe(e.sim.crowd.people.length);
    expect(plain(r.rooms.map((u) => [u.state, u.occupants]))).toEqual(plain(roomUnits(e.sim.tower).map((u) => [u.state, u.occupants])));
  });

  it("answers the point lookups and the expanded units", () => {
    const e = engine();
    const r = new ViewReader(e);
    const office = r.rooms.find((u) => u.kind === "office")!;
    expect(r.tower.getUnit(office.id)).toBe(office);
    expect(r.tower.unitAt(2, office.x + 1)).toBe(office);
    const tile = r.tower.unitAt(2, 250)!;
    expect([tile.kind, tile.x, Number.isNaN(tile.id)]).toEqual(["floor", 250, true]);
    expect(r.tower.unitAt(2, 400)).toBeUndefined();
    expect(r.tower.unitAt(9, 200)).toBeUndefined();
    expect([r.tower.hasStructure(1, 200), r.tower.structureKindAt(1, 200), r.tower.hasStructure(5, 200)]).toEqual([true, "lobby", false]);
    expect(r.tower.getTransport(r.tower.transports[0].id)).toBe(r.tower.transports[0]);
    expect(r.tower.units.length).toBe(e.sim.tower.units.length);
    expect(r.tower.units).toBe(r.tower.units);
    expect([r.tower.highestFloor, r.tower.lowestFloor, r.tower.revision]).toEqual([e.sim.tower.highestFloor, e.sim.tower.lowestFloor, e.sim.tower.revision]);
  });

  it("keeps rooms across a rebuild and reads the meta log's edits", () => {
    const e = engine();
    const r = new ViewReader(e);
    const kept = r.rooms;
    const office = kept.find((u) => u.kind === "office")!;
    e.labelUnit(office.id, "Corner");
    r.update();
    expect(r.rooms).toBe(kept);
    expect(office.label).toBe("Corner");
    expect(e.buildAt(code("office"), 3, 220)[0]).toBe(1);
    r.update();
    expect(r.rooms).not.toBe(kept);
    expect(r.tower.getUnit(office.id)).toBe(office);
    expect(r.rooms.length).toBe(kept.length + 1);
    e.nameTower("Spire");
    expect(r.tower.towerName).toBe("Spire");
  });

  it("starts again on a swap, with the camera the save carries", () => {
    const e = engine();
    e.setCamera(200, 2, 1.5);
    const save = e.serialize();
    const r = new ViewReader(e);
    const person = () => r.crowd.people[0];
    e.tick(480);
    r.update();
    const before = r.rooms;
    const first = person();
    expect(e.loadSave(save)[0]).toBe(1);
    r.update();
    expect(r.rooms).not.toBe(before);
    expect(r.header.camera).toEqual({ tile: 200, floor: 2, zoom: 1.5 });
    e.tick(480);
    r.update();
    if (first) expect(person()).not.toBe(first);
  });

  it("takes a full frame after another caller took one", () => {
    const e = engine();
    const r = new ViewReader(e);
    for (let i = 0; i < 4; i++) {
      e.tick(45);
      e.viewFrame(false);
      r.update();
      expect(plain(r.rooms.map((u) => [u.state, u.occupants]))).toEqual(plain(roomUnits(e.sim.tower).map((u) => [u.state, u.occupants])));
    }
  });
});
