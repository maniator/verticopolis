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
   *  engine through the wrapper (must equal `steps`). */
  attribution: { engineTickMs: number; engineExportMs: number; hostJsMs: number; merges: number; engineTicks: number } | null;
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
 * Simulation-only timing. `hosted`: tick the live app's tower through
 * `sim.tick` (on the WASM project that is the engine's tick plus the
 * host's read-model sync; on TypeScript it is the engine itself). `raw`:
 * tick a detached instance with nothing attached (a TypeScript Simulation,
 * or a bare WASM Engine from the served package). Each mode warms up on a
 * throwaway instance first, then measures a fresh one from the same save.
 *
 * `attribute` (hosted WASM only) wraps the engine's methods to split the
 * time. The wrappers cost time themselves, so the runner times an
 * unwrapped pass and takes only the split from a separate wrapped pass.
 * Nothing here touches a pending emergency: a write to the read model
 * would not reach the engine, and both engines must see the same state.
 */
export async function simRun(arg: { name: string; mode: "hosted" | "raw"; engine: "ts" | "wasm"; steps: number; warmSteps: number; dt: number; engineUrl: string; attribute: boolean }): Promise<SimRun> {
  const w = window as any;
  const g = w.game;
  const save = w.__perfSaves[arg.name] as string;
  w.__perfStash = w.__perfStash ?? {};
  const Sim = g.sim.constructor;
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
      const startsBefore = Number(hostOf()?.status?.starts ?? 0);
      const errorsBefore = errorsNow().length;
      g.adoptSim(Sim.deserialize(JSON.parse(save)));
      const loadMs = performance.now() - t0;
      g.speed = 0;
      g.engine.paused = true;
      const live = g.sim;
      const h = hostOf();
      // Hosted means: this adopt started a new engine, it raised no error,
      // and the live sim is the instance the host attached to.
      const hostedWasm =
        Boolean(h?.status?.hosted) && Number(h.status.starts) === startsBefore + 1 && errorsNow().length === errorsBefore && Boolean(h.current()) && Object.prototype.hasOwnProperty.call(live, "serialize");
      return {
        loadMs,
        hostedWasm,
        d: {
          tick: (dt) => live.tick(dt),
          save: () => live.serialize(),
          fields: () => ({ minutes: live.clock.minutes, money: live.money, star: live.star, population: live.population, people: live.crowd.people.length }),
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
          const sim = Sim.deserialize(JSON.parse(e.serialize()));
          return { minutes: sim.clock.minutes, money: e.money(), star: sim.star, population: sim.population, people: (JSON.parse(e.crowdView()).people as unknown[]).length };
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
  // A deep copy now, so the start digest cannot see the ticks below.
  w.__perfStash[`${tag}:start`] = JSON.parse(JSON.stringify(d.save()));
  const startMinutes = d.fields().minutes;

  const h = hostOf()?.current?.();
  const acc = { tick: 0, exp: 0, ticks: 0 };
  const restore: (() => void)[] = [];
  const mergesBefore = hostedWasm ? (h.merges as number) : 0;
  const attributing = arg.attribute && hostedWasm;
  if (attributing) {
    const e = h.engine;
    const wrap = (name: string, slot: "tick" | "exp") => {
      const own = Object.getOwnPropertyDescriptor(e, name);
      const orig = e[name];
      e[name] = function (this: unknown, ...a: unknown[]) {
        const t = performance.now();
        try {
          return orig.apply(this, a);
        } finally {
          acc[slot] += performance.now() - t;
          if (slot === "tick") acc.ticks++;
        }
      };
      restore.push(() => {
        if (own) Object.defineProperty(e, name, own);
        else delete e[name];
      });
    };
    wrap("tick", "tick");
    for (const name of ["serialize", "frameView", "logSince", "elevatorTelemetry", "housekeepingReport", "pendingChoice", "drainGameplayEvents"]) wrap(name, "exp");
  }

  const stepMs = new Array<number>(arg.steps);
  const t0 = performance.now();
  try {
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
  const stillHosted = hostedWasm && hostErrorsAdded.length === 0 && hostOf()?.current?.() === h && Boolean(hostOf()?.status?.hosted);
  const sum = stepMs.reduce((s, x) => s + x, 0);
  return {
    mode: arg.mode,
    engineActive: stillHosted || (arg.mode === "raw" && arg.engine === "wasm") ? "wasm" : "ts",
    steps: arg.steps,
    dt: arg.dt,
    loadMs,
    totalMs,
    stepMs,
    attribution: attributing ? { engineTickMs: acc.tick, engineExportMs: acc.exp, hostJsMs: Math.max(0, sum - acc.tick - acc.exp), merges: (h.merges as number) - mergesBefore, engineTicks: acc.ticks } : null,
    hostErrorsAdded,
    startMinutes,
    startKey: `${tag}:start`,
    endKey: `${tag}:end`,
    end: f,
  };
}
