import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { ECON, isOverheadKind } from "../../engine/econConfig";
import { GRID } from "../../engine/facilities";

const W = GRID.width;
const C = Math.floor(W / 2);
const MONTH = 60 * 24 * 31;

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

  it("charges overhead on vacant/unserved space (pure carrying cost)", () => {
    // Operating overhead is a Modern-only "deeper economy" sink (Classic is 0).
    const sim = Simulation.newGame(1, "modern");
    sim.simModel = "v1";
    sim.money = 1e9;
    sim.star = 1; // keep events off
    layFull(sim, "lobby", 1);
    layFull(sim, "floor", 2);
    // 5 empty offices, NO elevator → unserved → they stay vacant (no move-in),
    // no rent (quarterly + occupancy), no cars/services → overhead is the only cost.
    for (let i = 0; i < 5; i++) sim.tower.place("office", 2, i * 9);
    const before = sim.money;
    sim.tick(MONTH); // crosses one month boundary → payMaintenance once
    expect(before - sim.money).toBe(5 * ECON.overheadPerLeasableUnitMonthly);
  });

  it("overhead consumes no RNG — the shared stream is untouched by it (F3)", () => {
    // Two seed-identical sims with no cinema/commercial/events (star 1): nothing
    // in the tick touches sim.rng. The only difference is that A holds overhead-
    // bearing (empty, unserved) offices and B is bare. If overhead consumed RNG,
    // A's stream would diverge; it must not.
    const build = (withOverhead: boolean) => {
      const sim = Simulation.newGame(123);
      sim.simModel = "v1";
      sim.money = 1e9;
      sim.star = 1;
      layFull(sim, "lobby", 1);
      layFull(sim, "floor", 2);
      if (withOverhead) for (let i = 0; i < 10; i++) sim.tower.place("office", 2, i * 9);
      for (let m = 0; m < 3; m++) sim.tick(MONTH); // 3 monthly maintenance runs
      return sim;
    };
    const a = build(true);
    const b = build(false);
    expect(a.rng.next()).toBe(b.rng.next()); // identical stream position → overhead is RNG-free
  });

  it("a unit under construction pays no overhead", () => {
    const sim = Simulation.newGame(2);
    sim.simModel = "v1";
    sim.money = 1e9;
    sim.star = 1;
    layFull(sim, "lobby", 1);
    layFull(sim, "floor", 2);
    const r = sim.tower.place("office", 2, 0);
    sim.tower.units.find((u) => u.id === r.unitId)!.state = "construction";
    const before = sim.money;
    sim.tick(MONTH);
    expect(before - sim.money).toBe(0); // mid-build → no overhead
  });
});

describe("Economy depth — #5 blockbuster as a choice", () => {
  function cinemaSim(seed: number): { sim: Simulation; id: number } {
    const sim = Simulation.newGame(seed);
    sim.simModel = "v1";
    sim.money = 1e9;
    sim.star = 1;
    layFull(sim, "lobby", 1);
    layFull(sim, "floor", 2);
    layFull(sim, "floor", 3);
    const r = sim.tower.place("cinema", 2, 0);
    return { sim, id: r.unitId! };
  }

  it("policy 'feature' never books a blockbuster", () => {
    const { sim, id } = cinemaSim(3);
    expect(sim.setFilmPolicy(id, "feature")).toBe("feature");
    for (let m = 0; m < 12; m++) {
      sim.tick(MONTH);
      expect(sim.isShowingBlockbuster(id)).toBe(false);
    }
  });

  it("policy 'blockbuster' always books one", () => {
    const { sim, id } = cinemaSim(4);
    sim.setFilmPolicy(id, "blockbuster");
    sim.tick(MONTH);
    expect(sim.isShowingBlockbuster(id)).toBe(true);
  });

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
