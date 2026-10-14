import { Simulation } from "../engine/Simulation";
import type { GameplayEvent } from "../engine/gameplayEvents";
import type { LogEntry } from "../engine/types";
import { towerCatalog, useTowerCatalogSource } from "../engine/towerCatalog";
import { readCatalog } from "../dualrun/catalog";
import type { ShadowCommand } from "../dualrun/commands";
import { loadCommand, relayCommands, type CommandRelay } from "../dualrun/mirror";
import { appendEngineLog, applyRecords, checkRecords } from "./frameApply";
import { decodeHeader, type FrameHeader } from "./frameView";
import { mergeSimulation } from "./merge";
import { setStepGate } from "./stepGate";
import { adoptTelemetry, type TelemetryDocument } from "./telemetry";
import type { FrameReply, FrameRequest, FromWorker, MergePayload, Op, ToWorker } from "./workerProtocol";

/**
 * The main-thread half of the experimental worker host (`?engine=wasm-worker`;
 * design in `docs/architecture/wasm-worker-host.md`). The engine runs in a
 * worker; the `Simulation` the app holds is its read model, as with the
 * main-thread host, and is refreshed from the worker's replies instead of
 * from synchronous calls.
 *
 * - The frame loop still paces the clock and sizes every step (#867). Each
 *   step runs no TypeScript: it advances the instance's clock by its minutes
 *   (the engine's clock does the same) and joins the frame's batch, which
 *   the frame loop's `flush` sends with one frame request. While a request
 *   is unanswered the gate holds further steps back, so at most one frame's
 *   steps (the fixed step's cap of four) are ever in flight.
 * - Every command still runs on the instance first, so the caller gets the
 *   answer it always got, and is sent to the worker in order with the steps.
 * - A reply that predates one of the instance's commands (its `seq` is
 *   older) is applied as motion only: the crowd, the unit counters and the
 *   cars. Its money, star, log, pending choice and full save would undo the
 *   command until the next reply, so they wait for a reply that includes it.
 * - The worker drains the engine's gameplay events into every reply and the
 *   instance's `drainGameplayEvents` answers with them, so the one drain the
 *   app has sees each event once.
 * - `serialize` answers with the engine's exact save when the last reply
 *   carried one and nothing was sent since; otherwise with the read model's
 *   own save. `settle` asks for an exact one, for the async save paths.
 */
export interface WorkerHostStats {
  /** Messages and payload sent to the worker and received from it. */
  messagesSent: number;
  messagesReceived: number;
  opsSent: number;
  /** Bytes received: frame views, plus the text fields at two bytes a
   *  character (the size a structured clone of a JS string copies). */
  bytesReceived: number;
  frameBytes: number;
  mergeBytes: number;
  merges: number;
  replies: number;
  /** Replies that predated one of the instance's commands. */
  staleReplies: number;
  /** Main-thread time applying replies, and the worker's own time. */
  applyMs: number;
  mergeMs: number;
  workerOpsMs: number;
  workerReplyMs: number;
  /** Command to the first reply that includes it (the ack) and to the end
   *  of applying that reply (the change visible in the read model), in ms,
   *  for the last commands (bounded). */
  commandAckMs: number[];
  commandVisibleMs: number[];
  /** Commands a reply has included so far (not bounded). */
  commandsAcked: number;
  /** The worker's WASM linear memory at the last reply. */
  workerMemoryBytes: number | null;
}

export interface WorkerHost {
  readonly gen: number;
  readonly stats: WorkerHostStats;
  /** Whether the worker has loaded the tower. */
  loaded(): boolean;
  /** Route a worker reply here. */
  receive(msg: FromWorker): void;
  /** The frame loop's flush: send the batch with a frame request, when
   *  nothing is in flight and there is something to answer for. */
  flush(): void;
  /** Resolve once the read model includes every op sent and the engine's
   *  exact save is held (or the host has let go). */
  settle(): Promise<void>;
  detach(): void;
}

export interface WorkerHostOptions {
  gen: number;
  /** The catalogs' text from the worker's ready reply. */
  catalogs: { classic: string; modern: string };
  send(msg: ToWorker, transfer?: Transferable[]): void;
  /** A failure the host cannot continue past (a refused load, a gap in the
   *  sequence, a malformed reply, a clock that disagrees with the engine's).
   *  The controller lets the host go and the tower continues on the
   *  TypeScript engine from the read model. */
  onFatal(message: string): void;
  /** An op the engine refused or failed on: reported, and the host goes on,
   *  as the main-thread host goes on after a command the engine threw on. */
  onError(message: string): void;
}

