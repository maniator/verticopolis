import { GRID } from "../../engine/facilities";
import { FLOOR, TILE } from "../scale";
import {
  APRON_PAD_TILES,
  FORECOURT_TILES,
  FOUNTAIN_TILE,
  PLAZA_LAMP_TILES,
  PLAZA_SIDEWALK_TILES,
  ROAD_START,
  ROAD_TILES,
  ROUNDABOUT_START,
  ROUNDABOUT_TILES,
  SIDEWALK_START,
  SIDEWALK_TILES,
  hash01,
} from "../sceneryLayout";
import {
  STRIP_ABOVE,
  STRIP_BELOW,
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
} from "../excalibur/towerSceneryDraw";
import type { AnimJob, Job, Keys, StillJob } from "./catalog";

/**
 * The world outside the tower (`excalibur/towerScenery.ts`): the plaza's
 * roundabout, fountain and lamps, the street lamp with its "375 ST" sign, the
 * forecourt planter, the lot's trees and bushes, and the ground pieces. Every
 * frame is painted by the game's own scenery painters; {@link sceneryData}
 * says where the game puts each piece, so a frontend can rebuild the scene.
 */

export type ScenerySpec =
  | {
      p: "scenery";
      piece: "roundabout" | "planter" | "bush" | "sidewalk" | "forecourt";
    }
  | { p: "scenery"; piece: "fountain"; t: number }
  | { p: "scenery"; piece: "plazaLamp" | "streetLamp"; a: number }
  | { p: "scenery"; piece: "tree"; seed: number }
  | { p: "scenery"; piece: "road"; phase: number }
  | { p: "scenery"; piece: "strip"; tile: number; paved: boolean };

