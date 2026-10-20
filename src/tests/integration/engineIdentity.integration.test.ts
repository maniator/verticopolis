import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDiagnostics } from "../../wasmhost/engineDiagnostics";
import {
  parseEngineIdentity,
  readEngineIdentity,
} from "../../wasmhost/engineIdentity";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";

/**
 * The real package's identity record (#963) read through the frontend's own
 * reader: it parses, it agrees with the checked-in compat record, and the
 * diagnostics report built from it is healthy when the page expects the same
 * crate and flags a mismatch when it expects another.
 */

if (wasmRequired() && !hasWasmPackage())
  throw new Error(
    "VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build",
  );

const record = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../../engine-rs/src/compat-record.json"),
    "utf8",
  ),
) as {
  crateVersion: string;
  lockDigest: string;
  saveVersion: number;
};

describe.skipIf(!hasWasmPackage())(
  "engineIdentity from the real package",
  () => {
    const text = () => readEngineIdentity(wasm());

    it("parses and agrees with the compat record", () => {
      const id = parseEngineIdentity(text());
      expect(id).not.toBeNull();
      expect(id!.crate.version).toBe(record.crateVersion);
      expect(id!.lockDigest).toBe(record.lockDigest);
      expect(id!.saveVersion).toBe(record.saveVersion);
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
  },
);
