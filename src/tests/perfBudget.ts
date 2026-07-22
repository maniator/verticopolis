/**
 * Float-safe budget comparisons for the E5-S0 perf gate (e2e/perf.spec.ts).
 *
 * The gate compares a measurement against `baseline * tolerance`, and that
 * product is not exact in IEEE-754 doubles: 1.035 * 1.05 evaluates to
 * 1.0867499999999998828..., so a measurement of exactly 1.08675 ms (the true
 * 5% point) fails a strict `<=` by one ulp (~2e-16). CI run 29863943618 hit
 * exactly this class on a docs-only diff, missing the ceiling by 4e-13 ms
 * while every functional e2e test passed (audit finding AUD-009).
 *
 * Fix: compare against the budget widened by a RELATIVE epsilon of 1e-9 (one
 * part per billion). That absorbs representation noise, which sits around
 * 1e-16 relative, with seven orders of magnitude to spare, while staying
 * seven orders of magnitude below the 5% tolerance it guards, so the
 * threshold is not materially loosened: a real 0.0001% regression still
 * fails. The epsilon scales with the budget, so the guard holds at any
 * magnitude of baseline (microseconds or seconds alike).
 */
export const PERF_BUDGET_REL_EPSILON = 1e-9;

/**
 * True when `value` is at or under `baseline * tolerance` (a ceiling budget,
 * e.g. tolerance 1.05 for "may rise at most 5%"), allowing float-representation
 * noise up to the relative epsilon above the computed budget.
 */
export function withinCeiling(value: number, baseline: number, tolerance: number): boolean {
  const budget = baseline * tolerance;
  return value <= budget + Math.abs(budget) * PERF_BUDGET_REL_EPSILON;
}

/**
 * True when `value` is at or above `baseline * tolerance` (a floor budget,
 * e.g. tolerance 0.9 for "may fall at most 10%"), allowing float-representation
 * noise up to the relative epsilon below the computed budget.
 */
export function aboveFloor(value: number, baseline: number, tolerance: number): boolean {
  const budget = baseline * tolerance;
  return value >= budget - Math.abs(budget) * PERF_BUDGET_REL_EPSILON;
}
