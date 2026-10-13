import { chromium, type BrowserContext, type CDPSession, type Page } from "playwright";
import { processTreePss } from "./env";
import { adoptScenario, digestStashed, installProbes, measureFrames, pageInfo, prepareLiveApp, simRun, stashSave, wasmColdLoad, wasmMemoryBytes, type PageInfo, type SimRun } from "./page";
import type { PerfServer, ServedRequest } from "./server";
import type { Scenario } from "./scenarios";
import { frameStats, quantile } from "./stats";
import type { CompareConfig, EngineName, FrameSummary, ProcessRun, StartupSample, StepSummary } from "./types";

/**
 * One repetition of one engine in a fresh browser process (issue #972):
 * cold start, warm start (reload), then per scenario the memory snapshot,
 * the simulation-only runs (hosted and raw) and the gameplay frames, at
 * every CPU throttle; the TypeScript process also times the WASM package's
 * cold load steps; the last step is a first visit with the service worker
 * allowed, in a separate context, to count the precache traffic.
 */

export interface RunnerOptions {
  server: PerfServer;
  config: CompareConfig;
  scenarios: Scenario[];
  executablePath: string | null;
  log: (line: string) => void;
}

const STEP_TIMEOUT_MS = 15 * 60 * 1000;

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

/** Navigate (or reload) and wait for the app to publish `window.game`; the
 *  served requests are split at that moment. */
async function startup(page: Page, server: PerfServer, go: () => Promise<unknown>): Promise<{ sample: StartupSample; info: PageInfo }> {
  server.take();
  await go();
  await page.waitForFunction(() => Boolean((window as unknown as { game?: unknown }).game), undefined, { timeout: 120_000 });
  const servedBeforeReady = server.take();
  await page.waitForLoadState("networkidle", { timeout: 120_000 });
  // Give the first frame after ready a chance to land.
  await page.waitForFunction(() => (window as unknown as { __perfMarks?: { firstFrameAfterReady?: number } }).__perfMarks?.firstFrameAfterReady !== undefined, undefined, { timeout: 30_000 }).catch(() => {});
  const servedAfterReady = server.take();
  const info = await page.evaluate(pageInfo);
  return {
    info,
    sample: {
      engineActive: info.engineActive,
      gameReadyMs: info.marks.gameReady ?? null,
      engineHostedMs: info.marks.engineHosted ?? null,
      firstFrameMs: info.marks.firstFrameAfterReady ?? null,
      domContentLoadedMs: info.navigation?.domContentLoaded ?? null,
      loadEventMs: info.navigation?.loadEventEnd ?? null,
      wasmFetchMs: resourceMs(info, "/engine/verticopolis_engine_bg.wasm"),
      glueFetchMs: resourceMs(info, "/engine/verticopolis_engine.js"),
      servedBeforeReady,
      servedAfterReady,
    },
  };
}

export function stepSummary(r: SimRun, startDigest: string, endDigest: string): StepSummary {
  return {
    totalMs: r.totalMs,
    loadMs: r.loadMs,
    stepMedianMs: quantile(r.stepMs, 0.5),
    stepP95Ms: quantile(r.stepMs, 0.95),
    stepP99Ms: quantile(r.stepMs, 0.99),
    stepMaxMs: quantile(r.stepMs, 1),
    attribution: r.attribution,
    engineActive: r.engineActive,
    startDigest,
    endDigest,
    end: r.end,
  };
}

async function throttle(cdp: CDPSession, rate: number): Promise<void> {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
}

