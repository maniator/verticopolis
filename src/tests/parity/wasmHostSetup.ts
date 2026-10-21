import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { canonicalJson } from "../../engine/canonicalJson";
import { stateView } from "../../engine/conformanceView";
import { firstDifference } from "../../dualrun/shadow";
import { attachWasmHost, type WasmHost } from "../../wasmhost/wasmHost";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";
import { LOG_RING_CAP } from "../../engine/sim/constants";
import { coerceLog } from "../../engine/sim/coerce";
import type { LogEntry } from "../../engine/types";
import { fingerprint } from "./fingerprint";
import { WASM_PARITY_FLAG, REFRESH_HOOK, STATS_HOOK, frameCadenceRequested, clearFrameCadence, noteHostedTick } from "./typescriptOnly";

/**
 * The setup file of the `integrationWasm` and `unitWasm` vitest projects
 * (story-engine-test-parity, #878): every `Simulation` a test ticks runs on
 * the WASM engine, without the test knowing.
 *
 * The hook is a wrap of `Simulation.prototype.tick`, chosen over a module
 * mock of the construction points (`new Simulation`, `newGame`,
 * `deserialize`, the fixture helpers) for two reasons. One hook covers every
 * construction path, the fixtures' `.vctower` loads included. And attaching
 * at the first tick lets a test set its tower up the way the suites do today
 * (`tower.place`, a direct field write) before the engine starts from the
 * instance's own save, so setup that bypasses the command relay still
 * reaches the engine. `callExterminator` also attaches the host ahead of the
 * first tick so the booking is compared and relayed like other commands.
 * Pending booked room ids also survive a save and re-host (#902).
 *
 * Attaching normalizes the instance. The engine's load can log lines the
 * instance never had (the Classic rent-snap bulletin); the instance adopts
 * the ring's tail past its own log, each own line compared in the form the
 * load keeps it (`coerceLog`: the text cut to LOG_TEXT_CAP, a bad minute or
 * kind coerced), so a long line is not adopted twice. Then one
 * `host.syncStructure()` makes the instance the engine's loaded state (a
 * Classic tower's rents snap onto the 1994 ladder, a shell with no
 * `completeAt` is opened by `finishConstruction`), and the first compare
 * agrees.
 *
 * The compare checks the instance's own state view against the engine's. It
 * runs before every tick while the crowd is empty in the default tick mode,
 * and otherwise when the tower revision moved or the {@link fingerprint}
 * changed since the last sync; and it runs around a relayed
 * `callExterminator`, before the booking and after it. A relayed command
 * (`sim.build`) moved both engines in step and they agree. A disagreement is
 * an edit the relay does not carry (`tower.place`, a direct field write) or
 * a divergence on a relayed command. While the crowd is still empty the
 * engine is restarted from the instance's save (a re-host, the same start a
 * load gets); once the crowd exists the tick throws a
 * {@link WasmParityError} naming the first differing path, since a restart
 * would drop the crowd and hide the difference.
 *
 * The fingerprint is a hash of every unit's and every transport's own
 * fields, the Simulation's own primitive fields, `events.pending` and the
 * clock, taken after each sync. It leaves out the people (the frame owns
 * them), the weather (engine owned: no save carries it, and a load
 * recomputes it from the day) and the engine-owned per-frame counters: a
 * direct write to any of those is replaced by the next frame sync, and no
 * error names it. A counter stamped on a unit before the first tick
 * (`customersIn`) is the same case: the state view leaves it out, and the
 * first frame sync (the one attaching runs) replaces it.
 *
 * The refusals, each by name:
 * - the sampled v1 model (`simModel = "v1"`), at attach and on every hosted
 *   tick, since the save does not carry it and the engine never ported it;
 * - an instance that already has a crowd at attach (a Simulation shared
 *   between tests, ticked on the TypeScript engine after its release);
 * - a re-host after the first tick under the hour cadence, where the
 *   instance is behind the engine between merges and its save would rewind
 *   the engine.
 *
 * Each hosted tick runs on the engine (the host's relay tick: `engine.tick`
 * plus the frame sync), and in tick mode the engine's full save is then
 * merged into the instance (`host.syncStructure`), so an assertion between
 * hours reads the state the engine holds after that tick.
 * The hour cadence keeps the host's own (frame sync per tick, merge on an
 * hour pass or a revision change): `VC_WASM_SYNC=hour` sets it for a run, and
 * `atEngineFrameCadence` for one test that reads only what the frame carries.
 *
 * Every host is detached after each test (all of them, even when one
 * release throws), so the engines are freed and the instances are plain
 * TypeScript simulations again. A test that cannot run on the engine marks
 * itself with `itTypeScriptOnly` (typescriptOnly.ts), which reads the flag
 * raised here.
 */
export class WasmParityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WasmParityError";
  }
}

if (!hasWasmPackage()) throw new Error("the WASM parity projects need engine-rs/pkg/; run npm run wasm:build");
(globalThis as Record<string, unknown>)[WASM_PARITY_FLAG] = true;

