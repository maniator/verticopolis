import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "playwright";
import { processTreePss } from "../perfCompare/env";
import { adoptScenario, cpuProbe, digestStashed, installProbes, pageInfo, prepareLiveApp, stashSave, watchContextLoss, webglRenderer } from "../perfCompare/page";
import { trackContextLoss } from "../perfCompare/contextLoss";
import type { PerfServer } from "../perfCompare/server";
import type { Scenario } from "../perfCompare/scenarios";
import { frameStats, quantile } from "../perfCompare/stats";
import { simRun } from "../perfCompare/pageSim";
import { launchOptions, type BrowserLaunch } from "../perfCompare/renderer";
import { activeMode, engineMemory, framesRun, hostedRun, type ModeName } from "./pageWorker";

/**
 * One repetition of one engine mode in a fresh browser process, for the
 * worker-host benchmark (`npm run perf:worker`):
 * 1. a cold start, then a warm start (reload);
 * 2. per scenario, in a fresh page: memory after an hour of steps, then per
 *    CPU throttle the hosted simulation (720 steps in frame-sized batches),
 *    then per throttle the gameplay frames with a command every second;
 * 3. a cold start under the heaviest throttle in a fresh context;
 * 4. a first visit with the service worker allowed, then an offline reload.
 * The mode is re-checked after every pass; a pass on any other mode fails
 * the repetition.
 */

export interface WorkerConfig {
  reps: number;
  dt: number;
  steps: number;
  warmSteps: number;
  batch: number;
  memorySteps: number;
  throttles: number[];
  frameWindowMs: number;
  frameWarmMs: number;
  commandEveryMs: number;
  speed: number;
  viewport: { width: number; height: number };
  scenarios: string[];
  modes: ModeName[];
  quick: boolean;
  /** `--aa ts|wasm`: an A/A pass, the same mode in both slots ("ts" and "wasm"). Absent in results written before A/A passes existed. */
  aa?: "ts" | "wasm" | null;
}

export interface Startup {
  mode: ModeName;
  /** Navigation to `window.game`, and to the requested mode holding the
   *  tower (for the worker: the worker loaded it). */
  gameReadyMs: number | null;
  modeReadyMs: number | null;
  firstFrameMs: number | null;
  /** Bytes the server sent before the mode was ready (compressed). */
  bytesBeforeReady: number;
  requestsBeforeReady: number;
  wasmRequests: number;
}

export interface HostedSummary {
  wallMs: number;
  mainMs: number;
  batchMainP50Ms: number;
  batchMainP95Ms: number;
  batchMainMaxMs: number;
  startDigest: string;
  endDigest: string;
  worker: NonNullable<Awaited<ReturnType<typeof hostedRun>>["worker"]> | null;
  hostErrorsAdded: string[];
}

export interface FramesSummary {
  frames: number;
  meanFps: number;
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  onePercentLowFps: number;
  simMinutesPerSecond: number;
  /** Frames over 200 ms, which Excalibur hands 1 ms of game time. */
  clampedFrames: number;
  /** Null when the browser has no long-task timing. */
  longTasks: number | null;
  blockingMs: number | null;
  commands: number;
  commandsUnanswered: number;
  commandToFrameP50Ms: number | null;
  commandToFrameP95Ms: number | null;
  /** The smallest sample, which validation requires to be at least 0. */
  commandToFrameMinMs: number | null;
  worker: { repliesPerSecond: number; messagesPerSecond: number; bytesPerSecond: number; staleReplies: number; merges: number; deltas?: number; deltasRefused?: number; approximateSaves?: number; applyMsPerSecond: number; commandAckP50Ms: number | null; commandAckP95Ms: number | null } | null;
  hostErrorsAdded: string[];
}

export interface MemorySample {
  mainHeapUsedBytes: number;
  workerHeapUsedBytes: number | null;
  mainWasmBytes: number | null;
  workerWasmBytes: number | null;
  processPssBytes: number | null;
}

/** The bare engine (no host, no read model), timed in the TypeScript
 *  process for the TypeScript engine and in the step host's process for the
 *  WASM engine: perf:compare's raw pass, on the same steps as the hosted
 *  runs. */
