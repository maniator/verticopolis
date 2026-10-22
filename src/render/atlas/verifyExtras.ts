import { FACILITIES } from "../../engine/facilities";
import type { FacilityKind } from "../../engine/types";
import type { UnitView, TransportView } from "../../simport/view";
import { SHIRTS, personFigure } from "../pixelSprites/common";
import { FLOOR, TILE } from "../scale";
import { drawCar, drawEscapeStairs, drawLobbyEntrance, drawTransport, drawUnit } from "../sprites";
import { skyColor } from "../sprites/sky";
import { drawFountain, drawStreetLamp, drawStripTile, drawRoad } from "../excalibur/towerSceneryDraw";
import { bake, type Renderer } from "./bake";
import type { Job } from "./catalog";
import { CAR_SEEDS, SKY_COLUMNS } from "./catalogExtras";
import { compareImages, composeFrame, composeLayered } from "./compose";
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
function struct(kind: "floor" | "lobby", floor: number, x: number): UnitView {
  return { id: -1, kind, floor, x, width: 1, state: "occupied", occupants: 0, label: "" };
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

/** A shaft stack; `tiles` other than the catalog width names a legacy
 *  width's frames (`shaft/<kind>/w<tiles>/...`). */
function shaftCase(kind: FacilityKind, skip: number[], pieces: string[], tiles = FACILITIES[kind].width): Case {
  const w = tiles * TILE;
  const floors = pieces.length;
  const stem = tiles === FACILITIES[kind].width ? `shaft/${kind}` : `shaft/${kind}/w${tiles}`;
  // Bands run from the top floor down; `pieces` names each band's frame.
  return {
    label: `${kind} shaft${tiles === FACILITIES[kind].width ? "" : ` ${tiles} tiles wide`}, ${floors} floors skipping ${skip.join(", ") || "none"}`,
    frames: [...new Set(pieces)].map((p) => `${stem}/${p}`),
    atlas: (get) => {
      const out = blank(w, floors * FLOOR);
      pieces.forEach((p, i) => over(out, get(`${stem}/${p}`), 0, i * FLOOR));
      return out;
    },
    game: (doc) => {
      const ctx = canvas(doc, w, floors * FLOOR);
      const t: TransportView = { id: 1, kind, x: 0, width: w / TILE, bottom: 1, top: floors, cars: 1, carPositions: [1], carDir: [0], skipFloors: skip };
      drawTransport(ctx, t, 0, 0, w, FLOOR);
      return read(ctx, w, floors * FLOOR);
    },
  };
}

export function extraCases(): Case[] {
  const cab = (kind: FacilityKind, s: number, riders: number, arrow: "up" | "down" | null, full: boolean, tiles = FACILITIES[kind].width): Case => {
    const w = tiles * TILE;
    const seg = tiles === FACILITIES[kind].width ? "" : `/w${tiles}`;
    const name = `car/${kind}${seg}/${arrow ?? "idle"}/${full ? "full" : "notfull"}/s${s}`;
    return {
      label: `${kind} cab${seg ? ` ${tiles} tiles wide` : ""} with ${riders} riders`,
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
    shaftCase("elevatorExpress", [3], ["top", "stop", "skip", "stop", "bottom"]),
    shaftCase("elevatorStandard", [3], ["top", "stop", "skip", "stop", "bottom"]),
    shaftCase("elevatorService", [1, 4], ["top-skip", "stop", "stop", "bottom-skip"]),
    shaftCase("elevatorStandard", [1], ["single-skip"]),
    shaftCase("elevatorExpress", [], ["single"]),
    cab("elevatorStandard", 1, 3, "up", false),
    cab("elevatorService", 2, 4, null, true),
    cab("elevatorExpress", 3, 1, "down", false),
    // The legacy widths a save keeps (LEGACY_SHAFT_WIDTHS).
    shaftCase("elevatorStandard", [], ["top", "stop", "bottom"], 3),
    cab("elevatorStandard", 0, 4, "up", true, 3),
    shaftCase("elevatorExpress", [], ["top", "stop", "bottom"], 4),
    cab("elevatorExpress", 1, 2, "down", false, 4),
    ...(["stairs", "escalator"] as const).map((kind): Case => ({
      label: `${kind} 4 tiles wide`,
      frames: [`transport/${kind}/w4`],
      atlas: (get) => get(`transport/${kind}/w4`),
      game: (doc) => {
        const w = 4 * TILE;
        const ctx = canvas(doc, w, 2 * FLOOR);
        const t: TransportView = { id: 1, kind, x: 0, width: 4, bottom: 1, top: 2, cars: 0, carPositions: [], carDir: [], skipFloors: [] };
        drawTransport(ctx, t, 0, 0, w, FLOOR);
        return read(ctx, w, 2 * FLOOR);
      },
    })),
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
      label: "lit ground-lobby tile, variant 2 (chandelier)",
      frames: ["structure/lobby/ground/lit/v2"],
      atlas: (get) => get("structure/lobby/ground/lit/v2"),
      game: (doc) => {
        const ctx = canvas(doc, TILE, FLOOR);
        drawUnit({ ctx, lit: true, anim: 0, hour: 20 }, struct("lobby", 1, 2), 0, 0, TILE, FLOOR);
        return read(ctx, TILE, FLOOR);
      },
    },
    {
      label: "unlit ground-lobby tile, variant 3 (sconce on the shell)",
      frames: ["structure/lobby/ground/unlit/v3"],
      atlas: (get) => get("structure/lobby/ground/unlit/v3"),
      game: (doc) => {
        const ctx = canvas(doc, TILE, FLOOR);
        drawUnit({ ctx, lit: false, anim: 0, hour: 12 }, struct("lobby", 1, 3), 0, 0, TILE, FLOOR);
        return read(ctx, TILE, FLOOR);
      },
    },
    {
      label: "unlit sky-lobby tile, variant 1 (bench in front of the glass)",
      frames: ["structure/lobby/sky/unlit/v1"],
      atlas: (get) => get("structure/lobby/sky/unlit/v1"),
      game: (doc) => {
        const ctx = canvas(doc, TILE, FLOOR);
        drawUnit({ ctx, lit: false, anim: 0, hour: 12 }, struct("lobby", 2, 1), 0, 0, TILE, FLOOR);
        return read(ctx, TILE, FLOOR);
      },
    },
    {
      label: "grand entrance, left slice, unstaffed",
      frames: ["structure/entrance/grand-left/unlit/unstaffed/0"],
      atlas: (get) => get("structure/entrance/grand-left/unlit/unstaffed/0"),
      game: (doc) => {
        const ctx = canvas(doc, TILE, FLOOR);
        drawLobbyEntrance({ ctx, lit: false, anim: 0, hour: 12, staffed: false }, "grand-left", 0, 0, TILE, FLOOR);
        return read(ctx, TILE, FLOOR);
      },
    },
    {
      label: "compact grand entrance, staffed",
      frames: ["structure/entrance/grand-solo/lit/staffed/0"],
      atlas: (get) => get("structure/entrance/grand-solo/lit/staffed/0"),
      game: (doc) => {
        const ctx = canvas(doc, TILE, FLOOR);
        drawLobbyEntrance({ ctx, lit: true, anim: 0, hour: 20, staffed: true }, "grand-solo", 0, 0, TILE, FLOOR);
        return read(ctx, TILE, FLOOR);
      },
    },
    {
      label: "service entrance",
      frames: ["structure/entrance/service/unlit/staffed/0"],
      atlas: (get) => get("structure/entrance/service/unlit/staffed/0"),
      game: (doc) => {
        const ctx = canvas(doc, TILE, FLOOR);
        drawLobbyEntrance({ ctx, lit: false, anim: 0, hour: 12, staffed: true }, "service", 0, 0, TILE, FLOOR);
        return read(ctx, TILE, FLOOR);
      },
    },
    {
      label: "plaza fountain, sixth frame",
      frames: ["scenery/fountain/5"],
      atlas: (get) => get("scenery/fountain/5"),
      game: (doc) => {
        const ctx = canvas(doc, 100, 112);
        drawFountain(ctx, 100, 112, 0.5);
        return read(ctx, 100, 112);
      },
    },
    {
      label: "street lamp and 375 ST sign, half lit",
      frames: ["scenery/street-lamp/a50"],
      atlas: (get) => get("scenery/street-lamp/a50"),
      game: (doc) => {
        const w = 8 * TILE;
        const h = Math.round(FLOOR * 1.8);
        const ctx = canvas(doc, w, h);
        drawStreetLamp(ctx, w, h, 0.5);
        return read(ctx, w, h);
      },
    },
    {
      label: "ground strip, paved lot tile with a joint",
      frames: ["scenery/ground/pave/joint"],
      atlas: (get) => get("scenery/ground/pave/joint"),
      game: (doc) => {
        // One column wider than a lot tile, as the game paints a strip tile.
        const ctx = canvas(doc, TILE + 1, 11);
        drawStripTile(ctx, 0, 0, true);
        return read(ctx, TILE + 1, 11);
      },
    },
    {
      label: "road, one dash period",
      frames: ["scenery/ground/road"],
      atlas: (get) => get("scenery/ground/road"),
      game: (doc) => {
        const ctx = canvas(doc, 4 * TILE, 14);
        drawRoad(ctx, 4 * TILE, 4);
        return read(ctx, 4 * TILE, 14);
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
  return extraCases().flatMap((c) => {
    const jobNames = new Set(c.frames.map((f) => (jobs.some((j) => j.name === f) ? f : f.slice(0, f.lastIndexOf("/")))));
    const r = bake(
      jobs.filter((j) => jobNames.has(j.name)),
      renderer,
    );
    const recOf = (name: string) => {
      const rec = r.frames.find((f) => f.name === name);
      if (!rec) throw new Error(`no frame ${name}`);
      return rec;
    };
    const theirs = c.game(doc);
    const result = (label: string, mine: Image): SampleResult => {
      const cmp = compareImages(theirs, mine);
      return { label, frame: c.frames.join(", "), pixels: theirs.w * theirs.h, mismatches: cmp.mismatches, box: cmp.box, offset: { x: 0, y: 0 }, control: c.control };
    };
    const out = [result(c.label, c.atlas((name, chains = {}) => composeFrame(r, recOf(name), chains)))];
    // The lobby tiles and entrances are split for depth, so (outside the
    // control) they are composed through their shell and furniture as well,
    // and a lobby case that came back flat fails.
    const lobby = c.frames.every((f) => f.startsWith("structure/lobby/") || f.startsWith("structure/entrance/"));
    if (lobby && !c.control) {
      const split = c.frames.every((f) => recOf(f).layers);
      out.push(
        split
          ? result(`${c.label} (depth layers)`, c.atlas((name, chains = {}) => composeLayered(r, recOf(name), chains)))
          : { ...result(`${c.label} (depth layers missing)`, theirs), mismatches: theirs.w * theirs.h },
      );
    }
    return out;
  });
}
