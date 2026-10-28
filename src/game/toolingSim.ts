import { Simulation } from "../engine/Simulation";
import { TsEngine } from "../engine/port/tsEngine";
import type { FacilityKind } from "../engine/types";
import type { EnginePort, PortRecord } from "../simport/enginePort";
import { PortRenderSim } from "../simport/portRenderSim";
import type { ViewReader } from "../simport/viewReader";
import type { HudSource } from "../ui/uiStatus";
import { adoptTelemetry, isTelemetryDocument, telemetryDocument } from "../wasmhost/telemetry";

/**
 * `game.sim` for the tooling harnesses (the screenshot scenes and the e2e
 * specs, which build and inspect towers by hand), on either engine (PR 5e).
 *
 * On the TypeScript engine it is the engine's own tower. On the Rust engine
 * there is no TypeScript tower, so the harness gets a view over a copy made
 * from the engine's save. The view stays the same object for the app's life;
 * the copy behind it is made again whenever the engine's state moved on since
 * it was read, so a reference a harness keeps never reads an old tower.
 *
 * Edits reach the engine as a restore of the copy's save, which the app
 * follows as it follows an edit in place on the TypeScript engine (see
 * {@link followToolingEdit}):
 *
 * - right after a method call or a field write on the tower itself, so the
 *   app sees them in the same task;
 * - for an edit deeper in the copy (a tile placed on `sim.tower`), when the
 *   current task ends, or at once through {@link syncToolingSim}.
 *
 * The save carries neither the hourly elevator telemetry nor the loop's pass
 * memos, so the copy takes both from the engine and hands both back with
 * each restore (the Rust binding's tooling members), and a swapped-in tower
 * brings its own.
 *
 * A load starts the crowd empty, which a restore does too, so the edits the
 * harnesses make most (`build`, `buildTransport`, a `money` write) go to the
 * engine as its own commands instead, beside the same edit on the copy, and
 * leave the crowd alone as they do on the TypeScript engine. `sim.tick` runs
 * the engine itself. An edit the engine never got, made before the engine
 * moved on, throws when the tower is next read, so a harness never rolls the
 * engine back to an old tower by accident.
 *
 * Dev serves and tooling builds only: production has no copy, and its
 * `game.sim` on the Rust engine is undefined.
 */

interface ToolingApp {
  readonly enginePort: EnginePort;
  readonly reader: HudSource["reader"] & { update(): void };
  readonly portCodes: HudSource["codes"] & { kind(kind: FacilityKind): number };
  readonly ui: { lastLogSeq: number; resetLog(src: HudSource): void; update(src: HudSource): void };
  followSwap(keepHistory?: boolean): void;
  /** Draw the engine again after a hand edit reached it as a load
   *  ({@link followToolingEdit}). */
  followEdit(shown?: Simulation): void;
}

/** The Rust binding's tooling members the copy carries the telemetry and
 *  the memos through, and its state digest. */
interface RustTooling {
  setMoney?(amount: number): void;
  elevatorTelemetry?(): string;
  seedElevatorTelemetry?(json: string): void;
  loopMemos?(): Float64Array;
  seedLoopMemos?(lastHour: number, lastDay: number, lastMonth: number, lastQuarter: number): void;
  stateDigest?(): string;
}

interface Copy {
  /** What the harness holds, the same object for the app's life. */
  readonly view: Simulation;
  /** The engine's tower as last read, or null until it is read again. */
  sim: Simulation | null;
  /** The copy's own state as the engine last had it, to tell an edited copy;
   *  null while nothing that can edit the copy has reached it since it last
   *  matched the engine, so a run of reads and commands serializes nothing. */
  baseline: string | null;
  /** The engine's state when the copy last matched it, or null after a
   *  command: the copy made the same edit, so it still matches, and the
   *  engine's new state is not read until the task ends. */
  stamp: string | null;
  /** The copy was checked against the engine in this task. Nothing but the
   *  harness runs inside a task, so later reads in it skip the check, which
   *  reads the engine's whole state. A harness that drives the app's own
   *  commands reads the engine's tower again through game.syncSim. */
  fresh: boolean;
  /** A hand-on of deeper edits is queued for the end of the task. */
  queued: boolean;
  /** How many of the copy's log lines (its `logSeq`) the bulletin has had,
   *  from the engine's own log or from {@link followToolingEdit}. */
  logged: number;
  /** The views of the tower's parts handed out, by path (`liveOf`). */
  readonly parts: Map<string, object>;
}

const copies = new WeakMap<ToolingApp, Copy>();
/** Each handed-out view's copy, so a view handed back is read as its tower. */
const viewed = new WeakMap<Simulation, Copy>();

