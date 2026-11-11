import { describe, it, expect, afterEach, vi } from "vitest";
import type { HeatmapMode } from "../shared/engineTypes";
import type { FacilityKind } from "../shared/types";
import { SKY_HEADROOM_FLOORS } from "../render/cameraBounds";
import { extentFloors, fitLayout, mapExtent } from "../render/overviewMap/geometry";
import type { HeatCellView } from "../render/overviewMap/heatView";
import type { MapPaintContext, PatternSource } from "../render/overviewMap/paint";
import type { MapViewId } from "../render/overviewMap/views";
import { MINUTES_PER_GAME_HOUR, OverviewMapViews, type MapViewRoom } from "./overviewMapViews";
import { disposeRigs, pickView, rig } from "./overviewMapWindow.fixture";

const EXTENT = mapExtent({ lotWidth: 375, minFloor: -9, maxFloor: 100 }, SKY_HEADROOM_FLOORS);
const layout = fitLayout(EXTENT, 375, extentFloors(EXTENT) * 5);
const other = fitLayout(EXTENT, 375, extentFloors(EXTENT) * 4);

const cell = (floor: number, severity: number): HeatCellView => ({ floor, minX: 10, maxX: 40, severity });

/** The Traffic and Occupancy views over a fake engine and an injected clock,
 *  mounted in a window as the game builds them. */
function onView(view: MapViewId) {
  const clock = { minutes: 7 * 60, gesture: 0 };
  const engine = {
    cells: { congestion: [cell(1, 0), cell(2, 0.5), cell(3, 0.9)], occupancy: [cell(2, 0)] } as Record<string, HeatCellView[]>,
    tower: 1,
    meal: 1,
  };
  const heat = {
    cells: vi.fn((mode: HeatmapMode) => engine.cells[mode] ?? []),
    towerRevision: () => engine.tower,
    mealRevision: () => engine.meal,
  };
  const rooms: ReadonlyArray<MapViewRoom> = [];
  const v = new OverviewMapViews({
    rooms: () => rooms,
    roomById: () => undefined,
    minutes: () => clock.minutes,
    floorsOf: (_kind: FacilityKind) => 1,
    heat,
    gesture: () => clock.gesture,
  });
  const r = rig({ views: v });
  pickView(view);
  return { v, r, clock, engine, heat };
}

function fakeCtx(): MapPaintContext & { fills: number[] } {
  const fills: number[] = [];
  return { fills, fillStyle: "", fillRect: () => fills.push(1), clearRect: () => {} };
}
const plain: PatternSource = { get: (fill) => fill };
const legendOf = (view: MapViewId) => document.querySelector(`.overview-map-legend[data-view="${view}"]`) as HTMLElement;

afterEach(() => disposeRigs());

