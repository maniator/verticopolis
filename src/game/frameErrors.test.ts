import { describe, it, expect, afterEach, vi } from "vitest";
import { MAX_FRAME_ERRORS, noteFrameError } from "./frameErrors";

/** The shared log behind the frame guard and the traffic chip's refresh:
 *  throttled to one entry per two seconds per source, kept to a short ring in
 *  which a source that keeps failing replaces its own entries first. */

const log = () => ({ frameErrors: [] as Array<{ at: string; message: string }> });
const firstLines = (app: ReturnType<typeof log>) => app.frameErrors.map((e) => e.message.split("\n")[0]);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("noteFrameError", () => {
  it("logs to the console and the ring, with the error's message and stack", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = log();
    noteFrameError(app, new Error("boom"));
    expect(consoleSpy).toHaveBeenCalledExactlyOnceWith("[tick] frame error, continuing:", expect.any(Error));
    expect(app.frameErrors).toHaveLength(1);
    expect(firstLines(app)).toEqual(["boom"]);
    expect(app.frameErrors[0].message).toContain("frameErrors.test.ts");
    expect(Number.isNaN(Date.parse(app.frameErrors[0].at))).toBe(false);
  });

  it("logs a thrown non-Error as its string", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const app = log();
    noteFrameError(app, "plain");
    expect(app.frameErrors.map((e) => e.message)).toEqual(["plain"]);
  });

  it("logs the first failure even right after the page loads", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(performance, "now").mockReturnValue(0);
    const app = log();
    noteFrameError(app, new Error("at load"));
    expect(firstLines(app)).toEqual(["at load"]);
  });

  it("keeps one entry per two seconds for each source", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let now = 10_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const app = log();
    noteFrameError(app, new Error("first"));
    now += 2000;
    noteFrameError(app, new Error("inside the window"));
    now += 1;
    noteFrameError(app, new Error("next window"));
    expect(firstLines(app)).toEqual(["first", "next window"]);
    expect(consoleSpy).toHaveBeenCalledTimes(2);
  });

  it("throttles each source on its own and tags the chip's entries", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(performance, "now").mockReturnValue(10_000);
    const app = log();
    noteFrameError(app, new Error("frame threw"));
    noteFrameError(app, new Error("chip failed"), "traffic");
    noteFrameError(app, new Error("chip again"), "traffic");
    noteFrameError(app, new Error("frame again"));
    expect(firstLines(app)).toEqual(["frame threw", "[traffic] chip failed"]);
    expect(consoleSpy.mock.calls.map((c) => c[0])).toEqual([
      "[tick] frame error, continuing:",
      "[tick] traffic error, continuing:",
    ]);
  });

  it("throttles each app on its own", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(performance, "now").mockReturnValue(10_000);
    const one = log();
    const two = log();
    noteFrameError(one, new Error("one"));
    noteFrameError(two, new Error("two"));
    expect([firstLines(one), firstLines(two)]).toEqual([["one"], ["two"]]);
  });

  it("falls back to the wall clock where the page clock is missing", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("performance", undefined);
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const app = log();
    noteFrameError(app, new Error("first"));
    noteFrameError(app, new Error("inside the window"));
    now += 2001;
    noteFrameError(app, new Error("next window"));
    expect(firstLines(app)).toEqual(["first", "next window"]);
  });

  it("logs the first failure on another tower at once, inside the window", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(performance, "now").mockReturnValue(10_000);
    const app = log();
    noteFrameError(app, new Error("old tower"));
    noteFrameError(app, new Error("old tower, chip"), "traffic");
    // adoptSim empties the ring for the new tower's crash report.
    app.frameErrors.length = 0;
    noteFrameError(app, new Error("new tower"));
    noteFrameError(app, new Error("new tower again"));
    expect(firstLines(app)).toEqual(["new tower"]);
  });

  it("starts a new window when the clock goes back", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let now = 3000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const app = log();
    noteFrameError(app, new Error("real clock"));
    // The tooling swaps in a stepped clock that starts from 0.
    now = 16;
    noteFrameError(app, new Error("stepped clock"));
    now = 32;
    noteFrameError(app, new Error("stepped clock again"));
    expect(firstLines(app)).toEqual(["real clock", "stepped clock"]);
  });

  it("never throws on an error it cannot print", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const app = log();
    const hostile = {
      toString(): string {
        throw new Error("no string for you");
      },
    };
    expect(() => noteFrameError(app, hostile)).not.toThrow();
    expect(app.frameErrors.map((e) => e.message)).toEqual(["unprintable error"]);
  });

  it("lets a source that keeps failing replace only its own entries, so another source's last failure stays", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let now = 10_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const app = log();
    noteFrameError(app, new Error("root cause"));
    for (let i = 0; i < MAX_FRAME_ERRORS + 2; i++) {
      now += 2001;
      noteFrameError(app, new Error(`chip ${i}`), "traffic");
    }
    expect(firstLines(app)).toEqual(["root cause", "[traffic] chip 3", "[traffic] chip 4", "[traffic] chip 5", "[traffic] chip 6"]);
    // The next frame failure replaces the older frame entry.
    now += 2001;
    noteFrameError(app, new Error("second frame"));
    expect(firstLines(app)).toEqual(["[traffic] chip 3", "[traffic] chip 4", "[traffic] chip 5", "[traffic] chip 6", "second frame"]);
  });

  it("drops the oldest entry when a source's first failure meets a full ring", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let now = 10_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const app = log();
    for (let i = 0; i < MAX_FRAME_ERRORS; i++) {
      noteFrameError(app, new Error(`chip ${i}`), "traffic");
      now += 2001;
    }
    noteFrameError(app, new Error("frame"));
    expect(firstLines(app)).toEqual(["[traffic] chip 1", "[traffic] chip 2", "[traffic] chip 3", "[traffic] chip 4", "frame"]);
  });

  it("keeps a frame failure whose message starts like the chip's tag as the frame guard's", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let now = 10_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const app = log();
    noteFrameError(app, new Error("[traffic] lookalike"));
    now += 500;
    noteFrameError(app, new Error("[traffic] lookalike"));
    // The frame guard's window holds for it.
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    // And the chip's failures replace their own entries and keep this one.
    for (let i = 0; i < MAX_FRAME_ERRORS + 1; i++) {
      now += 2001;
      noteFrameError(app, new Error(`chip ${i}`), "traffic");
    }
    expect(firstLines(app)).toEqual([
      "[traffic] lookalike",
      "[traffic] chip 2",
      "[traffic] chip 3",
      "[traffic] chip 4",
      "[traffic] chip 5",
    ]);
  });

  it("never throws, even when the date cannot be read", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(Date.prototype, "toISOString").mockImplementation(() => {
      throw new RangeError("Invalid time value");
    });
    expect(() => noteFrameError(log(), new Error("boom"))).not.toThrow();
  });

  it("still records the entry when the console throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("console wrapper failed");
    });
    const app = log();
    expect(() => noteFrameError(app, new Error("boom"))).not.toThrow();
    expect(firstLines(app)).toEqual(["boom"]);
  });

  it(`keeps the newest ${MAX_FRAME_ERRORS} entries`, () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let now = 10_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const app = log();
    for (let i = 0; i < MAX_FRAME_ERRORS + 2; i++) {
      noteFrameError(app, new Error(`e${i}`));
      now += 2001;
    }
    expect(firstLines(app)).toEqual(["e2", "e3", "e4", "e5", "e6"]);
  });
});
