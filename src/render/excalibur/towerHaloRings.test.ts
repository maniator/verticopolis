import { describe, expect, it, vi } from "vitest";
import type { CatalogHalo } from "../../catalog/catalogTypes";
import { FLOOR, TILE } from "../scale";
import { drawHaloRings, haloStrength, storyDistance, type RingView } from "./towerHaloRings";

/**
 * The placement range rings (#1980), painted against a recording context: one
 * band per floor the halo reaches, faded as the engine fades it, inside the
 * lot and the tower's floor range, then one dashed outline.
 */

const GYM: CatalogHalo = { effect: "lift", floors: 5, max: 0.03, capLift: 0.15, feltBy: ["condo"], openHoursOnly: false, familyScaled: false };
const CLUB: CatalogHalo = { effect: "drain", floors: 4, max: 0.12, capLift: null, feltBy: ["condo"], openHoursOnly: true, familyScaled: false };
const POOL: CatalogHalo = { effect: "lift", floors: 6, max: 0.035, capLift: 0.15, feltBy: ["condo"], openHoursOnly: false, familyScaled: false };
const WORLD = { lotWidth: 375, minFloor: -9, maxFloor: 100 };

/** A context that records each band's fill (alpha and rect) and the outline. */
function recorder() {
  const bands: { alpha: number; y: number; w: number; h: number; color: string }[] = [];
  const state = { globalAlpha: 1, fillStyle: "", strokeStyle: "" };
  const ctx = {
    ...state,
    lineWidth: 1,
    fillRect: vi.fn((_x: number, y: number, w: number, h: number) => bands.push({ alpha: ctx.globalAlpha, y, w, h, color: ctx.fillStyle })),
    strokeRect: vi.fn(),
    setLineDash: vi.fn(),
  };
  return { ctx, bands };
}

/** Zoom 2, floor `f`'s top edge at y = -f * 100, the lot's left edge at x 10. */
const VIEW: RingView = { worldToScreenX: (x) => 10 + x, worldToScreenY: (f) => -f * 100, cam: { zoom: 2 } };

describe("placement range rings", () => {
  it("fades a halo from full on its own floor to nothing at its reach", () => {
    expect(haloStrength(GYM, 0)).toBe(1);
    expect(haloStrength(GYM, 1)).toBeCloseTo(0.8);
    expect(haloStrength(GYM, 4)).toBeCloseTo(0.2);
    expect(haloStrength(GYM, 5)).toBe(0);
  });

  it("paints a band for every floor a lift reaches, full width, faded by distance, then a dashed outline", () => {
    const { ctx, bands } = recorder();
    drawHaloRings(ctx as unknown as CanvasRenderingContext2D, GYM, 20, 1, WORLD, VIEW);
    // Floors 16 to 24: four either side of the gym's own.
    expect(bands.map((b) => b.y)).toEqual([16, 17, 18, 19, 20, 21, 22, 23, 24].map((f) => -f * 100));
    expect(bands.every((b) => b.w === WORLD.lotWidth * TILE * 2 && b.h === FLOOR * 2 && b.color === "#4fcf86")).toBe(true);
    const own = bands[4].alpha;
    expect(bands.map((b) => b.alpha / own)).toEqual([0.2, 0.4, 0.6, 0.8, 1, 0.8, 0.6, 0.4, 0.2].map((v) => expect.closeTo(v, 9)));
    expect(ctx.setLineDash).toHaveBeenNthCalledWith(1, [6, 4]);
    expect(ctx.strokeRect).toHaveBeenCalledWith(10.5, -24 * 100 + 0.5, WORLD.lotWidth * TILE * 2 - 1, 9 * FLOOR * 2 - 1);
    expect(ctx.setLineDash).toHaveBeenLastCalledWith([]);
    expect(ctx.globalAlpha).toBe(1);
  });

  it("paints a drain violet and keeps its bands inside the tower's floors", () => {
    const { ctx, bands } = recorder();
    drawHaloRings(ctx as unknown as CanvasRenderingContext2D, CLUB, -8, 1, WORLD, VIEW);
    // Three floors either side, but none below B10 (floor -9).
    expect(bands.map((b) => b.y)).toEqual([-9, -8, -7, -6, -5].map((f) => -f * 100));
    expect(bands.every((b) => b.color === "#a46ad8")).toBe(true);
  });

  it("counts a two-story venue's reach from its nearer story", () => {
    expect([18, 19, 20, 21, 22].map((f) => storyDistance(f, 20, 2))).toEqual([2, 1, 0, 0, 1]);
    const { ctx, bands } = recorder();
    drawHaloRings(ctx as unknown as CanvasRenderingContext2D, POOL, 20, 2, WORLD, VIEW);
    // Floors 15 to 26: five either side of the pool's two stories, both at full.
    expect(bands.map((b) => b.y)).toEqual([15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26].map((f) => -f * 100));
    const own = bands[5].alpha;
    expect(bands[6].alpha).toBe(own);
    expect(bands[4].alpha / own).toBeCloseTo(5 / 6, 9);
    expect(bands[7].alpha / own).toBeCloseTo(5 / 6, 9);
    expect(ctx.strokeRect).toHaveBeenCalledWith(10.5, -26 * 100 + 0.5, WORLD.lotWidth * TILE * 2 - 1, 12 * FLOOR * 2 - 1);
  });
});
