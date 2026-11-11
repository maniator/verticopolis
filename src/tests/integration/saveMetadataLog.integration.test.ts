import { describe, expect, it, beforeEach } from "vitest";
import { deflateSync, inflateSync } from "fflate";
import { draftFromSave, draftTower } from "../portKit/drafts";
import { noEngine } from "../portKit/rustEngine";
import type { SerializedGame } from "../../shared/types";
import { SaveGame } from "../../storage/SaveGame";
import { saveOf, readImport, readResult, readSlot } from "../fixtures/saveText";

/**
 * Save metadata stamps (savedAt + appVersion on every write, including
 * .vctower exports) and bulletin-log persistence (the tail rides the save and
 * restores through the trust boundary), on the Rust engine. See
 * _bmad-output/implementation-artifacts/story-save-metadata-and-log-tail.md.
 */

function decodeVctower(text: string): SerializedGame {
  const b64 = text.slice(text.indexOf("\n") + 1).trim();
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(inflateSync(bytes))) as SerializedGame;
}

describe.skipIf(noEngine)("write-time provenance stamps (savedAt + appVersion)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("serialize() itself is stamp-free (undo snapshots and crash reports carry no wall clock)", () => {
    const data = draftTower().serialize();
    expect("savedAt" in data).toBe(false);
    expect("appVersion" in data).toBe(false);
  });

  it("a localStorage save stamps both, and listSlots reads savedAt back", () => {
    const sim = draftTower();
    const before = Date.now();
    SaveGame.saveSlot(1, saveOf(sim));
    const raw = decodeSlot("simtower-clone-slot-1");
    expect(raw.savedAt).toBeGreaterThanOrEqual(before);
    expect(raw.appVersion).toMatch(/^\d+\.\d+\.\d+$/); // the Vite-injected build version
    const info = SaveGame.listSlots().find((s) => s.slot === 1)!;
    expect(info.savedAt).toBe(raw.savedAt);
  });

  it("a .vctower export stamps both (a moved file says when and by which build it was written)", async () => {
    const sim = draftTower();
    const before = Date.now();
    const file = await SaveGame.export(saveOf(sim));
    const data = decodeVctower(file);
    expect(data.savedAt).toBeGreaterThanOrEqual(before);
    expect(data.appVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("treats a forged savedAt as absent so the Saves dialog never shows Invalid Date", () => {
    const sim = draftTower();
    SaveGame.saveSlot(1, saveOf(sim));
    // Re-pack the slot with a hostile savedAt (a string) in place.
    const data = decodeSlot("simtower-clone-slot-1") as Omit<SerializedGame, "savedAt"> & { savedAt: unknown };
    data.savedAt = "yesterday";
    localStorage.setItem("simtower-clone-slot-1", repackSlot(data as unknown as SerializedGame));
    const info = SaveGame.listSlots().find((s) => s.slot === 1)!;
    expect(info.exists).toBe(true);
    expect(info.savedAt).toBeUndefined();
    // Finite but beyond what Date can represent (>8.64e15 ms) is just as
    // unrenderable: it must read as absent too.
    data.savedAt = 1e20;
    localStorage.setItem("simtower-clone-slot-1", repackSlot(data as unknown as SerializedGame));
    expect(SaveGame.listSlots().find((s) => s.slot === 1)!.savedAt).toBeUndefined();
  });

  it("listSlots reports the founded mode and in-game day for the Saves dialog", () => {
    SaveGame.saveSlot(1, saveOf(draftTower())); // classic by default
    SaveGame.saveSlot(2, saveOf(draftTower(7, "modern")));
    const slots = SaveGame.listSlots();
    const slot1 = slots.find((s) => s.slot === 1)!;
    const slot2 = slots.find((s) => s.slot === 2)!;
    expect(slot1.mode).toBe("classic");
    expect(slot2.mode).toBe("modern");
    expect(slot1.day).toBe(1); // a fresh tower is on its first day
    expect(slot2.day).toBe(1);
  });

  it("the day math holds deep into a tower's life, not just on day one", () => {
    // Pin the division, the +1, and the 1440 minutes-per-day invariant
    // (calendar.ts: a day is 1440 minutes in EVERY calendar) against a save
    // 813 full days in, mid-afternoon.
    SaveGame.saveSlot(1, saveOf(draftTower()));
    const data = decodeSlot("simtower-clone-slot-1");
    data.minutes = 813 * 1440 + 500;
    localStorage.setItem("simtower-clone-slot-1", repackSlot(data));
    expect(SaveGame.listSlots().find((s) => s.slot === 1)!.day).toBe(814);
  });

  it("a forged mode or minutes cannot reach the Saves dialog raw", () => {
    SaveGame.saveSlot(1, saveOf(draftTower()));
    const data = decodeSlot("simtower-clone-slot-1") as Omit<SerializedGame, "mode" | "minutes"> & {
      mode: unknown;
      minutes: unknown;
    };
    data.mode = "<img onerror=alert(1)>";
    const forgedDay = (minutes: unknown) => {
      data.minutes = minutes;
      localStorage.setItem("simtower-clone-slot-1", repackSlot(data as unknown as SerializedGame));
      return SaveGame.listSlots().find((s) => s.slot === 1)!;
    };
    const info = forgedDay("yesterday");
    expect(info.mode).toBe("classic"); // coerced, never the raw file string
    expect(info.day).toBeUndefined();
    // Same absent-not-clamped posture as savedAt: a negative or absurdly
    // large finite minutes must not render as a confident wrong day.
    expect(forgedDay(-5000).day).toBeUndefined();
    expect(forgedDay(1e300).day).toBeUndefined();
    expect(forgedDay(360_001 * 1440).day).toBeUndefined(); // just past the ceiling
  });

  it("loadResult surfaces the autosave's write time for the boot return-recency bucket", () => {
    const before = Date.now();
    SaveGame.save(saveOf(draftTower())); // writes the autosave slot
    const stamp = readResult().savedAt;
    expect(stamp).toBeGreaterThanOrEqual(before);
    // It agrees with the raw stamp the writer laid down.
    expect(stamp).toBe(decodeSlot("verticopolis-save").savedAt);
  });

  it("loadResult reads a forged autosave stamp as absent (same trust posture as the Saves dialog)", () => {
    SaveGame.save(saveOf(draftTower()));
    const data = decodeSlot("verticopolis-save") as Omit<SerializedGame, "savedAt"> & { savedAt: unknown };
    data.savedAt = "yesterday";
    localStorage.setItem("verticopolis-save", repackSlot(data as unknown as SerializedGame));
    expect(readResult().savedAt).toBeUndefined();
    data.savedAt = 1e20; // finite but beyond Date's range
    localStorage.setItem("verticopolis-save", repackSlot(data as unknown as SerializedGame));
    expect(readResult().savedAt).toBeUndefined();
  });

  it("the stamps are file provenance, not live state: deserialize does not carry them", () => {
    const data = { ...draftTower().serialize(), savedAt: 12345, appVersion: "9.9.9" };
    const sim = draftFromSave(data);
    // Nothing on the tower keeps them, and a re-serialize emits neither.
    const again = sim.serialize();
    expect("savedAt" in again).toBe(false);
    expect("appVersion" in again).toBe(false);
  });
});

describe.skipIf(noEngine)("bulletin-log persistence through the storage paths", () => {
  // The log's own rules (the tail and its cap, the round trip, the load's
  // hardening, the pre-log fixture) are Rust tests since #1875:
  // engine-rs/src/rule_tests/save_log.rs.
  it("the bulletin survives the REAL storage paths: slot save/load and .vctower export/import", async () => {
    localStorage.clear();
    const log = [
      { minute: 1, text: "Metro line opened.", kind: "good" },
      { minute: 2, text: "Recycling is overdue.", kind: "bad" },
    ];
    const tower = { serialize: () => ({ ...draftTower().serialize(), log }) };
    SaveGame.saveSlot(2, saveOf(tower));
    expect(readSlot(2)!.log!.map((e) => e.text)).toEqual([
      "Metro line opened.",
      "Recycling is overdue.",
    ]);
    const file = await SaveGame.export(saveOf(tower));
    const imported = await readImport(file);
    expect(imported.log!.map((e) => `${e.kind}:${e.text}`)).toEqual([
      "good:Metro line opened.",
      "bad:Recycling is overdue.",
    ]);
  });
});

function decodeSlot(key: string): SerializedGame {
  const raw = localStorage.getItem(key)!;
  const b64 = raw.slice("VCZ1:".length);
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(inflateSync(bytes))) as SerializedGame;
}

/** Re-pack a (possibly tampered) save object into the compressed slot format. */
function repackSlot(data: SerializedGame): string {
  const bytes = deflateSync(new TextEncoder().encode(JSON.stringify(data)));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return "VCZ1:" + btoa(bin);
}
