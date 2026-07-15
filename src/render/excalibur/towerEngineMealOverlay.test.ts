import { describe, expect, it, vi } from "vitest";
import { TowerEngine } from "./TowerEngine";
import { syncScene, syncFacade } from "./towerReconcile";
import { syncMotion } from "./towerCrowd";

// tick() routes scene syncing through towerSyncSchedule, which calls the
// friend functions directly (the class delegations are private); stub the
// modules so this whitebox harness never bakes a canvas.
vi.mock("./towerReconcile", () => ({ syncScene: vi.fn(), syncFacade: vi.fn() }));
vi.mock("./towerCrowd", () => ({ syncMotion: vi.fn() }));

describe("TowerEngine meal-overlay repaint trigger", () => {
  it("re-runs syncScene when the transient meal overlay changes mid-hour", () => {
    const updateMotion = vi.fn();
    const reconcileCrowd = vi.fn();
    const fake: any = {
      sim: {
        clock: { hour: 12, isNight: () => false, isEvening: () => false },
        tower: { revision: 7, mealOverlayRevision: 1 },
        congestion: () => 1,
        // The tick threads the read-only queue projection onto d.elevatorQueue;
        // stub the memoized view so this whitebox tick harness has one to read.
        crowd: { queueView: () => ({ landings: new Map(), boarded: new Map() }) },
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
      hourSyncPending: false,
      engine: { backgroundColor: null },
      onUpdate: null,
      syncEventFx: vi.fn(),
      updateMotion,
      reconcileCrowd,
    };

    (TowerEngine.prototype as any).tick.call(fake, 16);

    // Mid-hour overlay bump: same-frame scene sync (never deferred, the sim
    // just moved someone out for a meal), no structural motion/facade rebuild.
    expect(syncScene).toHaveBeenCalledTimes(1);
    expect(syncMotion).not.toHaveBeenCalled();
    expect(syncFacade).not.toHaveBeenCalled();
    expect(updateMotion).toHaveBeenCalledTimes(1);
    expect(reconcileCrowd).toHaveBeenCalledTimes(1);
    expect(fake.mealOverlayRev).toBe(1);
    expect(fake.hourSyncPending).toBe(false);
  });
});
