import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import type { FacilityKind, UnitState } from "../shared/types";
import { SKY_HEADROOM_FLOORS } from "../render/cameraBounds";
import { extentFloors, fitLayout, mapExtent } from "../render/overviewMap/geometry";
import { HOTEL_VIEW_STYLE } from "../render/overviewMap/hotelView";
import type { MapPaintContext, PatternSource } from "../render/overviewMap/paint";
import { MAP_DOM_ID } from "./overviewMapDom";
import { MAP_PICKER_DOM } from "./overviewMapPicker";
import { gameHour, MINUTES_PER_GAME_HOUR, OverviewMapViews, type MapViewRoom } from "./overviewMapViews";
import { disposeRigs, pickView, rig, rootEl } from "./overviewMapWindow.fixture";

const EXTENT = mapExtent({ lotWidth: 375, minFloor: -9, maxFloor: 100 }, SKY_HEADROOM_FLOORS);
const layout = fitLayout(EXTENT, 375, extentFloors(EXTENT) * 5);

type Room = MapViewRoom & { state: UnitState };
const hotel = (x: number, state: UnitState = "asleep"): Room => ({ id: x, kind: "hotelSingle", floor: 2, x, width: 4, state });

/** A views controller over a fake tower and an injected game clock. */
function views(rooms: Room[] = [hotel(40), hotel(50), { id: 10, kind: "office", floor: 3, x: 10, width: 9, state: "occupied" }]) {
  const clock = { minutes: 7 * 60 };
  const tower = { rooms: rooms as ReadonlyArray<Room> };
  const deps = {
    rooms: vi.fn(() => tower.rooms),
    roomById: (id: number) => tower.rooms.find((r) => r.id === id),
    minutes: vi.fn(() => clock.minutes),
    floorsOf: (_kind: FacilityKind) => 1,
  };
  const v = new OverviewMapViews(deps);
  return { v, deps, clock, tower, rooms };
}

/** A window rig with the views mounted, as the game builds it. */
function mounted(rooms?: Room[]) {
  const made = views(rooms);
  const r = rig({ views: made.v });
  return { ...made, r };
}

function fakeCtx(): MapPaintContext & { fills: unknown[] } {
  const fills: unknown[] = [];
  return { fills, fillStyle: "", fillRect: () => fills.push(1), clearRect: () => {} };
}
const plain: PatternSource = { get: (fill) => fill };

beforeEach(() => vi.restoreAllMocks());
afterEach(() => disposeRigs());

describe("gameHour", () => {
  it("counts whole game hours, and reads a bad clock as one fixed hour", () => {
    expect(MINUTES_PER_GAME_HOUR).toBe(60);
    expect(gameHour(0)).toBe(0);
    expect(gameHour(479)).toBe(7);
    expect(gameHour(480)).toBe(8);
    expect(gameHour(Number.NaN)).toBe(-1);
    expect(gameHour(Number.POSITIVE_INFINITY)).toBe(-1);
  });
});

describe("the map's views in the window", () => {
  it("puts the View dropdown right under the title bar and the legends in the body, hidden", () => {
    mounted();
    const root = rootEl();
    const picker = document.getElementById(MAP_PICKER_DOM.root)!;
    expect(picker.previousElementSibling?.classList.contains("win-title")).toBe(true);
    expect(picker.nextElementSibling?.classList.contains("overview-map-body")).toBe(true);
    const legends = [...root.querySelectorAll<HTMLElement>(".overview-map-body .overview-map-legend")];
    expect(legends.map((l) => l.dataset.view)).toEqual(["eval", "pricing", "hotel", "traffic", "occupancy"]);
    expect(legends.every((l) => l.hidden)).toBe(true);
    expect(document.getElementById(MAP_DOM_ID.summary)).not.toBeNull();
  });

  it("builds no dropdown without the views", () => {
    rig();
    expect(document.getElementById(MAP_PICKER_DOM.root)).toBeNull();
    expect(document.querySelector(".overview-map-legend")).toBeNull();
  });

  it("asks the views on every open frame and never on a closed one", () => {
    const { v, r } = mounted();
    const due = vi.spyOn(v, "due");
    r.win.frame();
    expect(due).toHaveBeenCalledTimes(1);
    r.win.setOpen(false, false);
    r.win.frame();
    expect(due).toHaveBeenCalledTimes(1);
  });

  it("lets Escape on the dropdown close the map, and keeps a build key from the game", () => {
    const { r } = mounted();
    const select = document.getElementById(MAP_PICKER_DOM.select) as HTMLSelectElement;
    select.focus();
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    select.dispatchEvent(new KeyboardEvent("keydown", { key: "b", bubbles: true, cancelable: true }));
    expect(seen).not.toHaveBeenCalled();
    document.removeEventListener("keydown", seen);
    select.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(r.win.isOpen()).toBe(false);
  });

  it("lets a mouse press reach the dropdown, so it opens", () => {
    mounted();
    const select = document.getElementById(MAP_PICKER_DOM.select) as HTMLSelectElement;
    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    select.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(false);
  });
});

