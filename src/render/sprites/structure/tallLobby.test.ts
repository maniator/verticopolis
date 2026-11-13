import { describe, expect, it } from "vitest";
import type { DrawCtx } from "../common";
import { consolePanel, drawLobbyTile, ENTRANCE_GRAND_SOLO, ENTRANCE_SERVICE, LOBBY_VARIANTS } from "./lobby";
import { drawTallLobbyEntrance, drawTallLobbyTile } from "./tallLobby";
import { archedWindow, globePendants } from "./tallLobbyPieces";

/**
 * Tall lobby slices (#308): one open hall over all its stories. One gilded
 * cornice at the top, one floor at the bottom and nothing between them; the
 * tall pieces run the hall's height and the furniture keeps its one-story size.
 */

const TILE = 10;
const STORY = 45;

/** A 2D context that records each filled rectangle with its fill color. */
function recordingCtx() {
  const log: string[] = [];
  let fill = "";
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, prop) => {
      if (prop === "fillRect") return (x: number, y: number, w: number, h: number) => void log.push(`${fill} ${x},${y} ${w}x${h}`);
      if (prop === "rect") return (x: number, y: number, w: number, h: number) => void log.push(`clip ${x},${y} ${w}x${h}`);
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => ({ addColorStop: () => {} });
      if (prop === "measureText") return () => ({ width: 10 });
      return () => {};
    },
    set: (_t, prop, value) => {
      if (prop === "fillStyle") fill = typeof value === "string" ? value : "gradient";
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { d: { ctx, lit: false, anim: 0, hour: 12 } as DrawCtx, log };
}

function drawn(draw: (d: DrawCtx) => void, lit = false): string[] {
  const r = recordingCtx();
  r.d.lit = lit;
  draw(r.d);
  return r.log;
}

/** The rows a recorded rectangle covers, as `[top, bottom)`. */
function rows(r: string): [number, number] {
  const [, at, size] = r.split(" ");
  const y = Number(at.split(",")[1]);
  return [y, y + Number(size.split("x")[1])];
}

const ALL_VARIANTS = Array.from({ length: LOBBY_VARIANTS + 4 }, (_, v) => v);

