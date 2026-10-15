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
const wasmStub = vi.hoisted(() => ({ requested: "ts" as "ts" | "wasm" | "wasm-worker", loadError: null as Error | null, module: null as unknown, workerError: null as Error | null }));
vi.mock("./wasmhost/engineChoice", async (importOriginal) => {
  const real = await importOriginal<typeof import("./wasmhost/engineChoice")>();
  return { ...real, engineRequested: () => wasmStub.requested };
});
vi.mock("./wasmhost/startWasmHost", async (importOriginal) => {
  const real = await importOriginal<typeof import("./wasmhost/startWasmHost")>();
  return {
    ...real,
    loadWasmEngine: vi.fn(async () => {
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
      if (wasmStub.workerError) throw wasmStub.workerError;
      return { worker: { terminate: vi.fn() }, catalogs: { classic: "{}", modern: "{}" } };
    }),
    startWorkerHost: vi.fn(() => ({ status: { hosted: true, errors: [] as string[] }, stop: vi.fn() })),
  };
});
import { startWasmHost } from "./wasmhost/startWasmHost";
import { startWorkerHost } from "./wasmhost/workerController";
import * as pwa from "./pwa";
import { Simulation } from "./engine/Simulation";
import { SaveGame } from "./storage/SaveGame";
import { setEngineWriter } from "./storage/vctowerWriter";


/** Make hasWebGL() see a real GL context (happy-dom canvas returns null). */
function stubWebGL(): void {
  const real = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "canvas") return { getContext: () => ({}) } as unknown as HTMLCanvasElement;
    return real(tag);
  });
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
      expect((globalThis as { __vcEngineBoot?: unknown }).__vcEngineBoot).toEqual({ build: "switchable", engine: "ts", failure: { stage: "load", message: "404 engine/verticopolis_engine.js" } });
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
      expect(boot()).toEqual({ build: "switchable", engine: "ts", failure: { stage: "start", message: "no worker host" } });
      // A later throw lets the started host go, so the state stops claiming it.
      vi.spyOn(pwa, "registerPWA").mockImplementationOnce(() => {
        throw new Error("no service worker");
      });
      await expect(bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn() })))).rejects.toThrow("no service worker");
      expect(boot()).toEqual({ build: "switchable", engine: "ts", failure: { stage: "start", message: "no service worker" } });
      // A refused first tower is not thrown: the host reports it and stays.
      vi.mocked(startWorkerHost).mockImplementationOnce(() => ({ status: { hosted: false, errors: ["not hosting this tower: it has a crowd"] }, stop: vi.fn() }) as never);
      await bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn() })));
      expect(boot()).toEqual({ build: "switchable", engine: "ts", failure: { stage: "start", message: "not hosting this tower: it has a crowd" } });
      wasmStub.workerError = new Error("the engine worker did not answer ready");
      vi.mocked(startWorkerHost).mockClear();
      await bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn() })));
      expect(startWorkerHost).not.toHaveBeenCalled();
      expect(boot()).toEqual({ build: "switchable", engine: "ts", failure: { stage: "load", message: "the engine worker did not answer ready" } });
      expect(error).toHaveBeenCalledWith(expect.stringContaining("[wasm-worker]"), expect.any(Error));
    } finally {
      wasmStub.requested = "ts";
      wasmStub.workerError = null;
    }
  });

  it("writes saves through the engine once the WASM engine starts", async () => {
    stubWebGL();
    wasmStub.requested = "wasm";
    const encodeVctower = vi.fn(() => "VCTOWER1\nZW5naW5l\n");
    wasmStub.module = { Engine: class {}, encodeVctower };
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
    stubWebGL();
    wasmStub.requested = "wasm";
    const encodeVctower = vi.fn(() => "VCTOWER1\nZW5naW5l\n");
    wasmStub.module = { Engine: class {}, encodeVctower };
    vi.mocked(startWasmHost).mockImplementationOnce(() => {
      throw new Error("no host");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn() })));
      expect(error).toHaveBeenCalledWith(expect.stringContaining("[wasm]"), expect.any(Error));
      // The fallback is recorded with its reason (#874) as well as logged.
      expect((globalThis as { __vcEngineBoot?: unknown }).__vcEngineBoot).toEqual({ build: "switchable", engine: "ts", failure: { stage: "start", message: "no host" } });
      expect(await SaveGame.export(new Simulation(1))).toMatch(/^VCTOWER1\n/);
      expect(encodeVctower).not.toHaveBeenCalled();
    } finally {
      setEngineWriter(null);
      wasmStub.requested = "ts";
      wasmStub.module = null;
    }
  });

  it("records a switchable build's refused first tower as a fallback to TypeScript", async () => {
    stubWebGL();
    wasmStub.requested = "wasm";
    const encodeVctower = vi.fn(() => "VCTOWER1\nZW5naW5l\n");
    wasmStub.module = { Engine: class {}, encodeVctower };
    vi.mocked(startWasmHost).mockImplementationOnce(() => ({ status: { engine: "wasm", starts: 0, hosted: false, errors: ["not hosting this tower: it has a crowd"] }, current: () => null, stop: () => {} }));
    try {
      await bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn() })));
      expect((globalThis as { __vcEngineBoot?: unknown }).__vcEngineBoot).toEqual({ build: "switchable", engine: "ts", failure: { stage: "start", message: "not hosting this tower: it has a crowd" } });
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
