import { afterEach, describe, expect, it, vi } from "vitest";
import { bootGame } from "./bootstrap";
import { EngineBootError } from "./wasmhost/engineBoot";
import { EnginePackageError } from "./wasmhost/enginePackageCheck";
import { ENGINE_LOADING_DELAY_MS, ENGINE_LOADING_TEXT } from "./engineLoading";
import { resetEngineStatus } from "./analyticsEngineStatus";

vi.mock("@vercel/speed-insights", () => ({ injectSpeedInsights: vi.fn() }));
vi.mock("@vercel/analytics", () => ({ inject: vi.fn() }));
vi.mock("virtual:pwa-register", () => ({ registerSW: () => () => {} }));
vi.mock("./analyticsRelay", () => ({ sendToRelay: vi.fn() }));
// A package load the test settles itself, to hold the boot while it looks at the cover.
const held = vi.hoisted(() => ({ fail: (_e: Error) => {} }));
const noop = held.fail;
// The cohort's selection picks the boot engine (#1197); this page life asks for Rust.
vi.mock("./engineCohort/boot", async (importOriginal) => ({ ...(await importOriginal<typeof import("./engineCohort/boot")>()), selectBootEngine: () => "wasm", noteRustFailed: vi.fn() }));
vi.mock("./wasmhost/rustEngine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./wasmhost/rustEngine")>()),
  loadWasmEngine: vi.fn(() => new Promise((_, reject) => (held.fail = reject))),
}));

/** Make hasWebGL() see a real GL context (happy-dom canvas returns null). */
function stubWebGL(): void {
  const real = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => (tag === "canvas" ? ({ getContext: () => ({}) } as unknown as HTMLCanvasElement) : real(tag)));
}

describe("bootGame, the engine loading line (#1132)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    delete (window as unknown as { game?: unknown }).game;
    window.location.href = "http://localhost:3000/";
  });

  it("says the engine is loading after a wait, and the failure copy replaces the line when the load times out", async () => {
    stubWebGL();
    vi.stubGlobal("__WASM_ONLY__", true);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="boot-cover"></div><div id="a11y-live"></div><div id="stage"></div>';
    resetEngineStatus();
    window.location.href = "https://verticopolis.com/";
    try {
      const run = bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn() }))).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(ENGINE_LOADING_DELAY_MS - 100);
      expect(document.querySelector(".boot-loading"), "a fast load never shows the line").toBeNull();
      await vi.advanceTimersByTimeAsync(200);
      expect(document.querySelector("#boot-cover .boot-loading")?.textContent).toBe(ENGINE_LOADING_TEXT);
      await vi.advanceTimersByTimeAsync(100);
      expect(document.getElementById("a11y-live")?.textContent, "and it is announced").toBe(ENGINE_LOADING_TEXT);
      held.fail(new EngineBootError("boot-timeout", "the engine package did not load within 90 seconds"));
      await vi.advanceTimersByTimeAsync(0);
      expect(await run).toBeInstanceOf(Error);
      expect(document.querySelector(".boot-loading")).toBeNull();
      expect(document.getElementById("boot-cover")).toBeNull();
      expect(document.getElementById("engine-failure")?.textContent).toContain("The engine took too long to load");
      expect(document.getElementById("a11y-live")?.textContent).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends a refused package to the exception tracker by code and kind, not by digest", async () => {
    stubWebGL();
    vi.stubGlobal("__WASM_ONLY__", true);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const run = bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn() }))).catch((e: unknown) => e);
    await vi.waitFor(() => expect(held.fail).not.toBe(noop));
    held.fail(new EnginePackageError("mismatch", "the wasm is not the file expected (aaaaaaaaaaaa)", { file: "wasm", expected: null, found: "aaaaaaaaaaaa", expectedPackage: null, servedPackage: null, controlled: false }));
    expect(((await run) as Error).message).toMatch(/\(load\): package-mismatch, mismatch$/);
  });
});
