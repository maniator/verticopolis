import { describe, expect, it, vi } from "vitest";
import type { WasmModule } from "../dualrun/binding";
import { engineFailureCopy, failBoot, loadBootEngine, publishBootState, typescriptBoot, type EngineBootState } from "./engineBoot";

const mod = (withWriter = true) => ({ Engine: class {}, ...(withWriter ? { encodeVctower: () => new Uint8Array() } : {}) }) as unknown as WasmModule;
const quiet = () => ({ error: vi.fn() });

describe("loadBootEngine, switchable build", () => {
  it("boots on the TypeScript engine, with nothing to load, when WASM is not asked for", () => {
    expect(typescriptBoot()).toEqual({ module: null, state: { build: "switchable", engine: "ts", failure: null } });
  });

  it("loads WASM when asked", async () => {
    const m = mod();
    const r = await loadBootEngine({ wasmOnly: false, load: async () => m });
    expect(r).toEqual({ module: m, state: { build: "switchable", engine: "wasm", failure: null } });
  });

  it("falls back to the TypeScript engine on a load failure, with the reason in the console", async () => {
    const log = quiet();
    const r = await loadBootEngine({ wasmOnly: false, load: async () => Promise.reject(new Error("404")), log });
    expect(r).toEqual({ module: null, state: { build: "switchable", engine: "ts", failure: null } });
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining("running on the TypeScript engine"), expect.any(Error));
  });

  it("keeps a package without a save writer (the TypeScript writer stays)", async () => {
    const m = mod(false);
    expect((await loadBootEngine({ wasmOnly: false, load: async () => m })).module).toBe(m);
  });
});

describe("loadBootEngine, wasm-only build", () => {
  it("loads the engine", async () => {
    const m = mod();
    const r = await loadBootEngine({ wasmOnly: true, load: async () => m });
    expect(r).toEqual({ module: m, state: { build: "wasm-only", engine: "wasm", failure: null } });
  });

  it("reports a load failure as a failure, never as the TypeScript engine", async () => {
    const log = quiet();
    const r = await loadBootEngine({ wasmOnly: true, load: async () => Promise.reject(new Error("CompileError: bad magic")), log });
    expect(r).toEqual({ module: null, state: { build: "wasm-only", engine: "none", failure: { stage: "load", message: "CompileError: bad magic" } } });
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining("no other engine"), expect.any(Error));
  });

  it("names a thrown non-Error", async () => {
    const r = await loadBootEngine({ wasmOnly: true, load: async () => Promise.reject("offline"), log: quiet() });
    expect(r.state.failure).toEqual({ stage: "load", message: "offline" });
  });

  it("refuses a package without the engine's save writer", async () => {
    const r = await loadBootEngine({ wasmOnly: true, load: async () => mod(false), log: quiet() });
    expect(r.module).toBeNull();
    expect(r.state).toMatchObject({ engine: "none", failure: { stage: "load", message: expect.stringContaining("encodeVctower") } });
  });
});

describe("failBoot and publishBootState", () => {
  it("marks a wasm-only build as running no engine, and a switchable one as back on TypeScript", () => {
    expect(failBoot({ build: "wasm-only", engine: "wasm", failure: null }, "host", "trap")).toEqual({ build: "wasm-only", engine: "none", failure: { stage: "host", message: "trap" } });
    expect(failBoot({ build: "switchable", engine: "wasm", failure: null }, "start", "x")).toEqual({ build: "switchable", engine: "ts", failure: { stage: "start", message: "x" } });
  });

  it("publishes the state for tooling", () => {
    const g: { __vcEngineBoot?: EngineBootState } = {};
    const state = { build: "wasm-only" as const, engine: "wasm" as const, failure: null };
    publishBootState(state, g);
    expect(g.__vcEngineBoot).toBe(state);
  });
});

describe("engineFailureCopy", () => {
  it("says what happened, why, and what to try, with the offline step only offline", () => {
    const online = engineFailureCopy({ stage: "load", message: "404" }, true);
    expect(online.headline).toMatch(/could not start/);
    expect(online.reason).toBe("404");
    expect(online.steps[0]).toMatch(/^Reload the page/);
    expect(online.steps.some((s) => /offline/.test(s))).toBe(false);
    const offline = engineFailureCopy({ stage: "load", message: "404" }, false);
    expect(offline.steps.some((s) => /You appear to be offline/.test(s))).toBe(true);
  });

  it("tells a mid-game stop apart from a failed start", () => {
    expect(engineFailureCopy({ stage: "host", message: "x" }, true).headline).toMatch(/stopped running this tower/);
  });

  it("keeps the copy free of em-dashes", () => {
    const all = [engineFailureCopy({ stage: "host", message: "" }, false), engineFailureCopy({ stage: "load", message: "" }, false)].flatMap((c) => [c.headline, ...c.steps]);
    for (const line of all) expect(line).not.toMatch(/\u2014/);
  });
});
