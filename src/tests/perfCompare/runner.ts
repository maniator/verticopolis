import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "playwright";
import { processTreePss } from "./env";
import { adoptScenario, digestStashed, installProbes, pageInfo, prepareLiveApp, stashSave, wasmColdLoad, wasmMemoryBytes, type PageInfo } from "./page";
import { audioStatus, measureFrames, startAudio, type FrameRun } from "./pageFrames";
import { simRun, type SimRun } from "./pageSim";
import type { PerfServer, ServedRequest } from "./server";
import type { Scenario } from "./scenarios";
import { frameStats, quantile } from "./stats";
import type { CompareConfig, EngineName, FrameSummary, MemorySummary, ProcessRun, StartupSample, StepSummary } from "./types";

/**
 * One repetition of one engine in a fresh browser process (issue #972):
 * 1. cold start and warm start (reload);
 * 2. a memory pass: per scenario, a fresh page (reload), load the save,
 *    two in-game hours, full GC, then JS heap, WASM memory and browser PSS;
 * 3. per scenario and CPU throttle: the simulation-only runs (hosted, plus a
 *    separate attribution pass on WASM, and the bare engine) and the
 *    gameplay frames, all with audio off (never started);
 * 4. audio started, then the gameplay frames again;
 * 5. (TypeScript process) the WASM package's load steps, timed apart;
 * 6. a cold start under the 4x throttle in a second fresh context;
 * 7. a first visit with the service worker allowed, then an offline reload.
 * The requested engine is re-checked after every sample.
 */

export interface RunnerOptions {
  server: PerfServer;
  config: CompareConfig;
  scenarios: Scenario[];
  executablePath: string | null;
  log: (line: string) => void;
}

const STEP_TIMEOUT_MS = 15 * 60 * 1000;
/** Excalibur hands a frame longer than this its own 1 ms (see
 *  src/render/excalibur/TowerEngine.ts, the decorative clock note). */
export const CLAMP_FRAME_MS = 200;

