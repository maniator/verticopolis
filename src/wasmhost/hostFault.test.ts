import { describe, expect, it } from "vitest";
import { EngineBootError } from "./engineBoot";
import { isEngineTrap, runEach } from "./hostFault";

describe("an engine trap (#1113)", () => {
  const named = (name: string, message: string) => Object.assign(new Error(message), { name });

  it("is a RuntimeError, from this realm or another, the borrow error after one, or a stack overflow", () => {
    expect(isEngineTrap(new WebAssembly.RuntimeError("unreachable"))).toBe(true);
    expect(isEngineTrap(named("RuntimeError", "unreachable executed"))).toBe(true);
    expect(isEngineTrap(new Error("recursive use of an object detected which would lead to unsafe aliasing in rust"))).toBe(true);
    expect(isEngineTrap(new RangeError("Maximum call stack size exceeded"))).toBe(true);
    expect(isEngineTrap(named("InternalError", "too much recursion"))).toBe(true);
    // Another realm's error is no `Error` here, and a wrapper keeps the trap
    // as its cause (the catalog read).
    expect(isEngineTrap({ name: "RuntimeError", message: "unreachable" })).toBe(true);
    expect(isEngineTrap(Object.assign(new Error("the engine returned no classic catalog: unreachable"), { cause: new WebAssembly.RuntimeError("unreachable") }))).toBe(true);
  });

  it("is not the engine's clean refusal, the host's own check, or a value that is no error", () => {
    expect(isEngineTrap(new Error("unknown mode: tower"))).toBe(false); // a JsError
    expect(isEngineTrap(new Error("the tower already has a crowd"))).toBe(false);
    expect(isEngineTrap(new RangeError("Invalid array length"))).toBe(false);
    expect(isEngineTrap(new TypeError("cannot read properties of undefined"))).toBe(false);
    expect(isEngineTrap(new EngineBootError("package-mismatch", "no catalog"))).toBe(false);
    expect(isEngineTrap("unreachable")).toBe(false);
    expect(isEngineTrap(null)).toBe(false);
    expect(isEngineTrap(Object.assign(new Error("the engine returned no classic catalog: mode must be"), { cause: new Error("mode must be") }))).toBe(false);
  });
});

describe("a teardown's steps (#1113)", () => {
  const throwing = (e: unknown) => () => {
    throw e;
  };

  const thrownBy = (...steps: (() => void)[]): unknown => {
    try {
      runEach(...steps);
    } catch (e) {
      return e;
    }
    return null;
  };

  it("runs every step and throws a lone error as it is", () => {
    const ran: number[] = [];
    const clean = new Error("the events do not go back");
    expect(thrownBy(() => void ran.push(1), throwing(clean), () => void ran.push(3))).toBe(clean);
    expect(ran).toEqual([1, 3]);
    expect(thrownBy(() => {})).toBeNull();
  });

  it("throws the first trap, naming the other errors, with the trap as its cause", () => {
    const trap = new WebAssembly.RuntimeError("unreachable");
    const thrown = thrownBy(throwing(new Error("the events do not go back")), throwing(trap), throwing(new WebAssembly.RuntimeError("a second trap")));
    expect(thrown).toMatchObject({ message: "unreachable, and the events do not go back, and a second trap", cause: trap });
    expect(isEngineTrap(thrown)).toBe(true);
  });

  it("names a wrapped trap's wrapper, and still finds the trap three wrappers deep", () => {
    const trap = new WebAssembly.RuntimeError("unreachable");
    const wrapped = [1, 2, 3].reduce<unknown>((cause, n) => Object.assign(new Error(`wrapper ${n}`), { cause }), trap);
    const thrown = thrownBy(throwing(new Error("the events do not go back")), throwing(wrapped));
    expect(thrown).toMatchObject({ message: "wrapper 3, and the events do not go back", cause: trap });
    expect(isEngineTrap(thrown)).toBe(true);
  });
});
