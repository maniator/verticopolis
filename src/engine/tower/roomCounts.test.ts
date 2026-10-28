import { describe, it, expect } from "vitest";
import { Simulation } from "../Simulation";
import { Housekeeping, INFEST_DAYS } from "../economy/housekeeping";
import { ALL_KINDS } from "../facilities";
import { COUNTED_FIELDS, markRoom, roomCounts } from "./rooms";
import type { FacilityKind, Unit, UnitState } from "../types";
import { walkedStats } from "../../tests/fixtures/walkedStats";

/**
 * Single writes of a field the HUD's kept room counts read, each driven once
 * after the counts are kept and held to the walk over every unit. The first
 * case issues the rent commands and a vacate one at a time, so a failure names
 * the command; the seeded run (`roomCounts.integration.test.ts`) issues them
 * too, mixed with the steps. The others are the paths 30 game hours on the
 * fixtures do not reach, or reach only where the write leaves every count
 * where it was. The last case holds the counts to reading a room's kind and
 * `COUNTED_FIELDS` only.
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

describe("single room writes reach the HUD's kept counts", () => {
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
    sim.vacate(shop, "access"); // its tally stays on the room, but an empty room counts nobody
    expect(shop.customersIn).toBe(2);
    expect(sim.stats()).toMatchObject({ ...walkedStats(sim), population: start.population - 2 });
    sim.clock.minutes = 12 * 60; // midday: open
    sim.economy.collectTrafficIncome();
    expect(shop.state).toBe("occupied");
    expect(sim.stats()).toMatchObject({ ...walkedStats(sim), population: start.population });
  });
});

describe("the HUD's kept counts read", () => {
  it("a room's kind and the counted fields only, for every kind, state and field combination in both modes", () => {
    const states: UnitState[] = ["construction", "empty", "occupied", "moving_in", "vacating", "asleep", "dirty", "infested", "fire", "gutted"];
    const read = new Set<string>();
    for (const mode of ["classic", "modern"] as const) {
      const sim = Simulation.newGame(3, mode);
      let id = 1;
      // Each of the four flag fields set or not, independently, and the
      // occupants at none or one, so a field read on one branch only (a sold
      // condo with no household, a let office off the market) is reached.
      const combos = Array.from({ length: 32 }, (_, bits) => bits);
      const units = ALL_KINDS.flatMap((kind) =>
        states.flatMap((state) =>
          combos.map((bits) => {
            const fields = {
              id: id++, kind, floor: 2, x: 0, width: 1, state,
              noRate: (bits & 1) !== 0, everOccupied: (bits & 2) !== 0,
              residents: bits & 4 ? 3 : undefined, customersIn: bits & 8 ? 2 : undefined, occupants: bits & 16 ? 1 : 0,
            };
            const note = (key: string | symbol) => read.add(String(key));
            return new Proxy(fields as unknown as Unit, {
              get: (target, key, receiver) => (note(key), Reflect.get(target, key, receiver)),
              has: (target, key) => (note(key), Reflect.has(target, key)),
              getOwnPropertyDescriptor: (target, key) => (note(key), Reflect.getOwnPropertyDescriptor(target, key)),
              ownKeys: (target) => (note("(ownKeys)"), Reflect.ownKeys(target)),
            });
          }),
        ),
      );
      sim.tower.units.splice(0, sim.tower.units.length, ...units);
      roomCounts(sim.tower); // the pass over every room
      for (const u of units) markRoom(sim.tower, u);
      roomCounts(sim.tower); // the recount of every marked room
    }
    const counted: readonly string[] = COUNTED_FIELDS;
    expect([...read].filter((key) => key !== "kind" && !counted.includes(key)), "a field the counts read must be in COUNTED_FIELDS, and every write of it marks").toEqual([]);
  });
});
