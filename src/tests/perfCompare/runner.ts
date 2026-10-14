import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "playwright";
import { processTreePss } from "./env";
import { adoptScenario, cpuProbe, digestStashed, installProbes, pageInfo, prepareLiveApp, stashSave, wasmColdLoad, wasmMemoryBytes, type PageInfo } from "./page";
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
 * 3. per scenario and CPU throttle: the simulation-only runs (hosted, then
 *    the bare engine, then on WASM a separate attribution pass);
 * 4. (TypeScript process) the WASM package's load steps, timed apart;
 * 5. the gameplay frames in two fresh-page blocks, audio off (never
 *    started) and audio on, their order alternating by repetition;
 * 6. a cold start under the heaviest throttle in a second fresh context,
 *    with a CPU probe showing the throttle held;
 * 7. a first visit with the service worker allowed, then an offline reload
 *    (a side measurement that cannot fail the repetition).
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
    gcAvailable: r.gcAvailable,
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
    await within(
      `${sc.name} memory ticks`,
      page.evaluate((n) => {
        const g = (window as unknown as { game: { sim: { tick(dt: number): void } } }).game;
        for (let i = 0; i < n; i++) g.sim.tick(2);
      }, 60),
    );
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
    cpuProbe: null,
    scenarios: {},
    wasmCold: null,
    audio: null,
    firstVisitWithServiceWorker: null,
  };
  const engineUrl = `${server.url}/engine/verticopolis_engine.js`;
  const url = `${server.url}/?engine=${engine}`;
  // Errors go to the run, except during the first visit (a side
  // measurement whose offline reload makes the engine package fail to load
  // on purpose); those land on the first-visit record.
  const sink = { side: null as string[] | null };
  const listen = (page: Page): void => {
    const note = (line: string) => (sink.side ?? run.pageErrors).push(line);
    page.on("pageerror", (e) => note(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") note(`console: ${m.text()}`);
    });
  };
  // Every page call is bounded, so a hung engine fails the repetition
  // instead of stalling the benchmark.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ev = <A, R>(page: Page, label: string, fn: (arg: A) => R | Promise<R>, arg: A): Promise<R> => within(label, page.evaluate(fn as any, arg) as Promise<R>);
  const slowRate = Math.max(...config.throttles);
  // The CPU probe under a throttle, kept by "<where>:<rate>".
  const probe = async (page: Page, key: string): Promise<void> => {
    const ms = await ev(page, "cpu probe", cpuProbe, undefined);
    run.cpuProbe = { unthrottledMs: run.cpuProbe?.unthrottledMs ?? NaN, throttledMs: run.cpuProbe?.throttledMs ?? null, rate: slowRate, timed: { ...(run.cpuProbe?.timed ?? {}), [key]: ms } };
  };
  let browser: Browser | null = null;
  try {
    // Autoplay without a gesture, so the audio-on block can start audio the
    // way a player's first click would; --expose-gc so every timed loop
    // starts from a full collection. Both engines get the same flags.
    browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required", "--js-flags=--expose-gc"], ...(opts.executablePath ? { executablePath: opts.executablePath } : {}) });
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
    const unthrottledProbe = await ev(page, "cpu probe", cpuProbe, undefined);
    run.cpuProbe = { unthrottledMs: unthrottledProbe, throttledMs: null, rate: slowRate, timed: {} };
    log(`  rep ${rep} ${engine}: cold ready ${cold.sample.gameReadyMs?.toFixed(0)} ms, warm ready ${warm.sample.gameReadyMs?.toFixed(0)} ms`);

    const memory = await memoryPass(page, cdp, opts, engine, engineUrl);
    await freshPage(page, engine, "timed passes boot");

    // Timed simulation passes. Per scenario and throttle the order is the
    // same on both engines (hosted, then raw); the WASM attribution pass
    // runs after both, so it cannot warm or grow anything they measure.
    for (const sc of scenarios) {
      await ev(page, "stash", stashSave, { name: sc.name, save: sc.save });
      run.scenarios[sc.name] = { ...memory[sc.name], hosted: {}, raw: {}, frames: {}, framesAudio: {} };
      const scenarioRun = run.scenarios[sc.name];
      for (const rate of config.throttles) {
        const t = String(rate);
        const sim = (mode: "hosted" | "raw", attribute: boolean) => ev(page, `${sc.name} ${mode}`, simRun, { name: sc.name, mode, engine, steps: config.steps, warmSteps: config.warmSteps, dt: config.dt, engineUrl, attribute });
        const digest = (key: string) => ev(page, "digest", digestStashed, key);
        await throttle(cdp, rate);
        try {
          // Prove the throttle holds for this scenario's passes.
          if (rate > 1) await probe(page, `${sc.name}:${t}`);
          const hosted = await sim("hosted", false);
          const hostedStart = await digest(hosted.startKey);
          const hostedEnd = await digest(hosted.endKey);
          const raw = await sim("raw", false);
          scenarioRun.raw[t] = stepSummary(raw, await digest(raw.startKey), await digest(raw.endKey));
          let attribution: SimRun["attribution"] = null;
          if (engine === "wasm") {
            // The split, from its own wrapped pass, which must have run the
            // same simulation as the timed one.
            const a = await sim("hosted", true);
            const aStart = await digest(a.startKey);
            const aEnd = await digest(a.endKey);
            attribution = a.attribution;
            if (!attribution || attribution.engineTicks !== config.steps) throw new Error(`${sc.name} ${t}x: the attribution pass saw ${attribution?.engineTicks ?? "no"} engine ticks for ${config.steps} steps`);
            if (a.engineActive !== "wasm" || a.hostErrorsAdded.length || aStart !== hostedStart || aEnd !== hostedEnd) throw new Error(`${sc.name} ${t}x: the attribution pass did not run the timed pass's simulation (${a.engineActive}, errors ${a.hostErrorsAdded.join("; ") || "none"}, ${aStart}/${aEnd} vs ${hostedStart}/${hostedEnd})`);
          }
          scenarioRun.hosted[t] = stepSummary(hosted, hostedStart, hostedEnd, attribution);
        } finally {
          await throttle(cdp, 1);
        }
        await expectEngine(page, engine, `${sc.name} ${t}x`);
        log(`  rep ${rep} ${engine} ${sc.name} ${t}x: hosted ${scenarioRun.hosted[t].totalMs.toFixed(0)} ms, raw ${scenarioRun.raw[t].totalMs.toFixed(0)} ms`);
      }
    }
    // The WASM package's load steps, before any audio runs.
    if (engine === "ts") run.wasmCold = await ev(page, "wasm cold load", wasmColdLoad, { wasmUrl: `${server.url}/engine/verticopolis_engine_bg.wasm`, jsUrl: engineUrl, scenario: scenarios[0].name });

    // Gameplay frames: an audio-off block and an audio-on block, each in a
    // fresh page, their order alternating by repetition so neither always
    // runs in the older process.
    const blocks: ("off" | "on")[] = rep % 2 === 0 ? ["off", "on"] : ["on", "off"];
    for (const block of blocks) {
      await freshPage(page, engine, `frames (audio ${block}) boot`);
      for (const sc of scenarios) await ev(page, "stash", stashSave, { name: sc.name, save: sc.save });
      if ((await ev(page, "audio status", audioStatus, undefined)).started) throw new Error("audio was running in a fresh page");
      if (block === "on") {
        run.audio = await ev(page, "start audio", startAudio, 15_000);
        log(`  rep ${rep} ${engine}: audio ${run.audio.started ? "started" : "DID NOT START"} (contexts: ${run.audio.contexts.join(", ") || "none"})`);
        if (!run.audio.started || !run.audio.contexts.includes("running")) continue;
      }
      for (const sc of scenarios) {
        for (const rate of config.throttles) {
          await ev(page, "adopt", adoptScenario, sc.name);
          await ev(page, "prepare", prepareLiveApp, undefined);
          await throttle(cdp, rate);
          try {
            if (rate > 1 && sc === scenarios[0]) await probe(page, `frames-${block}:${rate}`);
            const f = frameSummary(await ev(page, `${sc.name} frames (audio ${block})`, measureFrames, { windowMs: config.frameWindowMs, warmMs: config.frameWarmMs, speed: config.speed }));
            (block === "on" ? run.scenarios[sc.name].framesAudio : run.scenarios[sc.name].frames)[String(rate)] = f;
            log(`  rep ${rep} ${engine} ${sc.name} ${rate}x audio ${block}: frames median ${f.medianMs.toFixed(1)} ms (${f.frames} frames, ${f.clampedFrames} over ${CLAMP_FRAME_MS} ms, ${f.simMinutesPerSecond.toFixed(1)} sim-min/s)`);
          } finally {
            await throttle(cdp, 1);
          }
        }
      }
      await expectEngine(page, engine, `frames (audio ${block})`);
    }
    await ctx.close();

    // A cold start under the heaviest configured throttle: a fresh context
    // (fresh HTTP cache), throttled before navigation and again at commit,
    // with the CPU probe run under it to show the throttle held.
    if (slowRate > 1) {
      const slow = await newContext(browser, config, "block");
      const slowPage = await slow.newPage();
      listen(slowPage);
      const slowCdp = await slow.newCDPSession(slowPage);
      await throttle(slowCdp, slowRate);
      const c4 = await startup(slowPage, server, async () => {
        await slowPage.goto(url, { waitUntil: "commit" });
        await throttle(slowCdp, slowRate);
      });
      run.cold4x = c4.sample;
      if (c4.sample.engineActive !== engine) throw new Error(`${slowRate}x cold start: requested the ${engine} engine but ${c4.sample.engineActive} is active`);
      run.cpuProbe = { unthrottledMs: unthrottledProbe, throttledMs: await ev(slowPage, "cpu probe", cpuProbe, undefined), rate: slowRate, timed: run.cpuProbe?.timed ?? {} };
      await slow.close();
    }
    run.ok = true;
  } catch (e) {
    run.error = e instanceof Error ? e.message : String(e);
    log(`  rep ${rep} ${engine}: FAILED: ${run.error}`);
  }
  // Auxiliary, after the measurements are final: a first visit with the
  // service worker allowed, then an offline reload. Nothing in it can mark
  // the repetition failed.
  if (run.ok && browser) {
    run.firstVisitWithServiceWorker = await firstVisit(browser, config, server, url, listen, sink).catch((e: unknown) => ({
      served: [],
      swActive: false,
      onlineEngineActive: null,
      offlineEngineActive: null,
      onlinePageErrors: [],
      offlinePageErrors: [],
      error: e instanceof Error ? e.message : String(e),
    }));
    sink.side = null;
  }
  await browser?.close().catch(() => {});
  return run;
}

