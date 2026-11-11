import type { SerializedGame } from "../shared/types";

/**
 * The tower the tooling harnesses (the screenshot scenes and the e2e specs)
 * build and inspect by hand, as `game.sim` (#1875 step 4). It drives the
 * Rust engine itself: placements, lookups and commands are the binding's own
 * members, and what a harness reads comes from the engine's save. It answers
 * the part of the old TypeScript `Simulation` API the harnesses use, and
 * nothing else; a member it does not know reads as undefined.
 *
 * Two kinds of edit leave the engine's derived state behind, so the tower is
 * loaded again (a `restore` of its own save) before the game runs on:
 *
 * - a bare placement or removal (`tower.place`, `placeTransport`,
 *   `removeUnit`, `removeTransport`, `setCars`, `setSchedule`), which skips
 *   the charge, the star gate and the log, as the TypeScript tower's did;
 * - a write to a field of the save (a unit's `state`, the `star`, the clock's
 *   `minutes`, a pending choice), which the tower keeps as a patch over the
 *   engine's save until that load.
 *
 * The load happens at the end of the task, before a command or a tick, at
 * {@link ToolingTower.settle}, and when the app adopts the tower. A placement
 * runs with patches still pending unless one of them moves a unit or a shaft
 * (a geometry field), since nothing else a patch writes changes where a room
 * fits. A load starts the crowd empty and forgets the undo steps, as the
 * TypeScript tower's hand edits did; the elevator telemetry and the loop's
 * pass memos are carried across it. `money` is the engine's own `setMoney`,
 * so a money write leaves the crowd alone.
 */

/** The binding members the tower drives (the Rust `Engine`). */
export interface ToolingEngine {
  serialize(): string;
  restore(text: string): Float64Array;
  lastReason(): string | undefined;
  placeBare(kind: string, floor: number, x: number): string;
  placeTransportBare(kind: string, x: number, bottom: number, top: number): string;
  unitRecord(id: number): string | undefined;
  transportRecord(id: number): string | undefined;
  unitAt(floor: number, x: number): string | undefined;
  roomAt(floor: number, x: number): string | undefined;
  transportAt(floor: number, x: number): string | undefined;
  structureKindAt(floor: number, x: number): string | undefined;
  floorHasLobby(floor: number): boolean;
  isFloorServed(floor: number): boolean;
  highestFloor(): number;
  removeUnit(id: number): boolean;
  removeTransport(id: number): boolean;
  setCars(id: number, cars: number): boolean;
  setSchedule(id: number, schedule: string): boolean;
  build(kind: string, floor: number, x: number): string;
  buildTransport(kind: string, x: number, bottom: number, top: number): string;
  canBuild(kind: string, floor: number, x: number): string;
  evaluateStar(): void;
  tick(dtMinutes: number): void;
  setMoney(amount: number): void;
  money(): number;
  mode(): string;
  pendingChoice(): string | undefined;
  founder(): boolean;
  crowdView(): string;
  setWeather(name: string): boolean;
  elevatorTelemetry(): string;
  seedElevatorTelemetry(json: string): void;
  loopMemos(): Float64Array;
  seedLoopMemos(lastHour: number, lastDay: number, lastMonth: number, lastQuarter: number): void;
}

/** The binding's constructors, read off a running engine. */
interface ToolingEngineClass {
  newGame(seed: number, mode: string, calendar?: string | null, unbridged?: boolean | null): ToolingEngine;
  fromSave(text: string, markers?: string | null): ToolingEngine;
}

/** `game.sim.constructor`: a tower made off the app, on an engine of its
 *  own, which the app takes with `adoptSim`. */
export interface ToolingTowerClass {
  newGame(seed?: number, mode?: string): ToolingTower;
  deserialize(save: unknown, markers?: unknown): ToolingTower;
}

/** What the app does around the live tower's loads and commands. A tower a
 *  harness made off the app (`newGame`, `deserialize`) has none. */
export interface ToolingHost {
  /** Before a load: read what the engine logged, which the load drops. */
  beforeLoad(): void;
  /** After a load: draw the engine's tower again. */
  afterLoad(): void;
  /** After a command or a tick changed the engine in place. */
  afterCommand(): void;
}

type SaveRecord = Record<string, unknown> & { id: number };

/** The fields that move a unit or a shaft: a patch on one is loaded before a
 *  placement runs, since it changes where a room fits. */
