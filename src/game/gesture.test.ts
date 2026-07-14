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

  it("non-paint rooms tap-place on touch, drag on mouse", () => {
    for (const k of ["office", "shop", "parkingRamp"] as const) {
      expect(classifyGesture(build(k), 0, TOUCH, false)).toBe("pan");
      expect(classifyGesture(build(k), 0, MOUSE, false)).toBe("action");
    }
  });

  it("bulldoze pans+taps on touch, drags on mouse", () => {
    expect(classifyGesture({ type: "bulldoze" }, 0, TOUCH, false)).toBe("pan");
    expect(classifyGesture({ type: "bulldoze" }, 0, MOUSE, false)).toBe("action");
  });

  it("inspect always pans; a non-left button or held space always pans", () => {
    expect(classifyGesture({ type: "inspect" }, 0, TOUCH, false)).toBe("pan");
    expect(classifyGesture({ type: "inspect" }, 0, MOUSE, false)).toBe("pan");
    expect(classifyGesture(build("floor"), 1, TOUCH, false)).toBe("pan"); // middle/right button
    expect(classifyGesture(build("floor"), 0, MOUSE, true)).toBe("pan"); // space held
  });

  it("isPaintKind covers floor, lobby and parking (not the ramp)", () => {
    for (const k of ["floor", "lobby", "parking"] as const) expect(isPaintKind(k)).toBe(true);
    for (const k of ["office", "parkingRamp", "stairs", "elevatorStandard"] as const) {
      expect(isPaintKind(k)).toBe(false);
    }
  });
});
