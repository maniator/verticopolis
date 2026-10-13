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
}

export interface StepSummary {
  totalMs: number;
  loadMs: number;
  stepMedianMs: number;
  stepP95Ms: number;
  stepP99Ms: number;
  stepMaxMs: number;
  attribution: { engineTickMs: number; engineExportMs: number; hostJsMs: number; merges: number } | null;
  engineActive: EngineName;
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
  engineActive: EngineName;
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
  servedBeforeReady: ServedRequest[];
  servedAfterReady: ServedRequest[];
}

export interface ScenarioRun {
  adoptMs: number;
  memory: MemorySummary;
  /** Keyed by the CPU throttle rate as a string ("1", "4"). */
  hosted: Record<string, StepSummary>;
  raw: Record<string, StepSummary>;
  frames: Record<string, FrameSummary>;
}

export interface ProcessRun {
  rep: number;
  engine: EngineName;
  order: number;
  ok: boolean;
  error: string | null;
  /** Uncaught page errors and console errors, kept for the record. */
  pageErrors: string[];
  browserVersion: string | null;
  page: { crossOriginIsolated: boolean; timerResolutionMs: number; userAgent: string; viewport: { width: number; height: number; dpr: number }; webgl: { renderer: string; vendor: string } | null } | null;
  cold: StartupSample | null;
  warm: StartupSample | null;
  scenarios: Record<string, ScenarioRun>;
  wasmCold: { fetchMs: number; bytes: number; compileMs: number; instantiateMs: number; firstEngineMs: number } | null;
  /** A first visit with the service worker allowed, then an offline
   *  reload: which engine came back without the network. */
  firstVisitWithServiceWorker: { served: ServedRequest[]; swActive: boolean; offlineEngineActive: EngineName | null } | null;
}

export interface MetricRow {
  group: "startup" | "sim-hosted" | "sim-raw" | "frames" | "memory" | "transfer" | "wasm-load";
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
  /** wasm / ts, ratio of medians, with a seeded bootstrap 95% interval. */
  ratio: number;
  ciLow: number | null;
  ciHigh: number | null;
  verdict: "wasm faster" | "wasm slower" | "wasm smaller" | "wasm larger" | "wasm lower" | "wasm higher" | "equivalent" | "inconclusive";
  n: { ts: number; wasm: number };
}

export interface CompareResults {
  schema: 1;
  generatedAt: string;
  issue: string;
  config: CompareConfig;
  environment: Environment;
  browser: { version: string | null; headless: boolean; executable: string | null };
  scenarios: { name: string; description: string; sha256: string; population: number; units: number; transports: number; saveBytes: number }[];
  nodeChecks: NodeCheck[];
  runs: ProcessRun[];
  bundle: BundleReport | null;
  metrics: MetricRow[];
  comparisons: Comparison[];
  validation: { ok: boolean; errors: string[]; warnings: string[] };
  limitations: string[];
}
