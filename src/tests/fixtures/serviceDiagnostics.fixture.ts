import { Simulation } from "../../engine/Simulation";
import type { GameMode, Unit, UnitState } from "../../shared/types";
import { mustBuild, placeUnit } from "./towerFixtures";

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
    sim.tower.place("floor", 2, x);
    if (sim.tower.structureKindAt(1, x) !== "lobby")
      throw new Error(`retail fixture lobby missing at ${x}`);
    if (sim.tower.structureKindAt(2, x) !== "floor")
      throw new Error(`retail fixture floor missing at ${x}`);
  }
  // Commercial rooms cannot occupy the ground-floor lobby. An actual
  // elevator makes the floor-2 venues reachable for the demand-map test.
  mustBuild(sim, "elevatorStandard", 153, 1, 2);
  const shop = placeUnit(sim, "shop", 2, 165);
  const fastFood = placeUnit(sim, "fastFood", 2, 200);
  const restaurant = placeUnit(sim, "restaurant", 2, 235);
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

/** One shop among many occupied offices on the same reachable floor: the
 * tower's shoppers outstrip its retail space, the Modern "another venue would
 * still sell" case. The engine calculates the demand; nothing is written in. */
export function underServedRetailFixture(mode: GameMode = "modern") {
  const sim = Simulation.newGame(75, mode);
  sim.money = 1e9;
  sim.star = 5;
  for (let x = 150; x < 275; x++) {
    sim.tower.place("lobby", 1, x);
    for (let floor = 2; floor <= 5; floor++) sim.tower.place("floor", floor, x);
  }
  mustBuild(sim, "elevatorStandard", 153, 1, 5);
  const shop = placeUnit(sim, "shop", 2, 165);
  const offices: Unit[] = [];
  for (let floor = 2; floor <= 5; floor++) {
    for (let i = 0; i < 10; i++) {
      offices.push(placeUnit(sim, "office", floor, 183 + i * 9));
    }
  }
  for (const u of [shop, ...offices]) u.state = "occupied";
  return { sim, shop, offices };
}

/** Shops at three heights over one lobby, plus a sky bar and an office on the
 * far floor: the W3 placement fixture. Floors 2 to 8 are slabs, so a shop on
 * floor 3 is 2 floors from the ground lobby and one on floor 7 is 6 away. */
export function lobbyDistanceFixture(mode: GameMode = "modern") {
  const sim = Simulation.newGame(73, mode);
  sim.money = 1e9;
  sim.star = 5;
  for (let x = 150; x < 275; x++) {
    const lobby = sim.tower.place("lobby", 1, x);
    if (!lobby.ok) throw new Error(`lobby at ${x}: ${lobby.reason}`);
    for (let f = 2; f <= 8; f++) {
      const slab = sim.tower.place("floor", f, x);
      if (!slab.ok) throw new Error(`floor ${f} at ${x}: ${slab.reason}`);
    }
  }
  mustBuild(sim, "elevatorStandard", 153, 1, 8);
  const near = placeUnit(sim, "shop", 3, 165);
  const far = placeUnit(sim, "shop", 7, 165);
  const skyBar = placeUnit(sim, "skyBar", 8, 200);
  const office = placeUnit(sim, "office", 7, 235);
  for (const u of [near, far, skyBar, office]) u.state = "occupied";
  return { sim, near, far, skyBar, office };
}
