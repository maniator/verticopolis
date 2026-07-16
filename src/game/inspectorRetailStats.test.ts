import { describe, it, expect } from "vitest";
import { html, type TemplateResult } from "lit-html";
import { retailStatsLines } from "./inspector";
import { renderToFragment } from "../ui/testing/litTestUtils";

// Shop verdict baseline = dailyTrafficIncome.shop (2500) / retailSpendPerCustomer.shop (20)
// × TRAFFIC_FACTOR_MEAN (0.8) = 100 customers on an average good day. Folding the
// mean foot-traffic factor into the baseline is what keeps the green band
// reachable (real patronage can never hit the raw 125 ceiling, only ~0.8 of it).
// Yesterday's customer count maps to the verdict bands: <50 red, 50-85 neutral,
// >85 green.
//
// retailStatsLines returns lit `TemplateResult` lines now, so the assertions read
// the rendered DOM (text + the verdict div's color style) rather than an HTML
// string.
const render = (lines: TemplateResult[]): DocumentFragment => renderToFragment(html`${lines}`);
const verdictColor = (frag: DocumentFragment): string | null =>
  [...frag.querySelectorAll("div")]
    .find((d) => /booming|average|Very few|Just opened/.test(d.textContent ?? ""))
    ?.getAttribute("style") ?? null;

