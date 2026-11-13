import { describe, it, expect } from "vitest";
import { ON_THE_ESCAPE } from "./guardPosition";
import { FLOOR } from "../scale";
import { VIEW_ZOOM_MIN } from "../../shared/viewZoom";
import { drawSearchGuard, drawThief, FIGURE_HEIGHT } from "../sprites/events";
import { STAFF_LOOK } from "../pixelSprites/people";
import { drawOverlay, floorFigureScale, floorRoomSpan, guardPosition } from "./towerOverlay";

/**
 * The bomb search's guards and the thief walk a floor, so each must fit
 * inside one floor at every camera zoom. A fixed minimum size once drew the
 * guards several floors tall on a zoomed-out phone. The painters run against
 * a context that records each fillRect, so the assertions measure what was
 * drawn.
 */

interface Rect {
  y: number;
  h: number;
  style: string;
}

/** A 2D context stand-in that records every filled rectangle and the fill
 *  style it was drawn in; every other call is a no-op. */
function rectCtx(): { ctx: CanvasRenderingContext2D; rects: Rect[] } {
  const rects: Rect[] = [];
  let style = "";
  const noop = (): void => {};
  const ctx: any = new Proxy(
    {
      fillRect: (_x: number, y: number, _w: number, h: number) => rects.push({ y, h, style }),
      measureText: () => ({ width: 10 }),
      createLinearGradient: () => ({ addColorStop: noop }),
    },
    {
      get: (target: any, key: string) => {
        if (key in target) return target[key];
        return key === "fillStyle" ? style : noop;
      },
      set: (_t, key: string, value) => {
        if (key === "fillStyle") style = String(value);
        return true;
      },
    },
  );
  return { ctx: ctx as CanvasRenderingContext2D, rects };
}

/** The screen height a set of rectangles covers, top to bottom. Nothing
 *  drawn fails the test, so a figure that stops drawing cannot pass as one
 *  that fits. */
function extent(rects: ReadonlyArray<Rect>): number {
  expect(rects.length).toBeGreaterThan(0);
  const top = Math.min(...rects.map((r) => r.y));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return bottom - top;
}

const ZOOMS = [VIEW_ZOOM_MIN, 0.1, 0.25, 0.5, 1, 2, 4];
/** Whole-pixel rounding can add a pixel at each end of a tiny figure. */
const ROUNDING = 2;

describe("a figure walking a floor fits inside it at every zoom", () => {
  it("is sized by the camera zoom, the same as the crowd", () => {
    for (const zoom of ZOOMS) expect(floorFigureScale(zoom)).toBe(zoom);
  });

  it("is shorter than a floor at size 1", () => {
    expect(FIGURE_HEIGHT).toBeLessThan(FLOOR);
  });

  it("draws a search guard no taller than one floor", () => {
    for (const zoom of ZOOMS) {
      const { ctx, rects } = rectCtx();
      drawSearchGuard(ctx, 100, 300, floorFigureScale(zoom));
      expect(extent(rects), `zoom ${zoom}`).toBeLessThanOrEqual(FLOOR * zoom + ROUNDING);
    }
  });

  it("draws a caught thief and his guard no taller than one floor", () => {
    for (const zoom of ZOOMS) {
      const { ctx, rects } = rectCtx();
      drawThief(ctx, 100, 300, floorFigureScale(zoom), true);
      // Both figures drew: the thief's dark top and the guard's navy uniform.
      expect(rects.some((r) => r.style === STAFF_LOOK.thief.top)).toBe(true);
      expect(rects.some((r) => r.style === STAFF_LOOK.security.top)).toBe(true);
      expect(extent(rects), `zoom ${zoom}`).toBeLessThanOrEqual(FLOOR * zoom + ROUNDING);
    }
  });

  it("keeps the guards the overlay draws during a search inside their floor when zoomed out", () => {
    const zoom = 0.1;
    const { ctx, rects } = rectCtx();
    const sweeping = [{ floor: 5, left: 160, right: 200, from: 5, route: [], start: 0, arrive: 0, done: 40 }];
    const engine: any = {
      viewWidth: 800,
      viewHeight: 600,
      overlayCanvas: { width: 800, height: 600 },
      cam: { zoom },
      d: { anim: 0 },
      reducedMotion: true,
      explosions: [],
      treasures: [],
      vipStart: null,
      thiefStart: null,
      preview: null,
      transportPreview: null,
      selectedId: null,
      arrowHit: {},
      sim: {
        mode: "classic",
        weather: "clear",
        clock: { hour: 12, minutes: 20 },
        bombSearch: { deadline: 600, sweeping, searched: [], seq: 1 },
        tower: { revision: 1, mealOverlayRevision: 0, transports: [], getUnit: () => undefined, getTransport: () => undefined, facilityOf: () => ({ width: 3 }) },
      },
      worldToScreenX: (tile: number) => tile * 10 * zoom,
      worldToScreenY: (floor: number) => 300 - floor * FLOOR * zoom,
      screenToFloor: (sy: number) => (300 - sy) / (FLOOR * zoom),
    };
    drawOverlay(engine, ctx);
    // The navy uniform is the guard's own color (its torso and its cap).
    const uniform = rects.filter((r) => r.style === STAFF_LOOK.security.top);
    expect(uniform.length).toBeGreaterThan(0);
    expect(extent(uniform)).toBeLessThanOrEqual(FLOOR * zoom + ROUNDING);
  });
});

