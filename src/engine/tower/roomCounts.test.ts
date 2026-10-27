import { describe, it, expect } from "vitest";
import { Simulation } from "../Simulation";
import { Housekeeping, INFEST_DAYS } from "../economy/housekeeping";
import { markRoom } from "./rooms";
import type { FacilityKind, Unit, UnitState } from "../types";
import { walkedStats } from "../../tests/fixtures/walkedStats";

/**
 * The engine's rarer writes of a field the HUD's kept room counts read, each
 * driven once after the counts are kept and held to the walk over every unit.
 * The seeded run (`roomCounts.integration.test.ts`) reaches the common ones;
 * these are the paths 30 game hours on the fixtures do not reach, or reach
 * only where the write leaves every count where it was.
 */

/** A Classic tower: a lobby, two floors over it and stairs, with `rooms`. */
function tower(rooms: [FacilityKind, number, number][]): { sim: Simulation; placed: Unit[] } {
  const sim = Simulation.newGame(3, "classic");
  sim.money = 1e9;
  const t = sim.tower;
  for (let x = 150; x < 220; x++) expect(t.place("lobby", 1, x).ok).toBe(true);
  for (const floor of [2, 3]) for (let x = 150; x < 220; x++) expect(t.place("floor", floor, x).ok).toBe(true);
  expect(t.placeTransport("stairs", 150, 1, 2)).toMatchObject({ ok: true });
  const placed = rooms.map(([kind, floor, x]) => {
    const r = t.place(kind, floor, x);
    expect(r.ok, `${kind}: ${r.reason}`).toBe(true);
    return t.getUnit(r.unitId!)!;
  });
  return { sim, placed };
}

/** Set fields the way a test may (marking the room, as the engine does). */
function set(sim: Simulation, u: Unit, fields: Partial<Unit> & { state?: UnitState }): void {
  Object.assign(u, fields);
  markRoom(sim.tower, u);
}

describe("the engine's rarer room writes reach the HUD's kept counts", () => {
  it("vacate, the No Rate toggle, a reprice, the No Rate batch and a batch reprice", () => {
    const { sim, placed } = tower([["office", 2, 160], ["office", 2, 170], ["office", 2, 180]]);
    for (const u of placed) set(sim, u, { state: "occupied" });
    const start = sim.stats(); // the counts are kept from here
    expect(start).toMatchObject({ occupiedOffices: 3, vacant: 0 });
    const [a, b] = placed;
    sim.vacate(a, "access");
    expect(sim.stats()).toMatchObject({ ...walkedStats(sim), occupiedOffices: 2, vacant: 1, vacantNoRate: 0 });
    expect(sim.setNoRate(a.id)).toBe(true);
    expect(sim.stats()).toMatchObject({ ...walkedStats(sim), vacantNoRate: 1 });
    expect(sim.priceUnit(a, 20_000)).not.toBeNull();
    expect(sim.stats()).toMatchObject({ ...walkedStats(sim), vacantNoRate: 0 });
    sim.vacate(b, "access");
    expect(sim.applyRentBatch("office", "noRate")).not.toBeNull();
    expect(sim.stats()).toMatchObject({ ...walkedStats(sim), vacant: 2, vacantNoRate: 2 });
    // A batch reprice returns every No Rate office to the market.
    expect(sim.applyRentBatch("office", "default")).not.toBeNull();
    expect(sim.stats()).toMatchObject({ ...walkedStats(sim), vacant: 2, vacantNoRate: 0 });
  });

  it("the morning infestation and the cockroaches' spread", () => {
    const { sim, placed } = tower([["hotelSingle", 2, 160], ["hotelSingle", 2, 164], ["hotelSingle", 2, 168]]);
    const [neglected, asleep, infested] = placed;
    expect(asleep.x).toBe(neglected.x + neglected.width);
    set(sim, neglected, { state: "dirty", dirtyDays: INFEST_DAYS - 1 });
    set(sim, asleep, { state: "asleep" });
    set(sim, infested, { state: "infested" });
    const start = sim.stats();
    expect(start).toMatchObject({ occupiedHotel: 1, dirty: 1 });
    new Housekeeping(sim).beforeCheckout();
    // The neglected room turns infested, and both infested rooms spread to
    // the guest room between them.
    expect([neglected.state, asleep.state]).toEqual(["infested", "dirty"]);
    expect(sim.stats()).toMatchObject({ ...walkedStats(sim), occupiedHotel: 0, dirty: 1 });
  });

  it("a venue left empty with customers inside opening again for the hour", () => {
    const { sim, placed } = tower([["shop", 2, 160]]);
    const [shop] = placed;
    set(sim, shop, { state: "occupied", customersIn: 2 });
    const start = sim.stats();
    sim.vacate(shop, "access"); // the customers inside stay counted on the venue
    expect(shop.customersIn).toBe(2);
    expect(sim.stats()).toMatchObject({ ...walkedStats(sim), population: start.population - 2 });
    sim.clock.minutes = 12 * 60; // midday: open
    sim.economy.collectTrafficIncome();
    expect(shop.state).toBe("occupied");
    expect(sim.stats()).toMatchObject({ ...walkedStats(sim), population: start.population });
  });
});
