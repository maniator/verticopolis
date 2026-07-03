import { describe, it, expect } from "vitest";
import { drawSanta, drawExplosion } from "../render/sprites/events";
import { Simulation } from "../engine/Simulation";

/**
 * Smoke coverage for the two event visuals added for parity: they are
 * immediate-mode canvas draws (no Excalibur actors), so the meaningful checks
 * are (a) they issue draw calls without throwing on a bare 2D context, and
 * (b) the engine-facing signal the renderer polls is a transient that never
 * leaks into the save.
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
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe("event sprites", () => {
  it("drawSanta issues fills/strokes without throwing", () => {
    const { ctx, calls } = recordingCtx();
    expect(() => drawSanta(ctx, 120, 40, 1.15)).not.toThrow();
    expect(calls).toContain("fill");
    expect(calls).toContain("stroke"); // rein line + antlers
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
});

describe("event fx signals on the Simulation (cosmetic, transient)", () => {
  it("triggerSanta / triggerExplosion bump a counter the renderer polls", () => {
    const sim = Simulation.newGame(1);
    expect(sim.santaFxSeq).toBe(0);
    sim.triggerSanta();
    sim.triggerSanta();
    expect(sim.santaFxSeq).toBe(2);

    expect(sim.explosionFx.seq).toBe(0);
    sim.triggerExplosion(7, 42);
    expect(sim.explosionFx).toEqual({ floor: 7, x: 42, seq: 1 });
  });

  it("the fx signals are NOT serialized — they never ride along in a save", () => {
    const sim = Simulation.newGame(1);
    sim.triggerSanta();
    sim.triggerExplosion(9, 30);
    const data = sim.serialize() as unknown as Record<string, unknown>;
    expect(data.santaFxSeq).toBeUndefined();
    expect(data.explosionFx).toBeUndefined();
    // A reload starts the visual counters clean.
    const reloaded = Simulation.deserialize(sim.serialize());
    expect(reloaded.santaFxSeq).toBe(0);
    expect(reloaded.explosionFx.seq).toBe(0);
  });
});
