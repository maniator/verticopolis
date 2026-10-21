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
    expect(rooms.length).toBeGreaterThan(800);
    expect(rooms.every((u) => u.state === "asleep")).toBe(true);
    expect(crews).toHaveLength(24);
  });

  it("splits the staff network: some hotel floors have no crew in reach", () => {
    const reach = (floor: number) => crews.some((c) => sim.tower.staffConnected(c.floor, floor));
    const reached = rooms.filter((u) => reach(u.floor)).length;
    expect(reached).toBeGreaterThan(rooms.length / 3);
    expect(reached).toBeLessThan(rooms.length * 0.8);
  });

  it("has a wing whose rooms are on a crewed story but out of every crew's route", () => {
    const wing = rooms.filter((u) => u.x >= 270);
    expect(wing.length).toBeGreaterThan(100);
    const crew = crews.find((c) => c.floor > 2)!;
    const room = wing.find((u) => u.floor !== crew.floor)!;
    // The story says yes, the route says no.
    expect(sim.tower.staffConnected(crew.floor, room.floor)).toBe(true);
    const sent = Simulation.deserialize(sim.serialize()).spawnStaffTrip(crew.floor, room.floor, room.x + room.width / 2, room.id, 8, crew.x + crew.width / 2);
    expect(sent).toBe("no-route");
    const main = rooms.find((u) => u.x < 270 && u.floor === room.floor)!;
    expect(Simulation.deserialize(sim.serialize()).spawnStaffTrip(crew.floor, main.floor, main.x + main.width / 2, main.id, 8, crew.x + crew.width / 2)).toBe("sent");
  });

  it("makes hundreds of rooms dirty at the morning checkout and leaves the unreachable ones dirty", () => {
    const day = Simulation.deserialize(sim.serialize());
    let peak = 0;
    for (let i = 0; i < 720; i++) {
      day.tick(2);
      peak = Math.max(peak, day.tower.units.filter((u) => u.state === "dirty").length);
    }
    const left = day.tower.units.filter((u) => isHotelKind(u.kind) && u.state === "dirty").length;
    expect(peak).toBeGreaterThan(500);
    expect(left).toBeGreaterThan(100);
  });

  it("is deterministic: the same save text on every build", () => {
    expect(JSON.stringify(buildHotelTower(spec).serialize())).toBe(JSON.stringify(sim.serialize()));
  });
});
