import { describe, it, expect, beforeEach } from "vitest";
import { refreshTraffic } from "./trafficHud";
import { TRAFFIC_LABELS } from "@verticopolis/components/presentation/traffic";
import type { GameApp } from "../main";

/**
 * Unit coverage for the color-blind-safe traffic HUD. `refreshTraffic` (the
 * refresh `updateTraffic` wraps, minus its catch, so a failed draw fails the
 * test) reads the renderer's queue projection (the engine's `queueView`),
 * then draws the worst line with the app's smoothed tier into four DOM cells.
 * The fake app's `queueView` is a spy answering one landing, and
 * `lastTrafficTier` is read and written in place so we can assert the
 * hysteresis gate from both directions. The ordering and failure cases are in
 * `trafficHudPort.test.ts`.
 */

/** Build the minimal fake `GameApp` the HUD touches: a queue projection with
 *  one line of `count` riders at `lineFloor`, all fed up (tier 2) unless
 *  `waitTier` says otherwise, the mutable smoothed-tier field and the frame
 *  error log. */
function fakeApp(count: number, lineFloor: number, lastTier: number, waitTier: 0 | 1 | 2 = 2): GameApp {
  const landings = new Map([[7, new Map([[lineFloor, { count, tier: waitTier }]])]]);
  const app = {
    engine: { sim: { tower: {}, crowd: { queueView: () => ({ landings, boarded: new Map() }) } } },
    lastTrafficTier: lastTier,
    frameErrors: [],
  };
  return app as unknown as GameApp;
}

beforeEach(() => {
  document.body.innerHTML = `
    <div id="traffic">
      <span id="traffic-glyph"></span>
      <span id="traffic-label"></span>
      <span id="traffic-floor"></span>
    </div>`;
});

const level = () => document.getElementById("traffic-glyph")!.dataset.level;
const label = () => document.getElementById("traffic-label")!.textContent;
const floor = () => document.getElementById("traffic-floor")!.textContent;
const wrap = () => document.getElementById("traffic")!;

