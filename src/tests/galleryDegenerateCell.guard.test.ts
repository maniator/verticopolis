import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { Unit } from "../engine/types";
import type { Transport } from "../engine/types";

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

let priorGetContext: PropertyDescriptor | undefined;
let priorClientWidth: PropertyDescriptor | undefined;

beforeAll(async () => {
  priorGetContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext");
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    writable: true,
    value: () => fakeContext(),
  });
  // The point of this file: a container that has not laid out yet.
  priorClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 0 });
  vi.stubGlobal("requestAnimationFrame", () => 0);

  const app = document.createElement("div");
  app.id = "app";
  document.body.append(app);

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

describe("the gallery draws nothing into a cell that has not laid out", () => {
  it("hands no room box to a painter when the container measures zero", () => {
    // Not "every box is empty": an empty box must never REACH the painter,
    // because the painter clamps it back up to a visible 1px.
    expect(rec.units).toEqual([]);
  });

  it("hands no transport box to a painter either", () => {
    expect(rec.transports).toEqual([]);
  });
});
