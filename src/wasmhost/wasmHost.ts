import { LOG_RING_CAP } from "../engine/sim/constants";
import { Simulation } from "../engine/Simulation";
import type { Person } from "../engine/crowd/person";
import type { LogEntry } from "../engine/types";
import type { GameplayEvent } from "../engine/gameplayEvents";
import type { WasmEngine, WasmModule } from "../dualrun/binding";
import { readCatalog } from "../dualrun/catalog";
import { loadCommand, relayCommands } from "../dualrun/mirror";
import { ShadowEngine } from "../dualrun/shadow";
import { decodeFrame, type FrameView } from "./frameView";
import { mergeSimulation } from "./merge";
import { adoptTelemetry, type TelemetryDocument } from "./telemetry";
import { useTowerCatalogSource } from "../engine/towerCatalog";
import { catalogFor } from "../engine/catalog";
import type { Catalog, CatalogWorld } from "../engine/catalogTypes";

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
 *  none), when a mirror or host is already attached, or when the binding's
 *  catalog cannot be read, states another world or lists other facility
 *  kinds than this build's tables. While attached, `towerCatalog(sim)` is the
 *  engine's. */
export function attachWasmHost(sim: Simulation, mod: WasmModule): WasmHost {
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
  // The engine's meal overlay counter at the last sync. The instance keeps
  // its own counter and bumps it once in every sync where the engine's moved,
  // so a bump the instance made itself (a relayed command) and an engine bump
  // never land on the same number and the counter never steps back.
  let engineMealRev = decodeFrame(engine.frameView()).header.mealOverlayRevision;
  let simLogSeqAtSync = sim.logSeq;
  let detached = false;

  // The instance's events up to now are real (it was the authority); the
  // engine's start from here. The instance keeps its own buffer object for
  // the whole attach (the merge puts it back), so its marks, its drop count
  // and the read model's copies since the last drain all stay on it.
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
      // always freed. When the engine cannot hand its batch over, the read
      // model's copies of the commands' events since the last drain count as
      // dropped. That is an estimate: the engine's own tick events (fires,
      // stars, milestones) have no copy in the read model; a command the
      // instance accepted but the engine refused (#874) has no twin there;
      // a command the engine's full ring already dropped is counted again
      // from its copy; and the copies stop at the read model's ring cap.
      const duplicates = sim.gameplayEvents.length;
      let owed: GameplayEvent[] = carried;
      let dropped = droppedAtAttach + duplicates;
      try {
        dropped += engine.gameplayEventsDropped();
        owed = drainHosted();
        dropped -= duplicates;
      } finally {
        try {
          relay.detach();
        } finally {
          try {
            useTowerCatalogSource(sim, null);
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
  // Prices, sizes and build rules come from the engine that runs the tower.
  useTowerCatalogSource(sim, (mode) => catalogs[mode]);
  return host;
}

/** Put back an own property the host replaced: the one that was there, or
 *  none (the prototype's member shows through again). */
function restoreOwn(sim: Simulation, name: string, desc: PropertyDescriptor | undefined): void {
  if (desc) Object.defineProperty(sim, name, desc);
  else delete (sim as unknown as Record<string, unknown>)[name];
}

/** The optional person fields the frame carries: set when the record has
 *  them, and otherwise left in the shape the TypeScript engine leaves them
 *  in, so a held person reads as the instance's own would. */
const PERSON_OPTIONALS = ["originUnitId", "venueUnitId", "mealVenueId", "routine", "dwellSecondsLeft"] as const;

/** The optional person fields the TypeScript engine clears by assigning
 *  undefined (`motion.ts`: the origin unit at the lobby, the venue and the
 *  hotel-guest flag when a meal ends), so a cleared one keeps its key with
 *  no value. Every other optional field is absent until set and is never
 *  cleared, and the three flags are absent or true (no engine path writes
 *  false). A person first seen in a frame has no key for a field the frame
 *  sends as absent. */
const CLEARED_BY_ASSIGNMENT: ReadonlySet<string> = new Set(["originUnitId", "venueUnitId", "countedHotelGuest"]);

/** Clear an optional person field the frame sends as absent, the way the
 *  TypeScript engine would. */
function clearOptional(p: Person, key: keyof Person): void {
  if (!(key in p)) return;
  if (CLEARED_BY_ASSIGNMENT.has(key)) (p as unknown as Record<string, unknown>)[key] = undefined;
  else delete (p as unknown as Record<string, unknown>)[key];
}

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
        destX: r.x, wait: r.wait, tripWait: 0, age: 0, linger: 0,
      };
    } else {
      p.seed = r.seed;
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
      if (value === undefined) clearOptional(p, key);
      else (p as Record<typeof key, typeof value>)[key] = value;
    }
    // The flags: true when set, and a false one cleared as above.
    if (r.staff) p.staff = true;
    else clearOptional(p, "staff");
    if (r.countedHotelGuest) p.countedHotelGuest = true;
    else clearOptional(p, "countedHotelGuest");
    if (r.returning) p.returning = true;
    else clearOptional(p, "returning");
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

/** Refuses a binding catalog that states another world, or lists other
 *  facility kinds, than this build's tables for the same mode: the view was
 *  sized from that world and the UI has a color and a description only for
 *  those kinds. The error names the field or the kinds that differ. */
function refuseForeignCatalog(c: Catalog): void {
  const own = catalogFor(c.mode);
  for (const field of Object.keys(own.world) as (keyof CatalogWorld)[]) {
    if (c.world[field] !== own.world[field]) {
      throw new Error(`the WASM engine's ${c.mode} catalog states a different world from this build's tables (${field})`);
    }
  }
  // `readCatalog` already refuses a kind listed twice.
  const keys = c.facilities.map((f) => f.key);
  const kinds = new Set(own.facilities.map((f) => f.key));
  const listed = new Set(keys);
  const extra = keys.filter((k) => !kinds.has(k));
  const missing = [...kinds].filter((k) => !listed.has(k));
  if (extra.length > 0 || missing.length > 0) {
    const parts = [extra.length > 0 ? `unknown ${extra.join(", ")}` : "", missing.length > 0 ? `missing ${missing.join(", ")}` : ""];
    throw new Error(`the WASM engine's ${c.mode} catalog lists other facility kinds than this build draws (${parts.filter(Boolean).join("; ")})`);
  }
}
