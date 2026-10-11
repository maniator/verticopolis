import type { FacilityKind, Transport, Unit, UnitState } from "../../engine/types";
import type { PersonBuild } from "../pixelSprites/common";
import { personFigure } from "../pixelSprites/common";
import type { CarArrow } from "../carIndicator";
import { FLOOR, TILE } from "../scale";
import { drawCar, drawTransport, drawUnit, type DrawCtx, type EntranceKind } from "../sprites";
import { drawAwning, drawCrane, drawEscapeStairs, drawLobbyEntrance } from "../sprites";
import { drawGarbageTruck, drawMetroTrain, drawStreetCar } from "../sprites";
import { paintAnimatedUnit, paintSettledUnit } from "../regionPaint";
import { cloudFill, drawCloud, drawSunDisc, skyColor } from "../sprites/sky";

/**
 * One draw call the atlas bakes, as plain data: the catalog lists these, the
 * browser bake runs them through {@link paint}, and the comparison test runs
 * the same specs against the web renderer's own bake path. Every spec draws
 * at the canvas origin into a canvas exactly the frame's size, the same way
 * the web game bakes its sprites.
 */
export type PaintSpec =
  | UnitPaint
  | { p: "lobby"; ground: boolean; variant: number; lit: boolean }
  | { p: "floor" }
  | { p: "entrance"; kind: EntranceKind; lit: boolean; anim: number; staffed: boolean }
  | { p: "shaft"; kind: FacilityKind; floors: number; band: number; skip: number[] }
  | { p: "car"; kind: FacilityKind; seed: number; riders: number; arrow: CarArrow; full: boolean }
  | { p: "person"; build: PersonBuild; fill: string }
  | { p: "escape"; side: "left" | "right"; parity: 0 | 1 }
  | { p: "awning"; side: "left" | "right" }
  | { p: "crane"; t: number; lit: boolean }
  | { p: "streetCar"; seed: number }
  | { p: "garbageTruck"; w: number }
  | { p: "metroTrain"; w: number; headlight: boolean }
  | { p: "skyGradient" }
  | { p: "disc"; day: boolean; r: number }
  | { p: "cloud"; weather: "overcast" | "rain"; r: number }
  | { p: "solid"; css: string };

/** The fields of a placed room the sprite code reads, plus the scene inputs
 *  the web threads through its `DrawCtx` at bake time. */
export interface UnitPaint {
  p: "unit";
  kind: FacilityKind;
  state: UnitState;
  subtype?: string;
  floor: number;
  x: number;
  id: number;
  width: number;
  occupants: number;
  outForMeal: number;
  lit: boolean;
  hour: number;
  anim: number;
  parkingUse?: number;
  recycleFill?: number;
  dead?: boolean;
}

/** Build the engine-shaped unit a {@link UnitPaint} describes. */
export function unitOf(s: UnitPaint): Unit {
  return {
    id: s.id,
    kind: s.kind,
    floor: s.floor,
    x: s.x,
    width: s.width,
    state: s.state,
    satisfaction: 1,
    occupants: s.occupants,
    outForMeal: s.outForMeal,
    subtype: s.subtype,
    everOccupied: true,
    pendingIncome: 0,
    label: "",
  };
}

/** A structural tile as the web bakes it (`towerScene.fakeStruct`). */
function structUnit(kind: "floor" | "lobby", floor: number, x: number): Unit {
  return {
    id: -1,
    kind,
    floor,
    x,
    width: 1,
    state: "occupied",
    satisfaction: 1,
    occupants: 0,
    everOccupied: false,
    pendingIncome: 0,
    label: "",
  };
}

/** The scene context the web's settled-room bake hands `drawUnit`. */
export function unitDrawCtx(ctx: CanvasRenderingContext2D, s: UnitPaint): DrawCtx {
  return {
    ctx,
    lit: s.lit,
    anim: s.anim,
    hour: s.hour,
    parkingUse: s.parkingUse ?? 0,
    recycleFill: s.recycleFill ?? 0,
    parkingDead: s.dead === true,
  };
}

