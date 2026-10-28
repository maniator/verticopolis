import { expect } from "vitest";
import { facilityFloors } from "../engine/facilities";
import { CALENDAR_CODES, KIND_CODES, MODE_CODES, VIEW_LAYOUT, codeOf } from "../engine/port/layout";
import { Simulation } from "../engine/Simulation";
import type { FacilityKind } from "../engine/types";
import { newSeededGame } from "../tests/fixtures/towerFixtures";
import type { EnginePort, PortRecord } from "./enginePort";
import { ViewReader } from "./viewReader";

/**
 * The engine under the port contracts (`engineContract.fixture.ts`,
 * `engineLifecycle.fixture.ts`): either engine, started from a tower's save,
 * with the shared reader over it. The contracts drive the engine through
 * `EnginePort` alone and read it back through the reader, its records, its
 * events and its save, so the same cases run on `TsEngine` and the Rust
 * `Engine`.
 */

/** An engine on the save of `sim`. */
export type MakeEngine = (sim: Simulation) => EnginePort;

export interface Subject {
  readonly port: EnginePort;
  readonly reader: ViewReader;
}

/** The engine on `sim`'s save: by default a freshly founded Modern tower
 *  standing on its starter lobby (a ground-floor strip of lobby tiles). */
export function subject(make: MakeEngine, sim: Simulation = newSeededGame(7, "modern")): Subject {
  const port = make(sim);
  return { port, reader: new ViewReader(port, facilityFloors) };
}

export const kind = (name: FacilityKind): number => codeOf(KIND_CODES, name);
export const mode = (name: "classic" | "modern"): number => codeOf(MODE_CODES, name);
export const calendar = (name: "canon" | "realWorld"): number => codeOf(CALENDAR_CODES, name);
export const logKind = (name: string): number => VIEW_LAYOUT.logKinds.indexOf(name);
export const filmPolicy = (name: string): number => VIEW_LAYOUT.filmPolicies.indexOf(name);

/** Slot `name` of `op`'s record. */
export function slot(op: keyof typeof VIEW_LAYOUT.records, rec: PortRecord, name: string): number {
  const at = (VIEW_LAYOUT.records[op] as readonly string[]).indexOf(name);
  if (at < 0) throw new Error(`contract: ${op} has no slot ${name}`);
  return rec[at];
}

export const done = (rec: PortRecord): boolean => rec[0] === 1;
export const delta = (rec: PortRecord): number => rec[1];

/** The balance, from the engine's save. */
export const money = (s: Subject): number => saved(s).money;

const reasons = new WeakMap<PortRecord, string | undefined>();

/** The refusal text the engine gave right after answering `rec` through
 *  {@link run} (a later read may clear it). */
export const reasonOf = (rec: PortRecord): string | undefined => reasons.get(rec);

/** Run `call` and check its record's `delta` is the balance's change. */
export function run(s: Subject, call: (port: EnginePort) => PortRecord, label: string): PortRecord {
  const before = money(s);
  const rec = call(s.port);
  reasons.set(rec, s.port.lastReason());
  expect(money(s) - before, label).toBe(delta(rec));
  s.reader.update();
  return rec;
}

/** Run `call`, which must be done. */
export function must(s: Subject, call: (port: EnginePort) => PortRecord, label: string): PortRecord {
  const rec = run(s, call, label);
  expect(done(rec), `${label}: ${reasonOf(rec)}`).toBe(true);
  return rec;
}

/** The gameplay events since the last drain, oldest first. */
export function drain(port: EnginePort): { name: string; payload: unknown }[] {
  const [, count] = port.drainEvents();
  return Array.from({ length: count }, (_, i) => JSON.parse(port.eventText(i) ?? "null") as { name: string; payload: unknown });
}

