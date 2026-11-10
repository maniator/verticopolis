import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { isOverheadKind } from "../../engine/econConfig";
import { GRID } from "../../engine/facilities";

const W = GRID.width;
const C = Math.floor(W / 2);

function layFull(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = C; x < W; x++) sim.tower.place(kind, floor, x);
  for (let x = C - 1; x >= 0; x--) sim.tower.place(kind, floor, x);
}

describe("Economy depth — #4 operating overhead", () => {
  it("isOverheadKind: leasable/commercial pay it; service/structure/transport don't", () => {
    for (const k of ["office", "condo", "hotelSingle", "hotelDouble", "hotelSuite", "fastFood", "restaurant", "shop", "cinema", "partyHall"])
      expect(isOverheadKind(k)).toBe(true);
    for (const k of ["security", "medical", "housekeeping", "recycling", "metro", "lobby", "floor", "stairs", "elevatorStandard", "parking", "parkingRamp"])
      expect(isOverheadKind(k)).toBe(false);
  });

});

describe("Economy depth — #5 blockbuster as a choice", () => {
  function cinemaSim(seed: number): { sim: Simulation; id: number } {
    const sim = Simulation.newGame(seed);
    sim.money = 1e9;
    sim.star = 1;
    layFull(sim, "lobby", 1);
    layFull(sim, "floor", 2);
    layFull(sim, "floor", 3);
    const r = sim.tower.place("cinema", 2, 0);
    return { sim, id: r.unitId! };
  }

  it("setFilmPolicy returns null for a non-cinema", () => {
    const sim = Simulation.newGame(5);
    layFull(sim, "lobby", 1);
    layFull(sim, "floor", 2);
    const r = sim.tower.place("office", 2, 0);
    expect(sim.setFilmPolicy(r.unitId!, "blockbuster")).toBeNull();
  });

  it("filmPolicy round-trips through save/load; absent ⇒ auto; garbage ⇒ coerced", () => {
    const { sim, id } = cinemaSim(6);
    sim.setFilmPolicy(id, "blockbuster");
    const reloaded = Simulation.deserialize(sim.serialize());
    expect(reloaded.tower.units.find((u) => u.id === id)!.filmPolicy).toBe("blockbuster");

    // A cinema left on default has no field; a hand-edited garbage value coerces away.
    const data = sim.serialize();
    const cin = data.units.find((u) => u.id === id)!;
    (cin as { filmPolicy?: unknown }).filmPolicy = "garbage";
    const loaded = Simulation.deserialize(data);
    expect(loaded.tower.units.find((u) => u.id === id)!.filmPolicy).toBeUndefined(); // ⇒ auto
  });
});
