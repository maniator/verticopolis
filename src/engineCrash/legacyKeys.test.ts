import { beforeEach, describe, expect, it } from "vitest";
import { LEGACY_COHORT_KEYS, removeLegacyCohortKeys } from "./legacyKeys";

beforeEach(() => localStorage.clear());

describe("removeLegacyCohortKeys", () => {
  it("removes the retired cohort keys and leaves the player's other storage alone", () => {
    for (const key of LEGACY_COHORT_KEYS) localStorage.setItem(key, "{}");
    localStorage.setItem("vc.engine", "wasm");
    localStorage.setItem("verticopolis-save", "x");
    removeLegacyCohortKeys();
    for (const key of LEGACY_COHORT_KEYS) expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem("vc.engine")).toBe("wasm");
    expect(localStorage.getItem("verticopolis-save")).toBe("x");
  });

  it("does not throw on blocked or missing storage", () => {
    const blocked = {
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => removeLegacyCohortKeys(blocked)).not.toThrow();
    expect(() => removeLegacyCohortKeys(null)).not.toThrow();
  });
});
