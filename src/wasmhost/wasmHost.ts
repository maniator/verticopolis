import { LOG_RING_CAP } from "../engine/sim/constants";
import { Simulation } from "../engine/Simulation";
import type { LogEntry } from "../engine/types";
import type { GameplayEvent } from "../engine/gameplayEvents";
import type { WasmEngine, WasmModule } from "../dualrun/binding";
import { readCatalog } from "../dualrun/catalog";
import { loadCommand, relayCommands } from "../dualrun/mirror";
import { ShadowEngine } from "../dualrun/shadow";
import { drainEngineBatch } from "./engineEvents";
import { decodeFrame, decodeHeader, type FrameHeader, type FrameView } from "./frameView";
import { appendEngineLog, applyRecords, checkRecords } from "./frameApply";
import { setStepGate } from "./stepGate";
import { mergeSimulation } from "./merge";
import { adoptTelemetry, parseCommuteStress, type TelemetryDocument } from "./telemetry";
import { useTowerCatalogSource } from "../engine/towerCatalog";
import { syncCars, syncPeople, syncUnits } from "./frameSync";
import { refuseForeignCatalog } from "./catalogCheck";
export { refuseForeignCatalog } from "./catalogCheck";
import { FaultLatch, RestorePoints, carryLiveState, type FaultContext, type HostFault } from "./hostFault";
import { HostEvents, type EventRead } from "./hostEvents";

/**
 * Run a live `Simulation` on the WASM engine (story-engine-wasm-switch).
 * The engine is the authority: it alone ticks. The TypeScript instance the
 * app holds becomes a read model of it, refreshed every frame from the
 * engine's frame view (clock, money, the crowd's positions, the cars, the
 * per-unit counters, the effects) and, whenever the engine's hour pass runs
 * or its tower revision moves, from its full save. Every command the host
 * makes still runs on the instance (so the caller gets the same answer the
 * TypeScript engine gave) and is relayed to the engine, the way the dual run
 * relays it to its shadow; both engines agree by the conformance suite, and
 * the next sync makes the engine's state the instance's.
 *
 * The instance's `serialize` answers with the engine's save, so a save, an
 * export or an undo snapshot is the engine's state and never the read
 * model's view of it.
 *
 * Gameplay events follow the same rule: the instance runs every command too,
 * so its own buffer would report each one a second time. Its
 * `drainGameplayEvents` answers with the engine's batch and throws the
 * instance's away, so a host that drains `sim` sees each event once whichever
 * engine runs. Events the instance emitted before the host attached (the
 * founding) come out at the first drain, and events the engine emitted
 * after the last drain go back to the instance when the host detaches. A
 * command's events wait in the host until a restore point covers the command
 * (#874): the next merge (the sync after a structural command, or the hour
 * pass) or the next save the game reads (an undo capture, an autosave).
 */
export interface WasmHost {
  /** The engine behind the instance. */
  engine: WasmEngine;
  /** When the read model follows the engine (see {@link WasmHostOptions}). */
  readonly sync: "step" | "frame";
  /** Syncs so far: frame views applied and full merges done. */
  frames: number;
  merges: number;
  /** Apply the engine's full save to the instance now. */
  syncStructure(): void;
  /** The frame loop's flush: in coalesced mode, apply the engine's frame if
   *  a step ran since the last one; nothing in step mode. */
  flush(): void;
  /** Put the instance back the way it was and free the engine. A trap
   *  while letting go is a fault like any other (#874). A faulted tower is
   *  a read model the fault left part synchronized, so it stays frozen: it
   *  never ticks again, and its save is the newest restore point. */
  detach(): void;
  /** The fault that froze this host, or null while the engine answers. */
  readonly fault: HostFault | null;
  /** Commands relayed since the newest restore point, log lines and the
   *  camera aside: what a fallback to that point undoes, the trapped
   *  command and any after the fault included (#874). Temporary, with the
   *  restore points. */
  readonly lostEdits: number;
  /** A fresh TypeScript tower from the newest restore point that loads,
   *  carrying the read model's live state no save holds (#874). Throws when
   *  no point loads. Temporary, with the restore points. */
  restore(): Simulation;
}

