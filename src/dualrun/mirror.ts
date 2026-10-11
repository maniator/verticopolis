import type { Simulation } from "../engine/Simulation";
import type { Tower } from "../engine/Tower";
import { canonicalJson } from "../engine/canonicalJson";
import { crowdView, stateView } from "../engine/conformanceView";
import type { ShadowCommand } from "./commands";

/**
 * Record every mutation a live simulation receives from its host as a
 * {@link ShadowCommand}, by wrapping the instance's command methods and the
 * tower's edit methods, and by turning the few fields the host writes
 * directly (`money`, `view`, `autoBridge`, `towerName`) into accessors that
 * report their writes. Only calls from outside the engine are recorded: a
 * method the engine calls on itself while another recorded call runs (a
 * `sellAt` removing a unit, a tick paying rent into `money`) is part of that
 * call, so it is not reported again.
 *
 * After every tick that crosses an hour the mirror emits a checkpoint with
 * the two hashed views of the live engine as canonical JSON, so the shadow
 * compares at the same cadence the conformance suite pins.
 */
export type CommandSink = (cmd: ShadowCommand) => void;

type AnyFn = (...args: never[]) => unknown;

/** The command that starts a shadow for this live tower: its save and its
 *  boundary markers, under the generation given. A save carries no crowd, so
 *  the shadow can only start from a tower whose crowd is still empty (a game
 *  just founded or just loaded); anything later would diverge in the crowd
 *  view at the first hour by construction, so it is refused here. */
export function loadCommand(sim: Simulation, gen: number): Extract<ShadowCommand, { op: "load" }> {
  if (sim.crowd.people.length > 0) throw new Error("mirror: the shadow must start before the tower's crowd exists (right after founding or loading)");
  return {
    op: "load",
    gen,
    save: JSON.stringify(sim.serialize()),
    markers: { lastHour: sim.lastHour, lastDay: sim.lastDay, lastQuarter: sim.lastQuarter, lastMonth: sim.lastMonth },
  };
}

/** What a relay hands back: `detach` puts the instance back the way it was;
 *  `suppress` runs a function with reporting off, for a host that writes the
 *  watched fields itself (a frame sync writing `money`). */
export interface CommandRelay {
  detach(): void;
  suppress<T>(fn: () => T): T;
}

export interface RelayOptions {
  /** Stamps the checkpoints the tick wrapper emits (mirror mode). */
  gen?: number;
  /** Mirror mode: the live tick runs and every hour crossed emits a
   *  checkpoint. Host mode (`tick` given): the live tick never runs; this
   *  runs in its place with the minutes asked for, and no tick or checkpoint
   *  command reaches the sink. */
  tick?: (dtMinutes: number) => void;
}

/** Attach the mirror. `gen` stamps the checkpoints it emits. Throws, leaving
 *  the instance untouched, when a mirror is already attached. */
export function attachMirror(sim: Simulation, sink: CommandSink, gen = 0): () => void {
  return relayCommands(sim, sink, { gen }).detach;
}

/** Wrap the instance so every host mutation reaches `sink` as a command
 *  (see the module doc). Throws, leaving the instance untouched, when a
 *  relay is already attached. */
