import { describe, it, expect } from "vitest";
import { DEFAULT_MAP_VIEW, MAP_VIEWS, mapViewEntry } from "./views";

describe("the map's views", () => {
  it("lists the original's four in its order, then Traffic and Occupancy, Edit first as the default", () => {
    expect(DEFAULT_MAP_VIEW).toBe("edit");
    const order = ["edit", "eval", "pricing", "hotel", "traffic", "occupancy"];
    expect(MAP_VIEWS.map((v) => v.id)).toEqual(order);
    expect(MAP_VIEWS.map((v) => v.label)).toEqual(["Edit", "Eval", "Pricing", "Hotel", "Traffic", "Occupancy"]);
  });

  it("finds a view's entry, and none for a view the list lacks", () => {
    expect(mapViewEntry("pricing")?.label).toBe("Pricing");
    expect(mapViewEntry("hotel", [MAP_VIEWS[0]])).toBeUndefined();
  });
});
