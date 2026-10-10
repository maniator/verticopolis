import { readFileSync } from "node:fs";
import { applyCharge, chargeOf, type ChargeOutcome } from "./chargeOps";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Simulation } from "../../engine/Simulation";
import type { FacilityKind, GameMode } from "../../engine/types";
import { FACILITIES } from "../../engine/facilitiesData";
import type { SerializedGame } from "../../engine/serializedGame";
import { decodeVctower } from "../../storage/vctowerContainer";
import { markFounderFromLoadedFile } from "../../engine/sim/founderStatus";
import { rentOf } from "../../engine/econConfig";
import { serializeUnit } from "../../engine/sim/coerce";
import { digest } from "./canonical";
import { crowdView, stateView } from "../../engine/conformanceView";

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
  | ({ op: "addCar"; reason?: string } & At)
  | ({ op: "removeCar"; reason?: string } & At)
  | ({ op: "extendTransport"; end: "up" | "down"; targetFloor: number; hwmBottom?: number; hwmTop?: number; reason?: string } & At)
  | ({ op: "removeFacility"; method: "sell" | "bulldoze"; shaft?: boolean; reason?: string } & At)
  | { op: "startFire" }
  | { op: "bombThreat" }
  | { op: "evaluateStar" }
  | { op: "callExterminator"; expectFail?: boolean }
  | { op: "resolveChoice"; accept: boolean; kind?: "fireRescue" | "bombThreat" }
  | ({ op: "setSchedule"; schedule: Record<string, unknown> } & At)
  | { op: "toggleAutoBridge" }
  | ({ op: "setFilmPolicy"; policy: "auto" | "feature" | "blockbuster" } & At)
  | ({ op: "rerollSubtype" } & At)
  | { op: "applyRentBatch"; kind: FacilityKind; target: number | "default" | "noRate"; onlyDefaultPriced?: boolean }
  | ({ op: "resizeTransport"; bottom: number; top: number; expectFail?: boolean } & At)
  | ({ op: "clearStops" } & At)
  | ({ op: "setStop"; stopFloor: number; stop: boolean } & At)
  | ({ op: "priceUnit"; target: number } & At)
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
 *  "obj" a JSON object, "kind" any facility kind, "choice" fireRescue or
 *  bombThreat, "policy" a film policy, "target" a batch rent target (a finite
 *  number, default or noRate), "end" up or down, "method" sell or bulldoze.
 *  A trailing "?" marks the field optional. */
type FieldType = "int" | "u32" | "count" | "dir" | "num" | "str" | "bool" | "place" | "shaft" | "mode" | "obj" | "kind" | "choice" | "policy" | "target" | "end" | "method";
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
  addCar: { ...AT, reason: "str?" },
  removeCar: { ...AT, reason: "str?" },
  extendTransport: { ...AT, end: "end", targetFloor: "int", hwmBottom: "int?", hwmTop: "int?", reason: "str?" },
  removeFacility: { ...AT, method: "method", shaft: "bool?", reason: "str?" },
  startFire: {},
  bombThreat: {},
  evaluateStar: {},
  callExterminator: { expectFail: "bool?" },
  resolveChoice: { accept: "bool", kind: "choice?" },
  setSchedule: { ...AT, schedule: "obj" },
  toggleAutoBridge: {},
  setFilmPolicy: { ...AT, policy: "policy" },
  rerollSubtype: AT,
  applyRentBatch: { kind: "place", target: "target", onlyDefaultPriced: "bool?" },
  resizeTransport: { ...AT, bottom: "int", top: "int", expectFail: "bool?" },
  clearStops: AT,
  setStop: { ...AT, stopFloor: "int", stop: "bool" },
  priceUnit: { ...AT, target: "num" },
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
    case "choice": return v === "fireRescue" || v === "bombThreat";
    case "policy": return v === "auto" || v === "feature" || v === "blockbuster";
    case "target": return v === "default" || v === "noRate" || (typeof v === "number" && Number.isFinite(v));
    case "end": return v === "up" || v === "down";
    case "method": return v === "sell" || v === "bulldoze";
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
    if (c.op === "extendTransport" && (c.hwmBottom === undefined) !== (c.hwmTop === undefined)) throw new Error(`${where}: hwmBottom and hwmTop go together`);
  });
  return s;
}

