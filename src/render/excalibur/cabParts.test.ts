import { describe, expect, it } from "vitest";
import { castIndex, drawPerson, LOOKS } from "../pixelSprites/people";
import { paintRider, RIDER_FOOT, RIDER_X } from "./cabParts";
import { figureKey } from "./crowdLook";

/** A context that logs what is painted, to compare two paintings. */
function logCtx() {
  const log: string[] = [];
  const ctx: any = { fillRect: (...a: number[]) => log.push(`${ctx.fillStyle}:${a.join(",")}`), fillStyle: "" };
  return { ctx: ctx as CanvasRenderingContext2D, log };
}

describe("cab rider pictures", () => {
  // The bug: a cab drew its own made-up faces, so a person who walked into
  // an elevator came out of it looking like someone else. A rider's picture
  // is the crowd's own figure for that person.
  it("paints the person the figure names, standing, in their look, mood and shading", () => {
    for (const seed of [5, 8]) {
      for (const lit of [false, true]) {
        for (const mood of ["content", "fedUp"] as const) {
          const rider = logCtx();
          paintRider(rider.ctx, figureKey(castIndex(seed), "stand", 1, mood, false, lit));
          const person = logCtx();
          drawPerson(person.ctx, RIDER_X, RIDER_FOOT, LOOKS[castIndex(seed)], { lit, pose: "stand", empty: true, mood });
          expect(rider.log.length).toBeGreaterThan(0);
          expect(rider.log).toEqual(person.log);
        }
      }
    }
  });

  it("gives two different people two different pictures", () => {
    const a = logCtx();
    const b = logCtx();
    paintRider(a.ctx, figureKey(castIndex(5), "stand", 1, "content", false, false));
    paintRider(b.ctx, figureKey(castIndex(8), "stand", 1, "content", false, false));
    expect(a.log).not.toEqual(b.log);
  });
});
