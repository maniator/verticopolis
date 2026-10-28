import { afterEach, describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import type { SerializedGame } from "../../engine/serializedGame";
import { isStructural } from "../../engine/tower/towerTopology";
import type { FacilityKind, Unit } from "../../engine/types";
import { towerStateSig } from "../../engine/UndoHistory";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";

/**
 * The renderer-facing view (facade slice 6a, #1213) through the real
 * binding, read the way a host with no TypeScript `Simulation` reads it:
 * every slot by the names `viewLayout()` hands over. Each read is checked
 * against a TypeScript instance loaded from the same save and moved the same
 * way, which keeps this test independent of the Rust code that writes the
 * view.
 */

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

type Slots = Record<string, number>;
interface Layout {
  version: number;
  header: Slots; headerWidth: number;
  person: Slots; personWidth: number;
  unit: Slots; unitWidth: number;
  transport: Slots; transportFixed: number;
  car: Slots; carWidth: number;
  structure: Slots; structureWidth: number;
  room: Slots; roomWidth: number;
  run: Slots; runWidth: number;
  shaft: Slots; shaftFixed: number;
  kinds: string[]; names: string[]; unitStates: string[]; personStates: string[]; weather: string[];
  modes: string[]; calendars: string[]; metaRecord: string[];
}
interface Meta { revision: number; full: boolean; units: (number | string | null)[][] }
type Engine = {
  viewStructure(): Float64Array;
  viewFrame(full: unknown): Float64Array;
  unitMetaSince(since: unknown): string;
  towerSignature(): bigint;
  tick(dt: number): void;
  setLabel(id: number, label: string): boolean;
  setMoney(amount: number): void;
  adjustRent(id: number, dir: number): number | undefined;
  setNoRate(id: number): boolean;
  setCars(id: number, cars: number): boolean;
  sellAt(floor: number, x: number): boolean;
  free(): void;
};

const engines: Engine[] = [];
afterEach(() => {
  for (const e of engines.splice(0)) e.free();
});

/** A small tower with every kind of record: lobby and floor runs, offices,
 *  two fast food places (they carry a subtype), a renamed office, an
 *  elevator and stairs. The same tower in both engines, through one save. */
function tower(): { sim: Simulation; engine: Engine } {
  const built = Simulation.newGame(11, "classic");
  built.money = 1e8;
  for (let x = 160; x < 210; x++) expect(built.build("lobby", 1, x).ok).toBe(true);
  for (const floor of [2, 3]) for (let x = 160; x < 210; x++) expect(built.build("floor", floor, x).ok).toBe(true);
  for (const x of [170, 180]) expect(built.build("office", 2, x).ok).toBe(true);
  for (const floor of [2, 3]) expect(built.build("fastFood", floor, 190).ok).toBe(true);
  expect(built.buildTransport("elevatorStandard", 162, 1, 3).ok).toBe(true);
  expect(built.buildTransport("stairs", 205, 1, 2).ok).toBe(true);
  built.tower.unitAt(2, 170)!.label = "Corner Office";
  const save = JSON.stringify(built.serialize());
  const sim = Simulation.deserialize(JSON.parse(save) as SerializedGame);
  const engine = wasm().Engine.fromSave(save) as unknown as Engine;
  engines.push(engine);
  return { sim, engine };
}

/** Both engines moved by the same ticks. */
function play(sim: Simulation, engine: Engine, minutes: number): void {
  sim.tick(minutes);
  engine.tick(minutes);
}

const layout = (): Layout => {
  const probe = wasm().Engine.newGame(1, "modern");
  try {
    return JSON.parse(probe.viewLayout()) as Layout;
  } finally {
    probe.free();
  }
};

const FIELD_NAMES = ["state", "occupants", "customersIn", "hotelCustomersIn", "outForMeal"];

/** The fields a frame or a run carries for a unit, by the layout's names. */
function fields(u: Unit, l: Layout): number[] {
  const f: Record<string, number> = {
    state: l.unitStates.indexOf(u.state),
    occupants: u.occupants,
    customersIn: u.customersIn ?? -1,
    hotelCustomersIn: u.hotelCustomersIn ?? -1,
    outForMeal: u.outForMeal ?? -1,
  };
  return FIELD_NAMES.map((n) => f[n]);
}

/** The rooms in slot order, as the view numbers them. */
const roomsOf = (sim: Simulation): Unit[] => sim.tower.units.filter((u) => !isStructural(u.kind));

/** A frame decoded by the layout's names alone. */
function decode(v: Float64Array, l: Layout) {
  const h = (name: string) => v[l.header[name]];
  let at = l.headerWidth;
  const people = [];
  for (let i = 0; i < h("people"); i++) {
    const p = (name: string) => v[at + l.person[name]];
    people.push({ id: p("id"), seed: p("seed"), staff: p("staff") === 1, state: l.personStates[p("state")], floor: p("floor"), x: p("x"), fy: p("fy"), wait: p("wait") });
    at += l.personWidth;
  }
  const rooms = new Map<number, number[]>();
  for (let i = 0; i < h("units"); i++) {
    const r = (name: string) => v[at + l.unit[name]];
    rooms.set(r("slot"), FIELD_NAMES.map(r));
    at += l.unitWidth;
  }
  const transports = [];
  for (let i = 0; i < h("transports"); i++) {
    const id = v[at + l.transport.id];
    const count = v[at + l.transport.cars];
    at += l.transportFixed;
    const cars = [];
    for (let c = 0; c < count; c++) {
      cars.push([v[at + l.car.position], v[at + l.car.load], v[at + l.car.direction]]);
      at += l.carWidth;
    }
    transports.push({ id, cars });
  }
  expect(at).toBe(v.length);
  return { h, people, rooms, transports };
}

/** What a frame should carry for the people and cars, from the TypeScript
 *  instance. */
function people(sim: Simulation) {
  return sim.crowd.people.map((p) => ({ id: p.id, seed: p.seed, staff: p.staff === true, state: p.state, floor: p.floor, x: p.x, fy: p.fy, wait: p.wait }));
}
function transports(sim: Simulation) {
  return sim.tower.transports.map((t) => ({
    id: t.id,
    cars: Array.from({ length: t.cars }, (_, i) => [t.carPositions[i] ?? 0, t.carLoad?.[i] ?? -1, t.carDir[i] ?? 0]),
  }));
}

/** The structure decodes, by the layout's names alone, to the tower the
 *  TypeScript instance holds: the header, every room in slot order, every
 *  floor and lobby tile in exactly one run, every shaft. */
function expectStructure(sim: Simulation, engine: Engine): Float64Array {
  const l = layout();
  const v = engine.viewStructure();
  const h = (name: string) => v[l.structure[name]];
  expect(h("revision")).toBe(sim.tower.revision);
  expect([h("highestFloor"), h("lowestFloor")]).toEqual([sim.tower.highestFloor, sim.tower.lowestFloor]);
  expect([l.modes[h("mode")], l.calendars[h("calendar")]]).toEqual([sim.mode, sim.modernCalendar]);
  expect(h("sceneSeed")).toBe(sim.rng.initialSeed);
  const rooms = roomsOf(sim);
  expect(h("rooms")).toBe(rooms.length);
  let at = l.structureWidth;
  for (const u of rooms) {
    const r = (name: string) => v[at + l.room[name]];
    expect([r("id"), l.kinds[r("kind")], r("floor"), r("x"), r("width")]).toEqual([u.id, u.kind, u.floor, u.x, u.width]);
    at += l.roomWidth;
  }
  const tiles: string[] = [];
  for (let k = 0; k < h("runs"); k++) {
    const r = (name: string) => v[at + l.run[name]];
    for (let i = 0; i < r("count"); i++) {
      tiles.push(`${l.kinds[r("kind")]}@${r("floor")},${r("x") + i * r("width")}x${r("width")}:${FIELD_NAMES.map(r).join(",")}`);
    }
    at += l.runWidth;
  }
  const want = sim.tower.units
    .filter((u) => isStructural(u.kind))
    .map((u) => `${u.kind}@${u.floor},${u.x}x${u.width}:${fields(u, l).join(",")}`);
  expect(tiles.sort()).toEqual(want.sort());
  expect(h("shafts")).toBe(sim.tower.transports.length);
  for (const t of sim.tower.transports) {
    const s = (name: string) => v[at + l.shaft[name]];
    expect([s("id"), l.kinds[s("kind")], s("x"), s("width"), s("bottom"), s("top"), s("cars")]).toEqual([t.id, t.kind, t.x, t.width, t.bottom, t.top, t.cars]);
    at += l.shaftFixed + s("skips");
  }
  expect(at).toBe(v.length);
  return v;
}

describe.skipIf(!hasWasmPackage())("the engine view through the binding (#1213)", () => {
  it("hands over its layout by name, every slot named once", () => {
    const l = layout();
    expect(l.version).toBe(5);
    const tables: [Slots, number][] = [
      [l.header, l.headerWidth], [l.person, l.personWidth], [l.unit, l.unitWidth],
      [l.transport, l.transportFixed], [l.car, l.carWidth], [l.structure, l.structureWidth],
      [l.room, l.roomWidth], [l.run, l.runWidth], [l.shaft, l.shaftFixed],
    ];
    for (const [slots, width] of tables) {
      expect(Object.values(slots).sort((a, b) => a - b)).toEqual([...Array(width).keys()]);
    }
    expect(Object.keys(l.unit)).toEqual(["slot", ...FIELD_NAMES]);
    expect(l.metaRecord).toEqual(["id", "label", "subtype"]);
    expect(l.kinds).toContain("lobby");
    expect(l.unitStates).toContain("empty");
  });

  it("decodes the structure to the tower the TypeScript engine holds", () => {
    const { sim, engine } = tower();
    const v = expectStructure(sim, engine);
    // Three floors of one kind each, every tile alike: one run per floor.
    expect(v[layout().structure.runs]).toBe(3);
  });

  it("reads a tower in play: the header, the people, the rooms that changed and the cars", () => {
    const { sim, engine } = tower();
    const l = layout();
    // Play until the tower has people in it.
    for (let i = 0; i < 400 && sim.crowd.people.length === 0; i++) play(sim, engine, 6);
    expect(sim.crowd.people.length).toBeGreaterThan(0);
    let sent = roomsOf(sim).map((u) => fields(u, l));
    // Play can move metadata (a tenant's subtype), which the TypeScript
    // instance has no revision for: the meta revision moves when some
    // unit's label or subtype did, and the log lists just those units.
    const metaOf = () => new Map(sim.tower.units.map((u) => [u.id, `${u.label}|${u.subtype ?? ""}`]));
    let metaSent = metaOf();
    let metaRevision = 1;
    let frames = 0;
    let changedFrames = 0;
    const check = (v: Float64Array, full: boolean) => {
      frames++;
      const f = decode(v, l);
      expect(f.h("frameSeq")).toBe(frames);
      expect(f.h("full")).toBe(full ? 1 : 0);
      expect(f.h("minutes")).toBe(sim.clock.minutes);
      expect(f.h("towerRevision")).toBe(sim.tower.revision);
      const metaNow = metaOf();
      const moved = [...metaNow].filter(([id, m]) => metaSent.get(id) !== m).map(([id]) => id);
      if (moved.length === 0) {
        expect(f.h("metaRevision")).toBe(metaRevision);
      } else {
        expect(f.h("metaRevision")).toBeGreaterThan(metaRevision);
        const since = JSON.parse(engine.unitMetaSince(metaRevision)) as Meta;
        const id = l.metaRecord.indexOf("id");
        expect(since.full).toBe(false);
        expect(since.units.map((r) => r[id] as number).sort((a, b) => a - b)).toEqual(moved.sort((a, b) => a - b));
        metaRevision = f.h("metaRevision");
      }
      metaSent = metaNow;
      expect(f.h("logSeq")).toBe(sim.logSeq);
      expect(f.h("money")).toBe(sim.money);
      expect(f.h("star")).toBe(sim.star);
      expect(f.h("population")).toBe(sim.population);
      expect(l.weather[f.h("weather")]).toBe(sim.weather);
      const mask = f.h("unlocked");
      l.kinds.forEach((kind, k) => {
        expect(Math.floor(mask / 2 ** k) % 2, kind).toBe(sim.isUnlocked(kind as FacilityKind) ? 1 : 0);
      });
      const rooms = roomsOf(sim);
      expect(f.h("rooms")).toBe(rooms.length);
      expect(f.people).toEqual(people(sim));
      expect(f.transports).toEqual(transports(sim));
      // Every room on a full frame, else just the ones whose fields moved.
      const now = rooms.map((u) => fields(u, l));
      const want = new Map<number, number[]>();
      now.forEach((row, slot) => {
        if (full || row.join() !== sent[slot].join()) want.set(slot, row);
      });
      expect(f.rooms).toEqual(want);
      if (!full && want.size > 0) changedFrames++;
      sent = now;
    };
    check(engine.viewFrame(false), true);
    for (let i = 0; i < 60; i++) {
      play(sim, engine, 6);
      check(engine.viewFrame(false), false);
    }
    // The play moved some room and some tenant's metadata, so both paths ran.
    expect(changedFrames).toBeGreaterThan(0);
    expect(metaRevision).toBeGreaterThan(1);
    expectStructure(sim, engine);
    // Only a JS `true` asks for a full frame.
    for (const raw of [false, undefined, null, 1, "true", {}]) {
      const f = decode(engine.viewFrame(raw), l);
      expect([f.h("full"), f.h("units")], String(raw)).toEqual([0, 0]);
      frames++;
    }
    check(engine.viewFrame(true), true);
  });

  it("lists metadata from revision 1, then only what a setter changed", () => {
    const { sim, engine } = tower();
    const l = layout();
    const meta = (since: unknown) => JSON.parse(engine.unitMetaSince(since)) as Meta;
    const record = (u: Unit) => {
      const value: Record<string, number | string | null> = { id: u.id, label: u.label, subtype: u.subtype ?? null };
      return l.metaRecord.map((name) => value[name]);
    };
    const all = meta(undefined);
    const want = sim.tower.units.filter((u) => u.subtype !== undefined || u.label !== l.names[l.kinds.indexOf(u.kind)]).map(record);
    expect(want.length).toBe(3);
    expect(all).toEqual({ revision: 1, full: true, units: want });
    expect(meta(0)).toEqual(all);
    expect(meta(1)).toEqual({ revision: 1, full: false, units: [] });
    for (const raw of [null, Number.NaN, -1, 0.5, 2, "1", Infinity]) {
      expect(meta(raw).full, String(raw)).toBe(true);
    }
    const office = sim.tower.unitAt(2, 180)!;
    expect(engine.setLabel(office.id, "  Back Office ")).toBe(true);
    expect(sim.tower.setLabel(office.id, "  Back Office ")).toBe(true);
    expect(meta(1)).toEqual({ revision: 2, full: false, units: [record(office)] });
    expect(meta(2)).toEqual({ revision: 2, full: false, units: [] });
    expect(engine.viewFrame(false)[l.header.metaRevision]).toBe(2);
  });

  it("signs the tower as undo's fingerprint does, money and play aside", () => {
    const { sim, engine } = tower();
    // Each tower string seen so far, with the signature it read as: one
    // string reads as one signature, and two strings as two.
    const seen = new Map<string, bigint>();
    const check = (what: string) => {
      const text = towerStateSig(sim.tower, 0);
      const sig = engine.towerSignature();
      expect(typeof sig).toBe("bigint");
      const before = seen.get(text);
      if (before === undefined) {
        expect([...seen.values()], what).not.toContain(sig);
        seen.set(text, sig);
      } else {
        expect(sig, what).toBe(before);
      }
    };
    check("loaded");
    const office = sim.tower.unitAt(2, 180)!;
    const name = office.label;
    const corner = sim.tower.unitAt(2, 170)!.id;
    const elevator = sim.tower.transports.find((t) => t.kind === "elevatorStandard")!.id;
    const both = (a: unknown, b: unknown) => expect(a).toEqual(b);
    const steps: [string, () => void][] = [
      ["money", () => { sim.money = 12345; engine.setMoney(12345); }],
      ["label", () => both(sim.tower.setLabel(office.id, "Back Office"), engine.setLabel(office.id, "Back Office"))],
      ["label back", () => both(sim.tower.setLabel(office.id, name), engine.setLabel(office.id, name))],
      ["rent up", () => both(sim.adjustRent(office.id, 1), engine.adjustRent(office.id, 1) ?? null)],
      ["rent down", () => both(sim.adjustRent(office.id, -1), engine.adjustRent(office.id, -1) ?? null)],
      ["no rate", () => both(sim.setNoRate(corner), engine.setNoRate(corner))],
      ["cars", () => both(sim.setCars(elevator, 2), engine.setCars(elevator, 2))],
      ["play", () => play(sim, engine, 60)],
      ["sell", () => both(sim.sellAt(2, 180), engine.sellAt(2, 180))],
    ];
    for (const [what, step] of steps) {
      step();
      check(what);
    }
    // After the cars, the play and the sale, the structure is the tower's.
    expectStructure(sim, engine);
    // At least the loaded tower, the rename, the rent, no rate, two cars and
    // the sale read as strings of their own; the money step and the label
    // put back read as the loaded one.
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });
});
