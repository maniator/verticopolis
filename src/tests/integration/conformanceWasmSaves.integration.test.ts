/**
 * The Saves row of #945 (#1236): every save the web can load, loaded by the
 * Rust engine through its WASM binding, serializes to the bytes the web's
 * import path gives for the same input.
 *
 * "Byte for byte" here means the canonical JSON (keys sorted), plus the file
 * the engine writes. The binding's `serialize()` text is not compared raw: it
 * prints an integer-valued double with a trailing `.0` where JavaScript
 * prints `13551601` (EX-2). The file the engine writes (`encodeVctower`)
 * prints numbers the JavaScript way, so the raw-form test below holds it to
 * the same text as the one made from the web import's save, up to each
 * transport's key order.
 *
 * - Every `.vctower` fixture, loaded the way an import loads it (`fromVctower`
 *   against `SaveGame.importText` and the engine's `loadSave`).
 * - The loader table (`conformance/loader-cases.json`: forged and
 *   hand-edited saves) is replayed by the Rust test
 *   `forged_saves_load_as_the_typescript_loads_them`; here only its
 *   no-known-divergence state is pinned.
 * - Text that is not plain ASCII (astral characters, combining marks, a lone
 *   surrogate) in the tower name, read the way the web reads save text
 *   (`parseSaveJson`), and a save of exactly 32 MiB and one byte more,
 *   through the engine's reader and writer.
 *
 * A difference names the fixture and the first field that differs. Skips
 * without the WASM package, like the rest of `npm run test:wasm`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Engine, encodeVctower } from "../../dualrun/engine";
import type { SerializedGame } from "../../shared/types";
import { importTower } from "../fixtures/saveText";
import { MAX_SAVE_INFLATED_BYTES, STORE_MAGIC, TOWER_FILE_MAGIC, fromBase64, inflateCapped, parseSaveJson } from "../../storage/saveCompression";
import { decodeVctower } from "../../storage/vctowerContainer";
import { canonicalJson } from "../conformance/canonical";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";

const ROOT = resolve(__dirname, "../../..");
const FIXTURES = resolve(ROOT, "conformance/fixtures");
const fixtures = readdirSync(FIXTURES)
  .filter((f) => f.endsWith(".vctower"))
  .sort();
const cases = (JSON.parse(readFileSync(resolve(ROOT, "conformance/loader-cases.json"), "utf8")) as { cases: LoaderCase[] }).cases;

interface LoaderCase {
  id: string;
  input: unknown;
  knownDivergence?: string;
}

type RustSaves = { encodeVctower: typeof encodeVctower; Engine: typeof Engine };
const rustSaves = (): RustSaves => wasm() as unknown as RustSaves;

const run = hasWasmPackage();

/** The save JSON text inside a `.vctower` file. */
const jsonOfFile = (file: string): string => new TextDecoder().decode(inflateCapped(fromBase64(file.slice(TOWER_FILE_MAGIC.length).replace(/\s+/g, ""))));

