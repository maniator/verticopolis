import { describe, it, expect } from "vitest";
import { drawTransport } from "./sprites";
import type { Transport } from "../engine/types";

/**
 * Regression tests for the stairway/escalator flight geometry: a transport
 * spanning floors f..f+1 is ONE flight rising through the bottom band — the
 * top band is the arrival landing and must stay empty. (A span-1 stairway
 * used to draw a flight in BOTH bands, reading as two stacked staircases.)
 */

/** A minimal recording stand-in for CanvasRenderingContext2D. */
function recordingCtx() {
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  const lines: { x: number; y: number }[] = [];
  const texts: { text: string; x: number; y: number; style: string }[] = [];
  const noop = () => undefined;
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    font: "",
    textAlign: "",
    textBaseline: "",
    fillRect: (x: number, y: number, w: number, h: number) => void rects.push({ x, y, w, h }),
    beginPath: noop,
    moveTo: (x: number, y: number) => void lines.push({ x, y }),
    lineTo: (x: number, y: number) => void lines.push({ x, y }),
    stroke: noop,
    fill: noop,
    arc: noop,
    fillText: function (this: { fillStyle: string }, text: string, x: number, y: number) {
      texts.push({ text, x, y, style: this.fillStyle });
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, rects, lines, texts };
}

/** Parse the alpha from an `rgba(r,g,b,a)` string (1 if opaque/unknown). */
function alphaOf(style: string): number {
  const m = /rgba?\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)/.exec(style);
  return m ? Number(m[1]) : 1;
}

function transport(kind: Transport["kind"], bottom: number, top: number): Transport {
  return {
    id: 1,
    kind,
    x: 0,
    width: 4,
    bottom,
    top,
    cars: 0,
    carPositions: [],
    carDir: [],
    carLoad: [],
  } as unknown as Transport;
}

describe("transport sprite geometry", () => {
  const TOP_Y = 100;
  const FLOOR_H = 34;

  it("a two-floor stairway draws exactly one flight, in the bottom band", () => {
    const { ctx, rects } = recordingCtx();
    drawTransport(ctx, transport("stairs", 1, 2), 0, TOP_Y, 40, FLOOR_H);
    expect(rects.length).toBeGreaterThan(0); // treads were drawn
    // Every tread sits in the BOTTOM band: the top band is the arrival
    // landing. Two stacked flights would put treads above this line.
    expect(rects.every((r) => r.y >= TOP_Y + FLOOR_H)).toBe(true);
  });

  it("a tall stairway draws one flight per floor PAIR (span flights, not span+1)", () => {
    const { ctx, rects } = recordingCtx();
    drawTransport(ctx, transport("stairs", 1, 4), 0, TOP_Y, 40, FLOOR_H);
    // Group treads by the band they were drawn in.
    const bands = new Set(rects.map((r) => Math.floor((r.y - TOP_Y) / FLOOR_H)));
    expect(bands.size).toBe(3); // 3 flights for floors 1→2→3→4
    expect(bands.has(0)).toBe(false); // top band (arrival landing) stays empty
  });

  it("the escalator belt rises through the bottom band", () => {
    const { ctx, lines } = recordingCtx();
    drawTransport(ctx, transport("escalator", 1, 2), 0, TOP_Y, 40, FLOOR_H);
    expect(lines.length).toBeGreaterThan(0);
    // All belt/ridge geometry lives in the bottom band, not the landing.
    expect(lines.every((p) => p.y >= TOP_Y + FLOOR_H)).toBe(true);
  });
});

describe("elevator floor-number legibility", () => {
  const TOP_Y = 100;
  const FLOOR_H = 22; // a small band, the tall-tower case where contrast bites

  it("draws each floor number as a dark shadow behind a brighter glyph", () => {
    const { ctx, texts } = recordingCtx();
    // A 3-floor standard shaft: floors 3, 2, 1 each get a label.
    drawTransport(ctx, transport("elevatorStandard", 1, 3), 0, TOP_Y, 44, FLOOR_H);
    const ones = texts.filter((t) => t.text === "1");
    // The single "1" label is now drawn twice: a shadow and the glyph.
    expect(ones.length).toBe(2);
    const shadow = ones.find((t) => t.style.startsWith("rgba(0,0,0"));
    const glyph = ones.find((t) => t.style.startsWith("rgba(255,255,255"));
    expect(shadow).toBeDefined();
    expect(glyph).toBeDefined();
    // The shadow is painted FIRST so the bright glyph lands ON TOP of it. Paint
    // the shadow last and it would obscure the number, which is the exact
    // regression this guards; `texts` records the calls in draw order.
    expect(texts.indexOf(shadow!)).toBeLessThan(texts.indexOf(glyph!));
    // The shadow sits one pixel down-right of the glyph, and is a dark fill.
    expect(shadow!.x).toBe(glyph!.x + 1);
    expect(shadow!.y).toBe(glyph!.y + 1);
    expect(alphaOf(shadow!.style)).toBeCloseTo(0.55);
    // The glyph is far brighter than the old faint 0.28 fill, so it reads on
    // the near-black shaft (regression guard against dropping back to a wash).
    expect(alphaOf(glyph!.style)).toBeGreaterThanOrEqual(0.5);
  });

  it("labels every served floor and skips express skip-floors", () => {
    const { ctx, texts } = recordingCtx();
    const t = transport("elevatorExpress", 1, 4);
    (t as unknown as { skipFloors: number[] }).skipFloors = [2, 3]; // stops only at 1 and 4
    drawTransport(ctx, t, 0, TOP_Y, 44, FLOOR_H);
    const labels = new Set(texts.map((r) => r.text));
    expect(labels.has("1")).toBe(true);
    expect(labels.has("4")).toBe(true);
    expect(labels.has("2")).toBe(false); // skipped floors show no number
    expect(labels.has("3")).toBe(false);
  });
});
