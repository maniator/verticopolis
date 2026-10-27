import { describe, expect, it } from "vitest";
import { buildDiagnostics, identityMismatches } from "./engineDiagnostics";
import type { EngineBootState } from "./engineBoot";
import type { ExpectedEnginePackage } from "./enginePackageRecord";
import { IDENTITY_FIXTURE } from "./engineIdentity.fixture";

const identity = JSON.stringify(IDENTITY_FIXTURE);
const expected = (
  version = IDENTITY_FIXTURE.crate.version,
): ExpectedEnginePackage => ({
  package: "0123456789abcdef".repeat(4),
  files: {},
  crate: { name: IDENTITY_FIXTURE.crate.name, version },
});
const SRC = "5".repeat(64);
const OTHER_SRC = "6".repeat(64);
const withSources = (sources = SRC): ExpectedEnginePackage => ({
  ...expected(),
  sources,
});
const stamped = { state: "ok", sourceHash: SRC } as const;
const wasmBoot = (extra: Partial<EngineBootState> = {}): EngineBootState => ({
  build: "switchable",
  engine: "wasm",
  failure: null,
  identity,
  ...extra,
});
const base = { appVersion: "1.2.3", appSha: "abc1234" };
const row = (r: ReturnType<typeof buildDiagnostics>, label: string) =>
  r.rows.filter((x) => x.label === label).map((x) => x.value);

