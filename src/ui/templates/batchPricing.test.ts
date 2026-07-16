import { describe, it, expect, vi } from "vitest";
import {
  batchPricingTemplate,
  batchPriceText,
  batchPreviewMessage,
  batchRungTemplate,
  batchRungPreviewMessage,
  type BatchPricingCtx,
  type BatchPricingState,
  type BatchPricingHandlers,
  type BatchRungCtx,
  type BatchRungState,
  type BatchRungHandlers,
} from "./batchPricing";
import { CLASSIC_RULES, type PriceRung } from "../../engine/gameRules";
import type { BatchRentResult } from "../../engine/Simulation";
import { renderToFragment, click, change, input } from "../testing/litTestUtils";

/**
 * The batch-pricing dialog (E4). The template is a pure function of `state`; the
 * controller re-renders it on each event. Package: the state-driven bits (Apply
 * label / disabled, the price field's disabled + value, the preview text, the
 * radio/checkbox reflection) and the inline handler wiring. The reactive
 * re-render flow (snap-on-commit, the
 * two-click reset, live re-preview) lives in the controller and is pinned by the
 * showBatchPricingDialog integration tests.
 */

const BAND = { default: 10000, min: 5000, max: 20000, step: 1000 };
const CTX: BatchPricingCtx = { noun: "offices", priceWord: "rent", band: BAND };

const noop: BatchPricingHandlers = {
  onDec: () => {},
  onInc: () => {},
  onPriceInput: () => {},
  onPriceChange: () => {},
  onModeChange: () => {},
  onOnlyChange: () => {},
  onApply: () => {},
  onCancel: () => {},
};

const initialState = (over: Partial<BatchPricingState> = {}): BatchPricingState => ({
  mode: "set",
  priceRaw: String(BAND.default),
  only: false,
  resetArmed: false,
  previewMsg: "",
  applyDisabled: false,
  ...over,
});

describe("batchPricingTemplate structure and a11y", () => {
  it("keeps the preview a polite live region and labels the ± steppers", () => {
    const frag = renderToFragment(batchPricingTemplate(CTX, initialState(), noop));
    expect(frag.querySelector("#bp-preview")!.getAttribute("aria-live")).toBe("polite");
    expect(frag.querySelector('[data-bp="dec"]')!.getAttribute("aria-label")).toBe("decrease");
    expect(frag.querySelector('[data-bp="inc"]')!.getAttribute("aria-label")).toBe("increase");
  });

  it("offers Apply and Cancel", () => {
    const frag = renderToFragment(batchPricingTemplate(CTX, initialState(), noop));
    expect(frag.querySelector("#bp-apply")!.textContent).toBe("Apply");
    expect(frag.querySelector('[data-act="close"]')!.textContent).toBe("Cancel");
  });
});

describe("batchPricingTemplate reflects state", () => {
  it("shows the preview message and disables Apply when nothing changes", () => {
    const frag = renderToFragment(batchPricingTemplate(CTX, initialState({ previewMsg: "Set 0 of 5 offices to the default (10,000).", applyDisabled: true }), noop));
    expect(frag.querySelector("#bp-preview")!.textContent).toContain("Set 0 of 5 offices");
    expect(frag.querySelector<HTMLButtonElement>("#bp-apply")!.disabled).toBe(true);
  });

  it("relabels Apply to Confirm reset once the bulk reset is armed", () => {
    const frag = renderToFragment(batchPricingTemplate(CTX, initialState({ mode: "default", resetArmed: true }), noop));
    expect(frag.querySelector("#bp-apply")!.textContent).toBe("Confirm reset");
  });

  it("disables the price field and checks the default radio in reset mode", () => {
    const frag = renderToFragment(batchPricingTemplate(CTX, initialState({ mode: "default" }), noop));
    expect(frag.querySelector<HTMLInputElement>("#bp-price")!.disabled).toBe(true);
    expect(frag.querySelector<HTMLInputElement>('input[name="bp-mode"][value="default"]')!.checked).toBe(true);
    expect(frag.querySelector<HTMLInputElement>('input[name="bp-mode"][value="set"]')!.checked).toBe(false);
  });

  it("mirrors the raw price text and the only-default filter", () => {
    const frag = renderToFragment(batchPricingTemplate(CTX, initialState({ priceRaw: "12345", only: true }), noop));
    expect(frag.querySelector<HTMLInputElement>("#bp-price")!.value).toBe("12345");
    expect(frag.querySelector<HTMLInputElement>("#bp-only")!.checked).toBe(true);
  });
});

describe("batchPricingTemplate wires its actions inline", () => {
  it("routes the steppers, the price events, the toggles, and the footer", () => {
    const h: BatchPricingHandlers = {
      onDec: vi.fn(), onInc: vi.fn(), onPriceInput: vi.fn(), onPriceChange: vi.fn(),
      onModeChange: vi.fn(), onOnlyChange: vi.fn(), onApply: vi.fn(), onCancel: vi.fn(),
    };
    const frag = renderToFragment(batchPricingTemplate(CTX, initialState(), h));
    click(frag.querySelector('[data-bp="dec"]')!);
    expect(h.onDec).toHaveBeenCalledOnce();
    click(frag.querySelector('[data-bp="inc"]')!);
    expect(h.onInc).toHaveBeenCalledOnce();
    input(frag.querySelector("#bp-price")!);
    expect(h.onPriceInput).toHaveBeenCalledOnce();
    change(frag.querySelector("#bp-price")!);
    expect(h.onPriceChange).toHaveBeenCalledOnce();
    change(frag.querySelector('input[name="bp-mode"][value="default"]')!);
    expect(h.onModeChange).toHaveBeenCalledOnce();
    change(frag.querySelector("#bp-only")!);
    expect(h.onOnlyChange).toHaveBeenCalledOnce();
    click(frag.querySelector("#bp-apply")!);
    expect(h.onApply).toHaveBeenCalledOnce();
    click(frag.querySelector('[data-act="close"]')!);
    expect(h.onCancel).toHaveBeenCalledOnce();
  });
});

