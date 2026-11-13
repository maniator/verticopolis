import { describe, expect, it } from "vitest";
import type { FloorEdge } from "../facadeGeometry";
import { clipToOpenSky, firstRunAtOrAbove, setRainShelter, shelterRuns } from "./rainShelter";
import { drawRain } from "./towerOverlay";
import { RAIN } from "../sprites/sky";
import type { TowerEngine } from "./TowerEngine";

/**
 * The rain's clip (#638): the open sky above the ground line, less the
 * building's floor runs. A recording context logs the path it is given; the
 * fake engine maps a tile to 10px and a floor to 20px, with the ground line at
 * y 300 and tile 0 at x 100.
 */

const TILE_PX = 10;
const FLOOR_PX = 20;

function fakeEngine(ground = 300): TowerEngine {
  return {
    worldToScreenX: (tile: number) => 100 + tile * TILE_PX,
    worldToScreenY: (floor: number) => ground - floor * FLOOR_PX,
  } as unknown as TowerEngine;
}

function recorder() {
  const calls: string[] = [];
  const ctx = {
    beginPath: () => calls.push("beginPath"),
    rect: (x: number, y: number, w: number, h: number) => calls.push(`rect ${x} ${y} ${w} ${h}`),
    clip: (rule: string) => calls.push(`clip ${rule}`),
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    fillRect: () => calls.push("fillRect"),
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => calls.push("stroke"),
    set fillStyle(v: string) {
      calls.push(`fillStyle ${v}`);
    },
    set strokeStyle(_: string) {},
    set lineWidth(_: number) {},
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

const runs = (rows: Record<number, FloorEdge[]>) => new Map(Object.entries(rows).map(([f, row]) => [Number(f), row]));

describe("shelterRuns", () => {
  it("flattens every floor's runs into floor, first tile, end tile", () => {
    const flat = shelterRuns(runs({ 1: [{ min: 0, max: 8 }, { min: 12, max: 20 }], 2: [{ min: 2, max: 6 }] }));
    expect([...flat]).toEqual([1, 0, 8, 1, 12, 20, 2, 2, 6]);
  });

  it("orders the rows by floor whatever order the map holds them in", () => {
    const flat = shelterRuns(new Map([[5, [{ min: 0, max: 2 }]], [1, [{ min: 3, max: 4 }]], [3, [{ min: 6, max: 9 }]]]));
    expect([...flat]).toEqual([1, 3, 4, 3, 6, 9, 5, 0, 2]);
  });

  it("finds the first run on a floor or above by binary search", () => {
    const flat = shelterRuns(runs({ 1: [{ min: 0, max: 8 }, { min: 12, max: 20 }], 4: [{ min: 2, max: 6 }], 9: [{ min: 1, max: 3 }] }));
    expect(firstRunAtOrAbove(flat, -3)).toBe(0);
    expect(firstRunAtOrAbove(flat, 1)).toBe(0);
    expect(firstRunAtOrAbove(flat, 2)).toBe(6); // floor 4's run
    expect(firstRunAtOrAbove(flat, 9)).toBe(9);
    expect(firstRunAtOrAbove(flat, 10)).toBe(flat.length);
  });
});

describe("clipToOpenSky", () => {
  it("cuts each on-screen run of the building out of the sky above the ground", () => {
    const engine = fakeEngine();
    setRainShelter(engine, runs({ 1: [{ min: 0, max: 8 }], 2: [{ min: 2, max: 6 }] }));
    const { ctx, calls } = recorder();
    expect(clipToOpenSky(engine, ctx, 800, 600)).toBe(true);
    expect(calls).toEqual([
      "beginPath",
      "rect 0 0 800 300", // the sky stops at the ground line, so no rain underground
      "rect 100 280 80 20", // floor 1, tiles 0 to 8
      "rect 120 260 40 20", // floor 2, tiles 2 to 6
      "clip evenodd",
    ]);
  });

  it("lets rain fall on the whole sky before the tower has any runs", () => {
    const { ctx, calls } = recorder();
    expect(clipToOpenSky(fakeEngine(), ctx, 800, 600)).toBe(true);
    expect(calls).toEqual(["beginPath", "rect 0 0 800 300", "clip evenodd"]);
  });

  it("skips a run that is off screen", () => {
    const engine = fakeEngine();
    // Floor 20 sits at y -100 to -80, above the view; floor 1's second run
    // starts past the right edge.
    setRainShelter(engine, runs({ 1: [{ min: 0, max: 8 }, { min: 80, max: 90 }], 20: [{ min: 0, max: 8 }] }));
    const { ctx, calls } = recorder();
    clipToOpenSky(engine, ctx, 800, 600);
    expect(calls.filter((c) => c.startsWith("rect"))).toEqual(["rect 0 0 800 300", "rect 100 280 80 20"]);
  });

  it("keeps the rows that touch the view's top and bottom edges and no others", () => {
    // Ground at y 900 under a 600px view: floor 16 spans y 580 to 600 and
    // floor 45 spans 0 to 20, the last rows in view; 15 and 46 lie just past.
    const engine = fakeEngine(900);
    const row = [{ min: 0, max: 1 }];
    setRainShelter(engine, runs({ 1: row, 15: row, 16: row, 45: row, 46: row, 90: row }));
    const { ctx, calls } = recorder();
    clipToOpenSky(engine, ctx, 800, 600);
    expect(calls.filter((c) => c.startsWith("rect"))).toEqual(["rect 0 0 800 600", "rect 100 580 10 20", "rect 100 0 10 20"]);
  });

  it("clips nothing and draws no rain when the view is all underground", () => {
    const { ctx, calls } = recorder();
    expect(clipToOpenSky(fakeEngine(-40), ctx, 800, 600)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("keeps the sky rect inside the view when the ground is below it", () => {
    const { ctx, calls } = recorder();
    clipToOpenSky(fakeEngine(900), ctx, 800, 600);
    expect(calls[1]).toBe("rect 0 0 800 600");
  });
});

describe("drawRain", () => {
  const rainy = (ground: number) =>
    Object.assign(fakeEngine(ground), { sim: { weather: "rain" }, viewWidth: 800, viewHeight: 600, d: { anim: 0 } }) as unknown as TowerEngine;

  it("lays the tint and the streaks inside the open-sky clip, then lifts it", () => {
    const { ctx, calls } = recorder();
    drawRain(rainy(300), ctx);
    const step = (c: string) => calls.indexOf(c);
    expect(step("save")).toBe(0);
    expect(step("clip evenodd")).toBeGreaterThan(step("save"));
    expect(step(`fillStyle ${RAIN.tint}`), "the tint comes after the clip").toBeGreaterThan(step("clip evenodd"));
    expect(step("stroke")).toBeGreaterThan(step(`fillStyle ${RAIN.tint}`));
    expect(calls[calls.length - 1], "and the clip is lifted").toBe("restore");
  });

  it("paints nothing over a view of the basements", () => {
    const { ctx, calls } = recorder();
    drawRain(rainy(-40), ctx);
    expect(calls).toEqual(["save", "restore"]);
  });
});
