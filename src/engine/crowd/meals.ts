import type { FacilityKind } from "../types";
import { isHotelKind } from "../facilities";
import { HK_SHIFT_END, HK_SHIFT_START } from "../EconomySystem";
import type { StaffKind } from "./person";

/**
 * Meal cadence (gdd/arch-tower-wide-meal-cadence-2026-07-09). Four meal windows
 * drive real transport pressure: every "eating" population (offices, condos,
 * hotel guests, on-shift staff) spawns outbound trips to open food venues near
 * the peak of its window and lagged return trips near the tail. Trip options
 * feed the same weighted `options` array {@link Crowd.spawnTrips} already uses,
 * so the `MAX_PEOPLE` cap self-balances the pool. Economy is untouched:
 * `collectTrafficIncome` already models demand volume through appeal factors;
 * the meal-cadence change just makes the shafts feel the demand.
 *
 * Extracted from `Crowd.ts` as pure helpers the spawn path imports.
 */

export const MEAL_WINDOWS = {
  breakfast: { start: 6, end: 9, venues: ["fastFood"] as FacilityKind[] },
  lunch: { start: 11, end: 14, venues: ["fastFood", "restaurant"] as FacilityKind[] },
  dinner: { start: 17, end: 20, venues: ["fastFood", "restaurant"] as FacilityKind[] },
  lateNight: { start: 21, end: 24, venues: ["fastFood", "cinema"] as FacilityKind[] },
} as const;

export type MealWindow = keyof typeof MEAL_WINDOWS;

/** The window whose `[start, end)` covers `hour`, or null when off-window.
 *  Lunch (11-14) matches {@link Clock.isLunch} byte-for-byte. */
export function mealWindowFor(hour: number): MealWindow | null {
  for (const k of Object.keys(MEAL_WINDOWS) as MealWindow[]) {
    const w = MEAL_WINDOWS[k];
    if (hour >= w.start && hour < w.end) return k;
  }
  return null;
}

/** Whether a staff kind is eligible to make meal trips at this hour. Only
 *  housekeeping has a modeled shift window today; pass the mode's window
 *  (`GameRules.housekeepingShift()`: Classic the canon 12:00-17:00, Modern
 *  08:00-19:00) so the meal texture follows the maids' real hours. Callers
 *  without a rule-set fall back to the legacy [HK_SHIFT_START, HK_SHIFT_END)
 *  in `EconomySystem`. Security, medical, and recycling are always eligible
 *  while their facility is operational. If a future kind gains a shift, add
 *  its case here alongside the new constants, so the gate stays single-source. */
export function staffOnShift(kind: StaffKind, hour: number, shift?: { start: number; end: number }): boolean {
  if (kind === "housekeeping") return hour >= (shift?.start ?? HK_SHIFT_START) && hour < (shift?.end ?? HK_SHIFT_END);
  return true;
}

/**
 * Per-window origin mix (arch §4). The table is authoritative; adding a new
 * meal window means one row. Weights come from {@link ECON.mealPopulationWeights}.
 */
export type MealOriginKind = "office" | "condo" | "hotel" | "staff";
type MealMix = { origins: MealOriginKind[] };
export const MEAL_MIX: Record<MealWindow, MealMix> = {
  breakfast: { origins: ["hotel", "condo", "staff"] },
  lunch: { origins: ["office", "condo", "hotel", "staff"] },
  dinner: { origins: ["office", "condo", "hotel", "staff"] },
  lateNight: { origins: ["hotel", "condo"] },
};

/** True when this unit's kind belongs to the meal-origin bucket. Used by
 *  `spawnMealOutbound` to pick a specific room on a floor whose visible
 *  occupancy to drop. */
export function matchesMealOriginKind(u: { kind: FacilityKind }, bucket: MealOriginKind): boolean {
  switch (bucket) {
    case "office":
      return u.kind === "office";
    case "condo":
      return u.kind === "condo";
    case "hotel":
      return isHotelKind(u.kind);
    case "staff":
      return (
        u.kind === "security" ||
        u.kind === "medical" ||
        u.kind === "housekeeping" ||
        u.kind === "recycling"
      );
  }
}

/**
 * Outbound phase profile. `t` is normalized 0..1 across the meal window.
 * Weight is heavier in the first ~60% of the window and hits zero at t=0.6,
 * so outbound trips cluster near the start and taper toward the middle.
 * Returns are self-scheduled by each round-tripper on their eating-timer
 * expiry (PR A retired the aggregate return branch), so no matching
 * `returnWeight(t)` exists here.
 */
export function outboundWeight(t: number): number {
  return Math.max(0, Math.min(1, 2 * (0.6 - t)));
}
