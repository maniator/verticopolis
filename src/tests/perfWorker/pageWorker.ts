/**
 * Browser-side measurement functions of the worker-host benchmark
 * (`npm run perf:worker`). Self-contained for `page.evaluate`, like
 * `perfCompare/page.ts`: no module-scope references, helpers declared
 * inside. They read the `window.game` handle a VC_TOOLING=1 build publishes
 * and the `window.__vcEngine` handle every WASM host publishes.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ModeName = "ts" | "wasm" | "wasm-frame" | "wasm-worker";

/** Which engine host the live tower runs on, read from the page: the
 *  TypeScript engine, the step host, the coalesced host or the worker host.
 *  "ts" also when a requested host holds no tower or reported an error. */
export function activeMode(): ModeName {
  const w = window as any;
  const h = w.__vcEngine;
  const sim = w.game?.sim;
  if (!h?.status?.hosted || (h.status.errors ?? []).length > 0 || !h.current?.() || !sim || !Object.prototype.hasOwnProperty.call(sim, "serialize")) return "ts";
  if (h.status.placement === "worker") return h.current().loaded() ? "wasm-worker" : "ts";
  // The coalesced host registers a step gate; the step host does not. The
  // gate is not reachable from the page, so the URL that booted it says.
  return new URLSearchParams(location.search).get("engine") === "wasm-frame" ? "wasm-frame" : "wasm";
}

export interface HostedRun {
  steps: number;
  /** Wall time from the first step to the last reply applied. */
  wallMs: number;
  /** Main-thread time: the steps and flushes, plus (worker) the time spent
   *  applying replies in message handlers. */
  mainMs: number;
  /** Main-thread time per batch of steps (a frame's worth). */
  batchMainMs: number[];
  /** Worker host only: its counters over the run. */
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
 * wait; the wait is wall time, not main-thread time. A warm-up run on a
 * throwaway load comes first. The start and end saves are stashed for the
 * digest: the end save is the engine's exact one (the worker host settles
 * first).
 */
export async function hostedRun(arg: { name: string; steps: number; warmSteps: number; dt: number; batch: number }): Promise<HostedRun> {
  const w = window as any;
  const g = w.game;
  w.__perfStash = w.__perfStash ?? {};
  const host = () => w.__vcEngine;
  const errorsNow = (): string[] => [...((host()?.status?.errors ?? []) as string[])];
  // An uncapped yield: a message to a channel of our own runs in the next
  // task without the nested-timer clamp setTimeout(0) gets.
  const ch = new MessageChannel();
  const waiters: (() => void)[] = [];
  ch.port1.onmessage = () => waiters.shift()?.();
  const yieldTask = () => new Promise<void>((r) => { waiters.push(r); ch.port2.postMessage(0); });
  const adopt = async () => {
    g.adoptSim(g.sim.constructor.deserialize(JSON.parse(w.__perfSaves[arg.name])));
    g.speed = 0;
    g.engine.paused = true;
    const h = host();
    if (h?.status?.placement === "worker") {
      const until = performance.now() + 60_000;
      while (!h.current()?.loaded()) {
        if (performance.now() > until || !h.status.hosted) throw new Error(`${arg.name}: the worker did not load the tower`);
        await yieldTask();
      }
    }
    return g.sim;
  };
  const isWorker = () => host()?.status?.placement === "worker";
  const run = async (sim: any, steps: number, perBatch?: number[]) => {
    const h = host()?.current?.();
    const gateWait = async () => {
      if (!isWorker()) return;
      const until = performance.now() + 120_000;
      // The gate holds while a reply is out; it is the stats' replies count here.
      const want = h.stats.replies + 1;
      while (h.stats.replies < want) {
        if (performance.now() > until || !host().status.hosted) throw new Error(`${arg.name}: no worker reply`);
        await yieldTask();
      }
    };
    let main = 0;
    for (let i = 0; i < steps; ) {
      const t = performance.now();
      const n = Math.min(arg.batch, steps - i);
      for (let k = 0; k < n; k++) sim.tick(arg.dt);
      i += n;
      // The frame loop's flush (a no-op on the step host and on TypeScript).
      host()?.current?.()?.flush?.();
      const ms = performance.now() - t;
      main += ms;
      perBatch?.push(ms);
      await gateWait();
    }
    return main;
  };
  // Warm-up on a throwaway load.
  await run(await adopt(), arg.warmSteps);
  const sim = await adopt();
  const errorsAtStart = errorsNow().length;
  const tag = `${arg.name}:hosted:${performance.now()}`;
  w.__perfStash[`${tag}:start`] = JSON.stringify(sim.serialize());
  const h = host()?.current?.();
  const before = h?.stats ? { ...h.stats } : null;
  (globalThis as any).gc?.();
  const batchMainMs: number[] = [];
  const t0 = performance.now();
  let mainMs = await run(sim, arg.steps, batchMainMs);
  const wallMs = performance.now() - t0;
  if (isWorker()) {
    await h.settle();
    mainMs += h.stats.applyMs - before!.applyMs;
  }
  w.__perfStash[`${tag}:end`] = sim.serialize();
  const after = h?.stats;
  const d = (k: string) => (after[k] as number) - (before as any)[k];
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
}

