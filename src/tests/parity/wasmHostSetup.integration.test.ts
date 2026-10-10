import { describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";
import { onWasmParityProject } from "./typescriptOnly";

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
    const sim = Simulation.newGame(5, "modern");
    sim.money = 1e9;
    sim.star = 1;
    const c = Math.floor(GRID.width / 2);
    for (let x = 0; x < GRID.width; x++) sim.tower.place("lobby", 1, x);
    for (let x = 0; x < GRID.width; x++) sim.tower.place("floor", 2, x);
    expect(sim.buildTransport("elevatorStandard", c, 1, 2).ok).toBe(true);
    for (const x of [c + 4, c + 14, c + 24]) expect(sim.build("office", 2, x).ok).toBe(true);
    for (let h = 0; h < 24 * 4 && sim.crowd.people.length === 0; h++) sim.tick(60);
    expect(sim.crowd.people.length).toBeGreaterThan(0);
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    const revision = sim.tower.revision;
    office.satisfaction = office.satisfaction > 0.5 ? 0.1 : 0.9;
    expect(sim.tower.revision).toBe(revision);
    expect(() => sim.tick(1)).toThrow(WasmParityError);
  });
});
