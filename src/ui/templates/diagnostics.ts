import { html, type TemplateResult } from "lit-html";
import type { DiagnosticsReport } from "../../wasmhost/engineDiagnostics";

/**
 * The engine diagnostics block inside Help's About section (#963): the
 * report's summary, its rows and a Copy diagnostics button. The report is
 * built by `engineDiagnostics.ts`; the controller (`showHelp`) wires the
 * button and writes the outcome into the status line.
 */
export function diagnosticsBlock(report: DiagnosticsReport): TemplateResult {
  return html`<div class="help-diagnostics" data-state=${report.state}>
    <p class="help-diagnostics-summary">${report.summary}</p>
    <dl class="help-diagnostics-rows">
      ${report.rows.map(
        (r) =>
          html`<div class="help-diagnostics-row">
            <dt>${r.label}</dt>
            <dd>${r.value}</dd>
          </div>`,
      )}
    </dl>
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