/** Attach a host to `sim`. Throws, leaving the instance untouched, when the
 *  tower already has a crowd (the engine starts from a save, which carries
 *  none), when a mirror or host is already attached, or when the binding's
 *  catalog cannot be read, states another world or lists other facility
 *  kinds than this build's tables. While attached, `towerCatalog(sim)` is the
 *  engine's. */
export interface WasmHostOptions {
  /** When the read model follows the engine. "step" (the default, and the
   *  only mode the shipped `?engine=wasm` uses) applies the frame view after
   *  every step. "frame" (experimental, `?engine=wasm-frame`) applies it once
   *  per rendered frame, from the frame loop's `flush` (see `stepGate.ts`),
   *  straight from the engine's array (`frameApply.ts`); between steps the
   *  instance's clock advances by the step's minutes, which is what the
   *  engine's clock does, so the fixed step sizes the same steps. A caller
   *  that ticks outside the frame loop syncs with `syncStructure`. */
  sync?: "step" | "frame";
  /** Called once when a call into the engine throws (#874). By then the
   *  host is frozen: ticks and commands no longer reach the engine, and a
   *  save answers with the newest restore point. Nothing on the instance
   *  throws again, except a save when no restore point loads (the merges'
   *  and the attach save were loaded by TypeScript, so one always does). A
   *  throw from the callback is ignored. */
  onFault?: (fault: HostFault) => void;
  /** What the app is doing, so a fault in an undo or redo is coded
   *  `trap-undo` and one in an undo capture's save `trap-command`. */
  context?: () => FaultContext;
}

