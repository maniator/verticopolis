import { describe, expect, it } from "vitest";
import { liveDiagnostics } from "./engineDiagnosticsLive";
import { IDENTITY_FIXTURE } from "./engineIdentity.fixture";

describe("liveDiagnostics", () => {
  it("builds from a page that published nothing", () => {
    const r = liveDiagnostics({});
    expect(r.state).toBe("typescript");
    expect(r.text).toContain("App: v");
  });

  it("reads the boot state and the host's status from the page globals", () => {
    const r = liveDiagnostics({
      __vcEngineBoot: {
        build: "switchable",
        engine: "wasm",
        failure: null,
        identity: JSON.stringify(IDENTITY_FIXTURE),
      },
      __vcEngine: { status: { hosted: true, placement: "worker" } },
    });
    expect(r.rows.find((x) => x.label === "Engine in use")?.value).toBe(
      "WASM engine (worker)",
    );
    expect(r.rows.find((x) => x.label === "Engine crate")?.value).toBe(
      "example-engine 9.8.7",
    );
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
