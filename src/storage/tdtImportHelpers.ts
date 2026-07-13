/**
 * Small pure helpers for the `.TDT` import: the file sniff, the tower-name
 * derivation, and the deterministic seed hash. Extracted from `tdtImport.ts`
 * so the parse pass stays under the readable ceiling.
 */
import { TDT_MAGIC } from "./tdtConstants";

/** Heuristic for the import UI: is this picked file an original SimTower
 *  save? The .TDT extension first; else sniff the header magic, so a renamed
 *  or extension-less copy of a real save still routes here. The magic is the
 *  little-endian u16 at offset 0, single-sourced from {@link TDT_MAGIC}. */
export function looksLikeLegacyTower(filename: string, bytes?: Uint8Array): boolean {
  if (/\.tdt$/i.test(filename)) return true;
  return !!bytes && bytes.byteLength >= 2 && (bytes[0] | (bytes[1] << 8)) === TDT_MAGIC;
}

/** Tower name from the FILENAME (never from file bytes): basename minus
 *  extension, separators to spaces, printable ASCII only, capped length. */
export function towerNameFromFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const name = base
    .replace(/\.[^.]*$/, "")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24)
    .trim();
  return name || "SimTower Import";
}

/** FNV-1a over the file bytes: a stable, deterministic RNG seed for the
 *  imported tower (same file, same seed; golden-testable). */
export function hashSeed(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  h &= 0x7fffffff;
  return h === 0 ? 1 : h;
}
