/**
 * The Saves row of #945 (#1236): every save the web can load, loaded by the
 * Rust engine through its WASM binding, serializes to the bytes the TypeScript
 * engine writes for the same input.
 *
 * "Byte for byte" here means the canonical JSON: keys sorted and every number
 * re-printed in JavaScript form. The raw text is not compared, because it
 * differs in two known ways (EX-2, proposed, and the owner has not yet said
 * whether canonical equality is the row's criterion): the order of a
 * transport's keys follows the history of the TypeScript object (`carLoad`
 * lands after `load` when dispatch adds it and before it when a save carries
 * it), and the binding's `serialize()` prints an integer-valued double with a
 * trailing `.0` where JavaScript prints `13551601`. The raw-form test below
 * pins both, with their size.
 *
 * - Every `.vctower` fixture, loaded the way an import loads it (`fromVctower`
 *   against `SaveGame.import`).
 * - Every loader-table case (`conformance/loader-cases.json`: forged and
 *   hand-edited saves), `fromSave` against `Simulation.deserialize`. The
 *   `knownDivergence` cases (#858) are pinned as still different, so a fix
 *   flips them here and the entry has to be removed on purpose.
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
import { Simulation } from "../../engine/Simulation";
import type { SerializedGame } from "../../engine/types";
import { SaveGame } from "../../storage/SaveGame";
import { MAX_SAVE_INFLATED_BYTES, STORE_MAGIC, TOWER_FILE_MAGIC, fromBase64, inflateCapped, parseSaveJson } from "../../storage/saveCompression";
import { decodeVctower } from "../../storage/vctowerContainer";
import { canonicalJson } from "../conformance/canonical";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";

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

const run = hasWasmPackage() || wasmRequired();

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

/** What each engine serializes for one save text, read the way the web reads it. */
function bothSerialize(save: string): { ts: string; rust: string } {
  const ts = JSON.stringify(Simulation.deserialize(parseSaveJson(save) as SerializedGame).serialize());
  const engine = wasm().Engine.fromSave(save);
  try {
    return { ts, rust: engine.serialize() };
  } finally {
    engine.free();
  }
}

describe.runIf(run)("saves audit: the Rust engine loads what the web loads, byte for byte", () => {
  it("has fixtures and loader cases to check", () => {
    expect(fixtures.length).toBeGreaterThan(0);
    expect(cases.length).toBeGreaterThan(50);
  });

  it.each(fixtures)("%s: fromVctower serializes the bytes SaveGame.import does", async (name) => {
    const text = readFileSync(resolve(FIXTURES, name), "utf8");
    const web = JSON.stringify((await SaveGame.import(text)).serialize());
    const engine = wasm().Engine.fromVctower(text);
    try {
      const rust = engine.serialize();
      expect(firstDifference(JSON.parse(web), JSON.parse(rust)), name).toBeNull();
      expect(canonical(rust)).toBe(canonical(web));
    } finally {
      engine.free();
    }
  });

  // EX-2 (proposed): the raw text is not equal. The binding's `serialize()`
  // prints an integer-valued double with a trailing `.0`, so its text is a
  // little longer than the TypeScript writer's; the file the engine writes
  // from it (`encodeVctower` re-prints numbers the JavaScript way) has the
  // same length as the file made from the TypeScript text, and differs only
  // in the key order inside transports. A fix removes the entry.
  it.each(fixtures)("%s: the raw text differs from the TypeScript writer's only in number form, and the written file only in key order", async (name) => {
    const text = readFileSync(resolve(FIXTURES, name), "utf8");
    const ts = JSON.stringify((await SaveGame.import(text)).serialize());
    const engine = wasm().Engine.fromVctower(text);
    try {
      const rust = engine.serialize();
      const dotZero = (rust.match(/\d\.0(?=[,}\]])/g) ?? []).length;
      expect(rust, name).not.toBe(ts);
      expect(dotZero, name).toBeGreaterThan(0);
      expect(rust.length - ts.length, name).toBeGreaterThan(0);
      const stamp = 1_760_000_000_123;
      const fileOfRust = jsonOfFile(rustSaves().encodeVctower(rust, "3.0.0", stamp));
      const fileOfTs = jsonOfFile(rustSaves().encodeVctower(ts, "3.0.0", stamp));
      expect(fileOfRust.length, name).toBe(fileOfTs.length);
      expect(canonicalJson(JSON.parse(fileOfRust)), name).toBe(canonicalJson(JSON.parse(fileOfTs)));
    } finally {
      engine.free();
    }
  });

  it.each(cases.filter((c) => c.knownDivergence === undefined).map((c) => [c.id, c] as const))("loader case %s: fromSave serializes the bytes deserialize does", (_id, c) => {
    const { ts, rust } = bothSerialize(JSON.stringify(c.input));
    expect(firstDifference(JSON.parse(ts), JSON.parse(rust)), c.id).toBeNull();
    expect(canonical(rust)).toBe(canonical(ts));
  });

  it.each(cases.filter((c) => c.knownDivergence !== undefined).map((c) => [c.id, c] as const))("known divergence %s: still different, so a fix removes the entry", (_id, c) => {
    const { ts, rust } = bothSerialize(JSON.stringify(c.input));
    expect(canonical(rust), `${c.id} (${c.knownDivergence}) now matches: remove its knownDivergence`).not.toBe(canonical(ts));
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

  it.each(names)("a tower name with %s loads and serializes the same", (_what, name) => {
    const save = { ...base(), towerName: name };
    const { ts, rust } = bothSerialize(JSON.stringify(save));
    expect(firstDifference(JSON.parse(ts), JSON.parse(rust))).toBeNull();
    expect(canonical(rust)).toBe(canonical(ts));
  });

  // The web reads save text through `parseSaveJson`, which repairs a lone
  // surrogate escape to U+FFFD as the engine's loader does, so the character
  // loads the same in both. (`Simulation.deserialize` on a raw `JSON.parse`
  // would keep the half character, but no web reader calls it that way.)
  it("a lone surrogate in the tower name loads as U+FFFD in both engines through the web's reader", () => {
    const text = JSON.stringify({ ...base(), towerName: "a\uD800b" });
    expect(text).toContain("\\ud800");
    const { ts, rust } = bothSerialize(text);
    expect((JSON.parse(ts) as { towerName: string }).towerName).toBe("a\uFFFDb");
    expect(firstDifference(JSON.parse(ts), JSON.parse(rust))).toBeNull();
    expect(canonical(rust)).toBe(canonical(ts));
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
    const fromWeb = JSON.stringify((await SaveGame.import(file)).serialize());
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
    await expect(SaveGame.import(file)).rejects.toThrow(/too large/);
    expect(STORE_MAGIC.length).toBeGreaterThan(0);
  }, 120_000);
});