const baseResult = (over: Partial<BatchRentResult> = {}): BatchRentResult => ({
  matched: 5, eligible: 5, changed: 3, skippedSold: 0, skippedCustom: 0, customOverwritten: 0, clampedLow: 0, clampedHigh: 0, ...over,
});

describe("batchPriceText", () => {
  it("labels the default target and formats a numeric target", () => {
    expect(batchPriceText(CTX, "default")).toBe("the default ($10,000)");
    expect(batchPriceText(CTX, 12000)).toBe("$12,000");
  });
});

describe("batchPreviewMessage reproduces the honest count sentence", () => {
  it("states the changed/matched counts and the target", () => {
    expect(batchPreviewMessage(CTX, 12000, baseResult())).toBe("Set 3 of 5 offices to $12,000.");
  });

  it("appends the skipped-custom, sold, and overwrite clauses (with pluralization)", () => {
    const one = batchPreviewMessage(CTX, 12000, baseResult({ skippedCustom: 2, customOverwritten: 1, skippedSold: 4 }));
    expect(one).toBe("Set 3 of 5 offices to $12,000. 2 custom-priced left as-is. 1 custom price will be overwritten. 4 sold skipped.");
    const many = batchPreviewMessage(CTX, 12000, baseResult({ customOverwritten: 3 }));
    expect(many).toContain("3 custom prices will be overwritten.");
  });

  it("appends the clamp clauses when the target leaves the band", () => {
    expect(batchPreviewMessage(CTX, 20000, baseResult({ clampedHigh: 1 }))).toContain("Clamped to the $20,000 max.");
    expect(batchPreviewMessage(CTX, 5000, baseResult({ clampedLow: 1 }))).toContain("Clamped to the $5,000 min.");
  });
});

describe("batchRungTemplate (the Classic ladder variant, ux-pricing-split-editor §1.7)", () => {
  const RUNGS = (CLASSIC_RULES.priceOptions("office") as { rungs: readonly PriceRung[] }).rungs;
  const RCTX: BatchRungCtx = { noun: "offices", single: "office", rungs: RUNGS };
  const rnoop: BatchRungHandlers = {
    onChoiceChange: () => {},
    onOnlyChange: () => {},
    onApply: () => {},
    onCancel: () => {},
  };
  const rstate = (over: Partial<BatchRungState> = {}): BatchRungState => ({
    choice: 2,
    only: false,
    noRateArmed: false,
    previewMsg: "",
    applyDisabled: false,
    ...over,
  });

  it("swaps the number machinery for the rung picker: no price field, no band hint, no mode radios", () => {
    const frag = renderToFragment(batchRungTemplate(RCTX, rstate(), rnoop));
    expect(frag.querySelector("#bp-rung")).not.toBeNull();
    expect(frag.querySelector("#bp-price")).toBeNull();
    expect(frag.querySelector(".bp-band")).toBeNull();
    expect(frag.querySelector('input[type="radio"]')).toBeNull();
    expect(frag.textContent).toContain("Set every office to");
    // The filter survives, reworded to the ladder.
    expect(frag.textContent).toContain("Only offices still on Average");
    // The preview stays a polite live region; one primary plus Cancel.
    expect(frag.querySelector("#bp-preview")!.getAttribute("aria-live")).toBe("polite");
    expect(frag.querySelectorAll(".modal-actions .btn.primary")).toHaveLength(1);
  });

  it("relabels the primary to Confirm No Rate while armed", () => {
    expect(
      renderToFragment(batchRungTemplate(RCTX, rstate(), rnoop)).querySelector("#bp-apply")!.textContent,
    ).toBe("Apply");
    expect(
      renderToFragment(batchRungTemplate(RCTX, rstate({ choice: "noRate", noRateArmed: true }), rnoop))
        .querySelector("#bp-apply")!.textContent,
    ).toBe("Confirm No Rate");
  });

  it("pins the preview sentences: rung, sold-skipped, and the No Rate warning", () => {
    const r = (over: Partial<BatchRentResult> = {}): BatchRentResult => ({
      matched: 12,
      eligible: 9,
      changed: 9,
      skippedSold: 0,
      skippedCustom: 0,
      customOverwritten: 0,
      clampedLow: 0,
      clampedHigh: 0,
      ...over,
    });
    expect(batchRungPreviewMessage(RCTX, 1, r())).toBe("Set 9 of 12 offices to Low ($5,000).");
    const condoCtx: BatchRungCtx = {
      noun: "condos",
      single: "condo",
      rungs: (CLASSIC_RULES.priceOptions("condo") as { rungs: readonly PriceRung[] }).rungs,
    };
    expect(batchRungPreviewMessage(condoCtx, 3, r({ matched: 6, changed: 4, skippedSold: 2 }))).toBe(
      "Set 4 of 6 condos to High ($200,000). 2 sold skipped.",
    );
    expect(batchRungPreviewMessage(RCTX, "noRate", r({ matched: 14, changed: 12 }))).toBe(
      "Take 12 of 14 offices off the market (No Rate). Occupied offices keep their tenants and charge nothing.",
    );
  });
});
