import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeStored, expectedRow, readSeeds, rowMatches, storedForm } from "../build/rollbackRehearsalStore.ts";

/** The pure parts of the rollback rehearsal's browser half (#1221); the page driving is exercised by the dry run in the procedure doc. */
describe("rollback rehearsal browser helpers", () => {
  it("alternates .vctower and .TDT towers so the autosave and the slots carry both kinds", () => {
    const dir = mkdtempSync(join(tmpdir(), "rr-seeds-"));
    mkdirSync(dir, { recursive: true });
    for (const name of ["MYTOWER.TDT.json", "TOWER1.TDT.json", "TOWER2.TDT.json", "split-tower.vctower.json", "towerone.vctower.json"]) writeFileSync(join(dir, name), JSON.stringify({ towerName: name }));
    const seeds = readSeeds(dir);
    expect(seeds.map((s) => s.name)).toEqual(["split-tower.vctower.json", "MYTOWER.TDT.json", "towerone.vctower.json", "TOWER1.TDT.json"]);
    expect(seeds.map((s) => s.label)).toEqual(["Auto-save", "Slot 1", "Slot 2", "Slot 3"]);
  });

  it("stores a save in the game's form and reads it back, stamped", () => {
    const stored = storedForm({ towerName: "A", money: 5 }, "2.77.5", 123);
    expect(stored.startsWith("VCZ1:")).toBe(true);
    expect(decodeStored(stored)).toEqual({ towerName: "A", money: 5, savedAt: 123, appVersion: "2.77.5" });
    expect(decodeStored("not json")).toBeUndefined();
    expect(decodeStored(null)).toBeUndefined();
  });

  it("predicts the picker row from a save", () => {
    expect(expectedRow({ towerName: "Hotel", money: 1234567, minutes: 1440 * 3 })).toEqual({ name: "Hotel", funds: "$1,234,567", day: "Day 4" });
    expect(expectedRow({})).toEqual({ name: "Tower", funds: "$0", day: "Day 1" });
  });

  it("matches whole values only, so a different day or funds figure fails the row", () => {
    const expected = { name: "Hotel", funds: "$5,000", day: "Day 1" };
    expect(rowMatches("Auto-save Hotel $5,000 Day 1 12:00", expected)).toBe(true);
    expect(rowMatches("Auto-save Hotel $15,000 Day 1", expected)).toBe(false);
    expect(rowMatches("Auto-save Hotel $5,000 Day 12", expected)).toBe(false);
    expect(rowMatches("Auto-save Hotel $5,000.50 Day 1", expected)).toBe(false);
    expect(rowMatches("Auto-save Towerone $5,000 Day 1", { ...expected, name: "Tower" })).toBe(false);
    expect(rowMatches("Auto-save Tower $5,000 Day 1", { ...expected, name: "Tower" })).toBe(true);
    expect(rowMatches("Auto-save Hotel $5,000 Day 1 (it couldn't be read)", expected)).toBe(false);
  });
});
