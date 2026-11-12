import { describe, expect, it } from "vitest";
import { liveDiagnostics } from "./engineDiagnosticsLive";
import { IDENTITY_FIXTURE } from "./engineIdentity.fixture";
import { deferEngineIdentity, publishBootState, type EngineBootState } from "./engineBoot";

describe("liveDiagnostics", () => {
  it("builds from a page that published nothing", () => {
    const r = liveDiagnostics({});
    expect(r.state).toBe("not-running");
    expect(r.text).toContain("App: v");
  });

  it("reads the boot state and the host's status from the page globals", () => {
    const r = liveDiagnostics({
      __vcEngineBoot: {
        build: "wasm-only",
        engine: "wasm",
        failure: null,
        identity: JSON.stringify(IDENTITY_FIXTURE),
      },
      __vcEngine: { status: { hosted: true, placement: "worker" } },
    });
    expect(r.rows.find((x) => x.label === "Engine in use")?.value).toBe(
      "Rust engine (worker)",
    );
    expect(r.rows.find((x) => x.label === "Engine crate")?.value).toBe(
      "example-engine 9.8.7",
    );
  });

  it("reads an identity record boot left for later before it reports (#1254)", () => {
    const g: { __vcEngineBoot?: EngineBootState; __vcEngine?: { status: { hosted: boolean } } } = { __vcEngine: { status: { hosted: true } } };
    deferEngineIdentity({ engineIdentity: () => JSON.stringify(IDENTITY_FIXTURE) });
    publishBootState({ build: "wasm-only", engine: "wasm", failure: null }, g);
    const r = liveDiagnostics(g);
    deferEngineIdentity({});
    expect(r.rows.find((x) => x.label === "Engine crate")?.value).toBe("example-engine 9.8.7");
    expect(g.__vcEngineBoot?.identity).toBe(JSON.stringify(IDENTITY_FIXTURE));
  });

  it("reports a boot that failed", () => {
    const r = liveDiagnostics({
      __vcEngineBoot: {
        build: "wasm-only",
        engine: "none",
        failure: { stage: "load", reason: "boot-timeout", message: "late" },
      },
    });
    expect(r.state).toBe("not-loaded");
  });

  it("never throws: a page whose boot state cannot be read still gives a report to copy", () => {
    const hostile = {
      get __vcEngineBoot(): never {
        throw new Error("blocked");
      },
    };
    const r = liveDiagnostics(hostile);
    expect(r.state).toBe("unavailable");
    expect(r.text).toBe("Verticopolis diagnostics\nThe report could not be built: blocked");
  });
});