export interface RawSummary {
  engine: "ts" | "wasm";
  totalMs: number;
  startDigest: string;
  endDigest: string;
}

export interface ScenarioResult {
  memory: MemorySample;
  raw: Record<string, RawSummary>;
  hosted: Record<string, HostedSummary>;
  frames: Record<string, FramesSummary>;
}

export interface ModeRun {
  rep: number;
  /** The slot the run is recorded under: the mode itself, or in an A/A pass ("ts" or "wasm") a label for the first or second slot. */
  mode: ModeName;
  /** The mode this process was asked to run and the page reported holding the tower: `config.aa ?? mode`. Absent in results written before A/A passes existed, where it equals `mode`. */
  ranMode?: ModeName;
  order: number;
  ok: boolean;
  error: string | null;
  pageErrors: string[];
  browserVersion: string | null;
  page: { crossOriginIsolated: boolean; userAgent: string; webgl: { renderer: string; vendor: string } | null } | null;
  /** The renderer read again from a new context after the frames; see ProcessRun.rendererEnd. */
  rendererEnd?: string | null;
  /** The same read after the throttled cold start, kept apart so it cannot hide a change after the frames; absent for a run without a cold start. */
  rendererEndCold?: string | null;
  /** The WebGL contexts lost in the run's pages; see ProcessRun.contextLost. */
  contextLost?: string[];
  cold: Startup | null;
  warm: Startup | null;
  cold4x: Startup | null;
  cpuProbe: { unthrottledMs: number; timed: Record<string, number> } | null;
  scenarios: Record<string, ScenarioResult>;
  offline: { swActive: boolean; onlineMode: ModeName | null; offlineMode: ModeName | null; error: string | null; pageErrors: string[] } | null;
}

const STEP_TIMEOUT_MS = 20 * 60 * 1000;

