import { describe, expect, it } from "vitest";
import { GRID } from "../../engine/facilities";
import { lampAlpha } from "../excalibur/towerSceneryDraw";
import { SCENERY } from "../sceneryLayout";
import {
  FOUNTAIN_FRAMES,
  LAMP_STEPS,
  TREE_VARIANTS,
  sceneryData,
  sceneryJobs,
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
    expect(data.props[0]).toMatchObject({ x: SCENERY.roundabout.x, y: SCENERY.roundabout.y });
    expect(data.ground.runs[3]).toMatchObject(SCENERY.sidewalk);
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
});
