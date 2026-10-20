import { describe, expect, it } from "vitest";
import type { FacilityKind, Unit } from "../../engine/types";
import { FACILITIES } from "../../engine/facilities";
import { drawRoom } from "../pixelSprites";
import { lookupRoom, type LiveScene } from "../atlas/lookup";
import { occupantCap } from "../atlas/catalog";
import { roomOccupants, type RoomCtx } from "./common";
import { AMUSEMENTS_LOOKS } from "./amusements";
import { BOUTIQUE_LOOKS } from "./boutique";
import { FITNESS_LOOKS } from "./fitness";
import { FLOOR, TILE } from "../scale";

/**
 * Two promises the atlas makes about the rooms the #813 fix rewired, held here
 * so the painters cannot drift from them.
 *
 * One rounding: the live painter and the atlas reader turn a room's occupancy
 * into the same whole number of people, so a native frontend drawing from the
 * atlas shows the crowd the web shows.
 *
 * A crowd only grows: the atlas bakes a room's crowd one person at a time and
 * draws step n over step n - 1, so everything drawn for n - 1 people must still
 * be drawn, unmoved, for n. A figure that steps aside once a seat fills (the sky
 * bar's bartender did) breaks that.
 */

const DAY: LiveScene = { hour: 12, lit: false, parkingUse: 0, recycleFill: 0, dead: false };

describe("roomOccupants agrees with the atlas reader", () => {
  const counts = [0, 0.4, 0.5, 1, 2.5, 3.7, 6, -2, Number.NaN, Number.POSITIVE_INFINITY];
  const out = [undefined, -9, -0.5, 0, 1, 1.5, 9, Number.NaN, Number.POSITIVE_INFINITY];
  it.each(counts)("occupants %s", (occupants) => {
    for (const outForMeal of out) {
      const u = { kind: "nightclub" as const, state: "occupied" as const, width: FACILITIES.nightclub.width, occupants, outForMeal, id: 1 };
      const atlas = lookupRoom(u, DAY, 0);
      const atlasCount = "chains" in atlas && atlas.chains ? (atlas.chains.occupants ?? 0) : 0;
      expect(roomOccupants(u), `outForMeal ${outForMeal}`).toBe(atlasCount);
    }
  });
});

/** Every fillRect a room makes, as a multiset keyed by call and color. */
function draws(u: Unit, hour: number): Map<string, number> {
  const seen = new Map<string, number>();
  let fill = "";
  const ctx: Record<string, unknown> = {};
  for (const m of ["save", "restore", "beginPath", "closePath", "moveTo", "lineTo", "arc", "fill", "stroke", "strokeRect", "fillText", "translate", "scale", "setTransform"]) {
    ctx[m] = () => {};
  }
  ctx.fillRect = (...a: number[]) => {
    const k = `${fill}@${a.join(",")}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  };
  for (const p of ["strokeStyle", "lineWidth", "font", "textAlign", "globalAlpha"]) ctx[p] = undefined;
  Object.defineProperty(ctx, "fillStyle", { get: () => fill, set: (v: string) => { fill = String(v); } });
  const d = { ctx: ctx as unknown as CanvasRenderingContext2D, lit: false, anim: 0, hour } as RoomCtx;
  drawRoom(d, u, 0, 0, u.width * TILE, FLOOR);
  return seen;
}

const OPEN_HOUR: Partial<Record<FacilityKind, number>> = { skyBar: 20, nightclub: 22 };
// The office is left out on purpose: an empty desk's monitor is dark and a
// staffed one is lit, so its desks change as well as gain a worker. The atlas
// carries that through its soft-furniture layer, not by adding people.
const CASES: [FacilityKind, string | undefined][] = [
  ["skyBar", undefined], ["nightclub", undefined], ["daycare", undefined], ["spa", undefined],
  ...Object.keys(AMUSEMENTS_LOOKS).map((s): [FacilityKind, string] => ["amusements", s]),
  ...Object.keys(BOUTIQUE_LOOKS).map((s): [FacilityKind, string] => ["boutiqueBay", s]),
  ...Object.keys(FITNESS_LOOKS).map((s): [FacilityKind, string] => ["fitnessClub", s]),
];

describe("a rewired room's crowd only grows", () => {
  it.each(CASES)("%s %s", (kind, subtype) => {
    const hour = OPEN_HOUR[kind] ?? 12;
    const cap = occupantCap(kind);
    for (let x = 0; x < 16; x++) {
      const base = { id: 7, floor: 12, x, kind, subtype, state: "occupied", width: FACILITIES[kind].width, satisfaction: 0.8 };
      let prev = draws({ ...base, occupants: 1 } as Unit, hour);
      for (let n = 2; n <= cap; n++) {
        const next = draws({ ...base, occupants: n } as Unit, hour);
        for (const [k, c] of prev) {
          expect(next.get(k) ?? 0, `${kind} ${subtype ?? ""} at x ${x}: ${k} drawn for ${n - 1} people is gone at ${n}`).toBeGreaterThanOrEqual(c);
        }
        prev = next;
      }
    }
  });
});

describe("a rewired room draws a fractional occupancy as the whole people the atlas reads", () => {
  // `roomOccupants` rounds up, as `atlas/lookup.ts` does. A painter that read the
  // raw count instead would draw 2 people for 2.5 where the atlas bakes 3, and the
  // pure-function test above could not tell, so hold each painter to it.
  it.each(CASES)("%s %s", (kind, subtype) => {
    const hour = OPEN_HOUR[kind] ?? 12;
    const cap = occupantCap(kind);
    const base = { id: 7, floor: 12, x: 5, kind, subtype, state: "occupied", width: FACILITIES[kind].width, satisfaction: 0.8 };
    for (const k of [1, 2, 3, 5].filter((n) => n <= cap)) {
      const whole = draws({ ...base, occupants: k } as Unit, hour);
      for (const frac of [k - 0.5, k - 0.01]) {
        const part = draws({ ...base, occupants: frac } as Unit, hour);
        expect([...part], `${kind} ${subtype ?? ""} at ${frac} people`).toEqual([...whole]);
      }
    }
  });
});
