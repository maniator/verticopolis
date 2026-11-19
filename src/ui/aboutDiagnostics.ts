import type { DiagnosticsReport, DiagnosticsRow } from "@verticopolis/components/host/engineDiagnostics";
import { liveDiagnostics } from "@verticopolis/components/host/engineDiagnosticsLive";

/**
 * The game's side of the engine diagnostics: the components package's report
 * plus the components version this build bundles, and the shorter set of rows
 * About this game draws. Copy diagnostics (and Report a problem, and the stop
 * screen) keep every row; only the dialog trims.
 */

/** The row and clipboard line naming the bundled `@verticopolis/components`. */
export const COMPONENTS_LABEL = "Components";

/** Rows only Copy diagnostics carries: the copy time, the browser string and
 *  the engine's own digests mean something to a bug report, not on screen. */
const COPY_ONLY = new Set([
  "Date",
  "Browser",
  "Package id this page expects",
  "Frame layout",
  "Catalog",
  "Conformance lock",
]);

/** What the page expected beside what the engine reported. When the two agree
 *  the version line above the block already shows the value (its crate version
 *  and source hash), so the dialog drops both rows; when they differ it keeps
 *  both, since the difference is what a tester needs to see. */
const PAIRS: readonly (readonly [expected: string, actual: string])[] = [
  ["Crate this page expects", "Engine crate"],
  ["Source hash this page expects", "Source hash in the engine binary"],
];

/** The report with the components version added after the App row, on screen
 *  and in the copied text. An empty version leaves the report as it is. */
export function withComponents(report: DiagnosticsReport, version: string): DiagnosticsReport {
  if (!version) return report;
  const row: DiagnosticsRow = { label: COMPONENTS_LABEL, value: version };
  const appRow = report.rows.findIndex((r) => r.label === "App");
  const rows = [...report.rows];
  rows.splice(appRow >= 0 ? appRow + 1 : rows.length, 0, row);
  const lines = report.text.split("\n");
  const appLine = lines.findIndex((l) => l.startsWith("App: "));
  lines.splice(appLine >= 0 ? appLine + 1 : lines.length, 0, `${row.label}: ${row.value}`);
  return { ...report, rows, text: lines.join("\n") };
}

/** The live report for this page, with the bundled components version. */
export function gameDiagnostics(): DiagnosticsReport {
  return withComponents(liveDiagnostics(), typeof __COMPONENTS_VERSION__ !== "undefined" ? __COMPONENTS_VERSION__ : "");
}

/** The rows About this game draws. The version line above already names the
 *  app version, so the App row becomes the commit alone (kept when it reads
 *  "unknown", so the rows do not depend on the checkout). A healthy "Engine in
 *  use: Rust engine" repeats the summary sentence and is left out. */
export function aboutRows(rows: readonly DiagnosticsRow[]): DiagnosticsRow[] {
  const byLabel = new Map(rows.map((r) => [r.label, r.value]));
  const agreed = new Set<string>();
  for (const [expected, actual] of PAIRS) {
    const value = byLabel.get(expected);
    if (value !== undefined && value === byLabel.get(actual)) {
      agreed.add(expected);
      agreed.add(actual);
    }
  }
  const out: DiagnosticsRow[] = [];
  for (const r of rows) {
    if (COPY_ONLY.has(r.label) || agreed.has(r.label)) continue;
    if (r.label === "Engine in use" && r.value === "Rust engine") continue;
    if (r.label === "App") {
      const commit = /\(([^)]+)\)$/.exec(r.value)?.[1];
      if (commit) out.push({ label: "Commit", value: commit });
      continue;
    }
    out.push(r);
  }
  return out;
}
