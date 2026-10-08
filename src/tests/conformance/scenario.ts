import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Simulation } from "../../engine/Simulation";
import type { FacilityKind, GameMode } from "../../engine/types";
import { FACILITIES } from "../../engine/facilitiesData";
import type { SerializedGame } from "../../engine/serializedGame";
import { decodeVctower } from "../../storage/vctowerContainer";
import { markFounderFromLoadedFile } from "../../engine/sim/founderStatus";
import { rentOf } from "../../engine/econConfig";
import { digest } from "./canonical";

/**
 * The TypeScript reference runner for the engine conformance suite. The format
 * and the hash definition are documented in conformance/README.md; a second
 * engine implements the same runner and must produce the same checkpoint list.
 */

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const CONFORMANCE_DIR = resolve(REPO_ROOT, "conformance");

export type Start =
  | { newGame: { seed: number; mode: GameMode } }
  | { fixture: string; mode?: GameMode };

/** A unit or shaft is named by a tile it covers, never by id. */
interface At { floor: number; x: number }

export type Command =
  | { op: "setMoney"; amount: number }
  | { op: "build"; kind: FacilityKind; floor: number; x: number; expectFail?: boolean }
  | { op: "buildRow"; kind: FacilityKind; floor: number; from: number; to: number }
  | { op: "buildTransport"; kind: FacilityKind; x: number; bottom: number; top: number; expectFail?: boolean }
  | ({ op: "sell"; kind?: FacilityKind } & At)
  | ({ op: "adjustRent"; dir: 1 | -1 } & At)
  | ({ op: "setNoRate" } & At)
  | ({ op: "setCars"; cars: number } & At)
  | { op: "startFire" }
  | { op: "bombThreat" }
  | { op: "evaluateStar" }
  | { op: "callExterminator"; expectFail?: boolean }
  | ({ op: "setSchedule"; schedule: Record<string, unknown> } & At)
  | { op: "reload" }
  | { op: "tick"; dt: number; times?: number; checkpointEvery?: number }
  | { op: "checkpoint"; label: string };

export interface Scenario {
  id: string;
  description: string;
  start: Start;
  commands: Command[];
}

export interface Checkpoint {
  label: string;
  state: string;
  crowd: string;
}

/** Field types: "int" a whole number, "u32" a whole number from 0 to
 *  4294967295, "count" a whole number above zero, "dir" 1 or -1, "num" a finite
 *  number, "str" a non-empty string, "bool" a boolean, "place" a facility kind
 *  that is not a transport, "shaft" a transport kind, "mode" classic or modern,
 *  "obj" a JSON object, "kind" any facility kind.
 *  A trailing "?" marks the field optional. */
type FieldType = "int" | "u32" | "count" | "dir" | "num" | "str" | "bool" | "place" | "shaft" | "mode" | "obj" | "kind";
const AT = { floor: "int", x: "int" } as const;
const OPS: Record<Command["op"], Spec> = {
  setMoney: { amount: "num" },
  build: { kind: "place", floor: "int", x: "int", expectFail: "bool?" },
  buildRow: { kind: "place", floor: "int", from: "int", to: "int" },
  buildTransport: { kind: "shaft", x: "int", bottom: "int", top: "int", expectFail: "bool?" },
  sell: { ...AT, kind: "kind?" },
  adjustRent: { ...AT, dir: "dir" },
  setNoRate: AT,
  setCars: { ...AT, cars: "count" },
  startFire: {},
  bombThreat: {},
  evaluateStar: {},
  callExterminator: { expectFail: "bool?" },
  setSchedule: { ...AT, schedule: "obj" },
  reload: {},
  tick: { dt: "count", times: "count?", checkpointEvery: "count?" },
  checkpoint: { label: "str" },
};

function fits(type: FieldType, v: unknown): boolean {
  switch (type) {
    case "int": return Number.isInteger(v);
    case "u32": return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xffffffff;
    case "count": return Number.isInteger(v) && (v as number) > 0;
    case "dir": return v === 1 || v === -1;
    case "num": return typeof v === "number" && Number.isFinite(v);
    case "str": return typeof v === "string" && v.length > 0;
    case "bool": return typeof v === "boolean";
    case "place": return typeof v === "string" && own(FACILITIES, v) && !FACILITIES[v as FacilityKind].transport;
    case "shaft": return typeof v === "string" && own(FACILITIES, v) && !!FACILITIES[v as FacilityKind].transport;
    case "mode": return v === "classic" || v === "modern";
    case "obj": return typeof v === "object" && v !== null && !Array.isArray(v);
    case "kind": return typeof v === "string" && own(FACILITIES, v);
  }
}

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

