import { describe, expect, it } from "vitest";
import { PERF_BUDGET_REL_EPSILON, aboveFloor, withinCeiling } from "./perfBudget";

/**
 * Regression pins for AUD-009: the perf gate failed a docs-only diff by
 * 4e-13 ms because `baseline * 1.05` rounds below the mathematically exact
 * budget in doubles and the comparison was a strict `<=`. Each case below
 * first asserts the raw float quirk still holds (so the fixture can never
 * silently stop exercising the boundary), then asserts the epsilon-widened
 * comparison gives the mathematically correct verdict.
 */
describe("perf gate budget comparison (AUD-009 boundary noise)", () => {
  it("passes a measurement exactly at the 5% ceiling despite the budget product rounding down", () => {
    // 1.035 * 1.05 is 1.08675 exactly in decimal, but the double product lands
    // one ulp BELOW the double nearest 1.08675, so the old strict <= failed
    // the exact-boundary measurement by ~2.2e-16.
    const baseline = 1.035;
    const atBoundary = 1.08675;
    expect(atBoundary <= baseline * 1.05).toBe(false); // the raw quirk the gate hit
    expect(withinCeiling(atBoundary, baseline, 1.05)).toBe(true);
  });

  it("passes a measurement exactly at the 10% floor despite the budget product rounding up", () => {
    // 8.8 * 0.9 is 7.92 exactly in decimal, but the double product lands one
    // ulp ABOVE the double nearest 7.92, so a strict >= failed the
    // exact-boundary measurement from the other side.
    const baseline = 8.8;
    const atBoundary = 7.92;
    expect(atBoundary >= baseline * 0.9).toBe(false); // the raw quirk, floor side
    expect(aboveFloor(atBoundary, baseline, 0.9)).toBe(true);
  });

  it("still fails a real regression: the epsilon does not materially loosen the 5% threshold", () => {
    const baseline = 1.035;
    // One part in a million over the budget (0.0001%) is far above the 1e-9
    // epsilon and must still fail; the gate's effective tolerance stays 5%.
    expect(withinCeiling(baseline * 1.05 * (1 + 1e-6), baseline, 1.05)).toBe(false);
    expect(aboveFloor(baseline * 0.9 * (1 - 1e-6), baseline, 0.9)).toBe(false);
    // And a plainly regressed measurement (6% over) fails by a wide margin.
    expect(withinCeiling(baseline * 1.06, baseline, 1.05)).toBe(false);
  });

  it("keeps the epsilon relative, so the guard holds at any baseline magnitude", () => {
    for (const scale of [1e-4, 1, 1e4]) {
      const baseline = 1.035 * scale;
      const budget = baseline * 1.05;
      expect(withinCeiling(budget * (1 + PERF_BUDGET_REL_EPSILON / 2), baseline, 1.05)).toBe(true);
      expect(withinCeiling(budget * (1 + 1e-6), baseline, 1.05)).toBe(false);
    }
  });
});
