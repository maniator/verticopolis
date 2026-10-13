import type { CompareConfig, EngineName, FrameSummary, ProcessRun, StartupSample, StepSummary } from "./types";

/** Hand-made comparison records for the unit tests (issue #972). */

export function config(over: Partial<CompareConfig> = {}): CompareConfig {
  return {
    reps: 2,
    dt: 2,
    steps: 10,
    warmSteps: 2,
    throttles: [1],
    frameWindowMs: 100,
    frameWarmMs: 10,
    speed: 3,
    viewport: { width: 1280, height: 720 },
    scenarios: ["small"],
    quick: false,
    ...over,
  };
}

export function step(engine: EngineName, over: Partial<StepSummary> = {}): StepSummary {
  return {
    totalMs: 100,
    loadMs: 5,
    stepMedianMs: 1,
    stepP95Ms: 2,
    stepP99Ms: 3,
    stepMaxMs: 4,
    attribution: null,
    engineActive: engine,
    hostErrorsAdded: [],
    startMinutes: 580,
    startDigest: "a",
    endDigest: "b",
    end: { minutes: 600, money: 1, star: 2, population: 10, people: 3 },
    ...over,
  };
}

export function frames(engine: EngineName, over: Partial<FrameSummary> = {}): FrameSummary {
  return { frames: 120, medianMs: 16, p95Ms: 20, p99Ms: 30, meanFps: 60, onePercentLowFps: 33, simMinutesPerSecond: 100, tickShare: 0.1, uiShare: 0.01, ticks: 200, restShare: 0.89, clampedFrames: 0, engineActive: engine, hostErrorsAdded: [], audioStarted: false, ...over };
}

export function startupSample(engine: EngineName, over: Partial<StartupSample> = {}): StartupSample {
  return {
    engineActive: engine,
    gameReadyMs: 300,
    engineHostedMs: engine === "wasm" ? 290 : null,
    firstFrameMs: 320,
    domContentLoadedMs: 100,
    loadEventMs: 150,
    wasmFetchMs: engine === "wasm" ? 10 : null,
    glueFetchMs: engine === "wasm" ? 2 : null,
    wasmInstantiateMs: engine === "wasm" ? 40 : null,
    wasmInstantiateVia: engine === "wasm" ? "instantiateStreaming" : null,
    servedBeforeReady: [{ path: "/", status: 200, bytes: 1000, encoding: "br" }],
    servedAfterReady: [{ path: "/x.js", status: 200, bytes: 500, encoding: "br" }],
    ...over,
  };
}

export function processRun(rep: number, engine: EngineName, over: Partial<ProcessRun> = {}, scale = 1): ProcessRun {
  return {
    rep,
    engine,
    order: 0,
    ok: true,
    error: null,
    pageErrors: [],
    browserVersion: "141.0",
    page: { crossOriginIsolated: true, timerResolutionMs: 0.005, userAgent: "ua", viewport: { width: 1280, height: 720, dpr: 1 }, webgl: null },
    cold: startupSample(engine),
    warm: startupSample(engine),
    cold4x: startupSample(engine, { gameReadyMs: 1200 }),
    scenarios: {
      small: {
        adoptMs: 10 * scale,
        memory: { jsHeapUsedBytes: 1e6, jsHeapTotalBytes: 2e6, wasmMemoryBytes: engine === "wasm" ? 8e6 : null, processPssBytes: 5e8, processes: 5 },
        hosted: { "1": step(engine, { totalMs: 100 * scale }) },
        raw: { "1": step(engine, { totalMs: 50 * scale }) },
        frames: { "1": frames(engine) },
        framesAudio: { "1": frames(engine, { audioStarted: true }) },
      },
    },
    audio: { started: true, muted: false, contexts: ["running"] },
    wasmCold: engine === "ts" ? { fetchMs: 10, bytes: 1000, compileMs: 300, instantiateMs: 1, firstEngineMs: 20 } : null,
    firstVisitWithServiceWorker: { served: [{ path: "/", status: 200, bytes: 2000, encoding: "br" }], swActive: true, offlineEngineActive: "ts", offlinePageErrors: [], error: null },
    ...over,
  };
}
