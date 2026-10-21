/**
 * Browser-side measurement functions of the worker-host benchmark
 * (`npm run perf:worker`). Self-contained for `page.evaluate`, like
 * `perfCompare/page.ts`: no module-scope references, helpers declared
 * inside. They read the `window.game` handle a VC_TOOLING=1 build publishes
 * and the `window.__vcEngine` handle every WASM host publishes.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ModeName = "ts" | "wasm" | "wasm-frame" | "wasm-worker";

/** Which engine host the live tower runs on, read from the hosts
 *  themselves: the TypeScript engine, the step host, the coalesced host
 *  (its `sync` reads "frame") or the worker host. "ts" also when a host
 *  holds no tower or reported an error. */
export function activeMode(): ModeName {
  const w = window as any;
  const h = w.__vcEngine;
  const sim = w.game?.sim;
  if (!h?.status?.hosted || (h.status.errors ?? []).length > 0 || !h.current?.() || !sim || !Object.prototype.hasOwnProperty.call(sim, "serialize")) return "ts";
  if (h.status.placement === "worker") return h.current().loaded() ? "wasm-worker" : "ts";
  const sync = h.current().sync;
  if (sync === "frame") return "wasm-frame";
  return sync === "step" ? "wasm" : "ts";
}

export interface HostedRun {
  steps: number;
  /** Wall time from the first step to the last reply applied. */
  wallMs: number;
  /** Main-thread time: the steps and flushes, plus (worker) the time spent
   *  applying the replies in message handlers. */
  mainMs: number;
  /** The same per batch of steps (a frame's worth), the batch's replies
   *  included. */
  batchMainMs: number[];
  /** Worker host only: its counters over the timed steps (the settle that
   *  fetches the exact end save comes after and is not counted). */
  worker: { replies: number; staleReplies: number; merges: number; messagesSent: number; messagesReceived: number; bytesReceived: number; frameBytes: number; mergeBytes: number; applyMs: number; mergeMs: number; workerOpsMs: number; workerReplyMs: number } | null;
  startKey: string;
  endKey: string;
  hostErrorsAdded: string[];
}

/**
 * The hosted simulation, as the frame loop drives it, without rendering:
 * load the stashed save through `adoptSim`, then run `steps` steps of `dt`
 * minutes in batches of `batch` (the frame loop's cap of four), with the
 * frame loop's flush after each batch. The worker host's batch waits for
 * the worker's reply before the next one, as the frame loop's gate makes it
 * wait; the wait is idle wall time (the page is woken by the reply, not
 * polling), and the reply's apply is main-thread time. A warm-up run on a
 * throwaway load comes first. The start and end saves are stashed for the
 * digest: the end save is the engine's exact one (the worker host settles
 * after the timed steps).
 */
