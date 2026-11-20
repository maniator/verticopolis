import { describe, it, expect } from "vitest";

/**
 * Barrel-surface tripwire for the large-file split refactor.
 *
 * The refactor carves each oversized module into siblings but keeps the
 * original file as a barrel that re-exports every name it exported before, so
 * no importer (source, test, tool, e2e, screenshot) has to change (SPEC CAP-3).
 * This file pins that surface two ways:
 *
 *  1. Compile-time: the `import type` block names every TYPE each barrel
 *     exports. Because `npm run typecheck` is a required gate, deleting or
 *     renaming an exported type fails the build here first (types can't be
 *     checked at runtime, so they need the compiler).
 *  2. Runtime: every VALUE binding is imported by namespace and asserted
 *     defined, so a removed or renamed value export trips the test.
 *
 * Adding a NEW export is fine and needs no change here; only removals and
 * renames trip it. Retire a symbol here in the same change that retires it.
 * Only the game's own barrels are pinned here; the engine and components
 * packages hold their own exports to account.
 */

// --- 1. Compile-time surface: every exported TYPE. ---
import type { ExportReport } from "../storage/tdtExportReport";
import type { ImportReport } from "../storage/tdtImportReport";
import type { SlotInfo } from "../storage/SaveGame";

// Reference every type once so the block is provably load-bearing (a removed
// type becomes an unresolved reference here, failing typecheck).
export type _TypeSurfacePins = [ImportReport, ExportReport, SlotInfo];

// --- 2. Runtime surface: value bindings must resolve, not just typecheck. ---
import * as tdtImportHelpers from "../storage/tdtImportHelpers";
import * as saveGame from "../storage/SaveGame";

const RUNTIME_EXPORTS: Record<string, string[]> = {
  tdtImportHelpers: ["looksLikeLegacyTower"],
  saveGame: ["SLOT_COUNT", "SaveGame", "TOWER_FILE_EXT"],
};

const MODULES: Record<string, Record<string, unknown>> = {
  tdtImportHelpers,
  saveGame,
};

describe("barrel surface: every re-exported value binding resolves", () => {
  for (const [mod, names] of Object.entries(RUNTIME_EXPORTS)) {
    it(`${mod} exposes its value bindings`, () => {
      // Check binding PRESENCE, not truthiness: an export whose value is
      // legitimately `undefined` still exists as a binding, so key `in` the
      // namespace is the honest test that a name is actually re-exported.
      const missing = names.filter((n) => !(n in MODULES[mod]));
      expect(missing, `${mod} is missing value exports: ${missing.join(", ")}`).toEqual([]);
    });
  }
});
