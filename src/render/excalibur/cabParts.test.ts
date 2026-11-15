import { afterEach, describe, expect, it, vi } from "vitest";
import { castIndex, drawPerson, LOOKS } from "../pixelSprites/people";
import { drawCar } from "../sprites/transport";
import { FLOOR } from "../scale";
import { canvasCabParts, paintRider, RIDER_FOOT, RIDER_X } from "./cabParts";
import { figureKey } from "./crowdLook";

/** A context that logs what is painted, to compare two paintings. */
function logCtx() {
  const log: string[] = [];
  const ctx: any = { fillRect: (...a: number[]) => log.push(`${ctx.fillStyle}:${a.join(",")}`), fillStyle: "" };
  return { ctx: ctx as CanvasRenderingContext2D, log };
}

/** A context that logs every call and every style set, in order. */
function traceCtx() {
  const log: string[] = [];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (t, k) => (k in t ? t[k] : (...a: unknown[]) => log.push(`${String(k)}(${a.join(",")})`)),
    set: (t, k, v) => {
      t[k] = v;
      log.push(`${String(k)}=${String(v)}`);
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log };
}

afterEach(() => vi.restoreAllMocks());

describe("cab pictures", () => {
  it("paints an empty cab exactly as drawCar paints one with nobody aboard", () => {
    for (const [kind, w, arrow, full] of [
      ["elevatorStandard", 32, null, false],
      ["elevatorService", 32, "up", true],
      ["elevatorExpress", 48, "down", false],
    ] as const) {
      const part = traceCtx();
      vi.spyOn(document, "createElement").mockReturnValue({ getContext: () => part.ctx } as unknown as HTMLElement);
      canvasCabParts().empty(kind, w, arrow, full);
      vi.restoreAllMocks();
      const cab = traceCtx();
      drawCar(cab.ctx, 7, w, FLOOR, 0, arrow, full, kind);
      expect(part.log.length).toBeGreaterThan(0);
      expect(part.log).toEqual(cab.log);
    }
  });

  it("paints each part once and hands every cab the same picture", () => {
    const made = vi.spyOn(document, "createElement").mockImplementation(() => ({ getContext: () => traceCtx().ctx }) as unknown as HTMLElement);
    const parts = canvasCabParts();
    expect(parts.empty("elevatorStandard", 32, "up", false)).toBe(parts.empty("elevatorStandard", 32, "up", false));
    expect(parts.rider(5)).toBe(parts.rider(5));
    expect(parts.back("elevatorStandard", 32)).toBe(parts.back("elevatorStandard", 32));
    expect(parts.front(32, null, true)).toBe(parts.front(32, null, true));
    expect(made).toHaveBeenCalledTimes(4);
  });
});

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
