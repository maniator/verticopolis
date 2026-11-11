import type { GameMode, SerializedGame, Unit } from "../../shared/types";

/**
 * Deterministic service-diagnostics towers, shared by the Rust/WASM
 * integration suite and the browser specs. Each builder asserts every room it
 * places instead of assuming a build succeeded, and depends on no random save.
 *
 * Each builder is SELF-CONTAINED (no module-scope references, which is why
 * the room helper repeats in each): the browser specs run its source on the
 * page's own engine (`e2e/helpers.ts` → `buildInPage`), and the integration
 * suite runs it on a port kit draft. Both hand it `start`, which opens a new
 * tower on the Rust engine through the tooling tower's shape.
 */

/** The tooling tower's shape a builder drives (`src/game/toolingTower.ts`). */
export interface FixtureTower {
  money: number;
  star: number;
  readonly clock: { minutes: number };
  readonly tower: {
    place(kind: string, floor: number, x: number): { ok: boolean; reason?: string; unitId?: number };
    placeTransport(kind: string, x: number, bottom: number, top: number): { ok: boolean; reason?: string; transportId?: number };
    getUnit(id: number): unknown;
    structureKindAt(floor: number, x: number): string | undefined;
    setCars(id: number, cars: number): boolean;
    isFloorServed(floor: number): boolean;
  };
  serialize(): SerializedGame;
}

/** Opens a new tower on the Rust engine. */
export type StartTower = (seed: number, mode: GameMode) => FixtureTower;

/** A builder: a tower and the rooms a test reads by name. */
export type FixtureBuilder<T> = (start: StartTower, mode: GameMode) => { sim: FixtureTower } & T;

export interface ServiceDiagnosticsRooms {
  readonly hotel: Unit;
  readonly housekeeping: Unit;
  readonly office: Unit;
  readonly ramp: Unit;
  readonly connectedParking: Unit;
  readonly disconnectedParking: Unit;
}

/** A hotel room, its housekeeping station, an office, and a parking ramp with
 *  one stall beside it and one past a gap, which no ramp reaches. */
export const serviceDiagnosticsFixture: FixtureBuilder<ServiceDiagnosticsRooms> = (start, mode) => {
  const sim = start(7, mode);
  sim.money = 1e9;
  sim.star = 3;
  const room = (kind: string, floor: number, x: number): Unit => {
    const r = sim.tower.place(kind, floor, x);
    if (!r.ok || r.unitId === undefined) throw new Error(`place ${kind} at ${floor},${x}: ${r.reason ?? "no reason"}`);
    const u = sim.tower.getUnit(r.unitId) as Unit | undefined;
    if (!u) throw new Error(`place ${kind} at ${floor},${x}: unit ${r.unitId} not found`);
    return u;
  };
  for (let x = 150; x < 275; x++) {
    sim.tower.place("lobby", 1, x);
    sim.tower.place("floor", 2, x);
    sim.tower.place("floor", 0, x);
  }
  const office = room("office", 2, 160);
  const hotel = room("hotelSingle", 2, 185);
  const housekeeping = room("housekeeping", 2, 215);
  const ramp = room("parkingRamp", 0, 225);
  const connectedParking = room("parking", 0, 241);
  const disconnectedParking = room("parking", 0, 260);
  for (const u of [office, hotel, housekeeping, ramp, connectedParking, disconnectedParking]) u.state = "occupied";
  return { sim, office, hotel, housekeeping, ramp, connectedParking, disconnectedParking };
};

/** `save` with the hotel room of {@link serviceDiagnosticsFixture} put in
 *  `state` (a dirty room is a day into it), as a save edit. */
export function withHotelState(save: SerializedGame, hotelId: number, state: "dirty" | "infested"): SerializedGame {
  const edited = structuredClone(save);
  const hotel = edited.units.find((u) => u.id === hotelId);
  if (!hotel) throw new Error(`the save has no hotel room ${hotelId}`);
  hotel.state = state;
  hotel.dirtyDays = state === "dirty" ? 1 : 0;
  return edited;
}

/** A shop, a fast food and a restaurant on one reachable floor, with the
 *  takings each tier reads from. No demand is written in: the engine works it
 *  out. Commercial rooms cannot stand in the ground lobby, so an elevator
 *  serves floor 2. */
