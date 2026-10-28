import { html, type TemplateResult } from "lit-html";
import type { Simulation } from "../engine/Simulation";

/**
 * The recycling card's lines: current fill and the capacity/demand verdict.
 * Split out of `facilityDiagnostics` (the size guard), and shared by both
 * engines: the TypeScript engine's tower reads them off `sim`
 * ({@link recyclingLines}), the Rust engine's cards off the port
 * ({@link recyclingLinesOf}), so the two cards cannot drift on the wording.
 */

/** The lines for `pop` population against `cap` processed, with the bins
 *  `fill` full (0 to 1). The demand-met check is `pop <= cap`, exactly
 *  `Simulation.recyclingDemandMet`. */
export function recyclingLinesOf(pop: number, cap: number, fill: number): TemplateResult[] {
  const fillPct = Math.round(fill * 100);
  return [
    html`<div>Fill: ${fillPct}%. Truck collects each morning.</div>`,
    pop <= cap
      ? html`<div style="color:var(--good)">Capacity: ${pop.toLocaleString()}/${cap.toLocaleString()} population; demand met.</div>`
      : html`<div style="color:var(--bad)">Over capacity: ${pop.toLocaleString()} population vs ${cap.toLocaleString()} processed. Build another center (4★ requires demand met).</div>`,
  ];
}

/** The recycling block off the TypeScript tower. Population and capacity are
 *  each scanned once and reused across the lines, so a hover doesn't rescan
 *  the unit list several times over. */
export function recyclingLines(sim: Simulation): TemplateResult[] {
  return recyclingLinesOf(sim.tower.totalPopulation(), sim.recyclingCapacity(), sim.recyclingFill());
}
