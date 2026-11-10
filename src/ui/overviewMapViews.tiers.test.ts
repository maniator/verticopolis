import { describe, it, expect, afterEach, vi } from "vitest";
import type { FacilityKind } from "../engine/types";
import type { EvalTier, RentTier } from "../simport/roomTiers";
import { SKY_HEADROOM_FLOORS } from "../render/cameraBounds";
import { extentFloors, fitLayout, mapExtent } from "../render/overviewMap/geometry";
import type { MapPaintContext, PatternSource } from "../render/overviewMap/paint";
import { tiersOf } from "../render/overviewMap/tierView.fixture";
import type { MapViewId } from "../render/overviewMap/views";
import { tabId } from "./overviewMapTabs";
import { MINUTES_PER_GAME_HOUR, OverviewMapViews, type MapViewRoom } from "./overviewMapViews";
import { disposeRigs, rig } from "./overviewMapWindow.fixture";

const EXTENT = mapExtent({ lotWidth: 375, minFloor: -9, maxFloor: 100 }, SKY_HEADROOM_FLOORS);
const layout = fitLayout(EXTENT, 375, extentFloors(EXTENT) * 5);

const office = (id: number): MapViewRoom => ({ id, kind: "office", floor: 3, x: id * 10, width: 9, state: "occupied" });

/** The Eval and Pricing views over a fake tower, a fake engine read and an
 *  injected clock and gesture, mounted in a window as the game builds them. */
function onTab(view: MapViewId, rows: Array<[number, EvalTier, RentTier]> = [[1, "excellent", "average"], [2, "terrible", "high"]]) {
  const clock = { minutes: 7 * 60 };
  const tower = { rooms: [office(1), office(2)] as ReadonlyArray<MapViewRoom> };
  const engine = { rows, gesture: 0 };
  // The offices' anchors, as the engine's rows give them.
  const tiers = { read: vi.fn(() => tiersOf(engine.rows, (id) => [3, id * 10])) };
  const v = new OverviewMapViews({
    rooms: () => tower.rooms,
    roomById: (id) => tower.rooms.find((r) => r.id === id),
    minutes: () => clock.minutes,
    floorsOf: (_kind: FacilityKind) => 1,
    tiers,
    gesture: () => engine.gesture,
  });
  const r = rig({ views: v });
  const pick = (id: MapViewId) => (document.getElementById(tabId(id)) as HTMLButtonElement).click();
  pick(view);
  return { v, r, clock, tower, engine, tiers, pick };
}

function fakeCtx(): MapPaintContext & { fills: number[] } {
  const fills: number[] = [];
  return { fills, fillStyle: "", fillRect: () => fills.push(1), clearRect: () => {} };
}
const plain: PatternSource = { get: (fill) => fill };
const legendOf = (view: MapViewId) => document.querySelector(`.overview-map-legend[data-view="${view}"]`) as HTMLElement;

afterEach(() => disposeRigs());

