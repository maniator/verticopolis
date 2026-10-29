/**
 * The import UI's file sniff for original SimTower saves.
 */

/** The little-endian u16 at offset 0 of every `.TDT` file. */
const TDT_MAGIC = 0x2400;

/** Heuristic for the import UI: is this picked file an original SimTower
 *  save? The .TDT extension first; else sniff the header magic, so a renamed
 *  or extension-less copy of a real save still routes here. */
export function looksLikeLegacyTower(filename: string, bytes?: Uint8Array): boolean {
  if (/\.tdt$/i.test(filename)) return true;
  return !!bytes && bytes.byteLength >= 2 && (bytes[0] | (bytes[1] << 8)) === TDT_MAGIC;
}
