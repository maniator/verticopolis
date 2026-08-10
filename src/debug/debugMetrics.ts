/**
 * Shaping and formatting for the debug HUD's numbers. Pure: no DOM, no engine,
 * no Excalibur import. The input is described STRUCTURALLY (see
 * {@link FrameStatsLike}) rather than by importing Excalibur's `FrameStatistics`,
 * so this module stays testable with a plain object literal and adds nothing to
 * the debug chunk's import graph.
 *
 * The one non-obvious job here is {@link snapshotFrame}. Excalibur REUSES its
 * `stats.currFrame` instance every frame rather than reallocating it, so a
 * listener that keeps the object ends up reading whatever the latest frame put
 * there. Every consumer in this tree goes through `snapshotFrame`, which copies
 * the fields out into a plain object that is safe to hold, hand to the console,
 * or diff against a later frame.
 */

/** The subset of Excalibur's `FrameStatistics` the HUD reads. Every member is
 *  optional because this describes another library's object at runtime: a
 *  version that drops or renames a counter should cost that one row, not the
 *  whole panel. */
export interface FrameStatsLike {
  fps?: number;
  elapsedMs?: number;
  duration?: { update?: number; draw?: number; total?: number };
  systemDuration?: Record<string, number>;
  actors?: { alive?: number; killed?: number; remaining?: number; ui?: number; total?: number };
  graphics?: { drawCalls?: number; drawnImages?: number; rendererSwaps?: number };
}

/** One ECS system's cost for a frame. */
export interface SystemCost {
  /** The `systemDuration` key with a redundant `.update` suffix trimmed, e.g.
   *  `draw:GraphicsSystem`. Excalibur's key is
   *  `${systemType}:${ClassName}.${phase}`, and `systemType` is the string enum
   *  `"update"` / `"draw"`, so the prefix is already readable and is kept. A
   *  `.preupdate` / `.postupdate` suffix IS kept, since those are the ones worth
   *  telling apart from the main pass. */
  label: string;
  ms: number;
}

/** A plain, safe-to-retain copy of one frame's statistics. */
export interface FrameSnapshot {
  fps: number;
  elapsedMs: number;
  updateMs: number;
  drawMs: number;
  totalMs: number;
  drawCalls: number;
  drawnImages: number;
  rendererSwaps: number;
  actorsAlive: number;
  actorsTotal: number;
  /** The costliest systems this frame, descending. Length is capped by the
   *  `topN` passed to {@link snapshotFrame}. */
  systems: SystemCost[];
  /** How many systems Excalibur reported a duration for, before the zero-cost
   *  filter. `systemKeys > 0` with an empty `systems` means every reading was
   *  0, which is what a coarsened `performance.now()` looks like, NOT an engine
   *  that has yet to render. The two need telling apart: one is a browser
   *  privacy setting, the other is a bug. */
  systemKeys: number;
}

/** Coerce another library's number to something safe to render. A missing or
 *  non-finite counter becomes 0 rather than printing `NaN` or `undefined`,
 *  which would read as a bug in the game rather than a gap in the telemetry. */
function num(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * The costliest systems in `systemDuration`, descending, capped at `n`.
 *
 * Zero-cost entries are dropped. Excalibur's `FrameStats.reset()` zeroes the
 * existing keys rather than deleting them, so a system that stopped running
 * lingers at 0 forever; without this filter those stale zeros would pad the
 * list and push a real (but cheap) system out of a short top-N.
 *
 * Ties break by label so the list does not shuffle between frames, which would
 * make the panel unreadable at 4Hz.
 */
export function topSystems(systemDuration: Record<string, number> | undefined, n: number): SystemCost[] {
  if (!systemDuration || n <= 0) return [];
  const costs: SystemCost[] = [];
  for (const key of Object.keys(systemDuration)) {
    const ms = num(systemDuration[key]);
    if (ms <= 0) continue;
    costs.push({ label: key.endsWith(".update") ? key.slice(0, -".update".length) : key, ms });
  }
  costs.sort((a, b) => b.ms - a.ms || a.label.localeCompare(b.label));
  return costs.slice(0, n);
}

/** Copy one frame's statistics out of Excalibur's reused instance. See the
 *  module comment: never retain the object this was read from. */
export function snapshotFrame(stats: FrameStatsLike | undefined, topN: number): FrameSnapshot {
  const s = stats ?? {};
  return {
    fps: num(s.fps),
    elapsedMs: num(s.elapsedMs),
    updateMs: num(s.duration?.update),
    drawMs: num(s.duration?.draw),
    totalMs: num(s.duration?.total),
    drawCalls: num(s.graphics?.drawCalls),
    drawnImages: num(s.graphics?.drawnImages),
    rendererSwaps: num(s.graphics?.rendererSwaps),
    actorsAlive: num(s.actors?.alive),
    actorsTotal: num(s.actors?.total),
    systems: topSystems(s.systemDuration, topN),
    systemKeys: s.systemDuration ? Object.keys(s.systemDuration).length : 0,
  };
}

/** True when Excalibur reported systems but every one measured 0 ms, the
 *  signature of a coarsened `performance.now()` (Firefox's
 *  `privacy.resistFingerprinting`, or any context clamped to 1ms). Callers use
 *  it to explain an empty system list instead of claiming no frame has run. */
export function systemTimerTooCoarse(snap: FrameSnapshot): boolean {
  return snap.systems.length === 0 && snap.systemKeys > 0;
}

/** An empty snapshot, for the moment before the first frame has been sampled. */
export function emptySnapshot(): FrameSnapshot {
  return snapshotFrame(undefined, 0);
}

/** Milliseconds at a precision that stays useful across three orders of
 *  magnitude: sub-millisecond system costs need decimals, a 200ms hitch does
 *  not. The panel uses tabular figures, so the varying width does not jitter. */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  if (ms < 10) return ms.toFixed(2);
  if (ms < 100) return ms.toFixed(1);
  return ms.toFixed(0);
}

/** Whole frames per second. Fractional fps is noise at any refresh rate. */
export function formatFps(fps: number): string {
  return Number.isFinite(fps) ? String(Math.round(fps)) : "—";
}

/** A plain integer counter, thousands-separated once it gets long enough to
 *  misread (`drawnImages` reaches five figures on a busy tower). */
export function formatCount(value: number): string {
  return Number.isFinite(value) ? Math.round(value).toLocaleString("en-US") : "—";
}