async function newContext(browser: Awaited<ReturnType<typeof chromium.launch>>, config: CompareConfig, serviceWorkers: "allow" | "block"): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: config.viewport, deviceScaleFactor: 1, serviceWorkers });
  // tsx compiles this harness with esbuild's keepNames, which wraps inner
  // functions in a `__name(fn, "name")` helper. The functions Playwright
  // serializes into the page carry those calls but not the helper, so the
  // page gets an identity stand-in before anything else runs.
  await ctx.addInitScript({ content: "globalThis.__name = (fn) => fn;" });
  await ctx.addInitScript(installProbes);
  return ctx;
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
    scenarios: {},
    wasmCold: null,
    firstVisitWithServiceWorker: null,
  };
  const engineUrl = `${server.url}/engine/verticopolis_engine.js`;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch({ headless: true, ...(opts.executablePath ? { executablePath: opts.executablePath } : {}) });
    run.browserVersion = browser.version();
    const ctx = await newContext(browser, config, "block");
    const page = await ctx.newPage();
    page.on("pageerror", (e) => run.pageErrors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") run.pageErrors.push(`console: ${m.text()}`);
    });
    const cdp = await ctx.newCDPSession(page);
    const url = `${server.url}/?engine=${engine}`;

    const cold = await startup(page, server, () => page.goto(url, { waitUntil: "commit" }));
    run.cold = cold.sample;
    run.page = { crossOriginIsolated: cold.info.crossOriginIsolated, timerResolutionMs: cold.info.timerResolutionMs, userAgent: cold.info.userAgent, viewport: cold.info.viewport, webgl: cold.info.webgl };
    if (cold.sample.engineActive !== engine) throw new Error(`requested the ${engine} engine but ${cold.sample.engineActive} is active (host: ${JSON.stringify(cold.info.host)})`);
    const warm = await startup(page, server, () => page.reload({ waitUntil: "commit" }));
    run.warm = warm.sample;
    if (warm.sample.engineActive !== engine) throw new Error(`warm start: requested the ${engine} engine but ${warm.sample.engineActive} is active`);
    log(`  rep ${rep} ${engine}: cold ready ${cold.sample.gameReadyMs?.toFixed(0)} ms, warm ready ${warm.sample.gameReadyMs?.toFixed(0)} ms`);

    await page.evaluate(prepareLiveApp);
    for (const sc of scenarios) {
      await page.evaluate(stashSave, { name: sc.name, save: sc.save });
      const adopt = await page.evaluate(adoptScenario, sc.name);
      await page.evaluate(prepareLiveApp);
      if (adopt.engineActive !== engine) throw new Error(`${sc.name}: after loading the save, ${adopt.engineActive} runs the tower, not ${engine}`);
      // Memory after two in-game hours on the hosted path, then a full GC.
      await page.evaluate((n) => {
        const g = (window as unknown as { game: { sim: { tick(dt: number): void } } }).game;
        for (let i = 0; i < n; i++) g.sim.tick(2);
      }, 60);
      await cdp.send("HeapProfiler.collectGarbage");
      const heap = (await cdp.send("Runtime.getHeapUsage")) as { usedSize: number; totalSize: number };
      const wasmBytes = await page.evaluate(wasmMemoryBytes, engineUrl);
      const pss = processTreePss(process.pid);
      const scenarioRun: ProcessRun["scenarios"][string] = {
        adoptMs: adopt.adoptMs,
        memory: { jsHeapUsedBytes: heap.usedSize, jsHeapTotalBytes: heap.totalSize, wasmMemoryBytes: wasmBytes, processPssBytes: pss?.bytes ?? null, processes: pss?.processes ?? null },
        hosted: {},
        raw: {},
        frames: {},
      };
      run.scenarios[sc.name] = scenarioRun;
      for (const rate of config.throttles) {
        const t = String(rate);
        await throttle(cdp, rate);
        try {
          for (const mode of ["hosted", "raw"] as const) {
            const r = await within(`${sc.name} ${mode}`, page.evaluate(simRun, { name: sc.name, mode, engine, steps: config.steps, warmSteps: config.warmSteps, dt: config.dt, engineUrl }));
            const start = await page.evaluate(digestStashed, r.startKey);
            const end = await page.evaluate(digestStashed, r.endKey);
            (mode === "hosted" ? scenarioRun.hosted : scenarioRun.raw)[t] = stepSummary(r, start, end);
            await page.evaluate(prepareLiveApp);
          }
          await page.evaluate(adoptScenario, sc.name);
          await page.evaluate(prepareLiveApp);
          const f = await within(`${sc.name} frames`, page.evaluate(measureFrames, { windowMs: config.frameWindowMs, warmMs: config.frameWarmMs, speed: config.speed }));
          scenarioRun.frames[t] = frameSummary(f);
        } finally {
          await throttle(cdp, 1);
        }
        const h = scenarioRun.hosted[t];
        const raw = scenarioRun.raw[t];
        const fr = scenarioRun.frames[t];
        log(`  rep ${rep} ${engine} ${sc.name} ${t}x: hosted ${h.totalMs.toFixed(0)} ms, raw ${raw.totalMs.toFixed(0)} ms, frames median ${fr.medianMs.toFixed(1)} ms (${fr.frames} frames)`);
      }
    }
    if (engine === "ts") {
      run.wasmCold = await page.evaluate(wasmColdLoad, { wasmUrl: `${server.url}/engine/verticopolis_engine_bg.wasm`, jsUrl: engineUrl });
    }
    await ctx.close();

    // First visit with the service worker allowed: a separate context, so a
    // fresh HTTP cache, counted until the worker is active and the network
    // is idle.
    const sw = await newContext(browser, config, "allow");
    const swPage = await sw.newPage();
    server.take();
    await swPage.goto(url, { waitUntil: "commit" });
    await swPage.waitForFunction(() => Boolean((window as unknown as { game?: unknown }).game), undefined, { timeout: 120_000 });
    const swActive = await swPage
      .evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise<boolean>((ok) => setTimeout(() => ok(false), 30_000))]))
      .catch(() => false);
    await swPage.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => {});
    await swPage.waitForTimeout(1000);
    await swPage.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
    const served = server.take();
    // Then offline: reload with the network cut and see which engine the
    // page comes back on (the precache leaves engine/** out).
    let offlineEngineActive: EngineName | null = null;
    if (swActive) {
      await sw.setOffline(true);
      try {
        await swPage.reload({ waitUntil: "commit" });
        await swPage.waitForFunction(() => Boolean((window as unknown as { game?: unknown }).game), undefined, { timeout: 60_000 });
        await swPage.waitForTimeout(1000);
        offlineEngineActive = (await swPage.evaluate(pageInfo)).engineActive;
      } catch (e) {
        run.pageErrors.push(`offline reload: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        await sw.setOffline(false);
      }
    }
    run.firstVisitWithServiceWorker = { served, swActive, offlineEngineActive };
    server.take();
    await sw.close();
    run.ok = true;
  } catch (e) {
    run.error = e instanceof Error ? e.message : String(e);
    log(`  rep ${rep} ${engine}: FAILED: ${run.error}`);
  } finally {
    await browser?.close();
  }
  return run;
}

export function frameSummary(f: { intervalsMs: number[]; wallMs: number; simMinutes: number; tickMs: number; ticks: number; uiMs: number; engineActive: EngineName }): FrameSummary {
  const s = frameStats(f.intervalsMs);
  return {
    frames: s.frames,
    medianMs: s.medianMs,
    p95Ms: s.p95Ms,
    p99Ms: s.p99Ms,
    meanFps: s.meanFps,
    onePercentLowFps: s.onePercentLowFps,
    simMinutesPerSecond: f.simMinutes / (f.wallMs / 1000),
    tickShare: f.tickMs / f.wallMs,
    uiShare: f.uiMs / f.wallMs,
    ticks: f.ticks,
    engineActive: f.engineActive,
  };
}

/** The process order for a repetition: alternate which engine goes first,
 *  so neither always runs on a machine the other just warmed. */
export function engineOrder(rep: number): EngineName[] {
  return rep % 2 === 0 ? ["ts", "wasm"] : ["wasm", "ts"];
}

export function servedBytes(served: readonly ServedRequest[]): number {
  return served.reduce((s, x) => s + x.bytes, 0);
}
