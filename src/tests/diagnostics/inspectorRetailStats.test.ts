import { describe, it, expect } from "vitest";
import { html } from "lit-html";
import { retailDisplayLines } from "../../game/portServiceDiagnostics";
import type { ServiceDiagnosticFacts } from "../../simport/enginePort";
import { renderToFragment } from "../../ui/testing/litTestUtils";
import { groupDigits } from "../../ui/format";

/**
 * The commercial venue's patronage block on the inspector card. The engine
 * decides the verdict, the bar width, the local demand and the advice (the
 * bands are held by `diagnostics::service` tests in engine-rs); the card only
 * words those facts, and these cases hold the wording: each phrase once, one
 * progress bar, the verdict's color, the plural and the optional lines.
 */

type RetailFacts = ServiceDiagnosticFacts["retail"];

/** A low-tier shop with every optional line present. */
const FULL: RetailFacts = {
  active: true, today: 38, barWidth: 38, tier: "low",
  localDemandPct: 30, advice: "overBuilt", profitYest: 500, rainy: true,
};

const render = (facts: RetailFacts): DocumentFragment => renderToFragment(html`${retailDisplayLines(facts)}`);
const VERDICTS = /^(Business is booming\.|Business is average\.|Very few customers\.|Just opened, no data yet\.)$/;
const verdictOf = (frag: DocumentFragment) => [...frag.querySelectorAll("div")].find((d) => VERDICTS.test(d.textContent ?? ""));

describe("retailDisplayLines (commercial-venue inspector card)", () => {
  it("writes each line once, with one progress bar", () => {
    const frag = render(FULL);
    expect(frag.querySelectorAll(".evalbar")).toHaveLength(1);
    for (const phrase of [
      "Today's patronage:", "Local demand:", "Very few customers.",
      "Yesterday's profit:", "Rain might cause fewer customers.",
      "hold off on new venues",
    ]) {
      expect(frag.textContent!.split(phrase), phrase).toHaveLength(2);
    }
  });

  it("writes no block for a venue the engine marks inactive", () => {
    expect(retailDisplayLines({ ...FULL, active: false })).toEqual([]);
  });

  it("reads 'just opened' with no local demand or profit until the first full day", () => {
    const frag = render({ ...FULL, tier: "noData", localDemandPct: null, advice: "none", profitYest: null });
    expect(verdictOf(frag)?.textContent).toBe("Just opened, no data yet.");
    expect(verdictOf(frag)?.getAttribute("style")).toBeNull();
    expect(frag.textContent).not.toContain("Local demand:");
    expect(frag.textContent).not.toContain("Yesterday's profit:");
  });

  it("colors the low verdict bad and the booming one good, and leaves average plain", () => {
    expect(verdictOf(render({ ...FULL, tier: "low" }))?.getAttribute("style")).toContain("var(--bad)");
    expect(verdictOf(render({ ...FULL, tier: "booming" }))?.getAttribute("style")).toContain("var(--good)");
    const average = render({ ...FULL, tier: "average" });
    expect(verdictOf(average)?.textContent).toBe("Business is average.");
    expect(average.querySelector('[style*="var(--bad)"], [style*="var(--good)"]')).toBeNull();
  });

  it("adds the rain line only when it is raining, and groups yesterday's profit", () => {
    const profit = `Yesterday's profit: $${groupDigits(3210)}.`;
    const dry = render({ ...FULL, profitYest: 3210, rainy: false });
    expect(dry.textContent).toContain(profit);
    expect(dry.textContent).not.toContain("Rain might cause fewer customers.");
    expect(render({ ...FULL, profitYest: 3210, rainy: true }).textContent).toContain("Rain might cause fewer customers.");
  });

  it("pluralizes the customer count", () => {
    expect(render({ ...FULL, today: 1 }).textContent).toMatch(/Today's patronage: 1 customer(?!s)/);
    expect(render({ ...FULL, today: 0 }).textContent).toContain("Today's patronage: 0 customers");
  });

  it("fills the progress bar to the engine's width", () => {
    const bar = render({ ...FULL, barWidth: 50 }).querySelector<HTMLElement>(".evalbar > span");
    expect(bar?.getAttribute("style")).toBe("width:50%");
  });

  it("states the local demand as given, and the advice only when the engine gives one", () => {
    expect(render({ ...FULL, localDemandPct: 100, advice: "none" }).textContent).toContain("Local demand: 100% of capacity.");
    const quiet = render({ ...FULL, localDemandPct: 0, advice: "none" });
    expect(quiet.textContent).toContain("Local demand: 0% of capacity.");
    expect(quiet.textContent).not.toContain("hold off on new venues");
    expect(quiet.textContent).not.toContain("another venue would still sell");
    expect(render({ ...FULL, advice: "underServed" }).textContent).toContain("another venue would still sell");
  });
});
