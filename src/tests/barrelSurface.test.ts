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
import type { BatchRentOptions, BatchRentResult, BatchTarget, HeatCell, HeatmapMode, LogEntry } from "../engine/Simulation";
import type { ElevatorCalls, MealWindow, Person, PersonState, StaffKind } from "../engine/Crowd";
import type { TdtElevator, TdtFloor, TdtHeader, TdtStair, TdtTenant, TdtTower } from "../storage/tdtFormat";
import type { DecodedTransports, ImportReport, ParsedLegacyTower } from "../storage/tdtImport";
import type { BuiltLegacyTower, ExportReport } from "../storage/tdtExport";
import type { SlotInfo } from "../storage/SaveGame";
import type { FastFoodLook, RestaurantLook, RoomCtx, ShopLook } from "../render/pixelSprites";
import type { EntranceKind } from "../render/sprites/structure";
import type { SfxName } from "../audio/ToneAudioEngine";

// Reference every type once so the block is provably load-bearing (a removed
// type becomes an unresolved reference here, failing typecheck).
export type _TypeSurfacePins = [
  BatchRentOptions, BatchRentResult, BatchTarget, HeatCell, HeatmapMode, LogEntry,
  ElevatorCalls, MealWindow, Person, PersonState, StaffKind,
  TdtElevator, TdtFloor, TdtHeader, TdtStair, TdtTenant, TdtTower,
  DecodedTransports, ImportReport, ParsedLegacyTower,
  BuiltLegacyTower, ExportReport,
  SlotInfo,
  FastFoodLook, RestaurantLook, RoomCtx, ShopLook,
  EntranceKind,
  SfxName,
];

// --- 2. Runtime surface: value bindings must resolve, not just typecheck. ---
import * as facilities from "../engine/facilities";
import * as simulation from "../engine/Simulation";
import * as tower from "../engine/Tower";
import * as crowd from "../engine/Crowd";
import * as economy from "../engine/EconomySystem";
import * as migration from "../engine/saveMigration";
import * as tdtFormat from "../storage/tdtFormat";
import * as tdtImport from "../storage/tdtImport";
import * as tdtExport from "../storage/tdtExport";
import * as saveGame from "../storage/SaveGame";
import * as pixelSprites from "../render/pixelSprites";
import * as structure from "../render/sprites/structure";
import * as audio from "../audio/ToneAudioEngine";

