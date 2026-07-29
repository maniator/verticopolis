import { describe, it, expect } from "vitest";
import { stepCarPursuit, CAR_MAX_SPEED, SNAP_FLOORS, type CarDrawState } from "./carMotion";

/**
 * The eased car pursuit (GH #688, spec-elevator-car-motion). Shape assertions,
 * not exact values, so feel tuning of the constants does not churn tests: the
 * capabilities pinned are glide (CAP-1: converges, no raw jumps), the
 * accel/decel curve (CAP-2: speed rises from rest, peaks, falls near the
 * target, never crosses it, and a settled car does not creep), and the
 * discontinuity snap (CAP-3).
 */

const DT = 1 / 60;

/** Run `frames` fixed-dt frames toward a fixed target, recording per-frame speed. */
function run(s: CarDrawState, target: number, frames: number): number[] {
  const speeds: number[] = [];
  for (let i = 0; i < frames; i++) {
    const before = s.pos;
    stepCarPursuit(s, target, DT);
    speeds.push(Math.abs(s.pos - before) / DT);
  }
  return speeds;
}

describe("stepCarPursuit", () => {
  it("CAP-1: converges on the sim position with no frame moving faster than the speed cap", () => {
    const s: CarDrawState = { pos: 0, vel: 0 };
    const speeds = run(s, 5, 240);
    expect(s.pos).toBeCloseTo(5, 6);
    for (const v of speeds) expect(v).toBeLessThanOrEqual(CAR_MAX_SPEED + 1e-9);
  });

  it("CAP-1: keeps gliding when the target advances in sim-tick steps", () => {
    // A stepped target (the real sim pattern): the drawn position must move
    // EVERY frame while trailing it, not freeze and jump.
    const s: CarDrawState = { pos: 0, vel: 0 };
    let target = 0;
    let stillFrames = 0;
    for (let frame = 0; frame < 180; frame++) {
      if (frame % 20 === 0) target += 1; // a ~3Hz sim tick advancing one floor
      const before = s.pos;
      stepCarPursuit(s, target, DT);
      if (frame > 20 && s.pos !== target && s.pos === before) stillFrames++;
    }
    expect(stillFrames).toBe(0);
  });

  it("CAP-2: speed ramps up from rest, peaks, then falls as the target nears, without crossing it", () => {
    const s: CarDrawState = { pos: 0, vel: 0 };
    const speeds = run(s, 5, 240);
    const peak = Math.max(...speeds);
    const peakAt = speeds.indexOf(peak);
    // Rises from (near) zero: the first frame is far slower than the peak.
    expect(speeds[0]).toBeLessThan(peak / 4);
    // Falls again: the last moving frames are far slower than the peak.
    const moving = speeds.filter((v) => v > 0);
    expect(moving[moving.length - 1]).toBeLessThan(peak / 4);
    expect(peakAt).toBeGreaterThan(0);
    // Never crosses: position is monotone toward the target and capped at it.
    const t: CarDrawState = { pos: 0, vel: 0 };
    let prev = 0;
    for (let i = 0; i < 240; i++) {
      stepCarPursuit(t, 5, DT);
      expect(t.pos).toBeGreaterThanOrEqual(prev);
      expect(t.pos).toBeLessThanOrEqual(5 + 1e-9);
      prev = t.pos;
    }
  });

  it("CAP-2: a settled car under a stationary target does not creep", () => {
    const s: CarDrawState = { pos: 3, vel: 0 };
    for (let i = 0; i < 60; i++) stepCarPursuit(s, 3, DT);
    expect(s.pos).toBe(3);
    expect(s.vel).toBe(0);
  });

  it("CAP-2: works symmetrically downward", () => {
    const s: CarDrawState = { pos: 5, vel: 0 };
    run(s, 1, 240);
    expect(s.pos).toBeCloseTo(1, 6);
  });

  it("CAP-3: a jump beyond the snap threshold lands in one frame with no glide", () => {
    const s: CarDrawState = { pos: 2, vel: 4 };
    stepCarPursuit(s, 2 + SNAP_FLOORS + 1, DT);
    expect(s.pos).toBe(2 + SNAP_FLOORS + 1);
    expect(s.vel).toBe(0);
  });

  it("is defensive: a non-finite target or dt cannot poison the state", () => {
    const s: CarDrawState = { pos: 2, vel: 1 };
    stepCarPursuit(s, Number.NaN, DT);
    expect(s.pos).toBe(2);
    stepCarPursuit(s, 3, Number.NaN);
    expect(Number.isFinite(s.pos)).toBe(true);
    // A giant real-frame stall advances by at most the clamped step.
    const far: CarDrawState = { pos: 0, vel: 0 };
    stepCarPursuit(far, 5, 10);
    expect(far.pos).toBeLessThan(5);
  });
});
