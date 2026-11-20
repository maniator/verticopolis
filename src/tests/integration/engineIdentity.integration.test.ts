import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDiagnostics } from "../../engineHost/engineDiagnostics";
import { parseEngineIdentity, readEngineIdentity } from "@verticopolis/engine/host/engineIdentity";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";
import { ENGINE_ROOT } from "../packagePaths";

/**
 * The real package's identity record (#963) read through the frontend's own
 * reader: it parses, it names the crate version of the installed package
 * (the engine repository checks the record against its compat record), and
 * the diagnostics report built from it is healthy when the page expects the
 * same crate and flags a mismatch when it expects another.
 */

// The tooling build ships inside the engine package, which holds the version.
const installed = (JSON.parse(readFileSync(resolve(ENGINE_ROOT, "package.json"), "utf8")) as { version: string })
  .version;

describe.skipIf(!hasWasmPackage())("engineIdentity from the real package", () => {
  const text = () => readEngineIdentity(wasm());

  it("parses and names the installed package's crate version", () => {
    const id = parseEngineIdentity(text());
    expect(id).not.toBeNull();
    expect(id!.crate.version).toBe(installed);
    expect(id!.lockDigest).toMatch(/^[0-9a-f]{16}$/);
    expect(Number.isInteger(id!.saveVersion) && id!.saveVersion > 0).toBe(true);
  });

  it("gives a healthy report when the page expects this crate, and names the field when it expects another", () => {
    const id = parseEngineIdentity(text())!;
    const boot = {
      build: "switchable" as const,
      engine: "wasm" as const,
      failure: null,
      identity: text(),
    };
    const expected = (version: string) => ({
      package: "0".repeat(64),
      files: {},
      crate: { name: id.crate.name, version },
    });
    expect(
      buildDiagnostics({
        appVersion: "t",
        boot,
        host: { hosted: true },
        expected: expected(id.crate.version),
      }).state,
    ).toBe("ok");
    const off = buildDiagnostics({
      appVersion: "t",
      boot,
      host: { hosted: true },
      expected: expected("0.0.0"),
    });
    expect(off.state).toBe("mismatch");
    expect(off.text).toContain("crate version");
  });
});
