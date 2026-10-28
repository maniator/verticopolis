import { describe, expectTypeOf, it } from "vitest";
import type { Simulation } from "../engine/Simulation";
import type { RenderSim } from "./renderSim";

describe("RenderSim", () => {
  it("the live TypeScript Simulation satisfies it, so main.ts passes the instance it always did", () => {
    expectTypeOf<Simulation>().toExtend<RenderSim>();
  });
});
