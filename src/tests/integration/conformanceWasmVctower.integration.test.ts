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
 * player's import). `decodeVctower` must give back the stamped save, the
 * payload `fromTowerFile` hands the store must be that save's canonical JSON
 * (`JSON.stringify` formatting, keys in code unit order), the framing must
 * be the one the TypeScript writer puts around the same save, and the tower
 * `SaveGame.import` builds must hash to the same state,
 * with the same Founder status, as the one built from the original file. A
 * loaded tower that is no founder's, and a new game, written by the engine
 * must open as no founder's tower, and the binding must refuse a stamp the
 * web game would read as a founder's, and a save that is no tower.
 *
 * Skips without the WASM package, like the rest of `npm run test:wasm`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Engine, encodeVctower, exportTdt } from "../../dualrun/engine";
import { SaveGame } from "../../storage/SaveGame";
import { fromBase64, inflateCapped, STORE_MAGIC } from "../../storage/saveCompression";
import { fromTowerFile, toTowerFile } from "../../storage/towerFileCodec";
import { decodeVctower } from "../../storage/vctowerContainer";
import { canonicalJson } from "../conformance/canonical";
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
    expect((text.length - "VCTOWER1\n".length - 1) % 4).toBe(0);
    // The TypeScript writer's framing around the same save: only the base64
    // run between the magic line and the closing newline may differ.
    const web = toTowerFile(json);
    expect(web.ok).toBe(true);
    if (web.ok) expect(web.text.replace(/\n[^\n]*\n$/, "\n#\n")).toBe(text.replace(/\n[^\n]*\n$/, "\n#\n"));

    expect(decodeVctower(text, name)).toEqual(stamped);
    // Every byte of the JSON the engine can match: JSON.stringify's
    // formatting with keys in code unit order, the canonical text.
    expect(payloadText(text)).toBe(canonicalJson(stamped));

    const fromEngine = await SaveGame.import(text);
    expect(fromEngine.founder).toBe(fromWeb.founder);
    expect(tsEngine(fromEngine).stateDigest()).toBe(tsEngine(fromWeb).stateDigest());
  });

  it.each(["classic", "modern"])("a new %s game written by the engine opens as no founder's tower", async (mode) => {
    const engine = rust().Engine.newGame(20261010, mode);
    try {
      const json = engine.serialize();
      const text = rust().encodeVctower(json, VERSION, SAVED_AT);
      const sim = await SaveGame.import(text);
      expect(sim.founder).toBe(false);
      expect(payloadText(text)).toBe(canonicalJson({ ...JSON.parse(json), savedAt: SAVED_AT, appVersion: VERSION }));
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
  // open it, with U+FFFD where the half character was (#936).
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

    const written = rust().encodeVctower(json, VERSION, SAVED_AT);
    expect((await SaveGame.import(written)).tower.towerName).toBe("Sky \uFFFD");
    expect(rust().exportTdt(json).length).toBeGreaterThan(0);
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
