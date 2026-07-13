import { describe, it, expect } from "vitest";
import { heatColor, HEAT_STOPS } from "./TowerEngine";
import { congestionSeverity, CONGESTION_CHURN, CONGESTION_GRIDLOCK } from "../../engine/Simulation";

const rgba = (s: readonly number[]) => `rgba(${s[0]},${s[1]},${s[2]},0.4)`;

describe("heatColor (overlay ramp) + the amber=churn anchor", () => {
  it("hits the exact palette stops at the segment boundaries", () => {
    expect(heatColor(0)).toBe(rgba(HEAT_STOPS[0])); // green
    expect(heatColor(1)).toBe(rgba(HEAT_STOPS[3])); // red — no index overflow at s=1
    expect(heatColor(1 / 3)).toBe(rgba(HEAT_STOPS[1])); // chartreuse
    expect(heatColor(2 / 3)).toBe(rgba(HEAT_STOPS[2])); // amber
  });

  it("clamps out-of-range and non-finite severity instead of throwing", () => {
    expect(heatColor(-1)).toBe(rgba(HEAT_STOPS[0])); // green floor
    expect(heatColor(2)).toBe(rgba(HEAT_STOPS[3])); // red ceiling
    // A poisoned severity must degrade, never throw on the draw path.
    expect(() => heatColor(NaN)).not.toThrow();
  });

  it("LOCKS the cross-module invariant: churn renders amber, gridlock renders red", () => {
    // This is the whole point of the fix — the color must not contradict the
    // sim. It holds only while the palette keeps amber at position ⅔ (a 4-stop
    // ramp); if a stop is added/removed, congestionSeverity(churn) no longer
    // lands on amber and this fails loudly instead of silently shipping a
    // regression.
    expect(heatColor(congestionSeverity(CONGESTION_CHURN))).toBe(rgba(HEAT_STOPS[2])); // amber
    expect(heatColor(congestionSeverity(CONGESTION_GRIDLOCK))).toBe(rgba(HEAT_STOPS[3])); // red
    expect(HEAT_STOPS.length).toBe(4); // the anchor's structural precondition
  });
});
