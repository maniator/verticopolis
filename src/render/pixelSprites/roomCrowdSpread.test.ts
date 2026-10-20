import { describe, expect, it } from "vitest";
import type { FacilityKind, Unit } from "../../engine/types";
import { FACILITIES } from "../../engine/facilities";
import { drawRoom } from "../pixelSprites";
import { FLOOR, TILE } from "../scale";
import type { RoomCtx } from "./common";

/**
 * Where a rewired room seats its people, binding two promises the capacity suite
 * leaves open. A small crowd is spread over the whole row, not banked against
 * one end (the first cut of `busyStations` took the first seats that cleared a
 * threshold), and the nightclub's dancers stand on their authored 6px pitch with
 * the last one clear of the DJ booth.
 */

interface Figure { x: number; y: number }

/** Every finalized figure a room draws: the person builds stamp one contact-shadow
 *  literal per figure, one pixel left of it. */
function figures(u: Unit, hour: number): Figure[] {
  const out: Figure[] = [];
  let fill = "";
  let armed = false;
  const ctx: Record<string, unknown> = {};
  for (const m of ["save", "restore", "beginPath", "closePath", "moveTo", "lineTo", "arc", "fill", "stroke", "strokeRect", "fillText", "translate", "scale", "setTransform"]) {
    ctx[m] = () => {};
  }
  ctx.fillRect = (x: number, y: number) => {
    if (!armed) return;
    out.push({ x: x + 1, y });
    armed = false;
  };
  for (const p of ["strokeStyle", "lineWidth", "font", "textAlign", "globalAlpha"]) ctx[p] = undefined;
  Object.defineProperty(ctx, "fillStyle", { get: () => fill, set: (v: string) => { fill = String(v); armed = fill === "rgba(0,0,0,0.24)"; } });
  drawRoom({ ctx: ctx as unknown as CanvasRenderingContext2D, lit: false, anim: 0, hour } as RoomCtx, u, 0, 0, u.width * TILE, FLOOR);
  return out;
}

const key = (f: Figure): string => `${f.x},${f.y}`;

function unitAt(kind: FacilityKind, subtype: string | undefined, x: number, occupants: number): Unit {
  return { id: 7, floor: 12, x, kind, subtype, state: "occupied", width: FACILITIES[kind].width, satisfaction: 0.8, occupants } as Unit;
}

const SPREAD: [FacilityKind, string | undefined, number][] = [
  ["nightclub", undefined, 22],
  ["skyBar", undefined, 20],
  ["fitnessClub", "Spin Studio", 12],
];

describe("a lone visitor is spread over the whole row", () => {
  it.each(SPREAD)("%s %s", (kind, subtype, hour) => {
    // One visitor in 200 differently seeded rooms. Staff stand in the same place
    // every time, so what is left after taking out the figures common to every
    // room is the visitors.
    const rooms = Array.from({ length: 200 }, (_, x) => figures(unitAt(kind, subtype, x, 1), hour));
    const staff = new Set(rooms[0].map(key).filter((k) => rooms.every((r) => r.some((f) => key(f) === k))));
    const visitors = rooms.flat().filter((f) => !staff.has(key(f))).map((f) => f.x);
    // The full crowd gives the row's extent.
    const full = figures(unitAt(kind, subtype, 3, FACILITIES[kind].population ?? 0), hour).filter((f) => !staff.has(key(f))).map((f) => f.x);
    const lo = Math.min(...full);
    const hi = Math.max(...full);
    const span = hi - lo;
    const mean = visitors.reduce((a, b) => a + b, 0) / visitors.length;
    expect(new Set(visitors).size, "the visitor stands in many places").toBeGreaterThan(8);
    expect(Math.abs(mean - (lo + hi) / 2), `mean ${mean} of a row ${lo}..${hi}`).toBeLessThan(0.12 * span);
    expect(Math.min(...visitors)).toBeLessThanOrEqual(lo + 0.15 * span);
    expect(Math.max(...visitors)).toBeGreaterThanOrEqual(hi - 0.15 * span);
  });
});

describe("the nightclub crowd", () => {
  it("dances on a 6px pitch and stops short of the booth", () => {
    const u = unitAt("nightclub", undefined, 3, FACILITIES.nightclub.population ?? 0);
    const w = u.width * TILE;
    const all = figures(u, 22);
    const floorY = Math.max(...all.map((f) => f.y));
    // The DJ stands behind the booth, above the floor line; the dancers on it.
    const dancers = all.filter((f) => f.y === floorY).map((f) => f.x).sort((a, b) => a - b);
    expect(dancers.length).toBeGreaterThan(8);
    expect(new Set(dancers.slice(1).map((x, i) => x - dancers[i]))).toEqual(new Set([6]));
    const boothX = Math.round(w * 0.72);
    expect(dancers[dancers.length - 1] + 6, "the last dancer's torso reaches the booth").toBeLessThanOrEqual(boothX);
  });
});