const GEOMETRY = new Set(["id", "kind", "floor", "x", "width", "bottom", "top"]);

/** What a unit's save record leaves out when it holds the default
 *  (`Unit::serialize`): a view reads the default back, as the TypeScript
 *  unit held it. A structure tile one wide leaves out its width. */
const UNIT_DEFAULTS: Readonly<Record<string, unknown>> = { width: 1, state: "empty", satisfaction: 1, occupants: 0, everOccupied: false, pendingIncome: 0, noRate: false };

/** A record key in the patch table: a unit's or a shaft's, by id. */
const unitKey = (id: number): string => `u${id}`;
const shaftKey = (id: number): string => `t${id}`;

const parsed = <T>(text: string | undefined): T | undefined => (text === undefined ? undefined : (JSON.parse(text) as T));

export class ToolingTower {
  /** Field writes the engine has not loaded yet: per record (`u<id>`,
   *  `t<id>`) and for the save's top level (`top`, by dotted path). */
  private readonly patches = new Map<string, Map<string, unknown>>();
  /** A bare edit ran since the engine last loaded its tower. */
  private bare = false;
  /** The engine's save with the patches over it, read once per task. */
  private cached: { save: SerializedGame; units: Map<number, SaveRecord>; shafts: Map<number, SaveRecord> } | null = null;
  private queued = false;
  /** The tower's parts, in the old `Simulation` shape. */
  readonly tower: ToolingTowerParts;
  readonly clock: { minutes: number; readonly day: number; readonly minuteOfDay: number };
  readonly events: { pending: unknown };
  readonly crowd: { readonly people: unknown[] };
  /** The hourly elevator telemetry, by shaft (`set` seeds one shaft's rows). */
  readonly elevatorHourly: { set(id: number, rows: { weekday: number[]; weekend: number[] }): void };
  constructor(
    private readonly engineOf: () => ToolingEngine,
    private readonly host: ToolingHost | null = null,
  ) {
    this.tower = new ToolingTowerParts(this);
    this.clock = clockOf(this);
    this.events = eventsOf(this);
    this.crowd = { get people() { return (JSON.parse(engineOf().crowdView()) as { people: unknown[] }).people; } };
    this.elevatorHourly = hourlyOf(engineOf);
    // `game.sim.constructor`: a tower made off the app, on an engine of its
    // own, which the app takes with `adoptSim`.
    const Engine = (): ToolingEngineClass => engineOf().constructor as unknown as ToolingEngineClass;
    const detached = (engine: ToolingEngine): ToolingTower => new ToolingTower(() => engine);
    Object.defineProperty(this, "constructor", {
      value: {
        newGame: (seed = 12345, mode = "classic") => detached(Engine().newGame(seed, mode)),
        deserialize: (save: unknown, markers?: unknown) => detached(Engine().fromSave(JSON.stringify(save), markers === undefined ? null : JSON.stringify(markers))),
      } satisfies ToolingTowerClass,
    });
  }

  get port(): ToolingEngine {
    return this.engineOf();
  }

  // ---- the save's fields -------------------------------------------------

  get money(): number { return this.port.money(); }
  set money(amount: number) {
    this.port.setMoney(amount);
    this.cached = null;
    this.host?.afterCommand();
  }
  get star(): number { return this.save().star; }
  set star(v: number) { this.write("top", "star", v); }
  get evaluatedTower(): boolean { return this.save().evaluatedTower; }
  set evaluatedTower(v: boolean) { this.write("top", "evaluatedTower", v); }
  get vipFavorable(): boolean | undefined { return this.save().vipFavorable; }
  set vipFavorable(v: boolean | undefined) { this.write("top", "vipFavorable", v); }
  get vipVisitDay(): number | undefined { return this.save().vipVisitDay; }
  set vipVisitDay(v: number | undefined) { this.write("top", "vipVisitDay", v); }
  get log(): SerializedGame["log"] { return this.save().log ?? []; }
  get mode(): string { return this.port.mode(); }
  get founder(): boolean { return this.port.founder(); }
  get pendingChoice(): unknown {
    const top = this.patches.get("top");
    if (top?.has("events.pending")) return top.get("events.pending");
    return parsed(this.port.pendingChoice()) ?? null;
  }
  /** Today's weather, which no save carries: the engine's tooling write. */
  set weather(name: string) {
    if (!this.port.setWeather(name)) throw new Error(`the engine has no weather named ${name}`);
  }

