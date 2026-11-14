import { describe, it, expect } from "vitest";
import { cabFit, carIndicator } from "./carIndicator";

describe("carIndicator", () => {
  it("maps direction to the lantern arrow", () => {
    expect(carIndicator(1, 0, 16, 11, 0).arrow).toBe("up");
    expect(carIndicator(-1, 0, 16, 11, 0).arrow).toBe("down");
    expect(carIndicator(0, 0, 16, 11, 0).arrow).toBeNull(); // idle shows no lantern
  });

  it("draws one rider per person who boarded, up to the cab's room", () => {
    expect(carIndicator(0, 0, 16, 11, 0).riders).toBe(0);
    expect(carIndicator(0, 0, 16, 11, 3).riders).toBe(3); // the three who boarded
    expect(carIndicator(0, 0, 16, 11, 11).riders).toBe(11);
    expect(carIndicator(0, 0, 16, 11, 16).riders).toBe(11); // no more than fit
    expect(carIndicator(0, 0, 16, 0, 3).riders).toBe(0);
    expect(carIndicator(0, 0, 16, 11, NaN).riders).toBe(0);
  });

  it("never draws the car's load as people (3.7.3)", () => {
    // The traffic model's head count fills a car nobody walked into: it draws
    // no figures, so an empty landing never sends off a full cab.
    expect(carIndicator(1, 16, 16, 11, 0).riders).toBe(0);
    expect(carIndicator(-1, 1, 16, 11, 0).riders).toBe(0);
    expect(carIndicator(1, 16, 16, 11, 2).riders).toBe(2);
    expect(carIndicator(1, 16, 16, 11, 0).full).toBe(true); // FULL still reads the load
  });

  it("fits a rider every few pixels inside the cab's margins", () => {
    expect(cabFit(40)).toBe(11); // a standard cab, four tiles wide
    expect(cabFit(60)).toBe(18); // an express cab, six tiles wide
    expect(cabFit(8)).toBe(0);
    expect(cabFit(NaN)).toBe(0);
  });

  it("flags FULL only at or above capacity", () => {
    expect(carIndicator(1, 15, 16, 11, 0).full).toBe(false);
    expect(carIndicator(1, 16, 16, 11, 0).full).toBe(true);
    expect(carIndicator(1, 20, 16, 11, 0).full).toBe(true);
  });

  it("is defensive about zero/negative capacity and load", () => {
    expect(carIndicator(0, -5, 16, 11, -5).riders).toBe(0); // negative counts floored
    const z = carIndicator(1, 4, 0, 11, 0); // guard against divide-by-zero
    expect(Number.isFinite(z.riders)).toBe(true);
    expect(z.full).toBe(false); // no capacity → never "full"
  });

  it("treats non-finite inputs as safe defaults", () => {
    const n = carIndicator(NaN, NaN, NaN, 11, 0);
    expect(n.riders).toBe(0);
    expect(n.arrow).toBeNull();
    expect(n.full).toBe(false);
    // A stray NaN in any single field can't leak a NaN into the result.
    expect(Number.isFinite(carIndicator(1, NaN, 16, 11, 0).riders)).toBe(true);
    expect(carIndicator(Infinity, 8, 16, 11, 0).arrow).toBeNull(); // non-finite dir → idle
  });
});
