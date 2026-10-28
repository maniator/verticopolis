import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { refreshTraffic, updateTraffic } from "./trafficHud";
import { Simulation } from "../engine/Simulation";
import { GRID } from "../engine/facilities";
import { TRAFFIC_LABELS, trafficTier } from "../engine/traffic";
import { createTsSim } from "../simport/tsSim";
import type { CongestionHotspot } from "../simport/panels";
import type { GameApp } from "../main";

/**
 * The traffic chip on the port: it draws every answer in the order it was
 * asked (its hysteresis steps from one answer to the next), drops an answer
 * that lands after a newer question has settled and one about a tower that
 * was replaced while it was out, and sends a failed answer to the frame error
 * log without rejecting. The drawing itself is pinned in `trafficHud.test.ts`.
 */

interface Deferred {
  answer: Promise<CongestionHotspot>;
  resolve: (hot: CongestionHotspot) => void;
  reject: (e: unknown) => void;
}

function deferred(): Deferred {
  let resolve!: Deferred["resolve"];
  let reject!: Deferred["reject"];
  const answer = new Promise<CongestionHotspot>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { answer, resolve, reject };
}

/** A fake app whose port hands out the answers a test controls. */
function fakeApp(query: () => Promise<CongestionHotspot>) {
  return {
    sim: {},
    port: { query: vi.fn(query) },
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

describe("updateTraffic on the port", () => {
  it("asks the port once per refresh", async () => {
    const app = fakeApp(() => Promise.resolve({ ratio: 0.2, floor: null }));
    await updateTraffic(app as unknown as GameApp);
    expect(app.port.query).toHaveBeenCalledExactlyOnceWith({ op: "peakCongestionHotspot" });
    expect(label()).toBe("Smooth");
  });

  it("draws every answer in the order it was asked, stepping the hysteresis through each", async () => {
    // Three questions out at once, as a stepped clock asks them. 0.42 is not
    // past Busy's margin (0.43) from Smooth, 0.9 is, and 0.78 then holds Backed
    // up, since it is not down to 0.77: a skipped middle answer would show Busy.
    const out = [deferred(), deferred(), deferred()];
    const asks = [...out];
    const app = fakeApp(() => asks.shift()!.answer);
    const refreshes = [0, 1, 2].map(() => updateTraffic(app as unknown as GameApp));
    const tiers: number[] = [];
    for (const [i, ratio] of [0.42, 0.9, 0.78].entries()) {
      out[i].resolve({ ratio, floor: 7 });
      await refreshes[i];
      tiers.push(app.lastTrafficTier);
    }
    expect(tiers).toEqual([0, 2, 2]);
    expect([label(), floor()]).toEqual(["Backed up", " · 7F"]);
  });

  it("drops an older answer that lands after a newer one was drawn", async () => {
    const older = deferred();
    const newer = deferred();
    const asks = [older, newer];
    const app = fakeApp(() => asks.shift()!.answer);
    const first = updateTraffic(app as unknown as GameApp);
    const second = updateTraffic(app as unknown as GameApp);
    newer.resolve({ ratio: 0.5, floor: 7 });
    await second;
    older.resolve({ ratio: 0.9, floor: 42 });
    await first;
    expect([label(), floor(), app.lastTrafficTier]).toEqual(["Busy", " · 7F", 1]);
  });

  it("draws nothing when another tower was loaded while the answer was out", async () => {
    const out = deferred();
    const app = fakeApp(() => out.answer);
    const refresh = updateTraffic(app as unknown as GameApp);
    app.sim = {};
    out.resolve({ ratio: 0.9, floor: 42 });
    await refresh;
    expect(label()).toBe("");
    expect(app.lastTrafficTier).toBe(0);
  });

  it("logs a failed answer to the frame error log and still resolves", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = fakeApp(() => Promise.reject(new Error("no hotspot")));
    await expect(updateTraffic(app as unknown as GameApp)).resolves.toBeUndefined();
    expect(app.frameErrors.map((e) => e.message.split("\n")[0])).toEqual(["[traffic] no hotspot"]);
    expect(consoleSpy).toHaveBeenCalledExactlyOnceWith("[tick] traffic error, continuing:", expect.any(Error));
    expect(label()).toBe("");
  });

  it("logs a port that throws as it is asked the same way", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const app = fakeApp(() => {
      throw new Error("port down");
    });
    await expect(updateTraffic(app as unknown as GameApp)).resolves.toBeUndefined();
    expect(app.frameErrors.map((e) => e.message.split("\n")[0])).toEqual(["[traffic] port down"]);
  });

  it("logs a failed draw, and the tooling's refresh rejects with it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(document, "getElementById").mockImplementation(() => {
      throw new Error("draw failed");
    });
    const app = fakeApp(() => Promise.resolve({ ratio: 0.5, floor: 7 }));
    await expect(refreshTraffic(app as unknown as GameApp)).rejects.toThrow("draw failed");
    await expect(updateTraffic(app as unknown as GameApp)).resolves.toBeUndefined();
    expect(app.frameErrors.map((e) => e.message.split("\n")[0])).toEqual(["[traffic] draw failed"]);
  });

  it("drops a failure that lands after a newer answer was drawn", async () => {
    const older = deferred();
    const newer = deferred();
    const asks = [older, newer];
    const app = fakeApp(() => asks.shift()!.answer);
    const first = updateTraffic(app as unknown as GameApp);
    const second = updateTraffic(app as unknown as GameApp);
    newer.resolve({ ratio: 0.2, floor: null });
    await second;
    older.reject(new Error("stale"));
    await first;
    expect(app.frameErrors).toEqual([]);
    expect(label()).toBe("Smooth");
  });

  it("drops a failure about a tower that was replaced while the answer was out", async () => {
    const out = deferred();
    const app = fakeApp(() => out.answer);
    const refresh = updateTraffic(app as unknown as GameApp);
    app.sim = {};
    out.reject(new Error("old tower"));
    await refresh;
    expect(app.frameErrors).toEqual([]);
  });

  it("settles the tooling's refresh quietly when its failure is about a replaced tower", async () => {
    const out = deferred();
    const app = fakeApp(() => out.answer);
    const refresh = refreshTraffic(app as unknown as GameApp);
    app.sim = {};
    out.reject(new Error("old tower"));
    await expect(refresh).resolves.toBeUndefined();
  });

  it("draws the real engine's answer through the TypeScript adapter", async () => {
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
    // One tick, so under the WASM parity projects the Rust engine runs the
    // tower and the read model the adapter answers from is its merge.
    sim.tick(1);
    const app = { sim, lastTrafficTier: 0, frameErrors: [], port: createTsSim((): Simulation => app.sim) };
    await updateTraffic(app as unknown as GameApp);
    const hot = sim.peakCongestionHotspot();
    expect(hot.floor).toBe(1);
    expect(app.lastTrafficTier).toBe(trafficTier(hot.ratio));
    expect(app.lastTrafficTier).toBeGreaterThanOrEqual(2);
    expect([label(), floor(), app.frameErrors]).toEqual([TRAFFIC_LABELS[app.lastTrafficTier], " · 1F", []]);
  });
});
