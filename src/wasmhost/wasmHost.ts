import { LOG_RING_CAP } from "../engine/sim/constants";
import { Simulation } from "../engine/Simulation";
import type { Person } from "../engine/crowd/person";
import type { LogEntry } from "../engine/types";
import type { GameplayEvent } from "../engine/gameplayEvents";
import type { WasmEngine, WasmModule } from "../dualrun/binding";
import { loadCommand, relayCommands } from "../dualrun/mirror";
import { ShadowEngine } from "../dualrun/shadow";
import { decodeFrame, type FrameView } from "./frameView";
import { mergeSimulation } from "./merge";

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
 * after the last drain go back to the instance when the host detaches.
 */
export interface WasmHost {
  /** The engine behind the instance. */
  engine: WasmEngine;
  /** Syncs so far: frame views applied and full merges done. */
  frames: number;
  merges: number;
  /** Apply the engine's full save to the instance now. */
  syncStructure(): void;
  /** Put the instance back the way it was and free the engine. */
  detach(): void;
}

/** Attach a host to `sim`. Throws, leaving the instance untouched, when the
 *  tower already has a crowd (the engine starts from a save, which carries
 *  none) or when a mirror or host is already attached. */
export function attachWasmHost(sim: Simulation, mod: WasmModule): WasmHost {
  const shadow = new ShadowEngine(mod);
  shadow.apply(loadCommand(sim, 0));
  const engine = shadow.handle();
  let lastRevision = sim.tower.revision;
  let lastHourRuns = -1;
  // The engine's own log cursor, kept apart from the instance's `logSeq`
  // (which only ever grows here, as the UI's log view expects), and the
  // instance's cursor at the last sync: a command the instance ran logged
  // its own line, and the engine logs the same line for the same command
  // (the conformance suite pins the log), so those entries are skipped
  // rather than appended twice.
  let engineLogSeq = engine.frameView()[3];
  let simLogSeqAtSync = sim.logSeq;
  let detached = false;

  // The instance's events up to now are real (it was the authority); the
  // engine's start from here. A merge may swap the instance's buffer for the
  // fresh one, so the drain always reads `sim.gameplayEvents` as it stands.
  let carried: GameplayEvent[] = sim.gameplayEvents.drain();
  // The read model's own ring overflows with duplicates while hosted, so the
  // drop count is the instance's at attach plus the engine's.
  const droppedAtAttach = sim.gameplayEvents.dropped;
  const drainHosted = (): GameplayEvent[] => {
    sim.gameplayEvents.drain();
    const out = [...carried, ...(JSON.parse(engine.drainGameplayEvents()) as GameplayEvent[])];
    carried = [];
    return out;
  };
  const host: WasmHost = {
    engine,
    frames: 0,
    merges: 0,
    syncStructure() {
      syncFrame(true);
    },
    detach() {
      if (detached) return;
      detached = true;
      // The instance is the authority again: it keeps the events the engine
      // still owes and the engine's drop count. Every step of the teardown
      // runs even when an earlier one throws (an engine that can no longer
      // answer, a trap), so the instance is always let go and the engine
      // always freed.
      let owed: GameplayEvent[] = carried;
      let dropped = droppedAtAttach;
      try {
        dropped = droppedAtAttach + engine.gameplayEventsDropped();
        owed = drainHosted();
      } finally {
        try {
          relay.detach();
        } finally {
          try {
            restoreOwn(sim, "serialize", ownSerialize);
            restoreOwn(sim, "drainGameplayEvents", ownDrain);
            restoreOwn(sim, "gameplayEventsDropped", ownDropped);
            sim.gameplayEvents.drain(); // the read model's duplicates
            sim.gameplayEvents.dropped = dropped;
            for (const e of owed) sim.gameplayEvents.pushEvent(e);
          } finally {
            shadow.free();
          }
        }
      }
    },
  };

  const merge = (frame: FrameView) => {
    const fresh = Simulation.deserialize(JSON.parse(engine.serialize()));
    mergeSimulation(sim, fresh, { revision: frame.header.revision, mealOverlayRevision: frame.header.mealOverlayRevision });
    lastRevision = frame.header.revision;
    host.merges++;
  };

  /** Apply the engine's frame view to the instance, with a full merge
   *  first when the engine's hour pass ran or its tower moved (or when
   *  `force` asks for one). */
  const syncFrame = (force = false) => {
    const frame = decodeFrame(engine.frameView());
    const h = frame.header;
    relay.suppress(() => {
      if (force || h.onHourRuns !== lastHourRuns || h.revision !== lastRevision) {
        merge(frame);
        lastHourRuns = h.onHourRuns;
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
        const entries = (JSON.parse(engine.logSince(engineLogSeq)) as (LogEntry & { seq: number })[]).slice(ownSinceSync);
        for (const e of entries) sim.log.push({ minute: e.minute, text: e.text, kind: e.kind });
        while (sim.log.length > LOG_RING_CAP) sim.log.shift();
        sim.logSeq += entries.length;
        engineLogSeq = h.logSeq;
      }
      simLogSeqAtSync = sim.logSeq;
      syncPeople(sim, frame);
      syncUnits(sim, frame);
      syncCars(sim, frame);
    });
    host.frames++;
  };

  // The sink and the tick override are synchronous and let an engine throw
  // propagate to the caller (backlog #874 records the fallback to build:
  // catch, record on the status, re-adopt the last merged save). The tick
  // itself still arrives through the instance's frame-loop step math, which
  // the host forwards rather than owning (#867).
  let relay: ReturnType<typeof relayCommands>;
  try {
    relay = relayCommands(sim, (cmd) => { shadow.apply(cmd); }, {
      tick(dt) {
        engine.tick(dt);
        syncFrame();
      },
    });
  } catch (e) {
    // A relay already on the instance (the dual run's mirror, a second
    // host): the engine built for it must not leak, and the instance keeps
    // its own events.
    try {
      shadow.free();
    } finally {
      for (const ev of carried) sim.gameplayEvents.pushEvent(ev);
    }
    throw e;
  }
  const ownSerialize = Object.getOwnPropertyDescriptor(sim, "serialize");
  const ownDrain = Object.getOwnPropertyDescriptor(sim, "drainGameplayEvents");
  const ownDropped = Object.getOwnPropertyDescriptor(sim, "gameplayEventsDropped");
  Object.defineProperty(sim, "serialize", { value: () => JSON.parse(engine.serialize()), configurable: true, writable: true });
  // A reference to the override kept past detach drains the instance, which
  // is the authority again, and never reaches the freed engine.
  const drainOverride = (): GameplayEvent[] => (detached ? sim.gameplayEvents.drain() : drainHosted());
  Object.defineProperty(sim, "drainGameplayEvents", { value: drainOverride, configurable: true, writable: true });
  Object.defineProperty(sim, "gameplayEventsDropped", { get: () => droppedAtAttach + engine.gameplayEventsDropped(), configurable: true });
  return host;
}

