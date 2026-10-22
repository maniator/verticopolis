import { afterEach, describe, expect, it, vi } from "vitest";
import { bootGame } from "./bootstrap";
import { EngineBootError } from "./wasmhost/engineBoot";
import { fakeModule } from "./wasmhost/fakeEngine.fixture";

vi.mock("@vercel/speed-insights", () => ({ injectSpeedInsights: vi.fn() }));
vi.mock("@vercel/analytics", () => ({ inject: vi.fn() }));
vi.mock("virtual:pwa-register", () => ({ registerSW: () => () => {} }));
vi.mock("./analyticsRelay", () => ({ sendToRelay: vi.fn() }));
vi.mock("./wasmhost/engineChoice", async (importOriginal) => ({ ...(await importOriginal<typeof import("./wasmhost/engineChoice")>()), engineRequested: () => "wasm-worker" }));
// The worker the page spawns refuses the package, as the engine worker's byte check does.
// With `catalogs` set the worker starts, answering ready with those catalogs, and the host refuses the first tower.
const refusal = vi.hoisted(() => ({ error: null as unknown, catalogs: null as { classic: string; modern: string } | null }));
vi.mock("./wasmhost/workerController", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./wasmhost/workerController")>()),
  spawnEngineWorker: vi.fn(async () => {
    if (refusal.catalogs) return { worker: { terminate: vi.fn() }, catalogs: refusal.catalogs };
    throw refusal.error;
  }),
  startWorkerHost: vi.fn(() => ({ status: { hosted: false, errors: ["not hosting this tower"], lastError: "not hosting this tower", droppedErrors: 0 }, stop: vi.fn() })),
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

  it("codes a refused first tower by the catalogs the worker answered ready with (#1086)", async () => {
    stubWebGL();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const own = fakeModule().catalog as (mode: string) => string;
    const reasonFor = async (catalogs: { classic: string; modern: string }): Promise<unknown> => {
      refusal.catalogs = catalogs;
      await bootGame(vi.fn(() => ({ onUpdateAvailable: vi.fn() })));
      return (globalThis as { __vcEngineBoot?: { failure?: { stage: string; reason: string } } }).__vcEngineBoot?.failure;
    };
    // Catalogs this build cannot draw are a mismatched package; catalogs the worker could not hand over are not.
    expect(await reasonFor({ classic: "{}", modern: "{}" })).toMatchObject({ stage: "start", reason: "package-mismatch" });
    expect(await reasonFor({ classic: "not json", modern: "not json" })).toMatchObject({ stage: "start", reason: "attach-refused" });
    expect(await reasonFor({ classic: own("classic"), modern: own("modern") })).toMatchObject({ stage: "start", reason: "attach-refused" });
    refusal.catalogs = null;
  });
});
