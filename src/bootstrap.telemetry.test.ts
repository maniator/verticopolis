import { afterEach, describe, expect, it, vi } from "vitest";
import { bootGame } from "./bootstrap";
import { injectSpeedInsights } from "@vercel/speed-insights";
import { inject as injectWebAnalytics } from "@vercel/analytics";

// The telemetry SDKs are gated on the host and best-effort; stub them so the
// gate and its catch can be asserted without touching the real endpoints.
vi.mock("@vercel/speed-insights", () => ({ injectSpeedInsights: vi.fn() }));
vi.mock("@vercel/analytics", () => ({ inject: vi.fn() }));
// Mock `virtual:pwa-register` (Vite virtual module via bootstrap.ts/pwa.ts) so the import resolves on Windows too (as pwa.test.ts does).
vi.mock("virtual:pwa-register", () => ({ registerSW: () => () => {} }));
// The package load is stubbed so boot runs without an engine package. The
// default package has a save writer, the one part boot requires of it.
const wasmStub = vi.hoisted(() => ({ loadError: null as Error | null, module: { Engine: class {}, encodeVctower: () => "" } as unknown }));
vi.mock("@verticopolis/components/host/rustEngine", async (importOriginal) => {
  const real = await importOriginal<typeof import("@verticopolis/components/host/rustEngine")>();
  return {
    ...real,
    loadWasmEngine: vi.fn(async () => {
      if (wasmStub.module) return wasmStub.module;
      throw wasmStub.loadError ?? new Error("no package in this test");
    }),
    rustBootTower: vi.fn(() => ({ port: {}, corrupt: false, loaded: false, savedAt: undefined })),
  };
});

/** Make hasWebGL() see a real GL context (happy-dom canvas returns null). */
function stubWebGL(): void {
  const real = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "canvas") return { getContext: () => ({}) } as unknown as HTMLCanvasElement;
    return real(tag);
  });
}

/**
 * Unit tests for the boot entry. Everything runs headlessly under happy-dom:
 * happy-dom's <canvas> returns a null WebGL context, so hasWebGL() is false by
 * default and the true branch is exercised by stubbing document.createElement.
 * bootGame's telemetry is gated on window.location.hostname (localhost by
 * default here, so it is skipped) and registerPWA is real but returns early
 * without a service worker.
 */

/**
 * The boot entry's telemetry gate: the page telemetry is injected only on
 * the production and preview hosts, and a failure there never blocks boot.
 * Split from `bootstrap.test.ts` to keep both under the line ceiling.
 */

// Boot on the production host also starts the analytics client, which sends
// to the real ingest endpoint when the test page closes (happy-dom's beacon is
// a real request). The beacon is stubbed for the whole file, not per test,
// because that send comes after the last test has torn down.
Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: () => true });

describe("bootGame telemetry gate", () => {
  const localhost = "http://localhost:3000/";

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(injectSpeedInsights).mockReset();
    vi.mocked(injectWebAnalytics).mockReset();
    window.location.href = localhost; // restore host for the rest of the suite
    document.body.innerHTML = "";
    delete (window as unknown as { game?: unknown }).game;
  });

  it("injects Vercel telemetry on the production host", () => {
    stubWebGL();
    window.location.href = "https://verticopolis.com/";
    bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn() })));

    expect(injectSpeedInsights).toHaveBeenCalledTimes(1);
    expect(injectWebAnalytics).toHaveBeenCalledTimes(1);
  });

  it("injects telemetry on a Vercel preview host too", () => {
    stubWebGL();
    window.location.href = "https://feature-branch.vercel.app/";
    bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn() })));

    expect(injectSpeedInsights).toHaveBeenCalledTimes(1);
    expect(injectWebAnalytics).toHaveBeenCalledTimes(1);
  });

  it("skips telemetry on any other host", () => {
    stubWebGL();
    window.location.href = localhost;
    bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn() })));

    expect(injectSpeedInsights).not.toHaveBeenCalled();
    expect(injectWebAnalytics).not.toHaveBeenCalled();
  });

  it("never lets a telemetry failure block boot", async () => {
    stubWebGL();
    window.location.href = "https://verticopolis.com/";
    vi.mocked(injectSpeedInsights).mockImplementationOnce(() => {
      throw new Error("telemetry down");
    });
    const app = { onUpdateAvailable: vi.fn() };

    await expect(bootGame(vi.fn(() => app))).resolves.toBeUndefined();
    // Boot still finished: the game handle is published despite the telemetry throw.
    expect((window as unknown as { game?: unknown }).game).toBe(app);
  });
});