/** Paint a scenery piece into a canvas `w` x `h`. */
export function paintScenery(
  ctx: CanvasRenderingContext2D,
  s: ScenerySpec,
  w: number,
  h: number,
): void {
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

/** Piece sizes (px), as the game sizes their canvases. */
const SIZE = {
  roundabout: { w: ROUNDABOUT_TILES * TILE, h: 48 },
  fountain: { w: 100, h: 112 },
  plazaLamp: { w: 84, h: Math.round(FLOOR * 1.6) + 14 },
  streetLamp: { w: 8 * TILE, h: Math.round(FLOOR * 1.8) },
  planter: { w: 2 * TILE, h: 18 },
  tree: { w: 3 * TILE, h: Math.round(FLOOR * 1.5) },
  bush: { w: 2 * TILE, h: Math.round(FLOOR * 0.5) },
  sidewalk: { w: TILE, h: 11 },
  forecourt: { w: 2 * TILE, h: 10 },
  road: { w: 4 * TILE, h: 14 },
  strip: { w: TILE, h: STRIP_ABOVE + STRIP_BELOW },
};

/** The lamp brightness steps baked (the game fades continuously). */
export const LAMP_STEPS = [0, 25, 50, 75, 100];
/** Fountain frames: the water's motions share no period, so this samples one
 *  stretch close to a loop. */
export const FOUNTAIN_FRAMES = 24;
export const FOUNTAIN_DT = 0.1;
/** Tree variants baked (the game seeds each tree by the tower and its spot). */
export const TREE_VARIANTS = 8;

/** The grass variant of lot tile `t`: its shade (0..2) and whether it has a
 *  tuft, exactly as `drawStripTile` picks them. */
export function grassVariant(t: number): { shade: number; tuft: boolean } {
  const s = hash01(t * 17);
  let shade = 0;
  if (s < 0.33) shade = 1;
  else if (s < 0.66) shade = 2;
  return { shade, tuft: hash01(t * 29) < 0.2 };
}

/** A lot tile showing each grass variant (and each paving joint), for the bake. */
function sampleTiles(): {
  grass: Map<string, number>;
  pave: Map<string, number>;
} {
  const grass = new Map<string, number>();
  for (let t = 0; t < GRID.width && grass.size < 6; t++) {
    const g = grassVariant(t);
    const key = `s${g.shade}/${g.tuft ? "tuft" : "flat"}`;
    if (!grass.has(key)) grass.set(key, t);
  }
  return {
    grass,
    pave: new Map([
      ["plain", 1],
      ["joint", 0],
    ]),
  };
}

function still(
  name: string,
  size: { w: number; h: number },
  paint: ScenerySpec,
  keys: Keys,
): StillJob {
  return {
    type: "still",
    name,
    w: size.w,
    h: size.h,
    anchor: { x: 0, y: 0 },
    keys: { kind: "scenery", ...keys },
    paint,
  };
}

/** Every scenery frame. */
export function sceneryJobs(): Job[] {
  const jobs: Job[] = [
    still(
      "scenery/roundabout",
      SIZE.roundabout,
      { p: "scenery", piece: "roundabout" },
      { piece: "roundabout" },
    ),
    still(
      "scenery/planter",
      SIZE.planter,
      { p: "scenery", piece: "planter" },
      { piece: "planter" },
    ),
    still(
      "scenery/bush",
      SIZE.bush,
      { p: "scenery", piece: "bush" },
      { piece: "bush" },
    ),
    still(
      "scenery/ground/sidewalk",
      SIZE.sidewalk,
      { p: "scenery", piece: "sidewalk" },
      { piece: "sidewalk" },
    ),
    still(
      "scenery/ground/forecourt",
      SIZE.forecourt,
      { p: "scenery", piece: "forecourt" },
      { piece: "forecourt" },
    ),
    still(
      "scenery/ground/road",
      SIZE.road,
      { p: "scenery", piece: "road", phase: 4 },
      { piece: "road" },
    ),
  ];
  for (const pct of LAMP_STEPS) {
    jobs.push(
      still(
        `scenery/plaza-lamp/a${pct}`,
        SIZE.plazaLamp,
        { p: "scenery", piece: "plazaLamp", a: pct / 100 },
        { piece: "plazaLamp", lamp: pct },
      ),
    );
    jobs.push(
      still(
        `scenery/street-lamp/a${pct}`,
        SIZE.streetLamp,
        { p: "scenery", piece: "streetLamp", a: pct / 100 },
        { piece: "streetLamp", lamp: pct },
      ),
    );
  }
  for (let v = 0; v < TREE_VARIANTS; v++)
    jobs.push(
      still(
        `scenery/tree/v${v}`,
        SIZE.tree,
        { p: "scenery", piece: "tree", seed: v },
        { piece: "tree", variant: v },
      ),
    );
  const { grass, pave } = sampleTiles();
  for (const [key, tile] of grass)
    jobs.push(
      still(
        `scenery/ground/grass/${key}`,
        SIZE.strip,
        { p: "scenery", piece: "strip", tile, paved: false },
        { piece: "grass" },
      ),
    );
  for (const [key, tile] of pave)
    jobs.push(
      still(
        `scenery/ground/pave/${key}`,
        SIZE.strip,
        { p: "scenery", piece: "strip", tile, paved: true },
        { piece: "pave" },
      ),
    );
  const fountain: AnimJob = {
    type: "anim",
    name: "scenery/fountain",
    ...SIZE.fountain,
    anchor: { x: 0, y: 0 },
    keys: { kind: "scenery", piece: "fountain" },
    dt: FOUNTAIN_DT,
    loop: true,
    frames: Array.from(
      { length: FOUNTAIN_FRAMES },
      (_, i) =>
        ({
          p: "scenery",
          piece: "fountain",
          t: i * FOUNTAIN_DT,
        }) as ScenerySpec,
    ),
  };
  jobs.push(fountain);
  return jobs;
}

/** Where the game places each piece: x from the lot's left edge and y from
 *  the ground line (both px, y negative upward, the frame's top-left corner),
 *  back to front. A run repeats its tile frame from `x` for `w` px. */
export function sceneryData() {
  const plazaLamp = SIZE.plazaLamp;
  const streetLamp = SIZE.streetLamp;
  const planter = SIZE.planter;
  return {
    lotTiles: GRID.width,
    ground: {
      strip: {
        y: -STRIP_ABOVE,
        apronPadTiles: APRON_PAD_TILES,
        grass: Array.from({ length: GRID.width }, (_, t) => {
          const g = grassVariant(t);
          return `s${g.shade}/${g.tuft ? "tuft" : "flat"}`;
        }),
      },
      runs: [
        {
          frame: "scenery/ground/sidewalk",
          x: -PLAZA_SIDEWALK_TILES * TILE,
          y: -7,
          w: PLAZA_SIDEWALK_TILES * TILE,
        },
        {
          frame: "scenery/ground/road",
          x: -GRID.width * TILE,
          y: -2,
          w: (ROUNDABOUT_START + GRID.width) * TILE,
          tileOriginX: 0,
        },
        {
          frame: "scenery/ground/forecourt",
          x: GRID.width * TILE,
          y: -6,
          w: FORECOURT_TILES * TILE,
        },
        {
          frame: "scenery/ground/sidewalk",
          x: SIDEWALK_START * TILE,
          y: -7,
          w: SIDEWALK_TILES * TILE,
        },
        {
          frame: "scenery/ground/road",
          x: ROAD_START * TILE,
          y: -2,
          w: ROAD_TILES * TILE,
          tileOriginX: ROAD_START * TILE,
        },
      ],
    },
    props: [
      { frame: "scenery/roundabout", x: ROUNDABOUT_START * TILE, y: -30 },
      {
        frame: "scenery/fountain",
        x: FOUNTAIN_TILE * TILE - SIZE.fountain.w / 2,
        y: -102,
      },
      ...PLAZA_LAMP_TILES.map((t) => ({
        frame: "scenery/plaza-lamp",
        x: t * TILE - plazaLamp.w / 2,
        y: -plazaLamp.h + 4,
      })),
      {
        frame: "scenery/street-lamp",
        x: Math.round((SIDEWALK_START + 1) * TILE - streetLamp.w / 2),
        y: -streetLamp.h - 7,
      },
      {
        frame: "scenery/planter",
        x: Math.round(
          (GRID.width + FORECOURT_TILES / 2) * TILE - planter.w / 2,
        ),
        y: -planter.h - 6,
      },
    ],
    lamp: { steps: LAMP_STEPS, fadeIn: [18, 20], fadeOut: [5, 7] },
  };
}
