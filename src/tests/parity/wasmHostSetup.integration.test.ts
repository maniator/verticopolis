import { describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";
import type { GameMode } from "../../engine/types";
import { onWasmParityProject } from "./typescriptOnly";

const MID = Math.floor(GRID.width / 2);

/** A Modern floor-2 office tower served by one elevator, ticked by the hour
 *  until its crowd exists. */
function crowdedOfficeTower(seed: number): Simulation {
  const sim = Simulation.newGame(seed, "modern");
  sim.money = 1e9;
  sim.star = 1;
  for (let x = 0; x < GRID.width; x++) sim.tower.place("lobby", 1, x);
  for (let x = 0; x < GRID.width; x++) sim.tower.place("floor", 2, x);
  expect(sim.buildTransport("elevatorStandard", MID, 1, 2).ok).toBe(true);
  for (const x of [MID + 4, MID + 14, MID + 24]) expect(sim.build("office", 2, x).ok).toBe(true);
  for (let h = 0; h < 24 * 4 && sim.crowd.people.length === 0; h++) sim.tick(60);
  expect(sim.crowd.people.length).toBeGreaterThan(0);
  return sim;
}

/** A floor-2 hotel floor served by one elevator, with no rooms yet. */
function hotelTower(seed: number, mode: GameMode): Simulation {
  const sim = Simulation.newGame(seed, mode);
  sim.money = 1e9;
  sim.star = 2;
  for (let x = 0; x < GRID.width; x++) sim.tower.place("lobby", 1, x);
  for (let i = 0; i < 30; i++) expect(sim.tower.place("floor", 2, MID - 20 + i).ok).toBe(true);
  expect(sim.buildTransport("elevatorStandard", MID - 20, 1, 2).ok).toBe(true);
  return sim;
}

/** A hotel room placed straight on the tower (no relayed command). */
function placeHotel(sim: Simulation, x: number) {
  const r = sim.tower.place("hotelSingle", 2, x);
  expect(r.ok).toBe(true);
  return sim.tower.units.find((u) => u.id === r.unitId)!;
}

/**
 * The parity setup's own pin (story-engine-test-parity, #878): attaching
 * normalizes the instance the way the engine normalized it on load, so an
 * off-ladder rent written straight onto a Classic unit before the first
 * tick snaps once, logs one bulletin, and needs no re-host. Only the parity
 * projects load the setup file, so the plain projects skip this.
 */
describe.skipIf(!onWasmParityProject())("the WASM parity setup", () => {
  it("hosts a Classic tower with an off-ladder rent once and logs one rent-snap bulletin", async () => {
    const { parityStats } = await import("./wasmHostSetup");
    const sim = Simulation.newGame(3, "classic");
    sim.money = 1e9;
    sim.star = 1;
    for (let x = 0; x < GRID.width; x++) sim.tower.place("lobby", 1, x);
    for (let x = 0; x < GRID.width; x++) sim.tower.place("floor", 2, x);
    expect(sim.build("office", 2, Math.floor(GRID.width / 2)).ok).toBe(true);
    const office = sim.tower.units.find((u) => u.kind === "office" && u.floor === 2)!;
    office.rent = 12_345; // off the 1994 ladder: the load snaps it
    const hosts = parityStats.hosts;
    const rehosts = parityStats.rehosts;
    sim.tick(60);
    const bulletins = sim.log.filter((e) => e.text.startsWith("Classic pricing: rents snapped"));
    expect(bulletins).toHaveLength(1);
    expect(parityStats.hosts - hosts).toBe(1);
    expect(parityStats.rehosts - rehosts).toBe(0);
    expect(office.rent).not.toBe(12_345);
  });

  it("names a direct unit write made after the crowd exists, though it moves no revision", async () => {
    const { WasmParityError } = await import("./wasmHostSetup");
    const sim = crowdedOfficeTower(5);
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    const revision = sim.tower.revision;
    office.satisfaction = office.satisfaction > 0.5 ? 0.1 : 0.9;
    expect(sim.tower.revision).toBe(revision);
    expect(() => sim.tick(1)).toThrow(WasmParityError);
  });

  it("names a direct write to a transport's car count made after the crowd exists", async () => {
    const { WasmParityError } = await import("./wasmHostSetup");
    const sim = crowdedOfficeTower(21);
    const shaft = sim.tower.transports[0];
    shaft.cars = shaft.cars > 1 ? shaft.cars - 1 : shaft.cars + 1;
    expect(() => sim.tick(1)).toThrow(WasmParityError);
  });

  it("names a direct write to a unit's label made after the crowd exists", async () => {
    const { WasmParityError } = await import("./wasmHostSetup");
    const sim = crowdedOfficeTower(22);
    sim.tower.units.find((u) => u.kind === "office")!.label = "Renamed by the test";
    expect(() => sim.tick(1)).toThrow(WasmParityError);
  });

  it("re-hosts an un-relayed edit made before a booking, so both engines book and clear the same rooms", async () => {
    const { parityStats } = await import("./wasmHostSetup");
    const sim = hotelTower(23, "modern");
    sim.tick(1);
    expect(sim.crowd.people).toHaveLength(0);
    const room = placeHotel(sim, MID - 20);
    room.state = "infested";
    const rehosts = parityStats.rehosts;
    const res = sim.callExterminator();
    expect(res.ok).toBe(true);
    expect(res.rooms).toBe(1);
    expect(parityStats.rehosts - rehosts).toBe(1);
    for (let h = 0; h < 30; h++) sim.tick(60);
    expect(sim.tower.units.find((u) => u.id === room.id)!.state).toBe("empty");
  });

  it("refuses a re-host while an exterminator booking is pending", async () => {
    const { WasmParityError } = await import("./wasmHostSetup");
    const sim = hotelTower(24, "modern");
    placeHotel(sim, MID - 20).state = "infested";
    expect(sim.callExterminator().ok).toBe(true);
    expect(sim.crowd.people).toHaveLength(0);
    placeHotel(sim, MID); // un-relayed, after the booking
    expect(() => sim.tick(1)).toThrow(/exterminator booking is pending/);
    expect(() => sim.tick(1)).toThrow(WasmParityError);
  });

  it("keeps one copy of a long log line written before hosting (the load cuts it short)", () => {
    const sim = Simulation.newGame(25, "modern");
    const long = `parity probe ${"x".repeat(500)}`;
    sim.emit(long);
    sim.tick(60);
    sim.tick(60);
    expect(sim.log.filter((e) => e.text.startsWith("parity probe"))).toHaveLength(1);
  });

  it("refuses the v1 model at the first tick", () => {
    const sim = Simulation.newGame(26, "modern");
    sim.simModel = "v1";
    expect(() => sim.tick(60)).toThrow(/v1 model is TypeScript-only/);
  });

  it("refuses the v1 model set after the first tick", () => {
    const sim = Simulation.newGame(27, "modern");
    sim.tick(60);
    sim.simModel = "v1";
    expect(() => sim.tick(60)).toThrow(/v1 model is TypeScript-only/);
  });
});

/** One Simulation shared by two tests: the first builds a crowd on the
 *  engine, the afterEach releases the host, and the second must be refused
 *  (the engine starts from a save, which carries no crowd). */
describe.skipIf(!onWasmParityProject())("the WASM parity setup with a shared instance", () => {
  let shared: Simulation | undefined;
  it("builds a crowd on the engine", () => {
    shared = crowdedOfficeTower(28);
  });
  it("refuses the instance in the next test, now that it has a crowd", () => {
    expect(shared).toBeDefined();
    expect(() => shared!.tick(1)).toThrow(/already has a crowd/);
  });
});
