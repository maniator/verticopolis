import { html, nothing, type TemplateResult } from "lit-html";
import type { PriceRung } from "../../engine/gameRules";

/**
 * The shared Classic rung picker row: a color chip plus a native `<select>` of
 * the four canon rungs and the No Rate off switch (ux-pricing-split-editor §1).
 * One template for the unit editor card and the Classic batch dialog, so the
 * two surfaces can never drift on option text or order. The labels come from
 * the engine's `priceOptions(kind)` rungs, so the UI can never drift from the
 * canon table either.
 */

/** What the picker can sit on: a ladder level, or the off-market state. */
export type RungChoice = 0 | 1 | 2 | 3 | "noRate";

/** One rung's option text, verbatim per the UX spec: `Very Low  $2,000`. The
 *  billing period is NOT repeated here; the card's kv label already says
 *  Quarterly rent / Sale price / Room rate (one statement per card). */
export function rungOptionLabel(r: PriceRung): string {
  return `${r.label}  $${r.value.toLocaleString()}`;
}

/** The disabled divider between the ladder and the off switch, so No Rate
 *  reads as a deliberate switch, not a fifth price. Box-drawing rules (the
 *  standing empty-value glyph family), not prose punctuation. */
const DIVIDER = "──────";

export function rungPickerTemplate(opts: {
  /** The select's element id (`ed-rung` on the editor card, `bp-rung` in the batch dialog). */
  id: string;
  rungs: readonly PriceRung[];
  current: RungChoice;
  ariaLabel: string;
  disabled?: boolean;
  /** Editor-card path: the delegated [data-edit-select] change listener routes
   *  this value through handleEditAction (no inline handler needed). */
  dataEditSelect?: string;
  /** Dialog path: an inline @change handler (the batch controller re-renders
   *  from its own state). */
  onChange?: (e: Event) => void;
}): TemplateResult {
  const { rungs, current } = opts;
  // The chip is decorative reinforcement only (aria-hidden): the rung NAME is
  // always in the select text beside it, so color never carries the state
  // alone. No Rate renders it hollow (no fill): absence of a price is absence
  // of a fill.
  //
  // Selection is NOT bound on the options: lit commits an option's bindings
  // before the option attaches to the select, where selection writes are
  // unreliable (the select recomputes selectedness on attach; happy-dom drops
  // them entirely). The engine truth rides `data-current` instead, and every
  // render site follows up with {@link syncRungSelects}, a plain post-render
  // `select.value` write, which is well-defined everywhere.
  return html`<span class="rung-chip" data-rung=${current === "noRate" ? "none" : current} aria-hidden="true"></span><select
      id=${opts.id}
      class="field"
      aria-label=${opts.ariaLabel}
      data-current=${String(current)}
      data-edit-select=${opts.dataEditSelect ?? nothing}
      ?disabled=${opts.disabled ?? false}
      @change=${opts.onChange ?? nothing}
    >
      ${rungs.map((r) => html`<option value=${r.level}>${rungOptionLabel(r)}</option>`)}
      <option disabled>${DIVIDER}</option>
      <option value="noRate">No Rate</option>
    </select>`;
}

/**
 * Point every rung picker under `root` at its engine truth (`data-current`),
 * written AFTER render so the options are attached and the value write sticks.
 * Two guards keep the ~6 Hz editor pump from fighting the player: the write is
 * skipped when the DOM already agrees, AND a focused select is left alone
 * entirely (some platforms move `value` while the player arrows through the
 * open list, before `change` commits, so a pump write mid-interaction would
 * cancel the pick). Engine truth still lands: the change handler's own refresh
 * and the first pump after blur both reconcile, and a value that genuinely
 * moved underneath (a batch reprice, an undo) follows then.
 * Call after every render that may contain a rung picker (the editor pump and
 * the batch dialog both do).
 */
export function syncRungSelects(root: ParentNode): void {
  for (const s of root.querySelectorAll<HTMLSelectElement>("select[data-current]")) {
    if (s.ownerDocument.activeElement === s) continue;
    const v = s.dataset.current!;
    if (s.value !== v) s.value = v;
  }
}
