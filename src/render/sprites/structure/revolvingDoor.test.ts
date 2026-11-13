import { describe, expect, it } from "vitest";
import {
  DOOR_HEIGHT,
  DOOR_RADIUS,
  drawRevolvingDoorBack,
  drawRevolvingDoorFront,
  drawRevolvingDoorMiddle,
  insideDrum,
  QUARTER_TURN,
  turnDoor,
} from "./revolvingDoor";

/**
 * The revolving door between lobby halls of different heights (#2068): it
 * turns one way only, only while someone walks through it, and its wall
 * stands over the taller hall alone above the shorter hall's ceiling.
 */

/** A 2D context that records each filled rectangle as `[fill, x, y, w, h]`. */
function recorded(draw: (ctx: CanvasRenderingContext2D) => void): [string, number, number, number, number][] {
  const log: [string, number, number, number, number][] = [];
  let fill = "";
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, prop) => {
      if (prop === "fillRect") return (x: number, y: number, w: number, h: number) => void log.push([fill, x, y, w, h]);
      return () => {};
    },
    set: (_t, prop, value) => {
      if (prop === "fillStyle") fill = String(value);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  draw(ctx);
  return log;
}

const CX = 15;
const FOOT = 132;
const DAY_WALL = "#D8CDB6";
const BRASS = "#C9A24B";

describe("turnDoor", () => {
  it("stands still while the drum is empty", () => {
    expect(turnDoor(0.4, false, 30, 1)).toBe(0.4);
  });

  it("turns at the pace of a walker pushing a wing at its tip, the same way whichever way they walk", () => {
    expect(turnDoor(0.4, true, 6, 0.5)).toBeCloseTo(0.4 + 3 / DOOR_RADIUS, 9);
    expect(turnDoor(0.4, true, -6, 0.5)).toBeCloseTo(0.4 + 3 / DOOR_RADIUS, 9);
  });

  it("wraps after a full turn", () => {
    const turned = turnDoor(4 * QUARTER_TURN - 0.1, true, DOOR_RADIUS * 0.3, 1);
    expect(turned).toBeCloseTo(0.2, 9);
  });
});

describe("insideDrum", () => {
  it("holds a person whose middle is within the drum's radius", () => {
    expect(insideDrum(100, 100 + DOOR_RADIUS - 4, 8)).toBe(true);
    expect(insideDrum(100, 100 + DOOR_RADIUS - 3, 8)).toBe(false);
    expect(insideDrum(100, 100 - DOOR_RADIUS - 4, 8)).toBe(true);
    expect(insideDrum(100, 100 - DOOR_RADIUS - 5, 8)).toBe(false);
  });
});

describe("drawRevolvingDoorBack", () => {
  /** The wall's rectangles that reach above row `y`. */
  const wallAbove = (log: ReturnType<typeof recorded>, y: number) => log.filter(([fill, , top]) => fill === DAY_WALL && top < y);

  it("stands the wall over the taller hall alone above the shorter hall's ceiling", () => {
    const stepY = 45;
    for (const side of [-1, 1] as const) {
      const log = recorded((ctx) => drawRevolvingDoorBack(ctx, CX, FOOT, 0, 0.3, false, { y: stepY, side }));
      const above = wallAbove(log, stepY);
      expect(above, `side ${side}`).toHaveLength(1);
      const [, x, top, w, h] = above[0];
      expect([top, top + h]).toEqual([0, stepY]);
      // Left of the post for a taller left hall, right of it for a taller right one.
      expect(side < 0 ? x + w - 1 : x, `side ${side}`).toBe(CX);
      expect(side < 0 ? x : x + w - 1, `side ${side}`).toBe(side < 0 ? CX - 2 : CX + 2);
    }
  });

  it("runs the full wall from the ceiling to the canopy with no step", () => {
    const log = recorded((ctx) => drawRevolvingDoorBack(ctx, CX, FOOT, 0, 0.3, false));
    const walls = log.filter(([fill]) => fill === DAY_WALL);
    expect(walls).toHaveLength(1);
    const [, x, top, w, h] = walls[0];
    expect([x, w, top]).toEqual([CX - 2, 5, 0]);
    expect(top + h).toBe(FOOT - DOOR_HEIGHT - 4);
  });

  it("draws different back wings as the door turns, and the same picture a quarter turn on", () => {
    const at = (angle: number) => recorded((ctx) => drawRevolvingDoorBack(ctx, CX, FOOT, 0, angle, false));
    expect(at(0.3)).not.toEqual(at(0.6));
    expect(at(0.3 + QUARTER_TURN)).toEqual(at(0.3));
  });

  it("repaints in the night palette when the tower is lit", () => {
    const day = recorded((ctx) => drawRevolvingDoorBack(ctx, CX, FOOT, 0, 0.3, false)).map(([fill]) => fill);
    const night = recorded((ctx) => drawRevolvingDoorBack(ctx, CX, FOOT, 0, 0.3, true)).map(([fill]) => fill);
    expect(night).not.toEqual(day);
    expect(night).not.toContain(DAY_WALL);
  });
});

describe("drawRevolvingDoorMiddle and drawRevolvingDoorFront", () => {
  it("puts the brass push bar on the near wings only, over the center post", () => {
    const middle = recorded((ctx) => drawRevolvingDoorMiddle(ctx, CX, FOOT, 0.3, false));
    expect(middle[0]).toEqual(["#2A1C10", CX, FOOT - DOOR_HEIGHT, 1, DOOR_HEIGHT]);
    expect(middle.some(([fill]) => fill === BRASS)).toBe(true);
    const back = recorded((ctx) => drawRevolvingDoorBack(ctx, CX, FOOT, 0, 0.3, false));
    expect(back.some(([fill]) => fill === BRASS)).toBe(false);
  });

  it("frames the drum with posts just outside its radius and a canopy over it", () => {
    const front = recorded((ctx) => drawRevolvingDoorFront(ctx, CX, FOOT, false));
    const top = FOOT - DOOR_HEIGHT;
    expect(front).toContainEqual(["#6B4426", CX - DOOR_RADIUS - 1, top - 4, 2 * DOOR_RADIUS + 3, 4]);
    expect(front).toContainEqual(["#6B4426", CX - DOOR_RADIUS - 1, top, 1, DOOR_HEIGHT]);
    expect(front).toContainEqual(["#6B4426", CX + DOOR_RADIUS + 1, top, 1, DOOR_HEIGHT]);
  });
});