/** The outcome of a command an engine may refuse: `ok`, and the refusal
 *  reason when it did. */
export interface Outcome { ok: boolean; reason?: string }

/** What a scenario drives: one engine behind the small command surface the
 *  ops use. The TypeScript engine implements it directly (`tsEngine`); a port
 *  implements it through its binding, and the runner cannot tell them apart.
 *  Ids and tile queries read the engine as it stands, so a method that moves
 *  something (`adjustRent`, `setCars`) is checked by asking again. */
export interface ScenarioEngine {
  mode(): string;
  money(): number;
  setMoney(amount: number): void;
  build(kind: FacilityKind, floor: number, x: number): Outcome;
  buildTransport(kind: FacilityKind, x: number, bottom: number, top: number): Outcome;
  sellAt(floor: number, x: number): boolean;
  /** The unit covering a tile, with the rent it charges right now. */
  unitAt(floor: number, x: number): { id: number; kind: string; rent: number } | null;
  /** The shaft covering a tile, with its car count. */
  transportAt(floor: number, x: number): { id: number; kind: string; cars: number } | null;
  adjustRent(id: number, dir: 1 | -1): number | null;
  setNoRate(id: number): boolean;
  setCars(id: number, cars: number): boolean;
  /** The engine-owned charges (#914); each moves the money itself. */
  addCar(id: number): ChargeOutcome;
  removeCar(id: number): ChargeOutcome;
  extendTransport(id: number, end: "up" | "down", targetFloor: number, hwm: { bottom: number; top: number } | null): ChargeOutcome;
  removeFacility(id: number, method: "sell" | "bulldoze"): ChargeOutcome;
  setSchedule(id: number, schedule: Record<string, unknown>): boolean;
  startFire(): void;
  fires(): number;
  bombThreat(): void;
  evaluateStar(): void;
  callExterminator(): Outcome;
  autoBridge(): boolean;
  /** The bridging preference after the flip (Classic never flips). */
  toggleAutoBridge(): boolean;
  resizeTransport(id: number, bottom: number, top: number): Outcome;
  clearStops(id: number): boolean;
  setStop(id: number, floor: number, stop: boolean): boolean;
  priceUnit(id: number, target: number): number | null;
  setFilmPolicy(id: number, policy: "auto" | "feature" | "blockbuster"): string | null;
  rerollSubtype(id: number): string | null;
  /** The batch's `matched` count, or null when the batch does not apply. */
  applyRentBatch(kind: FacilityKind, target: number | "default" | "noRate", onlyDefaultPriced: boolean): number | null;
  pendingChoice(): { kind: string; cost: number } | null;
  resolveChoice(accept: boolean): void;
  tick(dt: number): void;
  /** A save round trip: serialize, then load the result as a fresh engine. */
  reload(): ScenarioEngine;
  stateDigest(): string;
  crowdDigest(): string;
  /** Release the engine, for a binding that owns memory; the runner calls it
   *  when the run ends, whether it finished or threw. */
  free?(): void;
}

/** How a runner starts an engine from a scenario's `start`. */
export type EngineStart = (start: Start) => ScenarioEngine;

