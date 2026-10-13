import { deflateSync } from "fflate";
import { TOWER_FILE_MAGIC, toBase64 } from "./saveCompression";

/**
 * The `.vctower` writer behind `SaveGame.export` and `SaveGame.packSync`
 * (whose base64 line the store and the desktop store keep). When the WASM
 * engine runs (`?engine=wasm`), the engine's own writer (`encodeVctower`,
 * `load::encode_vctower`) writes the file, so the game and a non-web
 * frontend write saves through one implementation. For the same stamped save
 * the engine writes the bytes the fflate writer here writes (#939, pinned
 * over every fixture), so the switch changes no file. An engine call that
 * throws, or hands back text that is no `.vctower` file, falls back to the
 * fflate writer and turns the engine writer off for the session, so a save
 * is never lost to the engine. (`saveToAsync` and the desktop store's
 * `toTowerFile` re-header keep their own writers.)
 */
export type VctowerWriter = (json: string, appVersion: string, savedAtMs: number) => string;

let engineWriter: VctowerWriter | null = null;

/** Write through the engine from now on, or (with null) through fflate. */
export function setEngineWriter(writer: VctowerWriter | null): void {
  engineWriter = writer;
}

const FILE_SHAPE = new RegExp(`^${TOWER_FILE_MAGIC}\\n[A-Za-z0-9+/]+={0,2}\\n$`);

/** The `.vctower` text of a stamped save: its JSON text, that text's UTF-8
 *  bytes (checked against the cap by `encodeSaveJson`), and its stamp. */
export function packVctower(json: string, bytes: Uint8Array, stamp: { appVersion?: string; savedAt?: number }): string {
  if (engineWriter && typeof stamp.appVersion === "string" && typeof stamp.savedAt === "number") {
    try {
      const text = engineWriter(json, stamp.appVersion, stamp.savedAt);
      if (FILE_SHAPE.test(text)) return text;
      throw new Error("the engine wrote no .vctower file");
    } catch (e) {
      engineWriter = null;
      console.error("[wasm] the engine did not write this save; writing saves on the TypeScript side from now on:", e);
    }
  }
  return TOWER_FILE_MAGIC + "\n" + toBase64(deflateSync(bytes, { level: 1 })) + "\n";
}

/** The base64 line of a `.vctower` text (as `packVctower` writes it): the
 *  payload a `VCZ1:` store value carries after its magic. */
export function payloadLine(vctower: string): string {
  return vctower.slice(TOWER_FILE_MAGIC.length + 1, -1);
}
