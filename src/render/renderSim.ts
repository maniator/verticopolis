import type { ElevatorQueueView } from "../shared/engineTypes";
import type { HeatCell, HeatmapMode } from "../shared/engineTypes";
import type { GameMode, SerializedView, WeatherKind } from "../shared/types";
import type { BombSearchView, CrowdView, TowerView } from "../simport/view";
import type { LobbyHalls } from "./lobbyHalls";

/**
 * Everything the renderer reads from the simulation, and nothing else (facade
 * slice 3, #1210). `TowerEngine.sim` and the scene modules are typed by this
 * interface, so the compiler lists the read surface.
 *
 * The port's adapter (`PortRenderSim`) fills these members from the Rust
 * engine's frame (`renderSim.types.test.ts` holds it to the interface).
 *
 * Reads are grouped by how often they happen:
 *
 * - Per frame, cheap: `clock`, `tower.revision`, the effect counters, `weather`.
 * - Per frame, memoized by the engine: `congestion`, `crowd.queueView`.
 * - Per step or per HUD tick: `population` (it walks every room, so it is never
 *   read per frame: `towerPopulation.ts` reads it again only on a revision
 *   change, a new sim, or a step after a 30-frame window, which fixes #1234).
 * - Per scene sync or hourly: `floorHeatmap`, `peakCongestion`, `parkingUsage`,
 *   `recyclingFill`, `positionReachable` (memoized per revision by its caller).
 * - Once per tower: `mode`, `rng.initialSeed`, `view`.
 *
 * Members whose comment starts "View:" are on `SimView` today; those under
 * "Frame slices (3b)" move behind view slices in slice 3b.
 */
export interface RenderSim {
  /** The tower's mode, which picks its catalog (`towerCatalog`). */
  readonly mode: GameMode;
  /** View: `header.sceneSeed`. The founding seed the scenery derives from; fixed for a tower's life. */
  readonly rng: { readonly initialSeed: number };
  /** View: `header.camera`. The saved camera. Read on construction and on `setSim` to restore it (`adoptCamera`); null means no saved view. */
  readonly view: SerializedView | null;

  /** View: `header.weather`. */
  readonly weather: WeatherKind;
  /** View: `header.population`. */
  readonly population: number;
  /** The clock the renderer reads; `clockView.ts` derives the same answers from `header.minutes`. */
  readonly clock: RenderClock;

  /** View: `tower`, plus the parking set the garage sprites read. */
  readonly tower: RenderTower;
  /** View: `crowd`, plus the elevator queue projection (frame slice). */
  readonly crowd: CrowdView & {
    queueView(tower: RenderTower): ElevatorQueueView;
  };

  /** Effect counters: a change fires one visual. View: `header.fx`. */
  readonly santaFxSeq: number;
  readonly vipFxSeq: number;
  readonly explosionFx: { readonly floor: number; readonly x: number; readonly seq: number };
  /** `x`, when the host has it, is a tile of the stretch of floor the thief
   *  prowled, so he runs that tower's rooms on a lot with several. */
  readonly thiefFx: { readonly caught: boolean; readonly floor: number; readonly x?: number; readonly seq: number };
  readonly treasureFx: { readonly floor: number; readonly x: number; readonly seq: number };
  /** Classic's bomb search while one runs, else null. View: `header.bombSearch`. */
  readonly bombSearch?: BombSearchView | null;

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
  /** The game clock in minutes since the start; it moves on every sim step. */
  readonly minutes: number;
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
  /** The lobby halls taller than one story (#308, #2068). Read once per
   *  structure pass, never per frame. */
  tallLobbies(): LobbyHalls;
}
