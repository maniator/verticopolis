import { describe, it, expect } from "vitest";
import { deflateSync, zlibSync } from "fflate";
import { Simulation } from "../engine/Simulation";
import { markFounderFromLoadedFile } from "../engine/sim/founderStatus";
import { SaveGame, SLOT_COUNT } from "./SaveGame";
import { fromBase64, inflate, inflateCapped, STORE_MAGIC, toBase64, TOWER_FILE_MAGIC } from "./saveCompression";
import { MIGRATION_SOURCES, SAVE_SLOT_IDS, isSaveSlotId, migrateSavesToStore, toTowerFile } from "./saveMigration";
import { asScopeToken, type SaveScopeToken, type SaveStorePort, type SaveStoreSnapshot } from "../platform/saveStore";

/**
 * A tower as an OLD build wrote it: no appVersion, which is the whole point.
 * Carries the two fields `SaveGame.import` insists on, because a value without
 * them is not a tower and the migration now refuses it.
 */
const PRE_2_0_SAVE = { minutes: 4321, units: [{ t: "office" }], towerName: "Old Guard", money: 500 };

const SCOPE: SaveScopeToken = asScopeToken("scope-token");

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
  let dropSilently: string | null = null;
  const port: SaveStorePort = {
    list(): Promise<SaveStoreSnapshot> {
      return Promise.resolve({ scopes: [{ token: SCOPE, label: "This computer" }], records: [] });
    },
    read(id: string): Promise<string | null> {
      return Promise.resolve(written.get(id)?.contents ?? existing[id] ?? null);
    },
    write(id: string, contents: string, scope: SaveScopeToken, seq: number): Promise<void> {
      if (failNext === id) return Promise.reject(Object.assign(new Error("no space"), { code: "full" }));
      // Models a shell that discards a write and wrongly RESOLVES anyway.
      if (dropSilently === id) return Promise.resolve();
      if (present.has(id)) return Promise.reject(Object.assign(new Error("exists"), { code: "denied" }));
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
  return {
    port,
    written,
    failWriteOf: (id: string) => (failNext = id),
    dropWriteOf: (id: string) => (dropSilently = id),
  };
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

  it("refuses valid JSON that is not a tower, in BOTH branches", () => {
    // `JSON.parse` succeeding is not the bar. Left alone, each of these becomes
    // a VCTOWER1 file in durable storage that only fails at import, which is
    // precisely what validating here is supposed to prevent.
    for (const junk of ["null", "42", "[]", '"hello"', "{}", '{"minutes":1}', '{"units":[]}']) {
      expect(toTowerFile(junk), `raw JSON ${junk}`).toEqual({ ok: false, reason: "unreadable" });
      expect(toTowerFile(storeValue(JSON.parse(junk))), `compressed ${junk}`).toEqual({
        ok: false,
        reason: "unreadable",
      });
    }
  });

  it("refuses a raw-JSON value carrying a lone surrogate rather than mangling it", () => {
    // This is the only branch that encodes text, and TextEncoder replaces a
    // lone surrogate with U+FFFD. Migrating it would produce a quietly
    // different tower name, which is worse than declining.
    const withLoneSurrogate = '{"minutes":1,"units":[],"towerName":"bad\uD800name"}';
    expect(JSON.parse(withLoneSurrogate)).toBeTruthy(); // it IS valid JSON
    expect(toTowerFile(withLoneSurrogate)).toEqual({ ok: false, reason: "unreadable" });
  });

  it("treats an empty or whitespace value as absent", () => {
    expect(toTowerFile("")).toEqual({ ok: false, reason: "empty" });
    expect(toTowerFile("   \n ")).toEqual({ ok: false, reason: "empty" });
  });

  it("in preserve mode, keeps bytes it cannot decode", () => {
    // The `unreadable` destination exists to hold what this build could not
    // read. Gating it on decodability would refuse exactly those bytes.
    const undecodable = STORE_MAGIC + toBase64(new Uint8Array([9, 9, 9, 9]));
    expect(toTowerFile(undecodable).ok).toBe(false);
    const preserved = toTowerFile(undecodable, true);
    expect(preserved.ok).toBe(true);
    if (!preserved.ok) return;
    // The bytes survive verbatim, which is the entire job.
    expect(preserved.text).toBe(TOWER_FILE_MAGIC + "\n" + undecodable.slice(STORE_MAGIC.length) + "\n");
    // Still refuses genuinely empty input, which carries nothing to preserve.
    expect(toTowerFile("", true)).toEqual({ ok: false, reason: "empty" });
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

  it("covers exactly as many numbered slots as SaveGame defines", () => {
    // The keys are spelled out rather than generated, so this is what catches
    // someone raising SLOT_COUNT and leaving the new slot unmigrated and
    // unreported. Reads the real constant, not a copy of it.
    const numbered = MIGRATION_SOURCES.filter((s) => /^simtower-clone-slot-\d+$/.test(s.key));
    expect(numbered.length).toBe(SLOT_COUNT);
    for (let n = 1; n <= SLOT_COUNT; n++) {
      expect(MIGRATION_SOURCES.some((s) => s.key === `simtower-clone-slot-${n}`)).toBe(true);
    }
  });

  it("keeps the two autosave keys on separate destinations", () => {
    // Both can hold a real tower at once, and loadResult falls back to the
    // legacy one, so collapsing them would drop whichever lost the race.
    const auto = MIGRATION_SOURCES.find((s) => s.key === "verticopolis-save");
    const legacy = MIGRATION_SOURCES.find((s) => s.key === "simtower-clone-save");
    expect(auto?.id).not.toBe(legacy?.id);
  });

  it("marks the unreadable backup, and only it, for byte preservation", () => {
    expect(MIGRATION_SOURCES.filter((s) => s.preserve).map((s) => s.id)).toEqual(["unreadable"]);
  });

  it("rejects an id outside the closed list", () => {
    expect(isSaveSlotId("slot-4")).toBe(false);
    expect(isSaveSlotId("../escape")).toBe(false);
    expect(isSaveSlotId("__proto__")).toBe(false);
    expect(SAVE_SLOT_IDS.every(isSaveSlotId)).toBe(true);
  });
});

describe("migrateSavesToStore", () => {
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
    expect(report.failures).toEqual([]);
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
    expect(await port.read("auto", SCOPE)).toBe("PRE-EXISTING");
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
    expect(second.alreadyComplete).toBe(true);
    expect(written.get("auto")!.contents).toBe(first);
  });

  it("distinguishes the steady state from six corrupt keys", async () => {
    // Both produce migratedAny: false. Only one of them is worth telling
    // anyone about, so the caller must be able to tell them apart.
    const { port } = fakeStore();
    const steady = await migrateSavesToStore(port, SCOPE, new Set(["auto"]), readerFor({}));
    expect(steady.alreadyComplete).toBe(true);
    expect(steady.nothingToDo).toBe(false);

    const corrupt = await migrateSavesToStore(
      port,
      SCOPE,
      new Set(),
      readerFor({ "verticopolis-save": STORE_MAGIC + "@@@" }),
    );
    expect(corrupt.alreadyComplete).toBe(false);
    expect(corrupt.migratedAny).toBe(false);

    // An empty machine is neither.
    const fresh = await migrateSavesToStore(port, SCOPE, new Set(), readerFor({}));
    expect(fresh.nothingToDo).toBe(true);
    expect(fresh.alreadyComplete).toBe(false);
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

  it("carries the unreadable backup across even when it cannot be decoded", async () => {
    const { port, written } = fakeStore();
    const undecodable = STORE_MAGIC + toBase64(new Uint8Array([9, 9, 9, 9]));
    const report = await migrateSavesToStore(
      port,
      SCOPE,
      new Set(),
      readerFor({ "simtower-clone-unreadable": undecodable }),
    );
    expect(report.outcomes.get("unreadable")).toBe("migrated");
    expect(written.get("unreadable")!.contents).toContain(undecodable.slice(STORE_MAGIC.length));
    // The same bytes on an ordinary slot are still refused.
    const strict = await migrateSavesToStore(
      port,
      SCOPE,
      new Set(),
      readerFor({ "simtower-clone-slot-1": undecodable }),
    );
    expect(strict.outcomes.get("slot-1")).toBe("unreadable");
  });

  it("reports a failed write, with the store's own reason", async () => {
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
    // "Disk full" must not arrive at the caller as an anonymous failure.
    expect(report.failures).toEqual([{ id: "auto", code: "full" }]);
  });

  it("does not believe a write that resolved without landing", async () => {
    // A duck-checked port is trusted for SHAPE only. A shell that discards a
    // stale write and resolves anyway, or one whose write returns no promise
    // at all, would otherwise be recorded as a tower that was saved. The
    // read-back is what makes "migrated" mean something.
    const { port, dropWriteOf } = fakeStore();
    dropWriteOf("auto");
    const report = await migrateSavesToStore(
      port,
      SCOPE,
      new Set(),
      readerFor({ "verticopolis-save": storeValue(PRE_2_0_SAVE) }),
    );
    expect(report.outcomes.get("auto")).toBe("write-failed");
    expect(report.migratedAny).toBe(false);
    expect(report.failures).toEqual([{ id: "auto" }]);
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
 * The end-to-end claim, run through the PRODUCTION reader rather than a
 * hand-rolled copy of it. Everything above proves the codec self-consistent;
 * only this proves a migrated tower actually loads.
 */
describe("a migrated tower loads through SaveGame.import", () => {
  it("round-trips a real simulation and keeps its Founder status", async () => {
    // serialize() is deliberately stamp-free, so this is a genuine pre-2.0
    // save rather than a fixture pretending to be one.
    const original = Simulation.newGame(4242);
    const serialized = original.serialize();
    expect((serialized as { appVersion?: unknown }).appVersion).toBeUndefined();

    const migrated = toTowerFile(storeValue(serialized));
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;

    // The real importer: magic-line check, version gate, whitespace tolerance,
    // fatal UTF-8 decode, size cap, schema check, deserialize, and the Founder
    // marking. If any of those disagreed with what the migration writes, this
    // is where it shows.
    const loaded = await SaveGame.import(migrated.text);
    expect(loaded.population).toBe(original.population);
    expect(loaded.tower.towerName).toBe(original.tower.towerName);
    expect(loaded.founder).toBe(true);
  });

  it("NEGATIVE CONTROL: the same tower stamped by a save does not come back a Founder", async () => {
    // Proves the assertion above is about the migration preserving absence,
    // not about import granting the badge to everything.
    const stamped = { ...Simulation.newGame(4242).serialize(), appVersion: "2.9.0" };
    const migrated = toTowerFile(storeValue(stamped));
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect((await SaveGame.import(migrated.text)).founder).toBe(false);
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
