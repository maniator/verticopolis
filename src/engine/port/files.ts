import { deflateSync } from "fflate";
import { Simulation } from "../Simulation";
import { markFounderFromLoadedFile } from "../sim/founderStatus";
import type { SerializedGame } from "../types";
import {
  TOWER_FILE_MAGIC,
  encodeSaveJson,
  fromBase64,
  inflateCapped,
  SaveTooLargeError,
  parseSaveJson,
  toBase64,
} from "../../storage/saveCompression";
import { tdtCodec } from "./tdtCodec";

/**
 * `TsEngine`'s file members, as the Rust engine answers them
 * (`engine-rs/src/wasm_port_files.rs`): the `.vctower` file in and out, and
 * the 1994 `.TDT` file in and out. Each throws an `Error` whose message is
 * the refusal text; `TsEngine` turns it into `lastReason()`. The report
 * sentences stay with `tdtImportReport.ts` and `tdtExportReport.ts`.
 */

export const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** `Simulation.deserialize` with the Rust reader's refusal of a JSON
 *  `null` save (`load::deserialize`), so both engines give one reason. */
export function deserializeSave(raw: SerializedGame | null): Simulation {
  if (raw === null) throw new Error("not a tower save (the save is null)");
  return Simulation.deserialize(raw);
}

/** A `.vctower` file read into a tower, with the founder rule a stored file
 *  takes: a save with no `appVersion` predates the stamp (before 2.0). */
export function readVctower(text: string): Simulation {
  const trimmed = text.trim();
  if (!trimmed.startsWith(TOWER_FILE_MAGIC)) throw new Error("not a VCTOWER1 file");
  const packed = lenientBase64(trimmed.slice(TOWER_FILE_MAGIC.length));
  const raw = parseSaveJson(new TextDecoder("utf-8", { fatal: true }).decode(inflate(packed))) as SerializedGame;
  // Best effort past the parse, as `loadSave` and the Rust reader are.
  const sim = deserializeSave(raw);
  markFounderFromLoadedFile(sim, raw);
  return sim;
}

/** `inflateCapped` with the Rust reader's refusal text past the cap
 *  (`load::decode_vctower`); the cap's own error carries none. */
function inflate(packed: Uint8Array): Uint8Array {
  try {
    return inflateCapped(packed);
  } catch (e) {
    if (e instanceof SaveTooLargeError) {
      throw new Error("this .vctower expands to more data than we will hold; it looks crafted rather than saved");
    }
    throw e;
  }
}

/** The payload as `Buffer.from(b64, "base64")` reads it, which the Rust
 *  reader follows (`load::lenient_base64`): decoding stops at the first `=`,
 *  every character outside the alphabet is skipped, the URL-safe alphabet is
 *  taken alongside the standard one, and a dangling single symbol is dropped.
 *  `atob` ignores the last symbol's unused bits, as that reader does. */
function lenientBase64(text: string): Uint8Array {
  let symbols = text
    .split("=")[0]
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/[^A-Za-z0-9+/]/g, "");
  if (symbols.length % 4 === 1) symbols = symbols.slice(0, -1);
  return fromBase64(symbols);
}

/** The tower as `.vctower` file text, stamped with the build and the time
 *  the host passes, refused as the Rust stamp refuses. */
export function writeVctower(sim: Simulation, appVersion: string, savedAtMs: number): string {
  if (!(Number.isFinite(savedAtMs) && Math.abs(savedAtMs) <= 8.64e15)) throw new Error(`savedAt ${savedAtMs} is not a time`);
  if (Number.parseInt(appVersion, 10) < 2) {
    throw new Error(`appVersion ${JSON.stringify(appVersion)} reads as a build before 2.0, which marks the tower as a founder's`);
  }
  const data = sim.serialize();
  data.savedAt = savedAtMs;
  data.appVersion = appVersion;
  return TOWER_FILE_MAGIC + "\n" + toBase64(deflateSync(encodeSaveJson(JSON.stringify(data)), { level: 1 })) + "\n";
}

/** A `.TDT` file read and checked, waiting for `adoptTdt`. */
export interface StagedTdt {
  sim: Simulation;
  /** The header's notes, then the walk's warnings. */
  notes: string[];
  name: string | undefined;
  /** The `loadTdt` record. */
  record: Float64Array;
}

/** Read and check a `.TDT` file: the codec reads it, and the tower goes through
 *  the trust boundary every save does, never marked a founder's. */
export function stageTdt(bytes: Uint8Array, filename: string): StagedTdt {
  const read = tdtCodec().read(bytes, filename);
  let sim: Simulation;
  try {
    const raw = JSON.parse(read.saveJson) as SerializedGame;
    // Only this entrypoint knows the tower came from an authentic PC TDT;
    // carry the provenance through both engines' ordinary save/reload paths.
    for (const t of raw.transports ?? []) {
      if (t.kind === "elevatorExpress" && t.bottom < 0 && Array.isArray(t.skipFloors)) {
        t.preserveBasementStops = true;
      }
    }
    sim = Simulation.deserialize(raw);
  } catch (e) {
    throw new Error(`This SimTower save couldn't be read. (${message(e)})`);
  }
  return { sim, notes: read.notes, name: sim.tower.towerName ?? undefined, record: read.record };
}

/** The tower as `.TDT` bytes and the `tdtExport` record. */
export function writeTdt(sim: Simulation): { record: Float64Array; bytes: Uint8Array } {
  return tdtCodec().write(JSON.stringify(sim.serialize()));
}