export interface FramesRun {
  intervalsMs: number[];
  wallMs: number;
  simMinutes: number;
  /** Long tasks (over 50 ms) on the main thread during the window. */
  longTasks: number;
  longTaskMs: number;
  /** Sum over long tasks of the part past 50 ms. */
  blockingMs: number;
  /** Command to the first frame drawn after the engine's answer is in the
   *  read model, ms, one per command issued in the window. */
  commandToFrameMs: number[];
  /** Worker host: the counters over the window. */
  worker: { replies: number; staleReplies: number; merges: number; messagesSent: number; messagesReceived: number; bytesReceived: number; applyMs: number; commandAckMs: number[] } | null;
  hostErrorsAdded: string[];
}

/**
 * Gameplay frames: the real frame loop at `speed` (steady clock, choices
 * declined, autosave off), sampled by rAF for `windowMs` after `warmMs`,
 * with a long-task observer on the main thread and a player command every
 * `commandEveryMs` (a tower rename, which every host relays and which
 * changes nothing the simulation reads).
 */
export function framesRun(arg: { windowMs: number; warmMs: number; speed: number; commandEveryMs: number }): Promise<FramesRun> {
  const w = window as any;
  const g = w.game;
  const sim = g.sim;
  const host = w.__vcEngine;
  const h = host?.current?.();
  const worker = host?.status?.placement === "worker";
  const errorsAtStart = ((host?.status?.errors ?? []) as string[]).length;
  const longs: number[] = [];
  let on = false;
  const obs = new PerformanceObserver((list) => {
    if (!on) return;
    for (const e of list.getEntries()) longs.push(e.duration);
  });
  try {
    obs.observe({ type: "longtask", buffered: false });
  } catch {
    /* no long-task timing here: the run reports none */
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
    let pending: { t: number; acked: number } | null = null;
    let commands = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    const begin = performance.now();
    const done = (): void => {
      clearInterval(timer);
      on = false;
      obs.disconnect();
      g.speed = 0;
      g.engine.paused = true;
      const after = h?.stats;
      const d = (k: string) => (after[k] as number) - before[k];
      resolve({
        intervalsMs: intervals,
        wallMs: last - start,
        simMinutes: sim.clock.minutes - startMinutes,
        longTasks: longs.length,
        longTaskMs: longs.reduce((s, x) => s + x, 0),
        blockingMs: longs.reduce((s, x) => s + Math.max(0, x - 50), 0),
        commandToFrameMs,
        worker: worker && before ? { replies: d("replies"), staleReplies: d("staleReplies"), merges: d("merges"), messagesSent: d("messagesSent"), messagesReceived: d("messagesReceived"), bytesReceived: d("bytesReceived"), applyMs: d("applyMs"), commandAckMs: (after.commandAckMs as number[]).slice(before.commandAckMs.length) } : null,
        hostErrorsAdded: ((host?.status?.errors ?? []) as string[]).slice(errorsAtStart),
      });
    };
    const issue = (): void => {
      if (pending) return; // one command at a time, so each is timed alone
      const t = performance.now();
      sim.tower.towerName = `Perf ${++commands}`;
      // The main-thread hosts answer in the call; the worker host once a
      // reply that includes the command is applied.
      pending = { t, acked: worker ? (h.stats.commandsAcked as number) + 1 : 0 };
    };
    const frame = (ts: number): void => {
      if (start === 0) {
        if (ts - begin >= arg.warmMs) {
          start = ts;
          last = ts;
          startMinutes = sim.clock.minutes;
          before = h?.stats ? { ...h.stats, commandAckMs: [...h.stats.commandAckMs], commandVisibleMs: [...h.stats.commandVisibleMs] } : null;
          on = true;
          timer = setInterval(issue, arg.commandEveryMs);
        }
        requestAnimationFrame(frame);
        return;
      }
      intervals.push(ts - last);
      last = ts;
      if (pending) {
        if (!worker || h.stats.commandsAcked >= pending.acked) {
          commandToFrameMs.push(ts - pending.t);
          pending = null;
        }
      }
      if (ts - start >= arg.windowMs) done();
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

/** Memory of the hosted tower after `steps` steps: the main thread's WASM
 *  linear memory (main-thread hosts, read through the app's own module) or
 *  the worker's (the worker host's last reply). The JS heaps and the
 *  process PSS come from the runner. */
export async function engineMemory(arg: { engineUrl: string }): Promise<{ mainWasmBytes: number | null; workerWasmBytes: number | null }> {
  const w = window as any;
  const h = w.__vcEngine;
  if (!h?.status?.hosted) return { mainWasmBytes: null, workerWasmBytes: null };
  if (h.status.placement === "worker") return { mainWasmBytes: null, workerWasmBytes: h.current().stats.workerMemoryBytes ?? null };
  const before = w.__perfMarks?.wasmInstantiateCalls ?? 0;
  const mod = await import(/* @vite-ignore */ arg.engineUrl);
  const exports = await mod.default();
  if ((w.__perfMarks?.wasmInstantiateCalls ?? 0) !== before || before === 0) throw new Error("the WASM memory read did not reach the instance the app booted");
  return { mainWasmBytes: (exports.memory as WebAssembly.Memory).buffer.byteLength, workerWasmBytes: null };
}
