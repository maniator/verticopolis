import { describe, expect, it } from "vitest";
import { aggregate, definitions, ratios, validate } from "./analysis";
import { makeConfig, metricsCsv, parseArgs, ratiosCsv } from "./main";
import { markdown } from "./report";
import { modeOrder, summarizeFrames, summarizeHosted, type ModeRun } from "./runner";
import type { ModeName } from "./pageWorker";

const config = { ...makeConfig(parseArgs(["--reps", "6"]), ["small"]) };

/** A finished run with every sample set from `scale` (so the modes and
 *  repetitions differ by a known factor), the same digests everywhere. */
function run(rep: number, mode: ModeName, scale: number, over: Partial<ModeRun> = {}): ModeRun {
  const hosted = (t: number) => ({ wallMs: 100 * scale * t, mainMs: 50 * scale * t, batchMainP50Ms: 1, batchMainP95Ms: 2 * scale, batchMainMaxMs: 3, startDigest: "s", endDigest: "e", hostErrorsAdded: [],
    worker: mode === "wasm-worker" ? { replies: 180, staleReplies: 0, merges: 6, messagesSent: 200, messagesReceived: 181, bytesReceived: 1000, frameBytes: 1800, mergeBytes: 600, applyMs: 10, mergeMs: 5, workerOpsMs: 40, workerReplyMs: 4 } : null });
  const frames = { frames: 60, meanFps: 10 / scale, medianMs: 100, p95Ms: 150, p99Ms: 190, onePercentLowFps: 5, simMinutesPerSecond: 50, clampedFrames: 0, longTasks: 3, blockingMs: 20 * scale, commands: 5, commandToFrameP50Ms: 30, commandToFrameP95Ms: 40, hostErrorsAdded: [],
    worker: mode === "wasm-worker" ? { repliesPerSecond: 9, messagesPerSecond: 20, bytesPerSecond: 5000, staleReplies: 0, merges: 2, applyMsPerSecond: 3, commandAckP50Ms: 4, commandAckP95Ms: 6 } : null };
  return {
    rep, mode, order: 0, ok: true, error: null, pageErrors: [], browserVersion: "141", page: null,
    cold: { mode, gameReadyMs: 100, modeReadyMs: 200 * scale, firstFrameMs: 300, bytesBeforeReady: 1000, requestsBeforeReady: 9, wasmRequests: mode === "ts" || mode === "wasm-worker" ? 0 : 1 },
    warm: null, cold4x: null, cpuProbe: { unthrottledMs: 100, timed: { "small:4": 390 } },
    scenarios: { small: { memory: { mainHeapUsedBytes: 10, workerHeapUsedBytes: mode === "wasm-worker" ? 5 : null, mainWasmBytes: mode === "wasm" || mode === "wasm-frame" ? 7 : null, workerWasmBytes: mode === "wasm-worker" ? 7 : null, processPssBytes: 100 }, hosted: { "1": hosted(1), "4": hosted(4) }, frames: { "1": frames, "4": frames } } },
    offline: null,
    ...over,
  };
}

const SCALE: Record<ModeName, number> = { ts: 1, wasm: 4, "wasm-frame": 2, "wasm-worker": 1 };
const runs = (): ModeRun[] => Array.from({ length: 6 }, (_, rep) => config.modes.map((m) => run(rep, m, SCALE[m] * (1 + rep / 100)))).flat();

