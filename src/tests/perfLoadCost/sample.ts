import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { launchOptions, type BrowserLaunch } from "../perfCompare/renderer";

/**
 * One engine load measurement (#985, `docs` in
 * `/release-3.0/offline-985/load-cost-measurement.md`): how long a page takes
 * to reach a hosted WASM engine, and how long its first simulation steps take.
 * The page-side code is self-contained for `addInitScript` / `evaluate`.
 */

export const CONDITIONS = ["L1", "L2", "L3", "L4"] as const;
export type Condition = (typeof CONDITIONS)[number];

export const CONDITION_TEXT: Record<Condition, string> = {
  L1: "cold first visit",
  L2: "repeat boot from the precache",
  L3: "repeat boot, offline",
  L4: "repeat boot after a browser restart",
};

/** The step counts whose elapsed time is reported. */
export const STEP_MARKS = [10, 60, 600] as const;

/** One run's numbers, all in milliseconds from the page's navigation start unless noted. */
export interface LoadSample {
  /** The first publish of a boot state that holds a running WASM engine. */
  readyMs: number;
  /** The engine binary's resource timing (start, end), when the page recorded one. */
  wasmFetchMs: number | null;
  /** Elapsed from the first step to the 10th, 60th and 600th, in STEP_MARKS order. */
  stepsMs: number[];
  /** Long tasks before the first step (count, longest). */
  longTasks: number;
  longestTaskMs: number;
  /** Whether a service worker controlled the page; the cold and uncontrolled runs are L1 only. */
  controlled: boolean;
}

/** Installed before any page script: records when the boot state is published and what it holds, and long tasks.
 *  A string, not a function: the harness is run through tsx, whose name-keeping helper does not exist in the page. */
export const INIT_SCRIPT = `(() => {
  const m = { events: [], longTasks: [] };
  window.__loadCost = m;
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) m.longTasks.push(e.duration); }).observe({ type: "longtask", buffered: true });
  } catch (e) {}
  let held;
  Object.defineProperty(window, "__vcEngineBoot", {
    configurable: true,
    get() { return held; },
    set(v) { held = v; m.events.push({ t: performance.now(), engine: String(v && v.engine), failure: !!(v && v.failure != null) }); },
  });
})();`;

/** In the page, once ready: run the first steps on the live tower and report the elapsed time at each mark. */
export async function stepsInPage(arg: { marks: readonly number[]; dt: number }): Promise<{ stepsMs: number[]; atStepsStartMs: number }> {
  const w = window as unknown as { game: { speed: number; engine: { paused: boolean }; sim: { tick(dt: number): void } } };
  const g = w.game;
  g.speed = 0;
  g.engine.paused = true;
  const atStepsStartMs = performance.now();
  const t0 = atStepsStartMs;
  const out: number[] = [];
  const last = Math.max(...arg.marks);
  for (let i = 1; i <= last; i++) {
    g.sim.tick(arg.dt);
    if (arg.marks.includes(i)) out.push(performance.now() - t0);
  }
  return { stepsMs: out, atStepsStartMs };
}

async function waitHosted(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __vcEngine?: { status: { hosted: boolean } }; game?: unknown };
      return !!w.__vcEngine?.status.hosted && !!w.game;
    },
    undefined,
    { timeout: 120_000, polling: 20 },
  );
}

/** Read the page's numbers once it hosts the engine. */
export async function readSample(page: Page, dt: number): Promise<LoadSample> {
  await waitHosted(page);
  const boot = await page.evaluate(() => {
    const m = (window as unknown as { __loadCost: { events: { t: number; engine: string; failure: boolean }[]; longTasks: number[] } }).__loadCost;
    const ready = m.events.find((e) => e.engine === "wasm" && !e.failure);
    const wasm = performance.getEntriesByType("resource").find((e) => /\.wasm(?:$|\?)/.test(e.name)) as PerformanceResourceTiming | undefined;
    return {
      readyMs: ready ? ready.t : null,
      wasmFetchMs: wasm ? wasm.responseEnd - wasm.startTime : null,
      longTasks: m.longTasks.length,
      longestTaskMs: m.longTasks.length ? Math.max(...m.longTasks) : 0,
      controlled: !!navigator.serviceWorker?.controller,
    };
  });
  if (boot.readyMs === null) throw new Error("the page never published a boot state holding a WASM engine");
  const steps = await page.evaluate(stepsInPage, { marks: STEP_MARKS, dt });
  return { readyMs: boot.readyMs, wasmFetchMs: boot.wasmFetchMs, stepsMs: steps.stepsMs, longTasks: boot.longTasks, longestTaskMs: boot.longestTaskMs, controlled: boot.controlled };
}

/** Wait until the worker is active and the engine glue and binary are in the precache. */
async function waitPrecached(page: Page): Promise<void> {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.waitForFunction(
    async () => {
      const hits = await Promise.all(["engine/verticopolis_engine_bg.wasm", "engine/verticopolis_engine.js"].map((f) => caches.match(new URL(f, document.baseURI).href, { ignoreSearch: true })));
      return hits.every((r) => r?.ok);
    },
    undefined,
    { timeout: 60_000, polling: 100 },
  ).catch(() => {
    throw new Error("the precache never held the engine files");
  });
}

async function throttle(page: Page, rate: number): Promise<void> {
  if (rate === 1) return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
}

export interface RunOptions {
  baseUrl: string;
  executablePath: string | null;
  launch: BrowserLaunch;
  throttle: number;
  dt: number;
  /** A fresh profile folder for L4. */
  profileDir: string;
}

/** Take one sample of a condition in a fresh browser profile. */
export async function takeSample(condition: Condition, shared: Browser, opts: RunOptions): Promise<LoadSample> {
  if (condition === "L4") return restartedSample(opts);
  const context = await shared.newContext({ baseURL: opts.baseUrl });
  try {
    return await sampleIn(context, condition, opts);
  } finally {
    await context.close();
  }
}

async function sampleIn(context: BrowserContext, condition: Condition, opts: RunOptions): Promise<LoadSample> {
  await context.addInitScript(INIT_SCRIPT);
  const page = await context.newPage();
  await throttle(page, opts.throttle);
  await page.goto("/", { waitUntil: "commit" });
  if (condition === "L1") return readSample(page, opts.dt);
  await waitHosted(page);
  await waitPrecached(page);
  if (condition === "L3") await context.setOffline(true);
  await page.reload({ waitUntil: "commit" });
  const sample = await readSample(page, opts.dt);
  if (!sample.controlled) throw new Error(`${condition}: the repeat boot was not controlled by the service worker`);
  return sample;
}

async function restartedSample(opts: RunOptions): Promise<LoadSample> {
  const open = () => chromium.launchPersistentContext(opts.profileDir, { ...launchOptions(opts.executablePath, opts.launch), baseURL: opts.baseUrl });
  const first = await open();
  try {
    await first.addInitScript(INIT_SCRIPT);
    const page = await first.newPage();
    await page.goto("/");
    await waitHosted(page);
    await waitPrecached(page);
  } finally {
    await first.close();
  }
  const second = await open();
  try {
    await second.addInitScript(INIT_SCRIPT);
    const page = await second.newPage();
    await throttle(page, opts.throttle);
    await page.goto("/", { waitUntil: "commit" });
    const sample = await readSample(page, opts.dt);
    if (!sample.controlled) throw new Error("L4: the boot after the restart was not controlled by the service worker");
    return sample;
  } finally {
    await second.close();
  }
}
