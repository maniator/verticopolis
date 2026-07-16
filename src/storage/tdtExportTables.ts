import type { FacilityKind } from "../engine/types";
import { TENANT_KIND, rentFromClass } from "./tdtTables";

/**
 * Writer-side tables and helpers for the `.TDT` exporter: the inverses of the
 * shared reader tables in `tdtTables.ts`, plus the DOS filename rule and the
 * pre-encoding tenant shape. Extracted from `tdtExport.ts`.
 */

/** Thrown for towers the 1994 format cannot represent at all. */
export class LegacyExportError extends Error {}

/** Kind to canonical single-story tenant ID: {@link TENANT_KIND} inverted,
 *  first (lowest) ID wins so security exports as 14 (never 17/SECOM). */
export const KIND_TENANT: ReadonlyMap<FacilityKind, number> = (() => {
  const m = new Map<FacilityKind, number>();
  for (const [id, kind] of Object.entries(TENANT_KIND)) {
    const n = Number(id);
    if (!m.has(kind) || n < m.get(kind)!) m.set(kind, n);
  }
  return m;
})();

/** Multi-story kinds to part IDs from the BOTTOM story up (doc §5; matches the
 *  importer's merge fixtures: recycling 21 under 20, theatre 19 under 18,
 *  metro 33/32/31, cathedral 36…40 rising to the crown). The theatre's
 *  separate screen halves (34/35) are not emitted: our model holds one
 *  full-width cinema, and inventing a hall/screen split point would be a
 *  guess; the importer merges either shape identically. Real-game rendering
 *  of a screenless theatre is a recorded validation follow-up. */
export const PART_STACKS: Readonly<Partial<Record<FacilityKind, readonly number[]>>> = {
  cinema: [19, 18],
  recycling: [21, 20],
  partyHall: [30, 29],
  metro: [33, 32, 31],
  weddingHall: [36, 37, 38, 39, 40],
};

/** Inverse of {@link rentFromClass}: a unit's rent maps to the nearest of the
 *  four 1994 rent-level classes (0 to 3), plus class 4 (No Rate) for kinds that
 *  charge no rent. Since the pricing split, a Classic tower's rents ARE the
 *  canon rung dollars, so this is lossless in practice (each rung is exactly
 *  its class); the nearest-with-ties-up rule only fires on a forged in-memory
 *  value and mirrors the engine's snap, so export and snap can never disagree.
 *  A priced kind with no stored override sits on Average and exports as 2; an
 *  unpriced kind (no rent band) exports as 4 (No Rate), matching what real
 *  saves store (fast food, security, housekeeping, retail all carry class 4). */
export function classFromRent(kind: FacilityKind, rent: number | undefined): number {
  const anchors = [0, 1, 2, 3].map((cls) => rentFromClass(kind, cls));
  if (anchors[0] === undefined) return 4; // no ladder: an unpriced kind
  if (rent === undefined) return 2; // no override: the Average default rung
  let best = 2;
  let bestDist = Infinity;
  for (let cls = 0; cls < anchors.length; cls++) {
    const d = Math.abs(rent - (anchors[cls] as number));
    // `<=` so an exact tie prefers the higher class: ties round up, matching
    // the engine's snapToLadder.
    if (d <= bestDist) {
      bestDist = d;
      best = cls;
    }
  }
  return best;
}

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

/** One tenant record, pre-encoding. */
export interface OutTenant {
  left: number;
  right: number;
  type: number; // negative = under construction
  status: number;
  rentClass: number;
  /** Canon variant byte for retail (0-based index into the kind's §7 list);
   *  undefined for non-retail kinds. Written to unit-record byte 17 (§4) AND
   *  mirrored into the retail-table slot (§7). */
  subtypeIdx?: number;
}
