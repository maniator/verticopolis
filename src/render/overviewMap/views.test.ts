import { describe, it, expect } from "vitest";
import { DEFAULT_MAP_VIEW, MAP_VIEWS, mapViewEntry } from "./views";

describe("the map's views", () => {
  it("lists the original's four in its order, Edit first as the default", () => {
    expect(DEFAULT_MAP_VIEW).toBe("edit");
    const order = ["edit", "eval", "pricing", "hotel"];
    expect(MAP_VIEWS.map((v) => v.id)).toEqual(order);
    expect(MAP_VIEWS.map((v) => v.label)).toEqual(["Edit", "Eval", "Pricing", "Hotel"]);
  });

  it("marks Eval and Pricing coming soon until S8, and only them", () => {
    expect(mapViewEntry("eval")?.comingSoon).toBe("Eval view coming soon");
    expect(mapViewEntry("pricing")?.comingSoon).toBe("Pricing view coming soon");
    expect(mapViewEntry("edit")?.comingSoon).toBeUndefined();
    expect(mapViewEntry("hotel")?.comingSoon).toBeUndefined();
    expect(mapViewEntry("hotel", [MAP_VIEWS[0]])).toBeUndefined();
  });
});
