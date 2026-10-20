import { describe, expect, it } from "vitest";
import { aggregate, definitions, ratios, validate } from "./analysis";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { csvField, limitations, readModelLimitations, loadWorkerCheckpoint, makeConfig, metricsCsv, parseArgs, ratiosCsv, scriptSizes } from "./main";
import { markdown, num, pct, readModelMarkdown, readModelSection, slices } from "./report";
import { Simulation } from "../../engine/Simulation";
import { serializeUnit } from "../../engine/sim/coerce";
import { FRAME_UNIT_FIELDS, churn, composition, measureReadModel, spread, summarizeMerges, type MergePass } from "./readModel";
import { buildSmallTower } from "../perfCompare/scenarios";
import { modeOrder, summarizeFrames, summarizeHosted, type ModeRun } from "./runner";
import type { ModeName } from "./pageWorker";

const config = { ...makeConfig(parseArgs(["--reps", "6"]), ["small"]) };

/** A finished run with every sample set from `scale` (so the modes and
 *  repetitions differ by a known factor), the same digests everywhere. */
function run(rep: number, mode: ModeName, scale: number, over: Partial<ModeRun> = {}): ModeRun {
  const hosted = (t: number) => ({ wallMs: 100 * scale * t, mainMs: 50 * scale * t, batchMainP50Ms: 1, batchMainP95Ms: 2 * scale, batchMainMaxMs: 3, startDigest: "s", endDigest: "e", hostErrorsAdded: [],
    worker: mode === "wasm-worker" ? { replies: 180, staleReplies: 0, merges: 6, messagesSent: 200, messagesReceived: 181, bytesReceived: 1000, frameBytes: 1800, mergeBytes: 600, applyMs: 10, mergeMs: 5, workerOpsMs: 40, workerReplyMs: 4 } : null });
  const frames = { frames: 60, meanFps: 10 / scale, medianMs: 100, p95Ms: 150, p99Ms: 190, onePercentLowFps: 5, simMinutesPerSecond: 50, clampedFrames: 0, longTasks: 3, blockingMs: 20 * scale, commands: 5, commandsUnanswered: 0, commandToFrameP50Ms: 30, commandToFrameP95Ms: 40, commandToFrameMinMs: 20, hostErrorsAdded: [],
    worker: mode === "wasm-worker" ? { repliesPerSecond: 9, messagesPerSecond: 20, bytesPerSecond: 5000, staleReplies: 0, merges: 2, applyMsPerSecond: 3, commandAckP50Ms: 4, commandAckP95Ms: 6 } : null };
  return {
    rep, mode, order: 0, ok: true, error: null, pageErrors: [], browserVersion: "141", page: { crossOriginIsolated: true, userAgent: "ua", webgl: { renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)", vendor: "Google Inc. (NVIDIA)" } }, rendererEnd: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    cold: { mode, gameReadyMs: 100, modeReadyMs: 200 * scale, firstFrameMs: 300, bytesBeforeReady: 1000, requestsBeforeReady: 9, wasmRequests: mode === "ts" || mode === "wasm-worker" ? 0 : 1 },
    warm: null, cold4x: null, cpuProbe: { unthrottledMs: 100, timed: { "small:4": 390 } },
    scenarios: { small: { raw: mode === "ts" || mode === "wasm" ? { "1": { engine: mode === "ts" ? "ts" : "wasm", totalMs: 80 * scale, startDigest: "s", endDigest: "e" }, "4": { engine: mode === "ts" ? "ts" : "wasm", totalMs: 320 * scale, startDigest: "s", endDigest: "e" } } : {}, memory: { mainHeapUsedBytes: 10, workerHeapUsedBytes: mode === "wasm-worker" ? 5 : null, mainWasmBytes: mode === "wasm" || mode === "wasm-frame" ? 7 : null, workerWasmBytes: mode === "wasm-worker" ? 7 : null, processPssBytes: 100 }, hosted: { "1": hosted(1), "4": hosted(4) }, frames: { "1": frames, "4": frames } } },
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
    const f = summarizeFrames({ intervalsMs: [100, 100, 300, 100], wallMs: 600, simMinutes: 30, longTasks: 2, longTaskMs: 400, blockingMs: 300, commandToFrameMs: [10, 30], commandsUnanswered: 0, worker: { replies: 6, staleReplies: 1, merges: 1, messagesSent: 7, messagesReceived: 6, bytesReceived: 600, applyMs: 12, commandAckMs: [4] }, hostErrorsAdded: [] });
    expect(f).toMatchObject({ frames: 4, clampedFrames: 1, simMinutesPerSecond: 50, commands: 2, commandToFrameP50Ms: 20, commandToFrameMinMs: 10, blockingMs: 300 });
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
      scripts: { worker: { raw: 8000, brotli: 2600 }, otherJs: { raw: 1, brotli: 1 }, enginePackage: { raw: 900_000, brotli: 330_000 } }, runs: rs, metrics, ratios: rr, validation: { ok: true, errors: [], warnings: [] }, limitations: ["one"],
    });
    expect(md.split("\n")[2]).toMatch(/^> \*\*Snapshot, measured 2026-10-14T10:00:00Z to 2026-10-14T14:00:00Z on commit `abc1234`.*Live numbers: re-run `npm run perf:worker`.*Validation passed/);
    expect(md).toMatch(/\| small \| 1x \| wall time, 720 steps \(ms\) \|/);
    expect(md).toMatch(/0\.50x .* lower/);
    expect(md).toMatch(/frames at a 640x360 CSS viewport/);
    expect(definitions(config).length).toBeGreaterThan(20);
  });

  const RTX = "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)";
  const withRenderer = (renderer: string | null, end: string | null | undefined = renderer) => runs().map((r) => ({ ...r, page: { crossOriginIsolated: true, userAgent: "ua", webgl: renderer === null ? null : { renderer, vendor: "v" } }, rendererEnd: end }));

  it("passes a hardware renderer read before and after the frames with no renderer finding", () => {
    const v = validate(config, runs());
    expect(v.errors.join()).not.toMatch(/renderer/i);
    expect(v.warnings.join()).not.toMatch(/renderer/i);
  });

  it("fails closed on a full run unless the GPU is verified, and only warns on a quick run", () => {
    const bad: [string, string | null][] = [["software", "llvmpipe (LLVM 15.0.7, 256 bits)"], ["virtual", "VMware SVGA 3D"], ["null text", "null"], ["masked", "WebKit WebGL"], ["unnamed", "ANGLE (Mystery Vendor, Thing 9000)"], ["missing", null]];
    for (const [label, renderer] of bad) {
      const set = withRenderer(renderer);
      expect(validate(config, set).errors.length, label).toBeGreaterThan(0);
      const quick = validate({ ...config, quick: true }, set);
      expect(quick.errors.filter((e) => /renderer/i.test(e)), label).toEqual([]);
      expect(quick.warnings.join(), label).toMatch(/renderer|rasterizer|adapter/i);
    }
  });

  it("fails mixed renderers and a renderer that changed after the frames, even under a quick run or an exception", () => {
    const mixed = runs().map((r, i) => ({ ...r, page: { crossOriginIsolated: true, userAgent: "ua", webgl: { renderer: i === 0 ? "ANGLE (AMD, AMD Radeon RX 6800 Direct3D11, D3D11)" : RTX, vendor: "v" } }, rendererEnd: i === 0 ? "ANGLE (AMD, AMD Radeon RX 6800 Direct3D11, D3D11)" : RTX }));
    expect(validate(config, mixed).errors.join()).toMatch(/different WebGL renderers/);
    const fell = withRenderer(RTX, "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)");
    expect(validate({ ...config, quick: true }, fell).errors.join()).toMatch(/renderer changed during/);
    expect(validate(config, fell, "EX-4").errors.join()).toMatch(/renderer changed during/);
    expect(validate(config, withRenderer(RTX, null)).errors.join()).toMatch(/none after the frames/);
  });

  it("turns the failures into warnings, naming the entry, when a register exception is declared", () => {
    const v = validate(config, withRenderer("llvmpipe (LLVM 15.0.7, 256 bits)"), "EX-4");
    expect(v.errors.filter((e) => /renderer|rasterizer/i.test(e))).toEqual([]);
    expect(v.warnings.join()).toMatch(/exception EX-4: .*software rasterizer/);
  });

  it("separates the worker placement from the sync changes, and counts the pairs a zero reference dropped", () => {
    const rs = ratios(aggregate(config, runs()), config.modes);
    const placement = rs.find((r) => r.metric === "wall time, 720 steps" && r.throttle === "1" && r.mode === "wasm-worker" && r.against === "wasm-frame")!;
    expect(placement.ratio).toBeCloseTo(0.5, 9);
    expect(rs.some((r) => r.against === "wasm-frame" && r.mode !== "wasm-worker")).toBe(false);
    const zeroed = runs().map((r) => (r.mode === "wasm" && r.rep < 2 ? { ...r, scenarios: { small: { ...r.scenarios.small, frames: { ...r.scenarios.small.frames, "1": { ...r.scenarios.small.frames["1"], blockingMs: 0 } } } } } : r));
    const blocking = ratios(aggregate(config, zeroed), config.modes).find((r) => r.metric.startsWith("main-thread blocking") && r.throttle === "1" && r.mode === "ts" && r.against === "wasm")!;
    expect(blocking.zeroReference).toBe(2);
    expect(blocking.n).toBe(4);
  });

  it("fails a run whose command became visible before it was sent", () => {
    const rs = runs();
    const f1 = rs[0].scenarios.small.frames["1"];
    rs[0] = { ...rs[0], scenarios: { small: { ...rs[0].scenarios.small, frames: { ...rs[0].scenarios.small.frames, "1": { ...f1, commandToFrameMinMs: -2.5 } } } } };
    expect(validate(config, rs).errors.join()).toMatch(/1x frames: a command became visible 2\.50 ms before it was sent/);
    const { commandToFrameMinMs: _drop, ...old } = f1;
    rs[0] = { ...rs[0], scenarios: { small: { ...rs[0].scenarios.small, frames: { ...rs[0].scenarios.small.frames, "1": old as typeof f1 } } } };
    expect(validate(config, rs).errors.join()).toMatch(/1x frames: no smallest command latency was recorded/);
  });

  it("checks the bare engine runs against the hosted end state", () => {
    const rs = runs();
    rs[0] = { ...rs[0], scenarios: { small: { ...rs[0].scenarios.small, raw: { ...rs[0].scenarios.small.raw, "1": { engine: "ts", totalMs: 1, startDigest: "s", endDigest: "drift" } } } } };
    expect(validate(config, rs).errors.join()).toMatch(/small 1x: the modes or repetitions ended in 2 different states/);
    const metrics = aggregate(config, runs());
    expect(metrics.find((m) => m.group === "raw" && m.mode === "ts" && m.throttle === "1")!.values).toHaveLength(6);
    expect(metrics.find((m) => m.group === "raw" && m.mode === "wasm-worker")!.values).toEqual([]);
  });

  it("resumes only a clean, matching, unfinished run, cuts a torn last line and runs failed ones again", () => {
    const dir = mkdtempSync(join(tmpdir(), "perf-worker-"));
    try {
      const meta = { commit: "c", dirty: false, skipBuild: false, config, enginePackage: {}, scenarios: ["x"], machine: { cpu: "a" } };
      writeFileSync(join(dir, "checkpoint.json"), JSON.stringify({ ...meta, startedAt: "2026-10-14T01:00:00Z" }));
      const ok = run(0, "ts", 1);
      const failed = { ...run(0, "wasm", 1), ok: false, error: "x" };
      writeFileSync(join(dir, "runs.jsonl"), `${JSON.stringify(ok)}\n${JSON.stringify(failed)}\n{"rep":1,"mo`);
      const cp = loadWorkerCheckpoint(dir, meta);
      expect(cp.startedAt).toBe("2026-10-14T01:00:00Z");
      expect(cp.runs.map((r) => r.mode)).toEqual(["ts"]);
      expect(cp.retried).toBe(1);
      expect(readFileSync(join(dir, "runs.jsonl"), "utf8").endsWith("\n")).toBe(true);
      expect(() => loadWorkerCheckpoint(dir, { ...meta, commit: "other" })).toThrow(/its commit differs/);
      expect(() => loadWorkerCheckpoint(dir, { ...meta, config: makeConfig(parseArgs(["--reps", "6", "--viewport", "1280x720"]), ["small"]) })).toThrow(/its config differs from this run's \(viewport; pass the options the run started with\)/);
      expect(() => loadWorkerCheckpoint(dir, { ...meta, dirty: true })).toThrow(/clean tree/);
      writeFileSync(join(dir, "checkpoint.json"), JSON.stringify({ ...meta, dirty: true, startedAt: "x" }));
      expect(() => loadWorkerCheckpoint(dir, meta)).toThrow(/started on a dirty tree/);
      writeFileSync(join(dir, "results.json"), "{}");
      expect(() => loadWorkerCheckpoint(dir, meta)).toThrow(/already holds final results/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("quotes CSV fields and reads the build's sizes, refusing a build without one worker chunk or the package", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField('a, "b"')).toBe('"a, ""b"""');
    expect(csvField(1.5)).toBe("1.5");
    const dist = mkdtempSync(join(tmpdir(), "perf-worker-dist-"));
    try {
      mkdirSync(join(dist, "assets"));
      mkdirSync(join(dist, "engine"));
      writeFileSync(join(dist, "assets", "main-1.js"), "x".repeat(100));
      expect(() => scriptSizes(dist)).toThrow(/0 engine worker chunks/);
      writeFileSync(join(dist, "assets", "engineWorker-1.js"), "y".repeat(50));
      expect(() => scriptSizes(dist)).toThrow(/verticopolis_engine_bg\.wasm is missing/);
      writeFileSync(join(dist, "engine", "verticopolis_engine_bg.wasm"), "z".repeat(10));
      writeFileSync(join(dist, "engine", "verticopolis_engine.js"), "z".repeat(5));
      const sizes = scriptSizes(dist);
      expect(sizes.worker.raw).toBe(50);
      expect(sizes.otherJs.raw).toBe(100);
      expect(sizes.enginePackage.raw).toBe(15);
      expect(sizes.worker.brotli).toBeGreaterThan(0);
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });

  it("parses its arguments", () => {
    expect(() => parseArgs(["--scenarios", ","])).toThrow(/at least one/);
    expect(() => parseArgs(["--scenarios", "a,a"])).toThrow(/twice/);
    expect(parseArgs(["--quick"]).reps).toBe(2);
    expect(parseArgs(["--quick", "--reps", "3"]).reps).toBe(3);
    expect(() => parseArgs(["--reps", "0"])).toThrow(/positive/);
    expect(() => parseArgs(["--resume", "a", "--out", "b"])).toThrow(/takes no --out/);
    expect(() => parseArgs(["--bogus"])).toThrow(/unknown argument/);
    expect(parseArgs([]).viewport).toEqual({ width: 640, height: 360 });
    expect(parseArgs(["--viewport", "1280x720"]).viewport).toEqual({ width: 1280, height: 720 });
    expect(makeConfig(parseArgs(["--viewport", "1280x720"]), ["small"]).viewport).toEqual({ width: 1280, height: 720 });
    for (const bad of ["1280", "1280x", "x720", "1280X720", "100x100", "9000x720", "1280x720x1"]) expect(() => parseArgs(["--viewport", bad])).toThrow(/WIDTHxHEIGHT/);
    expect(() => parseArgs(["--viewport"])).toThrow(/needs a value/);
    expect(limitations(makeConfig(parseArgs([]), ["small"])).join("\n")).toMatch(/640x360 CSS viewport \(the default.*so at that size the modes simulated almost nothing/);
    expect(limitations(makeConfig(parseArgs(["--viewport", "1280x720"]), ["small"])).join("\n")).toMatch(/1280x720 CSS viewport \(set with --viewport\)\. A frame longer than 200 ms/);
  });
});

describe("perf:worker read model shape", () => {
  const save = (units: object[], extra: object = {}) => JSON.stringify({ money: 5, units, ...extra });

  it("splits a save by top-level key and by unit kind, as shares of the whole", () => {
    const units = [{ id: 1, kind: "floor" }, { id: 2, kind: "floor" }, { id: 3, kind: "office", rent: 1000 }];
    const text = save(units, { log: ["a"] });
    const c = composition(text);
    expect(c.totalChars).toBe(text.length);
    expect(c.units).toBe(3);
    expect(c.keys.map((k) => k.name)).toEqual(["units", "log", "money"]);
    expect(c.keys[0].chars).toBe(JSON.stringify(units).length);
    expect(c.keys[0].share).toBeCloseTo(JSON.stringify(units).length / text.length, 12);
    const floor = c.unitKinds.find((k) => k.name === "floor")!;
    expect(floor).toMatchObject({ count: 2, chars: 2 * JSON.stringify(units[0]).length });
    // Kinds sum to the units key less its brackets and commas.
    expect(c.unitKinds.reduce((a, k) => a + k.chars, 0)).toBe(c.keys[0].chars - 2 - (units.length - 1));
    expect(c.unitKinds[0].name).toBe("floor");
  });

  it("counts units changed, added and removed by id, and names the fields and keys that moved", () => {
    const before = save([{ id: 1, kind: "floor" }, { id: 2, kind: "office", state: "vacant", sat: 0.5 }, { id: 3, kind: "condo" }], { minutes: 0 });
    const after = save([{ id: 2, kind: "office", state: "occupied", sat: 0.5 }, { id: 1, kind: "floor" }, { id: 4, kind: "shop" }], { minutes: 60 });
    expect(churn(before, after)).toEqual({ changed: 1, added: 1, removed: 1, total: 3, outsideFrame: 0, unitKeys: ["state"], topKeys: ["minutes", "units"] });
    // A change only in fields the frame view does not carry needs a merge.
    expect(churn(before, save([{ id: 1, kind: "floor" }, { id: 2, kind: "office", state: "vacant", sat: 0.7 }, { id: 3, kind: "condo", occupants: 2 }], { minutes: 0 }))).toMatchObject({ changed: 2, outsideFrame: 1, unitKeys: ["occupants", "sat"] });
    // A unit with a frame field and another field changed still needs the merge.
    expect(churn(before, save([{ id: 1, kind: "floor" }, { id: 2, kind: "office", state: "occupied", sat: 0.9 }, { id: 3, kind: "condo" }], { minutes: 0 }))).toMatchObject({ changed: 1, outsideFrame: 1 });
    // A record whose keys only moved is no change.
    expect(churn(before, save([{ kind: "floor", id: 1 }, { id: 2, kind: "office", sat: 0.5, state: "vacant" }, { id: 3, kind: "condo" }], { minutes: 0 }))).toMatchObject({ changed: 0, outsideFrame: 0, unitKeys: [] });
    expect(FRAME_UNIT_FIELDS).toEqual(["state", "occupants", "customersIn", "hotelCustomersIn", "outForMeal"]);
    // A save carries state and occupants of those, under the same names, and drops the visit counters.
    const office = buildSmallTower().tower.units.find((u) => u.kind === "office")!;
    const saved = serializeUnit({ ...office, state: "occupied", occupants: 3, customersIn: 2, hotelCustomersIn: 1, outForMeal: 1 });
    expect(FRAME_UNIT_FIELDS.filter((k) => k in saved)).toEqual(["state", "occupants"]);
    // Reordering alone is not a unit change, but it is a units-key change.
    expect(churn(before, save([{ id: 3, kind: "condo" }, { id: 1, kind: "floor" }, { id: 2, kind: "office", state: "vacant", sat: 0.5 }], { minutes: 0 }))).toMatchObject({ changed: 0, added: 0, removed: 0, topKeys: ["units"] });
    expect(() => churn(save([{ id: 1 }, { id: 1 }]), save([]))).toThrow(/appears twice/);
  });

  it("summarizes merges as the share of units changed and the units touched", () => {
    const pass = (changed: number, total: number, added = 0): MergePass => ({ step: 4, reason: "hour", changed, added, removed: 0, total, outsideFrame: changed > 20 ? 7 : 1, unitKeys: [], topKeys: [] });
    const sum = summarizeMerges([pass(10, 100), pass(0, 100, 3), pass(50, 200)]);
    expect(sum.changedShare).toMatchObject({ median: 0.1, max: 0.25 });
    expect(sum.changedShare!.mean).toBeCloseTo(0.35 / 3, 12);
    expect(sum).toMatchObject({ touched: { median: 10, mean: 21, max: 50 }, changedCount: { median: 10, mean: 20, max: 50 }, outsideFrame: { median: 1, mean: 3, max: 7 } });
    expect(summarizeMerges([])).toEqual({ changedShare: null, touched: null, changedCount: null, outsideFrame: null });
    // The report's shares: tiny ones are bounded, small ones get two decimals, the rest one.
    expect([pct(0), pct(0.00005), pct(0.0005), pct(0.25)]).toEqual(["0.0%", "<0.01%", "0.05%", "25.0%"]);
    const sl = (name: string, count: number, share: number) => ({ name, count, chars: 0, share });
    expect(slices([sl("units", 1, 0.9), sl("floor", 1200, 0.05), sl("a", 1, 0.03), sl("b", 1, 0.02)], 2)).toBe("units 90.0%, floor (1,200) 5.0%, 2 more 5.0%");
    expect(spread([4, 1, 3, 2])).toEqual({ median: 2.5, mean: 2.5, max: 4 });
    expect([num(2888), num(673.9166), num(0.5)]).toEqual(["2,888", "673.9", "0.5"]);
  });

  it("merges where the worker host would, once a batch, and repeats exactly", () => {
    const tower = { name: "small", save: JSON.stringify(buildSmallTower().serialize()) };
    const opts = { steps: 62, dt: 2, batch: 4 };
    const shape = measureReadModel(tower, opts);
    expect(shape.merges.length).toBeGreaterThanOrEqual(1);
    for (const m of shape.merges) {
      expect(m.step % opts.batch === 0 || m.step === opts.steps).toBe(true);
      expect(m.reason).not.toBe("revision");
      expect(m.topKeys).toContain("minutes");
    }
    expect(shape.composition.units).toBe(JSON.parse(tower.save).units.length);
    expect(shape.composition.unitKinds.find((k) => k.name === "floor")!.count).toBeGreaterThan(0);
    expect(shape.changedShare!.max).toBeGreaterThan(0);
    expect(measureReadModel(tower, opts)).toEqual(shape);
    const md = readModelSection([shape]).join("\n");
    expect(md).toMatch(/^## read model/);
    expect(md).toContain(`| small | ${shape.composition.totalChars.toLocaleString("en-US")} chars | ${shape.composition.units.toLocaleString("en-US")} | units `);
    for (const m of shape.merges) expect(m.outsideFrame).toBeLessThanOrEqual(m.changed);
    expect(md).toContain(`| ${shape.merges.length} (${shape.merges.length} hour) |`);
    // The first merge compares against the loaded save itself.
    expect(shape.composition.totalChars).toBe(JSON.stringify(Simulation.deserialize(JSON.parse(tower.save)).serialize()).length);
    expect(readModelSection([])).toEqual([]);
    const report = readModelMarkdown({ schema: 1, generatedAt: "2026-10-15T12:00:00Z", commit: "abcdef0123", dirty: false, appVersion: "2.34.1", node: "v22.22.0", config: { ...opts, quick: false }, scenarios: [{ name: "small", sha256: "a".repeat(64) }], readModel: [shape], limitations: ["one"] });
    expect(report.split("\n")[2]).toMatch(/^> \*\*Snapshot, measured 2026-10-15T12:00:00Z on commit `abcdef0`.*Live numbers: re-run `npm run perf:worker -- --read-model`/);
    expect(report).toContain("- one");
    expect(parseArgs(["--read-model"]).readModelOnly).toBe(true);
    for (const extra of [["--resume", "x"], ["--skip-build"], ["--reps", "3"], ["--viewport", "1280x720"]]) expect(() => parseArgs(["--read-model", ...extra])).toThrow(/takes no --resume, --skip-build, --reps or --viewport/);
    expect(parseArgs(["--read-model", "--quick", "--scenarios", "small"]).readModelOnly).toBe(true);
    expect(readModelLimitations(makeConfig(parseArgs(["--read-model"]), ["small"]))).toEqual([expect.stringMatching(/^The read model section is measured in Node on the TypeScript engine.*720 steps in batches of 4/)]);
  });
});