describe("the Traffic and Occupancy views", () => {
  it("read the engine's congestion once when chosen, paint each floor and count the floors", () => {
    const { v, heat } = onView("traffic");
    expect(v.due(layout, false)).toBe(true);
    expect(heat.cells).toHaveBeenCalledTimes(1);
    expect(heat.cells).toHaveBeenLastCalledWith("congestion");
    const ctx = fakeCtx();
    expect(v.paintOver(ctx, plain)).toBe(3);
    expect(legendOf("traffic").hidden).toBe(false);
    expect(legendOf("occupancy").hidden).toBe(true);
    expect(legendOf("traffic").textContent).toBe("Clear: 1Busy: 1Jammed: 1");
    for (let i = 0; i < 20; i++) expect(v.due(layout, false)).toBe(false);
    expect(heat.cells).toHaveBeenCalledTimes(1);
  });

  it("read again on a new game hour, and repaint only when a band moved", () => {
    const { v, heat, clock, engine } = onView("traffic");
    v.due(layout, false);
    clock.minutes += MINUTES_PER_GAME_HOUR;
    expect(v.due(layout, false)).toBe(false);
    expect(heat.cells).toHaveBeenCalledTimes(2);
    engine.cells.congestion = [cell(1, 0.8), cell(2, 0.5), cell(3, 0.9)];
    clock.minutes += MINUTES_PER_GAME_HOUR;
    expect(v.due(layout, false)).toBe(true);
    expect(legendOf("traffic").textContent).toBe("Clear: 0Busy: 1Jammed: 2");
  });

  it("read again when the tower's revision moves, and on Traffic when the meal overlay's does", () => {
    const { v, heat, engine, pick } = { ...onView("traffic"), pick: pickView };
    v.due(layout, false);
    engine.tower++;
    v.due(layout, false);
    expect(heat.cells).toHaveBeenCalledTimes(2);
    engine.meal++;
    v.due(layout, false);
    expect(heat.cells).toHaveBeenCalledTimes(3);
    pick("occupancy");
    v.due(layout, false);
    expect(heat.cells).toHaveBeenCalledTimes(4);
    expect(heat.cells).toHaveBeenLastCalledWith("occupancy");
    engine.meal++;
    expect(v.due(layout, false)).toBe(false);
    expect(heat.cells).toHaveBeenCalledTimes(4);
  });

  it("read again when the tower is touched (a swap can repeat the revision and hour), repainting only on a change", () => {
    const { v, heat, engine } = onView("occupancy");
    v.due(layout, false);
    v.towerTouched();
    expect(v.due(layout, false)).toBe(false);
    expect(heat.cells).toHaveBeenCalledTimes(2);
    engine.cells.occupancy = [cell(2, 0.9)];
    v.towerTouched();
    expect(v.due(layout, false)).toBe(true);
    expect(heat.cells).toHaveBeenCalledTimes(3);
    expect(legendOf("occupancy").textContent).toBe("Mostly full: 0Half full: 0Mostly empty: 1");
  });

  it("hold a read the tower's revision asks for during an editing drag until the drag ends", () => {
    const { v, heat, engine, clock } = onView("occupancy");
    v.due(layout, false);
    clock.gesture = 4;
    engine.tower++;
    v.due(layout, false);
    engine.tower++;
    v.due(layout, false);
    expect(heat.cells).toHaveBeenCalledTimes(1);
    clock.gesture = 0;
    v.due(layout, false);
    expect(heat.cells).toHaveBeenCalledTimes(2);
    v.due(layout, false);
    expect(heat.cells).toHaveBeenCalledTimes(2);
  });

  it("place the floors again on a new layout, without a read", () => {
    const { v, heat } = onView("occupancy");
    v.due(layout, false);
    expect(v.due(other, false)).toBe(true);
    expect(heat.cells).toHaveBeenCalledTimes(1);
    expect(legendOf("occupancy").textContent).toBe("Mostly full: 1Half full: 0Mostly empty: 0");
  });

  it("let go of the cells when the window closes, and read again when it reopens", () => {
    const { v, r, heat } = onView("traffic");
    v.due(layout, false);
    r.win.setOpen(false, false);
    expect(legendOf("traffic").textContent).toBe("Clear: 0Busy: 0Jammed: 0");
    r.win.setOpen(true, false);
    v.due(layout, false);
    expect(heat.cells.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("keep the old keys when a read throws, so the next frame reads again", () => {
    const { v, heat } = onView("traffic");
    heat.cells.mockImplementationOnce(() => {
      throw new Error("trap");
    });
    expect(() => v.due(layout, false)).toThrow("trap");
    expect(v.due(layout, false)).toBe(true);
    expect(heat.cells).toHaveBeenCalledTimes(2);
  });

  it("paint nothing without a heat source", () => {
    const v = new OverviewMapViews({ rooms: () => [], roomById: () => undefined, minutes: () => 0, floorsOf: () => 1 });
    rig({ views: v });
    pickView("traffic");
    expect(v.due(layout, false)).toBe(true);
    expect(v.paintOver(fakeCtx(), plain)).toBe(0);
  });
});
