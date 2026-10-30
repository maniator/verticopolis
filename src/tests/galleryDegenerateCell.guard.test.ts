import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { Unit } from "../engine/types";
import type { Transport } from "../engine/types";
import { fakeContext, importRemovingWindowListeners } from "./spriteReviewPageHarness";

/**
 * The gallery derives its column width from its container, which measures zero
 * before layout has run. `fitAtGameScale` answers that with an empty box, but an
 * empty box is not safe to draw: `drawUnit` reaches `drawFloor`, which clamps
 * height to at least 1px, so drawing it paints a stray hairline rather than
 * nothing.
 *
 * The main scale guard stubs a 960px container so the page lays out, which means
 * it cannot see this path at all. This file is the other half: a container that
 * measures zero must draw NOTHING.
 */

const rec = vi.hoisted(() => ({
  units: [] as Array<{ u: Unit; w: number; h: number }>,
  transports: [] as Array<{ t: Transport; w: number; floorH: number }>,
  captions: [] as string[],
}));

vi.mock("../render/pixelSprites", () => ({ drawRoom: () => {} }));
vi.mock("../render/sprites", () => ({
  drawUnit: (_d: unknown, u: Unit, _x: number, _y: number, w: number, h: number) => {
    rec.units.push({ u, w, h });
  },
  drawTransport: (_ctx: unknown, t: Transport, _x: number, _y: number, w: number, floorH: number) => {
    rec.transports.push({ t, w, floorH });
  },
  drawCar: () => {},
}));
vi.mock("../telemetry", () => ({ injectVercelTelemetry: () => {} }));
vi.mock("../analytics", () => ({ trackAppAction: () => {} }));
// The gallery reads the Rust engine's catalog before it draws. This run has no
// engine package, so the read answers with the TypeScript tables' catalog, which
// holds the same kinds; what the page does with it is what these guards watch.
vi.mock("../wasmhost/rustEngine", () => ({ loadWasmEngine: async () => ({}) }));
vi.mock("../dualrun/catalog", async () => {
  const { catalogFor } = await import("../engine/catalog");
  return { readCatalog: (_mod: unknown, mode: "classic" | "modern") => catalogFor(mode) };
});

let priorGetContext: PropertyDescriptor | undefined;
let priorClientWidth: PropertyDescriptor | undefined;
let removeListeners: () => void = () => {};

beforeAll(async () => {
  priorGetContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext");
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    writable: true,
    value: () => fakeContext({ onFillText: (text) => rec.captions.push(text) }),
  });
  // The point of this file: a container that has not laid out yet.
  priorClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 0 });
  vi.stubGlobal("requestAnimationFrame", () => 0);

  const app = document.createElement("div");
  app.id = "app";
  document.body.append(app);

  removeListeners = await importRemovingWindowListeners(() => import("../gallery"));
  // The gallery draws its first frame once the catalog is read.
  await vi.waitFor(() => expect((window as unknown as { galleryReady?: boolean }).galleryReady).toBe(true));
});

afterAll(() => {
  removeListeners();
  if (priorGetContext) Object.defineProperty(HTMLCanvasElement.prototype, "getContext", priorGetContext);
  else Reflect.deleteProperty(HTMLCanvasElement.prototype, "getContext");
  if (priorClientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", priorClientWidth);
  else Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("the gallery draws nothing into a cell that has not laid out", () => {
  it("still ran its frame over every cell (the positive control)", () => {
    // Without this, a page that never reached its cells would pass the two
    // emptiness checks below for the wrong reason. Each cell prints its caption
    // whether or not its sprite drew, so the captions prove draw() was reached.
    expect(rec.captions).toContain("Office (occupied)");
    expect(rec.captions).toContain("Express Elevator");
  });

  it("hands no room box to a painter when the container measures zero", () => {
    // Not "every box is empty": an empty box must never REACH the painter,
    // because the painter clamps it back up to a visible 1px.
    expect(rec.units).toEqual([]);
  });

  it("hands no transport box to a painter either", () => {
    expect(rec.transports).toEqual([]);
  });
});
