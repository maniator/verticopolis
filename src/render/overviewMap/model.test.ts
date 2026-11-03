import { describe, it, expect } from "vitest";
import { SKY_HEADROOM_FLOORS } from "../cameraBounds";
import { FLOOR, TILE } from "../scale";
import { OverviewMapModel, type MapFrameInput, type MapViewInput } from "./model";
import { MODERN_BAND_FLOORS } from "./extent";

const WORLD = { lotWidth: 375, minFloor: -9, maxFloor: 100 };

function view(highestFloor = 20, over: Partial<MapViewInput> = {}): MapViewInput {
  return {
    structure: [{ kind: "floor", floor: 1, x: 100, width: 1, count: 50 }],
    rooms: [{ kind: "office", floor: 2, x: 110, width: 9 }],
    tower: { lowestFloor: 1, highestFloor, transports: [{ kind: "elevatorExpress", x: 120, width: 4, bottom: 1, top: highestFloor }] },
    ...over,
  };
}

function input(v: MapViewInput, over: Partial<MapFrameInput> = {}): MapFrameInput {
  return { view: v, world: WORLD, theme: "modern", skyFloors: SKY_HEADROOM_FLOORS, boxWidth: 150, boxHeight: 300, classicShaftLine: 1, floorsOf: () => 1, ...over };
}

const cam = (line = 10) => ({ posX: 187 * TILE, posY: -line * FLOOR, zoom: 1, viewWidth: 1000, viewHeight: 14 * FLOOR });

describe("OverviewMapModel.sync", () => {
  it("builds on the first sync and not again for the same view", () => {
    const m = new OverviewMapModel();
    const v = view();
    expect(m.sync(input(v))).toBe(true);
    expect(m.marks.length).toBe(3);
    expect(m.sync(input(v))).toBe(false);
  });

  it("does not rebuild when a new tower object keeps the same arrays", () => {
    const m = new OverviewMapModel();
    const v = view();
    m.sync(input(v));
    // The model never reads a revision: only the arrays' identity counts.
    expect(m.sync(input({ ...v, tower: { ...v.tower } }))).toBe(false);
  });

  it("does not rebuild on every sync for a box that is not a number", () => {
    const m = new OverviewMapModel();
    const v = view();
    expect(m.sync(input(v, { boxWidth: NaN, boxHeight: NaN }))).toBe(true);
    expect(m.sync(input(v, { boxWidth: NaN, boxHeight: NaN }))).toBe(false);
    // NaN reads as the 1 px box `fitLayout` gives it, the same as 0.
    expect(m.sync(input(v, { boxWidth: 0, boxHeight: -1 }))).toBe(false);
  });

  it("keeps the layout, and so the camera placement, across a tower edit", () => {
    const m = new OverviewMapModel();
    const v = view();
    m.sync(input(v));
    const layout = m.layout;
    m.syncCamera(cam());
    expect(m.sync(input({ ...v, rooms: [...v.rooms] }))).toBe(true);
    expect(m.layout).toBe(layout);
    expect(m.placement).not.toBeNull();
    // The rebuild hands the placement back once, so a window that repaints the
    // rectangle with the tower has it, then the camera check holds again.
    expect(m.syncCamera(cam())).not.toBeNull();
    expect(m.syncCamera(cam())).toBeNull();
  });

  it("gives the placement again after a theme switch that keeps the layout", () => {
    const m = new OverviewMapModel();
    const full = view(100, { tower: { lowestFloor: -9, highestFloor: 100, transports: [] } });
    m.sync(input(full));
    m.syncCamera(cam());
    expect(m.sync(input(full, { theme: "classic" }))).toBe(true);
    expect(m.syncCamera(cam())).not.toBeNull();
  });

  it("clears the placement when the layout changes, until the camera is synced again", () => {
    const m = new OverviewMapModel();
    const v = view();
    m.sync(input(v));
    m.syncCamera(cam());
    m.sync(input(v, { boxHeight: 200 }));
    expect(m.placement).toBeNull();
    expect(m.syncCamera(cam())).not.toBeNull();
  });

  it("rebuilds when rooms, structure or transports are new arrays", () => {
    const m = new OverviewMapModel();
    const v = view();
    m.sync(input(v));
    expect(m.sync(input({ ...v, rooms: [...v.rooms] }))).toBe(true);
    const w = view();
    m.sync(input(w));
    expect(m.sync(input({ ...w, structure: [...w.structure] }))).toBe(true);
    const x = view();
    m.sync(input(x));
    expect(m.sync(input({ ...x, tower: { ...x.tower, transports: [...x.tower.transports] } }))).toBe(true);
  });

  it("rebuilds on a theme or box change", () => {
    const m = new OverviewMapModel();
    const v = view();
    m.sync(input(v));
    expect(m.sync(input(v, { theme: "classic" }))).toBe(true);
    expect(m.sync(input(v, { theme: "classic", boxWidth: 400 }))).toBe(true);
    expect(m.sync(input(v, { theme: "classic", boxWidth: 400 }))).toBe(false);
  });

  it("rebuilds in Modern only when the built top crosses a band, even with the same arrays", () => {
    const m = new OverviewMapModel();
    // Pick a top one floor under a band edge, so one more floor stays inside the band.
    const bandEdge = 6 * MODERN_BAND_FLOORS;
    const top = bandEdge - SKY_HEADROOM_FLOORS - 1;
    const v = view(top);
    m.sync(input(v));
    expect(m.layout!.extent.topLine).toBe(bandEdge);
    expect(m.sync(input({ ...v, tower: { ...v.tower, highestFloor: top + 1 } }))).toBe(false);
    expect(m.sync(input({ ...v, tower: { ...v.tower, highestFloor: top + 2 } }))).toBe(true);
    expect(m.layout!.extent.topLine).toBe(bandEdge + MODERN_BAND_FLOORS);
  });

  it("never rescales Classic as the tower grows", () => {
    const m = new OverviewMapModel();
    const v = view(5);
    m.sync(input(v, { theme: "classic" }));
    const layout = m.layout;
    expect(m.sync(input({ ...v, tower: { ...v.tower, highestFloor: 90 } }, { theme: "classic" }))).toBe(false);
    expect(m.layout).toBe(layout);
  });

  it("draws Classic shafts as lines of the asked width and Modern shafts as blocks", () => {
    const m = new OverviewMapModel();
    const v = view();
    const classic = (classicShaftLine: number) => input(v, { theme: "classic", boxWidth: 375 * 2, classicShaftLine });
    m.sync(classic(2));
    const shaft = m.marks.find((k) => k.layer === "transport")!;
    expect(shaft.rect.w).toBe(2);
    m.sync(input(v, { boxWidth: 375 * 2, classicShaftLine: 2 }));
    expect(m.marks.find((k) => k.layer === "transport")!.rect.w).toBe(8);
    // A new line width on the same Classic layout rebuilds, and draws that width.
    m.sync(classic(2));
    expect(m.sync(classic(3))).toBe(true);
    expect(m.marks.find((k) => k.layer === "transport")!.rect.w).toBe(3);
    // A width that rounds the same does not.
    expect(m.sync(classic(3.2))).toBe(false);
  });
});

