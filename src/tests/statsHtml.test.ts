import { describe, it, expect } from "vitest";
import { Simulation } from "../engine/Simulation";
import { buildIncomeHtml } from "../ui/statsHtml";

describe("buildIncomeHtml (income breakdown)", () => {
  it("Net sums only the shown rows, excluding hidden sub-dollar lines", () => {
    const sim = Simulation.newGame(91);
    // One clearly-shown line and two sub-$0.50/day lines that the row filter
    // hides (a realistic case: a small annual-ish charge amortized over 90 days).
    sim.recordMoney("offices", 1000);
    sim.recordMoney("food", 0.3); // rounds to $0 → hidden row
    sim.recordMoney("retail", 0.3); // rounds to $0 → hidden row

    const html = buildIncomeHtml(sim);

    // The big line shows; the sub-dollar lines are omitted from the list.
    expect(html).toContain("Offices");
    expect(html).not.toContain("Food");
    expect(html).not.toContain("Retail");

    // Net reflects only the shown rows ($1,000), not $1,000.6 → $1,001. The old
    // code summed every category and would render the inconsistent $1,001.
    // (Match the thousands separator loosely — toLocaleString is locale-driven.)
    expect(html).toContain("Net");
    expect(html).toMatch(/\$1[,.\u00a0\u202f ]?000\/day/);
    expect(html).not.toContain("$1,001");
  });

  it("renders nothing before any money has been recorded", () => {
    const sim = Simulation.newGame(92);
    expect(buildIncomeHtml(sim)).toBe("");
  });
});
