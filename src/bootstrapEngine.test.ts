import { afterEach, describe, expect, it, vi } from "vitest";
import { bootGame } from "./bootstrap";

// The telemetry SDKs are gated on the host and best-effort; stub them so the
// gate and its catch can be asserted without touching the real endpoints.
vi.mock("@vercel/speed-insights", () => ({ injectSpeedInsights: vi.fn() }));
vi.mock("@vercel/analytics", () => ({ inject: vi.fn() }));
// Mock `virtual:pwa-register` (Vite virtual module via bootstrap.ts/pwa.ts) so the import resolves on Windows too (as pwa.test.ts does).
vi.mock("virtual:pwa-register", () => ({ registerSW: () => () => {} }));
// The WASM engine switch: the request and the package load are stubbed so the
// fallback (package fails to load, the game boots on the TypeScript engine)
// can be asserted without a package.
const wasmStub = vi.hoisted(() => ({ requested: "ts" as "ts" | "wasm" | "wasm-worker", loadError: null as Error | null, module: null as unknown, workerError: null as Error | null, binary: null as { state: "ok"; sourceHash: string } | null }));
vi.mock("./wasmhost/engineChoice", async (importOriginal) => {
  const real = await importOriginal<typeof import("./wasmhost/engineChoice")>();
  return { ...real, engineRequested: () => wasmStub.requested };
});
vi.mock("./wasmhost/startWasmHost", async (importOriginal) => {
  const real = await importOriginal<typeof import("./wasmhost/startWasmHost")>();
  return {
    ...real,
    loadWasmEngine: vi.fn(async (_url?: string, _signal?: AbortSignal, opts?: { onBuild?: (b: unknown) => void }) => {
      if (wasmStub.binary) opts?.onBuild?.(wasmStub.binary);
      if (wasmStub.module) return wasmStub.module;
      throw wasmStub.loadError ?? new Error("no package in this test");
    }),
    startWasmHost: vi.fn(() => ({ status: { engine: "wasm", starts: 1, hosted: true, errors: [] }, current: () => null, stop: () => {} })),
  };
});
// The experimental worker host (`?engine=wasm-worker`): the spawn and the
// start are stubbed so the boot state it publishes can be asserted.
vi.mock("./wasmhost/workerController", async (importOriginal) => {
  const real = await importOriginal<typeof import("./wasmhost/workerController")>();
  return {
    ...real,
    spawnEngineWorker: vi.fn(async () => {
      if (wasmStub.workerError) throw Object.assign(wasmStub.workerError, wasmStub.binary ? { build: wasmStub.binary } : {});
      const catalog = (await import("./wasmhost/fakeEngine.fixture")).fakeModule().catalog as (m: string) => string; // this build's own catalogs
      return { worker: { terminate: vi.fn() }, catalogs: { classic: catalog("classic"), modern: catalog("modern") }, ...(wasmStub.binary ? { build: wasmStub.binary } : {}) };
    }),
    startWorkerHost: vi.fn(() => ({ status: { hosted: true, errors: [] as string[] }, stop: vi.fn() })),
  };
});
// The relay, so the reliability rows (`engine_status`) can be read back.
vi.mock("./analyticsRelay", () => ({ sendToRelay: vi.fn() }));
import { startWasmHost, type WasmHostOptions } from "./wasmhost/startWasmHost";
import { sendToRelay } from "./analyticsRelay";
import { resetEngineStatus } from "./analyticsEngineStatus";
import { startWorkerHost } from "./wasmhost/workerController";
import * as pwa from "./pwa";
import { Simulation } from "./engine/Simulation";
import { SaveGame } from "./storage/SaveGame";
import { setEngineWriter } from "./storage/vctowerWriter";
import { HOST_ERROR_HISTORY } from "./wasmhost/hostErrors";
import { EngineBootError } from "./wasmhost/engineBoot";

/** Make hasWebGL() see a real GL context (happy-dom canvas returns null). */
function stubWebGL(): void {
  const real = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "canvas") return { getContext: () => ({}) } as unknown as HTMLCanvasElement;
    return real(tag);
  });
}