describe("the Edit view", () => {
  it("adds nothing to a frame and never reads the rooms or the clock", () => {
    const { v, deps } = mounted();
    expect(v.selected).toBe("edit");
    expect(v.due(layout, false)).toBe(false);
    expect(v.due(layout, true)).toBe(false);
    const ctx = fakeCtx();
    expect(v.paintOver(ctx, plain)).toBe(0);
    expect(ctx.fills).toHaveLength(0);
    expect(deps.rooms).not.toHaveBeenCalled();
    expect(deps.minutes).not.toHaveBeenCalled();
  });
});

describe("the Hotel view's throttle", () => {
  function onHotel() {
    const made = mounted();
    pickView("hotel");
    return made;
  }

  it("repaints once when chosen, then not again within the game hour", () => {
    const { v, rooms, clock } = onHotel();
    expect(v.selected).toBe("hotel");
    expect(v.due(layout, false)).toBe(true);
    expect(v.due(layout, false)).toBe(false);
    rooms[0].state = "dirty";
    clock.minutes = 7 * 60 + 59;
    // The room went dirty, but the hour has not turned.
    expect(v.due(layout, false)).toBe(false);
    clock.minutes = 8 * 60;
    expect(v.due(layout, false)).toBe(true);
    const ctx = fakeCtx();
    // It says how many rooms it painted, so the window draws the shafts over them.
    expect(v.paintOver(ctx, plain)).toBe(1);
    expect(ctx.fills).toHaveLength(1);
    // A new hour with nothing changed repaints nothing.
    clock.minutes = 9 * 60;
    expect(v.due(layout, false)).toBe(false);
  });

  it("reads the rooms' states once per game hour, and walks no rooms in between", () => {
    const { v, deps, clock } = onHotel();
    v.due(layout, false);
    const watch = (v as unknown as { watch: { check(): boolean } }).watch;
    const check = vi.spyOn(watch, "check");
    for (let i = 0; i < 50; i++) v.due(layout, false);
    expect(check).not.toHaveBeenCalled();
    clock.minutes += MINUTES_PER_GAME_HOUR;
    for (let i = 0; i < 50; i++) v.due(layout, false);
    expect(check).toHaveBeenCalledTimes(1);
    expect(deps.minutes).toHaveBeenCalled();
  });

  it("collects its rooms again when the draw list rebuilds, the rooms change or the layout does", () => {
    const { v, tower, clock } = onHotel();
    v.due(layout, false);
    expect(v.due(layout, true)).toBe(true);
    tower.rooms = [hotel(40, "dirty")];
    expect(v.due(layout, false)).toBe(true);
    const ctx = fakeCtx();
    v.paintOver(ctx, plain);
    expect(ctx.fills).toHaveLength(1);
    expect(v.due(fitLayout(EXTENT, 200, 288), false)).toBe(true);
    // A clock that is not a number never reads as a new hour every frame.
    clock.minutes = Number.NaN;
    v.due(layout, true);
    expect(v.due(layout, false)).toBe(false);
  });

  it("shows the legend with the rooms counted, and hides it on the Edit view", () => {
    const { v, rooms, clock } = onHotel();
    const legend = document.querySelector('.overview-map-legend[data-view="hotel"]') as HTMLElement;
    expect(legend.hidden).toBe(false);
    rooms[0].state = "dirty";
    rooms[1].state = "infested";
    v.due(layout, false);
    expect(legend.textContent).toBe("Dirty: 1Infested: 1");
    const swatches = [...legend.querySelectorAll<HTMLElement>(".overview-map-swatch")];
    expect(swatches.map((s) => s.dataset.pattern)).toEqual([HOTEL_VIEW_STYLE.dirty.pattern, HOTEL_VIEW_STYLE.infested.pattern]);
    rooms[1].state = "empty";
    clock.minutes += MINUTES_PER_GAME_HOUR;
    v.due(layout, false);
    expect(legend.textContent).toBe("Dirty: 1Infested: 0");
    pickView("edit");
    expect(legend.hidden).toBe(true);
    // Back on Edit, one repaint drops the red, and the hotel rooms are let go.
    expect(v.due(layout, false)).toBe(true);
    expect(v.due(layout, false)).toBe(false);
  });

  it("lets the hotel rooms go when the window closes, and collects them again on reopen", () => {
    const { v, r } = onHotel();
    v.due(layout, false);
    const held = v as unknown as { watchRooms: unknown; watch: { size: number } };
    expect(held.watch.size).toBe(2);
    r.win.setOpen(false, false);
    expect(held.watchRooms).toBeNull();
    expect(held.watch.size).toBe(0);
    r.win.setOpen(true, false);
    expect(held.watch.size).toBe(2);
  });
});