async function within<T>(what: string, p: Promise<T>, ms = STEP_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<T>((_, fail) => (timer = setTimeout(() => fail(new Error(`${what} timed out after ${ms} ms`)), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

const p = (xs: number[], q: number): number | null => (xs.length ? quantile(xs, q) : null);

export function summarizeHosted(r: Awaited<ReturnType<typeof hostedRun>>, startDigest: string, endDigest: string): HostedSummary {
  return {
    wallMs: r.wallMs,
    mainMs: r.mainMs,
    batchMainP50Ms: quantile(r.batchMainMs, 0.5),
    batchMainP95Ms: quantile(r.batchMainMs, 0.95),
    batchMainMaxMs: quantile(r.batchMainMs, 1),
    startDigest,
    endDigest,
    worker: r.worker,
    hostErrorsAdded: r.hostErrorsAdded,
  };
}

export function summarizeFrames(f: Awaited<ReturnType<typeof framesRun>>): FramesSummary {
  if (f.intervalsMs.length === 0 || f.wallMs <= 0) throw new Error("the frames window drew no frames");
  const s = frameStats(f.intervalsMs);
  const secs = f.wallMs / 1000;
  return {
    frames: s.frames,
    meanFps: s.meanFps,
    medianMs: s.medianMs,
    p95Ms: s.p95Ms,
    p99Ms: s.p99Ms,
    onePercentLowFps: s.onePercentLowFps,
    simMinutesPerSecond: f.simMinutes / secs,
    clampedFrames: f.intervalsMs.filter((x) => x > 200).length,
    longTasks: f.longTasks,
    blockingMs: f.blockingMs,
    commands: f.commandToFrameMs.length,
    commandsUnanswered: f.commandsUnanswered,
    commandToFrameP50Ms: p(f.commandToFrameMs, 0.5),
    commandToFrameP95Ms: p(f.commandToFrameMs, 0.95),
    commandToFrameMinMs: f.commandToFrameMs.length ? Math.min(...f.commandToFrameMs) : null,
    worker: f.worker
      ? {
          repliesPerSecond: f.worker.replies / secs,
          messagesPerSecond: (f.worker.messagesSent + f.worker.messagesReceived) / secs,
          bytesPerSecond: f.worker.bytesReceived / secs,
          staleReplies: f.worker.staleReplies,
          merges: f.worker.merges,
          deltas: f.worker.deltas,
          deltasRefused: f.worker.deltasRefused,
          approximateSaves: f.worker.approximateSaves,
          applyMsPerSecond: f.worker.applyMs / secs,
          commandAckP50Ms: p(f.worker.commandAckMs, 0.5),
          commandAckP95Ms: p(f.worker.commandAckMs, 0.95),
        }
      : null,
    hostErrorsAdded: f.hostErrorsAdded,
  };
}

async function newContext(browser: Browser, config: WorkerConfig, serviceWorkers: "allow" | "block", onLoss: (line: string) => void): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: config.viewport, deviceScaleFactor: 1, serviceWorkers });
  // See perfCompare/runner.ts: esbuild's keepNames helper the page lacks.
  await ctx.addInitScript({ content: "globalThis.__name = (fn) => fn;" });
  await ctx.addInitScript(installProbes);
  await ctx.addInitScript(watchContextLoss);
  await trackContextLoss(ctx, onLoss);
  return ctx;
}

/** Wait for the game, and for the requested mode to hold the tower. Every
 *  mode, TypeScript included, is timed by the same 10 ms poll, so the
 *  startup rows compare like with like. */
async function waitMode(page: Page, mode: ModeName, ms = 120_000): Promise<void> {
  await page.waitForFunction((m) => {
    const w = window as unknown as { game?: unknown; __perfMarks?: Record<string, number>; __vcEngine?: { status: { hosted: boolean; placement?: string }; current(): { loaded?: () => boolean } | null } };
    if (!w.game) return false;
    const h = w.__vcEngine;
    const ready = m === "ts" || (Boolean(h?.status.hosted) && Boolean(h?.current()) && (m !== "wasm-worker" || (h!.status.placement === "worker" && Boolean(h!.current()?.loaded?.()))));
    // The first time the poll sees the mode hold the tower, in page time.
    if (ready && w.__perfMarks && w.__perfMarks.modeReady === undefined) w.__perfMarks.modeReady = performance.now();
    return ready;
  }, mode, { timeout: ms, polling: 10 });
}

async function startup(page: Page, server: PerfServer, mode: ModeName, go: () => Promise<unknown>): Promise<Startup> {
  server.take();
  await go();
  await waitMode(page, mode);
  const before = server.take();
  await page.waitForLoadState("networkidle", { timeout: 120_000 });
  await page.waitForFunction(() => (window as unknown as { __perfMarks?: { firstFrameAfterReady?: number } }).__perfMarks?.firstFrameAfterReady !== undefined, undefined, { timeout: 30_000 }).catch(() => {});
  server.take();
  const marks = await page.evaluate(() => ({ ...((window as unknown as { __perfMarks?: Record<string, number> }).__perfMarks ?? {}) }) as Record<string, number | undefined>);
  // When the 10 ms poll first saw the mode hold the tower (the worker:
  // loaded; TypeScript: the game).
  const modeReadyMs = marks.modeReady ?? null;
  const seen = await page.evaluate(activeMode);
  if (seen !== mode) throw new Error(`requested ${mode} but ${seen} holds the tower`);
  return {
    mode: seen,
    gameReadyMs: marks.gameReady ?? null,
    modeReadyMs,
    firstFrameMs: marks.firstFrameAfterReady ?? null,
    bytesBeforeReady: before.reduce((s, r) => s + r.bytes, 0),
    requestsBeforeReady: before.length,
    wasmRequests: before.filter((r) => r.path.endsWith(".wasm")).length,
  };
}

async function expectMode(page: Page, mode: ModeName, where: string): Promise<void> {
  const seen = await page.evaluate(activeMode);
  if (seen !== mode) throw new Error(`${where}: requested ${mode} but ${seen} holds the tower`);
}

async function freshPage(page: Page, mode: ModeName, where: string): Promise<void> {
  await page.reload({ waitUntil: "commit" });
  await waitMode(page, mode);
  await page.waitForLoadState("networkidle", { timeout: 120_000 });
  await expectMode(page, mode, where);
  await page.evaluate(prepareLiveApp);
}

/** The worker's JS heap, through the browser's DevTools target list: the
 *  page's dedicated workers, attached one by one (non-flat sessions, so a
 *  Playwright browser session can carry them). Null when the protocol
 *  offers no worker target or no answer. */
async function workerHeapBytes(browser: Browser): Promise<number | null> {
  const cdp = await browser.newBrowserCDPSession();
  try {
    const { targetInfos } = (await cdp.send("Target.getTargets")) as { targetInfos: { targetId: string; type: string; url: string }[] };
    const workers = targetInfos.filter((t) => t.type === "worker" && /engineWorker/.test(t.url));
    if (workers.length !== 1) return null;
    const { sessionId } = (await cdp.send("Target.attachToTarget", { targetId: workers[0].targetId, flatten: false })) as { sessionId: string };
    const answer = new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 10_000);
      cdp.on("Target.receivedMessageFromTarget", (e: { sessionId: string; message: string }) => {
        if (e.sessionId !== sessionId) return;
        const m = JSON.parse(e.message) as { id?: number; result?: { usedSize: number } };
        if (m.id !== 2) return;
        clearTimeout(timer);
        resolve(m.result ? m.result.usedSize : null);
      });
    });
    await cdp.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id: 1, method: "HeapProfiler.collectGarbage" }) });
    await cdp.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id: 2, method: "Runtime.getHeapUsage" }) });
    const bytes = await answer;
    await cdp.send("Target.detachFromTarget", { sessionId }).catch(() => {});
    return bytes;
  } catch {
    return null;
  } finally {
    await cdp.detach().catch(() => {});
  }
}

