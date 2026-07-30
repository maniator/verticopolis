import { describe, it, expect } from "vitest";
import { Simulation } from "../engine/Simulation";
import { SaveGame } from "./SaveGame";
import { fromBase64, inflateCapped, STORE_MAGIC, TOWER_FILE_MAGIC, toBase64 } from "./saveCompression";
import { migrateSavesToStore, toTowerFile } from "./saveMigration";
import { PRE_2_0_SAVE, SCOPE, decodeTowerFile, fakeStore, readerFor, storeValue } from "./saveMigration.fixture";

/**
 * Running the migration: ordering, idempotency, verification, and the
 * end-to-end load. The pure codec's own tests live in `saveMigration.test.ts`;
 * the two were split when the combined file crossed the 500-line guard.
 */

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
describe("preserve mode, every combination", () => {
  it("refuses a lone surrogate even in preserve mode, rather than mangling it", () => {
    // The guard originally sat inside the `!preserve` block, so the one mode
    // that promises byte fidelity was the one mode that could silently rewrite
    // a character as U+FFFD. A preserved value only reaches the encoding branch
    // when it is NOT VCZ1-prefixed, which for the unreadable backup is exactly
    // the arbitrary-bytes case the mode exists for.
    const raw = 'garbage\uD800bytes';
    expect(toTowerFile(raw, true)).toEqual({ ok: false, reason: "unreadable" });
    expect(toTowerFile(raw, false)).toEqual({ ok: false, reason: "unreadable" });
  });

  it("carries a non-VCZ1 preserved value through when it can be encoded faithfully", () => {
    // Not JSON, not a tower, no magic prefix. Preserve mode still takes it.
    const raw = "totally corrupt bytes, not json at all";
    expect(toTowerFile(raw, false)).toEqual({ ok: false, reason: "unreadable" });
    const preserved = toTowerFile(raw, true);
    expect(preserved.ok).toBe(true);
    if (!preserved.ok) return;
    const payload = preserved.text.trim().slice(TOWER_FILE_MAGIC.length).replace(/\s+/g, "");
    expect(new TextDecoder().decode(inflateCapped(fromBase64(payload)))).toBe(raw);
  });

  it("refuses a header with no payload in either mode", () => {
    // A VCTOWER1 line and nothing after it is an empty file, not a rescue.
    for (const preserve of [true, false]) {
      expect(toTowerFile(STORE_MAGIC, preserve), `preserve=${preserve}`).toEqual({ ok: false, reason: "empty" });
      expect(toTowerFile(STORE_MAGIC + "   ", preserve), `preserve=${preserve}`).toEqual({
        ok: false,
        reason: "empty",
      });
    }
  });

  it("passes a preserved payload through without normalizing its whitespace", () => {
    // A value that reached the preserve destination is by definition one this
    // build could not read, so it is the last place to assume the contents
    // follow the usual rules. SaveGame.import strips whitespace when reading.
    const spaced = "AAAA\nBBBB";
    const preserved = toTowerFile(STORE_MAGIC + spaced, true);
    expect(preserved.ok).toBe(true);
    if (!preserved.ok) return;
    expect(preserved.text).toBe(TOWER_FILE_MAGIC + "\n" + spaced + "\n");
  });
});

describe("write verification distinguishes what actually happened", () => {
  it("does not report a failed write when only the read-back failed", async () => {
    // Read and write fail for different reasons. Reporting a landed save as
    // write-failed, carrying the READ's error code, tells the player their
    // disk is full about an operation that succeeded.
    const { port } = fakeStore();
    const original = port.read.bind(port);
    let reads = 0;
    port.read = () => (++reads === 1 ? Promise.reject(new Error("io")) : original("auto", SCOPE));
    const report = await migrateSavesToStore(
      port,
      SCOPE,
      new Set(),
      readerFor({ "verticopolis-save": storeValue(PRE_2_0_SAVE) }),
    );
    // Conservative: it will not CLAIM success it could not verify, but it also
    // must not attribute a read failure to the write.
    expect(report.outcomes.get("auto")).toBe("write-failed");
    expect(report.failures).toEqual([{ id: "auto" }]);
  });

  it("treats a destination another writer holds as already-present, not a failure", async () => {
    // A stale caller snapshot is the normal case, not a hypothetical: the set
    // is taken before the run. The shell's O_EXCL refusal lands here, and
    // showing the player an error about a save that is fine would be wrong.
    const { port } = fakeStore({ auto: "SOMEONE ELSES TOWER" });
    const report = await migrateSavesToStore(
      port,
      SCOPE,
      new Set(), // deliberately stale: does not know about `auto`
      readerFor({ "verticopolis-save": storeValue(PRE_2_0_SAVE) }),
    );
    expect(report.outcomes.get("auto")).toBe("already-present");
    expect(report.failures).toEqual([]);
    expect(await port.read("auto", SCOPE)).toBe("SOMEONE ELSES TOWER");
  });

  it("cleans up a landed write whose contents came back wrong", async () => {
    // Otherwise that record becomes the derived done-marker and the source is
    // never retried, so a half-written tower would be permanent.
    const { port } = fakeStore();
    const realWrite = port.write.bind(port);
    port.write = (id, contents, scope, seq) => realWrite(id, contents.slice(0, 10), scope, seq);
    const report = await migrateSavesToStore(
      port,
      SCOPE,
      new Set(),
      readerFor({ "verticopolis-save": storeValue(PRE_2_0_SAVE) }),
    );
    expect(report.outcomes.get("auto")).toBe("write-failed");
    // The debris is gone, so the next boot sees an empty destination and retries.
    expect(await port.read("auto", SCOPE)).toBeNull();
  });

  it("survives a rejection whose code getter throws", async () => {
    // This runs inside a catch. A second throw from the handler would abandon
    // the five slots after it.
    const { port } = fakeStore();
    port.write = () =>
      Promise.reject(
        Object.defineProperty({}, "code", {
          get() {
            throw new Error("hostile");
          },
        }),
      );
    const report = await migrateSavesToStore(
      port,
      SCOPE,
      new Set(),
      readerFor({
        "verticopolis-save": storeValue(PRE_2_0_SAVE),
        "simtower-clone-slot-3": storeValue(PRE_2_0_SAVE),
      }),
    );
    expect(report.outcomes.get("auto")).toBe("write-failed");
    // The point: the loop reached the last source rather than dying at the first.
    expect(report.outcomes.get("slot-3")).toBe("write-failed");
    expect(report.failures.length).toBe(2);
  });

  it("survives a reader that returns something that is not a string", async () => {
    // `toTowerFile` is called outside any try, so a non-string here would throw
    // straight out of boot.
    const { port } = fakeStore();
    const report = await migrateSavesToStore(port, SCOPE, new Set(), (() => 42) as never);
    expect(report.nothingToDo).toBe(true);
  });
});
