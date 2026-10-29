import type { WasmModule } from "../../dualrun/binding";

/**
 * The `.TDT` file codec the TypeScript engine reads and writes through. The Rust
 * engine owns the format (`engine-rs/src/tdt/`); a TypeScript engine has no copy
 * of it, so it borrows a short-lived Rust engine from the engine package for each
 * file: one reads a file, another writes a tower. Both answer the numbers the
 * reports are built from in the same record layout the Rust port uses
 * (`src/simport/tdtRecords.ts`). Each throws an `Error` whose message is the
 * player-readable refusal.
 */

/** A `.TDT` file the codec read: the tower as save JSON, the port's `loadTdt`
 *  record, the header's notes then the walk's warnings, and the tower's name. */
export interface TdtRead {
  saveJson: string;
  record: Float64Array;
  notes: string[];
  name: string | undefined;
}

/** A tower the codec wrote: the port's `tdtExport` record and the file's bytes. */
export interface TdtWrite {
  record: Float64Array;
  bytes: Uint8Array;
}

export interface TdtCodec {
  read(bytes: Uint8Array, filename: string): TdtRead;
  write(saveJson: string): TdtWrite;
}

/** What the player reads when the engine package could not be loaded. */
export const TDT_UNAVAILABLE =
  "Importing and exporting SimTower (.TDT) files needs the Rust engine package, and it could not be loaded.";

/** The codec on a loaded engine package. */
export function codecFromModule(mod: Pick<WasmModule, "Engine">): TdtCodec {
  return {
    read(bytes, filename) {
      const engine = mod.Engine.newGame(1, "classic");
      try {
        const record = engine.loadTdt(bytes, filename);
        if (record[0] !== 1) throw new Error(engine.lastReason() ?? "This SimTower save couldn't be read.");
        const notes: string[] = [];
        for (let note = engine.tdtNote(0); note !== undefined; note = engine.tdtNote(notes.length)) notes.push(note);
        const name = engine.tdtTowerName();
        if (engine.adoptTdt()[0] !== 1) throw new Error(engine.lastReason() ?? "This SimTower save couldn't be read.");
        return { saveJson: engine.serialize(), record, notes, name };
      } finally {
        engine.free();
      }
    },
    write(saveJson) {
      const engine = mod.Engine.fromSave(saveJson);
      try {
        const record = engine.tdtExport();
        const bytes = record[0] === 1 ? engine.tdtFile() : undefined;
        if (!bytes) throw new Error(engine.lastReason() ?? "Export failed.");
        return { record, bytes };
      } finally {
        engine.free();
      }
    },
  };
}

let codec: TdtCodec | undefined;
let failure: string | undefined;

/** Install the codec the TypeScript engine reads and writes `.TDT` files with. */
export function useTdtCodec(next: TdtCodec | undefined): void {
  codec = next;
  failure = undefined;
}

/** The installed codec; throws the player's sentence when there is none. */
export function tdtCodec(): TdtCodec {
  if (!codec) throw new Error(failure ?? TDT_UNAVAILABLE);
  return codec;
}

/** Load the engine package (once) and install the codec on it. A package that
 *  cannot be loaded leaves the codec out, and `tdtCodec` then says so. */
export async function prepareTdtCodec(load: () => Promise<Pick<WasmModule, "Engine">> = defaultLoad): Promise<void> {
  if (codec) return;
  try {
    codec = codecFromModule(await load());
    failure = undefined;
  } catch (e) {
    failure = `${TDT_UNAVAILABLE} (${e instanceof Error ? e.message : String(e)})`;
  }
}

const defaultLoad = async (): Promise<Pick<WasmModule, "Engine">> => (await import("../../wasmhost/rustEngine")).loadWasmEngine();
