import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import * as ex from "excalibur";
import { Simulation } from "../../engine/Simulation";
import { newSeededGame } from "../../tests/fixtures/towerFixtures";
import { apronRange, plantSpots, plantVisible, ROUNDABOUT_START, skylineRects } from "../sceneryLayout";
import { GRID } from "../../engine/facilities";
import { TILE } from "../scale";
import { STRIP_MAX_SEG, syncScenery } from "./towerScenery";
import type { TowerEngine } from "./TowerEngine";

/**
 * Unit coverage for the scenery module against a stub engine: the world is
 * built lazily on the first sync, every canvas draw closure paints through a
 * recording context (no browser canvas needed), the apron repaint and plant
 * felling follow the built ground floor, and the sim-swap paths re-derive
 * exactly what the reviewers' findings demanded (equal-revision swaps included).
 * Pixel fidelity stays the Playwright visual tier's job.
 */

/** Founding seed whose layout the assertions lean on: its plant spots carry
 *  both kinds, and the starter-lobby apron hides at least one spot while
 *  sparing others. Counts derive from skylineRects/plantSpots at run time, so
 *  skyline tuning cannot stale this comment. */
const SEED = 4400;

/** Static actors makeScenery adds once, with the two segmented strips DERIVED.
 *  Ten are fixed: the left plaza (sidewalk, roundabout, fountain, 2 lamps) and
 *  the right street (forecourt, sidewalk, road, street lamp, planter). The plaza
 *  road and the lot's ground strip each split into texture-safe segments whose
 *  count falls out of `TILE`, so they are computed here exactly as
 *  `towerScenery` computes them. Pinning a literal went stale the moment the
 *  world scale moved: TILE 11 -> 10 shortened both strips and dropped one. */
const FIXED_ACTORS = 10;
const ROAD_SEGMENTS = Math.ceil(((ROUNDABOUT_START + GRID.width) * TILE) / STRIP_MAX_SEG);
const GROUND_SEGMENTS = Math.ceil((GRID.width * TILE) / STRIP_MAX_SEG);
const STATIC_ACTORS = FIXED_ACTORS + ROAD_SEGMENTS + GROUND_SEGMENTS;

// happy-dom canvases have no 2d context, which excalibur's Raster requires at
// construction (bootstrap.test.ts stubs the same seam). A permissive Proxy
// absorbs whatever property reads, writes, and method calls the constructor
// makes; actual raster pixels stay out of scope here.
beforeAll(() => {
  const real = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    if (tag !== "canvas") return real(tag);
    const ctx = new Proxy({} as Record<string | symbol, unknown>, {
      get: (t, p) => (p in t ? t[p] : () => undefined),
      set: (t, p, v) => ((t[p] = v), true),
    });
    const cnv = { width: 0, height: 0, getContext: () => ctx } as Record<string | symbol, unknown>;
    return new Proxy(cnv, {
      get: (t, p) => (p in t ? t[p] : () => undefined),
      set: (t, p, v) => ((t[p] = v), true),
    }) as unknown as HTMLCanvasElement;
  }) as typeof document.createElement);
});

// Restore document.createElement so the stub cannot leak into other test
// files sharing this worker.
afterAll(() => {
  vi.restoreAllMocks();
});

function fakeEngine(sim: Simulation): { eng: TowerEngine; added: ex.Actor[]; swap: (s: Simulation) => void } {
  const added: ex.Actor[] = [];
  const eng = { engine: { add: (a: ex.Actor) => void added.push(a) }, sim, d: { anim: 0 } } as unknown as TowerEngine;
  return { eng, added, swap: (s) => ((eng as { sim: Simulation }).sim = s) };
}

