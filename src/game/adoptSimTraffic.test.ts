import { describe, it, expect, vi } from "vitest";
import { GameApp } from "../main";

// Loading main.ts boots the game at module scope; this test only needs the
// class, so the boot is stubbed out.
vi.mock("../bootstrap", () => ({ bootGame: vi.fn() }));
import { Simulation } from "../engine/Simulation";
import type { TrafficTier } from "../engine/traffic";

/**
 * `GameApp.adoptSim` restarts the traffic chip's hysteresis on a different
 * tower (a load, a new tower, a slot, an import) and keeps it on an undo or
 * redo restore of the same tower (`preserveHistory`), which also keeps the
 * camera and the undo trail. We call the real method on a stand-in app that
 * carries only the members it touches.
 */

function standIn(tier: TrafficTier) {
  const sim = Simulation.newGame(3);
  return {
    sim,
    lastTrafficTier: tier,
    frameErrors: [{ at: "t", message: "old tower" }],
    clearSelection: vi.fn(),
    inspector: { clear: vi.fn() },
    onboarding: { adoptSim: vi.fn() },
    engine: { setSim: vi.fn() },
    // adoptSim builds the renderer's view over these two: the layout's heat
    // tables and the reader's tower and crowd are all it reads up front.
    enginePort: { take: vi.fn(), viewLayout: () => JSON.stringify({ heatModes: [], heatTints: [] }) },
    reader: { update: vi.fn(), tower: {}, crowd: { people: [] } },
    ui: { resetLog: vi.fn(), update: vi.fn() },
    history: { clear: vi.fn() },
  };
}

describe("adoptSim and the traffic chip", () => {
  it("starts the chip's hysteresis over on another tower", () => {
    const app = standIn(2);
    GameApp.prototype.adoptSim.call(app as unknown as GameApp, Simulation.newGame(4));
    expect(app.lastTrafficTier).toBe(0);
    expect(app.history.clear).toHaveBeenCalledTimes(1);
    expect(app.frameErrors).toEqual([]);
  });

  it("keeps it on an undo or redo restore", () => {
    const app = standIn(2);
    GameApp.prototype.adoptSim.call(app as unknown as GameApp, Simulation.deserialize(app.sim.serialize()), true);
    expect(app.lastTrafficTier).toBe(2);
    expect(app.history.clear).not.toHaveBeenCalled();
  });
});
