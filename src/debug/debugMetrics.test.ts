import { describe, expect, it } from "vitest";
import {
  emptySnapshot,
  formatCount,
  formatFps,
  formatMs,
  snapshotFrame,
  topSystems,
  type FrameStatsLike,
} from "./debugMetrics";

describe("topSystems", () => {
  const durations = {
    "draw:GraphicsSystem.update": 4.2,
    "update:MotionSystem.update": 1.1,
    "update:PointerSystem.update": 0.3,
    "draw:DebugSystem.update": 0.9,
  };

  it("returns the costliest systems descending, capped at n", () => {
    expect(topSystems(durations, 2)).toEqual([
      { label: "draw:GraphicsSystem", ms: 4.2 },
      { label: "update:MotionSystem", ms: 1.1 },
    ]);
  });

  it("trims a redundant .update suffix but keeps the phase prefix", () => {
    // The prefix is Excalibur's SystemType string enum ("update" / "draw"), so
    // it says which phase the cost landed in and is worth keeping.
    expect(topSystems({ "draw:GraphicsSystem.update": 1 }, 1)[0].label).toBe("draw:GraphicsSystem");
  });

  it("keeps a preupdate or postupdate suffix", () => {
    const out = topSystems({ "update:MotionSystem.postupdate": 2 }, 1);
    expect(out[0].label).toBe("update:MotionSystem.postupdate");
  });

  it("drops zero-cost entries", () => {
    // FrameStats.reset() zeroes existing keys instead of deleting them, so a
    // system that stopped running lingers at 0 and would otherwise pad the list.
    expect(topSystems({ "a.update": 0, "b.update": 1 }, 5)).toEqual([{ label: "b", ms: 1 }]);
  });

  it("breaks ties by label so the list does not shuffle between frames", () => {
    expect(topSystems({ "z.update": 1, "a.update": 1 }, 2).map((s) => s.label)).toEqual(["a", "z"]);
  });

  it("treats a non-finite duration as zero and drops it", () => {
    expect(topSystems({ "a.update": NaN, "b.update": Infinity, "c.update": 1 }, 5).map((s) => s.label)).toEqual(["c"]);
  });

  it("handles a missing map and a non-positive n", () => {
    expect(topSystems(undefined, 3)).toEqual([]);
    expect(topSystems(durations, 0)).toEqual([]);
    expect(topSystems(durations, -1)).toEqual([]);
  });
});

describe("snapshotFrame", () => {
  const stats: FrameStatsLike = {
    fps: 59.7,
    elapsedMs: 16.7,
    duration: { update: 3.5, draw: 8.25, total: 11.75 },
    graphics: { drawCalls: 120, drawnImages: 4300, rendererSwaps: 7 },
    actors: { alive: 210, total: 214 },
    systemDuration: { "draw:GraphicsSystem.update": 6.1 },
  };

  it("copies every field out into a plain object", () => {
    expect(snapshotFrame(stats, 3)).toEqual({
      fps: 59.7,
      elapsedMs: 16.7,
      updateMs: 3.5,
      drawMs: 8.25,
      totalMs: 11.75,
      drawCalls: 120,
      drawnImages: 4300,
      rendererSwaps: 7,
      actorsAlive: 210,
      actorsTotal: 214,
      systems: [{ label: "draw:GraphicsSystem", ms: 6.1 }],
      systemKeys: 1,
    });
  });

  it("does not retain the source object", () => {
    // Excalibur reuses its currFrame instance, so a snapshot that aliased it
    // would silently change under anyone holding it.
    const mutable: FrameStatsLike = { fps: 60, duration: { update: 1 } };
    const snap = snapshotFrame(mutable, 0);
    mutable.fps = 12;
    mutable.duration!.update = 99;
    expect(snap.fps).toBe(60);
    expect(snap.updateMs).toBe(1);
  });

  it("degrades a missing or non-finite counter to zero rather than NaN", () => {
    const snap = snapshotFrame({ fps: NaN, graphics: { drawCalls: undefined } }, 3);
    expect(snap.fps).toBe(0);
    expect(snap.drawCalls).toBe(0);
    expect(snap.updateMs).toBe(0);
  });

  it("survives entirely absent stats", () => {
    expect(snapshotFrame(undefined, 3).systems).toEqual([]);
    expect(emptySnapshot().fps).toBe(0);
  });
});

describe("formatters", () => {
  it("scales millisecond precision to the magnitude", () => {
    expect(formatMs(0.125)).toBe("0.13");
    expect(formatMs(9.999)).toBe("10.00");
    expect(formatMs(42.31)).toBe("42.3");
    expect(formatMs(216.7)).toBe("217");
  });

  it("renders a placeholder for a non-finite duration", () => {
    expect(formatMs(NaN)).toBe("—");
  });

  it("rounds fps to whole frames", () => {
    expect(formatFps(59.7)).toBe("60");
    expect(formatFps(NaN)).toBe("—");
  });

  it("separates thousands in a counter", () => {
    expect(formatCount(4300)).toBe("4,300");
    expect(formatCount(7)).toBe("7");
    expect(formatCount(Infinity)).toBe("—");
  });
});
