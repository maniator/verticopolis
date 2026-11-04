import { describe, it, expect } from "vitest";
import type { FacilityKind } from "../../engine/types";
import { SKY_HEADROOM_FLOORS } from "../cameraBounds";
import { buildMapDrawList, type MapSource } from "./drawList";
import { fitLayout, mapExtent } from "./geometry";
import { paintMapMarks, type MapPaintContext, type PatternSource } from "./paint";

/**
 * Size and time budget for the overview map on a tower the size of the `large`
 * perf fixture (docs/performance/benchmark-protocol.md: 17,322 population,
 * 43,358 units, about 110 floor and lobby runs and about 2,900 rooms). The
 * source here is synthetic, so the test pins the algorithm's shape: the draw
 * list is as long as the runs, rooms and shafts and far shorter than the tower's
 * tiles, the painter changes style per kind, and one rebuild plus paint stays far
 * inside a frame. The real engine fixture, the real catalog height lookup and a
 * real canvas are measured by the Playwright perf run (S4).
 */

const ROOM_KINDS: FacilityKind[] = ["office", "condo", "hotelDouble", "restaurant", "shop", "cinema", "parking"];

function largeTower(): MapSource & { tiles: number } {
  const structure: MapSource["structure"][number][] = [];
  const rooms: MapSource["rooms"][number][] = [];
  const transports: MapSource["transports"][number][] = [];
  let tiles = 0;
  // 109 floors, one floor-run each (a lobby run on the ground), about 40,000 tiles.
  for (let floor = -9; floor <= 100; floor++) {
    const x = floor % 7 === 0 ? 20 : 0;
    const count = Math.floor((floor === 1 ? 375 : 360) / 9);
    structure.push({ kind: floor === 1 ? "lobby" : "floor", floor, x, width: 9, count });
    tiles += count * 9;
    // Hundreds of tiles of rooms per floor, about 27 rooms a floor.
    for (let i = 0; i < 27; i++) {
      rooms.push({ kind: ROOM_KINDS[(floor + 9 + i) % ROOM_KINDS.length], floor, x: x + i * 13, width: 9 });
    }
  }
  for (let i = 0; i < 24; i++) transports.push({ kind: "elevatorStandard", x: 14 * i, width: 4, bottom: -9, top: 100 });
  for (let i = 0; i < 64; i++) transports.push({ kind: "stairs", x: 5 * i, width: 2, bottom: i % 90, top: (i % 90) + 1 });
  return { structure, rooms, transports, floorsOf: (k) => (k === "cinema" ? 2 : 1), tiles };
}

const patterns: PatternSource = { get: (fill, pattern) => (pattern === "solid" ? fill : `${pattern}:${fill}`) };
function countingCtx(): MapPaintContext & { fills: number; styleSets: number } {
  let style: unknown = "";
  const c = {
    fills: 0,
    styleSets: 0,
    get fillStyle() {
      return style as string;
    },
    set fillStyle(v: string | CanvasGradient | CanvasPattern) {
      style = v;
      c.styleSets++;
    },
    fillRect() {
      c.fills++;
    },
    clearRect() {},
  };
  return c;
}

describe("overview map budget on a large tower", () => {
  const WORLD = { lotWidth: 375, minFloor: -9, maxFloor: 100 };
  const layout = fitLayout(mapExtent(WORLD, SKY_HEADROOM_FLOORS), 750, 660);
  const tower = largeTower();

  it("is a large tower: tens of thousands of tiles, thousands of marks", () => {
    expect(tower.tiles).toBeGreaterThan(30_000);
    expect(tower.structure.length + tower.rooms.length + tower.transports.length).toBeGreaterThan(3_000);
  });

  it("makes one mark per run, room and shaft, far fewer than the tower has tiles", () => {
    const marks = buildMapDrawList(layout, tower);
    expect(marks.length).toBeLessThanOrEqual(tower.structure.length + tower.rooms.length + tower.transports.length);
    expect(marks.length).toBeLessThan(tower.tiles / 8);
  });

  it("paints exactly one rectangle per mark", () => {
    const marks = buildMapDrawList(layout, tower);
    const ctx = countingCtx();
    expect(paintMapMarks(ctx, layout.width, layout.height, marks, patterns)).toBe(marks.length);
    expect(ctx.fills).toBe(marks.length);
  });

  it("changes the fill style about once per kind and layer, far less than once per room", () => {
    const marks = buildMapDrawList(layout, tower);
    const ctx = countingCtx();
    paintMapMarks(ctx, layout.width, layout.height, marks, patterns);
    const kinds = new Set(marks.map((m) => m.kind)).size;
    // Each kind has a patterned and a plain variant, and the shafts add a few switches.
    expect(ctx.styleSets).toBeLessThan(kinds * 2 + 3 * 8 + 90);
    expect(ctx.styleSets).toBeLessThan(marks.length / 10);
  });

  it("rebuilds and paints in a few milliseconds (median of 15 after a warm-up, generous CI ceiling)", () => {
    buildMapDrawList(layout, tower);
    const times: number[] = [];
    for (let i = 0; i < 15; i++) {
      const t0 = performance.now();
      const marks = buildMapDrawList(layout, tower);
      paintMapMarks(countingCtx(), layout.width, layout.height, marks, patterns);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];
    // Local runs take about a millisecond; the ceiling only catches an accidental per-tile or
    // quadratic change. The real-catalog and real-canvas cost is measured in the S4 perf run.
    expect(median).toBeLessThan(25);
  });
});
