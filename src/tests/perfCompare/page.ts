/**
 * Browser-side measurement functions for the engine comparison (issue #972).
 * Like `e2e/perf-harness.ts`, every exported function is SELF-CONTAINED (no
 * module-scope references, helpers declared inside) because Playwright
 * serializes it into `page.evaluate` or `addInitScript`. They read the
 * `window.game` handle a VC_TOOLING=1 build publishes and the
 * `window.__vcEngine` handle the WASM host publishes, and return plain JSON.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Init script: stamp the moment the app publishes `window.game` and the
 *  moment the WASM host publishes `window.__vcEngine`, by accessor, so the
 *  startup numbers need no polling and no change to the app. */
export function installProbes(): void {
  const w = window as any;
  const marks: Record<string, number> = {};
  w.__perfMarks = marks;
  let game: unknown;
  let host: unknown;
  Object.defineProperty(w, "game", {
    configurable: true,
    get: () => game,
    set: (v) => {
      game = v;
      if (marks.gameReady === undefined) {
        marks.gameReady = performance.now();
        requestAnimationFrame(() => {
          marks.firstFrameAfterReady = performance.now();
        });
      }
    },
  });
  Object.defineProperty(w, "__vcEngine", {
    configurable: true,
    get: () => host,
    set: (v) => {
      host = v;
      if (marks.engineHosted === undefined) marks.engineHosted = performance.now();
    },
  });
}

export interface PageInfo {
  /** What actually runs the live tower: "wasm" only when the host holds it
   *  with no errors and the live sim is the hosted instance. */
  engineActive: "ts" | "wasm";
  host: { present: boolean; hosted: boolean; starts: number; errors: string[]; liveSimHosted: boolean };
  marks: Record<string, number>;
  navigation: { responseEnd: number; domContentLoaded: number; loadEventEnd: number; transferSize: number } | null;
  resources: { name: string; startTime: number; responseEnd: number; transferSize: number; encodedBodySize: number; decodedBodySize: number }[];
  crossOriginIsolated: boolean;
  timerResolutionMs: number;
  userAgent: string;
  viewport: { width: number; height: number; dpr: number };
  webgl: { renderer: string; vendor: string } | null;
}

export function pageInfo(): PageInfo {
  const w = window as any;
  const h = w.__vcEngine;
  const liveSimHosted = Boolean(w.game?.sim) && Object.prototype.hasOwnProperty.call(w.game.sim, "serialize");
  const host = {
    present: Boolean(h),
    hosted: Boolean(h?.status?.hosted),
    starts: Number(h?.status?.starts ?? 0),
    errors: [...((h?.status?.errors ?? []) as string[])],
    liveSimHosted,
  };
  const engineActive = host.present && host.hosted && host.errors.length === 0 && Boolean(h.current?.()) && liveSimHosted ? "wasm" : "ts";
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  // The smallest step performance.now() takes here, sampled.
  let res = Infinity;
  let last = performance.now();
  for (let i = 0; i < 200000 && res > 0.0005; i++) {
    const now = performance.now();
    if (now > last) {
      res = Math.min(res, now - last);
      last = now;
    }
  }
  let webgl: PageInfo["webgl"] = null;
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    if (gl && ext) webgl = { renderer: String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)), vendor: String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)) };
  } catch {
    webgl = null;
  }
  return {
    engineActive,
    host,
    marks: { ...(w.__perfMarks ?? {}) },
    navigation: nav ? { responseEnd: nav.responseEnd, domContentLoaded: nav.domContentLoadedEventEnd, loadEventEnd: nav.loadEventEnd, transferSize: nav.transferSize } : null,
    resources: (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).map((r) => ({
      name: new URL(r.name).pathname,
      startTime: r.startTime,
      responseEnd: r.responseEnd,
      transferSize: r.transferSize,
      encodedBodySize: r.encodedBodySize,
      decodedBodySize: r.decodedBodySize,
    })),
    crossOriginIsolated: Boolean((globalThis as any).crossOriginIsolated),
    timerResolutionMs: res,
    userAgent: navigator.userAgent,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    webgl,
  };
}