/** The TypeScript engine behind the scenario surface. */
export function tsEngine(sim: Simulation): ScenarioEngine {
  return {
    mode: () => sim.mode,
    money: () => sim.money,
    setMoney: (amount) => { sim.money = amount; },
    build: (kind, floor, x) => sim.build(kind, floor, x),
    buildTransport: (kind, x, bottom, top) => sim.buildTransport(kind, x, bottom, top),
    sellAt: (floor, x) => sim.sellAt(floor, x),
    unitAt: (floor, x) => {
      const u = sim.tower.unitAt(floor, x);
      // The rent is read off the unit as a save carries it, the same shape a
      // port's binding hands back, so both engines measure one quantity.
      return u ? { id: u.id, kind: u.kind, rent: rentOf(serializeUnit(u)) } : null;
    },
    transportAt: (floor, x) => {
      const t = sim.tower.transportAt(floor, x);
      return t ? { id: t.id, kind: t.kind, cars: t.cars } : null;
    },
    adjustRent: (id, dir) => sim.adjustRent(id, dir),
    setNoRate: (id) => sim.setNoRate(id),
    setCars: (id, cars) => sim.tower.setCars(id, cars),
    addCar: (id) => chargeOf(sim.addCar(id)),
    removeCar: (id) => chargeOf(sim.removeCar(id)),
    extendTransport: (id, end, targetFloor, hwm) => chargeOf(sim.extendTransport(id, end, targetFloor, hwm ?? undefined)),
    removeFacility: (id, method) => chargeOf(sim.removeFacility(id, method)),
    setSchedule: (id, schedule) => sim.tower.setSchedule(id, schedule),
    startFire: () => sim.startFire(),
    fires: () => sim.fires,
    bombThreat: () => sim.bombThreat(),
    evaluateStar: () => sim.evaluateStar(),
    callExterminator: () => {
      const r = sim.callExterminator();
      return r.ok ? { ok: true } : { ok: false, reason: r.reason };
    },
    autoBridge: () => sim.autoBridge,
    toggleAutoBridge: () => sim.toggleAutoBridge(),
    resizeTransport: (id, bottom, top) => {
      const r = sim.tower.resizeTransport(id, bottom, top);
      return r.ok ? { ok: true } : { ok: false, reason: r.reason };
    },
    clearStops: (id) => sim.tower.clearStops(id),
    setStop: (id, floor, stop) => sim.tower.setStop(id, floor, stop),
    priceUnit: (id, target) => {
      const u = sim.tower.getUnit(id);
      return u ? sim.priceUnit(u, target) : null;
    },
    setFilmPolicy: (id, policy) => sim.setFilmPolicy(id, policy),
    rerollSubtype: (id) => sim.rerollSubtype(id) ?? null,
    applyRentBatch: (kind, target, onlyDefaultPriced) => sim.applyRentBatch(kind, target, { onlyDefaultPriced })?.matched ?? null,
    pendingChoice: () => sim.pendingChoice,
    resolveChoice: (accept) => sim.resolveChoice(accept ? "accept" : "decline"),
    tick: (dt) => sim.tick(dt),
    reload: () => tsEngine(Simulation.deserialize(JSON.parse(JSON.stringify(sim.serialize())) as SerializedGame)),
    stateDigest: () => digest(stateView(sim)),
    crowdDigest: () => digest(crowdView(sim)),
  };
}

/** Start the TypeScript engine from a scenario's `start`. */
export const startTsEngine: EngineStart = (start) => {
  if ("newGame" in start) {
    const sim = Simulation.newGame(start.newGame.seed, start.newGame.mode);
    if (sim.mode !== start.newGame.mode) throw new Error(`new game founded as ${sim.mode}, not ${start.newGame.mode}`);
    return tsEngine(sim);
  }
  const raw = decodeVctower(readFileSync(resolve(REPO_ROOT, start.fixture), "utf8"), start.fixture) as SerializedGame;
  if (start.mode) raw.mode = start.mode;
  // The import path's steps after decoding (SaveGame.import).
  const sim = Simulation.deserialize(raw);
  markFounderFromLoadedFile(sim, raw);
  if (start.mode && sim.mode !== start.mode) throw new Error(`${start.fixture} loaded as ${sim.mode}, not ${start.mode}`);
  return tsEngine(sim);
};

export { crowdView, stateView };

function unitAt(e: ScenarioEngine, at: At) {
  const u = e.unitAt(at.floor, at.x);
  if (!u) throw new Error(`no unit at floor ${at.floor}, x ${at.x}`);
  return u;
}

function transportAt(e: ScenarioEngine, at: At) {
  const t = e.transportAt(at.floor, at.x);
  if (!t) throw new Error(`no transport at floor ${at.floor}, x ${at.x}`);
  return t;
}

function expectOk(ok: boolean, expectFail: boolean | undefined, what: string, reason?: string): void {
  if (ok === !expectFail) return;
  throw new Error(`${what} ${ok ? "succeeded but was expected to fail" : `failed: ${reason ?? "no reason"}`}`);
}

