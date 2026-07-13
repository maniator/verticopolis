import { describe, it, expect } from "vitest";
import { Clock } from "./Clock";

describe("Clock", () => {
  it("starts on Monday morning", () => {
    const c = new Clock();
    expect(c.dayOfWeek).toBe(0);
    expect(c.hour).toBe(7);
    expect(c.format()).toBe("Mon 07:00");
  });

  it("rolls over days and weekdays", () => {
    const c = new Clock();
    c.advance(60 * 24 * 5); // five days -> Saturday
    expect(c.dayOfWeek).toBe(5);
    expect(c.isWeekend).toBe(true);
  });

  it("identifies day phases", () => {
    const c = new Clock(8 * 60);
    expect(c.isMorning()).toBe(true);
    const lunch = new Clock(12 * 60);
    expect(lunch.isLunch()).toBe(true);
    const night = new Clock(23 * 60);
    expect(night.isNight()).toBe(true);
  });

  it("computes quarters from days", () => {
    const c = new Clock();
    expect(c.quarter).toBe(0);
    c.advance(60 * 24 * 90);
    expect(c.quarter).toBe(1);
  });
});
