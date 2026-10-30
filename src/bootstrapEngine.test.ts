import { afterEach, describe, expect, it, vi } from "vitest";
import { bootGame } from "./bootstrap";
import { saveOf } from "./tests/fixtures/saveText";

// The telemetry SDKs are gated on the host and best-effort; stub them so the
// gate and its catch can be asserted without touching the real endpoints.
vi.mock("@vercel/speed-insights", () => ({ injectSpeedInsights: vi.fn() }));
vi.mock("@vercel/analytics", () => ({ inject: vi.fn() }));
// Mock `virtual:pwa-register` (Vite virtual module via bootstrap.ts/pwa.ts) so the import resolves on Windows too (as pwa.test.ts does).
vi.mock("virtual:pwa-register", () => ({ registerSW: () => () => {} }));
// The WASM engine switch: the request, the package load and the Rust
// engine's first tower are stubbed so the boot state can be asserted without
// a package. The TypeScript engine's first tower is stubbed too, so a test
// can say whether it reads the stored save.
const wasmStub = vi.hoisted(() => ({ requested: "ts" as "ts" | "wasm" | "wasm-worker", loadError: null as Error | null, module: null as unknown, startError: null as Error | null, rustCorrupt: false, tsCorrupt: false, binary: null as { state: "ok"; sourceHash: string } | null }));
vi.mock("./wasmhost/engineChoice", async (importOriginal) => {
  const real = await importOriginal<typeof import("./wasmhost/engineChoice")>();
  return { ...real, engineRequested: () => wasmStub.requested };
});
vi.mock("./wasmhost/rustEngine", async (importOriginal) => {
  const real = await importOriginal<typeof import("./wasmhost/rustEngine")>();
  return {
    ...real,
    loadWasmEngine: vi.fn(async (_url?: string, _signal?: AbortSignal, opts?: { onBuild?: (b: unknown) => void }) => {
      if (wasmStub.binary) opts?.onBuild?.(wasmStub.binary);
      if (wasmStub.module) return wasmStub.module;
      throw wasmStub.loadError ?? new Error("no package in this test");
    }),
    rustBootTower: vi.fn(() => {
      if (wasmStub.startError) throw wasmStub.startError;
      return { port: { engine: "rust", lastReason: () => `the save is not a tower: ${"could not read /home/player/My Secret Tower.vctower"}` }, corrupt: wasmStub.rustCorrupt, loaded: !wasmStub.rustCorrupt, savedAt: undefined };
    }),
  };
});
vi.mock("./game/bootTower", async (importOriginal) => {
  const real = await importOriginal<typeof import("./game/bootTower")>();
  return { ...real, tsBootTower: vi.fn(() => ({ port: { engine: "ts" }, corrupt: wasmStub.tsCorrupt, loaded: !wasmStub.tsCorrupt, savedAt: undefined })) };
});
// The crash reload (#1422), so a test can say whether the page would reload.
vi.mock("./engineCrash/crashReload", async (importOriginal) => {
  const real = await importOriginal<typeof import("./engineCrash/crashReload")>();
  return { ...real, reloadSoon: vi.fn() };
});
// The relay, so the reliability rows (`engine_status`) can be read back.
vi.mock("./analyticsRelay", () => ({ sendToRelay: vi.fn() }));
import { rustBootTower } from "./wasmhost/rustEngine";
import { tsBootTower } from "./game/bootTower";
import { sendToRelay } from "./analyticsRelay";
import { resetEngineStatus } from "./analyticsEngineStatus";
import * as pwa from "./pwa";
import { Simulation } from "./engine/Simulation";
import { SaveGame } from "./storage/SaveGame";
import { setEngineWriter } from "./storage/vctowerWriter";
import { EngineBootError } from "./wasmhost/engineBoot";
import { noteEngineThrow, watchEngineTraps } from "./game/engineFault";
import { countRustCrash, crashReportDue, reloadSoon } from "./engineCrash/crashReload";

/** A tab whose storage keeps nothing, so a crash cannot be counted. */
function fullTabStore(): void {
  const quota = () => {
    throw new Error("quota");
  };
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: quota, removeItem: () => {} });
}

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

const bootState = (): unknown => (globalThis as { __vcEngineBoot?: unknown }).__vcEngineBoot;
const published = (): { status: { hosted: boolean }; port: unknown } | undefined => (globalThis as { __vcEngine?: { status: { hosted: boolean }; port: unknown } }).__vcEngine;

