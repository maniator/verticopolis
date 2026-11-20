import { afterEach, describe, expect, it, vi } from "vitest";
import { bootGame } from "./bootstrap";

// Boot's own collaborators are stubbed as in bootstrap.test.ts: the telemetry
// SDKs, the PWA register module and the engine package load, so boot runs
// headlessly without an engine.
vi.mock("@vercel/speed-insights", () => ({ injectSpeedInsights: vi.fn() }));
vi.mock("@vercel/analytics", () => ({ inject: vi.fn() }));
vi.mock("virtual:pwa-register", () => ({ registerSW: () => () => {} }));
vi.mock("@verticopolis/engine/host/rustEngine", async (importOriginal) => {
  const real = await importOriginal<typeof import("@verticopolis/engine/host/rustEngine")>();
  return {
    ...real,
    loadWasmEngine: vi.fn(async () => ({ Engine: class {}, encodeVctower: () => "" })),
    rustBootTower: vi.fn(() => ({ port: {}, corrupt: false, loaded: false, savedAt: undefined })),
  };
});

// The `?debug=fps` overlay (#645) is loaded lazily by boot; a spy stands in
// for it so the tests can see whether boot mounted it and what a failure does.
const hudStub = vi.hoisted(() => ({ mount: vi.fn() }));
vi.mock("./debugHud", () => ({ mountDebugHud: hudStub.mount }));
// The build-time preview flag, swapped per test like pwaPreview.test.ts does.
const deploy = vi.hoisted(() => ({ preview: false }));
vi.mock("./deployTarget", () => ({
  get PREVIEW_DEPLOY() {
    return deploy.preview;
  },
}));

/** Make hasWebGL() see a real GL context (happy-dom canvas returns null). */
function stubWebGL(): void {
  const real = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "canvas") return { getContext: () => ({}) } as unknown as HTMLCanvasElement;
    return real(tag);
  });
}

describe("the ?debug=fps overlay (#645)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    delete (window as unknown as { game?: unknown }).game;
    vi.unstubAllEnvs();
    history.replaceState(null, "", "/");
    hudStub.mount.mockReset();
    localStorage.clear();
    deploy.preview = false;
  });

  it("is not loaded without the flag", async () => {
    stubWebGL();
    await bootGame(() => ({ onUpdateAvailable: vi.fn() }));
    await vi.dynamicImportSettled();
    expect(hudStub.mount).not.toHaveBeenCalled();
  });

  it("mounts with the flag, reading the renderer the app holds at each call", async () => {
    history.replaceState(null, "", "/?debug=fps");
    stubWebGL();
    const app: { onUpdateAvailable: () => void; engine?: { engine: unknown } } = { onUpdateAvailable: vi.fn() };
    await bootGame(() => app as never);
    await vi.dynamicImportSettled();
    expect(hudStub.mount).toHaveBeenCalledTimes(1);
    const source = hudStub.mount.mock.calls[0][0] as () => unknown;
    expect(source()).toBeUndefined();
    const renderer = { stats: { prevFrame: {} } };
    app.engine = { engine: renderer };
    expect(source()).toBe(renderer);
  });

  it("only warns when the overlay fails to load, so no rejection reaches error analytics", async () => {
    history.replaceState(null, "", "/?debug=fps");
    stubWebGL();
    hudStub.mount.mockImplementation(() => {
      throw new Error("chunk missing offline");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      await bootGame(() => ({ onUpdateAvailable: vi.fn() }));
      await vi.dynamicImportSettled();
      await new Promise((r) => setTimeout(r, 0));
      expect(warn).toHaveBeenCalledWith("debug HUD did not load", expect.any(Error));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  describe("the stored vc-debug list", () => {
    it("mounts on a preview or staging deploy without the URL flag", async () => {
      vi.stubEnv("DEV", false);
      deploy.preview = true;
      localStorage.setItem("vc-debug", "fps");
      stubWebGL();
      await bootGame(() => ({ onUpdateAvailable: vi.fn() }));
      await vi.dynamicImportSettled();
      expect(hudStub.mount).toHaveBeenCalledTimes(1);
    });

    it("mounts on the dev server", async () => {
      localStorage.setItem("vc-debug", "all");
      stubWebGL();
      await bootGame(() => ({ onUpdateAvailable: vi.fn() }));
      await vi.dynamicImportSettled();
      expect(hudStub.mount).toHaveBeenCalledTimes(1);
    });

    it("is ignored in production, where only the URL flag works", async () => {
      vi.stubEnv("DEV", false);
      localStorage.setItem("vc-debug", "fps");
      stubWebGL();
      await bootGame(() => ({ onUpdateAvailable: vi.fn() }));
      await vi.dynamicImportSettled();
      expect(hudStub.mount).not.toHaveBeenCalled();
    });
  });
});
