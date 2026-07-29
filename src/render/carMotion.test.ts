import { describe, it, expect } from "vitest";
import { stepCarPursuit, CAR_MAX_SPEED, CAR_TAU, SNAP_FLOORS, type CarDrawState } from "./carMotion";

/**
 * The eased car pursuit (GH #688, spec-elevator-car-motion). Shape assertions,
 * not exact values, so feel tuning of the constants does not churn tests: the
 * capabilities pinned are glide (CAP-1: converges, moves every frame, never
 * outpaces the speed cap, and holds through the fastest normal-speed sim rate
 * without snapping), the accel/decel curve (CAP-2: speed rises from rest,
 * peaks, falls near the target, never crosses it, and a settled car does not
 * creep), and the discontinuity snap (CAP-3), plus the frame-time edge cases
 * (Excalibur's 200ms-to-1ms stall clamp, slow-device frames, hostile inputs).
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

  it("CAP-1: glides through a stepped sim target, never freezing and never jumping a tick's worth", () => {
    // The real sim pattern: the target advances one floor a few times a second.
    // The drawn position must move EVERY frame while trailing, and no single
    // frame may cover more than one frame of capped pursuit (a raw-draw
    // regression teleports a full floor per tick and fails the delta bound).
    const s: CarDrawState = { pos: 0, vel: 0 };
    let target = 0;
    let stillFrames = 0;
    let maxDelta = 0;
    for (let frame = 0; frame < 180; frame++) {
      if (frame % 20 === 0) target += 1; // a ~3Hz sim tick advancing one floor
      const before = s.pos;
      stepCarPursuit(s, target, DT);
      const delta = Math.abs(s.pos - before);
      if (delta > maxDelta) maxDelta = delta;
      if (frame > 20 && Math.abs(target - before) > 1e-3 && delta === 0) stillFrames++;
    }
    expect(stillFrames).toBe(0);
    expect(maxDelta).toBeLessThanOrEqual(CAR_MAX_SPEED * DT + 1e-9);
  });

  it("CAP-1: holds the fastest normal-speed sim rate (the night sprint) without ever snapping", () => {
    // Speed 1 at the ~3.25x night pace runs ~26 floors/s on screen (the
    // Pixel 8a express-teleport report). The chase must track it with a
    // bounded trail and zero snap-sized frames.
    const s: CarDrawState = { pos: 0, vel: 0 };
    let target = 0;
    let maxDelta = 0;
    let maxTrail = 0;
    for (let frame = 0; frame < 600; frame++) {
      target += 26 / 60;
      const before = s.pos;
      stepCarPursuit(s, target, DT);
      maxDelta = Math.max(maxDelta, Math.abs(s.pos - before));
      maxTrail = Math.max(maxTrail, Math.abs(target - s.pos));
    }
    expect(maxDelta).toBeLessThanOrEqual(CAR_MAX_SPEED * DT + 1e-9); // no snap frame
    expect(maxTrail).toBeLessThan(SNAP_FLOORS); // equilibrium trail stays inside the snap window
    expect(maxTrail).toBeLessThan(26 * CAR_TAU + 1); // and near the designed speed x tau trail
  });

  it("CAP-2: speed ramps up from rest, peaks, then falls as the target nears, without crossing it", () => {
    const s: CarDrawState = { pos: 0, vel: 0 };
    const speeds = run(s, 5, 240);
    const peak = Math.max(...speeds);
    // Rises from (near) zero: the first frame is far slower than the peak.
    expect(speeds[0]).toBeLessThan(peak / 4);
    // Falls again: the last moving frames are far slower than the peak.
    const moving = speeds.filter((v) => v > 0);
    expect(moving[moving.length - 1]).toBeLessThan(peak / 4);
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

  it("CAP-2: a target reversing against full momentum is braked, bounded, and then converged on", () => {
    // Chase upward until near full speed, then flip the target below: the car
    // may carry past the flip point (momentum reads as physical) but only by a
    // bounded excursion, and it must come back and settle.
    const s: CarDrawState = { pos: 0, vel: 0 };
    let i = 0;
    while (s.vel < CAR_MAX_SPEED * 0.9 && i++ < 240) stepCarPursuit(s, s.pos + 5, DT);
    const flipAt = s.pos;
    let maxExcursion = 0;
    for (let f = 0; f < 600; f++) {
      stepCarPursuit(s, flipAt - 2, DT);
      maxExcursion = Math.max(maxExcursion, s.pos - flipAt);
    }
    // Excursion bound: v^2 / (2 * 2A) at worst, ~1.1 floors for the shipped
    // constants; assert a loose 2.5 so tuning has room without hiding a bug.
    expect(maxExcursion).toBeLessThan(2.5);
    expect(s.pos).toBeCloseTo(flipAt - 2, 6);
  });

  it("CAP-3: a jump beyond the snap threshold lands in one frame with no glide", () => {
    const s: CarDrawState = { pos: 2, vel: 4 };
    stepCarPursuit(s, 2 + SNAP_FLOORS + 1, DT);
    expect(s.pos).toBe(2 + SNAP_FLOORS + 1);
    expect(s.vel).toBe(0); // a discontinuity (load, rebuild) lands parked
  });

  it("CAP-3: a snap mid-chase keeps the car's momentum so fast-forward stays in motion", () => {
    const s: CarDrawState = { pos: 0, vel: CAR_MAX_SPEED };
    stepCarPursuit(s, SNAP_FLOORS + 2, DT);
    expect(s.pos).toBe(SNAP_FLOORS + 2);
    expect(s.vel).toBe(CAR_MAX_SPEED); // carried, not re-ramped from zero
  });

  it("CAP-3: a gap of exactly the snap threshold still glides", () => {
    const s: CarDrawState = { pos: 0, vel: 0 };
    stepCarPursuit(s, SNAP_FLOORS, DT);
    expect(s.pos).toBeGreaterThan(0);
    expect(s.pos).toBeLessThan(SNAP_FLOORS);
  });

  it("treats Excalibur's 200ms-to-1ms stall clamp as one ordinary frame instead of starving", () => {
    const normal: CarDrawState = { pos: 0, vel: 0 };
    const clamped: CarDrawState = { pos: 0, vel: 0 };
    stepCarPursuit(normal, 5, DT);
    stepCarPursuit(clamped, 5, 0.001);
    expect(clamped.pos).toBeCloseTo(normal.pos, 9);
  });

  it("advances by the full delta on slow-device frames so the chase is not outpaced by the sim", () => {
    // The sim consumes the whole frame delta up to Excalibur's 200ms clamp; a
    // pursuit capped tighter would fall behind at 10fps. A 150ms step must
    // therefore cover clearly more ground than a 50ms step.
    const slow: CarDrawState = { pos: 0, vel: 0 };
    const capped: CarDrawState = { pos: 0, vel: 0 };
    stepCarPursuit(slow, 5.5, 0.15);
    stepCarPursuit(capped, 5.5, 0.05);
    expect(slow.pos).toBeGreaterThan(capped.pos * 1.5);
  });

  it("is defensive: hostile inputs cannot poison or fling the state", () => {
    const s: CarDrawState = { pos: 2, vel: 1 };
    stepCarPursuit(s, Number.NaN, DT);
    expect(s.pos).toBe(2); // NaN target: untouched
    const frozen: CarDrawState = { pos: 2, vel: 1 };
    stepCarPursuit(frozen, 4, Number.NaN);
    expect(frozen.pos).toBe(2); // NaN dt reads as zero time: no movement
    stepCarPursuit(frozen, 4, -1);
    expect(frozen.pos).toBe(2); // negative dt likewise
    const poisoned: CarDrawState = { pos: 2, vel: Number.NaN };
    stepCarPursuit(poisoned, 4, DT);
    expect(Number.isFinite(poisoned.pos)).toBe(true); // NaN velocity is reset, never propagated
    expect(Number.isFinite(poisoned.vel)).toBe(true);
    // A giant stalled frame advances by at most the internal step ceiling.
    const far: CarDrawState = { pos: 0, vel: 0 };
    stepCarPursuit(far, 5.9, 10);
    expect(far.pos).toBeLessThanOrEqual(CAR_MAX_SPEED * 0.2 + 1e-9);
  });
});
