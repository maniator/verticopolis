import { afterEach, describe, expect, it } from "vitest";
import { catalogFor } from "../engine/catalog";
import { bindViewWorld, resetViewWorldForTests, viewWorld } from "./viewWorld";

describe("the view world (#921)", () => {
  // The test setup binds the Modern world for every test; put it back after
  // each case here so the rest of the file's suite sees it.
  afterEach(() => {
    resetViewWorldForTests();
    bindViewWorld(catalogFor("modern").world);
  });

  it("throws before the first bind, so nothing guesses the lot's size", () => {
    resetViewWorldForTests();
    expect(() => viewWorld()).toThrow(/not bound/);
  });

  it("reads the bound catalog's lot width and floor range", () => {
    resetViewWorldForTests();
    const world = catalogFor("classic").world;
    bindViewWorld(world);
    expect(viewWorld()).toEqual({ lotWidth: world.lotWidth, minFloor: world.minFloor, maxFloor: world.maxFloor });
  });

  it("accepts a second bind that states the same world (both modes, both engines)", () => {
    resetViewWorldForTests();
    bindViewWorld(catalogFor("classic").world);
    expect(() => bindViewWorld(catalogFor("modern").world)).not.toThrow();
  });

  it("refuses a later world that differs from the one the view was built for", () => {
    resetViewWorldForTests();
    const world = catalogFor("modern").world;
    bindViewWorld(world);
    expect(() => bindViewWorld({ ...world, lotWidth: world.lotWidth + 1 })).toThrow(/differs from the one the view was built for/);
    expect(() => bindViewWorld({ ...world, maxFloor: world.maxFloor - 1 })).toThrow(/differs/);
    // The refused bind leaves the original world in place.
    expect(viewWorld().lotWidth).toBe(world.lotWidth);
  });
});