describe("OverviewMapModel.syncCamera", () => {
  it("is null before the first sync", () => {
    expect(new OverviewMapModel().syncCamera(cam())).toBeNull();
  });

  it("gives a placement on the first call and null while the camera has not moved", () => {
    const m = new OverviewMapModel();
    m.sync(input(view()));
    expect(m.syncCamera(cam())).not.toBeNull();
    expect(m.syncCamera(cam())).toBeNull();
  });

  it("gives a new placement after a pan, a zoom, a resize or a new layout", () => {
    const m = new OverviewMapModel();
    const v = view();
    m.sync(input(v));
    m.syncCamera(cam());
    expect(m.syncCamera(cam(11))).not.toBeNull();
    expect(m.syncCamera({ ...cam(11), zoom: 2 })).not.toBeNull();
    expect(m.syncCamera({ ...cam(11), zoom: 2, viewWidth: 500 })).not.toBeNull();
    const same = { ...cam(11), zoom: 2, viewWidth: 500 };
    expect(m.syncCamera(same)).toBeNull();
    m.sync(input(v, { boxHeight: 200 }));
    expect(m.syncCamera(same)).not.toBeNull();
  });
});

describe("OverviewMapModel.reset", () => {
  it("rebuilds on the next sync and gives the placement again, for cleared canvases", () => {
    const m = new OverviewMapModel();
    const v = view();
    m.sync(input(v));
    expect(m.syncCamera(cam())).not.toBeNull();
    expect(m.syncCamera(cam())).toBeNull();
    m.reset();
    expect(m.layout).toBeNull();
    expect(m.placement).toBeNull();
    expect(m.syncCamera(cam())).toBeNull();
    expect(m.sync(input(v))).toBe(true);
    expect(m.syncCamera(cam())).not.toBeNull();
  });
});
