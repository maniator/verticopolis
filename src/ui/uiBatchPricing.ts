
import type { UI } from "./UI";
import { render } from "lit-html";
import {
  batchPricingTemplate,
  batchPriceText,
  batchPreviewMessage,
  batchRungTemplate,
  batchRungPreviewMessage,
  type BatchPricingState,
  type BatchPricingCtx,
  type BatchRungCtx,
  type BatchRungState,
  type BatchRungHandlers,
} from "./templates/batchPricing";
import { syncRungSelects } from "./templates/rungPicker";
import type { BatchTarget, BatchRentOptions, BatchRentResult } from "../engine/Simulation";
import type { PriceOptions, PriceRung } from "../engine/gameRules";
import type { FacilityKind } from "../engine/types";

/**
 * The batch-pricing dialog controllers, extracted from `uiDialogs.ts` (which
 * re-exports {@link showBatchPricingDialog}, so callers are unchanged): the
 * Modern band controller with its live number machinery, and the Classic
 * ladder variant with the rung picker and the armed No Rate confirm.
 */

/** Batch-pricing dialog, pre-scoped to one priced kind. Live honest preview
 *  (same engine core as apply); Apply is disabled at zero changes. The body is
 *  chosen off the SHAPE of the mode's price options (never the mode string):
 *  a ladder gets the Classic rung-picker variant, a band keeps today's range
 *  editor byte-for-byte. */
export function showBatchPricingDialog(
  ui: UI,
  ctx: {
    kind: FacilityKind;
    kindLabel: string;
    options: PriceOptions;
  },
  cb: {
    preview: (target: BatchTarget, opts: BatchRentOptions) => BatchRentResult;
    apply: (target: BatchTarget, opts: BatchRentOptions) => BatchRentResult;
    onApplied: (summary: string) => void;
  },
): void {
  const { kind } = ctx;
  const noun = ctx.kindLabel.toLowerCase() + "s";
  if (ctx.options.shape === "ladder") {
    return showBatchRungDialog(ui, noun, ctx.kindLabel.toLowerCase(), ctx.options.rungs, cb);
  }
  const band = ctx.options.band;
  const priceWord = kind === "condo" ? "price" : "rent";
  const tctx: BatchPricingCtx = { noun, priceWord, band };
  // Snap a typed price to the band's step grid, so batch matches the ± adjuster's
  // granularity (a typed 12,345 becomes 12,000 for a $1,000-step office).
  const snap = (v: number) => {
    const stepped = Math.round((v - band.min) / band.step) * band.step + band.min;
    return Math.max(band.min, Math.min(band.max, stepped));
  };
  const clampStep = (v: number) => Math.max(band.min, Math.min(band.max, v));
  // The dialog's whole visible state. Every event mutates this and re-renders,
  // replacing the old hand-written refresh() that mutated the DOM in place.
  const state: BatchPricingState = {
    mode: "set",
    priceRaw: String(band.default),
    only: false,
    resetArmed: false,
    previewMsg: "",
    applyDisabled: false,
  };
  const targetOf = (): BatchTarget => (state.mode === "default" ? "default" : snap(Number(state.priceRaw) || 0));
  const optsOf = (): BatchRentOptions => ({ onlyDefaultPriced: state.only });
  // Recompute the honest preview sentence and the Apply-disabled flag from state
  // (the same engine core as apply), so the render is a pure view of `state`.
  const recompute = () => {
    const t = targetOf();
    const r = cb.preview(t, optsOf());
    state.previewMsg = batchPreviewMessage(tctx, t, r);
    state.applyDisabled = r.changed === 0;
  };
  // Re-render the whole dialog from `state` into the modal box. lit patches in
  // place, and the title-bar close that finishModal appends after the h2 (outside
  // lit's managed region) survives the re-render.
  function rerender(): void {
    render(batchPricingTemplate(tctx, state, handlers), box);
  }
  // Any input disarms a pending bulk reset (as the old refresh() did), then
  // re-previews and re-renders.
  const afterInput = () => {
    state.resetArmed = false;
    recompute();
    rerender();
  };
  const step = (dir: 1 | -1) => {
    state.priceRaw = String(clampStep((Number(state.priceRaw) || 0) + dir * band.step));
    afterInput();
  };
  const handlers = {
    onDec: () => step(-1),
    onInc: () => step(1),
    onPriceInput: (e: Event) => {
      state.priceRaw = (e.target as HTMLInputElement).value;
      afterInput();
    },
    // On commit (blur/Enter), normalize the field to the snapped value it will
    // actually apply, so the input never shows a number different from the result.
    onPriceChange: () => {
      if (state.mode !== "default") state.priceRaw = String(snap(Number(state.priceRaw) || 0));
      afterInput();
    },
    onModeChange: (e: Event) => {
      state.mode = (e.target as HTMLInputElement).value === "default" ? "default" : "set";
      afterInput();
    },
    onOnlyChange: (e: Event) => {
      state.only = (e.target as HTMLInputElement).checked;
      afterInput();
    },
    onApply: () => {
      // A bulk reset clears everyone's custom price, require a confirming click.
      if (state.mode === "default" && !state.resetArmed) {
        state.resetArmed = true;
        rerender();
        return;
      }
      const r = cb.apply(targetOf(), optsOf());
      cb.onApplied(`Set ${r.changed} ${noun} to ${batchPriceText(tctx, targetOf())}.`);
      ui.closeModal();
    },
    onCancel: () => ui.closeModal(),
  };
  recompute();
  const box = ui.openModalTemplate(batchPricingTemplate(tctx, state, handlers));
}

