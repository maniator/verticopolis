import type { ElevatorQueueView } from "../engine/crowd/person";
import type { HeatCell, HeatmapMode } from "../engine/sim/constants";
import type { GameMode, SerializedView, WeatherKind } from "../engine/types";
import type { CrowdView, TowerView } from "../simport/view";

/**
 * Everything the renderer reads from the simulation, and nothing else (facade
 * slice 3, #1210). `TowerEngine.sim` and the scene modules are typed by this
 * interface, so the compiler lists the read surface and no `src/render` module
 * names `Simulation` (`src/render/renderSim.guard.test.ts` pins that).
 *
 * The live TypeScript `Simulation` satisfies it as it is (`renderSim.types.test.ts`
 * assigns one), so `main.ts` passes the same instance it always did. A Rust
 * adapter fills the same members from the engine's frame.
 *
 * Reads are grouped by how often they happen:
 *
 * - Per frame, cheap: `clock`, `tower.revision`, the effect counters, `weather`.
 * - Per frame, memoized by the engine: `congestion`, `crowd.queueView`.
 * - Per step or per HUD tick: `population` (it walks every room, so a reader
 *   takes it at most once per step and never per frame).
 * - Per scene sync or hourly: `floorHeatmap`, `peakCongestion`, `parkingUsage`,
 *   `recyclingFill`, `positionReachable` (memoized per revision by its caller).
 * - Once per tower: `mode`, `rng.initialSeed`, `view`.
 *
 * The members marked "frame slice" below move behind view slices in slice 3b;
 * the members marked "view" are on `SimView` today.
 */
export interface RenderSim {
  /** The tower's mode, which picks its catalog (`towerCatalog`). */
  readonly mode: GameMode;
  /** The founding seed the scenery derives from; fixed for a tower's life. */
  readonly rng: { readonly initialSeed: number };
  /** The saved camera, restored after a load. Inert cargo the engine never reads. */
  readonly view: SerializedView | null;

  /** View: `header.weather`. */
  readonly weather: WeatherKind;
  /** View: `header.population`. O(R) on the TypeScript engine. */
  readonly population: number;
  /** The clock the renderer reads; `clockView.ts` derives the same answers from `header.minutes`. */
  readonly clock: RenderClock;

  /** View: `tower`, plus the parking set the garage sprites read. */
  readonly tower: RenderTower;
  /** View: `crowd`, plus the elevator queue projection (frame slice). */
  readonly crowd: CrowdView & {
    queueView(tower: RenderTower): ElevatorQueueView;
  };

  /** Effect counters: a change fires one visual. View proposal: `fx`. */
  readonly santaFxSeq: number;
  readonly vipFxSeq: number;
  readonly explosionFx: { readonly floor: number; readonly x: number; readonly seq: number };
  readonly thiefFx: { readonly caught: boolean; readonly floor: number; readonly seq: number };
  readonly treasureFx: { readonly floor: number; readonly x: number; readonly seq: number };

  /** Frame slices (3b): answered by the live engine today. */
  congestion(): number;
  peakCongestion(): number;
  floorHeatmap(mode: HeatmapMode): HeatCell[];
  /** Usage slice: the garage fill for `spots` working spaces, and the recycling fill. */
  parkingUsage(spots: number): number;
  recyclingFill(): number;
  /** Reachability: whether a walker can stand at `floor`, `x`. */
  positionReachable(floor: number, x: number): boolean;
}

/** The clock reads the renderer makes. */
export interface RenderClock {
  readonly hour: number;
  readonly minute: number;
  readonly minuteOfDay: number;
  isMorning(): boolean;
  isEvening(): boolean;
  isNight(): boolean;
}

/** The tower members the renderer reads beyond {@link TowerView}. */
export interface RenderTower extends TowerView {
  /** Working garage spaces by unit id (usage slice). */
  functionalParkingSet(): ReadonlySet<number>;
}
