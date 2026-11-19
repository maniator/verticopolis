import { html, type TemplateResult } from "lit-html";
import { groupDigits } from "@verticopolis/components/windows/format";

/**
 * The recycling card's lines: current fill and the capacity/demand verdict.
 * The card kit builds them from what the Rust engine's port reports.
 */

/** The lines for the engine's `recyclingCard` (#1745): the population the
 *  centers serve, what they process, the bins' fill (0 to 1) and the
 *  engine's verdict, all from one read, so the population shown is the one
 *  the verdict used. The card only words them, with the fix where `advises`
 *  (the catalog's `rules.advisesFixes`). */
export function recyclingLinesOf(card: ArrayLike<number>, advises: boolean): TemplateResult[] {
  const [pop, cap, fill, met] = [card[0], card[1], card[2], card[3]];
  const demandMet = met === 1;
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