function apply(e: ScenarioEngine, c: Command, emit: (label: string) => void, clock: { minutes: number }): ScenarioEngine {
  switch (c.op) {
    case "setMoney": e.setMoney(c.amount); break;
    case "build": {
      const r = e.build(c.kind, c.floor, c.x);
      expectOk(r.ok, c.expectFail, `build ${c.kind} @ ${c.floor},${c.x}`, r.reason);
      break;
    }
    case "buildRow":
      for (let x = c.from; x <= c.to; x++) {
        const r = e.build(c.kind, c.floor, x);
        expectOk(r.ok, false, `build ${c.kind} @ ${c.floor},${x}`, r.reason);
      }
      break;
    case "buildTransport": {
      const r = e.buildTransport(c.kind, c.x, c.bottom, c.top);
      expectOk(r.ok, c.expectFail, `buildTransport ${c.kind} @ x${c.x} ${c.bottom}-${c.top}`, r.reason);
      break;
    }
    case "sell": {
      // An optional kind pins what the tile holds, so a scenario that says it
      // sells a housekeeping crew cannot quietly sell whatever sits there.
      if (c.kind !== undefined) {
        const here = e.unitAt(c.floor, c.x)?.kind ?? e.transportAt(c.floor, c.x)?.kind;
        if (here !== c.kind) throw new Error(`sell @ ${c.floor},${c.x}: expected ${c.kind}, found ${here ?? "nothing"}`);
      }
      expectOk(e.sellAt(c.floor, c.x), false, `sell @ ${c.floor},${c.x}`);
      break;
    }
    case "adjustRent": {
      const u = unitAt(e, c);
      const moved = e.adjustRent(u.id, c.dir) !== null && unitAt(e, c).rent !== u.rent;
      expectOk(moved, false, `adjustRent ${c.dir} @ ${c.floor},${c.x}`, "rent did not move");
      break;
    }
    case "setNoRate": expectOk(e.setNoRate(unitAt(e, c).id), false, `setNoRate @ ${c.floor},${c.x}`); break;
    case "setCars": {
      const t = transportAt(e, c);
      expectOk(e.setCars(t.id, c.cars) && transportAt(e, c).cars === c.cars, false, `setCars ${c.cars} @ ${c.floor},${c.x}`);
      break;
    }
    case "addCar": case "removeCar": case "extendTransport": case "removeFacility": applyCharge(e, c); break;
    case "startFire": {
      const before = e.fires();
      e.startFire();
      expectOk(e.fires() > before, false, "startFire", "nothing caught fire");
      break;
    }
    case "bombThreat": e.bombThreat(); break;
    case "evaluateStar": e.evaluateStar(); break;
    case "toggleAutoBridge": {
      // The toggle is a Modern control; a Classic scenario that asks for it
      // is wrong, and the flip must be visible.
      const before = e.autoBridge();
      expectOk(e.toggleAutoBridge() !== before, false, "toggleAutoBridge", "bridging is not toggleable in this mode");
      break;
    }
    case "resizeTransport": {
      const r = e.resizeTransport(transportAt(e, c).id, c.bottom, c.top);
      expectOk(r.ok, c.expectFail, `resizeTransport @ ${c.floor},${c.x} to ${c.bottom}-${c.top}`, r.reason);
      break;
    }
    case "clearStops": expectOk(e.clearStops(transportAt(e, c).id), false, `clearStops @ ${c.floor},${c.x}`); break;
    case "setStop":
      expectOk(e.setStop(transportAt(e, c).id, c.stopFloor, c.stop), false, `setStop ${c.stopFloor} ${c.stop} @ ${c.floor},${c.x}`, "outside the span, or an express stop off a lobby");
      break;
    case "priceUnit":
      expectOk(e.priceUnit(unitAt(e, c).id, c.target) !== null, false, `priceUnit ${c.target} @ ${c.floor},${c.x}`, "not repriceable");
      break;
    case "setFilmPolicy":
      expectOk(e.setFilmPolicy(unitAt(e, c).id, c.policy) !== null, false, `setFilmPolicy ${c.policy} @ ${c.floor},${c.x}`, "not a cinema");
      break;
    case "rerollSubtype":
      expectOk(e.rerollSubtype(unitAt(e, c).id) !== null, false, `rerollSubtype @ ${c.floor},${c.x}`, "no subtype to draw");
      break;
    case "applyRentBatch": {
      // A batch that matched nothing changes nothing, so the scenario must
      // point at units that exist.
      const matched = e.applyRentBatch(c.kind, c.target, c.onlyDefaultPriced ?? false);
      expectOk(matched !== null && matched > 0, false, `applyRentBatch ${c.kind}`, matched === null ? "not a priced kind or target" : "no unit of that kind");
      break;
    }
    case "setSchedule":
      expectOk(e.setSchedule(transportAt(e, c).id, c.schedule), false, `setSchedule @ ${c.floor},${c.x}`, "not an elevator");
      break;
    case "callExterminator": {
      const r = e.callExterminator();
      expectOk(r.ok, c.expectFail, "callExterminator", r.reason);
      break;
    }
    case "resolveChoice": {
      // The answer must land on a real pending choice (a fire rescue offer or
      // a bomb ransom), so a scenario cannot claim a decision the engine
      // never asked for.
      const p = e.pendingChoice();
      if (!p) throw new Error("resolveChoice: no pending choice");
      if (c.kind !== undefined && p.kind !== c.kind) throw new Error(`resolveChoice: expected ${c.kind}, found ${p.kind}`);
      // An accept the tower cannot afford is a decline in the engine; the
      // scenario must mean what it says, so it is an error here.
      if (c.accept && e.money() < p.cost) throw new Error(`resolveChoice: cannot pay ${p.cost}`);
      e.resolveChoice(c.accept);
      break;
    }
    case "reload": {
      // A save round trip must lose nothing the save carries.
      const before = e.stateDigest();
      const loaded = e.reload();
      if (loaded.stateDigest() !== before) {
        loaded.free?.();
        throw new Error("reload changed the saved state");
      }
      return loaded;
    }
    case "tick":
      for (let i = 1; i <= (c.times ?? 1); i++) {
        e.tick(c.dt);
        clock.minutes += c.dt;
        if (c.checkpointEvery && i % c.checkpointEvery === 0) emit(`t+${clock.minutes}`);
      }
      break;
    case "checkpoint": emit(c.label); break;
    default: throw new Error(`unknown op ${(c as { op: string }).op}`);
  }
  return e;
}

