import { afterEach, describe } from "vitest";
import type { FacilityKind, UnitState } from "@verticopolis/engine/model/types";
import type { EnginePort } from "@verticopolis/engine/port/enginePort";
import type { StatsReport } from "@verticopolis/engine/port/panels";
import { PortCodes } from "@verticopolis/engine/port/portCodes";
import { statsReport } from "@verticopolis/engine/port/statsSheet";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";
import type { WasmEngine } from "@verticopolis/engine/binding/binding";
import { rustTooling, type ToolingSetters } from "./tooling";
import { Snapshot, draftFromSave, releaseDrafts, type Draft, type Leg } from "./drafts";

export {
  Snapshot,
  draftFromSave,
  draftTower,
  type Draft,
  type Leg,
  type PendingChoiceRecord,
  type SnapshotSource,
  type UnitRecord,
} from "./drafts";

/**
 * The test kit for suites that run on the engine port (#878, #1421; PR 7 of
 * the engine port contract). A suite names its engine with
 * {@link describeEngines} and drives one {@link PortSim} per test on the Rust
 * `Engine`, the engine the game ships. Until #1875 the same bodies also ran on
 * the TypeScript engine; that leg is gone with it.
 *
 * The engine is the authority. A test acts on it through port commands
 * ({@link PortSim.build}, {@link PortSim.buildTransport}, `tick`) and the
 * tooling-only members ({@link PortSim.startFireAt}, `setMoney`,
 * `setUnitState`, `setCustomersIn`), and reads it through {@link PortSim.state}, a read-only view
 * of the engine's own save. A fixture's raw tower edits (`tower.place`, a
 * unit's state, the star) go through {@link PortSim.setup} or a
 * {@link draftTower}: a tooling tower (`src/game/toolingTower.ts`) on an
 * engine of its own takes the edits, and the engine loads its save, the same
 * path a saved tower takes into the game. `setup` is allowed only before the
 * engine's first tick after a load; once a crowd exists a test needs a
 * tooling-only member instead, and `setup` says so.
 */

interface Leaf extends ToolingSetters {
  readonly port: EnginePort;
  /** The tooling-only members (binding tier 3); the setters are {@link ToolingSetters}. */
  setMoney(amount: number): void;
  free(): void;
}