/** The Classic (ladder) batch-pricing body: one rung picker in place of the
 *  number machinery, the only-on-Average filter, the honest preview, and the
 *  armed two-click confirm for a kind-wide No Rate (the one heavyweight choice
 *  in this dialog). Pinned copy per ux-pricing-split-editor §1.7 / §5. */
function showBatchRungDialog(
  ui: UI,
  noun: string,
  single: string,
  rungs: readonly PriceRung[],
  cb: {
    preview: (target: BatchTarget, opts: BatchRentOptions) => BatchRentResult;
    apply: (target: BatchTarget, opts: BatchRentOptions) => BatchRentResult;
    onApplied: (summary: string) => void;
  },
): void {
  const tctx: BatchRungCtx = { noun, single, rungs };
  // Opens on Average, the default rung (AR6), so Apply-with-no-thought is the
  // reset-to-default the old dialog's second radio offered.
  const state: BatchRungState = {
    choice: 2,
    only: false,
    noRateArmed: false,
    previewMsg: "",
    applyDisabled: false,
  };
  const targetOf = (): BatchTarget => (state.choice === "noRate" ? "noRate" : rungs[state.choice].value);
  const optsOf = (): BatchRentOptions => ({ onlyDefaultPriced: state.only });
  const recompute = () => {
    const r = cb.preview(targetOf(), optsOf());
    state.previewMsg = batchRungPreviewMessage(tctx, state.choice, r);
    state.applyDisabled = r.changed === 0;
  };
  function rerender(): void {
    render(batchRungTemplate(tctx, state, handlers), box);
    // Post-render selection write (see rungPicker.ts): options must be
    // attached before a select's value can be set reliably.
    syncRungSelects(box);
  }
  // Any change disarms a pending No Rate confirm, then re-previews.
  const afterInput = () => {
    state.noRateArmed = false;
    recompute();
    rerender();
  };
  const handlers: BatchRungHandlers = {
    onChoiceChange: (e: Event) => {
      const v = (e.target as HTMLSelectElement).value;
      state.choice = v === "noRate" ? "noRate" : (Number(v) as 0 | 1 | 2 | 3);
      afterInput();
    },
    onOnlyChange: (e: Event) => {
      state.only = (e.target as HTMLInputElement).checked;
      afterInput();
    },
    onApply: () => {
      // Taking a whole kind off the market is armed: first activation relabels
      // the primary to "Confirm No Rate", the second applies.
      if (state.choice === "noRate" && !state.noRateArmed) {
        state.noRateArmed = true;
        rerender();
        return;
      }
      const r = cb.apply(targetOf(), optsOf());
      const summary =
        state.choice === "noRate"
          ? `Took ${r.changed} ${noun} off the market (No Rate).`
          : `Set ${r.changed} ${noun} to ${rungs[state.choice].label} ($${rungs[state.choice].value.toLocaleString()}).`;
      cb.onApplied(summary);
      ui.closeModal();
    },
    onCancel: () => ui.closeModal(),
  };
  recompute();
  const box = ui.openModalTemplate(batchRungTemplate(tctx, state, handlers));
  syncRungSelects(box); // initial selection, post-attach (see rungPicker.ts)
}
