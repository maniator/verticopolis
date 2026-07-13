import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { deflateSync } from "fflate";
import { SAVE_VERSION, Simulation } from "../../engine/Simulation";
import { SaveGame } from "../../storage/SaveGame";
import { FACILITIES, GRID } from "../../engine/facilities";

describe("SaveGame", () => {
  beforeEach(() => localStorage.clear());
  // Several compression tests stub browser stream globals; always restore them
  // so later export/import tests see the real environment.
  afterEach(() => vi.unstubAllGlobals());

  function sampleGame(): Simulation {
    const sim = Simulation.newGame(42);
    const x0 = Math.floor(GRID.width / 2) - 20;
    for (let i = 0; i < 12; i++) sim.tower.place("floor", 2, x0 + i);
    sim.buildTransport("elevatorStandard", x0, 1, 2);
    sim.build("office", 2, x0);
    sim.money = 1234567;
    sim.tick(60 * 5);
    return sim;
  }

  it("persists the pending VIP inspection day across save/load", () => {
    const sim = sampleGame();
    // Simulate a Wedding Hall having scheduled the VIP a few days out.
    (sim as unknown as { vipVisitDay: number }).vipVisitDay = sim.clock.day + 3;
    const expected = (sim as unknown as { vipVisitDay: number }).vipVisitDay;
    const loaded = Simulation.deserialize(sim.serialize());
    expect((loaded as unknown as { vipVisitDay: number }).vipVisitDay).toBe(expected);
  });

  it("coerces non-finite unit fields from a tampered save to safe values", () => {
    const sim = sampleGame();
    const data = sim.serialize();
    // Simulate a hand-edited / foreign save with a poisoned satisfaction field.
    (data.units[0] as { satisfaction: unknown }).satisfaction = undefined;
    (data.units[0] as { occupants: unknown }).occupants = NaN;
    const loaded = Simulation.deserialize(data);
    const u = loaded.tower.units[0];
    expect(Number.isFinite(u.satisfaction)).toBe(true);
    expect(u.satisfaction).toBeGreaterThanOrEqual(0);
    expect(u.satisfaction).toBeLessThanOrEqual(1);
    expect(Number.isFinite(u.occupants)).toBe(true);
  });

  it("drops null/malformed unit and transport entries from a corrupt save without throwing", () => {
    const sim = sampleGame();
    const data = sim.serialize();
    const validUnits = data.units.length;
    const validTransports = data.transports.length;
    // A forged / partially-written save can hold a null (or a non-object
    // primitive, or a kind-less object) in the arrays. Reading `.kind` off a
    // null entry would throw and abort the WHOLE load — turning a recoverable
    // save into a hard failure. Cover the null-at-front position too.
    (data.units as unknown[]).unshift(null);
    (data.units as unknown[]).splice(2, 0, "junk", 42, {});
    (data.transports as unknown[]).unshift(null);
    (data.transports as unknown[]).push({});
    let loaded!: Simulation;
    expect(() => {
      loaded = Simulation.deserialize(data);
    }).not.toThrow();
    // The bad entries are dropped; every valid unit/transport survives.
    expect(loaded.tower.units).toHaveLength(validUnits);
    expect(loaded.tower.transports).toHaveLength(validTransports);
  });

  it("survives a non-array units/transports container in a corrupt save", () => {
    const sim = sampleGame();
    const data = sim.serialize();
    // A forged save can clobber the array field itself to a scalar/object.
    // `(data.units ?? [])` only guards null/undefined, so `.filter` on a
    // non-array would throw and abort the load — guard the container type.
    (data as { units: unknown }).units = 5;
    (data as { transports: unknown }).transports = { nope: true };
    let loaded!: Simulation;
    expect(() => {
      loaded = Simulation.deserialize(data);
    }).not.toThrow();
    expect(loaded.tower.units).toHaveLength(0);
    expect(loaded.tower.transports).toHaveLength(0);
  });

  it("clamps forged unit/transport geometry from a tampered save to the lot", () => {
    const sim = sampleGame();
    const data = sim.serialize();
    // Forged geometry would flow into renderer math (silhouette edges, lobby
    // variant indexing, per-tile draw loops, shaft band graphics) as
    // NaN/Infinity or absurd spans.
    (data.units[0] as { x: unknown }).x = -5.5;
    (data.units[0] as { floor: unknown }).floor = NaN;
    (data.units[0] as { width: unknown }).width = 1e9;
    // A near-edge origin with a huge width must not overhang the lot.
    (data.units[1] as { x: unknown }).x = GRID.width - 1;
    (data.units[1] as { width: unknown }).width = 50;
    (data.transports[0] as { x: unknown }).x = Infinity;
    (data.transports[0] as { top: unknown }).top = 1e9;
    // A forged bottom at/above the roof must not push top past maxFloor.
    (data.transports[0] as { bottom: unknown }).bottom = 1e9;
    const loaded = Simulation.deserialize(data);
    for (const u of [loaded.tower.units[0], loaded.tower.units[1]]) {
      expect(Number.isInteger(u.x) && u.x >= 0 && u.x < GRID.width).toBe(true);
      expect(Number.isInteger(u.floor) && u.floor >= GRID.minFloor && u.floor <= GRID.maxFloor).toBe(true);
      expect(Number.isInteger(u.width) && u.width >= 1).toBe(true);
      expect(u.x + u.width).toBeLessThanOrEqual(GRID.width);
    }
    const t = loaded.tower.transports[0];
    expect(Number.isInteger(t.x) && t.x >= 0).toBe(true);
    expect(t.x + FACILITIES[t.kind].width).toBeLessThanOrEqual(GRID.width);
    expect(t.bottom).toBeGreaterThanOrEqual(GRID.minFloor);
    expect(t.top).toBeLessThanOrEqual(GRID.maxFloor);
    expect(t.top).toBeGreaterThan(t.bottom);
  });

  it("preserves a legacy (narrower) transport width, clamps an over-wide one, and falls back for a corrupt one", () => {
    // A transport's stored width is trusted BELOW the catalog width so legacy
    // shafts survive a catalog width change (canon widths only ever grew:
    // stairs 4→8, standard elevator 3→4). Pinned with a WALKWAY because the
    // v5 heal-on-load pass deliberately re-widens narrow elevators; walkways
    // keep their stored width forever. A width ABOVE the catalog is always
    // forged and clamps down, or one corrupt entry could shadow-drop every
    // transport under its bogus footprint via the load-time overlap filter.
    // And a non-finite/non-positive width must not reach the consumers: it
    // would NaN-poison the W1 span scan (Tower.transportColumns) and make the
    // shaft unpickable (hit-testing).
    const legacy = sampleGame();
    const legacyData = legacy.serialize();
    legacyData.transports.push({
      ...legacyData.transports[0],
      id: 9_001,
      kind: "stairs",
      x: 5,
      width: 4, // the pre-E1b legacy flight width (catalog is 8)
      bottom: 1,
      top: 2,
      cars: 0,
      carPositions: [],
      carDir: [],
    });
    const legacyLoaded = Simulation.deserialize(legacyData);
    expect(legacyLoaded.tower.transports.find((t) => t.kind === "stairs")?.width).toBe(4);

    const kind = legacyData.transports[0].kind;
    const forged = sampleGame();
    const forgedData = forged.serialize();
    (forgedData.transports[0] as { width: unknown }).width = FACILITIES[kind].width + 3;
    const forgedLoaded = Simulation.deserialize(forgedData);
    expect(forgedLoaded.tower.transports[0].width).toBe(FACILITIES[kind].width);

    for (const bad of [NaN, Infinity, -4, 0, "8" as unknown as number]) {
      const sim = sampleGame();
      const data = sim.serialize();
      (data.transports[0] as { width: unknown }).width = bad;
      const t = Simulation.deserialize(data).tower.transports[0];
      expect(Number.isInteger(t.width) && t.width > 0).toBe(true);
      expect(t.width).toBe(FACILITIES[t.kind].width);
    }
  });

  it("coerces forged unit state/label strings from a tampered save", () => {
    const sim = sampleGame();
    const data = sim.serialize();
    // A forged `state` would flow into UI innerHTML (inspector "Status:" line)
    // and state-machine compares; a non-string label would crash escaping.
    (data.units[0] as { state: unknown }).state = '<img src=x onerror="x">';
    (data.units[0] as { label: unknown }).label = 42;
    const loaded = Simulation.deserialize(data);
    const u = loaded.tower.units[0];
    expect(u.state).toBe("empty");
    expect(u.label).toBe(FACILITIES[u.kind].name);
  });

  it("clamps a tampered nextId so new placements can never reuse a live id", () => {
    const sim = sampleGame();
    const data = sim.serialize();
    // A hand-edited/corrupt id counter — lower than ids already in use, or
    // missing entirely (→ NaN ids). Either would let a new placement alias an
    // existing unit's id, which the renderer keys its retained actors by.
    for (const forged of [1, undefined]) {
      (data as { nextId: unknown }).nextId = forged;
      const loaded = Simulation.deserialize(data);
      const before = new Set([
        ...loaded.tower.units.map((u) => u.id),
        ...loaded.tower.transports.map((t) => t.id),
      ]);
      // Adjacent to sampleGame's floor strip (x0..x0+11), so placement rules pass.
      const res = loaded.tower.place("floor", 2, Math.floor(GRID.width / 2) - 20 + 12);
      expect(res.ok).toBe(true);
      expect(Number.isFinite(res.unitId)).toBe(true);
      expect(before.has(res.unitId!)).toBe(false);
    }
  });

  it("repairs corrupt unit ids (NaN / duplicate / unsafe) so ids stay sane and unique", () => {
    const sim = sampleGame();
    const data = sim.serialize();
    // NaN would poison a raw Math.max over ids (and nextId with it); a
    // duplicate would alias by-id lookups and the renderer's retained actors;
    // an id past 2^53 would make the ++ repair (and allocateId later) a
    // precision no-op that re-mints the same id forever; negatives are out of
    // contract. A forged huge nextId must not win the counter max either.
    (data.units[0] as { id: unknown }).id = NaN;
    (data.units[1] as { id: unknown }).id = data.units[2].id;
    (data.units[3] as { id: unknown }).id = 2 ** 60;
    (data.units[4] as { id: unknown }).id = -7;
    (data as { nextId: unknown }).nextId = 1e308;
    const loaded = Simulation.deserialize(data);
    const ids = [
      ...loaded.tower.units.map((u) => u.id),
      ...loaded.tower.transports.map((t) => t.id),
    ];
    expect(ids.every((id) => Number.isSafeInteger(id) && id > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    // The counter must have landed above every repaired id (and stayed in the
    // range where ++ still increments).
    const res = loaded.tower.place("floor", 2, Math.floor(GRID.width / 2) - 20 + 12);
    expect(res.ok).toBe(true);
    expect(Number.isSafeInteger(res.unitId)).toBe(true);
    expect(ids.includes(res.unitId!)).toBe(false);
    const again = loaded.tower.place("floor", 2, Math.floor(GRID.width / 2) - 20 + 13);
    expect(again.unitId).not.toBe(res.unitId);
  });

  it("recomputes the sky weather on load (not left stale)", () => {
    const sim = sampleGame();
    sim.tick(60 * 24 * 5); // advance a few days
    const loaded = Simulation.deserialize(sim.serialize());
    expect(loaded.weather).toBe(Simulation.weatherFor(loaded.clock.day));
    expect(loaded.weather).toBe(sim.weather);
  });

  it("round-trips through localStorage", () => {
    const sim = sampleGame();
    SaveGame.save(sim);
    expect(SaveGame.hasSave()).toBe(true);
    const loaded = SaveGame.load()!;
    expect(loaded).not.toBeNull();
    expect(loaded.money).toBe(sim.money);
    expect(loaded.clock.minutes).toBe(sim.clock.minutes);
    expect(loaded.tower.units.length).toBe(sim.tower.units.length);
    expect(loaded.tower.transports.length).toBe(sim.tower.transports.length);
  });

  it("preserves occupancy lookups after load", () => {
    const sim = sampleGame();
    SaveGame.save(sim);
    const loaded = SaveGame.load()!;
    const x0 = Math.floor(GRID.width / 2) - 20;
    expect(loaded.tower.unitAt(2, x0)).toBeDefined();
  });

  // Mirrors SaveGame's internal autosave keys so tests can inspect raw stored values.
  const AUTO_KEY = "verticopolis-save";
  const LEGACY_AUTO_KEY = "simtower-clone-save";

  it("stores autosaves COMPRESSED (tagged, and smaller than the raw JSON), not as a giant blob", () => {
    const sim = sampleGame();
    SaveGame.save(sim);
    const raw = localStorage.getItem(AUTO_KEY)!;
    // The stored value is the compression marker + payload, never raw JSON.
    expect(raw.startsWith("VCZ1:")).toBe(true);
    expect(raw.startsWith("{")).toBe(false);
    expect(raw.length).toBeLessThan(JSON.stringify(sim.serialize()).length);
    // …and it still round-trips back to the same tower.
    expect(SaveGame.load()!.money).toBe(sim.money);
  });

  it("async autosave writes the same compressed localStorage format", async () => {
    const sim = sampleGame();
    sim.money = 765_432;
    await SaveGame.saveAsync(sim);
    const raw = localStorage.getItem(AUTO_KEY)!;
    expect(raw.startsWith("VCZ1:")).toBe(true);
    expect(SaveGame.load()!.money).toBe(765_432);
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
    await SaveGame.saveAsync(sim);
    expect(localStorage.getItem(AUTO_KEY)!.startsWith("VCZ1:")).toBe(true);
    expect(SaveGame.load()!.money).toBe(246_810);
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
    await SaveGame.saveAsync(sim);
    expect(SaveGame.load()!.money).toBe(135_790);
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
    const pending = SaveGame.saveAsync(stale);
    await vi.waitFor(() => expect(captured).toBeDefined());

    const fresh = sampleGame();
    fresh.money = 200;
    SaveGame.save(fresh);
    release();
    await pending;

    expect(SaveGame.load()!.money).toBe(200);
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
    const pending = SaveGame.saveAsync(auto);
    await vi.waitFor(() => expect(captured).toBeDefined());

    // Writes a DIFFERENT key, so the pending autosave must still commit.
    const manual = sampleGame();
    manual.money = 222;
    SaveGame.saveSlot(1, manual);
    release();
    await pending;

    expect(SaveGame.load()!.money).toBe(111); // autosave landed, not cancelled
    expect(SaveGame.loadSlot(1)!.money).toBe(222); // slot save intact
  });

  it("propagates direct async save failures to callers", async () => {
    const saveToAsync = vi.spyOn(SaveGame, "saveToAsync").mockRejectedValueOnce(new Error("write failed"));
    try {
      await expect(SaveGame.saveAsync(sampleGame())).rejects.toThrow(/write failed/);
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
    expect(SaveGame.load()).toBeNull(); // the cap fired (the payload alone is valid + loadable)
  });

  it("degrades a truncated / garbage compressed save to null — no crash, no partial tower", () => {
    // Corrupt deflate either makes fflate throw or yields bytes JSON.parse
    // rejects; either way readSlot catches it and returns null, so the player
    // never loads a half-decoded tower.
    const sim = sampleGame();
    SaveGame.save(sim);
    const body = localStorage.getItem(AUTO_KEY)!.slice("VCZ1:".length);
    localStorage.setItem(AUTO_KEY, "VCZ1:" + body.slice(0, Math.floor(body.length / 2))); // truncated payload
    expect(SaveGame.load()).toBeNull();
    localStorage.setItem(AUTO_KEY, "VCZ1:" + btoa("not a deflate stream at all")); // outright garbage
    expect(SaveGame.load()).toBeNull();
  });

  it("loadResult distinguishes an absent save from a present-but-unreadable one (for an honest boot)", () => {
    // Absent → not corrupt, no sim.
    expect(SaveGame.loadResult()).toEqual({ sim: null, corrupt: false });

    // A real save → readable, not corrupt.
    const sim = sampleGame();
    SaveGame.save(sim);
    const ok = SaveGame.loadResult();
    expect(ok.corrupt).toBe(false);
    expect(ok.sim?.money).toBe(sim.money);

    // Present but undecodable → corrupt (so boot warns instead of a silent fresh start).
    localStorage.setItem(AUTO_KEY, "VCZ1:" + btoa("not a deflate stream at all"));
    expect(SaveGame.loadResult()).toEqual({ sim: null, corrupt: true });
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

  it("falls back to a healthy legacy save when the Verticopolis autosave is unreadable, and still flags corruption", () => {
    const sim = sampleGame();
    sim.money = 555_555;
    localStorage.setItem(LEGACY_AUTO_KEY, JSON.stringify({ ...sim.serialize(), savedAt: 123 }));
    localStorage.setItem(AUTO_KEY, "VCZ1:not-actually-deflate");
    const boot = SaveGame.loadResult();
    expect(boot.sim).not.toBeNull(); // the legacy tower is rescued...
    expect(boot.sim!.money).toBe(555_555);
    expect(boot.corrupt).toBe(true); // ...while boot still preserves + warns
  });

  it("does not consult the legacy key (or flag corruption) when the Verticopolis autosave reads fine", () => {
    const sim = sampleGame();
    sim.money = 777_777;
    SaveGame.save(sim);
    localStorage.setItem(LEGACY_AUTO_KEY, "VCZ1:garbage-stale-legacy");
    const boot = SaveGame.loadResult();
    expect(boot.sim!.money).toBe(777_777);
    expect(boot.corrupt).toBe(false);
  });

  it("restores the legacy key when the quota-pressure retry also fails", () => {
    // Both keys exist and the origin's quota stays exhausted even after the
    // legacy key is dropped: the write must fail WITHOUT destroying the legacy
    // value, which an unreadable primary falls back to at load.
    const sim = sampleGame();
    SaveGame.save(sim);
    const legacyValue = JSON.stringify({ ...sim.serialize(), savedAt: 123 });
    localStorage.setItem(LEGACY_AUTO_KEY, legacyValue);
    const realSetItem = localStorage.setItem.bind(localStorage);
    const setSpy = vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key === AUTO_KEY) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      return realSetItem(key, value);
    });
    try {
      expect(() => SaveGame.save(sim)).toThrow(/quota/i);
      expect(localStorage.getItem(LEGACY_AUTO_KEY)).toBe(legacyValue); // restored, not lost
    } finally {
      setSpy.mockRestore();
    }
  });

  it("loads a legacy autosave key and rewrites future saves to the Verticopolis key", () => {
    const sim = sampleGame();
    localStorage.setItem(LEGACY_AUTO_KEY, JSON.stringify({ ...sim.serialize(), savedAt: 123 }));
    expect(SaveGame.hasSave()).toBe(true);
    expect(SaveGame.load()!.money).toBe(sim.money);

    const loaded = SaveGame.load()!;
    loaded.money = 333_333;
    SaveGame.save(loaded);
    expect(localStorage.getItem(AUTO_KEY)).not.toBeNull();
    expect(SaveGame.load()!.money).toBe(333_333);
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
      expect(() => SaveGame.save(sim)).not.toThrow();
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
    SaveGame.save(sim); // AUTO_KEY now populated
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
      expect(() => SaveGame.save(sim)).not.toThrow();
      expect(localStorage.getItem(LEGACY_AUTO_KEY)).toBeNull();
      expect(SaveGame.load()!.money).toBe(424_242);
    } finally {
      setSpy.mockRestore();
    }
  });

  it("still loads a legacy uncompressed (raw-JSON) save, then upgrades it to compressed on the next save", () => {
    const sim = sampleGame();
    localStorage.setItem(AUTO_KEY, JSON.stringify({ ...sim.serialize(), savedAt: 123 }));
    expect(localStorage.getItem(AUTO_KEY)!.startsWith("{")).toBe(true); // legacy: raw JSON, no marker

    const loaded = SaveGame.load()!;
    expect(loaded.money).toBe(sim.money); // old save still readable

    SaveGame.save(loaded); // re-saving migrates it forward
    expect(localStorage.getItem(AUTO_KEY)!.startsWith("VCZ1:")).toBe(true);
  });

  it("listSlots reads compressed slots — name / star / savedAt survive the round-trip", () => {
    const sim = sampleGame();
    sim.tower.towerName = "Compressed Tower";
    SaveGame.saveSlot(1, sim);
    const info = SaveGame.listSlots().find((s) => s.slot === 1)!;
    expect(info.exists).toBe(true);
    expect(info.towerName).toBe("Compressed Tower");
    expect(info.funds).toBe(sim.money);
    expect(info.savedAt).toBeGreaterThan(0);
  });

  it("exports a .vctower container (magic line + packed payload, not raw JSON) and imports it back", async () => {
    const sim = sampleGame();
    const file = await SaveGame.export(sim);
    // The made-up format: first line is the magic, and the body is NOT
    // copy-paste JSON anymore.
    expect(file.startsWith("VCTOWER1\n")).toBe(true);
    expect(() => JSON.parse(file)).toThrow();
    const loaded = await SaveGame.import(file);
    expect(loaded.money).toBe(sim.money);
    expect(loaded.star).toBe(sim.star);
  });

  it("exports files smaller than the old pretty-printed JSON format", async () => {
    const sim = sampleGame();
    const file = await SaveGame.export(sim);
    const oldFormat = JSON.stringify(sim.serialize(), null, 2);
    // The whole point of the compressed container: a fraction of the JSON it
    // replaced, not just marginally under it.
    expect(file.length).toBeLessThan(oldFormat.length / 2);
  });

  it("names the export file after the tower", () => {
    const sim = sampleGame();
    sim.tower.towerName = "Naftali's Tower #1";
    expect(SaveGame.exportFilename(sim)).toBe("naftali-s-tower-1.vctower");
    sim.tower.towerName = "✨✨"; // slugs to nothing → fallback
    expect(SaveGame.exportFilename(sim)).toBe("tower.vctower");
  });

  it("rejects a raw-JSON tower export — only .vctower containers import now", async () => {
    const sim = sampleGame();
    await expect(SaveGame.import(JSON.stringify(sim.serialize(), null, 2))).rejects.toThrow(/not a verticopolis tower file/i);
  });

  it("rejects malformed imports", async () => {
    await expect(SaveGame.import("{}")).rejects.toThrow();
    await expect(SaveGame.import("not json")).rejects.toThrow();
    await expect(SaveGame.import("[1,2,3]")).rejects.toThrow(); // no VCTOWER magic → not a tower file
    // A magic line over a garbage body must fail loudly, not half-load.
    await expect(SaveGame.import("VCTOWER1\n@@not base64@@")).rejects.toThrow();
    await expect(SaveGame.import("VCTOWER1\n" + btoa("[1,2,3]"))).rejects.toThrow();
  });

  it("reports a recognized-but-broken tower file as damaged, not as 'not a tower file'", async () => {
    // Valid base64 over bytes that are not a deflate stream.
    await expect(SaveGame.import("VCTOWER1\n" + btoa('{"minutes":'))).rejects.toThrow(/damaged/);
    // A truncated real export: recognized container, broken payload.
    const file = await SaveGame.export(sampleGame());
    await expect(SaveGame.import(file.slice(0, Math.floor(file.length / 2)))).rejects.toThrow(/damaged/);
  });

  it("tells the player to update when the file comes from a newer container version", async () => {
    await expect(SaveGame.import("VCTOWER2\n" + btoa("{}"))).rejects.toThrow(/newer version/);
  });

  it("rejects a decompression bomb with a 'too large' message, not 'damaged'", async () => {
    // Build a legitimate deflate-raw stream whose OUTPUT is just past the 64MB
    // cap, from a tiny compressed input — i.e. a real bomb, not corrupt bytes
    // (those land on the 'damaged' path instead). 65MB of zeros packs to a few KB.
    const huge = new Uint8Array(65 * 1024 * 1024); // all zeros → highly compressible
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
    await expect(SaveGame.import("VCTOWER1\n" + btoa(bin))).rejects.toThrow(/too large/);
  });

  describe("when the browser lacks the compression API", () => {
    // deflate-raw is a 2022+ browser feature; on an older browser the export
    // and the import of a compressed file must fail with an honest "your
    // browser is too old" message, not a silent failure and not "this file
    // is damaged" (which would blame a perfectly good save). Each direction is
    // probed separately: export needs only the encoder, import only the
    // decoder, so a browser missing one direction still gets the other.
    afterEach(() => vi.unstubAllGlobals());
    const broken = class {
      constructor() {
        throw new TypeError("Unsupported format: deflate-raw");
      }
    };
    const breakEncode = () => vi.stubGlobal("CompressionStream", broken);
    const breakDecode = () => vi.stubGlobal("DecompressionStream", broken);

    it("export reports the browser is too old, not a generic failure", async () => {
      breakEncode();
      await expect(SaveGame.export(sampleGame())).rejects.toThrow(/too old to create/);
    });

    it("importing a compressed file reports the browser is too old, not 'damaged'", async () => {
      // A real, healthy container built while compression WAS available.
      const file = await SaveGame.export(sampleGame());
      breakDecode();
      await expect(SaveGame.import(file)).rejects.toThrow(/too old to open/);
    });

    it("a decoder-only browser can still import, and an encoder-only browser can still export", async () => {
      const file = await SaveGame.export(sampleGame());
      breakEncode(); // decoder-only browser
      expect((await SaveGame.import(file)).money).toBe(sampleGame().money);
      vi.unstubAllGlobals();
      breakDecode(); // encoder-only browser
      await expect(SaveGame.export(sampleGame())).resolves.toMatch(/^VCTOWER1\n/);
    });
  });

  it("returns null when no save exists", () => {
    expect(SaveGame.load()).toBeNull();
    expect(SaveGame.hasSave()).toBe(false);
  });

  it("round-trips serialize -> deserialize -> serialize without drift", () => {
    const sim = sampleGame();
    // The nested per-car arrays are where serialization drift hides, not the
    // scalars — so assert they're populated before trusting the round-trip.
    const t = sim.tower.transports[0];
    expect(t.carPositions.length).toBeGreaterThan(0);

    const first = sim.serialize();
    const second = Simulation.deserialize(first).serialize();
    expect(second).toEqual(first);
    // And the deep-copied car arrays survive intact, value for value.
    expect(second.transports[0].carPositions).toEqual(first.transports[0].carPositions);
  });

  it("loads a save from an unknown future version without throwing", () => {
    const sim = sampleGame();
    const data = sim.serialize();
    // A save written by a newer build must degrade gracefully, not crash.
    (data as { version: number }).version = 999;
    expect(() => Simulation.deserialize(data)).not.toThrow();
    const loaded = Simulation.deserialize(data);
    expect(loaded.money).toBe(sim.money);
    expect(loaded.tower.units.length).toBe(sim.tower.units.length);
  });

  it("migrates a v2 save through the version ladder to the current schema", () => {
    const sim = sampleGame();
    const data = sim.serialize();
    (data as { version: number }).version = 2;
    const loaded = Simulation.deserialize(data);
    expect(SAVE_VERSION).toBe(6);
    expect(loaded.money).toBe(sim.money);
    expect(loaded.serialize().version).toBe(SAVE_VERSION);
  });

  it("migrates a v3 save up the ladder (venue-census bump): re-stamps version, tower intact", () => {
    // v3 -> v4 is additive/no-op data-wise: the meal-customer census reads a
    // transient overlay that is never serialized, so a v3 save is already valid
    // v4 data. The migration only re-stamps the version; the tower round-trips
    // unchanged and does not fall through the "newer than this build" path.
    const sim = sampleGame();
    const data = sim.serialize();
    (data as { version: number }).version = 3;
    const beforeUnits = JSON.stringify(data.units);
    const loaded = Simulation.deserialize(data);
    expect(loaded.serialize().version).toBe(SAVE_VERSION);
    expect(loaded.money).toBe(sim.money);
    expect(loaded.tower.totalPopulation()).toBe(sim.tower.totalPopulation());
    // Units survive the hop byte-for-byte (only the version stamp changed).
    expect(JSON.stringify(loaded.serialize().units)).toBe(beforeUnits);
  });

  it("drops units with an unrecognized kind on load", () => {
    const sim = sampleGame();
    const data = sim.serialize();
    const before = data.units.length;
    // Inject a bogus unit as if from a tampered/old save file.
    (data.units as any).push({ ...data.units[0], id: 99999, kind: "spaceport" });
    const loaded = Simulation.deserialize(data);
    expect(loaded.tower.units.length).toBe(before);
    expect(loaded.tower.units.some((u) => (u.kind as string) === "spaceport")).toBe(false);
  });
});
