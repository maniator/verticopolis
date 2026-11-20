import { describe, expect, it } from "vitest";
import type { DiagnosticsReport, DiagnosticsRow } from "@verticopolis/components/host/engineDiagnostics";
import { buildDiagnostics } from "@verticopolis/components/host/engineDiagnostics";
import { aboutRows, withComponents } from "./aboutDiagnostics";
import { IDENTITY_FIXTURE } from "../tests/engineFixtures/engineIdentity.fixture";

const healthy: DiagnosticsRow[] = [
  { label: "App", value: "v4.14.2 (b57cdd8)" },
  { label: "Date", value: "2026-11-19T22:40:19.672Z" },
  { label: "Browser", value: "Mozilla/5.0" },
  { label: "Engine in use", value: "Rust engine" },
  { label: "Package id this page expects", value: "54a702deb9fe" },
  { label: "Source hash this page expects", value: "5eddf5617986" },
  { label: "Crate this page expects", value: "verticopolis-engine 1.57.2" },
  { label: "Source hash in the engine binary", value: "5eddf5617986" },
  { label: "Engine crate", value: "verticopolis-engine 1.57.2" },
  { label: "Save version", value: "12 (loads back to 1)" },
  { label: "Frame layout", value: "1" },
  { label: "Catalog", value: "26 (classic 3494d3ed0398abb6, modern 3091b3f6237e125d)" },
  { label: "Conformance lock", value: "bcf5c78932ea82b1" },
];

const labels = (rows: DiagnosticsRow[]) => rows.map((r) => r.label);

describe("aboutRows", () => {
  it("shows a healthy engine as the commit and the save version, leaving the rest to Copy diagnostics", () => {
    expect(aboutRows(healthy)).toEqual([
      { label: "Commit", value: "b57cdd8" },
      { label: "Save version", value: "12 (loads back to 1)" },
    ]);
  });

  it("keeps both values of a pair that disagrees, and drops only the pair that agrees", () => {
    const rows = healthy.map((r) => (r.label === "Engine crate" ? { ...r, value: "verticopolis-engine 1.57.1" } : r));
    rows.push({ label: "Mismatch", value: "crate version (engine 1.57.1, this page was built for 1.57.2)" });
    const shown = labels(aboutRows(rows));
    expect(shown).toContain("Crate this page expects");
    expect(shown).toContain("Engine crate");
    expect(shown).toContain("Mismatch");
    expect(shown).not.toContain("Source hash this page expects");
    expect(shown).not.toContain("Source hash in the engine binary");
  });

  it("keeps a lone value with nothing to agree with, and an engine that is not running", () => {
    const rows: DiagnosticsRow[] = [
      { label: "App", value: "v4.14.2 (unknown)" },
      { label: "Engine in use", value: "not running" },
      { label: "Failed at", value: "load" },
      { label: "Crate this page expects", value: "verticopolis-engine 1.57.2" },
    ];
    expect(aboutRows(rows)).toEqual([{ label: "Commit", value: "unknown" }, ...rows.slice(1)]);
  });
});

describe("aboutRows over the components package's own report", () => {
  // Binds the labels above to the report the bundled package builds, so a
  // renamed row shows up here when the components pin moves.
  const sources = "5eddf5617986".padEnd(64, "0");
  const report = (crateVersion: string) =>
    buildDiagnostics({
      appVersion: "4.14.2",
      appSha: "b57cdd8",
      boot: {
        engine: "wasm",
        failure: null,
        identity: JSON.stringify(IDENTITY_FIXTURE),
        binary: { state: "ok", sourceHash: sources },
      } as never,
      host: { hosted: true },
      expected: {
        package: "54a702deb9fe".padEnd(64, "0"),
        files: {} as never,
        sources,
        crate: { name: "example-engine", version: crateVersion },
      },
      userAgent: "Mozilla/5.0",
      date: "2026-11-19T22:40:19.672Z",
    });

  it("shows only the commit and the save version when everything matches, and copies every row", () => {
    const ok = report("9.8.7");
    expect(ok.state).toBe("ok");
    expect(labels(aboutRows(ok.rows))).toEqual(["Commit", "Save version"]);
    expect(ok.text).toContain("Engine crate: example-engine 9.8.7");
    expect(ok.text).toContain("Source hash in the engine binary: 5eddf5617986");
  });

  it("shows both crates and the mismatch when the engine is not the one the page expected", () => {
    const off = report("9.8.6");
    expect(off.state).toBe("mismatch");
    expect(labels(aboutRows(off.rows))).toEqual([
      "Commit",
      "Crate this page expects",
      "Engine crate",
      "Save version",
      "Mismatch",
    ]);
  });
});

describe("withComponents", () => {
  const report: DiagnosticsReport = {
    state: "ok",
    summary: "The Rust engine is running and matches this build.",
    rows: [
      { label: "App", value: "v4.14.2 (b57cdd8)" },
      { label: "Date", value: "now" },
    ],
    text: "Verticopolis diagnostics\nThe Rust engine is running and matches this build.\nApp: v4.14.2 (b57cdd8)\nDate: now",
  };

  it("adds the components version after the App row, on screen and in the copied text", () => {
    const out = withComponents(report, "0.2.1");
    expect(labels(out.rows)).toEqual(["App", "Components", "Date"]);
    expect(out.text.split("\n").slice(2)).toEqual(["App: v4.14.2 (b57cdd8)", "Components: 0.2.1", "Date: now"]);
    expect(labels(aboutRows(out.rows))).toEqual(["Commit", "Components"]);
  });

  it("appends to a report with no App row, and leaves the report alone without a version", () => {
    const bare: DiagnosticsReport = {
      state: "unavailable",
      summary: "x",
      rows: [],
      text: "Verticopolis diagnostics\nx",
    };
    const appended = withComponents({ ...bare, rows: [{ label: "Date", value: "now" }] }, "0.2.1");
    expect(labels(appended.rows)).toEqual(["Date", "Components"]);
    expect(withComponents(bare, "0.2.1").text).toBe("Verticopolis diagnostics\nx\nComponents: 0.2.1");
    expect(withComponents(report, "")).toBe(report);
  });
});