describe("drawTallLobbyTile", () => {
  const Y = 90;

  it("draws a one-story lobby as the one-story tile, and clamps an out-of-range height to it", () => {
    const one = drawn((d) => drawLobbyTile(d, 20, Y, TILE, STORY, 1, true));
    expect(drawn((d) => drawTallLobbyTile(d, 20, Y, TILE, STORY, 1, true, 1))).toEqual(one);
    expect(drawn((d) => drawTallLobbyTile(d, 20, Y, TILE, STORY, 1, true, Number.NaN))).toEqual(one);
  });

  it("puts the gilded cornice on the hall's ceiling only, and caps a slice at three stories", () => {
    for (const ground of [true, false]) {
      for (let v = 0; v < LOBBY_VARIANTS; v++) {
        const slice = drawn((d) => drawTallLobbyTile(d, 20, Y, TILE, 3 * STORY, v, ground, 3));
        const cornices = slice.filter((r) => r.startsWith("#C9A24B") && r.endsWith(`${TILE}x3`));
        expect(cornices, `variant ${v}, ground ${ground}`).toEqual([`#C9A24B 20,${Y} ${TILE}x3`]);
      }
    }
    const four = drawn((d) => drawTallLobbyTile(d, 20, Y, TILE, 4 * STORY, 0, true, 4));
    expect(four).toEqual(drawn((d) => drawTallLobbyTile(d, 20, Y, TILE, 4 * STORY, 0, true, 3)));
  });

  it("lays one floor, at the bottom of the hall, with no slab between the stories", () => {
    for (const ground of [true, false]) {
      const band = ground ? "#DCD2B8" : "#CBC3B0";
      const slice = drawn((d) => drawTallLobbyTile(d, 0, Y, TILE, 3 * STORY, 0, ground, 3));
      expect(slice.filter((r) => r.startsWith(`${band} `) && r.endsWith(`${TILE}x5`))).toEqual([`${band} 0,${Y + 3 * STORY - 5} ${TILE}x5`]);
    }
  });

  it("runs the column from the ceiling to the floor, through every story", () => {
    const slice = drawn((d) => drawTallLobbyTile(d, 0, Y, TILE, 3 * STORY, 0, true, 3));
    const shaft = slice.find((r) => r.startsWith("#F1E8CE") && r.includes(" 3x"));
    expect(shaft).toBeDefined();
    const [top, bottom] = rows(shaft as string);
    expect(top).toBeLessThan(Y + 10);
    expect(bottom).toBeGreaterThan(Y + 3 * STORY - 10);
  });

  it("glazes the ground hall with one wide arched window over the second and third slots, each tile showing its half", () => {
    const frames = (v: number, ground: boolean) =>
      drawn((d) => drawTallLobbyTile(d, 0, Y, TILE, 3 * STORY, v, ground, 3))
        .filter((r) => r.startsWith("#C9A24B"))
        .filter((r) => rows(r)[1] - rows(r)[0] > STORY);
    const left = frames(1, true);
    const right = frames(2, true);
    expect(left).toHaveLength(1);
    // The same window, two tiles wide, drawn from the tile on its left.
    expect(left[0]).toMatch(new RegExp(`^#C9A24B 1,\\d+ ${2 * TILE - 2}x`));
    expect(right).toEqual([left[0].replace(" 1,", ` ${1 - TILE},`)]);
    for (const v of [1, 2]) {
      const clip = drawn((d) => drawTallLobbyTile(d, 0, Y, TILE, 3 * STORY, v, true, 3)).filter((r) => r.startsWith("clip"));
      expect(clip, `slot ${v}`).toEqual([`clip 0,${Y} ${TILE}x${2 * STORY + 4}`]);
    }
    // No window elsewhere downstairs, and none in a sky hall (its wall is glass).
    for (const v of [0, 3]) expect(frames(v, true), `slot ${v}`).toEqual([]);
    for (let v = 0; v < LOBBY_VARIANTS; v++) expect(frames(v, false), `sky slot ${v}`).toEqual([]);
  });

  it("stands the console on the hall's floor at its one-story size", () => {
    for (const ground of [true, false]) {
      const bottom = Y + 2 * STORY;
      const alone = drawn((d) => consolePanel(d.ctx, 0, TILE, bottom - STORY, bottom - 5, ground, false));
      const slice = drawn((d) => drawTallLobbyTile(d, 0, Y, TILE, 2 * STORY, 1, ground, 2));
      expect(alone.length).toBeGreaterThan(0);
      for (const r of alone) expect(slice).toContain(r);
    }
  });

  it("hangs the ground hall's chandelier on a chain from the ceiling into the open space", () => {
    const slice = drawn((d) => drawTallLobbyTile(d, 0, Y, TILE, 3 * STORY, 3, true, 3));
    const hang = Math.round(3 * STORY * 0.3);
    expect(slice).toContain(`#8A7430 ${TILE / 2},${Y + 3} 1x${hang}`);
  });

  it("lights a sky hall's globe pendants after dark", () => {
    const glow = (lit: boolean) =>
      drawn((d) => drawTallLobbyTile(d, 0, 0, TILE, 2 * STORY, 2, false, 2), lit).filter((r) => r.startsWith("#FBE7B8"));
    expect(glow(true)).toHaveLength(3);
    expect(glow(false)).toHaveLength(0);
  });

  it("draws every pattern slot and entrance, by day and by night, in both lobbies", () => {
    for (const v of ALL_VARIANTS) {
      for (const ground of [true, false]) {
        for (const lit of [true, false]) {
          const slice = drawn((d) => drawTallLobbyTile(d, 0, 0, TILE, 3 * STORY, v, ground, 3), lit);
          expect(slice.length, `variant ${v}, ground ${ground}, lit ${lit}`).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("drawTallLobbyEntrance", () => {
  it("draws an entrance slice as the ground lobby slice for its entrance kind", () => {
    const solo = drawn((d) => drawTallLobbyTile(d, 0, 0, TILE, 2 * STORY, ENTRANCE_GRAND_SOLO, true, 2));
    expect(drawn((d) => drawTallLobbyEntrance(d, "grand-solo", 0, 0, TILE, 2 * STORY, 2))).toEqual(solo);
    const service = drawn((d) => drawTallLobbyEntrance(d, "service", 0, 0, TILE, 2 * STORY, 2));
    expect(service).toEqual(drawn((d) => drawTallLobbyTile(d, 0, 0, TILE, 2 * STORY, ENTRANCE_SERVICE, true, 2)));
    expect(solo).not.toEqual(service);
  });

  it("stands the one-story entrance on the bottom story and carries the hall's wall over its cornice", () => {
    for (const kind of ["grand-solo", "service"] as const) {
      const variant = kind === "service" ? ENTRANCE_SERVICE : ENTRANCE_GRAND_SOLO;
      const lowY = STORY;
      const doors = drawn((d) => drawLobbyTile(d, 0, lowY, TILE, STORY, variant, true));
      const slice = drawn((d) => drawTallLobbyEntrance(d, kind, 0, 0, TILE, 2 * STORY, 2));
      const at = slice.findIndex((_, i) => doors.every((r, k) => slice[i + k] === r));
      expect(at, kind).toBeGreaterThan(0);
      // Drawn after the doors: a full-width wall down past the doors' cornice,
      // and the hall's one cornice at the top.
      const after = slice.slice(at + doors.length);
      expect(after.some((r) => r.includes(`0,`) && r.includes(` ${TILE}x`) && rows(r)[0] <= lowY && rows(r)[1] >= lowY + 4), kind).toBe(true);
      expect(after.filter((r) => r.startsWith("#C9A24B") && r.endsWith(`${TILE}x3`)), kind).toEqual([`#C9A24B 0,0 ${TILE}x3`]);
    }
  });
});

describe("tall lobby pieces", () => {
  it("draws no arched window too small to read", () => {
    expect(drawn((d) => archedWindow(d, 0, 0, 2, 40, true, 1))).toEqual([]);
    expect(drawn((d) => archedWindow(d, 0, 0, 8, 5, true, 1))).toEqual([]);
  });

  it("shows city lights through an arched window only after dark", () => {
    const lights = (lit: boolean) => drawn((d) => archedWindow(d, 0, 0, 8, 80, false, 7), lit).filter((r) => r.startsWith("#B89A62"));
    expect(lights(true).length).toBeGreaterThan(0);
    expect(lights(false)).toEqual([]);
  });

  it("hangs no pendants in a span too short for their cords", () => {
    expect(drawn((d) => globePendants(d, 5, 0, 9))).toEqual([]);
    expect(drawn((d) => globePendants(d, 5, 0, 40)).length).toBeGreaterThan(0);
  });
});
