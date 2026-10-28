import { vi } from "vitest";
import { Simulation } from "../engine/Simulation";
import { TsEngine } from "../engine/port/tsEngine";
import { PortCodes } from "../simport/portCodes";

/** The fake engine port the frame loop tests drive: its commands land on the
 *  spies of a fake sim. */
interface SpiedSim {
  resolveChoice: unknown;
  emit: unknown;
  evaluatedTower?: boolean;
}

export const portCodes = new PortCodes(new TsEngine(Simulation.newGame(1)));
const LOG_KINDS = ["info", "good", "bad", "money"];

export function fakeEnginePort(sim: SpiedSim) {
  return {
    hotspot: vi.fn(() => Float64Array.of(0, NaN)),
    evaluatedTower: vi.fn(() => sim.evaluatedTower === true),
    answerChoice: vi.fn((accept: boolean) => {
      (sim.resolveChoice as (opt: string) => void)(accept ? "accept" : "decline");
      return Float64Array.of(1, 0);
    }),
    logLine: vi.fn((text: string, kindCode: number) => {
      (sim.emit as (t: string, k: string) => void)(text, LOG_KINDS[kindCode]);
      return Float64Array.of(1, 0);
    }),
  };
}

/** The shared reader over the fake sim: the header reads the sim's star and
 *  emergency as they stand, and its population is the census taken at the
 *  last update, as the real reader's is. */
export function fakeReader(sim: { star: number; pendingChoice: unknown; tower: { totalPopulation: unknown } }) {
  let population = 0;
  return {
    update: vi.fn(() => {
      population = (sim.tower.totalPopulation as () => number)();
    }),
    rooms: [],
    structure: [],
    get header() {
      return { star: sim.star, pendingChoice: sim.pendingChoice, population, mode: "modern", modernCalendar: "realWorld" };
    },
  };
}
