import type { SerializedGame } from "../engine/types";
import { LegacyExportError } from "./tdtExportTables";
import { gatherTower } from "./tdtExportGather";
import { encodeTower } from "./tdtEncoder";
import { buildExportReport, type ExportReport } from "./tdtExportReport";

/**
 * Writer for original 1994 SimTower saves (`.TDT`): the importer's mirror.
 * Serializes a {@link SerializedGame} into the binary layout documented in
 * `docs/canon/tdt-format.md`, plus an honest {@link ExportReport} of what the
 * 1994 format can and cannot carry. Semantic tables the importer also owns
 * (tenant IDs, part families, hotel flags, rent classes, elevator kinds) live
 * in `tdtTables.ts` and are inverted in `tdtExportTables.ts`, so reader and
 * writer cannot drift apart on those.
 *
 * Self-consistency is enforced by tests: every exported buffer must parse
 * back through `parseTDT` with zero warnings and identical room state.
 *
 * This file is the entry point + barrel. `buildTDT` is a thin orchestrator over
 * three cohesive passes, each in its own sibling so every existing
 * `import { … } from "./tdtExport"` keeps working unchanged:
 *   - `tdtExportTables.ts`: the inverted tenant/part/rent tables + the DOS
 *     filename rule (`classFromRent`, `legacyFilename`, `LegacyExportError`).
 *   - `tdtExportGather.ts`: the room walk into per-floor records + paving.
 *   - `tdtByteWriter.ts` + `tdtEncoder.ts`: the binary emission.
 *   - `tdtExportReport.ts`: the reverse fidelity report.
 */

/** Result of a successful export build. */
export interface BuiltLegacyTower {
  bytes: Uint8Array;
  report: ExportReport;
}

/**
 * Build the `.TDT` bytes plus the reverse fidelity report for a serialized
 * tower. Throws {@link LegacyExportError} for towers the format cannot hold
 * (modern mode is refused earlier, in the UI flow, with its own message).
 */
export function buildTDT(save: SerializedGame): BuiltLegacyTower {
  if (save.mode === "modern") {
    throw new LegacyExportError(
      "This tower uses Modern rules. SimTower (1994) can only load Classic towers.",
    );
  }
  const gathered = gatherTower(save);
  const { bytes, stats } = encodeTower(save, gathered);
  const report = buildExportReport(save, gathered, stats);
  return { bytes, report };
}

// ---- Barrel: preserve the original public surface of this module. ----
export { LegacyExportError, classFromRent, legacyFilename } from "./tdtExportTables";
export type { ExportReport } from "./tdtExportReport";