  // ---- commands ----------------------------------------------------------

  build(kind: string, floor: number, x: number): { ok: boolean; reason?: string } {
    return this.command(() => JSON.parse(this.port.build(kind, floor, x)) as { ok: boolean; reason?: string });
  }
  buildTransport(kind: string, x: number, bottom: number, top: number): { ok: boolean; reason?: string } {
    return this.command(() => JSON.parse(this.port.buildTransport(kind, x, bottom, top)) as { ok: boolean; reason?: string });
  }
  canBuild(kind: string, floor: number, x: number): { ok: boolean; reason?: string; cost: number } {
    this.settle();
    return JSON.parse(this.port.canBuild(kind, floor, x)) as { ok: boolean; reason?: string; cost: number };
  }
  evaluateStar(): void { this.command(() => this.port.evaluateStar()); }
  tick(dtMinutes: number): void { this.command(() => this.port.tick(dtMinutes)); }
  /** The save, with every pending patch in it. */
  serialize(): SerializedGame { return JSON.parse(this.saveText()) as SerializedGame; }

  // ---- loads -------------------------------------------------------------

  /** Load the tower's own save into its engine when a bare edit or a patch
   *  is pending, carrying the telemetry and the memos across. */
  settle(): void {
    if (!this.bare && this.patches.size === 0) {
      // Nothing to load, but a direct port call may have moved the engine
      // since this task's read.
      this.cached = null;
      return;
    }
    this.loadInto(this.port, this.saveText(), this.port);
    this.host?.afterLoad();
  }

  /** The save text with every pending patch in it. */
  saveText(): string {
    if (this.patches.size === 0) return this.port.serialize();
    // Read the engine again: something may have moved it since this task's
    // read (a direct port call), and the patches go over what it holds now.
    this.cached = null;
    return JSON.stringify(this.save());
  }

  /** Load `text` into `target`, with `from`'s telemetry and memos, which a
   *  load starts empty. Loaded into its own engine, the tower then holds
   *  nothing pending; another engine leaves its pending state as it was. */
  loadInto(target: ToolingEngine, text: string, from: ToolingEngine): void {
    const telemetry = from.elevatorTelemetry();
    const [hour, day, month, quarter] = from.loopMemos();
    const own = target === this.port;
    if (own) this.host?.beforeLoad();
    if (target.restore(text)[0] !== 1) throw new Error(`the engine refused the harness's tower: ${target.lastReason() ?? "no reason given"}`);
    target.seedElevatorTelemetry(telemetry);
    target.seedLoopMemos(hour, day, month, quarter);
    if (own) this.discard();
  }

  /** Forget the pending edits and the read: the engine has a tower they do
   *  not belong to (a load, or another tower swapped in). */
  discard(): void {
    this.patches.clear();
    this.bare = false;
    this.cached = null;
  }

  // ---- for the parts -----------------------------------------------------

  /** The engine's save with the patches over it. */
  save(): SerializedGame {
    if (!this.cached) {
      const save = JSON.parse(this.port.serialize()) as SerializedGame;
      const units = new Map((save.units as unknown as SaveRecord[]).map((u) => [u.id, u]));
      const shafts = new Map((save.transports as unknown as SaveRecord[]).map((t) => [t.id, t]));
      for (const [key, fields] of this.patches) {
        if (key === "top") for (const [path, v] of fields) setPath(save as unknown as Record<string, unknown>, path, v);
        else Object.assign((key[0] === "u" ? units : shafts).get(Number(key.slice(1))) ?? {}, Object.fromEntries(fields));
      }
      this.cached = { save, units, shafts };
      // The app moves the engine between the harness's tasks (a tick, a
      // build from the UI), so a read holds only for the task that made it.
      const held = this.cached;
      queueMicrotask(() => {
        if (this.cached === held) this.cached = null;
      });
    }
    return this.cached.save;
  }

  /** A unit or shaft record as the save holds it, patches over it, as a view
   *  whose writes become patches. */
  record(kind: "unit" | "shaft", text: string | undefined): SaveRecord | undefined {
    const rec = parsed<SaveRecord>(text);
    if (!rec) return undefined;
    Object.assign(rec, Object.fromEntries(this.patches.get(kind === "unit" ? unitKey(rec.id) : shaftKey(rec.id)) ?? []));
    return this.view(kind, rec);
  }

