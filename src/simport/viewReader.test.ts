import { describe, expect, it, vi } from "vitest";
import type { FacilityKind } from "../shared/types";
import { ViewReader } from "./viewReader";
import { code, frame, mockPort, structure, type RoomSpec, type RunSpec, type ShaftSpec } from "../tests/portKit/mockPort";

/**
 * The shared reader over a mock port: which reads it asks for on each update
 * (a delta frame, a full one after a skip, the structure on a rebuild, the
 * labels of new rooms and of the meta log's edits), and what it decodes from
 * frames and structures encoded from the engine's layout. The reader on the
 * Rust engine runs in `portReader.integration.test.ts`.
 */

const ROOMS: RoomSpec[] = [
  { id: 10, kind: "office", floor: 2, x: 170, width: 9 },
  { id: 11, kind: "fastFood", floor: 2, x: 190, width: 16 },
  { id: 12, kind: "cinema", floor: 2, x: 220, width: 31 },
];

// The lobby whole; floor 2 between the rooms; floor 3 in two runs that split
// only on their tiles' state; floor 4 in two runs with a gap between.
const RUNS: RunSpec[] = [
  { kind: "lobby", floor: 1, x: 160, count: 120 },
  { kind: "floor", floor: 2, x: 160, count: 10 },
  { kind: "floor", floor: 2, x: 179, count: 11 },
  { kind: "floor", floor: 3, x: 160, count: 30 },
  { kind: "floor", floor: 3, x: 190, count: 30, state: "occupied", occupants: 2 },
  { kind: "floor", floor: 4, x: 160, count: 10 },
  { kind: "floor", floor: 4, x: 180, count: 10 },
];

const SHAFTS: ShaftSpec[] = [
  { id: 20, kind: "elevatorStandard", x: 162, bottom: 1, top: 4, cars: 1 },
  { id: 21, kind: "elevatorExpress", x: 300, bottom: 1, top: 4, cars: 2, skips: [2, 3] },
];

/** A cinema is two stories tall, everything else one. */
const floorsOf = (kind: FacilityKind) => (kind === "cinema" ? 2 : 1);

/** The unlocked-kinds mask: bit k set for the kind with code k. */
const unlockedMask = (kinds: string[]) => kinds.reduce((sum, k) => sum + 2 ** code("kinds", k), 0);

/** A tower the mock engine answers for; tests move its fields between updates. */
function world() {
  const w = {
    gen: 1,
    seq: 0,
    revision: 5,
    meta: 2,
    rooms: [...ROOMS],
    camera: '{"tile":200,"floor":2,"zoom":1.5}' as string | undefined,
    labels: new Map<number, string>([[10, "Corner"]]),
    subtypes: new Map<number, string>([[12, "art house"]]),
    metaLog: Float64Array.of(2, 0),
    people: [{ id: 7, seed: 9, staff: 1, state: code("personStates", "riding"), floor: 2, x: 165, fy: 2.5, wait: 12 }],
  };
  const port = mockPort({
    generation: () => w.gen,
    view: () => w.camera,
    towerName: () => "Spire",
    unitLabel: (id) => w.labels.get(id),
    unitSubtype: (id) => w.subtypes.get(id),
    unitMetaChanged: () => w.metaLog,
    viewStructure: () => structure({ header: { revision: w.revision, highestFloor: 4, lowestFloor: 1, sceneSeed: 77 }, rooms: w.rooms, runs: RUNS, shafts: SHAFTS }),
    viewFrame: (full) =>
      frame({
        header: {
          frameSeq: ++w.seq,
          full: full ? 1 : 0,
          rooms: w.rooms.length,
          towerRevision: w.revision,
          metaRevision: w.meta,
          money: 1_250_000,
          star: 3,
          weather: code("weather", "cloudy"),
          minutes: 1440 * 5 + 600,
          day: 5,
          dayOfWeek: 2,
          isWeekend: 1,
          unlocked: unlockedMask(["lobby", "floor", "office", "cinema"]),
        },
        people: w.people,
        units: [{ slot: 0, state: code("unitStates", "occupied"), occupants: 6, customersIn: -1, hotelCustomersIn: -1, outForMeal: 2 }],
        transports: [
          { id: 20, cars: [{ position: 2.5, load: 4, direction: 1 }] },
          { id: 21, cars: [{ position: 1, load: 0, direction: 0 }, { position: 4, load: 9, direction: -1 }] },
        ],
      }),
  });
  return { w, port, reader: new ViewReader(port, floorsOf) };
}

