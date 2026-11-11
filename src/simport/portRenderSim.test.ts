import { describe, expect, it, vi } from "vitest";
import { PortRenderSim } from "./portRenderSim";
import type { ViewReader } from "./viewReader";
import { code, mockPort } from "../tests/portKit/mockPort";

/**
 * The renderer's reads over a mock port: which port reads each one makes,
 * what it decodes, and when the queue projection is asked for again. The
 * render sim on the Rust engine runs in `portReads.integration.test.ts`.
 */

const FX = {
  santaSeq: 1,
  vipSeq: 2,
  explosion: { floor: 3, x: 200, seq: 4 },
  thief: { caught: true, floor: 5, seq: 6 },
  treasure: { floor: 7, x: 210, seq: 8 },
};

/** The reader fields the render sim reads: the header and the tower's lookups. */
function readerOf() {
  const header = { mode: "modern", sceneSeed: 77, camera: { tile: 200, floor: 2, zoom: 1.5 }, weather: "rain", population: 412, minutes: 1440 + 600, revision: 5, fx: FX, bombSearch: null };
  const people = [{ id: 7 }];
  const tower = { unitAt: vi.fn(() => undefined), revision: 5 };
  return { header, crowd: { people }, tower } as unknown as ViewReader & { header: typeof header };
}

function sim(answers: Parameters<typeof mockPort>[0] = {}) {
  const port = mockPort(answers);
  const reader = readerOf();
  return { port, reader, r: new PortRenderSim(port, reader) };
}

describe("PortRenderSim", () => {
  it("reads the view through the reader's header, asking the port nothing", () => {
    const { port, reader, r } = sim();
    expect([r.mode, r.rng.initialSeed, r.view, r.weather, r.population, r.bombSearch]).toEqual(["modern", 77, { tile: 200, floor: 2, zoom: 1.5 }, "rain", 412, null]);
    expect([r.santaFxSeq, r.vipFxSeq, r.explosionFx, r.thiefFx, r.treasureFx]).toEqual([1, 2, FX.explosion, FX.thief, FX.treasure]);
    expect([r.clock.minutes, r.clock.hour, r.clock.minute]).toEqual([1440 + 600, 10, 0]);
    expect(r.crowd.people).toBe(reader.crowd.people);
    r.tower.unitAt(2, 170);
    expect(reader.tower.unitAt).toHaveBeenCalledWith(2, 170);
    expect(port.viewLayout).toHaveBeenCalledOnce();
  });

  it("passes the render queries to the port with their arguments", () => {
    const { port, r } = sim({
      congestion: () => 0.25,
      hotspot: () => Float64Array.of(0.75, 3, 200),
      recyclingFill: () => 0.5,
      parkingUsage: (spots) => spots / 10,
      positionReachable: (floor) => floor < 4,
      parkingSet: () => Float64Array.of(2, 41, 42),
    });
    expect([r.congestion(), r.peakCongestion(), r.recyclingFill(), r.parkingUsage(30)]).toEqual([0.25, 0.75, 0.5, 3]);
    expect([r.positionReachable(3, 200), r.positionReachable(4, 170)]).toEqual([true, false]);
    expect([...r.tower.functionalParkingSet()]).toEqual([41, 42]);
    expect(vi.mocked(port.parkingUsage).mock.calls).toEqual([[30]]);
    expect(vi.mocked(port.positionReachable).mock.calls).toEqual([
      [3, 200],
      [4, 170],
    ]);
  });

  it("asks for a heatmap by the layout's code, and decodes its cells and tints", () => {
    const infested = code("heatTints", "infested");
    const { port, r } = sim({ heatCells: () => Float64Array.of(2, 160, 169, 0.5, 0, 3, 170, 200, 1, infested, 9) });
    expect(r.floorHeatmap("cleanliness")).toEqual([
      { floor: 2, minX: 160, maxX: 169, severity: 0.5 },
      { floor: 3, minX: 170, maxX: 200, severity: 1, tint: "infested" },
    ]);
    expect(vi.mocked(port.heatCells).mock.calls).toEqual([[code("heatModes", "cleanliness")]]);
  });

  it("decodes the queue projection and keeps it until the tower, the minute or the revision moves", () => {
    let gen = 1;
    // One landing (shaft 20, floor 1: 6 waiting, tier 2) and one boarded car (shaft 20, car 0: 4 riders).
    const { port, reader, r } = sim({ generation: () => gen, queueView: () => Float64Array.of(1, 1, 20, 1, 6, 2, 20, 0, 4) });
    const q = r.crowd.queueView(r.tower);
    expect([...q.landings.get(20)!]).toEqual([[1, { count: 6, tier: 2 }]]);
    expect([...q.boarded.get(20)!]).toEqual([[0, 4]]);
    expect(r.crowd.queueView(r.tower)).toBe(q);
    expect(port.queueView).toHaveBeenCalledOnce();
    reader.header.minutes++;
    const second = r.crowd.queueView(r.tower);
    reader.header.revision++;
    const third = r.crowd.queueView(r.tower);
    gen++;
    const fourth = r.crowd.queueView(r.tower);
    expect([second === q, third === second, fourth === third]).toEqual([false, false, false]);
    expect(port.queueView).toHaveBeenCalledTimes(4);
  });
});
