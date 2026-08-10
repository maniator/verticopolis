/**
 * Timing for the simulation tick, which nothing else can measure.
 *
 * `runFrame` executes INSIDE Excalibur's `onUpdate`, so its cost is folded into
 * `stats.duration.update` and never appears in `stats.systemDuration` (which
 * only covers ECS systems). Without a timer here the HUD can tell you the frame
 * was slow but not whether the sim or the renderer made it slow, which is the
 * first question worth asking.
 *
 * This module is deliberately OUTSIDE the lazily-imported part of `src/debug/`:
 * the frame loop reads it on every frame, so it has to be in the main bundle. It
 * is kept tiny and dependency-free to earn that place, and it is OFF by default,
 * so a session with no debug flags pays one boolean read per frame and makes no
 * `performance.now()` calls at all.
 */

/** Whether the frame loop should time its sim tick. Flipped by the debug
 *  installer; never on in a session that did not ask for debug. */
let enabled = false;

/** The most recent tick's duration in ms. */
let lastMs = 0;

/** The worst tick seen since the last {@link readSimTick}. The HUD samples at
 *  ~4Hz, so an instantaneous read would miss roughly fourteen frames in fifteen
 *  and, with them, exactly the hitch worth catching. */
let peakMs = 0;

/** Sentinel for "timing is off", returned by {@link beginSimTick} so the call
 *  site needs no second flag. Negative because a real `performance.now()`
 *  reading never is. */
const OFF = -1;

export function setSimTimingEnabled(on: boolean): void {
  enabled = on;
  if (!on) {
    lastMs = 0;
    peakMs = 0;
  }
}

export function isSimTimingEnabled(): boolean {
  return enabled;
}

/** Start timing a sim tick. Returns the start stamp, or a negative sentinel
 *  when timing is off (which {@link endSimTick} ignores). */
export function beginSimTick(): number {
  if (!enabled) return OFF;
  return globalThis.performance ? performance.now() : OFF;
}

/** Bank a tick begun at `start`. A sentinel start is a no-op, so the call site
 *  can pass whatever `beginSimTick` gave it without re-testing the flag. */
export function endSimTick(start: number): void {
  if (start < 0 || !globalThis.performance) return;
  const ms = performance.now() - start;
  // A non-finite or negative delta (a clock anomaly) is not a measurement.
  if (!Number.isFinite(ms) || ms < 0) return;
  lastMs = ms;
  if (ms > peakMs) peakMs = ms;
}

/**
 * The latest tick and the worst one since the peak was last cleared.
 *
 * `resetPeak` belongs to whoever owns the display window: the HUD passes true on
 * its refresh tick, so each panel update reports the worst frame in ITS window
 * rather than inheriting a spike that would otherwise sit there forever. Every
 * other caller peeks (the default), because a read that silently consumed the
 * peak would mean `vcdebug.stats()` and the running panel stole it from each
 * other, and whichever asked second saw a zero.
 */
export function readSimTick(resetPeak = false): { lastMs: number; peakMs: number } {
  const out = { lastMs, peakMs };
  if (resetPeak) peakMs = 0;
  return out;
}
