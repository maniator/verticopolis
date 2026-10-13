import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hasBusinessHours, isOpenAt } from "../../engine/facilities";
import type { FacilityKind } from "../../engine/types";
import { withLayerHook } from "../pixelSprites/layers";
import { roomJobs, roomKinds, type StillJob } from "./catalog";
import { LOBBY_VARIANTS } from "../sprites";
import { structureJobs } from "./catalogExtras";
import { paint, type PaintSpec, type UnitPaint } from "./paint";

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
  if (s.state === "gutted") return false;
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
    for (const j of stills) expect(j.layers, j.name).toBe(true);
  });

  it("marks exactly one break on every frame that paints a room, and none on vacancy cards, shutters or gutted shells", () => {
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
    const expected = roomKinds();
    expect([...split].sort()).toEqual(expected.sort());
  });
});

describe("depth-layer marks on the lobby", () => {
  it("splits every lobby tile and every entrance frame with exactly one break", () => {
    const lobby = structureJobs().filter((j) => j.keys.kind === "lobby");
    const paints: [string, PaintSpec, number, number][] = lobby.flatMap((j) =>
      j.type === "still" ? [[j.name, j.paint, j.w, j.h] as [string, PaintSpec, number, number]] : j.frames.map((f, i) => [`${j.name}/${i}`, f, j.w, j.h] as [string, PaintSpec, number, number]),
    );
    // Two styles x lit/unlit x each variant, plus four entrances x lit/unlit
    // x staffed/unstaffed x two poses.
    expect(paints.length).toBe(2 * 2 * LOBBY_VARIANTS + 4 * 2 * 2 * 2);
    for (const j of lobby) expect(j.layers, j.name).toBe(true);
    const wrong: string[] = [];
    for (const [name, spec, w, h] of paints) {
      const seen: string[] = [];
      withLayerHook({ shellEnd: () => seen.push("break"), furnitureEnd: () => seen.push("end") }, () => paint(sinkCtx(), spec, w, h));
      if (seen.join() !== "break") wrong.push(`${name}: ${seen.join() || "no marks"}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe("the aquatic center's depth split", () => {
  it("keeps the diver and the swimmers on the shell, so only the deck chairs come forward", () => {
    const job = roomJobs().find((j): j is StillJob => j.type === "still" && (j.paint as UnitPaint).kind === "aquaticCenter" && j.layers === true && j.chains !== undefined);
    expect(job).toBeDefined();
    const steps = job!.chains!.occupants.steps;
    const last = steps[steps.length - 1];
    // The rows of every rect drawn after the break. At the catalog's size
    // every attendee is the diver or a swimmer, so only the empty deck chairs
    // (rows midY + 3 and + 4) may follow it: nothing up on the diving board
    // and nothing down in the pool (from midY + 7).
    let broke = false;
    const after: { top: number; bottom: number }[] = [];
    const ctx = sinkCtx();
    (ctx as unknown as { fillRect: (x: number, y: number, w: number, h: number) => void }).fillRect = (_x, y, _w, h) => {
      if (broke) after.push({ top: y, bottom: y + h });
    };
    withLayerHook({ shellEnd: () => (broke = true), furnitureEnd: () => undefined }, () => paint(ctx, last as UnitPaint, job!.w, job!.h));
    expect(broke).toBe(true);
    const midY = Math.round(job!.h * 0.42);
    expect(after.length).toBeGreaterThan(0);
    expect(Math.min(...after.map((r) => r.top))).toBeGreaterThanOrEqual(midY + 2);
    expect(Math.max(...after.map((r) => r.bottom))).toBeLessThanOrEqual(midY + 7);
  });
});

describe("the soft furniture pass's assumption", () => {
  it("holds: no paint routine sets a composite mode", () => {
    // The soft pass (`browserEntry.ts`) draws the marks after the furniture
    // with source-atop and puts it back after every restore; a routine with a
    // composite mode of its own would override that. Only the soft pass
    // itself may set one.
    const root = join(__dirname, "..");
    const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== join("atlas", "browserEntry.ts"));
    expect(files.length).toBeGreaterThan(20);
    const offenders = files.filter((f) => readFileSync(join(root, f), "utf8").includes("globalCompositeOperation"));
    expect(offenders).toEqual([]);
  });
});
