import { beforeEach, describe, expect, it, vi } from "vitest";
import { carIndicator, type CarIndicator } from "../carIndicator";
import { castIndex } from "../pixelSprites/people";
import { cabRiderX } from "../sprites/transport";
import { FLOOR } from "../scale";
import { CabGraphic, cabWant, carKey, IDLE_CAR, type CabGfxEntry } from "./cabGraphics";
import { RIDER_FOOT, RIDER_H, RIDER_W, RIDER_X, type CabParts } from "./cabParts";
import type { CabLoad } from "./cabRiders";
import { figureKey } from "./crowdLook";

// The cab's parts are stand-in pictures that name what they are, so a test
// can read what a cab draws, and where.
const parts = {
  back: vi.fn((kind: string, w: number) => `back:${kind}:${w}`),
  front: vi.fn((w: number, arrow: string | null, full: boolean) => `front:${w}:${arrow}:${full}`),
  empty: vi.fn((kind: string, w: number, arrow: string | null, full: boolean) => `empty:${kind}:${w}:${arrow}:${full}`),
  rider: vi.fn((figure: number) => `rider:${figure}`),
};
const cabOf = (ind: CarIndicator = IDLE_CAR, w = 40) => new CabGraphic({ w, kind: "elevatorStandard" }, ind, parts as unknown as CabParts);
const entry = (): CabGfxEntry => ({ w: 40, kind: "elevatorStandard" });
/** Rider `seed`'s standing figure, as the crowd draws them. */
const fig = (seed: number) => figureKey(castIndex(seed), "stand", 1, "content", false, false);
/** A cab carrying the people with these seeds, standing in the crowd's looks. */
const carrying = (...seeds: number[]) => {
  const figures = seeds.map(fig);
  return carIndicator(0, 0, 16, 11, figures.length, figures, figures.join(","));
};
/** What a cab draws in one frame at (x, y), in order: each picture with its
 *  source cut (when cut) and where it lands. */
function drawn(cab: CabGraphic, x = 0, y = 0): string[] {
  const out: string[] = [];
  const ctx = {
    drawImage: (img: string, ...a: number[]) => out.push(a.length === 2 ? `${img}@${a[0]},${a[1]}` : `${img}[${a[0]}+${a[2]}x${a[3]}]@${a[4]},${a[5]}`),
  };
  (cab as unknown as { _drawImage(c: unknown, x: number, y: number): void })._drawImage(ctx, x, y);
  return out;
}
/** The riders a frame draws. */
const ridersIn = (calls: string[]) => calls.filter((c) => c.startsWith("rider:")).map((c) => Number(c.slice(6, c.indexOf("["))));
const foot = FLOOR - 3 - RIDER_FOOT;
const slotX = (cw: number, rc: number, p: number) => Math.round(cabRiderX(cw, rc, p) ?? NaN) - RIDER_X;
/** Rider `p` of `rc` in a cab `cw` wide drawn at (x, y): the part of their
 *  picture inside the cab's walls, where a painted cab put it. */
function inSlot(figure: number, cw: number, rc: number, p: number, x = 0, y = 0): string {
  const left = slotX(cw, rc, p);
  const sx = Math.max(0, -left);
  const w = Math.min(RIDER_W, cw - left) - sx;
  return `rider:${figure}[${sx}+${w}x${RIDER_H}]@${x + left + sx},${y + foot}`;
}

beforeEach(() => vi.clearAllMocks());

