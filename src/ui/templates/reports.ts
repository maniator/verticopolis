import { html, nothing, type TemplateResult } from "lit-html";
import { TOWER_FILE_EXT } from "../../storage/SaveGame";
import type { ImportReport } from "../../storage/tdtImport";
import type { ExportReport } from "../../storage/tdtExport";

/**
 * The TDT import/export report dialogs plus the export-choice modal. Authored to
 * match `exportConfirmHtml` / `importReportHtml` / `exportReportHtml`
 * structurally (proven by the transitional `assertDomEquivalent` tests): the
 * fact line, the "brought over" / "couldn't bring" (and their export twins)
 * lists as nested `TemplateResult`s (not joined strings), and the footer
 * buttons. Report strings and filenames interpolate as auto-escaped text (no
 * `escapeHtml`).
 *
 * These are STATIC structures only: the controllers (`confirmExport`,
 * `showImportReport`, `showExportReport`) keep their own logic (the
 * `isModalOpen()` clobber guard, the `#a11y-live` polite announcement, and the
 * `wireActions` wiring). Nothing binds inline.
 */

/** One honest sentence per list row, auto-escaped. */
const listItems = (lines: string[]): TemplateResult[] => lines.map((s) => html`<li>${s}</li>`);

const starLabel = (star: number): string => (star >= 6 ? "TOWER" : `${star}★`);

/** The export-choice modal body (.vctower primary, 1994 .TDT secondary). */
export function exportConfirmTemplate(isModern: boolean): TemplateResult {
  const legacyLine = isModern
    ? html`Saving for the original 1994 game (<b>.TDT</b>) is <b>Classic towers only</b>: the 1994 rule set cannot hold Modern mechanics.`
    : html`You can also save it for the original 1994 game (<b>.TDT</b>); a summary of what carries over shows first. <b>Still experimental</b>: verified to load in the real game for smaller Classic towers.`;
  return html`
      <h2>Export tower?</h2>
      <p>Your tower will be packed into a <b>${TOWER_FILE_EXT}</b> file and downloaded.</p>
      <p style="color:var(--muted);font-size:12px">${legacyLine}</p>
      <div class="modal-actions">
        <button class="btn" data-act="close">Cancel</button>
        <button class="btn" data-act="legacy" ?disabled=${isModern} title=${isModern ? "Classic towers only" : nothing}>For SimTower (1994)…</button>
        <button class="btn primary" data-act="export" autofocus>Export</button>
      </div>`;
}

/** The legacy (.TDT) import fidelity report modal body. */
export function importReportTemplate(report: ImportReport): TemplateResult {
  const stars = starLabel(report.star);
  // Minus before the dollar sign, same as the stats panel (legacy imports
  // can legitimately arrive in the red).
  const money = Math.round(report.money);
  const funds = `${money < 0 ? "-" : ""}$${Math.abs(money).toLocaleString()}`;
  return html`
      <h2>Import from SimTower (1994)</h2>
      <div class="import-facts well">
        <b>${report.towerName}</b> · ${stars} · ${funds}
        · ${report.floors} floor${report.floors === 1 ? "" : "s"}${report.basements ? ` / B${report.basements}` : ""}
        · ${report.unitsImported.toLocaleString()} rooms
      </div>
      <h3>Brought over</h3>
      <ul class="import-list">${listItems(report.broughtOver)}</ul>
      <h3>Couldn't bring over</h3>
      <ul class="import-list">${listItems(report.couldNotBring)}</ul>
      <p style="color:var(--muted);font-size:12px">Nothing is adopted until you open it. Your current tower is kept in its autosave, and the import is copied to a free save slot when one is available.</p>
      <div class="modal-actions">
        <button class="btn" data-act="close">Cancel</button>
        <button class="btn primary" data-act="open" autofocus>Open tower</button>
      </div>`;
}

/** The reverse-fidelity legacy (.TDT) export report modal body. */
export function exportReportTemplate(report: ExportReport): TemplateResult {
  const stars = starLabel(report.star);
  const funds = `${report.money < 0 ? "-" : ""}$${Math.abs(report.money).toLocaleString()}`;
  return html`
      <h2>Export for SimTower (1994)</h2>
      <p style="color:var(--muted);font-size:12px"><b>Work in progress.</b> Exporting to the original 1994 format is still experimental. It has been verified to load and play in the real game for smaller Classic towers; a large or complex tower may not load correctly yet. Your tower here is never changed.</p>
      <div class="import-facts well">
        <b>${report.towerName}</b> · ${stars} · ${funds}
        · ${report.floors} floor${report.floors === 1 ? "" : "s"}${report.basements ? ` / B${report.basements}` : ""}
        · ${report.roomsExported.toLocaleString()} rooms
      </div>
      <h3>Comes along</h3>
      <ul class="import-list">${listItems(report.comesAlong)}</ul>
      <h3>Stays behind</h3>
      <ul class="import-list">${listItems(report.staysBehind)}</ul>
      <p style="color:var(--muted);font-size:12px">Downloads as <b>${report.filename}</b>. Your tower here is untouched.</p>
      <div class="modal-actions">
        <button class="btn" data-act="close">Cancel</button>
        <button class="btn primary" data-act="download" autofocus>Download .TDT</button>
      </div>`;
}
