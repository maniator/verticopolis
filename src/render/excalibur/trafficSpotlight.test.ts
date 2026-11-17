import { describe, it, expect, vi } from "vitest";
import { drawTrafficSpotlight, spotlightAlpha, spotlightTraffic, SPOTLIGHT_MS, trafficSpotlightFloor } from "./trafficSpotlight";
import type { TowerEngine } from "./TowerEngine";
import { FLOOR, TILE } from "../scale";

vi.mock("../../presentation/viewWorld", () => ({ viewWorld: () => ({ lotWidth: 100 }) }));

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
  it("bands the floor, outlines each shaft and drops itself once over", () => {
    const { ctx, engine, c } = setup(true);
    drawTrafficSpotlight(engine, c, 0);
    expect(ctx.fillRect).not.toHaveBeenCalled(); // nothing up yet
    spotlightTraffic(engine, -1, [{ x: 40, width: 4, bottom: -6, top: 30 }], 1000);
    drawTrafficSpotlight(engine, c, 1500);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, FLOOR, 100 * TILE, FLOOR); // B2's row across the lot
    expect(ctx.strokeRect).toHaveBeenCalledWith(40 * TILE - 2, -30 * FLOOR - 2, 4 * TILE + 4, 37 * FLOOR + 4); // the shaft
    expect(trafficSpotlightFloor(engine)).toBe(-1);
    drawTrafficSpotlight(engine, c, 1000 + SPOTLIGHT_MS + 1);
    expect(trafficSpotlightFloor(engine)).toBeNull();
  });
});
