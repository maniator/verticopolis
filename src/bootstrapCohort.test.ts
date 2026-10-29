import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootGame } from "./bootstrap";

// Where boot tells the staged cohort (#1197) that Rust failed on this device:
// a package that did not load, or an engine that threw at start. A clean
// refusal of the stored tower is not a Rust failure. Split from
// bootstrapEngine.test.ts, which keeps the boot state and the rows.
vi.mock("@vercel/speed-insights", () => ({ injectSpeedInsights: vi.fn() }));
vi.mock("@vercel/analytics", () => ({ inject: vi.fn() }));
vi.mock("virtual:pwa-register", () => ({ registerSW: () => () => {} }));
vi.mock("./analyticsRelay", () => ({ sendToRelay: vi.fn() }));
const stub = vi.hoisted(() => ({ loadError: null as Error | null, startError: null as Error | null, rustCorrupt: false, notice: null as string | null | (() => never) }));
vi.mock("./engineCohort/boot", () => ({
  selectBootEngine: () => "wasm",
  noteRustFailed: vi.fn(),
  stageNotice: () => (typeof stub.notice === "function" ? stub.notice() : stub.notice),
}));
vi.mock("./wasmhost/rustEngine", async (importOriginal) => {
  const real = await importOriginal<typeof import("./wasmhost/rustEngine")>();
  return {
    ...real,
    loadWasmEngine: vi.fn(async () => {
      if (stub.loadError) throw stub.loadError;
      return { Engine: class {} };
    }),
    rustBootTower: vi.fn(() => {
      if (stub.startError) throw stub.startError;
      return { port: { lastReason: () => "refused" }, corrupt: stub.rustCorrupt, loaded: false, savedAt: undefined };
    }),
  };
});
vi.mock("./game/bootTower", async (importOriginal) => {
  const real = await importOriginal<typeof import("./game/bootTower")>();
  return { ...real, tsBootTower: vi.fn(() => ({ port: {}, corrupt: false, loaded: true, savedAt: undefined })) };
});
import { noteRustFailed } from "./engineCohort/boot";
import { setCurrentSelection } from "./engineCohort/current";

function stubWebGL(): void {
  const real = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "canvas") return { getContext: () => ({}) } as unknown as HTMLCanvasElement;
    return real(tag);
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(noteRustFailed).mockClear();
  stub.loadError = null;
  stub.startError = null;
  stub.rustCorrupt = false;
  stub.notice = null;
  setCurrentSelection(null);
  document.body.innerHTML = "";
  stubWebGL();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("bootGame and the cohort's safety suppression", () => {
  it("reports a package that did not load at the load stage", async () => {
    stub.loadError = new Error("404");
    await bootGame(() => ({ onUpdateAvailable: vi.fn() }));
    expect(noteRustFailed).toHaveBeenCalledExactlyOnceWith("load", "boot-error", undefined);
  });

  it("never reports a clean refusal of the stored tower", async () => {
    stub.rustCorrupt = true;
    await bootGame(() => ({ onUpdateAvailable: vi.fn() }));
    expect(noteRustFailed).not.toHaveBeenCalled();
  });

  it("reports an engine that threw at start", async () => {
    stub.startError = new Error("bad");
    await bootGame(() => ({ onUpdateAvailable: vi.fn() }));
    expect(noteRustFailed).toHaveBeenCalledExactlyOnceWith("start", "boot-error", undefined);
  });
});

describe("bootGame and the stage-change notice", () => {
  it("shows the notice once as a toast after the engine settles", async () => {
    stub.notice = "This game now runs on the new Rust engine as part of a test.";
    const toast = vi.fn();
    await bootGame(() => ({ onUpdateAvailable: vi.fn(), ui: { toast } }));
    expect(toast).toHaveBeenCalledExactlyOnceWith(stub.notice);
  });

  it("names the size gate instead, once, when it moved the tower off the Rust engine (#1197)", async () => {
    stub.notice = "This game now runs on the new Rust engine as part of a test.";
    setCurrentSelection({ stage: 2, preference: "auto", suppression: null, crashLoop: false, transition: "none", notice: "none", markerId: null, boot: "ts", requested: "wasm", selectedBy: "cohort", assignedArm: "wasm", sizeGated: true });
    const toast = vi.fn();
    await bootGame(() => ({ onUpdateAvailable: vi.fn(), ui: { toast } }));
    expect(toast).toHaveBeenCalledExactlyOnceWith("This tower is larger than the Rust engine test covers yet, so it runs on the TypeScript engine.");
  });

  it("shows nothing without a notice", async () => {
    const toast = vi.fn();
    await bootGame(() => ({ onUpdateAvailable: vi.fn(), ui: { toast } }));
    expect(toast).not.toHaveBeenCalled();
  });

  it("keeps booting when the notice throws", async () => {
    stub.notice = () => {
      throw new Error("bad");
    };
    const toast = vi.fn();
    await bootGame(() => ({ onUpdateAvailable: vi.fn(), ui: { toast } }));
    expect(toast).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith("[engine] could not show the engine test notice:", expect.any(Error));
  });
});
