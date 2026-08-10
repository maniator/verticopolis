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
  /** The handrail rises past the arrival deck by railH (9) minus the 2px yTop
   *  inset, as in the original where a flight breaks the floor line it lands on.
   *  Band assertions allow for it; the flight body still stays in its own band. */
  const RAIL_OVERHANG = 7;

  it("a two-floor stairway draws exactly one flight, in the bottom band", () => {
    const { ctx, rects } = recordingCtx();
    drawTransport(ctx, transport("stairs", 1, 2), 0, TOP_Y, 40, FLOOR_H);
    expect(rects.length).toBeGreaterThan(0); // treads were drawn
    // Every tread sits in the BOTTOM band: the top band is the arrival
    // landing. Two stacked flights would put treads above this line.
    expect(rects.every((r) => r.y >= TOP_Y + FLOOR_H - RAIL_OVERHANG)).toBe(true);  });

  it("a tall stairway draws one flight per floor PAIR (span flights, not span+1)", () => {
    const { ctx, rects } = recordingCtx();
    drawTransport(ctx, transport("stairs", 1, 4), 0, TOP_Y, 40, FLOOR_H);
    // Group by band, ignoring the handrail rows that overhang into the band above.
    const bands = new Set(
        rects.filter((r) => r.y >= TOP_Y + FLOOR_H).map((r) => Math.floor((r.y - TOP_Y) / FLOOR_H)),
    );
    expect(bands.size).toBe(3); // 3 flights for floors 1→2→3→4
    // Nothing rises above the top band beyond the handrail overhang.
    expect(rects.filter((r) => r.y < TOP_Y + FLOOR_H).every((r) => r.y >= TOP_Y + FLOOR_H - RAIL_OVERHANG)).toBe(true);
  });

  it("the escalator run rises through the bottom band, not the arrival landing", () => {
    const { ctx, rects } = recordingCtx();
    drawTransport(ctx, transport("escalator", 1, 2), 0, TOP_Y, 40, FLOOR_H);
    expect(rects.length).toBeGreaterThan(0); // steps + rails were drawn
    // All step/rail/landing geometry lives in the bottom band: the top band is
    // the arrival landing and must stay empty (no second stacked run).
    expect(rects.every((p) => p.y >= TOP_Y + FLOOR_H)).toBe(true);
  });
});

describe("elevator shaft stop lines", () => {
  const TOP_Y = 100;
  const FLOOR_H = 22;
  const W = 44;
  /** A per-floor stop line is the only full-width, 1px-tall rect the shaft
   *  bakes (backing is full width, guide rails and edge shadows are vertical). */
  const stopLines = (rects: { w: number; h: number }[]) => rects.filter((r) => r.h === 1 && r.w === W - 2);

  it("bakes a stop line per served floor and NO number text", () => {
    const { ctx, texts, rects } = recordingCtx();
    drawTransport(ctx, transport("elevatorStandard", 1, 3), 0, TOP_Y, W, FLOOR_H);
    // Floor numbers now render on the screen-space overlay (towerOverlay
    // drawShaftNumbers), not baked into this upscaled pixel bitmap.
    expect(texts.length).toBe(0);
    expect(stopLines(rects).length).toBe(3); // floors 1, 2, 3
  });

  it("skips the stop line on express skip-floors", () => {
    const { ctx, texts, rects } = recordingCtx();
    const t = transport("elevatorExpress", 1, 4);
    (t as unknown as { skipFloors: number[] }).skipFloors = [2, 3]; // stops only at 1 and 4
    drawTransport(ctx, t, 0, TOP_Y, W, FLOOR_H);
    expect(texts.length).toBe(0);
    expect(stopLines(rects).length).toBe(2); // only the served floors 1 and 4
  });
});
