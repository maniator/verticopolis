import { describe, expect, it } from "vitest";
import { glideCar, newCarDraw } from "../carMotion";
import { GAP_WEIGHT, advanceGlide, newGlide, newStepClock, smoothedInterval, stepProgress, tickStepClock } from "./crowdLook";

const FRAME = 1000 / 60;

/** Drive one car up a shaft at 60 frames a second: the engine moves it one
 *  floor on each frame `stepsAt` says a step lands, and the drawn car glides
 *  on the shared step clock. Returns how far the drawn car moved each frame. */
function drawnMoves(frames: number, stepsAt: (frame: number) => boolean): number[] {
  const clock = newStepClock(0);
  const car = newCarDraw(0);
  let minute = 0;
  let floor = 0;
  const moves: number[] = [];
  for (let f = 1; f <= frames; f++) {
    if (stepsAt(f)) {
      minute++;
      floor++;
    }
    tickStepClock(clock, minute, FRAME);
    const before = car.pos;
    glideCar(car, floor, clock.stepped, stepProgress(clock));
    moves.push(car.pos - before);
  }
  return moves;
}

describe("the glide step clock", () => {
  it("moves a car on the frame a step lands instead of holding it still (the 3.7.0 jitter)", () => {
    // 15 game minutes a second at 60 frames a second: a step every 4 frames.
    const moves = drawnMoves(80, (f) => f % 4 === 0).slice(20);
    for (const m of moves) expect(m).toBeGreaterThan(0);
    for (const m of moves) expect(m).toBeCloseTo(0.25, 6);
  });

  it("keeps a car at one speed when steps land every one or two frames", () => {
    // About 50 game minutes a second: gaps of 1 and 2 frames, mixed.
    const pattern = [true, false, true, true, false, true, true, false];
    const moves = drawnMoves(400, (f) => pattern[f % pattern.length]).slice(200);
    for (const m of moves) expect(m).toBeGreaterThan(0);
    const mean = moves.reduce((a, b) => a + b, 0) / moves.length;
    // Each frame's travel stays near the average, with no frame stalled and
    // none taking a whole extra floor's lurch.
    for (const m of moves) expect(Math.abs(m - mean)).toBeLessThan(mean * 0.6);
  });

  it("walks a person on every frame too, since people share the clock", () => {
    const clock = newStepClock(0);
    const g = newGlide(0, 5, false);
    let minute = 0;
    let x = 0;
    const pattern = [true, false, true, true, false, true, true, false];
    for (let f = 1; f <= 400; f++) {
      if (pattern[f % pattern.length]) {
        minute++;
        x += 0.5;
      }
      tickStepClock(clock, minute, FRAME);
      const before = g.x;
      advanceGlide(g, x, 5, clock.stepped, stepProgress(clock), true);
      if (f > 200) expect(g.x - before).toBeGreaterThan(0);
    }
  });

  it("counts the gap from the last step's frame, so a steady pace reads true", () => {
    const clock = newStepClock(0);
    let minute = 0;
    for (let f = 1; f <= 40; f++) {
      if (f % 4 === 0) minute++;
      tickStepClock(clock, minute, FRAME);
    }
    expect(clock.intervalMs).toBeCloseTo(4 * FRAME, 3);
    expect(clock.stepped).toBe(true);
    expect(stepProgress(clock)).toBeCloseTo(0.25, 6);
  });

  it("averages gaps at one pace and jumps to a new pace at once", () => {
    expect(smoothedInterval(20, 33)).toBeCloseTo(20 + 13 * GAP_WEIGHT, 6);
    expect(smoothedInterval(66, 333)).toBe(333);
    expect(smoothedInterval(333, 66)).toBe(66);
  });

  it("holds a paused glide where it is", () => {
    const clock = newStepClock(0);
    tickStepClock(clock, 1, FRAME);
    const at = stepProgress(clock);
    tickStepClock(clock, 1, 0);
    tickStepClock(clock, 1, 0);
    expect(stepProgress(clock)).toBe(at);
    expect(clock.stepped).toBe(false);
  });
});
