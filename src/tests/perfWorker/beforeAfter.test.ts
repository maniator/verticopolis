import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Metric } from "./analysis";
import { compareRuns } from "./beforeAfter";
import { comparisonCsv, comparisonMarkdown, main, parseBeforeAfterArgs } from "./beforeAfterMain";
import type { WorkerResults } from "./main";
import type { ModeName } from "./pageWorker";

const RTX = "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)";
const REPS = Array.from({ length: 10 }, (_, i) => i);

interface Spec {
  commit?: string;
  hash?: string;
  startedAt?: string;
  reps?: number;
  /** Multiplier on every value of a mode, to make the mode slower (times) in this run. */
  scale?: Partial<Record<ModeName, number>>;
  /** Limits `scale` to the metrics with this name, leaving the others steady. */
  scaleOnly?: string;
  dirty?: boolean;
  gpuVerified?: boolean;
  browserVersion?: string;
  scenarioHash?: string;
  quick?: boolean;
  validationOk?: boolean;
  skipRep?: number;
  /** Some wobble so intervals are not degenerate. */
  wobble?: number;
}

const metric = (mode: ModeName, name: string, base: number, spec: Spec, over: Partial<Metric> = {}): Metric => {
  const reps = REPS.filter((r) => r !== spec.skipRep);
  const scale = !spec.scaleOnly || spec.scaleOnly === name ? (spec.scale?.[mode] ?? 1) : 1;
  const values = reps.map((r) => base * scale * (1 + (spec.wobble ?? 0.01) * ((r % 3) - 1)));
  return { group: "hosted", scenario: "large", throttle: "1", metric: name, unit: "ms", better: "lower", mode, values, reps, summary: { median: base * scale, n: values.length } as Metric["summary"], ...over };
};

const results = (spec: Spec = {}): WorkerResults => {
  const modes: ModeName[] = ["ts", "wasm", "wasm-frame", "wasm-worker"];
  const metrics = modes.flatMap((m) => [
    metric(m, "main-thread time, 720 steps", 800, spec),
    metric(m, "mean FPS", 60, spec, { group: "frames", unit: "fps", better: "higher" }),
    ...(m === "wasm-worker" ? [metric(m, "full-save merges, 720 steps (hosted)", 24, spec, { group: "traffic", unit: "count" }), metric(m, "main-thread time, 720 steps", 800, spec, { throttle: "4", unthrottled: "worker" })] : []),
  ]);
  return {
    schema: 1,
    startedAt: spec.startedAt ?? "2026-10-21T08:00:00Z",
    generatedAt: "2026-10-21T12:00:00Z",
    config: { reps: spec.reps ?? 10, modes, scenarios: ["large"], throttles: [1, 4], steps: 720, dt: 2, batch: 4, memorySteps: 1, warmSteps: 1, frameWindowMs: 1, frameWarmMs: 1, speed: 3, commandEveryMs: 1000, quick: spec.quick ?? false, viewport: { width: 1280, height: 720 } },
    environment: { commit: spec.commit ?? "a".repeat(40), commitShort: "aaaaaaa", appVersion: "2.36.0", dirty: spec.dirty ?? false, tree: { porcelain: [], diffSha256: null, untracked: [], hidden: [], complete: true }, engineBuildHash: spec.hash ?? "h1", cpuModel: "Ryzen 5 5600X", logicalCpus: 12, totalMemoryBytes: 32 * 2 ** 30, os: "win32", kernel: "10", arch: "x64", node: "22.22.0", rust: "1.90", playwright: "1.61.1" },
    browser: { version: spec.browserVersion ?? "149.0.7827.55", executable: null, channel: null, args: [], rendererException: null, gpuVerified: spec.gpuVerified ?? true },
    scenarios: [{ name: "large", sha256: spec.scenarioHash ?? "s1", population: 1, units: 1, transports: 1, saveBytes: 1 }],
    scripts: {},
    runs: [{ rep: 0, mode: "ts", ok: true, page: { webgl: { renderer: RTX, vendor: "v" } }, rendererEnd: RTX }],
    metrics,
    ratios: [],
    validation: { ok: spec.validationOk ?? true, errors: [], warnings: [] },
    limitations: [],
  } as unknown as WorkerResults;
};