describe("cab graphics", () => {
  it("keys a cab by who is in it, so two loads of the same size never share a state", () => {
    expect(carKey(carrying(5))).not.toBe(carKey(carrying(8)));
    expect(carKey(carrying(5))).toBe(carKey(carrying(5)));
    expect(carKey(IDLE_CAR)).not.toBe(carKey(carrying(5)));
  });

  it("draws the back, each rider's own figure in their slot, then the front, where the car stands", () => {
    expect(drawn(cabOf(carrying(5, 8)), 100, 50)).toEqual([
      "back:elevatorStandard:40@100,50",
      inSlot(fig(5), 40, 2, 0, 100, 50),
      inSlot(fig(8), 40, 2, 1, 100, 50),
      "front:40:null:false@100,50",
    ]);
    // Only as many as the cab has room for.
    expect(ridersIn(drawn(cabOf({ ...carrying(5, 8), riders: 1 })))).toEqual([fig(5)]);
  });

  it("cuts a rider standing against the cab's walls at the walls, as a painted cab did", () => {
    // The first slot's picture starts left of the cab, and in a narrow cab the
    // last one runs past the right wall.
    expect(slotX(40, 2, 0)).toBeLessThan(0);
    expect(drawn(cabOf(carrying(5, 8)))[1]).toBe(`rider:${fig(5)}[${-slotX(40, 2, 0)}+${RIDER_W + slotX(40, 2, 0)}x${RIDER_H}]@0,${foot}`);
    const w = 14;
    const last = slotX(w, 2, 1);
    expect(last + RIDER_W).toBeGreaterThan(w);
    expect(drawn(cabOf(carrying(5, 8), w))[2]).toBe(`rider:${fig(8)}[0+${w - last}x${RIDER_H}]@${last},${foot}`);
  });

  it("shows new riders by pointing at their pictures, painting nothing and keeping no copy per car", () => {
    const cab = cabOf(carrying(5));
    vi.clearAllMocks();
    cab.show(carrying(8, 9));
    // Only the shared parts are looked up; the cab itself makes nothing.
    expect(parts.back).not.toHaveBeenCalled();
    expect(parts.rider.mock.calls).toEqual([[fig(8)], [fig(9)]]);
    expect(ridersIn(drawn(cab))).toEqual([fig(8), fig(9)]);
    // Fewer riders next time: the ones who left are not drawn.
    cab.show(carrying(3));
    expect(ridersIn(drawn(cab))).toEqual([fig(3)]);
    cab.show(IDLE_CAR);
    expect(ridersIn(drawn(cab))).toEqual([]);
  });

  it("draws the riders who were aboard when the state was shown, even if the count moves on", () => {
    const ind = carrying(5);
    const cab = cabOf(ind);
    (ind.figures as number[])[0] = fig(8); // the next step's recount
    expect(ridersIn(drawn(cab))).toEqual([fig(5)]);
  });

  it("draws an empty cab as one picture, with the lantern and FULL from the state", () => {
    const cab = cabOf();
    expect(drawn(cab, 7, 9)).toEqual(["empty:elevatorStandard:40:null:false@7,9"]);
    cab.show(carIndicator(1, 16, 16, 11, 0));
    expect(drawn(cab)).toEqual(["empty:elevatorStandard:40:up:true@0,0"]);
    cab.show({ ...carrying(5), arrow: "up", full: true });
    expect(drawn(cab)[2]).toBe("front:40:up:true@0,0");
  });

  it("clones into a cab showing the same state", () => {
    expect(drawn(cabOf(carrying(5, 8)).clone())).toEqual(drawn(cabOf(carrying(5, 8))));
  });
});

describe("cabWant", () => {
  const load = (...seeds: number[]): CabLoad => {
    const figures = seeds.map(fig);
    return { count: figures.length, figures: [...figures, 999], cast: figures.join(","), prev: [], prevCount: 0 };
  };

  it("keeps the same answer, unallocated, while nothing it reads changes", () => {
    const e = entry();
    const a = cabWant(e, 1, 4, 16, load(5));
    expect(cabWant(e, 1, 4, 16, load(5))).toBe(a);
    expect(a.ind.riders).toBe(1);
    expect(a.ind.arrow).toBe("up");
    expect(a.key).toBe(carKey(a.ind));
  });

  it("works the state out again when the lantern, the load, the capacity or the riders change", () => {
    const e = entry();
    const a = cabWant(e, 1, 4, 16, load(5));
    const down = cabWant(e, -1, 4, 16, load(5));
    expect(down).not.toBe(a);
    expect(down.ind.arrow).toBe("down");
    expect(cabWant(e, -1, 16, 16, load(5)).ind.full).toBe(true);
    expect(cabWant(e, -1, 16, 20, load(5)).ind.full).toBe(false);
    const more = cabWant(e, -1, 16, 20, load(5, 8));
    expect(more.ind.riders).toBe(2);
    expect(more.key).not.toBe(down.key);
  });

  it("copies only the counted riders, so the crowd's next count cannot change a kept state", () => {
    const riders = load(5, 8);
    const w = cabWant(entry(), 0, 0, 16, riders);
    expect(w.ind.figures).toEqual(riders.figures.slice(0, 2)); // not the stale 999 past the count
    riders.figures[0] = 0;
    expect(w.ind.figures[0]).not.toBe(0);
  });
});
