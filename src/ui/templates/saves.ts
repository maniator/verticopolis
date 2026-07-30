import { html, nothing, type TemplateResult } from "lit-html";
import type { SlotInfo } from "../../storage/SaveGame";

/**
 * The Saved Towers slot manager body. Authored to match `savesHtml` structurally
 * (proven by transitional guards, retired with the string builders): the auto-save row plus
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
/**
 * Where the listed towers live, as the player should be told.
 *
 * INJECTED, never detected. Nothing in `src/ui/` asks what platform it is on or
 * imports the platform port; a caller that knows passes this, and every caller
 * that does not simply omits it, which is exactly how `storageBlocked` already
 * works one module over. Web, Android and iOS pass nothing, so no caption is
 * rendered and the list keeps a generic name.
 *
 * Both strings come from the side that knows what the storage area actually is.
 * Composing them here would mean this module reasoning about namespaces, and it
 * would put player-facing wording about shared storage somewhere no one would
 * think to look for it.
 */
export interface SaveScopeCaption {
  /** Visible sentence, rendered between the heading and the list. */
  readonly text: string;
  /** Accessible name for the list, naming the same scope in fewer words. */
  readonly listLabel: string;
}

/** Ties the caption to the list it describes. Distinct per template so the two
 *  can never collide if both are ever mounted at once. */
const SAVES_CAPTION_ID = "saves-scope-caption";

export function savesTemplate(slots: SlotInfo[], scope?: SaveScopeCaption): TemplateResult {
  return html`
      <h2>Saved Towers</h2>
      ${scopeCaption(scope, SAVES_CAPTION_ID)}
      <div
        class="slots well"
        role="list"
        aria-label="${scopeListLabel(scope, "Saved towers")}"
        aria-describedby="${hasScopeCaption(scope) ? SAVES_CAPTION_ID : nothing}"
      >
        ${slots.map(slotRow)}
      </div>
      <div class="modal-actions">
        <button class="btn" data-act="export">Export to file</button>
        <button class="btn" data-act="import">Import from file</button>
        <button class="btn primary" data-act="close">Close</button>
      </div>`;
}

/**
 * The caption, in DOM order between the heading and the list, AND linked to it
 * by `aria-describedby`.
 *
 * Document order alone is not enough. It serves a player reading sequentially,
 * but the normal way to reach a list of saves is to jump to it by role, and a
 * jump lands past anything that merely precedes it. The association is what
 * makes the caption reachable both ways.
 *
 * Ordinary rendered text rather than a live region: this is a standing property
 * of the storage, not an event, and announcing it as an event would interrupt
 * whatever the player was doing.
 *
 * Exported so the title screen's picker renders the identical markup instead of
 * a second copy that can drift.
 */
export function scopeCaption(scope: SaveScopeCaption | undefined, id: string): TemplateResult | typeof nothing {
  const text = scopeText(scope);
  // An all-whitespace caption would render an empty paragraph, taking its
  // margin with it and describing the list as "".
  return text ? html`<p class="slots-scope" id="${id}">${text}</p>` : nothing;
}

/**
 * Whether a caption element will actually be rendered.
 *
 * The describedby attribute and the element itself MUST agree. Deciding the
 * attribute on `scope` while deciding the element on the text left a dangling
 * reference to a missing id whenever a shell sent a label but no text, which
 * is a worse accessible name than none at all. Both now ask this.
 */
export function hasScopeCaption(scope: SaveScopeCaption | undefined): boolean {
  return scopeText(scope) !== "";
}

/** The caption text, or "" when there is nothing usable to render. */
function scopeText(scope: SaveScopeCaption | undefined): string {
  return bridgeString(scope, "text");
}

/**
 * Read one string off an object that came from a wrapper shell, or "" if it is
 * not there, not a string, or hostile to read at all.
 *
 * The ACCESS is guarded, not just the type. `src/platform/` already takes this
 * posture toward an injected port ("Even the property reads are untrusted: a
 * throwing getter or revoked Proxy must degrade like any other malformed
 * injection"), and a type check alone left this module holding a weaker
 * definition of untrusted than the module it receives its data from. Here the
 * cost of being wrong is the whole saves dialog failing to render.
 */
function bridgeString(source: SaveScopeCaption | undefined, key: "text" | "listLabel"): string {
  try {
    const value = source?.[key];
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

/**
 * The list's accessible name: what the list IS, then where it lives.
 *
 * The scope AUGMENTS the functional name rather than replacing it. Replacing it
 * gave the saves manager and the load-only picker the identical accessible name
 * (both became "Towers on this computer"), which threw away the one word
 * telling a screen reader user which of the two they were in, and the shell has
 * no way to know which list it is naming.
 *
 * Falls back on an empty or absent label rather than blanking the name, and
 * type-checks the value because it crosses a process bridge: the interface
 * promises a string, an injection is not obliged to keep that promise, and a
 * throw here takes down the whole dialog.
 */
export function scopeListLabel(scope: SaveScopeCaption | undefined, fallback: string): string {
  const label = bridgeString(scope, "listLabel");
  return label ? `${fallback}, ${label}` : fallback;
}

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
  return html`<div class="slot-detail">${s.towerName ?? "Tower"} ${modeChip} · ${s.star === 6 ? "TOWER" : (s.star ?? 1) + "★"} · pop ${(s.population ?? 0).toLocaleString()} · $${Math.round(s.funds ?? 0).toLocaleString()}<br /><span class="slot-when">${when}</span></div>`;
}

function slotRow(s: SlotInfo): TemplateResult {
  const name = slotName(s);
  // Present in storage but unparseable HERE. This is not an empty slot, and
  // saying so would invite the player to overwrite bytes a later build may
  // still recover (the reasoning `preserveUnreadable` applies to the autosave,
  // and the same wording the title screen's picker uses). So the row is
  // labeled, and it loses its Save button: overwriting is the one action that
  // destroys the evidence. Delete stays, because clearing a slot you have been
  // told is unreadable is a deliberate choice rather than a silent loss.
  const unreadable = s.present && !s.exists;
  const detail = s.exists
    ? slotDetail(s)
    : unreadable
      ? html`<div class="slot-detail slot-unreadable">Couldn't be read by this version.</div>`
      : html`<div class="slot-detail slot-empty">empty</div>`;
  const saveBtn =
    s.slot === "auto" || unreadable ? nothing : html`<button class="btn" data-save="${s.slot}">Save</button>`;
  const loadBtn = s.exists ? html`<button class="btn" data-load="${s.slot}">Load</button>` : nothing;
  const delBtn =
    (s.exists || unreadable) && s.slot !== "auto"
      ? html`<button class="btn danger" data-del="${s.slot}" aria-label="Delete save slot ${s.slot}">✕</button>`
      : nothing;
  // `role="listitem"` is not decoration. The container now carries `role="list"`,
  // and a list whose children are not listitems is invalid ARIA: the semantics
  // are dropped, so the label and the item count a screen reader would announce
  // go with them. The two roles ship together or neither does.
  return html`<div class="slot" role="listitem"><div class="slot-head"><b>${name}</b>${detail}</div><div class="slot-actions">${saveBtn}${loadBtn}${delBtn}</div></div>`;
}
