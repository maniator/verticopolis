import { Simulation } from "../engine/Simulation";
import type { GameplayEvent } from "../engine/gameplayEvents";
import type { LogEntry } from "../engine/types";
import { useTowerCatalogSource } from "../engine/towerCatalog";
import { readCatalog } from "../dualrun/catalog";
import type { ShadowCommand } from "../dualrun/commands";
import { loadCommand, relayCommands, type CommandRelay } from "../dualrun/mirror";
import { appendEngineLog, applyRecords, checkRecords } from "./frameApply";
import { decodeHeader } from "./frameView";
import { SETTLE_TIMEOUT_MS, setStepGate } from "./stepGate";
import { refuseForeignCatalog } from "./wasmHost";
import type { FrameReply, FrameRequest, Op, ToWorker } from "./workerProtocol";
import { applyHeaderFields, isEventItem, isLogItem, mergeSave, parseArray, parseCount, parseMerge, parsePending, restoreOwn, structuredCloneOf } from "./workerApply";
import { LATENCY_SAMPLES, newWorkerHostStats, pushSample, type WorkerHost, type WorkerHostOptions } from "./workerStats";

export type { WorkerHost, WorkerHostOptions, WorkerHostStats } from "./workerStats";

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
 *   older) is refused, its events aside: its state would undo the command
 *   until the next reply, and its crowd and cars may name what the command
 *   removed. A new request goes out at once (after a streak of them, with
 *   the next frame's steps, so the clock goes on, unless a settle waits).
 * - The worker drains the engine's gameplay events into every reply and the
 *   instance's `drainGameplayEvents` answers with them, so the one drain the
 *   app has sees each event once.
 * - `serialize` answers with the engine's exact save when the last reply
 *   carried one and nothing was sent since; otherwise with the read model's
 *   own save. `settle` asks for an exact one, for the async save paths.
 */

/** The default reply watchdog: far past a working worker's reply (it
 *  answers between frames), short enough that a stuck worker gives the
 *  tower back to TypeScript while the player waits. */
export const REPLY_TIMEOUT_MS = 10_000;

/** Stale replies in a row after which the gate opens anyway (see `idle`). */
export const MAX_STALE_STREAK = 4;

const now = (): number => (globalThis.performance ? performance.now() : Date.now());

export function attachWorkerHost(sim: Simulation, opts: WorkerHostOptions): WorkerHost {
  const catalogs = {
    classic: readCatalog({ catalog: () => opts.catalogs.classic }, "classic"),
    modern: readCatalog({ catalog: () => opts.catalogs.modern }, "modern"),
  };
  for (const c of Object.values(catalogs)) refuseForeignCatalog(c); // the same check the main-thread host makes
  const { gen } = opts;
  const load = loadCommand(sim, gen); // refuses a tower whose crowd exists
  const stats = newWorkerHostStats();
  const replyTimeoutMs = opts.replyTimeoutMs ?? REPLY_TIMEOUT_MS;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const arm = (what: string) => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      // A hidden or frozen page can run an overdue timer before the reply
      // queued behind it; the watchdog waits for a visible page.
      if ((globalThis as { document?: { hidden?: boolean } }).document?.hidden) arm(what);
      else fatal(`the worker did not answer ${what} within ${replyTimeoutMs} ms`);
    }, replyTimeoutMs);
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
  /** Stale replies in a row, and the engine events they brought, held
   *  until a fresh reply: until then they belong to steps the read model has
   *  not taken, which a fallback gives back to the TypeScript engine to run
   *  again (so they are dropped there rather than handed out twice). */
  let staleStreak = 0;
  let held: GameplayEvent[] = [];
  /** The last op that is not a camera stamp, and the last camera stamp:
   *  a reply that includes the first is caught up, with the second patched
   *  into its save. */
  let lastStateSeq = 0;
  let lastView: { seq: number; value: unknown } | null = null;
  /** The engine's clock at the last reply (or the load), for the fallback. */
  let engineMinutes = sim.clock.minutes;
  const minutesAtAttach = sim.clock.minutes;
  const commandTimes = new Map<number, number>();
  /** When a stale reply first included a command (its ack). */
  const ackedAt = new Map<number, number>();
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


  const applyFrame = (r: FrameReply) => {
    // Only the answer to the request in flight (one at a time, answered in
    // order): anything else is not this host's to apply.
    if (!inFlight || r.req !== inFlight.req) throw new Error(`a reply to request ${r.req} while ${inFlight ? `request ${inFlight.req}` : "no request"} was in flight`);
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
      const bytes = 2 * (r.merge.save.length + r.merge.telemetry.length + (r.merge.housekeeping?.length ?? 0) + (r.merge.commute?.length ?? 0));
      stats.mergeBytes += bytes;
      stats.bytesReceived += bytes;
    }
    const h = decodeHeader(r.view);
    checkRecords(r.view, h);
    const events = parseArray<GameplayEvent>(r.events, "event batch", isEventItem);
    const dropped = parseCount(r.dropped, "dropped-event count");
    // A reply that includes every command the instance ran. One that does
    // not is refused (#908) except for its events: its state predates a
    // command the instance already answered, and its crowd and cars may name
    // what the command removed. The next request goes out at once, with no
    // new steps, so the read model waits one round trip, not a frame.
    const fresh = r.seq >= cmdSeq;
    lastFresh = fresh;
    if (!fresh) {
      stats.staleReplies++;
      // The commands this reply includes are acknowledged now, though not
      // yet visible.
      for (const [s] of commandTimes) {
        if (s > r.seq) break;
        if (!ackedAt.has(s)) ackedAt.set(s, t0);
      }
      staleStreak++;
      droppedEngine = dropped;
      for (const e of events) held.push(e);
      if (r.merge) needMerge = true;
      stats.applyMs += now() - t0;
      // Asked again at once, so the read model waits a round trip; after a
      // streak (a command every round trip, as while dragging out a build)
      // the frame loop's next flush sends the next steps with the request
      // instead, so the clock does not stop.
      // A waiting settle asks at once either way (the frame loop may not be
      // flushing: a modal open).
      if (staleStreak < MAX_STALE_STREAK || waiters.length > 0) requestFrame();
      return;
    }
    // Read everything the reply carries before any write (the events and
    // drop count were read above): one that does not parse, or is not the
    // engine's shape, is fatal with the read model as the last reply left
    // it, so the fallback's clock (rolled back to that minute) and state agree.
    const tParse = now();
    const merge = r.merge ? parseMerge(r.merge) : null;
    const parseMs = now() - tParse;
    const pending = h.pending && r.pending ? parsePending<NonNullable<typeof sim.events.pending>>(r.pending) : undefined;
    const log = r.log !== null ? parseArray<LogEntry>(r.log, "log", isLogItem) : null;
    droppedEngine = dropped;
    relay.suppress(() => {
      if (merge) {
        const t = now();
        mergeSave(sim, merge, h);
        stats.merges++;
        stats.mergeMs += now() - t + parseMs;
      }
      if (h.mealOverlayRevision !== engineMealRev) {
        engineMealRev = h.mealOverlayRevision;
        sim.tower.bumpMealOverlayRevision();
      }
      {
        applyHeaderFields(sim, h);
        // The pending choice, also when one replaced another between
        // replies (the batching widens that window), compared after the
        // merge, which can set its own copy.
        if (!h.pending) sim.events.pending = null;
        else if (pending !== undefined && r.pending !== JSON.stringify(sim.events.pending)) sim.events.pending = pending;
        if (log !== null) appendEngineLog(sim, log, sim.logSeq - simLogSeqAtSync);
        engineLogSeq = h.logSeq;
        simLogSeqAtSync = sim.logSeq;
      }
      applyRecords(sim, r.view, h);
    });
    // Applied: every command so far is in the read model, so its copies of
    // their events give way to the engine's, which arrive now, after any
    // held ones, and the engine's minute is the read model's. (A reply that
    // throws above is fatal before any of this, so a fallback gives its
    // steps back and hands out none of its events.)
    for (const e of held) carried.push(e);
    for (const e of events) carried.push(e);
    held = [];
    sim.gameplayEvents.drain();
    staleStreak = 0;
    engineMinutes = h.minutes;
    // Caught up: every op but camera stamps is in this reply.
    const caughtUp = r.seq >= lastStateSeq;
    if (caughtUp && h.minutes !== sim.clock.minutes) {
      fatal(`the engine's clock reads ${h.minutes} where the frame loop's reads ${sim.clock.minutes}`);
      return;
    }
    if (!caughtUp) exact = null;
    else if (r.merge) exact = { save: r.merge.save, seq, view: lastView && lastView.seq > r.seq ? { value: lastView.value } : undefined };
    else if (exact?.seq !== seq) exact = null;
    stats.ackedSeq = r.seq;
    const t1 = now();
    for (const [s, sent] of commandTimes) {
      if (s > r.seq) break;
      pushSample(stats.commandAckMs, (ackedAt.get(s) ?? t0) - sent);
      pushSample(stats.commandVisibleMs, t1 - sent);
      stats.commandsAcked++;
      commandTimes.delete(s);
      ackedAt.delete(s);
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
    // After a few stale replies in a row (a stream of commands, one a round
    // trip) the steps go on, so the clock does not stop while the player
    // drags; the read model waits for a reply that includes every command.
    idle: () => loaded && !detached && inFlight === null && (lastFresh || staleStreak >= MAX_STALE_STREAK),
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
        // A wait that gives up (the save goes ahead with the read model's)
        // takes its waiter with it, so it stops asking for full saves.
        const done = () => {
          clearTimeout(timer);
          waiters = waiters.filter((w) => w !== done);
          resolve();
        };
        const timer = setTimeout(done, SETTLE_TIMEOUT_MS);
        waiters.push(done);
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
      // The read model's copies of the commands no fresh reply included. The
      // engine events stale replies brought (`held`) are not handed out:
      // their steps are given back below, and their commands are in the
      // copies.
      const copies = sim.gameplayEvents.drain();
      const unconfirmed = copies;
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
      const camera = cmd.op === "setView";
      const keep = camera ? exactSave() : null;
      outbox.push({ seq: ++seq, cmd });
      if (camera) lastView = { seq, value: structuredCloneOf((cmd as { view: unknown }).view) };
      else lastStateSeq = seq;
      // A camera stamp changes nothing the simulation, the money, the log
      // or the pending choice holds, so a reply sent before it is not stale.
      if (!camera) {
        cmdSeq = seq;
        stats.lastCommandSeq = seq;
        commandTimes.set(seq, now());
        if (commandTimes.size > LATENCY_SAMPLES) {
          const oldest = commandTimes.keys().next().value as number;
          commandTimes.delete(oldest);
          ackedAt.delete(oldest);
        }
      }
      exact = keep ? { save: keep.save, seq, view: { value: structuredCloneOf((cmd as { view: unknown }).view) } } : null;
      scheduleSend();
    }, {
      tick(dt) {
        if (detached) return;
        outbox.push({ seq: ++seq, dt });
        lastStateSeq = seq;
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
        // The read model's state is as of the last fresh reply (its internals
        // as of the last merge, which every hour pass carries), plus the
        // commands since; its clock already counts the steps still in
        // flight. The save takes the state's own minute, so a tower loaded
        // from it runs those steps again, an hour or day pass among them,
        // instead of starting past a boundary that never ran.
        const data = Simulation.prototype.serialize.call(sim);
        data.minutes = engineMinutes;
        return data;
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


