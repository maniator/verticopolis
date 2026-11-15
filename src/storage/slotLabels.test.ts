import { afterEach, describe, expect, it } from "vitest";
import { cleanSlotName, SLOT_NAME_MAX, slotLabel } from "./slotLabels";

afterEach(() => localStorage.clear());

const store = (names: unknown) => localStorage.setItem("vc.slotNames", typeof names === "string" ? names : JSON.stringify(names));

describe("save slot names, as 4.1 and 4.2 left them", () => {
  it("reads each slot's own name, and none for a slot without one", () => {
    expect(slotLabel(1)).toBeUndefined();
    store({ 1: "Office run", 2: "Hotel test" });
    expect(slotLabel(1)).toBe("Office run");
    expect(slotLabel(2)).toBe("Hotel test");
    expect(slotLabel(3)).toBeUndefined();
  });

  it("trims a name, makes runs of spaces one, and cuts it to the limit", () => {
    expect(cleanSlotName("  Big   one \n")).toBe("Big one");
    store({ 3: "x".repeat(SLOT_NAME_MAX + 10), 1: "   " });
    expect(slotLabel(3)).toBe("x".repeat(SLOT_NAME_MAX));
    expect(slotLabel(1)).toBeUndefined();
  });

  it("reads a damaged entry as no names", () => {
    store("{not json");
    expect(slotLabel(1)).toBeUndefined();
    store({ 1: 42, 2: "Kept" });
    expect(slotLabel(1)).toBeUndefined();
    expect(slotLabel(2)).toBe("Kept");
  });

  it("follows a name another tab wrote", () => {
    store({ 1: "Mine" });
    expect(slotLabel(1)).toBe("Mine");
    store({ 1: "Theirs" });
    expect(slotLabel(1)).toBe("Theirs");
  });
});