/** A recording 2D-context stand-in (same idiom as the pixelSprites tests). */
function spyCtx(): { ctx: CanvasRenderingContext2D; log: string[] } {
  const log: string[] = [];
  const ctx: Record<string, unknown> = {};
  for (const m of ["clearRect", "fillRect", "strokeRect", "fillText", "beginPath", "ellipse", "fill", "stroke"]) {
    ctx[m] = (...a: unknown[]) => log.push(`${m}:${JSON.stringify(a)}`);
  }
  for (const p of ["fillStyle", "strokeStyle", "lineWidth", "font", "textAlign"]) {
    let v: unknown;
    Object.defineProperty(ctx, p, {
      get: () => v,
      set: (nv) => {
        v = nv;
        log.push(`${p}=${String(nv)}`);
      },
    });
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log };
}

/** Plant actors in plantSpots order. They share a z with the fountain, the
 *  three lamps, and the planter (all in front of the strip), so when the list
 *  still carries the statics (`leadingStatics` 5) those are dropped; a
 *  rebuild-only slice has no statics to drop. */
function plantActors(added: ex.Actor[], leadingStatics = 5): ex.Actor[] {
  const z = added[added.length - 1].z; // the last actor added is always a plant
  return added.filter((a) => a.z === z).slice(leadingStatics);
}

const stripCanvases = (added: ex.Actor[]): ex.Canvas[] =>
  added
    .map((a) => a.graphics.current)
    .filter((g): g is ex.Canvas => g instanceof ex.Canvas)
    // The thin ground strip: 11px tall and segment-wide (the sidewalks are
    // 11px tall too, but far narrower).
    .filter((g) => g.height === 11 && g.width > 1000);

