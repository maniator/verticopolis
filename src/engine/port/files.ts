import { deflateSync } from "fflate";
import { Simulation } from "../Simulation";
import { markFounderFromLoadedFile } from "../sim/founderStatus";
import type { SerializedGame } from "../types";
import {
  TOWER_FILE_MAGIC,
  encodeSaveJson,
  fromBase64,
  inflateCapped,
  parseSaveJson,
  toBase64,
} from "../../storage/saveCompression";
import { parseTDT } from "../../storage/tdtParse";
import { buildTDT } from "../../storage/tdtExport";

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
  const raw = parseSaveJson(new TextDecoder("utf-8", { fatal: true }).decode(inflateCapped(packed))) as SerializedGame;
  // Best effort past the parse, as `loadSave` and the Rust reader are.
  const sim = deserializeSave(raw);
  markFounderFromLoadedFile(sim, raw);
  return sim;
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

/** Read and check a `.TDT` file: the importer's output goes through the
 *  trust boundary every save does, and is never marked a founder's tower. */
export function stageTdt(bytes: Uint8Array, filename: string): StagedTdt {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const { save, facts } = parseTDT(buffer, filename);
  let sim: Simulation;
  try {
    sim = Simulation.deserialize(save);
  } catch (e) {
    throw new Error(`This SimTower save couldn't be read. (${message(e)})`);
  }
  const { counts: c, decodeStats: d, tdt } = facts;
  let floors = 0;
  let basements = 0;
  for (const u of save.units) {
    floors = Math.max(floors, u.floor);
    if (u.floor < 1) basements = Math.max(basements, 1 - u.floor);
  }
  const flights = save.transports.filter((t) => t.kind === "stairs" || t.kind === "escalator").length;
  // prettier-ignore
  const record = Float64Array.of(
    1,
    c.rooms, c.offices, c.occupiedOffices, c.condos, c.soldCondos, c.hotelRooms, c.hotelAsleep,
    c.hotelDirty, c.hotelBooked, c.asleepConverted, c.infested, c.venues, c.services, c.parkingStalls,
    c.construction, c.rentsApplied, c.twinRooms, c.secom, c.cathedral, c.burned, c.unknown,
    c.droppedFloors, c.offLot, c.overlapping, c.misplaced, c.clamped, c.widthMismatch,
    facts.decoded ? 1 : 0, d.droppedShafts, d.adjustedShafts, d.droppedFlights,
    tdt.parkingConnected ?? NaN, tdt.peopleCount ?? NaN,
    floors, basements, save.minutes, save.transports.length - flights, flights, save.star, save.money,
    facts.headerNotes.length, tdt.warnings.length,
  );
  return { sim, notes: [...facts.headerNotes, ...tdt.warnings], name: sim.tower.towerName ?? undefined, record };
}

/** The tower as `.TDT` bytes and the `tdtExport` record. */
export function writeTdt(sim: Simulation): { record: Float64Array; bytes: Uint8Array } {
  const built = buildTDT(sim.serialize());
  const { counts: c, stats: s, report } = built;
  // prettier-ignore
  const record = Float64Array.of(
    1,
    c.rooms, c.rentsSnapped, c.namesDropped, c.hotelStates, c.occupied, c.construction,
    c.parkingStalls, c.burnedOut, c.vacancyHistoryLost, c.outOfRange,
    s.balance, s.money, s.star, s.shaftsDropped, s.shaftsColliding, s.flightsDropped,
    s.transportsDropped, s.elevatorsLen, s.walkwaysLen, s.expressLen,
    report.floors, report.basements,
  );
  return { record, bytes: built.bytes };
}
