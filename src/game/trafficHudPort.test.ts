import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { refreshTraffic, updateTraffic } from "./trafficHud";
import type { GameApp } from "../main";

/**
 * The traffic chip over the renderer's queue projection (the engine's
 * `queueView`): it reads the projection once per refresh, walks a projection
 * it has already walked only once, draws every read in the order it was made
 * (its hysteresis steps from one to the next) and sends a failed read to the
 * frame error log without throwing. The drawing itself is pinned in
 * `trafficHud.test.ts`, and the chip on the Rust engine's own lines in
 * `trafficHud.integration.test.ts`.
 */

type Landings = Map<number, Map<number, { count: number; tier: 0 | 1 | 2 }>>;

/** One fed-up line of `count` riders at `floor` for shaft 7. */
const line = (count: number, floor = 7): Landings => new Map([[7, new Map([[floor, { count, tier: 2 as const }]])]]);

/** A fake app whose projection hands out the landings a test controls. */
function fakeApp(landings: () => Landings) {
  return {
    engine: { sim: { tower: {}, crowd: { queueView: vi.fn(() => ({ landings: landings(), boarded: new Map() })) } } },
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

describe("updateTraffic on the queue projection", () => {
  it("reads the projection once per refresh", () => {
    const app = fakeApp(() => new Map());
    updateTraffic(app as unknown as GameApp);
    expect(app.engine.sim.crowd.queueView).toHaveBeenCalledExactlyOnceWith();
    expect(label()).toBe("Smooth");
  });

  it("walks one projection once, however often it is drawn", () => {
    /** The landings, counting the walks over their shafts. */
    class Counted extends Map<number, Map<number, { count: number; tier: 0 | 1 | 2 }>> {
      walks = 0;
      override [Symbol.iterator]() {
        this.walks++;
        return super[Symbol.iterator]();
      }
    }
    const kept = new Counted(line(25, 9));
    kept.walks = 0;
    const app = fakeApp(() => kept);
    for (let i = 0; i < 3; i++) updateTraffic(app as unknown as GameApp);
    expect(kept.walks).toBe(1);
    expect([label(), floor()]).toEqual(["Backed up", " · 9F"]);
  });

  it("draws every read in the order it was made, stepping the hysteresis through each", () => {
    // 4 is not Busy, 25 is Backed up, and 16 then holds Backed up, since it is
    // not below three quarters of its edge (15): a skipped middle read would
    // show Busy.
    const answers = [4, 25, 16];
    const app = fakeApp(() => line(answers.shift()!));
    const tiers: number[] = [];
    for (let i = 0; i < 3; i++) {
      updateTraffic(app as unknown as GameApp);
      tiers.push(app.lastTrafficTier);
    }
    expect(tiers).toEqual([0, 2, 2]);
    expect([label(), floor()]).toEqual(["Backed up", " · 7F"]);
  });

  it("logs a projection that throws to the frame error log and still returns", () => {
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
    const app = fakeApp(() => line(8));
    expect(() => refreshTraffic(app as unknown as GameApp)).toThrow("draw failed");
    updateTraffic(app as unknown as GameApp);
    expect(app.frameErrors.map((e) => e.message.split("\n")[0])).toEqual(["[traffic] draw failed"]);
  });
});
