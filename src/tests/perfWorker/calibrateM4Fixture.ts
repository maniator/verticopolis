import type { WorkerPass } from "./calibrateM4";
import { M4_METRIC } from "./calibrateM4";

export const RTX = "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)";
export const SWIFT = "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)";

export interface WorkerSpec {
  aa?: "ts" | "wasm" | null;
  /** Paired difference (slot wasm minus slot ts) of the blocking row, per rep, at 1x and at 4x. */
  diff1?: number;
  diff4?: number;
  /** Reps recorded for the 4x row, to make it thin. */
  reps4?: number;
  reps?: number;
  commit?: string;
  cpu?: string;
  dirty?: boolean;
  ok?: boolean;
  quick?: boolean;
  scenarios?: string[];
  renderer?: string;
  gpuVerified?: boolean | null;
  contextLost?: string[] | null;
  startedAt?: string;
}

const alternate = (i: number): "ts" | "wasm" => (i % 2 === 0 ? "ts" : "wasm");

const row = (mode: "ts" | "wasm", throttle: string, n: number, diff: number) => ({
  group: "frames" as const,
  scenario: "large",
  throttle,
  metric: M4_METRIC,
  mode,
  reps: Array.from({ length: n }, (_, r) => r),
  values: Array.from({ length: n }, (_, r) => 100 + r + (mode === "wasm" ? diff : 0)),
});

/** A `perf:worker --aa` results.json with the fields calibration reads; pass `i` alternates the engine. */
export function workerPass(i: number, s: WorkerSpec = {}): { folder: string; results: WorkerPass } {
  const reps = s.reps ?? 10;
  const renderer = s.renderer ?? RTX;
  const lost = "contextLost" in s ? s.contextLost : [];
  return {
    folder: `aa-worker-${i}`,
    results: {
      startedAt: s.startedAt ?? new Date(Date.UTC(2026, 9, 21, 1, i)).toISOString(),
      config: { aa: "aa" in s ? s.aa : alternate(i), modes: ["ts", "wasm"], reps, scenarios: s.scenarios ?? ["small", "medium", "large"], throttles: [1, 4], quick: s.quick ?? false, steps: 720, dt: 2 },
      browser: { version: "149.0.7827.55", executable: "chrome.exe", channel: null, args: [], rendererException: null, gpuVerified: "gpuVerified" in s ? s.gpuVerified : true },
      runs: [{ ok: true, page: { webgl: { renderer } }, rendererEnd: renderer, rendererEndCold: renderer, ...(lost === null ? {} : { contextLost: lost }) }],
      metrics: [row("ts", "1", reps, 0), row("wasm", "1", reps, s.diff1 ?? 0), row("ts", "4", s.reps4 ?? reps, 0), row("wasm", "4", s.reps4 ?? reps, s.diff4 ?? 0)],
      validation: { ok: s.ok ?? true },
      environment: { commit: s.commit ?? "abc1234def", dirty: s.dirty ?? false, cpuModel: s.cpu ?? "cpu-a", tree: { porcelain: [], diffSha256: null, untracked: [], hidden: [], complete: true } },
    },
  } as unknown as { folder: string; results: WorkerPass };
}
