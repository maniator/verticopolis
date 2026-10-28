/**
 * The simulation-only runs of the engine comparison (issue #972), in the
 * page. Self-contained for `page.evaluate`, like page.ts.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface SimRun {
  mode: "hosted" | "raw";
  engineActive: "ts" | "wasm";
  steps: number;
  dt: number;
  /** Time to make the measured instance from the save (adopt for hosted). */
  loadMs: number;
  totalMs: number;
  stepMs: number[];
  /** Attribution passes only (hosted WASM): time inside the engine's tick,
   *  inside the exports the host reads back (serialize, frameView,
   *  logSince, telemetry and the rest), and the JavaScript remainder
   *  (decode, merge, read-model sync), plus how many ticks reached the
   *  engine through the wrapper (must equal `steps`). `byExport` splits the
   *  exports by name, and `parseMs` is the JSON.parse time inside the host
   *  JavaScript remainder. */
  attribution: { engineTickMs: number; engineExportMs: number; hostJsMs: number; wrappedTotalMs: number; merges: number; engineTicks: number; exportCalls: number; exportsWrapped: number; byExport: Record<string, { calls: number; ms: number }>; parseMs: number; parseCalls: number } | null;
  /** Whether the page had gc() (Chromium's --expose-gc), so the loop began
   *  from a full collection. */
  gcAvailable: boolean;
  /** New host errors during the run (WASM), and whether the same host
   *  still held the tower at the end. */
  hostErrorsAdded: string[];
  startMinutes: number;
  /** Keys of the stashed start and end saves (see digestStashed). */
  startKey: string;
  endKey: string;
  end: { minutes: number; money: number; star: number; population: number; people: number };
}

/**
 * Simulation-only timing. `hosted`: tick the live app's tower through its
 * engine port and read the app's view after each step, as a frame with one
 * step does (the port's tick plus the view frame and its decode, on either
 * engine; PR 5e). `raw`:
 * tick a detached instance with nothing attached (a TypeScript Simulation,
 * or a bare WASM Engine from the served package). Each mode warms up on a
 * throwaway instance first, then measures a fresh one from the same save.
 *
 * `attribute` (hosted WASM only) wraps the engine's methods to split the
 * time: its tick, the other exports (the view frame among them), and the
 * JavaScript left (the view's decode). The wrappers cost time themselves, so the runner times an
 * unwrapped pass and takes only the split from a separate wrapped pass.
 * Nothing here touches a pending emergency: a write to the read model
 * would not reach the engine, and both engines must see the same state.
 */
