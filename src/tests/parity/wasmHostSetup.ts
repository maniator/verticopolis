import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { canonicalJson } from "../../engine/canonicalJson";
import { stateView } from "../../engine/conformanceView";
import { firstDifference } from "../../dualrun/shadow";
import { attachWasmHost, type WasmHost } from "../../wasmhost/wasmHost";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";
import { LOG_RING_CAP } from "../../engine/sim/constants";
import { WASM_PARITY_FLAG } from "./typescriptOnly";

/**
 * The setup file of the `integrationWasm` and `unitWasm` vitest projects
 * (story-engine-test-parity, #878): every `Simulation` a test ticks runs on
 * the WASM engine, without the test knowing.
 *
 * The hook is a wrap of `Simulation.prototype.tick`, chosen over a module
 * mock of the construction points (`new Simulation`, `newGame`,
 * `deserialize`, the fixture helpers) for two reasons. One hook covers every
 * construction path, the fixtures' `.vctower` loads included. And attaching
 * at the first tick rather than at construction lets a test set its tower
 * up the way the suites do today (`tower.place`, a direct field write) before
 * the engine starts from the instance's own save, so setup that bypasses the
 * command relay still reaches the engine.
 *
 * Attaching runs one `host.syncStructure()` straight away, so the instance
 * is normalized the way the engine normalized it on load (a Classic tower's
 * rents snap onto the 1994 ladder, a shell with no `completeAt` is opened by
 * `finishConstruction`), and the first compare below agrees instead of
 * re-hosting. The load-time log lines the engine wrote (the rent-snap
 * bulletin) are adopted once, skipping any the instance log already ends
 * with, so a re-host never logs the bulletin twice.
 *
 * Per tick the wrapper does three things:
 * 1. Before the tick it compares the instance's own state view with the
 *    engine's. In the default tick mode the compare runs on every tick while
 *    the crowd is empty, and once the crowd exists on a tower revision move
 *    or a change in a cheap fingerprint of the fields tests write directly
 *    (the clock, money, a unit's state and counters), taken after each sync;
 *    under `VC_WASM_SYNC=hour` it runs on a revision or fingerprint move
 *    only. A relayed
 *    command (`sim.build`) moved both in step and they agree. A disagreement
 *    is an edit the relay does not carry (`tower.place`, a direct unit
 *    write) or a divergence on a relayed command: while the crowd is still
 *    empty the engine is restarted from the instance's save (a re-host, the
 *    same start a load gets), and once the crowd exists the tick throws a
 *    {@link WasmParityError} naming the first differing path, since a
 *    restart would drop the crowd and hide the difference. A re-host is
 *    refused while an exterminator booking is pending, since the save does
 *    not carry the booked room ids (#902). A per-frame counter stamped on
 *    the instance before the first tick (`customersIn`) is not a
 *    disagreement: the state view leaves it out, and the first frame sync
 *    (the one attaching runs) replaces it with the engine's value.
 * 2. The tick runs on the engine (the host's relay tick: `engine.tick` plus
 *    the frame sync).
 * 3. After the tick, the engine's full save is merged into the instance
 *    (`host.syncStructure`), so an assertion between hours reads the state
 *    the engine holds after that tick. `VC_WASM_SYNC=hour` keeps the host's
 *    own cadence (frame sync per tick, merge on an hour pass or a revision
 *    change) for a cost comparison.
 *
 * One command attaches the host ahead of the first tick: `callExterminator`
 * keeps its booked room ids in memory only (`exterminationRoomIds`, which no
 * save carries), so a booking made before the first tick would reach the
 * engine as a due day with no rooms. Hosting first relays the command, and
 * the engine books the same rooms. The same compare runs after the relayed
 * command, so a booking the two engines answer differently is caught even
 * when no tick follows.
 *
 * Every host is detached after each test, so the engines are freed and the
 * instances are plain TypeScript simulations again. A test that cannot run
 * on the engine marks itself with `itTypeScriptOnly` (typescriptOnly.ts),
 * which reads the flag raised here.
 */
export class WasmParityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WasmParityError";
  }
}

if (!hasWasmPackage()) throw new Error("the WASM parity projects need engine-rs/pkg/; run npm run wasm:build");
(globalThis as Record<string, unknown>)[WASM_PARITY_FLAG] = true;