const LATENCY_SAMPLES = 512;
const now = (): number => (globalThis.performance ? performance.now() : Date.now());

export function attachWorkerHost(sim: Simulation, opts: WorkerHostOptions): WorkerHost {
  const catalogs = {
    classic: readCatalog({ catalog: () => opts.catalogs.classic }, "classic"),
    modern: readCatalog({ catalog: () => opts.catalogs.modern }, "modern"),
  };
  const world = towerCatalog(sim).world;
  for (const c of Object.values(catalogs)) {
    if (c.world.lotWidth !== world.lotWidth || c.world.minFloor !== world.minFloor || c.world.maxFloor !== world.maxFloor) {
      throw new Error(`the WASM engine's ${c.mode} catalog states a different world from the tower's`);
    }
  }
  const { gen } = opts;
  const load = loadCommand(sim, gen); // refuses a tower whose crowd exists
  const stats: WorkerHostStats = {
    messagesSent: 0, messagesReceived: 0, opsSent: 0, bytesReceived: 0, frameBytes: 0, mergeBytes: 0, merges: 0, replies: 0, staleReplies: 0,
    applyMs: 0, mergeMs: 0, workerOpsMs: 0, workerReplyMs: 0, commandAckMs: [], commandVisibleMs: [], commandsAcked: 0, workerMemoryBytes: null,
  };
  const send = (msg: ToWorker, transfer?: Transferable[]) => {
    stats.messagesSent++;
    opts.send(msg, transfer);
  };

  let loaded = false;
  let detached = false;
  /** The last op numbered, the last command's number, and the last op a
   *  frame request covered. */
  let seq = 0;
  let cmdSeq = 0;
  let requestedSeq = 0;
  let reqCounter = 0;
  let inFlight: FrameRequest | null = null;
  let outbox: Op[] = [];
  let sendScheduled = false;
  let needMerge = false;
  let exact: { save: string; seq: number } | null = null;
  const commandTimes = new Map<number, number>();
  let waiters: (() => void)[] = [];
  // The read model's cursors, as the main-thread host keeps them.
  let engineLogSeq = 0;
  let engineMealRev = 0;
  let simLogSeqAtSync = sim.logSeq;

  let carried: GameplayEvent[] = sim.gameplayEvents.drain();
  const droppedAtAttach = sim.gameplayEvents.dropped;
  let droppedEngine = 0;
  const takeEvents = (): GameplayEvent[] => {
    sim.gameplayEvents.drain(); // the read model's duplicates of the commands' events
    const out = carried;
    carried = [];
    return out;
  };

  const sendOps = (request: boolean) => {
    sendScheduled = false;
    if (detached) return;
    if (!request && outbox.length === 0) return;
    const msg: Extract<ToWorker, { type: "ops" }> = { type: "ops", gen, ops: outbox };
    stats.opsSent += outbox.length;
    outbox = [];
    if (request) {
      inFlight = { req: ++reqCounter, logSeq: engineLogSeq, merge: needMerge };
      needMerge = false;
      requestedSeq = seq;
      msg.request = inFlight;
    }
    send(msg);
  };
  const scheduleSend = () => {
    if (sendScheduled) return;
    sendScheduled = true;
    queueMicrotask(() => sendOps(false));
  };
  /** Ask for a reply now, when none is in flight and there is something to
   *  answer for. */
  const requestFrame = () => {
    if (detached || !loaded || inFlight) return;
    if (seq === requestedSeq && !needMerge && waiters.length === 0) return;
    sendOps(true);
  };
  const resolveWaiters = () => {
    const w = waiters;
    waiters = [];
    for (const f of w) f();
  };

  const fatal = (message: string) => {
    if (detached) return;
    opts.onFatal(message);
  };

  const merge = (m: MergePayload, h: FrameHeader) => {
    const t0 = now();
    const fresh = Simulation.deserialize(JSON.parse(m.save));
    const buffer = sim.gameplayEvents;
    const minutes = sim.clock.minutes;
    try {
      mergeSimulation(sim, fresh, { revision: h.revision, mealOverlayRevision: sim.tower.mealOverlayRevision });
    } finally {
      sim.gameplayEvents = buffer;
      // The instance's clock is the frame loop's: it already counts any
      // steps still in flight.
      sim.clock.minutes = minutes;
    }
    adoptTelemetry(sim, JSON.parse(m.telemetry) as TelemetryDocument);
    sim.economy.adoptHousekeepingReport(m.housekeeping ? (JSON.parse(m.housekeeping) as { cleaned: number; leftover: number }) : null);
    stats.merges++;
    stats.mergeMs += now() - t0;
  };

  const applyFrame = (r: FrameReply) => {
    const t0 = now();
    inFlight = null;
    stats.replies++;
    stats.frameBytes += r.view.byteLength;
    stats.bytesReceived += r.view.byteLength + 2 * (r.events.length + (r.log?.length ?? 0) + (r.pending?.length ?? 0));
    stats.workerOpsMs += r.workMs.ops;
    stats.workerReplyMs += r.workMs.reply;
    stats.workerMemoryBytes = r.memoryBytes;
    if (r.merge) {
      const bytes = 2 * (r.merge.save.length + r.merge.telemetry.length + (r.merge.housekeeping?.length ?? 0));
      stats.mergeBytes += bytes;
      stats.bytesReceived += bytes;
    }
    const h = decodeHeader(r.view);
    checkRecords(r.view, h);
    for (const e of JSON.parse(r.events) as GameplayEvent[]) carried.push(e);
    droppedEngine = r.dropped;
    // A reply that includes every command the instance ran.
    const fresh = r.seq >= cmdSeq;
    if (!fresh) stats.staleReplies++;
    relay.suppress(() => {
      if (r.merge) {
        if (fresh) merge(r.merge, h);
        else needMerge = true;
      }
      if (h.mealOverlayRevision !== engineMealRev) {
        engineMealRev = h.mealOverlayRevision;
        sim.tower.bumpMealOverlayRevision();
      }
      if (fresh) {
        sim.money = h.money;
        sim.star = h.star;
        sim.weather = h.weather;
        sim.onHourRuns = h.onHourRuns;
        sim.santaFxSeq = h.santaFxSeq;
        if (sim.explosionFx.seq !== h.explosionFx.seq) sim.explosionFx = { floor: h.explosionFx.floor, x: h.explosionFx.x, seq: h.explosionFx.seq };
        if (sim.thiefFx.seq !== h.thiefFx.seq) sim.thiefFx = { caught: h.thiefFx.caught, floor: h.thiefFx.floor, seq: h.thiefFx.seq };
        if (sim.treasureFx.seq !== h.treasureFx.seq) sim.treasureFx = { floor: h.treasureFx.floor, x: h.treasureFx.x, seq: h.treasureFx.seq };
        sim.vipFxSeq = h.vipFxSeq;
        sim.events.adoptCounts(h.counts);
        if (h.pending !== (sim.events.pending !== null)) {
          sim.events.pending = h.pending && r.pending ? (JSON.parse(r.pending) as typeof sim.events.pending) : null;
        }
        if (r.log !== null) {
          appendEngineLog(sim, JSON.parse(r.log) as LogEntry[], sim.logSeq - simLogSeqAtSync);
        }
        engineLogSeq = h.logSeq;
        simLogSeqAtSync = sim.logSeq;
      }
      applyRecords(sim, r.view, h);
    });
    const caughtUp = fresh && r.seq === seq;
    if (caughtUp && h.minutes !== sim.clock.minutes) {
      fatal(`the engine's clock reads ${h.minutes} where the frame loop's reads ${sim.clock.minutes}`);
      return;
    }
    if (!caughtUp) exact = null;
    else if (r.merge) exact = { save: r.merge.save, seq };
    else if (exact?.seq !== seq) exact = null;
    const t1 = now();
    for (const [s, sent] of commandTimes) {
      if (s > r.seq) break;
      pushSample(stats.commandAckMs, t0 - sent);
      pushSample(stats.commandVisibleMs, t1 - sent);
      stats.commandsAcked++;
      commandTimes.delete(s);
    }
    stats.applyMs += t1 - t0;
    if (waiters.length > 0) {
      if (exact && exact.seq === seq && outbox.length === 0) resolveWaiters();
      else {
        needMerge = true;
        requestFrame();
      }
    }
  };

  const host: WorkerHost = {
    gen,
    stats,
    loaded: () => loaded,
    flush: () => requestFrame(),
    receive(msg) {
      if (detached || !("gen" in msg) || msg.gen !== gen) {
        if (msg.type === "error" && msg.gen === undefined && !detached) fatal(msg.message);
        return;
      }
      stats.messagesReceived++;
      try {
        switch (msg.type) {
          case "loaded": {
            const h = decodeHeader(msg.view);
            if (h.minutes !== sim.clock.minutes) throw new Error(`the engine loaded at minute ${h.minutes}, the tower is at ${sim.clock.minutes}`);
            engineLogSeq = h.logSeq;
            engineMealRev = h.mealOverlayRevision;
            loaded = true;
            requestFrame();
            return;
          }
          case "frame":
            applyFrame(msg);
            return;
          case "error":
            if (msg.seq === undefined) fatal(msg.message);
            else opts.onError(`op ${msg.seq}: ${msg.message}`);
            return;
        }
      } catch (e) {
        fatal(`reply: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    settle() {
      if (detached) return Promise.resolve();
      if (exact && exact.seq === seq && outbox.length === 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        waiters.push(resolve);
        needMerge = true;
        requestFrame();
      });
    },
    detach() {
      if (detached) return;
      detached = true;
      // The engine's events still in the worker (the batch in flight) are
      // not waited for; the docs list it. The instance is the authority
      // again and keeps the events it was handed, with the engine's last
      // reported drop count.
      const owed = takeEvents();
      try {
        send({ type: "free", gen });
      } finally {
        try {
          relay.detach();
        } finally {
          useTowerCatalogSource(sim, null);
          setStepGate(sim, null);
          restoreOwn(sim, "serialize", ownSerialize);
          restoreOwn(sim, "drainGameplayEvents", ownDrain);
          restoreOwn(sim, "gameplayEventsDropped", ownDropped);
          sim.gameplayEvents.drain();
          sim.gameplayEvents.dropped = droppedAtAttach + droppedEngine;
          for (const e of owed) sim.gameplayEvents.pushEvent(e);
          resolveWaiters();
        }
      }
    },
  };

  let relay: CommandRelay;
  try {
    relay = relayCommands(sim, (cmd: ShadowCommand) => {
      if (cmd.op === "load" || cmd.op === "tick" || cmd.op === "checkpoint") return; // host mode never reports these
      outbox.push({ seq: ++seq, cmd });
      cmdSeq = seq;
      commandTimes.set(seq, now());
      if (commandTimes.size > LATENCY_SAMPLES) commandTimes.delete(commandTimes.keys().next().value as number);
      exact = null;
      scheduleSend();
    }, {
      tick(dt) {
        if (detached) return;
        outbox.push({ seq: ++seq, dt });
        sim.clock.minutes += dt;
        exact = null;
      },
    });
  } catch (e) {
    for (const ev of carried) sim.gameplayEvents.pushEvent(ev);
    throw e;
  }
  const ownSerialize = Object.getOwnPropertyDescriptor(sim, "serialize");
  const ownDrain = Object.getOwnPropertyDescriptor(sim, "drainGameplayEvents");
  const ownDropped = Object.getOwnPropertyDescriptor(sim, "gameplayEventsDropped");
  Object.defineProperty(sim, "serialize", {
    value: () => (!detached && exact && exact.seq === seq && outbox.length === 0 ? JSON.parse(exact.save) : Simulation.prototype.serialize.call(sim)),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(sim, "drainGameplayEvents", { value: (): GameplayEvent[] => (detached ? sim.gameplayEvents.drain() : takeEvents()), configurable: true, writable: true });
  Object.defineProperty(sim, "gameplayEventsDropped", { get: () => droppedAtAttach + droppedEngine, configurable: true });
  useTowerCatalogSource(sim, (mode) => catalogs[mode]);
  setStepGate(sim, {
    canStep: () => loaded && !detached && inFlight === null,
    flush: requestFrame,
    settle: () => host.settle(),
  });
  send({ type: "load", gen, save: load.save, markers: load.markers });
  return host;
}

function pushSample(list: number[], v: number): void {
  list.push(v);
  if (list.length > LATENCY_SAMPLES) list.shift();
}

function restoreOwn(sim: Simulation, name: string, desc: PropertyDescriptor | undefined): void {
  if (desc) Object.defineProperty(sim, name, desc);
  else delete (sim as unknown as Record<string, unknown>)[name];
}