describe("ViewReader", () => {
  it("reads the layout, the camera, a full frame and the structure on its first update", () => {
    const { port } = world();
    expect(port.viewLayout).toHaveBeenCalledOnce();
    expect(port.view).toHaveBeenCalledOnce();
    expect(vi.mocked(port.viewFrame).mock.calls).toEqual([[true]]);
    expect(port.viewStructure).toHaveBeenCalledOnce();
    // Each new room's text is read once; the meta log is not, on a new tower.
    expect(vi.mocked(port.unitLabel).mock.calls).toEqual([[10], [11], [12]]);
    expect(vi.mocked(port.unitSubtype).mock.calls).toEqual([[10], [11], [12]]);
    expect(port.unitMetaChanged).not.toHaveBeenCalled();
  });

  it("decodes the rooms, the structure, the shafts and the header", () => {
    const { reader } = world();
    expect(reader.rooms.map((u) => [u.id, u.kind, u.floor, u.x, u.width, u.label, u.subtype])).toEqual([
      [10, "office", 2, 170, 9, "Corner", undefined],
      [11, "fastFood", 2, 190, 16, "Fast Food", undefined],
      [12, "cinema", 2, 220, 31, "Cinema", "art house"],
    ]);
    const office = reader.rooms[0];
    expect([office.state, office.occupants, office.customersIn, office.hotelCustomersIn, office.outForMeal]).toEqual(["occupied", 6, undefined, undefined, 2]);
    // Runs that split only on their tiles' fields are joined.
    expect(reader.structure.map((s) => [s.kind, s.floor, s.x, s.count])).toEqual([
      ["lobby", 1, 160, 120],
      ["floor", 2, 160, 10],
      ["floor", 2, 179, 11],
      ["floor", 3, 160, 60],
      ["floor", 4, 160, 10],
      ["floor", 4, 180, 10],
    ]);
    expect(reader.tower.transports.map((t) => [t.id, t.kind, t.bottom, t.top, t.skipFloors, t.cars, t.carPositions, t.carLoad, t.carDir])).toEqual([
      [20, "elevatorStandard", 1, 4, undefined, 1, [2.5], [4], [1]],
      [21, "elevatorExpress", 1, 4, [2, 3], 2, [1, 4], [0, 9], [0, -1]],
    ]);
    const h = reader.header;
    expect([h.money, h.star, h.weather, h.minuteOfDay, h.day, h.isWeekend, h.mode, h.modernCalendar, h.sceneSeed]).toEqual([1_250_000, 3, "cloudy", 600, 5, true, "modern", "canon", 77]);
    expect([h.camera, h.pendingChoice, h.bombSearch]).toEqual([{ tile: 200, floor: 2, zoom: 1.5 }, null, null]);
    expect(reader.crowd.people.map((p) => [p.id, p.seed, p.staff, p.state, p.floor, p.x, p.fy, p.wait])).toEqual([[7, 9, true, "riding", 2, 165, 2.5, 12]]);
    expect([reader.unlocked("office"), reader.unlocked("cinema"), reader.unlocked("hotelSuite")]).toEqual([true, true, false]);
    expect([reader.tower.highestFloor, reader.tower.lowestFloor, reader.tower.revision, reader.generation]).toEqual([4, 1, 5, 1]);
  });

  it("reads a delta frame in sequence, keeping the structure and each person", () => {
    const { port, reader } = world();
    const rooms = reader.rooms;
    const person = reader.crowd.people[0];
    reader.update();
    expect(vi.mocked(port.viewFrame).mock.calls).toEqual([[true], [false]]);
    expect(port.viewStructure).toHaveBeenCalledOnce();
    expect(port.view).toHaveBeenCalledOnce();
    expect(reader.rooms).toBe(rooms);
    expect(reader.crowd.people[0]).toBe(person);
  });

  it("takes a full frame after another caller took one", () => {
    const { w, port, reader } = world();
    w.seq++;
    reader.update();
    expect(vi.mocked(port.viewFrame).mock.calls).toEqual([[true], [false], [true]]);
  });

  it("rebuilds on a new revision, keeping each room by id and reading only the new one's text", () => {
    const { w, port, reader } = world();
    const [office] = reader.rooms;
    w.revision = 6;
    w.rooms = [...ROOMS, { id: 13, kind: "office", floor: 3, x: 220, width: 9 }];
    reader.update();
    expect(port.viewStructure).toHaveBeenCalledTimes(2);
    expect(reader.rooms.map((u) => u.id)).toEqual([10, 11, 12, 13]);
    expect(reader.tower.getUnit(10)).toBe(office);
    expect(vi.mocked(port.unitLabel).mock.calls.slice(3)).toEqual([[13]]);
  });

  it("reads the meta log's edits from the revision it last saw", () => {
    const { w, port, reader } = world();
    const [office, fastFood] = reader.rooms;
    w.meta = 3;
    w.metaLog = Float64Array.of(3, 0, 11, 999);
    w.labels.set(11, "Burger Bar");
    reader.update();
    expect(vi.mocked(port.unitMetaChanged).mock.calls).toEqual([[2]]);
    // Unit 999 names no room, so its text is not read.
    expect(vi.mocked(port.unitLabel).mock.calls.slice(3)).toEqual([[11]]);
    expect([office.label, fastFood.label]).toEqual(["Corner", "Burger Bar"]);
    // A full listing puts back the names of the rooms it leaves out.
    w.meta = 4;
    w.metaLog = Float64Array.of(4, 1, 11);
    reader.update();
    expect(vi.mocked(port.unitMetaChanged).mock.calls).toEqual([[2], [3]]);
    expect([office.label, fastFood.label, reader.rooms[2].subtype]).toEqual(["Office", "Burger Bar", undefined]);
  });

  it("starts again on a new generation, with the new tower's camera and people", () => {
    const { w, port, reader } = world();
    const rooms = reader.rooms;
    const person = reader.crowd.people[0];
    w.gen = 2;
    w.camera = undefined;
    reader.update();
    expect(port.view).toHaveBeenCalledTimes(2);
    expect(vi.mocked(port.viewFrame).mock.calls).toEqual([[true], [true]]);
    expect(port.viewStructure).toHaveBeenCalledTimes(2);
    expect(reader.rooms).not.toBe(rooms);
    expect(reader.rooms[0]).not.toBe(rooms[0]);
    expect(reader.crowd.people[0]).not.toBe(person);
    expect([reader.header.camera, reader.generation]).toEqual([null, 2]);
  });

  it("answers the point lookups on every story a room covers, and the tiles between", () => {
    const { port, reader } = world();
    const cinema = reader.rooms[2];
    expect([reader.tower.unitAt(2, 230), reader.tower.unitAt(3, 230), reader.tower.unitAt(4, 230)]).toEqual([cinema, cinema, undefined]);
    const tile = reader.tower.unitAt(3, 200)!;
    expect([tile.kind, tile.x, Number.isNaN(tile.id), tile.state, tile.occupants, tile.label]).toEqual(["floor", 200, true, "occupied", 2, "Floor"]);
    expect([reader.tower.unitAt(2, 400), reader.tower.unitAt(9, 200)]).toEqual([undefined, undefined]);
    expect([reader.tower.hasStructure(1, 200), reader.tower.structureKindAt(1, 200), reader.tower.hasStructure(5, 200)]).toEqual([true, "lobby", false]);
    expect(reader.tower.getTransport(21)).toBe(reader.tower.transports[1]);
    // The rooms, then every tile, built once.
    expect(reader.tower.units.length).toBe(3 + 120 + 10 + 11 + 60 + 20);
    expect(reader.tower.units).toBe(reader.tower.units);
    expect(port.towerName).not.toHaveBeenCalled();
    expect(reader.tower.towerName).toBe("Spire");
    expect(port.towerName).toHaveBeenCalledOnce();
  });

  it("finds the nearest structure tile on each side, where a bridge scan stops", () => {
    const { reader } = world();
    expect([reader.structureBeside(4, 175, -1), reader.structureBeside(4, 175, 1)]).toEqual([{ x: 169, kind: "floor" }, { x: 180, kind: "floor" }]);
    expect([reader.structureBeside(1, 100, 1), reader.structureBeside(1, 100, -1)]).toEqual([{ x: 160, kind: "lobby" }, undefined]);
    expect([reader.structureBeside(1, 200, -1), reader.structureBeside(1, 200, 1)]).toEqual([{ x: 199, kind: "lobby" }, { x: 201, kind: "lobby" }]);
    expect([reader.structureBeside(3, 300, -1), reader.structureBeside(3, 300, 1)]).toEqual([{ x: 219, kind: "floor" }, undefined]);
    expect([reader.structureBeside(2, 160, -1), reader.structureBeside(9, 200, 1)]).toEqual([undefined, undefined]);
  });
});
