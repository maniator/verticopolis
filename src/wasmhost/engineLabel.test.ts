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
