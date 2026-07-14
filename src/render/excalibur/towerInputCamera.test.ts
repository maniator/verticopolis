import { describe, it, expect, vi } from "vitest";
import * as ex from "excalibur";
import { GRID } from "../../engine/facilities";
import { FLOOR, TILE } from "../scale";
import {
  MIN_ZOOM,
  MAX_ZOOM,
  pan,
  zoomAt,
  zoomBy,
  ensureVisible,
  center,
  setCamera,
  applyView,
  viewState,
  adoptCamera,
  dynamicMinZoom,
  clampGestureZoom,
  focus,
  pickEntityAt,
} from "./towerInputCamera";

/**
 * Camera, coordinate and picking math for the tower renderer, driven against a
 * minimal fake engine. The screen transforms are the standard centered-camera
 * affine (screen = (world - camPos) * zoom + viewport/2), the exact inverse pair
 * Excalibur applies, so round-trips and the zoom-about-cursor invariant are real
 * numeric properties, not just no-throw. The picking tests assert z-ordering and
 * the transport-over-unit precedence, not merely that a hit was found.
 */

/** A fake TowerEngine carrying just the fields the camera/coord functions read,
 *  plus the same centered-camera transform the real getters funnel through. */

function eng(over: Record<string, any> = {}): any {
  const e: any = {
    cam: { pos: ex.vec(0, 0), zoom: 0.9 },
    viewWidth: 800,
    viewHeight: 600,
    sim: {
      tower: { highestFloor: 40, lowestFloor: 1 },
      clock: { isNight: () => false },
      weather: "clear",
    },
    transportActors: new Map(),
    roomActors: new Map(),
    screenToWorld(sx: number, sy: number) {
      return ex.vec((sx - e.viewWidth / 2) / e.cam.zoom + e.cam.pos.x, (sy - e.viewHeight / 2) / e.cam.zoom + e.cam.pos.y);
    },
    worldToScreenX(tile: number) {
      return (tile * TILE - e.cam.pos.x) * e.cam.zoom + e.viewWidth / 2;
    },
    worldToScreenY(floor: number) {
      return (-floor * FLOOR - e.cam.pos.y) * e.cam.zoom + e.viewHeight / 2;
    },
    screenToTile(sx: number) {
      return Math.floor(e.screenToWorld(sx, e.viewHeight / 2).x / TILE);
    },
    screenToFloor(sy: number) {
      return Math.ceil(-e.screenToWorld(e.viewWidth / 2, sy).y / FLOOR);
    },
    setCamera(t: number, f: number, z: number) {
      setCamera(e, t, f, z);
    },
    ...over,
  };
  return e;
}

describe("setCamera / viewState / applyView are exact inverses on the same device", () => {
  it("setCamera places the camera in grid units and clamps the zoom to the legal range", () => {
    const e = eng();
    setCamera(e, 100, 20, 1.5);
    expect(e.cam.pos.x).toBeCloseTo(100 * TILE, 6);
    expect(e.cam.pos.y).toBeCloseTo(-20 * FLOOR, 6);
    expect(e.cam.zoom).toBe(1.5);
    // A poisoned zoom degrades to MIN_ZOOM (the vertical clamp divides by zoom).
    setCamera(e, 0, 0, Number.NaN);
    expect(e.cam.zoom).toBe(MIN_ZOOM);
    setCamera(e, 0, 0, 999);
    expect(e.cam.zoom).toBe(MAX_ZOOM);
  });

  it("viewState round-trips through applyView within the grid interior", () => {
    const e = eng();
    applyView(e, { tile: 123.5, floor: 42.25, zoom: 1.7 });
    expect(viewState(e)).toEqual({ tile: 123.5, floor: 42.25, zoom: 1.7 });
  });

  it("a zoomless view (a TDT import) keeps the session's current zoom", () => {
    const e = eng();
    e.cam.zoom = 1.4;
    applyView(e, { tile: 50, floor: 10 });
    expect(e.cam.zoom).toBe(1.4);
  });

  it("applyView clamps a foreign over-zoomed view to THIS device's max", () => {
    const e = eng();
    applyView(e, { tile: 100, floor: 20, zoom: 99 });
    expect(e.cam.zoom).toBe(MAX_ZOOM);
  });
});