describe("buildDiagnostics", () => {
  it("builds from nothing at all: the page never published a boot state", () => {
    const r = buildDiagnostics({ appVersion: "dev" });
    expect(r.state).toBe("typescript");
    expect(r.rows[0]).toEqual({ label: "App", value: "vdev" });
    expect(r.text).toContain("Verticopolis diagnostics");
  });

  it("reports the TypeScript engine", () => {
    const r = buildDiagnostics({
      ...base,
      boot: { build: "switchable", engine: "ts", failure: null },
    });
    expect(r.state).toBe("typescript");
    expect(row(r, "Engine in use")).toEqual(["TypeScript engine"]);
    expect(row(r, "App")).toEqual(["v1.2.3 (abc1234)"]);
  });

  it("reports a healthy WASM engine with every field of its record", () => {
    const r = buildDiagnostics({
      ...base,
      boot: wasmBoot(),
      host: { hosted: true },
      expected: expected(),
    });
    expect(r.state).toBe("ok");
    expect(row(r, "Engine in use")).toEqual(["Rust engine"]);
    expect(row(r, "Engine crate")).toEqual(["example-engine 9.8.7"]);
    expect(row(r, "Save version")).toEqual(["7 (loads back to 1)"]);
    expect(row(r, "Frame layout")).toEqual(["2"]);
    expect(row(r, "Catalog")).toEqual([
      "3 (classic aaaa1111aaaa1111, modern bbbb2222bbbb2222)",
    ]);
    expect(row(r, "Conformance lock")).toEqual(["cccc3333cccc3333"]);
    expect(row(r, "Package id this page expects")).toEqual(["0123456789ab"]);
    expect(row(r, "Mismatch")).toEqual([]);
  });

  it("names the worker placement", () => {
    const r = buildDiagnostics({
      ...base,
      boot: wasmBoot(),
      host: { hosted: true, placement: "worker" },
    });
    expect(row(r, "Engine in use")).toEqual(["Rust engine (worker)"]);
  });

  it("says the identity is unavailable for a package without the call", () => {
    const { identity: _omit, ...noIdentity } = wasmBoot();
    const r = buildDiagnostics({
      ...base,
      boot: noIdentity,
      host: { hosted: true },
    });
    expect(r.state).toBe("unavailable");
    expect(row(r, "Engine crate")).toEqual([]);
  });

  it("treats an unreadable record as unavailable", () => {
    const r = buildDiagnostics({
      ...base,
      boot: wasmBoot({ identity: "{broken" }),
      host: { hosted: true },
    });
    expect(r.state).toBe("unavailable");
  });

  it("names the field when the engine's crate differs from the build this page expects", () => {
    const r = buildDiagnostics({
      ...base,
      boot: wasmBoot(),
      host: { hosted: true },
      expected: expected("0.0.1"),
    });
    expect(r.state).toBe("mismatch");
    expect(row(r, "Mismatch")).toEqual([
      "crate version (engine 9.8.7, this page was built for 0.0.1)",
    ]);
  });

  it("skips the comparison when BUILD.json predates the crate key", () => {
    const { crate: _omit, ...noCrate } = expected();
    const r = buildDiagnostics({
      ...base,
      boot: wasmBoot(),
      host: { hosted: true },
      expected: noCrate,
    });
    expect(r.state).toBe("ok");
    expect(row(r, "Crate this page expects")).toEqual([]);
  });

  it("reports an engine that never loaded in a switchable build, with the reason and the crate the page expects", () => {
    const boot: EngineBootState = {
      build: "switchable",
      engine: "ts",
      failure: {
        stage: "load",
        reason: "boot-timeout",
        message: "no answer in 90 seconds",
      },
    };
    const r = buildDiagnostics({ ...base, boot, expected: expected() });
    expect(r.state).toBe("not-loaded");
    expect(r.summary).toContain("TypeScript engine");
    expect(row(r, "Failed at")).toEqual(["load"]);
    expect(row(r, "Reason")).toEqual(["boot-timeout"]);
    expect(row(r, "Detail")).toEqual(["no answer in 90 seconds"]);
    expect(row(r, "Crate this page expects")).toEqual(["example-engine 9.8.7"]);
    expect(row(r, "Engine crate")).toEqual([]);
  });

  it("reports a wasm-only build that stopped", () => {
    const boot: EngineBootState = {
      build: "wasm-only",
      engine: "none",
      failure: { stage: "load", reason: "package-mismatch", message: "x" },
    };
    const r = buildDiagnostics({ ...base, boot });
    expect(r.state).toBe("not-loaded");
    expect(row(r, "Engine in use")).toEqual(["none"]);
    expect(r.summary).toContain("no other engine");
  });

  it("does not call a fallen-back engine healthy even though its identity was read", () => {
    const r = buildDiagnostics({
      ...base,
      boot: wasmBoot({
        engine: "ts",
        failure: {
          stage: "start",
          reason: "attach-refused",
          message: "refused",
        },
      }),
    });
    expect(r.state).toBe("not-loaded");
  });

  it("carries the host's last error and the count of errors it dropped", () => {
    const r = buildDiagnostics({
      ...base,
      boot: wasmBoot(),
      host: { hosted: true, lastError: "trap in tick", droppedErrors: 4 },
    });
    expect(row(r, "Last engine error")).toEqual(["trap in tick"]);
    expect(row(r, "Errors not kept")).toEqual(["4"]);
  });

  it("keeps the start of a long message", () => {
    const boot: EngineBootState = {
      build: "switchable",
      engine: "ts",
      failure: {
        stage: "load",
        reason: "boot-error",
        message: "x".repeat(500),
      },
    };
    const detail = row(buildDiagnostics({ ...base, boot }), "Detail")[0];
    expect(detail).toHaveLength(303);
    expect(detail.endsWith("...")).toBe(true);
  });

  it("folds a message that spans lines onto its row in the copied text", () => {
    const boot: EngineBootState = {
      build: "switchable",
      engine: "ts",
      failure: { stage: "load", reason: "boot-error", message: "first line\r\n   at second\nthird" },
    };
    const r = buildDiagnostics({ ...base, boot });
    expect(r.text).toContain("Detail: first line at second third");
    expect(r.text.split("\n").filter((l) => l.startsWith("Detail:"))).toHaveLength(1);
  });

  it("writes the text as heading, summary and one line per row, with no em-dash", () => {
    const r = buildDiagnostics({
      ...base,
      boot: wasmBoot(),
      host: { hosted: true },
      expected: expected(),
    });
    const lines = r.text.split("\n");
    expect(lines[0]).toBe("Verticopolis diagnostics");
    expect(lines[1]).toBe(r.summary);
    expect(lines.slice(2)).toEqual(r.rows.map((x) => `${x.label}: ${x.value}`));
    expect(r.text).not.toContain("—");
  });
});

