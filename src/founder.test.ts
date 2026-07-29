import { describe, it, expect, beforeEach } from "vitest";
import { shouldWelcomeFounder, __resetFounderForTest } from "./founder";

/**
 * The one-time Founder welcome latch. The Founder STATUS lives in the save
 * (`sim.founder`, exercised in the serialization tests); this module holds only
 * the per-profile "greet once" moment.
 */

beforeEach(() => {
  __resetFounderForTest();
});

describe("Founder welcome (one-time per profile)", () => {
  it("returns true the first time, false forever after", () => {
    expect(shouldWelcomeFounder()).toBe(true);
    expect(shouldWelcomeFounder()).toBe(false);
    expect(shouldWelcomeFounder()).toBe(false);
  });

  it("is a silent no-op when storage is blocked (no toast, no throw)", () => {
    const orig = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      expect(() => shouldWelcomeFounder()).not.toThrow();
      expect(shouldWelcomeFounder()).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: orig });
    }
  });
});
