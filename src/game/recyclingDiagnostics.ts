import { html, type TemplateResult } from "lit-html";
import { groupDigits } from "../ui/format";

/**
 * The recycling card's lines: current fill and the capacity/demand verdict.
 * The card kit builds them from what the Rust engine's port reports.
 */

/** The lines for `pop` population against `cap` processed, with the bins
 *  `fill` full (0 to 1). `demandMet` is the engine's verdict
 *  (`recyclingDemandMet`); the card only words it, with the fix where
 *  `advises` (the catalog's `rules.advisesFixes`). */
export function recyclingLinesOf(pop: number, cap: number, fill: number, demandMet: boolean, advises: boolean): TemplateResult[] {
  const fillPct = Math.round(fill * 100);
  // The catalog's `rules.advisesFixes` (#549): Classic names the cause only.
  const over = advises
    ? "Build another center: tenant ratings fall while trash piles up, and 4★ requires demand met."
    : "Tenant ratings fall while trash piles up, and 4★ requires demand met.";
  return [
    html`<div>Fill: ${fillPct}%. Truck collects each morning.</div>`,
    demandMet
      ? html`<div style="color:var(--good)">Capacity: ${groupDigits(pop)}/${groupDigits(cap)} population; demand met.</div>`
      : html`<div style="color:var(--bad)">Over capacity: ${groupDigits(pop)} population vs ${groupDigits(cap)} processed. ${over}</div>`,
  ];
}
