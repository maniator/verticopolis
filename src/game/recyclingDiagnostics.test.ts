import { describe, expect, it } from "vitest";
import { recyclingLinesOf } from "./recyclingDiagnostics";

/** A `recyclingCard` answer: population, capacity, fill, demand met (1 or 0). */
const card = (pop: number, cap: number, fill: number, met: boolean): Float64Array => Float64Array.of(pop, cap, fill, met ? 1 : 0);
const text = (lines: ReturnType<typeof recyclingLinesOf>): string => lines.map((l) => l.strings.join("|") + l.values.join("|")).join("\n");

describe("the recycling card lines", () => {
  it("say demand is met at or under capacity", () => {
    const out = text(recyclingLinesOf(card(2500, 2500, 0.42, true), true));
    expect(out).toContain("Fill: |%. Truck collects each morning.</div>42");
    expect(out).toContain("demand met");
    expect(out).not.toContain("color:var(--bad)");
  });

  it("flag a tower over capacity and say what to build", () => {
    const out = text(recyclingLinesOf(card(2501, 2500, 1, false), true));
    expect(out).toContain("Over capacity");
    expect(out).toContain("4★ requires demand met");
    expect(out).toContain("100");
  });

  it("say what to build only where the mode advises fixes (#549)", () => {
    expect(text(recyclingLinesOf(card(2501, 2500, 1, false), true))).toContain("Build another center");
    const classic = text(recyclingLinesOf(card(2501, 2500, 1, false), false));
    expect(classic).not.toContain("Build another center");
    expect(classic).toContain("Tenant ratings fall while trash piles up, and 4★ requires demand met.");
  });

  it("follow the engine's verdict even when the numbers disagree with it", () => {
    expect(text(recyclingLinesOf(card(9000, 2500, 1, true), true))).toContain("demand met");
    expect(text(recyclingLinesOf(card(100, 2500, 0.1, false), true))).toContain("Over capacity");
  });
});