describe("the source hash stamped in the engine binary", () => {
  const run = (boot: EngineBootState, exp: ExpectedEnginePackage | null) =>
    buildDiagnostics({ ...base, boot, host: { hosted: true }, expected: exp });

  it("shows the stamped hash beside the one the page expects, apart from the package id", () => {
    const r = run(wasmBoot({ binary: stamped }), withSources());
    expect(r.state).toBe("ok");
    expect(row(r, "Source hash in the engine binary")).toEqual(["555555555555"]);
    expect(row(r, "Source hash this page expects")).toEqual(["555555555555"]);
    expect(row(r, "Package id this page expects")).toEqual(["0123456789ab"]);
  });

  it("compares all 64 digits, not the 12 shown", () => {
    const near = SRC.slice(0, 12) + "6".repeat(52);
    const r = run(wasmBoot({ binary: { state: "ok", sourceHash: near } }), withSources());
    expect(r.state).toBe("mismatch");
    expect(row(r, "Mismatch")[0]).toContain("source hash");
  });

  it("is a mismatch, naming the source hash, when the binary was built from other sources", () => {
    const r = run(wasmBoot({ binary: { state: "ok", sourceHash: OTHER_SRC } }), withSources());
    expect(r.state).toBe("mismatch");
    expect(row(r, "Mismatch")).toEqual([
      "source hash (engine binary 666666666666, this page was built for 555555555555)",
    ]);
  });

  it("does not compare when the page recorded no source hash", () => {
    const r = run(wasmBoot({ binary: stamped }), expected());
    expect(r.state).toBe("ok");
    expect(row(r, "Source hash in the engine binary")).toEqual(["555555555555"]);
    expect(row(r, "Source hash this page expects")).toEqual([]);
  });

  it("is unavailable, with the reason, when the binary has no section", () => {
    const r = run(wasmBoot({ binary: { state: "missing" } }), withSources());
    expect(r.state).toBe("unavailable");
    expect(r.summary).toContain("carries no build metadata section");
    expect(row(r, "Source hash in the engine binary")).toEqual(["unavailable (no build metadata section)"]);
    expect(row(r, "Engine crate")).toEqual(["example-engine 9.8.7"]);
  });

  it("is unavailable, with the reason, when the section is malformed", () => {
    const r = run(wasmBoot({ binary: { state: "malformed", why: "not JSON" } }), withSources());
    expect(r.state).toBe("unavailable");
    expect(r.summary).toContain("malformed (not JSON)");
    expect(row(r, "Source hash in the engine binary")).toEqual(["unavailable (malformed: not JSON)"]);
  });

  it("lets a crate mismatch outrank missing metadata", () => {
    const r = run(wasmBoot({ binary: { state: "missing" } }), { ...withSources(), crate: { name: "example-engine", version: "0.0.1" } });
    expect(r.state).toBe("mismatch");
  });

  it("leaves a healthy report alone when the binary was never read", () => {
    const r = run(wasmBoot(), withSources());
    expect(r.state).toBe("ok");
    expect(row(r, "Source hash in the engine binary")).toEqual([]);
  });

  it("reports the failed binary's hash when the engine then did not load", () => {
    const boot: EngineBootState = {
      build: "switchable",
      engine: "ts",
      failure: { stage: "load", reason: "package-mismatch", message: "link failed" },
      binary: stamped,
    };
    const r = buildDiagnostics({ ...base, boot, expected: withSources() });
    expect(r.state).toBe("not-loaded");
    expect(row(r, "Source hash in the engine binary")).toEqual(["555555555555"]);
    expect(row(r, "Source hash this page expects")).toEqual(["555555555555"]);
    expect(row(r, "Engine crate")).toEqual([]);
  });

  it("copies a missing section too, with no em-dash", () => {
    const r = run(wasmBoot({ binary: { state: "missing" } }), withSources());
    expect(r.text).toContain("Source hash in the engine binary: unavailable (no build metadata section)");
    expect(r.text).not.toContain("—");
  });
});

describe("identityMismatches", () => {
  const record = { ...IDENTITY_FIXTURE };
  it("is empty without an expected crate", () => {
    expect(identityMismatches(record, null)).toEqual([]);
    expect(identityMismatches(record, undefined)).toEqual([]);
  });
  it("compares the source hash only when the binary's section was read", () => {
    const e = withSources();
    expect(identityMismatches(record, e, { state: "ok", sourceHash: OTHER_SRC })).toHaveLength(1);
    expect(identityMismatches(record, e, { state: "missing" })).toEqual([]);
    expect(identityMismatches(record, e, { state: "malformed", why: "x" })).toEqual([]);
    expect(identityMismatches(record, e, undefined)).toEqual([]);
    expect(identityMismatches(record, expected(), { state: "ok", sourceHash: OTHER_SRC })).toEqual([]);
  });
  it("names the crate when the name differs", () => {
    const e = expected();
    e.crate = { name: "other-engine", version: "9.8.7" };
    expect(identityMismatches(record, e)).toEqual([
      "crate name (engine example-engine, this page was built for other-engine)",
    ]);
  });
});

