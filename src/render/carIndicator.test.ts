import { describe, it, expect } from "vitest";
import { cabFit, carIndicator } from "./carIndicator";

describe("carIndicator", () => {
  it("maps direction to the lantern arrow", () => {
    expect(carIndicator(1, 0, 16, 11).arrow).toBe("up");
    expect(carIndicator(-1, 0, 16, 11).arrow).toBe("down");
    expect(carIndicator(0, 0, 16, 11).arrow).toBeNull(); // idle shows no lantern
  });

  it("draws one rider per passenger, up to the cab's room", () => {
    expect(carIndicator(0, 0, 16, 11).riders).toBe(0);
    expect(carIndicator(0, 3, 16, 11).riders).toBe(3); // the three who boarded
    expect(carIndicator(0, 11, 16, 11).riders).toBe(11);
    expect(carIndicator(0, 16, 16, 11).riders).toBe(11); // no more than fit
    expect(carIndicator(0, 3, 16, 0).riders).toBe(0);
  });

  it("fits a rider every few pixels inside the cab's margins", () => {
    expect(cabFit(40)).toBe(11); // a standard cab, four tiles wide
    expect(cabFit(60)).toBe(18); // an express cab, six tiles wide
    expect(cabFit(8)).toBe(0);
    expect(cabFit(NaN)).toBe(0);
  });

  it("flags FULL only at or above capacity", () => {
    expect(carIndicator(1, 15, 16, 11).full).toBe(false);
    expect(carIndicator(1, 16, 16, 11).full).toBe(true);
    expect(carIndicator(1, 20, 16, 11).full).toBe(true);
  });

  it("is defensive about zero/negative capacity and load", () => {
    expect(carIndicator(0, -5, 16, 11).riders).toBe(0); // negative load floored
    const z = carIndicator(1, 4, 0, 11); // guard against divide-by-zero
    expect(Number.isFinite(z.riders)).toBe(true);
    expect(z.full).toBe(false); // no capacity → never "full"
  });

  it("treats non-finite inputs as safe defaults", () => {
    const n = carIndicator(NaN, NaN, NaN, 11);
    expect(n.riders).toBe(0);
    expect(n.arrow).toBeNull();
    expect(n.full).toBe(false);
    // A stray NaN in any single field can't leak a NaN into the result.
    expect(Number.isFinite(carIndicator(1, NaN, 16, 11).riders)).toBe(true);
    expect(carIndicator(Infinity, 8, 16, 11).arrow).toBeNull(); // non-finite dir → idle
  });
});
