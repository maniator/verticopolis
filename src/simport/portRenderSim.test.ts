import { describe, expect, it } from "vitest";
import { Simulation } from "../engine/Simulation";
import type { HeatmapMode } from "../engine/sim/constants";
import { TsEngine } from "../engine/port/tsEngine";
import { PortRenderSim } from "./portRenderSim";
import { ViewReader } from "./viewReader";

/**
 * The renderer's reads over the port answer what the simulation answers when
 * the renderer holds it directly, so the renderer can draw the port in its
 * place. The golden test holds the port's render queries to the Rust engine.
 */

function tower(): Simulation {
  const sim = Simulation.newGame(5, "modern");
  sim.money = 1e8;
  sim.star = 3;
  for (let x = 160; x < 280; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
  for (const floor of [2, 3]) for (let x = 160; x < 280; x++) expect(sim.build("floor", floor, x).ok).toBe(true);
  for (const x of [170, 180, 200]) expect(sim.build("office", 2, x).ok).toBe(true);
  expect(sim.build("hotelSingle", 3, 170).ok).toBe(true);
  expect(sim.build("fastFood", 3, 200).ok).toBe(true);
  expect(sim.buildTransport("elevatorStandard", 162, 1, 3).ok).toBe(true);
  expect(sim.buildTransport("stairs", 275, 1, 2).ok).toBe(true);
  return sim;
}

const MODES: HeatmapMode[] = ["congestion", "occupancy", "satisfaction", "cleanliness"];

function sameReads(sim: Simulation, r: PortRenderSim): void {
  expect(r.mode).toBe(sim.mode);
  expect(r.rng.initialSeed).toBe(sim.rng.initialSeed);
  expect(r.view).toEqual(sim.view);
  expect(r.weather).toBe(sim.weather);
  expect(r.population).toBe(sim.population);
  for (const k of ["minutes", "hour", "minute", "minuteOfDay"] as const) expect(r.clock[k], k).toBe(sim.clock[k]);
  expect([r.clock.isMorning(), r.clock.isEvening(), r.clock.isNight()]).toEqual([sim.clock.isMorning(), sim.clock.isEvening(), sim.clock.isNight()]);
  expect([r.santaFxSeq, r.vipFxSeq]).toEqual([sim.santaFxSeq, sim.vipFxSeq]);
  expect([r.explosionFx, r.thiefFx, r.treasureFx]).toEqual([sim.explosionFx, sim.thiefFx, sim.treasureFx]);
  expect(r.congestion()).toBe(sim.congestion());
  expect(r.peakCongestion()).toBe(sim.peakCongestion());
  for (const m of MODES) expect(r.floorHeatmap(m), m).toEqual(sim.floorHeatmap(m));
  expect(r.tower.functionalParkingSet()).toEqual(sim.tower.functionalParkingSet());
  for (const spots of [0, 2, 30]) expect(r.parkingUsage(spots), `spots ${spots}`).toBe(sim.parkingUsage(spots));
  expect(r.recyclingFill()).toBe(sim.recyclingFill());
  for (const [floor, x] of [[1, 170], [2, 170], [3, 200], [4, 170]]) {
    expect(r.positionReachable(floor, x), `${floor} ${x}`).toBe(sim.positionReachable(floor, x));
  }
  expect(r.crowd.queueView(r.tower)).toEqual(sim.crowd.queueView(sim.tower));
  expect(r.crowd.people.map((p) => p.id)).toEqual(sim.crowd.people.map((p) => p.id));
}

describe("PortRenderSim over TsEngine", () => {
  it("reads what the simulation answers, before and after play", () => {
    const sim = tower();
    const engine = new TsEngine(sim);
    const reader = new ViewReader(engine);
    const r = new PortRenderSim(engine, reader);
    sameReads(sim, r);
    for (let i = 0; i < 8; i++) {
      engine.tick(75);
      reader.update();
      sameReads(sim, r);
    }
  });

  it("keeps the queue projection until the clock or the tower moves", () => {
    const sim = tower();
    const engine = new TsEngine(sim);
    const reader = new ViewReader(engine);
    const r = new PortRenderSim(engine, reader);
    engine.tick(600);
    reader.update();
    const q = r.crowd.queueView(r.tower);
    expect(r.crowd.queueView(r.tower)).toBe(q);
    engine.tick(1);
    reader.update();
    expect(r.crowd.queueView(r.tower)).not.toBe(q);
  });
});
