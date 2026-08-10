import { describe, it, expect } from "vitest";
import { drawShaftNumbers } from "./towerShaftNumbers";

/**
 * Elevator floor numbers, drawn in screen space by the overlay. Behavior is
 * asserted against drawShaftNumbers directly rather than through drawOverlay,
 * because the ruler also draws floor-number text and would pollute label
 * assertions. Pixel fidelity is the Playwright visual tier's job; this pins the
 * label set, the express skip-floors, basement labels, car occlusion, the
 * outline-then-fill order, and the readable-zoom cull.
 */

/** A recording 2D-context stand-in: text and style writes logged as strings. */
function spyCtx() {
  const log: string[] = [];
  const ctx: any = {};
  for (const m of ["fillText", "strokeText", "fillRect", "save", "restore"]) ctx[m] = (...a: unknown[]) => log.push(`${m}:${JSON.stringify(a)}`);
  for (const p of ["fillStyle", "strokeStyle", "lineWidth", "font", "textAlign", "textBaseline", "lineJoin", "miterLimit"]) {
    let v: unknown = "";
    Object.defineProperty(ctx, p, { get: () => v, set: (nv) => void (v = nv) });
  }
  return { ctx: ctx as CanvasRenderingContext2D, log };
}

/** A fake TowerEngine with simple, consistent screen transforms: x is identity,
 *  floor f sits at screen y (300 - f), so a shaft at x:100 w:4 centers at 102
 *  and every floor lands inside the 800x600 viewport. */
function eng(over: Record<string, any> = {}): any {
  return {
    viewWidth: 800,
    viewHeight: 600,
    cam: { zoom: 1 },
    sim: { tower: { transports: [] } },
    worldToScreenX: (tile: number) => tile,
    worldToScreenY: (floor: number) => 300 - floor,
    screenToFloor: (sy: number) => 300 - sy,
    ...over,
  };
}

function shaft(over: Record<string, any> = {}): any {
  return { id: 1, kind: "elevatorStandard", x: 100, width: 4, bottom: 1, top: 3, carPositions: [], ...over };
}

function textCalls(log: string[], method: "fillText" | "strokeText"): { text: string; x: number; y: number }[] {
  const out: { text: string; x: number; y: number }[] = [];
  for (const l of log) {
    if (!l.startsWith(method + ":")) continue;
    const a = JSON.parse(l.slice(method.length + 1)) as [string, number, number];
    out.push({ text: String(a[0]), x: a[1], y: a[2] });
  }
  return out;
}

function withShafts(shafts: any[], over: Record<string, any> = {}) {
  const e = eng(over);
  e.sim.tower.transports = shafts;
  return e;
}
function labels(log: string[]): Set<string> {
  return new Set(textCalls(log, "fillText").map((t) => t.text));
}

describe("elevator floor numbers (overlay)", () => {
  it("draws a number for each served floor", () => {
    const s = spyCtx();
    drawShaftNumbers(withShafts([shaft({ bottom: 1, top: 3 })]), s.ctx);
    const l = labels(s.log);
    expect(l.has("1")).toBe(true);
    expect(l.has("2")).toBe(true);
    expect(l.has("3")).toBe(true);
  });

  it("skips express skip-floors", () => {
    const s = spyCtx();
    drawShaftNumbers(withShafts([shaft({ kind: "elevatorExpress", bottom: 1, top: 4, skipFloors: [2, 3] })]), s.ctx);
    const l = labels(s.log);
    expect(l.has("1")).toBe(true);
    expect(l.has("4")).toBe(true);
    expect(l.has("2")).toBe(false);
    expect(l.has("3")).toBe(false);
  });

  it("numbers basements below the ground floor", () => {
    const s = spyCtx();
    drawShaftNumbers(withShafts([shaft({ bottom: -1, top: 1 })]), s.ctx);
    const l = labels(s.log);
    expect(l.has("1")).toBe(true); // ground
    expect(l.has("B1")).toBe(true); // floor 0
    expect(l.has("B2")).toBe(true); // floor -1
  });

  it("hides the number on a floor a car is currently over", () => {
    const s = spyCtx();
    drawShaftNumbers(withShafts([shaft({ bottom: 1, top: 3, carPositions: [2] })]), s.ctx);
    const l = labels(s.log);
    expect(l.has("1")).toBe(true);
    expect(l.has("3")).toBe(true);
    expect(l.has("2")).toBe(false); // the cab rides over its floor's number
  });

  it("draws the dark outline before the bright glyph so the fill lands on top", () => {
    const s = spyCtx();
    drawShaftNumbers(withShafts([shaft({ bottom: 3, top: 3 })]), s.ctx);
    const strokeIdx = s.log.findIndex((l) => l.startsWith('strokeText:["3"'));
    const fillIdx = s.log.findIndex((l) => l.startsWith('fillText:["3"'));
    expect(strokeIdx).toBeGreaterThanOrEqual(0);
    expect(fillIdx).toBeGreaterThan(strokeIdx);
  });

  it("draws nothing when zoomed out past the readable floor height", () => {
    const s = spyCtx();
    drawShaftNumbers(withShafts([shaft({ bottom: 1, top: 3 })], { cam: { zoom: 0.2 } }), s.ctx);
    expect(textCalls(s.log, "fillText").length).toBe(0);
  });

  it("skips a shaft whose center is a full half-width off-screen", () => {
    // shaftWpx = width * TILE(10) * zoom = 40, so the off-screen margin is 20px.
    const off = spyCtx();
    drawShaftNumbers(withShafts([shaft({ x: -30, width: 4 })]), off.ctx); // cx = -28 < -20
    expect(textCalls(off.log, "fillText").length).toBe(0);
    const on = spyCtx();
    drawShaftNumbers(withShafts([shaft({ x: -8, width: 4 })]), on.ctx); // cx = -6, still on-screen
    expect(textCalls(on.log, "fillText").length).toBeGreaterThan(0);
  });

  it("does not number stairs or escalators", () => {
    const s = spyCtx();
    drawShaftNumbers(withShafts([shaft({ kind: "stairs", bottom: 1, top: 3 }), shaft({ kind: "escalator", bottom: 1, top: 3 })]), s.ctx);
    expect(textCalls(s.log, "fillText").length).toBe(0);
  });

  it("brackets its shared-context writes in save/restore so nothing leaks", () => {
    const s = spyCtx();
    drawShaftNumbers(withShafts([shaft({ bottom: 1, top: 3 })]), s.ctx);
    const saveIdx = s.log.findIndex((l) => l.startsWith("save:"));
    const restoreIdx = s.log.findIndex((l) => l.startsWith("restore:"));
    const firstStroke = s.log.findIndex((l) => l.startsWith("strokeText:"));
    expect(saveIdx).toBeGreaterThanOrEqual(0);
    expect(saveIdx).toBeLessThan(firstStroke); // saved before drawing
    expect(restoreIdx).toBeGreaterThan(firstStroke); // restored after drawing
  });

  it("neither saves nor restores when it early-returns zoomed out (stays balanced)", () => {
    const s = spyCtx();
    drawShaftNumbers(withShafts([shaft({ bottom: 1, top: 3 })], { cam: { zoom: 0.2 } }), s.ctx);
    expect(s.log.some((l) => l.startsWith("save:"))).toBe(false);
    expect(s.log.some((l) => l.startsWith("restore:"))).toBe(false);
  });
});
