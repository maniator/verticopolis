import type { Simulation } from "../engine/Simulation";
import type { Command, CommandResult, CommandResults } from "./commands";
import type { SimPort } from "./port";
import { queryKey, type Query, type QueryResult, type QueryResults } from "./queries";
import type { HeaderView, SimView } from "./view";

/** How many distinct query answers `cached` keeps; the oldest goes first. */
const CACHE_CAP = 256;

/**
 * The port over today's TypeScript `Simulation` (spine AD-9). It stays as
 * the TypeScript arm's adapter and the fallback's until the TypeScript
 * engine retires.
 *
 * `getSim` is read on every call, so a tower swap (`adoptSim`) is seen
 * without rebuilding the port. The view hands out the live tower and crowd,
 * so a read copies nothing; the header is one small object per read.
 *
 * Every command runs through the instance's own method or field, never an
 * inner engine module, so the mirror host's relay (`relayCommands` in
 * `src/dualrun/mirror.ts`) sees it exactly as it sees a direct call and
 * forwards it to the Rust engine. Commands run synchronously: the effect is
 * on the view before the promise settles, and issue order is execution
 * order. A throw from the instance rejects the promise with that error.
 *
 * Engine types come in through `import type` only, so this module adds no
 * runtime edge into `src/engine/`.
 */
export function createTsSim(getSim: () => Simulation): SimPort {
  const answers = new Map<string, unknown>();
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
        return Promise.resolve(runCommand(getSim(), c) as CommandResult<C>);
      } catch (e) {
        return Promise.reject(e);
      }
    },
    query<Q extends Query>(q: Q): Promise<QueryResult<Q>> {
      try {
        const answer = runQuery(getSim(), q);
        const key = queryKey(q);
        answers.delete(key);
        answers.set(key, answer);
        if (answers.size > CACHE_CAP) answers.delete(answers.keys().next().value as string);
        return Promise.resolve(answer as QueryResult<Q>);
      } catch (e) {
        return Promise.reject(e);
      }
    },
    cached<Q extends Query>(q: Q): QueryResult<Q> | undefined {
      return answers.get(queryKey(q)) as QueryResult<Q> | undefined;
    },
    save() {
      try {
        return Promise.resolve(JSON.stringify(getSim().serialize()));
      } catch (e) {
        return Promise.reject(e);
      }
    },
    drainEvents() {
      return getSim().drainGameplayEvents();
    },
  };
}

function readHeader(sim: Simulation): HeaderView {
  return {
    money: sim.money,
    star: sim.star,
    population: sim.population,
    weather: sim.weather,
    logSeq: sim.logSeq,
    pendingChoice: sim.pendingChoice,
    minutes: sim.clock.minutes,
    minuteOfDay: sim.clock.minuteOfDay,
    revision: sim.tower.revision,
    mealOverlayRevision: sim.tower.mealOverlayRevision,
  };
}

type AnyResult = CommandResults[keyof CommandResults];

/** Run one command on the instance and convert its return value, keeping
 *  every field a caller reads today. */
function runCommand(sim: Simulation, c: Command): AnyResult {
  const tower = sim.tower;
  switch (c.op) {
    case "build":
      return sim.build(c.kind, c.floor, c.x);
    case "buildTransport":
      return sim.buildTransport(c.kind, c.x, c.bottom, c.top);
    case "removeFacility":
      return sim.removeFacility(c.id, c.method);
    case "beginExtend":
      return { ok: sim.beginExtend(c.id) };
    case "extendTransport":
      return sim.extendTransport(c.id, c.end, c.targetFloor);
    case "endExtend":
      sim.endExtend();
      return { ok: true };
    case "addCar":
      return sim.addCar(c.id);
    case "removeCar":
      return sim.removeCar(c.id);
    case "setStop":
      return { ok: tower.setStop(c.id, c.floor, c.stop) };
    case "setExpressStops":
      return { ok: tower.setExpressStops(c.id) };
    case "clearStops":
      return { ok: tower.clearStops(c.id) };
    case "setSchedule":
      return { ok: tower.setSchedule(c.id, c.schedule) };
    case "setLabel":
      return { ok: tower.setLabel(c.id, c.label) };
    case "adjustRent":
      return rentResult(sim.adjustRent(c.id, c.dir));
    case "setNoRate":
      return { ok: sim.setNoRate(c.id) };
    case "priceUnit": {
      // The editor holds the unit; an id that names none is refused.
      const unit = tower.getUnit(c.id);
      return unit ? rentResult(sim.priceUnit(unit, c.target)) : { ok: false };
    }
    case "applyRentBatch": {
      const batch = sim.applyRentBatch(c.kind, c.target, { onlyDefaultPriced: c.onlyDefaultPriced ?? false });
      return batch ? { ok: true, batch } : { ok: false };
    }
    case "setFilmPolicy": {
      const policy = sim.setFilmPolicy(c.id, c.policy);
      return policy ? { ok: true, policy } : { ok: false };
    }
    case "rerollSubtype": {
      const subtype = sim.rerollSubtype(c.id);
      return subtype === undefined ? { ok: false } : { ok: true, subtype };
    }
    case "callExterminator":
      return sim.callExterminator();
    case "resolveChoice":
      sim.resolveChoice(c.accept ? "accept" : "decline");
      return { ok: true };
    case "toggleAutoBridge":
      return { ok: true, value: sim.toggleAutoBridge() };
    case "setAutoBridge":
      sim.autoBridge = c.value;
      return { ok: true, value: sim.autoBridge };
    case "setTowerName":
      tower.towerName = c.name;
      return { ok: true };
    case "setView":
      sim.view = c.view;
      return { ok: true };
    case "emit":
      sim.emit(c.text, c.kind);
      return { ok: true };
    default:
      return unknownCommand(c);
  }
}

function rentResult(rent: number | null): CommandResults["adjustRent"] {
  return rent === null ? { ok: false } : { ok: true, rent };
}

function runQuery(sim: Simulation, q: Query): QueryResults[keyof QueryResults] {
  switch (q.op) {
    case "canBuild":
      return sim.canBuild(q.kind, q.floor, q.x);
    case "isUnlocked":
      return sim.isUnlocked(q.kind);
    default:
      return unknownQuery(q);
  }
}

function unknownCommand(c: never): never {
  throw new Error(`simport: unknown command ${JSON.stringify(c)}`);
}

function unknownQuery(q: never): never {
  throw new Error(`simport: unknown query ${JSON.stringify(q)}`);
}
