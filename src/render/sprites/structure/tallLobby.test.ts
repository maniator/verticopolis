import { describe, expect, it } from "vitest";
import type { DrawCtx } from "../common";
import { drawLobbyTile, ENTRANCE_GRAND_SOLO, ENTRANCE_SERVICE, LOBBY_VARIANTS } from "./lobby";
import { drawTallLobbyEntrance, drawTallLobbyTile } from "./tallLobby";

/**
 * Tall lobby slices (#308): every story keeps the one-story lobby's scale, so
 * the bottom story is the one-story tile itself and each story above is a
 * mezzanine with the gilded cornice at its top and a railing at its foot.
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

const ALL_VARIANTS = Array.from({ length: LOBBY_VARIANTS + 4 }, (_, v) => v);

describe("drawTallLobbyTile", () => {
  it("draws a one-story lobby as the one-story tile, and clamps an out-of-range height to it", () => {
    const one = drawn((d) => drawLobbyTile(d, 20, 90, TILE, STORY, 1, true));
    expect(drawn((d) => drawTallLobbyTile(d, 20, 90, TILE, STORY, 1, true, 1))).toEqual(one);
    expect(drawn((d) => drawTallLobbyTile(d, 20, 90, TILE, STORY, 1, true, Number.NaN))).toEqual(one);
  });

  it("ends a tall slice with the one-story tile, unstretched, on the bottom story", () => {
    for (const stories of [2, 3]) {
      const bottom = drawn((d) => drawLobbyTile(d, 20, 90 + (stories - 1) * STORY, TILE, STORY, 2, false));
      const slice = drawn((d) => drawTallLobbyTile(d, 20, 90, TILE, stories * STORY, 2, false, stories));
      expect(slice.slice(-bottom.length)).toEqual(bottom);
      expect(slice.length).toBeGreaterThan(bottom.length);
    }
  });

  it("tops every upper story with the gilded cornice, and caps a slice at three stories", () => {
    const slice = drawn((d) => drawTallLobbyTile(d, 20, 90, TILE, 4 * STORY, 0, true, 4));
    // Four stories asked, three drawn: the story is a third of the height.
    const story = Math.round((4 * STORY) / 3);
    for (const k of [0, 1]) expect(slice).toContain(`#C9A24B 20,${90 + k * story} ${TILE}x3`);
    expect(slice).toEqual(drawn((d) => drawTallLobbyTile(d, 20, 90, TILE, 4 * STORY, 0, true, 3)));
  });

  it("rails the ground lobby's mezzanine with a gilded balustrade and a sky lobby's with glass on steel", () => {
    const railTop = 90 + STORY - 3 - 9;
    const ground = drawn((d) => drawTallLobbyTile(d, 0, 90, TILE, 2 * STORY, 0, true, 2));
    const sky = drawn((d) => drawTallLobbyTile(d, 0, 90, TILE, 2 * STORY, 0, false, 2));
    expect(ground).toContain(`#C9A24B 0,${railTop} ${TILE}x1`);
    expect(ground).not.toContain(`#8E959C 0,${railTop} ${TILE}x1`);
    expect(sky).toContain(`#8E959C 0,${railTop} ${TILE}x1`);
    expect(sky).not.toContain(`#C9A24B 0,${railTop} ${TILE}x1`);
  });

  it("gives a sky lobby planter boxes on the rail in the second and fourth pattern slots only", () => {
    const box = (v: number) => drawn((d) => drawTallLobbyTile(d, 0, 0, TILE, 2 * STORY, v, false, 2)).filter((r) => r.startsWith("#6B4A2B"));
    expect(box(1)).toHaveLength(1);
    expect(box(3)).toHaveLength(1);
    expect(box(0)).toHaveLength(0);
    expect(box(2)).toHaveLength(0);
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

  it("lights a sky lobby's globe pendants after dark", () => {
    const glow = (lit: boolean) =>
      drawn((d) => drawTallLobbyTile(d, 0, 0, TILE, 2 * STORY, 2, false, 2), lit).filter((r) => r.startsWith("#FBE7B8"));
    expect(glow(true)).toHaveLength(3);
    expect(glow(false)).toHaveLength(0);
  });
});

describe("drawTallLobbyEntrance", () => {
  it("draws an entrance slice as the ground lobby slice for its entrance kind", () => {
    const solo = drawn((d) => drawTallLobbyTile(d, 0, 0, TILE, 2 * STORY, ENTRANCE_GRAND_SOLO, true, 2));
    expect(drawn((d) => drawTallLobbyEntrance(d, "grand-solo", 0, 0, TILE, 2 * STORY, 2))).toEqual(solo);
    const service = drawn((d) => drawTallLobbyTile(d, 0, 0, TILE, 2 * STORY, ENTRANCE_SERVICE, true, 2));
    expect(drawn((d) => drawTallLobbyEntrance(d, "service", 0, 0, TILE, 2 * STORY, 2))).toEqual(service);
    expect(solo).not.toEqual(service);
  });
});
