import { html, nothing, type TemplateResult } from "lit-html";
import type { SlotInfo } from "../../storage/SaveGame";

/**
 * The Saved Towers slot manager body. Authored to match `savesHtml` structurally
 * (proven by the transitional `assertDomEquivalent` test): the auto-save row plus
 * one row per numbered slot, each with its rule-set chip, star/pop/funds detail,
 * and per-row Save/Load/Delete actions gated by slot kind and existence. Rows are
 * composed as nested `TemplateResult`s (not a joined string), so the tower name
 * interpolates as auto-escaped text with no `escapeHtml` call. The Delete button
 * keeps its per-row `aria-label` for screen readers.
 *
 * This is a STATIC structure only. The row buttons (`data-save`/`data-load`/
 * `data-del`) and the footer actions (export/import/close) are wired imperatively
 * by the controller (`showSaves`) after mount, unchanged by this migration, so the
 * re-render-on-save flow keeps routing exactly as before.
 */
export function savesTemplate(slots: SlotInfo[]): TemplateResult {
  return html`
      <h2>Saved Towers</h2>
      <div class="slots well">${slots.map(slotRow)}</div>
      <div class="modal-actions">
        <button class="btn" data-act="export">Export to file</button>
        <button class="btn" data-act="import">Import from file</button>
        <button class="btn primary" data-act="close">Close</button>
      </div>`;
}

const fmtWhen = (ms?: number): string =>
  ms ? new Date(ms).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "";

function slotRow(s: SlotInfo): TemplateResult {
  const name = s.slot === "auto" ? "Auto-save" : `Slot ${s.slot}`;
  // The rule-set chip reuses the New Tower dialog's badge language (muted
  // Classic, green Modern). SlotInfo's mode is already coerced, so the
  // chip text is one of two literals, never raw file content.
  const modeChip =
    s.mode === "modern"
      ? html`<span class="nt-badge alt">Modern</span>`
      : html`<span class="nt-badge">Classic</span>`;
  // Plain integer, no locale grouping: the day is an ordinal, and the
  // finiteness guard keeps any non-numeric SlotInfo producer from ever
  // reaching the template raw (storage already bounds the value).
  const when = [Number.isFinite(s.day) ? `Day ${Math.floor(s.day!)}` : "", fmtWhen(s.savedAt)]
    .filter(Boolean)
    .join(" · ");
  const detail = s.exists
    ? html`<div class="slot-detail">${s.towerName ?? "Tower"} ${modeChip} · ${s.star === 6 ? "TOWER" : (s.star ?? 1) + "★"} · pop ${(s.population ?? 0).toLocaleString()} · $${Math.round(s.funds ?? 0).toLocaleString()}<br /><span class="slot-when">${when}</span></div>`
    : html`<div class="slot-detail slot-empty">empty</div>`;
  const saveBtn =
    s.slot === "auto" ? nothing : html`<button class="btn" data-save="${s.slot}">Save</button>`;
  const loadBtn = s.exists ? html`<button class="btn" data-load="${s.slot}">Load</button>` : nothing;
  const delBtn =
    s.exists && s.slot !== "auto"
      ? html`<button class="btn danger" data-del="${s.slot}" aria-label="Delete save slot ${s.slot}">✕</button>`
      : nothing;
  return html`<div class="slot"><div class="slot-head"><b>${name}</b>${detail}</div><div class="slot-actions">${saveBtn}${loadBtn}${delBtn}</div></div>`;
}
