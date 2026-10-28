import { describe, expect, it } from "vitest";
import { facilityFloors } from "../engine/facilities";
import { isOperational, type UnitState } from "../engine/types";
import { TsEngine } from "../engine/port/tsEngine";
import { Simulation } from "../engine/Simulation";
import type { EnginePort } from "../simport/enginePort";
import { ViewReader } from "../simport/viewReader";
import { createCardKit, INERT_STATES } from "./cardKit";

/** A tower with a recycling center in the basement and an occupied office. */
function tower(): { sim: Simulation; centerId: number; officeId: number } {
  const sim = Simulation.newGame(3, "classic");
  sim.money = 1e9;
  sim.star = 5;
  for (let x = 170; x < 230; x++) sim.tower.place("lobby", 1, x);
  for (const f of [0, -1, 2]) for (let x = 170; x < 230; x++) sim.tower.place("floor", f, x);
  const center = sim.tower.place("recycling", -1, 180);
  const office = sim.tower.place("office", 2, 180);
  if (!center.ok || center.unitId === undefined || !office.ok || office.unitId === undefined) throw new Error("the test tower did not build");
  const c = sim.tower.getUnit(center.unitId);
  const o = sim.tower.getUnit(office.unitId);
  if (!c || !o) throw new Error("the test tower lost a room");
  c.state = "occupied";
  o.state = "occupied";
  o.occupants = 6;
  return { sim, centerId: center.unitId, officeId: office.unitId };
}

/** The engine as the Rust engine presents it to the cards: the same reads, and
 *  no TypeScript tower behind them. */
function withoutTower(engine: TsEngine): EnginePort {
  return new Proxy(engine, { get: (target, key) => (key === "sim" ? undefined : Reflect.get(target, key, target)) }) as unknown as EnginePort;
}

describe("the card kit's unit lines on an engine with no TypeScript tower", () => {
  it("show a recycling center's fill and capacity lines, the same as the TypeScript tower's", () => {
    const { sim, centerId } = tower();
    const engine = new TsEngine(sim);
    const reader = new ViewReader(engine, facilityFloors);
    const own = createCardKit({ enginePort: engine, reader }).diagnostics.unit(centerId);
    const hosted = createCardKit({ enginePort: withoutTower(engine), reader }).diagnostics.unit(centerId);
    expect(own).toHaveLength(2);
    expect(hosted).toEqual(own);
  });

  it("read the capacity from the port", () => {
    const { sim, centerId } = tower();
    const engine = new TsEngine(sim);
    expect(engine.recyclingCapacity()).toBe(2500);
    const reader = new ViewReader(engine, facilityFloors);
    const lines = createCardKit({ enginePort: withoutTower(engine), reader }).diagnostics.unit(centerId);
    expect(lines.map((l) => l.values.join("|")).join("\n")).toContain("2,500");
  });

  it("show no recycling lines for another kind, or a center still under construction", () => {
    const { sim, centerId, officeId } = tower();
    const engine = new TsEngine(sim);
    const reader = new ViewReader(engine, facilityFloors);
    const kit = createCardKit({ enginePort: withoutTower(engine), reader });
    expect(kit.diagnostics.unit(officeId)).toEqual([]);
    const center = sim.tower.getUnit(centerId);
    if (!center) throw new Error("the center is gone");
    center.state = "construction";
    expect(kit.diagnostics.unit(centerId)).toEqual([]);
  });

  it("treat a room as inert in exactly the states the engine does", () => {
    const all: UnitState[] = ["construction", "empty", "occupied", "moving_in", "vacating", "asleep", "dirty", "infested", "fire", "gutted"];
    for (const state of all) expect(INERT_STATES.has(state), state).toBe(!isOperational({ state }));
  });
});