export function relayCommands(sim: Simulation, sink: CommandSink, opts: RelayOptions = {}): CommandRelay {
  const moneyDesc = Object.getOwnPropertyDescriptor(sim, "money");
  if (moneyDesc && !("value" in moneyDesc)) throw new Error("mirror: a mirror is already attached to this simulation");
  const gen = opts.gen ?? 0;
  let depth = 0;
  const restore: (() => void)[] = [];
  const detach = () => {
    for (const undo of restore.reverse()) undo();
    restore.length = 0;
  };
  let lastHourTicks = sim.hourTicks;

  /** Replace `obj[name]` with a wrapper that runs the original (or
   *  `replace` in its place) and, for a call from outside any other recorded
   *  call, reports it. */
  function wrap<T extends object, K extends keyof T & string>(obj: T, name: K, report: (args: unknown[], result: unknown) => ShadowCommand | null, replace?: (args: unknown[]) => unknown): void {
    const original = obj[name] as unknown as AnyFn;
    if (typeof original !== "function") throw new Error(`mirror: ${name} is not a method`);
    const wrapped = function (this: T, ...args: never[]): unknown {
      const outer = depth === 0;
      depth++;
      let result: unknown;
      try {
        result = replace ? replace(args) : original.apply(this, args);
      } finally {
        depth--;
      }
      if (outer) {
        const cmd = report(args, result);
        if (cmd) sink(cmd);
      }
      return result;
    };
    Object.defineProperty(obj, name, { value: wrapped, configurable: true, writable: true });
    restore.push(() => { delete (obj as Record<string, unknown>)[name]; });
  }

  /** Turn an own data field into an accessor that reports outside writes. */
  function watch<T extends object, K extends keyof T & string>(obj: T, name: K, report: (value: T[K]) => ShadowCommand): void {
    // An optional field the class never assigned has no own property yet;
    // it is still a data field, just an absent one.
    const desc = Object.getOwnPropertyDescriptor(obj, name);
    if (desc && !("value" in desc)) throw new Error(`mirror: ${name} is already an accessor`);
    let value = (desc ? desc.value : undefined) as T[K];
    Object.defineProperty(obj, name, {
      configurable: true,
      enumerable: true,
      get: () => value,
      set: (next: T[K]) => {
        value = next;
        if (depth === 0) sink(report(next));
      },
    });
    restore.push(() => {
      delete (obj as Record<string, unknown>)[name];
      if (desc || value !== undefined) Object.defineProperty(obj, name, { value, configurable: true, enumerable: true, writable: true });
    });
  }

  const tower: Tower = sim.tower;
  const n = (v: unknown) => v as number;
  const s = (v: unknown) => v as string;

  try {
    if (opts.tick) {
      const run = opts.tick;
      wrap(sim, "tick", () => null, ([dt]) => { run(n(dt)); });
    } else {
      wrap(sim, "tick", ([dt]) => {
        sink({ op: "tick", dt: n(dt) });
        if (sim.hourTicks === lastHourTicks) return null;
        lastHourTicks = sim.hourTicks;
        return { op: "checkpoint", gen, label: `day ${sim.clock.day} ${String(sim.clock.hour).padStart(2, "0")}:00`, state: canonicalJson(stateView(sim)), crowd: canonicalJson(crowdView(sim)) };
      });
    }
    wrap(sim, "build", ([kind, floor, x]) => ({ op: "build", kind, floor: n(floor), x: n(x) }) as ShadowCommand);
    wrap(sim, "buildTransport", ([kind, x, bottom, top]) => ({ op: "buildTransport", kind, x: n(x), bottom: n(bottom), top: n(top) }) as ShadowCommand);
    wrap(sim, "sellAt", ([floor, x]) => ({ op: "sellAt", floor: n(floor), x: n(x) }));
    // The engine-owned charges (#914): the command carries the money move, so
    // the shadow charges or refunds for itself and no setMoney follows.
    wrap(sim, "addCar", ([id]) => ({ op: "addCar", id: n(id) }));
    wrap(sim, "removeCar", ([id]) => ({ op: "removeCar", id: n(id) }));
    wrap(sim, "extendTransport", ([id, end, targetFloor, hwm]) => {
      const mark = hwm as { bottom: number; top: number } | undefined;
      return { op: "extendTransport", id: n(id), end: end as "up" | "down", targetFloor: n(targetFloor), hwm: mark ? { bottom: mark.bottom, top: mark.top } : null };
    });
    wrap(sim, "removeFacility", ([id, method]) => ({ op: "removeFacility", id: n(id), method: method as "sell" | "bulldoze" }));
    wrap(sim, "adjustRent", ([id, dir]) => ({ op: "adjustRent", id: n(id), dir: dir as 1 | -1 }));
    wrap(sim, "setNoRate", ([id]) => ({ op: "setNoRate", id: n(id) }));
    wrap(sim, "priceUnit", ([u, target]) => ({ op: "priceUnit", id: (u as { id: number }).id, target: n(target) }));
    wrap(sim, "applyRentBatch", ([kind, target, opts]) => ({ op: "applyRentBatch", kind, target, onlyDefaultPriced: (opts as { onlyDefaultPriced?: boolean } | undefined)?.onlyDefaultPriced ?? false }) as ShadowCommand);
    wrap(sim, "setFilmPolicy", ([id, policy]) => ({ op: "setFilmPolicy", id: n(id), policy }) as ShadowCommand);
    wrap(sim, "rerollSubtype", ([id]) => ({ op: "rerollSubtype", id: n(id) }));
    wrap(sim, "toggleAutoBridge", () => ({ op: "toggleAutoBridge" }));
    wrap(sim, "startFire", () => ({ op: "startFire" }));
    wrap(sim, "bombThreat", () => ({ op: "bombThreat" }));
    wrap(sim, "evaluateStar", () => ({ op: "evaluateStar" }));
    wrap(sim, "callExterminator", () => ({ op: "callExterminator" }));
    wrap(sim, "resolveChoice", ([option]) => ({ op: "resolveChoice", accept: option === "accept" }));
    wrap(sim, "emit", ([text, kind]) => ({ op: "emit", text: s(text), kind: kind === undefined ? "info" : s(kind) }));
    watch(sim, "money", (amount) => ({ op: "setMoney", amount }));
    watch(sim, "view", (view) => ({ op: "setView", view: view ?? null }));
    watch(sim, "autoBridge", (value) => ({ op: "setAutoBridge", value }));

    wrap(tower, "removeUnit", ([id]) => ({ op: "removeUnit", id: n(id) }));
    wrap(tower, "removeTransport", ([id]) => ({ op: "removeTransport", id: n(id) }));
    wrap(tower, "resizeTransport", ([id, bottom, top]) => ({ op: "resizeTransport", id: n(id), bottom: n(bottom), top: n(top) }));
    wrap(tower, "setCars", ([id, cars]) => ({ op: "setCars", id: n(id), cars: n(cars) }));
    wrap(tower, "setSchedule", ([id, raw]) => ({ op: "setSchedule", id: n(id), schedule: raw }));
    wrap(tower, "setStop", ([id, floor, stop]) => ({ op: "setStop", id: n(id), floor: n(floor), stop: stop as boolean }));
    wrap(tower, "setExpressStops", ([id]) => ({ op: "setExpressStops", id: n(id) }));
    wrap(tower, "clearStops", ([id]) => ({ op: "clearStops", id: n(id) }));
    // The label as stored (trimmed, or the catalog name), so the shadow never
    // has to trim the way JavaScript does.
    wrap(tower, "setLabel", ([id, label], ok) => (ok ? { op: "setLabel", id: n(id), label: tower.getUnit(n(id))?.label ?? s(label) } : null));
    watch(tower, "towerName", (name) => ({ op: "setTowerName", name: name ?? null }));
  } catch (e) {
    detach();
    throw e;
  }

  return {
    detach,
    suppress<T>(fn: () => T): T {
      depth++;
      try {
        return fn();
      } finally {
        depth--;
      }
    },
  };
}
