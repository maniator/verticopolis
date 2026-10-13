import { GRID } from "../../engine/facilities";
import { FLOOR, TILE } from "../scale";
import {
  APRON_PAD_TILES,
  GROUND,
  PLANT_CLEAR_TILES,
  PLANT_RULE,
  PLANT_SIZE,
  SCENERY,
  SKYLINE_BANDS,
  SKYLINE_OVERSCAN_TILES,
  STRIP_ABOVE,
  STRIP_BELOW,
  type PieceRect,
} from "../sceneryLayout";
import {
  PAVE_JOINT_EVERY,
  drawBush,
  drawForecourt,
  drawFountain,
  drawPlanter,
  drawPlazaLamp,
  drawRoad,
  drawRoundabout,
  drawSidewalk,
  drawStreetLamp,
  drawStripTile,
  drawTree,
  grassLook,
} from "../excalibur/towerSceneryDraw";
import type { AnimJob, Job, Keys, StillJob } from "./catalog";
import { Z } from "../depthPlanes";
import { CLOUD_COUNT, CLOUD_DRIFT, SUN_ARC, cloudMotion, cloudSeed } from "../sprites/sky";

/**
 * The world outside the tower (`excalibur/towerScenery.ts`): the plaza's
 * roundabout, fountain and lamps, the street lamp with its "375 ST" sign, the
 * forecourt planter, the lot's trees and bushes, and the ground pieces. Every
 * frame is painted by the game's own scenery painters, and {@link sceneryData}
 * publishes the game's own placement table (`SCENERY` in `sceneryLayout.ts`),
 * so a frontend can rebuild the scene.
 */

export type ScenerySpec =
  | { p: "scenery"; piece: "roundabout" | "planter" | "bush" | "sidewalk" | "forecourt" }
  | { p: "scenery"; piece: "fountain"; t: number }
  | { p: "scenery"; piece: "plazaLamp" | "streetLamp"; a: number }
  | { p: "scenery"; piece: "tree"; seed: number }
  | { p: "scenery"; piece: "road"; phase: number }
  | { p: "scenery"; piece: "strip"; tile: number; paved: boolean };

/** Paint a scenery piece into a canvas `w` x `h`. */
export function paintScenery(ctx: CanvasRenderingContext2D, s: ScenerySpec, w: number, h: number): void {
  switch (s.piece) {
    case "roundabout":
      return drawRoundabout(ctx, w);
    case "fountain":
      return drawFountain(ctx, w, h, s.t);
    case "plazaLamp":
      return drawPlazaLamp(ctx, w, h, s.a);
    case "streetLamp":
      return drawStreetLamp(ctx, w, h, s.a);
    case "planter":
      return drawPlanter(ctx, w, h);
    case "tree":
      return drawTree(ctx, w, h, s.seed);
    case "bush":
      return drawBush(ctx, w, h);
    case "sidewalk":
      return drawSidewalk(ctx, w);
    case "forecourt":
      return drawForecourt(ctx, w);
    case "road":
      return drawRoad(ctx, w, s.phase);
    case "strip":
      return drawStripTile(ctx, 0, s.tile, s.paved);
  }
}

const size = (r: PieceRect) => ({ w: r.w, h: r.h });

/** Frame sizes: the fixed pieces as the game sizes them, plants at their base
 *  size, and the ground tiles one period of their pattern. A strip tile is one
 *  column wider than a lot tile, as the game paints it. */
const SIZE = {
  roundabout: size(SCENERY.roundabout),
  fountain: size(SCENERY.fountain),
  plazaLamp: size(SCENERY.plazaLamps[0]),
  streetLamp: size(SCENERY.streetLamp),
  planter: size(SCENERY.planter),
  tree: { w: PLANT_SIZE.tree.tiles * TILE, h: Math.round(FLOOR * PLANT_SIZE.tree.floors) },
  bush: { w: PLANT_SIZE.bush.tiles * TILE, h: Math.round(FLOOR * PLANT_SIZE.bush.floors) },
  sidewalk: { w: TILE, h: SCENERY.sidewalk.h },
  forecourt: { w: 2 * TILE, h: SCENERY.forecourt.h },
  road: { w: 4 * TILE, h: SCENERY.rightRoad.h },
  strip: { w: TILE + 1, h: STRIP_ABOVE + STRIP_BELOW },
};

/** The lamp brightness steps baked (the game fades continuously). */
export const LAMP_STEPS = [0, 25, 50, 75, 100];
/** Fountain frames: the water's motions share no period, so this samples one
 *  stretch close to a loop. */
