import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { refreshTraffic, updateTraffic } from "./trafficHud";
import { Simulation } from "../engine/Simulation";
import { GRID } from "../engine/facilities";
import { TRAFFIC_LABELS, trafficTier } from "../engine/traffic";
import { TsEngine } from "../engine/port/tsEngine";
import { PortCodes } from "../simport/portCodes";
import type { GameApp } from "../main";

/**
 * The traffic chip on the engine port: the port answers at once, so it draws
 * every answer in the order it was asked (its hysteresis steps from one answer
 * to the next) and sends a failed answer to the frame error log without
 * throwing. The drawing itself is pinned in `trafficHud.test.ts`.
 */

const codes = new PortCodes(new TsEngine(Simulation.newGame(1)));

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

  it("draws the real engine's answer through the TypeScript engine", () => {
    // A lobby-served bank with one weak car under a heavy office stack: the
    // lobby is the hotspot, and the jam is past the hysteresis margin.
    const sim = Simulation.newGame(7);
    sim.simModel = "v2";
    sim.money = 1e12;
    for (let x = 0; x < GRID.width; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    for (let f = 2; f <= 10; f++) for (let x = 0; x < GRID.width; x++) expect(sim.tower.place("floor", f, x).ok).toBe(true);
    expect(sim.buildTransport("elevatorStandard", GRID.width - 6, 1, 10).ok).toBe(true);
    const bank = sim.tower.transports[0];
    sim.tower.setCars(bank.id, 1);
    let offices = 0;
    for (let f = 2; f <= 10; f++) {
      for (let x = 0; x + 9 <= GRID.width; x += 9) {
        const r = sim.tower.place("office", f, x);
        expect(r.ok).toBe(true);
        sim.tower.getUnit(r.unitId!)!.state = "occupied";
        offices++;
      }
    }
    // The offices fill floors 2 to 10 beside the shaft, which stops on every one.
    expect(offices).toBe(9 * Math.floor(GRID.width / 9));
    expect(sim.tower.stopsOf(bank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect([...sim.tower.servedFloors()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    sim.tick(1);
    const app = { enginePort: new TsEngine(sim), portCodes: codes, lastTrafficTier: 0, frameErrors: [] };
    updateTraffic(app as unknown as GameApp);
    const hot = sim.peakCongestionHotspot();
    expect(hot.floor).toBe(1);
    expect(app.lastTrafficTier).toBe(trafficTier(hot.ratio));
    expect(app.lastTrafficTier).toBeGreaterThanOrEqual(2);
    expect([label(), floor(), app.frameErrors]).toEqual([TRAFFIC_LABELS[app.lastTrafficTier], " · 1F", []]);
  });
});