describe("the Eval and Pricing views", () => {
  it("read the engine once when chosen, paint the rated rooms and count them in the legend", () => {
    const { v, tiers } = onTab("eval");
    expect(v.due(layout, false)).toBe(true);
    expect(tiers.read).toHaveBeenCalledTimes(1);
    const ctx = fakeCtx();
    v.paintOver(ctx, plain);
    expect(ctx.fills).toHaveLength(2);
    expect(legendOf("eval").hidden).toBe(false);
    expect(legendOf("hotel").hidden).toBe(true);
    expect(legendOf("eval").textContent).toBe("Excellent: 1Good: 0Terrible: 1");
    // A steady frame reads nothing and repaints nothing.
    for (let i = 0; i < 20; i++) expect(v.due(layout, false)).toBe(false);
    expect(tiers.read).toHaveBeenCalledTimes(1);
  });

  it("switch between Eval and Pricing with one repaint and no read", () => {
    const { v, tiers, pick } = onTab("eval");
    v.due(layout, false);
    pick("pricing");
    expect(v.due(layout, false)).toBe(true);
    expect(tiers.read).toHaveBeenCalledTimes(1);
    expect(legendOf("pricing").hidden).toBe(false);
    expect(legendOf("eval").hidden).toBe(true);
    expect(legendOf("pricing").textContent).toBe("High: 1Average: 1Low: 0Very Low: 0");
  });

  it("read again when the game hour turns, the rooms move or the tower is touched, at most once a frame", () => {
    const { v, tiers, clock, tower, engine } = onTab("pricing");
    v.due(layout, false);
    clock.minutes += MINUTES_PER_GAME_HOUR - 1;
    expect(v.due(layout, false)).toBe(false);
    clock.minutes += 1;
    // The hour's read found the same tiers: no repaint.
    expect(v.due(layout, false)).toBe(false);
    expect(tiers.read).toHaveBeenCalledTimes(2);
    tower.rooms = [office(1)];
    expect(v.due(layout, false)).toBe(true);
    expect(tiers.read).toHaveBeenCalledTimes(3);
    // A touch alone reads on the next frame, and two touches read once.
    v.towerTouched();
    v.towerTouched();
    engine.rows = [[1, "good", "low"]];
    expect(v.due(layout, false)).toBe(true);
    expect(tiers.read).toHaveBeenCalledTimes(4);
    expect(v.due(layout, false)).toBe(false);
    expect(tiers.read).toHaveBeenCalledTimes(4);
    // A read that finds nothing new repaints nothing.
    v.towerTouched();
    expect(v.due(layout, false)).toBe(false);
    expect(tiers.read).toHaveBeenCalledTimes(5);
    // A clock that is not a number never reads as a new hour every frame.
    clock.minutes = Number.NaN;
    v.due(layout, false);
    expect(v.due(layout, false)).toBe(false);
    expect(tiers.read).toHaveBeenCalledTimes(6);
  });

  it("hold a read for rooms moved during a drag until the gesture ends, and place the old rows on the new rooms", () => {
    const { v, tiers, tower, engine } = onTab("eval");
    v.due(layout, false);
    engine.gesture = 4;
    tower.rooms = [office(1)];
    // The removed room's mark goes at once, with no engine read.
    expect(v.due(layout, false)).toBe(true);
    const ctx = fakeCtx();
    v.paintOver(ctx, plain);
    expect(ctx.fills).toHaveLength(1);
    tower.rooms = [office(1), office(3)];
    expect(v.due(layout, false)).toBe(true);
    expect(v.due(layout, false)).toBe(false);
    expect(tiers.read).toHaveBeenCalledTimes(1);
    engine.gesture = 0;
    engine.rows = [[1, "good", "low"], [3, "good", "low"]];
    expect(v.due(layout, false)).toBe(true);
    expect(tiers.read).toHaveBeenCalledTimes(2);
    expect(v.due(layout, false)).toBe(false);
    // A later gesture releases a hold left by one that never closed.
    engine.gesture = 5;
    tower.rooms = [office(1)];
    v.due(layout, false);
    expect(tiers.read).toHaveBeenCalledTimes(2);
    engine.gesture = 6;
    v.due(layout, false);
    expect(tiers.read).toHaveBeenCalledTimes(3);
  });

  it("keep the dirty flag when a read throws, and read again on the next frame", () => {
    const { v, tiers } = onTab("eval");
    tiers.read.mockImplementationOnce(() => {
      throw new Error("engine trapped");
    });
    expect(() => v.due(layout, false)).toThrow("engine trapped");
    expect(v.due(layout, false)).toBe(true);
    expect(tiers.read).toHaveBeenCalledTimes(2);
  });

  it("place the rooms again, with no read, when the layout changes, and not for a rebuild alone", () => {
    const { v, tiers } = onTab("eval");
    v.due(layout, false);
    expect(v.due(layout, true)).toBe(false);
    expect(v.due(fitLayout(EXTENT, 200, 288), false)).toBe(true);
    expect(tiers.read).toHaveBeenCalledTimes(1);
  });

  it("read nothing on another tab or a closed window, and read on the next open or pick", () => {
    const { v, r, tiers, pick } = onTab("eval");
    v.due(layout, false);
    pick("hotel");
    v.towerTouched();
    v.due(layout, false);
    pick("edit");
    v.due(layout, false);
    expect(tiers.read).toHaveBeenCalledTimes(1);
    pick("pricing");
    v.due(layout, false);
    expect(tiers.read).toHaveBeenCalledTimes(2);
    expect(legendOf("pricing").textContent).toBe("High: 1Average: 1Low: 0Very Low: 0");
    r.win.setOpen(false, false);
    // Closed, the legends drop their counts, so a reopen shows no old ones.
    expect(legendOf("pricing").textContent).toBe("High: 0Average: 0Low: 0Very Low: 0");
    v.towerTouched();
    r.win.frame();
    expect(tiers.read).toHaveBeenCalledTimes(2);
    r.win.setOpen(true, false);
    expect(tiers.read).toHaveBeenCalledTimes(3);
  });

  it("paint nothing without a tier reader", () => {
    const v = new OverviewMapViews({ rooms: () => [office(1)], roomById: () => undefined, minutes: () => 0, floorsOf: () => 1 });
    rig({ views: v });
    (document.getElementById(tabId("eval")) as HTMLButtonElement).click();
    expect(v.due(layout, false)).toBe(true);
    const ctx = fakeCtx();
    v.paintOver(ctx, plain);
    expect(ctx.fills).toHaveLength(0);
  });
});
