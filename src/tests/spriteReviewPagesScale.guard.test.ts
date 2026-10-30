import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { FACILITIES } from "../engine/facilities";
import { FLOOR, TILE } from "../render/scale";
import type { Transport, Unit } from "../engine/types";
import { fakeContext, importRemovingWindowListeners } from "./spriteReviewPageHarness";

/**
 * Shift-left guard: the two sprite-review pages draw at the world's proportions.
 *
 * `preview.html` and `gallery.html` are the pages a person opens to judge room
 * art, so art vetted through them is vetted at whatever aspect they happen to
 * use. Both had quietly kept their own copy of the scale and both had drifted
 * (issue #814): 12 x 44 on one page and 18 x 52 on the other, against a world of
 * 10 x 45. Nothing failed, because nothing was watching.
 *
 * This runs each page for one frame against a recording context. What reaches
 * the screen is the box a painter is handed TIMES the context scale the page set
 * around it, so both halves are checked: every box must carry the world's tiles
 * per floor, and every scale must be uniform (the same factor on both axes) and
 * a whole multiple of the world wherever the cell has room for 1x. A page that
 * drew either half at a pitch of its own fails here. Pixel sizes are never
 * pinned: pinning them would only relocate the drift instead of catching it.
 */

/** Boxes the pages handed the sprite painters, and the context scales they set,
 *  tagged by page. Hoisted, because the module mocks below are hoisted above
 *  this file's own imports. */
const rec = vi.hoisted(() => ({
  page: "" as "preview" | "gallery" | "",
  rooms: [] as Array<{ u: Unit; w: number; h: number }>,
  units: [] as Array<{ u: Unit; w: number; h: number }>,
  transports: [] as Array<{ t: Transport; w: number; floorH: number }>,
  scales: { preview: [] as Array<[number, number]>, gallery: [] as Array<[number, number]> },
}));

// Recording stand-ins for the painters. What they draw is not this file's
// business (the sprite suites cover that); the box they are handed is.
vi.mock("../render/pixelSprites", () => ({
  drawRoom: (_d: unknown, u: Unit, _x: number, _y: number, w: number, h: number) => {
    rec.rooms.push({ u, w, h });
  },
}));
vi.mock("../render/sprites", () => ({
  drawUnit: (_d: unknown, u: Unit, _x: number, _y: number, w: number, h: number) => {
    rec.units.push({ u, w, h });
  },
  drawTransport: (_ctx: unknown, t: Transport, _x: number, _y: number, w: number, floorH: number) => {
    rec.transports.push({ t, w, floorH });
  },
  drawCar: () => {},
}));
// The gallery reports a page landing and injects host telemetry on import.
// Neither belongs in a unit run.
vi.mock("../telemetry", () => ({ injectVercelTelemetry: () => {} }));
vi.mock("../analytics", () => ({ trackAppAction: () => {} }));

/** The world's floor pitch, in tiles. Both pages must reproduce this whatever
 *  they magnify or shrink by. */
const TILES_PER_FLOOR = FLOOR / TILE;

/** Tiles per floor a drawn box implies. */
function tilesPerFloor(tiles: number, floors: number, w: number, h: number): number {
  return h / floors / (w / tiles);
}

const floorsOf = (u: Unit): number => FACILITIES[u.kind].floors ?? 1;

/** The metro spans the whole lot. Its platform art composes itself into whatever
 *  width it is handed, so the gallery deliberately fills the cell width and takes
 *  only the height from the scale; its box is the one that cannot be checked for
 *  aspect. */

let priorGetContext: PropertyDescriptor | undefined;
let priorClientWidth: PropertyDescriptor | undefined;
let removeListeners: Array<() => void> = [];

beforeAll(async () => {
  priorGetContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext");
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    writable: true,
    value: () =>
      fakeContext({
        onScale: (sx, sy) => {
          if (rec.page) rec.scales[rec.page].push([sx, sy]);
        },
      }),
  });
  // The gallery sizes its columns from the container, which measures 0 with no
  // layout engine. Give it a desktop width so it lays out its three columns.
  priorClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 960 });
  // Both pages loop on rAF. Swallowing the callback leaves exactly the one frame
  // each page draws synchronously on import.
  vi.stubGlobal("requestAnimationFrame", () => 0);

  const previewCanvas = document.createElement("canvas");
  previewCanvas.id = "preview";
  document.body.append(previewCanvas);
  const app = document.createElement("div");
  app.id = "app";
  document.body.append(app);

  rec.page = "preview";
  removeListeners.push(await importRemovingWindowListeners(() => import("../preview")));
  rec.page = "gallery";
  removeListeners.push(await importRemovingWindowListeners(() => import("../gallery")));
  rec.page = "";
});

