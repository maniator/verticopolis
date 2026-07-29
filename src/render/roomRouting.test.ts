import { describe, it, expect } from "vitest";
import type { Unit } from "../engine/types";
import { drawUnit, type DrawCtx } from "./sprites";
import { FACILITIES } from "../engine/facilities";
import { isElevatorKind } from "../engine/facilityPredicates";
import { isFixedSpanTransport } from "../engine/facilityCaps";

/**
 * Regression guard for the rental-living render bug: a leased Studio/Apartment
 * rendered as a single flat facility-color block (the teal/olive "squares")
 * because the two kinds were added to drawRoom's per-kind switch but NOT to the
 * ROOM_KINDS gate in sprites.ts that decides whether drawUnit even calls
 * drawRoom. Missing the gate, they fell through to drawInterior's `default`
 * case: one fillRect in FACILITIES[kind].color.
 *
 * Every leased tenant room is pinned to the rich dollhouse path here, so a
 * future room kind can't slip through the same gap: a real room sets dozens of
 * wall/furniture fill colors, the flat fallback sets ~1.
 */

/** A recording 2D-context stand-in: logs every style assignment and draw call
 *  (mirrors the spy in sprites.test.ts, kept local so this file stands alone). */
function spyCtx() {
  const log: string[] = [];
  const ctx: Record<string, unknown> = {};
  const methods = ["save", "restore", "beginPath", "closePath", "moveTo", "lineTo", "arc", "arcTo", "quadraticCurveTo", "bezierCurveTo", "rect", "roundRect", "ellipse", "fill", "stroke", "fillRect", "strokeRect", "clearRect", "fillText", "strokeText", "translate", "scale", "rotate", "clip", "setLineDash", "drawImage"];
  for (const m of methods) ctx[m] = (...a: unknown[]) => log.push(`${m}:${JSON.stringify(a)}`);
  ctx.createLinearGradient = () => ({ addColorStop: () => {} });
  ctx.createRadialGradient = () => ({ addColorStop: () => {} });
  ctx.measureText = () => ({ width: 10 });
  for (const p of ["fillStyle", "strokeStyle", "lineWidth", "globalAlpha", "font", "textAlign", "textBaseline", "lineCap", "lineJoin"]) {
    let v: unknown = "";
    Object.defineProperty(ctx, p, { get: () => v, set: (nv) => (log.push(`${p}=${String(nv)}`), void (v = nv)) });
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log };
}
function unit(over: Partial<Unit>): Unit {
  return { id: 7, kind: "office", floor: 3, x: 5, width: 8, state: "occupied", satisfaction: 1, occupants: 2, ...over } as Unit;
}
const draw = (ctx: CanvasRenderingContext2D): DrawCtx => ({ ctx, lit: true, anim: 0.5, hour: 14 });
const fillColorSets = (log: string[]) => log.filter((l) => l.startsWith("fillStyle=")).length;

describe("drawUnit routes leased tenant rooms to the detailed dollhouse, not the flat fill", () => {
  it.each([
    ["rentalStudio", 6],
    ["rentalApartment", 11],
  ] as const)("an occupied %s draws a full room (dozens of fill colors, not a flat block)", (kind, wTiles) => {
    const s = spyCtx();
    drawUnit(draw(s.ctx), unit({ kind, width: wTiles, state: "occupied", occupants: 2 }), 0, 0, wTiles * 11, 34);
    // A furnished dollhouse sets many colors; the flat facility-color fallback ~1.
    expect(fillColorSets(s.log)).toBeGreaterThan(20);
  });

  it("a vacant rental still routes to drawRoom (the LEASE shell), not the flat fill", () => {
    const s = spyCtx();
    drawUnit(draw(s.ctx), unit({ kind: "rentalStudio", width: 6, state: "empty", occupants: 0 }), 0, 0, 66, 34);
    // The shell writes its "LEASE" plate text; the flat fallback never draws text.
    expect(s.log.some((l) => l.startsWith("fillText") && l.includes("LEASE"))).toBe(true);
  });
});

describe("no facility kind falls through to the flat facility-color fallback (systemic guard)", () => {
  // The rental bug's root cause was structural: ROOM_KINDS (the gate in sprites.ts)
  // is a hand-maintained mirror of drawRoom's per-kind switch, and drawInterior's
  // `default` paints one flat FACILITIES[kind].color block. A kind that is a real
  // room but forgotten in ROOM_KINDS (or a service missing its drawInterior case)
  // renders as that flat block, silently, past a green suite. Render EVERY facility
  // kind and assert none produces the flat-fallback signature, so the next kind
  // added can't slip through the same gap the two rentals did.
  // Transports (stairs/escalator/elevators) are catalog facilities but are drawn
  // by the transport renderer, never through drawUnit, so they are out of scope.
  const kinds = (Object.keys(FACILITIES) as (keyof typeof FACILITIES)[]).filter(
    (k) => !isElevatorKind(k) && !isFixedSpanTransport(k),
  );
  it.each(kinds)("%s renders content, not a flat facility-color block", (kind) => {
    const s = spyCtx();
    const w = Math.max(4, FACILITIES[kind].width ?? 6) * 11;
    drawUnit(draw(s.ctx), unit({ kind, width: FACILITIES[kind].width ?? 6, state: "occupied", occupants: 2 }), 0, 0, w, 34);
    const colors = new Set(s.log.filter((l) => l.startsWith("fillStyle=")).map((l) => l.slice("fillStyle=".length)));
    // The flat fallback sets exactly the one facility color and nothing else.
    const hitFlatFallback = colors.size <= 1 && colors.has(FACILITIES[kind].color);
    expect(hitFlatFallback, `${kind} rendered as a flat ${FACILITIES[kind].color} block, missing from ROOM_KINDS or lacking a drawInterior case?`).toBe(false);
  });
});
