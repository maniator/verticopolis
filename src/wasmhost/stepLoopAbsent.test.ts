import { describe, expect, it } from "vitest";
import type * as loop from "../engine/sim/loop";
import * as absent from "./stepLoopAbsent";
import { Simulation } from "../engine/Simulation";

// The stand-in replaces the loop module by alias in a wasm-only build, so it
// must offer every export the loop has, with the same types; this fails to
// typecheck when the loop gains or changes one.
const sameShape: typeof loop = absent;
void sameShape;

describe("stepLoopAbsent", () => {
  it("refuses every step by name, so a tower the WASM host does not hold cannot quietly tick on TypeScript", () => {
    const sim = Simulation.newGame(3, "classic");
    for (const step of [() => absent.tick(sim, 1), () => absent.advanceStep(sim, 1), () => absent.onHour(sim), () => absent.onDay(sim), () => absent.finishConstruction(sim)]) {
      expect(step).toThrow(absent.StepLoopAbsentError);
    }
    expect(() => absent.tick(sim, 1)).toThrow(/tick: the TypeScript step loop is not part of this wasm-only build/);
  });

  it("still answers the hour count, which is a read", () => {
    const sim = Simulation.newGame(3, "classic");
    sim.onHourRuns = 7;
    expect(absent.hourTicks(sim)).toBe(7);
  });
});