const saveOf = (sim: Simulation): string => JSON.stringify(sim.serialize());
const memosOf = (sim: Simulation): number[] => [sim.lastHour, sim.lastDay, sim.lastMonth, sim.lastQuarter];
/** What a restore hands the engine: the save, the telemetry and the memos. */
const stateOf = (sim: Simulation): string => `${saveOf(sim)}\n${JSON.stringify(telemetryDocument(sim))}\n${memosOf(sim).join(",")}`;

/** A cheap mark of the engine's state: the Rust binding's state digest. */
function stampOf(port: EnginePort): string {
  const tooling = port as RustTooling;
  return tooling.stateDigest ? tooling.stateDigest() : port.serialize();
}

/** The engine's tower as a TypeScript instance, its telemetry and memos too. */
function copyOf(port: EnginePort): Simulation {
  const sim = Simulation.deserialize(JSON.parse(port.serialize()));
  const tooling = port as RustTooling;
  const doc: unknown = tooling.elevatorTelemetry ? JSON.parse(tooling.elevatorTelemetry()) : null;
  if (isTelemetryDocument(doc)) adoptTelemetry(sim, doc);
  if (tooling.loopMemos) [sim.lastHour, sim.lastDay, sim.lastMonth, sim.lastQuarter] = tooling.loopMemos();
  return sim;
}

/** Load `sim` into the Rust engine: its save, then its telemetry and memos,
 *  which a load starts empty. */
function restoreInto(port: EnginePort, sim: Simulation): void {
  if (port.restore(saveOf(sim))[0] !== 1) throw new Error(`the engine refused the harness's tower: ${port.lastReason() ?? "no reason given"}`);
  const tooling = port as RustTooling;
  tooling.seedElevatorTelemetry?.(JSON.stringify(telemetryDocument(sim)));
  tooling.seedLoopMemos?.(sim.lastHour, sim.lastDay, sim.lastMonth, sim.lastQuarter);
}

/** The tower the harness reads and edits (see the module doc). */
export function toolingSim(app: ToolingApp): Simulation | undefined {
  if (app.enginePort instanceof TsEngine) return app.enginePort.sim;
  if (!(import.meta.env.DEV || __TOOLING_BUILD__)) return undefined;
  let copy = copies.get(app);
  if (!copy) {
    copy = { view: null as unknown as Simulation, sim: null, baseline: null, stamp: null, fresh: false, queued: false, logged: 0, parts: new Map() };
    (copy as { view: Simulation }).view = viewOf(app, copy);
    viewed.set(copy.view, copy);
    copies.set(app, copy);
  }
  return copy.view;
}

const STALE = "game.sim has an edit the engine never got, and the engine moved on since, so the edit was dropped; make the edit and hand it on (game.syncSim) before the engine runs";

/** The engine's tower as the copy holds it, read again when the engine moved
 *  on. An edit still pending on an old copy is dropped loudly. */
function current(app: ToolingApp, copy: Copy): Simulation {
  if (!copy.sim || !copy.fresh) {
    const stamp = stampOf(app.enginePort);
    if (!copy.sim || stamp !== copy.stamp) {
      const pending = copy.sim !== null && copy.baseline !== null && stateOf(copy.sim) !== copy.baseline;
      copy.sim = null;
      if (pending) throw new Error(STALE);
      copy.sim = copyOf(app.enginePort);
      copy.logged = copy.sim.logSeq;
      copy.baseline = null;
      copy.stamp = stamp;
    }
    copy.fresh = true;
  }
  if (!copy.queued) {
    copy.queued = true;
    queueMicrotask(() => {
      copy.queued = false;
      push(app, copy, true);
    });
  }
  return copy.sim;
}

/** The copy as it is about to be edited: its state is kept first, so the
 *  hand-on can tell what changed. A method call counts, since it may edit the
 *  copy or hand out a part a harness writes to later in the task. */
function editing(app: ToolingApp, copy: Copy): Simulation {
  const sim = current(app, copy);
  copy.baseline ??= stateOf(sim);
  return sim;
}

/** The copy's edits the engine runs as its own commands: the command for a
 *  call, by the call's name. */
const COMMANDS: Record<string, (port: EnginePort, codes: ToolingApp["portCodes"], args: unknown[]) => PortRecord> = {
  build: (port, codes, [kind, floor, x]) => port.buildAt(codes.kind(kind as FacilityKind), floor as number, x as number),
  buildTransport: (port, codes, [kind, x, bottom, top]) => port.buildShaft(codes.kind(kind as FacilityKind), x as number, bottom as number, top as number),
};

/** The view: each read goes to the current copy, each method call and field
 *  write is handed to the engine, and `tick` runs the engine itself. */