export async function simRun(arg: { name: string; mode: "hosted" | "raw"; engine: "ts" | "wasm"; steps: number; warmSteps: number; dt: number; engineUrl: string; attribute: boolean }): Promise<SimRun> {
  const w = window as any;
  const g = w.game;
  const save = w.__perfSaves[arg.name] as string;
  w.__perfStash = w.__perfStash ?? {};
  // The TypeScript engine's Simulation class, for the raw TypeScript pass
  // (only on the TypeScript project; the Rust engine has no `sim`).
  const Sim = g.sim?.constructor;
  const hostOf = () => w.__vcEngine;
  const errorsNow = (): string[] => [...((hostOf()?.status?.errors ?? []) as string[])];

  interface Driver { tick(dt: number): void; save(): unknown; fields(): { minutes: number; money: number; star: number; population: number; people: number }; free(): void }
  let mod: any = null;
  if (arg.mode === "raw" && arg.engine === "wasm") {
    mod = await import(/* @vite-ignore */ arg.engineUrl);
    await mod.default();
  }
  const make = (): { d: Driver; loadMs: number; hostedWasm: boolean } => {
    const t0 = performance.now();
    if (arg.mode === "hosted") {
      // A player's load: the stored source, then the app follows the swap.
      const port = g.enginePort;
      const loaded = port.loadSave(save)[0] === 1;
      if (loaded) g.followSwap();
      const loadMs = performance.now() - t0;
      if (!loaded) throw new Error(`${arg.name}: the engine refused the scenario's save`);
      g.speed = 0;
      g.engine.paused = true;
      const reader = g.reader;
      // Hosted means the Rust engine the boot published is the app's port.
      const hostedWasm = Boolean(hostOf()?.status?.hosted) && hostOf().port === port;
      return {
        loadMs,
        hostedWasm,
        d: {
          tick: (dt) => {
            port.tick(dt);
            reader.update();
          },
          save: () => JSON.parse(port.serialize()) as unknown,
          fields: () => {
            const h = reader.header;
            return { minutes: h.minutes, money: h.money, star: h.star, population: h.population, people: reader.crowd.people.length };
          },
          free: () => {},
        },
      };
    }
    if (arg.engine === "ts") {
      const sim = Sim.deserialize(JSON.parse(save));
      return {
        loadMs: performance.now() - t0,
        hostedWasm: false,
        d: {
          tick: (dt) => sim.tick(dt),
          save: () => sim.serialize(),
          fields: () => ({ minutes: sim.clock.minutes, money: sim.money, star: sim.star, population: sim.population, people: sim.crowd.people.length }),
          free: () => {},
        },
      };
    }
    const e = mod.Engine.fromSave(save);
    const loadMs = performance.now() - t0;
    return {
      loadMs,
      hostedWasm: false,
      d: {
        tick: (dt) => e.tick(dt),
        save: () => JSON.parse(e.serialize()),
        fields: () => {
          // The engine's own view header, as the app's view reads it.
          const l = JSON.parse(e.viewLayout()).header;
          const f = e.viewFrame(true);
          return { minutes: f[l.minutes], money: f[l.money], star: f[l.star], population: f[l.population], people: (JSON.parse(e.crowdView()).people as unknown[]).length };
        },
        free: () => e.free(),
      },
    };
  };

  // Warm up: JIT and WASM tier-up on a throwaway instance.
  {
    const { d } = make();
    for (let i = 0; i < arg.warmSteps; i++) d.tick(arg.dt);
    d.free();
  }
  const { d, loadMs, hostedWasm } = make();
  const errorsAtStart = errorsNow().length;
  const tag = `${arg.name}:${arg.mode}:${arg.engine}:${arg.attribute ? "attr" : "time"}:${performance.now()}`;
  // The start save as one string (not a live object graph), so the start
  // digest cannot see the ticks below and the copy costs a collector next
  // to nothing to keep while the loop runs.
  w.__perfStash[`${tag}:start`] = JSON.stringify(d.save());
  const startMinutes = d.fields().minutes;

  const h = hostOf()?.port;
  const acc = { tick: 0, exp: 0, ticks: 0, calls: 0, parse: 0, parses: 0 };
  const byExport: Record<string, { calls: number; ms: number }> = {};
  const restore: (() => void)[] = [];
  const attributing = arg.attribute && hostedWasm;
  let exportsWrapped = 0;
  // Only the outermost wrapped call is timed, and JSON.parse is timed only
  // outside every wrapped call, so no millisecond lands in two categories.
  let depth = 0;
  const stepMs = new Array<number>(arg.steps);
  const gcAvailable = typeof (globalThis as any).gc === "function";
  let t0 = 0;
  try {
    if (attributing) {
      const e = h;
      const wrap = (name: string, slot: "tick" | "exp") => {
        if (slot === "exp") exportsWrapped++;
        const own = Object.getOwnPropertyDescriptor(e, name);
        const orig = e[name];
        e[name] = function (this: unknown, ...a: unknown[]) {
          if (depth > 0) return orig.apply(this, a);
          depth++;
          const t = performance.now();
          try {
            return orig.apply(this, a);
          } finally {
            depth--;
            const ms = performance.now() - t;
            acc[slot] += ms;
            if (slot === "tick") acc.ticks++;
            else {
              acc.calls++;
              const b = (byExport[name] ??= { calls: 0, ms: 0 });
              b.calls++;
              b.ms += ms;
            }
          }
        };
        restore.push(() => {
          if (own) Object.defineProperty(e, name, own);
          else delete e[name];
        });
      };
      wrap("tick", "tick");
      // JSON.parse is where the host turns the engine's strings into the
      // read model, so its share is the "parse" of parse-and-merge. It runs
      // in the attribution pass only, like the export wrappers.
      const parse = JSON.parse;
      JSON.parse = function (this: unknown, ...a: Parameters<typeof JSON.parse>) {
        if (depth > 0) return parse.apply(this, a);
        const t = performance.now();
        try {
          return parse.apply(this, a);
        } finally {
          acc.parse += performance.now() - t;
          acc.parses++;
        }
      } as typeof JSON.parse;
      restore.push(() => {
        JSON.parse = parse;
      });
      // Every other method the binding's class has, so no export the host
      // calls can land in the "host JS" remainder unseen.
      for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(e))) {
        if (name === "constructor" || name === "tick" || name === "free" || typeof e[name] !== "function") continue;
        wrap(name, "exp");
      }
    }

    // A full collection before the clock starts (Chromium runs with
    // --expose-gc for both engines), so neither loop pays for the setup's
    // garbage: the warmup instance, the parse above, a raw engine's fields().
    (globalThis as any).gc?.();
    t0 = performance.now();
    for (let i = 0; i < arg.steps; i++) {
      const a = performance.now();
      d.tick(arg.dt);
      stepMs[i] = performance.now() - a;
    }
  } finally {
    for (const r of restore) r();
  }
  const totalMs = performance.now() - t0;
  w.__perfStash[`${tag}:end`] = d.save();
  const f = d.fields();
  d.free();
  const hostErrorsAdded = errorsNow().slice(errorsAtStart);
  // Still hosted at the end: the same host, no new error.
  const stillHosted = hostedWasm && hostErrorsAdded.length === 0 && hostOf()?.port === h && g.enginePort === h && Boolean(hostOf()?.status?.hosted);
  const sum = stepMs.reduce((s, x) => s + x, 0);
  return {
    mode: arg.mode,
    engineActive: stillHosted || (arg.mode === "raw" && arg.engine === "wasm") ? "wasm" : "ts",
    steps: arg.steps,
    dt: arg.dt,
    loadMs,
    totalMs,
    stepMs,
    attribution: attributing
      ? { engineTickMs: acc.tick, engineExportMs: acc.exp, hostJsMs: Math.max(0, sum - acc.tick - acc.exp), wrappedTotalMs: sum, merges: 0, engineTicks: acc.ticks, exportCalls: acc.calls, byExport, parseMs: acc.parse, parseCalls: acc.parses, exportsWrapped }
      : null,
    hostErrorsAdded,
    gcAvailable,
    startMinutes,
    startKey: `${tag}:start`,
    endKey: `${tag}:end`,
    end: f,
  };
}
