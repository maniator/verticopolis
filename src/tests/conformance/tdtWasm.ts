import type { SerializedGame } from "../../engine/types";
import { PortCodes } from "../../simport/portCodes";
import { exportFacts, importFacts } from "../../simport/tdtRecords";
import { exportReport, type ExportReport } from "../../storage/tdtExportReport";
import { importReport, type ImportReport } from "../../storage/tdtImportReport";
import { codecFromModule, useTdtCodec } from "../../engine/port/tdtCodec";
import { describe, it } from "vitest";
import { hasWasmPackage, wasm } from "./wasmEngine";

/**
 * The `.TDT` codec as the tests meet it: the Rust importer and exporter through
 * the WASM binding, with the reports built from the port's records, the way the
 * game builds them. A refusal throws the player-readable sentence as an `Error`
 * of one of the two classes below.
 */

/** Suites that need the codec skip themselves where the engine package is not
 *  built; the WASM lanes set `VC_REQUIRE_WASM=1`, and `engineLoad.test.ts` fails
 *  those runs when the package is missing, so a skip cannot hide there. */
export const describeWithCodec = describe.skipIf(!hasWasmPackage());
export const itWithCodec = it.skipIf(!hasWasmPackage());

export class LegacyImportError extends Error {}
export class LegacyExportError extends Error {}

export interface ParsedTdt {
  save: SerializedGame;
  report: ImportReport;
  /** The header's notes, then the walk's warnings. */
  notes: string[];
  /** The numbers the report is built from. */
  facts: ReturnType<typeof importFacts>;
}

export interface BuiltTdt {
  bytes: Uint8Array;
  report: ExportReport;
  /** The `tdtExport` record. */
  record: Float64Array;
}

/** The package's free `importTdt`: the importer alone, with no engine behind it. */
const importTdt = (bytes: Uint8Array, filename: string): string =>
  (wasm() as unknown as { importTdt(bytes: Uint8Array, filename: string): string }).importTdt(bytes, filename);

const bytesOf = (input: ArrayBuffer | Uint8Array): Uint8Array => (input instanceof Uint8Array ? input : new Uint8Array(input));

/** Read a `.TDT` file the way the game does. The report and facts come from the
 *  engine's load; the save is the importer's own output, before an engine
 *  adopts it and normalizes it (an express shaft stops only at lobbies, a
 *  default state or zero count is left out). */
export function parseTDT(input: ArrayBuffer | Uint8Array, filename: string): ParsedTdt {
  const engine = wasm().Engine.newGame(1, "classic");
  try {
    const record = engine.loadTdt(bytesOf(input), filename);
    if (record[0] !== 1) throw new LegacyImportError(engine.lastReason() ?? "This SimTower save couldn't be read.");
    const facts = importFacts(record, new PortCodes(engine), engine);
    if (engine.adoptTdt()[0] !== 1) throw new LegacyImportError(engine.lastReason() ?? "This SimTower save couldn't be read.");
    const bytes = bytesOf(input);
    const { save } = JSON.parse(importTdt(bytes, filename)) as { save: SerializedGame };
    return { save, report: importReport(facts), notes: [...facts.notes], facts };
  } finally {
    engine.free();
  }
}

/** What the binary walk read, as far as the import's record tells it. */
export interface TdtWalk {
  /** The header's notes, then the walk's warnings. */
  warnings: string[];
  /** The save's own elevator shafts in table order, or null when the walk gave
   *  up on the table and the importer rebuilt them from the floors. */
  elevators: { x: number; cars: number; stops: number }[] | null;
  /** One entry per flight the walk read, or null when it gave up. */
  stairs: unknown[] | null;
  parkingConnected: number | null;
  peopleCount: number | null;
}

const ELEVATOR_KINDS = new Set(["elevatorStandard", "elevatorService", "elevatorExpress"]);

/** The walk of a `.TDT` file: the Rust import's notes and decode facts, with the
 *  shafts read back off the imported save. */
export function parseTdtBinary(input: ArrayBuffer | Uint8Array, filename = "TOWER.TDT"): TdtWalk {
  const { save, notes, facts } = parseTDT(input, filename);
  const decoded = facts.decoded;
  const shafts = save.transports.filter((t) => ELEVATOR_KINDS.has(t.kind));
  return {
    warnings: notes,
    elevators: decoded
      ? shafts.map((t) => ({ x: t.x, cars: t.cars, stops: t.top - t.bottom + 1 - (t.skipFloors?.length ?? 0) }))
      : null,
    stairs: decoded ? Array.from({ length: facts.flights }) : null,
    parkingConnected: facts.parkingConnected,
    peopleCount: facts.peopleCount,
  };
}

/** Write a save as a `.TDT` file the way the game does. */
export function buildTDT(save: SerializedGame | string): BuiltTdt {
  const engine = wasm().Engine.fromSave(typeof save === "string" ? save : JSON.stringify(save));
  try {
    const record = engine.tdtExport();
    const bytes = record[0] === 1 ? engine.tdtFile() : undefined;
    if (!bytes) throw new LegacyExportError(engine.lastReason() ?? "Export failed.");
    return { bytes, record, report: exportReport(exportFacts(record, new PortCodes(engine), engine.towerName())) };
  } finally {
    engine.free();
  }
}

/** Give the TypeScript engine the Rust `.TDT` codec from the built package, as
 *  the game does after it loads the package. Call it where `hasWasmPackage()`. */
export function installTdtCodec(): void {
  useTdtCodec(codecFromModule(wasm()));
}
