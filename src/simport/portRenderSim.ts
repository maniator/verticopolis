import type { ElevatorQueueView, QueueLanding } from "../engine/crowd/person";
import type { HeatCell, HeatmapMode } from "../engine/sim/constants";
import type { GameMode, SerializedView, WeatherKind } from "../engine/types";
import type { RenderSim, RenderTower } from "../render/renderSim";
import { ClockReads } from "./clockView";
import type { EnginePort } from "./enginePort";
import type { ViewReader } from "./viewReader";
import type { CrowdView } from "./view";

/**
 * The renderer's `RenderSim` over the port (facade slice 7, PR 5b): the view
 * reads come from the shared `ViewReader`, the rest from the port's render
 * queries, so the renderer draws either engine through one object. The
 * frame loop updates the reader before the renderer reads it.
 *
 * Costs match the TypeScript engine's: the queue projection is decoded once
 * per tower, game minute and revision (the crowd moves only on a step, and a
 * step moves the clock), so a frame between steps reads the kept one without
 * asking the port; the scene sync's parking set is decoded per call, once
 * per sync.
 */
export class PortRenderSim implements RenderSim {
  private readonly clockReads = new ClockReads();
  readonly tower: RenderTower;
  readonly crowd: CrowdView & { queueView(tower: RenderTower): ElevatorQueueView };
  private readonly heatModes: readonly HeatmapMode[];
  private readonly heatTints: readonly string[];
  private queueKey = { gen: NaN, minutes: NaN, revision: NaN };
  private queue: ElevatorQueueView = { landings: new Map(), boarded: new Map() };

  constructor(
    private readonly port: EnginePort,
    private readonly reader: ViewReader,
  ) {
    const l = JSON.parse(port.viewLayout()) as { heatModes: HeatmapMode[]; heatTints: string[] };
    this.heatModes = l.heatModes;
    this.heatTints = l.heatTints;
    const tower = Object.create(reader.tower) as RenderTower & { functionalParkingSet: () => ReadonlySet<number> };
    tower.functionalParkingSet = () => new Set(port.parkingSet().subarray(1));
    this.tower = tower;
    this.crowd = { people: reader.crowd.people, queueView: () => this.queueView() };
  }

  get mode(): GameMode {
    return this.reader.header.mode;
  }
  get rng(): { readonly initialSeed: number } {
    return { initialSeed: this.reader.header.sceneSeed };
  }
  get view(): SerializedView | null {
    return this.reader.header.camera;
  }
  get weather(): WeatherKind {
    return this.reader.header.weather;
  }
  get population(): number {
    return this.reader.header.population;
  }
  get santaFxSeq(): number {
    return this.reader.header.fx.santaSeq;
  }
  get vipFxSeq(): number {
    return this.reader.header.fx.vipSeq;
  }
  get explosionFx() {
    return this.reader.header.fx.explosion;
  }
  get thiefFx() {
    return this.reader.header.fx.thief;
  }
  get treasureFx() {
    return this.reader.header.fx.treasure;
  }

  /** The reader's clock, set from its header on each read without allocating. */
  get clock(): ClockReads {
    return this.clockReads.set(this.reader.header);
  }

  congestion(): number {
    return this.port.congestion();
  }
  peakCongestion(): number {
    return this.port.hotspot()[0];
  }
  floorHeatmap(mode: HeatmapMode): HeatCell[] {
    const r = this.port.heatCells(this.heatModes.indexOf(mode));
    const cells: HeatCell[] = [];
    for (let i = 0; i + 5 <= r.length; i += 5) {
      const cell: HeatCell = { floor: r[i], minX: r[i + 1], maxX: r[i + 2], severity: r[i + 3] };
      if (r[i + 4] > 0) cell.tint = this.heatTints[r[i + 4]] as HeatCell["tint"];
      cells.push(cell);
    }
    return cells;
  }
  parkingUsage(spots: number): number {
    return this.port.parkingUsage(spots);
  }
  recyclingFill(): number {
    return this.port.recyclingFill();
  }
  positionReachable(floor: number, x: number): boolean {
    return this.port.positionReachable(floor, x);
  }

  private queueView(): ElevatorQueueView {
    const h = this.reader.header;
    const k = this.queueKey;
    const gen = this.port.generation();
    if (k.gen === gen && k.minutes === h.minutes && k.revision === h.revision) return this.queue;
    const r = this.port.queueView();
    const landings = new Map<number, Map<number, QueueLanding>>();
    const boarded = new Map<number, Map<number, number>>();
    let at = 2;
    for (let i = 0; i < r[0]; i++, at += 4) {
      let floors = landings.get(r[at]);
      if (!floors) landings.set(r[at], (floors = new Map()));
      floors.set(r[at + 1], { count: r[at + 2], tier: r[at + 3] as QueueLanding["tier"] });
    }
    for (let i = 0; i < r[1]; i++, at += 3) {
      let cars = boarded.get(r[at]);
      if (!cars) boarded.set(r[at], (cars = new Map()));
      cars.set(r[at + 1], r[at + 2]);
    }
    k.gen = gen;
    k.minutes = h.minutes;
    k.revision = h.revision;
    this.queue = { landings, boarded };
    return this.queue;
  }
}
