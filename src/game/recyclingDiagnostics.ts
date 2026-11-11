import { html, type TemplateResult } from "lit-html";
import { groupDigits } from "../ui/format";

/**
 * The recycling card's lines: current fill and the capacity/demand verdict.
 * The card kit builds them from what the Rust engine's port reports.
 */

/** The lines for `pop` population against `cap` processed, with the bins
 *  `fill` full (0 to 1). `demandMet` is the engine's verdict
 *  (`recyclingDemandMet`); the card only words it. */
export function recyclingLinesOf(pop: number, cap: number, fill: number, demandMet: boolean): TemplateResult[] {
  const fillPct = Math.round(fill * 100);
  return [
    html`<div>Fill: ${fillPct}%. Truck collects each morning.</div>`,
    demandMet
      ? html`<div style="color:var(--good)">Capacity: ${groupDigits(pop)}/${groupDigits(cap)} population; demand met.</div>`
      : html`<div style="color:var(--bad)">Over capacity: ${groupDigits(pop)} population vs ${groupDigits(cap)} processed. Build another center (4★ requires demand met).</div>`,
  ];
}