/** Put every stub back to a TypeScript boot with nothing stored. */
function resetStubs(): void {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  vi.mocked(reloadSoon).mockClear();
  setEngineWriter(null);
  watchEngineTraps(null);
  vi.mocked(rustBootTower).mockClear();
  vi.mocked(tsBootTower).mockClear();
  delete (globalThis as { __vcEngine?: unknown }).__vcEngine;
  Object.assign(wasmStub, { requested: "ts", loadError: null, module: null, startError: null, rustCorrupt: false, tsCorrupt: false, binary: null });
}

/**
 * The engine half of `bootGame`: which engine boot settles on, the tower it
 * hands the app, the boot state it publishes (`window.__vcEngineBoot`) and
 * the save writer. The Rust engine is the app's engine port (PR 5e), so a
 * Rust boot builds its first tower on it and publishes it on
 * `window.__vcEngine`. Split from bootstrap.test.ts, which keeps the rest of
 * boot.
 */
describe("bootGame engine", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    document.body.innerHTML = "";
    delete (window as unknown as { game?: unknown }).game;
    resetStubs();
  });

  it("boots on the TypeScript engine, with the reason logged, when the requested WASM package fails to load", async () => {
    stubWebGL();
    wasmStub.requested = "wasm";
    wasmStub.loadError = new Error("404 engine/verticopolis_engine.js");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const create = vi.fn((_tower: unknown) => ({ onUpdateAvailable: vi.fn() }));
    await bootGame(create);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({ port: { engine: "ts" } });
    expect(rustBootTower).not.toHaveBeenCalled();
    expect(published()).toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("[wasm]"), wasmStub.loadError);
    expect(document.getElementById("boot-fallback-host")).toBeNull();
    // A switchable build reports the engine it settled on, and why.
    expect(bootState()).toEqual({ build: "switchable", engine: "ts", failure: { stage: "load", reason: "boot-error", message: "404 engine/verticopolis_engine.js" } });
  });

  it("says why the game did not start when the stored tower cannot be read", async () => {
    document.body.innerHTML = '<div id="stage"></div>';
    stubWebGL();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const blocked = new DOMException("The operation is insecure.", "SecurityError");
    vi.mocked(tsBootTower).mockImplementationOnce(() => {
      throw blocked;
    });
    const create = vi.fn((_tower: unknown) => ({ onUpdateAvailable: vi.fn() }));
    await expect(bootGame(create)).rejects.toBe(blocked);
    expect(create).not.toHaveBeenCalled();
    expect(document.getElementById("boot-fallback-host")!.textContent).toContain("Something went wrong starting the game: The operation is insecure.");
  });

  it("hands the app the Rust engine's tower and publishes the engine before the app exists", async () => {
    requestWasm();
    let seen: unknown;
    const create = vi.fn((_tower: unknown) => {
      seen = published();
      return { onUpdateAvailable: vi.fn() };
    });
    await bootGame(create);
    const tower = create.mock.calls[0][0] as { port: unknown };
    expect(tower).toMatchObject({ port: { engine: "rust" }, corrupt: false });
    expect(tsBootTower).not.toHaveBeenCalled();
    // The title screen's version line reads it as the app builds.
    expect(seen).toEqual({ status: { engine: "wasm", hosted: true, lastError: null, lastFallback: null }, port: tower.port });
    expect(bootState()).toEqual({ build: "switchable", engine: "wasm", failure: null });
  });

  it("boots the old measurement hosts' requests on the same Rust engine", async () => {
    requestWasm();
    wasmStub.requested = "wasm-worker";
    const create = vi.fn((_tower: unknown) => ({ onUpdateAvailable: vi.fn() }));
    await bootGame(create);
    expect(create.mock.calls[0][0]).toMatchObject({ port: { engine: "rust" } });
    expect(bootState()).toEqual({ build: "switchable", engine: "wasm", failure: null });
  });

  it("keeps what the binary's build section said on the boot state, for a package that loaded and one that did not link", async () => {
    stubWebGL();
    const binary = { state: "ok", sourceHash: "a".repeat(64) } as const;
    vi.spyOn(console, "error").mockImplementation(() => {});
    wasmStub.binary = binary;
    wasmStub.requested = "wasm";
    wasmStub.module = { Engine: class {} };
    await bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn() })));
    expect(bootState()).toEqual({ build: "switchable", engine: "wasm", failure: null, binary });
    // The binary was read, then the glue and binary did not link.
    wasmStub.module = null;
    wasmStub.loadError = new WebAssembly.LinkError("import mismatch");
    await bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn() })));
    expect(bootState()).toEqual({ build: "switchable", engine: "ts", failure: { stage: "load", reason: "package-mismatch", message: "import mismatch" }, binary });
  });

  it("writes saves through the engine once the Rust engine starts", async () => {
    const encodeVctower = requestWasm();
    await bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn() })));
    expect(rustBootTower).toHaveBeenCalled();
    expect(bootState()).toEqual({ build: "switchable", engine: "wasm", failure: null });
    expect(await SaveGame.export(saveOf(new Simulation(1)))).toBe("VCTOWER1\nZW5naW5l\n");
    expect(encodeVctower).toHaveBeenCalledTimes(1);
  });

  it("reloads the game at the running engine's first trap, with the writer off and the reason shown", async () => {
    const encodeVctower = requestWasm();
    document.body.innerHTML = '<div id="stage"></div>';
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const setSpeed = vi.fn();
    await bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn(), setSpeed })));
    expect(noteEngineThrow(new Error("a refusal, not a trap"))).toBe(false);
    expect(noteEngineThrow(new WebAssembly.RuntimeError("unreachable"))).toBe(true);
    // Heard once: the poisoned engine's later throws are frame errors only.
    expect(noteEngineThrow(new WebAssembly.RuntimeError("unreachable"))).toBe(false);
    const message = "the Rust engine failed during a tick: unreachable";
    expect(published()?.status).toMatchObject({ hosted: false, lastError: message });
    expect(bootState()).toEqual({ build: "switchable", engine: "none", failure: { stage: "host", reason: "trap-tick", message } });
    expect(document.getElementById("boot-fallback-host")?.textContent).toContain("Reloading your tower from its last autosave.");
    // The game stops behind the line, as behind the failure message, until the reload.
    expect(document.getElementById("engine-failure")?.getAttribute("data-stage")).toBe("reload");
    expect(reloadSoon).toHaveBeenCalledOnce();
    expect(setSpeed).toHaveBeenCalledWith(0);
    expect(error).toHaveBeenCalledWith(`[wasm] ${message}`);
    await SaveGame.export(saveOf(new Simulation(1)));
    expect(encodeVctower).not.toHaveBeenCalled();
  });

  it("stops the game at the tab's second trap instead of reloading again", async () => {
    requestWasm();
    document.body.innerHTML = '<div id="stage"></div>';
    vi.spyOn(console, "error").mockImplementation(() => {});
    wasmStub.binary = { state: "ok", sourceHash: "b".repeat(64) };
    countRustCrash(sessionStorage, __APP_SHA__);
    await bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn(), setSpeed: vi.fn() })));
    expect(noteEngineThrow(new WebAssembly.RuntimeError("unreachable"))).toBe(true);
    expect(document.getElementById("engine-failure")?.getAttribute("data-stage")).toBe("host");
    expect(reloadSoon).not.toHaveBeenCalled();
    // The tab keeps the fault and the engine that crashed for the crash
    // report a TypeScript boot offers (the stub package records no identity).
    expect(crashReportDue(sessionStorage, __APP_SHA__)).toEqual({
      count: 2,
      last: { reason: "trap-tick", stage: "start", rust: { version: null, sourceHash: "b".repeat(64) } },
    });
  });

  it("stops the game at a trap whose count storage did not keep", async () => {
    requestWasm();
    document.body.innerHTML = '<div id="stage"></div>';
    vi.spyOn(console, "error").mockImplementation(() => {});
    fullTabStore();
    await bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn(), setSpeed: vi.fn() })));
    expect(noteEngineThrow(new WebAssembly.RuntimeError("unreachable"))).toBe(true);
    vi.unstubAllGlobals();
    expect(document.getElementById("engine-failure")?.getAttribute("data-stage")).toBe("host");
    expect(reloadSoon).not.toHaveBeenCalled();
  });

  it("leaves the game and its saves on TypeScript when the Rust engine does not start", async () => {
    const encodeVctower = requestWasm();
    wasmStub.startError = new Error("no engine");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const create = vi.fn((_tower: unknown) => ({ onUpdateAvailable: vi.fn() }));
    await bootGame(create);
    expect(create.mock.calls[0][0]).toMatchObject({ port: { engine: "ts" } });
    expect(published()).toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("[wasm]"), expect.any(Error));
    // The fallback is recorded with its reason (#874) as well as logged.
    expect(bootState()).toEqual({ build: "switchable", engine: "ts", failure: { stage: "start", reason: "boot-error", message: "no engine" } });
    expect(await SaveGame.export(saveOf(new Simulation(1)))).toMatch(/^VCTOWER1\n/);
    expect(encodeVctower).not.toHaveBeenCalled();
  });

  it("leaves a stored tower the Rust engine refuses, and TypeScript reads, on TypeScript, as a refused start", async () => {
    const encodeVctower = requestWasm();
    wasmStub.rustCorrupt = true;
    const create = vi.fn((_tower: unknown) => ({ onUpdateAvailable: vi.fn() }));
    await bootGame(create);
    expect(create.mock.calls[0][0]).toMatchObject({ port: { engine: "ts" }, corrupt: false });
    expect(published()).toBeUndefined();
    expect(bootState()).toEqual({ build: "switchable", engine: "ts", failure: { stage: "start", reason: "attach-refused", message: expect.stringContaining("not a tower") } });
    // The page life holds the TypeScript port (#1258): the app loads, imports
    // and starts every later tower on it, and the Rust boot ran once.
    expect(rustBootTower).toHaveBeenCalledTimes(1);
    expect(tsBootTower).toHaveBeenCalledTimes(1);
    expect(await SaveGame.export(saveOf(new Simulation(1)))).toMatch(/^VCTOWER1\n/);
    expect(encodeVctower).not.toHaveBeenCalled();
  });

  it("keeps the Rust engine for a stored tower neither engine reads", async () => {
    requestWasm();
    wasmStub.rustCorrupt = true;
    wasmStub.tsCorrupt = true;
    const create = vi.fn((_tower: unknown) => ({ onUpdateAvailable: vi.fn() }));
    await bootGame(create);
    // The app keeps the unreadable save aside, as it does on TypeScript.
    expect(create.mock.calls[0][0]).toMatchObject({ port: { engine: "rust" }, corrupt: true });
    expect(bootState()).toEqual({ build: "switchable", engine: "wasm", failure: null });
  });
});