const ENV_SYNC_MODE: "tick" | "hour" = (() => {
  const v = process.env.VC_WASM_SYNC;
  if (v !== undefined && v !== "" && v !== "tick" && v !== "hour") throw new Error(`VC_WASM_SYNC must be tick or hour, got "${v}"`);
  return v === "hour" ? "hour" : "tick";
})();
/** The cadence in force: the switch's, or the host's own for a test that
 *  asked for it through `atEngineFrameCadence` (reset after each test). */
const syncMode = (): "tick" | "hour" => (frameCadenceRequested() ? "hour" : ENV_SYNC_MODE);

interface Hosting {
  host: WasmHost;
  /** The host's own tick (the relay's: `engine.tick` plus the frame sync). */
  relayTick: (dt: number) => void;
  /** The `callExterminator` wrapper this file put on the instance, so a
   *  release can tell it from anything else left there (the tick wrapper is
   *  {@link hostedTickWrapper}, shared by every host). */
  exterminatorWrapper: () => ReturnType<Simulation["callExterminator"]>;
  /** The instance's tower revision right after the last sync. */
  revision: number;
  /** {@link fingerprint} right after the last sync. */
  fingerprint: number;
  /** Whether the engine has ticked since this host attached. */
  ticked: boolean;
}

const hosted = new Map<Simulation, Hosting>();

const V1_REFUSAL = "wasm parity: the sampled v1 model is TypeScript-only; mark the test with itTypeScriptOnly";

/** The tick this file puts on every hosted instance. */
const hostedTickWrapper = function (this: Simulation, dt: number): void {
  hostedTick(this, dt);
};

/** Counters a test or a report can read: hosts started, re-hosts after an
 *  un-relayed edit, ticks run on the engine. */
export const parityStats = { hosts: 0, rehosts: 0, ticks: 0, merges: 0 };
(globalThis as Record<string, unknown>)[STATS_HOOK] = parityStats;

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

/** One log line's identity for the tail check below. */
function sameLine(a: { minute: number; kind?: string; text: string }, b: { minute: number; kind?: string; text: string }): boolean {
  return a.minute === b.minute && a.kind === b.kind && a.text === b.text;
}

/** One log line as the engine's load keeps it (`coerceLog`: the text cut
 *  to LOG_TEXT_CAP, a bad minute or kind coerced), or undefined for a line
 *  the load drops. */
function asLoaded(e: LogEntry): LogEntry | undefined {
  return coerceLog([e])[0];
}

function attach(sim: Simulation): Hosting {
  if (sim.simModel === "v1") throw new Error(V1_REFUSAL);
  // A crowd on an instance this file does not host means it was hosted in
  // an earlier test, released by the afterEach below, and ticked on the
  // TypeScript engine since (or it is shared between tests); the engine can
  // only start from a save, which carries no crowd.
  if (sim.crowd.people.length > 0) {
    throw new Error("wasm parity: this Simulation already has a crowd, so it was released after a previous test; the parity projects need one Simulation per test");
  }
  const host = attachWasmHost(sim, wasm());
  try {
    return finishAttach(sim, host);
  } catch (e) {
    // The engine is freed and the instance's relay removed, so a failed
    // attach leaves a plain TypeScript simulation behind.
    host.detach();
    const ownTick = Object.getOwnPropertyDescriptor(sim, "tick");
    if (ownTick && ownTick.value === hostedTickWrapper) delete (sim as Partial<Simulation>).tick;
    throw e;
  }
}

function finishAttach(sim: Simulation, host: WasmHost): Hosting {
  parityStats.hosts++;
  // The engine starts from the instance's save, and a load can log a line
  // the founded instance never had (the Classic rent snap bulletin), ahead
  // of the host's log cursor. The instance adopts those lines, so it reads
  // as a tower loaded on the engine does, and the compare below sees one
  // log on both sides.
  // (A save with no log yet carries no `log` field.)
  const ring = (JSON.parse(host.engine.serialize()) as { log?: Simulation["log"] }).log ?? [];
  // The ring is the instance's log (capped at LOG_RING_CAP, each line as the
  // load coerced it) followed by the load-time lines: find the longest tail
  // of the instance log that the ring starts with, so a log already at the
  // cap, or a line the load cut short, still lines up.
  const loaded = sim.log.map(asLoaded);
  let overlap = Math.min(ring.length, loaded.length);
  while (overlap > 0) {
    const tail = loaded.slice(loaded.length - overlap);
    if (tail.every((e, k) => e !== undefined && sameLine(e, ring[k]))) break;
    overlap--;
  }
  const extra = ring.slice(overlap);
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
  // The booking runs on the instance and is relayed to the engine by the
  // host's own wrapper. The compare before it carries an un-relayed edit
  // into the engine (a re-host) while no booking is pending yet; the one
  // after it throws on any difference (it never re-hosts), so an answer the
  // two engines disagree on fails the test.
  const exterminatorWrapper = function (this: Simulation): ReturnType<Simulation["callExterminator"]> {
    const current = hosted.get(this);
    if (!current) return relayExterminator.call(this);
    const before = compareOrRehost(this, current);
    if (before !== current) return before.exterminatorWrapper.call(this);
    const result = relayExterminator.call(this);
    const after = compareOrRehost(this, current, { rehost: false });
    after.revision = this.tower.revision;
    after.fingerprint = fingerprint(this);
    return result;
  };
  const entry: Hosting = {
    host,
    relayTick: relayDesc.value as (dt: number) => void,
    exterminatorWrapper,
    revision: sim.tower.revision,
    fingerprint: fingerprint(sim),
    ticked: false,
  };
  Object.defineProperty(sim, "tick", { value: hostedTickWrapper, configurable: true, writable: true });
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
  if (ownTick && ownTick.value === hostedTickWrapper) delete (sim as Partial<Simulation>).tick;
  const ownExterminator = Object.getOwnPropertyDescriptor(sim, "callExterminator");
  if (ownExterminator && ownExterminator.value === entry.exterminatorWrapper) delete (sim as Partial<Simulation>).callExterminator;
  if (sim.tick !== Simulation.prototype.tick) throw new Error("wasm parity: a released instance still has its own tick");
}

