import { describe, expect, it, vi } from "vitest";
import { BulldozeDragChoice, dragRemoves } from "./bulldozeDrag";

/**
 * What a bulldoze drag clears: by default only the kind it first touched
 * (#644); with Everything picked on the Bulldoze card, all it crosses.
 */

describe("dragRemoves", () => {
  it("keeps a one-kind drag to the kind it first touched", () => {
    expect(dragRemoves("one kind", "lobby", "lobby")).toBe(true);
    expect(dragRemoves("one kind", "lobby", "elevatorExpress")).toBe(false);
    expect(dragRemoves("one kind", "floor", "office")).toBe(false);
  });

  it("removes anything while the drag has touched nothing yet", () => {
    expect(dragRemoves("one kind", undefined, "office")).toBe(true);
  });

  it("removes every kind once the player picks Everything", () => {
    for (const kind of ["lobby", "floor", "office", "elevatorStandard", "stairs"] as const) {
      expect(dragRemoves("everything", "lobby", kind), kind).toBe(true);
    }
  });
});

describe("BulldozeDragChoice", () => {
  it("starts on one kind and tells its listeners about a new pick, once", () => {
    const choice = new BulldozeDragChoice();
    expect(choice.clears).toBe("one kind");
    const heard = vi.fn();
    const off = choice.onChange(heard);
    choice.pick("everything");
    choice.pick("everything");
    expect(choice.clears).toBe("everything");
    expect(heard).toHaveBeenCalledOnce();
    off();
    choice.pick("one kind");
    expect(heard).toHaveBeenCalledOnce();
  });
});