describe("pan / clamp keep the camera inside the world bounds", () => {
  it("panning left of the lot pins the camera x at 0", () => {
    const e = eng();
    setCamera(e, 100, 20, 1);
    // A large rightward screen drag moves the world left; clamp floors x at 0.
    pan(e, 1e6, 0);
    expect(e.cam.pos.x).toBe(0);
  });

  it("panning right past the lot pins the camera x at the world width", () => {
    const e = eng();
    setCamera(e, 100, 20, 1);
    pan(e, -1e6, 0);
    expect(e.cam.pos.x).toBe(GRID.width * TILE);
  });

  it("a plain drag moves the world opposite the pointer, scaled by zoom", () => {
    const e = eng();
    setCamera(e, 100, 20, 2);
    const x0 = e.cam.pos.x;
    pan(e, 40, 0); // drag right 40 screen px at zoom 2 -> world moves left 20
    expect(e.cam.pos.x).toBeCloseTo(x0 - 20, 6);
  });
});

describe("zoomAt pins the world point under the cursor", () => {
  it("zooming in about a screen point leaves that point's world coords fixed", () => {
    const e = eng();
    setCamera(e, 120, 30, 1); // mid-tower so the clamp doesn't bite
    const sx = 520;
    const sy = 250;
    const before = e.screenToWorld(sx, sy);
    zoomAt(e, 1.6, sx, sy);
    const after = e.screenToWorld(sx, sy);
    expect(after.x).toBeCloseTo(before.x, 4);
    expect(after.y).toBeCloseTo(before.y, 4);
    expect(e.cam.zoom).toBeCloseTo(1.6, 6);
  });

  it("zoomBy about the center honors the tower-aware floor", () => {
    const e = eng();
    setCamera(e, 100, 20, 0.9);
    zoomBy(e, 1e-4); // hard zoom-out request
    expect(e.cam.zoom).toBeCloseTo(dynamicMinZoom(e), 8);
  });
});

describe("dynamicMinZoom / clampGestureZoom (tower-aware floor)", () => {
  it("a deeper tower (basements) has a floor further out than a shallow one", () => {
    const shallow = dynamicMinZoom(eng({ sim: { tower: { highestFloor: 50, lowestFloor: 1 } } }));
    const deep = dynamicMinZoom(eng({ sim: { tower: { highestFloor: 50, lowestFloor: -9 } } }));
    expect(deep).toBeLessThan(shallow);
  });

  it("never forces a zoom-IN when the camera already sits below the floor", () => {
    const e = eng({ sim: { tower: { highestFloor: 5, lowestFloor: 1 } } });
    e.cam.zoom = 0.1;
    const lo = dynamicMinZoom(e);
    expect(lo).toBeGreaterThan(0.1); // precondition: below the floor
    // A pinch-OUT holds; a pinch-IN eases toward the floor honoring the request.
    expect(clampGestureZoom(e, 0.1 * 0.9)).toBeCloseTo(0.1, 10);
    expect(clampGestureZoom(e, 0.12)).toBeCloseTo(0.12, 10);
  });

  it("a non-finite gesture zoom degrades to a finite effective floor", () => {
    expect(Number.isFinite(clampGestureZoom(eng(), Number.NaN))).toBe(true);
  });
});

describe("center / ensureVisible", () => {
  it("center parks the camera over the middle of the built height", () => {
    const e = eng({ sim: { tower: { highestFloor: 60, lowestFloor: 1 } } });
    center(e);
    expect(e.cam.pos.x).toBeCloseTo((GRID.width / 2) * TILE, 6);
    expect(e.cam.pos.y).toBeCloseTo(-(60 / 2) * FLOOR, 6);
  });

  it("ensureVisible pans the minimum amount to bring an off-screen cell into frame", () => {
    const e = eng();
    setCamera(e, 100, 20, 1);
    ensureVisible(e, 160, 20); // far to the right of the current view
    const sx = e.worldToScreenX(160);
    expect(sx).toBeGreaterThanOrEqual(0);
    expect(sx).toBeLessThanOrEqual(e.viewWidth);
  });

  it("ensureVisible leaves an already-visible cell where it is", () => {
    const e = eng();
    setCamera(e, 100, 20, 1);
    const before = { x: e.cam.pos.x, y: e.cam.pos.y };
    ensureVisible(e, 100, 20); // dead center already
    expect(e.cam.pos.x).toBeCloseTo(before.x, 6);
    expect(e.cam.pos.y).toBeCloseTo(before.y, 6);
  });
});

