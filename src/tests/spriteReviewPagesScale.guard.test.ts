import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { FACILITIES, GRID } from "../engine/facilities";
import { FLOOR, TILE } from "../render/scale";
import type { Transport, Unit } from "../engine/types";

/**
 * Shift-left guard: the two sprite-review pages draw at the world's proportions.
 *
 * `preview.html` and `gallery.html` are the pages a person opens to judge room
 * art, so art vetted through them is vetted at whatever aspect they happen to
 * use. Both had quietly kept their own copy of the scale and both had drifted
 * (issue #814): 12 x 44 on one page and 18 x 52 on the other, against a world of
 * 10 x 45. Nothing failed, because nothing was watching.
 *
 * This runs each page for one frame against a recording context and inspects the
 * BOX each sprite was handed, which is the page's whole contribution to how the
 * art reads. The assertion is the aspect (`FLOOR / TILE`), never a pixel size: a
 * page is free to magnify or to shrink a footprint into its cell, and pinning
 * sizes would only relocate the drift instead of catching it.
 */

/** Boxes the pages handed the sprite painters. Hoisted, because the module mocks
 *  below are hoisted above this file's own imports. */
const rec = vi.hoisted(() => ({
  rooms: [] as Array<{ u: Unit; w: number; h: number }>,
  units: [] as Array<{ u: Unit; w: number; h: number }>,
  transports: [] as Array<{ t: Transport; w: number; floorH: number }>,
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

/** A 2D-context stand-in that absorbs every call, so neither page needs a real
 *  canvas. Same Proxy shape the service-sprite suite uses. */
function fakeContext(): CanvasRenderingContext2D {
  const store: Record<string | symbol, unknown> = {};
  const ctx: unknown = new Proxy({} as Record<string | symbol, unknown>, {
    get(_t, prop) {
      if (prop === "canvas") return { width: 4096, height: 4096, getContext: () => ctx };
      if (prop === "createLinearGradient" || prop === "createRadialGradient" || prop === "createPattern") {
        return () => ({ addColorStop: () => {} });
      }
      if (prop === "measureText") return () => ({ width: 4 });
      if (prop in store) return store[prop];
      return () => {};
    },
    set(_t, prop, value) {
      store[prop] = value;
      return true;
    },
  });
  return ctx as CanvasRenderingContext2D;
}

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
const isFullLot = (u: Unit): boolean => FACILITIES[u.kind].width >= GRID.width;

let priorGetContext: PropertyDescriptor | undefined;
let priorClientWidth: PropertyDescriptor | undefined;

beforeAll(async () => {
  priorGetContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext");
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    writable: true,
    value: () => fakeContext(),
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

  await import("../preview");
  await import("../gallery");
});

afterAll(() => {
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
    const subjects = rec.units.filter((r) => r.u.id === 1 && !isFullLot(r.u));
    expect(subjects.length).toBeGreaterThan(30);
    for (const { u, w, h } of subjects) {
      expect(w, `${u.kind} drew an empty box`).toBeGreaterThan(0);
      expect(tilesPerFloor(u.width, floorsOf(u), w, h), `${u.kind} in the gallery`).toBeCloseTo(TILES_PER_FLOOR, 6);
    }
    // The full-lot metro is the documented exception, so it is checked only for
    // being drawn at all rather than dropped from the catalog.
    const fullLot = rec.units.filter((r) => r.u.id === 1 && isFullLot(r.u));
    expect(fullLot.length).toBe(1);
    expect(fullLot[0].h).toBeGreaterThan(0);
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

  it("magnifies by a whole multiple of the world scale on both pages", () => {
    // A page may draw larger than the world so the art is legible, but only by a
    // whole multiple, or its pixels land between the world's. Individual cells
    // sit BELOW that ceiling whenever a footprint had to shrink to fit (uniform
    // shrinking keeps the aspect, which the assertions above already prove), so
    // what has to be a whole number is each page's ceiling: the magnification
    // its roomiest cell reaches.
    const magOf = (tiles: number, w: number): number => w / (tiles * TILE);
    const previewCeiling = Math.max(...rec.rooms.map((r) => magOf(r.u.width, r.w)));
    const galleryCeiling = Math.max(
      ...rec.units.filter((r) => r.u.id === 1 && !isFullLot(r.u)).map((r) => magOf(r.u.width, r.w)),
    );
    for (const [page, ceiling] of [["preview.html", previewCeiling], ["gallery.html", galleryCeiling]] as const) {
      expect(ceiling, `${page} never reaches its own magnification`).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(ceiling), `${page} magnifies by ${ceiling}x`).toBe(true);
    }
  });
});
