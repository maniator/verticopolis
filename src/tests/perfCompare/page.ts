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
 *  moment the WASM host publishes `window.__vcEngine`, by accessor, and the
 *  engine package's instantiate on the boot path, so the startup numbers
 *  need no polling and no change to the app. */
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
  // Count the audio contexts the page makes, so a run can say whether
  // audio really started (Tone.js makes one on the first start()).
  const contexts: { state: string }[] = [];
  w.__perfAudioContexts = contexts;
  const Ctx = w.AudioContext as (new (...a: unknown[]) => { state: string }) | undefined;
  if (Ctx) {
    w.AudioContext = class extends (Ctx as new (...a: unknown[]) => { state: string }) {
      constructor(...a: unknown[]) {
        super(...a);
        contexts.push(this);
      }
    };
  }
  // Time the engine package's compile and instantiate on the app's own boot
  // path (wasm-bindgen's loader calls instantiateStreaming, or instantiate
  // as its fallback): the first call's start and end.
  const wa = WebAssembly as any;
  for (const name of ["instantiateStreaming", "instantiate"]) {
    const orig = wa[name];
    if (typeof orig !== "function") continue;
    wa[name] = function (this: unknown, ...a: unknown[]) {
      const t = performance.now();
      const p = orig.apply(this, a) as Promise<unknown>;
      marks.wasmInstantiateCalls = (marks.wasmInstantiateCalls ?? 0) + 1;
      if (marks.wasmInstantiateStart === undefined) {
        marks.wasmInstantiateStart = t;
        marks.wasmInstantiateVia = name === "instantiateStreaming" ? 1 : 2;
        p.then(
          () => (marks.wasmInstantiateEnd = performance.now()),
          () => (marks.wasmInstantiateEnd = -1),
        );
      }
      return p;
    };
  }
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
    // -1 when the clock never moved in the sampling loop.
    timerResolutionMs: Number.isFinite(res) ? res : -1,
    userAgent: navigator.userAgent,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
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
  const data = { ...((typeof save === "string" ? JSON.parse(save) : save) as Record<string, unknown>) };
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
 *  does: no title screen, no autosave, steady clock, paused, and an
 *  emergency answered "decline" the moment the frame loop raises it (through
 *  `sim.resolveChoice`, which the WASM host relays, so both engines see the
 *  same answer; the pending field itself is never written, since a write to
 *  the read model would not reach the engine). Identical on both engines. */
export function prepareLiveApp(): void {
  const g = (window as any).game;
  document.getElementById("splash")?.remove();
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
 *  player's load takes on either engine. On WASM it counts as hosted only
 *  when this adopt started a new engine and raised no new host error. */
export function adoptScenario(name: string): AdoptResult {
  const w = window as any;
  const g = w.game;
  const save = w.__perfSaves[name] as string;
  const h = w.__vcEngine;
  const startsBefore = Number(h?.status?.starts ?? 0);
  const errorsBefore = ((h?.status?.errors ?? []) as string[]).length;
  const t0 = performance.now();
  const sim = g.sim.constructor.deserialize(JSON.parse(save));
  g.adoptSim(sim);
  const adoptMs = performance.now() - t0;
  g.speed = 0;
  g.engine.paused = true;
  const hosted =
    Boolean(h?.status?.hosted) &&
    Number(h.status.starts) === startsBefore + 1 &&
    (h.status.errors as string[]).length === errorsBefore &&
    Boolean(h.current()) &&
    Object.prototype.hasOwnProperty.call(g.sim, "serialize");
  return { adoptMs, engineActive: hosted ? "wasm" : "ts", starts: Number(h?.status?.starts ?? 0), population: g.sim.population };
}

/** Size of the engine's linear memory, when the page hosts the tower on it
 *  (the loader's init returns the instance the app already made). The runner
 *  calls it on the WASM process only, so a TypeScript page never loads it. */
export async function wasmMemoryBytes(engineUrl: string): Promise<number | null> {
  const w = window as any;
  if (!w.__vcEngine?.status?.hosted) return null;
  const before = w.__perfMarks?.wasmInstantiateCalls ?? 0;
  const mod = await import(/* @vite-ignore */ engineUrl);
  const exports = await mod.default();
  // A second instantiate would mean this read a fresh module, not the app's.
  if ((w.__perfMarks?.wasmInstantiateCalls ?? 0) !== before || before === 0) throw new Error("the WASM memory read did not reach the instance the app booted");
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
 * module), and build the first Engine from a fixed scenario's save. This is a
 * step-by-step stand-in: the app itself streams the compile
 * (instantiateStreaming), which the boot-path probe times on the WASM
 * process.
 */
export async function wasmColdLoad(arg: { wasmUrl: string; jsUrl: string; scenario: string }): Promise<WasmColdLoad> {
  const save = (window as any).__perfSaves[arg.scenario] as string;
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
  t = performance.now();
  glue.Engine.fromSave(save).free();
  const firstEngineMs = performance.now() - t;
  return { fetchMs, bytes: bytes.byteLength, compileMs, instantiateMs, firstEngineMs };
}

/** A fixed CPU-bound loop, timed: run once unthrottled and once under the
 *  4x cold start, so the report can show the throttle really applied. */
export function cpuProbe(): number {
  const t = performance.now();
  let x = 0;
  for (let i = 0; i < 20_000_000; i++) x = (x + i * 7) % 1_000_003;
  const ms = performance.now() - t;
  (globalThis as unknown as { __perfSink?: number }).__perfSink = x;
  return ms;
}

/**
 * The WebGL adapter this page gets: the unmasked renderer and vendor, or the
 * plain `RENDERER` and `VENDOR` when the debug extension is missing. Null when
 * no context could be made or the renderer is not a non-empty string (a lost
 * context answers null, which must never be recorded as the text "null").
 * The game asks for webgl2 first, so the probe does too. The probe's context
 * is released at once, so the renderer is read again later (after the frames)
 * from a new context, and a GPU process that died in between shows.
 */
export function webglRenderer(): { renderer: string; vendor: string } | null {
  try {
    const canvas = document.createElement("canvas");
    // The game asks for the high-performance adapter, so a machine with two GPUs names the one the game uses.
    const gl = (canvas.getContext("webgl2", { powerPreference: "high-performance" }) ?? canvas.getContext("webgl", { powerPreference: "high-performance" })) as WebGLRenderingContext | null;
    if (!gl) return null;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    const vendor = gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    if (typeof renderer !== "string" || !renderer.trim()) return null;
    return { renderer: renderer.trim(), vendor: typeof vendor === "string" ? vendor.trim() : "" };
  } catch {
    return null;
  }
}
