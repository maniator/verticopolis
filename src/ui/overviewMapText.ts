/**
 * The overview MAP window's text summary (#343, CAP-5): what a screen reader
 * hears for the map canvas, including where the view is when it sits past a
 * Modern crop (a sighted player sees the edge band and its chevron). DOM-free,
 * so it is unit-tested on its own.
 */
import type { BuiltFloors, ViewPlacement } from "../render/overviewMap/extent";
import { floorLabel } from "./floorLabel";

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The built range as whole floors, the way the Modern crop reads it: a lowest
 *  floor that is not finite reads as the ground floor, and a top that is not
 *  finite, or under the lowest, as the lowest. Unlike the crop it is not held
 *  to the world: the view reports the floors it is given. */
function builtRange(built: BuiltFloors): { readonly lo: number; readonly hi: number } {
  const lo = Number.isFinite(built.lowestFloor) ? Math.floor(built.lowestFloor) : 1;
  const hi = Number.isFinite(built.highestFloor) ? Math.floor(built.highestFloor) : lo;
  return { lo, hi: Math.max(lo, hi) };
}

/** Floors above ground and basements in the built range. Floor 1 is the
 *  ground floor and floor 0 is B1. */
export function builtFloorCounts(built: BuiltFloors): { readonly above: number; readonly basements: number } {
  const { lo, hi } = builtRange(built);
  return { above: Math.max(0, hi - Math.max(lo, 1) + 1), basements: Math.max(0, Math.min(0, hi) - lo + 1) };
}

type Where = Pick<ViewPlacement, "outside" | "centerFloor">;

/** Where the view is, in words: its floor, or the sky above the top floor or the
 *  ground below the lowest, and whether it is past the map's edge. Empty when
 *  the camera's position is unknown. */
export function viewSentence(placement: Where, built: BuiltFloors): string {
  const floor = placement.centerFloor;
  if (floor === null) return "";
  const { lo, hi } = builtRange(built);
  let at = `The view is at floor ${floorLabel(floor)}`;
  if (floor > hi) at = `The view is above the top floor, ${floorLabel(hi)}`;
  else if (floor < lo) at = `The view is below the lowest floor, ${floorLabel(lo)}`;
  if (placement.outside === "above") return `${at}, past the top of the map.`;
  if (placement.outside === "below") return `${at}, past the bottom of the map.`;
  return `${at}.`;
}

/** The whole summary: the tower's size, then where the view is. */
export function mapSummary(built: BuiltFloors, placement: Where): string {
  const { above, basements } = builtFloorCounts(built);
  const size = basements > 0
    ? `${count(above, "floor", "floors")} above ground and ${count(basements, "basement", "basements")}.`
    : `${count(above, "floor", "floors")} above ground.`;
  const where = viewSentence(placement, built);
  return where ? `Tower map: ${size} ${where}` : `Tower map: ${size}`;
}