const before = () => results();
const after = (spec: Spec = {}) => results({ commit: "b".repeat(40), hash: "h2", startedAt: "2026-10-21T14:00:00Z", ...spec });
const row = (c: ReturnType<typeof compareRuns>, mode: ModeName, name: string, throttle = "1") => c.rows.find((r) => r.mode === mode && r.metric === name && r.throttle === throttle)!;

describe("compareRuns", () => {
  it("measures a subject slowdown against steady controls, above 1.0 meaning worse", () => {
    const c = compareRuns(before(), after({ scale: { "wasm-worker": 1.2 } }));
    expect(c.problems).toEqual([]);
    expect(c.kind).toBe("before-after");
    const s = row(c, "wasm-worker", "main-thread time, 720 steps");
    expect(s.role).toBe("subject");
    expect(s.ratio).toBeCloseTo(1.2, 1);
    expect(s.status).toBe("ok");
    expect(s.pairs).toBe(10);
    expect(s.diffMedian).toBeCloseTo(160, -1);
    expect(row(c, "ts", "main-thread time, 720 steps").status).toBe("control-ok");
  });

  it("reads a rate the other way round: a lower AFTER frame rate is a ratio above 1.0", () => {
    const c = compareRuns(before(), after({ scale: { "wasm-worker": 0.5 } }));
    const fps = row(c, "wasm-worker", "mean FPS");
    expect(fps.ratio).toBeCloseTo(2, 1);
    expect(fps.diffMedian).toBeCloseTo(-30, 0);
  });

  it("voids the subject rows of a metric whose control moved, and says which control", () => {
    const c = compareRuns(before(), after({ scale: { ts: 1.2, "wasm-worker": 1.2 }, scaleOnly: "main-thread time, 720 steps" }));
    const s = row(c, "wasm-worker", "main-thread time, 720 steps");
    expect(s.status).toBe("void");
    expect(s.voidedBy).toEqual(["ts 1.20x"]);
    expect(row(c, "ts", "main-thread time, 720 steps").status).toBe("control-drift");
    // The frame-rate metric's controls are steady, so that row stands.
    expect(row(c, "wasm-worker", "mean FPS").status).toBe("ok");
    expect(c.counts.void).toBeGreaterThan(0);
  });

  it("marks a metric no control measures as uncontrolled, not as a clean row", () => {
    const c = compareRuns(before(), after());
    expect(row(c, "wasm-worker", "full-save merges, 720 steps (hosted)").status).toBe("uncontrolled");
  });

  it("pairs by repetition number, so a repetition missing from AFTER costs one pair and shifts none", () => {
    const c = compareRuns(before(), after({ skipRep: 3, scale: { "wasm-worker": 1.2 } }));
    const s = row(c, "wasm-worker", "main-thread time, 720 steps");
    expect(s.pairs).toBe(9);
    expect(s.ratio).toBeCloseTo(1.2, 1);
    expect(s.status).toBe("thin");
  });

  it("drops zero denominators from the ratio and keeps the difference", () => {
    const b = before();
    const a = after();
    const zero = (r: WorkerResults) => r.metrics.filter((m) => m.mode === "wasm-worker" && m.metric.startsWith("full-save"));
    zero(b)[0].values = zero(b)[0].values.map((_, i) => (i < 2 ? 0 : 24));
    const s = row(compareRuns(b, a), "wasm-worker", "full-save merges, 720 steps (hosted)");
    expect(s.zeroReference).toBe(2);
    expect(s.pairs).toBe(8);
    expect(s.diffMedian).not.toBeNull();
  });

  it("carries the unthrottled-worker flag onto 4x worker rows", () => {
    const c = compareRuns(before(), after());
    expect(row(c, "wasm-worker", "main-thread time, 720 steps", "4").unthrottled).toBe("worker");
    expect(row(c, "wasm-worker", "main-thread time, 720 steps", "1").unthrottled).toBeUndefined();
  });

  it("calls two runs of one build an A/A comparison", () => {
    expect(compareRuns(before(), results({ startedAt: "2026-10-21T14:00:00Z" })).kind).toBe("A/A");
  });

  it("refuses runs that are not protocol evidence or that differ in more than the build", () => {
    const problems = (a: WorkerResults, b: WorkerResults = before()) => compareRuns(b, a).problems.join("\n");
    expect(problems(after({ dirty: true }))).toMatch(/AFTER: it ran on a dirty tree/);
    expect(problems(after({ gpuVerified: false }))).toMatch(/AFTER does not record gpuVerified: true/);
    expect(problems(after({ quick: true }))).toMatch(/AFTER is a --quick run/);
    expect(problems(after({ validationOk: false }))).toMatch(/AFTER failed its own validation/);
    expect(problems(after({ browserVersion: "150.0.0.0" }))).toMatch(/differ in browser/);
    expect(problems(after({ scenarioHash: "s2" }))).toMatch(/differ in scenario inputs/);
    expect(problems(after({ reps: 12 }))).toMatch(/differ in run parameters/);
    expect(problems(after({ startedAt: "2026-10-21T06:00:00Z" }))).toMatch(/AFTER started before BEFORE/);
    expect(problems(after({ reps: 8 }), results({ reps: 8 }))).toMatch(/fewer than the 10/);
    const rtx = (r: WorkerResults) => ({ ...r, runs: [{ ...r.runs[0], rendererEnd: null }] }) as WorkerResults;
    expect(problems(rtx(after()))).toMatch(/none after the frames/);
    expect(compareRuns(before(), after({ dirty: true })).rows).toEqual([]);
  });
});

