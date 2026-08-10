import { describe, it, expect } from "vitest";
import type { Unit } from "../../engine/types";
import { drawRoom } from "../pixelSprites";
import { geoVariant, type RoomCtx } from "./common";
import { FLOOR, TILE } from "../scale";
import { AMUSEMENTS_LOOKS } from "./amusements";
import { BOUTIQUE_LOOKS } from "./boutique";
import { FITNESS_LOOKS } from "./fitness";

/**
 * Room CONTAINMENT, split from `roomCapacity.test.ts` so both stay under the
 * line ceiling. That file proves each room draws the crowd it holds; this one
 * proves it does not solve the count by drawing through a wall.
 */

/** A recording 2D-context stand-in: every draw call and style set is logged. */
function spyCtx() {
  const log: string[] = [];
  const ctx: Record<string, unknown> = {};
  for (const m of [
    "save", "restore", "beginPath", "closePath", "moveTo", "lineTo", "arc",
    "fill", "stroke", "fillRect", "strokeRect", "fillText", "translate", "scale",
  ]) {
    ctx[m] = (...a: unknown[]) => log.push(`${m}:${JSON.stringify(a)}`);
  }
  for (const q of ["fillStyle", "strokeStyle", "lineWidth", "font", "textAlign", "globalAlpha"]) {
    let v: unknown;
    Object.defineProperty(ctx, q, { get: () => v, set: (nv) => { v = nv; log.push(`${q}=${String(nv)}`); } });
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log };
}

/** An hour each kind is actually open. A closed venue paints its shutter and
 *  nobody at all, so measuring a bar at noon measures nothing. */
const OPEN_HOUR: Record<string, number> = { skyBar: 20, nightclub: 22 };
const room = (ctx: CanvasRenderingContext2D, kind?: string): RoomCtx =>
  ({ ctx, lit: false, anim: 0, hour: OPEN_HOUR[kind ?? ""] ?? 12 });

/** Every fillRect the log recorded, as [x, w] pairs. */
function rectSpans(log: string[]): [number, number][] {
  return log
    .filter((l) => l.startsWith("fillRect:"))
    .map((l) => JSON.parse(l.slice("fillRect:".length)) as number[])
    .map(([x, , w]) => [x, w] as [number, number]);
}

function unit(over: Partial<Unit>): Unit {
  return { id: 1, floor: 10, x: 20, state: "occupied", satisfaction: 0.8, ...over } as Unit;
}

/** Office layout selector: `geoVariant(u, 3, 5)` picks 0-2 cubicle row, 3
 *  meeting, 4 executive. */
const officeLayout = (n: number) => (u: Pick<Unit, "kind" | "floor" | "x">): boolean => geoVariant(u, 3, 5) === n;

describe("a full room keeps every figure and fixture inside its own box", () => {
  // Packing the restored slots back in must not solve the count by drawing
  // through a wall, and a room narrower than its catalog width must give up
  // furniture rather than spill it: the preview and gallery pages render these
  // rooms at sizes of their own. Anything outside the box is clipped away by
  // both draw paths, so a row that reaches past the wall is not a bleed onto the
  // neighbor, it is furniture the player never sees, which is this bug again.
  //
  // Widths start at 6 tiles. Below that these kinds have never been drawable:
  // their fixed-size wall art alone is wider than the room, which is older than
  // this change and is not what these rows are about.
  const KINDS: [string, number, Partial<Unit>][] = [
    ["office", 6, { kind: "office" }],
    ...Object.keys(AMUSEMENTS_LOOKS).map((s) => [`amusements ${s}`, 25, { kind: "amusements", subtype: s }] as [string, number, Partial<Unit>]),
    ...Object.keys(BOUTIQUE_LOOKS).map((s) => [`boutiqueBay ${s}`, 22, { kind: "boutiqueBay", subtype: s }] as [string, number, Partial<Unit>]),
    ["skyBar", 22, { kind: "skyBar" }],
    ["nightclub", 30, { kind: "nightclub" }],
    ["daycare", 14, { kind: "daycare" }],
    ["spa", 18, { kind: "spa" }],
    ...Object.keys(FITNESS_LOOKS).map((s) => [`fitnessClub ${s}`, 20, { kind: "fitnessClub", subtype: s }] as [string, number, Partial<Unit>]),
  ];

  // Every width from 6 tiles up, in 3px steps rather than whole tiles. A row
  // that lands its last item exactly on its limit spills only at the widths
  // where the compressed pitch divides that way, so a sweep of five round tile
  // counts walks straight past it: the arcade and claw players spilled at 144px
  // (which is what `preview.ts` renders a 12-tile room at) while every whole-tile
  // width was clean.
  // The office picks one column per geo layout so all five are swept; the other
  // kinds take their variety from the subtype, which the cases pass explicitly.
  const officeColumns = [0, 1, 2, 3, 4].map((n) => {
    for (let x = 0; x < 400; x++) if (officeLayout(n)({ kind: "office", floor: 10, x })) return x;
    throw new Error(`no office column draws layout ${n}`);
  });

  it.each(KINDS)("%s stays in the box at every width, at full population", (label, occupants, over) => {
    const columns = over.kind === "office" ? officeColumns : [0, 1, 2, 3];
    for (let W = 6 * TILE; W <= 260; W += 3) {
      const tiles = Math.round(W / TILE);
      for (const x of columns) {
        const s = spyCtx();
        drawRoom(room(s.ctx, String(over.kind)), unit({ ...over, width: tiles, occupants, x }), 0, 0, W, FLOOR);
        for (const [rx, rw] of rectSpans(s.log)) {
          expect(rx, `${label} at ${W}px, column ${x}, drew from ${rx}`).toBeGreaterThanOrEqual(0);
          expect(rx + rw, `${label} at ${W}px, column ${x}, drew to ${rx + rw}, past ${W}`).toBeLessThanOrEqual(W);
        }
      }
    }
  });
});
