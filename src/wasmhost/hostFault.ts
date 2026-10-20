import { Simulation } from "../engine/Simulation";

/**
 * The runtime fallback's state (#874; spec-874-runtime-fallback.md): what a
 * host records when a call into its engine throws, and the engine-written
 * saves it can go back to.
 *
 * Two lifetimes live here. The fault capture (`FaultLatch`, `hostFault`) is
 * host infrastructure that stays once the TypeScript simulation retires: a
 * Rust-only build still has to freeze the engine and stop cleanly (the
 * strict path), and a frozen tower's save still answers with the newest
 * engine-written save (`RestorePoints.newestSave`, without its TypeScript
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

const WHERE: Record<HostFaultReason, string> = { "trap-command": "a command", "trap-tick": "a tick", "trap-undo": "an undo or redo", other: "a save" };

/** The fault for a throw on `path`, named for the log and the status.
 *  `where` names the path when its code's usual name does not fit. */
export function hostFault(path: HostFaultReason, context: FaultContext, error: unknown, where = WHERE[path]): HostFault {
  let reason = path;
  if (context === "undo") reason = "trap-undo";
  else if (context === "capture" && path === "other") reason = "trap-command";
  return { reason, message: `the WASM engine failed during ${where}: ${error instanceof Error ? error.message : String(error)}` };
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

/**
 * The engine-written saves a faulted host can go back to, newest first: the
 * latest save the host read, the last merge's save, and the save the engine
 * was built from. Every point costs nothing extra: each is a save the host
 * reads anyway. A merge reads one every game hour and at the sync after a
 * structural command, and the game reads one for every undo capture (before
 * each edit gesture), autosave and export.
 *
 * So a fallback loses everything since the newest of those: the game time
 * since it (up to a game hour while the clock runs) and the commands since
 * it. Those are the edit under way, and the edit before it when that one
 * has not merged yet (paused, or a command with no structural change) and
 * the next capture's own save is what traps, plus any action that takes no
 * undo capture (an emergency answer, an exterminator call, a rename).
 *
 * Events are emitted once when a fallback goes back to the newest point,
 * because the host moves the engine's pending events behind its own just
 * before it reads a save, and holds a command's events until a point covers
 * the command. The events up to the point are delivered or handed over; a
 * fallback replays the time after it on the TypeScript engine, which emits
 * that time's events, and none of them had left the host (see `wasmHost.ts`).
 * A fallback to an older point, when the newest does not load, can emit the
 * events between the two again.
 *
 * Temporary compatibility code, but for `newestSave`: the points exist to
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
  private chosen: string | null = null;

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

  /** A fresh TypeScript tower from the newest point that loads. Throws the
   *  first point's error when none does. */
  restore(): { sim: Simulation; point: RestorePointKind } {
    let first: unknown = null;
    for (const [point, text] of this.candidates()) {
      try {
        const sim = Simulation.deserialize(JSON.parse(text));
        this.chosen = text;
        return { sim, point };
      } catch (e) {
        first ??= e;
      }
    }
    throw first;
  }

  /** The save of the point `restore` goes back to: what a save asked of a
   *  faulted host answers with, so a save never holds a state the recovery
   *  would skip. Checked once; throws when no point loads, which cannot
   *  happen while a merge's save or the attach save is kept (TypeScript
   *  loaded the one and wrote the other), and one always is. */
  newestSave(): unknown {
    if (this.chosen === null) this.restore();
    return JSON.parse(this.chosen as string);
  }
}

/** Live state no save carries, from the read model the fault froze to the
 *  fresh tower: the elevator telemetry and yesterday's housekeeping result
 *  (both last merged at the hour pass), the commute-stress averages (last
 *  synced at the faulted frame), and the title screen backdrop's mark, so
 *  its events are still left behind when the player's tower takes over.
 *  Telemetry for a car the fresh tower does not have is left behind. Each
 *  part is best effort: a fresh tower without one beats no fallback. */
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
  ];
  for (const part of parts) {
    try {
      part();
    } catch {
      // The fresh tower keeps its own.
    }
  }
}
