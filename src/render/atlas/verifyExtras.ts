import { FACILITIES } from "../../engine/facilities";
import type { FacilityKind, Transport, Unit } from "../../engine/types";
import { SHIRTS, personFigure } from "../pixelSprites/common";
import { FLOOR, TILE } from "../scale";
import { drawCar, drawEscapeStairs, drawLobbyEntrance, drawTransport, drawUnit } from "../sprites";
import { skyColor } from "../sprites/sky";
import { bake, type Renderer } from "./bake";
import type { Job } from "./catalog";
import { CAR_SEEDS, SKY_COLUMNS } from "./catalogExtras";
import { compareImages, composeFrame } from "./compose";
import { blank, over, type Image } from "./pixels";
import type { SampleResult } from "./verify";

/**
 * The non-room half of the atlas check, run beside `verify.ts`: each case
 * composes atlas frames the way a frontend would and compares them with the
 * game's own draw call, made with the arguments the game passes
 * (`towerReconcile.transportGraphic`, `towerCrowd.carGfx`,
 * `towerScene.bakeSharedGraphics`, `towerScene.skyColor`). The shaft case
 * rebuilds a whole express shaft, skip floor included, from its floor pieces.
 */

function canvas(doc: Document, w: number, h: number): CanvasRenderingContext2D {
  const c = doc.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

function read(ctx: CanvasRenderingContext2D, w: number, h: number): Image {
  return { w, h, data: ctx.getImageData(0, 0, w, h).data };
}

/** A structural tile as the game bakes it (`towerScene.fakeStruct`). */
function struct(kind: "floor" | "lobby", floor: number, x: number): Unit {
  return { id: -1, kind, floor, x, width: 1, state: "occupied", satisfaction: 1, occupants: 0, everOccupied: false, pendingIncome: 0, label: "" };
}

interface Case {
  label: string;
  /** Compares two different pictures on purpose (see SampleResult). */
  control?: boolean;
  frames: string[];
  /** Compose the atlas side from baked frames. */
  atlas: (get: (name: string, chains?: Record<string, number>) => Image) => Image;
  /** The game's draw. */
  game: (doc: Document) => Image;
}

function shaftCase(kind: FacilityKind): Case {
  const w = FACILITIES[kind].width * TILE;
  const floors = 5;
  const skip = 3;
  // Bands from the top: top floor, stop, skip floor, stop, bottom floor.
  const pieces = ["top", "stop", "skip", "stop", "bottom"];
  return {
    label: `${kind} shaft, five floors with floor ${skip} skipped`,
    frames: [...new Set(pieces)].map((p) => `shaft/${kind}/${p}`),
    atlas: (get) => {
      const out = blank(w, floors * FLOOR);
      pieces.forEach((p, i) => over(out, get(`shaft/${kind}/${p}`), 0, i * FLOOR));
      return out;
    },
    game: (doc) => {
      const ctx = canvas(doc, w, floors * FLOOR);
      const t: Transport = { id: 1, kind, x: 0, width: w / TILE, bottom: 1, top: floors, cars: 1, carPositions: [1], carDir: [0], load: 0, skipFloors: [skip] };
      drawTransport(ctx, t, 0, 0, w, FLOOR);
      return read(ctx, w, floors * FLOOR);
    },
  };
}

export function extraCases(): Case[] {
  const cab = (kind: FacilityKind, s: number, riders: number, arrow: "up" | "down" | null, full: boolean): Case => {
    const w = FACILITIES[kind].width * TILE;
    const name = `car/${kind}/${arrow ?? "idle"}/${full ? "full" : "notfull"}/s${s}`;
    return {
      label: `${kind} cab with ${riders} riders`,
      frames: [name],
      atlas: (get) => get(name, { riders }),
      game: (doc) => {
        const ctx = canvas(doc, w, FLOOR);
        drawCar(ctx, CAR_SEEDS[s], w, FLOOR, riders, arrow, full, kind);
        return read(ctx, w, FLOOR);
      },
    };
  };
  return [
    shaftCase("elevatorExpress"),
    shaftCase("elevatorStandard"),
    cab("elevatorStandard", 1, 3, "up", false),
    cab("elevatorService", 2, 4, null, true),
    cab("elevatorExpress", 3, 1, "down", false),
    {
      label: "walker in shirt 2",
      frames: ["person/walker/shirt2"],
      atlas: (get) => get("person/walker/shirt2"),
      game: (doc) => {
        // towerScene's walker bake: 9 x 25, the figure one pixel in, feet on row 24.
        const ctx = canvas(doc, 9, 25);
        personFigure(ctx, 1, 24, "walker", SHIRTS[2]);
        return read(ctx, 9, 25);
      },
    },
    {
      label: "lit sky-lobby tile, variant 2",
      frames: ["structure/lobby/sky/lit/v2"],
      atlas: (get) => get("structure/lobby/sky/lit/v2"),
      game: (doc) => {
        const ctx = canvas(doc, TILE, FLOOR);
        drawUnit({ ctx, lit: true, anim: 0, hour: 20 }, struct("lobby", 2, 2), 0, 0, TILE, FLOOR);
        return read(ctx, TILE, FLOOR);
      },
    },
    {
      label: "grand entrance, doorman's second pose",
      frames: ["structure/entrance/grand-right/lit/staffed/1"],
      atlas: (get) => get("structure/entrance/grand-right/lit/staffed/1"),
      game: (doc) => {
        const ctx = canvas(doc, TILE, FLOOR);
        drawLobbyEntrance({ ctx, lit: true, anim: 1.5, hour: 20, staffed: true }, "grand-right", 0, 0, TILE, FLOOR);
        return read(ctx, TILE, FLOOR);
      },
    },
    {
      label: "right fire escape, odd floor",
      frames: ["facade/escape/right/1"],
      atlas: (get) => get("facade/escape/right/1"),
      game: (doc) => {
        const ctx = canvas(doc, 14, FLOOR);
        drawEscapeStairs(ctx, "right", 1, FLOOR);
        return read(ctx, 14, FLOOR);
      },
    },
    {
      // The control: lobby variant 0 from the atlas against the game's
      // variant 1. These differ, so the comparison must say so.
      label: "control: lobby variant 0 against variant 1",
      control: true,
      frames: ["structure/lobby/sky/lit/v0"],
      atlas: (get) => get("structure/lobby/sky/lit/v0"),
      game: (doc) => {
        const ctx = canvas(doc, TILE, FLOOR);
        drawUnit({ ctx, lit: true, anim: 0, hour: 20 }, struct("lobby", 2, 1), 0, 0, TILE, FLOOR);
        return read(ctx, TILE, FLOOR);
      },
    },
    {
      label: "sky strip",
      frames: ["sky/gradient"],
      atlas: (get) => get("sky/gradient"),
      game: (doc) => {
        const ctx = canvas(doc, SKY_COLUMNS, 1);
        for (let c = 0; c < SKY_COLUMNS; c++) {
          ctx.fillStyle = skyColor((c * 24) / SKY_COLUMNS);
          ctx.fillRect(c, 0, 1, 1);
        }
        return read(ctx, SKY_COLUMNS, 1);
      },
    },
  ];
}

/** Run every non-room case. Animation frames are addressed by their full
 *  frame name (`<animation>/<i>`); their job is the animation. */
export function verifyExtras(doc: Document, jobs: readonly Job[], renderer: Renderer): SampleResult[] {
  return extraCases().map((c) => {
    const jobNames = new Set(c.frames.map((f) => (jobs.some((j) => j.name === f) ? f : f.slice(0, f.lastIndexOf("/")))));
    const r = bake(
      jobs.filter((j) => jobNames.has(j.name)),
      renderer,
    );
    const get = (name: string, chains: Record<string, number> = {}) => {
      const rec = r.frames.find((f) => f.name === name);
      if (!rec) throw new Error(`no frame ${name}`);
      return composeFrame(r, rec, chains);
    };
    const mine = c.atlas(get);
    const theirs = c.game(doc);
    const cmp = compareImages(theirs, mine);
    return { label: c.label, frame: c.frames.join(", "), pixels: theirs.w * theirs.h, mismatches: cmp.mismatches, box: cmp.box, offset: { x: 0, y: 0 }, control: c.control };
  });
}
