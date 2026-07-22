import { describe, it, expect } from "vitest";
import { drawPlazaLamp, drawStreetLamp, lampAlpha } from "./towerSceneryDraw";

/**
 * The lamp fade windows are pure math with four boundary hours; pin them so a
 * future retune of the dusk/dawn ramps is a deliberate edit instead of a
 * silent drift. The
 * painters themselves are driven through recording contexts in
 * towerScenery.test.ts.
 */

describe("lampAlpha", () => {
  it("is full night outside the ramps and zero across the day", () => {
    expect(lampAlpha(0)).toBe(1);
    expect(lampAlpha(4.99)).toBe(1);
    expect(lampAlpha(12)).toBe(0);
    expect(lampAlpha(17.99)).toBe(0);
    expect(lampAlpha(20)).toBe(1);
    expect(lampAlpha(23.99)).toBe(1);
  });

  it("fades out through dawn: full at 5:00, half at 6:00, off at 7:00", () => {
    expect(lampAlpha(5)).toBe(1);
    expect(lampAlpha(6)).toBe(0.5);
    expect(lampAlpha(7)).toBe(0);
  });

  it("fades in through dusk: off at 18:00, half at 19:00, full at 20:00", () => {
    expect(lampAlpha(18)).toBe(0);
    expect(lampAlpha(19)).toBe(0.5);
    expect(lampAlpha(20)).toBe(1);
  });

  it("stays inside [0, 1] across the whole clock, fractional minutes included", () => {
    for (let m = 0; m < 24 * 60; m += 7) {
      const a = lampAlpha(m / 60);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });
});

/** Minimal recording context for the lit-path checks below. */
function spyCtx(): { ctx: CanvasRenderingContext2D; log: string[] } {
  const log: string[] = [];
  const ctx: Record<string, unknown> = {};
  for (const m of ["clearRect", "fillRect", "strokeRect", "fillText", "beginPath", "ellipse", "fill", "stroke"]) {
    ctx[m] = () => log.push(m);
  }
  let fill: unknown;
  Object.defineProperty(ctx, "fillStyle", {
    get: () => fill,
    set: (v) => {
      fill = v;
      log.push("fillStyle=" + String(v));
    },
  });
  for (const pr of ["strokeStyle", "lineWidth", "font", "textAlign"]) {
    Object.defineProperty(ctx, pr, { get: () => undefined, set: () => undefined });
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log };
}

describe("lit lamp painters", () => {
  it("paint the warm glow and head at full night, and neither at noon", () => {
    for (const [painter, w, h] of [
      [drawPlazaLamp, 84, 84],
      [drawStreetLamp, 88, 79],
    ] as const) {
      const night = spyCtx();
      painter(night.ctx, w, h, 1);
      expect(night.log.some((l) => l.startsWith("fillStyle=rgba(255, 214, 140"))).toBe(true);
      expect(night.log).toContain("fillStyle=#ffd890");
      const noon = spyCtx();
      painter(noon.ctx, w, h, 0);
      expect(noon.log.some((l) => l.startsWith("fillStyle=rgba"))).toBe(false);
      expect(noon.log).toContain("fillStyle=#55555e");
    }
  });
});
