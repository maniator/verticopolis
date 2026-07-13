import { describe, it, expect } from "vitest";
import { retailStatsLines } from "../game/inspector";

// Shop verdict baseline = dailyTrafficIncome.shop (2500) / retailSpendPerCustomer.shop (20)
// × TRAFFIC_FACTOR_MEAN (0.8) = 100 customers on an average good day. Folding the
// mean foot-traffic factor into the baseline is what keeps the green band
// reachable (real patronage can never hit the raw 125 ceiling, only ~0.8 of it).
// Yesterday's customer count maps to the verdict bands: <50 red, 50-85 neutral,
// >85 green.
describe("retailStatsLines (commercial-venue inspector card)", () => {
  it("returns nothing for a kind with no spend baseline", () => {
    expect(retailStatsLines("office", 10, 10, 100, false)).toBe("");
  });

  it("reads 'just opened' until the first full day rolls over", () => {
    // No yesterday yet: the verdict can't judge a partial day, so it stays neutral.
    const html = retailStatsLines("shop", 3, undefined, undefined, false);
    expect(html).toContain("Just opened, no data yet.");
    expect(html).toContain("Today's patronage: 3 customers");
    expect(html).not.toContain("Very few customers");
  });

  it("judges the last COMPLETED day, so a booming shop hovered after midnight never flashes red", () => {
    // Regression for the early-morning red flash: today has just reset to 0 at
    // the rollover, but yesterday was a booming 95 (> 85, near the ideal-day
    // ceiling of 100). The verdict must read the completed yesterday, not the
    // empty today.
    const html = retailStatsLines("shop", 0, 95, 5000, false);
    expect(html).toContain("Business is booming.");
    expect(html).not.toContain("Very few customers");
    expect(html).toContain('color:var(--good)');
    // Today's running count is still shown honestly (0 so far).
    expect(html).toContain("Today's patronage: 0 customers");
  });

  it("reaches the green 'booming' verdict on a real average-good day (baseline is not the raw ceiling)", () => {
    // A venue at full appeal, well placed, on a dry day earns ~100 customers
    // (= 125 raw ceiling × 0.8 mean traffic factor). That is representable by
    // the engine, so the green tier is not dead code: 100 / 100 = 1.0 > 0.85.
    const html = retailStatsLines("shop", 100, 100, 3000, false);
    expect(html).toContain("Business is booming.");
    expect(html).toContain('color:var(--good)');
  });

  it("shows a red 'very few customers' verdict when yesterday genuinely underperformed", () => {
    const html = retailStatsLines("shop", 40, 10, 200, false);
    expect(html).toContain("Very few customers.");
    expect(html).toContain('color:var(--bad)');
  });

  it("shows a neutral 'business is average' verdict in the middle band", () => {
    const html = retailStatsLines("shop", 100, 70, 3000, false);
    expect(html).toContain("Business is average.");
    // Neutral verdicts carry no color style.
    expect(html).not.toContain("var(--bad)");
    expect(html).not.toContain("var(--good)");
  });

  it("adds the rain line only when it is raining, and shows yesterday's profit", () => {
    // Derive the expected thousands separator from the runtime locale so the
    // assertion doesn't hard-code en-US formatting.
    const profit = `Yesterday's profit: $${(3210).toLocaleString()}.`;
    const dry = retailStatsLines("shop", 100, 70, 3210, false);
    expect(dry).toContain(profit);
    expect(dry).not.toContain("Rain might cause fewer customers.");
    const wet = retailStatsLines("shop", 100, 70, 3210, true);
    expect(wet).toContain("Rain might cause fewer customers.");
  });

  it("pluralizes the customer count and clamps a forged negative to zero", () => {
    // Match the singular without depending on the trailing space before the bar
    // span: the negative lookahead pins "customer" (not "customers").
    expect(retailStatsLines("shop", 1, 70, 0, false)).toMatch(/Today's patronage: 1 customer(?!s)/);
    expect(retailStatsLines("shop", -5, 70, 0, false)).toContain("Today's patronage: 0 customers");
  });
});
