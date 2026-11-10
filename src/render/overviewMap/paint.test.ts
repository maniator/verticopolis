import { describe, it, expect } from "vitest";
import {
  MIN_PATTERN_SIDE,
  PATTERN_TILE,
  createPatternSource,
  paintMapMarks,
  paintTransportMarks,
  patternCells,
  type MapPaintContext,
  type PatternSource,
  type PatternTarget,
} from "./paint";
import type { MapMark } from "./drawList";
import type { MapPattern } from "./style";

type Call = { op: "clear" | "fill"; args: number[]; style?: unknown };

function fakeCtx(): MapPaintContext & { calls: Call[]; styleSets: unknown[] } {
  const calls: Call[] = [];
  const styleSets: unknown[] = [];
  let style: unknown = "";
  return {
    calls,
    styleSets,
    get fillStyle() {
      return style as string;
    },
    set fillStyle(v) {
      style = v;
      styleSets.push(v);
    },
    fillRect(x, y, w, h) {
      calls.push({ op: "fill", args: [x, y, w, h], style });
    },
    clearRect(x, y, w, h) {
      calls.push({ op: "clear", args: [x, y, w, h] });
    },
  };
}

const plain: PatternSource = { get: (fill, pattern) => (pattern === "solid" ? fill : `${pattern}:${fill}`) as string };
const mark = (kind: MapMark["kind"], w = 10, h = 10): MapMark => ({ layer: "room", kind, rect: { x: 0, y: 0, w, h } });

describe("patternCells", () => {
  const PATTERNS: MapPattern[] = ["solid", "dots", "diagonal", "horizontal", "grid", "checker", "outline"];

  it("keeps every mark inside the tile and never repeats one", () => {
    for (const p of PATTERNS) {
      const cells = patternCells(p);
      const keys = new Set(cells.map(([x, y]) => `${x},${y}`));
      expect(keys.size, p).toBe(cells.length);
      for (const [x, y] of cells) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(PATTERN_TILE);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThan(PATTERN_TILE);
      }
    }
  });

  it("gives solid no marks and every other pattern some, but never a full tile", () => {
    expect(patternCells("solid")).toHaveLength(0);
    for (const p of PATTERNS.filter((x) => x !== "solid")) {
      const n = patternCells(p).length;
      expect(n, p).toBeGreaterThan(0);
      expect(n, p).toBeLessThan(PATTERN_TILE * PATTERN_TILE);
    }
  });

  it("makes each pattern a different tile", () => {
    const sigs = PATTERNS.map((p) => patternCells(p).map(([x, y]) => `${x},${y}`).sort().join("|"));
    expect(new Set(sigs).size).toBe(PATTERNS.length);
  });
});

describe("createPatternSource", () => {
  function factory(opts: { context?: boolean } = {}) {
    let made = 0;
    const tiles: Array<{ w: number; h: number; fills: number; fillStyles: string[] }> = [];
    const makeCanvas = (): HTMLCanvasElement => {
      made++;
      const rec = { w: 0, h: 0, fills: 0, fillStyles: [] as string[] };
      tiles.push(rec);
      const canvas = {
        get width() {
          return rec.w;
        },
        set width(v: number) {
          rec.w = v;
        },
        get height() {
          return rec.h;
        },
        set height(v: number) {
          rec.h = v;
        },
        getContext: () =>
          opts.context === false
            ? null
            : {
                set fillStyle(v: string) {
                  rec.fillStyles.push(v);
                },
                fillRect: () => void rec.fills++,
              },
      };
      return canvas as unknown as HTMLCanvasElement;
    };
    return { makeCanvas, made: () => made, tiles };
  }
  const target: PatternTarget = { createPattern: () => ({ tag: "pattern" }) as unknown as CanvasPattern };

  it("accepts a real 2D context as its target (compile-time check)", () => {
    const real: PatternTarget = null as unknown as CanvasRenderingContext2D;
    expect(real).toBeNull();
  });

  it("returns the plain color for solid without building a tile", () => {
    const f = factory();
    const src = createPatternSource(f.makeCanvas, target);
    expect(src.get("#abc", "solid")).toBe("#abc");
    expect(f.made()).toBe(0);
  });

  it("builds one tile per fill and pattern, then reuses it", () => {
    const f = factory();
    const src = createPatternSource(f.makeCanvas, target);
    const a = src.get("#abcdef", "dots");
    expect(src.get("#abcdef", "dots")).toBe(a);
    src.get("#fedcba", "dots");
    src.get("#abcdef", "grid");
    expect(f.made()).toBe(3);
    expect(f.tiles[0]).toMatchObject({ w: PATTERN_TILE, h: PATTERN_TILE });
  });

  it("paints the fill and then the ink marks onto the tile, with ink chosen for the fill", () => {
    const f = factory();
    const src = createPatternSource(f.makeCanvas, target);
    src.get("#f0f0f0", "diagonal");
    src.get("#202020", "diagonal");
    expect(f.tiles[0].fills).toBe(1 + patternCells("diagonal").length);
    expect(f.tiles[0].fillStyles).toEqual(["#f0f0f0", "#1c1c1c"]);
    expect(f.tiles[1].fillStyles).toEqual(["#202020", "#f2f2f2"]);
  });

  it("answers the plain fill, and does not cache the miss, when the tile cannot be built", () => {
    const none = factory({ context: false });
    const noCtx = createPatternSource(none.makeCanvas, target);
    expect(noCtx.get("#abcdef", "dots")).toBe("#abcdef");
    expect(noCtx.get("#abcdef", "dots")).toBe("#abcdef");
    expect(none.made()).toBe(2);

    const f = factory();
    let ready = false;
    const flaky = createPatternSource(f.makeCanvas, { createPattern: () => (ready ? ({ tag: "p" } as unknown as CanvasPattern) : null) });
    expect(flaky.get("#abcdef", "dots")).toBe("#abcdef");
    ready = true;
    expect(typeof flaky.get("#abcdef", "dots")).toBe("object");
  });
});

