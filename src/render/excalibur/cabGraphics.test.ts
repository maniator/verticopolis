import { beforeEach, describe, expect, it, vi } from "vitest";
import { carIndicator } from "../carIndicator";
import { castIndex } from "../pixelSprites/people";
import { cabRiderX } from "../sprites/transport";
import { FLOOR } from "../scale";
import { CAB_GFX_KEEP, cabWant, carGfx, carKey, IDLE_CAR, paintCab, type CabGfxEntry } from "./cabGraphics";
import { RIDER_FOOT, RIDER_X, type CabParts } from "./cabParts";
import type { CabLoad } from "./cabRiders";
import { figureKey } from "./crowdLook";

// No 2D canvas here: a stand-in canvas keeps the draw callback, so a test can
// run it and see what the cab is asked to draw, and the cab's parts are
// stand-in pictures that name what they are.
vi.mock("excalibur", async (importOriginal) => {
  const real = await importOriginal<typeof import("excalibur")>();
  class FakeCanvas {
    flagDirty = vi.fn();
    constructor(readonly options: { width: number; height: number; draw: (ctx: unknown) => void }) {}
  }
  return { ...real, Canvas: FakeCanvas };
});
const parts = {
  back: vi.fn((kind: string, w: number) => `back:${kind}:${w}`),
  front: vi.fn((w: number, arrow: string | null, full: boolean) => `front:${w}:${arrow}:${full}`),
  rider: vi.fn((figure: number) => `rider:${figure}`),
};
vi.mock("./cabParts", async (importOriginal) => ({ ...(await importOriginal<object>()), cabParts: () => parts }));

type Fake = { flagDirty: ReturnType<typeof vi.fn>; options: { draw: (ctx: unknown) => void } };
const entry = (): CabGfxEntry => ({ w: 40, kind: "elevatorStandard", gfx: new Map() });
/** Rider `seed`'s standing figure, as the crowd draws them. */
const fig = (seed: number) => figureKey(castIndex(seed), "stand", 1, "content", false, false);
/** A cab carrying the people with these seeds, standing in the crowd's looks. */
const carrying = (...seeds: number[]) => {
  const figures = seeds.map(fig);
  return carIndicator(0, 0, 16, 11, figures.length, figures, figures.join(","));
};
/** What a cab canvas copies in, in order. */
function painted(draw: (ctx: unknown) => void): string[] {
  const out: string[] = [];
  draw({ drawImage: (img: string, x: number, y: number) => out.push(`${img}@${x},${y}`) });
  return out;
}
/** The riders a painting copies in. */
const ridersIn = (calls: string[]) => calls.filter((c) => c.startsWith("rider:")).map((c) => Number(c.slice(6, c.indexOf("@"))));

beforeEach(() => vi.clearAllMocks());

describe("cab graphics", () => {
  it("keys a cab by who is in it, so two loads of the same size never share a drawing", () => {
    expect(carKey(carrying(5))).not.toBe(carKey(carrying(8)));
    expect(carKey(carrying(5))).toBe(carKey(carrying(5)));
    expect(carKey(IDLE_CAR)).not.toBe(carKey(carrying(5)));
  });

  it("paints the back, each rider's own figure in their slot, then the front", () => {
    const calls = painted((ctx) => paintCab(ctx as CanvasRenderingContext2D, parts as unknown as CabParts, entry(), carrying(5, 8), [fig(5), fig(8)]));
    const foot = FLOOR - 3 - RIDER_FOOT;
    expect(calls).toEqual([
      "back:elevatorStandard:40@0,0",
      `rider:${fig(5)}@${Math.round(cabRiderX(40, 2, 0) ?? NaN) - RIDER_X},${foot}`,
      `rider:${fig(8)}@${Math.round(cabRiderX(40, 2, 1) ?? NaN) - RIDER_X},${foot}`,
      "front:40:null:false@0,0",
    ]);
    // Only as many as the cab has room for.
    const one = painted((ctx) => paintCab(ctx as CanvasRenderingContext2D, parts as unknown as CabParts, entry(), { ...carrying(5, 8), riders: 1 }, [fig(5), fig(8)]));
    expect(ridersIn(one)).toEqual([fig(5)]);
  });

  it("puts the riders' own figures in the cab's drawing", () => {
    const cv = carGfx(entry(), carrying(5, 8)) as unknown as Fake;
    expect(ridersIn(painted(cv.options.draw))).toEqual([fig(5), fig(8)]);
  });

  it("draws the riders who were aboard when the state was set, even if the count moves on first", () => {
    const ind = carrying(5);
    const cv = carGfx(entry(), ind) as unknown as Fake;
    (ind.figures as number[])[0] = fig(8); // the next step's recount
    expect(ridersIn(painted(cv.options.draw))).toEqual([fig(5)]);
  });

  it("reuses a kept drawing when the same state shows again", () => {
    const e = entry();
    const first = carGfx(e, carrying(5));
    carGfx(e, IDLE_CAR);
    expect(carGfx(e, carrying(5))).toBe(first);
    expect(e.gfx.size).toBe(2);
  });

  it("keeps a few states per car and redraws the oldest canvas for the new riders instead of making another", () => {
    const e = entry();
    const made = Array.from({ length: CAB_GFX_KEEP }, (_, i) => carGfx(e, carrying(i + 1)));
    expect(new Set(made).size).toBe(CAB_GFX_KEEP);
    // Showing the first state again makes the second the oldest.
    carGfx(e, carrying(1));
    const oldest = made[1] as unknown as Fake;
    const next = carGfx(e, carrying(99));
    expect(next).toBe(oldest); // recycled, not a new canvas
    expect(oldest.flagDirty).toHaveBeenCalledTimes(1);
    expect(e.gfx.size).toBe(CAB_GFX_KEEP);
    expect(e.gfx.has(carKey(carrying(2)))).toBe(false);
    expect(e.gfx.get(carKey(carrying(99)))).toBe(oldest);
    expect(ridersIn(painted(oldest.options.draw))).toEqual([fig(99)]);
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
