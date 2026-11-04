import { beforeEach, describe, expect, it, vi } from "vitest";
import { setSlotPopulationReader } from "./slotCensus";
import type { SlotInfo } from "./slotInfo";
import { rememberedSlotInfo } from "./slotInfoMemo";

const row = (population: number): SlotInfo => ({ slot: 1, exists: true, present: true, population });

describe("rememberedSlotInfo", () => {
  beforeEach(() => {
    localStorage.clear();
    // A fresh census epoch, so no row from an earlier test is reused.
    setSlotPopulationReader(null);
  });

  it("reads a slot once while its stored value holds", () => {
    localStorage.setItem("k", "VCZ1:one");
    const read = vi.fn(() => row(5));
    expect(rememberedSlotInfo(1, ["k"], read).population).toBe(5);
    expect(rememberedSlotInfo(1, ["k"], read).population).toBe(5);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(["VCZ1:one"]);
  });

  it("reads again when the stored value changes, appears or goes", () => {
    const read = vi.fn((raws: readonly (string | null)[]) => row(raws[0] === null ? 0 : raws[0].length));
    expect(rememberedSlotInfo(1, ["k"], read).population).toBe(0);
    localStorage.setItem("k", "ab");
    expect(rememberedSlotInfo(1, ["k"], read).population).toBe(2);
    localStorage.setItem("k", "abc");
    expect(rememberedSlotInfo(1, ["k"], read).population).toBe(3);
    localStorage.removeItem("k");
    expect(rememberedSlotInfo(1, ["k"], read).population).toBe(0);
    expect(read).toHaveBeenCalledTimes(4);
  });

  it("reads again when any key the loader walks changes", () => {
    localStorage.setItem("a", "x");
    const read = vi.fn(() => row(1));
    rememberedSlotInfo("auto", ["a", "b"], read);
    localStorage.setItem("b", "legacy");
    rememberedSlotInfo("auto", ["a", "b"], read);
    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenLastCalledWith(["x", "legacy"]);
  });

  it("reads again once the census reader is installed or removed", () => {
    localStorage.setItem("k", "v");
    const read = vi.fn(() => row(1));
    rememberedSlotInfo(1, ["k"], read);
    setSlotPopulationReader(() => 7);
    rememberedSlotInfo(1, ["k"], read);
    setSlotPopulationReader(null);
    rememberedSlotInfo(1, ["k"], read);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("reads again when the same slot is asked through other keys", () => {
    localStorage.setItem("a", "v");
    localStorage.setItem("b", "v");
    const read = vi.fn(() => row(1));
    rememberedSlotInfo(1, ["a"], read);
    rememberedSlotInfo(1, ["b"], read);
    rememberedSlotInfo(1, ["b"], read);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("keeps each slot's row apart", () => {
    localStorage.setItem("k", "v");
    const one = vi.fn(() => row(1));
    const two = vi.fn(() => ({ ...row(2), slot: 2 }));
    expect(rememberedSlotInfo(1, ["k"], one).population).toBe(1);
    expect(rememberedSlotInfo(2, ["k"], two).population).toBe(2);
    expect(rememberedSlotInfo(1, ["k"], one).population).toBe(1);
    expect(one).toHaveBeenCalledTimes(1);
  });

  it("hands out a copy, so editing a row does not change the next one", () => {
    localStorage.setItem("k", "v");
    const first = rememberedSlotInfo(1, ["k"], () => row(5));
    first.population = 99;
    const second = rememberedSlotInfo(1, ["k"], () => row(6));
    expect(second.population).toBe(5);
    second.population = 98;
    expect(rememberedSlotInfo(1, ["k"], () => row(7)).population).toBe(5);
  });

  it("reads a stored slot that failed to load again on the next open", () => {
    localStorage.setItem("k", "v");
    const unreadable: SlotInfo = { slot: 1, exists: false, present: true };
    const read = vi.fn().mockReturnValueOnce(unreadable).mockReturnValue(row(4));
    expect(rememberedSlotInfo(1, ["k"], read).exists).toBe(false);
    expect(rememberedSlotInfo(1, ["k"], read).population).toBe(4);
    expect(rememberedSlotInfo(1, ["k"], read).population).toBe(4);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("remembers a slot with nothing stored", () => {
    const read = vi.fn((): SlotInfo => ({ slot: 1, exists: false, present: false }));
    rememberedSlotInfo(1, ["k"], read);
    rememberedSlotInfo(1, ["k"], read);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reads again when the census reader is removed during a read", () => {
    localStorage.setItem("k", "v");
    setSlotPopulationReader(() => 7);
    // A census trap removes the reader in the middle of the read, as boot's trap
    // handler does, and the row still loads from another key.
    const read = vi.fn().mockImplementationOnce(() => (setSlotPopulationReader(null), row(1))).mockReturnValue(row(2));
    rememberedSlotInfo(1, ["k"], read);
    expect(rememberedSlotInfo(1, ["k"], read).population).toBe(2);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