describe("paintMapMarks", () => {
  it("clears the whole map first, then fills one rectangle per mark in order", () => {
    const ctx = fakeCtx();
    const marks = [mark("floor"), mark("office"), mark("elevatorExpress")];
    const n = paintMapMarks(ctx, 120, 80, marks, plain);
    expect(n).toBe(3);
    expect(ctx.calls[0]).toEqual({ op: "clear", args: [0, 0, 120, 80] });
    expect(ctx.calls.filter((c) => c.op === "fill")).toHaveLength(3);
  });

  it("resolves a kind's style once per run of same-kind marks", () => {
    const asked: string[] = [];
    const counting: PatternSource = { get: (fill, pattern) => (asked.push(`${pattern}:${fill}`), fill) };
    paintMapMarks(fakeCtx(), 10, 10, [mark("office"), mark("office"), mark("office"), mark("condo"), mark("condo")], counting);
    // Two kinds, each asked once for its patterned and once for its plain fill.
    expect(asked).toHaveLength(4);
  });

  it("paints an unknown kind in the placeholder instead of throwing", () => {
    const ctx = fakeCtx();
    expect(() => paintMapMarks(ctx, 10, 10, [mark("notAKind" as never)], plain)).not.toThrow();
    expect(String(ctx.styleSets[0])).toContain("#ff00ff");
  });

  it("sets the fill style only when the style changes", () => {
    const ctx = fakeCtx();
    paintMapMarks(ctx, 10, 10, [mark("office"), mark("office"), mark("office"), mark("elevatorExpress")], plain);
    expect(ctx.styleSets).toHaveLength(2);
  });

  it("paints a mark too small to read a pattern in as a plain fill", () => {
    const ctx = fakeCtx();
    paintMapMarks(ctx, 50, 50, [mark("condo", MIN_PATTERN_SIDE - 1, 10)], plain);
    expect(ctx.styleSets[0]).not.toContain(":");
    const big = fakeCtx();
    paintMapMarks(big, 50, 50, [mark("condo", MIN_PATTERN_SIDE, 10)], plain);
    expect(String(big.styleSets[0])).toContain("dots:");
  });

  it("draws every kind, stairs and escalators included", () => {
    const marks = [mark("floor", 40, 4), mark("stairs", 8, 8), mark("escalator", 8, 8), mark("elevatorStandard", 4, 20)];
    const ctx = fakeCtx();
    expect(paintMapMarks(ctx, 60, 30, marks, plain)).toBe(4);
    expect(ctx.calls.filter((c) => c.op === "fill")).toHaveLength(4);
  });

  it("paints an empty list as a cleared map", () => {
    const ctx = fakeCtx();
    expect(paintMapMarks(ctx, 5, 5, [], plain)).toBe(0);
    expect(ctx.calls).toHaveLength(1);
  });
});

describe("paintTransportMarks", () => {
  it("paints only the trailing transport marks again, without clearing", () => {
    const shaft = (x: number): MapMark => ({ layer: "transport", kind: "elevatorStandard", rect: { x, y: 0, w: 1, h: 20 } });
    const ctx = fakeCtx();
    expect(paintTransportMarks(ctx, [mark("office"), mark("hotelSingle"), shaft(3), shaft(7)], plain)).toBe(2);
    expect(ctx.calls.map((c) => c.op)).toEqual(["fill", "fill"]);
    expect(ctx.calls.map((c) => c.args[0])).toEqual([3, 7]);
    expect(paintTransportMarks(fakeCtx(), [mark("office")], plain)).toBe(0);
    expect(paintTransportMarks(fakeCtx(), [], plain)).toBe(0);
  });
});