  /** Every unit or shaft record, as views. */
  records(kind: "unit" | "shaft"): SaveRecord[] {
    this.save();
    const all = kind === "unit" ? this.cached!.units : this.cached!.shafts;
    return [...all.values()].map((r) => this.view(kind, r));
  }

  view(kind: "unit" | "shaft", rec: SaveRecord): SaveRecord {
    const key = kind === "unit" ? unitKey(rec.id) : shaftKey(rec.id);
    return new Proxy(rec, {
      get: (target, field) => {
        if (typeof field !== "string") return Reflect.get(target, field);
        // Another view of the same record may have written the field since
        // this one was read: the pending value is the current one, and a
        // nested edit goes to that same value.
        const pending = this.patches.get(key);
        if (pending?.has(field)) target[field] = pending.get(field);
        if (!(field in target)) return kind === "unit" ? UNIT_DEFAULTS[field] : undefined;
        // A nested value (a shaft's schedule, say) hands itself back whole
        // when a harness edits it in place.
        return tracked(target[field], () => this.write(key, field, target[field]));
      },
      set: (target, field, value) => {
        if (typeof field !== "string") return false;
        target[field] = value;
        this.write(key, field, value);
        return true;
      },
    });
  }

  /** A bare edit: patches that move something are loaded first. A refused
   *  edit changed nothing, so it leaves nothing to load. */
  bareEdit<T>(edit: () => T): T {
    this.settleGeometry();
    const out = edit();
    if (!applied(out)) return out;
    this.bare = true;
    this.cached = null;
    this.endOfTask();
    return out;
  }

  /** Load the pending patches when one moves a unit or a shaft, so a
   *  placement or a lookup by tile sees the tower where its records say. */
  settleGeometry(): void {
    if ([...this.patches.entries()].some(([key, fields]) => key !== "top" && [...fields.keys()].some((f) => GEOMETRY.has(f)))) this.settle();
  }

  /** Drop a pending patch on a record's field that a bare setter is about to
   *  write, so the later write is the one the load keeps. */
  supersede(key: string, field: string): void {
    const fields = this.patches.get(key);
    if (!fields?.delete(field)) return;
    if (fields.size === 0) this.patches.delete(key);
    this.cached = null;
  }

  private command<T>(run: () => T): T {
    this.settle();
    const out = run();
    this.cached = null;
    this.host?.afterCommand();
    return out;
  }

  write(key: string, field: string, value: unknown): void {
    let fields = this.patches.get(key);
    if (!fields) this.patches.set(key, (fields = new Map()));
    fields.set(field, value);
    if (this.cached) {
      if (key === "top") setPath(this.cached.save as unknown as Record<string, unknown>, field, value);
      else {
        const rec = (key[0] === "u" ? this.cached.units : this.cached.shafts).get(Number(key.slice(1)));
        if (rec) rec[field] = value;
      }
    }
    this.endOfTask();
  }

  /** The live tower loads what is pending when the harness's task ends. */
  private endOfTask(): void {
    if (!this.host || this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      this.settle();
    });
  }
}

/** `game.sim.tower`: the tower's own lookups and bare edits. */
export class ToolingTowerParts {
  constructor(private readonly sim: ToolingTower) {}

  private get port(): ToolingEngine {
    return this.sim.port;
  }

  place(kind: string, floor: number, x: number): { ok: boolean; reason?: string; unitId?: number } {
    return this.sim.bareEdit(() => JSON.parse(this.port.placeBare(kind, floor, x)) as { ok: boolean; reason?: string; unitId?: number });
  }
  placeTransport(kind: string, x: number, bottom: number, top: number): { ok: boolean; reason?: string; transportId?: number } {
    return this.sim.bareEdit(() => JSON.parse(this.port.placeTransportBare(kind, x, bottom, top)) as { ok: boolean; reason?: string; transportId?: number });
  }
  removeUnit(id: number): SaveRecord | undefined {
    const rec = this.getUnit(id);
    return rec && this.sim.bareEdit(() => this.port.removeUnit(id)) ? rec : undefined;
  }
  removeTransport(id: number): SaveRecord | undefined {
    const rec = this.getTransport(id);
    return rec && this.sim.bareEdit(() => this.port.removeTransport(id)) ? rec : undefined;
  }
  setCars(id: number, cars: number): boolean {
    const ok = this.sim.bareEdit(() => this.port.setCars(id, cars));
    if (ok) this.sim.supersede(shaftKey(id), "cars");
    return ok;
  }
  setSchedule(id: number, schedule: unknown): boolean {
    const ok = this.sim.bareEdit(() => this.port.setSchedule(id, JSON.stringify(schedule)));
    if (ok) this.sim.supersede(shaftKey(id), "schedule");
    return ok;
  }

