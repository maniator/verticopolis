import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Metric } from "./analysis";
import { compareRuns, resolveControls } from "./beforeAfter";
import { comparisonCsv, comparisonMarkdown, main, parseBeforeAfterArgs } from "./beforeAfterMain";
import type { WorkerResults } from "./main";
import type { ModeName } from "./pageWorker";

const RTX = "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)";
const SWIFT = "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)";
const REPS = Array.from({ length: 10 }, (_, i) => i);
const MODES: ModeName[] = ["ts", "wasm", "wasm-frame", "wasm-worker"];
const TIME = "main-thread time, 720 steps";
const LOW = "1% low FPS";
const BLOCK = "main-thread blocking (long tasks past 50 ms)";
const MERGES = "full-save merges, 720 steps (hosted)";

interface Spec {
  commit?: string;
  hash?: string;
  startedAt?: string;
  generatedAt?: string | null;
  reps?: number;
  /** Multiplier on every value of a mode, to make the mode slower (times) in this run. */
  scale?: Partial<Record<ModeName, number>>;
  /** Limits `scale` to the metrics with this name, leaving the others steady. */
  scaleOnly?: string;
  dirty?: boolean;
  gpuVerified?: boolean;
  browserVersion?: string;
  scenarioHash?: string;
  scenarioOrder?: boolean;
  quick?: boolean | undefined;
  validationOk?: boolean;
  validationErrors?: string[];
  skipRep?: number;
  skipRepFor?: ModeName;
  /** The same wobble in every run, so intervals are not degenerate but ratios stay exact. */
  wobble?: number;
  /** Independent relative noise per value, from a hash of `seed` and the value's place: two runs with different seeds are a real A/A pair. */
  jitter?: number;
  seed?: number;
  /** Replaces a value; return undefined to keep the generated one. */
  valueFor?: (mode: ModeName, name: string, rep: number, base: number) => number | undefined;
  rendererEnd?: string | null;
  rendererEndCold?: string | null | undefined;
}

/** A value in [-1, 1] that depends only on the key. */
const noise = (key: string): number => {
  let h = 0x811c9dc5;
  for (const ch of key) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
};

const metric = (mode: ModeName, name: string, base: number, spec: Spec, over: Partial<Metric> = {}): Metric => {
  const reps = REPS.filter((r) => !(r === spec.skipRep && (!spec.skipRepFor || spec.skipRepFor === mode)));
  const scale = !spec.scaleOnly || spec.scaleOnly === name ? (spec.scale?.[mode] ?? 1) : 1;
  const values = reps.map((r) => spec.valueFor?.(mode, name, r, base) ?? base * scale * (1 + (spec.wobble ?? 0.01) * ((r % 3) - 1)) * (1 + (spec.jitter ?? 0) * noise(`${spec.seed ?? 0}|${mode}|${name}|${over.throttle ?? "1"}|${r}`)));
  return { group: "hosted", scenario: "large", throttle: "1", metric: name, unit: "ms", better: "lower", mode, values, reps, summary: null, ...over };
};

