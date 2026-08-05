import { describe, expect, it } from "vitest";
import {
  TDT_ELEVATOR_BUILT_FIXED,
  TDT_ELEVATOR_CAR_BLOCK_SIZE,
  TDT_ELEVATOR_PER_FLOOR_SIZE,
  TDT_ELEVATOR_HEADER_SIZE,
  builtShaftPayloadSize,
  builtShaftPayloadSizeFor,
  TDT_ELEVATOR_TYPE_EXPRESS,
} from "./tdtConstants";
import { ELEVATOR_KINDS } from "./tdtTables";

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

describe("builtShaftPayloadSizeFor", () => {
  const base = TDT_ELEVATOR_BUILT_FIXED + TDT_ELEVATOR_CAR_BLOCK_SIZE;

  it("sizes standard and service shafts by their SPAN, ignoring the stop count", () => {
    for (const type of [1, 2]) {
      // A shaft spanning 12 floors and stopping at 3 still carries 12 entries.
      expect(builtShaftPayloadSizeFor(type, 10, 21, 3)).toBe(base + 12 * TDT_ELEVATOR_PER_FLOOR_SIZE);
      expect(builtShaftPayloadSizeFor(type, 10, 21, 3)).toBe(builtShaftPayloadSize(10, 21));
    }
  });

  it("sizes an EXPRESS shaft by its STOPS, ignoring the span", () => {
    // The harness measurement: 91 spanned floors, 8 stops, 6,274 bytes.
    expect(builtShaftPayloadSizeFor(TDT_ELEVATOR_TYPE_EXPRESS, 10, 100, 8)).toBe(
      base + 8 * TDT_ELEVATOR_PER_FLOOR_SIZE,
    );
    // 6,274 is the full record STRIDE the harness measured, header included.
    expect(TDT_ELEVATOR_HEADER_SIZE + builtShaftPayloadSizeFor(TDT_ELEVATOR_TYPE_EXPRESS, 10, 100, 8)).toBe(6_274);
    // Sizing that same shaft by its span is what desynced the walk by 26,892.
    expect(builtShaftPayloadSize(10, 100) - builtShaftPayloadSizeFor(TDT_ELEVATOR_TYPE_EXPRESS, 10, 100, 8)).toBe(26_892);
  });

  it("floors an express at ONE entry, so a zero-stop record still has a size", () => {
    // Both sides must agree on a malformed record rather than each guessing.
    expect(builtShaftPayloadSizeFor(TDT_ELEVATOR_TYPE_EXPRESS, 10, 100, 0)).toBe(
      base + TDT_ELEVATOR_PER_FLOOR_SIZE,
    );
  });

  it("rejects an inverted or fractional span for EVERY kind, express included", () => {
    // The express branch does not size from the span, but it is still a bug.
    for (const type of [TDT_ELEVATOR_TYPE_EXPRESS, 1, 2]) {
      expect(() => builtShaftPayloadSizeFor(type, 40, 20, 4)).toThrow(/whole number of floors/);
      expect(() => builtShaftPayloadSizeFor(type, 1.5, 3, 4)).toThrow(/whole number of floors/);
    }
  });

  it("rejects a fractional stop count", () => {
    expect(() => builtShaftPayloadSizeFor(TDT_ELEVATOR_TYPE_EXPRESS, 10, 100, 2.5)).toThrow(/whole number/);
    expect(() => builtShaftPayloadSizeFor(TDT_ELEVATOR_TYPE_EXPRESS, 10, 100, Number.NaN)).toThrow(/whole number/);
  });

  it("agrees with the ELEVATOR_KINDS order the encoder maps kinds through", () => {
    // TDT_ELEVATOR_TYPE_EXPRESS restates that table's index 0 from another
    // module. Reordering ELEVATOR_KINDS would silently attach the stop-sized
    // rule to standard shafts, and nothing else would notice.
    expect(ELEVATOR_KINDS.indexOf("elevatorExpress")).toBe(TDT_ELEVATOR_TYPE_EXPRESS);
  });
});
