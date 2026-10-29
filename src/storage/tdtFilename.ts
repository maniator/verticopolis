/** Names DOS/Win9x reserve for devices: a file by these names cannot exist on
 *  the filesystems the real game lives on. */
const DOS_RESERVED = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

/** DOS-safe download name: A–Z0–9 from the tower name, upper-cased, capped at
 *  8 characters (the real game lives on 8.3 filesystems), never empty and
 *  never a reserved device name (CON, PRN, COM1...). */
export function legacyFilename(towerName: string): string {
  const stem = towerName
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  return `${!stem || DOS_RESERVED.has(stem) ? "TOWER1" : stem}.TDT`;
}