/** Compare the instance's state view with the engine's (see the module
 *  doc for when), re-host on a difference while the crowd is empty, and
 *  throw once it exists or when `rehost` is false. Returns the hosting in
 *  force afterwards. */
function compareOrRehost(sim: Simulation, entry: Hosting, opts: { rehost?: boolean } = {}): Hosting {
  // A tower edit moves the revision; a direct field write (`u.rent = n`,
  // `sim.money = n`) does not, so while the crowd is still empty
  // (the setup phase of most suites, where the instance is cheap to
  // serialize) the compare runs every tick, and a write that bypassed the
  // relay reaches the engine through the re-host. In hour mode the instance
  // is behind the engine between merges, so only a revision or fingerprint
  // move compares.
  // Once the crowd exists, a direct write that moves no revision (`u.state =
  // "occupied"`, a clock swap) shows in the cheap fingerprint, and the full
  // compare runs then too.
  const crowdEmpty = sim.crowd.people.length === 0;
  if (sim.tower.revision === entry.revision && !(syncMode() === "tick" && crowdEmpty) && fingerprint(sim) === entry.fingerprint) return entry;
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
  if (opts.rehost === false) {
    throw new WasmParityError(
      `the instance's state departs from the engine's at ${d?.path ?? "?"} right after a relayed callExterminator (instance ${JSON.stringify(d?.live)}, engine ${JSON.stringify(d?.shadow)}): ` +
        "the two engines answered the booking differently",
    );
  }
  if (syncMode() === "hour" && entry.ticked) {
    // Between merges the instance is behind the engine, so its save is stale
    // and a restart from it would rewind the engine.
    throw new WasmParityError(
      `the instance's state departs from the engine's at ${d?.path ?? "?"} after the first tick under the hour cadence (VC_WASM_SYNC=hour, or atEngineFrameCadence in the test), which cannot re-host after a tick (the instance's save is behind the engine between merges): ` +
        "make the edit before the first tick, or run the test in tick mode (drop its atEngineFrameCadence call)",
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
  // A test can set v1 after the first tick, past the refusal at attach.
  if (sim.simModel === "v1") throw new Error(V1_REFUSAL);
  entry = compareOrRehost(sim, entry);
  entry.relayTick(dt);
  entry.ticked = true;
  noteHostedTick();
  parityStats.ticks++;
  if (syncMode() === "tick") {
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

/** `refreshFromEngine` (typescriptOnly.ts): the compare first, so an
 *  un-relayed edit is still named, then a full merge. */
(globalThis as Record<string, unknown>)[REFRESH_HOOK] = (sim: Simulation): void => {
  const was = hosted.get(sim);
  if (!was) return;
  const entry = compareOrRehost(sim, was);
  entry.host.syncStructure();
  parityStats.merges++;
  entry.revision = sim.tower.revision;
  entry.fingerprint = fingerprint(sim);
};

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

// A hosted tick in a file's beforeAll belongs to no test, so each test
// starts with no tick noted.
beforeEach(() => clearFrameCadence());

afterEach(() => {
  clearFrameCadence();
  // Every host is released even when one release throws, so no engine
  // leaks into the next test.
  const errors: unknown[] = [];
  for (const sim of [...hosted.keys()]) {
    try {
      release(sim);
    } catch (e) {
      errors.push(e);
    }
  }
  // (AggregateError is ES2021, past the project's ES2020 lib; Node has it.)
  const Aggregate = (globalThis as unknown as { AggregateError: new (errors: unknown[], message: string) => Error }).AggregateError;
  if (errors.length > 0) throw new Aggregate(errors, `wasm parity: ${errors.length} host release(s) failed`);
});