type Spec = Record<string, `${FieldType}` | `${FieldType}?`>;

function check(where: string, value: unknown, spec: Spec, skip: string[] = []): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${where}: must be an object`);
  const obj = value as Record<string, unknown>;
  for (const k of Object.keys(obj)) if (!skip.includes(k) && !own(spec, k)) throw new Error(`${where}: unknown field ${k}`);
  for (const [k, t] of Object.entries(spec)) {
    if (obj[k] === undefined && t.endsWith("?")) continue;
    if (!fits(t.replace("?", "") as FieldType, obj[k])) throw new Error(`${where}: ${k} must be ${t.replace("?", "")}`);
  }
}

/** Read a scenario and refuse it whole on an unknown op, an unknown field, or
 *  a missing or ill-typed one, so a typo cannot quietly weaken it. */
export function loadScenario(file: string): Scenario {
  const s = JSON.parse(readFileSync(file, "utf8")) as Scenario;
  check(file, s, { id: "str", description: "str" }, ["start", "commands"]);
  const start = s.start as unknown as Record<string, unknown>;
  if (start && typeof start === "object" && "newGame" in start) {
    check(`${file} start`, start, {}, ["newGame"]);
    check(`${file} start.newGame`, start.newGame, { seed: "u32", mode: "mode" });
  } else {
    check(`${file} start`, start, { fixture: "str", mode: "mode?" });
  }
  if (!Array.isArray(s.commands)) throw new Error(`${file}: commands must be an array`);
  s.commands.forEach((c, i) => {
    const where = `${file} command ${i}`;
    if (!c || typeof c !== "object" || Array.isArray(c)) throw new Error(`${where}: must be an object`);
    const op = (c as { op?: unknown }).op;
    if (typeof op !== "string" || !own(OPS, op)) throw new Error(`${where}: unknown op ${JSON.stringify(op)}`);
    check(where, c, OPS[op as Command["op"]], ["op"]);
    if (c.op === "buildRow" && c.from > c.to) throw new Error(`${where}: buildRow from must not be past to`);
  });
  return s;
}

function startSim(start: Start): Simulation {
  if ("newGame" in start) {
    const sim = Simulation.newGame(start.newGame.seed, start.newGame.mode);
    if (sim.mode !== start.newGame.mode) throw new Error(`new game founded as ${sim.mode}, not ${start.newGame.mode}`);
    return sim;
  }
  const raw = decodeVctower(readFileSync(resolve(REPO_ROOT, start.fixture), "utf8"), start.fixture) as SerializedGame;
  if (start.mode) raw.mode = start.mode;
  // The import path's steps after decoding (SaveGame.import).
  const sim = Simulation.deserialize(raw);
  markFounderFromLoadedFile(sim, raw);
  if (start.mode && sim.mode !== start.mode) throw new Error(`${start.fixture} loaded as ${sim.mode}, not ${start.mode}`);
  return sim;
}

/** The saved game minus prose: log entry `text` and the pending choice's
 *  `message` are player copy (locale-formatted money), so they stay out of the
 *  hash. Every other field of both stays in. */
export function stateView(sim: Simulation): unknown {
  const data = sim.serialize() as SerializedGame & Record<string, unknown>;
  const view: Record<string, unknown> = { ...data };
  if (data.log) view.log = data.log.map(({ text: _text, ...rest }) => rest);
  const events = data.events as { pending?: { message: string } | null } | undefined;
  if (events?.pending) {
    const { message: _message, ...pending } = events.pending;
    view.events = { ...events, pending };
  }
  return view;
}

/** The live crowd, which saves never carry: its people, id source and rng. */
export function crowdView(sim: Simulation): unknown {
  return { nextId: sim.crowd.nextId, rng: sim.crowd.rng.seed, people: sim.crowd.people };
}

function unitAt(sim: Simulation, at: At) {
  const u = sim.tower.unitAt(at.floor, at.x);
  if (!u) throw new Error(`no unit at floor ${at.floor}, x ${at.x}`);
  return u;
}

function expectOk(ok: boolean, expectFail: boolean | undefined, what: string, reason?: string): void {
  if (ok === !expectFail) return;
  throw new Error(`${what} ${ok ? "succeeded but was expected to fail" : `failed: ${reason ?? "no reason"}`}`);
}

function apply(sim: Simulation, c: Command, emit: (label: string) => void, clock: { minutes: number }): Simulation {
  switch (c.op) {
    case "setMoney": sim.money = c.amount; break;
    case "build": {
      const r = sim.build(c.kind, c.floor, c.x);
      expectOk(r.ok, c.expectFail, `build ${c.kind} @ ${c.floor},${c.x}`, r.reason);
      break;
    }
    case "buildRow":
      for (let x = c.from; x <= c.to; x++) {
        const r = sim.build(c.kind, c.floor, x);
        expectOk(r.ok, false, `build ${c.kind} @ ${c.floor},${x}`, r.reason);
      }
      break;
    case "buildTransport": {
      const r = sim.buildTransport(c.kind, c.x, c.bottom, c.top);
      expectOk(r.ok, c.expectFail, `buildTransport ${c.kind} @ x${c.x} ${c.bottom}-${c.top}`, r.reason);
      break;
    }
    case "sell": {
      // An optional kind pins what the tile holds, so a scenario that says it
      // sells a housekeeping crew cannot quietly sell whatever sits there.
      if (c.kind !== undefined) {
        const here = sim.tower.unitAt(c.floor, c.x)?.kind ?? sim.tower.transportAt(c.floor, c.x)?.kind;
        if (here !== c.kind) throw new Error(`sell @ ${c.floor},${c.x}: expected ${c.kind}, found ${here ?? "nothing"}`);
      }
      expectOk(sim.sellAt(c.floor, c.x), false, `sell @ ${c.floor},${c.x}`);
      break;
    }
    case "adjustRent": {
      const u = unitAt(sim, c);
      const before = rentOf(u);
      expectOk(sim.adjustRent(u.id, c.dir) !== null && rentOf(u) !== before, false, `adjustRent ${c.dir} @ ${c.floor},${c.x}`, "rent did not move");
      break;
    }
    case "setNoRate": expectOk(sim.setNoRate(unitAt(sim, c).id), false, `setNoRate @ ${c.floor},${c.x}`); break;
    case "setCars": {
      const t = sim.tower.transportAt(c.floor, c.x);
      if (!t) throw new Error(`no transport at floor ${c.floor}, x ${c.x}`);
      expectOk(sim.tower.setCars(t.id, c.cars) && t.cars === c.cars, false, `setCars ${c.cars} @ ${c.floor},${c.x}`);
      break;
    }
    case "startFire": {
      const before = sim.fires;
      sim.startFire();
      expectOk(sim.fires > before, false, "startFire", "nothing caught fire");
      break;
    }
    case "bombThreat": sim.bombThreat(); break;
    case "evaluateStar": sim.evaluateStar(); break;
    case "setSchedule": {
      const t = sim.tower.transportAt(c.floor, c.x);
      if (!t) throw new Error(`no transport at floor ${c.floor}, x ${c.x}`);
      expectOk(sim.tower.setSchedule(t.id, c.schedule), false, `setSchedule @ ${c.floor},${c.x}`, "not an elevator");
      break;
    }
    case "callExterminator": {
      const r = sim.callExterminator();
      expectOk(r.ok, c.expectFail, "callExterminator", r.ok ? undefined : r.reason);
      break;
    }
    case "reload": {
      // A save round trip must lose nothing the save carries.
      const before = digest(stateView(sim));
      const loaded = Simulation.deserialize(JSON.parse(JSON.stringify(sim.serialize())) as SerializedGame);
      if (digest(stateView(loaded)) !== before) throw new Error("reload changed the saved state");
      return loaded;
    }
    case "tick":
      for (let i = 1; i <= (c.times ?? 1); i++) {
        sim.tick(c.dt);
        clock.minutes += c.dt;
        if (c.checkpointEvery && i % c.checkpointEvery === 0) emit(`t+${clock.minutes}`);
      }
      break;
    case "checkpoint": emit(c.label); break;
    default: throw new Error(`unknown op ${(c as { op: string }).op}`);
  }
  return sim;
}

/** Run a scenario from its start, returning every checkpoint in order: `start`
 *  before the first command, the ones the commands take, and `final` after the
 *  last command, so nothing a scenario runs goes unchecked. */
export function runScenario(s: Scenario): Checkpoint[] {
  let sim = startSim(s.start);
  const out: Checkpoint[] = [];
  const clock = { minutes: 0 };
  const labels = new Set<string>();
  const emit = (label: string) => {
    if (labels.has(label)) throw new Error(`${s.id}: checkpoint label ${label} is taken twice`);
    labels.add(label);
    out.push({ label, state: digest(stateView(sim)), crowd: digest(crowdView(sim)) });
  };
  emit("start");
  for (const c of s.commands) sim = apply(sim, c, emit, clock);
  emit("final");
  return out;
}
