import { describe, expect, it } from "vitest";
import { activeEngine, engineSuffix, refreshSplashVersion, versionLine } from "./engineLabel";
import { APP_VERSION } from "../appVersion";
import { IDENTITY_FIXTURE } from "./engineIdentity.fixture";
import { shortId } from "./enginePackageRecord";
import { TS_ENGINE_SOURCES, TS_ENGINE_VERSION } from "./tsEngineIdentity";

const ts = ` · TypeScript engine ${TS_ENGINE_VERSION} (${shortId(TS_ENGINE_SOURCES)})`;

describe("engine label", () => {
  it("names the TypeScript engine by default, with its pinned version and source hash", () => {
    expect(activeEngine({})).toBe("ts");
    expect(engineSuffix({})).toBe(ts);
    expect(versionLine("2.29.0", {})).toBe(`v2.29.0${ts}`);
    expect(TS_ENGINE_SOURCES).toMatch(/^[0-9a-f]{64}$/);
  });

  it("names the Rust engine's crate version and binary hash when its package reported them", () => {
    const hash = "ab".repeat(32);
    const boot = { identity: JSON.stringify(IDENTITY_FIXTURE), binary: { state: "ok" as const, sourceHash: hash } };
    const v = IDENTITY_FIXTURE.crate.version;
    expect(engineSuffix({ __vcEngine: { status: { hosted: true } }, __vcEngineBoot: boot })).toBe(` · Rust engine ${v} (${shortId(hash)})`);
    expect(engineSuffix({ __vcEngine: { status: { hosted: true, placement: "worker" } }, __vcEngineBoot: boot })).toBe(` · Rust engine ${v} (${shortId(hash)}, worker)`);
    expect(engineSuffix({ __vcEngine: { status: { hosted: true } }, __vcEngineBoot: { binary: { state: "missing" } } })).toBe(" · Rust engine");
  });

  it("never names the TypeScript engine where none runs: a wasm-only build, or a Rust engine that stopped", () => {
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
    // A later tower the host would not take runs on TypeScript.
    expect(engineSuffix({ __vcEngine: idle, __vcEngineBoot: { build: "switchable", engine: "wasm" } })).toBe(ts);
    expect(engineSuffix({ __vcEngine: { status: { hosted: true } }, __vcEngineBoot: { build: "wasm-only", engine: "wasm", identity } })).toBe(` · Rust engine ${v}`);
    // A switchable build back on TypeScript names it.
    expect(engineSuffix({ __vcEngineBoot: { build: "switchable", engine: "ts" } })).toBe(ts);
  });

  it("names the WASM engine only while a tower is hosted", () => {
    const hosted = { __vcEngine: { status: { hosted: true } } };
    const idle = { __vcEngine: { status: { hosted: false } } };
    expect(activeEngine(hosted)).toBe("wasm");
    expect(activeEngine(idle)).toBe("ts");
    expect(versionLine("2.29.0", hosted)).toBe("v2.29.0 · Rust engine");
    expect(versionLine("2.29.0", idle)).toBe(`v2.29.0${ts}`);
  });

  it("rewrites a mounted splash version line and ignores a page without one", () => {
    const el = { textContent: "v0.0.0" } as HTMLElement;
    refreshSplashVersion({ querySelector: () => el } as unknown as Document);
    expect(el.textContent).toBe(`v${APP_VERSION}${ts}`);
    expect(() => refreshSplashVersion({ querySelector: () => null } as unknown as Document)).not.toThrow();
  });
});