const SYNC_MODE: "tick" | "hour" = process.env.VC_WASM_SYNC === "hour" ? "hour" : "tick";

interface Hosting {
  host: WasmHost;
  /** The host's own tick (the relay's: `engine.tick` plus the frame sync). */
  relayTick: (dt: number) => void;
  /** The wrappers this file put on the instance, so a release can tell them
   *  from anything else left there. */
  tickWrapper: (dt: number) => void;
  exterminatorWrapper: () => ReturnType<Simulation["callExterminator"]>;
  /** The instance's tower revision right after the last sync. */
  revision: number;
  /** {@link fingerprint} right after the last sync. */
  fingerprint: string;
}

const hosted = new Map<Simulation, Hosting>();

/** Counters a test or a report can read: hosts started, re-hosts after an
 *  un-relayed edit, ticks run on the engine. */
export const parityStats = { hosts: 0, rehosts: 0, ticks: 0, merges: 0 };

/** The instance's own state view (its `serialize` is the engine's while
 *  hosted, so the prototype's is used here). */
function ownStateView(sim: Simulation): string {
  const own = Object.getOwnPropertyDescriptor(sim, "serialize");
  if (own) delete (sim as Partial<Simulation>).serialize;
  try {
    return canonicalJson(stateView(sim));
  } finally {
    if (own) Object.defineProperty(sim, "serialize", own);
  }
}

/** The fields a test writes straight onto the instance without moving the
 *  tower revision (the clock, money, weather, star, and a unit's state,
 *  rent, occupancy and satisfaction counters), read cheaply after every
 *  sync. A change before the next tick means a direct write landed, and the
 *  full state-view compare runs even once the crowd exists. */
function fingerprint(sim: Simulation): string {
  const parts: (string | number | boolean | undefined)[] = [sim.clock.minutes, sim.money, sim.weather, sim.star];
  for (const u of sim.tower.units) {
    parts.push(u.id, u.state, u.rent, u.noRate, u.occupants, u.customersIn, u.hotelCustomersIn, u.outForMeal, u.satisfaction, u.dirtyDays, u.everOccupied, u.residents, u.vacateAt, u.vacateReason, u.completeAt);
  }
  return parts.join(",");
}

/** One log line's identity for the tail check below. */
function sameLine(a: { minute: number; kind?: string; text: string }, b: { minute: number; kind?: string; text: string }): boolean {
  return a.minute === b.minute && a.kind === b.kind && a.text === b.text;
}

