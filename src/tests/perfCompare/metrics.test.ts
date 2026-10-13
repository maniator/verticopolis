import { describe, expect, it } from "vitest";
import { processRun } from "./fixtures";
import { aggregate, compareEngines } from "./metrics";

const runs = () =>
  Array.from({ length: 8 }, (_, rep) => [processRun(rep, "ts", {}, 1 + rep * 0.001), processRun(rep, "wasm", {}, 2 + rep * 0.001)]).flat();

describe("aggregate", () => {
  it("collects one value per successful repetition, with its rep", () => {
    const all = runs();
    all[3] = { ...all[3], ok: false, error: "x" }; // rep 1 wasm
    const rows = aggregate(all, ["small"], [1]);
    const hostedWasm = rows.find((r) => r.group === "sim-hosted" && r.metric === "total for fixed duration" && r.engine === "wasm")!;
    expect(hostedWasm.values).toHaveLength(7);
    expect(hostedWasm.reps).toEqual([0, 2, 3, 4, 5, 6, 7]);
    expect(hostedWasm.summary!.median).toBeCloseTo(200.4, 6);
  });

  it("measures engine-specific metrics on that engine only", () => {
    const rows = aggregate(runs(), ["small"], [1]);
    expect(rows.filter((r) => r.metric === "WASM linear memory").map((r) => r.engine)).toEqual(["wasm"]);
    // No throttle above 1x: no throttled cold-start rows to collide with the 1x ones.
    expect(rows.filter((r) => r.metric === "cold game ready").map((r) => r.throttle)).toEqual(["1", "1"]);
    expect(rows.filter((r) => r.metric === "cold compile").map((r) => r.engine)).toEqual(["ts"]);
    expect(rows.find((r) => r.metric === "cold engine hosted")!.values).toHaveLength(8);
  });

  it("sums the served bytes per phase and leaves missing values out", () => {
    const all = runs();
    all[0].warm = null;
    const rows = aggregate(all, ["small"], [1]);
    expect(rows.find((r) => r.metric === "cold bytes served total" && r.engine === "ts")!.values[0]).toBe(1500);
    expect(rows.find((r) => r.metric === "cold bytes served before ready" && r.engine === "ts")!.values[0]).toBe(1000);
    expect(rows.find((r) => r.metric === "warm game ready" && r.engine === "ts")!.values).toHaveLength(7);
    expect(rows.find((r) => r.metric === "first visit with service worker, bytes served" && r.engine === "wasm")!.values[0]).toBe(2000);
    expect(rows.find((r) => r.metric === "cold before ready: html" && r.engine === "ts")!.values[0]).toBe(0);
    expect(aggregate(all, ["small"], [1, 4]).find((r) => r.metric === "cold game ready" && r.throttle === "4" && r.engine === "ts")!.values[0]).toBe(1200);
    expect(rows.find((r) => r.metric === "JS heap + WASM linear memory" && r.engine === "wasm")!.values[0]).toBe(9e6);
    expect(rows.find((r) => r.group === "frames-audio" && r.metric === "mean FPS" && r.engine === "ts")!.values).toHaveLength(8);
  });

  it("has a null summary when nothing was measured", () => {
    const rows = aggregate([processRun(0, "ts", { wasmCold: null })], ["small"], [1]);
    expect(rows.find((r) => r.metric === "cold compile")!.summary).toBeNull();
  });
});

describe("compareEngines", () => {
  it("skips a zero TypeScript median and says so", () => {
    const skipped: string[] = [];
    const comps = compareEngines(aggregate(runs(), ["small"], [1, 4]), skipped);
    expect(comps.find((c) => c.metric === "frames over 200 ms (game time clamped)")).toBeUndefined();
    expect(skipped.some((x) => x.includes("frames over 200 ms"))).toBe(true);
    // One zero among the TypeScript repetitions is enough for no ratio.
    const some = runs();
    some[0].scenarios.small.frames["1"].clampedFrames = 0;
    for (const r of some.slice(1)) r.scenarios.small.frames["1"].clampedFrames = 3;
    expect(compareEngines(aggregate(some, ["small"], [1])).find((c) => c.group === "frames" && c.metric === "frames over 200 ms (game time clamped)")).toBeUndefined();
  });

  it("reports wasm / ts with the metric's direction", () => {
    const comps = compareEngines(aggregate(runs(), ["small"], [1]));
    const hosted = comps.find((c) => c.group === "sim-hosted" && c.metric === "total for fixed duration")!;
    expect(hosted.ratio).toBeCloseTo(2, 2);
    expect(hosted.verdict).toBe("wasm slower");
    const fps = comps.find((c) => c.metric === "mean FPS")!;
    expect(fps.verdict).toBe("equivalent");
    expect(comps.find((c) => c.metric === "WASM linear memory")).toBeUndefined();
  });

  it("words bytes as smaller or larger, shares as lower or higher, and faster for a better time", () => {
    const all = runs().map((r) => {
      if (r.engine !== "wasm") return r;
      r.cold!.servedBeforeReady = [{ path: "/", status: 200, bytes: 500, encoding: "br" }];
      r.scenarios.small.frames["1"].tickShare = 0.5;
      r.scenarios.small.raw["1"].totalMs = 10;
      r.scenarios.small.memory.jsHeapUsedBytes = 3e6;
      return r;
    });
    const comps = compareEngines(aggregate(all, ["small"], [1]));
    expect(comps.find((c) => c.metric === "cold bytes served before ready")!.verdict).toBe("wasm smaller");
    expect(comps.find((c) => c.metric === "JS heap used")!.verdict).toBe("wasm larger");
    expect(comps.find((c) => c.metric === "share of frame time in sim.tick")!.verdict).toBe("wasm higher");
    expect(comps.find((c) => c.group === "sim-raw" && c.metric === "total for fixed duration")!.verdict).toBe("wasm faster");
  });

  it("is inconclusive with one sample per side", () => {
    const comps = compareEngines(aggregate([processRun(0, "ts"), processRun(0, "wasm", {}, 2)], ["small"], [1]));
    // Five a side is still under the floor, even with a clear difference.
    const five = Array.from({ length: 5 }, (_, rep) => [processRun(rep, "ts"), processRun(rep, "wasm", {}, 2)]).flat();
    expect(compareEngines(aggregate(five, ["small"], [1])).find((c) => c.group === "sim-hosted" && c.metric === "total for fixed duration")!.verdict).toBe("inconclusive");
    expect(comps.find((c) => c.group === "sim-hosted" && c.metric === "total for fixed duration")!.verdict).toBe("inconclusive");
  });
});
