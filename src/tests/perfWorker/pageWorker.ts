/**
 * Browser-side measurement functions of the worker-host benchmark
 * (`npm run perf:worker`). Self-contained for `page.evaluate`, like
 * `perfCompare/page.ts`: no module-scope references, helpers declared
 * inside. They read the `window.game` handle a VC_TOOLING=1 build publishes
 * and the `window.__vcEngine` handle boot publishes when the Rust engine runs
 * the game.
 *
 * The Rust engine is the game's engine port (PR 5e), so the old hosts are
 * gone: `wasm-frame` and `wasm-worker` boot the same engine as `wasm`, and a
 * run asks for `ts` and `wasm` only. The names stay in `ModeName` so the
 * analysis reads the runs committed before the cutover.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ModeName = "ts" | "wasm" | "wasm-frame" | "wasm-worker";

/** Which engine the live tower runs on: "wasm" when the app's engine port
 *  is the Rust engine boot published, "ts" otherwise. */
export function activeMode(): ModeName {
  const w = window as any;
  const h = w.__vcEngine;
  return h?.status?.hosted && h.port && w.game?.enginePort === h.port ? "wasm" : "ts";
}

export interface HostedRun {
  steps: number;
  /** Wall time from the first step to the last view read. */
  wallMs: number;
  /** Main-thread time: the steps and the view reads. Every engine runs on
   *  the main thread now, so this matches `wallMs` up to the loop itself;
   *  the worker host's runs before PR 5e also counted its replies here. */
  mainMs: number;
  /** The same per batch of steps (a frame's worth), its view read included. */
  batchMainMs: number[];
  /** The worker host's counters over the timed steps, in runs before PR 5e;
   *  null now that there is no worker host. */
  worker: { replies: number; staleReplies: number; merges: number; messagesSent: number; messagesReceived: number; bytesReceived: number; frameBytes: number; mergeBytes: number; applyMs: number; mergeMs: number; workerOpsMs: number; workerReplyMs: number; deltas?: number; deltaBytes?: number; deltaMs?: number; workerSaveMs?: number; deltasRefused?: number; approximateSaves?: number } | null;
  startKey: string;
  endKey: string;
  hostErrorsAdded: string[];
}

/**
 * The hosted simulation, as the frame loop drives it, without rendering:
 * load the stashed save the way a player's load does (its stamped copy, see
 * `stashSave`, through the engine port's
 * stored source, then the app follows the swap), then run `steps` steps of
 * `dt` minutes through the port in batches of `batch` (the frame loop's cap
 * of four), with the frame's view read after each batch. A warm-up run on a
 * throwaway load comes first. The start and end saves are stashed for the
 * digest.
 */
export async function hostedRun(arg: { name: string; steps: number; warmSteps: number; dt: number; batch: number; stash: boolean }): Promise<HostedRun> {
  const w = window as any;
  const g = w.game;
  w.__perfStash = w.__perfStash ?? {};
  const adopt = () => {
    if (g.enginePort.loadSave(w.__perfStoredSaves[arg.name])[0] !== 1) throw new Error(`${arg.name}: the engine refused the scenario's save`);
    g.followSwap();
    g.speed = 0;
    g.engine.paused = true;
    return g.enginePort;
  };
  const run = (port: any, steps: number, perBatch?: number[]) => {
    let main = 0;
    for (let i = 0; i < steps; ) {
      const t = performance.now();
      const n = Math.min(arg.batch, steps - i);
      for (let k = 0; k < n; k++) port.tick(arg.dt);
      i += n;
      // The frame's view read, as the frame loop makes it after its steps.
      g.reader.update();
      const ms = performance.now() - t;
      main += ms;
      perBatch?.push(ms);
    }
    return main;
  };
  // No rendering during the hosted runs: the frames pass measures the
  // renderer and the steps together.
  const clock = g.engine.engine.clock;
  clock.stop();
  try {
    // Warm-up on a throwaway load.
    if (arg.warmSteps > 0) run(adopt(), arg.warmSteps);
    const port = adopt();
    const tag = `${arg.name}:hosted:${performance.now()}`;
    if (arg.stash) w.__perfStash[`${tag}:start`] = port.serialize();
    (globalThis as any).gc?.();
    const batchMainMs: number[] = [];
    const t0 = performance.now();
    const mainMs = run(port, arg.steps, batchMainMs);
    const wallMs = performance.now() - t0;
    if (arg.stash) w.__perfStash[`${tag}:end`] = port.serialize();
    return { steps: arg.steps, wallMs, mainMs, batchMainMs, worker: null, startKey: `${tag}:start`, endKey: `${tag}:end`, hostErrorsAdded: [] };
  } finally {
    clock.start();
  }
}