  get units(): SaveRecord[] { return this.sim.records("unit"); }
  get transports(): SaveRecord[] { return this.sim.records("shaft"); }
  getUnit(id: number): SaveRecord | undefined { return this.sim.record("unit", this.port.unitRecord(id)); }
  getTransport(id: number): SaveRecord | undefined { return this.sim.record("shaft", this.port.transportRecord(id)); }
  // The lookups by tile and floor read the engine's own geometry, so a
  // pending patch that moves something is loaded first.
  unitAt(floor: number, x: number): SaveRecord | undefined { return this.sim.record("unit", this.geometry().unitAt(floor, x)); }
  roomAt(floor: number, x: number): SaveRecord | undefined { return this.sim.record("unit", this.geometry().roomAt(floor, x)); }
  transportAt(floor: number, x: number): SaveRecord | undefined { return this.sim.record("shaft", this.geometry().transportAt(floor, x)); }
  structureKindAt(floor: number, x: number): string | undefined { return this.geometry().structureKindAt(floor, x); }
  floorHasLobby(floor: number): boolean { return this.geometry().floorHasLobby(floor); }
  isFloorServed(floor: number): boolean { return this.geometry().isFloorServed(floor); }
  get highestFloor(): number { return this.geometry().highestFloor(); }

  private geometry(): ToolingEngine {
    this.sim.settleGeometry();
    return this.port;
  }
}

/** `sim.clock`: the save's minutes, and the day and the minute of the day
 *  read from them as the clock reads them. */
function clockOf(sim: ToolingTower): ToolingTower["clock"] {
  return {
    get minutes() { return sim.save().minutes; },
    set minutes(v: number) { sim.write("top", "minutes", v); },
    get day() { return Math.floor(sim.save().minutes / 1440); },
    get minuteOfDay() { return ((sim.save().minutes % 1440) + 1440) % 1440; },
  };
}

/** `sim.events`: the pending choice the save carries. */
function eventsOf(sim: ToolingTower): ToolingTower["events"] {
  return {
    get pending() {
      const pending = sim.save().events?.pending ?? null;
      return tracked(pending, () => sim.write("top", "events.pending", pending));
    },
    set pending(v: unknown) { sim.write("top", "events.pending", v); },
  };
}

/** `sim.elevatorHourly.set(id, rows)`: one shaft's hourly rows, seeded into
 *  the engine's telemetry. */
function hourlyOf(engineOf: () => ToolingEngine): ToolingTower["elevatorHourly"] {
  return {
    set(id, rows) {
      const engine = engineOf();
      const doc = JSON.parse(engine.elevatorTelemetry()) as { hourly: [number, unknown][] };
      doc.hourly = [...doc.hourly.filter(([at]) => at !== id), [id, { weekday: [...rows.weekday], weekend: [...rows.weekend] }]];
      engine.seedElevatorTelemetry(JSON.stringify(doc));
    },
  };
}

/** A nested save value whose writes, at any depth, `commit` the value
 *  they changed, so an edit in place becomes a patch like a replacement. */
function tracked<T>(value: T, commit: () => void): T {
  if (typeof value !== "object" || value === null) return value;
  return new Proxy(value, {
    get: (target, field) => tracked(Reflect.get(target, field), commit),
    set: (target, field, next) => {
      const ok = Reflect.set(target, field, next);
      if (ok) commit();
      return ok;
    },
    deleteProperty: (target, field) => {
      const ok = Reflect.deleteProperty(target, field);
      if (ok) commit();
      return ok;
    },
  });
}

/** Whether a bare edit changed the tower: a placement's `{ ok: true }`, or a
 *  removal's or a setter's `true`. */
function applied(out: unknown): boolean {
  return out === true || (typeof out === "object" && out !== null && (out as { ok?: unknown }).ok === true);
}

/** Write `value` at a dotted path of a save object, making the objects on
 *  the way. */
function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let at = obj;
  for (const k of keys.slice(0, -1)) {
    if (typeof at[k] !== "object" || at[k] === null) at[k] = {};
    at = at[k] as Record<string, unknown>;
  }
  at[keys[keys.length - 1]] = value;
}
