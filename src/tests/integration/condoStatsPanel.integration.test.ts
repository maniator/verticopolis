import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { rentOf } from "../../engine/econConfig";
import { GRID } from "../../engine/facilities";
import type { Unit } from "../../engine/types";
import { statsTemplate } from "../../ui/templates/stats";
import { unitEditorTemplate } from "../../ui/templates/editor";
import { renderToFragment } from "../../ui/testing/litTestUtils";

/**
 * The stats dialog's Households readout and the sold-condo editor price,
 * driven by REAL move-ins over ticked time (split from
 * `condoModes.integration.test.ts` when that suite reached the file-size
 * ceiling; the condo rule-set tests stay there).
 */

const C = Math.floor(GRID.width / 2);

function lay(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = 0; x < GRID.width; x++) sim.tower.place(kind, floor, x);
}

/** A served, sale-ready condo on a fresh tower (same idiom as condoModes). */
function servedCondo(sim: Simulation): Unit {
  sim.money = 1e9;
  sim.star = 1; // no random fire/bomb events to perturb the run
  lay(sim, "lobby", 1);
  lay(sim, "floor", 2);
  sim.buildTransport("elevatorStandard", C, 1, 2);
  const r = sim.tower.place("condo", 2, C + 4);
  const condo = sim.tower.units.find((u) => u.id === r.unitId)!;
  condo.state = "empty"; // skip the construction phase
  condo.satisfaction = 1;
  return condo;
}

/** Tick hours until a predicate holds (or we give up), so RNG-driven move-ins
 *  and evictions can resolve without hard-coding a tick count. */
function tickUntil(sim: Simulation, pred: () => boolean, maxHours = 24 * 40): boolean {
  for (let i = 0; i < maxHours && !pred(); i++) sim.tick(60);
  return pred();
}

describe("Not-present households never ghost the readout (gutted/empty)", () => {
  it("excludes a gutted sold condo from both population and the Households section", () => {
    const sim = Simulation.newGame(3, "modern");
    const condo = servedCondo(sim);
    tickUntil(sim, () => condo.everOccupied);
    expect(sim.tower.totalPopulation()).toBe(condo.residents);
    expect(renderToFragment(statsTemplate(sim)).textContent).toContain("People housed");
    // A fire guts the only sold condo: it stops being present.
    condo.state = "gutted";
    // Population drops it (isPresent false) …
    expect(sim.tower.totalPopulation()).toBe(0);
    // … and the Households readout drops it too — no ghost family, back to the
    // empty-state placeholder rather than a stale "People housed".
    expect(renderToFragment(statsTemplate(sim)).textContent).toContain("No condos sold yet");
  });
});

describe("Stats panel — Households section (Modern only)", () => {
  it("shows a Households section on a Modern tower, and not on a Classic one", () => {
    const modern = Simulation.newGame(3, "modern");
    const mc = servedCondo(modern);
    tickUntil(modern, () => mc.everOccupied);
    const modernText = renderToFragment(statsTemplate(modern)).textContent!;
    expect(modernText).toContain("Households");
    expect(modernText).toMatch(/Avg household/);

    const classic = Simulation.newGame(3, "classic");
    const cc = servedCondo(classic);
    tickUntil(classic, () => cc.everOccupied);
    expect(renderToFragment(statsTemplate(classic)).textContent).not.toContain("Households");
  });

  it("shows a sold Modern condo's editor price as the household-scaled amount (what buy-back reclaims)", () => {
    const sim = Simulation.newGame(7, "modern");
    const condo = servedCondo(sim);
    tickUntil(sim, () => condo.everOccupied);
    const expected = Math.round((rentOf(condo) * condo.residents!) / 3);
    expect(renderToFragment(unitEditorTemplate(sim, condo)).querySelector('[data-field="rent"]')!.textContent).toBe(`$${expected.toLocaleString()}`);
  });

  it("keeps 'People housed' equal to the census even when a sold condo lacks residents", () => {
    // A corrupt/hand-edited Modern save: a present, sold condo with no household.
    // The census (residentCount) falls back to the classic 3, so the readout must
    // too — otherwise People housed would undercount total population.
    const sim = Simulation.newGame(3, "modern");
    const a = servedCondo(sim);
    tickUntil(sim, () => a.everOccupied); // a real household (2–5)
    const b = sim.tower.place("condo", 2, C + 24);
    const bare = sim.tower.units.find((u) => u.id === b.unitId)!;
    bare.state = "occupied";
    bare.everOccupied = true;
    bare.residents = undefined; // sold but no household on the record
    const pop = sim.tower.totalPopulation();
    expect(pop).toBe(a.residents! + 3); // census counts the bare condo as 3
    const cell = [...renderToFragment(statsTemplate(sim)).querySelectorAll("span.k")].find((el) => el.textContent === "People housed")!.nextElementSibling!;
    // Locale-proof digit-strip parse (toLocaleString's separator varies).
    expect(Number(cell.textContent!.replace(/\D/g, ""))).toBe(pop); // agrees with the census
  });
});