/** The first checkpoint where a run departs from its lock entry (index, both
 *  sides), or null when they agree to the end. The useful fact for a port. */
export function firstDivergence(got: Checkpoint[], want: Checkpoint[]): { checkpoint: number; got: Checkpoint | null; want: Checkpoint | null } | null {
  const same = (a: Checkpoint | undefined, b: Checkpoint | undefined) =>
    !!a && !!b && a.label === b.label && a.state === b.state && a.crowd === b.crowd;
  for (let i = 0; i < Math.max(got.length, want.length); i++) {
    if (!same(got[i], want[i])) return { checkpoint: i, got: got[i] ?? null, want: want[i] ?? null };
  }
  return null;
}

/** Run a scenario from its start, returning every checkpoint in order: `start`
 *  before the first command, the ones the commands take, and `final` after the
 *  last command, so nothing a scenario runs goes unchecked. The engine defaults
 *  to the TypeScript one; a port passes its own `start`. */
export function runScenario(s: Scenario, start: EngineStart = startTsEngine): Checkpoint[] {
  let e = start(s.start);
  const out: Checkpoint[] = [];
  const clock = { minutes: 0 };
  const labels = new Set<string>();
  const emit = (label: string) => {
    if (labels.has(label)) throw new Error(`${s.id}: checkpoint label ${label} is taken twice`);
    labels.add(label);
    out.push({ label, state: e.stateDigest(), crowd: e.crowdDigest() });
  };
  try {
    emit("start");
    for (const c of s.commands) e = apply(e, c, emit, clock);
    emit("final");
  } finally {
    e.free?.();
  }
  return out;
}
