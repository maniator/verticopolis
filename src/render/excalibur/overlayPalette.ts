/**
 * The stats-overlay color palette: the good-to-bad severity ramp and the
 * semantic tint categories that sit outside it. Split out of `towerOverlay.ts`
 * (file-size ceiling) the way the engine splits cohesive leaves; `towerOverlay`
 * re-exports the public pieces so importers keep one entry point.
 */

/** Heatmap ramp stops (green → chartreuse → amber → red). The chartreuse
 *  waypoint gives the green→amber leg real resolution, so the lived-in low end
 *  of a metric (e.g. a healthy tower's congestion) reads as a gradient rather
 *  than one flat green. The congestion overlay pins its amber stop (⅔) to the
 *  churn threshold, see `CONGESTION_AMBER_SEVERITY` in the engine. Module-level
 *  so the color mixer doesn't rebuild the table on every call (it runs once per
 *  visible floor per frame while an overlay is active). */
export const HEAT_STOPS: readonly (readonly [number, number, number])[] = [
  [63, 184, 90], // green (good)
  [163, 199, 71], // chartreuse
  [224, 169, 78], // amber — the congestion overlay pins churn here (see below)
  [214, 52, 47], // red (bad)
];
export const HEAT_SEGS = HEAT_STOPS.length - 1;

/** Colors for the semantic {@link HeatCell.tint} categories, outside the
 *  good-to-bad ramp: `infested` is a violet no ramp position can produce
 *  (terminal "housekeeping can never clean this", distinct from the red
 *  "no crew can reach this"), `na` a faint neutral gray ("this unit does not
 *  take housekeeping", so a blank condo never reads as an uncovered room).
 *  The alphas are tuned for compositing OVER the tower art; the legend uses
 *  the opaque {@link LEGEND_TINT_COLORS} variants so its swatches stay visible
 *  on the dark legend box. */
export const TINT_COLORS: Record<"infested" | "na", string> = {
  infested: "rgba(154,64,214,0.5)",
  na: "rgba(128,134,148,0.18)",
};

/** Opaque swatch variants of {@link TINT_COLORS} for the legend: the map
 *  alphas (0.5 / 0.18) read fine over bright tower art but composite to
 *  near-black squares on the legend's dark backdrop. */
export const LEGEND_TINT_COLORS: Record<"infested" | "na", string> = {
  infested: "rgb(154,64,214)",
  na: "rgb(120,126,140)",
};

/** Severity 0..1 → an rgba tint (green → chartreuse → amber → red) at a fixed
 *  overlay alpha. Linear segments through the evenly-spaced {@link HEAT_STOPS}
 *  so the ramp reads cleanly. Allocation-light (no per-call array/closure) since
 *  it's on the draw path.
 *
 *  Exported for the overlay test that locks the "amber = churn" invariant: the
 *  congestion ramp's `CONGESTION_AMBER_SEVERITY` (⅔) must land exactly on the
 *  amber stop, which holds only while the palette keeps amber at position
 *  ⅔, i.e. a 4-stop ramp. A test asserts that so a palette edit can't silently
 *  break the anchor. */
export function heatColor(severity: number): string {
  // Clamp to [0,1]; the `> 0` form also folds NaN to 0 so a poisoned severity
  // can never index past the palette and throw on the draw path.
  const s = severity > 0 ? (severity > 1 ? 1 : severity) : 0;
  const seg = Math.min(HEAT_SEGS - 1, Math.floor(s * HEAT_SEGS));
  const t = s * HEAT_SEGS - seg; // 0..1 within the segment
  const a = HEAT_STOPS[seg];
  const b = HEAT_STOPS[seg + 1];
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgba(${r},${g},${bl},0.4)`;
}