/** The parts of a save the contracts read back. */
export interface SavedTower {
  version: number;
  money: number;
  mode?: string;
  modernCalendar?: string;
  autoBridge?: boolean;
  founder?: boolean;
  towerName?: string;
  view?: { tile: number; floor: number; zoom?: number };
  units: { id: number; kind: string; floor: number; x: number; rent?: number; label?: string }[];
  transports: { id: number; skipFloors?: number[]; schedule?: Record<string, unknown> }[];
  log?: { text: string; kind: string }[];
}

export const saved = (s: Pick<Subject, "port">): SavedTower => JSON.parse(s.port.serialize()) as SavedTower;

export function mustFind<T>(items: ReadonlyArray<T>, match: (item: T) => boolean): T {
  const found = items.find(match);
  if (found === undefined) throw new Error("contract: expected item not found");
  return found;
}

/** The lot's width in tiles (`GRID.width`, the 1994 map's 375 segments). */
export const LOT_WIDTH = 375;

/** The middle of the ground-floor lobby the founded tower stands on, checked
 *  to span the cells the cases build over (`mid - 4` to `mid + 15`). */
export function lobbyCenter(s: Subject): number {
  const lobby: number[] = [];
  for (let x = 0; x < LOT_WIDTH; x++) if (s.reader.tower.structureKindAt(1, x) === "lobby") lobby.push(x);
  expect(lobby.length, "the founded tower's starter lobby").toBeGreaterThan(0);
  const left = lobby[0];
  const right = lobby[lobby.length - 1] + 1;
  const mid = Math.floor((left + right) / 2);
  expect([left <= mid - 4, right >= mid + 16, right - left === lobby.length], `the starter lobby spans ${left} to ${right} in one run`).toEqual([true, true, true]);
  return mid;
}

/** One past the starter lobby's last tile, walking right from `mid`. */
export function lobbyRight(s: Subject, mid: number): number {
  let x = mid;
  while (s.reader.tower.structureKindAt(1, x) === "lobby") x++;
  return x;
}

/** What `furnish` built, by id. */
export interface Furnished {
  mid: number;
  office: number;
  fastFood: number;
  shaft: number;
}

/** Floor 2 and 3 strips by brush, an office on floor 2, a fast food on floor
 *  3 over it, and a one-car standard elevator over floors 1 to 3. */
export function furnish(s: Subject): Furnished {
  const mid = lobbyCenter(s);
  const tiles = Float64Array.from({ length: 11 }, (_, i) => mid + 5 + i);
  for (const floor of [2, 3]) expect(slot("paintTiles", must(s, (p) => p.paintTiles(kind("floor"), floor, tiles), `floor ${floor}`), "placed")).toBe(11);
  must(s, (p) => p.buildAt(kind("office"), 2, mid - 4), "office");
  must(s, (p) => p.buildAt(kind("fastFood"), 3, mid - 4), "fast food");
  must(s, (p) => p.buildShaft(kind("elevatorStandard"), mid + 12, 1, 3), "shaft");
  const { tower } = s.reader;
  return {
    mid,
    office: mustFind(tower.units, (u) => u.kind === "office").id,
    fastFood: mustFind(tower.units, (u) => u.kind === "fastFood").id,
    shaft: mustFind(tower.transports, (t) => t.kind === "elevatorStandard").id,
  };
}

/** Run `call`, which must be refused, and check it moved nothing: no balance
 *  change, the same save, no log line and no gameplay event. */
export function expectUnmoved(s: Subject, call: (port: EnginePort) => PortRecord, label: string): PortRecord {
  const save = s.port.serialize();
  drain(s.port);
  const rec = call(s.port);
  reasons.set(rec, s.port.lastReason());
  expect(done(rec), label).toBe(false);
  expect(delta(rec), label).toBe(0);
  expect(s.port.serialize(), label).toBe(save);
  expect(drain(s.port), label).toEqual([]);
  return rec;
}

/** A copy of `sim` through its save, so a factory never shares a tower. */
export const copyOf = (sim: Simulation): Simulation => Simulation.deserialize(JSON.parse(JSON.stringify(sim.serialize())));