export const retailServiceFixture: FixtureBuilder<{ readonly shop: Unit; readonly fastFood: Unit; readonly restaurant: Unit }> = (start, mode) => {
  const sim = start(71, mode);
  sim.money = 1e9;
  sim.star = 5;
  const room = (kind: string, floor: number, x: number): Unit => {
    const r = sim.tower.place(kind, floor, x);
    if (!r.ok || r.unitId === undefined) throw new Error(`place ${kind} at ${floor},${x}: ${r.reason ?? "no reason"}`);
    const u = sim.tower.getUnit(r.unitId) as Unit | undefined;
    if (!u) throw new Error(`place ${kind} at ${floor},${x}: unit ${r.unitId} not found`);
    return u;
  };
  for (let x = 150; x < 275; x++) {
    sim.tower.place("lobby", 1, x);
    sim.tower.place("floor", 2, x);
    if (sim.tower.structureKindAt(1, x) !== "lobby") throw new Error(`retail fixture lobby missing at ${x}`);
    if (sim.tower.structureKindAt(2, x) !== "floor") throw new Error(`retail fixture floor missing at ${x}`);
  }
  const lift = sim.tower.placeTransport("elevatorStandard", 153, 1, 2);
  if (!lift.ok) throw new Error(`retail fixture elevator: ${lift.reason ?? "no reason"}`);
  const shop = room("shop", 2, 165);
  const fastFood = room("fastFood", 2, 200);
  const restaurant = room("restaurant", 2, 235);
  for (const u of [shop, fastFood, restaurant]) u.state = "occupied";
  shop.patronageToday = 40;
  shop.patronageYest = 10;
  shop.profitYest = 200;
  fastFood.patronageToday = 3;
  restaurant.patronageToday = 120;
  restaurant.patronageYest = 110;
  restaurant.profitYest = 4800;
  return { sim, shop, fastFood, restaurant };
};

/** One shop among forty occupied offices on four reachable floors: the
 *  tower's shoppers outstrip its retail space, Modern's "another venue would
 *  still sell" case. The engine works out the demand. */
export const underServedRetailFixture: FixtureBuilder<{ readonly shop: Unit; readonly offices: readonly Unit[] }> = (start, mode) => {
  const sim = start(75, mode);
  sim.money = 1e9;
  sim.star = 5;
  const room = (kind: string, floor: number, x: number): Unit => {
    const r = sim.tower.place(kind, floor, x);
    if (!r.ok || r.unitId === undefined) throw new Error(`place ${kind} at ${floor},${x}: ${r.reason ?? "no reason"}`);
    const u = sim.tower.getUnit(r.unitId) as Unit | undefined;
    if (!u) throw new Error(`place ${kind} at ${floor},${x}: unit ${r.unitId} not found`);
    return u;
  };
  for (let x = 150; x < 275; x++) {
    sim.tower.place("lobby", 1, x);
    for (let floor = 2; floor <= 5; floor++) sim.tower.place("floor", floor, x);
  }
  const lift = sim.tower.placeTransport("elevatorStandard", 153, 1, 5);
  if (!lift.ok) throw new Error(`under-served fixture elevator: ${lift.reason ?? "no reason"}`);
  const shop = room("shop", 2, 165);
  const offices: Unit[] = [];
  for (let floor = 2; floor <= 5; floor++) {
    for (let i = 0; i < 10; i++) offices.push(room("office", floor, 183 + i * 9));
  }
  for (const u of [shop, ...offices]) u.state = "occupied";
  return { sim, shop, offices };
};

/** Shops at two heights over one lobby, plus a sky bar and an office on the
 *  far floors. Floors 2 to 8 are slabs, so a shop on floor 3 is 2 floors from
 *  the ground lobby and one on floor 7 is 6 away. */
export const lobbyDistanceFixture: FixtureBuilder<{ readonly near: Unit; readonly far: Unit; readonly skyBar: Unit; readonly office: Unit }> = (start, mode) => {
  const sim = start(73, mode);
  sim.money = 1e9;
  sim.star = 5;
  const room = (kind: string, floor: number, x: number): Unit => {
    const r = sim.tower.place(kind, floor, x);
    if (!r.ok || r.unitId === undefined) throw new Error(`place ${kind} at ${floor},${x}: ${r.reason ?? "no reason"}`);
    const u = sim.tower.getUnit(r.unitId) as Unit | undefined;
    if (!u) throw new Error(`place ${kind} at ${floor},${x}: unit ${r.unitId} not found`);
    return u;
  };
  for (let x = 150; x < 275; x++) {
    const lobby = sim.tower.place("lobby", 1, x);
    if (!lobby.ok) throw new Error(`lobby at ${x}: ${lobby.reason ?? "no reason"}`);
    for (let f = 2; f <= 8; f++) {
      const slab = sim.tower.place("floor", f, x);
      if (!slab.ok) throw new Error(`floor ${f} at ${x}: ${slab.reason ?? "no reason"}`);
    }
  }
  const lift = sim.tower.placeTransport("elevatorStandard", 153, 1, 8);
  if (!lift.ok) throw new Error(`lobby-distance fixture elevator: ${lift.reason ?? "no reason"}`);
  const near = room("shop", 3, 165);
  const far = room("shop", 7, 165);
  const skyBar = room("skyBar", 8, 200);
  const office = room("office", 7, 235);
  for (const u of [near, far, skyBar, office]) u.state = "occupied";
  return { sim, near, far, skyBar, office };
};
