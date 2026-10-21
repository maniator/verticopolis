import type { calibrate as calibrateWith } from "./calibrate";
import type { EngineName } from "./types";

export type Folder = Parameters<typeof calibrateWith>[0][number];

export const RTX = "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)";
export const SWIFT = "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)";
export interface Spec {
  engine?: EngineName | null;
  /** Upper bound of every ratio cell. */
  upper?: number;
  /** Cold start paired difference: the wasm slot's value minus ts slot's, per rep. */
  coldDiff?: number;
  reps?: number;
  commit?: string;
  dirty?: boolean;
  ok?: boolean;
  scenarios?: string[];
  quick?: boolean;
  /** Replaces the cmp pairs of every ratio cell. */
  pairs?: number;
  cpu?: string;
  renderer?: string | null;
  rendererEnd?: string | null;
  rendererEndCold?: string | null;
  channel?: string | null;
  args?: string[];
  browserVersion?: string;
  exception?: string | null;
  gpuVerified?: boolean | null;
  /** The runs' context-loss record; null leaves the field out, as a harness from before #1136 did. */
  contextLost?: string[] | null;
  tree?: unknown;
  throttles?: number[];
  startedAt?: string;
}

const alternate = (i: number): EngineName => (i % 2 === 0 ? "ts" : "wasm");

const cmp = (group: string, metric: string, scenario: string, throttle: string, upper: number, pairs = 10) => ({
  group, scenario, throttle, metric, unit: "ms", better: "lower", tsMedian: 1, wasmMedian: 1, ratio: 1, ciLow: 2 - upper, ciHigh: upper, verdict: "equivalent", n: { ts: 10, wasm: 10, pairs },
});

export function pass(i: number, s: Spec = {}): Folder {
  const reps = s.reps ?? 10;
  const upper = s.upper ?? 1.01;
  // Unset means the verified card; null means no WebGL read at all.
  const renderer = s.renderer === undefined ? RTX : s.renderer;
  const webgl = renderer === null ? null : { renderer, vendor: "v" };
  const scenarios = s.scenarios ?? ["small", "medium", "large"];
  const comparisons = scenarios.flatMap((sc) =>
    ["1", "4"].flatMap((t) => [cmp("sim-raw", "total for fixed duration", sc, t, upper, s.pairs), cmp("sim-hosted", "total for fixed duration", sc, t, upper, s.pairs), cmp("frames", "frame time p99", sc, t, upper, s.pairs), cmp("frames", "1% low FPS", sc, t, upper, s.pairs)]),
  );
  const repsList = Array.from({ length: reps }, (_, r) => r);
  const startup = (engine: EngineName, t: string) => ({ group: "startup", scenario: "-", throttle: t, metric: "cold game ready", unit: "ms", better: "lower", engine, reps: repsList, values: repsList.map((r) => (t === "1" ? 400 : 1600) + r + (engine === "wasm" ? (s.coldDiff ?? 0) * (t === "1" ? 1 : 4) : 0)), summary: null });
  return {
    folder: `aa-${i}`,
    results: {
      startedAt: s.startedAt ?? new Date(Date.UTC(2026, 9, 21, 0, i)).toISOString(),
      config: { aa: s.engine === undefined ? alternate(i) : s.engine, reps, scenarios, throttles: s.throttles ?? [1, 4], quick: s.quick ?? false, dt: 2, steps: 720 },
      browser: { version: s.browserVersion ?? "141.0.1", executable: null, channel: s.channel ?? null, args: s.args ?? [], rendererException: s.exception ?? null, gpuVerified: "gpuVerified" in s ? s.gpuVerified : true },
      runs: [{ ok: true, page: { webgl }, rendererEnd: s.rendererEnd === undefined ? renderer : s.rendererEnd, rendererEndCold: "rendererEndCold" in s ? s.rendererEndCold : renderer, ...(s.contextLost === null ? {} : { contextLost: s.contextLost ?? [] }) }],
      comparisons,
      metrics: ["1", "4"].flatMap((t) => [startup("ts", t), startup("wasm", t)]),
      validation: { ok: s.ok ?? true, errors: [], warnings: [] },
      environment: { commit: s.commit ?? "abc1234def", dirty: s.dirty ?? false, cpuModel: s.cpu ?? "cpu-a", tree: s.tree ?? { porcelain: [], diffSha256: null, untracked: [], hidden: [], complete: true } },
    },
  } as unknown as Folder;
}

export const many = (n: number, over: (i: number) => Spec = () => ({})): Folder[] => Array.from({ length: n }, (_, i) => pass(i, over(i)));
export const fam = (c: ReturnType<typeof calibrateWith>, id: string) => c.families.find((f) => f.id === id)!;

