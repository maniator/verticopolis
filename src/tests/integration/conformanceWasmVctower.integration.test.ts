/**
 * The `.vctower` writer in the Rust engine (`encode_vctower` with the
 * `stamp_save` stamp, reached here as `encodeVctower` through the WASM
 * binding) against the web game's readers. A host other than the web game
 * can write saves with the engine's encoder, so every file it writes has to
 * open in the web game exactly as the web game's own file of the same save.
 *
 * Every `.vctower` fixture the web game wrote is loaded the way an import
 * loads it, serialized, then stamped and written by the engine, and read back
 * by each web reader: `decodeVctower` (the Node container decoder),
 * `fromTowerFile` (the desktop store's re-header), and `SaveGame.import` (the
 * player's import). The engine's file must be the web game's file of the
 * same save, stamp and time, byte for byte (#939): the JSON is
 * `JSON.stringify`'s text in the web's key order, and the compressor is a
 * port of the web's (fflate at level 1). The tower `SaveGame.import`
 * builds must hash to the same state, with the same Founder status, as the
 * one built from the original file. A loaded tower that is no founder's, and
 * a new game, written by the engine must open as no founder's tower, and the
 * binding must refuse a stamp the web game would read as a founder's, and a
 * save that is no tower.
 *
 * Skips without the WASM package, like the rest of `npm run test:wasm`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Engine, encodeVctower, exportTdt } from "../../dualrun/engine";
import { SaveGame } from "../../storage/SaveGame";
import { fromBase64, inflateCapped, parseSaveJson, STORE_MAGIC } from "../../storage/saveCompression";
import { fromTowerFile, toTowerFile } from "../../storage/towerFileCodec";
import { setEngineWriter } from "../../storage/vctowerWriter";
import { decodeVctower } from "../../storage/vctowerContainer";
import { tsEngine } from "../conformance/scenario";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";

const FIXTURES = resolve(__dirname, "../fixtures");
const fixtures = readdirSync(FIXTURES)
  .filter((f) => f.endsWith(".vctower"))
  .sort();

const VERSION = "3.0.0";
const SAVED_AT = 1_760_000_000_123;

type RustVctower = { encodeVctower: typeof encodeVctower; exportTdt: typeof exportTdt; Engine: typeof Engine };
const rust = (): RustVctower => wasm() as unknown as RustVctower;

/** The JSON text inside a `.vctower`, read the way the desktop store reads
 *  the value `fromTowerFile` hands it. */
function payloadText(text: string): string {
  const stored = fromTowerFile(text);
  expect(stored.ok).toBe(true);
  if (!stored.ok) throw new Error("fromTowerFile refused the engine's file");
  return new TextDecoder("utf-8", { fatal: true }).decode(inflateCapped(fromBase64(stored.value.slice(STORE_MAGIC.length))));
}

const run = hasWasmPackage() || wasmRequired();

