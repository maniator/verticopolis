import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { engineFailureArchive } from "./failureArchive";
import type { EngineBootFailure } from "../wasmhost/engineBoot";

const failure: EngineBootFailure = {
  stage: "host",
  reason: "trap-tick",
  message: "private tower name and engine stack should not be in the report",
};

describe("Rust engine failure report without a running engine", () => {
  it("archives failure codes and the exact stored save without attempting engine serialization", () => {
    const stored = 'VCZ1:{"name":"tower","unicode":"שלום"}';
    const { filename, bytes } = engineFailureArchive(failure, stored, "test-version");
    const entries = unzipSync(bytes);
    const details = JSON.parse(strFromU8(entries["engine-failure.json"]));
    expect(filename).toBe("verticopolis-engine-failure-test-version.zip");
    expect(details.report).toBe("verticopolis-engine-failure");
    expect(details.failure).toEqual({ stage: "host", reason: "trap-tick" });
    expect(details.savedTower).toBe("stored-copy");
    expect(JSON.stringify(details)).not.toContain("private tower name");
    expect(strFromU8(entries["recovery-copy.txt"])).toBe(stored);
  });

  it("still makes a useful report when no autosave exists", () => {
    const entries = unzipSync(engineFailureArchive(failure, null, "test-version").bytes);
    const details = JSON.parse(strFromU8(entries["engine-failure.json"]));
    expect(details.savedTower).toBe("unavailable");
    expect(entries["recovery-copy.txt"]).toBeUndefined();
  });

  it("keeps the verified package failure codes and hashes without stack traces", () => {
    const boot: EngineBootFailure = {
      stage: "load",
      reason: "package-mismatch",
      message: "some private stack",
      package: { kind: "mismatch", file: "wasm", expected: null, found: null, expectedPackage: null, servedPackage: null, controlled: false },
    };
    const entries = unzipSync(engineFailureArchive(boot, null, "test-version").bytes);
    const details = JSON.parse(strFromU8(entries["engine-failure.json"]));
    expect(details.failure.package.kind).toBe("mismatch");
    expect(details.failure.package.file).toBe("wasm");
    expect(JSON.stringify(details)).not.toContain("some private stack");
  });
});
