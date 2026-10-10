// Generated from conformance/events/catalog.json by `npm run gen:events`.
// Do not edit: change the catalog and regenerate (src/engine/gameplayCatalog.test.ts fails while this is stale).

/**
 * The gameplay events the engine emits, one entry per event. This file is the
 * contract: engine-rs/src/gameplay.rs checks GameplayEvent against it in a unit
 * test, src/engine/gameplayEvents.d.ts is generated from it (npm run
 * gen:events), and the conformance lock hashes the drained events per
 * checkpoint. Payload rule: closed enums and small bounded integers only. No
 * free text, no tower names, no money amounts. A field of any other type is
 * refused by the catalog checks on both sides. A rename is a catalog change:
 * bump the event's version and add a history note.
 */
export type GameplayCatalogVersion = 1;

export type GameplayMode =
  | "classic"
  | "modern";

export type GameplayFacilityKind =
  | "lobby"
  | "floor"
  | "office"
  | "condo"
  | "hotelSingle"
  | "hotelDouble"
  | "hotelSuite"
  | "fastFood"
  | "restaurant"
  | "foodHall"
  | "shop"
  | "cinema"
  | "partyHall"
  | "amusements"
  | "boutiqueBay"
  | "fitnessClub"
  | "clinic"
  | "nightclub"
  | "spa"
  | "skyBar"
  | "aquaticCenter"
  | "daycare"
  | "stairs"
  | "escalator"
  | "elevatorStandard"
  | "elevatorService"
  | "elevatorExpress"
  | "parkingRamp"
  | "parking"
  | "security"
  | "medical"
  | "housekeeping"
  | "recycling"
  | "metro"
  | "weddingHall"
  | "rentalStudio"
  | "rentalApartment";

export type GameplayRemovalMethod =
  | "sell"
  | "bulldoze";

export type GameplayEmergencyKind =
  | "fireRescue"
  | "bombThreat";

export type GameplayEmergencyDecision =
  | "accept"
  | "decline";

export type GameplayEmergencySource =
  | "player"
  | "timeout";

export type GameplayMilestoneId =
  | "pop-500"
  | "pop-2500"
  | "pop-7500"
  | "pop-12000"
  | "star-4"
  | "star-5"
  | "cinema"
  | "metro"
  | "skyline"
  | "well-served"
  | "full-house";

