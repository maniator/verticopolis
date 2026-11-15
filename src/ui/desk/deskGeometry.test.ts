import { describe, expect, it } from "vitest";
import { BULLETIN_HEIGHT, DESK_GAP, SHORT_DESK_BULLETIN_DROP, SHORT_DESK_BULLETIN_INSET, SIDE_COLUMN, TOOLS_LIMITS, TOOLS_WIDTH, TOWER_LIMITS, defaultLayout, fitRect, parseLayout, resizedTo } from "./deskGeometry";

/** Whether two windows overlap, given their sizes. */
function overlap(a: { x: number; y: number }, aw: number, ah: number, b: { x: number; y: number }, bw: number, bh: number): boolean {
  return a.x < b.x + bw && b.x < a.x + aw && a.y < b.y + bh && b.y < a.y + ah;
}

describe("defaultLayout", () => {
  it("keeps Info, the tower, the Map and the Bulletin apart on the smallest desk and on common ones", () => {
    for (const [w, h] of [[1024, 572], [1366, 740], [1920, 1052]]) {
      const l = defaultLayout(w, h, 90, 336);
      const info = { ...l.info, h: 90 };
      expect(overlap(info, info.w, info.h, l.tower, l.tower.w, l.tower.h), `${w}x${h}`).toBe(false);
      expect(overlap(info, info.w, info.h, l.map, SIDE_COLUMN, 336), `${w}x${h}`).toBe(false);
      expect(overlap(l.map, SIDE_COLUMN, 336, l.bulletin, SIDE_COLUMN, BULLETIN_HEIGHT), `${w}x${h}`).toBe(false);
      expect(l.bulletin.y + BULLETIN_HEIGHT).toBeLessThanOrEqual(h);
    }
  });

  it("lays Info across the top between Tools and the right column, the tower under it", () => {
    const l = defaultLayout(1440, 872, 70);
    expect(l.tools).toEqual({ x: DESK_GAP, y: DESK_GAP, w: TOOLS_WIDTH, h: 600 });
    expect(l.info).toEqual({ x: TOOLS_WIDTH + 2 * DESK_GAP, y: DESK_GAP, w: l.tower.w, h: 0 });
    expect(l.tower.x).toBe(l.info.x);
    expect(l.tower.y).toBe(70 + 2 * DESK_GAP);
    expect(l.tower.x + l.tower.w).toBe(l.map.x - DESK_GAP);
    expect(l.tower.y + l.tower.h).toBe(872 - DESK_GAP);
    expect(l.map).toEqual({ x: 1440 - SIDE_COLUMN - DESK_GAP, y: DESK_GAP, w: 0, h: 0 });
    expect(defaultLayout(1440, 872, 110).tower.y).toBe(110 + 2 * DESK_GAP);
  });

  it("opens the Bulletin over the tower's sky on a short desk, in its upper third", () => {
    for (const [w, h] of [[1024, 572], [1280, 560]]) {
      const l = defaultLayout(w, h, 90, 336);
      expect(l.bulletin.x, `${w}x${h}`).toBe(l.tower.x + SHORT_DESK_BULLETIN_INSET);
      expect(l.bulletin.x + SIDE_COLUMN, `${w}x${h}`).toBeLessThanOrEqual(l.map.x);
      expect(l.bulletin.y, `${w}x${h}`).toBe(l.tower.y + SHORT_DESK_BULLETIN_DROP);
      expect(l.bulletin.y, `${w}x${h}`).toBeLessThanOrEqual(l.tower.y + l.tower.h / 3);
    }
  });

  it("keeps the Bulletin under the Map in the column when the desk is tall enough", () => {
    const l = defaultLayout(1366, 740, 90, 336);
    expect(l.bulletin.x).toBe(l.map.x);
    expect(l.bulletin.y).toBeGreaterThanOrEqual(l.map.y + 336);
  });

  it("never makes the tower smaller than its limits on a small desk", () => {
    const l = defaultLayout(600, 200);
    expect(l.tower.w).toBe(TOWER_LIMITS.minW);
    expect(l.tower.h).toBe(TOWER_LIMITS.minH);
  });
});

describe("fitRect", () => {
  it("pulls a window saved on a bigger screen back onto the desk", () => {
    expect(fitRect({ x: 1800, y: 1200, w: 900, h: 700 }, 1024, 572, TOWER_LIMITS)).toEqual({ x: 124, y: 548, w: 900, h: 572 });
  });

  it("keeps a resizable window at its minimum size", () => {
    expect(fitRect({ x: 0, y: 0, w: 10, h: 10 }, 1440, 872, TOWER_LIMITS)).toEqual({ x: 0, y: 0, w: TOWER_LIMITS.minW, h: TOWER_LIMITS.minH });
  });

  it("leaves the size of a fixed-size window alone and moves only its corner", () => {
    expect(fitRect({ x: -40, y: -5, w: 0, h: 0 }, 1440, 872, null)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe("resizedTo", () => {
  const start = { x: 100, y: 50, w: 500, h: 400 };

  it("follows the drag within the desk and the limits", () => {
    expect(resizedTo(start, 80, -30, TOWER_LIMITS, 1440, 872, false)).toEqual({ x: 100, y: 50, w: 580, h: 370 });
    expect(resizedTo(start, 5000, 5000, TOWER_LIMITS, 1440, 872, false)).toEqual({ x: 100, y: 50, w: 1340, h: 822 });
    expect(resizedTo(start, -5000, -5000, TOWER_LIMITS, 1440, 872, false)).toEqual({ x: 100, y: 50, w: TOWER_LIMITS.minW, h: TOWER_LIMITS.minH });
  });

  it("keeps the width of a window that grows in height only (Tools)", () => {
    expect(resizedTo(start, 300, 100, TOOLS_LIMITS, 1440, 872, true)).toEqual({ x: 100, y: 50, w: 500, h: 500 });
  });
});

describe("parseLayout", () => {
  it("reads the saved windows and drops anything that is not a usable rectangle", () => {
    const raw = JSON.stringify({
      tower: { x: 10, y: 20, w: 800, h: 600 },
      map: { x: "1", y: 2, w: 3, h: 4 },
      info: { x: -1, y: 0, w: 0, h: 0 },
      tools: null,
      other: { x: 1, y: 1, w: 1, h: 1 },
    });
    expect(parseLayout(raw)).toEqual({ tower: { x: 10, y: 20, w: 800, h: 600 } });
  });

  it("opens the default layout for a missing or damaged store", () => {
    expect(parseLayout(null)).toEqual({});
    expect(parseLayout("{oops")).toEqual({});
    expect(parseLayout("42")).toEqual({});
  });
});