describe("refreshTraffic", () => {
  it("renders Smooth with no floor suffix, no aria floor, and no warn class", () => {
    const app = fakeApp(4, 42, 0);
    refreshTraffic(app);

    expect(app.lastTrafficTier).toBe(0);
    expect(label()).toBe("Smooth");
    expect(label()).toBe(TRAFFIC_LABELS[0]);
    expect(level()).toBe("smooth"); // the stylesheet fills one bar
    // At Smooth the line's floor is suppressed entirely.
    expect(floor()).toBe("");
    expect(wrap().getAttribute("aria-label")).toBe("Traffic: Smooth");
    expect(wrap().classList.contains("traffic-warn")).toBe(false);
  });

  it("shows the line's floor, its aria, and the warn class at a raised tier (>=2)", () => {
    // 25 fed-up riders -> Backed up (20 up), straight from Smooth.
    const app = fakeApp(25, 42, 0);
    refreshTraffic(app);

    expect(app.lastTrafficTier).toBe(2);
    expect(label()).toBe("Backed up");
    expect(level()).toBe("backed-up"); // the stylesheet fills three bars
    expect(floor()).toBe(" · 42F");
    expect(wrap().getAttribute("aria-label")).toBe("Traffic: Backed up, worst line on floor 42");
    expect(wrap().classList.contains("traffic-warn")).toBe(true);
  });

  it("names the ground lobby as 1F (the boarding-jam case)", () => {
    const app = fakeApp(25, 1, 0);
    refreshTraffic(app);

    expect(label()).toBe("Backed up");
    expect(floor()).toBe(" · 1F");
    expect(wrap().getAttribute("aria-label")).toBe("Traffic: Backed up, worst line on floor 1");
  });

  it("formats a basement line with the B-grammar, never 0F/-1F", () => {
    // A line at a basement landing: floor 0 is B1, floor -1 is B2. The visible
    // tag and the spoken aria both use the basement grammar, matching the ruler.
    const b1 = fakeApp(25, 0, 0);
    refreshTraffic(b1);
    expect(floor()).toBe(" · B1");
    expect(wrap().getAttribute("aria-label")).toBe("Traffic: Backed up, worst line on floor B1");

    document.getElementById("traffic-floor")!.textContent = "";
    const b2 = fakeApp(25, -1, 2);
    refreshTraffic(b2);
    expect(floor()).toBe(" · B2");
    expect(wrap().getAttribute("aria-label")).toBe("Traffic: Backed up, worst line on floor B2");
  });

  it("shows the floor at tier 1 (Busy) but does NOT set the warn class (tier < 2)", () => {
    // 8 fed-up riders -> Busy (5 up).
    const app = fakeApp(8, 7, 0);
    refreshTraffic(app);

    expect(app.lastTrafficTier).toBe(1);
    expect(label()).toBe("Busy");
    expect(floor()).toBe(" · 7F");
    expect(wrap().getAttribute("aria-label")).toBe("Traffic: Busy, worst line on floor 7");
    expect(wrap().classList.contains("traffic-warn")).toBe(false);
  });

  describe("hysteresis", () => {
    it("reads a car's worth of fresh riders as Smooth and a fresh crowd of 300 as Busy", () => {
      const car = fakeApp(21, 12, 0, 0);
      refreshTraffic(car);
      expect(car.lastTrafficTier).toBe(0);
      expect(label()).toBe("Smooth");
      expect(floor()).toBe("");

      const crowd = fakeApp(300, 12, 0, 0);
      refreshTraffic(crowd);
      expect(crowd.lastTrafficTier).toBe(1);
      expect(label()).toBe("Busy");
      expect(floor()).toBe(" · 12F");
    });

    it("counts an impatient line at a quarter: 40 riders read Busy, 80 Backed up", () => {
      const busy = fakeApp(40, 12, 0, 1);
      refreshTraffic(busy);
      expect(busy.lastTrafficTier).toBe(1);
      const backed = fakeApp(80, 12, 0, 1);
      refreshTraffic(backed);
      expect(backed.lastTrafficTier).toBe(2);
    });

    it("does not flip DOWN while the line is at three quarters of the edge or more", () => {
      // Backed up (tier 2), and 15 is three quarters of its edge (20): it holds.
      const app = fakeApp(15, 5, 2);
      refreshTraffic(app);

      expect(app.lastTrafficTier).toBe(2);
      expect(label()).toBe("Backed up");
      // Still raised, so the line's floor keeps showing.
      expect(floor()).toBe(" · 5F");
    });

    it("flips DOWN once the line falls below three quarters of the edge", () => {
      const app = fakeApp(14, 5, 2);
      refreshTraffic(app);

      expect(app.lastTrafficTier).toBe(1);
      expect(label()).toBe("Busy");
    });
  });

  it("is a no-op on a second identical pass (does not rewrite unchanged cells)", () => {
    const app = fakeApp(25, 42, 2);
    refreshTraffic(app);
    // Prove the guarded write branches take their "unchanged" path: clear the
    // aria/warn side effects, run again with the same reading, and confirm they
    // are NOT re-applied because label and floor text did not change.
    wrap().removeAttribute("aria-label");
    wrap().classList.remove("traffic-warn");
    refreshTraffic(app);

    expect(app.lastTrafficTier).toBe(2);
    expect(label()).toBe("Backed up");
    expect(floor()).toBe(" · 42F");
    // Untouched because neither label nor floor text changed on this pass.
    expect(wrap().getAttribute("aria-label")).toBeNull();
    expect(wrap().classList.contains("traffic-warn")).toBe(false);
  });

  it("tolerates missing DOM cells without throwing", () => {
    document.body.innerHTML = "";
    const app = fakeApp(25, 42, 0);
    // The rejecting refresh: a throw in the draw would surface here.
    expect(() => refreshTraffic(app)).not.toThrow();
    // The smoothed tier still advances even with no elements to paint.
    expect(app.lastTrafficTier).toBe(2);
  });
});