export const FOUNTAIN_FRAMES = 24;
export const FOUNTAIN_DT = 0.1;
/** Tree variants baked (the game seeds each tree by the tower and its spot). */
export const TREE_VARIANTS = 8;

/** The grass frame name for a lot tile. */
export function grassName(tile: number): string {
  const g = grassLook(tile);
  return `s${g.shade}/${g.tuft ? "tuft" : "flat"}`;
}

/** A lot tile showing each grass look, for the bake. */
function grassSamples(): Map<string, number> {
  const grass = new Map<string, number>();
  for (let t = 0; t < GRID.width && grass.size < 6; t++) if (!grass.has(grassName(t))) grass.set(grassName(t), t);
  return grass;
}

function still(name: string, sz: { w: number; h: number }, paint: ScenerySpec, keys: Keys): StillJob {
  // The scenery joined the atlas after its first release, so its images pack
  // on pages of their own and leave the older pages as they were.
  return { type: "still", name, w: sz.w, h: sz.h, anchor: { x: 0, y: 0 }, keys: { kind: "scenery", ...keys }, paint, ownPages: true };
}

/** Every scenery frame. */
export function sceneryJobs(): Job[] {
  const jobs: Job[] = [
    still("scenery/roundabout", SIZE.roundabout, { p: "scenery", piece: "roundabout" }, { piece: "roundabout" }),
    still("scenery/planter", SIZE.planter, { p: "scenery", piece: "planter" }, { piece: "planter" }),
    still("scenery/bush", SIZE.bush, { p: "scenery", piece: "bush" }, { piece: "bush" }),
    still("scenery/ground/sidewalk", SIZE.sidewalk, { p: "scenery", piece: "sidewalk" }, { piece: "sidewalk" }),
    still("scenery/ground/forecourt", SIZE.forecourt, { p: "scenery", piece: "forecourt" }, { piece: "forecourt" }),
    still("scenery/ground/road", SIZE.road, { p: "scenery", piece: "road", phase: 4 }, { piece: "road" }),
  ];
  for (const pct of LAMP_STEPS) {
    jobs.push(still(`scenery/plaza-lamp/a${pct}`, SIZE.plazaLamp, { p: "scenery", piece: "plazaLamp", a: pct / 100 }, { piece: "plazaLamp", lamp: pct }));
    jobs.push(still(`scenery/street-lamp/a${pct}`, SIZE.streetLamp, { p: "scenery", piece: "streetLamp", a: pct / 100 }, { piece: "streetLamp", lamp: pct }));
  }
  for (let v = 0; v < TREE_VARIANTS; v++) jobs.push(still(`scenery/tree/v${v}`, SIZE.tree, { p: "scenery", piece: "tree", seed: v }, { piece: "tree", variant: v }));
  for (const [name, tile] of grassSamples()) {
    const g = grassLook(tile);
    jobs.push(still(`scenery/ground/grass/${name}`, SIZE.strip, { p: "scenery", piece: "strip", tile, paved: false }, { piece: "grass", shade: g.shade, tuft: g.tuft }));
  }
  for (const joint of [false, true]) {
    jobs.push(still(`scenery/ground/pave/${joint ? "joint" : "plain"}`, SIZE.strip, { p: "scenery", piece: "strip", tile: joint ? 0 : 1, paved: true }, { piece: "pave", joint }));
  }
  const fountain: AnimJob = {
    type: "anim",
    name: "scenery/fountain",
    ...SIZE.fountain,
    anchor: { x: 0, y: 0 },
    keys: { kind: "scenery", piece: "fountain" },
    dt: FOUNTAIN_DT,
    loop: true,
    ownPages: true,
    frames: Array.from({ length: FOUNTAIN_FRAMES }, (_, i): ScenerySpec => ({ p: "scenery", piece: "fountain", t: i * FOUNTAIN_DT })),
  };
  jobs.push(fountain);
  return jobs;
}

const at = (r: PieceRect) => ({ x: r.x, y: r.y });

/** Where the game places each piece (see docs/atlas.md, "The world outside
 *  the tower"), back to front. */
