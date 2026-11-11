import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { deflateSync } from "fflate";
import { draftTower, type Draft } from "../portKit/drafts";
import { LOT_WIDTH } from "../portKit/draftFixtures";
import { SaveGame } from "../../storage/SaveGame";
import { toBase64, deflate } from "../../storage/saveCompression";
import { saveOf, loadAuto, importTower, readAuto, readImport, readResult, readSlot } from "../fixtures/saveText";
import { noEngine } from "../portKit/rustEngine";

/** A check of the engine's load of the stored save, skipped where no engine package is built. */
const itEngine = it.skipIf(noEngine);

describe.skipIf(noEngine)("SaveGame", () => {
  beforeEach(() => localStorage.clear());
  // Several compression tests stub browser stream globals; always restore them
  // so later export/import tests see the real environment.
  afterEach(() => vi.unstubAllGlobals());

  /** Rename the tower through the engine's own setter. */
  const nameTower = (sim: Draft, name: string): void => (sim.port as unknown as { setTowerName(name: string): void }).setTowerName(name);

  /** A played tower on the Rust engine: the seeded lobby, floor 2 over part
   *  of it, an elevator, an office and five hours of play. */
  function sampleGame(): Draft {
    const sim = draftTower(42);
    const x0 = Math.floor(LOT_WIDTH / 2) - 20;
    for (let x = x0; x < x0 + 40; x++) sim.tower.place("lobby", 1, x);
    for (let i = 0; i < 12; i++) sim.tower.place("floor", 2, x0 + i);
    sim.buildTransport("elevatorStandard", x0, 1, 2);
    sim.build("office", 2, x0);
    sim.money = 1234567;
    sim.tick(60 * 5);
    return sim;
  }

  // What a load does with a tampered save (forged fields, ids, geometry,
  // overlaps, the unit cap) is a Rust test since #1875:
  // engine-rs/src/rule_tests/save_hardening.rs.

  it("a storage-layer quota throw propagates out of saveSlot (the manual-save catch depends on it)", () => {
    // Pins the OTHER half of the #537 AC at the localStorage layer: appModals
    // catches what SaveGame.saveSlot lets through, so a swallow added inside
    // writeSlot's non-autosave path would break the slot-save failure toast
    // without this test noticing at the mock layer.
    const sim = sampleGame();
    const realSetItem = localStorage.setItem.bind(localStorage);
    const setSpy = vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key.includes("slot")) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      return realSetItem(key, value);
    });
    try {
      expect(() => SaveGame.saveSlot(2, saveOf(sim))).toThrow(/quota/i);
    } finally {
      setSpy.mockRestore();
    }
  });

  itEngine("round-trips through localStorage into the engine", () => {
    const sim = sampleGame();
    SaveGame.save(saveOf(sim));
    expect(SaveGame.hasSave()).toBe(true);
    const loaded = loadAuto()!;
    expect(loaded).not.toBeNull();
    expect(loaded.money).toBe(sim.money);
    expect(loaded.clock.minutes).toBe(sim.clock.minutes);
    expect(loaded.tower.units.length).toBe(sim.tower.units.length);
    expect(loaded.tower.transports.length).toBe(sim.tower.transports.length);
  });

  itEngine("preserves occupancy lookups after load", () => {
    const sim = sampleGame();
    SaveGame.save(saveOf(sim));
    const loaded = loadAuto()!;
    const x0 = Math.floor(LOT_WIDTH / 2) - 20;
    expect(loaded.tower.unitAt(2, x0)).toBeDefined();
  });

  // Mirrors SaveGame's internal autosave keys so tests can inspect raw stored values.
  const AUTO_KEY = "verticopolis-save";
  const LEGACY_AUTO_KEY = "simtower-clone-save";

  it("stores autosaves COMPRESSED (tagged, and smaller than the raw JSON), not as a giant blob", () => {
    const sim = sampleGame();
    SaveGame.save(saveOf(sim));
    const raw = localStorage.getItem(AUTO_KEY)!;
    // The stored value is the compression marker + payload, never raw JSON.
    expect(raw.startsWith("VCZ1:")).toBe(true);
    expect(raw.startsWith("{")).toBe(false);
    expect(raw.length).toBeLessThan(JSON.stringify(sim.serialize()).length);
    // …and it still round-trips back to the same tower.
    expect(readAuto()!.money).toBe(sim.money);
  });

  it("async autosave writes the same compressed localStorage format", async () => {
    const sim = sampleGame();
    sim.money = 765_432;
    await SaveGame.saveAsync(saveOf(sim));
    const raw = localStorage.getItem(AUTO_KEY)!;
    expect(raw.startsWith("VCZ1:")).toBe(true);
    expect(readAuto()!.money).toBe(765_432);
  });

  it("async autosave falls back to the synchronous writer when native compression is unavailable", async () => {
    vi.stubGlobal(
      "CompressionStream",
      class {
        constructor() {
          throw new TypeError("Unsupported format: deflate-raw");
        }
      },
    );
    const sim = sampleGame();
    sim.money = 246_810;
    await SaveGame.saveAsync(saveOf(sim));
    expect(localStorage.getItem(AUTO_KEY)!.startsWith("VCZ1:")).toBe(true);
    expect(readAuto()!.money).toBe(246_810);
  });

  it("async autosave only requires native compression, not native decompression", async () => {
    vi.stubGlobal(
      "DecompressionStream",
      class {
        constructor() {
          throw new TypeError("Unsupported format: deflate-raw");
        }
      },
    );
    const sim = sampleGame();
    sim.money = 135_790;
    await SaveGame.saveAsync(saveOf(sim));
    expect(readAuto()!.money).toBe(135_790);
  });

  it("does not let an older async autosave overwrite a newer synchronous save", async () => {
    let captured: Uint8Array | undefined;
    let release!: () => void;
    class SlowCompressionStream {
      readable: ReadableStream<Uint8Array>;
      writable: WritableStream<Uint8Array>;

      constructor() {
        this.readable = new ReadableStream<Uint8Array>({
          async start(controller) {
            await new Promise<void>((resolve) => (release = resolve));
            controller.enqueue(deflateSync(captured!));
            controller.close();
          },
        });
        this.writable = new WritableStream<Uint8Array>({
          write(chunk) {
            captured = chunk;
          },
        });
      }
    }
    vi.stubGlobal("CompressionStream", SlowCompressionStream);
    vi.stubGlobal("DecompressionStream", class {});

    const stale = sampleGame();
    stale.money = 100;
    const pending = SaveGame.saveAsync(saveOf(stale));
    await vi.waitFor(() => expect(captured).toBeDefined());

    const fresh = sampleGame();
    fresh.money = 200;
    SaveGame.save(saveOf(fresh));
    release();
    await pending;

    expect(readAuto()!.money).toBe(200);
  });

  it("a manual SLOT save does not cancel an in-flight async autosave commit", async () => {
    let captured: Uint8Array | undefined;
    let release!: () => void;
    class SlowCompressionStream {
      readable: ReadableStream<Uint8Array>;
      writable: WritableStream<Uint8Array>;

      constructor() {
        this.readable = new ReadableStream<Uint8Array>({
          async start(controller) {
            await new Promise<void>((resolve) => (release = resolve));
            controller.enqueue(deflateSync(captured!));
            controller.close();
          },
        });
        this.writable = new WritableStream<Uint8Array>({
          write(chunk) {
            captured = chunk;
          },
        });
      }
    }
    vi.stubGlobal("CompressionStream", SlowCompressionStream);
    vi.stubGlobal("DecompressionStream", class {});

    const auto = sampleGame();
    auto.money = 111;
    const pending = SaveGame.saveAsync(saveOf(auto));
    await vi.waitFor(() => expect(captured).toBeDefined());

    // Writes a DIFFERENT key, so the pending autosave must still commit.
    const manual = sampleGame();
    manual.money = 222;
    SaveGame.saveSlot(1, saveOf(manual));
    release();
    await pending;

    expect(readAuto()!.money).toBe(111); // autosave landed, not cancelled
    expect(readSlot(1)!.money).toBe(222); // slot save intact
  });

  it("propagates direct async save failures to callers", async () => {
    const saveToAsync = vi.spyOn(SaveGame, "saveToAsync").mockRejectedValueOnce(new Error("write failed"));
    try {
      await expect(SaveGame.saveAsync(saveOf(sampleGame()))).rejects.toThrow(/write failed/);
    } finally {
      saveToAsync.mockRestore();
    }
  });

  // Chunked base64 of raw bytes (mirrors SaveGame's own encoder) for the
  // decompression-bomb fixtures below.
  const b64 = (bytes: Uint8Array): string => {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };

  it("the 32MB inflate cap — not just a downstream JSON.parse failure — is what rejects an over-cap save", () => {
    // A VALID, fully loadable save whose JSON inflates PAST the 32MB cap. Without
    // the cap this decodes to real JSON and loads fine, so a null result proves
    // inflateCapped aborted the inflation itself (it never allocates the whole
    // output or hangs) — distinguishing the cap from the downstream JSON.parse.
    const sim = sampleGame();
    const data = { ...sim.serialize(), savedAt: 1, filler: "x".repeat(33 * 1024 * 1024) }; // > 32MB inflated
    const packed = deflateSync(new TextEncoder().encode(JSON.stringify(data)));
    localStorage.setItem(AUTO_KEY, "VCZ1:" + b64(packed));
    expect(readAuto()).toBeNull(); // the cap fired (the payload alone is valid + loadable)
  });

  it("degrades a truncated / garbage compressed save to null — no crash, no partial tower", () => {
    // Corrupt deflate either makes fflate throw or yields bytes JSON.parse
    // rejects; either way readSlot catches it and returns null, so the player
    // never loads a half-decoded tower.
    const sim = sampleGame();
    SaveGame.save(saveOf(sim));
    const body = localStorage.getItem(AUTO_KEY)!.slice("VCZ1:".length);
    localStorage.setItem(AUTO_KEY, "VCZ1:" + body.slice(0, Math.floor(body.length / 2))); // truncated payload
    expect(readAuto()).toBeNull();
    localStorage.setItem(AUTO_KEY, "VCZ1:" + btoa("not a deflate stream at all")); // outright garbage
    expect(readAuto()).toBeNull();
  });

  it("loadResult distinguishes an absent save from a present-but-unreadable one (for an honest boot)", () => {
    // Absent → not corrupt, no sim, no write time.
    expect(readResult()).toEqual({ save: null, corrupt: false, savedAt: undefined });

    // A real save → readable, not corrupt, and its write time comes back for the
    // boot recency bucket (no second decode of the slot).
    const sim = sampleGame();
    const before = Date.now();
    SaveGame.save(saveOf(sim));
    const ok = readResult();
    expect(ok.corrupt).toBe(false);
    expect(ok.save?.money).toBe(sim.money);
    expect(ok.savedAt).toBeGreaterThanOrEqual(before);

    // Present but undecodable → corrupt (so boot warns instead of a silent fresh start).
    localStorage.setItem(AUTO_KEY, "VCZ1:" + btoa("not a deflate stream at all"));
    expect(readResult()).toEqual({ save: null, corrupt: true, savedAt: undefined });
    expect(SaveGame.hasSave()).toBe(true); // …yet the key IS present — the exact trap this guards
  });

  it("preserveUnreadable copies unreadable bytes to a backup key so autosave can't clobber a recoverable save", () => {
    const UNREADABLE_KEY = "simtower-clone-unreadable"; // mirrors the internal backup key
    // Nothing to preserve when the slot is empty.
    SaveGame.preserveUnreadable();
    expect(localStorage.getItem(UNREADABLE_KEY)).toBeNull();

    // An unreadable (e.g. newer-format) save is copied verbatim, byte for byte.
    const unreadable = "VCZ1:" + btoa("from a newer build we can't decode here");
    localStorage.setItem(AUTO_KEY, unreadable);
    SaveGame.preserveUnreadable();
    expect(localStorage.getItem(UNREADABLE_KEY)).toBe(unreadable); // recoverable later
    expect(localStorage.getItem(AUTO_KEY)).toBe(unreadable); // original left in place
  });

  it("preserveUnreadable says whether the bytes are kept, and leaves a stash that already holds them alone", () => {
    const KEY = "simtower-clone-unreadable";
    expect(SaveGame.preserveUnreadable()).toBe(false); // nothing to keep
    localStorage.setItem(AUTO_KEY, "VCZ1:abc");
    const write = vi.spyOn(localStorage, "setItem");
    expect(SaveGame.preserveUnreadable()).toBe(true);
    expect(SaveGame.preserveUnreadable()).toBe(true);
    expect(write.mock.calls.filter(([k]) => k === KEY)).toHaveLength(1); // the second call wrote nothing
    write.mockRestore();
    // A full quota reports the loss instead of pretending the bytes are safe.
    localStorage.removeItem(KEY);
    const full = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    try {
      expect(SaveGame.preserveUnreadable()).toBe(false);
    } finally {
      full.mockRestore();
    }
  });

  it("a damaged autosave never replaces a stash that holds a different save, a newer one does", () => {
    const KEY = "simtower-clone-unreadable";
    localStorage.setItem(KEY, "VCZ1:first");
    localStorage.setItem(AUTO_KEY, "VCZ1:second");
    expect(SaveGame.preserveUnreadable()).toBe(false);
    expect(localStorage.getItem(KEY)).toBe("VCZ1:first");
    expect(SaveGame.preserveUnreadable(AUTO_KEY, true)).toBe(true);
    expect(localStorage.getItem(KEY)).toBe("VCZ1:second");
  });

  it("a stash that is only the VCZ1 prefix downloads as stored, not as an empty tower file", () => {
    localStorage.setItem("simtower-clone-unreadable", "VCZ1:");
    expect(SaveGame.unreadableBackup()).toBe("VCZ1:");
  });

  it("the kept save downloads as a .vctower file the game can import once updated", async () => {
    const sim = sampleGame();
    sim.money = 424_242;
    const stored = SaveGame.packSync(saveOf(sim));
    localStorage.setItem(AUTO_KEY, stored);
    SaveGame.preserveUnreadable();
    const file = SaveGame.unreadableBackup()!;
    expect(file.startsWith("VCTOWER1\n")).toBe(true);
    expect(file.endsWith("\n")).toBe(true);
    expect((await readImport(file)).money).toBe(424_242);
    // Text that is not a compressed store value comes back as stored.
    localStorage.setItem("simtower-clone-unreadable", "plain text");
    expect(SaveGame.unreadableBackup()).toBe("plain text");
  });

  it("falls back to a healthy legacy save when the Verticopolis autosave is unreadable, and still flags corruption", () => {
    const sim = sampleGame();
    sim.money = 555_555;
    localStorage.setItem(LEGACY_AUTO_KEY, JSON.stringify({ ...sim.serialize(), savedAt: 123 }));
    localStorage.setItem(AUTO_KEY, "VCZ1:not-actually-deflate");
    const boot = readResult();
    expect(boot.save).not.toBeNull(); // the legacy tower is rescued...
    expect(boot.save!.money).toBe(555_555);
    expect(boot.corrupt).toBe(true); // ...while boot still preserves + warns
    // The write time comes from the tower that ACTUALLY loaded (the legacy key),
    // not the unreadable primary, so the boot recency bucket stays honest.
    expect(boot.savedAt).toBe(123);
  });

  it("does not consult the legacy key (or flag corruption) when the Verticopolis autosave reads fine", () => {
    const sim = sampleGame();
    sim.money = 777_777;
    SaveGame.save(saveOf(sim));
    localStorage.setItem(LEGACY_AUTO_KEY, "VCZ1:garbage-stale-legacy");
    const boot = readResult();
    expect(boot.save!.money).toBe(777_777);
    expect(boot.corrupt).toBe(false);
  });

  it("restores the legacy key when the quota-pressure retry also fails", () => {
    // Both keys exist and the origin's quota stays exhausted even after the
    // legacy key is dropped: the write must fail WITHOUT destroying the legacy
    // value, which an unreadable primary falls back to at load.
    const sim = sampleGame();
    SaveGame.save(saveOf(sim));
    const legacyValue = JSON.stringify({ ...sim.serialize(), savedAt: 123 });
    localStorage.setItem(LEGACY_AUTO_KEY, legacyValue);
    const realSetItem = localStorage.setItem.bind(localStorage);
    const setSpy = vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key === AUTO_KEY) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      return realSetItem(key, value);
    });
    try {
      expect(() => SaveGame.save(saveOf(sim))).toThrow(/quota/i);
      expect(localStorage.getItem(LEGACY_AUTO_KEY)).toBe(legacyValue); // restored, not lost
    } finally {
      setSpy.mockRestore();
    }
  });

  it("loads a legacy autosave key and rewrites future saves to the Verticopolis key", () => {
    const sim = sampleGame();
    localStorage.setItem(LEGACY_AUTO_KEY, JSON.stringify({ ...sim.serialize(), savedAt: 123 }));
    expect(SaveGame.hasSave()).toBe(true);
    expect(readAuto()!.money).toBe(sim.money);

    const loaded = readAuto()!;
    loaded.money = 333_333;
    SaveGame.save(JSON.stringify(loaded));
    expect(localStorage.getItem(AUTO_KEY)).not.toBeNull();
    expect(readAuto()!.money).toBe(333_333);
  });

  it("removes the legacy autosave key before migrating so quota can be reclaimed", () => {
    const sim = sampleGame();
    localStorage.setItem(LEGACY_AUTO_KEY, JSON.stringify({ ...sim.serialize(), savedAt: 123 }));
    const realSetItem = localStorage.setItem.bind(localStorage);
    const setSpy = vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key === AUTO_KEY && localStorage.getItem(LEGACY_AUTO_KEY) !== null) {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      }
      return realSetItem(key, value);
    });
    try {
      expect(() => SaveGame.save(saveOf(sim))).not.toThrow();
      expect(localStorage.getItem(LEGACY_AUTO_KEY)).toBeNull();
      expect(localStorage.getItem(AUTO_KEY)).not.toBeNull();
    } finally {
      setSpy.mockRestore();
    }
  });

  it("retries the autosave write after dropping a coexisting legacy key when quota is tight", () => {
    // Both keys can coexist (multi-tab, or an older build re-writing the
    // legacy key after migration). A quota-tight write must reclaim the stale
    // legacy duplicate and retry rather than fail the autosave.
    const sim = sampleGame();
    SaveGame.save(saveOf(sim)); // AUTO_KEY now populated
    localStorage.setItem(LEGACY_AUTO_KEY, JSON.stringify({ ...sim.serialize(), savedAt: 123 }));
    const realSetItem = localStorage.setItem.bind(localStorage);
    const setSpy = vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key === AUTO_KEY && localStorage.getItem(LEGACY_AUTO_KEY) !== null) {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      }
      return realSetItem(key, value);
    });
    try {
      sim.money = 424_242;
      expect(() => SaveGame.save(saveOf(sim))).not.toThrow();
      expect(localStorage.getItem(LEGACY_AUTO_KEY)).toBeNull();
      expect(readAuto()!.money).toBe(424_242);
    } finally {
      setSpy.mockRestore();
    }
  });

  it("still loads a legacy uncompressed (raw-JSON) save, then upgrades it to compressed on the next save", () => {
    const sim = sampleGame();
    localStorage.setItem(AUTO_KEY, JSON.stringify({ ...sim.serialize(), savedAt: 123 }));
    expect(localStorage.getItem(AUTO_KEY)!.startsWith("{")).toBe(true); // legacy: raw JSON, no marker

    const loaded = readAuto()!;
    expect(loaded.money).toBe(sim.money); // old save still readable

    SaveGame.save(JSON.stringify(loaded)); // re-saving migrates it forward
    expect(localStorage.getItem(AUTO_KEY)!.startsWith("VCZ1:")).toBe(true);
  });

  it("listSlots reads compressed slots — name / star / savedAt survive the round-trip", () => {
    const sim = sampleGame();
    nameTower(sim, "Compressed Tower");
    SaveGame.saveSlot(1, saveOf(sim));
    const info = SaveGame.listSlots().find((s) => s.slot === 1)!;
    expect(info.exists).toBe(true);
    expect(info.towerName).toBe("Compressed Tower");
    expect(info.funds).toBe(sim.money);
    expect(info.savedAt).toBeGreaterThan(0);
  });

  it("listSlots tells an EMPTY slot from a present-but-unreadable one", () => {
    // SPEC-splash-load-tower CAP-2. `exists` is parse-based and reads false for
    // both, so only the raw `present` flag separates "nothing was ever here"
    // from "a tower is here that this build cannot read". The title screen's
    // picker keys its rows on that difference: hiding an unreadable slot would
    // claim the tower is gone while the bytes are still on disk, which is the
    // very thing preserveUnreadable exists to prevent.
    SaveGame.saveSlot(1, saveOf(sampleGame()));
    localStorage.setItem("simtower-clone-slot-2", "VCZ1:not-actually-base64-deflate");
    const slots = SaveGame.listSlots();
    const at = (n: number | "auto") => slots.find((s) => s.slot === n)!;

    expect(at(1)).toMatchObject({ exists: true, present: true }); // readable
    expect(at(2)).toMatchObject({ exists: false, present: true }); // unreadable
    expect(at(3)).toMatchObject({ exists: false, present: false }); // empty
  });

  it("the autosave row describes what load() would actually do across BOTH keys", () => {
    // Partial migration / multi-tab divergence: the current key is present but
    // undecodable while the legacy key holds a healthy tower. loadResult falls
    // back and opens it, so the picker's Auto-save row must offer it too.
    // Reading only the key autosaveKey() picks would label the row unreadable
    // and give it no Load control, while Continue one row above opens that same
    // tower fine.
    const sim = sampleGame();
    nameTower(sim, "Legacy Rescue");
    SaveGame.save(saveOf(sim)); // writes the current key
    localStorage.setItem("simtower-clone-save", localStorage.getItem("verticopolis-save")!);
    localStorage.setItem("verticopolis-save", "VCZ1:not-actually-base64-deflate");

    expect(readAuto()!.towerName).toBe("Legacy Rescue"); // the fallback works
    const auto = SaveGame.listSlots().find((s) => s.slot === "auto")!;
    expect(auto).toMatchObject({ exists: true, present: true, towerName: "Legacy Rescue" });
  });

  it("the autosave row reads unreadable when BOTH keys are present and neither parses", () => {
    localStorage.setItem("verticopolis-save", "VCZ1:garbage");
    localStorage.setItem("simtower-clone-save", "VCZ1:also-garbage");
    const auto = SaveGame.listSlots().find((s) => s.slot === "auto")!;
    expect(auto).toMatchObject({ exists: false, present: true });
  });

  it("exports a .vctower container (magic line + packed payload, not raw JSON) and imports it back", async () => {
    const sim = sampleGame();
    const file = await SaveGame.export(saveOf(sim));
    // The made-up format: first line is the magic, and the body is NOT
    // copy-paste JSON anymore.
    expect(file.startsWith("VCTOWER1\n")).toBe(true);
    expect(() => JSON.parse(file)).toThrow();
    const loaded = await readImport(file);
    expect(loaded.money).toBe(sim.money);
    expect(loaded.star).toBe(sim.star);
  });

  it("exports files smaller than the old pretty-printed JSON format", async () => {
    const sim = sampleGame();
    const file = await SaveGame.export(saveOf(sim));
    const oldFormat = JSON.stringify(sim.serialize(), null, 2);
    // The whole point of the compressed container: a fraction of the JSON it
    // replaced, not just marginally under it.
    expect(file.length).toBeLessThan(oldFormat.length / 2);
  });

  it("names the export file after the tower", () => {
    expect(SaveGame.exportFilename("Naftali's Tower #1")).toBe("naftali-s-tower-1.vctower");
    expect(SaveGame.exportFilename("✨✨")).toBe("tower.vctower"); // slugs to nothing, so the fallback
  });

  it("rejects a raw-JSON tower export — only .vctower containers import now", async () => {
    const sim = sampleGame();
    await expect(readImport(JSON.stringify(sim.serialize(), null, 2))).rejects.toThrow(/not a verticopolis tower file/i);
  });

  it("rejects malformed imports", async () => {
    await expect(readImport("{}")).rejects.toThrow();
    await expect(readImport("not json")).rejects.toThrow();
    await expect(readImport("[1,2,3]")).rejects.toThrow(); // no VCTOWER magic → not a tower file
    // A magic line over a garbage body must fail loudly, not half-load.
    await expect(readImport("VCTOWER1\n@@not base64@@")).rejects.toThrow();
    await expect(readImport("VCTOWER1\n" + btoa("[1,2,3]"))).rejects.toThrow();
  });

  it("reports a recognized-but-broken tower file as damaged, not as 'not a tower file'", async () => {
    // Valid base64 over bytes that are not a deflate stream.
    await expect(readImport("VCTOWER1\n" + btoa('{"minutes":'))).rejects.toThrow(/damaged/);
    // A truncated real export: recognized container, broken payload.
    const file = await SaveGame.export(saveOf(sampleGame()));
    await expect(readImport(file.slice(0, Math.floor(file.length / 2)))).rejects.toThrow(/damaged/);
  });

  it("tells the player to update when the file comes from a newer container version", async () => {
    await expect(readImport("VCTOWER2\n" + btoa("{}"))).rejects.toThrow(/newer version/);
  });

  it("rejects a decompression bomb with a 'too large' message, not 'damaged'", async () => {
    // Build a legitimate deflate-raw stream whose OUTPUT is just past the 32MB
    // cap every save reader shares (MAX_SAVE_INFLATED_BYTES), from a tiny
    // compressed input: a real bomb (corrupt bytes land on the 'damaged'
    // path instead). 33MB of zeros packs to a few KB, and sits in the
    // band the import used to accept at a 64MB cap while the store refused it.
    const huge = new Uint8Array(33 * 1024 * 1024); // all zeros, highly compressible
    const cs: GenericTransformStream = new CompressionStream("deflate-raw");
    const packed = new Uint8Array(
      await new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(huge);
            c.close();
          },
        }).pipeThrough(cs),
      ).arrayBuffer(),
    );
    // Chunked btoa (matches SaveGame's own encoder — no node Buffer in the browser).
    let bin = "";
    for (let i = 0; i < packed.length; i += 0x8000) bin += String.fromCharCode(...packed.subarray(i, i + 0x8000));
    await expect(readImport("VCTOWER1\n" + btoa(bin))).rejects.toThrow(/too large/);
  });

  describe("when the browser lacks the compression API", () => {
    // deflate-raw is a 2022+ browser feature; on an older browser the import
    // of a compressed file must fail with an honest "your browser is too old"
    // message, not a silent failure and not "this file is damaged" (which
    // would blame a perfectly good save). Import needs only the decoder;
    // export compresses with fflate, so it needs neither direction.
    afterEach(() => vi.unstubAllGlobals());
    const broken = class {
      constructor() {
        throw new TypeError("Unsupported format: deflate-raw");
      }
    };
    const breakEncode = () => vi.stubGlobal("CompressionStream", broken);
    const breakDecode = () => vi.stubGlobal("DecompressionStream", broken);

    it("export works without the compression API", async () => {
      breakEncode();
      breakDecode();
      const file = await SaveGame.export(saveOf(sampleGame()));
      vi.unstubAllGlobals();
      expect((await readImport(file)).money).toBe(sampleGame().money);
    });

    it("importing a compressed file reports the browser is too old, not 'damaged'", async () => {
      // A real, healthy container built while compression WAS available.
      const file = await SaveGame.export(saveOf(sampleGame()));
      breakDecode();
      await expect(readImport(file)).rejects.toThrow(/too old to open/);
    });

    it("a decoder-only browser can still import, and an encoder-only browser can still export", async () => {
      const file = await SaveGame.export(saveOf(sampleGame()));
      breakEncode(); // decoder-only browser
      expect((await readImport(file)).money).toBe(sampleGame().money);
      vi.unstubAllGlobals();
      breakDecode(); // encoder-only browser
      await expect(SaveGame.export(saveOf(sampleGame()))).resolves.toMatch(/^VCTOWER1\n/);
    });
  });

  it("returns null when no save exists", () => {
    expect(readAuto()).toBeNull();
    expect(SaveGame.hasSave()).toBe(false);
  });

  // The round trip, the version ladder, unknown kinds and the founder mark
  // are Rust tests since #1875: engine-rs/src/rule_tests/save_versions.rs.

  describe.skipIf(noEngine)("Ground-floor recognition through the real file-load path", () => {
    // Build a genuine .vctower container (magic + base64 of the async-deflated
    // JSON, the exact shape SaveGame.importText parses) with a chosen appVersion, so
    // the provenance-stamp -> detection wiring is exercised end-to-end via the
    // real import path (which calls markFounderFromLoadedFile), not a hand-stamped
    // object handed straight to deserialize().
    async function importWith(sim: Draft, appVersion?: string, fields: Record<string, unknown> = {}): Promise<Draft> {
      const data = { ...(sim.serialize() as unknown as Record<string, unknown>), ...fields };
      if (appVersion === undefined) delete data.appVersion;
      else data.appVersion = appVersion;
      const text = "VCTOWER1\n" + toBase64(await deflate(new TextEncoder().encode(JSON.stringify(data)))) + "\n";
      return importTower(text); // the engine applies the founder rule
    }

    it("recognizes a genuine pre-stamp save (no appVersion) as a Founder on import", async () => {
      expect((await importWith(sampleGame(), undefined)).founder).toBe(true);
    });

    it("recognizes a pre-2.0 stamped save (appVersion 1.x) as a Founder on import", async () => {
      expect((await importWith(sampleGame(), "1.99.0")).founder).toBe(true);
    });

    it("does NOT stamp Founder onto an imported 2.0+ save that never earned it", async () => {
      expect((await importWith(sampleGame(), "2.4.1")).founder).toBe(false);
    });

    it("keeps Founder on an imported 2.0+ save that carries the earned flag", async () => {
      // A pre-2.0 tower re-saved in 2.0: the stamp is 2.x but the flag persists.
      expect((await importWith(sampleGame(), "2.4.1", { founder: true })).founder).toBe(true);
    });
  });
});
