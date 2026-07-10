import { describe, expect, it, vi } from "vitest";
import { TowerEngine } from "../render/excalibur/TowerEngine";

describe("TowerEngine meal-overlay repaint trigger", () => {
  it("re-runs syncScene when the transient meal overlay changes mid-hour", () => {
    const syncScene = vi.fn();
    const syncMotion = vi.fn();
    const syncFacade = vi.fn();
    const updateMotion = vi.fn();
    const reconcileCrowd = vi.fn();
    const fake: any = {
      sim: {
        clock: { hour: 12, isNight: () => false, isEvening: () => false },
        tower: { revision: 7, mealOverlayRevision: 1 },
        congestion: () => 1,
      },
      d: { lit: false, anim: 0, hour: 12, stress: 0 },
      craneGfx: null,
      paused: true,
      reducedMotion: false,
      lastAnimWall: 0,
      animClock: 0,
      builtRev: 7,
      mealOverlayRev: 0,
      litState: false,
      lastSyncHour: 12,
      engine: { backgroundColor: null },
      onUpdate: null,
      syncEventFx: vi.fn(),
      syncScene,
      syncMotion,
      syncFacade,
      updateMotion,
      reconcileCrowd,
    };

    (TowerEngine.prototype as any).tick.call(fake, 16);

    expect(syncScene).toHaveBeenCalledTimes(1);
    expect(syncMotion).not.toHaveBeenCalled();
    expect(syncFacade).not.toHaveBeenCalled();
    expect(updateMotion).toHaveBeenCalledTimes(1);
    expect(reconcileCrowd).toHaveBeenCalledTimes(1);
    expect(fake.mealOverlayRev).toBe(1);
  });
});
