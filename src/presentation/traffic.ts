/**
 * Pure congestion → traffic-tier mapping for the color-blind-safe traffic cue.
 * Kept pure and headless so it's unit-testable and shared by the HUD chip and
 * the congestion overlay legend.
 *
 * Fed the tower's PEAK per-floor congestion (`Simulation.peakCongestion()`) —
 * its busiest populated-and-served floor — so it reflects the worst pressure
 * point, matching the overlay legend and the original's spatial cues (red
 * walkers, the congestion heatmap). The thresholds are calibrated to the range
 * the spatial model actually emits: measured across real towers, a well-built
 * tower peaks around 0.2–0.3 (Smooth), a genuinely under-served or packed floor
 * pushes past 0.8–1.5, and a real jam runs 1.5+.
 *
 * This is NOT the walker-red gate. Red frustrated walkers are an ACUTE per-person
 * symptom driven by `stress = clamp(congestion - 1)` on the rider's own floor
 * (red once that floor crosses ~1.0+); the chip is an EARLIER tower-level warning
 * that a floor is tightening before anyone turns red. The two are distinct
 * signals on purpose — don't recouple them.
 */
export type TrafficTier = 0 | 1 | 2 | 3;

/** Lower edges of Busy / Backed up / Gridlock on PEAK congestion. The single
 *  source of truth: `trafficTier` maps with these, and the HUD's anti-flicker
 *  hysteresis gate reads the same array, so the raw tier and the smoothed tier
 *  can never desync from a one-sided edit. */
export const TRAFFIC_BOUNDS = [0.4, 0.8, 1.5] as const;

export function trafficTier(congestion: number): TrafficTier {
  const [busy, backedUp, gridlock] = TRAFFIC_BOUNDS;
  if (congestion > gridlock) return 3; // Gridlock — a floor is genuinely jammed
  if (congestion > backedUp) return 2; // Backed up — a reachable floor is overloaded
  if (congestion >= busy) return 1; // Busy — the tower is tightening
  return 0; // Smooth
}

export const TRAFFIC_LABELS = ["Smooth", "Busy", "Backed up", "Gridlock"] as const;

/** A shape-coded 4-step bar glyph — filled cells (▮) up to the tier, empty (▯)
 *  after — legible in grayscale, so the cue never depends on color alone. */
export function trafficGlyph(tier: TrafficTier): string {
  const on = "▮";
  const off = "▯";
  return on.repeat(tier + 1) + off.repeat(3 - tier);
}
