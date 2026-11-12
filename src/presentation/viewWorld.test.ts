import { afterEach, describe, expect, it } from "vitest";
import { catalogFor } from "../tests/catalogFixture";
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

  it("refuses a later lot of another width or basement, and keeps the bound world", () => {
    resetViewWorldForTests();
    const world = catalogFor("modern").world;
    bindViewWorld(world);
    expect(() => bindViewWorld({ ...world, lotWidth: world.lotWidth + 1 })).toThrow(/differs from the one the view was built for/);
    expect(() => bindViewWorld({ ...world, minFloor: world.minFloor - 1 })).toThrow(/lowest floor/);
    expect(() => bindViewWorld({ ...world, lotWidth: world.lotWidth - 1, maxFloor: world.maxFloor + 20 }), "a taller top does not excuse a wider lot").toThrow(/differs/);
    expect(viewWorld(), "each refused bind left the original world in place").toEqual({ lotWidth: world.lotWidth, minFloor: world.minFloor, maxFloor: world.maxFloor });
  });

  it("moves to a later world with another top floor, for a taller lot (#1985)", () => {
    resetViewWorldForTests();
    const world = catalogFor("modern").world;
    bindViewWorld(world);
    bindViewWorld({ ...world, maxFloor: world.maxFloor + 20 });
    expect(viewWorld().maxFloor, "the taller tower's top").toBe(world.maxFloor + 20);
    bindViewWorld(world);
    expect(viewWorld().maxFloor, "and back down for a standard tower").toBe(world.maxFloor);
  });
});