describe("which engine is running, by the host's status", () => {
  const sourceExpected = (): ExpectedEnginePackage => ({ ...expected(), sources: SRC });

  it("calls a tower the host refused TypeScript even though boot recorded no failure", () => {
    const r = buildDiagnostics({
      ...base,
      boot: wasmBoot(),
      host: { hosted: false, lastFallback: { reason: "attach-refused", stage: "adopt" } },
      expected: expected(),
    });
    expect(r.state).toBe("typescript");
    expect(r.summary).toContain("fell back to the TypeScript engine");
    expect(row(r, "Engine in use")).toEqual(["TypeScript engine"]);
    expect(row(r, "Last fallback")).toEqual(["attach-refused at adopt"]);
  });

  it("follows the host when a later tower is hosted after the first was refused", () => {
    const r = buildDiagnostics({
      ...base,
      boot: wasmBoot({ failure: { stage: "start", reason: "attach-refused", message: "crowd" } }),
      host: { hosted: true },
      expected: expected(),
    });
    expect(r.state).toBe("ok");
    expect(row(r, "Engine in use")).toEqual(["Rust engine"]);
    expect(row(r, "Failed at")).toEqual(["start"]);
  });

  it.each([
    ["load", "did not load"],
    ["start", "did not take the first tower"],
    ["host", "stopped after a fault"],
  ] as const)("words a %s failure as '%s'", (stage, words) => {
    const boot: EngineBootState = { build: "switchable", engine: "ts", failure: { stage, reason: "boot-error", message: "x" } };
    const r = buildDiagnostics({ ...base, boot, host: { hosted: false } });
    expect(r.state).toBe("not-loaded");
    expect(r.summary).toContain(words);
    expect(r.summary).toContain("TypeScript engine");
  });

  it("says a wasm-only build has no other engine after a fault", () => {
    const boot: EngineBootState = { build: "wasm-only", engine: "none", failure: { stage: "host", reason: "trap-tick", message: "trap" } };
    const r = buildDiagnostics({ ...base, boot, host: { hosted: false } });
    expect(r.summary).toBe("The Rust engine stopped after a fault, and this build has no other engine.");
  });

  it("reports a source hash mismatch for a package that reports no identity", () => {
    const { identity: _omit, ...noIdentity } = wasmBoot({ binary: { state: "ok", sourceHash: OTHER_SRC } });
    const r = buildDiagnostics({ ...base, boot: noIdentity, host: { hosted: true }, expected: sourceExpected() });
    expect(r.state).toBe("mismatch");
    expect(row(r, "Mismatch")).toHaveLength(1);
  });

  it("reports a source hash mismatch for a binary that failed to link", () => {
    const boot: EngineBootState = {
      build: "switchable",
      engine: "ts",
      failure: { stage: "load", reason: "package-mismatch", message: "import mismatch" },
      binary: { state: "ok", sourceHash: OTHER_SRC },
    };
    const r = buildDiagnostics({ ...base, boot, expected: sourceExpected() });
    expect(r.state).toBe("not-loaded");
    expect(row(r, "Mismatch")).toEqual([
      "source hash (engine binary 666666666666, this page was built for 555555555555)",
    ]);
  });

  it("claims a match only when something was compared", () => {
    const { crate: _c, ...noCrate } = expected();
    const none = buildDiagnostics({ ...base, boot: wasmBoot(), host: { hosted: true }, expected: noCrate });
    expect(none.state).toBe("ok");
    expect(none.summary).toContain("no build record to compare");
    const unknown = buildDiagnostics({ ...base, boot: wasmBoot(), host: { hosted: true }, expected: null });
    expect(unknown.summary).toContain("no build record to compare");
    const compared = buildDiagnostics({ ...base, boot: wasmBoot(), host: { hosted: true }, expected: expected() });
    expect(compared.summary).toContain("matches this build");
  });

  it("carries the browser and the date for a support ticket", () => {
    const r = buildDiagnostics({ ...base, userAgent: "TestBrowser/1.0", date: "2026-10-20T20:00:00.000Z" });
    expect(row(r, "Browser")).toEqual(["TestBrowser/1.0"]);
    expect(row(r, "Date")).toEqual(["2026-10-20T20:00:00.000Z"]);
    expect(buildDiagnostics(base).rows.some((x) => x.label === "Browser" || x.label === "Date")).toBe(false);
  });
});

