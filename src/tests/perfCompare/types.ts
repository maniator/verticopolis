import type { Environment } from "./env";
import type { BundleReport } from "./bundle";
import type { NodeCheck } from "./nodeCheck";
import type { ServedRequest } from "./server";
import type { Summary } from "./stats";

/** The shapes the comparison writes (issue #972), shared by the runner, the
 *  validation and the report. */

export type EngineName = "ts" | "wasm";

export interface CompareConfig {
  reps: number;
  /** In-game minutes per step (the game's own step at the fastest speed
   *  with the steady clock: 120 min/s over 60 Hz). */
  dt: number;
  steps: number;
  warmSteps: number;
  throttles: number[];
  frameWindowMs: number;
  frameWarmMs: number;
  /** Fastest speed index (SPEEDS[3] = 120 sim-minutes per second). */
  speed: number;
  viewport: { width: number; height: number };
  scenarios: string[];
  quick: boolean;
  /** An A/A pass (protocol section 6.1): both slots run this engine. The
   *  slot names ("ts" and "wasm") stay the pairing labels, so every ratio
   *  reads slot "wasm" over slot "ts". Null for a comparison run. */
  aa: EngineName | null;
}

export interface StepSummary {
  totalMs: number;
  loadMs: number;
  stepMedianMs: number;
  stepP95Ms: number;
  stepP99Ms: number;
  stepMaxMs: number;
  /** From a separate wrapped pass (hosted WASM only); the timings above
   *  come from an unwrapped pass. */
  attribution: { engineTickMs: number; engineExportMs: number; hostJsMs: number; wrappedTotalMs: number; merges: number; engineTicks: number; exportCalls: number; exportsWrapped: number } | null;
  engineActive: EngineName;
  hostErrorsAdded: string[];
  /** The loop began from a full GC (gc() was there). */
  gcAvailable: boolean;
  startMinutes: number;
  startDigest: string;
  endDigest: string;
  end: { minutes: number; money: number; star: number; population: number; people: number };
}

export interface FrameSummary {
  frames: number;
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  meanFps: number;
  onePercentLowFps: number;
  simMinutesPerSecond: number;
  tickShare: number;
  uiShare: number;
  ticks: number;
  /** 1 - tickShare - uiShare: the canvas render, compositor, GC and idle. */
  restShare: number;
  /** Frames longer than 200 ms. Excalibur hands such a frame 1 ms of
   *  elapsed time, so the game advances almost nothing in it: frame rows
   *  with clamped frames understate the sim work. */
  clampedFrames: number;
  engineActive: EngineName;
  hostErrorsAdded: string[];
  audioStarted: boolean;
}

export interface MemorySummary {
  jsHeapUsedBytes: number;
  jsHeapTotalBytes: number;
  wasmMemoryBytes: number | null;
  processPssBytes: number | null;
  processes: number | null;
}

export interface StartupSample {
  engineActive: EngineName;
  gameReadyMs: number | null;
  engineHostedMs: number | null;
  firstFrameMs: number | null;
  domContentLoadedMs: number | null;
  loadEventMs: number | null;
  /** Resource timing of the engine package, when it loaded. */
  wasmFetchMs: number | null;
  glueFetchMs: number | null;
  /** The boot path's own compile and instantiate of the engine package
   *  (first instantiateStreaming or instantiate call), WASM only. */
  wasmInstantiateMs: number | null;
  wasmInstantiateVia: "instantiateStreaming" | "instantiate" | null;
  servedBeforeReady: ServedRequest[];
  servedAfterReady: ServedRequest[];
}

export interface ScenarioRun {
  adoptMs: number;
  memory: MemorySummary;
  /** Keyed by the CPU throttle rate as a string ("1", "4"). */
  hosted: Record<string, StepSummary>;
  raw: Record<string, StepSummary>;
  /** Audio not started (no gesture: the Tone.js chunk never loads). */
  frames: Record<string, FrameSummary>;
  /** The same frames with the game's audio started and unmuted. */
  framesAudio: Record<string, FrameSummary>;
}

