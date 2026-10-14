import { describe, expect, it } from "vitest";
import { GRID } from "../../engine/facilities";
import { drawBush, drawTree, lampAlpha } from "../excalibur/towerSceneryDraw";
import { Z } from "../depthPlanes";
import { allJobs } from "./browserEntry";
import { TILE } from "../scale";
import { SCENERY, hash01, plantRect, plantSpots, skylineRects } from "../sceneryLayout";
import { CLOUD_COUNT, cloudSeed } from "../sprites/sky";
import {
  FOUNTAIN_FRAMES,
  LAMP_STEPS,
  TREE_VARIANTS,
  depthData,
  sceneryData,
  sceneryJobs,
  skyData,
} from "./scenery";

describe("scenery in the atlas", () => {
  const jobs = sceneryJobs();
  const names = new Set(
    jobs.flatMap((j) =>
      j.type === "anim" ? j.frames.map((_, i) => `${j.name}/${i}`) : [j.name],
    ),
  );
  const animations = new Set(
    jobs.filter((j) => j.type === "anim").map((j) => j.name),
  );

  it("bakes every piece the game draws outside the tower", () => {
    for (const n of [
      "scenery/roundabout",
      "scenery/planter",
      "scenery/bush",
      "scenery/ground/sidewalk",
      "scenery/ground/forecourt",
      "scenery/ground/road",
    ])
      expect(names.has(n), n).toBe(true);
    for (const pct of LAMP_STEPS) {
      expect(names.has(`scenery/plaza-lamp/a${pct}`)).toBe(true);
      expect(names.has(`scenery/street-lamp/a${pct}`)).toBe(true);
    }
    for (let v = 0; v < TREE_VARIANTS; v++)
      expect(names.has(`scenery/tree/v${v}`)).toBe(true);
    expect(animations.has("scenery/fountain")).toBe(true);
    expect(
      [...names].filter((n) => n.startsWith("scenery/fountain/")),
    ).toHaveLength(FOUNTAIN_FRAMES);
    expect(
      names.has("scenery/ground/pave/plain") &&
        names.has("scenery/ground/pave/joint"),
    ).toBe(true);
  });

  it("bakes a grass tile for every variant the lot shows, and maps every lot tile to one", () => {
    const data = sceneryData();
    expect(data.ground.strip.grass).toHaveLength(GRID.width);
    for (const key of new Set(data.ground.strip.grass))
      expect(names.has(`scenery/ground/grass/${key}`), key).toBe(true);
    // The lamp fade the data states is the game's.
    expect([18, 19, 20, 5, 6, 7].map((h) => lampAlpha(h))).toEqual([0, 0.5, 1, 1, 0.5, 0]);
    expect(data.lamp.fadeIn).toEqual([18, 20]);
    expect(data.lamp.fadeOut).toEqual([5, 7]);
  });

  it("publishes the game's own placement table", () => {
    const data = sceneryData();
    expect(data.ground.runs[1]).toMatchObject(SCENERY.roundabout);
    expect(data.props[0]).toMatchObject({ x: SCENERY.fountain.x, y: SCENERY.fountain.y });
    expect(data.ground.runs[4]).toMatchObject(SCENERY.sidewalk);
  });

  it("places only frames it bakes (a lamp by its steps)", () => {
    const data = sceneryData();
    for (const r of data.ground.runs)
      expect(names.has(r.frame), r.frame).toBe(true);
    for (const p of data.props)
      expect(
        names.has(p.frame) ||
          animations.has(p.frame) ||
          names.has(`${p.frame}/a100`),
        p.frame,
      ).toBe(true);
  });

  it("publishes skyline and plant rules that rebuild the game's own layout from the seed", () => {
    const { skyline, plants, lotTiles } = sceneryData();
    for (const seed of [0, 1, 4400, 987654321]) {
      const rects = skyline.bands.flatMap((b) => {
        const out = [];
        for (let t = -skyline.overscanTiles + b.start; t < lotTiles + skyline.overscanTiles; t += b.step)
          out.push({
            tile: t,
            w: b.w.base + hash01(seed + t * b.w.key) * b.w.span,
            hFloors: b.hFloors.base + hash01(seed + t * b.hFloors.key) * b.hFloors.span,
            depth: b.depth,
          });
        return out;
      });
      expect(rects).toEqual(skylineRects(seed));
      const R = plants.rule;
      const spots = [];
      for (let t = R.margin; t < lotTiles - R.margin; t += R.step) {
        const r = hash01(seed * 3 + t);
        if (r < R.skipBelow) continue;
        spots.push({
          tile: t + Math.floor(hash01(seed + t * R.jitter.key) * R.jitter.span) + R.jitter.min,
          scale: R.scale.base + hash01(seed + t * R.scale.key) * R.scale.span,
          kind: (r < R.bushBelow ? "bush" : "tree") as "bush" | "tree",
        });
      }
      expect(spots).toEqual(plantSpots(seed));
      for (const spot of spots) {
        const rect = plantRect(spot);
        expect(rect.y + rect.h).toBe(plants.bottomY);
        expect(rect.x + rect.w / 2).toBe(spot.tile * TILE);
      }
    }
  });

  it("names a frame family for every draw plane in z order, and the clouds the sky draws", () => {
    const planes = depthData();
    expect(planes.map((p) => p.z)).toEqual(Object.values(Z).sort((a, b) => a - b));
    const all = allJobs().map((j) => j.name);
    for (const p of planes)
      for (const f of p.frames)
        expect(all.some((n) => n === f || n.startsWith(`${f}/`)), f).toBe(true);
    const sky = skyData();
    expect(sky.clouds.list).toHaveLength(CLOUD_COUNT);
    expect(sky.clouds.list[1].offset).toBe(cloudSeed(1) * 53);
  });

  it("publishes the plant paint so a frontend paints any spot as the game does", () => {
    const P = sceneryData().plants.paint;
    const record = (draw: (ctx: CanvasRenderingContext2D) => void) => {
      const ops: unknown[] = [];
      const ctx = {
        set fillStyle(v: string) {
          ops.push(v);
        },
        fillRect: (...a: number[]) => ops.push(a),
      } as unknown as CanvasRenderingContext2D;
      draw(ctx);
      return ops;
    };
    for (const [w, h, seed] of [[30, 68, 4400], [24, 54, 7], [36, 81, 123456]]) {
      const T = P.tree;
      const trunkW = Math.max(T.trunk.minW, Math.round(w * T.trunk.w));
      const trunkH = Math.round(h * T.trunk.h);
      const want: unknown[] = [T.trunk.color, [Math.round(w / 2 - trunkW / 2), h - trunkH, trunkW, trunkH]];
      T.canopy.forEach((c, li) => {
        const jitter = Math.round((hash01(seed + li * T.jitterKey) - 0.5) * 2);
        want.push(c.color, [Math.round((w * (1 - c.w)) / 2) + jitter, Math.round(h - trunkH - h * c.y), Math.round(w * c.w), Math.round(h * T.canopyH)]);
      });
      expect(record((ctx) => drawTree(ctx, w, h, seed))).toEqual(want);
      const B = P.bush;
      expect(record((ctx) => drawBush(ctx, w, h))).toEqual([
        B.base.color,
        [0, Math.round(h * B.base.y), w, Math.ceil(h * B.base.h)],
        B.top.color,
        [Math.round(w * B.top.x), 0, Math.round(w * B.top.w), Math.round(h * B.top.h)],
      ]);
    }
  });
});