const lastRow = (xs: Record<string, unknown>[]): Record<string, unknown> | undefined => xs[xs.length - 1];

/** Every `engine_status` row the relay saw, in order; `attempt` rows only with `all`. */
const engineRows = (all = false): Record<string, unknown>[] =>
  vi
    .mocked(sendToRelay)
    .mock.calls.filter(([name, props]) => name === "engine_status" && (all || (props as { trigger?: string }).trigger !== "attempt"))
    .map(([, props]) => props as Record<string, unknown>);

/**
 * The reliability instrument's wiring (issue #1081): the row boot sends once
 * it has picked its engine and the writer latch-off, as codes, never the
 * messages behind them.
 */
describe("bootGame engine_status", () => {
  const secret = "could not read /home/player/My Secret Tower.vctower";

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    delete (window as unknown as { game?: unknown }).game;
    window.location.href = "http://localhost:3000/";
    resetStubs();
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
    expect(engineRows(true).map((r) => r.trigger)).toEqual(["attempt", "settle"]);
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

  it("counts a refused first tower once, with none of the engine's reason", async () => {
    requestWasm();
    wasmStub.rustCorrupt = true;
    await boot();
    expect(engineRows()).toEqual([expect.objectContaining({ trigger: "settle", engine: "ts-fallback", fallback_reason: "attach-refused", fallback_stage: "start", fallbacks: 1 })]);
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
    await SaveGame.export(saveOf(new Simulation(1)));
    expect(lastRow(engineRows())).toMatchObject({ trigger: "writer-latch", engine: "wasm", writer_latched: true });
    expect(bootState()).toEqual({ build: "switchable", engine: "wasm", failure: null, writerLatched: true });
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
    wasmStub.startError = new Error(secret);
    expect(await settled()).toMatchObject({ engine: "ts-fallback", fallback_reason: "boot-error", fallback_stage: "start" });
    // A package whose catalogs this build cannot draw is a mismatched one.
    wasmStub.startError = new EngineBootError("package-mismatch", secret);
    expect(await settled()).toMatchObject({ engine: "ts-fallback", fallback_reason: "package-mismatch", fallback_stage: "start" });
    expect(JSON.stringify(vi.mocked(sendToRelay).mock.calls)).not.toMatch(/Secret|player|vctower/);
  });

  it("counts a running engine's trap at its tower's stage, and then takes an update at once", async () => {
    stubWebGL();
    vi.spyOn(console, "error").mockImplementation(() => {});
    wasmStub.requested = "wasm";
    wasmStub.module = { Engine: class {} };
    let onUpdate: ((activate: () => Promise<void>, info?: unknown) => void) | undefined;
    vi.spyOn(pwa, "registerPWA").mockImplementation((opts) => {
      onUpdate = opts.onUpdateAvailable as typeof onUpdate;
    });
    const prompt = vi.fn();
    document.body.innerHTML = '<div id="stage"></div>';
    await boot({ onUpdateAvailable: prompt, setSpeed: vi.fn() });
    const activate = vi.fn(() => Promise.resolve());
    onUpdate!(activate);
    expect(prompt).toHaveBeenCalledOnce();
    // A count storage did not keep stops the game rather than reload it.
    fullTabStore();
    expect(noteEngineThrow(new WebAssembly.RuntimeError("unreachable"))).toBe(true);
    vi.unstubAllGlobals();
    // A trap that stops the game, with no reload, is a fallback row.
    expect(lastRow(engineRows())).toMatchObject({ trigger: "fallback", engine: "ts-fallback", fallback_reason: "trap-tick", fallback_stage: "start", fallbacks: 1 });
    onUpdate!(activate);
    expect(activate).toHaveBeenCalledOnce();
    expect(prompt).toHaveBeenCalledOnce();
  });

  it("names the Rust engine that crashed on the row sent before a crash reload", async () => {
    stubWebGL();
    vi.spyOn(console, "error").mockImplementation(() => {});
    wasmStub.requested = "wasm";
    wasmStub.module = { Engine: class {} };
    document.body.innerHTML = '<div id="stage"></div>';
    await boot({ setSpeed: vi.fn() });
    expect(noteEngineThrow(new WebAssembly.RuntimeError("unreachable"))).toBe(true);
    expect(reloadSoon).toHaveBeenCalledOnce();
    expect(lastRow(engineRows())).toMatchObject({ trigger: "crash-reload", engine: "wasm", fallback_reason: "trap-tick", fallback_stage: "start", fallbacks: 1 });
  });

  it("keeps the row when a boot step after the engine throws, and sends none when the game never existed", async () => {
    stubWebGL();
    vi.spyOn(console, "error").mockImplementation(() => {});
    wasmStub.requested = "wasm";
    wasmStub.module = { Engine: class {} };
    vi.spyOn(pwa, "registerPWA").mockImplementationOnce(() => {
      throw new Error(secret);
    });
    await expect(boot()).rejects.toThrow("Secret");
    expect(engineRows()).toEqual([expect.objectContaining({ trigger: "settle", engine: "wasm", fallbacks: 0 })]);
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

    it("reports a Rust engine that did not start as a stop at the start, and never falls back", async () => {
      stubWebGL();
      vi.stubGlobal("__WASM_ONLY__", true);
      vi.spyOn(console, "error").mockImplementation(() => {});
      wasmStub.module = { Engine: class {}, encodeVctower: () => "VCTOWER1\n" };
      wasmStub.startError = new EngineBootError("package-mismatch", secret);
      const create = vi.fn(() => ({ onUpdateAvailable: vi.fn() }));
      resetEngineStatus();
      vi.mocked(sendToRelay).mockClear();
      window.location.href = "https://verticopolis.com/";
      await expect(bootGame(create)).rejects.toThrow(/did not start/);
      expect(create).not.toHaveBeenCalled();
      expect(tsBootTower).not.toHaveBeenCalled();
      expect(engineRows()).toEqual([expect.objectContaining({ trigger: "settle", build: "wasm-only", engine: "none", fallback_reason: "package-mismatch", fallback_stage: "start", fallbacks: 1 })]);
      expect(bootState()).toMatchObject({ build: "wasm-only", engine: "none", failure: { stage: "start", reason: "package-mismatch" } });
      expect(JSON.stringify(vi.mocked(sendToRelay).mock.calls)).not.toMatch(/Secret/);
    });

    it("keeps a stored tower the Rust engine refuses on the Rust engine, as an unreadable save", async () => {
      stubWebGL();
      vi.stubGlobal("__WASM_ONLY__", true);
      wasmStub.module = { Engine: class {}, encodeVctower: () => "VCTOWER1\n" };
      wasmStub.rustCorrupt = true;
      const create = vi.fn((_tower: unknown) => ({ onUpdateAvailable: vi.fn() }));
      await bootGame(create);
      expect(create.mock.calls[0][0]).toMatchObject({ port: { engine: "rust" }, corrupt: true });
      expect(tsBootTower).not.toHaveBeenCalled();
      expect(bootState()).toEqual({ build: "wasm-only", engine: "wasm", failure: null });
    });
  });
});
