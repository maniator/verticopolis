import { Simulation } from "../engine/Simulation";
import { towerStateSig } from "../engine/UndoHistory";

/**
 * The runtime fallback's state (#874; spec-874-runtime-fallback.md): what a
 * host records when a call into its engine throws, and the engine-written
 * saves it can go back to.
 *
 * Two lifetimes live here. The fault capture (`FaultLatch`, `hostFault`) is
 * host infrastructure that stays once the TypeScript simulation retires: a
 * Rust-only build still has to freeze the engine and stop cleanly (the
 * strict path), and a frozen tower's save still answers with the newest
 * engine-written save (`RestorePoints.newestText`, without its TypeScript
 * load check). The rest of the restore points and `carryLiveState` exist
 * only to re-adopt a tower on the TypeScript engine, which is temporary
 * compatibility code: the TypeScript-engine retirement removes them.
 */

/** Which path into the engine threw, as the analytics code reports it. A
 *  save, or a read while a tower is let go, is `other`; any path during an
 *  undo or redo is `trap-undo`; the undo capture's save before a gesture's
 *  first command is `trap-command` (the release plan's A1 codes). */
export type HostFaultReason = "trap-command" | "trap-tick" | "trap-undo" | "other";

/** What the app was doing when the engine threw. */
export type FaultContext = "undo" | "capture" | null;

/** Whether a fallback code is a running engine's fault rather than a tower
 *  the host would not take. */
export function isHostFault(reason: string): reason is HostFaultReason {
  return reason === "trap-command" || reason === "trap-tick" || reason === "trap-undo" || reason === "other";
}

export interface HostFault {
  reason: HostFaultReason;
  message: string;
}

const WHERE: Record<HostFaultReason, string> = { "trap-command": "during a command", "trap-tick": "during a tick", "trap-undo": "during an undo or redo", other: "during a save" };

/** The fault for a throw on `path`, named for the log and the status.
 *  `where` says where it failed ("during a save") when its code's usual
 *  place does not fit. */
export function hostFault(path: HostFaultReason, context: FaultContext, error: unknown, where = WHERE[path]): HostFault {
  let reason = path;
  if (context === "undo") reason = "trap-undo";
  else if (context === "capture" && path === "other") reason = "trap-command";
  return { reason, message: `the Rust engine failed ${where}: ${error instanceof Error ? error.message : String(error)}` };
}

/** wasm-bindgen's error for a call on an object a trap left borrowed. */
const POISONED = "recursive use of an object detected";

/**
 * Whether a throw from the engine is a trap, after which the module may be
 * corrupt and must not be called again (#1113): a `WebAssembly.RuntimeError`
 * (a Rust panic or abort), wasm-bindgen's borrow error that every later call
 * on a trapped object throws, or a stack overflow, which unwinds through the
 * module and leaves its stack pointer where it stopped. A stack overflow in
 * the host's own TypeScript looks the same and latches too: it cannot be told
 * apart, and latching is the safe side. A wrapper that keeps the throw as its
 * `cause` (the catalog read) is classed by it, and another realm's errors by
 * their name. Anything else is a clean answer: the engine's own `Result::Err`
 * (a plain `Error`) or a check in the host's TypeScript. Narrow on purpose:
 * one the test misses is only left a refusal, as before.
 */
export function isEngineTrap(error: unknown): boolean {
  return trapIn(error) !== null;
}

/** The trap itself, `error` or one of its causes, or null for none. */
function trapIn(error: unknown): unknown {
  for (let e = error, depth = 0; typeof e === "object" && e !== null && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    if (typeof WebAssembly !== "undefined" && e instanceof WebAssembly.RuntimeError) return e;
    const { name, message } = e as { name?: unknown; message?: unknown };
    if (name === "RuntimeError") return e;
    if (typeof message !== "string") continue;
    if (message.includes(POISONED)) return e;
    if ((name === "RangeError" && /maximum call stack size exceeded/i.test(message)) || (name === "InternalError" && /too much recursion/i.test(message))) return e;
  }
  return null;
}

/** Let the engine a refused attach built go, and answer what to throw: the
 *  refusal, or for a trap in the free behind it an error that names both and
 *  has the trap as its cause, which the caller latches on (#1113). After a
 *  trap the engine is let go without a call into the module; a free that
 *  throws has already taken the handle off wasm-bindgen's finalizer. */
