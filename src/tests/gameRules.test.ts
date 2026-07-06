import { describe, it, expect } from "vitest";
import { CLASSIC_RULES, MODERN_RULES, makeRules, householdPrice } from "../engine/gameRules";
import { FACILITIES } from "../engine/facilities";
import { RNG } from "../engine/rng";

/**
 * The rule-set strategy object in isolation — the one place Classic and Modern
 * diverge. Testing the policies directly (not through a full Simulation) is the
 * payoff of extracting them: each mode's behavior is a small, pure surface.
 */

const CLASSIC_3 = FACILITIES.condo.population;

describe("makeRules", () => {
  it("maps each mode to its rule-set", () => {
    expect(makeRules("classic")).toBe(CLASSIC_RULES);
    expect(makeRules("modern")).toBe(MODERN_RULES);
  });
});

describe("householdPrice", () => {
  it("is the base for a household-less condo and scales by size otherwise", () => {
    expect(householdPrice(160_000, undefined)).toBe(160_000);
    expect(householdPrice(160_000, 3)).toBe(160_000); // the classic 3 is parity
    expect(householdPrice(150_000, 2)).toBe(Math.round((150_000 * 2) / CLASSIC_3));
    expect(householdPrice(150_000, 5)).toBe(Math.round((150_000 * 5) / CLASSIC_3));
  });
});

describe("CLASSIC_RULES", () => {
  it("sells the flat 3 at the asking price and never touches the RNG", () => {
    const rng = new RNG(42);
    const before = rng.seed;
    const sale = CLASSIC_RULES.sellCondo(160_000, rng);
    expect(sale).toEqual({ price: 160_000, residents: undefined });
    expect(rng.seed).toBe(before); // determinism: Classic must not advance the stream
  });

  it("strips any household and never adjusts churn", () => {
    expect(CLASSIC_RULES.hasVariantHouseholds).toBe(false);
    expect(CLASSIC_RULES.coerceResidents(5)).toBeUndefined();
    expect(CLASSIC_RULES.coerceResidents(undefined)).toBeUndefined();
    expect(CLASSIC_RULES.churnMultiplier(5)).toBe(1);
    expect(CLASSIC_RULES.churnMultiplier(undefined)).toBe(1);
  });
});

describe("MODERN_RULES", () => {
  it("draws a 2-5 household and scales the sale price to it", () => {
    const rng = new RNG(7);
    const sale = MODERN_RULES.sellCondo(160_000, rng);
    expect(sale.residents).toBeGreaterThanOrEqual(2);
    expect(sale.residents).toBeLessThanOrEqual(5);
    expect(sale.price).toBe(householdPrice(160_000, sale.residents));
  });

  it("advances the RNG on a sale (variant households consume the stream)", () => {
    const rng = new RNG(7);
    const before = rng.seed;
    MODERN_RULES.sellCondo(160_000, rng);
    expect(rng.seed).not.toBe(before);
  });

  it("clamps a coerced household into the real generator band (2..5)", () => {
    expect(MODERN_RULES.coerceResidents(undefined)).toBeUndefined();
    expect(MODERN_RULES.coerceResidents(9999)).toBe(5);
    expect(MODERN_RULES.coerceResidents(1)).toBe(2); // below the band → floor
    expect(MODERN_RULES.coerceResidents(0)).toBe(2);
    expect(MODERN_RULES.coerceResidents(3.4)).toBe(3); // rounds
    expect(MODERN_RULES.coerceResidents("nonsense")).toBe(CLASSIC_3); // non-number → classic 3
  });

  it("sharpens churn for big families and softens for small, neutral at 3", () => {
    expect(MODERN_RULES.churnMultiplier(3)).toBe(1);
    expect(MODERN_RULES.churnMultiplier(5)).toBeGreaterThan(1);
    expect(MODERN_RULES.churnMultiplier(2)).toBeLessThan(1);
    expect(MODERN_RULES.churnMultiplier(undefined)).toBe(1);
  });

  it("keeps the variant-household distribution centered on the classic mean", () => {
    // Sample the roll many times; the mean must sit at the classic 3 (the ladder
    // invariant), with every draw in-band.
    const rng = new RNG(12345);
    let sum = 0;
    const N = 20_000;
    for (let i = 0; i < N; i++) {
      const { residents } = MODERN_RULES.sellCondo(160_000, rng);
      expect(residents).toBeGreaterThanOrEqual(2);
      expect(residents).toBeLessThanOrEqual(5);
      sum += residents!;
    }
    expect(sum / N).toBeCloseTo(CLASSIC_3, 1); // mean ≈ 3.0
  });
});
