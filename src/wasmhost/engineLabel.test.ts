import { afterEach, describe, expect, it } from "vitest";
import { activeEngine, engineSuffix, refreshSplashVersion, versionLine } from "./engineLabel";
import { APP_VERSION } from "../appVersion";
import { IDENTITY_FIXTURE } from "./engineIdentity.fixture";
import { deferEngineIdentity, publishBootState, type EngineBootState } from "./engineBoot";
import { shortId } from "./enginePackageRecord";

describe("engine label", () => {
  it("names the Rust engine before it reports anything, since it is the only engine", () => {
    expect(activeEngine({})).toBe("ts");
    expect(engineSuffix({})).toBe(" · Rust engine");
    expect(versionLine("2.29.0", {})).toBe("v2.29.0 · Rust engine");
  });

  it("names the Rust engine's crate version and binary hash when its package reported them", () => {
    const hash = "ab".repeat(32);
    const boot = { identity: JSON.stringify(IDENTITY_FIXTURE), binary: { state: "ok" as const, sourceHash: hash } };
    const v = IDENTITY_FIXTURE.crate.version;
    expect(engineSuffix({ __vcEngine: { status: { hosted: true } }, __vcEngineBoot: boot })).toBe(` · Rust engine ${v} (${shortId(hash)})`);
    expect(engineSuffix({ __vcEngine: { status: { hosted: true, placement: "worker" } }, __vcEngineBoot: boot })).toBe(` · Rust engine ${v} (${shortId(hash)}, worker)`);
    expect(engineSuffix({ __vcEngine: { status: { hosted: true } }, __vcEngineBoot: { binary: { state: "missing" } } })).toBe(" · Rust engine");
  });

  it("never names the TypeScript engine, which no build carries (#1875), and says when the Rust engine stopped", () => {
    const hash = "cd".repeat(32);
    const v = IDENTITY_FIXTURE.crate.version;
    const identity = JSON.stringify(IDENTITY_FIXTURE);
    const idle = { status: { hosted: false } };
    // A trap stops the engine: the boot state reads none until the reload.
    const trapped = { build: "switchable" as const, engine: "none" as const, identity, binary: { state: "ok" as const, sourceHash: hash } };
    expect(engineSuffix({ __vcEngine: idle, __vcEngineBoot: trapped })).toBe(` · Rust engine ${v} (${shortId(hash)}, stopped)`);
    // A wasm-only build before its engine hosts a tower, and after it stopped.
    expect(engineSuffix({ __vcEngineBoot: { build: "wasm-only", engine: "wasm" } })).toBe(" · Rust engine");
    expect(engineSuffix({ __vcEngine: idle, __vcEngineBoot: { build: "wasm-only", engine: "none" } })).toBe(" · Rust engine (stopped)");
    // A switchable build starting Rust, before the host attaches.
    expect(engineSuffix({ __vcEngineBoot: { build: "switchable", engine: "wasm" } })).toBe(" · Rust engine");
    // A later tower the host would not take.
    expect(engineSuffix({ __vcEngine: idle, __vcEngineBoot: { build: "switchable", engine: "wasm" } })).toBe(" · Rust engine");
    expect(engineSuffix({ __vcEngine: { status: { hosted: true } }, __vcEngineBoot: { build: "wasm-only", engine: "wasm", identity } })).toBe(` · Rust engine ${v}`);
    // An old switchable boot state that chose TypeScript.
    expect(engineSuffix({ __vcEngineBoot: { build: "switchable", engine: "ts" } })).toBe(" · Rust engine");
  });

  it("names the WASM engine only while a tower is hosted", () => {
    const hosted = { __vcEngine: { status: { hosted: true } } };
    const idle = { __vcEngine: { status: { hosted: false } } };
    expect(activeEngine(hosted)).toBe("wasm");
    expect(activeEngine(idle)).toBe("ts");
    expect(versionLine("2.29.0", hosted)).toBe("v2.29.0 · Rust engine");
    expect(versionLine("2.29.0", idle)).toBe("v2.29.0 · Rust engine");
  });

  describe("on the page, with the identity record left for after boot (#1254)", () => {
    const g = globalThis as { __vcEngine?: { status: { hosted: boolean } }; __vcEngineBoot?: EngineBootState };
    afterEach(() => {
      deferEngineIdentity({});
      delete g.__vcEngine;
      delete g.__vcEngineBoot;
    });

    it("draws the title screen's line without reading it, and names the version once Settings or About asks", () => {
      let reads = 0;
      deferEngineIdentity({ engineIdentity: () => (reads++, JSON.stringify(IDENTITY_FIXTURE)) });
      g.__vcEngine = { status: { hosted: true } };
      publishBootState({ build: "wasm-only", engine: "wasm", failure: null });
      expect(versionLine("2.29.0")).toBe("v2.29.0 · Rust engine");
      expect(reads).toBe(0);
      const named = ` · Rust engine ${IDENTITY_FIXTURE.crate.version}`;
      expect(engineSuffix()).toBe(named);
      expect(versionLine("2.29.0")).toBe(`v2.29.0${named}`);
      expect(reads).toBe(1);
    });
  });

  it("rewrites a mounted splash version line and ignores a page without one", () => {
    const el = { textContent: "v0.0.0" } as HTMLElement;
    refreshSplashVersion({ querySelector: () => el } as unknown as Document);
    expect(el.textContent).toBe(`v${APP_VERSION} · Rust engine`);
    expect(() => refreshSplashVersion({ querySelector: () => null } as unknown as Document)).not.toThrow();
  });
});
