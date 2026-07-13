import { describe, it, expect } from "vitest";
import { carIndicator } from "./carIndicator";

describe("carIndicator", () => {
  it("maps direction to the lantern arrow", () => {
    expect(carIndicator(1, 0, 16).arrow).toBe("up");
    expect(carIndicator(-1, 0, 16).arrow).toBe("down");
    expect(carIndicator(0, 0, 16).arrow).toBeNull(); // idle shows no lantern
  });

  it("buckets riders 0..4 scaled to capacity", () => {
    expect(carIndicator(0, 0, 16).riders).toBe(0);
    expect(carIndicator(0, 8, 16).riders).toBe(2); // half of a 16-cap cab
    expect(carIndicator(0, 16, 16).riders).toBe(4);
    // A big express cab (cap 24) half-loaded is still only ~2/4, not "full".
    expect(carIndicator(0, 12, 24).riders).toBe(2);
    // Never exceeds the 4-bucket ceiling even if somehow overloaded.
    expect(carIndicator(0, 100, 16).riders).toBe(4);
  });

  it("flags FULL only at or above capacity", () => {
    expect(carIndicator(1, 15, 16).full).toBe(false);
    expect(carIndicator(1, 16, 16).full).toBe(true);
    expect(carIndicator(1, 20, 16).full).toBe(true);
  });

  it("is defensive about zero/negative capacity and load", () => {
    expect(carIndicator(0, -5, 16).riders).toBe(0); // negative load floored
    const z = carIndicator(1, 4, 0); // guard against divide-by-zero
    expect(Number.isFinite(z.riders)).toBe(true);
    expect(z.full).toBe(false); // no capacity → never "full"
  });

  it("treats non-finite inputs as safe defaults", () => {
    const n = carIndicator(NaN, NaN, NaN);
    expect(n.riders).toBe(0);
    expect(n.arrow).toBeNull();
    expect(n.full).toBe(false);
    // A stray NaN in any single field can't leak a NaN into the result.
    expect(Number.isFinite(carIndicator(1, NaN, 16).riders)).toBe(true);
    expect(carIndicator(Infinity, 8, 16).arrow).toBeNull(); // non-finite dir → idle
  });
});
