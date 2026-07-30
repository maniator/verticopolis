import { describe, it, expect } from "vitest";
import { deflateSync, zlibSync } from "fflate";
import { markFounderFromLoadedFile } from "../engine/sim/founderStatus";
import { fromBase64, inflate, inflateCapped, STORE_MAGIC, toBase64, TOWER_FILE_MAGIC } from "./saveCompression";
import { MIGRATION_SOURCES, SAVE_SLOT_IDS, isSaveSlotId, migrateSavesToStore, toTowerFile } from "./saveMigration";
import type { SaveScopeToken, SaveStorePort, SaveStoreSnapshot } from "../platform/saveStore";

/** A tower as an OLD build wrote it: no appVersion, which is the whole point. */
const PRE_2_0_SAVE = { minutes: 4321, units: [{ t: "office" }], towerName: "Old Guard", money: 500 };

function storeValue(obj: unknown): string {
  return STORE_MAGIC + toBase64(deflateSync(new TextEncoder().encode(JSON.stringify(obj)), { level: 1 }));
}

/** Decode what the migration produced, the way `SaveGame.import` would. */
function decodeTowerFile(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  expect(trimmed.startsWith(TOWER_FILE_MAGIC + "\n")).toBe(true);
  const payload = trimmed.slice(TOWER_FILE_MAGIC.length).replace(/\s+/g, "");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(inflateCapped(fromBase64(payload)))) as Record<
    string,
    unknown
  >;
}

/** Records every write, and refuses a duplicate id the way an O_EXCL create does. */
function fakeStore(existing: Record<string, string> = {}) {
  const written = new Map<string, { contents: string; scope: SaveScopeToken; seq: number }>();
  const present = new Set(Object.keys(existing));
  let failNext: string | null = null;
  const port: SaveStorePort = {
    list(): Promise<SaveStoreSnapshot> {
      return Promise.resolve({ scopes: [{ token: "s", label: "This computer" }], records: [] });
    },
    read(id: string): Promise<string | null> {
      return Promise.resolve(written.get(id)?.contents ?? existing[id] ?? null);
    },
    write(id: string, contents: string, scope: SaveScopeToken, seq: number): Promise<void> {
      if (failNext === id) return Promise.reject(new Error("io"));
      if (present.has(id)) return Promise.reject(new Error("exists"));
      present.add(id);
      written.set(id, { contents, scope, seq });
      return Promise.resolve();
    },
    delete(id: string): Promise<void> {
      present.delete(id);
      written.delete(id);
      return Promise.resolve();
    },
  };
  return { port, written, failWriteOf: (id: string) => (failNext = id) };
}

function readerFor(values: Record<string, string>) {
  return (key: string): string | null => values[key] ?? null;
}

