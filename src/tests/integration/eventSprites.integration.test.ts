import { describe, it, expect } from "vitest";
import { drawSanta, drawExplosion, drawThief, drawTreasure, drawVipLimo } from "../../render/sprites/events";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";

/**
 * Smoke coverage for the event visuals added for parity: they are immediate-mode
 * canvas draws (no Excalibur actors), so the meaningful checks are (a) they issue
 * draw calls without throwing on a bare 2D context, and (b) the engine-facing
 * signals the renderer polls are transients that never leak into the save.
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
    expect(loose.calls).toContain("fillText"); // the $ on the loot sack
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

describe("event fx signals on the Simulation (cosmetic, transient)", () => {
  it("each trigger bumps the counter the renderer polls", () => {
    const sim = Simulation.newGame(1);
    expect(sim.santaFxSeq).toBe(0);
    sim.triggerSanta();
    sim.triggerSanta();
    expect(sim.santaFxSeq).toBe(2);

    sim.triggerExplosion(7, 42);
    expect(sim.explosionFx).toEqual({ floor: 7, x: 42, seq: 1 });

    sim.triggerThief(true, 5);
    expect(sim.thiefFx).toEqual({ caught: true, floor: 5, seq: 1 });

    sim.triggerTreasure(-3, 12);
    expect(sim.treasureFx).toEqual({ floor: -3, x: 12, seq: 1 });

    sim.triggerVip();
    expect(sim.vipFxSeq).toBe(1);
  });

  it("unearthing buried treasure fires the sparkle trigger at the dig site", () => {
    // Mirrors simulation.test's deterministic treasure dig (seed 42): digging
    // parking into a fresh B1 slab turns up treasure, which must also bump the
    // cosmetic treasureFx the renderer polls.
    const sim = Simulation.newGame(42);
    sim.star = 3;
    sim.money = 10_000_000;
    const x0 = Math.floor(GRID.width / 2) - 20;
    for (let i = 0; i < 120 && x0 + i < GRID.width; i++) sim.tower.place("floor", 0, x0 + i);
    for (let i = 0; i + 6 <= 120 && x0 + i + 6 <= GRID.width; i += 6) sim.build("parking", 0, x0 + i);
    expect(sim.log.some((e) => e.text.toLowerCase().includes("treasure"))).toBe(true);
    expect(sim.treasureFx.seq).toBeGreaterThan(0); // the visual fired
    expect(sim.treasureFx.floor).toBe(0); // at the dug B1 slab
  });

  it("the fx signals are NOT serialized — they never ride along in a save", () => {
    const sim = Simulation.newGame(1);
    sim.triggerSanta();
    sim.triggerExplosion(9, 30);
    sim.triggerThief(false, 3);
    sim.triggerTreasure(-1, 5);
    sim.triggerVip();
    const data = sim.serialize() as unknown as Record<string, unknown>;
    for (const k of ["santaFxSeq", "explosionFx", "thiefFx", "treasureFx", "vipFxSeq"]) {
      expect(data[k]).toBeUndefined();
    }
    // A reload starts the visual counters clean.
    const reloaded = Simulation.deserialize(sim.serialize());
    expect(reloaded.santaFxSeq).toBe(0);
    expect(reloaded.explosionFx.seq).toBe(0);
    expect(reloaded.thiefFx.seq).toBe(0);
    expect(reloaded.treasureFx.seq).toBe(0);
    expect(reloaded.vipFxSeq).toBe(0);
  });
});