afterAll(() => {
  for (const remove of removeListeners) remove();
  removeListeners = [];
  if (priorGetContext) Object.defineProperty(HTMLCanvasElement.prototype, "getContext", priorGetContext);
  else Reflect.deleteProperty(HTMLCanvasElement.prototype, "getContext");
  if (priorClientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", priorClientWidth);
  else Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("the sprite-review pages draw at the world scale", () => {
  it("preview.html gives every room the world's tiles per floor", () => {
    // A page that drew nothing would pass every loop below, so count first.
    expect(rec.rooms.length).toBeGreaterThan(5);
    for (const { u, w, h } of rec.rooms) {
      expect(w, `${u.kind} drew an empty box`).toBeGreaterThan(0);
      expect(tilesPerFloor(u.width, floorsOf(u), w, h), `${u.kind} on preview.html`).toBeCloseTo(TILES_PER_FLOOR, 6);
    }
  });

  it("gallery.html gives every room the world's tiles per floor", () => {
    // Every catalog cell draws a backing floor strip under its subject, at a
    // deliberately wider box; the subject carries id 1 and the backdrops do not.
    const subjects = rec.units.filter((r) => r.u.id === 1);
    expect(subjects.length).toBeGreaterThan(30);
    for (const { u, w, h } of subjects) {
      expect(w, `${u.kind} drew an empty box`).toBeGreaterThan(0);
      expect(tilesPerFloor(u.width, floorsOf(u), w, h), `${u.kind} in the gallery`).toBeCloseTo(TILES_PER_FLOOR, 6);
    }
  });

  it("gallery.html gives every shaft the world's tiles per floor", () => {
    // Stairs, escalator, and the three elevator kinds. A shaft drawn at a floor
    // pitch of its own would misreport the one proportion the transport art is
    // judged on, the car against the floor it stops at.
    expect(rec.transports.length).toBe(5);
    for (const { t, w, floorH } of rec.transports) {
      expect(tilesPerFloor(t.width, 1, w, floorH), `${t.kind} in the gallery`).toBeCloseTo(TILES_PER_FLOOR, 6);
    }
  });

  it("scales the context uniformly on both pages", () => {
    // The box half above is world-size by construction, so a page could only
    // distort the art through its transform. Equal factors on both axes is the
    // half of the aspect that lives there.
    for (const page of ["preview", "gallery"] as const) {
      expect(rec.scales[page].length, `${page} never transformed its context`).toBeGreaterThan(5);
      for (const [sx, sy] of rec.scales[page]) expect(sy, `${page} scaled ${sx} x ${sy}`).toBe(sx);
    }
  });

  it("preview.html draws every room at exactly the world scale", () => {
    // The preview's cells are sized so even the two-floor cinema fits at 1x;
    // any other factor means a room shrank or a cell lost its height budget.
    for (const [sx] of rec.scales.preview) expect(sx).toBe(1);
  });

  it("gallery.html magnifies by whole multiples, up to its ceiling of 3", () => {
    // A cell may step down from 3x to 2x or 1x when its footprint is too big,
    // but at or above the world scale only whole multiples keep each world
    // pixel a whole block of screen pixels. Below 1x is allowed only for a
    // footprint wider than the cell, so it must be the rare case.
    const scales = rec.scales.gallery.map(([sx]) => sx);
    expect(Math.max(...scales)).toBe(3);
    for (const s of scales) {
      expect(s, "a cell scaled to nothing").toBeGreaterThan(0);
      if (s >= 1) expect(Number.isInteger(s), `a cell magnified by ${s}x`).toBe(true);
    }
    const fractional = scales.filter((s) => s < 1).length;
    expect(fractional, "too many gallery cells shrank below the world scale").toBeLessThanOrEqual(3);
  });
});