function viewOf(app: ToolingApp, copy: Copy): Simulation {
  const tick = (dt: number): void => {
    push(app, copy);
    copy.sim = null;
    app.enginePort.tick(dt);
    app.reader.update();
  };
  const own = (key: string | symbol): PropertyDescriptor | undefined => {
    const desc = Reflect.getOwnPropertyDescriptor(current(app, copy), key);
    // A descriptor hands out the part itself, which may be written to.
    if (typeof desc?.value === "object" && desc.value !== null) editing(app, copy);
    // The view's own target is empty, so a key it reports must stay configurable.
    return desc && { ...desc, configurable: true };
  };
  return new Proxy(Object.create(Simulation.prototype) as Simulation, {
    get(_target, key) {
      if (key === "tick") return tick;
      const sim = current(app, copy);
      const value: unknown = Reflect.get(sim, key, sim);
      if (typeof key === "string" && typeof value === "object" && value !== null) return liveOf(app, copy, [key], value);
      if (typeof value !== "function" || key === "constructor") return value;
      const command = typeof key === "string" ? COMMANDS[key] : undefined;
      return (...args: unknown[]) => {
        if (!command) {
          const out = (value as (...a: unknown[]) => unknown).apply(editing(app, copy), args);
          push(app, copy);
          return out;
        }
        return alongside(app, copy, String(key), (target) => (value as (...a: unknown[]) => { ok: boolean }).apply(target, args), () => command(app.enginePort, app.portCodes, args));
      };
    },
    set(_target, key, value) {
      const setMoney = (app.enginePort as RustTooling).setMoney;
      if (key === "money" && typeof value === "number" && setMoney) {
        alongside(app, copy, "money", (target) => (Reflect.set(target, key, value, target), { ok: true }), () => (setMoney.call(app.enginePort, value), Float64Array.of(1)));
        return true;
      }
      const sim = editing(app, copy);
      const done = Reflect.set(sim, key, value, sim);
      push(app, copy);
      return done;
    },
    has: (_target, key) => key in current(app, copy),
    ownKeys: () => Reflect.ownKeys(current(app, copy)),
    getOwnPropertyDescriptor: (_target, key) => own(key),
  });
}

/** A part of the tower (`game.sim.tower`, its units, the crowd) as a view
 *  too: a harness that keeps it reads and edits the part in the engine's
 *  tower as it is now, as it would on the TypeScript engine, whose parts stay
 *  put. Its methods run on the part itself, and an edit through it is handed
 *  on as an edit of the tower is. One view per path, so it compares equal to
 *  itself. */
function liveOf(app: ToolingApp, copy: Copy, path: readonly string[], sample: object): object {
  const key = path.join("\0");
  const known = copy.parts.get(key);
  if (known) return known;
  const resolve = (edit = false): object => path.reduce<object>((o, k) => Reflect.get(o, k, o) as object, edit ? editing(app, copy) : current(app, copy));
  const array = Array.isArray(sample);
  const target: object = array ? [] : Object.create(Object.getPrototypeOf(sample) as object | null);
  const part = new Proxy(target, {
    get(_target, k) {
      const obj = resolve();
      const value: unknown = Reflect.get(obj, k, obj);
      if (typeof k === "string" && typeof value === "object" && value !== null) return liveOf(app, copy, [...path, k], value);
      if (typeof value !== "function" || k === "constructor") return value;
      // resolve() just read the current copy, so it is kept as it is now.
      copy.baseline ??= stateOf(copy.sim!);
      return (value as (...a: unknown[]) => unknown).bind(obj);
    },
    set: (_target, k, value) => {
      const obj = resolve(true);
      return Reflect.set(obj, k, value, obj);
    },
    has: (_target, k) => k in resolve(),
    ownKeys: () => Reflect.ownKeys(resolve()),
    getOwnPropertyDescriptor(_target, k) {
      const desc = Reflect.getOwnPropertyDescriptor(resolve(), k);
      if (typeof desc?.value === "object" && desc.value !== null) editing(app, copy);
      // An array's length is fixed on the target, so it is reported as it is.
      if (!desc || (array && k === "length")) return desc;
      return { ...desc, configurable: true };
    },
  });
  copy.parts.set(key, part);
  return part;
}

/** Make the same edit on the copy and, as a command, on the engine, after
 *  handing on any edit still pending, and fail loudly when the two engines
 *  disagree on whether it went through. */
function alongside<T extends { ok: boolean }>(app: ToolingApp, copy: Copy, what: string, onCopy: (sim: Simulation) => T, onEngine: () => PortRecord): T {
  push(app, copy);
  const sim = current(app, copy);
  const port = app.enginePort;
  const out = onCopy(sim);
  const done = onEngine()[0] === 1;
  if (done !== Boolean(out.ok)) throw new Error(`the engines disagree on ${what}: ${done ? "the Rust engine took it" : `the Rust engine refused it (${port.lastReason() ?? "no reason given"})`}`);
  app.reader.update();
  // Both made the same edit, so the copy still matches the engine, and the
  // lines the copy logged for it are the engine's own, which the bulletin reads.
  if (copy.baseline !== null) copy.baseline = stateOf(sim);
  copy.logged = sim.logSeq;
  copy.stamp = null;
  return out;
}