async function within<T>(what: string, p: Promise<T>, ms = STEP_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<T>((_, fail) => (timer = setTimeout(() => fail(new Error(`${what} timed out after ${ms} ms`)), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

function resourceMs(info: PageInfo, path: string): number | null {
  const r = info.resources.find((x) => x.name === path);
  return r ? r.responseEnd - r.startTime : null;
}

/** Startup numbers from one page load's marks and timings. */
export function startupSample(info: PageInfo, servedBeforeReady: ServedRequest[], servedAfterReady: ServedRequest[]): StartupSample {
  const m = info.marks;
  const instantiated = m.wasmInstantiateStart !== undefined && m.wasmInstantiateEnd !== undefined && m.wasmInstantiateEnd >= 0;
  const via = { 1: "instantiateStreaming", 2: "instantiate" } as const;
  return {
    engineActive: info.engineActive,
    gameReadyMs: m.gameReady ?? null,
    engineHostedMs: m.engineHosted ?? null,
    firstFrameMs: m.firstFrameAfterReady ?? null,
    domContentLoadedMs: info.navigation?.domContentLoaded ?? null,
    loadEventMs: info.navigation?.loadEventEnd ?? null,
    wasmFetchMs: resourceMs(info, "/engine/verticopolis_engine_bg.wasm"),
    glueFetchMs: resourceMs(info, "/engine/verticopolis_engine.js"),
    wasmInstantiateMs: instantiated ? m.wasmInstantiateEnd - m.wasmInstantiateStart : null,
    wasmInstantiateVia: via[m.wasmInstantiateVia as 1 | 2] ?? null,
    servedBeforeReady,
    servedAfterReady,
  };
}

/** Navigate (or reload) and wait for the app to publish `window.game`. The
 *  served requests are split where the poll first sees it (every 10 ms),
 *  so the before-ready bytes can include a request issued in that gap. */
async function startup(page: Page, server: PerfServer, go: () => Promise<unknown>): Promise<{ sample: StartupSample; info: PageInfo }> {
  server.take();
  await go();
  await page.waitForFunction(() => Boolean((window as unknown as { game?: unknown }).game), undefined, { timeout: 120_000, polling: 10 });
  const before = server.take();
  await page.waitForLoadState("networkidle", { timeout: 120_000 });
  // A missing first frame stays null and is reported as a missing sample.
  await page.waitForFunction(() => (window as unknown as { __perfMarks?: { firstFrameAfterReady?: number } }).__perfMarks?.firstFrameAfterReady !== undefined, undefined, { timeout: 30_000 }).catch(() => {});
  const after = server.take();
  const info = await page.evaluate(pageInfo);
  return { info, sample: startupSample(info, before, after) };
}

export function stepSummary(r: SimRun, startDigest: string, endDigest: string, attribution: SimRun["attribution"] = r.attribution): StepSummary {
  return {
    totalMs: r.totalMs,
    loadMs: r.loadMs,
    stepMedianMs: quantile(r.stepMs, 0.5),
    stepP95Ms: quantile(r.stepMs, 0.95),
    stepP99Ms: quantile(r.stepMs, 0.99),
    stepMaxMs: quantile(r.stepMs, 1),
    attribution,
    engineActive: r.engineActive,
    hostErrorsAdded: r.hostErrorsAdded,
    startMinutes: r.startMinutes,
    startDigest,
    endDigest,
    end: r.end,
  };
}

export function frameSummary(f: FrameRun): FrameSummary {
  const s = frameStats(f.intervalsMs);
  const tickShare = f.tickMs / f.wallMs;
  const uiShare = f.uiMs / f.wallMs;
  return {
    frames: s.frames,
    medianMs: s.medianMs,
    p95Ms: s.p95Ms,
    p99Ms: s.p99Ms,
    meanFps: s.meanFps,
    onePercentLowFps: s.onePercentLowFps,
    simMinutesPerSecond: f.simMinutes / (f.wallMs / 1000),
    tickShare,
    uiShare,
    restShare: Math.max(0, 1 - tickShare - uiShare),
    ticks: f.ticks,
    clampedFrames: f.intervalsMs.filter((x) => x > CLAMP_FRAME_MS).length,
    engineActive: f.engineActive,
    hostErrorsAdded: f.hostErrorsAdded,
    audioStarted: f.audioStarted,
  };
}

async function throttle(cdp: CDPSession, rate: number): Promise<void> {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
}

async function newContext(browser: Browser, config: CompareConfig, serviceWorkers: "allow" | "block"): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: config.viewport, deviceScaleFactor: 1, serviceWorkers });
  // tsx compiles this harness with esbuild's keepNames, which wraps inner
  // functions in a `__name(fn, "name")` helper. The functions Playwright
  // serializes into the page carry those calls but not the helper, so the
  // page gets an identity stand-in before anything else runs.
  await ctx.addInitScript({ content: "globalThis.__name = (fn) => fn;" });
  await ctx.addInitScript(installProbes);
  return ctx;
}

async function expectEngine(page: Page, engine: EngineName, where: string): Promise<void> {
  const info = await page.evaluate(pageInfo);
  if (info.engineActive !== engine) throw new Error(`${where}: requested the ${engine} engine but ${info.engineActive} is active (host: ${JSON.stringify(info.host)})`);
}

async function freshPage(page: Page, engine: EngineName, where: string): Promise<void> {
  await page.reload({ waitUntil: "commit" });
  await page.waitForFunction(() => Boolean((window as unknown as { game?: unknown }).game), undefined, { timeout: 120_000 });
  await page.waitForLoadState("networkidle", { timeout: 120_000 });
  await expectEngine(page, engine, where);
  await page.evaluate(prepareLiveApp);
}

/** The memory pass: each scenario in a fresh page, so no scenario's WASM
 *  memory or heap carries another's (or a bare engine's) high-water mark. */
async function memoryPass(page: Page, cdp: CDPSession, opts: RunnerOptions, engine: EngineName, engineUrl: string): Promise<Record<string, { adoptMs: number; memory: MemorySummary }>> {
  const out: Record<string, { adoptMs: number; memory: MemorySummary }> = {};
  for (const sc of opts.scenarios) {
    await freshPage(page, engine, `${sc.name} memory pass boot`);
    await page.evaluate(stashSave, { name: sc.name, save: sc.save });
    const adopt = await page.evaluate(adoptScenario, sc.name);
    if (adopt.engineActive !== engine) throw new Error(`${sc.name}: after loading the save, ${adopt.engineActive} runs the tower, not ${engine}`);
    await page.evaluate(prepareLiveApp);
    await page.evaluate((n) => {
      const g = (window as unknown as { game: { sim: { tick(dt: number): void } } }).game;
      for (let i = 0; i < n; i++) g.sim.tick(2);
    }, 60);
    await cdp.send("HeapProfiler.collectGarbage");
    const heap = (await cdp.send("Runtime.getHeapUsage")) as { usedSize: number; totalSize: number };
    const wasmBytes = engine === "wasm" ? await page.evaluate(wasmMemoryBytes, engineUrl) : null;
    const pss = processTreePss(process.pid, /chrom|headless_shell/i);
    await expectEngine(page, engine, `${sc.name} memory pass`);
    out[sc.name] = { adoptMs: adopt.adoptMs, memory: { jsHeapUsedBytes: heap.usedSize, jsHeapTotalBytes: heap.totalSize, wasmMemoryBytes: wasmBytes, processPssBytes: pss?.bytes ?? null, processes: pss?.processes ?? null } };
  }
  return out;
}

export async function runProcess(opts: RunnerOptions, rep: number, engine: EngineName, order: number): Promise<ProcessRun> {
  const { server, config, scenarios, log } = opts;
  const run: ProcessRun = {
    rep,
    engine,
    order,
    ok: false,
    error: null,
    pageErrors: [],
    browserVersion: null,
    page: null,
    cold: null,
    warm: null,
    cold4x: null,
    scenarios: {},
    wasmCold: null,
    audio: null,
    firstVisitWithServiceWorker: null,
  };
  const engineUrl = `${server.url}/engine/verticopolis_engine.js`;
  const url = `${server.url}/?engine=${engine}`;
  // Errors go to the run, except during the offline reload, where the
  // engine package failing to load is the behavior being measured; those
  // land on the first-visit record instead.
  const sink = { offline: null as string[] | null };
  const listen = (page: Page): void => {
    const note = (line: string) => (sink.offline ?? run.pageErrors).push(line);
    page.on("pageerror", (e) => note(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") note(`console: ${m.text()}`);
    });
  };
  let browser: Browser | null = null;
  try {
    // Autoplay without a gesture, so the audio-on pass can start audio the
    // way a player's first click would. Audio stays off until that pass.
    browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"], ...(opts.executablePath ? { executablePath: opts.executablePath } : {}) });
    run.browserVersion = browser.version();
    const ctx = await newContext(browser, config, "block");
    const page = await ctx.newPage();
    listen(page);
    const cdp = await ctx.newCDPSession(page);

    const cold = await startup(page, server, () => page.goto(url, { waitUntil: "commit" }));
    run.cold = cold.sample;
    run.page = { crossOriginIsolated: cold.info.crossOriginIsolated, timerResolutionMs: cold.info.timerResolutionMs, userAgent: cold.info.userAgent, viewport: cold.info.viewport, webgl: cold.info.webgl };
    if (cold.sample.engineActive !== engine) throw new Error(`requested the ${engine} engine but ${cold.sample.engineActive} is active (host: ${JSON.stringify(cold.info.host)})`);
    const warm = await startup(page, server, () => page.reload({ waitUntil: "commit" }));
    run.warm = warm.sample;
    if (warm.sample.engineActive !== engine) throw new Error(`warm start: requested the ${engine} engine but ${warm.sample.engineActive} is active`);
    log(`  rep ${rep} ${engine}: cold ready ${cold.sample.gameReadyMs?.toFixed(0)} ms, warm ready ${warm.sample.gameReadyMs?.toFixed(0)} ms`);

    const memory = await memoryPass(page, cdp, opts, engine, engineUrl);
    await freshPage(page, engine, "timed passes boot");

    for (const sc of scenarios) {
      await page.evaluate(stashSave, { name: sc.name, save: sc.save });
      const scenarioRun: ProcessRun["scenarios"][string] = { ...memory[sc.name], hosted: {}, raw: {}, frames: {}, framesAudio: {} };
      run.scenarios[sc.name] = scenarioRun;
      for (const rate of config.throttles) {
        const t = String(rate);
        await throttle(cdp, rate);
        try {
          const sim = (mode: "hosted" | "raw", attribute: boolean) =>
            within(`${sc.name} ${mode}`, page.evaluate(simRun, { name: sc.name, mode, engine, steps: config.steps, warmSteps: config.warmSteps, dt: config.dt, engineUrl, attribute }));
          const hosted = await sim("hosted", false);
          const hostedStart = await page.evaluate(digestStashed, hosted.startKey);
          const hostedEnd = await page.evaluate(digestStashed, hosted.endKey);
          // The split comes from its own wrapped pass, so the wrappers'
          // cost never reaches the timings.
          let attribution: SimRun["attribution"] = null;
          if (engine === "wasm") {
            const a = await sim("hosted", true);
            await page.evaluate(digestStashed, a.startKey);
            await page.evaluate(digestStashed, a.endKey);
            attribution = a.attribution;
            if (!attribution || attribution.engineTicks !== config.steps) throw new Error(`${sc.name} ${t}x: the attribution pass saw ${attribution?.engineTicks ?? "no"} engine ticks for ${config.steps} steps`);
          }
          scenarioRun.hosted[t] = stepSummary(hosted, hostedStart, hostedEnd, attribution);
          const raw = await sim("raw", false);
          scenarioRun.raw[t] = stepSummary(raw, await page.evaluate(digestStashed, raw.startKey), await page.evaluate(digestStashed, raw.endKey));
          await page.evaluate(adoptScenario, sc.name);
          await page.evaluate(prepareLiveApp);
          scenarioRun.frames[t] = frameSummary(await within(`${sc.name} frames`, page.evaluate(measureFrames, { windowMs: config.frameWindowMs, warmMs: config.frameWarmMs, speed: config.speed })));
        } finally {
          await throttle(cdp, 1);
        }
        await expectEngine(page, engine, `${sc.name} ${t}x`);
        const h = scenarioRun.hosted[t];
        const fr = scenarioRun.frames[t];
        log(`  rep ${rep} ${engine} ${sc.name} ${t}x: hosted ${h.totalMs.toFixed(0)} ms, raw ${scenarioRun.raw[t].totalMs.toFixed(0)} ms, frames median ${fr.medianMs.toFixed(1)} ms (${fr.frames} frames, ${fr.clampedFrames} over ${CLAMP_FRAME_MS} ms)`);
      }
    }

    // Audio on: start it the way a first gesture would, then the frames again.
    if ((await page.evaluate(audioStatus)).started) throw new Error("audio started before the audio-on pass; the audio-off frames are not audio-off");
    run.audio = await page.evaluate(startAudio, 15_000);
    log(`  rep ${rep} ${engine}: audio ${run.audio.started ? "started" : "DID NOT START"} (contexts: ${run.audio.contexts.join(", ") || "none"})`);
    if (run.audio.started) {
      for (const sc of scenarios) {
        for (const rate of config.throttles) {
          await page.evaluate(adoptScenario, sc.name);
          await page.evaluate(prepareLiveApp);
          await throttle(cdp, rate);
          try {
            run.scenarios[sc.name].framesAudio[String(rate)] = frameSummary(await within(`${sc.name} frames with audio`, page.evaluate(measureFrames, { windowMs: config.frameWindowMs, warmMs: config.frameWarmMs, speed: config.speed })));
          } finally {
            await throttle(cdp, 1);
          }
        }
      }
      await expectEngine(page, engine, "audio pass");
    }
    if (engine === "ts") {
      run.wasmCold = await page.evaluate(wasmColdLoad, { wasmUrl: `${server.url}/engine/verticopolis_engine_bg.wasm`, jsUrl: engineUrl, scenario: scenarios[0].name });
    }
    await ctx.close();

    // A cold start under the 4x throttle: a fresh context (fresh HTTP cache),
    // throttled before navigation.
    const slow = await newContext(browser, config, "block");
    const slowPage = await slow.newPage();
    listen(slowPage);
    const slowCdp = await slow.newCDPSession(slowPage);
    await throttle(slowCdp, 4);
    const c4 = await startup(slowPage, server, () => slowPage.goto(url, { waitUntil: "commit" }));
    run.cold4x = c4.sample;
    if (c4.sample.engineActive !== engine) throw new Error(`4x cold start: requested the ${engine} engine but ${c4.sample.engineActive} is active`);
    await slow.close();
    run.ok = true;

    // Auxiliary: a first visit with the service worker allowed, then an
    // offline reload. A failure here is recorded on its own record and never
    // discards the repetition's measurements above.
    run.firstVisitWithServiceWorker = await firstVisit(browser, config, server, url, listen, sink);
  } catch (e) {
    run.error = e instanceof Error ? e.message : String(e);
    run.ok = false;
    log(`  rep ${rep} ${engine}: FAILED: ${run.error}`);
  } finally {
    await browser?.close();
  }
  return run;
}

async function firstVisit(browser: Browser, config: CompareConfig, server: PerfServer, url: string, listen: (p: Page) => void, sink: { offline: string[] | null }): Promise<NonNullable<ProcessRun["firstVisitWithServiceWorker"]>> {
  const sw = await newContext(browser, config, "allow");
  const result: NonNullable<ProcessRun["firstVisitWithServiceWorker"]> = { served: [], swActive: false, offlineEngineActive: null, offlinePageErrors: [], error: null };
  try {
    const page = await sw.newPage();
    listen(page);
    server.take();
    await page.goto(url, { waitUntil: "commit" });
    await page.waitForFunction(() => Boolean((window as unknown as { game?: unknown }).game), undefined, { timeout: 120_000 });
    result.swActive = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise<boolean>((ok) => setTimeout(() => ok(false), 30_000))]));
    await page.waitForLoadState("networkidle", { timeout: 120_000 });
    await page.waitForTimeout(1000);
    await page.waitForLoadState("networkidle", { timeout: 60_000 });
    result.served = server.take();
    if (result.swActive) {
      // Offline: reload with the network cut and see which engine the page
      // comes back on (the precache leaves engine/** out).
      await sw.setOffline(true);
      sink.offline = result.offlinePageErrors;
      try {
        await page.reload({ waitUntil: "commit" });
        await page.waitForFunction(() => Boolean((window as unknown as { game?: unknown }).game), undefined, { timeout: 60_000 });
        await page.waitForTimeout(1000);
        result.offlineEngineActive = (await page.evaluate(pageInfo)).engineActive;
      } finally {
        sink.offline = null;
        await sw.setOffline(false);
      }
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  } finally {
    server.take();
    await sw.close();
  }
  return result;
}

/** The process order for a repetition: alternate which engine goes first,
 *  so neither always runs on a machine the other just warmed. */
export function engineOrder(rep: number): EngineName[] {
  return rep % 2 === 0 ? ["ts", "wasm"] : ["wasm", "ts"];
}
