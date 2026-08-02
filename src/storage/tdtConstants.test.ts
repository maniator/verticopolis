import { describe, expect, it } from "vitest";
import {
  TDT_ELEVATOR_BUILT_FIXED,
  TDT_ELEVATOR_CAR_BLOCK_SIZE,
  TDT_ELEVATOR_PER_FLOOR_SIZE,
  builtShaftPayloadSize,
} from "./tdtConstants";

/**
 * `builtShaftPayloadSize` is pure arithmetic, and it is the root invariant the
 * `.TDT` writer, the reader's skip, and the test fixture all share: if they ever
 * disagree about a built elevator slot's payload, the whole table desyncs after
 * the first shaft and the 1994 game loses every later one. That has happened
 * twice, so the contract is pinned here at the cheapest tier rather than only
 * inside the heavier export/import integration runs.
 */
describe("builtShaftPayloadSize", () => {
  const base = TDT_ELEVATOR_BUILT_FIXED + TDT_ELEVATOR_CAR_BLOCK_SIZE;

  it("counts one per-floor entry per SPANNED floor, endpoints included", () => {
    expect(builtShaftPayloadSize(10, 10)).toBe(base + TDT_ELEVATOR_PER_FLOOR_SIZE); // degenerate: one floor
    expect(builtShaftPayloadSize(10, 11)).toBe(base + 2 * TDT_ELEVATOR_PER_FLOOR_SIZE);
    expect(builtShaftPayloadSize(10, 21)).toBe(base + 12 * TDT_ELEVATOR_PER_FLOOR_SIZE);
  });

  it("depends only on the SPAN, not on where the shaft sits", () => {
    // The operands are TDT floor bytes at every call site, but only their
    // difference is used, so a uniform offset must not change the answer.
    expect(builtShaftPayloadSize(40, 60)).toBe(builtShaftPayloadSize(0, 20));
  });

  it("refuses an inverted span rather than returning a negative size", () => {
    expect(() => builtShaftPayloadSize(40, 20)).toThrow(/whole number of floors/);
  });

  it("refuses fractional floors, including two that cancel", () => {
    // A writer pads a fractional size up to the next byte while a reader skips
    // the fraction, so the two silently disagree.
    expect(() => builtShaftPayloadSize(1.5, 3)).toThrow(/whole number of floors/);
    // 1.5 -> 3.5 spans a whole 3 floors on paper while describing floors that
    // do not exist: check the operands, not just their difference.
    expect(() => builtShaftPayloadSize(1.5, 3.5)).toThrow(/whole number of floors/);
  });

  it("refuses non-finite floors", () => {
    expect(() => builtShaftPayloadSize(0, Number.POSITIVE_INFINITY)).toThrow(/whole number of floors/);
    expect(() => builtShaftPayloadSize(Number.NaN, 10)).toThrow(/whole number of floors/);
  });
});