describe("perf:worker analysis", () => {
  it("summarizes each metric per mode and pairs the ratios by repetition", () => {
    const metrics = aggregate(config, runs());
    const wall = metrics.find((m) => m.metric === "wall time, 720 steps" && m.throttle === "1" && m.mode === "wasm")!;
    expect(wall.values).toHaveLength(6);
    expect(wall.summary!.median).toBeCloseTo(400 * 1.025, 6);
    const rs = ratios(metrics, config.modes);
    const frame = rs.find((r) => r.metric === "wall time, 720 steps" && r.throttle === "1" && r.mode === "wasm-frame" && r.against === "wasm")!;
    expect(frame.ratio).toBeCloseTo(0.5, 9);
    expect(frame.n).toBe(6);
    expect(frame.verdict).toBe("lower");
    const ts = rs.find((r) => r.metric === "mean FPS" && r.mode === "wasm" && r.against === "ts")!;
    expect(ts.ratio).toBeCloseTo(0.25, 9);
    expect(ts.verdict).toBe("lower");
  });

  it("counts the worker's heap and linear memory with the page's, and leaves the worker-only rows to the worker", () => {
    const metrics = aggregate(config, runs());
    const combined = (mode: ModeName) => metrics.find((m) => m.metric.startsWith("JS heaps + WASM") && m.mode === mode)!.summary!.median;
    expect(combined("wasm-worker")).toBe(10 + 5 + 7);
    expect(combined("wasm")).toBe(10 + 7);
    expect(combined("ts")).toBe(10);
    const traffic = metrics.filter((m) => m.group === "traffic");
    expect(traffic.length).toBeGreaterThan(0);
    expect(traffic.every((m) => m.mode === "wasm-worker")).toBe(true);
    expect(traffic.find((m) => m.metric.startsWith("frame view bytes per reply") && m.throttle === "1")!.summary!.median).toBe(10);
    // A worker run whose worker heap could not be read has no combined sample.
    const missing = runs().map((r) => (r.mode === "wasm-worker" ? { ...r, scenarios: { small: { ...r.scenarios.small, memory: { ...r.scenarios.small.memory, workerHeapUsedBytes: null } } } } : r));
    expect(aggregate(config, missing).find((m) => m.metric.startsWith("JS heaps + WASM") && m.mode === "wasm-worker")!.values).toEqual([]);
  });

  it("fails closed on a missing or failed run, a digest disagreement, a host error, a weak throttle and mixed browsers", () => {
    expect(validate(config, runs()).errors).toEqual([]);
    const all = runs();
    all[0] = { ...all[0], ok: false, error: "boom" };
    all[1] = { ...all[1], scenarios: { small: { ...all[1].scenarios.small, hosted: { ...all[1].scenarios.small.hosted, "4": { ...all[1].scenarios.small.hosted["4"], endDigest: "other" } } } } };
    all[2] = { ...all[2], cpuProbe: { unthrottledMs: 100, timed: { "small:4": 150 } }, browserVersion: "140" };
    all[3] = { ...all[3], scenarios: { small: { ...all[3].scenarios.small, frames: { ...all[3].scenarios.small.frames, "1": { ...all[3].scenarios.small.frames["1"], hostErrorsAdded: ["trap"] } } } } };
    const v = validate(config, all.slice(0, -1));
    const text = v.errors.join("\n");
    expect(text).toMatch(/rep 0 ts: failed: boom/);
    expect(text).toMatch(/small 4x: the modes or repetitions ended in 2 different states/);
    expect(text).toMatch(/under half the 4x throttle/);
    expect(text).toMatch(/different browser builds/);
    expect(text).toMatch(/host errors trap/);
    expect(text).toMatch(/rep 5 wasm-worker: 0 runs/);
  });

  it("rotates the mode order so no mode always runs first", () => {
    const modes = config.modes;
    const firsts = new Set(Array.from({ length: 4 }, (_, rep) => modeOrder(rep, modes)[0]));
    expect(firsts.size).toBe(4);
    for (let rep = 0; rep < 8; rep++) expect([...modeOrder(rep, modes)].sort()).toEqual([...modes].sort());
  });

  it("summarizes a hosted and a frames pass", () => {
    const h = summarizeHosted({ steps: 8, wallMs: 10, mainMs: 6, batchMainMs: [1, 2, 3, 4], worker: null, startKey: "a", endKey: "b", hostErrorsAdded: [] }, "s", "e");
    expect(h).toMatchObject({ wallMs: 10, mainMs: 6, batchMainP50Ms: 2.5, batchMainMaxMs: 4, startDigest: "s", endDigest: "e" });
    const f = summarizeFrames({ intervalsMs: [100, 100, 300, 100], wallMs: 600, simMinutes: 30, longTasks: 2, longTaskMs: 400, blockingMs: 300, commandToFrameMs: [10, 30], worker: { replies: 6, staleReplies: 1, merges: 1, messagesSent: 7, messagesReceived: 6, bytesReceived: 600, applyMs: 12, commandAckMs: [4] }, hostErrorsAdded: [] });
    expect(f).toMatchObject({ frames: 4, clampedFrames: 1, simMinutesPerSecond: 50, commands: 2, commandToFrameP50Ms: 20, blockingMs: 300 });
    expect(f.worker).toMatchObject({ repliesPerSecond: 10, bytesPerSecond: 1000, applyMsPerSecond: 20, commandAckP50Ms: 4 });
  });

  it("writes the CSVs and a report that leads with the snapshot window and the validation state", () => {
    const rs = runs();
    const metrics = aggregate(config, rs);
    const rr = ratios(metrics, config.modes);
    expect(metricsCsv(metrics).split("\n")[0]).toMatch(/^group,scenario,throttle,metric/);
    expect(ratiosCsv(rr).split("\n").length).toBe(rr.length + 2);
    const md = markdown({
      schema: 1, startedAt: "2026-10-14T10:00:00Z", generatedAt: "2026-10-14T14:00:00Z", config, browser: { version: "141", executable: null },
      environment: { commitShort: "abc1234", appVersion: "2.31.1", dirty: false, enginePackage: { "verticopolis_engine_bg.wasm": "f".repeat(64) }, engineBuildHash: "h", cpuModel: "cpu", logicalCpus: 4, totalMemoryBytes: 2 ** 34, os: "linux", node: "22", playwright: "1.61" } as never,
      scenarios: [{ name: "small", sha256: "a".repeat(64), population: 10, units: 2, transports: 1, saveBytes: 5 }],
      scripts: { worker: { raw: 8000, brotli: 2600 }, otherJs: { raw: 1, brotli: 1 } }, runs: rs, metrics, ratios: rr, validation: { ok: true, errors: [], warnings: [] }, limitations: ["one"],
    });
    expect(md.split("\n")[2]).toMatch(/^> \*\*Snapshot, measured 2026-10-14T10:00:00Z to 2026-10-14T14:00:00Z on commit `abc1234`.*Live numbers: re-run `npm run perf:worker`.*Validation passed/);
    expect(md).toMatch(/\| small \| 1x \| wall time, 720 steps \(ms\) \|/);
    expect(md).toMatch(/0\.50x .* lower/);
    expect(definitions(config).length).toBeGreaterThan(20);
  });

  it("parses its arguments", () => {
    expect(parseArgs(["--quick"]).reps).toBe(2);
    expect(parseArgs(["--quick", "--reps", "3"]).reps).toBe(3);
    expect(() => parseArgs(["--reps", "0"])).toThrow(/positive/);
    expect(() => parseArgs(["--resume", "a", "--out", "b"])).toThrow(/takes no --out/);
    expect(() => parseArgs(["--bogus"])).toThrow(/unknown argument/);
  });
});
