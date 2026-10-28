import { vi } from "vitest";
import { Simulation } from "../engine/Simulation";
import { TsEngine } from "../engine/port/tsEngine";
import { PortCodes } from "../simport/portCodes";

/** The fake engine port the frame loop tests drive: its commands land on the
 *  spies of a fake sim. */
interface SpiedSim {
  resolveChoice: unknown;
  emit: unknown;
}

export const portCodes = new PortCodes(new TsEngine(Simulation.newGame(1)));
const LOG_KINDS = ["info", "good", "bad", "money"];

export function fakeEnginePort(sim: SpiedSim) {
  return {
    hotspot: vi.fn(() => Float64Array.of(0, NaN)),
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