const RUNTIME_EXPORTS: Record<string, string[]> = {
  facilities: [
    "ALL_KINDS", "BUILD_CAPS", "FACILITIES", "GARBAGE_COLLECT_HOUR", "GRID", "LOT_WIDTH", "MAX_CARS",
    "PARKING_WORKERS_PER_SPACE", "POOLED_CAPS", "RECYCLING_POP_PER_CENTER", "STAR_THRESHOLDS",
    "TOWER_POPULATION", "TRANSPORT_CAPACITY", "buildMinutes", "censusCount", "facilityFloors",
    "hasBusinessHours", "isCommercialKind", "isElevatorKind", "isFacilityKind", "isFixedSpanTransport",
    "isHotelKind", "isOpenAt", "isStaffOnlyTransport", "isStaffTransportKind", "maxCarsFor", "maxSpanFor",
    "openHoursPerDay", "residentCount", "transportCarCapacity",
  ],
  simulation: [
    "CONGESTION_CHURN", "CONGESTION_GRIDLOCK", "ECON", "LOG_SAVE_CAP", "SAVE_VERSION", "Simulation",
    "TRANSPORT_FAR_TILES", "VACATE_RESCIND", "congestionSeverity", "serializeUnit",
  ],
  tower: ["Tower"],
  crowd: [
    "CROWD_SECONDS_PER_MINUTE", "Crowd", "EAT_SECONDS_MAX", "EAT_SECONDS_MIN", "MEAL_WINDOWS",
    "mealWindowFor", "staffOnShift", "visibleOccupants",
  ],
  economy: [
    "COMMERCIAL_LOBBY_FLOORS", "EconomySystem", "HK_SHIFT_END", "HK_SHIFT_START", "TRAFFIC_FACTOR_MEAN",
    "TRAFFIC_FACTOR_MIN", "TRAFFIC_FACTOR_SPAN",
  ],
  migration: [
    "SAVE_VERSION", "floatingStructureCount", "migrateSave", "migrationLooksValid", "reflowV1toV2",
    "upgradeV1toV2", "upgradeV2toV3", "upgradeV3toV4", "upgradeV4toV5", "widenLegacyElevatorShafts",
  ],
  tdtFormat: [
    // The full value surface: every TDT_* constant + the reader, error, view
    // mapping, and parse/locate functions. Exhaustive on purpose (a review
    // finding: a curated subset let a dropped constant like TDT_WORLD_W slip
    // past this net), so any silent removal from the barrel trips the test.
    "ByteReader", "LegacyImportError", "locateStairs", "parseTdtBinary",
    "viewFromViewWords", "viewWordsFromView",
    "TDT_MAGIC", "TDT_HEADER_SIZE", "TDT_FLOOR_COUNT", "TDT_TENANT_RECORD_SIZE",
    "TDT_FLOOR_INDEX_ENTRIES", "TDT_MAX_TENANTS_PER_FLOOR", "TDT_MAX_FILE_BYTES", "TDT_MAX_PEOPLE",
    "TDT_PERSON_RECORD_SIZE", "TDT_MAX_CENSUS", "TDT_DEFAULT_VIEW_X", "TDT_DEFAULT_VIEW_Y",
    "TDT_FLOOR_OFFSET", "TDT_TILE_PX", "TDT_FLOOR_PX", "TDT_WORLD_W", "TDT_WORLD_H",
    "TDT_VIEW_W", "TDT_VIEW_H", "TDT_RETAIL_SLOTS", "TDT_RETAIL_RECORD_SIZE", "TDT_ELEVATOR_SLOTS",
    "TDT_ELEVATOR_HEADER_SIZE", "TDT_ELEVATOR_BUILT_FIXED", "TDT_ELEVATOR_PER_FLOOR_SIZE",
    "TDT_ELEVATOR_PER_CAR_SIZE", "TDT_ELEVATOR_SCHEDULE_DEFAULT", "TDT_FINANCE_SIZE", "TDT_PARKING_SIZE",
    "TDT_STAIR_SLOTS", "TDT_STAIR_RECORD_SIZE", "TDT_ROUTING_TAIL_SIZE", "TDT_MAX_TILE",
    "TDT_MAX_STAIR_CROWD", "TDT_STAIR_SCAN_WINDOW",
  ],
  tdtImport: [
    "ELEVATOR_KINDS", "FAMILY_STORIES", "HOTEL_ASLEEP_FLAG", "HOTEL_DIRTY_FLAG", "HOTEL_OCCUPANT_MASK",
    "PART_FAMILY", "TDT_BURNED", "TDT_FLOOR_OFFSET", "TENANT_KIND", "LegacyImportError", "isLobbyFloor",
    "looksLikeLegacyTower", "parseTDT", "rentFromClass", "synthesizeTransports", "towerNameFromFilename",
    "transportsFromDecoded",
  ],
  tdtExport: ["LegacyExportError", "buildTDT", "classFromRent", "legacyFilename"],
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
  audio: ["ToneAudioEngine", "clamp", "detailFor", "lerp", "midiToFreq", "sameNotes", "sceneFor"],
};

const MODULES: Record<string, Record<string, unknown>> = {
  facilities, simulation, tower, crowd, economy, migration, tdtFormat, tdtImport, tdtExport,
  saveGame, pixelSprites, structure, audio,
};

describe("barrel surface: every re-exported value binding resolves", () => {
  for (const [mod, names] of Object.entries(RUNTIME_EXPORTS)) {
    it(`${mod} exposes its value bindings`, () => {
      const missing = names.filter((n) => MODULES[mod][n] === undefined);
      expect(missing, `${mod} is missing value exports: ${missing.join(", ")}`).toEqual([]);
    });
  }
});
