import { beforeEach, describe, expect, it } from "vitest";
import { storedSaveChars } from "./sizeGate";

// The size gate's measure (#1197): the longest stored save, so a small
// unreadable autosave cannot hide the large legacy one the boot falls back to.
beforeEach(() => localStorage.clear());

describe("storedSaveChars", () => {
  it("reads 0 with no save, a save's decoded length, and the longer of the two keys", () => {
    expect(storedSaveChars()).toBe(0);
    localStorage.setItem("verticopolis-save", "x".repeat(40));
    expect(storedSaveChars()).toBe(40);
    localStorage.setItem("verticopolis-save", "bad");
    localStorage.setItem("simtower-clone-save", "y".repeat(500));
    expect(storedSaveChars()).toBe(500);
  });
});