describe.runIf(run)("the engine's .vctower writer opens in the web game", () => {
  it("has fixtures to check", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(fixtures)("%s: loaded by the web game, written by the engine, read back by every web reader", async (name) => {
    const original = readFileSync(resolve(FIXTURES, name), "utf8");
    // What SaveGame.export hands its writer: the loaded tower's serialization.
    const fromWeb = await SaveGame.import(original);
    const json = JSON.stringify(fromWeb.serialize());
    const text = rust().encodeVctower(json, VERSION, SAVED_AT);
    const stamped = { ...(JSON.parse(json) as Record<string, unknown>), savedAt: SAVED_AT, appVersion: VERSION };

    expect(text).toMatch(/^VCTOWER1\n[A-Za-z0-9+/]+={0,2}\n$/);
    // The TypeScript writer's file of the same stamped save, byte for byte.
    const web = toTowerFile(JSON.stringify(stamped));
    expect(web.ok).toBe(true);
    if (web.ok) expect(text).toBe(web.text);

    expect(decodeVctower(text, name)).toEqual(stamped);
    expect(payloadText(text)).toBe(JSON.stringify(stamped));

    const fromEngine = await SaveGame.import(text);
    expect(fromEngine.founder).toBe(fromWeb.founder);
    expect(tsEngine(fromEngine).stateDigest()).toBe(tsEngine(fromWeb).stateDigest());
  });

  // SaveGame.export stamps with the build and the clock; pin both and the
  // engine, handed the same, writes the same file (#939).
  it.each(fixtures)("%s: the engine writes the web game's export byte for byte", async (name) => {
    const original = readFileSync(resolve(FIXTURES, name), "utf8");
    const sim = await SaveGame.import(original);
    vi.useFakeTimers({ now: SAVED_AT, toFake: ["Date"] });
    try {
      const webFile = await SaveGame.export(sim);
      expect(rust().encodeVctower(JSON.stringify(sim.serialize()), __APP_VERSION__, SAVED_AT)).toBe(webFile);
      // packSync, the localStorage writer the desktop store re-headers, packs
      // the same bits.
      expect(SaveGame.packSync(sim)).toBe(STORE_MAGIC + (webFile.split("\n")[1] ?? ""));
    } finally {
      vi.useRealTimers();
    }
  });

  // With the engine running, the web game writes its saves through the
  // engine's writer (#935); the files stay the bytes it wrote on its own.
  it.each(fixtures)("%s: the game's writers through the engine write what they write alone", async (name) => {
    const sim = await SaveGame.import(readFileSync(resolve(FIXTURES, name), "utf8"));
    vi.useFakeTimers({ now: SAVED_AT, toFake: ["Date"] });
    const error = vi.spyOn(console, "error");
    try {
      const own = [await SaveGame.export(sim), SaveGame.packSync(sim)];
      setEngineWriter(rust().encodeVctower);
      expect([await SaveGame.export(sim), SaveGame.packSync(sim)]).toEqual(own);
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      setEngineWriter(null);
      vi.useRealTimers();
    }
  });

  // A save that already carries a stamp keeps each stamp key where it was,
  // as the property assignments in SaveGame's stamp() keep it (#939).
  it("restamps a stamped save in place, as the web writer does", () => {
    const json = JSON.stringify({ savedAt: 1, version: 7, appVersion: "2.5.0", minutes: 0, units: [], towerName: "Sky" });
    const web = toTowerFile(JSON.stringify({ ...JSON.parse(json), savedAt: SAVED_AT, appVersion: VERSION }));
    expect(web.ok).toBe(true);
    if (web.ok) expect(rust().encodeVctower(json, VERSION, SAVED_AT)).toBe(web.text);
  });

  // The compressor port against fflate itself on saves the fixtures do not
  // reach: tower names of many lengths and kinds of text (runs, repeats,
  // random letters, any character), so every block type, both table sizes
  // and the code length limit get written (#939).
  it("writes what the web writer writes for many kinds of save text", () => {
    let x = 20261013;
    const next = (): number => {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return (x >>>= 0);
    };
    const pick = (alphabet: string): string => alphabet[next() % alphabet.length] ?? "a";
    const kinds: Array<() => string> = [
      () => pick("ab"),
      () => pick("abcdefghijklmnopqrstuvwxyz "),
      () => String.fromCharCode(32 + (next() % 95)),
      () => String.fromCodePoint(0x20 + (next() % 0x2fff)),
      () => pick("xy").repeat(1 + (next() % 300)),
      () => "Tower " + (next() % 1000) + ", ",
    ];
    for (let n = 0; n < 40; n++) {
      const make = kinds[n % kinds.length] ?? kinds[0];
      const length = [0, 1, 2, 3, 100, 3000, 9000, 25000, 70000, 200000][n % 10] ?? 0;
      let name = "";
      while (name.length < length && make) name += make();
      const save = { version: 7, minutes: next() % 100000, units: [], towerName: name };
      const json = JSON.stringify(save);
      const web = toTowerFile(JSON.stringify({ ...save, savedAt: SAVED_AT, appVersion: VERSION }));
      expect(web.ok).toBe(true);
      if (web.ok) expect(rust().encodeVctower(json, VERSION, SAVED_AT), `save ${n}`).toBe(web.text);
    }
  });

  it.each(["classic", "modern"])("a new %s game written by the engine opens as no founder's tower", async (mode) => {
    const engine = rust().Engine.newGame(20261010, mode);
    try {
      const json = engine.serialize();
      const text = rust().encodeVctower(json, VERSION, SAVED_AT);
      const sim = await SaveGame.import(text);
      expect(sim.founder).toBe(false);
      expect(payloadText(text)).toBe(JSON.stringify({ ...JSON.parse(json), savedAt: SAVED_AT, appVersion: VERSION }));
      expect(tsEngine(sim).stateDigest()).toBe(engine.stateDigest());
      // The engine's stamp adds exactly the fields SaveGame.export's does.
      const webKeys = Object.keys(decodeVctower(await SaveGame.export(sim)) as object).sort();
      const engineKeys = Object.keys(decodeVctower(text) as object).sort();
      expect(engineKeys).toEqual(webKeys);
    } finally {
      engine.free();
    }
  });

  // Every fixture is a founder's tower, so this one is derived: a fixture
  // re-stamped as written by a 2.x build, with no founder flag, loads in the
  // web game as no founder's tower and must stay that way through the engine.
  it("a loaded tower that is no founder's stays so through the engine", async () => {
    const first = fixtures[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const raw = decodeVctower(readFileSync(resolve(FIXTURES, first), "utf8")) as Record<string, unknown>;
    delete raw.founder;
    const later = toTowerFile(JSON.stringify({ ...raw, appVersion: "2.5.0" }));
    expect(later.ok).toBe(true);
    if (!later.ok) return;
    const fromWeb = await SaveGame.import(later.text);
    expect(fromWeb.founder).toBe(false);
    const text = rust().encodeVctower(JSON.stringify(fromWeb.serialize()), VERSION, SAVED_AT);
    const fromEngine = await SaveGame.import(text);
    expect(fromEngine.founder).toBe(false);
    expect(tsEngine(fromEngine).stateDigest()).toBe(tsEngine(fromWeb).stateDigest());
  });

  // A build name that is not a number reads as no founder's tower in the
  // web game's own rule (`markFounderFromLoadedFile`, `detectFounder`).
  it.each(["", "dev"])("a stamp named %j opens as no founder's tower", async (version) => {
    const engine = rust().Engine.newGame(20261011, "classic");
    try {
      const sim = await SaveGame.import(rust().encodeVctower(engine.serialize(), version, SAVED_AT));
      expect(sim.founder).toBe(false);
    } finally {
      engine.free();
    }
  });

  // A founder's file decoded but never loaded (its old stamp still in place)
  // keeps the badge when the engine stamps it again.
  it("a re-stamped founder's file stays a founder's tower", async () => {
    const name = "split-tower.vctower";
    const raw = decodeVctower(readFileSync(resolve(FIXTURES, name), "utf8"), name) as Record<string, unknown>;
    expect(raw.appVersion).toBe("1.100.0");
    const text = rust().encodeVctower(JSON.stringify(raw), VERSION, SAVED_AT);
    expect((await SaveGame.import(text)).founder).toBe(true);
  });

  // A name cut through an emoji (the rename box counts UTF-16 units) leaves
  // half a surrogate pair, which JSON.stringify writes as an escape a Rust
  // string cannot hold. The web game writes such a tower; the engine has to
  // open it, with U+FFFD where the half character was, and the web game's own
  // loader agrees (#936).
  it("a tower the web game wrote with a split emoji opens in the engine", async () => {
    const first = fixtures[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const sim = await SaveGame.import(readFileSync(resolve(FIXTURES, first), "utf8"));
    sim.tower.towerName = "Sky \ud83c";
    const webFile = await SaveGame.export(sim);
    const json = JSON.stringify(sim.serialize());
    expect(json).toContain("\\ud83c");
    // The file the web writer made carries the escape itself.
    expect(payloadText(webFile)).toContain("\\ud83c");

    const nameIn = (engine: Engine): unknown => (JSON.parse(engine.serialize()) as { towerName?: unknown }).towerName;
    for (const engine of [rust().Engine.fromVctower(webFile), rust().Engine.fromSave(json)]) {
      try {
        expect(nameIn(engine)).toBe("Sky \uFFFD");
      } finally {
        engine.free();
      }
    }

    // The web loader repairs the same string the same way, so both engines
    // hold one tower and the dual run sees no divergence (#936).
    const webLoaded = await SaveGame.import(webFile);
    expect(webLoaded.tower.towerName).toBe("Sky \uFFFD");
    // The Node decoder the dual-run and conformance harnesses load with too.
    expect((decodeVctower(webFile) as { towerName?: unknown }).towerName).toBe("Sky \uFFFD");
    const fromWebFile = rust().Engine.fromVctower(webFile);
    try {
      expect(tsEngine(webLoaded).stateDigest()).toBe(fromWebFile.stateDigest());
    } finally {
      fromWebFile.free();
    }

    const written = rust().encodeVctower(json, VERSION, SAVED_AT);
    expect((await SaveGame.import(written)).tower.towerName).toBe("Sky \uFFFD");
    expect(rust().exportTdt(json).length).toBeGreaterThan(0);
  });

  // Both engines repair the save text before parsing it, so keys that
  // repair to one name collapse the same way, last one winning, whatever
  // their order and depth (#936).
  it.each([
    String.raw`"k\ud800":1,"k\udc00":2`,
    String.raw`"k\udc00":2,"k\ud800":1`,
    String.raw`"k\ud800":1,"k\uFFFD":2,"k\ud800":3`,
  ])("keys that repair to one name read the same in both engines: %s", (body) => {
    const json = `{"version":7,"minutes":0,"units":[{${body}}],${body},"o":{${body},"i":{${body}}}}`;
    const web = parseSaveJson(json) as Record<string, unknown>;
    const engine = JSON.parse(payloadText(rust().encodeVctower(json, VERSION, SAVED_AT))) as unknown;
    expect(engine).toEqual({ ...web, savedAt: SAVED_AT, appVersion: VERSION });
  });

  it("refuses what the web game would load wrong or refuse", () => {
    const tower = JSON.stringify({ version: 7, minutes: 0, units: [] });
    expect(() => rust().encodeVctower("{not json", VERSION, SAVED_AT)).toThrow(/^save: /);
    for (const v of ["1.9.0", "0.1", " 1"]) {
      expect(() => rust().encodeVctower(tower, v, SAVED_AT), v).toThrow(/before 2\.0/);
    }
    for (const at of [Number.NaN, Number.POSITIVE_INFINITY, 8.64e15 + 1]) {
      expect(() => rust().encodeVctower(tower, VERSION, at), String(at)).toThrow(/not a time/);
    }
    for (const notTower of ["null", "42", "[]", "{}", JSON.stringify({ minutes: 0, units: {} })]) {
      expect(() => rust().encodeVctower(notTower, VERSION, SAVED_AT), notTower).toThrow(/not a tower save/);
    }
  });
});
