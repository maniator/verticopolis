import * as ex from "excalibur";
import { coveredUpperStories, lotCovered, lobbyLaneSpan } from "./towerCrowdLayout";
import { FLOOR } from "../scale";
import type { TowerEngine } from "./TowerEngine";

/**
 * Construction of the ambient walker population: the structural runs a tower's
 * floor and lobby tiles form, and one pacing figure per slot in them. Split out
 * of `towerCrowd.ts` so the per-frame motion path and this build-once path stay
 * separately readable (and so neither file sits on the size ceiling).
 *
 * This path BAKES `ex.Canvas` graphics, so it cannot run under happy-dom and is
 * covered on the Playwright tier; the gating that decides who is actually shown
 * lives in `updateMotion` next door, which IS unit-tested.
 */

interface Run {
  kind: "floor" | "lobby";
  floor: number;
  x0: number;
  x1: number;
}


export function buildWalkers(engine: TowerEngine): void {
  const coveredRows = coveredUpperStories(engine.sim.tower.units);
  const byFloor = new Map<number, Map<number, "floor" | "lobby">>();
  for (const u of engine.sim.tower.units) {
    if (u.kind === "floor" || u.kind === "lobby") {
      if (lotCovered(coveredRows, u.floor, u.x)) continue; // upper story of a multi-floor facility
      let row = byFloor.get(u.floor);
      if (!row) byFloor.set(u.floor, (row = new Map()));
      row.set(u.x, u.kind);
    }
  }
  let budget = 400;
  for (const [floor, row] of byFloor) {
    for (const run of mergeRuns(floor, row)) {
      if (budget <= 0) break;
      const wTiles = run.x1 - run.x0 + 1;
      const density = run.kind === "lobby" ? 0.5 : 0.14;
      const count = Math.min(run.kind === "lobby" ? 20 : 8, Math.floor(wTiles * density));
      const foot = engine.worldYTop(floor) + FLOOR - 3;
      const x0w = engine.worldX(run.x0) + 3;
      const x1w = engine.worldX(run.x1 + 1) - 3;
      const runW = x1w - x0w;
      for (let i = 0; i < count && budget > 0; i++, budget--) {
        const seed = (floor * 131 + run.x0 * 7 + i * 53) | 0;
        const rank = (i + 0.5) / count; // only the first few show until it fills
        const speed = 7 + (Math.abs(seed) % 6);
        if (run.kind === "lobby") {
          // Concourse: each figure paces its own evenly spaced lane, gated on
          // tower busyness. Confining every figure to a lane keeps a busy lobby
          // from piling everyone at the ping-pong turnaround ends (the old
          // full-width sweep bunched them up there).
          const [segX0, segX1] = lobbyLaneSpan(i, count, x0w, x1w);
          spawnWalker(engine, segX0, segX1, foot, foot, seed, speed, rank, floor, run.x0, false);
        } else {
          // Corridor: loiter in a short stretch around a spread-out anchor, so a
          // lone figure shuffles in place instead of sprinting the whole floor,
          // and only appears when this floor actually has occupants.
          const anchor = x0w + rank * runW;
          const half = Math.min(14, runW / 2);
          // Clamp the loiter span to the run so a figure never paces past the
          // corridor ends, robust even if the count/density constants change.
          const segX0 = Math.max(x0w, anchor - half);
          const segX1 = Math.min(x1w, anchor + half);
          spawnWalker(engine, segX0, segX1, foot, foot, seed, speed, rank, floor, run.x0, true);
        }
      }
    }
  }
  for (const t of engine.sim.tower.transports) {
    if (t.kind !== "stairs" && t.kind !== "escalator") continue;
    const x0w = engine.worldX(t.x) + 2;
    const x1w = engine.worldX(t.x + t.width) - 3;
    const yb = engine.worldYTop(t.bottom) + FLOOR - 2;
    const yt = yb - (FLOOR - 4);
    const n = t.kind === "escalator" ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const seed = (t.id * 17 + i * 29) | 0;
      // Low ranks so stairs/escalators show climbers even in a modest tower,
      // otherwise the routed crowd (elevators only) makes stairs look unused.
      spawnWalker(engine, x0w, x1w, yb, yt, seed, t.kind === "escalator" ? 12 : 7, 0.04 + i * 0.18, t.bottom, t.x, false);
    }
  }
}

function spawnWalker(
  engine: TowerEngine,
  x0w: number,
  x1w: number,
  y0w: number,
  y1w: number,
  seed: number,
  speed: number,
  rank: number,
  floor: number,
  tileX: number,
  perFloor: boolean,
): void {
  const gfx = engine.personGfx[Math.abs(seed) % engine.personGfx.length];
  // Actor bounds track the baked canvas footprint (see reconcileCrowd).
  const a = new ex.Actor({ pos: ex.vec(x0w, y0w), width: gfx.width, height: gfx.height, anchor: ex.vec(0.5, 1), z: 0.4 });
  a.graphics.use(gfx);
  engine.engine.add(a);
  engine.walkers.push({
    actor: a,
    gfx,
    x0w,
    x1w,
    y0w,
    y1w,
    speed,
    dir: seed % 2 === 0 ? 1 : -1,
    phase: (Math.abs(seed) % 100) / 100,
    impatient: (((seed >>> 8) & 0xff) / 255) < 0.5,
    red: false,
    rank,
    floor,
    tileX,
    perFloor,
  });
}

function mergeRuns(floor: number, row: Map<number, "floor" | "lobby">): Run[] {
  const xs = [...row.keys()].sort((a, b) => a - b);
  const runs: Run[] = [];
  if (xs.length === 0) return runs;
  let start = xs[0];
  let prev = xs[0];
  let kind = row.get(xs[0])!;
  for (let i = 1; i < xs.length; i++) {
    const x = xs[i];
    const k = row.get(x)!;
    if (x === prev + 1 && k === kind) {
      prev = x;
    } else {
      runs.push({ kind, floor, x0: start, x1: prev });
      start = prev = x;
      kind = k;
    }
  }
  runs.push({ kind, floor, x0: start, x1: prev });
  return runs;
}
