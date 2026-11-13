import { describe, it, expect } from "vitest";
import { glideCar, newCarDraw, SNAP_FLOORS } from "./carMotion";

/**
 * The drawn elevator car glides over each sim step (#2097): at the slow
 * speeds a step lands a few times a second, and a car that caught up and then
 * waited for the next one stopped between floors.
 */

/** One step of `frames` equal frames toward `target`, recording each drawn position. */
function step(s: ReturnType<typeof newCarDraw>, target: number, frames: number): number[] {
  const out: number[] = [];
  for (let f = 0; f < frames; f++) out.push(glideCar(s, target, f === 0, (f + 1) / frames).pos);
  return out;
}

describe("glideCar", () => {
  it("moves every frame of a slow step and reaches the engine's floor at its end", () => {
    const s = newCarDraw(4);
    const drawn = step(s, 5, 60); // a one-second step at the lunch slowdown
    for (let i = 1; i < drawn.length; i++) expect(drawn[i]).toBeGreaterThan(drawn[i - 1]);
    expect(drawn[drawn.length - 1]).toBe(5);
  });

  it("keeps going from where it is drawn when the next step lands early, with no jump", () => {
    const s = newCarDraw(0);
    glideCar(s, 1, true, 0.5);
    expect(s.pos).toBeCloseTo(0.5, 9);
    // The next step arrives before this one finished: start from 0.5, not 1.
    glideCar(s, 2, true, 0);
    expect(s.pos).toBeCloseTo(0.5, 9);
    glideCar(s, 2, false, 0.5);
    expect(s.pos).toBeCloseTo(1.25, 9);
  });

  it("stands still at a stop while the engine keeps it there", () => {
    const s = newCarDraw(7);
    expect(step(s, 7, 10).every((p) => p === 7)).toBe(true);
  });

  it("snaps across a gap no glide could show, and ignores a bad target", () => {
    const s = newCarDraw(0);
    glideCar(s, SNAP_FLOORS + 1, true, 0);
    expect(s.pos).toBe(SNAP_FLOORS + 1);
    glideCar(s, Number.NaN, true, 0.5);
    expect(s.pos).toBe(SNAP_FLOORS + 1);
  });
});
