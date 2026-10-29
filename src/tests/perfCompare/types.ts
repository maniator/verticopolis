import type { ChurnReport } from "./churn";
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
  attribution: { engineTickMs: number; engineExportMs: number; hostJsMs: number; wrappedTotalMs: number; merges: number; engineTicks: number; exportCalls: number; exportsWrapped: number; byExport: Record<string, { calls: number; ms: number }>; parseMs: number; parseCalls: number } | null;
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
  /** When boot first published its engine state (`window.__vcEngineBoot`),
   *  which both engines do just before the app is created: on WASM it ends
   *  the package load (#1254). Null when the page never published it;
   *  absent in results written before the mark existed. */
  engineLoadedMs?: number | null;
  servedBeforeReady: ServedRequest[];
  servedAfterReady: ServedRequest[];
}

/** The package's load in a blank page (#1005), the two ways a page can take
 *  it. Each way runs in a context of its own, because V8 keeps a compiled
 *  module by its bytes and a second compile in the same process would answer
 *  from that cache. A way that failed leaves its record `null` and says why
 *  in `error`. */
export interface IdleLoad {
  /** The whole download, then `WebAssembly.compile` (what the old
   *  `wasmCold` row timed, without the app's event loop in the way):
   *  `responseMs` to the headers, `bodyMs` to read the bytes, `compileMs`. */
  buffered: { responseMs: number; bodyMs: number; compileMs: number; bytes: number } | null;
  /** `WebAssembly.compileStreaming` over the response, which compiles while
   *  the bytes arrive: `responseMs` to the headers, `totalMs` from the request
   *  to the module. */
  streamed: { responseMs: number; totalMs: number } | null;
  error: string | null;
}

/** One cold start with a scenario's save in the autosave slot (#1254), in a
 *  fresh context of the repetition's browser process. `sample` is set only
 *  when every check passed (the requested engine ran, the boot loaded the
 *  seeded tower with its population, the renderer did not change, no context
 *  was lost and no engine or frame error was logged); otherwise `error` says
 *  why and the row has no sample from this repetition. */
export interface SavedStart {
  sample: StartupSample | null;
  error: string | null;
  /** sha256 of the autosave value the context was seeded with. */
  seedSha256: string;
  /** The WebGL renderer read after the start. */
  renderer: string | null;
  /** Page and console errors and lost WebGL contexts during this start,
   *  kept off the repetition's own lists. */
  pageErrors: string[];
  contextLost: string[];
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
  /** One line per WebGL context lost on a canvas in any of the run's pages (contextLoss.ts); absent in results written before this check, empty for none. Any entry fails validation in every mode. */
  contextLost?: string[];
  cold: StartupSample | null;
  warm: StartupSample | null;
  /** A cold start under the heaviest configured CPU throttle (4x by
   *  default), in a second fresh context of the same browser process
   *  (fresh HTTP cache, not a fresh process). */
  cold4x: StartupSample | null;
  /** A cold start at 1x with each scenario's save in the autosave slot,
   *  keyed by scenario (#1254). Auxiliary like the first visit: it runs after
   *  every other measurement of a good repetition and cannot fail it.
   *  Absent in results written before it and in failed repetitions. */
  coldSaved?: Record<string, SavedStart>;
  /** A fixed CPU loop: unthrottled, under the cold start's throttle, and
   *  under each throttle of every scenario's timed passes and of each frame
   *  block (keyed "<scenario or frames-on/off>:<rate>"). */
  cpuProbe: { unthrottledMs: number; throttledMs: number | null; rate: number; timed: Record<string, number> } | null;
  scenarios: Record<string, ScenarioRun>;
  wasmCold: { fetchMs: number; bytes: number; compileMs: number; instantiateMs: number; firstEngineMs: number } | null;
  /** The package's download and compile in a blank same-origin page of a
   *  context of its own, so no event loop of the app waits in the timings and
   *  no earlier compile in the process answers from V8's module cache (#1005).
   *  Auxiliary like the first visit: it runs on the TypeScript process only,
   *  after every other measurement, and cannot fail the repetition. Absent in
   *  results written before it and in repetitions that did not run it. */
  wasmIdle?: IdleLoad;
  /** The audio start of the audio-on frame pass: the last scenario's page, since each scenario starts audio in its own. */
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
  /** Hourly save churn on the WASM engine in Node, per scenario. */
  churn?: ChurnReport[];
  runs: ProcessRun[];
  bundle: BundleReport | null;
  /** The same totals for the VC_TOOLING=1 build the timings ran on. */
  toolingBundleTotals?: BundleReport["totals"];
  metrics: MetricRow[];
  comparisons: Comparison[];
  validation: { ok: boolean; errors: string[]; warnings: string[] };
  limitations: string[];
}
