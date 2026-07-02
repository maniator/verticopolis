import { describe, it, expect } from "vitest";
import { drawTransport } from "../render/sprites";
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
    fillText: noop,
  } as unknown as CanvasRenderingContext2D;
  return { ctx, rects, lines };
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