describe("towerScenery", () => {
  it("builds the whole world lazily on the first sync, plants tracking the starter apron", () => {
    const sim = newSeededGame(SEED);
    const { eng, added } = fakeEngine(sim);
    syncScenery(eng);
    expect(added.length).toBe(STATIC_ACTORS + skylineRects(SEED).length + plantSpots(SEED).length);

    const spots = plantSpots(SEED);
    const plants = plantActors(added);
    expect(plants.length).toBe(spots.length);
    // Visibility mirrors the pure layout math for the starter lobby's apron,
    // which both fells at least one plant and spares at least one.
    const apron = apronRange(sim.tower.units);
    expect(apron).not.toBeNull();
    spots.forEach((s, i) => expect(plants[i].graphics.opacity).toBe(plantVisible(s, apron) ? 1 : 0));
    expect(plants.some((p) => p.graphics.opacity === 0)).toBe(true);
    expect(plants.some((p) => p.graphics.opacity === 1)).toBe(true);
  });

  it("every canvas draw closure paints (strip, plaza, street, plants)", () => {
    const sim = newSeededGame(SEED);
    const { eng, added } = fakeEngine(sim);
    syncScenery(eng);
    const canvases = [...new Set(added.map((a) => a.graphics.current).filter((g): g is ex.Canvas => g instanceof ex.Canvas))];
    // Every static is a canvas actor, plus a canvas per plant, plus exactly
    // TWO shared skyline fills: the whole skyline must reuse one tiny raster
    // per depth (the texture-memory contract), so unique canvases stay flat
    // no matter how many skyline rects the seed lays. Both plant kinds exist
    // for this seed, so drawTree and drawBush both run.
    expect(canvases.length).toBe(STATIC_ACTORS + plantSpots(SEED).length + 2);
    expect(plantSpots(SEED).map((s) => s.kind)).toContain("tree");
    expect(plantSpots(SEED).map((s) => s.kind)).toContain("bush");
    for (const cv of canvases) {
      const s = spyCtx();
      cv.execute(s.ctx);
      expect(s.log.some((l) => l.startsWith("fillRect"))).toBe(true);
    }
    // The strip paints both surfaces on a starter tower: apron cement over the
    // lobby, grass on the open lot.
    const stripLogs: string[] = [];
    for (const cv of stripCanvases(added)) {
      const s = spyCtx();
      cv.execute(s.ctx);
      stripLogs.push(...s.log);
    }
    expect(stripLogs).toContain("fillStyle=#b0b0a8"); // cement
    expect(stripLogs.some((l) => l.startsWith("fillStyle=#4e7a34") || l.startsWith("fillStyle=#5b8a3c") || l.startsWith("fillStyle=#446c2e"))).toBe(true); // grass shades
  });

  it("building outward repaints the strip and fells the plant it reaches; a no-op sync stays silent", () => {
    const sim = newSeededGame(SEED);
    const { eng, added } = fakeEngine(sim);
    syncScenery(eng);
    const spots = plantSpots(SEED);
    const plants = plantActors(added);
    const apron0 = apronRange(sim.tower.units)!;
    const targetIdx = spots.findIndex((s) => s.tile - 2 >= apron0.max);
    expect(targetIdx).toBeGreaterThan(-1);
    expect(plants[targetIdx].graphics.opacity).toBe(1);

    const spies = stripCanvases(added).map((cv) => vi.spyOn(cv, "flagDirty"));
    sim.money = 1e12;
    for (let x = apron0.max - 3; x <= spots[targetIdx].tile + 2; x++) {
      expect(sim.build("lobby", 1, x).ok).toBe(true);
    }
    syncScenery(eng);
    expect(spies.some((sp) => sp.mock.calls.length > 0)).toBe(true);
    expect(plants[targetIdx].graphics.opacity).toBe(0);

    // Unchanged tower: the next sync must not repaint or add anything.
    spies.forEach((sp) => sp.mockClear());
    const count = added.length;
    syncScenery(eng);
    expect(spies.every((sp) => sp.mock.calls.length === 0)).toBe(true);
    expect(added.length).toBe(count);
  });

  it("a swapped sim with the same founding seed keeps the city but re-derives the apron, even at an equal revision", () => {
    const sim = newSeededGame(SEED);
    const { eng, added, swap } = fakeEngine(sim);
    syncScenery(eng);
    const snapshot = sim.serialize();
    const spots = plantSpots(SEED);
    const plants = plantActors(added);
    const apron0 = apronRange(sim.tower.units)!;
    const targetIdx = spots.findIndex((s) => s.tile - 2 >= apron0.max);

    sim.money = 1e12;
    for (let x = apron0.max - 3; x <= spots[targetIdx].tile + 2; x++) sim.build("lobby", 1, x);
    syncScenery(eng);
    expect(plants[targetIdx].graphics.opacity).toBe(0);

    // Undo-style swap: restore the snapshot and force the revision counter to
    // collide with the live tower's, the exact hazard the review flagged.
    const sim2 = Simulation.deserialize(snapshot);
    sim2.tower.revision = sim.tower.revision;
    const count = added.length;
    swap(sim2);
    syncScenery(eng);
    expect(added.length).toBe(count); // same founding seed: no city rebuild
    expect(plants[targetIdx].graphics.opacity).toBe(1); // the tree stands again
  });

  it("a different founding seed rebuilds the city for the new tower", () => {
    const sim = newSeededGame(SEED);
    const { eng, added, swap } = fakeEngine(sim);
    syncScenery(eng);
    const oldSkyline = added[STATIC_ACTORS]; // first seeded actor
    // Outside a real scene Actor.kill() is a warn-and-return, so assert the
    // call itself: the module must retire every seeded actor on a seed change.
    const killed = vi.spyOn(oldSkyline, "kill");
    const count = added.length;

    const other = 20260713;
    swap(newSeededGame(other));
    syncScenery(eng);
    expect(killed).toHaveBeenCalled();
    expect(added.length).toBe(count + skylineRects(other).length + plantSpots(other).length);
    // The new plants follow the NEW sim's apron from their first frame.
    const newPlants = plantActors(added.slice(count), 0);
    const apron = apronRange((eng as unknown as { sim: Simulation }).sim.tower.units);
    plantSpots(other).forEach((s, i) => expect(newPlants[i].graphics.opacity).toBe(plantVisible(s, apron) ? 1 : 0));
  });
});