describe("output", () => {
  it("writes csv and a report that says what the comparison cannot tell", () => {
    const c = compareRuns(before(), after({ scale: { "wasm-worker": 1.2 } }));
    const csv = comparisonCsv(c);
    expect(csv.split("\n")[0]).toMatch(/^role,group,scenario,throttle,metric,unit,mode,before_median/);
    expect(csv.trim().split("\n")).toHaveLength(c.rows.length + 1);
    const md = comparisonMarkdown(c, "2026-10-21T15:00:00Z");
    expect(md).toMatch(/^# BEFORE\/AFTER comparison/);
    expect(md).toMatch(/Snapshot of runs started/);
    expect(md).toMatch(/\| wasm-worker \| 800 \| 960 \| 1\.20x/);
    expect(md).toMatch(/wasm-worker †/);
    expect(md).toMatch(/What this comparison cannot tell/);
    expect(comparisonMarkdown(compareRuns(before(), after({ dirty: true })), "t")).toMatch(/cannot be compared.*\n\n- AFTER: it ran on a dirty tree/s);
    expect(comparisonMarkdown(compareRuns(before(), results({ startedAt: "2026-10-21T14:00:00Z" })), "t")).toMatch(/every ratio here is noise/);
  });

  it("lists a drifted control and the void rows it caused", () => {
    const md = comparisonMarkdown(compareRuns(before(), after({ scale: { wasm: 1.3, "wasm-worker": 1.1 } })), "t");
    expect(md).toMatch(/Controls that moved or are thin/);
    expect(md).toMatch(/VOID \(control moved: wasm 1\.30x\)/);
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
  const folder = (root: string, name: string, r: WorkerResults): string => {
    mkdirSync(join(root, name), { recursive: true });
    writeFileSync(join(root, name, "results.json"), JSON.stringify(r));
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
});