export function attachWasmHost(sim: Simulation, mod: WasmModule, options: WasmHostOptions = {}): WasmHost {
  const coalesce = options.sync === "frame";
  // Read the binding's catalogs first, both modes (a Classic tower's
  // patronage readout uses the Modern yardstick): a binding whose catalog this
  // build cannot read refuses the attach before an engine is built.
  const catalogs = { classic: readCatalog(mod, "classic"), modern: readCatalog(mod, "modern") };
  // The view was sized from the tables' world and cannot resize, the read
  // model applies the tables' world rules (the ground floor and its structure,
  // the lobby interval), and the UI draws only the kinds it has a presentation
  // for. A binding that states another world or lists other kinds is refused
  // here, once, instead of failing the status pump after the switch.
  for (const c of Object.values(catalogs)) refuseForeignCatalog(c);
  const shadow = new ShadowEngine(mod);
  const load = loadCommand(sim, 0);
  shadow.apply(load);
  const engine = shadow.handle();
  // The saves a fault goes back to (#874): first the one the engine was just
  // built from. Temporary, removed with the TypeScript simulation, like
  // everything below that reads or notes a point.
  const points = new RestorePoints(load.save);
  let lastRevision = sim.tower.revision;
  let lastHourRuns = -1;
  // The engine's own log cursor, kept apart from the instance's `logSeq`
  // (which only ever grows here, as the UI's log view expects), and the
  // instance's cursor at the last sync: a command the instance ran logged
  // its own line, and the engine logs the same line for the same command
  // (the conformance suite pins the log), so those entries are skipped
  // rather than appended twice.
  let engineLogSeq = engine.frameView()[3];
  // The engine's meal overlay counter at the last sync. The instance keeps
  // its own counter and bumps it once in every sync where the engine's moved,
  // so a bump the instance made itself (a relayed command) and an engine bump
  // never land on the same number and the counter never steps back.
  let engineMealRev = decodeFrame(engine.frameView()).header.mealOverlayRevision;
  let simLogSeqAtSync = sim.logSeq;
  let commuteRevision = Number.NaN;
  let detached = false;
  /** Coalesced mode: steps ran since the last sync. */
  let stale = false;

  // The instance's events up to now are real (it was the authority); the
  // engine's start from here. The instance keeps its own buffer object for
  // the whole attach (the merge puts it back), so its marks, its drop count
  // and the read model's copies since the last drain all stay on it.
  const events = new HostEvents(sim.gameplayEvents.drain());
  // The read model's own ring overflows with duplicates while hosted, so the
  // drop count is the instance's at attach plus the engine's.
  const droppedAtAttach = sim.gameplayEvents.dropped;
  const dropCount = () => droppedAtAttach + events.unreadable + events.engineDropped;
  /** Read the engine's pending events and its drop count, and throw away
   *  the read model's copies. Nothing is kept until `events` takes the read:
   *  a read that throws part way keeps none of it, and its events are after
   *  the newest restore point, which a fallback emits again. */
  const readEvents = (): EventRead => {
    const batch = drainEngineBatch(engine);
    const dropped = engine.gameplayEventsDropped();
    sim.gameplayEvents.drain();
    return { ...batch, dropped };
  };
  /** A restore point: the engine's pending events move behind the host's,
   *  then its save is read. Both or neither: when the save throws, the events
   *  read with it are dropped, since the fallback's replay emits them. */
  const readPoint = (): string => {
    const batch = readEvents();
    const text = engine.serialize();
    events.cover(batch);
    points.note(text);
    return text;
  };
  /** Events the engine emitted since the host last read them came from
   *  ticks after the newest point, so a newer point is taken before they can
   *  leave the host, and a fallback never emits them twice. The engine's tick
   *  events come with its hour pass, whose merge reads them first, so this
   *  rarely costs a save. */
  const pullTicks = () => {
    const batch = readEvents();
    if (batch.events.length === 0 && batch.lost === 0) {
      events.count(batch);
      return;
    }
    points.note(engine.serialize());
    events.cover(batch);
  };
  const drainHosted = (): GameplayEvent[] => {
    pullTicks();
    return events.take();
  };
  const droppedSoFar = () => {
    events.engineDropped = guard("trap-tick", () => engine.gameplayEventsDropped(), events.engineDropped);
    return dropCount();
  };
  // A throw from the engine freezes the host once (#874); every call into
  // it goes through `guard`, so the instance's caller never sees one.
  const latch = new FaultLatch(options, () => {
    stale = false;
    events.dropHeld();
  });
  const guard = latch.guard.bind(latch);
  const host: WasmHost = {
    engine,
    sync: coalesce ? "frame" : "step",
    frames: 0,
    merges: 0,
    get fault() {
      return latch.fault;
    },
    get lostEdits() {
      return events.lostEdits;
    },
    syncStructure() {
      if (!detached) guard("trap-tick", () => syncFrame(true), undefined);
    },
    flush() {
      if (coalesce && stale && !detached) guard("trap-tick", () => syncFrame(), undefined);
    },
    restore() {
      const fresh = points.restore().sim;
      carryLiveState(sim, fresh);
      return fresh;
    },
    detach() {
      if (detached) return;
      // A live host hands over what the engine still owes: coalesced steps
      // since the last sync, the commute averages, the pending events.
      // Through the latch, so a trap here is a fault like any other, and a
      // faulted host asks the engine nothing.
      guard(
        "other",
        () => {
          if (coalesce && stale) syncFrame();
          sim.crowd.adoptCommuteStress(parseCommuteStress(engine.commuteStress()));
          // A healthy engine's commands all stand: the instance keeps them.
          events.cover(readEvents());
        },
        undefined,
        "while letting a tower go",
      );
      detached = true;
      const faulted = latch.fault !== null;
      // The instance is the authority again: it keeps the events the host
      // holds (after a fault, every one up to the newest restore point) and
      // the engine's last drop count. Every step runs even when an
      // earlier one throws, so the instance is always let go.
      const handOff = { events: events.take(), dropped: dropCount() };
      runEach(
        () => relay.detach(),
        () => useTowerCatalogSource(sim, null),
        () => setStepGate(sim, null),
        // A faulted tower never runs on TypeScript: its tick does nothing and
        // its save stays the newest restore point (temporary, with them).
        faulted ? () => Object.defineProperty(sim, "tick", { value: () => {}, configurable: true, writable: true }) : () => restoreOwn(sim, "serialize", ownSerialize),
        () => restoreOwn(sim, "drainGameplayEvents", ownDrain),
        () => restoreOwn(sim, "gameplayEventsDropped", ownDropped),
        () => sim.gameplayEvents.restore(handOff.events, handOff.dropped),
        () => {
          try {
            shadow.free();
          } catch (e) {
            // A trapped engine cannot be freed; its module is not used again.
            if (!faulted) throw e;
          }
        },
      );
    },
  };

  const merge = (frame: Pick<FrameView, "header">) => {
    const text = engine.serialize();
    const fresh = Simulation.deserialize(JSON.parse(text));
    // The per-origin commute-stress averages, live crowd state no save
    // carries; read before any write, so a bad reply leaves the instance as
    // it was.
    const commute = parseCommuteStress(engine.commuteStress());
    const buffer = sim.gameplayEvents;
    try {
      mergeSimulation(sim, fresh, { revision: frame.header.revision, mealOverlayRevision: sim.tower.mealOverlayRevision });
    } finally {
      sim.gameplayEvents = buffer; // the merge copies the fresh, empty one
    }
    // The hourly elevator telemetry the save leaves out (the schedule dialog,
    // the stats screen, the diagnostics): it only moves in the engine's hour
    // pass, which brings a merge.
    adoptTelemetry(sim, JSON.parse(engine.elevatorTelemetry()) as TelemetryDocument);
    // Yesterday's housekeeping result, latched at the morning checkout and
    // likewise left out of the save (the stats screen and diagnostics read it).
    const hk = engine.housekeepingReport();
    sim.economy.adoptHousekeepingReport(hk ? (JSON.parse(hk) as { cleaned: number; leftover: number }) : null);
    sim.crowd.adoptCommuteStress(commute);
    commuteRevision = engine.commuteStressRevision();
    lastRevision = frame.header.revision;
    // The merged save is the newest restore point, and the events the engine
    // emitted up to it move behind the host's (see `readPoint`).
    events.cover(readEvents());
    points.noteMerge(text);
    host.merges++;
  };

  /** Apply the engine's frame view to the instance, with a full merge
   *  first when the engine's hour pass ran or its tower moved (or when
   *  `force` asks for one). */
  const syncFrame = (force = false) => {
    const view = engine.frameView();
    let frame: FrameView | null = null;
    let h: FrameHeader;
    if (coalesce) {
      h = decodeHeader(view);
      checkRecords(view, h);
    } else {
      frame = decodeFrame(view);
      h = frame.header;
    }
    relay.suppress(() => {
      if (force || h.onHourRuns !== lastHourRuns || h.revision !== lastRevision) {
        merge({ header: h });
        lastHourRuns = h.onHourRuns;
      }
      const revision = engine.commuteStressRevision();
      if (revision !== commuteRevision) {
        sim.crowd.adoptCommuteStress(parseCommuteStress(engine.commuteStress()));
        commuteRevision = revision;
      }
      // The meal overlay moves mid-hour (a worker leaves for lunch), and the
      // renderer repaints rooms when the instance's counter moves, so the
      // counter follows every engine change at the frame it happens, like the
      // outForMeal counts below.
      if (h.mealOverlayRevision !== engineMealRev) {
        engineMealRev = h.mealOverlayRevision;
        sim.tower.bumpMealOverlayRevision();
      }
      sim.clock.minutes = h.minutes;
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
        const text = h.pending ? engine.pendingChoice() : undefined;
        sim.events.pending = text ? (JSON.parse(text) as typeof sim.events.pending) : null;
      }
      if (h.logSeq !== engineLogSeq) {
        const ownSinceSync = sim.logSeq - simLogSeqAtSync;
        const all = JSON.parse(engine.logSince(engineLogSeq)) as (LogEntry & { seq: number })[];
        if (coalesce) appendEngineLog(sim, all, ownSinceSync);
        else {
          const entries = all.slice(ownSinceSync);
          for (const e of entries) sim.log.push({ minute: e.minute, text: e.text, kind: e.kind });
          while (sim.log.length > LOG_RING_CAP) sim.log.shift();
          sim.logSeq += entries.length;
        }
        engineLogSeq = h.logSeq;
      }
      simLogSeqAtSync = sim.logSeq;
      if (frame) {
        syncPeople(sim, frame);
        syncUnits(sim, frame);
        syncCars(sim, frame);
      } else {
        applyRecords(sim, view, h);
      }
    });
    stale = false;
    host.frames++;
  };

  // The sink and the tick override catch every engine throw (#874): the
  // host freezes, the caller gets the instance's answer, and `onFault`
  // tells the owner, which re-adopts a restore point. The tick itself still
  // arrives through the instance's frame-loop step math, which the host
  // forwards rather than owning (#867).
  let relay: ReturnType<typeof relayCommands>;
  try {
    relay = relayCommands(sim, (cmd) => {
      guard("trap-command", () => {
        // Events still in the engine here came from ticks.
        pullTicks();
        shadow.apply(cmd);
        // The command's own events wait for a point that covers it.
        events.hold(readEvents());
      }, undefined);
      // The read model ran the command and the newest point is from before
      // it, so a fallback undoes it.
      events.noteCommand(cmd.op);
    }, {
      tick(dt) {
        guard("trap-tick", () => {
          engine.tick(dt);
          if (!coalesce) {
            syncFrame();
            return;
          }
          // The engine's clock moved by exactly these minutes; the
          // instance's follows so the next step is sized from the same
          // clock, and the rest of the frame waits for the flush.
          sim.clock.minutes += dt;
          stale = true;
        }, undefined);
      },
    });
  } catch (e) {
    // A relay already on the instance (the dual run's mirror, a second
    // host): the engine built for it must not leak, and the instance keeps
    // its own events.
    try {
      runEach(
        () => shadow.free(),
        () => sim.gameplayEvents.restore(events.take(), sim.gameplayEvents.dropped),
      );
    } catch {
      // The refusal is the caller's answer; a failure to free behind it is not.
    }
    throw e;
  }
  const ownSerialize = Object.getOwnPropertyDescriptor(sim, "serialize");
  const ownDrain = Object.getOwnPropertyDescriptor(sim, "drainGameplayEvents");
  const ownDropped = Object.getOwnPropertyDescriptor(sim, "gameplayEventsDropped");
  // Every save the game reads (an undo capture, an autosave, an export) is
  // a restore point at no extra cost, and one asked of a faulted host is the
  // point the fallback goes back to.
  const serializeHosted = () => {
    const text = guard("other", readPoint, null);
    return text === null ? points.newestSave() : JSON.parse(text);
  };
  Object.defineProperty(sim, "serialize", { value: serializeHosted, configurable: true, writable: true });
  // A reference to the override kept past detach drains the instance, which
  // is the authority again, and never reaches the freed engine. The
  // analytics session's own flush releases the held events (`release`),
  // after a drain that did not fault: a fault drops them with their commands.
  const drainOverride = (opts?: { release?: boolean }): GameplayEvent[] => {
    if (detached) return sim.gameplayEvents.drain();
    const out = guard("trap-tick", drainHosted, null);
    if (out === null) return events.take();
    if (opts?.release && !latch.fault) {
      events.release();
      out.push(...events.take());
    }
    return out;
  };
  Object.defineProperty(sim, "drainGameplayEvents", { value: drainOverride, configurable: true, writable: true });
  Object.defineProperty(sim, "gameplayEventsDropped", { get: droppedSoFar, configurable: true });
  // Prices, sizes and build rules come from the engine that runs the tower.
  useTowerCatalogSource(sim, (mode) => catalogs[mode]);
  if (coalesce) {
    setStepGate(sim, {
      canStep: () => true,
      flush: () => host.flush(),
      settle: () => {
        if (stale && !detached) guard("trap-tick", () => syncFrame(), undefined);
        return Promise.resolve();
      },
    });
  }
  return host;
}

/** Run every step, even after one throws, then throw the first error: a
 *  teardown that must let the instance go and free the engine whatever an
 *  earlier step did. */
function runEach(...steps: (() => void)[]): void {
  let failure: { error: unknown } | null = null;
  for (const step of steps) {
    try {
      step();
    } catch (error) {
      failure ??= { error };
    }
  }
  if (failure) throw failure.error;
}

/** Put back an own property the host replaced: the one that was there, or
 *  none (the prototype's member shows through again). */
function restoreOwn(sim: Simulation, name: string, desc: PropertyDescriptor | undefined): void {
  if (desc) Object.defineProperty(sim, name, desc);
  else delete (sim as unknown as Record<string, unknown>)[name];
}