/** Keep a scenario's save in the page, so it crosses the boundary once. */
export function stashSave(arg: { name: string; save: string }): number {
  const w = window as any;
  w.__perfSaves = w.__perfSaves ?? {};
  w.__perfSaves[arg.name] = arg.save;
  return arg.save.length;
}

/**
 * The comparison digest of a save stashed by {@link simRun}: the conformance
 * state view (the save minus the player-copy prose, as
 * `src/engine/conformanceView.ts` defines it) as canonical JSON, SHA-256,
 * first 16 hex digits. That is the conformance lock's own `stateDigest`
 * (`src/tests/conformance/canonical.ts`), so a browser digest compares
 * directly with the Node check's. Both engines' saves pass through the same
 * JSON.parse and the same printer here. The crowd is not in a save; the
 * Node check compares it with the conformance crowd digest.
 */
export async function digestStashed(key: string): Promise<string> {
  const w = window as any;
  const save = w.__perfStash?.[key];
  if (save === undefined) throw new Error(`nothing stashed under ${key}`);
  const stable = (v: unknown): string => {
    if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
    if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : stable(x))).join(",")}]`;
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
  };
  const data = { ...(save as Record<string, unknown>) };
  if (Array.isArray(data.log)) data.log = (data.log as Record<string, unknown>[]).map(({ text: _t, ...rest }) => rest);
  const ev = data.events as { pending?: Record<string, unknown> | null } | undefined;
  if (ev?.pending) {
    const { message: _m, ...pending } = ev.pending;
    data.events = { ...ev, pending };
  }
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stable(data))));
  delete w.__perfStash[key];
  return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

/** Calm the live app for scripted measurement, the way e2e/perf.spec.ts
 *  does: no title screen, no modal emergencies, no autosave, steady clock,
 *  paused. Identical on both engines. */
export function prepareLiveApp(): void {
  const g = (window as any).game;
  document.getElementById("splash")?.remove();
  g.sim.events.pending = null;
  g.ui.showEventChoice = (_m: string, _c: string, onResolve: (opt: "accept" | "decline") => void) => onResolve("decline");
  g.shownWin = true;
  g.shownChoice = false;
  g.shownUpdate = false;
  g.prefs.steadyClock = true;
  if (g.saveLoad) g.saveLoad.autosave = () => {};
  g.speed = 0;
  g.engine.paused = true;
}

export interface AdoptResult {
  adoptMs: number;
  engineActive: "ts" | "wasm";
  starts: number;
  population: number;
}

/** Load a stashed scenario into the live app through `adoptSim`, the path a
 *  player's load takes on either engine. */
export function adoptScenario(name: string): AdoptResult {
  const w = window as any;
  const g = w.game;
  const save = w.__perfSaves[name] as string;
  const t0 = performance.now();
  const sim = g.sim.constructor.deserialize(JSON.parse(save));
  g.adoptSim(sim);
  const adoptMs = performance.now() - t0;
  g.speed = 0;
  g.engine.paused = true;
  g.sim.events.pending = null;
  const h = w.__vcEngine;
  const hosted = Boolean(h?.status?.hosted) && (h.status.errors as string[]).length === 0 && Boolean(h.current()) && Object.prototype.hasOwnProperty.call(g.sim, "serialize");
  return { adoptMs, engineActive: hosted ? "wasm" : "ts", starts: Number(h?.status?.starts ?? 0), population: g.sim.population };
}

export interface SimRun {
  mode: "hosted" | "raw";
  engineActive: "ts" | "wasm";
  steps: number;
  dt: number;
  /** Time to make the measured instance from the save (raw only). */
  loadMs: number;
  totalMs: number;
  stepMs: number[];
  /** Hosted WASM only: time inside the engine's tick, inside the exports
   *  the host reads back (serialize, frameView, logSince, telemetry), and
   *  the JavaScript remainder (decode, merge, read-model sync). */
  attribution: { engineTickMs: number; engineExportMs: number; hostJsMs: number; merges: number } | null;
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
 */
export async function simRun(arg: { name: string; mode: "hosted" | "raw"; engine: "ts" | "wasm"; steps: number; warmSteps: number; dt: number; engineUrl: string }): Promise<SimRun> {
  const w = window as any;
  const g = w.game;
  const save = w.__perfSaves[arg.name] as string;
  // The start and end saves are stashed for digestStashed, so the digest
  // code exists once in the page.
  w.__perfStash = w.__perfStash ?? {};
  const Sim = g.sim.constructor;

  // A uniform driver over the three kinds of instance.
  interface Driver { tick(dt: number): void; save(): unknown; fields(): { minutes: number; money: number; star: number; population: number; people: number }; free(): void }
  let mod: any = null;
  if (arg.mode === "raw" && arg.engine === "wasm") {
    mod = await import(/* @vite-ignore */ arg.engineUrl);
    await mod.default();
  }
  const make = (): { d: Driver; loadMs: number } => {
    const t0 = performance.now();
    if (arg.mode === "hosted") {
      const sim = Sim.deserialize(JSON.parse(save));
      g.adoptSim(sim);
      g.speed = 0;
      g.engine.paused = true;
      g.sim.events.pending = null;
      const live = g.sim;
      return {
        loadMs: performance.now() - t0,
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
      d: {
        tick: (dt) => e.tick(dt),
        save: () => JSON.parse(e.serialize()),
        fields: () => {
          const s = JSON.parse(e.serialize());
          const sim = Sim.deserialize(s);
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
  const { d, loadMs } = make();
  const tag = `${arg.name}:${arg.mode}:${arg.engine}:${performance.now()}`;
  w.__perfStash[`${tag}:start`] = d.save();

  // Attribution wrappers on the hosted engine (WASM project only).
  const h = w.__vcEngine?.current?.();
  const hostedWasm = arg.mode === "hosted" && Boolean(h) && Object.prototype.hasOwnProperty.call(g.sim, "serialize");
  const acc = { tick: 0, exp: 0 };
  const restore: (() => void)[] = [];
  const mergesBefore = hostedWasm ? (h.merges as number) : 0;
  if (hostedWasm) {
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
  const sum = stepMs.reduce((s, x) => s + x, 0);
  return {
    mode: arg.mode,
    engineActive: hostedWasm || (arg.mode === "raw" && arg.engine === "wasm") ? "wasm" : "ts",
    steps: arg.steps,
    dt: arg.dt,
    loadMs,
    totalMs,
    stepMs,
    attribution: hostedWasm ? { engineTickMs: acc.tick, engineExportMs: acc.exp, hostJsMs: Math.max(0, sum - acc.tick - acc.exp), merges: (h.merges as number) - mergesBefore } : null,
    startKey: `${tag}:start`,
    endKey: `${tag}:end`,
    end: f,
  };
}

export interface FrameRun {
  intervalsMs: number[];
  wallMs: number;
  simMinutes: number;
  tickMs: number;
  ticks: number;
  uiMs: number;
  engineActive: "ts" | "wasm";
}

/**
 * Gameplay frames: the real frame loop at the fastest speed (steady clock,
 * emergencies declined, autosave off), sampled by rAF for `windowMs` after
 * `warmMs`. Time inside `sim.tick` and `ui.update` is summed alongside, so
 * the report can tell engine time from the rest of the frame.
 */
export function measureFrames(arg: { windowMs: number; warmMs: number; speed: number }): Promise<FrameRun> {
  const w = window as any;
  const g = w.game;
  const sim = g.sim;
  const ui = g.ui;
  const ownTick = Object.getOwnPropertyDescriptor(sim, "tick");
  const ownUpdate = Object.getOwnPropertyDescriptor(ui, "update");
  const tick = sim.tick;
  const update = ui.update;
  const acc = { tick: 0, ticks: 0, ui: 0, on: false };
  sim.tick = function (this: unknown, dt: number) {
    const t = performance.now();
    try {
      return tick.call(this, dt);
    } finally {
      if (acc.on) {
        acc.tick += performance.now() - t;
        acc.ticks++;
      }
    }
  };
  ui.update = function (this: unknown, ...a: unknown[]) {
    const t = performance.now();
    try {
      return update.apply(this, a);
    } finally {
      if (acc.on) acc.ui += performance.now() - t;
    }
  };
  g.speed = arg.speed;
  g.engine.paused = false;
  const h = w.__vcEngine?.current?.();
  const engineActive: "ts" | "wasm" = h && Object.prototype.hasOwnProperty.call(sim, "serialize") ? "wasm" : "ts";
  return new Promise<FrameRun>((resolve) => {
    const intervals: number[] = [];
    let start = 0;
    let startMinutes = 0;
    let last = 0;
    const begin = performance.now();
    const done = (): void => {
      g.speed = 0;
      g.engine.paused = true;
      acc.on = false;
      if (ownTick) Object.defineProperty(sim, "tick", ownTick);
      else delete sim.tick;
      if (ownUpdate) Object.defineProperty(ui, "update", ownUpdate);
      else delete ui.update;
      resolve({ intervalsMs: intervals, wallMs: last - start, simMinutes: sim.clock.minutes - startMinutes, tickMs: acc.tick, ticks: acc.ticks, uiMs: acc.ui, engineActive });
    };
    const frame = (ts: number): void => {
      if (start === 0) {
        if (ts - begin >= arg.warmMs) {
          start = ts;
          last = ts;
          startMinutes = sim.clock.minutes;
          acc.on = true;
        }
        requestAnimationFrame(frame);
        return;
      }
      intervals.push(ts - last);
      last = ts;
      if (ts - start >= arg.windowMs) done();
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

/** Size of the engine's linear memory, when the page has loaded it. */
export async function wasmMemoryBytes(engineUrl: string): Promise<number | null> {
  const w = window as any;
  if (!w.__vcEngine) return null;
  const mod = await import(/* @vite-ignore */ engineUrl);
  const exports = await mod.default();
  return (exports.memory as WebAssembly.Memory).buffer.byteLength;
}

export interface WasmColdLoad {
  fetchMs: number;
  bytes: number;
  compileMs: number;
  instantiateMs: number;
  firstEngineMs: number;
}

/**
 * The engine package's load steps, timed apart, in a page that has never
 * compiled it (run on the TypeScript project, last): download the bytes,
 * compile them, instantiate the glue (a cache-busted copy, so it is a fresh
 * module), and build the first Engine from the boot tower's save.
 */
export async function wasmColdLoad(arg: { wasmUrl: string; jsUrl: string }): Promise<WasmColdLoad> {
  const g = (window as any).game;
  let t = performance.now();
  const bytes = await (await fetch(arg.wasmUrl, { cache: "no-store" })).arrayBuffer();
  const fetchMs = performance.now() - t;
  t = performance.now();
  const module = await WebAssembly.compile(bytes);
  const compileMs = performance.now() - t;
  const glue = await import(/* @vite-ignore */ `${arg.jsUrl}?cold=${Date.now()}`);
  t = performance.now();
  glue.initSync({ module });
  const instantiateMs = performance.now() - t;
  const save = JSON.stringify(g.sim.serialize());
  t = performance.now();
  glue.Engine.fromSave(save).free();
  const firstEngineMs = performance.now() - t;
  return { fetchMs, bytes: bytes.byteLength, compileMs, instantiateMs, firstEngineMs };
}
