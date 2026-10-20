import type { Metric } from "./analysis";
import type { compareRuns } from "./beforeAfter";
import type { WorkerResults } from "./main";
import type { ModeName } from "./pageWorker";

/** Result sets shaped like two `perf:worker` runs, for the before/after tests. */
export const RTX = "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)";
export const SWIFT = "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)";
export const REPS = Array.from({ length: 10 }, (_, i) => i);
export const MODES: ModeName[] = ["ts", "wasm", "wasm-frame", "wasm-worker"];
export const TIME = "main-thread time, 720 steps";
export const LOW = "1% low FPS";
export const BLOCK = "main-thread blocking (long tasks past 50 ms)";
export const MERGES = "full-save merges, 720 steps (hosted)";

export interface Spec {
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

export const metric = (mode: ModeName, name: string, base: number, spec: Spec, over: Partial<Metric> = {}): Metric => {
  const reps = REPS.filter((r) => !(r === spec.skipRep && (!spec.skipRepFor || spec.skipRepFor === mode)));
  const scale = !spec.scaleOnly || spec.scaleOnly === name ? (spec.scale?.[mode] ?? 1) : 1;
  const values = reps.map((r) => spec.valueFor?.(mode, name, r, base) ?? base * scale * (1 + (spec.wobble ?? 0.01) * ((r % 3) - 1)) * (1 + (spec.jitter ?? 0) * noise(`${spec.seed ?? 0}|${mode}|${name}|${over.throttle ?? "1"}|${r}`)));
  return { group: "hosted", scenario: "large", throttle: "1", metric: name, unit: "ms", better: "lower", mode, values, reps, summary: null, ...over };
};

export const results = (spec: Spec = {}): WorkerResults => {
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

export const before = (spec: Spec = {}) => results(spec);
export const after = (spec: Spec = {}) => results({ commit: "b".repeat(40), hash: "h2", startedAt: "2026-10-21T14:00:00Z", generatedAt: "2026-10-21T18:00:00Z", ...spec });
export type Cmp = ReturnType<typeof compareRuns>;
export const row = (c: Cmp, mode: ModeName, name: string, throttle = "1") => c.rows.find((r) => r.mode === mode && r.metric === name && r.throttle === throttle)!;
export const both = ["ts", "wasm"] as ModeName[];
