import { describe, it, expect } from "vitest";
import { fitLayout } from "@verticopolis/components/render/overviewMap/geometry";
import { MAP_TAP_SLOP_CSS, MAP_TOUCH_TARGET_CSS } from "@verticopolis/components/windows/overviewMapInput";
import type { MapViewId } from "@verticopolis/components/render/overviewMap/views";
import { mapFloorAt, mapPick, tapReach, type MapPickRoom, type MapPickShaft } from "./overviewMapPick";

// One map pixel per tile and ten per floor: tiles 0 to 100, floor lines 0 to
// 10, so floor f fills map y (10 - f) * 10 to (11 - f) * 10.
const layout = fitLayout({ leftTile: 0, width: 100, topLine: 10, bottomLine: 0 }, 100, 100);
const floorY = (floor: number) => (10 - floor) * 10 + 5;

const office: MapPickRoom = { id: 1, kind: "office", floor: 5, x: 10, width: 9 };
const condo: MapPickRoom = { id: 2, kind: "condo", floor: 5, x: 30, width: 16 };
const suite: MapPickRoom = { id: 3, kind: "hotelSuite", floor: 7, x: 10, width: 4 };
const lobby: MapPickRoom = { id: 4, kind: "lobby", floor: 1, x: 0, width: 100 };
const elevator: MapPickShaft = { id: 10, kind: "elevatorStandard", x: 50, width: 4, bottom: 1, top: 6 };
const stairs: MapPickShaft = { id: 11, kind: "stairs", x: 20, width: 8, bottom: 4, top: 5 };
const service: MapPickShaft = { id: 12, kind: "elevatorService", x: 88, width: 4, bottom: 1, top: 9 };

function pick(view: MapViewId, x: number, y: number, reach = 3) {
  return mapPick({
    view,
    layout,
    x,
    y,
    reach,
    rooms: [office, condo, suite, lobby],
    shafts: [elevator, stairs, service],
    floorsOf: (kind) => (kind === "condo" ? 3 : 1),
  });
}

describe("mapPick: rooms", () => {
  it("opens the room under the tap on every view but Edit and Traffic", () => {
    for (const view of ["eval", "pricing", "hotel", "occupancy"] as const)
      expect(pick(view, 14, floorY(5))).toEqual({ type: "unit", id: 1, kind: "office" });
    expect(pick("edit", 14, floorY(5))).toBeNull();
  });

  it("finds a room by every story it covers", () => {
    expect(pick("eval", 35, floorY(7))).toEqual({ type: "unit", id: 2, kind: "condo" });
  });

  it("takes the nearest room within reach of a tap that misses them all", () => {
    expect(pick("eval", 21, floorY(5))).toEqual({ type: "unit", id: 1, kind: "office" });
    expect(pick("eval", 28, floorY(5))).toEqual({ type: "unit", id: 2, kind: "condo" });
    expect(pick("eval", 24, floorY(5))).toBeNull();
    expect(pick("eval", 24, floorY(5), 6)).toEqual({ type: "unit", id: 1, kind: "office" });
  });

  it("never opens the lobby or a floor, which have no card", () => {
    expect(pick("eval", 70, floorY(1))).toBeNull();
  });

  it("opens nothing for a point that is not a number", () => {
    expect(pick("eval", Number.NaN, floorY(5))).toBeNull();
    expect(pick("traffic", 52, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("mapPick: Traffic", () => {
  it("opens the shaft serving the tapped floor nearest the tap, at any distance", () => {
    expect(pick("traffic", 90, floorY(2))).toEqual({ type: "transport", id: 10, kind: "elevatorStandard" });
    expect(pick("traffic", 22, floorY(5))).toEqual({ type: "transport", id: 11, kind: "stairs" });
    expect(pick("traffic", 45, floorY(5))).toEqual({ type: "transport", id: 10, kind: "elevatorStandard" });
  });

  it("opens no room, never a service elevator, and nothing on a floor no passenger shaft serves", () => {
    expect(pick("traffic", 14, floorY(7))).toBeNull();
    expect(pick("traffic", 89, floorY(8))).toBeNull();
  });
});

describe("mapPick: Traffic and skipped stops", () => {
  // An express from floor 1 to 9 that stops only at 1 and 9, standing right
  // under the tap, and a standard elevator far across the floor.
  const express: MapPickShaft = {
    id: 20,
    kind: "elevatorExpress",
    x: 40,
    width: 4,
    bottom: 1,
    top: 9,
    skipFloors: [2, 3, 4, 5, 6, 7, 8],
  };
  const far: MapPickShaft = { id: 21, kind: "elevatorStandard", x: 90, width: 4, bottom: 1, top: 9 };
  const pickShafts = (shafts: MapPickShaft[], floor: number) =>
    mapPick({ view: "traffic", layout, x: 41, y: floorY(floor), reach: 3, rooms: [], shafts, floorsOf: () => 1 });

  it("passes over a shaft that skips the tapped floor for one that stops there", () => {
    expect(pickShafts([express, far], 5)).toEqual({ type: "transport", id: 21, kind: "elevatorStandard" });
    expect(pickShafts([express, far], 9)).toEqual({ type: "transport", id: 20, kind: "elevatorExpress" });
  });

  it("opens nothing when the only shaft on the floor skips it", () => {
    expect(pickShafts([express], 5)).toBeNull();
  });
});

describe("mapFloorAt and tapReach", () => {
  it("reads the floor a map y falls on", () => {
    expect(mapFloorAt(layout, (10 - 5) * 10 + 0.5)).toBe(5);
    expect(mapFloorAt(layout, (10 - 5) * 10 + 9.5)).toBe(5);
  });

  it("gives a finger more reach than a mouse, in map pixels", () => {
    expect(tapReach("touch", 2)).toBe(MAP_TOUCH_TARGET_CSS);
    expect(tapReach("mouse", 2)).toBe(MAP_TAP_SLOP_CSS * 2);
    expect(tapReach("pen", 1)).toBe(MAP_TAP_SLOP_CSS);
  });
});