function makeLeaf(save: string): Leaf {
  const engine: WasmEngine = wasm().Engine.fromSave(save);
  return {
    port: engine as unknown as EnginePort,
    setMoney: (amount) => engine.setMoney(amount),
    ...rustTooling(engine),
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

export class PortSim {
  private leaf: Leaf;
  private cached: Snapshot | undefined;
  private ticked = false;
  /** A write the save does not carry, which a later `setup` would drop. */
  private unsavedWrite = false;

  private readonly codes: PortCodes;

  /** A simulation on `leg` that starts from `source`: a {@link Draft} (a
   *  fixture's authoring copy; nothing reads it afterwards) or save text the
   *  engine loads itself, such as an edited or forged save. */
  constructor(
    readonly leg: Leg,
    source: Draft | string,
  ) {
    this.leaf = makeLeaf(typeof source === "string" ? source : source.saveText());
    this.codes = new PortCodes(this.leaf.port);
    live.add(this);
  }

  /** The engine's port, for the calls the port has and this class does not
   *  wrap. A call that writes the tower must go through a wrapper or
   *  {@link changed} so the read-only copy follows. */
  get port(): EnginePort {
    return this.leaf.port;
  }

  /** A read-only view of the engine's save, read again after any write. */
  get state(): Snapshot {
    this.cached ??= new Snapshot(this);
    return this.cached;
  }

  /** A slot of the frame header by its layout name, read from the engine now
   *  (the counters the save does not carry, such as the emergency tallies). */
  frameSlot(name: string): number {
    const layout = JSON.parse(this.leaf.port.viewLayout()) as { header: Record<string, number> };
    const at = layout.header[name];
    if (at === undefined) throw new Error(`PortSim.frameSlot: the frame header has no slot ${name}`);
    return this.leaf.port.viewFrame(true)[at];
  }

  /** The stats screen as the engine answers it (`statsSheet`): the HUD strip,
   *  the ledger averages, the next star, the milestones, the elevator rows. */
  statsReport(): StatsReport {
    return statsReport(this.leaf.port.statsSheet(), new PortCodes(this.leaf.port));
  }

  /** The engine's save text. */
  save(): string {
    return this.leaf.port.serialize();
  }

  /** Tell the kit a write went around its wrappers. */
  changed(): void {
    this.cached = undefined;
  }

  /** Edit the tower as a fixture: `edit` gets a {@link Draft} opened on the
   *  engine's save, and the engine loads the result. Only before the first
   *  tick since the last load; take ids out of the draft, since its records
   *  are not the engine's. */
  setup<T = void>(edit: (draft: Draft) => T): T {
    if (this.ticked) {
      throw new Error(
        "PortSim.setup runs before the engine's first tick; a mid-run write needs a tooling-only member on the engine",
      );
    }
    if (this.unsavedWrite)
      throw new Error(
        "PortSim.setup reloads the engine from its save, which would drop an earlier setCustomersIn; call setup first",
      );
    const draft = draftFromSave(this.leaf.port.serialize());
    const out = edit(draft);
    const answer = this.leaf.port.loadSave(draft.saveText());
    if (answer[0] !== 1)
      throw new Error(
        `PortSim.setup: the engine refused the edited save: ${this.leaf.port.lastReason() ?? "no reason"}`,
      );
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
    return this.result(this.leaf.port.buildAt(this.codes.kind(kind), floor, x));
  }

  buildTransport(kind: FacilityKind, x: number, bottom: number, top: number): CommandResult {
    return this.result(this.leaf.port.buildShaft(this.codes.kind(kind), x, bottom, top));
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

  /** Start a fire in room `id` as the daily roll's outbreak does, with the
   *  paid-rescue offer, drawing nothing from the random stream. */
  startFireAt(id: number): void {
    if (!this.leaf.startFireAt(id)) throw new Error(`PortSim.startFireAt: the engine refused ${id}`);
    this.changed();
  }

  /** Answer the pending choice; false when none was pending. */
  answerChoice(accept: boolean): boolean {
    return this.result(this.leaf.port.answerChoice(accept)).ok;
  }

  setMoney(amount: number): void {
    this.leaf.setMoney(amount);
    this.changed();
  }

  /** Set a unit's state, and its occupants when given, mid-run. */
  setUnitState(id: number, state: UnitState, occupants?: number): void {
    if (!this.leaf.setUnitState(id, state, occupants))
      throw new Error(
        `PortSim.setUnitState: the engine refused unit ${id} ${state}${occupants === undefined ? "" : ` x${occupants}`}`,
      );
    this.changed();
  }

  /** Set a unit's live customer tally (`customersIn`), which lives outside
   *  the save: how a test fills a venue to capacity. The unit's kind and its
   *  venue cap are not checked, so any count from 0 to
   *  `Number.MAX_SAFE_INTEGER` is taken; anything else throws. An attendance
   *  venue's occupants follow the tally. A later `setup` throws, since its
   *  reload would drop the stamp. */
  setCustomersIn(id: number, count: number): void {
    if (!this.leaf.setCustomersIn(id, count))
      throw new Error(`PortSim.setCustomersIn: the engine refused unit ${id} customers ${count}`);
    this.unsavedWrite = true;
    this.changed();
  }

  /** Free the engine. The kit calls it after each test. */
  release(): void {
    live.delete(this);
    this.leaf.free();
  }
}

/** Run `body` on the Rust engine when the package is built, and skip it
 *  otherwise. */
export function describeEngines(name: string, body: (leg: Leg) => void): void {
  if (hasWasmPackage()) {
    describe(`${name} [rust]`, () => {
      afterEach(releaseAll);
      body("rust");
    });
  } else {
    describe.skip(`${name} [rust: no engine package]`, () => undefined);
  }
}

/** The engine a test that names none uses. */
export function defaultLeg(): Leg {
  return "rust";
}

/** Free every engine the kit started. A test that makes engines outside
 *  {@link describeEngines} calls it from an `afterEach`. */
export function releaseAll(): void {
  for (const sim of [...live]) sim.release();
  releaseDrafts();
}
