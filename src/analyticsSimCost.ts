/**
 * The session's engine cost: how long the engine's steps took per game hour,
 * with the tower's peak population and the game speed the player mostly ran.
 * The frame loop times each `advance` call and hands the time here with the
 * game clock after it ({@link SimCostTally.note}); `analyticsSession.ts` sends
 * the summary once per session as `session_sim_cost`, and adds the population
 * and speed to `session_fps` so frame rates can be compared tower size to
 * tower size.
 *
 * Only frames whose clock moved forward by a believable amount count toward
 * the cost: a pause, a modal freeze, a loaded tower or a new day's wrap moves
 * the clock by nothing, backward or by a jump, and is left out, so the figure
 * is engine milliseconds per game hour actually stepped.
 */

/** Fewest game hours stepped before `session_sim_cost` is worth sending. */
export const SIM_COST_MIN_GAME_HOURS = 2;

/** Most game minutes one frame can step (4 steps of at most 20 minutes, plus
 *  slack); a larger move is a load or a jump, not a step. */
const MAX_FRAME_GAME_MINUTES = 120;

export class SimCostTally {
  private stepMs = 0;
  private gameMinutes = 0;
  private lastClock: number | null = null;
  private peak = 0;
  /** Frames seen at each speed (game minutes per real second). */
  private readonly framesBySpeed = new Map<number, number>();

  /** One frame's step: `ms` the `advance` call took, `clock` the game clock in
   *  minutes after it, `speed` the minutes per second it ran at, and the
   *  tower's population. */
  note(ms: number, clock: number, speed: number, population: number): void {
    if (Number.isFinite(population) && population > this.peak) this.peak = population;
    if (Number.isFinite(speed)) this.framesBySpeed.set(speed, (this.framesBySpeed.get(speed) ?? 0) + 1);
    const prev = this.lastClock;
    this.lastClock = Number.isFinite(clock) ? clock : null;
    if (prev === null || this.lastClock === null) return;
    const moved = this.lastClock - prev;
    if (!(moved > 0) || moved > MAX_FRAME_GAME_MINUTES || !Number.isFinite(ms) || ms < 0) return;
    this.stepMs += ms;
    this.gameMinutes += moved;
  }

  /** Forget the last clock reading, so the first frame after a hidden stretch
   *  sets a new anchor instead of counting the gap. */
  reanchor(): void {
    this.lastClock = null;
  }

  /** The highest population seen this session. */
  get peakPopulation(): number {
    return this.peak;
  }

  /** Game hours stepped by the counted frames. */
  get gameHours(): number {
    return this.gameMinutes / 60;
  }

  /** Engine milliseconds per game hour stepped, or 0 before any hour ran. */
  get msPerGameHour(): number {
    return this.gameMinutes > 0 ? (this.stepMs * 60) / this.gameMinutes : 0;
  }

  /** The speed the most frames ran at; with `running` true, paused frames
   *  (speed 0) are left out. 0 when no frame qualifies. */
  mainSpeed(running: boolean): number {
    let best = 0;
    let most = 0;
    for (const [speed, frames] of this.framesBySpeed) {
      if (running && speed <= 0) continue;
      if (frames > most) {
        best = speed;
        most = frames;
      }
    }
    return best;
  }
}
