import { describe, expect, it, vi } from "vitest";
import * as ex from "excalibur";
import { FLOOR, TILE } from "../scale";
import {
  clearPersonFocus,
  drawPersonRing,
  focusPerson,
  focusScreenRect,
  focusSpot,
  focusedPerson,
  notePersonPlace,
  pickPersonAt,
  setFollow,
  stepFollow,
} from "./personFocus";
import type { TowerEngine } from "./TowerEngine";

/** A drawn figure standing with its feet at world (x, y). */
function figure(x: number, y: number, visible = true) {
  return { actor: { pos: ex.vec(x, y), graphics: { isVisible: visible }, isKilled: false }, glide: { x: x / TILE, fy: 3 } };
}

function engine(actors: Array<[number, ReturnType<typeof figure>]>, people: Array<{ id: number; x: number; fy: number }> = []) {
  const e = {
    cam: { pos: ex.vec(0, 0), zoom: 1 },
    crowdActors: new Map(actors),
    sim: { crowd: { people } },
    gesture: null as "pan" | "action" | null,
    moved: 0,
    worldX: (tile: number) => tile * TILE,
    worldYTop: (floor: number) => -floor * FLOOR,
    applyView: vi.fn((v: { tile: number; floor: number; zoom: number }) => (e.cam.pos = ex.vec(v.tile * TILE, -v.floor * FLOOR))),
    // The screen is the world shifted by the camera and scaled by the zoom.
    engine: { worldToScreenCoordinates: (p: ex.Vector) => ex.vec((p.x - e.cam.pos.x) * e.cam.zoom, (p.y - e.cam.pos.y) * e.cam.zoom) },
  };
  return e as typeof e & TowerEngine;
}

describe("pickPersonAt", () => {
  it("picks the figure under the point, nearest first", () => {
    const e = engine([
      [1, figure(100, 0)],
      [2, figure(104, 0)],
    ]);
    expect(pickPersonAt(e, ex.vec(103, -10))).toBe(2);
    expect(pickPersonAt(e, ex.vec(99, -10))).toBe(1);
  });

  it("misses empty space and a rider hidden in a car", () => {
    const e = engine([[1, figure(100, 0, false)]]);
    expect(pickPersonAt(e, ex.vec(100, -10))).toBeNull();
    expect(pickPersonAt(engine([[1, figure(100, 0)]]), ex.vec(300, -10))).toBeNull();
  });
});

describe("the follow", () => {
  it("glides the camera toward the person and keeps the zoom", () => {
    const e = engine([[7, figure(500, 0)]]);
    focusPerson(e, 7);
    stepFollow(e, 16);
    expect(e.applyView).not.toHaveBeenCalled(); // not following yet
    setFollow(e, true);
    stepFollow(e, 500);
    const spot = focusSpot(e)!;
    expect(e.applyView).toHaveBeenCalledTimes(1);
    expect(e.cam.pos.x).toBeGreaterThan(0);
    expect(e.cam.pos.x).toBeLessThan(spot.x);
    expect(e.applyView.mock.lastCall![0].zoom).toBe(1);
    for (let i = 0; i < 20; i++) stepFollow(e, 500);
    expect(e.cam.pos.x).toBeCloseTo(spot.x, 0);
  });

  it("hands the camera back when the player pans", () => {
    const e = engine([[7, figure(500, 0)]]);
    focusPerson(e, 7);
    setFollow(e, true);
    e.gesture = "pan";
    e.moved = 40;
    stepFollow(e, 16);
    expect(e.applyView).not.toHaveBeenCalled();
    expect(focusedPerson(e)?.follow).toBe(false);
  });

  it("hands the camera back when anything else moves it, and keeps it through a zoom", () => {
    const e = engine([[7, figure(500, 0)]]);
    focusPerson(e, 7);
    setFollow(e, true);
    stepFollow(e, 16);
    // A zoom re-centers on the person: the follow holds.
    e.cam.zoom = 2;
    e.cam.pos = ex.vec(e.cam.pos.x + 30, e.cam.pos.y);
    stepFollow(e, 16);
    expect(e.applyView).toHaveBeenCalledTimes(2);
    expect(focusedPerson(e)?.follow).toBe(true);
    // The keyboard cursor nudges the camera one tile: the player has it back.
    e.cam.pos = ex.vec(e.cam.pos.x - TILE, e.cam.pos.y);
    stepFollow(e, 16);
    expect(e.applyView).toHaveBeenCalledTimes(2);
    expect(focusedPerson(e)?.follow).toBe(false);
    // Pressing Follow again starts afresh from wherever the camera is.
    setFollow(e, true);
    stepFollow(e, 16);
    expect(e.applyView).toHaveBeenCalledTimes(3);
    expect(focusedPerson(e)?.follow).toBe(true);
  });

  it("finds a person the renderer culled in the view's people", () => {
    const e = engine([], [{ id: 9, x: 20, fy: 2 }]);
    focusPerson(e, 9);
    expect(focusSpot(e)).toEqual(ex.vec(20 * TILE, -2 * FLOOR + FLOOR - 3));
    clearPersonFocus(e);
    expect(focusSpot(e)).toBeNull();
  });

  it("follows the engine's word to a person the view does not carry", () => {
    const e = engine([]);
    focusPerson(e, 9);
    expect(focusSpot(e)).toBeNull();
    notePersonPlace(e, 30, 5);
    expect(focusSpot(e)).toEqual(ex.vec(30 * TILE, -5 * FLOOR + FLOOR - 3));
    // A fresh pick forgets the last person's place.
    focusPerson(e, 10);
    expect(focusSpot(e)).toBeNull();
  });
});

describe("the ring and the card's anchor", () => {
  /** A canvas context that records the ellipse it is asked to stroke. */
  function ctx() {
    return { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), stroke: vi.fn(), ellipse: vi.fn(), strokeStyle: "", lineWidth: 0 };
  }

  it("draws nothing and anchors nothing with no one picked", () => {
    const e = engine([[7, figure(500, 0)]]);
    const c = ctx();
    drawPersonRing(e, c as unknown as CanvasRenderingContext2D);
    expect(c.stroke).not.toHaveBeenCalled();
    expect(focusScreenRect(e)).toBeNull();
  });

  it("rings the picked figure where the screen shows it, larger when zoomed in", () => {
    const e = engine([[7, figure(500, 0)]]);
    focusPerson(e, 7);
    const c = ctx();
    drawPersonRing(e, c as unknown as CanvasRenderingContext2D);
    expect(c.stroke).toHaveBeenCalledTimes(1);
    const [x, , rx] = c.ellipse.mock.lastCall!;
    expect(x).toBe(focusSpot(e)!.x);
    e.cam.zoom = 4;
    drawPersonRing(e, c as unknown as CanvasRenderingContext2D);
    expect(c.ellipse.mock.lastCall![2]).toBeGreaterThan(rx);
  });

  it("anchors the card above the figure's head, centered on it", () => {
    const e = engine([[7, figure(500, 0)]]);
    focusPerson(e, 7);
    const spot = focusSpot(e)!;
    const r = focusScreenRect(e)!;
    expect(r.x + r.w / 2).toBeCloseTo(spot.x);
    expect(r.y).toBeLessThan(spot.y);
  });
});
