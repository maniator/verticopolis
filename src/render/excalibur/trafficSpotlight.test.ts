import { describe, it, expect, vi } from "vitest";
import { drawTrafficSpotlight, spotlightAlpha, spotlightTraffic, SPOTLIGHT_MS, trafficSpotlightFloor } from "./trafficSpotlight";
import type { TowerEngine } from "./TowerEngine";
import { FLOOR, TILE } from "../scale";

/** A spy canvas and an engine with an identity-ish camera. */
function setup(reducedMotion = false) {
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    setLineDash: vi.fn(),
    globalAlpha: 1,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
  };
  const engine = {
    cam: { zoom: 1 },
    reducedMotion,
    worldToScreenX: (tile: number) => tile * TILE,
    worldToScreenY: (floor: number) => -floor * FLOOR,
  } as unknown as TowerEngine;
  return { ctx, engine, c: ctx as unknown as CanvasRenderingContext2D };
}

describe("spotlightAlpha", () => {
  it("pulses while up, holds steady under reduced motion, fades at the end and is gone after", () => {
    expect(spotlightAlpha(0, false)).toBeCloseTo(1);
    expect(spotlightAlpha(1000 / 3, false)).toBeLessThan(1); // mid-pulse
    expect(spotlightAlpha(1000 / 3, true)).toBe(1);
    expect(spotlightAlpha(SPOTLIGHT_MS - 300, true)).toBeCloseTo(0.5);
    expect(spotlightAlpha(SPOTLIGHT_MS + 1, true)).toBe(0);
    expect(spotlightAlpha(-1, true)).toBe(0);
  });
});

describe("drawTrafficSpotlight", () => {
  it("bands the line's stretch, outlines its elevator on that floor only, and drops itself once over", () => {
    const { ctx, engine, c } = setup(true);
    drawTrafficSpotlight(engine, c, 0);
    expect(ctx.fillRect).not.toHaveBeenCalled(); // nothing up yet
    spotlightTraffic(engine, -1, { x: 36, width: 11 }, { x: 40, width: 4 }, 1000);
    drawTrafficSpotlight(engine, c, 1500);
    // B2's row from the line's left end, 11 tiles: never the whole lot.
    expect(ctx.fillRect).toHaveBeenCalledExactlyOnceWith(36 * TILE, FLOOR, 11 * TILE, FLOOR);
    // The elevator, one floor tall: never the whole shaft.
    expect(ctx.strokeRect).toHaveBeenLastCalledWith(40 * TILE - 2, FLOOR - 2, 4 * TILE + 4, FLOOR + 4);
    expect(trafficSpotlightFloor(engine)).toBe(-1);
    drawTrafficSpotlight(engine, c, 1000 + SPOTLIGHT_MS + 1);
    expect(trafficSpotlightFloor(engine)).toBeNull();
  });
});