/** Every gameplay event's payload, by event name. */
export interface GameplayEventPayloads {
  /**
   * A new tower was founded. Emitted once by the new-game constructor, before
   * any command runs. Loading a save never emits it. Version 1, once per tower.
   * Takes over from the shell's new_game_started call in saveLoad.ts in phase
   * 2. That wire name was game_started until 2026-09-14, renamed because it
   * read like a session counter; the wire keeps new_game_started.
   */
  tower_founded: {
    mode: GameplayMode;
  };
  /**
   * A build or transport placement succeeded and was charged. kind is the kind
   * actually placed (the Floor tool on the ground floor places a lobby). floor
   * is the top story the placement reaches: floor plus height minus one for a
   * room, the top of the span for a shaft. count is the number of units of kind
   * the placement laid, 1 for every engine placement today; bridge and
   * under-floor tiles a room lays are not counted. Version 1, per occurrence.
   * New. Feeds the shell's noteBuild folds (first_build, session_builds,
   * session_peak_floors) in phase 2.
   */
  facility_placed: {
    kind: GameplayFacilityKind;
    /** A whole number from -9 to 100. */
    floor: number;
    /** A whole number from 1 to 1000. */
    count: number;
  };
  /**
   * A unit or shaft was removed by a player command, with method saying how.
   * Emitted by the engine's sell command (sellAt, method sell) after the
   * removal and refund. The editor's Sell and the bulldozer remove through the
   * tower directly today; they move onto an engine command carrying the method
   * in phase 2, which is when bulldoze is first emitted. Version 1, per
   * occurrence. New. Takes over from economy_action with action demolish in
   * phase 2.
   */
  facility_removed: {
    kind: GameplayFacilityKind;
    method: GameplayRemovalMethod;
  };
  /**
   * A price moved: priceUnit or adjustRent changed a unit's price or put it
   * back on the market, setNoRate took a unit that was on the market off it, or
   * applyRentBatch changed at least one unit (changed above zero). A batch
   * emits once for the whole batch. A write that leaves the price where it was
   * emits nothing, and the price itself is never carried. Version 1, per
   * occurrence. New. Takes over from economy_action with action price_tune in
   * phase 2; the platform keeps the once-per-session latch.
   */
  pricing_changed: {
    kind: GameplayFacilityKind;
  };
  /**
   * A shaft's capacity changed: setCars changed the car count, or
   * resizeTransport moved the span. A refused or no-op edit emits nothing. The
   * TypeScript engine emits from the tower's own setCars and resizeTransport
   * (the editor calls them there); the Rust engine emits from
   * Simulation::set_cars and Simulation::resize_transport, which its binding
   * and referee call, and its bare tower methods emit nothing. Version 1, per
   * occurrence. New. Takes over from economy_action with action capacity_tune
   * in phase 2; the platform keeps the once-per-session latch.
   */
  capacity_changed: {
    kind: GameplayFacilityKind;
  };
  /**
   * The tower's rating rose to star (6 is TOWER). One event per rung crossed,
   * in ascending order, so a single evaluation that lifts the tower two rungs
   * emits two events. Loading a save never emits it. Once per tower along one
   * line of play: the rating never falls, but an undo or a load of an earlier
   * save rewinds it, and reaching the rung again emits again. Version 1, once
   * per tower. New. Takes over from the 6 Hz star diff in frameLoop.ts in phase
   * 2; the wire name star_reached does not change.
   */
  star_reached: {
    /** A whole number from 2 to 6. */
    star: number;
  };
  /**
   * A room caught fire (an ignition). A blaze spreading to a neighbor is the
   * same fire and emits nothing. Version 1, per occurrence. New. Takes over
   * from the fires counter that session_emergencies samples, in phase 2.
   */
  fire_started: Record<string, never>;
  /**
   * Rooms on fire were reduced to gutted shells: once per daily fire pass that
   * gutted at least one room, and once per paid rescue that gutted at least one
   * room. rooms is the number gutted in that step. Bomb losses are not fire
   * losses and never count here. Version 1, per occurrence. New. Takes over
   * from the firesGutRooms counter that session_emergencies samples, in phase
   * 2.
   */
  fire_gutted: {
    /** A whole number from 1 to 10000. */
    rooms: number;
  };
  /**
   * A bomb went off with no Security to stop it. rooms is the number of rooms
   * the blast gutted (0 when the tower had nothing to destroy). A threat
   * Security swept away emits nothing. Version 1, per occurrence. New. Takes
   * over from the bombs counter that session_emergencies samples, in phase 2.
   */
  bomb_detonated: {
    /** A whole number from 0 to 10000. */
    rooms: number;
  };
  /**
   * A pending emergency choice was resolved. decision is what took effect:
   * accept only when the tower paid, so an accept the tower cannot afford is a
   * decline. source is player for the resolve command and timeout for the daily
   * roll's auto-decline. Emitted before the outcome's own events (a rescue's
   * fire_gutted, a search's bomb_detonated). Version 1, per occurrence. New.
   * Takes over from emergency_choice in phase 2; the platform drops source
   * timeout, so a timed-out decline still reports nothing.
   */
  emergency_resolved: {
    kind: GameplayEmergencyKind;
    decision: GameplayEmergencyDecision;
    source: GameplayEmergencySource;
  };
  /**
   * An optional milestone was achieved and announced. Loading a save adopts
   * already-met milestones silently and emits nothing. Once per tower along one
   * line of play: an undo or a load of an earlier save rewinds the achieved
   * set, and achieving the milestone again emits again. Version 1, once per
   * tower. New. Nothing sends it today; the store-neutral milestone sink reads
   * it later.
   */
  milestone_reached: {
    id: GameplayMilestoneId;
  };
}

/** Each event's schema version, by name. */
export interface GameplayEventVersions {
  tower_founded: 1;
  facility_placed: 1;
  facility_removed: 1;
  pricing_changed: 1;
  capacity_changed: 1;
  star_reached: 1;
  fire_started: 1;
  fire_gutted: 1;
  bomb_detonated: 1;
  emergency_resolved: 1;
  milestone_reached: 1;
}

export type GameplayEventName = keyof GameplayEventPayloads;

/** One drained event, `{ name, payload }`, as both engines hand it over. */
export type GameplayEvent = {
  [N in GameplayEventName]: { name: N; payload: GameplayEventPayloads[N] };
}[GameplayEventName];
