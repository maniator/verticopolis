import { Simulation } from "../../engine/Simulation";
import type { GameMode, Unit, UnitState } from "../../engine/types";
import { placeUnit } from "./towerFixtures";

/**
 * One deterministic service-diagnostics tower shared by the reference engine,
 * real Rust/WASM tests and inspector presentation tests. Assert every placed
 * room instead of assuming a build succeeded. Do not depend on random saves.
 */
export interface ServiceDiagnosticsFixture {
  readonly sim: Simulation;
  readonly hotel: Unit;
  readonly housekeeping: Unit;
  readonly office: Unit;
  readonly ramp: Unit;
  readonly connectedParking: Unit;
  readonly disconnectedParking: Unit;
}

export function serviceDiagnosticsFixture(mode: GameMode = "modern"): ServiceDiagnosticsFixture {
  const sim = Simulation.newGame(7, mode);
  sim.money = 1e9;
  sim.star = 3;
  for (let x = 150; x < 275; x++) {
    sim.tower.place("lobby", 1, x);
    sim.tower.place("floor", 2, x);
    sim.tower.place("floor", 0, x);
  }
  const office = placeUnit(sim, "office", 2, 160);
  const hotel = placeUnit(sim, "hotelSingle", 2, 185);
  const housekeeping = placeUnit(sim, "housekeeping", 2, 215);
  const ramp = placeUnit(sim, "parkingRamp", 0, 225);
  const connectedParking = placeUnit(sim, "parking", 0, 241);
  const disconnectedParking = placeUnit(sim, "parking", 0, 260);
  const rooms = [office, hotel, housekeeping, ramp, connectedParking, disconnectedParking];
  rooms.forEach((room) => { room.state = "occupied"; });
  if (!sim.tower.functionalParkingSet().has(connectedParking.id))
    throw new Error("service fixture parking stall did not connect to its ramp");
  if (sim.tower.functionalParkingSet().has(disconnectedParking.id))
    throw new Error("service fixture's disconnected parking stall unexpectedly connected");
  return { sim, office, hotel, housekeeping, ramp, connectedParking, disconnectedParking };
}

/** Intentional test mutation; applies equally when saved and reloaded by Rust. */
export function setFixtureHotelState(fixture: ServiceDiagnosticsFixture, state: UnitState): void {
  fixture.hotel.state = state;
  fixture.hotel.dirtyDays = state === "dirty" ? 1 : 0;
}


/** Commercial-state fixture shared by the WASM differential and browser tests.
 * Ground-level venues share the same reachable lobby segment. No fabricated
 * demand pressure values are written into the engine; it calculates them. */
export function retailServiceFixture(mode: GameMode = "modern") {
  const sim = Simulation.newGame(71, mode);
  sim.money = 1e9;
  sim.star = 5;
  for (let x = 150; x < 275; x++) {
    sim.tower.place("lobby", 1, x);
    if (sim.tower.structureKindAt(1, x) !== "lobby")
      throw new Error(`retail fixture lobby missing at ${x}`);
  }
  const shop = placeUnit(sim, "shop", 1, 165);
  const fastFood = placeUnit(sim, "fastFood", 1, 200);
  const restaurant = placeUnit(sim, "restaurant", 1, 235);
  for (const u of [shop, fastFood, restaurant]) u.state = "occupied";
  shop.patronageToday = 40;
  shop.patronageYest = 10;
  shop.profitYest = 200;
  fastFood.patronageToday = 3;
  restaurant.patronageToday = 120;
  restaurant.patronageYest = 110;
  restaurant.profitYest = 4800;
  return { sim, shop, fastFood, restaurant };
}