describe("adoptCamera policy", () => {
  it("restores a saved view, centers when none, and leaves the camera alone on keepCamera", () => {
    const applyView = vi.fn();
    const center = vi.fn();
    const e = eng({ applyView, center });
    adoptCamera(e, { tile: 1, floor: 2 });
    expect(applyView).toHaveBeenCalledExactlyOnceWith({ tile: 1, floor: 2 });
    expect(center).not.toHaveBeenCalled();
    adoptCamera(e, null);
    expect(center).toHaveBeenCalledTimes(1);
    applyView.mockClear();
    center.mockClear();
    adoptCamera(e, { tile: 1, floor: 2 }, true);
    expect(applyView).not.toHaveBeenCalled();
    expect(center).not.toHaveBeenCalled();
  });
});

describe("focus resolves the dominant facility in the visible band", () => {
  it("reports the widest visible non-floor kind as dominant", () => {
    const units = [
      { kind: "office", floor: 20, x: 100, width: 10 },
      { kind: "shop", floor: 20, x: 120, width: 30 }, // widest in-band
      { kind: "floor", floor: 20, x: 90, width: 200 }, // floors never win
    ];
    const e = eng({ sim: { tower: { highestFloor: 40, lowestFloor: 1, units }, clock: { isNight: () => false }, weather: "clear" } });
    setCamera(e, 130, 20, 1);
    const f = focus(e);
    expect(f.dominant).toBe("shop");
    expect(f.night).toBe(false);
    expect(f.weather).toBe("clear");
  });

  it("falls back to 'outside' at ground level with nothing in frame", () => {
    const e = eng({ sim: { tower: { highestFloor: 40, lowestFloor: 1, units: [] }, clock: { isNight: () => true }, weather: "rain" } });
    setCamera(e, 100, 0, 1); // centered at the ground/basement line (centerFloor <= 0)
    const f = focus(e);
    expect(f.dominant).toBe("outside");
    expect(f.night).toBe(true);
    expect(f.weather).toBe("rain");
  });

  it("maps the lobby kind through to the 'lobby' focus label", () => {
    const units = [{ kind: "lobby", floor: 15, x: 100, width: 40 }];
    const e = eng({ sim: { tower: { highestFloor: 40, lowestFloor: 1, units }, clock: { isNight: () => false }, weather: "clear" } });
    setCamera(e, 120, 15, 1);
    expect(focus(e).dominant).toBe("lobby");
  });
});

describe("pickEntityAt resolves the top-most collider under a point", () => {
  const world = ex.vec(100, -100);
  const hit = (z: number) => ({ z, contains: () => true });
  const miss = (z: number) => ({ z, contains: () => false });

  it("prefers a transport whose collider contains the point", () => {
    const e = eng({
      transportActors: new Map([[7, hit(1)]]),
      roomActors: new Map([[3, { actor: hit(0) }]]),
      sim: { tower: { highestFloor: 40, lowestFloor: 1, getTransport: () => ({ kind: "elevatorStandard" }), getUnit: () => ({ kind: "office" }), unitAt: () => undefined } },
    });
    expect(pickEntityAt(e, world)).toEqual({ type: "transport", id: 7, kind: "elevatorStandard" });
  });

  it("returns the higher-z of two overlapping room actors", () => {
    const e = eng({
      transportActors: new Map(),
      roomActors: new Map([
        [1, { actor: hit(0) }],
        [2, { actor: hit(5) }],
      ]),
      sim: { tower: { highestFloor: 40, lowestFloor: 1, getTransport: () => undefined, getUnit: () => ({ kind: "office" }), unitAt: () => undefined } },
    });
    expect(pickEntityAt(e, world)!.id).toBe(2);
  });

  it("falls back to a floor/lobby tile via unitAt when no actor contains the point", () => {
    const e = eng({
      transportActors: new Map([[7, miss(1)]]),
      roomActors: new Map([[3, { actor: miss(0) }]]),
      sim: { tower: { highestFloor: 40, lowestFloor: 1, getTransport: () => undefined, getUnit: () => undefined, unitAt: () => ({ id: 99, kind: "lobby" }) } },
    });
    expect(pickEntityAt(e, world)).toEqual({ type: "unit", id: 99, kind: "lobby" });
  });

  it("returns null when nothing is under the point and the tile is empty", () => {
    const e = eng({
      transportActors: new Map(),
      roomActors: new Map(),
      sim: { tower: { highestFloor: 40, lowestFloor: 1, getTransport: () => undefined, getUnit: () => undefined, unitAt: () => undefined } },
    });
    expect(pickEntityAt(e, ex.vec(1, -1))).toBeNull();
  });
});
