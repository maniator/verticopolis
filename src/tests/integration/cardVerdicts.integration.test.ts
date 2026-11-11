import { expect, it } from "vitest";
import { VIEW_LAYOUT } from "../../engine/port/layout";
import type { FacilityKind, GameMode } from "../../shared/types";
import { PortSim, describeEngines, draftTower, type Leg, type Draft } from "../portKit/portSim";

/**
 * The card verdicts live in the engine (#1420): whether a shaft's average
 * load is near capacity, and whether recycling meets demand. Each engine
 * answers the same, so the frontend only words what it is handed.
 */

/** The engine's own cutoff: a shaft is near capacity strictly above it. */
const CUTOFF = 0.85;
const LOADS = [undefined, 0, 0.5, CUTOFF, 0.8501, 0.97, 1] as const;
const slot = (name: (typeof VIEW_LAYOUT.records.shaftCard)[number]): number => VIEW_LAYOUT.records.shaftCard.indexOf(name);

type SeededPort = { seedElevatorTelemetry(json: string): void };

/** A 20-story tower with a sky lobby at floor 15: a four-car local, a service
 *  shaft and an express (the schedule tower's shafts, `fixtures/scheduleTower.ts`). */
function tower(mode: GameMode): { sim: Draft; standard: number; service: number; express: number } {
  const sim = draftTower(31, mode, "realWorld");
  sim.money = 1e12;
  sim.star = 5;
  const put = (kind: FacilityKind, floor: number, x: number) => {
    const r = sim.tower.place(kind, floor, x);
    if (!r.ok) throw new Error(`${kind} ${floor},${x}: ${r.reason}`);
  };
  for (let x = 0; x < 60; x++) put("lobby", 1, x);
  for (let f = 2; f <= 20; f++) for (let x = 0; x < 60; x++) put(f === 15 ? "lobby" : "floor", f, x);
  const shaft = (kind: "elevatorStandard" | "elevatorService" | "elevatorExpress", x: number, top: number): number => {
    const r = sim.tower.placeTransport(kind, x, 1, top);
    if (!r.ok || r.transportId === undefined) throw new Error(`${kind}: ${r.reason}`);
    return r.transportId;
  };
  const standard = shaft("elevatorStandard", 4, 20);
  const service = shaft("elevatorService", 10, 12);
  const express = shaft("elevatorExpress", 16, 20);
  sim.tower.setCars(standard, 4);
  return { sim, standard, service, express };
}
/** Give every shaft in `ids` the same measured load (none when undefined):
 *  the engine takes a telemetry document. */
function setLoad(sim: PortSim, ids: readonly number[], load: number | undefined): void {
  const util = load === undefined ? [] : ids.map((id) => [id, load]);
  (sim.port as unknown as SeededPort).seedElevatorTelemetry(JSON.stringify({ util, hourly: [], origins: [] }));
}

describeEngines("the card verdicts", (leg: Leg) => {
  for (const mode of ["classic", "modern"] as const) {
    it(`${mode}: a shaft is near capacity only above the cutoff`, () => {
      const f = tower(mode);
      const kinds = [f.standard, f.service, f.express] as const;
      const sim = new PortSim(leg, f.sim);
      for (const load of LOADS) {
        setLoad(sim, kinds, load);
        for (const id of kinds) {
          const want = load !== undefined && load > CUTOFF ? 1 : 0;
          expect(sim.port.shaftCard(id)[slot("nearCapacity")], `${mode} load ${String(load)} / shaft ${id}`).toBe(want);
        }
      }
    });

    // No office floor asks for recycling here, so demand is met. The
    // TypeScript reference answered true in both modes too, until #1875.
    it(`${mode}: recycling demand met is a verdict the engine answers`, () => {
      const f = tower(mode);
      const sim = new PortSim(leg, f.sim);
      expect(sim.port.recyclingDemandMet()).toBe(true);
    });
  }
});
