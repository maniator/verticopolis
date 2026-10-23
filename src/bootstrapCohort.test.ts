import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootGame } from "./bootstrap";

// Where boot tells the staged cohort (#1197) that Rust failed on this device:
// a package that did not load, a fault the host latched, a host that threw
// at start. A clean refusal of one tower is not a Rust failure. Split from
// bootstrapEngine.test.ts, which keeps the boot state and the rows.
vi.mock("@vercel/speed-insights", () => ({ injectSpeedInsights: vi.fn() }));
vi.mock("@vercel/analytics", () => ({ inject: vi.fn() }));
vi.mock("virtual:pwa-register", () => ({ registerSW: () => () => {} }));
vi.mock("./analyticsRelay", () => ({ sendToRelay: vi.fn() }));
const stub = vi.hoisted(() => ({ loadError: null as Error | null, notice: null as string | null | (() => never) }));
vi.mock("./engineCohort/boot", () => ({
  selectBootEngine: () => "wasm",
  noteRustFailed: vi.fn(),
  stageNotice: () => (typeof stub.notice === "function" ? stub.notice() : stub.notice),
}));
vi.mock("./wasmhost/startWasmHost", async (importOriginal) => {
  const real = await importOriginal<typeof import("./wasmhost/startWasmHost")>();
  return {
    ...real,
    loadWasmEngine: vi.fn(async () => {
      if (stub.loadError) throw stub.loadError;
      return { Engine: class {} };
    }),
    startWasmHost: vi.fn(),
  };
});
import { startWasmHost, type WasmHostHandle, type WasmHostOptions } from "./wasmhost/startWasmHost";
import { noteRustFailed } from "./engineCohort/boot";

function stubWebGL(): void {
  const real = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "canvas") return { getContext: () => ({}) } as unknown as HTMLCanvasElement;
    return real(tag);
  });
}

const status = (over: Partial<WasmHostHandle["status"]> = {}) =>
  ({ engine: "wasm", starts: 1, hosted: true, fallbacks: 0, lastFallback: null, latched: false, restorePoint: null, errors: [], lastError: null, droppedErrors: 0, ...over }) as WasmHostHandle["status"];

/** Boot with a host that hands over its options, so a test can report a fallback. */
async function boot(start: (o: WasmHostOptions | undefined) => WasmHostHandle["status"] = () => status()): Promise<WasmHostOptions | undefined> {
  let opts: WasmHostOptions | undefined;
  vi.mocked(startWasmHost).mockImplementationOnce((_app, _mod, _log, o) => {
    opts = o;
    return { status: start(o), current: () => null, stop: () => {} } as unknown as WasmHostHandle;
  });
  await bootGame(() => ({ onUpdateAvailable: vi.fn() }));
  return opts;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(noteRustFailed).mockClear();
  stub.loadError = null;
  stub.notice = null;
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

  it("reports a latched fault with the stage of the tower it hit", async () => {
    const opts = await boot();
    expect(noteRustFailed).not.toHaveBeenCalled();
    expect(opts?.onFallback).toBeTypeOf("function");
    opts!.onFallback!({ reason: "trap-tick", stage: "adopt" }, true);
    expect(noteRustFailed).toHaveBeenCalledExactlyOnceWith("adopt", "trap-tick", undefined);
  });

  it("reports a first tower whose attach trapped", async () => {
    await boot((o) => {
      o?.onFallback?.({ reason: "attach-refused", stage: "start" }, true);
      return status({ starts: 0, hosted: false, fallbacks: 1, lastFallback: { reason: "attach-refused", stage: "start" }, latched: true, lastError: "trapped" });
    });
    expect(noteRustFailed).toHaveBeenCalledExactlyOnceWith("start", "attach-refused", undefined);
  });

  it("never reports a clean refusal of one tower", async () => {
    const opts = await boot((o) => {
      o?.onFallback?.({ reason: "attach-refused", stage: "start" }, false);
      return status({ starts: 0, hosted: false, fallbacks: 1, lastFallback: { reason: "attach-refused", stage: "start" }, lastError: "refused" });
    });
    expect(opts?.onFallback).toBeTypeOf("function");
    opts!.onFallback!({ reason: "attach-refused", stage: "adopt" }, false);
    expect(noteRustFailed).not.toHaveBeenCalled();
  });

  it("never reports a package mismatch the host did not latch, keeping the approved scoping", async () => {
    const opts = await boot();
    opts!.onFallback!({ reason: "package-mismatch", stage: "adopt" }, false);
    expect(noteRustFailed).not.toHaveBeenCalled();
    opts!.onFallback!({ reason: "package-mismatch", stage: "adopt" }, true);
    expect(noteRustFailed).toHaveBeenCalledExactlyOnceWith("adopt", "package-mismatch", undefined);
  });

  it("reports a host that threw at start", async () => {
    vi.mocked(startWasmHost).mockImplementationOnce(() => {
      throw new Error("bad");
    });
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
