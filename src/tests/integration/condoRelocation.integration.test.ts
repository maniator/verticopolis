import { describe, it, expect } from "vitest";
import { CLASSIC_RULES, MODERN_RULES } from "../../engine/gameRules";
import { ECON } from "../../engine/econConfig";

/**
 * Household-aware condo departures (Modern only). A sold Modern condo's family
 * can relocate for life reasons even when perfectly served; Classic condos never
 * relocate (they stay 1994-sticky). The relocation rides the existing buy-back
 * path and enters a non-rescindable "relocation" notice. The behavior tests run
 * on both engines in condoRelocationEngine.integration.test.ts; these pin the
 * rule's values.
 */

describe("GameRules.condoRelocationChance", () => {
  it("Classic never relocates a condo (returns 0 for any household)", () => {
    for (const r of [undefined, 2, 3, 4, 5]) {
      expect(CLASSIC_RULES.condoRelocationChance(r)).toBe(0);
    }
  });

  it("Modern scales the chance UP with family size (bigger family, bigger flight risk)", () => {
    const base = ECON.condoRelocationChanceMonthly;
    expect(MODERN_RULES.condoRelocationChance(3)).toBeCloseTo(base, 10); // mean household is neutral
    expect(MODERN_RULES.condoRelocationChance(undefined)).toBeCloseTo(base, 10); // no household reads as 3
    expect(MODERN_RULES.condoRelocationChance(2)).toBeLessThan(MODERN_RULES.condoRelocationChance(3));
    expect(MODERN_RULES.condoRelocationChance(5)).toBeGreaterThan(MODERN_RULES.condoRelocationChance(3));
    expect(MODERN_RULES.condoRelocationChance(5)).toBeCloseTo((base * 5) / 3, 10);
  });
});
