import { describe, expect, it } from "vitest";
import { activeEngine, engineSuffix, refreshSplashVersion, versionLine } from "./engineLabel";
import { APP_VERSION } from "../appVersion";

describe("engine label", () => {
  it("names the TypeScript engine by default, with no suffix on the version", () => {
    expect(activeEngine({})).toBe("ts");
    expect(engineSuffix({})).toBe("");
    expect(versionLine("2.29.0", {})).toBe("v2.29.0");
  });

  it("names the WASM engine only while a tower is hosted", () => {
    const hosted = { __vcEngine: { status: { hosted: true } } };
    const idle = { __vcEngine: { status: { hosted: false } } };
    expect(activeEngine(hosted)).toBe("wasm");
    expect(activeEngine(idle)).toBe("ts");
    expect(versionLine("2.29.0", hosted)).toBe("v2.29.0 · WASM engine");
    expect(versionLine("2.29.0", idle)).toBe("v2.29.0");
  });

  it("rewrites a mounted splash version line and ignores a page without one", () => {
    const el = { textContent: "v0.0.0" } as HTMLElement;
    refreshSplashVersion({ querySelector: () => el } as unknown as Document);
    expect(el.textContent).toBe(`v${APP_VERSION}`);
    expect(() => refreshSplashVersion({ querySelector: () => null } as unknown as Document)).not.toThrow();
  });
});
