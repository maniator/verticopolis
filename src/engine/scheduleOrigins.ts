/**
 * Per-floor demand-origin accumulator for the Schedule dialog's readouts
 * (elevator-scheduling #465). A transient, day-split ring of hourly boarding
 * counts bucketed by origin floor, folded from the boardings the dispatcher
 * already computes: sampling only, no RNG, no sim-behavior read-back, and
 * NEVER serialized (a persisted accumulator is a save-format conversation
 * this feature does not open; spec §16, Cloud's constraint).
 *
 * Shape mirrors the day-split demand rings (#466): one 24-slot ring per day
 * type, each slot an origin-floor map EMA'd hourly with the same 0.3/0.7
 * blend. Two deliberate differences from the demand ring: the tally covers a
 * whole hour, so the fold site attributes it to the hour that ENDED (the
 * demand frac is instantaneous and stays on the current hour), and the
 * full-value first-sample seed applies only to an EMPTY slot, so a floor that
 * decays out and returns blends back in instead of snapping to full weight.
 * Pure helpers only; `Simulation` owns the per-shaft store and the hourly
 * fold site lives beside `sampleElevatorUtil`.
 */

export const ORIGIN_HOURS = 24;

/** One shaft's boarding-origin history: per day type, per hour-of-day, an
 *  origin-floor map of EMA'd boarding counts. Transient, like {@link HourlyByDay}. */
export interface OriginRings {
  weekday: Map<number, number>[];
  weekend: Map<number, number>[];
}

export function emptyOriginRings(): OriginRings {
  return {
    weekday: Array.from({ length: ORIGIN_HOURS }, () => new Map<number, number>()),
    weekend: Array.from({ length: ORIGIN_HOURS }, () => new Map<number, number>()),
  };
}

/** Floors whose EMA'd boarding count (absolute mass, not a normalized share)
 *  decays below this are dropped from the slot map, so a floor that stopped
 *  generating trips fades out instead of lingering. */
const PRUNE_BELOW = 0.05;

/**
 * Fold one hour's boarding counts into the slot for `(day, hour)`. The same
 * EMA rule as the demand ring: `0.3 * new + 0.7 * old`, with floors absent
 * this hour decaying by the same blend and pruned once negligible. The
 * full-value first-sample seed applies only when the WHOLE slot is empty:
 * a previously pruned floor re-entering an active slot blends in at sample
 * weight, so an intermittent floor cannot oscillate between full and gone.
 */
export function foldOrigins(rings: OriginRings, isWeekend: boolean, hour: number, counts: ReadonlyMap<number, number> | undefined): void {
  const slot = (isWeekend ? rings.weekend : rings.weekday)[((hour % ORIGIN_HOURS) + ORIGIN_HOURS) % ORIGIN_HOURS];
  const firstSample = slot.size === 0;
  for (const [floor, prev] of slot) {
    const sampled = counts?.get(floor) ?? 0;
    const next = 0.3 * sampled + 0.7 * prev;
    if (next < PRUNE_BELOW) slot.delete(floor);
    else slot.set(floor, next);
  }
  if (counts) {
    for (const [floor, n] of counts) {
      if (n <= 0 || slot.has(floor)) continue; // existing floors were blended above
      const seeded = firstSample ? n : 0.3 * n;
      if (seeded >= PRUNE_BELOW) slot.set(floor, seeded);
    }
  }
}

/** The day's origin mass summed across all 24 slots, floor by floor: the
 *  staging-aim input (#465). A single peak-hour slot is the wrong basis for
 *  staging (the demand peak is often the lobby-dominated up-rush, and a slot
 *  can be empty at the exact sampled instant), so the aim reads the whole
 *  day's boarding geography instead. */
export function dayOriginTotals(ring: ReadonlyArray<ReadonlyMap<number, number>>): Map<number, number> {
  const totals = new Map<number, number>();
  for (const slot of ring) {
    for (const [floor, n] of slot) totals.set(floor, (totals.get(floor) ?? 0) + n);
  }
  return totals;
}

/**
 * The top origin floors of one slot map, busiest first: floors carrying at
 * least `minShare` of the slot's total boardings, capped at `k`. Empty when
 * the slot has no measured mass, so callers can gate rendering on length.
 */
export function topOriginFloors(slot: ReadonlyMap<number, number> | undefined, k = 3, minShare = 0.15): number[] {
  if (!slot || slot.size === 0) return [];
  let total = 0;
  for (const n of slot.values()) total += n;
  if (total <= 0) return [];
  return [...slot.entries()]
    .filter(([, n]) => n / total >= minShare)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, k)
    .map(([floor]) => floor);
}

/** The single busiest origin floor of a slot, or undefined with no data. The
 *  demand-aimed Auto-tune staging seed reads this (#465). */
export function peakOriginFloor(slot: ReadonlyMap<number, number> | undefined): number | undefined {
  const top = topOriginFloors(slot, 1, 0);
  return top.length > 0 ? top[0] : undefined;
}