async function throttle(cdp: CDPSession, rate: number): Promise<void> {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
}

export interface RunnerOptions {
  server: PerfServer;
  config: WorkerConfig;
  scenarios: Scenario[];
  executablePath: string | null;
  launch: BrowserLaunch;
  log: (line: string) => void;
}

/** `slot` is the mode the run is recorded under; in an A/A pass (`config.aa`) both slots run the same mode, which is the one every page check and measurement below uses. */
export async function runMode(opts: RunnerOptions, rep: number, slot: ModeName, order: number): Promise<ModeRun> {
  const { server, config, scenarios, log } = opts;
  const mode: ModeName = config.aa ?? slot;
  const run: ModeRun = { rep, mode: slot, ranMode: mode, order, ok: false, error: null, pageErrors: [], browserVersion: null, page: null, cold: null, warm: null, cold4x: null, cpuProbe: null, scenarios: {}, offline: null, contextLost: [] };
  const noteLoss = (line: string): void => {
    run.contextLost?.push(line);
  };
  const url = `${server.url}/?engine=${mode}`;
  const engineUrl = `${server.url}/engine/verticopolis_engine.js`;
  const sink = { side: null as string[] | null };
  const listen = (page: Page): void => {
    const note = (line: string) => (sink.side ?? run.pageErrors).push(line);
    page.on("pageerror", (e) => note(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") note(`console: ${m.text()}`);
    });
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ev = <A, R>(page: Page, label: string, fn: (arg: A) => R | Promise<R>, arg: A): Promise<R> => within(label, page.evaluate(fn as any, arg) as Promise<R>);
  const slowRate = Math.max(...config.throttles);
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch(launchOptions(opts.executablePath, opts.launch));
    run.browserVersion = browser.version();
    const ctx = await newContext(browser, config, "block", noteLoss);
    const page = await ctx.newPage();
    listen(page);
    const cdp = await ctx.newCDPSession(page);
    run.cold = await startup(page, server, mode, () => page.goto(url, { waitUntil: "commit" }));
    const info = await page.evaluate(pageInfo);
    run.page = { crossOriginIsolated: info.crossOriginIsolated, userAgent: info.userAgent, webgl: await ev(page, "renderer", webglRenderer, undefined) };
    run.warm = await startup(page, server, mode, () => page.reload({ waitUntil: "commit" }));
    run.cpuProbe = { unthrottledMs: await ev(page, "cpu probe", cpuProbe, undefined), timed: {} };
    log(`  rep ${rep} ${mode}: cold ready ${run.cold.modeReadyMs?.toFixed(0)} ms, warm ready ${run.warm.modeReadyMs?.toFixed(0)} ms`);

    for (const sc of scenarios) {
      await freshPage(page, mode, `${sc.name} boot`);
      await ev(page, "stash", stashSave, { name: sc.name, save: sc.save });
      // Memory after a few steps on a fresh page.
      await ev(page, `${sc.name} memory steps`, hostedRun, { name: sc.name, steps: config.memorySteps, warmSteps: 0, dt: config.dt, batch: config.batch, stash: false });
      // The harness's stashed saves leave the heap before it is read.
      await ev(page, "drop stash", () => { (window as unknown as { __perfStash?: unknown }).__perfStash = {}; }, undefined);
      await cdp.send("HeapProfiler.collectGarbage");
      const heap = (await cdp.send("Runtime.getHeapUsage")) as { usedSize: number };
      const wasm = await ev(page, "engine memory", engineMemory, undefined);
      const memory: MemorySample = {
        mainHeapUsedBytes: heap.usedSize,
        workerHeapUsedBytes: mode === "wasm-worker" ? await workerHeapBytes(browser) : null,
        mainWasmBytes: wasm.mainWasmBytes,
        workerWasmBytes: wasm.workerWasmBytes,
        processPssBytes: processTreePss(process.pid, /chrom|headless_shell/i)?.bytes ?? null,
      };
      await expectMode(page, mode, `${sc.name} memory`);
      run.scenarios[sc.name] = { memory, raw: {}, hosted: {}, frames: {} };
      const result = run.scenarios[sc.name];
      for (const rate of config.throttles) {
        await throttle(cdp, rate);
        try {
          if (rate > 1) run.cpuProbe.timed[`${sc.name}:${rate}`] = await ev(page, "cpu probe", cpuProbe, undefined);
          const r = await ev(page, `${sc.name} hosted`, hostedRun, { name: sc.name, steps: config.steps, warmSteps: config.warmSteps, dt: config.dt, batch: config.batch, stash: true });
          const start = await ev(page, "digest", digestStashed, r.startKey);
          const end = await ev(page, "digest", digestStashed, r.endKey);
          result.hosted[String(rate)] = summarizeHosted(r, start, end);
          // The bare engine, once per engine (TypeScript in its own process,
          // WASM in the step host's).
          if (mode === "ts" || mode === "wasm") {
            const engine = mode === "ts" ? "ts" : "wasm";
            const raw = await ev(page, `${sc.name} raw`, simRun, { name: sc.name, mode: "raw", engine, steps: config.steps, warmSteps: config.warmSteps, dt: config.dt, engineUrl, attribute: false });
            result.raw[String(rate)] = { engine, totalMs: raw.totalMs, startDigest: await ev(page, "digest", digestStashed, raw.startKey), endDigest: await ev(page, "digest", digestStashed, raw.endKey) };
          }
        } finally {
          await throttle(cdp, 1);
        }
        await expectMode(page, mode, `${sc.name} ${rate}x hosted`);
        log(`  rep ${rep} ${mode} ${sc.name} ${rate}x: hosted wall ${result.hosted[String(rate)].wallMs.toFixed(0)} ms, main ${result.hosted[String(rate)].mainMs.toFixed(0)} ms`);
      }
      for (const rate of config.throttles) {
        await ev(page, "adopt", adoptScenario, sc.name);
        await ev(page, "prepare", prepareLiveApp, undefined);
        await waitMode(page, mode);
        await throttle(cdp, rate);
        try {
          if (rate > 1) run.cpuProbe.timed[`frames-${sc.name}:${rate}`] = await ev(page, "cpu probe", cpuProbe, undefined);
          const f = summarizeFrames(await ev(page, `${sc.name} frames`, framesRun, { windowMs: config.frameWindowMs, warmMs: config.frameWarmMs, speed: config.speed, commandEveryMs: config.commandEveryMs }));
          result.frames[String(rate)] = f;
          log(`  rep ${rep} ${mode} ${sc.name} ${rate}x frames: ${f.meanFps.toFixed(2)} fps mean, ${f.onePercentLowFps.toFixed(2)} 1% low, ${f.simMinutesPerSecond.toFixed(1)} sim-min/s, blocking ${f.blockingMs?.toFixed(0) ?? "n/a"} ms`);
        } finally {
          await throttle(cdp, 1);
        }
        await expectMode(page, mode, `${sc.name} ${rate}x frames`);
      }
    }
    // The adapter again, from a new context, once every frame is measured (and
    // once more after the throttled cold start below when there is one).
    run.rendererEnd = (await ev(page, "renderer after the frames", webglRenderer, undefined))?.renderer ?? null;
    await ctx.close();

    if (slowRate > 1) {
      const slow = await newContext(browser, config, "block", noteLoss);
      const slowPage = await slow.newPage();
      listen(slowPage);
      const slowCdp = await slow.newCDPSession(slowPage);
      await throttle(slowCdp, slowRate);
      run.cold4x = await startup(slowPage, server, mode, async () => {
        await slowPage.goto(url, { waitUntil: "commit" });
        await throttle(slowCdp, slowRate);
      });
      // The throttle held in this context too.
      run.cpuProbe.timed[`cold:${slowRate}`] = await ev(slowPage, "cpu probe", cpuProbe, undefined);
      run.rendererEndCold = (await ev(slowPage, "renderer after the cold start", webglRenderer, undefined))?.renderer ?? null;
      await slow.close();
    }
    run.ok = true;
  } catch (e) {
    run.error = e instanceof Error ? e.message : String(e);
    log(`  rep ${rep} ${mode}: FAILED: ${run.error}`);
  }
  if (run.ok && browser) run.offline = await offline(browser, config, url, mode, listen, sink);
  await browser?.close().catch(() => {});
  return run;
}

