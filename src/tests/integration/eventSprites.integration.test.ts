import { describe, it, expect } from "vitest";
import { drawSanta, drawExplosion, drawThief, drawTreasure, drawVipLimo } from "../../render/sprites/events";

/**
 * Smoke coverage for the event visuals added for parity: they are immediate-mode
 * canvas draws (no Excalibur actors), so the meaningful checks are (a) they issue
 * draw calls without throwing on a bare 2D context, and (b) the engine-facing
 * signals the renderer polls are transients that never leak into the save (a
 * Rust test since #1875: engine-rs/src/rule_tests/event_fx.rs).
 */

/** A recording stand-in for CanvasRenderingContext2D (mirrors renderTransport.test.ts). */
function recordingCtx() {
  const calls: string[] = [];
  const noop = (name: string) => () => void calls.push(name);
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    globalAlpha: 1,
    font: "",
    textAlign: "",
    textBaseline: "",
    save: noop("save"),
    restore: noop("restore"),
    beginPath: noop("beginPath"),
    closePath: noop("closePath"),
    moveTo: noop("moveTo"),
    lineTo: noop("lineTo"),
    quadraticCurveTo: noop("quadraticCurveTo"),
    stroke: noop("stroke"),
    fill: noop("fill"),
    arc: noop("arc"),
    fillRect: noop("fillRect"),
    fillText: noop("fillText"),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe("event sprites", () => {
  it("drawSanta issues fills/strokes without throwing", () => {
    const { ctx, calls } = recordingCtx();
    expect(() => drawSanta(ctx, 120, 40, 1.15)).not.toThrow();
    expect(calls).toContain("fill");
    expect(calls).toContain("stroke"); // rein line + antlers
    expect(calls).toContain("fillRect"); // the enriched board rider (integer rects)
    expect(calls.filter((c) => c === "save")).toHaveLength(1);
    expect(calls.filter((c) => c === "restore")).toHaveLength(1); // balanced save/restore
  });

  it("drawExplosion draws a fading starburst, and no-ops once fully faded", () => {
    const mid = recordingCtx();
    drawExplosion(mid.ctx, 100, 100, 40, 0.3);
    expect(mid.calls).toContain("fill");

    // phase >= 1 → alpha 0 → nothing drawn (the retire frame).
    const done = recordingCtx();
    drawExplosion(done.ctx, 100, 100, 40, 1);
    expect(done.calls).toHaveLength(0);
    // zero/negative radius is a no-op too (guards a degenerate camera zoom).
    const tiny = recordingCtx();
    drawExplosion(tiny.ctx, 100, 100, 0, 0.2);
    expect(tiny.calls).toHaveLength(0);
  });

  it("drawThief draws the figure (and a guard when caught) without throwing", () => {
    const loose = recordingCtx();
    expect(() => drawThief(loose.ctx, 100, 200, 1.1, false)).not.toThrow();
    expect(loose.calls).toContain("fillRect"); // the board burglar (integer rects, no $ glyph)
    expect(loose.calls).not.toContain("fillText"); // the board burglar has no $ glyph
    expect(loose.calls.filter((c) => c === "restore")).toHaveLength(1);
    // Caught → the extra guard figure means strictly more draw calls.
    const caught = recordingCtx();
    drawThief(caught.ctx, 100, 200, 1.1, true);
    expect(caught.calls.length).toBeGreaterThan(loose.calls.length);
  });

  it("drawTreasure fades out (no-op at phase 1) and drawVipLimo draws without throwing", () => {
    const mid = recordingCtx();
    drawTreasure(mid.ctx, 50, 50, 1, 0.2);
    expect(mid.calls).toContain("fill");
    const gone = recordingCtx();
    drawTreasure(gone.ctx, 50, 50, 1, 1); // fully faded → nothing drawn
    expect(gone.calls).toHaveLength(0);

    const limo = recordingCtx();
    expect(() => drawVipLimo(limo.ctx, 300, 400, 1)).not.toThrow();
    expect(limo.calls).toContain("fillRect");
    expect(limo.calls.filter((c) => c === "restore")).toHaveLength(1);
  });
});
