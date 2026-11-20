import { afterEach, describe, expect, it, vi } from "vitest";
import { bootGame } from "./bootstrap";

vi.mock("@vercel/speed-insights", () => ({ injectSpeedInsights: vi.fn() }));
vi.mock("@vercel/analytics", () => ({ inject: vi.fn() }));
vi.mock("virtual:pwa-register", () => ({ registerSW: () => () => {} }));
// The package load is stubbed to fail the way the byte check refuses another
// build's files, so boot's answer to it can be asserted without a package.
const loadStub = vi.hoisted(() => ({ error: null as Error | null }));
vi.mock("@verticopolis/components/host/rustEngine", async (importOriginal) => {
  const real = await importOriginal<typeof import("@verticopolis/components/host/rustEngine")>();
  return {
    ...real,
    loadWasmEngine: vi.fn(async () => {
      throw loadStub.error ?? new Error("no package in this test");
    }),
  };
});
// The reload itself, so a test can say whether the page would reload.
vi.mock("./engineCrash/mismatchReload", async (importOriginal) => {
  const real = await importOriginal<typeof import("./engineCrash/mismatchReload")>();
  return { ...real, reloadForMatchingFiles: vi.fn() };
});
vi.mock("./analyticsRelay", () => ({ sendToRelay: vi.fn() }));
import { sendToRelay } from "./analyticsRelay";
import { resetEngineStatus } from "./analyticsEngineStatus";
import { EngineBootError, type PackageFailure } from "@verticopolis/components/host/engineBoot";
import { MISMATCH_RELOAD_KEY, MISMATCH_RELOAD_LINE, reloadForMatchingFiles } from "./engineCrash/mismatchReload";

/** Make hasWebGL() see a real GL context (happy-dom canvas returns null). */
function stubWebGL(): void {
  const real = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "canvas") return { getContext: () => ({}) } as unknown as HTMLCanvasElement;
    return real(tag);
  });
}

const detail = {
  file: "wasm",
  expected: "111111111111",
  found: "222222222222",
  expectedPackage: "aaaaaaaaaaaa",
  servedPackage: "bbbbbbbbbbbb",
  controlled: false,
} as const;
const refused = (kind: PackageFailure["kind"], controlled = false) =>
  new EngineBootError("package-mismatch", "the engine binary is not the one this build expects", {
    ...detail,
    kind,
    controlled,
  });

/** Every event the relay saw, by name. */
const sent = (name: string): Record<string, unknown>[] =>
  vi
    .mocked(sendToRelay)
    .mock.calls.filter(([n]) => n === name)
    .map(([, props]) => props as Record<string, unknown>);

/**
 * Boot's one reload for engine files from another build: a cached older page
 * meeting a newer deploy reloads once by itself instead of stopping, and a
 * page that comes back as the same build stops as before.
 */
describe("bootGame with engine files from another build", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    sessionStorage.clear();
    vi.mocked(reloadForMatchingFiles).mockClear();
    document.body.innerHTML = "";
    window.location.href = "http://localhost:3000/";
    loadStub.error = null;
    delete (globalThis as { __vcEngineBoot?: unknown }).__vcEngineBoot;
  });

  const boot = (create = vi.fn((_tower: unknown) => ({ onUpdateAvailable: vi.fn() }))) => {
    resetEngineStatus();
    vi.mocked(sendToRelay).mockClear();
    window.location.href = "https://verticopolis.com/";
    return { create, run: bootGame(create) };
  };

  it("reloads once, says so, and reports the reload instead of an exception", async () => {
    stubWebGL();
    vi.spyOn(console, "error").mockImplementation(() => {});
    document.body.innerHTML = '<div id="stage"></div>';
    loadStub.error = refused("mismatch");
    const { create, run } = boot();
    await expect(run).resolves.toBeUndefined();
    expect(reloadForMatchingFiles).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
    expect(
      (globalThis as { __vcEngineBoot?: unknown }).__vcEngineBoot,
      "only the page that stays publishes its boot state",
    ).toBeUndefined();
    expect(document.getElementById("boot-fallback-host")!.textContent).toContain(MISMATCH_RELOAD_LINE);
    expect(sent("app_action")).toEqual([expect.objectContaining({ action: "engine_reload", detail: "mismatch" })]);
    expect(sent("engine_status").filter((r) => r.trigger === "settle")).toEqual([
      expect.objectContaining({ engine: "none", fallback_reason: "package-mismatch", fallback_stage: "load" }),
    ]);
    expect(JSON.parse(sessionStorage.getItem(MISMATCH_RELOAD_KEY)!)).toEqual([__APP_SHA__]);
  });

  it("stops with the engine screen when the page comes back as the same build", async () => {
    stubWebGL();
    vi.spyOn(console, "error").mockImplementation(() => {});
    document.body.innerHTML = '<div id="stage"></div>';
    loadStub.error = refused("mismatch");
    sessionStorage.setItem(MISMATCH_RELOAD_KEY, JSON.stringify([__APP_SHA__]));
    await expect(boot().run).rejects.toThrow(/did not start \(load\): package-mismatch, mismatch/);
    expect(reloadForMatchingFiles).not.toHaveBeenCalled();
    expect((globalThis as { __vcEngineBoot?: { failure?: unknown } }).__vcEngineBoot?.failure).toMatchObject({
      reason: "package-mismatch",
    });
    expect(sent("app_action").filter((r) => r.action === "engine_reload")).toEqual([]);
    expect(document.getElementById("boot-fallback-host")!.textContent).toMatch(/do not match this version of the game/);
  });

  it("stops without a reload on a page a service worker controls", async () => {
    stubWebGL();
    vi.spyOn(console, "error").mockImplementation(() => {});
    document.body.innerHTML = '<div id="stage"></div>';
    loadStub.error = refused("mismatch", true);
    await expect(boot().run).rejects.toThrow(/did not start \(load\): package-mismatch, mismatch/);
    expect(reloadForMatchingFiles).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(MISMATCH_RELOAD_KEY)).toBeNull();
  });

  it("never reloads for files that did not arrive", async () => {
    stubWebGL();
    vi.spyOn(console, "error").mockImplementation(() => {});
    document.body.innerHTML = '<div id="stage"></div>';
    loadStub.error = refused("load-failed");
    await expect(boot().run).rejects.toThrow(/did not start/);
    expect(reloadForMatchingFiles).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(MISMATCH_RELOAD_KEY)).toBeNull();
  });
});
