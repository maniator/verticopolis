import { describe, expectTypeOf, it } from "vitest";
import type { PortRenderSim } from "../simport/portRenderSim";
import type { RenderSim } from "./renderSim";

describe("RenderSim", () => {
  it("the port's render adapter satisfies it, so main.ts hands the renderer the Rust engine's reads", () => {
    expectTypeOf<PortRenderSim>().toExtend<RenderSim>();
  });
});
