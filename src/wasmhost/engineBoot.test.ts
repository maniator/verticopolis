import { describe, expect, it, vi } from "vitest";
import type { WasmModule } from "../dualrun/binding";
import { EngineBootError, FALLBACK_REASONS, FALLBACK_STAGES, bootFailureReason, engineFailureCopy, failBoot, loadBootEngine, publishBootState, typescriptBoot, type EngineBootState } from "./engineBoot";

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
    expect(r).toEqual({ module: null, state: { build: "switchable", engine: "ts", failure: { stage: "load", reason: "boot-error", message: "404" } } });
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
    expect(r).toEqual({ module: null, state: { build: "wasm-only", engine: "none", failure: { stage: "load", reason: "boot-error", message: "CompileError: bad magic" } } });
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining("no other engine"), expect.any(Error));
  });

  it("gives up on a load that never settles", async () => {
    vi.useFakeTimers();
    try {
      const pending = loadBootEngine({ wasmOnly: true, load: () => new Promise<WasmModule>(() => {}), log: quiet(), timeoutMs: 1000 });
      await vi.advanceTimersByTimeAsync(1000);
      expect((await pending).state.failure).toEqual({ stage: "load", reason: "boot-timeout", message: "the engine package did not load within 1 second" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("names a thrown non-Error", async () => {
    const r = await loadBootEngine({ wasmOnly: true, load: async () => Promise.reject("offline"), log: quiet() });
    expect(r.state.failure).toEqual({ stage: "load", reason: "boot-error", message: "offline" });
  });

  it("refuses a package without the engine's save writer", async () => {
    const r = await loadBootEngine({ wasmOnly: true, load: async () => mod(false), log: quiet() });
    expect(r.module).toBeNull();
    expect(r.state).toMatchObject({ engine: "none", failure: { stage: "load", reason: "package-mismatch", message: expect.stringContaining("encodeVctower") } });
  });
});

describe("fallback reason codes", () => {
  it("keeps the lists closed, with none first and the runtime codes reserved", () => {
    expect(FALLBACK_REASONS).toEqual(["none", "boot-timeout", "boot-error", "package-mismatch", "attach-refused", "trap-command", "trap-tick", "trap-undo", "other"]);
    expect(FALLBACK_STAGES).toEqual(["none", "load", "start", "adopt", "undo"]);
  });

  it("takes a typed failure's own code, reads a link failure as a mismatched package, and calls the rest a boot error", () => {
    expect(bootFailureReason(new EngineBootError("boot-timeout", "slow"))).toBe("boot-timeout");
    expect(bootFailureReason(new EngineBootError("package-mismatch", "old glue"))).toBe("package-mismatch");
    expect(bootFailureReason(new WebAssembly.LinkError("import object field 'wbg' is not a Function"))).toBe("package-mismatch");
    expect(bootFailureReason(new WebAssembly.CompileError("bad magic"))).toBe("boot-error");
    expect(bootFailureReason(new Error("404"))).toBe("boot-error");
    expect(bootFailureReason("offline")).toBe("boot-error");
  });

  it("reports a glue and binary that do not link as a package mismatch", async () => {
    const r = await loadBootEngine({ wasmOnly: false, load: async () => Promise.reject(new WebAssembly.LinkError("bad import")), log: quiet() });
    expect(r.state.failure).toMatchObject({ stage: "load", reason: "package-mismatch" });
  });
});

describe("failBoot and publishBootState", () => {
  it("marks a wasm-only build as running no engine, and a switchable one as back on TypeScript", () => {
    expect(failBoot({ build: "wasm-only", engine: "wasm", failure: null }, "host", "attach-refused", "trap")).toEqual({ build: "wasm-only", engine: "none", failure: { stage: "host", reason: "attach-refused", message: "trap" } });
    expect(failBoot({ build: "switchable", engine: "wasm", failure: null }, "start", "boot-error", "x")).toEqual({ build: "switchable", engine: "ts", failure: { stage: "start", reason: "boot-error", message: "x" } });
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
    const online = engineFailureCopy({ stage: "load", reason: "boot-error", message: "404" }, true);
    expect(online.headline).toMatch(/could not start/);
    expect(online.reason).toBe("404");
    expect(online.steps[0]).toMatch(/^Reload the page/);
    expect(online.steps.some((s) => /offline/.test(s))).toBe(false);
    const offline = engineFailureCopy({ stage: "load", reason: "boot-error", message: "404" }, false);
    expect(offline.steps.some((s) => /You appear to be offline/.test(s))).toBe(true);
  });

  it("tells a mid-game stop apart from a failed start", () => {
    const host = engineFailureCopy({ stage: "host", reason: "attach-refused", message: "x" }, true);
    expect(host.headline).toMatch(/stopped running this tower, so the game has stopped/);
    expect(host.steps[0]).toMatch(/continue from your last save/);
  });

  it("keeps the copy free of em-dashes", () => {
    const all = [engineFailureCopy({ stage: "host", reason: "attach-refused", message: "" }, false), engineFailureCopy({ stage: "load", reason: "boot-error", message: "" }, false)].flatMap((c) => [c.headline, ...c.steps]);
    for (const line of all) expect(line).not.toMatch(/\u2014/);
  });
});

describe("loadBootEngine, engine identity (#963)", () => {
  const withIdentity = (fn: () => string) => ({ ...mod(), engineIdentity: fn }) as unknown as WasmModule;

  it("carries the engine's record on the boot state, in both build modes", async () => {
    for (const wasmOnly of [false, true]) {
      const r = await loadBootEngine({ wasmOnly, load: async () => withIdentity(() => '{"schema":1}') });
      expect(r.state.identity).toBe('{"schema":1}');
    }
  });

  it("boots on, with no identity, a package without the call or one whose call throws", async () => {
    const throwing = withIdentity(() => {
      throw new Error("trap");
    });
    for (const m of [mod(), throwing]) {
      const r = await loadBootEngine({ wasmOnly: false, load: async () => m });
      expect(r.state).toEqual({ build: "switchable", engine: "wasm", failure: null });
    }
  });

  it("keeps the record when a later failure puts the game back on TypeScript", async () => {
    const r = await loadBootEngine({ wasmOnly: false, load: async () => withIdentity(() => "{}") });
    expect(failBoot(r.state, "start", "attach-refused", "x").identity).toBe("{}");
  });
});

describe("loadBootEngine, the engine binary's build metadata (#963)", () => {
  const ok = { state: "ok", sourceHash: "a".repeat(64) } as const;

  it("carries what the binary's section said on the boot state, in both build modes", async () => {
    for (const wasmOnly of [false, true]) {
      const r = await loadBootEngine({
        wasmOnly,
        load: async (onBuild) => {
          onBuild(ok);
          return mod();
        },
      });
      expect(r.state.binary).toEqual(ok);
    }
  });

  it("carries a missing or malformed section too, and boots on", async () => {
    for (const binary of [{ state: "missing" }, { state: "malformed", why: "not JSON" }] as const) {
      const r = await loadBootEngine({
        wasmOnly: false,
        load: async (onBuild) => {
          onBuild(binary);
          return mod();
        },
      });
      expect(r.state).toEqual({ build: "switchable", engine: "wasm", failure: null, binary });
    }
  });

  it("leaves the field out when the loader never read a binary", async () => {
    const r = await loadBootEngine({ wasmOnly: false, load: async () => mod() });
    expect("binary" in r.state).toBe(false);
  });

  it("keeps it when the load then fails, in both build modes", async () => {
    for (const wasmOnly of [false, true]) {
      const r = await loadBootEngine({
        wasmOnly,
        log: quiet(),
        load: async (onBuild) => {
          onBuild(ok);
          throw new WebAssembly.LinkError("import mismatch");
        },
      });
      expect(r.module).toBeNull();
      expect(r.state.failure).toMatchObject({ stage: "load", reason: "package-mismatch" });
      expect(r.state.binary).toEqual(ok);
    }
  });

  it("keeps it when a wasm-only build refuses a package with no save writer", async () => {
    const r = await loadBootEngine({
      wasmOnly: true,
      log: quiet(),
      load: async (onBuild) => {
        onBuild(ok);
        return mod(false);
      },
    });
    expect(r.state.engine).toBe("none");
    expect(r.state.binary).toEqual(ok);
  });

  it("keeps it when a later failure puts the game back on TypeScript", async () => {
    const r = await loadBootEngine({
      wasmOnly: false,
      load: async (onBuild) => {
        onBuild(ok);
        return mod();
      },
    });
    expect(failBoot(r.state, "start", "attach-refused", "x").binary).toEqual(ok);
  });

  it("does not report a build that arrives after the load timed out", async () => {
    vi.useFakeTimers();
    try {
      let late: ((b: typeof ok) => void) | undefined;
      const pending = loadBootEngine({
        wasmOnly: false,
        timeoutMs: 1000,
        log: quiet(),
        load: (onBuild) => {
          late = onBuild;
          return new Promise<WasmModule>(() => {});
        },
      });
      await vi.advanceTimersByTimeAsync(1000);
      const r = await pending;
      late?.(ok);
      expect(r.state.failure?.reason).toBe("boot-timeout");
      expect("binary" in r.state).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
