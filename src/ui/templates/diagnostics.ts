import { html, type TemplateResult } from "lit-html";
import type { DiagnosticsReport } from "../../engineHost/engineDiagnostics";
import { aboutRows } from "../aboutDiagnostics";

/**
 * The engine diagnostics block inside About this game (#963): the
 * report's summary, the rows worth reading on screen (`aboutRows`) and a Copy
 * diagnostics button that copies every row. The report is built by the
 * components package's `engineDiagnostics.ts`; the controller (`showAbout`, src/ui/uiHelp.ts) wires the
 * button and writes the outcome into the status line.
 */
export function diagnosticsBlock(report: DiagnosticsReport): TemplateResult {
  return html`<div class="help-diagnostics" data-state=${report.state}>
    <p class="help-diagnostics-summary">${report.summary}</p>
    <dl class="help-diagnostics-rows">
      ${aboutRows(report.rows).map(
        (r) =>
          html`<div class="help-diagnostics-row">
            <dt>${r.label}</dt>
            <dd>${r.value}</dd>
          </div>`,
      )}
    </dl>
    <p class="help-diagnostics-note" style="margin:0 0 6px;font-size:0.9em;color:var(--muted)">
      Copy diagnostics adds the date, your browser and the engine's digests.
    </p>
    <p class="help-diagnostics-actions">
      <button type="button" class="btn" data-act="copy-diagnostics">
        Copy diagnostics
      </button>
      <span
        class="help-diagnostics-status"
        role="status"
        aria-live="polite"
      ></span>
    </p>
  </div>`;
}
