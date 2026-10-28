import { describe, it, expect, vi } from "vitest";
import { GameApp } from "../main";

// Loading main.ts boots the game at module scope; this test only needs the
// class, so the boot is stubbed out.
vi.mock("../bootstrap", () => ({ bootGame: vi.fn() }));
import type { TrafficTier } from "../engine/traffic";

/**
 * `GameApp.followSwap` restarts the traffic chip's hysteresis on a different
 * tower (a load, a new tower, a slot, an import) and keeps it on an undo or
 * redo restore of the same tower (`preserveHistory`), which also keeps the
 * camera and the undo trail. We call the real method on a stand-in app that
 * carries only the members it touches.
 */

function standIn(tier: TrafficTier) {
  return {
    lastTrafficTier: tier,
    frameErrors: [{ at: "t", message: "old tower" }],
    clearSelection: vi.fn(),
    inspector: { clear: vi.fn() },
    onboarding: { adoptSim: vi.fn() },
    engine: { setSim: vi.fn() },
    // followSwap builds the renderer's view over these two: the layout's heat
    // tables and the reader's tower, crowd and header are all it reads up front.
    enginePort: { viewLayout: () => JSON.stringify({ heatModes: [], heatTints: [] }) },
    reader: { update: vi.fn(), tower: {}, crowd: { people: [] }, header: { star: 1 } },
    ui: { resetLog: vi.fn(), update: vi.fn() },
    history: { clear: vi.fn() },
  };
}

describe("followSwap and the traffic chip", () => {
  it("starts the chip's hysteresis over on another tower", () => {
    const app = standIn(2);
    GameApp.prototype.followSwap.call(app as unknown as GameApp);
    expect(app.lastTrafficTier).toBe(0);
    expect(app.history.clear).toHaveBeenCalledTimes(1);
    expect(app.frameErrors).toEqual([]);
  });

  it("keeps it on an undo or redo restore", () => {
    const app = standIn(2);
    GameApp.prototype.followSwap.call(app as unknown as GameApp, true);
    expect(app.lastTrafficTier).toBe(2);
    expect(app.history.clear).not.toHaveBeenCalled();
  });
});
