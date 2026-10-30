import { describe, it, expect } from "vitest";
import {
  METRO_TRAIN_ARRIVED_AT,
  METRO_TRAIN_DEPARTS_AT,
  METRO_TRAIN_GONE_AT,
  metroTrainOffset,
} from "./metroTrainSchedule";

const SPAN = 100;
const at = (hour: number, minute: number, night = false): number => metroTrainOffset(hour * 60 + minute, SPAN, night);

describe("metroTrainOffset", () => {
  it("slides in from the left tunnel, waits, then leaves to the right", () => {
    expect(at(12, 0)).toBe(-SPAN);
    expect(at(12, METRO_TRAIN_ARRIVED_AT / 2)).toBeCloseTo(-SPAN / 2, 6);
    expect(at(12, METRO_TRAIN_ARRIVED_AT)).toBe(0);
    expect(at(12, METRO_TRAIN_DEPARTS_AT - 1)).toBe(0);
    expect(at(12, METRO_TRAIN_DEPARTS_AT)).toBe(0);
    expect(at(12, (METRO_TRAIN_DEPARTS_AT + METRO_TRAIN_GONE_AT) / 2)).toBeCloseTo(SPAN / 2, 6);
  });

  it("is out of sight for the rest of the hour", () => {
    expect(Math.abs(at(12, METRO_TRAIN_GONE_AT))).toBe(SPAN);
    expect(Math.abs(at(12, 45))).toBe(SPAN);
    expect(Math.abs(at(12, 59))).toBe(SPAN);
  });

  it("calls once every daytime hour, the same way each time", () => {
    for (let hour = 6; hour < 21; hour++) {
      const present = Array.from({ length: 60 }, (_, m) => at(hour, m)).filter((x) => Math.abs(x) < SPAN);
      expect(present.length).toBe(METRO_TRAIN_GONE_AT - 1);
      expect(at(hour, 10)).toBe(0);
    }
  });

  it("runs no trains at night", () => {
    for (const hour of [21, 23, 0, 3, 5]) {
      for (let m = 0; m < 60; m += 5) expect(at(hour, m, true)).toBe(-SPAN);
    }
  });
});