function attach(sim: Simulation): Hosting {
  if (sim.simModel === "v1") throw new Error("wasm parity: the sampled v1 model is TypeScript-only; mark the test with itTypeScriptOnly");
  // A crowd on an instance this file does not host means it was hosted in
  // an earlier test, released by the afterEach below, and ticked on the
  // TypeScript engine since (or it is shared between tests); the engine can
  // only start from a save, which carries no crowd.
  if (sim.crowd.people.length > 0) {
    throw new Error("wasm parity: this Simulation already has a crowd, so it was released after a previous test; the parity projects need one Simulation per test");
  }
  const host = attachWasmHost(sim, wasm());
  parityStats.hosts++;
  // The engine starts from the instance's save, and a load can log a line
  // the founded instance never had (the Classic rent snap bulletin), ahead
  // of the host's log cursor. The instance adopts those lines, so it reads
  // as a tower loaded on the engine does, and the compare below sees one
  // log on both sides.
  // (A save with no log yet carries no `log` field.)
  const ring = (JSON.parse(host.engine.serialize()) as { log?: Simulation["log"] }).log ?? [];
  // The ring is the instance's log (capped at LOG_RING_CAP) followed by the
  // load-time lines: find the longest tail of the instance log that the
  // ring starts with, so a log already at the cap still lines up.
  let overlap = Math.min(ring.length, sim.log.length);
  while (overlap > 0) {
    const tail = sim.log.slice(sim.log.length - overlap);
    if (tail.every((e, k) => sameLine(e, ring[k]))) break;
    overlap--;
  }
  // A load-time line the instance log already ends with (a re-host loading
  // the same off-ladder rents again) is not adopted twice.
  const recent = sim.log.slice(Math.max(0, sim.log.length - (ring.length - overlap)));
  const extra = ring.slice(overlap).filter((e) => !recent.some((r) => sameLine(r, e)));
  if (extra.length > 0) {
    sim.log.push(...extra.map((e) => ({ minute: e.minute, text: e.text, kind: e.kind })));
    while (sim.log.length > LOG_RING_CAP) sim.log.shift();
    // `logSeq` stays where the host read it: the host counts the instance's
    // own lines since its last sync by that cursor and skips as many engine
    // lines, so a bump here would drop engine lines.
  }
  // Normalize the instance as the engine normalized it on load, so the
  // first compare agrees and no re-host fires.
  host.syncStructure();
  const relayDesc = Object.getOwnPropertyDescriptor(sim, "tick");
  if (!relayDesc || typeof relayDesc.value !== "function") throw new Error("wasm parity: the host left no tick on the instance");
  const exterminatorDesc = Object.getOwnPropertyDescriptor(sim, "callExterminator");
  if (!exterminatorDesc || typeof exterminatorDesc.value !== "function") throw new Error("wasm parity: the host left no callExterminator relay on the instance");
  const relayExterminator = exterminatorDesc.value as () => ReturnType<Simulation["callExterminator"]>;
  const tickWrapper = function (this: Simulation, dt: number) {
    hostedTick(this, dt);
  };
  // The booking runs on the instance and is relayed to the engine by the
  // host's own wrapper; the compare after it catches an answer the two
  // engines disagree on when no tick follows.
  const exterminatorWrapper = function (this: Simulation): ReturnType<Simulation["callExterminator"]> {
    const result = relayExterminator.call(this);
    const current = hosted.get(this);
    if (current) compareOrRehost(this, current);
    return result;
  };
  const entry: Hosting = {
    host,
    relayTick: relayDesc.value as (dt: number) => void,
    tickWrapper,
    exterminatorWrapper,
    revision: sim.tower.revision,
    fingerprint: fingerprint(sim),
  };
  Object.defineProperty(sim, "tick", { value: tickWrapper, configurable: true, writable: true });
  Object.defineProperty(sim, "callExterminator", { value: exterminatorWrapper, configurable: true, writable: true });
  hosted.set(sim, entry);
  return entry;
}

function release(sim: Simulation): void {
  const entry = hosted.get(sim);
  if (!entry) return;
  hosted.delete(sim);
  // The relay's restore deletes the own `tick` and `callExterminator`, which
  // are the wrappers above; one left behind would keep the instance hosted.
  entry.host.detach();
  const ownTick = Object.getOwnPropertyDescriptor(sim, "tick");
  if (ownTick && ownTick.value === entry.tickWrapper) delete (sim as Partial<Simulation>).tick;
  const ownExterminator = Object.getOwnPropertyDescriptor(sim, "callExterminator");
  if (ownExterminator && ownExterminator.value === entry.exterminatorWrapper) delete (sim as Partial<Simulation>).callExterminator;
  if (sim.tick !== Simulation.prototype.tick) throw new Error("wasm parity: a released instance still has its own tick");
}

/** Whether the instance holds an exterminator booking the engine would lose
 *  on a re-host (the save carries the due day but not the room ids). */
function bookingPending(sim: Simulation): boolean {
  return (sim.exterminationRoomIds?.length ?? 0) > 0 || sim.exterminationDueDay !== undefined;
}

/** Compare the instance's state view with the engine's (see the module
 *  doc for when), re-host on a difference while the crowd is empty, and
 *  throw once it exists. Returns the hosting in force afterwards. */
