import type { SerializedGame } from "../engine/types";

/**
 * Foundation for importing original 1994 **SimTower** `.TWR` save files.
 *
 * The `.TWR` format is the proprietary binary save of the original game (a
 * Win16/Mac OpenBook product). It has been partially reverse-engineered by the
 * community: a header followed by tower metadata (funds, star rating, name,
 * clock) and a list of placed facilities encoded by type id, floor and column,
 * plus elevator shaft definitions with car schedules.
 *
 * Fully decoding it is a self-contained project (binary layout, tile-id tables,
 * elevator car schedules), so it is planned for a **v2**. This module already
 * establishes the pluggable seam: a single `parseTWR()` that maps the binary
 * into our {@link SerializedGame} schema, and `looksLikeTWR()` for the import
 * UI to route `.TWR` files here. Today it recognizes the file and reports that
 * full conversion is coming, rather than silently failing.
 */

export class LegacyImportError extends Error {}
export class LegacyNotYetSupported extends LegacyImportError {}

/** Heuristic: is this byte stream / filename an original SimTower save? */
export function looksLikeTWR(filename: string, bytes?: Uint8Array): boolean {
  if (/\.twr$/i.test(filename)) return true;
  // SimTower towers are sizeable binaries; a tiny file is certainly not one.
  if (bytes && bytes.byteLength > 2000) {
    // The original files are not JSON — reject anything starting with '{' or '['.
    const c = bytes[0];
    if (c !== 0x7b && c !== 0x5b) return true;
  }
  return false;
}

/**
 * Parse an original `.TWR` buffer into our save schema.
 *
 * @throws {LegacyNotYetSupported} until the v2 binary decoder lands.
 */
export function parseTWR(buffer: ArrayBuffer): SerializedGame {
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength < 16) {
    throw new LegacyImportError("This file is too small to be a SimTower .TWR save.");
  }
  // Recognized as a plausible legacy tower — but the decoder isn't built yet.
  throw new LegacyNotYetSupported(
    "Recognized an original SimTower .TWR file. Importing classic saves is planned " +
      "for a future update — for now, build fresh or import a Verticopolis tower file.",
  );
}
