import { describe, expect, it } from "vitest";
import { ROOM_EDGE, ROOM_LIGHT, shadeRoom, shadesRoom } from "./roomShading";
import type { UnitState } from "../shared/types";

describe("Modern's room shading (#2097)", () => {
  it("shades a room only in Modern's look and only while someone is there", () => {
    const present: UnitState[] = ["occupied", "asleep", "moving_in", "vacating"];
    for (const state of present) {
      expect(shadesRoom(true, { state })).toBe(true);
      expect(shadesRoom(false, { state }), `Classic stays flat (${state})`).toBe(false);
    }
    // A state read by its color keeps that color.
    for (const state of ["vacant", "construction", "fire", "gutted"] as UnitState[]) expect(shadesRoom(true, { state })).toBe(false);
  });

  it("lights from above and the left, inside the room's rect", () => {
    const stops: [number, string][] = [];
    const rects: { x: number; y: number; w: number; h: number; style: unknown }[] = [];
    const gradient = { addColorStop: (at: number, c: string) => stops.push([at, c]) };
    const ctx = {
      fillStyle: "" as unknown,
      save() {},
      restore() {},
      createLinearGradient: () => gradient,
      fillRect(x: number, y: number, w: number, h: number) {
        rects.push({ x, y, w, h, style: ctx.fillStyle });
      },
    };
    shadeRoom(ctx as unknown as CanvasRenderingContext2D, 40, 90, 120, 45);
    expect(stops[0]).toEqual([0, ROOM_LIGHT.ceiling]);
    expect(stops[stops.length - 1]).toEqual([1, ROOM_LIGHT.floor]);
    expect(rects.find((r) => r.style === ROOM_EDGE.lit)).toMatchObject({ x: 40, w: 1 });
    expect(rects.find((r) => r.style === ROOM_EDGE.shaded)).toMatchObject({ x: 40 + 120 - 2, w: 2 });
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(40);
      expect(r.x + r.w).toBeLessThanOrEqual(160);
      expect(r.y).toBeGreaterThanOrEqual(90);
      expect(r.y + r.h).toBeLessThanOrEqual(135);
    }
  });
});
