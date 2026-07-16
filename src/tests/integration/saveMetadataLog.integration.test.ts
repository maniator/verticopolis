import { describe, expect, it, beforeEach } from "vitest";
import { deflateSync, inflateSync } from "fflate";
import towerFile from "../fixtures/towerone_6.vctower?raw";
import { LOG_SAVE_CAP, Simulation } from "../../engine/Simulation";
import type { SerializedGame } from "../../engine/types";
import { SaveGame } from "../../storage/SaveGame";

/**
 * Save metadata stamps (savedAt + appVersion on every write, including
 * .vctower exports) and bulletin-log persistence (the tail rides the save and
 * restores through the trust boundary). See
 * _bmad-output/implementation-artifacts/story-save-metadata-and-log-tail.md.
 */

function decodeVctower(text: string): SerializedGame {
  const b64 = text.slice(text.indexOf("\n") + 1).trim();
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(inflateSync(bytes))) as SerializedGame;
}

describe("write-time provenance stamps (savedAt + appVersion)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("serialize() itself is stamp-free (undo snapshots and crash reports carry no wall clock)", () => {
    const data = new Simulation().serialize();
    expect("savedAt" in data).toBe(false);
    expect("appVersion" in data).toBe(false);
  });

  it("a localStorage save stamps both, and listSlots reads savedAt back", () => {
    const sim = new Simulation();
    const before = Date.now();
    SaveGame.saveSlot(1, sim);
    const raw = decodeSlot("simtower-clone-slot-1");
    expect(raw.savedAt).toBeGreaterThanOrEqual(before);
    expect(raw.appVersion).toMatch(/^\d+\.\d+\.\d+$/); // the Vite-injected build version
    const info = SaveGame.listSlots().find((s) => s.slot === 1)!;
    expect(info.savedAt).toBe(raw.savedAt);
  });

  it("a .vctower export stamps both (a moved file says when and by which build it was written)", async () => {
    const sim = new Simulation();
    const before = Date.now();
    const file = await SaveGame.export(sim);
    const data = decodeVctower(file);
    expect(data.savedAt).toBeGreaterThanOrEqual(before);
    expect(data.appVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("treats a forged savedAt as absent so the Saves dialog never shows Invalid Date", () => {
    const sim = new Simulation();
    SaveGame.saveSlot(1, sim);
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
    SaveGame.saveSlot(1, new Simulation()); // classic by default
    SaveGame.saveSlot(2, Simulation.newGame(7, "modern"));
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
    SaveGame.saveSlot(1, new Simulation());
    const data = decodeSlot("simtower-clone-slot-1");
    data.minutes = 813 * 1440 + 500;
    localStorage.setItem("simtower-clone-slot-1", repackSlot(data));
    expect(SaveGame.listSlots().find((s) => s.slot === 1)!.day).toBe(814);
  });

  it("a forged mode or minutes cannot reach the Saves dialog raw", () => {
    SaveGame.saveSlot(1, new Simulation());
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

  it("the stamps are file provenance, not live state: deserialize does not carry them", () => {
    const data = { ...new Simulation().serialize(), savedAt: 12345, appVersion: "9.9.9" };
    const sim = Simulation.deserialize(data);
    // Nothing on the sim exposes them, and a re-serialize emits neither.
    const again = sim.serialize();
    expect("savedAt" in again).toBe(false);
    expect("appVersion" in again).toBe(false);
  });
});

describe("bulletin-log persistence", () => {
  it("the log tail rides the save (newest last, capped) and an empty log contributes no key", () => {
    const sim = new Simulation();
    expect("log" in sim.serialize()).toBe(false);
    for (let i = 0; i < LOG_SAVE_CAP + 40; i++) sim.emit(`line ${i}`, i % 2 ? "good" : "info");
    const data = sim.serialize();
    expect(data.log).toHaveLength(LOG_SAVE_CAP);
    expect(data.log![LOG_SAVE_CAP - 1].text).toBe(`line ${LOG_SAVE_CAP + 39}`);
    expect(data.log![0].text).toBe("line 40");
  });

  it("save/load round-trips the bulletin, and logSeq stays transient (no toast replay)", () => {
    const sim = new Simulation();
    sim.emit("VIP arriving Thursday.", "info");
    sim.emit("Office leased.", "good");
    const loaded = Simulation.deserialize(sim.serialize());
    expect(loaded.log.map((e) => e.text)).toEqual(["VIP arriving Thursday.", "Office leased."]);
    expect(loaded.log.map((e) => e.kind)).toEqual(["info", "good"]);
    expect(loaded.logSeq).toBe(0); // the UI rebases on adopt; restored lines never toast
  });

  it("serialized entries are copies: mutating the live log later cannot rewrite a held snapshot", () => {
    const sim = new Simulation();
    sim.emit("original", "info");
    const data = sim.serialize();
    sim.log[0].text = "mutated";
    expect(data.log![0].text).toBe("original");
  });

  it("the bulletin survives the REAL storage paths: slot save/load and .vctower export/import", async () => {
    localStorage.clear();
    const sim = new Simulation();
    sim.emit("Metro line opened.", "good");
    sim.emit("Recycling is overdue.", "bad");
    SaveGame.saveSlot(2, sim);
    expect(SaveGame.loadSlot(2)!.log.map((e) => e.text)).toEqual([
      "Metro line opened.",
      "Recycling is overdue.",
    ]);
    const file = await SaveGame.export(sim);
    const imported = await SaveGame.import(file);
    expect(imported.log.map((e) => `${e.kind}:${e.text}`)).toEqual([
      "good:Metro line opened.",
      "bad:Recycling is overdue.",
    ]);
  });

  it("junk padding after real entries cannot evict them: the newest VALID entries restore", () => {
    const base = new Simulation().serialize();
    const log = [
      { minute: 1, text: "real one", kind: "info" },
      { minute: 2, text: "real two", kind: "good" },
      ...Array.from({ length: 400 }, () => null),
    ];
    const restored = Simulation.deserialize({ ...base, log } as unknown as SerializedGame).log;
    expect(restored.map((e) => e.text)).toEqual(["real one", "real two"]);
  });

  it("truncation never tears an astral character in half", () => {
    const base = new Simulation().serialize();
    // 399 ASCII chars, then an emoji whose surrogate pair straddles index 400.
    const text = "x".repeat(399) + "\u{1F3D7}\u{1F3D7}";
    const restored = Simulation.deserialize({
      ...base,
      log: [{ minute: 0, text, kind: "info" }],
    } as unknown as SerializedGame).log;
    expect(restored[0].text).toHaveLength(399); // the torn high surrogate is dropped
    expect(restored[0].text[398]).toBe("x");
  });

  it("undo snapshots carry the log, so an undo no longer wipes the bulletin", () => {
    const sim = new Simulation();
    sim.emit("before the mistake", "info");
    const snap = JSON.stringify(sim.serialize()); // exactly what UndoHistory stores
    const restored = Simulation.deserialize(JSON.parse(snap) as SerializedGame);
    expect(restored.log.map((e) => e.text)).toEqual(["before the mistake"]);
  });

  it("the save cap equals the ring cap, so an undo never trims scrollback", () => {
    // Regression for the deferred review finding: with LOG_SAVE_CAP below the
    // ring cap, undoing while the ring held more entries silently dropped the
    // older lines. Overfill the ring so the test pins EQUALITY: the live
    // ring's own length must equal LOG_SAVE_CAP (that IS the ruling), and
    // everything the ring holds survives the round trip. All expectations
    // derive from the constant so the test tracks the contract, not a number.
    const overflow = 50;
    const total = LOG_SAVE_CAP + overflow;
    const sim = new Simulation();
    for (let i = 0; i < total; i++) sim.emit(`line ${i}`, "info");
    expect(sim.log).toHaveLength(LOG_SAVE_CAP); // ring cap == save cap, the ruling itself
    const snap = JSON.stringify(sim.serialize());
    const restored = Simulation.deserialize(JSON.parse(snap) as SerializedGame);
    expect(restored.log.map((e) => e.text)).toEqual(sim.log.map((e) => e.text));
    expect(restored.log[0].text).toBe(`line ${overflow}`);
    expect(restored.log[LOG_SAVE_CAP - 1].text).toBe(`line ${total - 1}`);
  });

  it("serialize's own tail slice keeps the newest entries even past the cap", () => {
    // The live ring normally keeps log.length at the cap, which would leave
    // the serialize slice untestable; hand-build an over-cap log to pin the
    // slice contract (newest LOG_SAVE_CAP entries, in order) independently
    // of the ring, so the two caps can never silently diverge again. The
    // expectations derive from the constant so they track the contract.
    const overflow = 50;
    const total = LOG_SAVE_CAP + overflow;
    const sim = new Simulation();
    sim.log = Array.from({ length: total }, (_, i) => ({ minute: i, text: `hand ${i}`, kind: "info" as const }));
    const data = sim.serialize();
    expect(data.log).toHaveLength(LOG_SAVE_CAP);
    expect(data.log![0].text).toBe(`hand ${overflow}`);
    expect(data.log![LOG_SAVE_CAP - 1].text).toBe(`hand ${total - 1}`);
  });

  it("hardens hostile log input: junk drops, text truncates, kinds and minutes coerce, count caps", () => {
    const base = new Simulation().serialize();
    const forged = (log: unknown) =>
      Simulation.deserialize({ ...base, log } as unknown as SerializedGame).log;
    expect(forged("not an array")).toEqual([]);
    expect(forged(42)).toEqual([]);
    expect(forged([null, 7, "line", [], { minute: 3 }])).toEqual([]); // no string text anywhere
    const one = forged([
      { minute: NaN, text: "x".repeat(10_000), kind: "explosive" },
      { minute: 12, text: 99, kind: "good" }, // numeric text: dropped
    ]);
    expect(one).toHaveLength(1);
    expect(one[0].minute).toBe(0);
    expect(one[0].text).toHaveLength(400);
    expect(one[0].kind).toBe("info");
    const flood = forged(Array.from({ length: 100_000 }, (_, i) => ({ minute: i, text: `l${i}`, kind: "info" })));
    expect(flood).toHaveLength(300); // the live ring cap, newest kept
    expect(flood[299].text).toBe("l99999");
  });

  it("the pre-log fixture loads with only the one-time Classic pricing-snap bulletin", () => {
    const data = decodeVctower(towerFile);
    expect("log" in data).toBe(false);
    // The v5 -> v6 party-hall migration relocates this fixture's basement hall
    // into a free two-story slot (it does not drop it), so it emits nothing.
    // This pre-split Classic fixture's rents DO snap onto the canon ladder,
    // though, so the load posts exactly the pinned snap bulletin (with the
    // condo callout: the fixture holds condos), once: a second round-trip
    // finds everything already on rungs and adds no new line.
    const first = Simulation.deserialize(data);
    expect(first.log.map((e) => e.text)).toEqual([
      "Classic pricing: rents snapped to the four 1994 rate levels. Condos can now sell for as little as $50,000.",
    ]);
    expect(first.log[0].kind).toBe("info"); // bulletin-only, never a toast
    const again = Simulation.deserialize(first.serialize());
    expect(again.log.map((e) => e.text)).toEqual(first.log.map((e) => e.text));
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