async function firstVisit(browser: Browser, config: CompareConfig, server: PerfServer, url: string, listen: (p: Page) => void, sink: { side: string[] | null }): Promise<NonNullable<ProcessRun["firstVisitWithServiceWorker"]>> {
  const result: NonNullable<ProcessRun["firstVisitWithServiceWorker"]> = { served: [], swActive: false, onlineEngineActive: null, offlineEngineActive: null, onlinePageErrors: [], offlinePageErrors: [], error: null };
  let sw: BrowserContext | null = null;
  sink.side = result.onlinePageErrors;
  try {
    sw = await newContext(browser, config, "allow");
    const page = await sw.newPage();
    listen(page);
    server.take();
    await page.goto(url, { waitUntil: "commit" });
    await page.waitForFunction(() => Boolean((window as unknown as { game?: unknown }).game), undefined, { timeout: 120_000 });
    result.swActive = await within("service worker", page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise<boolean>((ok) => setTimeout(() => ok(false), 30_000))])), 60_000);
    await page.waitForLoadState("networkidle", { timeout: 120_000 });
    await page.waitForTimeout(1000);
    await page.waitForLoadState("networkidle", { timeout: 60_000 });
    result.served = server.take();
    result.onlineEngineActive = (await within("first visit info", page.evaluate(pageInfo), 60_000)).engineActive;
    if (result.swActive) {
      // Offline: reload with the network cut and see which engine the page
      // comes back on (the precache leaves engine/** out).
      await sw.setOffline(true);
      sink.side = result.offlinePageErrors;
      try {
        await page.reload({ waitUntil: "commit" });
        await page.waitForFunction(() => Boolean((window as unknown as { game?: unknown }).game), undefined, { timeout: 60_000 });
        await page.waitForTimeout(1000);
        result.offlineEngineActive = (await within("offline info", page.evaluate(pageInfo), 60_000)).engineActive;
      } finally {
        await sw.setOffline(false);
      }
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  } finally {
    server.take();
    // Late offline errors land on the offline record until the context is gone.
    await sw?.close().catch(() => {});
    sink.side = null;
  }
  return result;
}

/** The process order for a repetition: alternate which engine goes first,
 *  so neither always runs on a machine the other just warmed. */
export function engineOrder(rep: number): EngineName[] {
  return rep % 2 === 0 ? ["ts", "wasm"] : ["wasm", "ts"];
}
