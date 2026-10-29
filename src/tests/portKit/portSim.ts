import { afterEach, describe } from "vitest";
import { KIND_CODES, VIEW_LAYOUT, codeOf } from "../../engine/port/layout";
import { TsEngine } from "../../engine/port/tsEngine";
import { Simulation } from "../../engine/Simulation";
import type { Tower } from "../../engine/Tower";
import type { FacilityKind, SerializedGame, Transport, Unit } from "../../engine/types";
import type { EnginePort } from "../../simport/enginePort";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";
import type { WasmEngine } from "../../dualrun/binding";

/**
 * The test kit for suites that run on the engine port (#878, #1421; PR 7 of
 * the engine port contract). A suite names its engines with
 * {@link describeEngines} and drives one {@link PortSim} per test: the Rust
 * `Engine` (the authority the release ships) and `TsEngine` (the fallback,
 * kept working through 3.0) run the same test body.
 *
 * The engine is the authority. A test acts on it through port commands
 * ({@link PortSim.build}, {@link PortSim.buildTransport}, `tick`) and the
 * tooling-only members ({@link PortSim.startFire}, `bombThreat`,
 * `setMoney`), and reads it through {@link PortSim.state}, a read-only copy
 * of the engine's own save. A fixture's raw tower edits (`tower.place`, a
 * unit's state, the star) go through {@link PortSim.setup}: the engine's save
 * is opened as a draft, the edit is made, and the engine loads the result,
 * the same path a saved tower takes into the game. That is allowed only
 * before the engine's first tick after a load; once a crowd exists a test
 * needs a tooling-only member instead, and `setup` says so.
 */

export type Leg = "ts" | "rust";

/** A `Simulation` method that moves the tower. They are absent from
 *  {@link Snapshot}, so a write to the read-only copy fails to compile
 *  instead of being lost. */
type SimulationWrites =
  | "tick" | "build" | "paintBrush" | "buildTransport" | "sellAt" | "setCars" | "resizeTransport" | "addCar" | "removeCar"
  | "beginExtend" | "extendTransport" | "endExtend" | "removeFacility" | "emit" | "startFire" | "bombThreat" | "evaluateStar"
  | "callExterminator" | "resolveChoice" | "adjustRent" | "setNoRate" | "priceUnit" | "applyRentBatch" | "setFilmPolicy"
  | "rerollSubtype" | "moveIn" | "toggleAutoBridge";
type TowerWrites =
  | "place" | "placeTransport" | "placeStructureRun" | "removeUnit" | "removeTransport" | "setLabel" | "resizeTransport"
  | "setCars" | "setSchedule" | "setStop" | "setExpressStops" | "clearStops" | "setNextId";

/** What a test may read of the tower. */
export type TowerView = Readonly<Omit<Tower, TowerWrites | "units" | "transports">> & {
  readonly units: readonly Readonly<Unit>[];
  readonly transports: readonly Readonly<Transport>[];
};
/** A read-only copy of the engine's save, as a `Simulation`. */
export type Snapshot = Readonly<Omit<Simulation, SimulationWrites | "tower">> & { readonly tower: TowerView };

interface Leaf {
  readonly port: EnginePort;
  /** The tooling-only members (binding tier 3), the same on both engines. */
  startFire(): void;
  bombThreat(): void;
  evaluateStar(): void;
  setMoney(amount: number): void;
  free(): void;
}

function makeLeaf(leg: Leg, save: string): Leaf {
  if (leg === "ts") {
    const engine = new TsEngine(Simulation.deserialize(JSON.parse(save) as SerializedGame));
    return {
      port: engine,
      startFire: () => engine.sim.startFire(),
      bombThreat: () => engine.sim.bombThreat(),
      evaluateStar: () => engine.sim.evaluateStar(),
      setMoney: (amount) => {
        engine.sim.money = amount;
      },
      free: () => undefined,
    };
  }
  const engine: WasmEngine = wasm().Engine.fromSave(save);
  return {
    port: engine as unknown as EnginePort,
    startFire: () => engine.startFire(),
    bombThreat: () => engine.bombThreat(),
    evaluateStar: () => engine.evaluateStar(),
    setMoney: (amount) => engine.setMoney(amount),
    free: () => engine.free(),
  };
}

const live = new Set<PortSim>();

function must(result: CommandResult, what: string): CommandResult {
  if (!result.ok) throw new Error(`${what} was refused: ${result.reason ?? "no reason"}`);
  return result;
}

/** What a command answered: `ok`, the refusal text, the engine's measured
 *  money change. */
export interface CommandResult {
  readonly ok: boolean;
  readonly reason: string | undefined;
  readonly delta: number;
}

