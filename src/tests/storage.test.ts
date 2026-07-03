import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { deflateSync } from "fflate";
import { Simulation } from "../engine/Simulation";
import { SaveGame } from "../storage/SaveGame";
import { FACILITIES, GRID } from "../engine/facilities";

describe("SaveGame", () => {
  beforeEach(() => localStorage.clear());

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

  const AUTO_KEY = "simtower-clone-save"; // mirrors the internal autosave key

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

  it("caps inflation of a corrupt/oversized compressed save — returns null, never hangs the tab", () => {
    // A real decompression bomb: a few KB of DEFLATE that inflates past the 32MB
    // cap. inflateCapped must abort and readSlot must degrade to "no save".
    const bomb = deflateSync(new Uint8Array(33 * 1024 * 1024)); // 33MB of zeros → tiny packed
    let bin = "";
    for (let i = 0; i < bomb.length; i += 0x8000) bin += String.fromCharCode(...bomb.subarray(i, i + 0x8000));
    localStorage.setItem(AUTO_KEY, "VCZ1:" + btoa(bin));
    expect(SaveGame.load()).toBeNull();
  });

  it("rejects a truncated / garbage compressed save — corrupt deflate fails loudly, never a partial tower", () => {
    // fflate's sync Inflate THROWS on a truncated/invalid stream (it does not
    // silently emit partial output), and readSlot catches that to null.
    const sim = sampleGame();
    SaveGame.save(sim);
    const body = localStorage.getItem(AUTO_KEY)!.slice("VCZ1:".length);
    localStorage.setItem(AUTO_KEY, "VCZ1:" + body.slice(0, Math.floor(body.length / 2))); // truncated payload
    expect(SaveGame.load()).toBeNull();
    localStorage.setItem(AUTO_KEY, "VCZ1:" + btoa("not a deflate stream at all")); // outright garbage
    expect(SaveGame.load()).toBeNull();
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

  it("still imports a legacy raw-JSON export", async () => {
    const sim = sampleGame();
    const loaded = await SaveGame.import(JSON.stringify(sim.serialize(), null, 2));
    expect(loaded.money).toBe(sim.money);
  });

  it("rejects malformed imports", async () => {
    await expect(SaveGame.import("{}")).rejects.toThrow();
    await expect(SaveGame.import("not json")).rejects.toThrow();
    await expect(SaveGame.import("[1,2,3]")).rejects.toThrow(); // parses, fails validation
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
    // deflate-raw is a 2022+ browser feature; on an older browser both the
    // export and the import of a compressed file must fail with an honest
    // "your browser is too old" message — not a silent failure, and NOT
    // "this file is damaged" (which would blame a perfectly good save).
    afterEach(() => vi.unstubAllGlobals());
    const breakCompression = () =>
      vi.stubGlobal(
        "CompressionStream",
        class {
          constructor() {
            throw new TypeError("Unsupported format: deflate-raw");
          }
        },
      );

    it("export reports the browser is too old, not a generic failure", async () => {
      breakCompression();
      await expect(SaveGame.export(sampleGame())).rejects.toThrow(/too old to create/);
    });

    it("importing a compressed file reports the browser is too old, not 'damaged'", async () => {
      // A real, healthy container built while compression WAS available.
      const file = await SaveGame.export(sampleGame());
      breakCompression();
      await expect(SaveGame.import(file)).rejects.toThrow(/too old to open/);
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

  it("drops units with an unrecognized kind on load", async () => {
    const sim = sampleGame();
    const data = sim.serialize();
    const before = data.units.length;
    // Inject a bogus unit as if from a tampered/old save file.
    (data.units as any).push({ ...data.units[0], id: 99999, kind: "spaceport" });
    const loaded = await SaveGame.import(JSON.stringify(data));
    expect(loaded.tower.units.length).toBe(before);
    expect(loaded.tower.units.some((u) => (u.kind as string) === "spaceport")).toBe(false);
  });
});
