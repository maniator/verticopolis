import { makeConfig, parseArgs } from "./main";
import type { ModeName } from "./pageWorker";
import type { ModeRun } from "./runner";

/** The finished runs the analysis tests share: every sample set from a scale, the same digests everywhere.
 *  They have the four modes of the runs committed before PR 5e (a run now
 *  measures `ts` and `wasm` only), so the analysis keeps reading those. */
export const config = { ...makeConfig(parseArgs(["--reps", "6"]), ["small"]), modes: ["ts", "wasm", "wasm-frame", "wasm-worker"] as ModeName[] };

/** A finished run with every sample set from `scale` (so the modes and
 *  repetitions differ by a known factor), the same digests everywhere. */
export function run(rep: number, mode: ModeName, scale: number, over: Partial<ModeRun> = {}): ModeRun {
  const hosted = (t: number) => ({ wallMs: 100 * scale * t, mainMs: 50 * scale * t, batchMainP50Ms: 1, batchMainP95Ms: 2 * scale, batchMainMaxMs: 3, startDigest: "s", endDigest: "e", hostErrorsAdded: [],
    worker: mode === "wasm-worker" ? { replies: 180, staleReplies: 0, merges: 6, messagesSent: 200, messagesReceived: 181, bytesReceived: 1000, frameBytes: 1800, mergeBytes: 600, applyMs: 10, mergeMs: 5, workerOpsMs: 40, workerReplyMs: 4, deltas: 18, deltaBytes: 360, deltaMs: 2 * scale, workerSaveMs: 3, deltasRefused: 1, approximateSaves: 2 } : null });
  const frames = { frames: 60, meanFps: 10 / scale, medianMs: 100, p95Ms: 150, p99Ms: 190, onePercentLowFps: 5, simMinutesPerSecond: 50, clampedFrames: 0, longTasks: 3, blockingMs: 20 * scale, commands: 5, commandsUnanswered: 0, commandToFrameP50Ms: 30, commandToFrameP95Ms: 40, commandToFrameMinMs: 20, hostErrorsAdded: [],
    worker: mode === "wasm-worker" ? { repliesPerSecond: 9, messagesPerSecond: 20, bytesPerSecond: 5000, staleReplies: 0, merges: 2, deltas: 7, deltasRefused: 1, approximateSaves: 3, applyMsPerSecond: 3, commandAckP50Ms: 4, commandAckP95Ms: 6 } : null };
  return {
    rep, mode, order: 0, ok: true, error: null, pageErrors: [], browserVersion: "141", page: { crossOriginIsolated: true, userAgent: "ua", webgl: { renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)", vendor: "Google Inc. (NVIDIA)" } }, rendererEnd: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    cold: { mode, gameReadyMs: 100, modeReadyMs: 200 * scale, firstFrameMs: 300, bytesBeforeReady: 1000, requestsBeforeReady: 9, wasmRequests: mode === "ts" || mode === "wasm-worker" ? 0 : 1 },
    warm: null, cold4x: null, cpuProbe: { unthrottledMs: 100, timed: { "small:4": 390 } },
    scenarios: { small: { raw: mode === "ts" || mode === "wasm" ? { "1": { engine: mode === "ts" ? "ts" : "wasm", totalMs: 80 * scale, startDigest: "s", endDigest: "e" }, "4": { engine: mode === "ts" ? "ts" : "wasm", totalMs: 320 * scale, startDigest: "s", endDigest: "e" } } : {}, memory: { mainHeapUsedBytes: 10, workerHeapUsedBytes: mode === "wasm-worker" ? 5 : null, mainWasmBytes: mode === "wasm" || mode === "wasm-frame" ? 7 : null, workerWasmBytes: mode === "wasm-worker" ? 7 : null, processPssBytes: 100 }, hosted: { "1": hosted(1), "4": hosted(4) }, frames: { "1": frames, "4": frames } } },
    offline: null,
    ...over,
  };
}

export const SCALE: Record<ModeName, number> = { ts: 1, wasm: 4, "wasm-frame": 2, "wasm-worker": 1 };
export const runs = (): ModeRun[] => Array.from({ length: 6 }, (_, rep) => config.modes.map((m) => run(rep, m, SCALE[m] * (1 + rep / 100)))).flat();