export function sceneryData() {
  return {
    lotTiles: GRID.width,
    ground: {
      // Solid fills: the dirt from the ground line down, and the ground line
      // centered on y 0, both across `lots` lot widths centered on the lot.
      dirt: { color: GROUND.dirt, x: -((GROUND.lots - 1) / 2) * GRID.width * TILE, w: GROUND.lots * GRID.width * TILE, y: 0, h: GROUND.belowFloors * FLOOR },
      line: { color: GROUND.line, y: -GROUND.lineH / 2, h: GROUND.lineH },
      strip: {
        y: -STRIP_ABOVE,
        tileW: TILE,
        apronPadTiles: APRON_PAD_TILES,
        jointEvery: PAVE_JOINT_EVERY,
        grass: Array.from({ length: GRID.width }, (_, t) => grassName(t)),
      },
      runs: [
        { frame: "scenery/ground/sidewalk", ...SCENERY.plazaSidewalk, tileOriginX: SCENERY.plazaSidewalk.x },
        // The roundabout shares the ground's plane: one copy, before the road.
        { frame: "scenery/roundabout", ...SCENERY.roundabout, tileOriginX: SCENERY.roundabout.x },
        // The game's last road segment runs one column on, over the roundabout's
        // first column.
        { frame: "scenery/ground/road", ...SCENERY.leftRoad, w: SCENERY.leftRoad.w + 1, tileOriginX: 0 },
        { frame: "scenery/ground/forecourt", ...SCENERY.forecourt, tileOriginX: SCENERY.forecourt.x },
        { frame: "scenery/ground/sidewalk", ...SCENERY.sidewalk, tileOriginX: SCENERY.sidewalk.x },
        { frame: "scenery/ground/road", ...SCENERY.rightRoad, tileOriginX: SCENERY.rightRoad.x },
      ],
    },
    props: [
      { frame: "scenery/fountain", ...at(SCENERY.fountain) },
      ...SCENERY.plazaLamps.map((r) => ({ frame: "scenery/plaza-lamp", ...at(r) })),
      { frame: "scenery/street-lamp", ...at(SCENERY.streetLamp) },
      { frame: "scenery/planter", ...at(SCENERY.planter) },
    ],
    // The skyline and the plants are seeded by the tower's founding seed
    // (`hash01` and the rules below; docs/atlas.md spells them out).
    skyline: {
      overscanTiles: SKYLINE_OVERSCAN_TILES,
      bands: SKYLINE_BANDS.map((b) => ({ ...b, frame: `sky/skyline/${b.depth === 0 ? "far" : "near"}` })),
    },
    plants: {
      rule: PLANT_RULE,
      size: PLANT_SIZE,
      // A plant's canvas is centered on its tile's left edge, and its bottom
      // edge (exclusive) sits at bottomY.
      bottomY: -STRIP_ABOVE + 2,
      clearTiles: PLANT_CLEAR_TILES,
      treeVariants: TREE_VARIANTS,
    },
    lamp: { steps: LAMP_STEPS, fadeIn: [18, 20], fadeOut: [5, 7] },
  };
}

/** The sun's arc and the clouds' drift (`towerScene.ts`), in the game's own
 *  terms. Both are drawn in screen space, sized to the view. */
export function skyData() {
  return {
    sun: { ...SUN_ARC, day: "sky/sun", night: "sky/moon" },
    clouds: {
      ...CLOUD_DRIFT,
      weathers: ["overcast", "rain"],
      list: Array.from({ length: CLOUD_COUNT }, (_, i) => ({ frame: i, ...cloudMotion(cloudSeed(i)) })),
    },
  };
}

/** The frame families on each of the game's draw planes ({@link Z}). */
const PLANE_FRAMES: Record<keyof typeof Z, string[]> = {
  sky: ["sky/gradient", "sky/sun", "sky/moon", "sky/cloud"],
  skylineFar: ["sky/skyline/far"],
  skylineNear: ["sky/skyline/near"],
  dirt: [],
  groundLine: [],
  strip: ["scenery/ground/grass", "scenery/ground/pave"],
  groundEdge: ["scenery/ground/sidewalk", "scenery/ground/road", "scenery/roundabout", "scenery/ground/forecourt"],
  plant: ["scenery/fountain", "scenery/plaza-lamp", "scenery/street-lamp", "scenery/planter", "scenery/tree", "scenery/bush"],
  hang: ["facade/escape", "facade/awning", "facade/crane"],
  structure: ["structure/floor", "structure/lobby", "structure/entrance"],
  room: ["room"],
  walker: ["person"],
  animatedRoom: ["fire", "construction"],
  streetCar: ["vehicle/streetcar"],
  vehicle: ["vehicle/metrotrain", "vehicle/garbagetruck"],
  transport: ["shaft", "transport/stairs", "transport/escalator"],
  cab: ["car"],
  crowd: ["person"],
  overlay: [],
};

/** The game's draw planes, back to front, with the families drawn on each. */
export function depthData() {
  return (Object.keys(Z) as (keyof typeof Z)[])
    .map((plane) => ({ plane, z: Z[plane], frames: PLANE_FRAMES[plane] }))
    .sort((a, b) => a.z - b.z);
}