export async function hostedRun(arg: { name: string; steps: number; warmSteps: number; dt: number; batch: number; stash: boolean }): Promise<HostedRun> {
  const w = window as any;
  const g = w.game;
  w.__perfStash = w.__perfStash ?? {};
  const host = () => w.__vcEngine;
  const errorsNow = (): string[] => [...((host()?.status?.errors ?? []) as string[])];
  const isWorker = () => host()?.status?.placement === "worker";
  // Woken by the host's own reply handling: the controller routes every
  // worker message through `current().receive`, which this wraps for the
  // run, so the wait costs no main-thread time.
  const wake = (h: any, until: () => boolean, what: string, ms: number): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      if (until()) return resolve();
      const own = Object.getOwnPropertyDescriptor(h, "receive");
      const receive = h.receive;
      const done = (e?: Error) => {
        clearTimeout(timer);
        if (own) Object.defineProperty(h, "receive", own);
        else delete h.receive;
        if (e) reject(e);
        else resolve();
      };
      const timer = setTimeout(() => done(new Error(`${arg.name}: ${what} within ${ms} ms`)), ms);
      h.receive = function (this: unknown, m: unknown) {
        receive.call(h, m);
        if (!host().status.hosted) done(new Error(`${arg.name}: the worker host let the tower go (${errorsNow().join("; ")})`));
        else if (until()) done();
      };
    });
  const adopt = async () => {
    g.adoptSim(g.sim.constructor.deserialize(JSON.parse(w.__perfSaves[arg.name])));
    g.speed = 0;
    g.engine.paused = true;
    const h = host()?.current?.();
    if (isWorker()) await wake(h, () => h.loaded(), "the worker did not load the tower", 60_000);
    return g.sim;
  };
  const run = async (sim: any, steps: number, perBatch?: number[]) => {
    const h = host()?.current?.();
    let main = 0;
    for (let i = 0; i < steps; ) {
      const t = performance.now();
      const n = Math.min(arg.batch, steps - i);
      for (let k = 0; k < n; k++) sim.tick(arg.dt);
      i += n;
      // The frame loop's flush (a no-op on the step host and on TypeScript).
      h?.flush?.();
      let ms = performance.now() - t;
      if (isWorker()) {
        const apply = h.stats.applyMs;
        const replies = h.stats.replies;
        // A batch is answered by a fresh reply (a stale one is followed by
        // a request of its own, which the gate waits for too).
        await wake(h, () => h.stats.replies > replies && h.idle(), "no worker reply", 120_000);
        ms += h.stats.applyMs - apply;
      }
      main += ms;
      perBatch?.push(ms);
    }
    return main;
  };
  // No rendering during the hosted runs, in every mode: the renderer's
  // frames would sit between the worker host's replies (a reply waits for
  // the main thread) where the synchronous hosts never yield to one. The
  // frames pass measures the two together.
  const clock = g.engine.engine.clock;
  clock.stop();
  try {
    // Warm-up on a throwaway load.
    if (arg.warmSteps > 0) await run(await adopt(), arg.warmSteps);
    const sim = await adopt();
    const errorsAtStart = errorsNow().length;
    const tag = `${arg.name}:hosted:${performance.now()}`;
    if (arg.stash) w.__perfStash[`${tag}:start`] = JSON.stringify(sim.serialize());
    const h = host()?.current?.();
    const before = h?.stats ? { ...h.stats } : null;
    (globalThis as any).gc?.();
    const batchMainMs: number[] = [];
    const t0 = performance.now();
    const mainMs = await run(sim, arg.steps, batchMainMs);
    const wallMs = performance.now() - t0;
    const after = h?.stats ? { ...h.stats } : null;
    if (isWorker()) await h.settle();
    if (arg.stash) w.__perfStash[`${tag}:end`] = JSON.stringify(sim.serialize());
    const d = (k: string) => (after![k] as number) - (before as any)[k];
    return {
      steps: arg.steps,
      wallMs,
      mainMs,
      batchMainMs,
      worker: isWorker() && before ? { replies: d("replies"), staleReplies: d("staleReplies"), merges: d("merges"), messagesSent: d("messagesSent"), messagesReceived: d("messagesReceived"), bytesReceived: d("bytesReceived"), frameBytes: d("frameBytes"), mergeBytes: d("mergeBytes"), applyMs: d("applyMs"), mergeMs: d("mergeMs"), workerOpsMs: d("workerOpsMs"), workerReplyMs: d("workerReplyMs") } : null,
      startKey: `${tag}:start`,
      endKey: `${tag}:end`,
      hostErrorsAdded: errorsNow().slice(errorsAtStart),
    };
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
  worker: { replies: number; staleReplies: number; merges: number; messagesSent: number; messagesReceived: number; bytesReceived: number; applyMs: number; commandAckMs: number[] } | null;
  hostErrorsAdded: string[];
}

/**
 * Gameplay frames: the real frame loop at `speed` (steady clock, choices
 * declined, autosave off), sampled by rAF for `windowMs` after `warmMs`,
 * with a long-task observer on the main thread and a player command every
 * `commandEveryMs` (a tower rename, which every host relays and which
 * changes nothing the simulation reads). On the worker host a command is
 * answered when a reply includes its own sequence number.
 */