/** The path of the first value that differs between two parsed saves, or null. */
export function firstDifference(a: unknown, b: unknown, path = "$"): string | null {
  if (Object.is(a, b)) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array vs object`;
  const ka = Object.keys(a);
  const kb = Object.keys(b as object);
  for (const k of new Set([...ka, ...kb])) {
    if (!ka.includes(k)) return `${path}.${k}: only in the second`;
    if (!kb.includes(k)) return `${path}.${k}: only in the first`;
    const d = firstDifference((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

/** The save as canonical JSON text, the form both engines' saves compare in. */
const canonical = (save: string): string => canonicalJson(JSON.parse(save));

/** What the engine serializes for one save text. */
function engineSerialize(save: string): string {
  const engine = wasm().Engine.fromSave(save);
  try {
    return engine.serialize();
  } finally {
    engine.free();
  }
}

describe.runIf(run)("saves audit: the Rust engine loads what the web loads, byte for byte", () => {
  it("has fixtures and loader cases to check", () => {
    expect(fixtures.length).toBeGreaterThan(0);
    expect(cases.length).toBeGreaterThan(50);
  });

  it.each(fixtures)("%s: fromVctower serializes the bytes SaveGame.importText does", async (name) => {
    const text = readFileSync(resolve(FIXTURES, name), "utf8");
    const web = JSON.stringify((await importTower(text)).serialize());
    const engine = wasm().Engine.fromVctower(text);
    try {
      const rust = engine.serialize();
      expect(firstDifference(JSON.parse(web), JSON.parse(rust)), name).toBeNull();
      expect(canonical(rust)).toBe(canonical(web));
    } finally {
      engine.free();
    }
  });

  // EX-2 (proposed). The binding's `serialize()` text carries `.0` on
  // integer-valued doubles, so it is longer than the TypeScript writer's; no
  // reader compares it raw (every consumer runs JSON.parse on it), and
  // printing it the JavaScript way costs about 1.5 times as much on the hosted
  // merge path. The file the engine writes re-prints numbers the JavaScript
  // way, so it is the same text as the one made from the TypeScript save once
  // each transport's keys are put in one order. Any other difference fails
  // here, and so does a fix of either gap, so the entry has to be removed or
  // rewritten.
  /** The save with each transport's own keys sorted: the one place the two writers' key order is known to differ. */
  const transportKeysSorted = (save: Record<string, unknown>): Record<string, unknown> => ({
    ...save,
    transports: (save.transports as Array<Record<string, unknown>>).map((t) => Object.fromEntries(Object.entries(t).sort(([x], [y]) => x.localeCompare(y, "en")))),
  });

  it.each(fixtures)("%s: the written file is the web import's text up to a transport's key order, and the binding text only adds .0", async (name) => {
    const text = readFileSync(resolve(FIXTURES, name), "utf8");
    const ts = JSON.stringify((await importTower(text)).serialize());
    const engine = wasm().Engine.fromVctower(text);
    try {
      const rust = engine.serialize();
      expect((rust.match(/\d\.0(?=[,}\]])/g) ?? []).length, name).toBeGreaterThan(0);
      expect(canonical(rust), name).toBe(canonical(ts));
      const stamp = 1_760_000_000_123;
      const fileOfRust = jsonOfFile(rustSaves().encodeVctower(rust, "3.0.0", stamp));
      const fileOfTs = jsonOfFile(rustSaves().encodeVctower(ts, "3.0.0", stamp));
      expect(fileOfRust.length, name).toBe(fileOfTs.length);
      // Numbers printed the JavaScript way: re-printing changes nothing.
      expect(JSON.stringify(JSON.parse(fileOfRust)), name).toBe(fileOfRust);
      const a = JSON.stringify(transportKeysSorted(JSON.parse(fileOfRust)));
      const b = JSON.stringify(transportKeysSorted(JSON.parse(fileOfTs)));
      expect(a, name).toBe(b);
    } finally {
      engine.free();
    }
  });

  // The loader table's cases (forged and hand-edited saves) are replayed
  // against their recorded state hashes by the Rust test
  // `forged_saves_load_as_the_typescript_loads_them` (engine-rs/src/load/loader_cases.rs).
  it("has no loader case still marked as a known divergence", () => {
    expect(cases.filter((c) => c.knownDivergence !== undefined).map((c) => c.id)).toEqual([]);
  });
});

/** The tower fixture, renamed so the save is `bytes` long once serialized and stamped. */
describe.runIf(run)("saves audit: text and size edges through the engine", () => {
  const base = (): SerializedGame => decodeVctower(readFileSync(resolve(FIXTURES, "split-tower.vctower"), "utf8"), "split-tower") as SerializedGame;

  const names: Array<[string, string]> = [
    ["astral characters", "Tower \u{1F3D9}\u{FE0F} \u{1D4B3}\u{1F680}"],
    ["combining marks", "Café Ạ̊"],
    ["right to left and joiners", "שלום ‍‌ مرحبا"],
    ["controls and quotes", 'line\nbreak\t"quoted" \\ back\u0007bell sep'],
    ["a very long name", "x".repeat(70_000)],
  ];

  it.each(names)("a tower name with %s loads and serializes as written", (_what, name) => {
    const save = { ...base(), towerName: name };
    const rust = engineSerialize(JSON.stringify(save));
    expect((JSON.parse(rust) as { towerName: string }).towerName).toBe(name);
    // A second load changes nothing.
    expect(canonical(engineSerialize(rust))).toBe(canonical(rust));
  });

  // The web reads save text through `parseSaveJson`, which repairs a lone
  // surrogate escape to U+FFFD as the engine's loader does, so the character
  // reads the same in both.
  it("a lone surrogate in the tower name loads as U+FFFD in the engine and the web's reader", () => {
    const text = JSON.stringify({ ...base(), towerName: "a\uD800b" });
    expect(text).toContain("\\ud800");
    const rust = engineSerialize(text);
    expect((JSON.parse(rust) as { towerName: string }).towerName).toBe("a\uFFFDb");
    expect((parseSaveJson(text) as { towerName: string }).towerName).toBe("a\uFFFDb");
  });

  const CAP = MAX_SAVE_INFLATED_BYTES;
  const jsonOf = jsonOfFile;
  const STAMP_AT = 1_760_000_000_123;

  /** A fixture tower whose stamped save is `bytes` long, as the web writer stamps it. */
  function towerOf(bytes: number): string {
    const rust = rustSaves();
    const probe = jsonOf(rust.encodeVctower(JSON.stringify(base()), "3.0.0", STAMP_AT));
    const pad = bytes - new TextEncoder().encode(probe).length;
    const save = { ...base(), towerName: (base() as { towerName?: string }).towerName + "x".repeat(pad) };
    return JSON.stringify(save);
  }

  it("a save of exactly 32 MiB is written by the engine and read back by the engine and the web", async () => {
    const rust = rustSaves();
    const file = rust.encodeVctower(towerOf(CAP), "3.0.0", STAMP_AT);
    expect(new TextEncoder().encode(jsonOf(file)).length).toBe(CAP);
    const engine = rust.Engine.fromVctower(file);
    const fromEngine = engine.serialize();
    engine.free();
    const fromWeb = JSON.stringify((await importTower(file)).serialize());
    expect(canonical(fromEngine)).toBe(canonical(fromWeb));
  }, 120_000);

  it("a save one byte past 32 MiB is refused by the engine's writer and reader, as the web's are", async () => {
    const rust = rustSaves();
    expect(() => rust.encodeVctower(towerOf(CAP + 1), "3.0.0", STAMP_AT)).toThrow();
    // The reader: a file whose payload inflates to one byte past the cap.
    const ok = rust.encodeVctower(towerOf(CAP), "3.0.0", STAMP_AT);
    const grown = jsonOf(ok).replace('"towerName":"', '"towerName":"x');
    expect(new TextEncoder().encode(grown).length).toBe(CAP + 1);
    const { deflateSync } = await import("fflate");
    const { toBase64 } = await import("../../storage/saveCompression");
    const file = `${TOWER_FILE_MAGIC}\n${toBase64(deflateSync(new TextEncoder().encode(grown), { level: 1 }))}\n`;
    expect(() => rust.Engine.fromVctower(file)).toThrow();
    await expect(importTower(file)).rejects.toThrow(/too large/);
    expect(STORE_MAGIC.length).toBeGreaterThan(0);
  }, 120_000);
});