/** Ask for the main-thread WASM engine, whose save writer is recorded. */
function requestWasm(): ReturnType<typeof vi.fn> {
  stubWebGL();
  wasmStub.requested = "wasm";
  const encodeVctower = vi.fn(() => "VCTOWER1\nZW5naW5l\n");
  wasmStub.module = { Engine: class {}, encodeVctower };
  return encodeVctower;
}

/**
 * The engine half of `bootGame`: which engine boot settles on, the boot state
 * it publishes (`window.__vcEngineBoot`) and the save writer, for the
 * main-thread WASM host and the experimental worker host. Split from
 * bootstrap.test.ts, which keeps the rest of boot.
 */
describe("bootGame engine", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    document.body.innerHTML = "";
    delete (window as unknown as { game?: unknown }).game;
  });

  it("boots on the TypeScript engine, with the reason logged, when the requested WASM package fails to load", async () => {
    stubWebGL();
    wasmStub.requested = "wasm";
    wasmStub.loadError = new Error("404 engine/verticopolis_engine.js");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = { onUpdateAvailable: vi.fn() };
    const create = vi.fn(() => app);
    try {
      await bootGame(create);
      expect(create).toHaveBeenCalledTimes(1);
      expect(startWasmHost).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(expect.stringContaining("[wasm]"), wasmStub.loadError);
      expect(document.getElementById("boot-fallback-host")).toBeNull();
      // A switchable build reports the engine it settled on, and why.
      expect((globalThis as { __vcEngineBoot?: unknown }).__vcEngineBoot).toEqual({ build: "switchable", engine: "ts", failure: { stage: "load", reason: "boot-error", message: "404 engine/verticopolis_engine.js" } });
    } finally {
      wasmStub.requested = "ts";
      wasmStub.loadError = null;
    }
  });

  it("publishes the worker host as the WASM engine, and a worker that fails as a fallback with its reason", async () => {
    stubWebGL();
    wasmStub.requested = "wasm-worker";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const boot = () => (globalThis as { __vcEngineBoot?: unknown }).__vcEngineBoot;
    vi.mocked(startWorkerHost).mockClear();
    vi.mocked(startWasmHost).mockClear();
    try {
      await bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn() })));
      expect(startWorkerHost).toHaveBeenCalledTimes(1);
      expect(startWasmHost).not.toHaveBeenCalled();
      expect(boot()).toEqual({ build: "switchable", engine: "wasm", failure: null });
      vi.mocked(startWorkerHost).mockImplementationOnce(() => {
        throw new Error("no worker host");
      });
      await bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn() })));
      expect(boot()).toEqual({ build: "switchable", engine: "ts", failure: { stage: "start", reason: "boot-error", message: "no worker host" } });
      // A later throw lets the started host go, so the state stops claiming it.
      vi.spyOn(pwa, "registerPWA").mockImplementationOnce(() => {
        throw new Error("no service worker");
      });
      await expect(bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn() })))).rejects.toThrow("no service worker");
      // The throw came from outside the engine, so it is coded `other`.
      expect(boot()).toEqual({ build: "switchable", engine: "ts", failure: { stage: "start", reason: "other", message: "no service worker" } });
      // A refused first tower is not thrown: the host reports it and stays.
      // The message is the status's latest error, which a full list no longer
      // ends with (#1059).
      const full = Array.from({ length: HOST_ERROR_HISTORY }, (_, i) => `older failure ${i + 1}`);
      vi.mocked(startWorkerHost).mockImplementationOnce(
        () => ({ status: { hosted: false, errors: full, lastError: "not hosting this tower: it has a crowd", droppedErrors: 1 }, stop: vi.fn() }) as never,
      );
      await bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn() })));
      expect(boot()).toEqual({ build: "switchable", engine: "ts", failure: { stage: "start", reason: "attach-refused", message: "not hosting this tower: it has a crowd" } });
      wasmStub.workerError = new Error("the engine worker did not answer ready");
      vi.mocked(startWorkerHost).mockClear();
      await bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn() })));
      expect(startWorkerHost).not.toHaveBeenCalled();
      expect(boot()).toEqual({ build: "switchable", engine: "ts", failure: { stage: "load", reason: "boot-error", message: "the engine worker did not answer ready" } });
      expect(error).toHaveBeenCalledWith(expect.stringContaining("[wasm-worker]"), expect.any(Error));
    } finally {
      wasmStub.requested = "ts";
      wasmStub.workerError = null;
    }
  });

  it("keeps what the binary's build section said on the boot state, for a package that loaded and one that did not link", async () => {
    stubWebGL();
    const binary = { state: "ok", sourceHash: "a".repeat(64) } as const;
    const boot = () => (globalThis as { __vcEngineBoot?: unknown }).__vcEngineBoot;
    vi.spyOn(console, "error").mockImplementation(() => {});
    wasmStub.binary = binary;
    try {
      wasmStub.requested = "wasm";
      wasmStub.module = { Engine: class {} };
      await bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn() })));
      expect(boot()).toEqual({ build: "switchable", engine: "wasm", failure: null, binary });
      // The binary was read, then the glue and binary did not link.
      wasmStub.module = null;
      wasmStub.loadError = new WebAssembly.LinkError("import mismatch");
      await bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn() })));
      expect(boot()).toEqual({ build: "switchable", engine: "ts", failure: { stage: "load", reason: "package-mismatch", message: "import mismatch" }, binary });
      // The worker host: the worker read it, whether it then answered ready or failed.
      wasmStub.requested = "wasm-worker";
      wasmStub.loadError = null;
      await bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn() })));
      expect(boot()).toEqual({ build: "switchable", engine: "wasm", failure: null, binary });
      wasmStub.workerError = new Error("link failed in the worker");
      await bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn() })));
      expect(boot()).toEqual({ build: "switchable", engine: "ts", failure: { stage: "load", reason: "boot-error", message: "link failed in the worker" }, binary });
    } finally {
      wasmStub.requested = "ts";
      wasmStub.module = null;
      wasmStub.loadError = null;
      wasmStub.workerError = null;
      wasmStub.binary = null;
    }
  });

  it("writes saves through the engine once the WASM engine starts", async () => {
    const encodeVctower = requestWasm();
    try {
      await bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn() })));
      expect(startWasmHost).toHaveBeenCalled();
      expect((globalThis as { __vcEngineBoot?: unknown }).__vcEngineBoot).toEqual({ build: "switchable", engine: "wasm", failure: null });
      expect(await SaveGame.export(new Simulation(1))).toBe("VCTOWER1\nZW5naW5l\n");
      expect(encodeVctower).toHaveBeenCalledTimes(1);
    } finally {
      setEngineWriter(null);
      wasmStub.requested = "ts";
      wasmStub.module = null;
    }
  });

  it("leaves saves on the TypeScript writer when the WASM host does not start", async () => {
    const encodeVctower = requestWasm();
    vi.mocked(startWasmHost).mockImplementationOnce(() => {
      throw new Error("no host");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn() })));
      expect(error).toHaveBeenCalledWith(expect.stringContaining("[wasm]"), expect.any(Error));
      // The fallback is recorded with its reason (#874) as well as logged.
      expect((globalThis as { __vcEngineBoot?: unknown }).__vcEngineBoot).toEqual({ build: "switchable", engine: "ts", failure: { stage: "start", reason: "boot-error", message: "no host" } });
      expect(await SaveGame.export(new Simulation(1))).toMatch(/^VCTOWER1\n/);
      expect(encodeVctower).not.toHaveBeenCalled();
    } finally {
      setEngineWriter(null);
      wasmStub.requested = "ts";
      wasmStub.module = null;
    }
  });

  it("records a switchable build's refused first tower as a fallback to TypeScript", async () => {
    const encodeVctower = requestWasm();
    // The message is the latest error, which a full list no longer holds (#1059).
    const full = Array.from({ length: HOST_ERROR_HISTORY }, () => "an earlier error");
    vi.mocked(startWasmHost).mockImplementationOnce(() => ({ status: { engine: "wasm", starts: 0, hosted: false, fallbacks: 1, lastFallback: { reason: "attach-refused", stage: "start" }, latched: false, restorePoint: null, errors: full, lastError: "not hosting this tower: it has a crowd", droppedErrors: 1 }, current: () => null, stop: () => {} }));
    try {
      await bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn() })));
      expect((globalThis as { __vcEngineBoot?: unknown }).__vcEngineBoot).toEqual({ build: "switchable", engine: "ts", failure: { stage: "start", reason: "attach-refused", message: "not hosting this tower: it has a crowd" } });
      // The host follows every later adopt, so saves keep the engine's writer.
      expect(await SaveGame.export(new Simulation(1))).toBe("VCTOWER1\nZW5naW5l\n");
      expect(encodeVctower).toHaveBeenCalledTimes(1);
    } finally {
      setEngineWriter(null);
      wasmStub.requested = "ts";
      wasmStub.module = null;
    }
  });
});