const results = (spec: Spec = {}): WorkerResults => {
  const metrics = MODES.flatMap((m) => [
    metric(m, TIME, 800, spec),
    metric(m, "mean FPS", 60, spec, { group: "frames", unit: "fps", better: "higher" }),
    metric(m, LOW, 30, spec, { group: "frames", unit: "fps", better: "higher" }),
    metric(m, BLOCK, 0, spec, { group: "frames", unit: "ms" }),
    // Rows no run can have data for: the bare engine of a host that does not measure it, and PSS off Linux.
    ...(m === "wasm-worker" ? [metric(m, "bare engine, 720 steps", 1, spec, { group: "raw", values: [], reps: [] })] : []),
    metric(m, "browser process PSS", 1, spec, { group: "memory", unit: "bytes", values: [], reps: [] }),
    metric(m, TIME, 800, spec, { throttle: "4", ...(m === "wasm-worker" ? { unthrottled: "worker" as const } : {}) }),
    ...(m === "wasm-worker" ? [metric(m, MERGES, 24, spec, { group: "traffic", unit: "count" })] : []),
  ]);
  const scenarios = [{ name: "large", sha256: spec.scenarioHash ?? "s1", population: 1, units: 1, transports: 1, saveBytes: 1 }, { name: "medium", sha256: "s0", population: 1, units: 1, transports: 1, saveBytes: 1 }];
  return {
    schema: 1,
    startedAt: spec.startedAt ?? "2026-10-21T08:00:00Z",
    generatedAt: spec.generatedAt === null ? undefined : (spec.generatedAt ?? "2026-10-21T12:00:00Z"),
    config: { reps: spec.reps ?? 10, modes: MODES, scenarios: ["large", "medium"], throttles: [1, 4], steps: 720, dt: 2, batch: 4, memorySteps: 1, warmSteps: 1, frameWindowMs: 1, frameWarmMs: 1, speed: 3, commandEveryMs: 1000, quick: "quick" in spec ? spec.quick : false, viewport: { width: 1280, height: 720 } },
    environment: { commit: spec.commit ?? "a".repeat(40), commitShort: "aaaaaaa", appVersion: "2.36.0", dirty: spec.dirty ?? false, tree: { porcelain: [], diffSha256: null, untracked: [], hidden: [], complete: true }, engineBuildHash: spec.hash ?? "h1", cpuModel: "Ryzen 5 5600X", logicalCpus: 12, totalMemoryBytes: 32 * 2 ** 30, os: "win32", kernel: "10", arch: "x64", node: "22.22.0", rust: "1.90", playwright: "1.61.1" },
    browser: { version: spec.browserVersion ?? "149.0.7827.55", executable: null, channel: null, args: [], rendererException: null, gpuVerified: spec.gpuVerified ?? true },
    scenarios: spec.scenarioOrder ? scenarios.slice().reverse() : scenarios,
    scripts: {},
    runs: [{ rep: 0, mode: "ts", ok: true, page: { webgl: { renderer: RTX, vendor: "v" } }, rendererEnd: "rendererEnd" in spec ? spec.rendererEnd : RTX, rendererEndCold: "rendererEndCold" in spec ? spec.rendererEndCold : RTX }],
    metrics,
    ratios: [],
    validation: { ok: spec.validationOk ?? true, errors: spec.validationErrors ?? [], warnings: [] },
    limitations: [],
  } as unknown as WorkerResults;
};

const before = (spec: Spec = {}) => results(spec);
const after = (spec: Spec = {}) => results({ commit: "b".repeat(40), hash: "h2", startedAt: "2026-10-21T14:00:00Z", generatedAt: "2026-10-21T18:00:00Z", ...spec });
type Cmp = ReturnType<typeof compareRuns>;
const row = (c: Cmp, mode: ModeName, name: string, throttle = "1") => c.rows.find((r) => r.mode === mode && r.metric === name && r.throttle === throttle)!;
const both = ["ts", "wasm"] as ModeName[];

