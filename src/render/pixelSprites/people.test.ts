import { describe, expect, it } from "vitest";
import { CAST, crewIndex, drawPerson, LOOK, LOOKS, MOOD_TOP, outfitColors, walkFrame, WALK_FRAMES, type Pose } from "./people";
import { RESERVED_COLORS } from "./common";
import { POSES, MOODS } from "../excalibur/crowdLook";
import { FIGURE_FOOT, FIGURE_H, FIGURE_W } from "../excalibur/peopleGfx";

/** A canvas stand-in that records every rectangle painted, with its color. */
function recorder() {
  const rects: { x: number; y: number; w: number; h: number; color: string }[] = [];
  const ctx = {
    fillStyle: "",
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h, color: String(ctx.fillStyle) });
    },
    clearRect() {},
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rects };
}

/** Where the bake puts a figure (see peopleGfx.ts). */
const BODY_X = 11;

describe("the people cast (#2097)", () => {
  it("keeps every outfit off the mood colors and the reserved state cues", () => {
    const banned = new Set<string>([...Object.values(MOOD_TOP), ...RESERVED_COLORS].map((c) => c.toUpperCase()));
    for (const look of LOOKS) {
      for (const c of outfitColors(look)) expect(banned.has(c.toUpperCase()), `${c} is a state color`).toBe(false);
    }
  });

  it("paints the mood color only when the person has a mood", () => {
    for (const look of CAST) {
      const content = recorder();
      drawPerson(content.ctx, BODY_X, FIGURE_FOOT, look, { lit: true, mood: "content" });
      const colors = new Set(content.rects.map((r) => r.color.toUpperCase()));
      expect(colors.has(MOOD_TOP.fedUp.toUpperCase())).toBe(false);
      const fedUp = recorder();
      drawPerson(fedUp.ctx, BODY_X, FIGURE_FOOT, look, { lit: true, mood: "fedUp" });
      expect(fedUp.rects.some((r) => r.color.toUpperCase() === MOOD_TOP.fedUp.toUpperCase())).toBe(true);
    }
  });

  it("fits every look, pose, frame and mood inside the shared figure canvas", () => {
    for (const look of LOOKS) {
      for (const pose of POSES) {
        for (let frame = 0; frame < WALK_FRAMES.lit; frame++) {
          for (const mood of MOODS) {
            for (const lit of [false, true]) {
              const { ctx, rects } = recorder();
              drawPerson(ctx, BODY_X, FIGURE_FOOT, look, { lit, frame, pose: pose as Pose, mood });
              for (const r of rects) {
                const x0 = Math.min(r.x, r.x + r.w);
                const y0 = Math.min(r.y, r.y + r.h);
                expect(x0, `${look.hairStyle} ${pose} ${frame}`).toBeGreaterThanOrEqual(0);
                expect(x0 + Math.abs(r.w)).toBeLessThanOrEqual(FIGURE_W);
                expect(y0).toBeGreaterThanOrEqual(0);
                expect(y0 + Math.abs(r.h)).toBeLessThanOrEqual(FIGURE_H);
              }
            }
          }
        }
      }
    }
  });

  it("keeps the flat look to the 1994 two-step and gives the lit look four frames", () => {
    expect([0, 1, 2, 3].map((s) => walkFrame(false, s))).toEqual([0, 2, 0, 2]);
    expect([0, 1, 2, 3, 4].map((s) => walkFrame(true, s))).toEqual([0, 1, 2, 3, 0]);
  });

  it("strides: the legs sit apart on a contact frame and together on a passing one", () => {
    const legSpan = (frame: number) => {
      const { ctx, rects } = recorder();
      drawPerson(ctx, BODY_X, FIGURE_FOOT, CAST[0], { lit: false, frame, pose: "walk" });
      const shoes = rects.filter((r) => r.y === FIGURE_FOOT - 1 && r.color === CAST[0].shoe);
      return Math.max(...shoes.map((r) => r.x)) - Math.min(...shoes.map((r) => r.x));
    };
    expect(legSpan(0)).toBeGreaterThan(legSpan(1));
    expect(legSpan(2)).toBeGreaterThan(legSpan(1));
  });

  it("gives the cleaning housekeeper a vacuum and the walking one a cart", () => {
    expect(LOOKS[LOOK.housekeeper].carry).toBe("cart");
    expect(LOOKS[LOOK.housekeeperCleaning].carry).toBe("vacuum");
    expect(LOOKS[LOOK.thief].carry).toBe("sack");
  });

  it("gives the housekeeping crew different faces under one uniform", () => {
    const crew = [0, 1, 2, 3, 4, 5].map((seed) => LOOKS[crewIndex(seed, false)]);
    expect(new Set(crew.map((h) => h.skin + h.hairStyle)).size).toBe(crew.length);
    expect(new Set(crew.map((h) => h.top)).size).toBe(1);
    expect(LOOKS[crewIndex(4, true)].carry).toBe("vacuum");
    expect(LOOKS[crewIndex(4, true)].skin).toBe(LOOKS[crewIndex(4, false)].skin);
  });

  it("draws a housekeeper's cart only while it is pushed", () => {
    const cart = (pose: Pose) => {
      const { ctx, rects } = recorder();
      drawPerson(ctx, BODY_X, FIGURE_FOOT, LOOKS[LOOK.housekeeper], { lit: false, pose });
      // The cart reaches right of the body, past the front hand.
      return rects.filter((r) => r.x > BODY_X + 12).length;
    };
    expect(cart("push")).toBeGreaterThan(0);
    expect(cart("stand")).toBe(0);
  });
});

describe("a figure lying down (#2116)", () => {
  it("is the upright figure turned a quarter turn, with no floor shadow", () => {
    const X = 40;
    const F = 30;
    const dims = { legs: 0, torso: 6, head: 6, seated: true, width: 4 };
    for (const look of CAST) {
      const upright = recorder();
      drawPerson(upright.ctx, X, F, look, { lit: false, pose: "stand", empty: true, dims });
      const lying = recorder();
      drawPerson(lying.ctx, X, F, look, { lit: false, pose: "stand", empty: true, dims, lying: true });
      const shadow = (r: { color: string }) => r.color.startsWith("rgba(0,0,0");
      // Upright cell (column, row) lands at (row, -column - 1) about the foot point.
      const turned = upright.rects.filter((r) => !shadow(r)).map((r) => ({
        x: X + (r.y - F), y: F - (r.x - X) - r.w, w: r.h, h: r.w, color: r.color,
      }));
      expect(lying.rects).toEqual(turned);
      expect(lying.rects.some(shadow)).toBe(false);
    }
  });
});