const lastRow = (xs: Record<string, unknown>[]): Record<string, unknown> | undefined => xs[xs.length - 1];
const bootState = (): unknown => (globalThis as { __vcEngineBoot?: unknown }).__vcEngineBoot;

/** Every `engine_status` row the relay saw, in order. */
const engineRows = (): Record<string, unknown>[] =>
  vi
    .mocked(sendToRelay)
    .mock.calls.filter(([name]) => name === "engine_status")
    .map(([, props]) => props as Record<string, unknown>);

/**
 * The reliability instrument's wiring (issue #1081): the row boot sends once
 * it has picked its engine, the later fallbacks the host reports, and the
 * writer latch-off, all as codes, never the messages behind them.
 */
describe("bootGame engine_status", () => {
  const secret = "could not read /home/player/My Secret Tower.vctower";

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    delete (window as unknown as { game?: unknown }).game;
    window.location.href = "http://localhost:3000/";
    setEngineWriter(null);
    wasmStub.requested = "ts";
    wasmStub.loadError = null;
    wasmStub.module = null;
    wasmStub.workerError = null;
  });

  const boot = async (game: Record<string, unknown> = {}) => {
    resetEngineStatus();
    vi.mocked(sendToRelay).mockClear();
    window.location.href = "https://verticopolis.com/";
    await bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn(), ...game })));
  };

  it("reports the TypeScript default, once", async () => {
    stubWebGL();
    await boot();
    expect(engineRows()).toEqual([expect.objectContaining({ trigger: "settle", engine_requested: "ts", engine: "ts", build: "switchable", fallback_reason: "none", fallbacks: 0 })]);
  });

  it("reports a package that failed to load by its code, with none of the message", async () => {
    stubWebGL();
    vi.spyOn(console, "error").mockImplementation(() => {});
    wasmStub.requested = "wasm";
    wasmStub.loadError = new Error(secret);
    await boot();
    expect(engineRows()).toEqual([expect.objectContaining({ engine_requested: "wasm", engine: "ts-fallback", fallback_reason: "boot-error", fallback_stage: "load", fallbacks: 1 })]);
    expect(JSON.stringify(vi.mocked(sendToRelay).mock.calls)).not.toMatch(/Secret|player|vctower/);
  });

  it("reports a worker that did not start as a fallback at the load", async () => {
    stubWebGL();
    vi.spyOn(console, "error").mockImplementation(() => {});
    wasmStub.requested = "wasm-worker";
    wasmStub.workerError = new Error(secret);
    await boot();
    expect(engineRows()).toEqual([expect.objectContaining({ engine_requested: "wasm-worker", engine: "ts-fallback", fallback_reason: "boot-error", fallback_stage: "load" })]);
    expect(JSON.stringify(vi.mocked(sendToRelay).mock.calls)).not.toMatch(/Secret/);
  });

  it("counts a refused first tower once, then each later tower the host refuses", async () => {
    requestWasm();
    let opts: WasmHostOptions | undefined;
    vi.mocked(startWasmHost).mockImplementationOnce((_app, _mod, _log, o) => {
      opts = o;
      // The real host reports the first refusal through onFallback as well.
      o?.onFallback?.({ reason: "attach-refused", stage: "start" }, false);
      return { status: { engine: "wasm", starts: 0, hosted: false, fallbacks: 1, lastFallback: { reason: "attach-refused", stage: "start" }, latched: false, restorePoint: null, errors: [`not hosting this tower: ${secret}`], lastError: `not hosting this tower: ${secret}`, droppedErrors: 0 }, current: () => null, stop: () => {} };
    });
    await boot();
    expect(engineRows()).toEqual([expect.objectContaining({ trigger: "settle", engine: "ts-fallback", fallback_reason: "attach-refused", fallback_stage: "start", fallbacks: 1 })]);
    opts?.onFallback?.({ reason: "attach-refused", stage: "adopt" }, false);
    expect(lastRow(engineRows())).toMatchObject({ trigger: "fallback", fallback_stage: "adopt", fallbacks: 2 });
    expect(JSON.stringify(vi.mocked(sendToRelay).mock.calls)).not.toMatch(/Secret/);
  });

  it("reports the engine writer turning itself off, on the boot state too", async () => {
    stubWebGL();
    vi.spyOn(console, "error").mockImplementation(() => {});
    wasmStub.requested = "wasm";
    wasmStub.module = { Engine: class {}, encodeVctower: () => "not a tower file" };
    await boot();
    expect(engineRows()).toEqual([expect.objectContaining({ trigger: "settle", engine: "wasm", writer_latched: false })]);
    expect(bootState()).toEqual({ build: "switchable", engine: "wasm", failure: null });
    await SaveGame.export(new Simulation(1));
    expect(lastRow(engineRows())).toMatchObject({ trigger: "writer-latch", engine: "wasm", writer_latched: true });
    expect(bootState()).toEqual({ build: "switchable", engine: "wasm", failure: null, writerLatched: true });
  });

  it("records a switchable build's running engine fault on the boot state, turns the engine writer off and shows no stop (#874)", async () => {
    const encodeVctower = requestWasm();
    let opts: WasmHostOptions | undefined;
    const status = { engine: "wasm" as const, starts: 1, hosted: true, fallbacks: 0, errors: [] as string[], lastError: null as string | null, droppedErrors: 0 };
    vi.mocked(startWasmHost).mockImplementationOnce((_app, _mod, _log, o) => {
      opts = o;
      return { status, current: () => null, stop: () => {} } as never;
    });
    const setSpeed = vi.fn();
    await boot({ setSpeed });
    expect(opts?.strict).toBeUndefined();
    expect(await SaveGame.export(new Simulation(1))).toBe("VCTOWER1\nZW5naW5l\n");
    expect(encodeVctower).toHaveBeenCalledTimes(1);
    // The engine traps in a tick; the host has frozen it and moves the game
    // to TypeScript.
    status.lastError = `the WASM engine failed during a tick: ${secret}`;
    opts?.onFallback?.({ reason: "trap-tick", stage: "start" }, true);
    expect(bootState()).toEqual({ build: "switchable", engine: "ts", failure: { stage: "host", reason: "trap-tick", message: status.lastError } });
    // The game runs on: no stop message, and the clock is left alone.
    expect(document.getElementById("engine-failure")).toBeNull();
    expect(setSpeed).not.toHaveBeenCalled();
    // Saves go back to the TypeScript writer: the trapped module is not asked.
    expect(await SaveGame.export(new Simulation(1))).toMatch(/^VCTOWER1\n/);
    expect(encodeVctower).toHaveBeenCalledTimes(1);
    expect(lastRow(engineRows())).toMatchObject({ trigger: "fallback", engine: "ts-fallback", fallback_reason: "trap-tick", fallbacks: 1 });
    expect(JSON.stringify(vi.mocked(sendToRelay).mock.calls)).not.toMatch(/Secret/);
  });

  it("turns the engine writer off and records the boot state when a later tower's attach traps (#1113)", async () => {
    const encodeVctower = requestWasm();
    let opts: WasmHostOptions | undefined;
    const status = { engine: "wasm" as const, starts: 1, hosted: true, fallbacks: 0, latched: false, restorePoint: null, errors: [] as string[], lastError: null as string | null, droppedErrors: 0 };
    vi.mocked(startWasmHost).mockImplementationOnce((_app, _mod, _log, o) => {
      opts = o;
      return { status, current: () => null, stop: () => {} } as never;
    });
    await boot();
    expect(await SaveGame.export(new Simulation(1))).toBe("VCTOWER1\nZW5naW5l\n");
    // A load traps as it attaches; the host sets its status, then reports.
    Object.assign(status, { hosted: false, latched: true, lastError: `not hosting this tower or any later one, since the WASM engine trapped: ${secret}` });
    opts?.onFallback?.({ reason: "attach-refused", stage: "adopt" }, true);
    expect(bootState()).toEqual({ build: "switchable", engine: "ts", failure: { stage: "host", reason: "attach-refused", message: status.lastError } });
    expect(await SaveGame.export(new Simulation(1))).toMatch(/^VCTOWER1\n/);
    expect(encodeVctower).toHaveBeenCalledTimes(1);
    expect(lastRow(engineRows())).toMatchObject({ trigger: "fallback", fallback_reason: "attach-refused", fallback_stage: "adopt" });
    expect(JSON.stringify(vi.mocked(sendToRelay).mock.calls)).not.toMatch(/Secret/);
  });

  it("never installs the engine writer when the first tower's attach trapped (#1113)", async () => {
    const encodeVctower = requestWasm();
    const lastError = `not hosting this tower or any later one, since the WASM engine trapped: ${secret}`;
    vi.mocked(startWasmHost).mockImplementationOnce((_app, _mod, _log, o) => {
      o?.onFallback?.({ reason: "attach-refused", stage: "start" }, true);
      return { status: { engine: "wasm", starts: 0, hosted: false, fallbacks: 1, lastFallback: { reason: "attach-refused", stage: "start" }, latched: true, restorePoint: null, errors: [lastError], lastError, droppedErrors: 0 }, current: () => null, stop: () => {} };
    });
    await boot();
    // Recorded once the host returns, with its message, as a refusal is.
    expect(bootState()).toEqual({ build: "switchable", engine: "ts", failure: { stage: "start", reason: "attach-refused", message: lastError } });
    expect(await SaveGame.export(new Simulation(1))).toMatch(/^VCTOWER1\n/);
    expect(encodeVctower).not.toHaveBeenCalled();
    expect(engineRows()).toEqual([expect.objectContaining({ trigger: "settle", engine: "ts-fallback", fallback_reason: "attach-refused", fallback_stage: "start" })]);
  });

  it("codes every boot failure path, and sends none of the message behind it", async () => {
    stubWebGL();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const settled = async () => {
      await boot();
      expect(engineRows()).toHaveLength(1);
      return engineRows()[0];
    };
    wasmStub.requested = "wasm";
    wasmStub.loadError = new EngineBootError("boot-timeout", secret);
    expect(await settled()).toMatchObject({ engine: "ts-fallback", fallback_reason: "boot-timeout", fallback_stage: "load", fallbacks: 1 });
    wasmStub.loadError = new WebAssembly.LinkError(secret);
    expect(await settled()).toMatchObject({ engine: "ts-fallback", fallback_reason: "package-mismatch", fallback_stage: "load" });
    wasmStub.loadError = null;
    wasmStub.module = { Engine: class {} };
    vi.mocked(startWasmHost).mockImplementationOnce(() => {
      throw new Error(secret);
    });
    expect(await settled()).toMatchObject({ engine: "ts-fallback", fallback_reason: "boot-error", fallback_stage: "start" });
    wasmStub.module = null;
    wasmStub.requested = "wasm-worker";
    vi.mocked(startWorkerHost).mockImplementationOnce(() => {
      throw new Error(secret);
    });
    expect(await settled()).toMatchObject({ engine_requested: "wasm-worker", engine: "ts-fallback", fallback_reason: "boot-error", fallback_stage: "start" });
    vi.mocked(startWorkerHost).mockImplementationOnce(
      () => ({ status: { hosted: false, errors: [`not hosting this tower: ${secret}`], lastError: `not hosting this tower: ${secret}`, droppedErrors: 0 }, stop: vi.fn() }) as never,
    );
    expect(await settled()).toMatchObject({ engine: "ts-fallback", fallback_reason: "attach-refused", fallback_stage: "start" });
    expect(JSON.stringify(vi.mocked(sendToRelay).mock.calls)).not.toMatch(/Secret|player|vctower/);
  });

  it("keeps the row when a boot step after the engine throws, and sends none when the game never existed", async () => {
    stubWebGL();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failingPwa = () =>
      vi.spyOn(pwa, "registerPWA").mockImplementationOnce(() => {
        throw new Error(secret);
      });
    // The main-thread host keeps running: the settle row stands alone.
    wasmStub.requested = "wasm";
    wasmStub.module = { Engine: class {} };
    failingPwa();
    await expect(boot()).rejects.toThrow("Secret");
    expect(engineRows()).toEqual([expect.objectContaining({ trigger: "settle", engine: "wasm", fallbacks: 0 })]);
    // The worker host is let go, so a fallback follows the settle row.
    wasmStub.module = null;
    wasmStub.requested = "wasm-worker";
    failingPwa();
    await expect(boot()).rejects.toThrow("Secret");
    expect(engineRows()).toEqual([
      expect.objectContaining({ trigger: "settle", engine: "wasm-worker", fallbacks: 0 }),
      expect.objectContaining({ trigger: "fallback", engine: "ts-fallback", fallback_reason: "other", fallback_stage: "start", fallbacks: 1 }),
    ]);
    // No game, no engine ran: no row (the error reaches $exception instead).
    resetEngineStatus();
    vi.mocked(sendToRelay).mockClear();
    await expect(
      bootGame(() => {
        throw new Error(secret);
      }),
    ).rejects.toThrow("Secret");
    expect(engineRows()).toEqual([]);
    expect(JSON.stringify(vi.mocked(sendToRelay).mock.calls.filter(([n]) => n === "engine_status"))).not.toMatch(/Secret/);
  });

  describe("a wasm-only build", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("reports a package that did not load as a stop, with no engine left", async () => {
      stubWebGL();
      vi.stubGlobal("__WASM_ONLY__", true);
      vi.spyOn(console, "error").mockImplementation(() => {});
      wasmStub.loadError = new Error(secret);
      await expect(boot()).rejects.toThrow(/did not start/);
      expect(engineRows()).toEqual([expect.objectContaining({ trigger: "settle", build: "wasm-only", engine_requested: "wasm", engine: "none", fallback_reason: "boot-error", fallback_stage: "load", fallbacks: 1 })]);
      // A package without the engine writer is the wrong package.
      wasmStub.loadError = null;
      wasmStub.module = { Engine: class {} };
      await expect(boot()).rejects.toThrow(/did not start/);
      expect(engineRows()).toEqual([expect.objectContaining({ engine: "none", fallback_reason: "package-mismatch", fallback_stage: "load" })]);
      expect(JSON.stringify(vi.mocked(sendToRelay).mock.calls)).not.toMatch(/Secret/);
    });

    it("reports a first tower the strict host refused as a stop at the start", async () => {
      stubWebGL();
      vi.stubGlobal("__WASM_ONLY__", true);
      vi.spyOn(console, "error").mockImplementation(() => {});
      wasmStub.module = { Engine: class {}, encodeVctower: () => "VCTOWER1\n" };
      vi.mocked(startWasmHost).mockImplementationOnce((_app, _mod, _log, o) => {
        o?.onFallback?.({ reason: "attach-refused", stage: "start" }, false);
        o?.onFatal?.(`not hosting this tower: ${secret}`, "attach-refused");
        return { status: { engine: "wasm", starts: 0, hosted: false, fallbacks: 1, lastFallback: { reason: "attach-refused", stage: "start" }, latched: false, restorePoint: null, errors: [`not hosting this tower: ${secret}`], lastError: `not hosting this tower: ${secret}`, droppedErrors: 0 }, current: () => null, stop: () => {} };
      });
      await boot();
      expect(engineRows()).toEqual([expect.objectContaining({ trigger: "settle", build: "wasm-only", engine: "none", fallback_reason: "attach-refused", fallback_stage: "start", fallbacks: 1 })]);
      expect(bootState()).toMatchObject({ build: "wasm-only", engine: "none", failure: { stage: "start", reason: "attach-refused" } });
      expect(JSON.stringify(vi.mocked(sendToRelay).mock.calls)).not.toMatch(/Secret/);
    });
  });
});