export function framesRun(arg: { windowMs: number; warmMs: number; speed: number; commandEveryMs: number }): Promise<FramesRun> {
  const w = window as any;
  const g = w.game;
  const sim = g.sim;
  const host = w.__vcEngine;
  const h = host?.current?.();
  const worker = host?.status?.placement === "worker";
  const errorsAtStart = ((host?.status?.errors ?? []) as string[]).length;
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
    let before: any = null;
    let pending: { t: number; seq: number } | null = null;
    let commands = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    const begin = performance.now();
    // The newest `k` of a bounded sample list (none when k is 0).
    const lastSamples = (xs: number[], k: number): number[] => (k > 0 ? xs.slice(-Math.min(k, xs.length)) : []);
    const done = (): void => {
      clearInterval(timer);
      g.speed = 0;
      g.engine.paused = true;
      const after = h?.stats;
      const d = (k: string) => (after[k] as number) - before[k];
      // Long tasks are delivered after they end: take the queued ones, and
      // keep those that started inside the window.
      for (const e of obs.takeRecords()) longs.push({ start: e.startTime, duration: e.duration });
      obs.disconnect();
      const inWindow = longs.filter((e) => e.start >= start && e.start < last);
      resolve({
        intervalsMs: intervals,
        wallMs: last - start,
        simMinutes: sim.clock.minutes - startMinutes,
        longTasks: longTasks ? inWindow.length : null,
        longTaskMs: longTasks ? inWindow.reduce((s, x) => s + x.duration, 0) : null,
        blockingMs: longTasks ? inWindow.reduce((s, x) => s + Math.max(0, x.duration - 50), 0) : null,
        commandToFrameMs,
        commandsUnanswered: pending ? 1 : 0,
        worker: worker && before ? { replies: d("replies"), staleReplies: d("staleReplies"), merges: d("merges"), messagesSent: d("messagesSent"), messagesReceived: d("messagesReceived"), bytesReceived: d("bytesReceived"), applyMs: d("applyMs"), commandAckMs: lastSamples(after.commandAckMs as number[], after.commandsAcked - before.commandsAcked) } : null,
        hostErrorsAdded: ((host?.status?.errors ?? []) as string[]).slice(errorsAtStart),
      });
    };
    const issue = (): void => {
      if (pending) return; // one command at a time, so each is timed alone
      const t = performance.now();
      sim.tower.towerName = `Perf ${++commands}`;
      // The main-thread hosts answer in the call; the worker host once a
      // reply includes this command's seq.
      pending = { t, seq: worker ? h.stats.lastCommandSeq : 0 };
    };
    const frame = (ts: number): void => {
      if (start === 0) {
        if (ts - begin >= arg.warmMs) {
          start = ts;
          last = ts;
          startMinutes = sim.clock.minutes;
          before = h?.stats ? { ...h.stats } : null;
          timer = setInterval(issue, arg.commandEveryMs);
        }
        requestAnimationFrame(frame);
        return;
      }
      intervals.push(ts - last);
      last = ts;
      if (pending && (!worker || h.stats.ackedSeq >= pending.seq)) {
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

/** Memory of the hosted tower: the main thread's WASM linear memory
 *  (main-thread hosts, read from the instance the probe kept) or the worker's
 *  (the worker host's last reply). The JS heaps and the process PSS come
 *  from the runner (which drops the harness's stashed saves before it reads the heap). It also drops them here, so
 *  they are not counted as the game's. */
export function engineMemory(): { mainWasmBytes: number | null; workerWasmBytes: number | null } {
  const w = window as any;
  w.__perfStash = {};
  const h = w.__vcEngine;
  if (!h?.status?.hosted) return { mainWasmBytes: null, workerWasmBytes: null };
  if (h.status.placement === "worker") return { mainWasmBytes: null, workerWasmBytes: h.current().stats.workerMemoryBytes ?? null };
  const memory = w.__perfWasmMemory as WebAssembly.Memory | undefined;
  if (!memory) throw new Error("the WASM memory read found no instance the app booted");
  return { mainWasmBytes: memory.buffer.byteLength, workerWasmBytes: null };
}
