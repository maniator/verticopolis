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
 * blend and first-sample seeding, so the two accumulators warm and decay in
 * step. Pure helpers only; `Simulation` owns the per-shaft store and the
 * hourly fold site lives beside `sampleElevatorUtil`.
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

/** Floors whose EMA'd share decays below this are dropped from the slot map,
 *  so a floor that stopped generating trips fades out instead of lingering. */
const PRUNE_BELOW = 0.05;

/**
 * Fold one hour's boarding counts into the slot for `(day, hour)`. The same
 * EMA rule as the demand ring: a floor's first positive sample lands at full
 * value; after that `0.3 * new + 0.7 * old`. Floors absent this hour decay by
 * the same blend and are pruned once negligible.
 */
export function foldOrigins(rings: OriginRings, isWeekend: boolean, hour: number, counts: ReadonlyMap<number, number> | undefined): void {
  const slot = (isWeekend ? rings.weekend : rings.weekday)[((hour % ORIGIN_HOURS) + ORIGIN_HOURS) % ORIGIN_HOURS];
  for (const [floor, prev] of slot) {
    const sampled = counts?.get(floor) ?? 0;
    const next = 0.3 * sampled + 0.7 * prev;
    if (next < PRUNE_BELOW) slot.delete(floor);
    else slot.set(floor, next);
  }
  if (counts) {
    for (const [floor, n] of counts) {
      if (n <= 0 || slot.has(floor)) continue; // existing floors were blended above
      slot.set(floor, n); // first positive sample lands at full value
    }
  }
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
