/**
 * The frame-rate sampling constants and percentile math behind `session_fps`
 * and the debug HUD's fps row.
 *
 * Split out of `analytics.ts` so the sampling policy sits in one readable place
 * (and so that file stays under the size ceiling). `GameplaySession` still owns
 * the reservoir itself; this module owns only the numbers that describe it and
 * the pure function that reduces it.
 */

/** Fixed cap on the per-session fps sample reservoir: bounded memory no matter
 *  how long a session runs, large enough for a stable p50/p5. */
export const FPS_RESERVOIR = 256;

/** Minimum foreground frames before `session_fps` is worth emitting (about two
 *  seconds at 60fps), so a blink-and-leave visit does not report a meaningless
 *  percentile. */
export const FPS_MIN_SAMPLES = 120;

/** Longest wall-clock gap still treated as one rendered frame (1 second = 1fps).
 *  A gap longer than this is not a slow frame but a loop interruption that did
 *  not route through hide/resume: an in-place WebGL context-loss recovery
 *  (`rebuildEngine`) restarts the render loop while this same page-lifetime
 *  session stays active, so its first frame back would otherwise charge the whole
 *  outage as one sub-1fps sample straight into the worst-frame `low` tail (the
 *  Pixel 8a recovery is exactly #538's scenario). Such a gap re-anchors and is
 *  dropped instead. Realistic device jank down to 1fps is still captured. */
export const FPS_MAX_FRAME_MS = 1000;

export interface FpsPercentiles {
  p50: number;
  p5: number;
  /** The true foreground frame count behind the percentiles, which exceeds
   *  {@link FPS_RESERVOIR} on any session longer than a few seconds. */
  samples: number;
}

/**
 * Reduce a reservoir to whole-fps percentiles, or null below
 * {@link FPS_MIN_SAMPLES} where a percentile would be noise. `p5` is the 5th
 * percentile: sorted ascending, the low tail IS the worst frames, so it is the
 * hitch signal, while `p50` is the typical frame.
 *
 * Sorts a COPY so the caller's reservoir is untouched. That is hygiene, not a
 * correctness guard: Algorithm R draws its replacement index uniformly at
 * random and never reads element order, so an in-place sort would not actually
 * bias the sample. Stated plainly because the weaker, true reason is the one a
 * future reader should weigh, and a comment claiming this protects the sampling
 * would send them chasing a hazard that is not there.
 */
export function fpsPercentilesOf(samples: readonly number[], seen: number): FpsPercentiles | null {
  if (seen < FPS_MIN_SAMPLES) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return { p50: Math.round(at(0.5)), p5: Math.round(at(0.05)), samples: seen };
}
