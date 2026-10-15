import type { WasmModule } from "../dualrun/binding";
import { ShadowEngine } from "../dualrun/shadow";
import type { FromWorker, OpsMessage, ToWorker } from "./workerProtocol";

/**
 * The engine worker's logic, apart from the worker global so it runs in Node
 * against the real package (the integration tests drive it through an
 * in-process channel). It holds one engine per tower, applies the ops in
 * the order they arrive, and answers each frame request with the frame view
 * (its buffer transferred), the gameplay events drained since the last
 * reply, the log entries the main thread lacks, the pending choice, and the
 * save half: the full save when the tower's revision moved since the last
 * one it sent or when asked, and on an hour pass the engine's delta against
 * the last save or delta sent (#1045), or the full save when no delta can
 * carry it (units added, removed or reordered, or a command since the last
 * sync).
 */
export type Post = (msg: FromWorker, transfer?: Transferable[]) => void;

/** Refused ops reported per tower before the rest are dropped (a trapped
 *  engine fails every op after the first). A fatal error is always sent. */
export const MAX_ERRORS_PER_TOWER = 20;

const now = (): number => (globalThis.performance ? performance.now() : Date.now());

export class EngineWorkerCore {
  private readonly shadow: ShadowEngine;
  private gen = -1;
  private seq = 0;
  private sentRevision = Number.NaN;
  private sentHourRuns = Number.NaN;
  /** The last full save or delta sent (#1045): the next delta's base. */
  private sync = 0;
  /** A command (a camera stamp aside) ran since the last save sent. The
   *  read model ran it too, on its own; a command the engine answered
   *  differently (a refusal it reports only in its result) leaves a unit
   *  the engine never changes, which no delta would correct, so the next
   *  hour pass sends the full save instead, as every hour pass did before. */
  private commandSinceSync = false;
  private errors = 0;

  /** `memoryBytes` reads the engine's linear memory size, for the
   *  benchmark (the entry point passes the module's memory). */
  constructor(private readonly mod: WasmModule, private readonly post: Post, private readonly memoryBytes: () => number | null = () => null) {
    this.shadow = new ShadowEngine(mod);
  }

  /** The catalogs' text, for the ready reply. */
  catalogs(): { classic: string; modern: string } {
    const read = (mode: "classic" | "modern") => {
      if (typeof this.mod.catalog !== "function") throw new Error("the WASM binding exports no catalog; rebuild it");
      return this.mod.catalog(mode);
    };
    return { classic: read("classic"), modern: read("modern") };
  }

  handle(msg: ToWorker): void {
    switch (msg.type) {
      case "init":
        return; // the entry point loads the package before building the core
      case "load":
        this.load(msg.gen, msg.save, msg.markers);
        return;
      case "ops":
        if (msg.gen === this.gen) this.ops(msg);
        return;
      case "free":
        if (msg.gen === this.gen) {
          this.shadow.free();
          this.gen = -1;
        }
        return;
    }
  }

  private load(gen: number, save: string, markers: { lastHour: number; lastDay: number; lastQuarter: number; lastMonth: number }): void {
    this.gen = gen;
    this.seq = 0;
    this.errors = 0;
    this.sentRevision = Number.NaN;
    this.sentHourRuns = Number.NaN;
    this.sync = 0;
    this.commandSinceSync = false;
    try {
      this.shadow.apply({ op: "load", gen, save, markers });
      const engine = this.shadow.handle();
      // The first frame's state is the save the main thread sent, so the
      // first full save goes out only when the layout moves. That save is
      // also the base of the first delta (sync 0), which the engine's
      // mirror takes from its own serialization of the loaded tower. When
      // the engine read the save into anything else (a repair or migration
      // the read model did not make), the first reply sends a full save
      // instead.
      const loaded = engine.serializeForSync();
      const view = engine.frameView();
      this.sentRevision = sameJson(JSON.parse(loaded), JSON.parse(save)) ? view[1] : Number.NaN;
      this.sentHourRuns = view[22];
      this.post({ type: "loaded", gen, view }, [view.buffer]);
    } catch (e) {
      this.fatal(undefined, `load: ${message(e)}`);
    }
  }

