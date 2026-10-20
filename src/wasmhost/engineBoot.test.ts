import { describe, expect, it, vi } from "vitest";
import type { WasmModule } from "../dualrun/binding";
import { EngineBootError, FALLBACK_REASONS, FALLBACK_STAGES, bootFailure, bootFailureReason, engineFailureCopy, failBoot, loadBootEngine, packageFailureOf, publishBootState, typescriptBoot, type EngineBootState } from "./engineBoot";
import { EnginePackageError, type PackageFailureKind } from "./enginePackageCheck";

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

const refusal = (kind: PackageFailureKind) =>
  new EnginePackageError(kind, `the ${kind} message`, { controlled: true, file: "wasm", expected: "aaaaaaaaaaaa", found: "bbbbbbbbbbbb", expectedPackage: "111111111111", servedPackage: "222222222222" });

describe("a refused engine package (#985)", () => {
  it("is a package mismatch only when the bytes disagree with the shell", () => {
    expect(bootFailureReason(refusal("mismatch"))).toBe("package-mismatch");
    expect(bootFailureReason(refusal("load-failed"))).toBe("boot-error");
    expect(bootFailureReason(refusal("unverifiable"))).toBe("boot-error");
  });

  it("keeps the kind, the file and both ids on the failure, beside the closed code", () => {
    expect(bootFailure("load", refusal("mismatch"))).toEqual({
      stage: "load",
      reason: "package-mismatch",
      message: "the mismatch message",
      package: { kind: "mismatch", file: "wasm", expected: "aaaaaaaaaaaa", found: "bbbbbbbbbbbb", expectedPackage: "111111111111", servedPackage: "222222222222", controlled: true },
    });
    // The detail is plain data, so a worker can post it.
    expect(structuredClone(bootFailure("load", refusal("load-failed")))).toMatchObject({ reason: "boot-error", package: { kind: "load-failed" } });
    expect(bootFailure("load", new Error("404"))).toEqual({ stage: "load", reason: "boot-error", message: "404" });
  });

  it("carries the detail through a boot error that a worker's reply became", () => {
    const pkg = packageFailureOf(refusal("mismatch"));
    expect(pkg?.kind).toBe("mismatch");
    const e = new EngineBootError("package-mismatch", "from the worker", pkg);
    expect(packageFailureOf(e)).toBe(pkg);
    expect(bootFailure("load", e).package).toBe(pkg);
    expect(packageFailureOf(new EngineBootError("boot-timeout", "slow"))).toBeUndefined();
  });

  it("falls back to the TypeScript engine on a switchable build and records the detail", async () => {
    const log = quiet();
    const r = await loadBootEngine({ wasmOnly: false, load: async () => Promise.reject(refusal("mismatch")), log });
    expect(r.module).toBeNull();
    expect(r.state).toMatchObject({ build: "switchable", engine: "ts", failure: { stage: "load", reason: "package-mismatch", package: { kind: "mismatch", expectedPackage: "111111111111" } } });
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it("stops a wasm-only build with the same detail", async () => {
    const r = await loadBootEngine({ wasmOnly: true, load: async () => Promise.reject(refusal("unverifiable")), log: quiet() });
    expect(r.state).toMatchObject({ build: "wasm-only", engine: "none", failure: { stage: "load", reason: "boot-error", package: { kind: "unverifiable" } } });
  });
});

describe("the load deadline", () => {
  it("aborts the signal the loader holds when it expires, before the timeout is published", async () => {
    vi.useFakeTimers();
    try {
      let seen: AbortSignal | undefined;
      const pending = loadBootEngine({
        wasmOnly: false,
        load: (signal) => {
          seen = signal;
          return new Promise<WasmModule>((_, fail) => signal.addEventListener("abort", () => fail(new Error("late"))));
        },
        log: quiet(),
        timeoutMs: 2000,
      });
      expect(seen?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(2000);
      expect(seen?.aborted).toBe(true);
      // The timeout wins over the load's own late rejection.
      expect((await pending).state.failure).toMatchObject({ reason: "boot-timeout", message: "the engine package did not load within 2 seconds" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves the signal alone when the load finishes in time", async () => {
    let seen: AbortSignal | undefined;
    await loadBootEngine({ wasmOnly: false, load: async (signal) => ((seen = signal), mod()), log: quiet() });
    expect(seen?.aborted).toBe(false);
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