describe("toTowerFile (the byte-fidelity codec)", () => {
  it("re-headers a compressed save without touching the payload", () => {
    const raw = storeValue(PRE_2_0_SAVE);
    const result = toTowerFile(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("reheadered");
    // THE property. The base64 after the new header is character-for-character
    // the base64 that was after the old one, so nothing was decoded and
    // re-encoded along the way.
    expect(result.text).toBe(TOWER_FILE_MAGIC + "\n" + raw.slice(STORE_MAGIC.length) + "\n");
  });

  it("keeps a pre-2.0 tower's appVersion ABSENT, which is what earns Founder", () => {
    // The hazard this whole module is shaped around. `stamp()` sets appVersion
    // unconditionally, so any migration that deserialized and re-saved would
    // hand this tower a version string and silently cost the player the badge.
    const result = toTowerFile(storeValue(PRE_2_0_SAVE));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const decoded = decodeTowerFile(result.text);
    expect(decoded.appVersion).toBeUndefined();
    expect(decoded).toEqual(PRE_2_0_SAVE);

    // And the badge really does follow from that field being absent.
    const sim = { founder: false };
    markFounderFromLoadedFile(sim, decoded);
    expect(sim.founder).toBe(true);
  });

  it("NEGATIVE CONTROL: a stamped tower does not earn Founder", () => {
    // Without this, the assertion above would pass even if
    // markFounderFromLoadedFile granted the badge unconditionally, and the test
    // would be proving nothing about the migration at all.
    const stamped = { ...PRE_2_0_SAVE, appVersion: "2.4.0" };
    const result = toTowerFile(storeValue(stamped));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sim = { founder: false };
    markFounderFromLoadedFile(sim, decodeTowerFile(result.text));
    expect(sim.founder).toBe(false);
  });

  it("compresses a pre-compression raw-JSON save without re-serializing it", () => {
    // The one case that genuinely re-encodes. It must still not parse-and-write:
    // key ORDER survives here, which it would not if the object had been parsed
    // and re-stringified through a code path that rebuilt it.
    const json = '{"minutes":10,"towerName":"Legacy","units":[]}';
    const result = toTowerFile(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("compressed");
    const payload = result.text.trim().slice(TOWER_FILE_MAGIC.length).replace(/\s+/g, "");
    expect(new TextDecoder().decode(inflateCapped(fromBase64(payload)))).toBe(json);
    expect(decodeTowerFile(result.text).appVersion).toBeUndefined();
  });

  it("refuses a value that will not decode, rather than writing a broken tower file", () => {
    expect(toTowerFile(STORE_MAGIC + "not!valid!base64!")).toEqual({ ok: false, reason: "unreadable" });
    expect(toTowerFile(STORE_MAGIC + toBase64(new Uint8Array([1, 2, 3, 4])))).toEqual({
      ok: false,
      reason: "unreadable",
    });
    expect(toTowerFile("{ this is not json")).toEqual({ ok: false, reason: "unreadable" });
  });

  it("treats an empty or whitespace value as absent", () => {
    expect(toTowerFile("")).toEqual({ ok: false, reason: "empty" });
    expect(toTowerFile("   \n ")).toEqual({ ok: false, reason: "empty" });
  });
});

describe("the source list", () => {
  it("covers all six localStorage keys and maps them to distinct destinations", () => {
    // Six, not one. A migration that read only the current autosave key would
    // leave towers that live solely on a legacy key behind.
    expect(MIGRATION_SOURCES.map((s) => s.key)).toEqual([
      "verticopolis-save",
      "simtower-clone-save",
      "simtower-clone-slot-1",
      "simtower-clone-slot-2",
      "simtower-clone-slot-3",
      "simtower-clone-unreadable",
    ]);
    const ids = MIGRATION_SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(isSaveSlotId)).toBe(true);
  });

  it("keeps the two autosave keys on separate destinations", () => {
    // Both can hold a real tower at once, and loadResult falls back to the
    // legacy one, so collapsing them would drop whichever lost the race.
    const auto = MIGRATION_SOURCES.find((s) => s.key === "verticopolis-save");
    const legacy = MIGRATION_SOURCES.find((s) => s.key === "simtower-clone-save");
    expect(auto?.id).not.toBe(legacy?.id);
  });

  it("rejects an id outside the closed list", () => {
    expect(isSaveSlotId("slot-4")).toBe(false);
    expect(isSaveSlotId("../escape")).toBe(false);
    expect(isSaveSlotId("__proto__")).toBe(false);
    expect(SAVE_SLOT_IDS.every(isSaveSlotId)).toBe(true);
  });
});

describe("migrateSavesToStore", () => {
  const SCOPE: SaveScopeToken = "scope-token";

  it("moves every readable tower and echoes the scope token back", async () => {
    const { port, written } = fakeStore();
    const report = await migrateSavesToStore(
      port,
      SCOPE,
      new Set(),
      readerFor({
        "verticopolis-save": storeValue(PRE_2_0_SAVE),
        "simtower-clone-slot-2": storeValue({ ...PRE_2_0_SAVE, towerName: "Second" }),
      }),
    );
    expect(report.outcomes.get("auto")).toBe("migrated");
    expect(report.outcomes.get("slot-2")).toBe("migrated");
    expect(report.outcomes.get("slot-1")).toBe("absent");
    expect(report.migratedAny).toBe(true);
    expect(report.nothingToDo).toBe(false);
    expect(written.get("auto")?.scope).toBe(SCOPE);
    expect(decodeTowerFile(written.get("slot-2")!.contents).towerName).toBe("Second");
  });

  it("skips a destination that already exists instead of overwriting it", async () => {
    const { port, written } = fakeStore({ auto: "PRE-EXISTING" });
    const report = await migrateSavesToStore(
      port,
      SCOPE,
      new Set(["auto"]),
      readerFor({ "verticopolis-save": storeValue(PRE_2_0_SAVE) }),
    );
    expect(report.outcomes.get("auto")).toBe("already-present");
    expect(written.has("auto")).toBe(false);
    expect(await port.read("auto")).toBe("PRE-EXISTING");
  });

  it("is a no-op on a second run, with no flag to consult", async () => {
    const values = { "verticopolis-save": storeValue(PRE_2_0_SAVE) };
    const { port, written } = fakeStore();
    await migrateSavesToStore(port, SCOPE, new Set(), readerFor(values));
    const first = written.get("auto")!.contents;

    // The done-marker is derived: pass the ids the store now holds, exactly as
    // boot would after re-reading the snapshot.
    const second = await migrateSavesToStore(port, SCOPE, new Set(["auto"]), readerFor(values));
    expect(second.outcomes.get("auto")).toBe("already-present");
    expect(second.migratedAny).toBe(false);
    expect(written.get("auto")!.contents).toBe(first);
  });

  it("never writes or clears localStorage", async () => {
    localStorage.clear();
    localStorage.setItem("verticopolis-save", storeValue(PRE_2_0_SAVE));
    const before = localStorage.getItem("verticopolis-save");
    const { port } = fakeStore();
    await migrateSavesToStore(port, SCOPE, new Set());
    // Read through the real reader this time, so the default path is covered.
    expect(localStorage.getItem("verticopolis-save")).toBe(before);
    expect(localStorage.length).toBe(1);
  });

  it("leaves a corrupt value in place and reports it", async () => {
    const { port, written } = fakeStore();
    const report = await migrateSavesToStore(
      port,
      SCOPE,
      new Set(),
      readerFor({ "verticopolis-save": STORE_MAGIC + "@@@" }),
    );
    expect(report.outcomes.get("auto")).toBe("unreadable");
    expect(written.has("auto")).toBe(false);
    expect(report.migratedAny).toBe(false);
  });

  it("reports a failed write rather than claiming success", async () => {
    const { port, failWriteOf } = fakeStore();
    failWriteOf("auto");
    const report = await migrateSavesToStore(
      port,
      SCOPE,
      new Set(),
      readerFor({ "verticopolis-save": storeValue(PRE_2_0_SAVE) }),
    );
    expect(report.outcomes.get("auto")).toBe("write-failed");
    expect(report.migratedAny).toBe(false);
  });

  it("separates 'nothing to migrate' from 'migrated nothing'", async () => {
    // These are not the same event and boot treats them differently: an empty
    // machine is done, whereas six unreadable keys is a report worth making.
    const { port } = fakeStore();
    expect((await migrateSavesToStore(port, SCOPE, new Set(), readerFor({}))).nothingToDo).toBe(true);
    const corrupt = await migrateSavesToStore(
      port,
      SCOPE,
      new Set(),
      readerFor({ "verticopolis-save": STORE_MAGIC + "@@@" }),
    );
    expect(corrupt.nothingToDo).toBe(false);
    expect(corrupt.migratedAny).toBe(false);
  });

  it("writes at the lowest seq, so a migration can never outrank a real save", async () => {
    const { port, written } = fakeStore();
    await migrateSavesToStore(port, SCOPE, new Set(), readerFor({ "verticopolis-save": storeValue(PRE_2_0_SAVE) }));
    expect(written.get("auto")!.seq).toBe(1);
  });

  it("survives a storage that throws on read", async () => {
    // Private mode and disabled site storage both throw from getItem. Boot must
    // not die there; there is simply nothing to migrate.
    const { port } = fakeStore();
    const report = await migrateSavesToStore(port, SCOPE, new Set(), () => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(report.nothingToDo).toBe(true);
  });
});

/**
 * The assumption the whole design rests on, asserted rather than believed.
 *
 * localStorage packs with fflate (synchronous, so a pre-reload flush cannot be
 * lost) and `.vctower` packs with CompressionStream. The re-header is only
 * sound because both emit RAW deflate. If that ever stops being true, this
 * module has to start decoding, which reopens the Founder hazard, so it should
 * surface as a failing test and not as quietly lost badges.
 */
describe("the two containers wrap the same bytes", () => {
  it("a fflate-packed payload decodes through the .vctower reader's own path", async () => {
    const json = JSON.stringify(PRE_2_0_SAVE);
    const packed = deflateSync(new TextEncoder().encode(json), { level: 1 });
    // `inflate` is DecompressionStream("deflate-raw"), the exact call
    // SaveGame.import makes. Feeding it fflate's output is the compatibility
    // claim, stated directly.
    expect(new TextDecoder().decode(await inflate(packed))).toBe(json);
  });

  it("NEGATIVE CONTROL: zlib-framed bytes are rejected by that path", async () => {
    // Proves the check above discriminates. fflate's zlibSync differs from
    // deflateSync only by the framing the raw reader must refuse, so if this
    // passed, the assertion above would hold for any compressor at all.
    await expect(inflate(zlibSync(new TextEncoder().encode(JSON.stringify(PRE_2_0_SAVE))))).rejects.toThrow();
  });
});
