import { html, nothing, type TemplateResult } from "lit-html";
import { live } from "lit-html/directives/live.js";
import type { BatchTarget, BatchRentResult } from "../../engine/Simulation";
import type { PriceRung } from "../../engine/gameRules";
import { rungPickerTemplate, type RungChoice } from "./rungPicker";

/**
 * The batch-pricing dialog (E4, the interactive stateful dialog). This is a pure
 * function of local dialog `state`, re-rendered by the controller
 * (`showBatchPricingDialog`) on every input event, replacing the old hand-written
 * `refresh()` that mutated the preview text and `disabled` in place. Authored to
 * match `batchPricingHtml` structurally at the initial state (proven by the
 * retired transitional guards): the two rule-set radios, the ± price
 * adjuster, the only-default-priced filter, the live `aria-live` preview, and the
 * Apply / Cancel footer.
 *
 * The price field binds its LIVE `.value` from `state.priceRaw` (kept as the raw
 * field text, so typing is preserved and only a commit snaps it) through the
 * `live()` directive: because the controller re-renders on every keystroke,
 * `live()` compares against the DOM's current value and skips the write when they
 * already match, so a mid-number edit does not jerk the caret to the end (a plain
 * `.value` binding would). Programmatic changes (inc/dec, snap, mode) still differ
 * from the DOM value, so those do update the field. Every other control reflects
 * state via `?checked` / `?disabled`. Actions bind inline via
 * `@input` / `@change` / `@click`, so there is no `wireActions` pass; the derived
 * preview message and Apply-disabled flag are computed by the controller and read
 * from `state` here.
 */
export interface BatchPricingCtx {
  noun: string;
  priceWord: string;
  band: { default: number; min: number; max: number; step: number };
}

export interface BatchPricingState {
  mode: "set" | "default";
  /** The raw text in the price field (snapped only on commit), so re-rendering
   *  never reformats mid-type. */
  priceRaw: string;
  only: boolean;
  /** The bulk reset needs a confirming second click; armed by the first. */
  resetArmed: boolean;
  /** The honest preview sentence, or "" before the first preview / when hidden. */
  previewMsg: string;
  applyDisabled: boolean;
}

export interface BatchPricingHandlers {
  onDec: () => void;
  onInc: () => void;
  onPriceInput: (e: Event) => void;
  onPriceChange: () => void;
  onModeChange: (e: Event) => void;
  onOnlyChange: (e: Event) => void;
  onApply: () => void;
  onCancel: () => void;
}

const money = (n: number): string => `$${n.toLocaleString()}`;

/** How a batch target reads in a sentence: the labelled default, or the amount. */
export function batchPriceText(ctx: BatchPricingCtx, target: BatchTarget): string {
  return target === "default" ? `the default (${money(ctx.band.default)})` : money(target as number);
}

/** The honest preview sentence for a previewed batch result, mirroring the old
 *  controller's message chain. A pure function so it lives with the view. */
export function batchPreviewMessage(ctx: BatchPricingCtx, target: BatchTarget, r: BatchRentResult): string {
  let msg = `Set ${r.changed} of ${r.matched} ${ctx.noun} to ${batchPriceText(ctx, target)}.`;
  if (r.skippedCustom) msg += ` ${r.skippedCustom} custom-priced left as-is.`;
  if (r.customOverwritten) msg += ` ${r.customOverwritten} custom price${r.customOverwritten === 1 ? "" : "s"} will be overwritten.`;
  if (r.skippedSold) msg += ` ${r.skippedSold} sold skipped.`;
  if (r.clampedHigh) msg += ` Clamped to the ${money(ctx.band.max)} max.`;
  if (r.clampedLow) msg += ` Clamped to the ${money(ctx.band.min)} min.`;
  return msg;
}

// ---- The Classic (ladder) variant (ux-pricing-split-editor §1.7) -------------
// Same modal window; the body swaps the number machinery for the rung picker.
// The two Modern mode radios collapse into the one select (Average IS the
// default rung, so a separate reset mode would be the same choice twice), the
// range helper line disappears (a ladder needs no band hint), and a rung can
// never clamp, so the preview never emits clamp sentences.

export interface BatchRungCtx {
  /** Plural noun for the kind ("offices"). */
  noun: string;
  /** Singular ("office"), for the lead-in sentence. */
  single: string;
  rungs: readonly PriceRung[];
}

