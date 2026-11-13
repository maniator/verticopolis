import { describe, expect, it } from "vitest";
import { checkBinding, INSTANCE_METHODS, STATIC_METHODS, TOOLING_METHODS } from "./binding";

/** A glue module whose Engine class defines `methods` and the statics. */
function glue(methods: readonly string[]): { Engine: unknown } {
  class Engine {}
  const proto = Engine.prototype as unknown as Record<string, unknown>;
  for (const name of methods) proto[name] = () => undefined;
  for (const name of STATIC_METHODS) (Engine as unknown as Record<string, unknown>)[name] = () => undefined;
  return { Engine };
}

describe("checkBinding (#1057)", () => {
  it("accepts the player package, which has no tier 3 op, on a player boot", () => {
    const mod = glue(INSTANCE_METHODS);
    expect(checkBinding(mod, { tooling: false })).toBe(mod);
  });

  it("refuses the player package on a tooling boot, naming the tier 3 ops it lacks", () => {
    expect(() => checkBinding(glue(INSTANCE_METHODS), { tooling: true })).toThrow(/lacks Engine#setMoney, Engine#setCars,/);
  });

  it("accepts the tooling package on either boot", () => {
    const mod = glue([...INSTANCE_METHODS, ...TOOLING_METHODS]);
    expect(checkBinding(mod, { tooling: true })).toBe(mod);
    expect(checkBinding(mod, { tooling: false })).toBe(mod);
  });

  it("still refuses a package missing a player op", () => {
    expect(() => checkBinding(glue(INSTANCE_METHODS.filter((m) => m !== "tick")), { tooling: false })).toThrow("lacks Engine#tick;");
  });

  it("keeps tier 3 out of the player list", () => {
    expect(INSTANCE_METHODS.filter((m) => (TOOLING_METHODS as readonly string[]).includes(m))).toEqual([]);
  });
});