describe("retailStatsLines (commercial-venue inspector card)", () => {
  it("returns no lines for a kind with no spend baseline", () => {
    expect(retailStatsLines("office", 10, 10, 100, false)).toEqual([]);
  });

  it("reads 'just opened' until the first full day rolls over", () => {
    // No yesterday yet: the verdict can't judge a partial day, so it stays neutral.
    const frag = render(retailStatsLines("shop", 3, undefined, undefined, false));
    expect(frag.textContent).toContain("Just opened, no data yet.");
    expect(frag.textContent).toContain("Today's patronage: 3 customers");
    expect(frag.textContent).not.toContain("Very few customers");
    // Neutral verdict carries no color.
    expect(verdictColor(frag)).toBeNull();
  });

  it("judges the last COMPLETED day, so a booming shop hovered after midnight never flashes red", () => {
    // Regression for the early-morning red flash: today has just reset to 0 at
    // the rollover, but yesterday was a booming 95 (> 85, near the ideal-day
    // ceiling of 100). The verdict must read the completed yesterday, not the
    // empty today.
    const frag = render(retailStatsLines("shop", 0, 95, 5000, false));
    expect(frag.textContent).toContain("Business is booming.");
    expect(frag.textContent).not.toContain("Very few customers");
    expect(frag.querySelector('div[style*="var(--good)"]')?.textContent).toBe("Business is booming.");
    // Today's running count is still shown honestly (0 so far).
    expect(frag.textContent).toContain("Today's patronage: 0 customers");
  });

  it("reaches the green 'booming' verdict on a real average-good day (baseline is not the raw ceiling)", () => {
    // A venue at full appeal, well placed, on a dry day earns ~100 customers
    // (= 125 raw ceiling × 0.8 mean traffic factor). That is representable by
    // the engine, so the green tier is not dead code: 100 / 100 = 1.0 > 0.85.
    const frag = render(retailStatsLines("shop", 100, 100, 3000, false));
    expect(frag.querySelector('div[style*="var(--good)"]')?.textContent).toBe("Business is booming.");
  });

  it("shows a red 'very few customers' verdict when yesterday genuinely underperformed", () => {
    const frag = render(retailStatsLines("shop", 40, 10, 200, false));
    expect(frag.querySelector('div[style*="var(--bad)"]')?.textContent).toBe("Very few customers.");
  });

  it("shows a neutral 'business is average' verdict in the middle band", () => {
    const frag = render(retailStatsLines("shop", 100, 70, 3000, false));
    expect(frag.textContent).toContain("Business is average.");
    // Neutral verdicts carry no color style anywhere in the block.
    expect(verdictColor(frag)).toBeNull();
    expect(frag.querySelector('[style*="var(--bad)"]')).toBeNull();
    expect(frag.querySelector('[style*="var(--good)"]')).toBeNull();
  });

  it("adds the rain line only when it is raining, and shows yesterday's profit", () => {
    // Derive the expected thousands separator from the runtime locale so the
    // assertion doesn't hard-code en-US formatting.
    const profit = `Yesterday's profit: $${(3210).toLocaleString()}.`;
    const dry = render(retailStatsLines("shop", 100, 70, 3210, false));
    expect(dry.textContent).toContain(profit);
    expect(dry.textContent).not.toContain("Rain might cause fewer customers.");
    const wet = render(retailStatsLines("shop", 100, 70, 3210, true));
    expect(wet.textContent).toContain("Rain might cause fewer customers.");
  });

  it("pluralizes the customer count and clamps a forged negative to zero", () => {
    // Match the singular without depending on the trailing space before the bar
    // span: the negative lookahead pins "customer" (not "customers").
    expect(render(retailStatsLines("shop", 1, 70, 0, false)).textContent).toMatch(
      /Today's patronage: 1 customer(?!s)/,
    );
    expect(render(retailStatsLines("shop", -5, 70, 0, false)).textContent).toContain(
      "Today's patronage: 0 customers",
    );
  });

  it("fills the progress bar proportionally to today's count against the baseline", () => {
    // 50 of the 100-customer baseline → the evalbar inner span is 50% wide.
    const frag = render(retailStatsLines("shop", 50, 70, 3000, false));
    const bar = frag.querySelector<HTMLElement>(".evalbar > span");
    expect(bar?.getAttribute("style")).toBe("width:50%");
  });

  it("shows the venue's local demand share as its own line, leaving the verdict on the stable baseline", () => {
    // The demand line reports the venue's share of local demand. The verdict keeps
    // a STABLE full-appeal baseline (100 customers), so 38 of that reads red, and
    // the demand line explains the red as thin local demand rather than the
    // baseline shrinking to hide it (which would misgrade yesterday against
    // today's demand).
    const frag = render(retailStatsLines("shop", 38, 38, 3000, false, 0.4));
    expect(frag.textContent).toContain("Local demand: 40% of capacity.");
    expect(frag.querySelector('div[style*="var(--bad)"]')?.textContent).toBe("Very few customers.");
  });

  it("reads a fully-subscribed venue as 100% local demand", () => {
    const frag = render(retailStatsLines("shop", 90, 90, 5000, false, 1));
    expect(frag.textContent).toContain("Local demand: 100% of capacity.");
  });

  it("reports zero local demand for a reachable venue with no local population", () => {
    // demandFraction 0 (in the map, but the pool is empty): the venue is present
    // and trading nothing, so the line names the cause honestly.
    const frag = render(retailStatsLines("shop", 0, 0, 0, false, 0));
    expect(frag.textContent).toContain("Local demand: 0% of capacity.");
  });

  it("omits the local-demand line when the fraction is unknown (venue absent from the demand map)", () => {
    // undefined (not 0): the venue is not in the current demand map (stranded, or
    // not yet in this hour's memo). Omit the line rather than fabricate a false 0%,
    // and leave the rest of the card (verdict from the stable baseline) intact.
    const frag = render(retailStatsLines("shop", 40, 70, 3000, false, undefined));
    expect(frag.textContent).not.toContain("Local demand:");
    expect(frag.textContent).toContain("Business is average."); // 70 / 100 baseline = 0.7, neutral
  });

  // Phase C: Modern-only under-served / over-built advice, keyed on the raw share.
  it("Modern advice names an under-served tower when demand outstrips capacity", () => {
    const frag = render(retailStatsLines("shop", 100, 90, 5000, false, 1, 1.5, true));
    expect(frag.textContent).toContain("another venue would still sell");
  });

  it("Modern advice names an over-built tower when capacity outstrips demand", () => {
    const frag = render(retailStatsLines("shop", 20, 20, 500, false, 0.3, 0.3, true));
    expect(frag.textContent).toContain("hold off on new venues");
  });

  it("Modern advice stays silent in the healthy demand band", () => {
    const frag = render(retailStatsLines("shop", 70, 70, 3000, false, 0.7, 0.7, true));
    expect(frag.textContent).not.toContain("would still sell");
    expect(frag.textContent).not.toContain("hold off on new venues");
  });

  it("advice keys on the raw share, not the displayed fraction (Modern over-built)", () => {
    // Decouple the two arguments to pin the routing contract: pass a displayed
    // fraction of 60% (which sits in the silent healthy band, so advice keyed on
    // the fraction would stay quiet) alongside a raw share of 0.2 (over-built). The
    // over-built line must still fire, proving the advice reads `share`, not the
    // floored/displayed fraction. (Physically the floor is 0.25, below the 0.5
    // over-built cut, so a real map never separates the two across this threshold;
    // this guards the function's contract regardless, so a future floor change
    // cannot silently reroute the advice onto the wrong number.)
    const frag = render(retailStatsLines("shop", 60, 60, 1200, false, 0.6, 0.2, true));
    expect(frag.textContent).toContain("Local demand: 60% of capacity.");
    expect(frag.textContent).toContain("hold off on new venues");
  });

  it("Classic shows the demand number but no advice", () => {
    const frag = render(retailStatsLines("shop", 20, 20, 500, false, 0.3, 0.3, false));
    expect(frag.textContent).toContain("Local demand: 30% of capacity.");
    expect(frag.textContent).not.toContain("hold off on new venues");
    expect(frag.textContent).not.toContain("would still sell");
  });
});
