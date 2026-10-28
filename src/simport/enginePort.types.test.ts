import { describe, expectTypeOf, it } from "vitest";
import type { Engine } from "../dualrun/engine";
import type { EnginePort } from "./enginePort";

// The contract's compile-time proof (section 1): the generated binding
// `Engine` satisfies `EnginePort`, so a member that drifts on the Rust side
// (a renamed export, a changed argument or answer) fails the typecheck.
// `TsEngine` joins this check when it lands (contract PR 3).
describe("EnginePort", () => {
  it("is satisfied by the binding's Engine", () => {
    expectTypeOf<Engine>().toMatchTypeOf<EnginePort>();
    const port = (e: Engine): EnginePort => e;
    expectTypeOf(port).returns.toEqualTypeOf<EnginePort>();
  });
});
