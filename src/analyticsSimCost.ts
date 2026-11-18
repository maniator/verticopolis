/**
 * The session's engine cost: how long the engine's steps took per game hour,
 * at the tower size and game speed the session spent most of its game time
 * at. The frame loop times each `advance` call and hands the time here with
 * the game clock after it ({@link SimCostTally.note}); `analyticsSession.ts`
 * sends the summary once per reporting window as `session_sim_cost`, and adds
 * the peak population and the running speed to `session_fps`.
 *
 * Only frames whose clock moved forward by a believable amount on the same
 * tower count toward the cost: a pause, a modal freeze, a new day's wrap or a
 * jump moves the clock by nothing, backward or too far, and a tower that was
 * opened, founded, undone or redone has a new engine generation, so its first
 * frame only re-anchors. The figure is engine milliseconds per game hour
 * actually stepped.
 *
 * The time is kept apart per population band and speed, the same bands the
 * dashboard groups by, and the summary reports the one cell with the most
 * game minutes. So a small tower played for hours and a large one opened at
 * the end are never blended, and a few minutes at the fastest speed do not
 * relabel hours at the slowest.
 */

/** Fewest game hours stepped, in the reported cell, before `session_sim_cost`
 *  is worth sending. */
export const SIM_COST_MIN_GAME_HOURS = 2;

/** Most game minutes one frame can step (4 steps of at most 20 minutes, plus
 *  slack); a larger move is a load or a jump, not a step. */
const MAX_FRAME_GAME_MINUTES = 120;

/** The population band limits the dashboard tiles group by: under 1,000,
 *  1,000 to 4,999, 5,000 to 9,999, and 10,000 or more. */
const POPULATION_BAND_LIMITS: readonly number[] = [1_000, 5_000, 10_000];

/** Which band a population falls in, counted from 0. */
function populationBand(population: number): number {
  let band = 0;
  while (band < POPULATION_BAND_LIMITS.length && population >= POPULATION_BAND_LIMITS[band]) band++;
  return band;
}

/** Engine time and game time stepped at one population band and speed. */
interface CostCell {
  ms: number;
  minutes: number;
  /** The highest population stepped in this cell. */
  peak: number;
}

/** The cell a summary reports, with the speed it was stepped at. */
export interface SimCostSummary {
  msPerGameHour: number;
  gameHours: number;
  population: number;
  speed: number;
}

export class SimCostTally {
  private lastClock: number | null = null;
  private lastTower: number | null = null;
  private peak = 0;
  /** Running frames seen at each speed (game minutes per real second);
   *  paused frames (speed 0) are not counted. */
  private readonly framesBySpeed = new Map<number, number>();
  /** Per running speed, one cost cell per population band. */
  private readonly cellsBySpeed = new Map<number, CostCell[]>();

  /** One frame's step: `ms` the `advance` call took, `clock` the game clock in
   *  minutes after it, `speed` the minutes per second it ran at, the tower's
   *  population, and `tower` the engine generation the frame read. */
  note(ms: number, clock: number, speed: number, population: number, tower: number): void {
    if (Number.isFinite(population) && population > this.peak) this.peak = population;
    const running = Number.isFinite(speed) && speed > 0;
    if (running) this.framesBySpeed.set(speed, (this.framesBySpeed.get(speed) ?? 0) + 1);
    const prev = this.lastClock;
    const sameTower = tower === this.lastTower;
    this.lastClock = Number.isFinite(clock) ? clock : null;
    this.lastTower = tower;
    if (prev === null || this.lastClock === null || !sameTower || !running) return;
    const moved = this.lastClock - prev;
    if (!(moved > 0) || moved > MAX_FRAME_GAME_MINUTES || !Number.isFinite(ms) || ms < 0) return;
    const cell = this.cell(speed, Number.isFinite(population) ? populationBand(population) : 0);
    cell.ms += ms;
    cell.minutes += moved;
    if (population > cell.peak) cell.peak = population;
  }

  /** Forget the last clock reading, so the first frame after a hidden stretch
   *  sets a new anchor instead of counting the gap. */
  reanchor(): void {
    this.lastClock = null;
  }

  /** The highest population seen this window. */
  get peakPopulation(): number {
    return this.peak;
  }

  /** The running speed the most frames ran at, or 0 when the game never ran.
   *  Frame-weighted, like the fps samples it labels. */
  mainSpeed(): number {
    let best = 0;
    let most = 0;
    for (const [speed, frames] of this.framesBySpeed) {
      if (frames > most) {
        best = speed;
        most = frames;
      }
    }
    return best;
  }

  /** The population band and speed with the most game minutes stepped, or
   *  null before any step counted. */
  summary(): SimCostSummary | null {
    let best: SimCostSummary | null = null;
    let most = 0;
    for (const [speed, cells] of this.cellsBySpeed) {
      for (const cell of cells) {
        if (cell.minutes <= most) continue;
        most = cell.minutes;
        best = { msPerGameHour: (cell.ms * 60) / cell.minutes, gameHours: cell.minutes / 60, population: cell.peak, speed };
      }
    }
    return best;
  }

  private cell(speed: number, band: number): CostCell {
    let cells = this.cellsBySpeed.get(speed);
    if (!cells) {
      cells = Array.from({ length: POPULATION_BAND_LIMITS.length + 1 }, () => ({ ms: 0, minutes: 0, peak: 0 }));
      this.cellsBySpeed.set(speed, cells);
    }
    return cells[band];
  }
}