export function letEngineGo(shadow: { free(): void; abandon(): void }, refusal: unknown): unknown {
  if (isEngineTrap(refusal)) {
    shadow.abandon();
    return refusal;
  }
  try {
    shadow.free();
  } catch (e) {
    const text = (x: unknown) => (x instanceof Error ? x.message : String(x));
    if (isEngineTrap(e)) return Object.assign(new Error(`${text(e)}, while freeing the engine after a refusal: ${text(refusal)}`), { cause: e });
  }
  return refusal;
}

/** Run every step, even after one throws, then throw: a teardown that must
 *  let the instance go and free the engine whatever an earlier step did.
 *  A lone error is thrown as it is. Several are thrown as one new error that
 *  names them all, the first trap's first (or else the first error's), with
 *  the trap itself as its cause, so the caller latches on it (#1113). */
export function runEach(...steps: (() => void)[]): void {
  const errors: unknown[] = [];
  for (const step of steps) {
    try {
      step();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 0) return;
  if (errors.length === 1) throw errors[0];
  const first = errors.find((e) => trapIn(e) !== null) ?? errors[0];
  const text = (x: unknown) => (x instanceof Error ? x.message : String(x));
  throw Object.assign(new Error([first, ...errors.filter((e) => e !== first)].map(text).join(", and ")), { cause: trapIn(first) ?? first });
}

/** Freezes a host on the first throw from its engine and reports it. */
export class FaultLatch {
  fault: HostFault | null = null;

  constructor(
    private readonly opts: { onFault?: (fault: HostFault) => void; context?: () => FaultContext },
    private readonly onFreeze: () => void = () => {},
  ) {}

  /** Record the first fault, then tell the host and its owner. A throw from
   *  the owner's callback is ignored: the host is frozen either way. */
  freeze(path: HostFaultReason, error: unknown, where?: string): void {
    if (this.fault) return;
    this.fault = hostFault(path, this.opts.context?.() ?? null, error, where);
    this.onFreeze();
    try {
      this.opts.onFault?.(this.fault);
    } catch {
      // The owner's report is its own; nothing here can undo the freeze.
    }
  }

  /** Run a call into the engine. Once frozen, or when the call throws (which
   *  freezes), answer `otherwise`. */
  guard<T>(path: HostFaultReason, fn: () => T, otherwise: T, where?: string): T {
    if (this.fault) return otherwise;
    try {
      return fn();
    } catch (e) {
      this.freeze(path, e, where);
      return otherwise;
    }
  }
}

/** Which restore point a fresh tower came from. */
export type RestorePointKind = "latest" | "merge" | "attach";

/** The point a recovery loaded, and how many newer points failed to load
 *  before it (#1126). */
export interface RestoredPoint {
  point: RestorePointKind;
  skipped: number;
}

/**
 * The engine-written saves a faulted host can go back to, newest first: the
 * latest save the host read, the last merge's save, and the save the engine
 * was built from. Every point costs nothing extra: each is a save the host
 * reads anyway. A merge reads one every game hour and at the sync after a
 * structural command, and the game reads one for every undo capture (before
 * each edit gesture), autosave and export.
 *
 * So a fallback loses everything since the newest of those: the play since
 * it and the commands since it. The 30-second autosave keeps that to about
 * 30 seconds of play while its timer fires on time, and an hour pass's
 * merge to a game hour at most; the owner's bound is 30 seconds of play
 * (R6, 2026-10-20), which this code does not measure or enforce (the
 * facade's restore points do, slice 8). The commands lost are the edit
 * under way, and the edit before it when that one has not merged yet
 * (paused, or a command with no structural change) and the next capture's
 * own save is what traps, plus any action that takes no undo capture (an
 * emergency answer, an exterminator call, a rename).
 *
 * Events are emitted once when a fallback goes back to the newest point,
 * because the host moves the engine's pending events behind its own just
 * before it reads a save, and holds a command's events until a point covers
 * the command. The events up to the point are delivered or handed over; a
 * fallback replays the time after it on the TypeScript engine, which emits
 * that time's events, and none of them had left the host (see `wasmHost.ts`).
 * A fallback to an older point, when the newest does not load, can emit the
 * events between the two again; the recovery records the point it loaded
 * and says so (#1126).
 *
 * Temporary compatibility code, but for `newestText`: the points exist to
 * re-adopt a tower on the TypeScript engine, and go when the TypeScript
 * simulation retires. The strict path keeps the newest save a frozen tower
 * answers with (see the module note).
 */
export class RestorePoints {
  private latest: string | null = null;
  private merged: string | null = null;
  private attach: string | null;
  /** The point `restore` last chose, so a save of a faulted host answers
   *  with the same one. Cleared by a newer point. */
  private chosen: { text: string; point: RestoredPoint } | null = null;

  constructor(attach: string) {
    this.attach = attach;
  }

  /** The host read this save from a healthy engine: the newest point now. */
  note(text: string): void {
    this.latest = text;
    this.chosen = null;
  }

  /** A merge read this save and loaded it, so it is known to load and the
   *  attach save is no longer needed. It is the newest point now. */
  noteMerge(text: string): void {
    this.merged = text;
    this.latest = null;
    this.attach = null;
    this.chosen = null;
  }

  /** The points, newest first. */
  private candidates(): [RestorePointKind, string][] {
    const out: [RestorePointKind, string][] = [];
    if (this.latest !== null) out.push(["latest", this.latest]);
    if (this.merged !== null) out.push(["merge", this.merged]);
    if (this.attach !== null) out.push(["attach", this.attach]);
    return out;
  }

  /** A fresh TypeScript tower from the newest point that loads, with the
   *  number of newer points that did not. After a save answered with a point
   *  the walk starts there and goes on to older points only, so the tower is
   *  never newer than a save already holds: the points newer than it failed
   *  already, and only a fault reads them, so `skipped` is its place in the
   *  list. Throws the walk's first error when none from there on loads. */
  restore(): RestoredPoint & { sim: Simulation } {
    let first: unknown = null;
    let skipped = this.chosen?.point.skipped ?? 0;
    for (const [point, text] of this.candidates().slice(skipped)) {
      try {
        const sim = Simulation.deserialize(JSON.parse(text));
        this.chosen = { text, point: { point, skipped } };
        return { sim, point, skipped };
      } catch (e) {
        first ??= e;
        skipped++;
      }
    }
    throw first;
  }

  /** The save of the point `restore` goes back to: what a save asked of a
   *  faulted host answers with, and where the recovery's walk starts.
   *  Checked once; throws when no point loads, which cannot happen while a
   *  merge's save or the attach save is kept (TypeScript loaded the one and
   *  wrote the other), and one always is. */
  newestText(): string {
    if (this.chosen === null) this.restore();
    return (this.chosen as { text: string }).text;
  }

  /** {@link newestText}, parsed. */
  newestSave(): unknown {
    return JSON.parse(this.newestText());
  }

  /** The point the faulted host's saves answer with, once a save or the
   *  recovery chose one; null until then. An undo's or a redo's own
   *  snapshot can be that save, so the recovery after it learns how far
   *  back the snapshot went. */
  get answered(): RestoredPoint | null {
    return this.chosen?.point ?? null;
  }
}

/** Live state no save carries, from the read model the fault froze to the
 *  fresh tower: the elevator telemetry and yesterday's housekeeping result
 *  (both last merged at the hour pass), the commute-stress averages (last
 *  synced at the faulted frame), the title screen backdrop's mark, so its
 *  events are still left behind when the player's tower takes over, and the
 *  bridging setting, which a restore point may hold from before the player
 *  last switched it (an undo keeps the live one the same way). Telemetry for
 *  a car the fresh tower does not have is left behind. Each part is best
 *  effort: a fresh tower without one beats no fallback. */
export function carryLiveState(from: Simulation, to: Simulation): void {
  const shafts = to.tower.transportsById;
  const parts = [
    ...(["elevatorUtil", "elevatorHourly", "elevatorOrigins"] as const).map((key) => () => {
      const target = to[key] as Map<number, unknown>;
      target.clear();
      for (const [id, value] of from[key] as Map<number, unknown>) if (shafts.has(id)) target.set(id, value);
    }),
    () => to.economy.adoptHousekeepingReport(from.economy.housekeepingReport()),
    () => to.crowd.adoptCommuteStress([...from.crowd.commuteStressByFloor]),
    () => {
      to.gameplayEvents.discardOnHandOff = from.gameplayEvents.discardOnHandOff;
    },
    () => {
      to.autoBridge = from.autoBridge;
    },
  ];
  for (const part of parts) {
    try {
      part();
    } catch {
      // The fresh tower keeps its own.
    }
  }
}

/** The undo signature of a save's tower, the way the port's
 *  `undoSignature` reads a live TypeScript tower, for the recovery's tidy of
 *  the undo trail (`UndoHistory.dropUnchanged`). Temporary, with the
 *  fallback. */
export function signatureOfSave(text: string): string {
  const sim = Simulation.deserialize(JSON.parse(text));
  return towerStateSig(sim.tower, sim.money);
}
