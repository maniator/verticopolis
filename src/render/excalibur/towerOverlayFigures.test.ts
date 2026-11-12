import { describe, it, expect } from "vitest";
import { FLOOR } from "../scale";
import { VIEW_ZOOM_MIN } from "../../shared/viewZoom";
import { drawSearchGuard, drawThief, FIGURE_HEIGHT } from "../sprites/events";
import { drawOverlay, floorFigureScale } from "./towerOverlay";

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

/** The screen height a set of rectangles covers, top to bottom. */
function extent(rects: ReadonlyArray<Rect>): number {
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
      expect(extent(rects), `zoom ${zoom}`).toBeLessThanOrEqual(FLOOR * zoom + ROUNDING);
    }
  });

  it("keeps the guards the overlay draws during a search inside their floor when zoomed out", () => {
    const zoom = 0.1;
    const { ctx, rects } = rectCtx();
    const sweeping = [{ floor: 5, left: 160, right: 200, from: 5, start: 0, arrive: 0, done: 40 }];
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
    // The navy uniform is the guard's own color; nothing else is drawn in it.
    const uniform = rects.filter((r) => r.style === "#274B8F");
    expect(uniform.length).toBe(1);
    expect(uniform[0]!.h).toBeLessThanOrEqual(FLOOR * zoom);
  });
});
