import type { GameplayEvent } from "../engine/gameplayEventBuffer";
import type { Simulation } from "../engine/Simulation";
import { settleEngine, stepGate } from "../wasmhost/stepGate";
import type { Command, CommandOp, CommandResult, CommandResults } from "./commands";
import type { SimPort } from "./port";
import { queryKey, type Query, type QueryOp, type QueryResult, type QueryResults } from "./queries";
import type { HeaderView, SimView } from "./view";

/**
 * The port over today's TypeScript `Simulation` (spine AD-9). It stays as
 * the TypeScript arm's adapter and the fallback's until the TypeScript
 * engine retires.
 *
 * `getSim` is read on every call, so a tower swap (`adoptSim`) is seen
 * without rebuilding the port, and the answers `cached` returns are stored
 * per tower, so a new tower starts with none. The view hands out the live
 * tower and crowd, so a read copies nothing; the header is one small object
 * per read whose `population`, the one field that walks the rooms, is
 * computed only when read.
 *
 * Every command goes through a method or a field of the instance itself, the
 * ones the mirror host's relay (`relayCommands` in `src/dualrun/mirror.ts`)
 * wraps or watches, so the relay sees a port command exactly as it sees a
 * direct call and forwards it to the Rust engine. Commands run
 * synchronously: the effect is on the view before the promise settles, and
 * issue order is execution order. A throw from the instance rejects the
 * promise with that error.
 *
 * Engine types come in through `import type` only, so this module adds no
 * runtime edge into `src/engine/`.
 */
export function createTsSim(getSim: () => Simulation): SimPort {
  // Kept per tower, so a swap starts with none and a replaced tower is not
  // held alive by its answers.
  const answers = new WeakMap<Simulation, Answers>();
  const answersFor = (sim: Simulation): Answers => {
    let mine = answers.get(sim);
    if (!mine) answers.set(sim, (mine = createAnswers()));
    return mine;
  };
  const view: SimView = {
    get header() {
      return readHeader(getSim());
    },
    get tower() {
      return getSim().tower;
    },
    get crowd() {
      return getSim().crowd;
    },
  };
  return {
    view,
    tick(dtMinutes) {
      getSim().tick(dtMinutes);
    },
    command<C extends Command>(c: C): Promise<CommandResult<C>> {
      try {
        const sim = getSim();
        const before = sim.money;
        // The table is checked op by op; this cast only tells the compiler
        // that `c.op` picks the handler for `C`.
        const run = COMMANDS[c.op] as unknown as (sim: Simulation, c: C) => Answer<C["op"]>;
        const result = run(sim, c);
        return Promise.resolve({ ...result, delta: sim.money - before } as CommandResult<C>);
      } catch (e) {
        return Promise.reject(e);
      }
    },
    query<Q extends Query>(q: Q): Promise<QueryResult<Q>> {
      try {
        const sim = getSim();
        const ask = QUERIES[q.op] as unknown as (sim: Simulation, q: Q) => QueryResult<Q>;
        const answer = ask(sim, q);
        answersFor(sim).put(q, answer);
        return Promise.resolve(answer);
      } catch (e) {
        return Promise.reject(e);
      }
    },
    cached<Q extends Query>(q: Q): QueryResult<Q> | undefined {
      return answersFor(getSim()).get(q);
    },
    save() {
      try {
        const sim = getSim();
        // A host that steps in the background (the experimental worker and
        // coalesced hosts) registers a step gate; without one the save is
        // taken now, so it holds exactly what was issued before it.
        if (!stepGate(sim)) return Promise.resolve(JSON.stringify(sim.serialize()));
        return settledSave(getSim);
      } catch (e) {
        return Promise.reject(e);
      }
    },
    drainEvents(opts?: { release?: boolean }): GameplayEvent[] {
      // The WASM host's drain takes `release`; the instance's own ignores it.
      const source: EventSource = getSim();
      return opts?.release ? source.drainGameplayEvents({ release: true }) : source.drainGameplayEvents();
    },
  };
}

/** The drain as the analytics bridge calls it (`analyticsEngineBridge.ts`):
 *  the instance's method, which the WASM host replaces with one that takes
 *  `release`. */
interface EventSource {
  drainGameplayEvents(opts?: { release?: boolean }): GameplayEvent[];
}

/** The save of a host that steps in the background, once it has caught up
 *  (as `saveLoad.ts`'s autosave waits). A tower adopted during the wait is
 *  not the one asked for, so the wait starts again on the tower held now. */
async function settledSave(getSim: () => Simulation): Promise<string> {
  for (;;) {
    const sim = getSim();
    await settleEngine(sim);
    if (getSim() === sim) return JSON.stringify(sim.serialize());
  }
}

/** The header as one object: the scalars copied, `population` computed on
 *  its first read and kept for the object's life (it walks every room). */
function readHeader(sim: Simulation): HeaderView {
  let population: number | undefined;
  return {
    money: sim.money,
    star: sim.star,
    get population() {
      return (population ??= sim.population);
    },
    weather: sim.weather,
    logSeq: sim.logSeq,
    pendingChoice: sim.pendingChoice,
    minutes: sim.clock.minutes,
    minuteOfDay: sim.clock.minuteOfDay,
    revision: sim.tower.revision,
    mealOverlayRevision: sim.tower.mealOverlayRevision,
  };
}

/** A command's answer before the port adds `delta`, the balance's change,
 *  which it measures the same way for every command. */
type Answer<K extends CommandOp> = Omit<CommandResults[K], "delta">;
type Handler<K extends CommandOp> = (sim: Simulation, c: Extract<Command, { op: K }>) => Answer<K>;