  private ops(msg: OpsMessage): void {
    if (!this.shadow.loaded()) return; // a refused load: nothing can apply
    const t0 = now();
    for (const op of msg.ops) {
      if (op.seq !== this.seq + 1) {
        this.fatal(op.seq, `op ${op.seq} arrived after ${this.seq}; the sequence has a gap`);
        return;
      }
      this.seq = op.seq;
      // A step that fails leaves the engine's clock and state where no
      // later reply can be trusted, so it is fatal; a refused command is
      // reported and the run goes on.
      if ("dt" in op) {
        try {
          this.shadow.apply({ op: "tick", dt: op.dt });
        } catch (e) {
          this.fatal(op.seq, `tick: ${message(e)}`);
          return;
        }
        continue;
      }
      if (op.cmd.op !== "setView") this.commandSinceSync = true;
      try {
        this.shadow.apply(op.cmd);
      } catch (e) {
        this.fail(op.seq, `${op.cmd.op}: ${message(e)}`);
      }
    }
    const t1 = now();
    if (!msg.request) return;
    try {
      const engine = this.shadow.handle();
      const view = engine.frameView();
      const revision = view[1];
      const hourRuns = view[22];
      const logSeq = view[3];
      const pending = view[21] === 1 ? engine.pendingChoice() ?? null : null;
      let merge = null;
      let delta = null;
      const full = msg.request.merge || revision !== this.sentRevision;
      const tSave = now();
      if (full || hourRuns !== this.sentHourRuns) {
        // A delta only for an hour pass on an unchanged layout; the engine
        // answers nothing when it cannot describe the change, and the full
        // save goes instead.
        const text = full || this.commandSinceSync ? undefined : engine.saveDelta();
        const telemetry = engine.elevatorTelemetry();
        const housekeeping = engine.housekeepingReport() ?? null;
        const base = this.sync;
        this.sync++;
        if (text === undefined) merge = { save: engine.serializeForSync(), telemetry, housekeeping, sync: this.sync };
        else delta = { delta: text, telemetry, housekeeping, base, sync: this.sync };
        this.sentRevision = revision;
        this.sentHourRuns = hourRuns;
        this.commandSinceSync = false;
      }
      const tSaved = now();
      const events = engine.drainGameplayEvents();
      const reply: FromWorker = {
        type: "frame",
        gen: this.gen,
        req: msg.request.req,
        seq: this.seq,
        view,
        events,
        dropped: engine.gameplayEventsDropped(),
        log: logSeq !== msg.request.logSeq ? engine.logSince(msg.request.logSeq) : null,
        pending,
        merge,
        delta,
        workMs: { ops: t1 - t0, reply: now() - t1, save: tSaved - tSave },
        memoryBytes: this.memoryBytes(),
      };
      this.post(reply, [view.buffer]);
    } catch (e) {
      this.fatal(undefined, `frame: ${message(e)}`);
    }
  }

  /** One op the engine refused: reported (up to the cap), and the next
   *  reply carries a full save whatever moved, so the read model takes the
   *  engine's state after the refusal. */
  private fail(seq: number, text: string): void {
    this.sentRevision = Number.NaN;
    if (this.errors >= MAX_ERRORS_PER_TOWER) return;
    this.errors++;
    this.post({ type: "error", gen: this.gen, seq, fatal: false, message: text });
  }

  /** An error the tower cannot go on past. Nothing applies after it until
   *  the next load, so the engine is freed. */
  private fatal(seq: number | undefined, text: string): void {
    this.shadow.free();
    this.post({ type: "error", gen: this.gen, seq, fatal: true, message: text });
  }
}

/** Whether two parsed JSON values are equal, key order aside. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameJson(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = Object.keys(ra);
  if (keys.length !== Object.keys(rb).length) return false;
  for (const k of keys) if (!(k in rb) || !sameJson(ra[k], rb[k])) return false;
  return true;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