export interface ProcessRun {
  rep: number;
  /** The slot this process filled. It is the engine that ran, except in an
   *  A/A pass (`CompareConfig.aa`), where both slots run the same one. */
  engine: EngineName;
  /** The engine this process was asked to run: `config.aa ?? engine`. The
   *  engine the page reported running is checked against it (`engineActive`,
   *  validate.ts). Absent in results written before A/A passes existed,
   *  where it equals `engine`. */
  ranEngine?: EngineName;
  order: number;
  ok: boolean;
  error: string | null;
  /** Uncaught page errors and console errors, kept for the record. */
  pageErrors: string[];
  browserVersion: string | null;
  page: { crossOriginIsolated: boolean; timerResolutionMs: number; userAgent: string; viewport: { width: number; height: number; dpr: number }; webgl: { renderer: string; vendor: string } | null } | null;
  /** The WebGL renderer read again from a new context once the frames were done. A GPU process that died in between shows as a different string or none (validate.ts). Absent in results written before this check. */
  rendererEnd?: string | null;
  /** The same read after the throttled cold start, kept apart so it cannot hide a change after the frames; absent for a run without a cold start. */
  rendererEndCold?: string | null;
  cold: StartupSample | null;
  warm: StartupSample | null;
  /** A cold start under the heaviest configured CPU throttle (4x by
   *  default), in a second fresh context of the same browser process
   *  (fresh HTTP cache, not a fresh process). */
  cold4x: StartupSample | null;
  /** A fixed CPU loop: unthrottled, under the cold start's throttle, and
   *  under each throttle of every scenario's timed passes and of each frame
   *  block (keyed "<scenario or frames-on/off>:<rate>"). */
  cpuProbe: { unthrottledMs: number; throttledMs: number | null; rate: number; timed: Record<string, number> } | null;
  scenarios: Record<string, ScenarioRun>;
  wasmCold: { fetchMs: number; bytes: number; compileMs: number; instantiateMs: number; firstEngineMs: number } | null;
  /** The audio start for the audio-on frame pass. */
  audio: { started: boolean; muted: boolean; contexts: string[] } | null;
  /** A first visit with the service worker allowed, then an offline
   *  reload: which engine came back without the network. */
  firstVisitWithServiceWorker: {
    served: ServedRequest[];
    swActive: boolean;
    /** The engine the online first visit ran on. */
    onlineEngineActive: EngineName | null;
    offlineEngineActive: EngineName | null;
    /** Page errors of the online visit, and of the offline reload (where
     *  the WASM package failing to load is the behavior measured). */
    onlinePageErrors: string[];
    offlinePageErrors: string[];
    error: string | null;
  } | null;
}

export interface MetricRow {
  group: "startup" | "sim-hosted" | "sim-raw" | "frames" | "frames-audio" | "memory" | "transfer" | "wasm-load";
  scenario: string;
  throttle: string;
  metric: string;
  unit: string;
  /** Which way is better, for the report's wording. */
  better: "lower" | "higher";
  engine: EngineName;
  values: number[];
  /** The repetition each value came from, parallel to `values`. */
  reps: number[];
  summary: Summary | null;
  /** Why the two engines' values are not compared (no ratio, no verdict);
   *  the report lists such a metric per engine. */
  noVerdict?: string;
}

export interface Comparison {
  group: MetricRow["group"];
  scenario: string;
  throttle: string;
  metric: string;
  unit: string;
  better: "lower" | "higher";
  tsMedian: number;
  wasmMedian: number;
  /** wasm / ts: the median of the per-repetition ratios, with the
   *  order-statistic 95% interval of that median. */
  ratio: number;
  ciLow: number | null;
  ciHigh: number | null;
  verdict: "wasm faster" | "wasm slower" | "wasm smaller" | "wasm larger" | "wasm lower" | "wasm higher" | "wasm fewer" | "wasm more" | "equivalent" | "inconclusive" | "A/A";
  n: { ts: number; wasm: number; pairs: number };
}

export interface CompareResults {
  schema: 1;
  /** When the run started and when it finished (ISO). */
  startedAt?: string;
  /** Each --resume of the run, and the attempts a stop interrupted (rerun;
   *  their partial measurements are not kept, and validation names them). */
  resumes?: { at: string; runsFromCheckpoint: number }[];
  interruptedAttempts?: { rep: number; engine: string; at: string }[];
  generatedAt: string;
  issue: string;
  config: CompareConfig;
  environment: Environment;
  browser: { version: string | null; headless: boolean; executable: string | null; channel?: string | null; args?: string[]; rendererException?: string | null; rendererExceptionSha256?: string | null; rendererExceptionCommit?: string | null; gpuVerified?: boolean };
  scenarios: { name: string; description: string; sha256: string; population: number; units: number; transports: number; saveBytes: number }[];
  nodeChecks: NodeCheck[];
  runs: ProcessRun[];
  bundle: BundleReport | null;
  /** The same totals for the VC_TOOLING=1 build the timings ran on. */
  toolingBundleTotals?: BundleReport["totals"];
  metrics: MetricRow[];
  comparisons: Comparison[];
  validation: { ok: boolean; errors: string[]; warnings: string[] };
  limitations: string[];
}