export interface FramesRun {
  intervalsMs: number[];
  wallMs: number;
  simMinutes: number;
  /** Long tasks (over 50 ms) on the main thread during the window; null
   *  when this browser has no long-task timing. */
  longTasks: number | null;
  longTaskMs: number | null;
  /** Sum over long tasks of the part past 50 ms. */
  blockingMs: number | null;
  /** Command to the clock inside the first frame callback after the
   *  engine's answer is in the read model, ms, one per command answered in
   *  the window, and the commands still unanswered when it closed. */
  commandToFrameMs: number[];
  commandsUnanswered: number;
  /** Worker host: the counters over the window. */
  worker: { replies: number; staleReplies: number; merges: number; messagesSent: number; messagesReceived: number; bytesReceived: number; applyMs: number; commandAckMs: number[]; deltas?: number; deltasRefused?: number; approximateSaves?: number } | null;
  hostErrorsAdded: string[];
}

/**
 * Gameplay frames: the real frame loop at `speed` (steady clock, choices
 * declined, autosave off), sampled by rAF for `windowMs` after `warmMs`,
 * with a long-task observer on the main thread and a player command every
 * `commandEveryMs` (a tower rename through the engine port, which changes
 * nothing the simulation reads). The engine answers in the call, so a
 * command is timed to the first frame after it.
 */
export function framesRun(arg: { windowMs: number; warmMs: number; speed: number; commandEveryMs: number }): Promise<FramesRun> {
  const w = window as any;
  const g = w.game;
  const port = g.enginePort;
  const minutesNow = (): number => g.reader.header.minutes;
  const longs: { start: number; duration: number }[] = [];
  let longTasks = true;
  const obs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) longs.push({ start: e.startTime, duration: e.duration });
  });
  try {
    obs.observe({ type: "longtask", buffered: false });
  } catch {
    longTasks = false;
  }
  (globalThis as any).gc?.();
  g.speed = arg.speed;
  g.engine.paused = false;
  return new Promise<FramesRun>((resolve) => {
    const intervals: number[] = [];
    const commandToFrameMs: number[] = [];
    let start = 0;
    let startMinutes = 0;
    let last = 0;
    let pending: { t: number } | null = null;
    let commands = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    const begin = performance.now();
    const done = (): void => {
      clearInterval(timer);
      g.speed = 0;
      g.engine.paused = true;
      // Long tasks are delivered after they end: take the queued ones, and
      // keep those that started inside the window.
      for (const e of obs.takeRecords()) longs.push({ start: e.startTime, duration: e.duration });
      obs.disconnect();
      const inWindow = longs.filter((e) => e.start >= start && e.start < last);
      resolve({
        intervalsMs: intervals,
        wallMs: last - start,
        simMinutes: minutesNow() - startMinutes,
        longTasks: longTasks ? inWindow.length : null,
        longTaskMs: longTasks ? inWindow.reduce((s, x) => s + x.duration, 0) : null,
        blockingMs: longTasks ? inWindow.reduce((s, x) => s + Math.max(0, x.duration - 50), 0) : null,
        commandToFrameMs,
        commandsUnanswered: pending ? 1 : 0,
        worker: null,
        hostErrorsAdded: [],
      });
    };
    const issue = (): void => {
      if (pending) return; // one command at a time, so each is timed alone
      const t = performance.now();
      // The engine answers in the call; the next frame shows it.
      port.nameTower(`Perf ${++commands}`);
      pending = { t };
    };
    const frame = (ts: number): void => {
      if (start === 0) {
        if (ts - begin >= arg.warmMs) {
          start = ts;
          last = ts;
          startMinutes = minutesNow();
          timer = setInterval(issue, arg.commandEveryMs);
        }
        requestAnimationFrame(frame);
        return;
      }
      intervals.push(ts - last);
      last = ts;
      if (pending) {
        // The clock now, inside the callback: `ts` is when the frame
        // began, which can come before a command issued in the same frame.
        commandToFrameMs.push(performance.now() - pending.t);
        pending = null;
      }
      if (ts - start >= arg.windowMs) done();
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

/** Memory of the hosted tower: the main thread's WASM linear memory, read
 *  from the instance the probe kept (the worker host's runs before PR 5e
 *  reported the worker's here). The JS heaps and the process PSS come
 *  from the runner (which drops the harness's stashed saves before it reads the heap). It also drops them here, so
 *  they are not counted as the game's. */
export function engineMemory(): { mainWasmBytes: number | null; workerWasmBytes: number | null } {
  const w = window as any;
  w.__perfStash = {};
  const h = w.__vcEngine;
  if (!h?.status?.hosted) return { mainWasmBytes: null, workerWasmBytes: null };
  const memory = w.__perfWasmMemory as WebAssembly.Memory | undefined;
  if (!memory) throw new Error("the WASM memory read found no instance the app booted");
  return { mainWasmBytes: memory.buffer.byteLength, workerWasmBytes: null };
}
