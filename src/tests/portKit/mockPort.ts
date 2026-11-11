import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { vi } from "vitest";
import type { EnginePort } from "../../simport/enginePort";

/**
 * A mock engine port for the port's unit tests (`src/simport/`). Each method a
 * test hands `mockPort` becomes a `vi.fn()` spy, so a test asserts the calls a
 * unit made and feeds it the answers it decodes. A method the test did not
 * hand over throws when called, so an unexpected port call fails the test.
 *
 * The numeric answers (frames, the structure, records) are encoded from the
 * Rust engine's own layout, `src/simport/fixtures/viewLayout.json`, which
 * `portReads.integration.test.ts` holds to the engine's fresh answer.
 */

type Slots = Record<string, number>;

/** The parts of `viewLayout()` the encoders and the units read. */
export interface Layout {
  header: Slots;
  headerWidth: number;
  person: Slots;
  personWidth: number;
  unit: Slots;
  unitWidth: number;
  transport: Slots;
  transportFixed: number;
  car: Slots;
  carWidth: number;
  structure: Slots;
  structureWidth: number;
  room: Slots;
  roomWidth: number;
  run: Slots;
  runWidth: number;
  shaft: Slots;
  shaftFixed: number;
  kinds: string[];
  names: string[];
  unitStates: string[];
  personStates: string[];
  weather: string[];
  modes: string[];
  calendars: string[];
  filmPolicies: string[];
  vacateReasons: string[];
  logKinds: string[];
  heatModes: string[];
  heatTints: string[];
  scheduleSlots: number;
  records: Record<string, string[]>;
}

export const FIXTURES = resolve(__dirname, "../../simport/fixtures");
/** The layout fixture's text, as the engine's `viewLayout()` answers it. */
export const LAYOUT_TEXT = JSON.stringify(JSON.parse(readFileSync(resolve(FIXTURES, "viewLayout.json"), "utf8")));
export const LAYOUT = JSON.parse(LAYOUT_TEXT) as Layout;

type Methods = { [K in keyof EnginePort]?: EnginePort[K] };

/** A port whose methods are the spies of `answers`; any other method throws
 *  when called. `viewLayout` answers the layout fixture unless overridden. */
export function mockPort(answers: Methods = {}): EnginePort {
  const spies = new Map<string, unknown>();
  for (const [name, impl] of Object.entries({ viewLayout: () => LAYOUT_TEXT, ...answers })) spies.set(name, vi.fn(impl as (...a: unknown[]) => unknown));
  return new Proxy({} as EnginePort, {
    get(_, name) {
      // Not a thenable, so a port passed through a promise stays a port.
      if (typeof name === "symbol" || name === "then") return undefined;
      return (
        spies.get(name) ??
        (() => {
          throw new Error(`unexpected port call: ${name}`);
        })
      );
    },
  });
}

/** `name`'s code in a layout table; throws for a name the table lacks. */
export function code(table: keyof Pick<Layout, "kinds" | "unitStates" | "personStates" | "weather" | "modes" | "calendars" | "filmPolicies" | "vacateReasons" | "heatModes" | "heatTints">, name: string): number {
  const at = LAYOUT[table].indexOf(name);
  if (at < 0) throw new Error(`${table} has no ${name}`);
  return at;
}

type Fields = Record<string, number>;

/** One fixed-width row: each field at its slot, the rest 0. */
function row(slots: Slots, width: number, fields: Fields): number[] {
  const out = new Array<number>(width).fill(0);
  for (const [name, v] of Object.entries(fields)) {
    if (!(name in slots)) throw new Error(`the layout has no slot ${name}`);
    out[slots[name]] = v;
  }
  return out;
}

export interface Car {
  position: number;
  load: number;
  direction: number;
}

/** A `viewFrame` answer: the header (counts filled in), then people, units and
 *  each shaft's cars. */
export function frame(spec: { header?: Fields; people?: Fields[]; units?: Fields[]; transports?: { id: number; cars: Car[] }[] }): Float64Array {
  const l = LAYOUT;
  const people = spec.people ?? [];
  const units = spec.units ?? [];
  const transports = spec.transports ?? [];
  const out = row(l.header, l.headerWidth, { ...spec.header, people: people.length, units: units.length, transports: transports.length });
  for (const p of people) out.push(...row(l.person, l.personWidth, p));
  for (const u of units) out.push(...row(l.unit, l.unitWidth, u));
  for (const t of transports) {
    out.push(...row(l.transport, l.transportFixed, { id: t.id, cars: t.cars.length }));
    for (const c of t.cars) out.push(...row(l.car, l.carWidth, { ...c }));
  }
  return Float64Array.from(out);
}

export interface RoomSpec {
  id: number;
  kind: string;
  floor: number;
  x: number;
  width: number;
}

export interface RunSpec {
  kind: "floor" | "lobby";
  floor: number;
  x: number;
  width?: number;
  count: number;
  state?: string;
  occupants?: number;
}

export interface ShaftSpec {
  id: number;
  kind: string;
  x: number;
  width?: number;
  bottom: number;
  top: number;
  cars: number;
  skips?: number[];
}

/** A `viewStructure` answer: the scalars (counts filled in), then rooms, runs
 *  and shafts, kinds and states passed by name. */
export function structure(spec: { header?: Fields; mode?: string; calendar?: string; rooms?: RoomSpec[]; runs?: RunSpec[]; shafts?: ShaftSpec[] }): Float64Array {
  const l = LAYOUT;
  const rooms = spec.rooms ?? [];
  const runs = spec.runs ?? [];
  const shafts = spec.shafts ?? [];
  const out = row(l.structure, l.structureWidth, {
    mode: code("modes", spec.mode ?? "modern"),
    calendar: code("calendars", spec.calendar ?? "canon"),
    ...spec.header,
    rooms: rooms.length,
    runs: runs.length,
    shafts: shafts.length,
  });
  for (const r of rooms) out.push(...row(l.room, l.roomWidth, { ...r, kind: code("kinds", r.kind) }));
  for (const r of runs) {
    const counters = { customersIn: -1, hotelCustomersIn: -1, outForMeal: -1 };
    const fields = { kind: code("kinds", r.kind), floor: r.floor, x: r.x, width: r.width ?? 1, count: r.count, state: code("unitStates", r.state ?? "empty"), occupants: r.occupants ?? 0 };
    out.push(...row(l.run, l.runWidth, { ...counters, ...fields }));
  }
  for (const s of shafts) {
    const skips = s.skips ?? [];
    out.push(...row(l.shaft, l.shaftFixed, { id: s.id, kind: code("kinds", s.kind), x: s.x, width: s.width ?? 4, bottom: s.bottom, top: s.top, cars: s.cars, skips: skips.length }));
    out.push(...skips);
  }
  return Float64Array.from(out);
}

/** A command or card record: each named slot of `op`'s record set, the rest
 *  0, then `tail` (a shaft card's hourly, stop and origin sections). */
export function record(op: string, fields: Fields, tail: number[] = []): Float64Array {
  const names = LAYOUT.records[op];
  if (!names) throw new Error(`the layout has no ${op} record`);
  return Float64Array.from([...row(Object.fromEntries(names.map((n, i) => [n, i])), names.length, fields), ...tail]);
}
