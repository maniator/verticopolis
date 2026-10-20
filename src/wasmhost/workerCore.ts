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
 * full save only when the tower's revision or the hour pass moved since the
 * last one it sent (or when asked).
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
  private sentCommuteRevision = Number.NaN;
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
    this.sentCommuteRevision = Number.NaN;
    try {
      this.shadow.apply({ op: "load", gen, save, markers });
      const engine = this.shadow.handle();
      // The first frame's state is the save the main thread sent, so the
      // first full save goes out only when something moves.
      const view = engine.frameView();
      this.sentRevision = view[1];
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
      if (msg.request.merge || revision !== this.sentRevision || hourRuns !== this.sentHourRuns) {
        merge = { save: engine.serialize(), telemetry: engine.elevatorTelemetry(), housekeeping: engine.housekeepingReport() ?? null, commute: engine.commuteStress() };
        this.sentRevision = revision;
        this.sentHourRuns = hourRuns;
      }
      const events = engine.drainGameplayEvents();
      const commuteRevision = engine.commuteStressRevision();
      const commute = !merge && commuteRevision !== this.sentCommuteRevision ? engine.commuteStress() : null;
      this.sentCommuteRevision = commuteRevision;
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
        commute,
        workMs: { ops: t1 - t0, reply: now() - t1 },
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

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
