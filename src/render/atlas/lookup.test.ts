import { describe, expect, it } from "vitest";
import { rand } from "../sprites/common";
import { lookupRoom, type LiveScene } from "./lookup";

const DAY: LiveScene = { hour: 12, lit: false, parkingUse: 0, recycleFill: 0, dead: false };

describe("lookupRoom", () => {
  it("maps fire and construction to their loops", () => {
    expect(lookupRoom({ kind: "office", state: "fire", occupants: 0, id: 1 }, DAY, 0)).toEqual({ animation: "fire/office" });
    expect(lookupRoom({ kind: "cinema", state: "construction", occupants: 0, id: 1 }, DAY, 2)).toEqual({ animation: "construction/cinema" });
  });
  it("splits presence and counts the visible occupants", () => {
    expect(lookupRoom({ kind: "office", state: "occupied", occupants: 6, outForMeal: 2, id: 1 }, DAY, 1)).toEqual({
      frame: "room/office/occupied/-/w9/unlit/always/any/v1/home",
      chains: { occupants: 4 },
      overlays: [],
    });
    expect(lookupRoom({ kind: "office", state: "occupied", occupants: 2, outForMeal: 5, id: 1 }, DAY, 0)).toMatchObject({ chains: { occupants: 0 } });
    expect(lookupRoom({ kind: "office", state: "empty", occupants: 0, id: 1 }, DAY, 0)).toMatchObject({ frame: expect.stringMatching(/\/away$/) });
  });
  it("reads business hours, the condo's late night and the subtype", () => {
    const shop = lookupRoom({ kind: "shop", state: "occupied", subtype: "Bank", occupants: 1, id: 1 }, { ...DAY, hour: 22, lit: true }, 3);
    expect(shop).toMatchObject({ frame: expect.stringContaining("room/shop/occupied/Bank/") });
    expect(shop).toMatchObject({ frame: expect.stringContaining("/lit/closed/any/v3/") });
    expect(lookupRoom({ kind: "condo", state: "occupied", occupants: 3, id: 1 }, { ...DAY, hour: 23 }, 0)).toMatchObject({ frame: expect.stringContaining("/always/late/") });
    expect(lookupRoom({ kind: "condo", state: "occupied", occupants: 3, id: 1 }, { ...DAY, hour: 6 }, 0)).toMatchObject({ frame: expect.stringContaining("/always/notlate/") });
  });
  it("garage: the dead mark wins, else a car when the roll passes", () => {
    const full = { ...DAY, parkingUse: 1 };
    expect(lookupRoom({ kind: "parking", state: "occupied", occupants: 0, id: 12 }, { ...full, dead: true }, 0)).toMatchObject({ overlays: ["dead"] });
    expect(lookupRoom({ kind: "parking", state: "occupied", occupants: 0, id: 12 }, full, 0)).toMatchObject({ overlays: ["car5"] });
    expect(lookupRoom({ kind: "parking", state: "occupied", occupants: 0, id: 12 }, DAY, 0)).toMatchObject({ overlays: [] });
    const half = { ...DAY, parkingUse: rand(12 * 31) - 1e-9 };
    expect(lookupRoom({ kind: "parking", state: "occupied", occupants: 0, id: 12 }, half, 0)).toMatchObject({ overlays: [] });
  });
  it("recycling: the fill in eighths, clamped", () => {
    expect(lookupRoom({ kind: "recycling", state: "occupied", occupants: 0, id: 1 }, { ...DAY, recycleFill: 0.49 }, 0)).toMatchObject({ chains: { fill: 4 } });
    expect(lookupRoom({ kind: "recycling", state: "occupied", occupants: 0, id: 1 }, { ...DAY, recycleFill: 3 }, 0)).toMatchObject({ chains: { fill: 8 } });
  });
  it("occupant-free kinds carry no presence", () => {
    expect(lookupRoom({ kind: "security", state: "occupied", occupants: 5, id: 1 }, DAY, 0)).toEqual({
      frame: "room/security/occupied/-/w8/unlit/always/any/v0",
      chains: {},
      overlays: [],
    });
  });
});