/** A batch price target: a price, the unit's default, or No Rate. */
export type BatchTarget = number | "default" | "noRate";

/** A batch's counts, by the layout's slot names. */
export interface BatchResult {
  readonly matched: number;
  readonly eligible: number;
  readonly changed: number;
  readonly skippedSold: number;
  readonly skippedCustom: number;
  readonly customOverwritten: number;
  readonly clampedLow: number;
  readonly clampedHigh: number;
}

/** The port's number for a batch target: NaN is the default, -1 No Rate. */
function batchCode(target: BatchTarget): number {
  if (target === "default") return NaN;
  return target === "noRate" ? -1 : target;
}

function batchResult(slots: readonly string[], rec: Float64Array): BatchResult {
  const out: Record<string, number> = {};
  slots.forEach((name, i) => {
    if (name !== "status" && name !== "ok" && name !== "delta") out[name] = rec[i];
  });
  return out as unknown as BatchResult;
}

export class PortSim {
  private leaf: Leaf;
  private cached: Snapshot | undefined;
  private ticked = false;

  /** A simulation on `leg` that starts from `source`: a draft `Simulation`
   *  (a fixture's authoring copy; nothing reads it afterwards) or save text
   *  the engine loads itself, such as an edited or forged save. */
  constructor(
    readonly leg: Leg,
    source: Simulation | string,
  ) {
    this.leaf = makeLeaf(leg, typeof source === "string" ? source : JSON.stringify(source.serialize()));
    live.add(this);
  }

  /** The engine's port, for the calls the port has and this class does not
   *  wrap. A call that writes the tower must go through a wrapper or
   *  {@link changed} so the read-only copy follows. */
  get port(): EnginePort {
    return this.leaf.port;
  }

  /** A read-only copy of the engine's save, rebuilt after any write. */
  get state(): Snapshot {
    this.cached ??= Simulation.deserialize(JSON.parse(this.leaf.port.serialize()) as SerializedGame) as unknown as Snapshot;
    return this.cached;
  }

  /** The read-only copy as a `Simulation`, for a rule that takes one and only
   *  reads (a milestone's test, say). */
  get readOnlySimulation(): Simulation {
    return this.state as unknown as Simulation;
  }

  /** A slot of the frame header by its layout name, read from the engine now
   *  (the counters the save does not carry, such as the emergency tallies). */
  frameSlot(name: string): number {
    const layout = JSON.parse(this.leaf.port.viewLayout()) as { header: Record<string, number> };
    const at = layout.header[name];
    if (at === undefined) throw new Error(`PortSim.frameSlot: the frame header has no slot ${name}`);
    return this.leaf.port.viewFrame(true)[at];
  }

  /** The analytics-only emergency tallies (#611). */
  emergencyCounts(): { fires: number; firesGutRooms: number; bombs: number } {
    return { fires: this.frameSlot("firesStarted"), firesGutRooms: this.frameSlot("firesGutRooms"), bombs: this.frameSlot("bombsDetonated") };
  }

  /** The engine's save text. */
  save(): string {
    return this.leaf.port.serialize();
  }

  /** Tell the kit a write went around its wrappers. */
  changed(): void {
    this.cached = undefined;
  }

  /** Edit the tower as a fixture: `edit` gets a draft `Simulation` opened on
   *  the engine's save, and the engine loads the result. Only before the
   *  first tick since the last load; take ids out of the draft, since its
   *  objects are not the engine's. */
  setup<T = void>(edit: (draft: Simulation) => T): T {
    if (this.ticked) {
      throw new Error("PortSim.setup runs before the engine's first tick; a mid-run write needs a tooling-only member on the engine");
    }
    const draft = Simulation.deserialize(JSON.parse(this.leaf.port.serialize()) as SerializedGame);
    const out = edit(draft);
    const answer = this.leaf.port.loadSave(JSON.stringify(draft.serialize()));
    if (answer[0] !== 1) throw new Error(`PortSim.setup: the engine refused the edited save: ${this.leaf.port.lastReason() ?? "no reason"}`);
    this.changed();
    return out;
  }

  tick(dtMinutes: number): void {
    this.ticked = true;
    this.leaf.port.tick(dtMinutes);
    this.changed();
  }

  private result(rec: Float64Array): CommandResult {
    this.changed();
    const ok = rec[0] === 1;
    return { ok, reason: ok ? undefined : this.leaf.port.lastReason(), delta: rec[1] };
  }

  build(kind: FacilityKind, floor: number, x: number): CommandResult {
    return this.result(this.leaf.port.buildAt(codeOf(KIND_CODES, kind), floor, x));
  }

