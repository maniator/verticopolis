import { describe, it, expect, beforeEach } from "vitest";
import { __resetSlotGuardForTest, dropUndo, forgetLiveTower, homeSlot, keepForUndo, pendingUndo, rememberHome, slotFingerprint } from "./slotGuard";

/**
 * The overwrite guard's memory: the live tower's home slot and the one step of
 * Undo. Slots are a plain map standing in for `SaveGame.slotRaw`.
 */

let stored: Map<number, string>;
const readSlot = (n: number): string | null => stored.get(n) ?? null;

beforeEach(() => {
  __resetSlotGuardForTest();
  sessionStorage.clear();
  stored = new Map();
});

describe("slotFingerprint", () => {
  it("is stable for one value and differs for values of the same length", () => {
    expect(slotFingerprint("VCZ1:abc")).toBe(slotFingerprint("VCZ1:abc"));
    expect(slotFingerprint("VCZ1:abc")).not.toBe(slotFingerprint("VCZ1:abd"));
    expect(slotFingerprint("VCZ1:abc").startsWith("8:")).toBe(true);
  });
});

describe("homeSlot", () => {
  it("names the slot remembered as home while it still holds what was there", () => {
    stored.set(2, "tower A");
    rememberHome(2, "tower A");
    expect(homeSlot(readSlot)).toBe(2);
  });

  it("stops naming it once anything else is written there, or it is emptied", () => {
    stored.set(2, "tower A");
    rememberHome(2, "tower A");
    stored.set(2, "tower B, written by another tab");
    expect(homeSlot(readSlot)).toBeNull();
    stored.delete(2);
    expect(homeSlot(readSlot)).toBeNull();
  });

  it("is null once another tower arrives, and an empty slot is never home", () => {
    stored.set(1, "tower A");
    rememberHome(1, "tower A");
    forgetLiveTower();
    expect(homeSlot(readSlot)).toBeNull();
    rememberHome(1, null);
    expect(homeSlot(readSlot)).toBeNull();
  });

  it("keeps nothing in storage, so a page load starts with no home", () => {
    stored.set(3, "tower A");
    rememberHome(3, "tower A");
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.getItem("vc-home-slot")).toBeNull();
  });
});

describe("pendingUndo", () => {
  it("offers a replace while the slot still holds what the replace wrote", () => {
    stored.set(1, "live tower");
    keepForUndo({ slot: 1, towerName: "Old", action: "replaced", raw: "old tower", left: slotFingerprint("live tower") });
    expect(pendingUndo(readSlot)).toMatchObject({ slot: 1, towerName: "Old", raw: "old tower" });
  });

  it("withdraws a replace once the slot holds anything else, so Undo never destroys a newer save", () => {
    stored.set(1, "live tower");
    keepForUndo({ slot: 1, towerName: "Old", action: "replaced", raw: "old tower", left: slotFingerprint("live tower") });
    stored.set(1, "live tower, saved again later");
    expect(pendingUndo(readSlot)).toBeNull();
  });

  it("offers a delete only while the slot stays empty", () => {
    keepForUndo({ slot: 2, towerName: "Gone", action: "deleted", raw: "gone tower", left: null });
    expect(pendingUndo(readSlot)?.action).toBe("deleted");
    stored.set(2, "a new save");
    expect(pendingUndo(readSlot)).toBeNull();
  });

  it("drops a replace when another tower arrives, since its slot holds the only copy of the tower it saved", () => {
    stored.set(1, "tower X");
    keepForUndo({ slot: 1, towerName: "Old", action: "replaced", raw: "old tower", left: slotFingerprint("tower X") });
    forgetLiveTower();
    expect(pendingUndo(readSlot)).toBeNull();
  });

  it("keeps a delete when another tower arrives, since it only refills an empty slot", () => {
    keepForUndo({ slot: 2, towerName: "Gone", action: "deleted", raw: "gone tower", left: null });
    forgetLiveTower();
    expect(pendingUndo(readSlot)?.towerName).toBe("Gone");
  });

  it("is gone after dropUndo, and a later action replaces an earlier one", () => {
    keepForUndo({ slot: 2, towerName: "First", action: "deleted", raw: "a", left: null });
    keepForUndo({ slot: 3, towerName: "Second", action: "deleted", raw: "b", left: null });
    expect(pendingUndo(readSlot)?.towerName).toBe("Second");
    dropUndo();
    expect(pendingUndo(readSlot)).toBeNull();
  });
});
