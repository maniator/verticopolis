import { afterEach, describe, expect, it, vi } from "vitest";
import { bootGame } from "./bootstrap";
import { EngineBootError } from "./wasmhost/engineBoot";

vi.mock("@vercel/speed-insights", () => ({ injectSpeedInsights: vi.fn() }));
vi.mock("@vercel/analytics", () => ({ inject: vi.fn() }));
vi.mock("virtual:pwa-register", () => ({ registerSW: () => () => {} }));
vi.mock("./analyticsRelay", () => ({ sendToRelay: vi.fn() }));
vi.mock("./wasmhost/engineChoice", async (importOriginal) => ({ ...(await importOriginal<typeof import("./wasmhost/engineChoice")>()), engineRequested: () => "wasm-worker" }));
// The worker the page spawns refuses the package, as the engine worker's byte check does.
const refusal = vi.hoisted(() => ({ error: null as unknown }));
vi.mock("./wasmhost/workerController", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./wasmhost/workerController")>()),
  spawnEngineWorker: vi.fn(async () => {
    throw refusal.error;
  }),
}));

/** Make hasWebGL() see a real GL context (happy-dom canvas returns null). */
function stubWebGL(): void {
  const real = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => (tag === "canvas" ? ({ getContext: () => ({}) } as unknown as HTMLCanvasElement) : real(tag)));
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  delete (window as unknown as { game?: unknown }).game;
});

describe("bootGame, a worker whose package check refuses the engine (#985)", () => {
  it("keeps the refusal's detail and the binary's build on the published boot state", async () => {
    stubWebGL();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const detail = { kind: "mismatch" as const, file: "wasm" as const, expected: "aaaaaaaaaaaa", found: "bbbbbbbbbbbb", expectedPackage: "111111111111", servedPackage: "222222222222", controlled: true };
    const build = { state: "ok" as const, sourceHash: "ab".repeat(32) };
    refusal.error = Object.assign(new EngineBootError("package-mismatch", "could not load the WASM engine: refused", detail), { build });
    await bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn() })));
    const boot = (globalThis as { __vcEngineBoot?: { engine: string; failure: unknown; binary: unknown } }).__vcEngineBoot;
    expect(boot).toMatchObject({ engine: "ts", binary: build });
    expect(boot?.failure).toEqual({ stage: "load", reason: "package-mismatch", message: "could not load the WASM engine: refused", package: detail });
  });

  it("codes a plain error as a boot error, with no package detail", async () => {
    stubWebGL();
    vi.spyOn(console, "error").mockImplementation(() => {});
    refusal.error = new Error("the engine worker failed to start: no module");
    await bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn() })));
    const boot = (globalThis as { __vcEngineBoot?: { failure: Record<string, unknown> } }).__vcEngineBoot;
    expect(boot?.failure).toMatchObject({ stage: "load", reason: "boot-error" });
    expect("package" in (boot?.failure ?? {})).toBe(false);
  });
});
