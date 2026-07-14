import { describe, it, expect, vi } from "vitest";
import {
  batchPricingTemplate,
  batchPriceText,
  batchPreviewMessage,
  type BatchPricingCtx,
  type BatchPricingState,
  type BatchPricingHandlers,
} from "./batchPricing";
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