/** Restore the engine to the copy when the copy changed. At the end of the
 *  task no part handed out in it is still held, so the copy counts as
 *  unedited again, and it is checked against the engine at its next read (a
 *  copy whose engine state went unread since a command is read again);
 *  mid-task, a part may still be written, so it stays compared. */
function push(app: ToolingApp, copy: Copy, endOfTask = false): void {
  if (copy.sim && copy.baseline !== null) {
    const state = stateOf(copy.sim);
    if (state !== copy.baseline) {
      const port = app.enginePort;
      // A copy whose stamp went unread since a command was checked in this task.
      if (copy.stamp !== null && copy.stamp !== stampOf(port)) {
        copy.sim = null;
        throw new Error(STALE);
      }
      // The bulletin reads the engine's new lines first: a load numbers the
      // log from nothing, so the next read would skip them.
      app.reader.update();
      app.ui.update({ reader: app.reader, codes: app.portCodes, port });
      restoreInto(port, copy.sim);
      // Lines the copy logged by itself (a star reached, say) reached the
      // engine only inside the save, which a load reads as no new lines.
      const logged = copy.sim.logSeq !== copy.logged;
      // A copy read from a save numbers its log from nothing, so its saved
      // tail would count as before the cursor; number it as the tail's own.
      if (logged && copy.sim.logSeq < copy.sim.log.length) copy.sim.logSeq = copy.sim.log.length;
      app.followEdit(logged ? copy.sim : undefined);
      copy.logged = copy.sim.logSeq;
      copy.stamp = stampOf(port);
    }
    copy.baseline = state;
  }
  if (!endOfTask) return;
  copy.baseline = null;
  copy.fresh = false;
  if (copy.stamp === null) copy.sim = null;
}

/** Hand the copy's edits to the engine now. Nothing happens without a copy,
 *  or on the TypeScript engine, whose tower the harness edits in place. */
export function syncToolingSim(app: ToolingApp): void {
  const copy = copies.get(app);
  if (copy) push(app, copy, true);
}

/** Swap in a tower a harness built by hand, on either engine: the
 *  TypeScript engine takes the instance, the Rust engine loads its save.
 *  `preserveHistory` is an undo or redo style swap, which keeps the camera
 *  and the undo trail. */
export function adoptToolingSim(app: ToolingApp, built: Simulation, preserveHistory: boolean): void {
  if (!(import.meta.env.DEV || __TOOLING_BUILD__)) throw new Error("adoptSim is for tooling builds only");
  const held = viewed.get(built);
  const sim = held ? held.sim ?? copyOf(app.enginePort) : built;
  const port = app.enginePort;
  if (port instanceof TsEngine) port.take(sim);
  else restoreInto(port, sim);
  const copy = copies.get(app);
  if (copy) copy.sim = null;
  app.followSwap(preserveHistory);
  if (port instanceof TsEngine) return;
  // The bulletin shows the swapped-in tower's log as the TypeScript engine
  // shows it: a load numbers the engine's log from nothing, which the
  // bulletin reads as no lines, so they are read from the tower handed in.
  app.ui.resetLog({ reader: app.reader, codes: app.portCodes, port: new TsEngine(sim) });
  app.ui.lastLogSeq = app.reader.header.logSeq;
}

/** The app after a hand edit reached the Rust engine as a load: the renderer
 *  draws the engine's tower again with the camera kept, and the rest stays as
 *  an edit in place leaves it on the TypeScript engine (the selection, the
 *  latches, the undo trail). A load numbers the engine's log from nothing, so
 *  the bulletin keeps the lines it shows and its cursor moves to the engine's
 *  count, from which the next line is read. `shown` is the harness's tower
 *  when it logged lines the engine never saw: the bulletin is rebuilt from
 *  that tower's log, which holds the lines it showed and the new ones. */
export function followToolingEdit(
  app: {
    readonly enginePort: EnginePort;
    readonly reader: ViewReader;
    readonly portCodes: HudSource["codes"];
    renderSim: PortRenderSim;
    readonly engine: { setSim(sim: PortRenderSim, opts?: { keepCamera?: boolean }): void };
    readonly ui: { lastLogSeq: number; resetLog(src: HudSource): void };
  },
  shown?: Simulation,
): void {
  app.reader.update();
  app.renderSim = new PortRenderSim(app.enginePort, app.reader);
  app.engine.setSim(app.renderSim, { keepCamera: true });
  if (shown) app.ui.resetLog({ reader: app.reader, codes: app.portCodes, port: new TsEngine(shown) });
  app.ui.lastLogSeq = app.reader.header.logSeq;
}