/** A first visit with the service worker allowed, then an offline reload:
 *  which mode comes back without the network. A side measurement: nothing
 *  in it fails the repetition. */
async function offline(browser: Browser, config: WorkerConfig, url: string, mode: ModeName, listen: (p: Page) => void, sink: { side: string[] | null }): Promise<NonNullable<ModeRun["offline"]>> {
  const result: NonNullable<ModeRun["offline"]> = { swActive: false, onlineMode: null, offlineMode: null, error: null, pageErrors: [] };
  sink.side = result.pageErrors;
  // The mode a page settles on: the requested one if it comes up within
  // the wait, otherwise whatever holds the tower then.
  const settled = async (page: Page, ms: number): Promise<ModeName> => {
    await page.waitForFunction((m) => {
      const w = window as unknown as { __vcEngine?: { status: { hosted: boolean; placement?: string }; current(): { loaded?: () => boolean } | null } };
      const h = w.__vcEngine;
      return m === "ts" ? true : Boolean(h?.status.hosted && h.current() && (m !== "wasm-worker" || h.current()?.loaded?.()));
    }, mode, { timeout: ms, polling: 50 }).catch(() => {});
    return page.evaluate(activeMode);
  };
  let ctx: BrowserContext | null = null;
  try {
    // A side measurement with no frames in it: a loss here fails nothing.
    ctx = await newContext(browser, config, "allow", () => {});
    const page = await ctx.newPage();
    listen(page);
    await page.goto(url, { waitUntil: "commit" });
    await page.waitForFunction(() => Boolean((window as unknown as { game?: unknown }).game), undefined, { timeout: 120_000 });
    result.swActive = await within("service worker", page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise<boolean>((ok) => setTimeout(() => ok(false), 30_000))])), 60_000);
    await page.waitForLoadState("networkidle", { timeout: 120_000 });
    result.onlineMode = await settled(page, 30_000);
    if (result.swActive) {
      await ctx.setOffline(true);
      try {
        await page.reload({ waitUntil: "commit" });
        await page.waitForFunction(() => Boolean((window as unknown as { game?: unknown }).game), undefined, { timeout: 60_000 });
        result.offlineMode = await settled(page, 30_000);
      } finally {
        await ctx.setOffline(false);
      }
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  } finally {
    await ctx?.close().catch(() => {});
    sink.side = null;
  }
  return result;
}

/** The process order for a repetition: the four modes rotated by one each
 *  repetition, so no mode always runs first or after the same neighbor. */
export function modeOrder(rep: number, modes: readonly ModeName[]): ModeName[] {
  const k = rep % modes.length;
  return [...modes.slice(k), ...modes.slice(0, k)];
}