  buildTransport(kind: FacilityKind, x: number, bottom: number, top: number): CommandResult {
    return this.result(this.leaf.port.buildShaft(codeOf(KIND_CODES, kind), x, bottom, top));
  }

  /** {@link build}, which throws when the engine refuses: a fixture asserts its
   *  own construction. */
  mustBuild(kind: FacilityKind, floor: number, x: number): CommandResult {
    return must(this.build(kind, floor, x), `build ${kind} at ${floor},${x}`);
  }

  /** {@link buildTransport}, which throws when the engine refuses. */
  mustBuildTransport(kind: FacilityKind, x: number, bottom: number, top: number): CommandResult {
    return must(this.buildTransport(kind, x, bottom, top), `buildTransport ${kind} at ${x} (${bottom}-${top})`);
  }

  /** Extend shaft `id` up or down to `targetFloor`. */
  extendShaft(id: number, up: boolean, targetFloor: number): CommandResult {
    return this.result(this.leaf.port.extendShaft(id, up, targetFloor));
  }

  /** Demolish unit `id` through the port; whether it was done. */
  demolish(id: number, bulldoze = false): boolean {
    return this.result(this.leaf.port.demolish(id, bulldoze)).ok;
  }

  /** Price one unit one rung up (1) or down (-1); the rent after, or null
   *  when the engine refused. */
  stepRent(id: number, dir: number): number | null {
    const rec = this.leaf.port.stepRent(id, dir);
    this.changed();
    return rec[0] === 1 ? rec[2] : null;
  }

  /** Price one unit at `target`; the rent after, or null when refused. */
  setRent(id: number, target: number): number | null {
    const rec = this.leaf.port.setRent(id, target);
    this.changed();
    return rec[0] === 1 ? rec[2] : null;
  }

  /** Take a unit off the market (Classic's No Rate); whether it was done. */
  noRate(id: number): boolean {
    return this.result(this.leaf.port.noRate(id)).ok;
  }

  /** Apply a price target to every unit of `kind`; null when the engine
   *  refused (an unpriced kind, or No Rate in Modern). */
  rentBatch(kind: FacilityKind, target: BatchTarget, options: { onlyDefaultPriced?: boolean } = {}): BatchResult | null {
    const rec = this.leaf.port.rentBatch(codeOf(KIND_CODES, kind), batchCode(target), options.onlyDefaultPriced === true);
    this.changed();
    return rec[0] === 1 ? batchResult(VIEW_LAYOUT.records.rentBatch, rec) : null;
  }

  /** What {@link rentBatch} would do, with nothing written; null when refused. */
  quoteRentBatch(kind: FacilityKind, target: BatchTarget, options: { onlyDefaultPriced?: boolean } = {}): BatchResult | null {
    const rec = this.leaf.port.quoteRentBatch(codeOf(KIND_CODES, kind), batchCode(target), options.onlyDefaultPriced === true);
    return rec[0] === 1 ? batchResult(VIEW_LAYOUT.records.quoteRentBatch, rec) : null;
  }

  evaluateStar(): void {
    this.leaf.evaluateStar();
    this.changed();
  }

  /** Sell what stands at a cell (a floor or lobby tile included). */
  sellAt(floor: number, x: number): boolean {
    const unit = this.state.tower.unitAt(floor, x);
    const rec = unit ? this.leaf.port.demolish(unit.id, false) : this.leaf.port.demolishTile(floor, x, false);
    return this.result(rec).ok;
  }

  startFire(): void {
    this.leaf.startFire();
    this.changed();
  }

  bombThreat(): void {
    this.leaf.bombThreat();
    this.changed();
  }

  setMoney(amount: number): void {
    this.leaf.setMoney(amount);
    this.changed();
  }

  /** Free the engine. The kit calls it after each test. */
  release(): void {
    live.delete(this);
    this.leaf.free();
  }
}

/** Run `body` once per engine: `ts` always, `rust` when the engine package is
 *  built. `VC_REQUIRE_WASM=1` (CI's switch) makes a missing package an
 *  error instead of a skip. */
export function describeEngines(name: string, body: (leg: Leg) => void): void {
  describe(`${name} [ts]`, () => {
    afterEach(releaseAll);
    body("ts");
  });
  if (hasWasmPackage()) {
    describe(`${name} [rust]`, () => {
      afterEach(releaseAll);
      body("rust");
    });
  } else if (wasmRequired()) {
    throw new Error(`${name}: the Rust leg needs engine-rs/pkg/; run npm run wasm:build`);
  } else {
    describe.skip(`${name} [rust: no engine package]`, () => undefined);
  }
}

function releaseAll(): void {
  for (const sim of [...live]) sim.release();
}