/** Put back an own property the host replaced: the one that was there, or
 *  none (the prototype's member shows through again). */
function restoreOwn(sim: Simulation, name: string, desc: PropertyDescriptor | undefined): void {
  if (desc) Object.defineProperty(sim, name, desc);
  else delete (sim as unknown as Record<string, unknown>)[name];
}

/** The optional person fields the frame carries: set when the record has
 *  them and deleted when it does not, so a held person reads as the
 *  instance's own would (a cleared `venueUnitId` is absent on both). */
const PERSON_OPTIONALS = ["originUnitId", "venueUnitId", "mealVenueId", "routine", "dwellSecondsLeft"] as const;

function syncPeople(sim: Simulation, frame: FrameView): void {
  const held = new Map<number, Person>();
  for (const p of sim.crowd.people) held.set(p.id, p);
  const next = frame.people.map((r) => {
    let p = held.get(r.id);
    if (!p) {
      // A person first seen in a frame starts from placeholders for the
      // fields the frame does not carry (the route's leg, shaftId and
      // carIndex, destX, tripWait, age, linger), so a reader of those sees
      // a new walker's values even while the engine has the person riding.
      // Backlog #868 owns the gap.
      p = {
        id: r.id, seed: r.seed, state: r.state, floor: r.floor, fy: r.fy, x: r.x,
        floors: [], originFloor: r.originFloor, shafts: [], leg: 0, shaftId: null, carIndex: null,
        destX: r.x, wait: r.wait, tripWait: 0, age: 0, linger: 0, staff: r.staff,
      };
    } else {
      p.seed = r.seed;
      p.staff = r.staff;
      p.state = r.state;
      p.floor = r.floor;
      p.x = r.x;
      p.fy = r.fy;
      p.wait = r.wait;
      p.originFloor = r.originFloor;
    }
    // The route, in place: a holder of the arrays sees the new legs.
    p.floors.splice(0, p.floors.length, ...r.floors);
    p.shafts.splice(0, p.shafts.length, ...r.shafts);
    for (const key of PERSON_OPTIONALS) {
      const value = r[key];
      if (value === undefined) delete p[key];
      else (p as Record<typeof key, typeof value>)[key] = value;
    }
    // The flags are optional on the instance too, and false reads as absent.
    if (r.countedHotelGuest) p.countedHotelGuest = true;
    else delete p.countedHotelGuest;
    if (r.returning) p.returning = true;
    else delete p.returning;
    return p;
  });
  sim.crowd.people.splice(0, sim.crowd.people.length, ...next);
}

function syncUnits(sim: Simulation, frame: FrameView): void {
  for (const r of frame.units) {
    const u = sim.tower.byId.get(r.id);
    if (!u) continue;
    u.state = r.state;
    u.occupants = r.occupants;
    u.customersIn = r.customersIn;
    u.hotelCustomersIn = r.hotelCustomersIn;
    u.outForMeal = r.outForMeal;
  }
}

function syncCars(sim: Simulation, frame: FrameView): void {
  for (const r of frame.transports) {
    const t = sim.tower.transportsById.get(r.id);
    if (!t) continue;
    t.carPositions.splice(0, t.carPositions.length, ...r.carPositions);
    t.carDir.splice(0, t.carDir.length, ...r.carDir);
    if (r.carLoad) {
      if (t.carLoad) t.carLoad.splice(0, t.carLoad.length, ...r.carLoad);
      else t.carLoad = r.carLoad;
    } else {
      delete t.carLoad;
    }
  }
}
