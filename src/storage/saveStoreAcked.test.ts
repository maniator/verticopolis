import { describe, it, expect, vi, beforeEach } from "vitest";
import { ackedHash, clearAcked, coherenceHash, noteAcked } from "./saveStoreAcked";

/**
 * The coherence stamp in isolation. Its ONE job is answering "which side
 * moved" at the next boot, so the tests pin the properties hydration's
 * three-way leans on: a stamp survives a round trip, an absent or corrupt
 * stamp reads as "nothing acked" (the conservative answer), and a failure to
 * WRITE the stamp never throws into a save path.
 */

beforeEach(() => {
  localStorage.clear();
});

describe("coherenceHash", () => {
  it("is stable for equal input and differs across different input", () => {
    expect(coherenceHash("abc")).toBe(coherenceHash("abc"));
    expect(coherenceHash("abc")).not.toBe(coherenceHash("abd"));
    // The empty string still hashes (the FNV offset basis), because an empty
    // cache value must be distinguishable from an absent stamp.
    expect(coherenceHash("")).toBe((0x811c9dc5 >>> 0).toString(16));
  });
});

describe("noteAcked / ackedHash / clearAcked", () => {
  it("round-trips per id without cross-talk", () => {
    noteAcked("auto", "value-a");
    noteAcked("slot-1", "value-b");

    expect(ackedHash("auto")).toBe(coherenceHash("value-a"));
    expect(ackedHash("slot-1")).toBe(coherenceHash("value-b"));
    expect(ackedHash("slot-2")).toBeUndefined();

    clearAcked("auto");
    expect(ackedHash("auto")).toBeUndefined();
    // Clearing one id leaves the others.
    expect(ackedHash("slot-1")).toBe(coherenceHash("value-b"));
  });

  it("stores everything under ONE meta key, never per-slot keys", () => {
    noteAcked("auto", "x");
    noteAcked("slot-1", "y");
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem("vc-store-acked")).not.toBeNull();
  });

  it("a corrupt meta key reads as NOTHING acked, the conservative answer", () => {
    // "Nothing acked" makes every difference a conflict-or-reconcile decision
    // rather than a silent overwrite, so corruption costs conservatism, not
    // towers.
    for (const bad of ["not json", "[1,2]", "null", '"str"', '{"auto": 7}']) {
      localStorage.setItem("vc-store-acked", bad);
      expect(ackedHash("auto")).toBeUndefined();
    }
    // Non-string entries are dropped individually, not the whole map.
    localStorage.setItem("vc-store-acked", '{"auto": 7, "slot-1": "abcd"}');
    expect(ackedHash("auto")).toBeUndefined();
    expect(ackedHash("slot-1")).toBe("abcd");
  });

  it("a quota failure writing the stamp never throws into the caller", () => {
    // noteAcked runs inside write paths (the write-through, hydration); a
    // throw here would turn a committed save into a reported failure. The spy
    // targets the INSTANCE: happy-dom's localStorage does not dispatch
    // through Storage.prototype, so a prototype spy intercepts nothing.
    noteAcked("slot-1", "existing"); // so clearAcked below genuinely writes
    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw Object.assign(new Error("quota"), { name: "QuotaExceededError" });
    });
    try {
      expect(() => noteAcked("auto", "value")).not.toThrow();
      expect(() => clearAcked("slot-1")).not.toThrow();
      // The throws genuinely fired (guards against a vacuous pass).
      expect(setItem).toHaveBeenCalledTimes(2);
    } finally {
      setItem.mockRestore();
    }
    expect(ackedHash("auto")).toBeUndefined();
  });

  it("clearAcked on an absent id writes nothing at all", () => {
    noteAcked("slot-1", "kept"); // so readMap has content and the guard is real
    const setItem = vi.spyOn(localStorage, "setItem");
    try {
      clearAcked("never-acked");
      expect(setItem).not.toHaveBeenCalled();
      clearAcked("slot-1");
      expect(setItem).toHaveBeenCalledTimes(1);
    } finally {
      setItem.mockRestore();
    }
  });
});
