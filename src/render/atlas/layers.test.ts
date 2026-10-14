import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hasBusinessHours, isOpenAt } from "../../engine/facilities";
import type { FacilityKind } from "../../engine/types";
import { withLayerHook } from "../pixelSprites/layers";
import { roomJobs, roomKinds, type StillJob } from "./catalog";
import { LOBBY_VARIANTS } from "../sprites";
import { structureJobs, transportJobs, vehicleJobs } from "./catalogExtras";
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
    // Every room kind splits somewhere in the catalog.
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

describe("depth-layer marks on the cabs and the metro train", () => {
  it("breaks every cab and train frame once, at every rider count, and ends the cab's riders", () => {
    const jobs = [...transportJobs(), ...vehicleJobs()].filter((j): j is StillJob => j.type === "still" && j.layers === true);
    const names = jobs.map((j) => j.name);
    expect(names.some((n) => n.startsWith("car/"))).toBe(true);
    expect(names.filter((n) => n.startsWith("vehicle/metrotrain/"))).toHaveLength(2);
    expect(names.some((n) => n.startsWith("vehicle/streetcar/") || n.startsWith("vehicle/garbagetruck"))).toBe(false);
    // Each carries its riders inside: a front picture over them.
    expect(jobs.every((j) => j.front === true)).toBe(true);
    const wrong: string[] = [];
    for (const j of jobs) {
      for (const [i, spec] of [j.paint, ...Object.values(j.chains ?? {}).flatMap((c) => c.steps)].entries()) {
        const seen: string[] = [];
        withLayerHook({ shellEnd: () => seen.push("break"), furnitureEnd: () => seen.push("end") }, () => paint(sinkCtx(), spec, j.w, j.h));
        if (seen.join() !== "break,end") wrong.push(`${j.name} step ${i}: ${seen.join() || "no marks"}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("the vehicles' draw order", () => {
  it("draws each vehicle's body and frames after its riders, so they stand in front", () => {
    // Fill colors by phase: before the break, between the marks, after the end.
    const phases = (spec: PaintSpec, w: number, h: number) => {
      const out: string[][] = [[], [], []];
      let phase = 0;
      const ctx = sinkCtx();
      let fill = "";
      Object.defineProperty(ctx, "fillStyle", { set: (v: string) => (fill = v), get: () => fill });
      (ctx as unknown as { fillRect: () => void }).fillRect = () => out[phase].push(fill);
      withLayerHook({ shellEnd: () => (phase = 1), furnitureEnd: () => (phase = 2) }, () => paint(ctx, spec, w, h));
      return out;
    };
    const train = vehicleJobs().find((j): j is StillJob => j.name === "vehicle/metrotrain/headlight")!;
    const [tb, tm, tf] = phases(train.paint, train.w, train.h);
    expect(tb.length).toBeGreaterThan(0);
    expect(tb.every((c) => c === "#2A3440")).toBe(true); // only the interior behind the riders
    expect(tm.length).toBeGreaterThan(0);
    expect(tm).not.toContain("#C6CCD4");
    expect(tf).toContain("#C6CCD4"); // the body comes after
    // Every cab kind, arrow and FULL state, at its fullest.
    const cabs = transportJobs().filter((j): j is StillJob => j.type === "still" && j.name.startsWith("car/"));
    expect(cabs.length).toBeGreaterThan(0);
    for (const cab of cabs) {
      const steps = cab.chains!.riders.steps;
      const [, cm, cf] = phases(steps[steps.length - 1], cab.w, cab.h);
      expect(cm.length, cab.name).toBeGreaterThan(0);
      expect(cm.some((c) => c.startsWith("rgba(40,44,54")), cab.name).toBe(false);
      expect(cf.some((c) => c.startsWith("rgba(40,44,54")), cab.name).toBe(true); // the door frames
    }
  });
});

describe("the cab floor band", () => {
  it("stays on the shell because the riders' feet cover every band row (#999)", () => {
    // Each fillRect by phase: before the break, between the marks, after the end.
    type Rect = { x: number; y: number; w: number; h: number };
    const rects = (spec: PaintSpec, w: number, h: number) => {
      const out: Rect[][] = [[], [], []];
      let phase = 0;
      const ctx = sinkCtx();
      (ctx as unknown as { fillRect: (x: number, y: number, w: number, h: number) => void }).fillRect = (x, y, rw, rh) => out[phase].push({ x, y, w: rw, h: rh });
      withLayerHook({ shellEnd: () => (phase = 1), furnitureEnd: () => (phase = 2) }, () => paint(ctx, spec, w, h));
      return out;
    };
    const banded = transportJobs().filter(
      (j): j is StillJob => j.type === "still" && (j.name.startsWith("car/elevatorService/") || j.name.startsWith("car/elevatorExpress/")),
    );
    expect(banded.some((j) => j.name.startsWith("car/elevatorService/"))).toBe(true);
    expect(banded.some((j) => j.name.startsWith("car/elevatorExpress/"))).toBe(true);
    for (const cab of banded) {
      const bandRows = [cab.h - 5, cab.h - 4, cab.h - 3];
      const covered = new Set<number>();
      expect(cab.chains?.riders, cab.name).toBeDefined();
      // The door frames and the center seam, the only front marks that reach the band.
      const frames = (r: Rect) => r.w === 1 && (r.x === 2 || r.x === cab.w - 3 || r.x === cab.w / 2 - 0.5);
      for (const step of cab.chains!.riders.steps) {
        const [shell, riders, front] = rects(step, cab.w, cab.h);
        // The band (a 3-row plate across the cab bottom) is painted before the break...
        expect(shell.some((r) => r.x === 2 && r.y === cab.h - 5 && r.w === cab.w - 4 && r.h === 3), cab.name).toBe(true);
        // ...the front marks still come after the riders...
        expect(front.length, cab.name).toBeGreaterThan(0);
        // ...and none of them paints over the band but the frames and the seam.
        expect(front.filter((r) => r.y + r.h > cab.h - 5 && !frames(r)), cab.name).toEqual([]);
        for (const r of riders) {
          // No rider reaches the side frames (the right door frame is at w - 3).
          expect(r.x + r.w, cab.name).toBeLessThanOrEqual(cab.w - 3);
          if (r.x >= cab.w - 2 || r.x + r.w <= 2) continue; // beside the band
          for (const row of bandRows) if (row >= r.y && row < r.y + r.h) covered.add(row);
        }
      }
      // A rider's legs reach the band's upper rows and its contact shadow the
      // bottom one, so no whole band row could move to the front without
      // changing a pixel of the flat frame: the band stays on the shell, as the
      // game draws it (split by column, it would tear where the layers part).
      expect([...covered].sort((a, b) => a - b), cab.name).toEqual(bandRows);
    }
  });
});

describe("the recycling center's depth split", () => {
  it("paints its curb and gauge as shell art among the furniture", () => {
    const job = roomJobs().find((j): j is StillJob => j.type === "still" && (j.paint as UnitPaint).kind === "recycling" && j.layers === true && j.chains !== undefined);
    expect(job).toBeDefined();
    // The frame and every fill step, the full one (with its FULL cue) too.
    const steps = [job!.paint, ...job!.chains!.fill.steps];
    expect(steps.some((p) => (p as UnitPaint).recycleFill === 1)).toBe(true);
    for (const spec of steps) {
      const seen: string[] = [];
      withLayerHook(
        {
          shellEnd: () => seen.push("break"),
          furnitureEnd: () => seen.push("end"),
          shellPaint: (_ctx, draw) => {
            seen.push("shell");
            draw();
          },
        },
        () => paint(sinkCtx(), spec, job!.w, job!.h),
      );
      expect(seen.join()).toBe("break,shell,shell,end");
    }
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
