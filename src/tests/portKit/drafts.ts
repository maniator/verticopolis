import type { SerializedGame, Transport, Unit } from "../../shared/types";
import type { NextStarView, StatsReport } from "../../simport/panels";
import type { EnginePort } from "../../simport/enginePort";
import { ToolingTower, type ToolingEngine } from "../../game/toolingTower";
import { wasm } from "../conformance/wasmEngine";
import type { WasmEngine } from "../../engineBinding/binding";

/**
 * The port kit's drafts (a fixture's authoring copy on an engine of its own)
 * and {@link Snapshot}, the read-only view a test checks. Split out of
 * `portSim.ts`, which re-exports all of it.
 */

/** What a {@link Snapshot} reads: a `PortSim`'s port, save, stats report and
 *  frame header. */
export interface SnapshotSource {
  readonly port: EnginePort;
  save(): string;
  statsReport(): StatsReport;
  frameSlot(name: string): number;
}

/** The engine a suite runs on. One since the TypeScript engine left (#1875);
 *  the parameter stays so a suite reads the same. */
export type Leg = "rust";

/** A fixture's authoring copy: the tooling tower's shape of the old
 *  `Simulation` (`tower.place`, record views, `money`, `star`, `build`). */
export type Draft = ToolingTower;

/** A tower's record as a test reads it. */
export type UnitRecord = Readonly<Unit>;

/** Drafts the kit made, freed with the engines. */
const drafts = new Set<WasmEngine>();

function adopt(engine: WasmEngine): Draft {
  drafts.add(engine);
  return new ToolingTower(() => engine as unknown as ToolingEngine);
}

/** A new tower to author a fixture on, as `Simulation.newGame` was.
 *  `calendar` is Modern's calendar key ("realWorld" or "canon"). */
export function draftTower(seed = 12345, mode: "classic" | "modern" = "classic", calendar?: string): Draft {
  return adopt(wasm().Engine.newGame(seed, mode, calendar ?? null));
}

/** A choice waiting on the player, as the save carries it. */
export interface PendingChoiceRecord {
  readonly kind: string;
  readonly cost: number;
  readonly message: string;
}

/** A draft opened on save text (a fixture file, an edited save). */
export function draftFromSave(save: string | object): Draft {
  return adopt(wasm().Engine.fromSave(typeof save === "string" ? save : JSON.stringify(save)));
}

/**
 * What a test may read of the engine: its save through the tooling tower's
 * record views (a unit's left-out defaults read back), plus the computed reads
 * the old `Simulation` copy answered, each from the engine's own port.
 */
export class Snapshot {
  private readonly view: ToolingTower;
  private saved: SerializedGame | undefined;
  private report: StatsReport | undefined;

  constructor(private readonly sim: SnapshotSource) {
    this.view = new ToolingTower(() => sim.port as unknown as ToolingEngine);
  }

  private save(): SerializedGame {
    this.saved ??= JSON.parse(this.sim.save()) as SerializedGame;
    return this.saved;
  }

  private stats(): StatsReport {
    this.report ??= this.sim.statsReport();
    return this.report;
  }

  get money(): number { return this.view.money; }
  get star(): number { return this.view.star; }
  get mode(): string { return this.view.mode; }
  get log(): NonNullable<SerializedGame["log"]> { return this.view.log ?? []; }
  get events(): { readonly pending: PendingChoiceRecord | null } {
    return { pending: (this.save().events as { pending?: PendingChoiceRecord | null } | undefined)?.pending ?? null };
  }
  get clock(): { readonly minutes: number; readonly day: number; readonly minuteOfDay: number; readonly hour: number } {
    const { minutes, day, minuteOfDay } = this.view.clock;
    return { minutes, day, minuteOfDay, hour: Math.floor(minuteOfDay / 60) };
  }
  /** The milestones the tower has reached, by id. */
  get milestones(): readonly string[] { return (this.save().milestones as string[] | undefined) ?? []; }
  /** The random stream's state, which the save carries as `seed`. */
  get rng(): { readonly seed: number } { return { seed: this.save().seed }; }
  /** The HUD population (the frame header's). */
  get population(): number { return this.sim.frameSlot("population"); }
  /** Rooms burning now. */
  get fires(): number { return this.tower.units.filter((u) => u.state === "fire").length; }
  get tower(): {
    readonly units: readonly UnitRecord[];
    readonly transports: readonly Readonly<Transport>[];
    unitAt(floor: number, x: number): UnitRecord | undefined;
    getUnit(id: number): UnitRecord | undefined;
    getTransport(id: number): Readonly<Transport> | undefined;
    totalPopulation(): number;
  } {
    const parts = this.view.tower;
    return {
      units: parts.units as unknown as UnitRecord[],
      transports: parts.transports as unknown as Transport[],
      unitAt: (floor, x) => parts.unitAt(floor, x) as unknown as UnitRecord | undefined,
      getUnit: (id) => parts.getUnit(id) as unknown as UnitRecord | undefined,
      getTransport: (id) => parts.getTransport(id) as unknown as Transport | undefined,
      totalPopulation: () => this.population,
    };
  }
  /** The next star's requirements, as the stats screen answers them. */
  nextStarRequirements(): NextStarView | null { return this.stats().nextStar; }
  /** The ledger's averages, as the stats screen answers them. */
  incomeBreakdown(): StatsReport["income"] { return this.stats().income; }
}

/** Free the drafts the kit made. */
export function releaseDrafts(): void {
  for (const engine of drafts) engine.free();
  drafts.clear();
}
