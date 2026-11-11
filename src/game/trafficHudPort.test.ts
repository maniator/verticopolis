import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { refreshTraffic, updateTraffic } from "./trafficHud";
import { PortCodes } from "../simport/portCodes";
import { mockPort } from "../tests/portKit/mockPort";
import type { GameApp } from "../main";

/**
 * The traffic chip on the engine port: the port answers at once, so it draws
 * every answer in the order it was asked (its hysteresis steps from one answer
 * to the next) and sends a failed answer to the frame error log without
 * throwing. The drawing itself is pinned in `trafficHud.test.ts`, and the
 * chip on the Rust engine's own answer in `trafficHud.integration.test.ts`.
 */

const codes = new PortCodes(mockPort());

/** A fake app whose engine port hands out the records a test controls. */
function fakeApp(hotspot: () => Float64Array) {
  return {
    enginePort: { hotspot: vi.fn(hotspot) },
    portCodes: codes,
    lastTrafficTier: 0,
    frameErrors: [] as Array<{ at: string; message: string }>,
  };
}

const label = () => document.getElementById("traffic-label")!.textContent;
const floor = () => document.getElementById("traffic-floor")!.textContent;

beforeEach(() => {
  document.body.innerHTML = `
    <div id="traffic">
      <span id="traffic-glyph"></span>
      <span id="traffic-label"></span>
      <span id="traffic-floor"></span>
    </div>`;
});

afterEach(() => vi.restoreAllMocks());

describe("updateTraffic on the engine port", () => {
  it("asks the port once per refresh, and reads NaN as no hotspot floor", () => {
    const app = fakeApp(() => Float64Array.of(0.2, NaN));
    updateTraffic(app as unknown as GameApp);
    expect(app.enginePort.hotspot).toHaveBeenCalledOnce();
    expect(label()).toBe("Smooth");
  });

  it("draws every answer in the order it was asked, stepping the hysteresis through each", () => {
    // 0.42 is not past Busy's margin (0.43) from Smooth, 0.9 is, and 0.78 then
    // holds Backed up, since it is not down to 0.77: a skipped middle answer
    // would show Busy.
    const answers = [0.42, 0.9, 0.78];
    const app = fakeApp(() => Float64Array.of(answers.shift()!, 7));
    const tiers: number[] = [];
    for (let i = 0; i < 3; i++) {
      updateTraffic(app as unknown as GameApp);
      tiers.push(app.lastTrafficTier);
    }
    expect(tiers).toEqual([0, 2, 2]);
    expect([label(), floor()]).toEqual(["Backed up", " · 7F"]);
  });

  it("logs a port that throws to the frame error log and still returns", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = fakeApp(() => {
      throw new Error("port down");
    });
    expect(updateTraffic(app as unknown as GameApp)).toBeUndefined();
    expect(app.frameErrors.map((e) => e.message.split("\n")[0])).toEqual(["[traffic] port down"]);
    expect(consoleSpy).toHaveBeenCalledExactlyOnceWith("[tick] traffic error, continuing:", expect.any(Error));
    expect(label()).toBe("");
  });

  it("logs a failed draw, and the tooling's refresh throws it", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(document, "getElementById").mockImplementation(() => {
      throw new Error("draw failed");
    });
    const app = fakeApp(() => Float64Array.of(0.5, 7));
    expect(() => refreshTraffic(app as unknown as GameApp)).toThrow("draw failed");
    updateTraffic(app as unknown as GameApp);
    expect(app.frameErrors.map((e) => e.message.split("\n")[0])).toEqual(["[traffic] draw failed"]);
  });
});
