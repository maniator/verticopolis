import { html, nothing, type TemplateResult } from "lit-html";
import type { SlotInfo } from "../../storage/SaveGame";
import { groupDigits } from "../format";

/**
 * The Saved Towers slot manager body. Authored to match `savesHtml` structurally
 * (proven by transitional guards, retired with the string builders): the auto-save row plus
 * one row per numbered slot, each with its rule-set chip, star/pop/funds detail,
 * and per-row Save/Load/Delete actions gated by slot kind and existence. Rows are
 * composed as nested `TemplateResult`s (not a joined string), so the tower name
 * interpolates as auto-escaped text with no `escapeHtml` call. The Delete button
 * keeps its per-row `aria-label` for screen readers.
 *
 * `guard` keeps a save from landing on another tower by accident: the live
 * tower's own slot is tagged and saves in one click, any other occupied slot
 * says "Replace…" and asks first (`replaceSlotTemplate`), and the last replace
 * or delete gets an Undo line under the list.
 *
 * This is a STATIC structure only. The row buttons (`data-save`/`data-load`/
 * `data-del`) and the footer actions (export/import/close) are wired imperatively
 * by the controller (`showSaves`) after mount, unchanged by this migration, so the
 * re-render-on-save flow keeps routing exactly as before.
 */
export function savesTemplate(slots: SlotInfo[], keptUnreadable = false, guard: SavesGuard = NO_GUARD): TemplateResult {
  return html`
      <h2>Saved Towers</h2>
      <div class="slots well" role="list" aria-label="Saved towers">
        ${slots.map((s) => slotRow(s, guard.home))}
      </div>
      ${guard.undo ? undoNote(guard.undo) : nothing}
      ${keptUnreadable ? keptUnreadableNote : nothing}
      <div class="modal-actions">
        <button class="btn" data-act="export">Export to file…</button>
        <button class="btn" data-act="import">Import from file…</button>
        <button class="btn primary" data-act="close">Close</button>
      </div>`;
}

/**
 * What the Saved Towers dialog needs to keep the player from saving over
 * another tower by accident (`storage/slotGuard`).
 */
export interface SavesGuard {
  /** The manual slot known to hold the tower being played. Saving there stays
   *  one click; saving over any other occupied slot asks first. Null when no
   *  slot is known to hold it, so every occupied slot asks. */
  readonly home: number | null;
  /** The name of the tower being played, for the replace confirm. */
  readonly liveName: string;
  /** The one step of Undo, when there is one to offer. */
  readonly undo: SavesUndo | null;
  /** At the click, the slot's row when a save there must ask first, or null
   *  when it may save at once. Read from storage then, since the list may be
   *  stale. Without it, the dialog decides from the list it drew. */
  readonly replaceTarget?: (slot: number) => SlotInfo | null;
}

/** The Undo line under the slots: what it puts back, and the action. */
export interface SavesUndo {
  readonly slot: number;
  readonly towerName: string;
  readonly action: "replaced" | "deleted";
  /** Put the tower back. */
  readonly run: () => UndoResult;
}

/** What an Undo did: put the tower back, found the slot changed since (so
 *  there is nothing to put back), or failed to write (said in the dialog). */
export type UndoResult = "back" | "gone" | "failed";

/** No guard state: no home slot (every occupied slot asks) and no Undo. */
export const NO_GUARD: SavesGuard = { home: null, liveName: "Tower", undo: null };

/** The Undo line. The button is wired by `[data-act="undo"]`. */
function undoNote(u: SavesUndo): TemplateResult {
  const what = u.action === "replaced" ? html`Replaced <b>${u.towerName}</b> in Slot ${u.slot}.` : html`Deleted <b>${u.towerName}</b> from Slot ${u.slot}.`;
  return html`<p class="slot-detail slot-undo"><span>${what}</span><button class="btn" data-act="undo" aria-label="Undo: put ${u.towerName} back in Slot ${u.slot}">Undo</button></p>`;
}

/**
 * The confirm shown before a save replaces a tower in an occupied slot that is
 * not the live tower's own. It names both towers: the saved one with the same
 * summary row the list shows, and the live one by name. Cancel comes first
 * and is the default button (it takes focus), so Enter, Esc, the ✕ and a
 * click outside all keep the saved tower.
 */
export function replaceSlotTemplate(
  target: SlotInfo,
  liveName: string,
  actions: { onCancel: () => void; onReplace: () => void },
): TemplateResult {
  const name = slotName(target);
  const sameName = (target.towerName || "Tower") === liveName;
  return html`<h2>Replace ${name}?</h2>
      <p>${name} already holds a saved tower:</p>
      <div class="slots well"><div class="slot"><div class="slot-head">${slotDetail(target)}</div></div></div>
      <p>Saving here replaces it with <b>${liveName}</b>, the tower you're playing now.${sameName ? " They have the same name, so check the date and population." : ""}
        To keep both, save to an empty slot or use Export to file.</p>
      <div class="modal-actions"><button class="btn primary" data-act="no" @click=${actions.onCancel}>Cancel</button><button class="btn danger" data-act="yes" @click=${actions.onReplace}>Replace</button></div>`;
}

