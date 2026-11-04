import { describe, expect, it } from "vitest";
import type { Simulation } from "../../engine/Simulation";
import { VIEW_LAYOUT } from "../../engine/port/layout";
import { tower } from "../fixtures/scheduleTower";
import { PortSim, describeEngines, type Leg } from "../portKit/portSim";

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
type TsPort = { sim: Simulation };

/** Give every shaft in `ids` the same measured load (none when undefined),
 *  the way each engine holds it: the Rust engine takes a telemetry document,
 *  the TypeScript reference keeps the map on its simulation. */
function setLoad(sim: PortSim, ids: readonly number[], load: number | undefined): void {
  if (sim.leg === "rust") {
    const util = load === undefined ? [] : ids.map((id) => [id, load]);
    (sim.port as unknown as SeededPort).seedElevatorTelemetry(JSON.stringify({ util, hourly: [], origins: [] }));
    return;
  }
  const { elevatorUtil } = (sim.port as unknown as TsPort).sim;
  for (const id of ids) {
    if (load === undefined) elevatorUtil.delete(id);
    else elevatorUtil.set(id, load);
  }
}

/** What each engine answered for recycling, by mode and leg. */
const recycling: Record<string, boolean> = {};

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

    it(`${mode}: recycling demand met is a verdict the engine answers`, () => {
      const f = tower(mode);
      const sim = new PortSim(leg, f.sim);
      recycling[`${mode}/${leg}`] = sim.port.recyclingDemandMet();
    });
  }
});

describe("the engines agree on recycling demand", () => {
  for (const mode of ["classic", "modern"] as const) {
    it(`${mode}: Rust answers what the TypeScript reference answers`, () => {
      const ts = recycling[`${mode}/ts`];
      expect(typeof ts).toBe("boolean");
      const rust = recycling[`${mode}/rust`];
      if (rust !== undefined) expect(rust).toBe(ts);
    });
  }
});