/** Paint `s` into `ctx`, whose canvas is `w` x `h`. */
export function paint(ctx: CanvasRenderingContext2D, s: PaintSpec, w: number, h: number): void {
  switch (s.p) {
    case "unit": {
      // The game's own paint paths: burning and unbuilt rooms through their
      // per-unit canvas, settled rooms through the region compositor's.
      const d = unitDrawCtx(ctx, s);
      if (s.state === "fire" || s.state === "construction") return paintAnimatedUnit(d, unitOf(s), w, h);
      return paintSettledUnit(d, unitOf(s), 0, 0, w, h, s.dead === true);
    }
    case "lobby":
      return drawUnit(structCtx(ctx, s.lit), structUnit("lobby", s.ground ? 1 : 2, s.variant), 0, 0, TILE, FLOOR);
    case "floor":
      return drawUnit(structCtx(ctx, false), structUnit("floor", 1, 0), 0, 0, TILE, FLOOR);
    case "entrance":
      return drawLobbyEntrance(
        { ctx, lit: s.lit, anim: s.anim, hour: s.lit ? 20 : 12, staffed: s.staffed },
        s.kind,
        0,
        0,
        TILE,
        FLOOR,
      );
    case "shaft":
      return drawTransport(ctx, shaftOf(s.kind, s.floors, s.skip, w), 0, -s.band * FLOOR, w, FLOOR);
    case "car":
      return drawCar(ctx, s.seed, w, FLOOR, s.riders, s.arrow, s.full, s.kind);
    case "person":
      return personFigure(ctx, PERSON_X, h - 1, s.build, s.fill);
    case "escape":
      return drawEscapeStairs(ctx, s.side, s.parity, FLOOR);
    case "awning":
      return drawAwning(ctx, s.side, FLOOR);
    case "crane":
      return drawCrane(ctx, s.t, s.lit);
    case "streetCar":
      return drawStreetCar(ctx, s.seed);
    case "garbageTruck":
      return drawGarbageTruck(ctx, s.w);
    case "metroTrain":
      return drawMetroTrain(ctx, s.w, s.headlight);
    default:
      return paintSky(ctx, s, w, h);
  }
}

/** The sky family: the 24-hour color strip, the sun and moon, the clouds and
 *  the skyline's solid fills. */
function paintSky(ctx: CanvasRenderingContext2D, s: PaintSpec, w: number, h: number): void {
  switch (s.p) {
    case "skyGradient":
      // One column per quarter hour, sampled at the column's start.
      for (let col = 0; col < w; col++) {
        ctx.fillStyle = skyColor((col * 24) / w);
        ctx.fillRect(col, 0, 1, h);
      }
      return;
    case "disc":
      return drawSunDisc(ctx, w / 2, h / 2, s.day);
    case "cloud": {
      ctx.fillStyle = cloudFill(s.weather);
      const o = cloudOrigin(s.r);
      return drawCloud(ctx, o.x, o.y, s.r);
    }
    case "solid":
      ctx.fillStyle = s.css;
      ctx.fillRect(0, 0, w, h);
      return;
    default:
      throw new Error(`unknown paint spec ${JSON.stringify(s)}`);
  }
}

function structCtx(ctx: CanvasRenderingContext2D, lit: boolean): DrawCtx {
  return { ctx, lit, anim: 0, hour: lit ? 20 : 12 };
}

/** A shaft `floors` tall for one band bake, as the web's `transportGraphic`
 *  draws it. */
function shaftOf(kind: FacilityKind, floors: number, skip: number[], w: number): Transport {
  return {
    id: 1,
    kind,
    x: 0,
    width: w / TILE,
    bottom: 1,
    top: floors,
    cars: 1,
    carPositions: [1],
    carDir: [0],
    load: 0,
    skipFloors: skip,
  };
}

/** The walker bake's column offset (towerScene's PERSON_X): figures sit one
 *  pixel in from the left so the 1px contact shadow fits. */
export const PERSON_X = 1;

/** Canvas size for a person build: the build plus the contact-shadow margin. */
export function personSize(width: number, height: number): { w: number; h: number } {
  return { w: width + 2, h: height + 1 };
}

/** Where a cloud of radius `r` is drawn inside its own canvas so every puff
 *  lands in bounds, and the canvas size that holds it. */
export function cloudOrigin(r: number): { x: number; y: number; w: number; h: number } {
  const x = Math.ceil(r * 0.88) + 2;
  const y = Math.ceil(r * 0.5) + 2;
  return { x, y, w: x + Math.ceil(r * 0.9) + 2, h: y + Math.ceil(r * 0.55) + 11 };
}
