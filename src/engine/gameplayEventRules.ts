// Generated from conformance/events/catalog.json by `npm run gen:events`.
// Do not edit: change the catalog and regenerate (src/engine/gameplayCatalog.test.ts fails while this is stale).
import type { GameplayEventRules } from "./gameplayCatalog";

/** The catalog's enums and payload fields, without its prose: what the
 *  analytics bridge checks every drained event against. */
export const GAMEPLAY_EVENT_RULES: GameplayEventRules = {
  enums: {
    mode: ["classic", "modern"],
    facilityKind: ["lobby", "floor", "office", "condo", "hotelSingle", "hotelDouble", "hotelSuite", "fastFood", "restaurant", "foodHall", "shop", "cinema", "partyHall", "amusements", "boutiqueBay", "fitnessClub", "clinic", "nightclub", "spa", "skyBar", "aquaticCenter", "daycare", "stairs", "escalator", "elevatorStandard", "elevatorService", "elevatorExpress", "parkingRamp", "parking", "security", "medical", "housekeeping", "recycling", "metro", "weddingHall", "rentalStudio", "rentalApartment"],
    removalMethod: ["sell", "bulldoze"],
    emergencyKind: ["fireRescue", "bombThreat"],
    emergencyDecision: ["accept", "decline"],
    emergencySource: ["player", "timeout"],
    milestoneId: ["pop-500", "pop-2500", "pop-7500", "pop-12000", "star-4", "star-5", "cinema", "metro", "skyline", "well-served", "full-house"],
  },
  events: [
    { name: "tower_founded", payload: { mode: { type: "enum", enum: "mode" } } },
    { name: "facility_placed", payload: { kind: { type: "enum", enum: "facilityKind" }, floor: { type: "integer", min: -9, max: 100 }, count: { type: "integer", min: 1, max: 1000 } } },
    { name: "facility_removed", payload: { kind: { type: "enum", enum: "facilityKind" }, method: { type: "enum", enum: "removalMethod" } } },
    { name: "pricing_changed", payload: { kind: { type: "enum", enum: "facilityKind" } } },
    { name: "capacity_changed", payload: { kind: { type: "enum", enum: "facilityKind" } } },
    { name: "star_reached", payload: { star: { type: "integer", min: 2, max: 6 } } },
    { name: "fire_started", payload: {} },
    { name: "fire_gutted", payload: { rooms: { type: "integer", min: 1, max: 10000 } } },
    { name: "bomb_detonated", payload: { rooms: { type: "integer", min: 0, max: 10000 } } },
    { name: "emergency_resolved", payload: { kind: { type: "enum", enum: "emergencyKind" }, decision: { type: "enum", enum: "emergencyDecision" }, source: { type: "enum", enum: "emergencySource" } } },
    { name: "milestone_reached", payload: { id: { type: "enum", enum: "milestoneId" } } },
  ],
};
