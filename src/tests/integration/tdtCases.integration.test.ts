/**
 * TDT conformance table: synthetic `.TDT` files run through `parseTDT`, and
 * serialized towers run through `buildTDT`, pinned into
 * `conformance/tdt-cases.json` for the Rust `tdt` referee
 * (`cargo run --release --bin tdt`) to replay. The cases are generated here
 * from code so they regenerate on purpose only, like the scenario lock:
 * `VC_CONFORMANCE_UPDATE=1 npx vitest run --project integration tdtCases`.
 *
 * Every import case is a synthetic buffer from `buildTdt` (never bytes from a
 * real, copyrighted SimTower save), pinned as the canonical-JSON hash of the
 * serialized game the importer produces plus the sorted warnings of the
 * binary walk, or as the message of the `LegacyImportError` it throws. Every
 * export case is a serialized tower (a hand-built save embedded in the lock,
 * or a `.vctower` fixture loaded and re-serialized the way the export menu
 * does), pinned as the SHA-256 of the bytes `buildTDT` writes, or as the
 * message of the `LegacyExportError` it throws.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import type { SerializedGame } from "../../engine/types";
import { LegacyExportError, buildTDT } from "../../storage/tdtExport";
import { parseTdtBinary } from "../../storage/tdtFormat";
import { LegacyImportError, parseTDT } from "../../storage/tdtImport";
import { decodeVctower } from "../../storage/vctowerContainer";
import { digest } from "../conformance/canonical";
import { exportInputs } from "../fixtures/tdtExportCases";
import { importInputs } from "../fixtures/tdtImportCases";

const LOCK = resolve(__dirname, "../../../conformance/tdt-cases.json");
const FIXTURES = resolve(__dirname, "../fixtures");
const REPO_ROOT = resolve(__dirname, "../../..");
const UPDATE = process.env.VC_CONFORMANCE_UPDATE === "1";
if (UPDATE && process.env.CI) throw new Error("VC_CONFORMANCE_UPDATE is a local regeneration switch and never runs in CI");

/** One `.TDT` through the importer: the hash of the serialized game and the
 *  binary walk's warnings, or the player-readable error. */
type ImportCase = {
  id: string;
  filename: string;
  /** The file: raw deflate, base64 (the buffers are mostly zero fill). */
  bytes: string;
  expected?: { save: string; warnings: string[] };
  throws?: string;
};

/** One serialized tower through the exporter: the SHA-256 of the file, or the
 *  player-readable error. `save` is embedded for hand-built towers; `fixture`
 *  names a `.vctower` under the repository root that both sides load,
 *  deserialize and re-serialize before exporting (the export menu's own path). */
type ExportCase = {
  id: string;
  save?: unknown;
  /** The save is another case's `save` with `patch` merged over its top
   *  level (the sample variants, which would otherwise repeat 40 KB each). */
  base?: string;
  patch?: Record<string, unknown>;
  fixture?: string;
  expected?: string;
  throws?: string;
};

type Lock = { import: ImportCase[]; export: ExportCase[] };
function importCase(id: string, bytes: Uint8Array, filename = "TOWER.TDT"): ImportCase {
  const base = { id, filename, bytes: deflateRawSync(bytes).toString("base64") };
  try {
    const parsed = parseTDT(bytes.slice().buffer as ArrayBuffer, filename);
    const warnings = [...parseTdtBinary(bytes).warnings].sort();
    return { ...base, expected: { save: digest(parsed.save), warnings } };
  } catch (err) {
    if (!(err instanceof LegacyImportError)) throw err;
    return { ...base, throws: err.message };
  }
}

function exportCase(id: string, input: unknown): ExportCase {
  try {
    return { id, expected: createHash("sha256").update(buildTDT(input as SerializedGame).bytes).digest("hex") };
  } catch (err) {
    if (!(err instanceof LegacyExportError)) throw err;
    return { id, throws: err.message };
  }
}

/** A `.vctower` fixture the way the export menu sees it: decoded, loaded and
 *  re-serialized by the engine. */
function fixtureSave(file: string): SerializedGame {
  const raw = decodeVctower(readFileSync(resolve(REPO_ROOT, file), "utf8"), file) as SerializedGame;
  return JSON.parse(JSON.stringify(Simulation.deserialize(raw).serialize())) as SerializedGame;
}

/** One case per line, so a regenerated lock diffs by case. */
function writeLock(l: Lock): void {
  const rows = (cases: unknown[]) => cases.map((c) => `  ${JSON.stringify(c)}`).join(",\n");
  writeFileSync(LOCK, `{\n "import": [\n${rows(l.import)}\n ],\n "export": [\n${rows(l.export)}\n ]\n}\n`);
}

function buildLock(): Lock {
  const imports = importInputs().map(([id, bytes, filename]) => importCase(id, bytes, filename));
  // Hand-built saves cross the lock as JSON, so the hash is taken of the
  // JSON round trip of each one (a NaN or an Infinity becomes null on both
  // sides), never of the in-memory object.
  const saves = new Map<string, unknown>();
  const exports: ExportCase[] = exportInputs().map(([id, entry]) => {
    if ("save" in entry) {
      const input = JSON.parse(JSON.stringify(entry.save)) as unknown;
      saves.set(id, input);
      return { save: input, ...exportCase(`export-${id}`, input) };
    }
    const patch = JSON.parse(JSON.stringify(entry.patch)) as Record<string, unknown>;
    const input = { ...(saves.get(entry.base) as Record<string, unknown>), ...patch };
    return { base: `export-${entry.base}`, patch, ...exportCase(`export-${id}`, input) };
  });
  for (const f of readdirSync(FIXTURES).filter((f) => f.endsWith(".vctower")).sort()) {
    const fixture = `src/tests/fixtures/${f}`;
    exports.push({ fixture, ...exportCase(`export-fixture-${f.replace(/\.vctower$/, "")}`, fixtureSave(fixture)) });
  }
  return { import: imports, export: exports };
}

describe("tdt conformance table", () => {
  const lock = buildLock();
  it("has a unique id per case", () => {
    const ids = [...lock.import.map((c) => c.id), ...lock.export.map((c) => c.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("locks every case in conformance/tdt-cases.json", () => {
    if (UPDATE) {
      writeLock(lock);
      return;
    }
    expect(existsSync(LOCK)).toBe(true);
    const pinned = JSON.parse(readFileSync(LOCK, "utf8")) as Lock;
    expect(pinned.import.map((c) => c.id)).toEqual(lock.import.map((c) => c.id));
    expect(pinned.export.map((c) => c.id)).toEqual(lock.export.map((c) => c.id));
    // Inputs are compared too (the bytes and the embedded saves), so a change
    // to the builder or a fixture cannot leave the Rust side replaying a stale
    // input under an unchanged hash.
    for (const [i, c] of lock.import.entries()) expect(c).toEqual(pinned.import[i]);
    for (const [i, c] of lock.export.entries()) {
      expect({ ...c, save: digest(c.save ?? null) }).toEqual({ ...pinned.export[i], save: digest(pinned.export[i].save ?? null) });
    }
  });
});
