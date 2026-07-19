import { describe, it, expect, beforeEach } from "vitest";
import { updateTraffic } from "./trafficHud";
import { TRAFFIC_LABELS, trafficGlyph } from "../engine/traffic";
import type { GameApp } from "../main";

/**
 * Unit coverage for the color-blind-safe traffic HUD. `updateTraffic` reads the
 * live sim's peak hotspot and the app's smoothed tier, then writes four DOM
 * cells. We drive it with a hand-built fake app: `sim.peakCongestionHotspot()`
 * returns a fixed `{ratio, floor}`, and `lastTrafficTier` is read and written in
 * place so we can assert the hysteresis gate from both directions.
 */

/** Build the minimal fake `GameApp` the HUD touches: a stubbed hotspot reading
 *  plus the mutable smoothed-tier field. */
function fakeApp(cong: number, hotspotFloor: number, lastTier: number): GameApp {
  return {
    sim: { peakCongestionHotspot: () => ({ ratio: cong, floor: hotspotFloor }) },
    lastTrafficTier: lastTier,
  } as unknown as GameApp;
}

beforeEach(() => {
  document.body.innerHTML = `
    <div id="traffic">
      <span id="traffic-glyph"></span>
      <span id="traffic-label"></span>
      <span id="traffic-floor"></span>
    </div>`;
});

const glyph = () => document.getElementById("traffic-glyph")!.textContent;
const label = () => document.getElementById("traffic-label")!.textContent;
const floor = () => document.getElementById("traffic-floor")!.textContent;
const wrap = () => document.getElementById("traffic")!;

describe("updateTraffic", () => {
  it("renders Smooth with no floor suffix, no aria hotspot, and no warn class", () => {
    const app = fakeApp(0.2, 42, 0);
    updateTraffic(app);

    expect(app.lastTrafficTier).toBe(0);
    expect(label()).toBe("Smooth");
    expect(label()).toBe(TRAFFIC_LABELS[0]);
    expect(glyph()).toBe(trafficGlyph(0)); // ▮▯▯▯
    // Below Smooth's tier the hotspot floor is suppressed entirely.
    expect(floor()).toBe("");
    expect(wrap().getAttribute("aria-label")).toBe("Traffic: Smooth");
    expect(wrap().classList.contains("traffic-warn")).toBe(false);
  });

  it("shows the floor suffix, hotspot aria, and warn class at a raised tier (>=2)", () => {
    // cong 0.9 -> raw tier 2 (Backed up), and 0.9 >= B[0] + 0.03, so it flips up.
    const app = fakeApp(0.9, 42, 0);
    updateTraffic(app);

    expect(app.lastTrafficTier).toBe(2);
    expect(label()).toBe("Backed up");
    expect(glyph()).toBe(trafficGlyph(2)); // ▮▮▮▯
    expect(floor()).toBe(" · 42F");
    expect(wrap().getAttribute("aria-label")).toBe("Traffic: Backed up, worst on floor 42");
    expect(wrap().classList.contains("traffic-warn")).toBe(true);
  });

  it("shows the floor at tier 1 (Busy) but does NOT set the warn class (tier < 2)", () => {
    // 0.5 -> raw 1, and 0.5 >= B[0] + 0.03 = 0.43, so it flips to Busy.
    const app = fakeApp(0.5, 7, 0);
    updateTraffic(app);

    expect(app.lastTrafficTier).toBe(1);
    expect(label()).toBe("Busy");
    expect(floor()).toBe(" · 7F");
    expect(wrap().getAttribute("aria-label")).toBe("Traffic: Busy, worst on floor 7");
    expect(wrap().classList.contains("traffic-warn")).toBe(false);
  });

  describe("hysteresis", () => {
    it("does not flip UP for a raw tier just over a boundary (needs +0.03 past)", () => {
      // 0.41 -> raw tier 1, but 0.41 < B[0] + 0.03 = 0.43, so the smoothed tier
      // holds at Smooth.
      const app = fakeApp(0.41, 12, 0);
      updateTraffic(app);

      expect(app.lastTrafficTier).toBe(0);
      expect(label()).toBe("Smooth");
      expect(floor()).toBe("");
    });

    it("flips UP once the reading clears the boundary + 0.03", () => {
      const app = fakeApp(0.44, 12, 0);
      updateTraffic(app);

      expect(app.lastTrafficTier).toBe(1);
      expect(label()).toBe("Busy");
    });

    it("does not flip DOWN until the reading drops boundary - 0.03 below", () => {
      // Currently Busy (tier 1). 0.39 -> raw tier 0, but 0.39 > B[0] - 0.03 = 0.37,
      // so it holds at Busy.
      const app = fakeApp(0.39, 5, 1);
      updateTraffic(app);

      expect(app.lastTrafficTier).toBe(1);
      expect(label()).toBe("Busy");
      // Still tier 1, so the hotspot floor keeps showing.
      expect(floor()).toBe(" · 5F");
    });

    it("flips DOWN once the reading falls below boundary - 0.03", () => {
      const app = fakeApp(0.36, 5, 1);
      updateTraffic(app);

      expect(app.lastTrafficTier).toBe(0);
      expect(label()).toBe("Smooth");
      expect(floor()).toBe("");
    });
  });

  it("is a no-op on a second identical pass (does not rewrite unchanged cells)", () => {
    const app = fakeApp(0.9, 42, 2);
    updateTraffic(app);
    // Prove the guarded write branches take their "unchanged" path: clear the
    // aria/warn side effects, run again with the same reading, and confirm they
    // are NOT re-applied because label and floor text did not change.
    wrap().removeAttribute("aria-label");
    wrap().classList.remove("traffic-warn");
    updateTraffic(app);

    expect(app.lastTrafficTier).toBe(2);
    expect(label()).toBe("Backed up");
    expect(floor()).toBe(" · 42F");
    // Untouched because neither label nor floor text changed on this pass.
    expect(wrap().getAttribute("aria-label")).toBeNull();
    expect(wrap().classList.contains("traffic-warn")).toBe(false);
  });

  it("tolerates missing DOM cells without throwing", () => {
    document.body.innerHTML = "";
    const app = fakeApp(0.9, 42, 0);
    expect(() => updateTraffic(app)).not.toThrow();
    // The smoothed tier still advances even with no elements to paint.
    expect(app.lastTrafficTier).toBe(2);
  });
});
