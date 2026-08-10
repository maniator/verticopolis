import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beginSimTick, endSimTick, isSimTimingEnabled, readSimTick, setSimTimingEnabled } from "./simTimer";

describe("simTimer", () => {
  let clock: number;
  let nowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clock = 1_000;
    nowSpy = vi.spyOn(performance, "now").mockImplementation(() => clock);
    setSimTimingEnabled(false); // module state is shared; start every test off
  });

  afterEach(() => {
    nowSpy.mockRestore();
    setSimTimingEnabled(false);
  });

  /** Run one timed tick that "costs" `ms`. */
  function tick(ms: number): void {
    const start = beginSimTick();
    clock += ms;
    endSimTick(start);
  }

  it("is off by default and makes no clock call while off", () => {
    expect(isSimTimingEnabled()).toBe(false);
    expect(beginSimTick()).toBeLessThan(0);
    // The point of the flag: a normal session must not pay for performance.now().
    expect(nowSpy).not.toHaveBeenCalled();
  });

  it("ignores a sentinel start, so the call site needs no second flag", () => {
    endSimTick(beginSimTick());
    expect(readSimTick()).toEqual({ lastMs: 0, peakMs: 0 });
  });

  it("records a tick once enabled", () => {
    setSimTimingEnabled(true);
    tick(4);
    expect(readSimTick()).toEqual({ lastMs: 4, peakMs: 4 });
  });

  it("keeps the worst tick as the peak while last follows the newest", () => {
    setSimTimingEnabled(true);
    tick(2);
    tick(37); // the hitch
    tick(3);
    // At ~4Hz the panel would sample one frame in fifteen, so the instantaneous
    // read alone would miss the hitch entirely.
    expect(readSimTick()).toEqual({ lastMs: 3, peakMs: 37 });
  });

  it("peeks without consuming the peak by default", () => {
    // The panel and `vcdebug.stats()` both read this. If a plain read consumed
    // the peak they would steal it from each other, and whichever asked second
    // would report a spurious zero.
    setSimTimingEnabled(true);
    tick(20);
    expect(readSimTick().peakMs).toBe(20);
    expect(readSimTick().peakMs).toBe(20);
  });

  it("resets the peak only when asked, so a spike does not sit there forever", () => {
    setSimTimingEnabled(true);
    tick(20);
    expect(readSimTick(true).peakMs).toBe(20);
    tick(1);
    expect(readSimTick()).toEqual({ lastMs: 1, peakMs: 1 });
  });

  it("drops a clock anomaly rather than banking a bogus measurement", () => {
    setSimTimingEnabled(true);
    tick(5);
    const start = beginSimTick();
    clock -= 100; // time ran backwards
    endSimTick(start);
    expect(readSimTick()).toEqual({ lastMs: 5, peakMs: 5 });
  });

  it("clears its readings when switched off", () => {
    setSimTimingEnabled(true);
    tick(9);
    setSimTimingEnabled(false);
    // A stale reading from a previous debug session would be worse than none.
    expect(readSimTick()).toEqual({ lastMs: 0, peakMs: 0 });
  });
});
