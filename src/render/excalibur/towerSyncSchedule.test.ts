import { describe, it, expect, vi, beforeEach } from "vitest";
import { displayLit, drainSceneSync, planSceneSync, runSceneSync } from "./towerSyncSchedule";
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

const quiet = {
  structural: false,
  mealOverlay: false,
  litChanged: false,
  hourChanged: false,
  pending: false,
  simCrossedHour: false,
};

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

  it("syncs structural and meal-overlay changes in the same frame, with nothing left pending", () => {
    expect(planSceneSync({ ...quiet, structural: true })).toEqual({ syncNow: true, nextPending: false });
    expect(planSceneSync({ ...quiet, mealOverlay: true })).toEqual({ syncNow: true, nextPending: false });
  });

  it("a meal-overlay bump on a frame whose sim advance crossed an hour books instead of stacking with the scans", () => {
    const f1 = planSceneSync({ ...quiet, mealOverlay: true, simCrossedHour: true });
    expect(f1).toEqual({ syncNow: false, nextPending: true });
    expect(planSceneSync({ ...quiet, pending: true })).toEqual({ syncNow: true, nextPending: false });
  });

  it("structural changes sync now even on an hour-crossing frame (the player just acted)", () => {
    expect(planSceneSync({ ...quiet, structural: true, simCrossedHour: true })).toEqual({
      syncNow: true,
      nextPending: false,
    });
  });

  it("pending never survives a sync, whatever arrives with it", () => {
    for (const extra of ["structural", "mealOverlay", "litChanged", "hourChanged"] as const) {
      expect(planSceneSync({ ...quiet, pending: true, [extra]: true })).toEqual({
        syncNow: true,
        nextPending: false,
      });
    }
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

  // The live clock (sim.clock.hour) matching d.hour means this frame's sim
  // advance crossed no hour; tests that need a crossing set them apart.
  const eng = (over: Record<string, unknown> = {}, clockHour = 9) => ({
    sim: { tower: { revision: 1, mealOverlayRevision: 0 }, clock: { hour: clockHour }, ...(over.sim as object | undefined) },
    d: { lit: false, hour: 9 },
    litState: false,
    lastSyncHour: 9,
    builtRev: 1,
    mealOverlayRev: 0,
    hourSyncPending: false,
    ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== "sim")),
  });

  it("hour change: books the sync, then runs it next frame with fresh bookkeeping", () => {
    const e = eng({ d: { lit: false, hour: 10 } }, 10);
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

  it("a meal-overlay bump on an hour-crossing frame books for the next frame instead of joining the scans", () => {
    // The live clock is past the displayed hour: this frame's onUpdate just
    // crossed 10:00 and ran the hourly scans.
    const e = eng({ sim: { tower: { revision: 1, mealOverlayRevision: 3 } } }, 10);
    runSceneSync(e as never);
    expect(syncScene).not.toHaveBeenCalled();
    expect(e.hourSyncPending).toBe(true);
    expect(e.mealOverlayRev).toBe(0); // adopted only when the sync really runs
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

describe("drainSceneSync (frame-start drain, before the sim advances)", () => {
  beforeEach(() => vi.clearAllMocks());

  const eng = (over: Record<string, unknown> = {}) => ({
    sim: { tower: { revision: 1, mealOverlayRevision: 0 }, clock: { hour: 10 } },
    d: { lit: true, hour: 10 },
    litState: false,
    lastSyncHour: 9,
    builtRev: 1,
    mealOverlayRev: 0,
    hourSyncPending: true,
    ...over,
  });

  it("drains a booked deferral: syncs, adopts bookkeeping, clears the latch", () => {
    const e = eng();
    drainSceneSync(e as never);
    expect(syncScene).toHaveBeenCalledTimes(1);
    expect(e.hourSyncPending).toBe(false);
    expect(e.lastSyncHour).toBe(10);
    expect(e.litState).toBe(true);
  });

  it("is a no-op when nothing is pending", () => {
    const e = eng({ hourSyncPending: false });
    drainSceneSync(e as never);
    expect(syncScene).not.toHaveBeenCalled();
  });

  it("stands aside when a structural change is already waiting: one sync covers both", () => {
    // A tower swap (builtRev reset) or an edit from last frame is visible at
    // frame start; draining too would run the full reconcile twice.
    const e = eng({ sim: { tower: { revision: 2, mealOverlayRevision: 0 }, clock: { hour: 10 } } });
    drainSceneSync(e as never);
    expect(syncScene).not.toHaveBeenCalled();
    expect(e.hourSyncPending).toBe(true); // stays booked for the structural sync
    runSceneSync(e as never);
    expect(syncScene).toHaveBeenCalledTimes(1);
    expect(syncMotion).toHaveBeenCalledTimes(1);
    expect(e.hourSyncPending).toBe(false);
    expect(e.lastSyncHour).toBe(10);
  });

  it("flags the crane's canvas when the adopted lighting changes, and only then", () => {
    // The crane's cab window is lighting-dependent but its canvas re-rasters
    // only when flagged; the sync application is its one lit-driven trigger,
    // so a frozen decorative clock (pause / reduced motion) still flips it.
    const flagDirty = vi.fn();
    const e = eng({ craneGfx: { flagDirty } });
    drainSceneSync(e as never); // d.lit true vs litState false: flip adopted
    expect(flagDirty).toHaveBeenCalledTimes(1);

    const calmFlag = vi.fn();
    const calm = eng({ craneGfx: { flagDirty: calmFlag }, d: { lit: false, hour: 10 }, litState: false });
    drainSceneSync(calm as never); // hour moved, lighting did not
    expect(calmFlag).not.toHaveBeenCalled();
  });

  it("a catch-up frame that crosses the NEXT hour never re-stacks: the drain repaints before the sim advances, the new hour books its own deferral", () => {
    // Frame start: last frame's deferral drains against the pre-advance hour.
    const e = eng();
    drainSceneSync(e as never);
    expect(syncScene).toHaveBeenCalledTimes(1);
    // The sim then advances across ANOTHER hour inside onUpdate (its onHour
    // scans run there); the post-update evaluation must book, not sync, so
    // the two costs land on different frames.
    e.sim.clock.hour = 11;
    e.d.hour = 11;
    runSceneSync(e as never);
    expect(syncScene).toHaveBeenCalledTimes(1); // still just the drain's sync
    expect(e.hourSyncPending).toBe(true);
  });
});

describe("displayLit (shared boot/tick lighting derivation)", () => {
  it("is lit during evening or night, dark otherwise", () => {
    const clock = (evening: boolean, night: boolean) => ({ isEvening: () => evening, isNight: () => night });
    expect(displayLit(clock(false, false))).toBe(false);
    expect(displayLit(clock(true, false))).toBe(true);
    expect(displayLit(clock(false, true))).toBe(true);
  });
});
