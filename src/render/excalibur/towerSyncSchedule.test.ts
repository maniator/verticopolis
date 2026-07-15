import { describe, it, expect, vi, beforeEach } from "vitest";
import { planSceneSync, runSceneSync } from "./towerSyncSchedule";
import { syncScene, syncFacade } from "./towerReconcile";
import { syncMotion } from "./towerCrowd";

// runSceneSync calls the friend functions directly (the delegations on the
// class are private); stub the modules so no canvas ever bakes here.
vi.mock("./towerReconcile", () => ({ syncScene: vi.fn(), syncFacade: vi.fn() }));
vi.mock("./towerCrowd", () => ({ syncMotion: vi.fn() }));

/**
 * CAP-3 of the mobile render-perf spec: hour-driven scene reconciles defer
 * exactly one frame off the engine's hourly scans; structural and meal-overlay
 * reconciles stay same-frame; nothing is ever skipped. The planner is pure and
 * fully pinned here; runSceneSync is driven with a fake engine (no canvas
 * baking happens at this seam, syncScene is a spy).
 */

const quiet = { structural: false, mealOverlay: false, litChanged: false, hourChanged: false, pending: false };

describe("planSceneSync (pure one-step scheduler)", () => {
  it("defers an hour-only change one frame, then drains it", () => {
    const f1 = planSceneSync({ ...quiet, hourChanged: true });
    expect(f1).toEqual({ syncNow: false, nextPending: true });
    const f2 = planSceneSync({ ...quiet, pending: true });
    expect(f2).toEqual({ syncNow: true, nextPending: false });
  });

  it("defers a lit-only flip the same way (lighting is hour-derived)", () => {
    expect(planSceneSync({ ...quiet, litChanged: true })).toEqual({ syncNow: false, nextPending: true });
  });

  it("syncs structural and meal-overlay changes in the same frame", () => {
    expect(planSceneSync({ ...quiet, structural: true }).syncNow).toBe(true);
    expect(planSceneSync({ ...quiet, mealOverlay: true }).syncNow).toBe(true);
  });

  it("an immediate cause absorbs a same-frame hour trigger (one sync, nothing pending)", () => {
    expect(planSceneSync({ ...quiet, structural: true, hourChanged: true, litChanged: true })).toEqual({
      syncNow: true,
      nextPending: false,
    });
  });

  it("a pending drain absorbs a fresh hour trigger instead of re-deferring", () => {
    // Long frame at top speed: the hour advanced AGAIN while a deferral
    // waited. The drain syncs against live state, so nothing re-books.
    expect(planSceneSync({ ...quiet, pending: true, hourChanged: true })).toEqual({
      syncNow: true,
      nextPending: false,
    });
  });

  it("does nothing on a quiet frame", () => {
    expect(planSceneSync(quiet)).toEqual({ syncNow: false, nextPending: false });
  });

  it("never skips a reconcile: any trigger leads to a sync within two steps", () => {
    for (const key of ["structural", "mealOverlay", "litChanged", "hourChanged"] as const) {
      const f1 = planSceneSync({ ...quiet, [key]: true });
      const synced = f1.syncNow || planSceneSync({ ...quiet, pending: f1.nextPending }).syncNow;
      expect(synced).toBe(true);
    }
  });
});

describe("runSceneSync (engine wiring)", () => {
  beforeEach(() => vi.clearAllMocks());

  const eng = (over: Record<string, unknown> = {}) => ({
    sim: { tower: { revision: 1, mealOverlayRevision: 0 } },
    d: { lit: false, hour: 9 },
    litState: false,
    lastSyncHour: 9,
    builtRev: 1,
    mealOverlayRev: 0,
    hourSyncPending: false,
    ...over,
  });

  it("hour change: books the sync, then runs it next frame with fresh bookkeeping", () => {
    const e = eng({ d: { lit: false, hour: 10 } });
    runSceneSync(e as never);
    expect(syncScene).not.toHaveBeenCalled();
    expect(e.hourSyncPending).toBe(true);
    expect(e.lastSyncHour).toBe(9); // bookkeeping moves only when the sync runs

    runSceneSync(e as never);
    expect(syncScene).toHaveBeenCalledTimes(1);
    expect(syncScene).toHaveBeenCalledWith(e);
    expect(e.hourSyncPending).toBe(false);
    expect(e.lastSyncHour).toBe(10);
  });

  it("structural change: same-frame scene AND motion/facade sync, revision adopted", () => {
    const e = eng({ sim: { tower: { revision: 2, mealOverlayRevision: 0 } } });
    runSceneSync(e as never);
    expect(syncScene).toHaveBeenCalledTimes(1);
    expect(syncMotion).toHaveBeenCalledTimes(1);
    expect(syncFacade).toHaveBeenCalledTimes(1);
    expect(e.builtRev).toBe(2);
  });

  it("meal-overlay bump: same-frame scene sync, revision adopted, no motion rebuild", () => {
    const e = eng({ sim: { tower: { revision: 1, mealOverlayRevision: 3 } } });
    runSceneSync(e as never);
    expect(syncScene).toHaveBeenCalledTimes(1);
    expect(e.mealOverlayRev).toBe(3);
    expect(syncMotion).not.toHaveBeenCalled();
  });

  it("lit flip rides the deferral and lands litState one frame later", () => {
    const e = eng({ d: { lit: true, hour: 9 } });
    runSceneSync(e as never);
    expect(e.litState).toBe(false);
    runSceneSync(e as never);
    expect(e.litState).toBe(true);
    expect(syncScene).toHaveBeenCalledTimes(1);
  });

  it("quiet frames call nothing and move nothing", () => {
    const e = eng();
    runSceneSync(e as never);
    expect(syncScene).not.toHaveBeenCalled();
    expect(e.hourSyncPending).toBe(false);
    expect(e.lastSyncHour).toBe(9);
  });
});
