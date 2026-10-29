import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootGame } from "./bootstrap";

// The size gate at boot (#1197): with the flag on at a gated stage, a cohort
// tower above the threshold boots on TypeScript before the package loads, and
// the settle row says `size_gated`. The flag ships off (`config.test.ts`).
vi.mock("@vercel/speed-insights", () => ({ injectSpeedInsights: vi.fn() }));
vi.mock("@vercel/analytics", () => ({ inject: vi.fn() }));
vi.mock("virtual:pwa-register", () => ({ registerSW: () => () => {} }));
vi.mock("./analyticsRelay", () => ({ sendToRelay: vi.fn() }));
const stub = vi.hoisted(() => ({ chars: 0, selectedBy: "cohort" }));
vi.mock("./engineCohort/config", async (importOriginal) => ({ ...(await importOriginal<typeof import("./engineCohort/config")>()), SIZE_GATE_ON: true, SIZE_GATE_THRESHOLD: 10 }));
vi.mock("./engineCohort/current", () => ({ currentSelection: () => ({ stage: 2, selectedBy: stub.selectedBy, requested: "wasm", boot: "wasm" }) }));
vi.mock("./engineCohort/boot", () => ({ selectBootEngine: () => "wasm", noteRustFailed: vi.fn(), stageNotice: () => null }));
vi.mock("./analyticsEngineStatus", async (importOriginal) => ({ ...(await importOriginal<typeof import("./analyticsEngineStatus")>()), noteEngineSettled: vi.fn() }));
vi.mock("./wasmhost/rustEngine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./wasmhost/rustEngine")>()),
  loadWasmEngine: vi.fn(async () => ({ Engine: class {} })),
  rustBootTower: vi.fn(() => ({ port: { lastReason: () => undefined }, corrupt: false, loaded: true, savedAt: undefined })),
}));
vi.mock("./game/bootTower", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./game/bootTower")>()),
  storedSaveChars: () => stub.chars,
  tsBootTower: vi.fn(() => ({ port: {}, corrupt: false, loaded: true, savedAt: undefined })),
}));
import { noteEngineSettled } from "./analyticsEngineStatus";
import { tsBootTower } from "./game/bootTower";
import { loadWasmEngine } from "./wasmhost/rustEngine";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(noteEngineSettled).mockClear();
  vi.mocked(loadWasmEngine).mockClear();
  vi.mocked(tsBootTower).mockClear();
  stub.selectedBy = "cohort";
  document.body.innerHTML = "";
  const real = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => (tag === "canvas" ? ({ getContext: () => ({}) } as unknown as HTMLCanvasElement) : real(tag)));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const settled = () => vi.mocked(noteEngineSettled).mock.calls[0]![0];

describe("the size gate at boot", () => {
  it("boots a cohort tower above the threshold on TypeScript, without loading the package, and says so", async () => {
    stub.chars = 11;
    const toast = vi.fn();
    await bootGame(() => ({ onUpdateAvailable: vi.fn(), ui: { toast } }));
    expect(toast).toHaveBeenCalledExactlyOnceWith("This tower is larger than the Rust engine test covers yet, so it runs on the TypeScript engine.");
    expect(loadWasmEngine).not.toHaveBeenCalled();
    expect(tsBootTower).toHaveBeenCalled();
    expect(settled()).toMatchObject({ requested: "wasm", boot: "ts", sizeGated: true, failure: null });
  });

  it("leaves a tower at the threshold, and a player's own choice, on the engine boot chose", async () => {
    stub.chars = 10;
    await bootGame(() => ({ onUpdateAvailable: vi.fn() }));
    expect(loadWasmEngine).toHaveBeenCalled();
    expect(settled().sizeGated).toBeUndefined();
    vi.mocked(noteEngineSettled).mockClear();
    stub.chars = 11;
    stub.selectedBy = "setting";
    await bootGame(() => ({ onUpdateAvailable: vi.fn() }));
    expect(settled().sizeGated).toBeUndefined();
  });
});
