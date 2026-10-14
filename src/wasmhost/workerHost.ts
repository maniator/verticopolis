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
import { LATENCY_SAMPLES, newWorkerHostStats, pushSample, type WorkerHostStats } from "./workerStats";

export type { WorkerHostStats } from "./workerStats";

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

export interface WorkerHost {
  readonly gen: number;
  readonly stats: WorkerHostStats;
  /** Whether the worker has loaded the tower. */
  loaded(): boolean;
  /** Whether the gate is open: loaded, nothing in flight, and the last reply
   *  included every command. */
  idle(): boolean;
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
  /** How long the worker gets to answer a load or a frame request before
   *  the host gives up on it (a hung worker, a lost reply). */
  replyTimeoutMs?: number;
}

/** The default reply watchdog: far past a working worker's reply (it
 *  answers between frames), short enough that a stuck worker gives the
 *  tower back to TypeScript while the player waits. */
export const REPLY_TIMEOUT_MS = 10_000;
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
  const stats = newWorkerHostStats();
  const replyTimeoutMs = opts.replyTimeoutMs ?? REPLY_TIMEOUT_MS;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const arm = (what: string) => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => fatal(`the worker did not answer ${what} within ${replyTimeoutMs} ms`), replyTimeoutMs);
  };
  const disarm = () => {
    clearTimeout(watchdog);
    watchdog = undefined;
  };
  /** Post to the worker. A message that cannot be posted (a command whose
   *  payload cannot be cloned, a closed port) would leave a gap in the
   *  sequence the worker refuses, so it is fatal here. */
  const send = (msg: ToWorker, transfer?: Transferable[]): boolean => {
    stats.messagesSent++;
    try {
      opts.send(msg, transfer);
      return true;
    } catch (e) {
      fatal(`could not post to the worker: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
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
  /** The engine's exact save at `seq`, while nothing but camera stamps
   *  (`view`, which the save carries and the simulation never reads) was
   *  sent after it. */
  let exact: { save: string; seq: number; view?: { value: unknown } } | null = null;
  /** The last reply was fresh (it included every command): the gate only
   *  opens on one, so a stale reply is followed by a request with no new
   *  steps instead of more steps. */
  let lastFresh = true;
  /** The engine's clock at the last reply (or the load), for the fallback. */
  let engineMinutes = sim.clock.minutes;
  const minutesAtAttach = sim.clock.minutes;
  const commandTimes = new Map<number, number>();
  let waiters: (() => void)[] = [];
  // The read model's cursors, as the main-thread host keeps them.
  let engineLogSeq = 0;
  let engineMealRev = 0;
  let simLogSeqAtSync = sim.logSeq;

  let carried: GameplayEvent[] = sim.gameplayEvents.drain();
  const droppedAtAttach = sim.gameplayEvents.dropped;
  let droppedEngine = 0;
  // The read model's own buffer holds its copies of the events of the
  // commands it ran. They are dropped once a fresh reply has brought the
  // engine's (which follow in `carried`), and handed back at a detach for
  // the commands no reply has included yet, so a command's event is never
  // lost to a fallback or a tower swap, and never handed out twice.
  const takeEvents = (): GameplayEvent[] => {
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
    if (send(msg) && request) arm("a frame request");
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
    disarm();
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
    disarm();
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
    engineMinutes = h.minutes;
    // A reply that includes every command the instance ran. One that does
    // not is refused (#908) except for its events: its state predates a
    // command the instance already answered, and its crowd and cars may name
    // what the command removed. The next request goes out at once, with no
    // new steps, so the read model waits one round trip, not a frame.
    const fresh = r.seq >= cmdSeq;
    lastFresh = fresh;
    if (!fresh) {
      stats.staleReplies++;
      if (r.merge) needMerge = true;
      stats.applyMs += now() - t0;
      requestFrame();
      return;
    }
    // Every command so far is in this reply: the read model's copies of
    // their events are the engine's, which arrived above.
    sim.gameplayEvents.drain();
    relay.suppress(() => {
      if (r.merge) merge(r.merge, h);
      if (h.mealOverlayRevision !== engineMealRev) {
        engineMealRev = h.mealOverlayRevision;
        sim.tower.bumpMealOverlayRevision();
      }
      {
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
        // The pending choice, also when one replaced another between
        // replies (the batching widens that window).
        if (!h.pending) sim.events.pending = null;
        else if (r.pending && r.pending !== JSON.stringify(sim.events.pending)) sim.events.pending = JSON.parse(r.pending) as typeof sim.events.pending;
        if (r.log !== null) {
          appendEngineLog(sim, JSON.parse(r.log) as LogEntry[], sim.logSeq - simLogSeqAtSync);
        }
        engineLogSeq = h.logSeq;
        simLogSeqAtSync = sim.logSeq;
      }
      applyRecords(sim, r.view, h);
    });
    const caughtUp = r.seq === seq;
    if (caughtUp && h.minutes !== sim.clock.minutes) {
      fatal(`the engine's clock reads ${h.minutes} where the frame loop's reads ${sim.clock.minutes}`);
      return;
    }
    if (!caughtUp) exact = null;
    else if (r.merge) exact = { save: r.merge.save, seq };
    else if (exact?.seq !== seq) exact = null;
    stats.ackedSeq = r.seq;
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
      if (exactSave()) resolveWaiters();
      else {
        needMerge = true;
        requestFrame();
      }
    }
  };

  /** The engine's exact save, when it is current: caught up with every
   *  op sent (camera stamps aside) and nothing waiting to go out. */
  const exactSave = () => (!detached && exact && exact.seq === seq && outbox.every((o) => "cmd" in o && o.cmd.op === "setView") ? exact : null);

  const host: WorkerHost = {
    gen,
    stats,
    loaded: () => loaded,
    idle: () => loaded && !detached && inFlight === null && lastFresh,
    flush: () => requestFrame(),
    receive(msg) {
      if (detached || !("gen" in msg) || msg.gen !== gen) {
        if (msg.type === "error" && msg.gen === undefined) fatal(msg.message);
        return;
      }
      stats.messagesReceived++;
      try {
        switch (msg.type) {
          case "loaded": {
            disarm();
            const h = decodeHeader(msg.view);
            if (h.minutes !== minutesAtAttach) throw new Error(`the engine loaded at minute ${h.minutes}, the tower was at ${minutesAtAttach}`);
            engineMinutes = h.minutes;
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
            if (msg.fatal || msg.seq === undefined) fatal(msg.message);
            else opts.onError(`op ${msg.seq}: ${msg.message}`);
            return;
        }
      } catch (e) {
        fatal(`reply: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    settle() {
      if (detached) return Promise.resolve();
      if (exactSave()) return Promise.resolve();
      return new Promise<void>((resolve) => {
        waiters.push(resolve);
        needMerge = true;
        requestFrame();
      });
    },
    detach() {
      if (detached) return;
      // The engine's events for steps still in the worker are not waited
      // for (the docs list it). The instance is the authority again: it keeps
      // the engine's events it was handed, then its own copies for the
      // commands no reply included yet, and the engine's last drop count.
      // Steps the engine never confirmed are given back: the clock returns
      // to the engine's last reported minute, so the TypeScript engine does
      // not start ahead of the state it holds.
      const owed = takeEvents();
      const unconfirmed = sim.gameplayEvents.drain();
      const lostSteps = !exactSave() && sim.clock.minutes !== engineMinutes;
      detached = true;
      disarm();
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
          sim.gameplayEvents.dropped = droppedAtAttach + droppedEngine;
          for (const e of owed) sim.gameplayEvents.pushEvent(e);
          for (const e of unconfirmed) sim.gameplayEvents.pushEvent(e);
          if (lostSteps) sim.clock.minutes = engineMinutes;
          resolveWaiters();
        }
      }
    },
  };

  let relay: CommandRelay;
  try {
    relay = relayCommands(sim, (cmd: ShadowCommand) => {
      if (cmd.op === "load" || cmd.op === "tick" || cmd.op === "checkpoint") return; // host mode never reports these
      if (detached) return;
      // A camera stamp keeps the exact save (patched with the new view),
      // so a save that stamps the camera first can still be exact.
      const keep = cmd.op === "setView" ? exactSave() : null;
      outbox.push({ seq: ++seq, cmd });
      cmdSeq = seq;
      stats.lastCommandSeq = seq;
      commandTimes.set(seq, now());
      if (commandTimes.size > LATENCY_SAMPLES) commandTimes.delete(commandTimes.keys().next().value as number);
      exact = keep ? { save: keep.save, seq, view: { value: (cmd as { view: unknown }).view } } : null;
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
    value: () => {
      const e = exactSave();
      if (!e) {
        stats.approximateSaves++;
        return Simulation.prototype.serialize.call(sim);
      }
      const data = JSON.parse(e.save) as Record<string, unknown>;
      if (e.view) {
        if (e.view.value == null) delete data.view;
        else data.view = e.view.value;
      }
      return data;
    },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(sim, "drainGameplayEvents", { value: (): GameplayEvent[] => (detached ? sim.gameplayEvents.drain() : takeEvents()), configurable: true, writable: true });
  Object.defineProperty(sim, "gameplayEventsDropped", { get: () => droppedAtAttach + droppedEngine, configurable: true });
  useTowerCatalogSource(sim, (mode) => catalogs[mode]);
  setStepGate(sim, {
    canStep: () => host.idle(),
    flush: requestFrame,
    settle: () => host.settle(),
  });
  if (!send({ type: "load", gen, save: load.save, markers: load.markers })) {
    host.detach();
    throw new Error("could not post the tower to the worker");
  }
  arm("the load");
  return host;
}


function restoreOwn(sim: Simulation, name: string, desc: PropertyDescriptor | undefined): void {
  if (desc) Object.defineProperty(sim, name, desc);
  else delete (sim as unknown as Record<string, unknown>)[name];
}