/** An autosave this version couldn't read is kept aside (SaveGame.preserveUnreadable).
 *  The player can download it, and a save from a newer version imports from
 *  that file once the game is updated. */
const keptUnreadableNote = html`<p class="slot-detail slot-unreadable">
    An autosave this version couldn't read is kept. If a newer version of the game wrote it, update the game, then use Import from file.
    <button class="btn" data-act="unreadable">Download unreadable save</button>
  </p>`;

const fmtWhen = (ms?: number): string =>
  ms ? new Date(ms).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "";

/** Human name for a slot, shared with the title screen's picker. */
export function slotName(s: SlotInfo): string {
  return s.slot === "auto" ? "Auto-save" : `Slot ${s.slot}`;
}

/**
 * The one-line tower summary for an EXISTING slot: name, rule-set chip, star,
 * population, funds, then the day and write time.
 *
 * Exported because the title screen's load-only picker
 * (`./towerPicker.ts`, SPEC-splash-load-tower) shows the same summary. Sharing
 * the renderer is the point: two copies would let the manager and the picker
 * drift into describing the same tower differently. Callers must check
 * `s.exists` first; this assumes a parsed slot.
 */
export function slotDetail(s: SlotInfo): TemplateResult {
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
  // No census yet (the engine package is not installed): say nothing rather than "pop 0".
  const population = s.population === undefined ? nothing : html` · pop ${groupDigits(s.population)}`;
  return html`<div class="slot-detail">${s.towerName ?? "Tower"} ${modeChip} · ${s.star === 6 ? "TOWER" : (s.star ?? 1) + "★"}${population} · $${groupDigits(Math.round(s.funds ?? 0))}<br /><span class="slot-when">${when}</span></div>`;
}

function slotRow(s: SlotInfo, home: number | null): TemplateResult {
  const name = slotName(s);
  // The live tower's own slot saves in one click and says whose it is. Any
  // other occupied slot reads "Replace…": the ellipsis is the old promise that
  // a question comes before anything happens (see replaceSlotTemplate).
  const isHome = s.exists && s.slot === home;
  // Present in storage but unparseable HERE. This is not an empty slot, and
  // saying so would invite the player to overwrite bytes a later build may
  // still recover (the reasoning `preserveUnreadable` applies to the autosave,
  // and the same wording the title screen's picker uses). So the row is
  // labeled, and it loses its Save button: overwriting is the one action that
  // destroys the evidence. Delete stays, because clearing a slot you have been
  // told is unreadable is a deliberate choice rather than a silent loss.
  const unreadable = s.present && !s.exists;
  let detail: TemplateResult;
  if (s.exists) detail = slotDetail(s);
  else if (unreadable) detail = html`<div class="slot-detail slot-unreadable">Couldn't be read by this version.</div>`;
  else detail = html`<div class="slot-detail slot-empty">empty</div>`;
  const saveBtn = s.slot === "auto" || unreadable ? nothing : saveButton(s.slot, name, s.exists, isHome);
  const tag = isHome ? html` <span class="slot-tag">This tower</span>` : nothing;
  const loadBtn = s.exists ? html`<button class="btn" data-load="${s.slot}">Load</button>` : nothing;
  const delBtn =
    (s.exists || unreadable) && s.slot !== "auto"
      ? html`<button class="btn danger" data-del="${s.slot}" aria-label="Delete save slot ${s.slot}">✕</button>`
      : nothing;
  // `role="listitem"` is not decoration. The container now carries `role="list"`,
  // and a list whose children are not listitems is invalid ARIA: the semantics
  // are dropped, so the label and the item count a screen reader would announce
  // go with them. The two roles ship together or neither does.
  return html`<div class="slot" role="listitem"><div class="slot-head"><b>${name}</b>${tag}${detail}</div><div class="slot-actions">${saveBtn}${loadBtn}${delBtn}</div></div>`;
}

/** A manual slot's save button: one click into an empty slot or the live
 *  tower's own, "Replace…" over any other tower. */
function saveButton(slot: number | "auto", name: string, occupied: boolean, isHome: boolean): TemplateResult {
  if (isHome) return html`<button class="btn primary" data-save="${slot}">Save</button>`;
  if (occupied) return html`<button class="btn" data-save="${slot}" aria-label="Replace the tower in ${name}">Replace…</button>`;
  return html`<button class="btn" data-save="${slot}">Save</button>`;
}
