import { describe, expect, it } from "vitest";
import { hasBusinessHours, isOpenAt } from "../../engine/facilities";
import type { FacilityKind } from "../../engine/types";
import { withLayerHook } from "../pixelSprites/layers";
import { DEPTH_FLAT_KINDS, roomJobs, roomKinds, type StillJob } from "./catalog";
import { paint, type UnitPaint } from "./paint";

/** A 2D context that accepts every call (the pixels are checked in a real
 *  browser by the export and the e2e spec). */
function sinkCtx(): CanvasRenderingContext2D {
  const grad = { addColorStop: () => undefined };
  return new Proxy({} as Record<string, unknown>, {
    get(target, prop) {
      if (prop in target) return target[prop as string];
      if (prop === "createLinearGradient" || prop === "createRadialGradient" || prop === "createPattern") return () => grad;
      if (prop === "measureText") return () => ({ width: 10 });
      if (prop === "getLineDash") return () => [];
      return () => undefined;
    },
    set(target, prop, v) {
      target[prop as string] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

/** The kinds whose vacant state paints the LEASE or SALE card. */
const VACANCY_KINDS = new Set<FacilityKind>(["office", "condo", "rentalStudio", "rentalApartment"]);

/** The services and venues the game draws as interiors (`sprites.ts`
 *  `drawInterior`): they never show the closed shutter. */
const INTERIOR_KINDS = new Set<FacilityKind>(["partyHall", "aquaticCenter", "weddingHall", "security", "medical", "housekeeping", "metro", "parking", "parkingRamp", "recycling"]);

/** Whether the game paints `s` as a full room (so it should split), rather
 *  than a vacancy card, a closed shutter or a gutted shell. */
function paintsRoom(s: UnitPaint): boolean {
  if (DEPTH_FLAT_KINDS.has(s.kind) || s.state === "gutted") return false;
  if (s.state === "empty" && VACANCY_KINDS.has(s.kind)) return false;
  if (!INTERIOR_KINDS.has(s.kind) && s.state !== "empty" && hasBusinessHours(s.kind) && !isOpenAt(s.kind, s.hour)) return false;
  return true;
}

/** The marks one paint makes, in order. */
function marks(s: UnitPaint, w: number, h: number): string[] {
  const seen: string[] = [];
  withLayerHook({ shellEnd: () => seen.push("break"), furnitureEnd: () => seen.push("end") }, () => paint(sinkCtx(), s, w, h));
  return seen;
}

describe("depth-layer marks across the room catalog", () => {
  const stills = roomJobs().filter((j): j is StillJob => j.type === "still");

  it("asks for a split on every room still frame", () => {
    expect(stills.length).toBeGreaterThan(0);
    expect(stills.every((j) => j.layers === true)).toBe(true);
  });

  it("marks exactly one break on every frame that paints a room, and none on vacancy cards, shutters, gutted shells or the flat kinds", () => {
    const wrong: string[] = [];
    const split = new Set<FacilityKind>();
    for (const j of stills) {
      const s = j.paint as UnitPaint;
      const seen = marks(s, j.w, j.h);
      const breaks = seen.filter((m) => m === "break").length;
      const want = paintsRoom(s) ? 1 : 0;
      if (breaks !== want) wrong.push(`${j.name}: ${breaks} breaks, want ${want}`);
      // Every end that counts comes after the break.
      if (breaks === 1 && seen[0] !== "break") wrong.push(`${j.name}: ends before its break`);
      if (breaks === 1) split.add(s.kind);
    }
    expect(wrong.slice(0, 10)).toEqual([]);
    // Every room kind outside the flat list splits somewhere in the catalog.
    const expected = roomKinds().filter((k) => !DEPTH_FLAT_KINDS.has(k));
    expect([...split].sort()).toEqual(expected.sort());
  });
});