export interface BatchRungState {
  choice: RungChoice;
  only: boolean;
  /** Batch No Rate is armed, two clicks: the first activation relabels the
   *  primary to `Confirm No Rate`, the second applies. Any other change disarms. */
  noRateArmed: boolean;
  previewMsg: string;
  applyDisabled: boolean;
}

export interface BatchRungHandlers {
  onChoiceChange: (e: Event) => void;
  onOnlyChange: (e: Event) => void;
  onApply: () => void;
  onCancel: () => void;
}

/** The honest preview sentence for a ladder batch, pinned strings from the UX
 *  spec's copy inventory (§5). A pure function so it lives with the view. */
export function batchRungPreviewMessage(ctx: BatchRungCtx, choice: RungChoice, r: BatchRentResult): string {
  if (choice === "noRate") {
    return `Take ${r.changed} of ${r.matched} ${ctx.noun} off the market (No Rate). Occupied ${ctx.noun} keep their tenants and charge nothing.`;
  }
  const rung = ctx.rungs[choice];
  let msg = `Set ${r.changed} of ${r.matched} ${ctx.noun} to ${rung.label} (${money(rung.value)}).`;
  if (r.skippedSold) msg += ` ${r.skippedSold} sold skipped.`;
  return msg;
}

export function batchRungTemplate(
  ctx: BatchRungCtx,
  state: BatchRungState,
  h: BatchRungHandlers,
): TemplateResult {
  return html`
      <h2>Set all ${ctx.noun}</h2>
      <p class="bp-rung-lead">Set every ${ctx.single} to</p>
      <div class="bp-rung">${rungPickerTemplate({
        id: "bp-rung",
        rungs: ctx.rungs,
        current: state.choice,
        ariaLabel: `Set every ${ctx.single} to`,
        onChange: h.onChoiceChange,
      })}</div>
      <label class="bp-only"><input id="bp-only" type="checkbox" ?checked=${state.only} @change=${h.onOnlyChange} /> Only ${ctx.noun} still on Average</label>
      <p id="bp-preview" class="bp-preview" aria-live="polite">${state.previewMsg || nothing}</p>
      <div class="modal-actions">
        <button class="btn primary" id="bp-apply" data-act="apply" ?disabled=${state.applyDisabled} @click=${h.onApply}>${state.noRateArmed ? "Confirm No Rate" : "Apply"}</button>
        <button class="btn" data-act="close" @click=${h.onCancel}>Cancel</button>
      </div>`;
}

export function batchPricingTemplate(
  ctx: BatchPricingCtx,
  state: BatchPricingState,
  h: BatchPricingHandlers,
): TemplateResult {
  const { noun, priceWord, band } = ctx;
  return html`
      <h2>Set all ${noun}</h2>
      <div class="batch-modes">
        <label><input type="radio" name="bp-mode" value="set" ?checked=${state.mode === "set"} @change=${h.onModeChange} /> Set ${priceWord} to</label>
        <span class="bp-amount"><button type="button" class="btn" data-bp="dec" aria-label="decrease" @click=${h.onDec}>–</button>
          <input id="bp-price" class="field" type="number" inputmode="numeric" .value=${live(state.priceRaw)} min=${band.min} max=${band.max} step=${band.step} ?disabled=${state.mode === "default"} @input=${h.onPriceInput} @change=${h.onPriceChange} />
          <button type="button" class="btn" data-bp="inc" aria-label="increase" @click=${h.onInc}>+</button></span>
        <div class="bp-band">Range ${money(band.min)}–${money(band.max)}</div>
        <label><input type="radio" name="bp-mode" value="default" ?checked=${state.mode === "default"} @change=${h.onModeChange} /> Reset to default (${money(band.default)})</label>
      </div>
      <label class="bp-only"><input id="bp-only" type="checkbox" ?checked=${state.only} @change=${h.onOnlyChange} /> Only ${noun} still on the default price</label>
      <p id="bp-preview" class="bp-preview" aria-live="polite">${state.previewMsg || nothing}</p>
      <div class="modal-actions">
        <button class="btn primary" id="bp-apply" data-act="apply" ?disabled=${state.applyDisabled} @click=${h.onApply}>${state.resetArmed ? "Confirm reset" : "Apply"}</button>
        <button class="btn" data-act="close" @click=${h.onCancel}>Cancel</button>
      </div>`;
}
