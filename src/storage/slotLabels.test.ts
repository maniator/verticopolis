import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanSlotName, setSlotLabel, SLOT_NAME_MAX, slotLabel } from "./slotLabels";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("save slot names", () => {
  it("names a slot, keeps the others apart, and an empty name gives the number back", () => {
    expect(slotLabel(1)).toBeUndefined();
    expect(setSlotLabel(1, "Office run")).toBe(true);
    setSlotLabel(2, "Hotel test");
    expect(slotLabel(1)).toBe("Office run");
    expect(slotLabel(2)).toBe("Hotel test");
    expect(slotLabel(3)).toBeUndefined();
    setSlotLabel(1, "   ");
    expect(slotLabel(1)).toBeUndefined();
    expect(slotLabel(2)).toBe("Hotel test");
    setSlotLabel(2, "");
    expect(localStorage.getItem("vc.slotNames")).toBeNull();
  });

  it("trims a name, makes runs of spaces one, and cuts it to the limit", () => {
    expect(cleanSlotName("  Big   one \n")).toBe("Big one");
    const long = "x".repeat(SLOT_NAME_MAX + 10);
    setSlotLabel(3, long);
    expect(slotLabel(3)).toBe("x".repeat(SLOT_NAME_MAX));
  });

  it("reads a damaged entry as no names, and says when the browser refuses the write", () => {
    localStorage.setItem("vc.slotNames", "{not json");
    expect(slotLabel(1)).toBeUndefined();
    localStorage.setItem("vc.slotNames", JSON.stringify({ 1: 42, 2: "Kept" }));
    expect(slotLabel(1)).toBeUndefined();
    expect(slotLabel(2)).toBe("Kept");
    const refuse = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(setSlotLabel(1, "Nope")).toBe(false);
    expect(slotLabel(1)).toBeUndefined();
    refuse.mockRestore();
  });

  it("follows a name another tab wrote", () => {
    setSlotLabel(1, "Mine");
    expect(slotLabel(1)).toBe("Mine");
    localStorage.setItem("vc.slotNames", JSON.stringify({ 1: "Theirs" }));
    expect(slotLabel(1)).toBe("Theirs");
  });
});
