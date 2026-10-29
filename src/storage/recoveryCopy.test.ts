import { beforeEach, describe, expect, it, vi } from "vitest";
import { readRecoveryText } from "./recoveryCopy";
import { SaveGame } from "./SaveGame";

/** The recovery copy is the stored bytes as they sit in storage (#1422 6b). */
describe("readRecoveryText", () => {
  beforeEach(() => localStorage.clear());

  it("returns the autosave exactly as stored, unreadable bytes included", () => {
    const stored = "VCZ1:not-really-deflate\u0000\ttrailing ";
    localStorage.setItem("verticopolis-save", stored);
    expect(readRecoveryText()).toBe(stored);
  });

  it("reads the legacy autosave key when only it is stored", () => {
    localStorage.setItem("simtower-clone-save", "{\"legacy\":true}");
    expect(readRecoveryText()).toBe("{\"legacy\":true}");
  });

  it("falls back to the unreadable stash, and is null with nothing stored", () => {
    expect(readRecoveryText()).toBeNull();
    localStorage.setItem("verticopolis-save", "kept bytes");
    SaveGame.preserveUnreadable();
    SaveGame.clear();
    expect(readRecoveryText()).toBe("kept bytes");
  });

  it("is null when storage itself throws", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    try {
      expect(readRecoveryText()).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});
