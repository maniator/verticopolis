import { describe, expect, it } from "vitest";
import { rand } from "../sprites/common";
import { FACILITIES } from "../../engine/facilities";
import { lookupRoom, lookupShaft, type LiveScene, type LiveUnit } from "./lookup";

/** Look up a unit at its catalog width. */
function look(u: Omit<LiveUnit, "width">, s: LiveScene, v: number) {
  return lookupRoom({ ...u, width: FACILITIES[u.kind].width }, s, v);
}

const DAY: LiveScene = { hour: 12, lit: false, parkingUse: 0, recycleFill: 0, dead: false };

describe("lookupRoom", () => {
  it("maps fire and construction to their loops", () => {
    expect(look({ kind: "office", state: "fire", occupants: 0, id: 1 }, DAY, 0)).toEqual({ animation: "fire/office" });
    expect(look({ kind: "cinema", state: "construction", occupants: 0, id: 1 }, DAY, 2)).toEqual({ animation: "construction/cinema" });
  });
  it("splits presence and counts the visible occupants", () => {
    expect(look({ kind: "office", state: "occupied", occupants: 6, outForMeal: 2, id: 1 }, DAY, 1)).toEqual({
      frame: "room/office/occupied/-/w9/unlit/always/any/v1/home",
      chains: { occupants: 4 },
      overlays: [],
    });
    expect(look({ kind: "office", state: "occupied", occupants: 2, outForMeal: 5, id: 1 }, DAY, 0)).toMatchObject({ chains: { occupants: 0 } });
    expect(look({ kind: "office", state: "empty", occupants: 0, id: 1 }, DAY, 0)).toMatchObject({ frame: expect.stringMatching(/\/away$/) });
  });
  it("reads business hours, the condo's late night and the subtype", () => {
    const shop = look({ kind: "shop", state: "occupied", subtype: "Bank", occupants: 1, id: 1 }, { ...DAY, hour: 22, lit: true }, 3);
    expect(shop).toMatchObject({ frame: expect.stringContaining("room/shop/occupied/Bank/") });
    expect(shop).toMatchObject({ frame: expect.stringContaining("/lit/closed/any/v3/") });
    expect(look({ kind: "condo", state: "occupied", occupants: 3, id: 1 }, { ...DAY, hour: 23 }, 0)).toMatchObject({ frame: expect.stringContaining("/always/late/") });
    expect(look({ kind: "condo", state: "occupied", occupants: 3, id: 1 }, { ...DAY, hour: 6 }, 0)).toMatchObject({ frame: expect.stringContaining("/always/notlate/") });
  });
  it("garage: the dead mark wins, else a car when the roll passes", () => {
    const full = { ...DAY, parkingUse: 1 };
    expect(look({ kind: "parking", state: "occupied", occupants: 0, id: 12 }, { ...full, dead: true }, 0)).toMatchObject({ overlays: ["dead"] });
    expect(look({ kind: "parking", state: "occupied", occupants: 0, id: 12 }, full, 0)).toMatchObject({ overlays: ["car5"] });
    expect(look({ kind: "parking", state: "occupied", occupants: 0, id: 12 }, DAY, 0)).toMatchObject({ overlays: [] });
    const half = { ...DAY, parkingUse: rand(12 * 31) - 1e-9 };
    expect(look({ kind: "parking", state: "occupied", occupants: 0, id: 12 }, half, 0)).toMatchObject({ overlays: [] });
  });
  it("recycling: the fill in eighths, clamped", () => {
    expect(look({ kind: "recycling", state: "occupied", occupants: 0, id: 1 }, { ...DAY, recycleFill: 0.49 }, 0)).toMatchObject({ chains: { fill: 4 } });
    expect(look({ kind: "recycling", state: "occupied", occupants: 0, id: 1 }, { ...DAY, recycleFill: 3 }, 0)).toMatchObject({ chains: { fill: 8 } });
  });
  it("reads corrupt or fractional counts the way the art can draw them", () => {
    expect(look({ kind: "office", state: "occupied", occupants: 4.7, outForMeal: 1, id: 1 }, DAY, 0)).toMatchObject({ chains: { occupants: 4 } });
    expect(look({ kind: "office", state: "occupied", occupants: NaN, id: 1 }, DAY, 0)).toMatchObject({ frame: expect.stringMatching(/\/away$/) });
    expect(look({ kind: "parking", state: "occupied", occupants: 0, id: 12 }, { ...DAY, parkingUse: Infinity }, 0)).toMatchObject({ overlays: [] });
    expect(look({ kind: "shop", state: "occupied", subtype: "Nope", occupants: 1, id: 1 }, DAY, 0)).toMatchObject({ frame: expect.stringContaining("room/shop/occupied/-/") });
    expect(look({ kind: "rentalStudio", state: "occupied", occupants: 1, id: 1 }, { ...DAY, hour: 2 }, 0)).toMatchObject({ frame: expect.stringContaining("/always/late/") });
  });
  it("draws a room at an off-catalog width from its catalog frame, stretched (#917)", () => {
    // A TDT import or a legacy save keeps a room's original width.
    const wide = lookupRoom({ kind: "office", state: "occupied", width: 12, occupants: 3, id: 1 }, DAY, 0);
    expect(wide).toEqual({ frame: "room/office/occupied/-/w9/unlit/always/any/v0/home", chains: { occupants: 3 }, overlays: [], stretchTo: 12 });
    expect(lookupRoom({ kind: "condo", state: "fire", width: 10, occupants: 0, id: 1 }, DAY, 0)).toEqual({ animation: "fire/condo", stretchTo: 10 });
    expect(lookupRoom({ kind: "recycling", state: "occupied", width: 3, occupants: 0, id: 1 }, DAY, 0)).toMatchObject({
      frame: expect.stringContaining("/w20/"),
      stretchTo: 3,
    });
    // A catalog-width room carries no stretch; a corrupt width reads as the catalog's.
    expect(look({ kind: "office", state: "occupied", occupants: 1, id: 1 }, DAY, 0)).not.toHaveProperty("stretchTo");
    expect(lookupRoom({ kind: "office", state: "empty", width: NaN, occupants: 0, id: 1 }, DAY, 0)).not.toHaveProperty("stretchTo");
    expect(lookupRoom({ kind: "office", state: "empty", width: 9.2, occupants: 0, id: 1 }, DAY, 0)).not.toHaveProperty("stretchTo");
    expect(lookupRoom({ kind: "office", state: "empty", width: 0, occupants: 0, id: 1 }, DAY, 0)).not.toHaveProperty("stretchTo");
    expect(lookupRoom({ kind: "office", state: "empty", width: -4, occupants: 0, id: 1 }, DAY, 0)).not.toHaveProperty("stretchTo");
    // Overlays and chains survive the stretch.
    expect(lookupRoom({ kind: "parking", state: "occupied", width: 6, occupants: 0, id: 12 }, { ...DAY, dead: true }, 0)).toEqual({
      frame: "room/parking/occupied/-/w4/unlit/always/any/v0",
      chains: {},
      overlays: ["dead"],
      stretchTo: 6,
    });
  });
  it("names a shaft's frames, with the legacy widths baked and any other stretched (#917)", () => {
    expect(lookupShaft("elevatorStandard", 4)).toEqual({ shaft: "shaft/elevatorStandard", car: "car/elevatorStandard" });
    expect(lookupShaft("elevatorStandard", 3)).toEqual({ shaft: "shaft/elevatorStandard/w3", car: "car/elevatorStandard/w3" });
    expect(lookupShaft("stairs", 4)).toEqual({ shaft: "transport/stairs/w4" });
    expect(lookupShaft("stairs", 8)).toEqual({ shaft: "transport/stairs" });
    expect(lookupShaft("elevatorExpress", 2)).toEqual({ shaft: "shaft/elevatorExpress", car: "car/elevatorExpress", stretchTo: 2 });
    expect(lookupShaft("escalator", NaN)).toEqual({ shaft: "transport/escalator" });
  });
  it("occupant-free kinds carry no presence", () => {
    expect(look({ kind: "security", state: "occupied", occupants: 5, id: 1 }, DAY, 0)).toEqual({
      frame: "room/security/occupied/-/w8/unlit/always/any/v0",
      chains: {},
      overlays: [],
    });
  });
});