describe("compareRuns", () => {
  it("measures a subject slowdown against steady controls, above 1.0 meaning worse", () => {
    const c = compareRuns(before(), after({ scale: { "wasm-worker": 1.2 } }));
    expect(c.problems).toEqual([]);
    expect(c.kind).toBe("before-after");
    const s = row(c, "wasm-worker", TIME);
    expect(s.role).toBe("subject");
    expect(s.basis).toBe("ratio");
    expect(s.ratio).toBeCloseTo(1.2, 1);
    expect(s.status).toBe("ok");
    expect(s.pairs).toBe(10);
    expect(s.diffMedian).toBeCloseTo(160, -1);
    // Steady controls leave the net ratio at the raw one.
    expect(s.net!.ratio).toBeCloseTo(s.ratio!, 1);
    expect(row(c, "ts", TIME).status).toBe("control-ok");
  });

  it("reads a rate the other way round, in the ratio, its interval and the difference", () => {
    const f = (r: number) => 1 + 0.1 * ((r % 3) - 1);
    const c = compareRuns(before({ wobble: 0 }), after({ wobble: 0, valueFor: (m, n, r, base) => (m === "wasm-worker" && n === LOW ? base * 0.5 * f(r) : undefined) }));
    const s = row(c, "wasm-worker", LOW);
    // Ratios 30 / (15 f): three of 1.818, three of 2.0 and four of 2.222; the interval takes order statistics 2 and 9.
    expect(s.ratio).toBeCloseTo(2, 6);
    expect(s.ciLow).toBeCloseTo(30 / 16.5, 6);
    expect(s.ciHigh).toBeCloseTo(30 / 13.5, 6);
    expect(s.ciLow!).toBeGreaterThan(1);
    // The difference is signed so that positive is worse: BEFORE minus AFTER for a rate.
    expect(s.diffMedian).toBeCloseTo(15, 6);
    expect(s.diffCiLow).toBeCloseTo(13.5, 6);
    expect(s.diffCiHigh).toBeCloseTo(16.5, 6);
    // A rate that improved reads below 1.0 and negative.
    const better = compareRuns(before(), after({ scale: { "wasm-worker": 1.5 }, scaleOnly: LOW }));
    expect(row(better, "wasm-worker", LOW).ratio).toBeCloseTo(1 / 1.5, 1);
    expect(row(better, "wasm-worker", LOW).diffMedian!).toBeLessThan(0);
  });

  it("voids the subject rows of a metric whose control moved, and says which control", () => {
    const c = compareRuns(before(), after({ scale: { ts: 1.2, "wasm-worker": 1.2 }, scaleOnly: TIME }));
    const s = row(c, "wasm-worker", TIME);
    expect(s.status).toBe("void");
    expect(s.voidedBy).toEqual(["ts 1.20x"]);
    expect(row(c, "ts", TIME).status).toBe("control-drift");
    // The frame-rate metric's controls are steady, so that row stands.
    expect(row(c, "wasm-worker", "mean FPS").status).toBe("ok");
  });

  it("lets a control that moved block the row even when it has too few pairs, and puts void before thin", () => {
    // ts has 9 pairs and sits at 1.3x while wasm has 10 and vouches: the subject is void all the same.
    const c = compareRuns(before(), after({ scale: { ts: 1.3, "wasm-worker": 1.2 }, scaleOnly: TIME, skipRep: 3, skipRepFor: "ts" }), { controls: both });
    expect(row(c, "ts", TIME).pairs).toBe(9);
    expect(row(c, "ts", TIME).status).toBe("control-drift");
    expect(row(c, "wasm", TIME).status).toBe("control-ok");
    expect(row(c, "wasm-worker", TIME).status).toBe("void");
    expect(row(c, "wasm-worker", TIME).voidedBy.join(" ")).toMatch(/ts 1\.30x \(only 9 pairs, but it moved\)/);
    // With the subject short of pairs as well, void still comes before thin.
    const v = compareRuns(before(), after({ scale: { ts: 1.3, "wasm-worker": 1.2 }, scaleOnly: TIME, skipRep: 3 }), { controls: both });
    expect(row(v, "wasm-worker", TIME).pairs).toBe(9);
    expect(row(v, "wasm-worker", TIME).status).toBe("void");
  });

  it("judges a control on its median: a noisy control with a steady median vouches and shows up as noisy", () => {
    // The same wobble in both runs cannot make a ratio wide, so use real independent noise of 12%.
    const c = compareRuns(before({ jitter: 0.12, seed: 1 }), after({ jitter: 0.12, seed: 2, commit: "a".repeat(40), hash: "h1" }));
    const noisy = c.rows.filter((r) => r.role === "control" && r.status === "control-noisy");
    expect(noisy.length).toBeGreaterThan(0);
    for (const n of noisy) expect(factor(n.ciLow!, 0.05) || factor(n.ciHigh!, 0.05)).toBe(true);
    // Under the old rule a noisy control voided; now no row is void while every control median held.
    const held = c.rows.filter((r) => r.role === "control").every((r) => r.status !== "control-drift");
    if (held) expect(c.counts.void).toBe(0);
  });

  it("an A/A pair of one commit comes out usable: no void rows, a net ratio around 1 with its interval", () => {
    const c = compareRuns(before({ jitter: 0.04, seed: 11 }), results({ jitter: 0.04, seed: 12, startedAt: "2026-10-21T14:00:00Z", generatedAt: "2026-10-21T18:00:00Z" }));
    expect(c.kind).toBe("A/A");
    expect(c.options.controls).toEqual(["ts", "wasm", "wasm-frame"]);
    const subjects = c.rows.filter((r) => r.role === "subject");
    expect(subjects.length).toBeGreaterThan(5);
    expect(c.counts.void).toBe(0);
    for (const s of subjects.filter((x) => x.basis === "ratio" && x.metric !== MERGES)) {
      expect(s.status, `${s.metric} ${s.throttle}x`).toBe("ok");
      expect(s.net, `${s.metric} ${s.throttle}x`).not.toBeNull();
      expect(s.net!.ratio).toBeGreaterThan(0.9);
      expect(s.net!.ratio).toBeLessThan(1.1);
    }
  });

  it("carries the controls' scatter into the subject through the net-of-control ratio", () => {
    // The controls and the subject share a 10% slowdown on the machine, with independent noise: raw ratio 1.1, net near 1.
    const slow = { ts: 1.1, wasm: 1.1, "wasm-frame": 1.1, "wasm-worker": 1.1 };
    const c = compareRuns(before(), after({ scale: slow, scaleOnly: TIME }), { controls: both, tolerance: 0.2 });
    const s = row(c, "wasm-worker", TIME);
    expect(s.status).toBe("ok");
    expect(s.ratio).toBeCloseTo(1.1, 1);
    expect(s.net!.ratio).toBeCloseTo(1, 1);
    expect(s.net!.controls).toEqual(["ts", "wasm"]);
    expect(row(c, "wasm-worker", TIME, "4").net!.ratio).toBeCloseTo(1, 1);
  });

  it("marks a metric no control measures as uncontrolled", () => {
    const c = compareRuns(before(), after());
    expect(row(c, "wasm-worker", MERGES).status).toBe("uncontrolled");
  });

  it("pairs by repetition number: a repetition missing from AFTER costs one pair and shifts none", () => {
    // BEFORE rep r is 100 + 10 r, AFTER rep r is twice that; pairing by index after dropping rep 3 would not give exactly 2.
    const valueFor = (scale: number) => (m: ModeName, n: string, r: number): number | undefined => (m === "wasm-worker" && n === TIME ? (100 + 10 * r) * scale : undefined);
    const c = compareRuns(before({ valueFor: valueFor(1) }), after({ skipRep: 3, valueFor: valueFor(2) }), { minPairs: 6 });
    const s = row(c, "wasm-worker", TIME);
    expect(s.pairs).toBe(9);
    expect(s.ratio).toBe(2);
    expect(s.ciLow).toBe(2);
    expect(s.ciHigh).toBe(2);
    // The medians are over the 9 paired repetitions (100 + 10 r without r = 3), not over all 10 BEFORE values.
    expect(s.beforeMedian).toBeCloseTo(100 + 10 * 5, 6);
    expect(s.afterMedian).toBeCloseTo(2 * (100 + 10 * 5), 6);
    expect(compareRuns(before(), after({ skipRep: 3 })).rows.find((r) => r.role === "subject" && r.metric === TIME)!.status).toBe("thin");
  });

  it("reads blocking that goes from 0 to 400 ms on the difference", () => {
    const c = compareRuns(before(), after({ valueFor: (m, n) => (m === "wasm-worker" && n === BLOCK ? 400 : undefined) }));
    const s = row(c, "wasm-worker", BLOCK);
    expect(s.basis).toBe("difference");
    expect(s.ratio).toBeNull();
    expect(s.pairs).toBe(10);
    expect(s.diffMedian).toBe(400);
    expect(s.diffCiLow).toBe(400);
    expect(s.diffCiHigh).toBe(400);
    expect(s.status).toBe("ok");
    // Blocking that stayed at 0 reads 0.
    expect(row(c, "wasm-worker", BLOCK, "1").beforeMedian).toBe(0);
    expect(row(compareRuns(before(), after()), "wasm-worker", BLOCK).diffMedian).toBe(0);
  });

  it("puts a rate that fell to zero on the difference too, positive for worse", () => {
    const c = compareRuns(before(), after({ valueFor: (m, n) => (m === "wasm-worker" && n === "mean FPS" ? 0 : undefined) }));
    const s = row(c, "wasm-worker", "mean FPS");
    expect(s.zeroReference).toBe(10);
    expect(s.basis).toBe("difference");
    expect(s.ratio).toBeNull();
    expect(s.diffMedian).toBeCloseTo(60, -1);
    expect(s.status).toBe("ok");
    // One zero in ten pairs also moves the row to the difference.
    const one = compareRuns(before(), after({ valueFor: (m, n, r) => (m === "wasm-worker" && n === "mean FPS" && r === 4 ? 0 : undefined) }));
    expect(row(one, "wasm-worker", "mean FPS").basis).toBe("difference");
    expect(row(one, "wasm-worker", "mean FPS").zeroReference).toBe(1);
    expect(row(one, "wasm-worker", "mean FPS").pairs).toBe(10);
  });

  it("voids a difference-basis row when its control left zero", () => {
    const c = compareRuns(before(), after({ valueFor: (m, n) => ((m === "wasm-worker" || m === "ts") && n === BLOCK ? 400 : undefined) }));
    expect(row(c, "ts", BLOCK).status).toBe("control-drift");
    expect(row(c, "wasm-worker", BLOCK).status).toBe("void");
    expect(row(c, "wasm-worker", BLOCK).voidedBy[0]).toMatch(/ts 400\.00 ms from 0/);
  });

  it("derives the unthrottled label from the mode and throttle alone", () => {
    const strip = (r: WorkerResults): WorkerResults => ({ ...r, metrics: r.metrics.map(({ unthrottled: _u, ...m }) => m as Metric) });
    const c = compareRuns(strip(before()), strip(after()));
    expect(row(c, "wasm-worker", TIME, "4").unthrottled).toBe("worker");
    expect(row(c, "wasm-worker", TIME, "1").unthrottled).toBeUndefined();
    expect(c.rows.filter((r) => r.unthrottled).every((r) => r.mode === "wasm-worker" && r.throttle === "4")).toBe(true);
  });

  it("chooses the default controls by whether the engine build differs", () => {
    expect(compareRuns(before(), after()).options.controls).toEqual(["ts"]);
    expect(compareRuns(before(), after()).options.subjects).toEqual(["wasm", "wasm-frame", "wasm-worker"]);
    expect(compareRuns(before(), results({ startedAt: "2026-10-21T14:00:00Z", generatedAt: "2026-10-21T18:00:00Z" })).options.controls).toEqual(["ts", "wasm", "wasm-frame"]);
    expect(resolveControls(before(), after(), { controls: ["wasm"] })).toEqual(["wasm"]);
  });

  it("leaves out rows no run can have data for and names metrics with values on one side", () => {
    const a = after();
    a.metrics.find((m) => m.mode === "ts" && m.metric === LOW)!.values = [];
    a.metrics.find((m) => m.mode === "ts" && m.metric === LOW)!.reps = [];
    const c = compareRuns(before(), a);
    expect(c.notMeasured).toBe(MODES.length + 1);
    expect(c.rows.some((r) => r.metric === "browser process PSS")).toBe(false);
    expect(c.missing.join("\n")).toMatch(/ts large 1x 1% low FPS: values only in BEFORE/);
    // The one control lost its AFTER values, so nothing vouches for the other hosts' rows.
    expect(row(c, "wasm", LOW).status).toBe("uncontrolled");
  });

  it("calls two runs of one build an A/A comparison", () => {
    expect(compareRuns(before(), results({ startedAt: "2026-10-21T14:00:00Z", generatedAt: "2026-10-21T18:00:00Z" })).kind).toBe("A/A");
  });

  it("keeps the roles from the argument order whichever run came first, and refuses runs that overlap", () => {
    const first = after({ scale: { "wasm-worker": 1.2 }, startedAt: "2026-10-21T02:00:00Z", generatedAt: "2026-10-21T06:00:00Z" });
    const c = compareRuns(before(), first);
    expect(c.problems).toEqual([]);
    expect(row(c, "wasm-worker", TIME).ratio).toBeCloseTo(1.2, 1);
    expect(compareRuns(before(), after({ startedAt: "2026-10-21T11:00:00Z" })).problems.join(" ")).toMatch(/overlapped/);
    expect(compareRuns(before(), after({ generatedAt: null })).problems.join(" ")).toMatch(/no readable start or finish time/);
    expect(compareRuns(before(), after({ startedAt: "garbage" })).problems.join(" ")).toMatch(/no readable start or finish time/);
  });

  it("refuses runs that are not protocol evidence or that differ in more than the build", () => {
    const problems = (a: WorkerResults, b: WorkerResults = before()) => compareRuns(b, a).problems.join("\n");
    expect(problems(after({ dirty: true }))).toMatch(/AFTER: it ran on a dirty tree/);
    expect(problems(after({ gpuVerified: false }))).toMatch(/AFTER does not record gpuVerified: true/);
    expect(problems(after({ quick: true }))).toMatch(/AFTER is a --quick run/);
    expect(problems(after({ quick: undefined }))).toMatch(/AFTER is a --quick run, or does not say it was not/);
    expect(problems(after({ validationOk: false }))).toMatch(/AFTER failed its own validation/);
    expect(problems(after({ validationErrors: ["a digest differs"] }))).toMatch(/AFTER failed its own validation/);
    expect(problems(after({ browserVersion: "150.0.0.0" }))).toMatch(/differ in browser/);
    expect(problems(after({ scenarioHash: "s2" }))).toMatch(/differ in scenario inputs/);
    expect(problems(after({ reps: 12 }))).toMatch(/differ in run parameters/);
    expect(problems(after({ reps: 8 }), results({ reps: 8 }))).toMatch(/fewer than the 10/);
    expect(compareRuns(before(), after({ dirty: true })).rows).toEqual([]);
    // The scenario list in another order is the same list.
    expect(problems(after({ scenarioOrder: true }))).toBe("");
  });

  it("checks all three renderer reads, the one after the cold start included", () => {
    const problems = (spec: Spec) => compareRuns(before(), after(spec)).problems.join("\n");
    expect(problems({ rendererEnd: null })).toMatch(/none after the frames/);
    expect(problems({ rendererEndCold: SWIFT })).toMatch(/SwiftShader/);
    expect(problems({ rendererEndCold: null })).toMatch(/none after the cold start/);
    // A run without a cold start (the read is absent, not null) is not held to it.
    expect(problems({ rendererEndCold: undefined })).toBe("");
    // The cold-start read is part of the browser identity.
    expect(compareRuns(before(), after({ rendererEndCold: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0, D3D11)" })).problems.join("\n")).toMatch(/different WebGL renderers|differ in browser/);
  });

  it("refuses repeated or out-of-range repetitions, mismatched lengths, non-finite values and a metric listed twice", () => {
    const withMetric = (edit: (m: Metric, all: Metric[]) => void): string[] => {
      const a = after();
      edit(a.metrics[0], a.metrics);
      return compareRuns(before(), a).problems;
    };
    expect(withMetric((m) => (m.reps = m.reps.map(() => 0))).join(" ")).toMatch(/repeat or fall outside/);
    expect(withMetric((m) => (m.values = m.values.slice(1))).join(" ")).toMatch(/do not line up/);
    expect(withMetric((m) => (m.values = m.values.map((v, i) => (i === 0 ? (null as unknown as number) : v)))).join(" ")).toMatch(/not a finite number/);
    expect(withMetric((m) => (m.reps = m.reps.map((x) => x + 5))).join(" ")).toMatch(/repeat or fall outside/);
    expect(withMetric((m, all) => all.push({ ...m })).join(" ")).toMatch(/listed twice/);
  });

  it("refuses the same results twice", () => {
    expect(compareRuns(before(), before()).problems.join(" ")).toMatch(/same results/);
  });

  it("names a metric one run lacks, and one whose unit differs, instead of dropping it", () => {
    const a = after();
    a.metrics = a.metrics.filter((m) => m.metric !== MERGES);
    a.metrics.find((m) => m.mode === "ts" && m.metric === "mean FPS")!.unit = "ms";
    const c = compareRuns(before(), a);
    expect(c.missing.join("\n")).toMatch(/full-save merges.*only in BEFORE/);
    expect(c.missing.join("\n")).toMatch(/mean FPS: unit or direction differs/);
    expect(comparisonMarkdown(c, "t")).toMatch(/## Metrics not compared/);
  });

  it("refuses subject and control lists that leave nothing to compare, and runs with no subject row", () => {
    expect(compareRuns(before(), after(), { subjects: ["ts"], controls: ["ts"] }).problems.join(" ")).toMatch(/ts is both a control and a subject/);
    expect(compareRuns(before(), after(), { subjects: [] }).problems.join(" ")).toMatch(/no subject mode/);
    expect(compareRuns(before(), after(), { controls: [], subjects: ["wasm-worker"] }).problems.join(" ")).toMatch(/none of the control modes/);
    const bare = (r: WorkerResults): WorkerResults => ({ ...r, metrics: r.metrics.filter((m) => m.mode === "ts") });
    const c = compareRuns(bare(before()), bare(after()));
    expect(c.problems.join(" ")).toMatch(/no subject metric is in both runs/);
    expect(c.rows).toEqual([]);
    expect(compareRuns({ ...before(), metrics: [] }, { ...after(), metrics: [] }).problems.join(" ")).toMatch(/no subject metric/);
  });

  it("lists the modes it left out", () => {
    expect(compareRuns(before(), after(), { subjects: ["wasm-worker"] }).unlisted).toEqual(["wasm", "wasm-frame"]);
  });
});

/** The band check the tests use to recognize a noisy control, written separately from the module's own. */
function factor(ratio: number, tol: number): boolean {
  return ratio > 1 + tol || ratio < 1 / (1 + tol);
}

describe("output", () => {
  it("writes csv and a report that says what the comparison cannot tell", () => {
    const c = compareRuns(before(), after({ scale: { "wasm-worker": 1.2 } }));
    const csv = comparisonCsv(c);
    const header = csv.split("\n")[0].split(",");
    expect(header).toEqual(expect.arrayContaining(["basis", "net_ratio", "diff_worse_is_positive", "notes", "unthrottled"]));
    expect(header[header.length - 1]).toBe("unthrottled");
    expect(csv.trim().split("\n")).toHaveLength(c.rows.length + 1);
    const md = comparisonMarkdown(c, "2026-10-21T15:00:00Z");
    expect(md).toMatch(/^# BEFORE\/AFTER comparison/);
    expect(md).toMatch(/Snapshot of runs started/);
    expect(md).toMatch(/\| wasm-worker \| 800 \| 960 \| 1\.20x/);
    expect(md).toMatch(/net of control/);
    expect(md).toMatch(/What this comparison cannot tell/);
    expect(md).toMatch(/harness hash/);
    expect(comparisonMarkdown(compareRuns(before(), after({ dirty: true })), "t")).toMatch(/cannot be compared.*\n\n- AFTER: it ran on a dirty tree/s);
    expect(comparisonMarkdown(compareRuns(before(), results({ startedAt: "2026-10-21T14:00:00Z", generatedAt: "2026-10-21T18:00:00Z" })), "t")).toMatch(/every ratio here is noise/);
  });

  it("marks every 4x worker row with the dagger in the markdown and csv, and states the main-thread-only vouching", () => {
    const c = compareRuns(before(), after());
    const md = comparisonMarkdown(c, "t");
    const at4x = md.split("\n").filter((l) => l.startsWith("| large | 4x |"));
    const workers = at4x.filter((l) => l.includes("| wasm-worker"));
    expect(workers.length).toBeGreaterThan(0);
    for (const l of workers) {
      expect(l).toMatch(/wasm-worker †/);
      expect(l).toMatch(/controlled \(main thread only\)/);
    }
    // The main-thread hosts at 4x are throttled for real and carry no dagger.
    for (const l of at4x.filter((x) => !x.includes("| wasm-worker"))) expect(l).not.toMatch(/†/);
    for (const l of md.split("\n").filter((x) => x.startsWith("| large | 1x |"))) expect(l).not.toMatch(/†/);
    expect(md).toMatch(/† The engine worker was barely CPU-throttled/);
    expect(md).toMatch(/7 to 41% slower/);
    const lines = comparisonCsv(c).trim().split("\n");
    // The column is last, and metric names hold commas, so read it from the end of the line.
    expect(lines[0].endsWith(",unthrottled")).toBe(true);
    const marked = lines.slice(1).filter((l) => l.endsWith(",worker"));
    expect(marked.length).toBe(c.rows.filter((r) => r.mode === "wasm-worker" && r.throttle === "4").length);
    expect(marked.every((l) => l.includes(",wasm-worker,"))).toBe(true);
  });

  it("lists a drifted control and the void rows it caused", () => {
    const md = comparisonMarkdown(compareRuns(before(), after({ scale: { wasm: 1.3, "wasm-worker": 1.1 } }), { controls: both }), "t");
    expect(md).toMatch(/Controls that moved, are noisy or are thin/);
    expect(md).toMatch(/VOID \(control moved: wasm 1\.30x\)/);
  });

  it("words a noisy control as noisy and shows pairs and the net ratio per row", () => {
    const c = compareRuns(before({ jitter: 0.12, seed: 1 }), after({ jitter: 0.12, seed: 2, commit: "a".repeat(40), hash: "h1" }));
    const md = comparisonMarkdown(c, "t");
    expect(md).toMatch(/noisy but its median held/);
    expect(md).not.toMatch(/TOO NOISY TO VOUCH/);
    expect(md).toMatch(/\| pairs \| status \|/);
  });

  it("puts a banner on a tolerance looser than the cap and says how many rows have no data", () => {
    const md = comparisonMarkdown(compareRuns(before(), after(), { tolerance: 0.1 }), "t");
    expect(md).toMatch(/The tolerance is 10%, looser than the 5% cap/);
    expect(md).toMatch(/\d+ metric row\(s\) have no values in either run/);
    expect(comparisonMarkdown(compareRuns(before(), after()), "t")).not.toMatch(/looser than the 5% cap/);
  });
});

describe("parseBeforeAfterArgs", () => {
  it("takes two folders in order and the options", () => {
    expect(parseBeforeAfterArgs(["a", "b", "--out", "o", "--controls", "ts,wasm", "--subjects", "wasm-worker", "--tolerance", "0.03", "--min-pairs", "12"])).toEqual({ before: "a", after: "b", out: "o", options: { controls: ["ts", "wasm"], subjects: ["wasm-worker"], tolerance: 0.03, minPairs: 12 } });
  });
  it("refuses a missing folder or out, a bad mode, a mode in both lists, and repeats", () => {
    for (const bad of [["a", "--out", "o"], ["a", "b"], ["a", "b", "c", "--out", "o"], ["a", "b", "--out", "o", "--controls", "nope"], ["a", "b", "--out", "o", "--tolerance", "2"], ["a", "b", "--out", "o", "--min-pairs", "3"], ["a", "b", "--out", "o", "--out", "p"], ["a", "b", "--out", "o", "--x", "1"], ["a", "b", "--out", "o", "--controls", "ts", "--subjects", "ts"]]) expect(() => parseBeforeAfterArgs(bad), bad.join(" ")).toThrow();
  });
});

describe("main", () => {
  const folder = (root: string, name: string, r: WorkerResults, bom = false): string => {
    mkdirSync(join(root, name), { recursive: true });
    writeFileSync(join(root, name, "results.json"), (bom ? "﻿" : "") + JSON.stringify(r));
    return name;
  };
  it("writes the three files, exits 0 for comparable runs and 1 for runs that are not", () => {
    const root = mkdtempSync(join(tmpdir(), "ba-"));
    const b = folder(root, "before", before());
    const ok = folder(root, "after", after({ scale: { "wasm-worker": 1.1 } }));
    const bad = folder(root, "dirty", after({ dirty: true }));
    expect(main([b, ok, "--out", "out1"], root, () => "t")).toBe(0);
    for (const f of ["comparison.json", "comparison.csv", "comparison.md"]) expect(readFileSync(join(root, "out1", f), "utf8").length).toBeGreaterThan(10);
    expect(JSON.parse(readFileSync(join(root, "out1", "comparison.json"), "utf8")).before.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(main([b, bad, "--out", "out2"], root, () => "t")).toBe(1);
    expect(() => main([b, ok, "--out", "out1"], root)).toThrow(/already exists/);
    expect(() => main([b, "missing", "--out", "out3"], root)).toThrow(/no results.json/);
  });
  it("exits 0 for all-void or all-uncontrolled results (the exit code says only that the runs compared), and 1 when no subject row exists", () => {
    const root = mkdtempSync(join(tmpdir(), "ba-"));
    const b = folder(root, "before", before());
    const slow = folder(root, "slow", after({ scale: { ts: 1.5, "wasm-worker": 3 } }));
    expect(main([b, slow, "--out", "o1"], root, () => "t")).toBe(0);
    expect(readFileSync(join(root, "o1", "comparison.md"), "utf8")).toMatch(/VOID/);
    const bare = (r: WorkerResults): WorkerResults => ({ ...r, metrics: r.metrics.filter((m) => m.mode === "ts") });
    const bb = folder(root, "bb", bare(before()));
    const ba = folder(root, "ba", bare(after()));
    expect(main([bb, ba, "--out", "o2"], root, () => "t")).toBe(1);
  });
  it("throws before writing anything when a subject is also a default control", () => {
    const root = mkdtempSync(join(tmpdir(), "ba-"));
    const b = folder(root, "before", before());
    const a = folder(root, "after", after());
    expect(() => main([b, a, "--out", "o", "--subjects", "ts"], root)).toThrow(/ts is both a control and a subject/);
    expect(existsSync(join(root, "o"))).toBe(false);
  });
  it("reads a results.json with a byte order mark", () => {
    const root = mkdtempSync(join(tmpdir(), "ba-"));
    const b = folder(root, "before", before(), true);
    const a = folder(root, "after", after(), true);
    expect(main([b, a, "--out", "o"], root, () => "t")).toBe(0);
  });
});
