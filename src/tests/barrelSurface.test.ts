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
 */

// --- 1. Compile-time surface: every exported TYPE. ---
import type { Person, PersonState } from "../shared/engineTypes";
import type { ExportReport } from "../storage/tdtExportReport";
import type { ImportReport } from "../storage/tdtImportReport";
import type { SlotInfo } from "../storage/SaveGame";
import type { FastFoodLook, RestaurantLook, RoomCtx, ShopLook } from "../render/pixelSprites";
import type { EntranceKind } from "../render/sprites/structure";
import type { SfxName } from "../audio/ToneAudioEngine";

// Reference every type once so the block is provably load-bearing (a removed
// type becomes an unresolved reference here, failing typecheck).
export type _TypeSurfacePins = [
  Person, PersonState,
  ImportReport, ExportReport,
  SlotInfo,
  FastFoodLook, RestaurantLook, RoomCtx, ShopLook,
  EntranceKind,
  SfxName,
];

// --- 2. Runtime surface: value bindings must resolve, not just typecheck. ---
import * as tdtImportHelpers from "../storage/tdtImportHelpers";
import * as tdtFilename from "../storage/tdtFilename";
import * as saveGame from "../storage/SaveGame";
import * as pixelSprites from "../render/pixelSprites";
import * as structure from "../render/sprites/structure";
import * as spriteFacilities from "../render/sprites/facilities";
import * as audio from "../audio/ToneAudioEngine";
import * as toneScenes from "../audio/toneScenes";
import * as toneVoices from "../audio/toneVoices";

const RUNTIME_EXPORTS: Record<string, string[]> = {
  tdtImportHelpers: ["looksLikeLegacyTower"],
  tdtFilename: ["legacyFilename"],
  saveGame: ["SLOT_COUNT", "SaveGame", "TOWER_FILE_EXT"],
  pixelSprites: [
    "FASTFOOD_LOOKS", "PAL", "RESTAURANT_LOOKS", "SHIRTS", "SHOP_LOOKS", "SKIN", "drawRoom", "person",
    "sampleState",
  ],
  structure: [
    "AWNING_W", "CRANE_H", "CRANE_W", "ENTRANCE_GRAND_LEFT", "ENTRANCE_GRAND_RIGHT", "ENTRANCE_GRAND_SOLO",
    "ENTRANCE_SERVICE", "ESCAPE_W", "LOBBY_VARIANTS", "craneAnchorTile", "drawAwning", "drawBurntShell",
    "drawConstruction", "drawCrane", "drawEscapeStairs", "drawFlames", "drawFloor", "drawLobby",
    "drawLobbyEntrance", "lobbyVariant",
  ],
  spriteFacilities: [
    "drawGarbageTruck", "drawHousekeeping", "drawMedical", "drawMetro", "drawMetroTrain", "drawParking",
    "drawParkingRamp", "drawPartyHall", "drawRecycling", "drawSecurity", "drawStreetCar", "drawWeddingHall",
  ],
  audio: ["ToneAudioEngine"],
  toneScenes: [
    "DETAIL_ZOOM", "OVERVIEW_EXIT", "OVERVIEW_ZOOM", "SCENES", "clamp", "detailFor", "lerp",
    "midiToFreq", "sameNotes", "sceneFor",
  ],
  toneVoices: ["createSfxVoices", "playSfx"],
};

const MODULES: Record<string, Record<string, unknown>> = {
  tdtImportHelpers, tdtFilename,
  saveGame, pixelSprites, structure, spriteFacilities, audio, toneScenes, toneVoices,
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
