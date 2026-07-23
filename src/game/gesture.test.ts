import { describe, it, expect } from "vitest";
import { classifyGesture, isPaintKind } from "./gesture";
import type { Tool } from "../ui/UI";
import type { FacilityKind } from "../engine/types";

const build = (kind: FacilityKind): Tool => ({ type: "build", kind });
const TOUCH = true;
const MOUSE = false;

describe("classifyGesture — the pan-vs-act routing matrix", () => {
  it("paint tools (floor/lobby/parking) drag-paint on touch AND mouse — mobile can lay a run", () => {
    for (const k of ["floor", "lobby", "parking"] as const) {
      expect(classifyGesture(build(k), 0, TOUCH, false)).toBe("action");
      expect(classifyGesture(build(k), 0, MOUSE, false)).toBe("action");
    }
  });

  it("drag-sized transports (elevators) own the drag on touch", () => {
    for (const k of ["elevatorStandard", "elevatorService", "elevatorExpress"] as const) {
      expect(classifyGesture(build(k), 0, TOUCH, false)).toBe("action");
    }
  });

  it("fixed-span transports (stairs/escalator) tap-place on touch, drag on mouse", () => {
    for (const k of ["stairs", "escalator"] as const) {
      expect(classifyGesture(build(k), 0, TOUCH, false)).toBe("pan"); // finger-down can still pan
      expect(classifyGesture(build(k), 0, MOUSE, false)).toBe("action");
    }
  });

  it("non-paint rooms own the one-finger touch drag now (offset ghost, place on release), still act on mouse", () => {
    for (const k of ["office", "shop", "parkingRamp"] as const) {
      expect(classifyGesture(build(k), 0, TOUCH, false)).toBe("action");
      expect(classifyGesture(build(k), 0, MOUSE, false)).toBe("action");
    }
  });

  it("bulldoze pans+taps on touch, drags on mouse", () => {
    expect(classifyGesture({ type: "bulldoze" }, 0, TOUCH, false)).toBe("pan");
    expect(classifyGesture({ type: "bulldoze" }, 0, MOUSE, false)).toBe("action");
  });

  it("inspect always pans; a non-left button or held pan key always pans", () => {
    expect(classifyGesture({ type: "inspect" }, 0, TOUCH, false)).toBe("pan");
    expect(classifyGesture({ type: "inspect" }, 0, MOUSE, false)).toBe("pan");
    expect(classifyGesture(build("floor"), 1, TOUCH, false)).toBe("pan"); // middle/right button
    expect(classifyGesture(build("floor"), 0, MOUSE, true)).toBe("pan"); // Space/Shift held
  });

  it("the pan key (Space or Shift) beats every drag-owning gesture on mouse", () => {
    // The whole point of the modifier: it is the escape hatch out of the
    // tools that otherwise own left-drag (paint runs, drag-sized shafts,
    // bulldoze sweeps). Nothing may place, size, or demolish under it.
    expect(classifyGesture(build("lobby"), 0, MOUSE, true)).toBe("pan"); // paint run
    expect(classifyGesture(build("parking"), 0, MOUSE, true)).toBe("pan"); // paint run
    expect(classifyGesture(build("elevatorStandard"), 0, MOUSE, true)).toBe("pan"); // drag-sized shaft
    expect(classifyGesture(build("office"), 0, MOUSE, true)).toBe("pan"); // room
    expect(classifyGesture(build("stairs"), 0, MOUSE, true)).toBe("pan"); // fixed flight
    expect(classifyGesture({ type: "bulldoze" }, 0, MOUSE, true)).toBe("pan");
    // Touch with the key held (hybrid device): still pans, same rule.
    expect(classifyGesture(build("elevatorStandard"), 0, TOUCH, true)).toBe("pan");
  });

  it("isPaintKind covers floor, lobby and parking (not the ramp)", () => {
    for (const k of ["floor", "lobby", "parking"] as const) expect(isPaintKind(k)).toBe(true);
    for (const k of ["office", "parkingRamp", "stairs", "elevatorStandard"] as const) {
      expect(isPaintKind(k)).toBe(false);
    }
  });
});