/** One handler per command, typed per op, so each conversion keeps the
 *  fields that command's callers read. */
const COMMANDS: { readonly [K in CommandOp]: Handler<K> } = {
  build: (sim, c) => sim.build(c.kind, c.floor, c.x),
  buildTransport: (sim, c) => sim.buildTransport(c.kind, c.x, c.bottom, c.top),
  removeFacility: (sim, c) => sim.removeFacility(c.id, c.method),
  beginExtend: (sim, c) => ({ ok: sim.beginExtend(c.id) }),
  extendTransport: (sim, c) => sim.extendTransport(c.id, c.end, c.targetFloor),
  // Closing the drag is always allowed, whether or not one was open.
  endExtend: (sim) => {
    sim.endExtend();
    return { ok: true };
  },
  addCar: (sim, c) => sim.addCar(c.id),
  removeCar: (sim, c) => sim.removeCar(c.id),
  setStop: (sim, c) => ({ ok: sim.tower.setStop(c.id, c.floor, c.stop) }),
  setExpressStops: (sim, c) => ({ ok: sim.tower.setExpressStops(c.id) }),
  clearStops: (sim, c) => ({ ok: sim.tower.clearStops(c.id) }),
  setSchedule: (sim, c) => ({ ok: sim.tower.setSchedule(c.id, c.schedule) }),
  setLabel: (sim, c) => ({ ok: sim.tower.setLabel(c.id, c.label) }),
  adjustRent: (sim, c) => rentAnswer(sim.adjustRent(c.id, c.dir)),
  setNoRate: (sim, c) => ({ ok: sim.setNoRate(c.id) }),
  priceUnit: (sim, c) => {
    // The editor holds the unit; an id that names none is refused.
    const unit = sim.tower.getUnit(c.id);
    return unit ? rentAnswer(sim.priceUnit(unit, c.target)) : { ok: false };
  },
  applyRentBatch: (sim, c) => {
    const batch = c.onlyDefaultPriced === undefined ? sim.applyRentBatch(c.kind, c.target) : sim.applyRentBatch(c.kind, c.target, { onlyDefaultPriced: c.onlyDefaultPriced });
    return batch ? { ok: true, batch } : { ok: false };
  },
  setFilmPolicy: (sim, c) => {
    const policy = sim.setFilmPolicy(c.id, c.policy);
    return policy === null ? { ok: false } : { ok: true, policy };
  },
  rerollSubtype: (sim, c) => {
    const subtype = sim.rerollSubtype(c.id);
    return subtype === undefined ? { ok: false } : { ok: true, subtype };
  },
  callExterminator: (sim) => sim.callExterminator(),
  // Refused when no emergency is waiting (a second click, or the daily roll
  // already took the default).
  resolveChoice: (sim, c) => {
    const waiting = sim.pendingChoice !== null;
    sim.resolveChoice(c.accept ? "accept" : "decline");
    return { ok: waiting };
  },
  // A Classic tower always bridges, so a toggle there changes nothing.
  toggleAutoBridge: (sim) => {
    const before = sim.autoBridge;
    const value = sim.toggleAutoBridge();
    return { ok: value !== before, value };
  },
  setAutoBridge: (sim, c) => {
    if (c.value !== sim.autoBridge && !sim.rules.bridgingToggleable()) return { ok: false, value: sim.autoBridge };
    sim.autoBridge = c.value;
    return { ok: true, value: sim.autoBridge };
  },
  setTowerName: (sim, c) => {
    sim.tower.towerName = c.name;
    return { ok: true };
  },
  setView: (sim, c) => {
    sim.view = c.view;
    return { ok: true };
  },
  emit: (sim, c) => {
    sim.emit(c.text, c.kind);
    return { ok: true };
  },
};

function rentAnswer(rent: number | null): Answer<"adjustRent"> {
  return rent === null ? { ok: false } : { ok: true, rent };
}

type Asker<K extends QueryOp> = (sim: Simulation, q: Extract<Query, { op: K }>) => QueryResults[K];

const QUERIES: { readonly [K in QueryOp]: Asker<K> } = {
  canBuild: (sim, q) => sim.canBuild(q.kind, q.floor, q.x),
  isUnlocked: (sim, q) => sim.isUnlocked(q.kind),
};

/** How many answers each query keeps for `cached`. A placement answer is per
 *  cell, so the build preview can ask for thousands; the oldest goes first.
 *  An unlock answer is per facility kind, a set the catalog bounds. */
const CACHE_CAPS: { readonly [K in QueryOp]: number } = { canBuild: 256, isUnlocked: Infinity };

interface Answers {
  put<Q extends Query>(q: Q, answer: QueryResult<Q>): void;
  get<Q extends Query>(q: Q): QueryResult<Q> | undefined;
}

/** The last answer to each query, one map per op, least recently used first. */
function createAnswers(): Answers {
  const maps = new Map<QueryOp, Map<string, unknown>>();
  const mapFor = (op: QueryOp): Map<string, unknown> => {
    let map = maps.get(op);
    if (!map) maps.set(op, (map = new Map()));
    return map;
  };
  return {
    put(q, answer) {
      const map = mapFor(q.op);
      const key = queryKey(q);
      map.delete(key);
      map.set(key, answer);
      if (map.size > CACHE_CAPS[q.op]) map.delete(map.keys().next().value as string);
    },
    get<Q extends Query>(q: Q) {
      const map = maps.get(q.op);
      const key = queryKey(q);
      if (!map?.has(key)) return undefined;
      // A read counts as use, so a key the preview keeps reading stays.
      const answer = map.get(key) as QueryResult<Q>;
      map.delete(key);
      map.set(key, answer);
      return answer;
    },
  };
}