function compareOrRehost(sim: Simulation, entry: Hosting): Hosting {
  // A tower edit moves the revision; a direct field write (`u.rent = n`,
  // `sim.weather = "rain"`) does not, so while the crowd is still empty
  // (the setup phase of most suites, where the instance is cheap to
  // serialize) the compare runs every tick, and a write that bypassed the
  // relay reaches the engine through the re-host. In hour mode the instance
  // is behind the engine between merges, so only a revision or fingerprint
  // move compares.
  // Once the crowd exists, a direct write that moves no revision (`u.state =
  // "occupied"`, a clock swap) shows in the cheap fingerprint, and the full
  // compare runs then too.
  const crowdEmpty = sim.crowd.people.length === 0;
  if (sim.tower.revision === entry.revision && !(SYNC_MODE === "tick" && crowdEmpty) && fingerprint(sim) === entry.fingerprint) return entry;
  const own = ownStateView(sim);
  const engine = entry.host.engine.stateView();
  if (own === engine) return entry;
  const ownTree = JSON.parse(own) as Record<string, unknown>;
  const engineTree = JSON.parse(engine) as Record<string, unknown>;
  const d = firstDifference(ownTree, engineTree);
  if (!crowdEmpty) {
    const at = (tree: Record<string, unknown>) => {
      const m = /^\$\.(\w+)\[(\d+)\]/.exec(d?.path ?? "");
      return m ? (tree[m[1]] as unknown[] | undefined)?.[Number(m[2])] : undefined;
    };
    const entryDetail = d && /^\$\.\w+\[\d+\]/.test(d.path) ? ` (instance entry ${JSON.stringify(at(ownTree))}, engine entry ${JSON.stringify(at(engineTree))})` : "";
    // `VC_PARITY_DUMP=<dir>` writes both views beside each other for a
    // triage that needs more than the first differing path. A dump that
    // fails is reported and never replaces the parity error.
    const dumpDir = process.env.VC_PARITY_DUMP;
    if (dumpDir) {
      try {
        mkdirSync(dumpDir, { recursive: true });
        const stamp = `${Date.now()}-${parityStats.hosts}`;
        writeFileSync(join(dumpDir, `parity-${stamp}-instance.json`), own);
        writeFileSync(join(dumpDir, `parity-${stamp}-engine.json`), engine);
      } catch (e) {
        console.warn(`[parity] VC_PARITY_DUMP failed: ${String(e)}`);
      }
    }
    throw new WasmParityError(
      `the instance's state departs from the engine's between ticks at ${d?.path ?? "?"} (instance ${JSON.stringify(d?.live)}, engine ${JSON.stringify(d?.shadow)})${entryDetail}: ` +
        "an edit the relay does not carry (tower.place, a direct field write) or a divergence on a relayed command, after the crowd exists",
    );
  }
  if (bookingPending(sim)) {
    throw new WasmParityError(
      `the instance's state departs from the engine's at ${d?.path ?? "?"} while an exterminator booking is pending, and a re-host would start the engine from a save that carries the due day but not the booked room ids (#902): ` +
        "make the edit before the callExterminator call, or relay it",
    );
  }
  if (process.env.VC_PARITY_TRACE) {
    console.log(`[parity] re-host at ${sim.clock.minutes}: ${d?.path} instance=${JSON.stringify(d?.live)} engine=${JSON.stringify(d?.shadow)}`);
  }
  release(sim);
  const next = attach(sim);
  parityStats.rehosts++;
  return next;
}

function hostedTick(sim: Simulation, dt: number): void {
  let entry = hosted.get(sim);
  if (!entry) throw new Error("wasm parity: a hosted tick on an instance that is not hosted");
  entry = compareOrRehost(sim, entry);
  entry.relayTick(dt);
  parityStats.ticks++;
  if (SYNC_MODE === "tick") {
    entry.host.syncStructure();
    parityStats.merges++;
  }
  entry.revision = sim.tower.revision;
  entry.fingerprint = fingerprint(sim);
}

/** Whether a mirror or host the test attached itself owns the instance: its
 *  relay turned `money` into an accessor. Such an instance is left alone. */
function ownRelay(sim: Simulation): boolean {
  const money = Object.getOwnPropertyDescriptor(sim, "money");
  return money !== undefined && !("value" in money);
}

const protoTick = Simulation.prototype.tick;
Simulation.prototype.tick = function (this: Simulation, dtMinutes: number): void {
  // An instance that reaches the prototype while another relay owns it is
  // being ticked through the prototype by that relay.
  if (ownRelay(this)) {
    protoTick.call(this, dtMinutes);
    return;
  }
  attach(this);
  this.tick(dtMinutes);
};

const protoCallExterminator = Simulation.prototype.callExterminator;
Simulation.prototype.callExterminator = function (this: Simulation): ReturnType<Simulation["callExterminator"]> {
  // Hosted (or owned by another relay), the instance's own wrapper reached
  // this prototype as the original it relays around, so the call runs here.
  if (hosted.has(this) || ownRelay(this)) return protoCallExterminator.call(this);
  attach(this);
  return this.callExterminator();
};

afterEach(() => {
  for (const sim of [...hosted.keys()]) release(sim);
});