describe("a guard crossing to another tower on the lot", () => {
  // Off from floor 4 of the left tower (stairs at tile 100) at minute 0,
  // down 3 floors to the shared lobby on 1, over to the right tower's stairs
  // (tile 200) and up 4 to floor 5 (rooms from tile 210): 7 floors of
  // stairs, 14 minutes.
  const g = {
    floor: 5, left: 210, right: 219, from: 4, start: 0, arrive: 14, done: 18.5,
    route: [[4, 100], [1, 100], [1, 200], [5, 200]] as const,
  };

  it("walks down its own tower's stairs to the lobby first", () => {
    expect(guardPosition(g, 0)).toEqual({ floor: 4, x: 100 - ON_THE_ESCAPE, climbing: true });
    expect(guardPosition(g, 4)).toEqual({ floor: 2, x: 100 - ON_THE_ESCAPE, climbing: true });
  });

  it("then climbs the other tower's stairs, never the sky between them", () => {
    expect(guardPosition(g, 6)).toEqual({ floor: 1, x: 200 - ON_THE_ESCAPE, climbing: true });
    expect(guardPosition(g, 8)).toEqual({ floor: 2, x: 200 - ON_THE_ESCAPE, climbing: true });
    expect(guardPosition(g, 12)).toEqual({ floor: 4, x: 200 - ON_THE_ESCAPE, climbing: true });
    expect(guardPosition(g, 14)).toEqual({ floor: 5, x: 210, climbing: false });
  });

  it("follows a route that turns back more than once", () => {
    // Up 1 to a bridge on 6, over to the middle tower, down 3 to a bridge
    // on 3, over to the right tower and up 2: 6 floors, 12 minutes.
    const zigzag = {
      ...g, from: 5, arrive: 12, done: 20,
      route: [[5, 100], [6, 100], [6, 200], [3, 200], [3, 300], [5, 300]] as const,
    };
    expect(guardPosition(zigzag, 1)).toEqual({ floor: 5.5, x: 100 - ON_THE_ESCAPE, climbing: true });
    expect(guardPosition(zigzag, 4)).toEqual({ floor: 5, x: 200 - ON_THE_ESCAPE, climbing: true });
    expect(guardPosition(zigzag, 9)).toEqual({ floor: 3.5, x: 300 - ON_THE_ESCAPE, climbing: true });
  });
});

describe("a thief on a lot with several towers runs his own tower's rooms", () => {
  // Floor 4 holds two towers' floor tiles (100 to 139 and 200 to 239) with
  // an office in each; the lobby on 1 runs under both.
  const units = [
    { kind: "lobby", floor: 1, x: 100, width: 140 },
    { kind: "floor", floor: 4, x: 100, width: 40 },
    { kind: "floor", floor: 4, x: 200, width: 40 },
    { kind: "office", floor: 4, x: 110, width: 9 },
    { kind: "office", floor: 4, x: 220, width: 9 },
  ] as const;

  it("keeps to the tower that holds his tile", () => {
    expect(floorRoomSpan(units, 4, 200)).toEqual({ left: 220, right: 229 });
    expect(floorRoomSpan(units, 4, 100)).toEqual({ left: 110, right: 119 });
  });

  it("runs the whole floor when the host gives no tile, or one off every tower", () => {
    expect(floorRoomSpan(units, 4)).toEqual({ left: 110, right: 229 });
    expect(floorRoomSpan(units, 4, 170)).toEqual({ left: 110, right: 229 });
  });

  it("reads floor tiles one per unit as one run", () => {
    const tiles = [
      ...Array.from({ length: 40 }, (_, i) => ({ kind: "floor" as const, floor: 4, x: 200 + i, width: 1 })),
      ...Array.from({ length: 40 }, (_, i) => ({ kind: "floor" as const, floor: 4, x: 100 + i, width: 1 })),
      { kind: "office" as const, floor: 4, x: 110, width: 9 },
      { kind: "office" as const, floor: 4, x: 220, width: 9 },
    ];
    expect(floorRoomSpan(tiles, 4, 239)).toEqual({ left: 220, right: 229 });
  });
});
