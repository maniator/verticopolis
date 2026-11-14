import { afterEach, describe, expect, it } from "vitest";
import { readCatalog } from "../../engineBinding/catalog";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";

/**
 * The renderer-facing view (facade slice 6a, #1213) through the real
 * binding, read the way a host reads it: every slot by the names
 * `viewLayout()` hands over. The structure and the metadata are checked
 * against the engine's own save of the same tower. Until #1875 each read was
 * checked against a TypeScript instance moved the same way; the frame and
 * signature halves of that comparison are Rust tests now (`view/frame_tests.rs`,
 * `view/oracle_tests.rs`, `view/meta_tests.rs`, `rule_tests/undo_signature.rs`).
 */

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
  viewLayout(): string;
  viewStructure(): Float64Array;
  viewFrame(full: unknown): Float64Array;
  unitMetaSince(since: unknown): string;
  serialize(): string;
  build(kind: string, floor: number, x: number): string;
  buildTransport(kind: string, x: number, bottom: number, top: number): string;
  setLabel(id: number, label: string): boolean;
  setMoney(amount: number): void;
  free(): void;
};
type SaveUnit = { id: number; kind: string; floor: number; x: number; label?: string; subtype?: string };
type SaveTransport = { id: number; kind: string; x: number; bottom: number; top: number; cars: number };
type Save = { units: SaveUnit[]; transports: SaveTransport[] };

const engines: Engine[] = [];
afterEach(() => {
  for (const e of engines.splice(0)) e.free();
});

const FIELD_NAMES = ["state", "occupants", "customersIn", "hotelCustomersIn", "outForMeal"];
/** The kinds the view sends as runs of tiles rather than as rooms. */
const STRUCTURAL = new Set(["floor", "lobby"]);

const ok = (answer: string): void => expect((JSON.parse(answer) as { ok: boolean }).ok).toBe(true);

/** A small tower with every kind of record: lobby and floor runs, offices,
 *  two fast food places (they carry a subtype), a renamed office, an
 *  elevator and stairs, built, saved and loaded again so the metadata
 *  starts over. */
function tower(): { engine: Engine; save: Save } {
  const built = wasm().Engine.newGame(11, "classic") as unknown as Engine;
  try {
    built.setMoney(1e8);
    for (let x = 160; x < 210; x++) ok(built.build("lobby", 1, x));
    for (const floor of [2, 3]) for (let x = 160; x < 210; x++) ok(built.build("floor", floor, x));
    for (const x of [170, 180]) ok(built.build("office", 2, x));
    for (const floor of [2, 3]) ok(built.build("fastFood", floor, 190));
    ok(built.buildTransport("elevatorStandard", 162, 1, 3));
    ok(built.buildTransport("stairs", 205, 1, 2));
    const corner = (JSON.parse(built.serialize()) as Save).units.find((u) => u.kind === "office" && u.x === 170)!;
    expect(built.setLabel(corner.id, "Corner Office")).toBe(true);
    const text = built.serialize();
    const engine = wasm().Engine.fromSave(text) as unknown as Engine;
    engines.push(engine);
    return { engine, save: JSON.parse(text) as Save };
  } finally {
    built.free();
  }
}

const layout = (): Layout => {
  const probe = wasm().Engine.newGame(1, "modern");
  try {
    return JSON.parse(probe.viewLayout()) as Layout;
  } finally {
    probe.free();
  }
};

describe.skipIf(!hasWasmPackage())("the engine view through the binding (#1213)", () => {
  it("hands over its layout by name, every slot named once", () => {
    const l = layout();
    expect(l.version).toBe(23);
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

  it("decodes the structure, by the layout's names alone, to the tower the save holds", () => {
    const { engine, save } = tower();
    const l = layout();
    const widths = new Map<string, number>(readCatalog(wasm(), "classic").facilities.map((f) => [f.key, f.width]));
    const v = engine.viewStructure();
    const h = (name: string) => v[l.structure[name]];
    const rooms = save.units.filter((u) => !STRUCTURAL.has(u.kind));
    expect(h("rooms")).toBe(rooms.length);
    let at = l.structureWidth;
    for (const u of rooms) {
      const r = (name: string) => v[at + l.room[name]];
      expect([r("id"), l.kinds[r("kind")], r("floor"), r("x"), r("width")]).toEqual([u.id, u.kind, u.floor, u.x, widths.get(u.kind)]);
      at += l.roomWidth;
    }
    // Every floor and lobby tile in exactly one run.
    const tiles: string[] = [];
    // Three floors of one kind each, every tile alike: one run per floor.
    expect(h("runs")).toBe(3);
    for (let k = 0; k < h("runs"); k++) {
      const r = (name: string) => v[at + l.run[name]];
      for (let i = 0; i < r("count"); i++) tiles.push(`${l.kinds[r("kind")]}@${r("floor")},${r("x") + i * r("width")}x${r("width")}`);
      at += l.runWidth;
    }
    const want = save.units.filter((u) => STRUCTURAL.has(u.kind)).map((u) => `${u.kind}@${u.floor},${u.x}x${widths.get(u.kind)}`);
    expect(tiles.sort()).toEqual(want.sort());
    expect(h("shafts")).toBe(save.transports.length);
    for (const t of save.transports) {
      const s = (name: string) => v[at + l.shaft[name]];
      expect([s("id"), l.kinds[s("kind")], s("x"), s("width"), s("bottom"), s("top"), s("cars")]).toEqual([t.id, t.kind, t.x, widths.get(t.kind), t.bottom, t.top, t.cars]);
      at += l.shaftFixed + s("skips");
    }
    expect(at).toBe(v.length);
  });

  it("lists metadata from revision 1, then only what a setter changed", () => {
    const { engine, save } = tower();
    const l = layout();
    const meta = (since: unknown) => JSON.parse(engine.unitMetaSince(since)) as Meta;
    const name = (kind: string) => l.names[l.kinds.indexOf(kind)];
    const record = (u: SaveUnit, label = u.label ?? name(u.kind)) => {
      const value: Record<string, number | string | null> = { id: u.id, label, subtype: u.subtype ?? null };
      return l.metaRecord.map((n) => value[n]);
    };
    const all = meta(undefined);
    // The renamed office and the two fast food places, which carry a subtype.
    const want = save.units.filter((u) => u.subtype !== undefined || u.label !== undefined).map((u) => record(u));
    expect(want.length).toBe(3);
    expect(all).toEqual({ revision: 1, full: true, units: want });
    expect(meta(0)).toEqual(all);
    expect(meta(1)).toEqual({ revision: 1, full: false, units: [] });
    for (const raw of [null, Number.NaN, -1, 0.5, 2, "1", Infinity]) {
      expect(meta(raw).full, String(raw)).toBe(true);
    }
    const office = save.units.find((u) => u.kind === "office" && u.x === 180)!;
    expect(engine.setLabel(office.id, "  Back Office ")).toBe(true);
    expect(meta(1)).toEqual({ revision: 2, full: false, units: [record(office, "Back Office")] });
    expect(meta(2)).toEqual({ revision: 2, full: false, units: [] });
    expect(engine.viewFrame(false)[l.header.metaRevision]).toBe(2);
  });
});
