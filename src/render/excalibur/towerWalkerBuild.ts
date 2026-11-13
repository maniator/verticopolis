import * as ex from "excalibur";
import { Z } from "../depthPlanes";
import { coveredUpperStories, lotCovered, trafficLots } from "./towerCrowdLayout";
import { FLOOR } from "../scale";
import type { TowerEngine } from "./TowerEngine";
import { towerCatalog } from "../../catalog/towerCatalog";

/**
 * Construction of the decorative passers-by: figures that loiter in a short
 * stretch of corridor for life, but are not people the engine knows about.
 * Split out of `towerCrowd.ts` so the per-frame motion path and this
 * build-once path stay separately readable.
 *
 * What they may do is set by #2091, after a player said they hid the traffic:
 * - A Classic tower builds none, because SimTower had none. The catalog says
 *   so (`rules.decorativePassersBy`), and nothing is built and then hidden.
 * - A Modern tower builds them only in corridors, never in a lobby or on a
 *   stair or escalator, and never on a lot where a player reads traffic
 *   (an elevator landing, a flight's landing, a shop's front; see
 *   `trafficLots`). There are half as many as the old corridor rule.
 * - `updateMotion` next door shows a floor's figures only while that floor has
 *   live occupants, and hides them all when the Settings switch is off or
 *   reduced motion is on.
 *
 * This runs once per rebuild, not per frame: it reads the tower's layout and
 * hands each figure a share of the already-baked `engine.personGfx` canvases.
 * Baking none of its own means it runs under happy-dom, so it is unit-tested in
 * `towerWalkerBuild.test.ts`.
 */

/** The most figures one corridor run gets, and how many per tile of run. Half
 *  of the old 8 and 0.14 (#2091). */
export const PASSERS_PER_RUN_CAP = 4;
export const PASSERS_PER_TILE = 0.07;
/** The most figures a whole tower gets. */
export const PASSERS_BUDGET = 200;

/** One contiguous corridor stretch on a floor, in tiles (inclusive). */
interface Run {
  floor: number;
  x0: number;
  x1: number;
}

export function buildWalkers(engine: TowerEngine): void {
  const catalog = towerCatalog(engine.sim);
  if (!catalog.rules.decorativePassersBy) return;
  const tower = engine.sim.tower;
  const coveredRows = coveredUpperStories(tower.units, catalog);
  const traffic = trafficLots(tower.transports, tower.units, catalog);
  const byFloor = new Map<number, Set<number>>();
  for (const u of tower.units) {
    // Corridors only: the bare floor lots between rooms. A lobby is where the
    // engine's own commuters cross, so it gets no decorative figure.
    if (u.kind !== "floor") continue;
    if (lotCovered(coveredRows, u.floor, u.x)) continue; // upper story of a multi-floor facility
    if (traffic.get(u.floor)?.has(u.x)) continue;
    let row = byFloor.get(u.floor);
    if (!row) byFloor.set(u.floor, (row = new Set()));
    row.add(u.x);
  }
  let budget = PASSERS_BUDGET;
  for (const [floor, row] of byFloor) {
    for (const run of mergeRuns(floor, row)) {
      if (budget <= 0) return;
      const wTiles = run.x1 - run.x0 + 1;
      const count = Math.min(PASSERS_PER_RUN_CAP, Math.floor(wTiles * PASSERS_PER_TILE));
      const foot = engine.worldYTop(floor) + FLOOR - 3;
      const x0w = engine.worldX(run.x0) + 3;
      const x1w = engine.worldX(run.x1 + 1) - 3;
      const runW = x1w - x0w;
      for (let i = 0; i < count && budget > 0; i++, budget--) {
        const seed = (floor * 131 + run.x0 * 7 + i * 53) | 0;
        const rank = (i + 0.5) / count; // only the first few show until the floor fills
        // Loiter in a short stretch around a spread-out anchor, so a lone
        // figure shuffles in place instead of sprinting the whole floor. The
        // span is clamped to the run, so a figure never paces past its ends
        // onto a traffic lot.
        const anchor = x0w + rank * runW;
        const half = Math.min(14, runW / 2);
        spawnWalker(engine, Math.max(x0w, anchor - half), Math.min(x1w, anchor + half), foot, seed, 7 + (Math.abs(seed) % 6), rank, floor);
      }
    }
  }
}

function spawnWalker(engine: TowerEngine, x0w: number, x1w: number, yw: number, seed: number, speed: number, rank: number, floor: number): void {
  const gfx = engine.personGfx[Math.abs(seed) % engine.personGfx.length];
  // Actor bounds track the baked canvas footprint (see reconcileCrowd).
  const a = new ex.Actor({ pos: ex.vec(x0w, yw), width: gfx.width, height: gfx.height, anchor: ex.vec(0.5, 1), z: Z.walker });
  a.graphics.use(gfx);
  engine.engine.add(a);
  engine.walkers.push({
    actor: a,
    gfx,
    x0w,
    x1w,
    yw,
    speed,
    dir: seed % 2 === 0 ? 1 : -1,
    phase: (Math.abs(seed) % 100) / 100,
    rank,
    floor,
  });
}

/** The contiguous runs of a floor's corridor lots. */
function mergeRuns(floor: number, row: Set<number>): Run[] {
  const xs = [...row].sort((a, b) => a - b);
  const runs: Run[] = [];
  if (xs.length === 0) return runs;
  let start = xs[0];
  let prev = xs[0];
  for (let i = 1; i < xs.length; i++) {
    const x = xs[i];
    if (x === prev + 1) {
      prev = x;
    } else {
      runs.push({ floor, x0: start, x1: prev });
      start = prev = x;
    }
  }
  runs.push({ floor, x0: start, x1: prev });
  return runs;
}
