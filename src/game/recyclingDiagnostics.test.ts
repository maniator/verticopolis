import { describe, expect, it } from "vitest";
import { recyclingLinesOf } from "./recyclingDiagnostics";

const text = (lines: ReturnType<typeof recyclingLinesOf>): string => lines.map((l) => l.strings.join("|") + l.values.join("|")).join("\n");

describe("the recycling card lines", () => {
  it("say demand is met at or under capacity", () => {
    const out = text(recyclingLinesOf(2500, 2500, 0.42));
    expect(out).toContain("Fill: |%. Truck collects each morning.</div>42");
    expect(out).toContain("demand met");
    expect(out).not.toContain("color:var(--bad)");
  });

  it("flag a tower over capacity and say what to build", () => {
    const out = text(recyclingLinesOf(2501, 2500, 1));
    expect(out).toContain("Over capacity");
    expect(out).toContain("4★ requires demand met");
    expect(out).toContain("100");
  });
});
