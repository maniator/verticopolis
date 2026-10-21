import { describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { isHotelKind } from "../../engine/facilities";
import { buildHotelTower } from "./fixtureHotelTower";

const spec = { seed: 21, floors: 62, crews: 24 };

describe("the hotel-heavy tower", () => {
  const sim = buildHotelTower(spec);
  const rooms = sim.tower.units.filter((u) => isHotelKind(u.kind));
  const crews = sim.tower.units.filter((u) => u.kind === "housekeeping");

  it("is a Modern tower with several hundred booked rooms and 24 housekeeping units", () => {
    expect(sim.mode).toBe("modern");
    expect(rooms.length).toBeGreaterThan(500);
    expect(rooms.every((u) => u.state === "asleep")).toBe(true);
    expect(crews).toHaveLength(24);
  });

  it("splits the staff network: some hotel floors have no crew in reach", () => {
    const reach = (floor: number) => crews.some((c) => sim.tower.staffConnected(c.floor, floor));
    const reached = rooms.filter((u) => reach(u.floor)).length;
    expect(reached).toBeGreaterThan(rooms.length / 3);
    expect(reached).toBeLessThan(rooms.length * 0.8);
  });

  it("makes hundreds of rooms dirty at the morning checkout and leaves the unreachable ones dirty", () => {
    const day = Simulation.deserialize(sim.serialize());
    let peak = 0;
    for (let i = 0; i < 720; i++) {
      day.tick(2);
      peak = Math.max(peak, day.tower.units.filter((u) => u.state === "dirty").length);
    }
    const left = day.tower.units.filter((u) => isHotelKind(u.kind) && u.state === "dirty").length;
    expect(peak).toBeGreaterThan(400);
    expect(left).toBeGreaterThan(100);
  });

  it("is deterministic: the same save text on every build", () => {
    expect(JSON.stringify(buildHotelTower(spec).serialize())).toBe(JSON.stringify(sim.serialize()));
  });
});
