import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deflateSync } from "fflate";
import type { Simulation } from "../engine/Simulation";
import { SaveGame } from "./SaveGame";
import {
  MAX_SAVE_INFLATED_BYTES,
  SaveTooLargeError,
  STORE_MAGIC,
  TOWER_FILE_MAGIC,
  fromBase64,
  inflateCapped,
  toBase64,
} from "./saveCompression";
import { toTowerFile } from "./towerFileCodec";

/**
 * The one 32 MiB cap at its edge, on a real tower: a save whose JSON is
 * exactly the cap writes through every web writer and opens through every
 * reader, and one byte more is refused by every writer and every reader.
 * The fixture's own tower name pads the save to the size each test needs.
 */

const CAP = MAX_SAVE_INFLATED_BYTES;
// SaveGame's autosave key, the slot `loadResult` reads first.
const AUTO_KEY = "verticopolis-save";
const FIXTURE = resolve(__dirname, "../../conformance/fixtures/split-tower.vctower");

/** The JSON text inside a VCZ1 store value or a `.vctower` file. */
function jsonOf(packed: string): string {
  const b64 = packed.startsWith(STORE_MAGIC) ? packed.slice(STORE_MAGIC.length) : packed.slice(TOWER_FILE_MAGIC.length);
  return new TextDecoder().decode(inflateCapped(fromBase64(b64.replace(/\s+/g, ""))));
}

/** The fixture tower, renamed so its stamped save is exactly `bytes` long. */
async function towerOf(bytes: number): Promise<Simulation> {
  const sim = await SaveGame.import(readFileSync(FIXTURE, "utf8"));
  const base = new TextEncoder().encode(jsonOf(SaveGame.packSync(sim))).length;
  sim.tower.towerName = sim.tower.towerName + "x".repeat(bytes - base);
  return sim;
}

/** The save text of a tower one byte past the cap, written by hand (every
 *  web writer refuses it). */
async function oversizedJson(): Promise<string> {
  const json = jsonOf(SaveGame.packSync(await towerOf(CAP)));
  const grown = json.replace('"towerName":"', '"towerName":"x');
  expect(new TextEncoder().encode(grown).length).toBe(CAP + 1);
  return grown;
}

beforeEach(() => {
  // A fixed clock keeps the savedAt stamp, and so the save's length, steady.
  vi.useFakeTimers({ now: 1_760_000_000_123, toFake: ["Date"] });
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("a save of exactly 32 MiB", () => {
  it("is the cap, the same as the engine's (load.rs MAX_SAVE_INFLATED_BYTES)", () => {
    expect(CAP).toBe(32 * 1024 * 1024);
  });

  it("writes through every writer and opens through every reader", async () => {
    const sim = await towerOf(CAP);
    const name = sim.tower.towerName;

    const packed = SaveGame.packSync(sim);
    const json = jsonOf(packed);
    expect(new TextEncoder().encode(json).length).toBe(CAP);

    SaveGame.saveTo(AUTO_KEY, sim);
    const sync = SaveGame.loadResult();
    expect(sync.corrupt).toBe(false);
    expect(sync.sim?.tower.towerName).toBe(name);

    localStorage.clear();
    await SaveGame.saveToAsync(AUTO_KEY, sim);
    const async = SaveGame.loadResult();
    expect(async.corrupt).toBe(false);
    expect(async.sim?.tower.towerName).toBe(name);

    const file = await SaveGame.export(sim);
    expect(new TextEncoder().encode(jsonOf(file)).length).toBe(CAP);
    expect((await SaveGame.import(file)).tower.towerName).toBe(name);

    const reheadered = toTowerFile(json);
    expect(reheadered.ok).toBe(true);
    if (reheadered.ok) expect((await SaveGame.import(reheadered.text)).tower.towerName).toBe(name);
  }, 60_000);
});

describe("a save one byte past 32 MiB", () => {
  it("is refused by every writer, which leave the slot as it was", async () => {
    const sim = await towerOf(CAP + 1);
    expect(() => SaveGame.packSync(sim)).toThrow(SaveTooLargeError);
    expect(() => SaveGame.saveTo(AUTO_KEY, sim)).toThrow(SaveTooLargeError);
    await expect(SaveGame.saveToAsync(AUTO_KEY, sim)).rejects.toThrow(SaveTooLargeError);
    expect(localStorage.getItem(AUTO_KEY)).toBeNull();
    await expect(SaveGame.export(sim)).rejects.toThrow(SaveTooLargeError);
  }, 60_000);

  it("is refused by every reader", async () => {
    const json = await oversizedJson();
    const b64 = toBase64(deflateSync(new TextEncoder().encode(json), { level: 1 }));

    localStorage.setItem(AUTO_KEY, STORE_MAGIC + b64);
    const stored = SaveGame.loadResult();
    expect(stored.sim).toBeNull();
    expect(stored.corrupt).toBe(true);

    await expect(SaveGame.import(TOWER_FILE_MAGIC + "\n" + b64 + "\n")).rejects.toThrow(/too large/);
    // The byte-preserving re-header refuses it too.
    expect(toTowerFile(json).ok).toBe(false);
  }, 60_000);
});
