import { describe, expect, it, vi } from "vitest";
import type { FireResponseView } from "../../simport/view";
import { FLOOR } from "../scale";
import { STAFF_LOOK } from "../pixelSprites/people";
import {
  HELICOPTER_APPROACH_FLOORS,
  HELICOPTER_APPROACH_TILES,
  HELICOPTER_HOVER_FLOORS,
  helicopterPlace,
  renderFireResponse,
  roofOverFire,
} from "./towerFireResponse";

vi.mock("../../catalog/towerCatalog", () => ({ towerCatalog: () => ({ rules: { shadedLook: false } }) }));

/** A fire in the room at tiles 170 to 178 on floor 6, a guard who climbed
 *  from floor 2 and stands at tile 174, and the helicopter called at 100. */
function answer(o: Partial<FireResponseView> = {}): FireResponseView {
  return {
    floor: 6,
    x: 170,
    width: 8,
    guards: [{ floor: 6, left: 160, right: 174, from: 2, route: [[2, 160], [6, 160]], start: 0, arrive: 8, done: 15 }],
    helicopter: { called: 100, arrive: 130, sprayEnd: 150, leave: 165 },
    out: false,
    seq: 3,
    ...o,
  };
}

describe("the Fire Rescue helicopter's flight", () => {
  const hoverX = 174;
  const hoverFloor = 6 + HELICOPTER_HOVER_FLOORS;

  it("is nowhere before it was called and after it has gone", () => {
    expect(helicopterPlace(answer(), 99)).toBeNull();
    expect(helicopterPlace(answer(), 165)).toBeNull();
    expect(helicopterPlace(answer({ helicopter: null }), 120)).toBeNull();
  });

  it("flies in from the right and down to hover over the room the fire started in", () => {
    expect(helicopterPlace(answer(), 100)).toEqual({ x: hoverX + HELICOPTER_APPROACH_TILES, floor: hoverFloor + HELICOPTER_APPROACH_FLOORS, spraying: false });
    expect(helicopterPlace(answer(), 115)).toEqual({ x: hoverX + HELICOPTER_APPROACH_TILES / 2, floor: hoverFloor + HELICOPTER_APPROACH_FLOORS / 2, spraying: false });
  });

  it("hovers a floor clear of the roof when the fire is near the top", () => {
    expect(helicopterPlace(answer(), 140, 12)).toEqual({ x: hoverX, floor: 13, spraying: true });
    expect(helicopterPlace(answer(), 140, 7)).toEqual({ x: hoverX, floor: hoverFloor, spraying: true });
  });

  it("sprays from the minute it lands until it stops, then flies off to the left", () => {
    expect(helicopterPlace(answer(), 130)).toEqual({ x: hoverX, floor: hoverFloor, spraying: true });
    expect(helicopterPlace(answer(), 149)).toEqual({ x: hoverX, floor: hoverFloor, spraying: true });
    const leaving = helicopterPlace(answer(), 157.5);
    expect(leaving?.spraying).toBe(false);
    expect(leaving?.x).toBeCloseTo(hoverX - HELICOPTER_APPROACH_TILES / 2);
  });
});

describe("drawing the answer to a fire", () => {
  /** A context that records each fillRect's fill style and each stroke. */
  function recordingCtx() {
    const fills: string[] = [];
    let strokes = 0;
    let style = "";
    const noop = (): void => {};
    const ctx = new Proxy(
      { fillRect: () => fills.push(style), stroke: () => strokes++ },
      {
        get: (t: Record<string, unknown>, k: string) => {
          if (k in t) return t[k];
          return k === "fillStyle" ? style : noop;
        },
        set: (_t, k: string, v: unknown) => {
          if (k === "fillStyle") style = String(v);
          return true;
        },
      },
    ) as unknown as CanvasRenderingContext2D;
    return { ctx, fills, strokes: () => strokes };
  }

  function engine(fire: FireResponseView | null, minutes: number) {
    return {
      cam: { zoom: 1 },
      d: { anim: 0 },
      reducedMotion: true,
      sim: { fireResponse: fire, clock: { minutes }, tower: { revision: 1, units: [] } },
      worldToScreenX: (tile: number) => tile * 10,
      worldToScreenY: (floor: number) => 300 - floor * FLOOR,
    } as unknown as Parameters<typeof renderFireResponse>[0];
  }

  it("draws nothing while nobody answers a fire", () => {
    const r = recordingCtx();
    renderFireResponse(engine(null, 0), r.ctx);
    expect(r.fills).toEqual([]);
  });

  it("draws each guard in the security uniform, and the helicopter spraying once it lands", () => {
    const r = recordingCtx();
    renderFireResponse(engine(answer(), 140), r.ctx);
    expect(r.fills).toContain(STAFF_LOOK.security.top);
    expect(r.fills).toContain("#b51f1f");
    expect(r.strokes()).toBeGreaterThan(0);
  });

  it("draws no spray while the helicopter is still flying in", () => {
    const r = recordingCtx();
    renderFireResponse(engine(answer({ guards: [] }), 110), r.ctx);
    expect(r.fills).toContain("#b51f1f");
    expect(r.strokes()).toBe(0);
  });

  it("reads the roof over the room once per answer and tower revision", () => {
    let reads = 0;
    const rooms = [
      { floor: 6, x: 170, width: 8 },
      { floor: 12, x: 160, width: 30 },
      { floor: 20, x: 200, width: 9 },
    ];
    const tower = {
      revision: 7,
      get units() {
        reads++;
        return rooms;
      },
    };
    const e = { sim: { tower } } as unknown as Parameters<typeof roofOverFire>[0];
    const fire = answer({ seq: 41 });
    expect(roofOverFire(e, fire)).toBe(12);
    expect(roofOverFire(e, fire)).toBe(12);
    expect(reads).toBe(1);
    tower.revision = 8;
    rooms.push({ floor: 15, x: 174, width: 1 });
    expect(roofOverFire(e, fire)).toBe(15);
    expect(reads).toBe(2);
  });
});
