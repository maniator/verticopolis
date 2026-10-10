import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FACILITIES, GRID } from "./facilitiesData";
import { MILESTONES } from "./milestones";
import { checkCatalog, checkEvent, renderGameplayEventsDts, type GameplayCatalog } from "./gameplayCatalog";
import type { FacilityKind, GameMode } from "./types";
import type { GameplayFacilityKind, GameplayMilestoneId, GameplayMode } from "./gameplayEvents";

/**
 * The gameplay event catalog (`conformance/events/catalog.json`) is the
 * contract both engines emit against. These tests hold the catalog to its
 * payload rule, the generated `gameplayEvents.d.ts` to the catalog, and the
 * catalog's closed sets to the engine's own tables. The Rust side runs the
 * same checks in `engine-rs/src/gameplay.rs`.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const raw = (): Record<string, unknown> => JSON.parse(readFileSync(resolve(root, "conformance/events/catalog.json"), "utf8")) as Record<string, unknown>;
const catalog: GameplayCatalog = checkCatalog(raw());

/** A copy of the catalog with one payload field replaced on the first event. */
function withField(field: string, spec: unknown): Record<string, unknown> {
  const c = raw() as { events: { payload: Record<string, unknown> }[] };
  c.events[0].payload[field] = spec;
  return c as unknown as Record<string, unknown>;
}

// Compile-time: the engine's own unions and the catalog's are the same sets.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const sameKinds: Same<FacilityKind, GameplayFacilityKind> = true;
const sameModes: Same<GameMode, GameplayMode> = true;
const sameMilestones: Same<(typeof MILESTONES)[number]["id"], GameplayMilestoneId> = true;

describe("gameplay event catalog", () => {
  it("passes its own payload rule", () => {
    expect(catalog.events.map((e) => e.name)).toEqual([
      "tower_founded",
      "facility_placed",
      "facility_removed",
      "pricing_changed",
      "capacity_changed",
      "star_reached",
      "fire_started",
      "fire_gutted",
      "bomb_detonated",
      "emergency_resolved",
      "milestone_reached",
    ]);
    expect([sameKinds, sameModes, sameMilestones]).toEqual([true, true, true]);
  });

  it("refuses a string payload field that is not a catalog enum", () => {
    expect(() => checkCatalog(withField("towerName", { type: "string" }))).toThrow(/closed enums and small integers only/);
    expect(() => checkCatalog(withField("mode", { type: "enum", enum: "freeText" }))).toThrow(/not in the catalog/);
    expect(() => checkCatalog(withField("money", { type: "number" }))).toThrow(/not allowed/);
    expect(() => checkCatalog(withField("cash", { type: "integer", min: 0, max: 2_000_000_000 }))).toThrow(/within 100000/);
    expect(() => checkCatalog(withField("note", "free text"))).toThrow(/not allowed/);
  });

  it("refuses a malformed catalog", () => {
    const twice = raw() as { events: unknown[] };
    twice.events.push(twice.events[0]);
    expect(() => checkCatalog(twice)).toThrow(/listed twice/);
    const noHistory = raw() as { events: Record<string, unknown>[] };
    delete noHistory.events[0].history;
    expect(() => checkCatalog(noHistory)).toThrow(/history must be a non-empty string/);
    const badCardinality = raw() as { events: Record<string, unknown>[] };
    badCardinality.events[0].cardinality = "per_session";
    expect(() => checkCatalog(badCardinality)).toThrow(/cardinality/);
    const dupValue = raw() as { enums: Record<string, string[]> };
    dupValue.enums.mode = ["classic", "classic"];
    expect(() => checkCatalog(dupValue)).toThrow(/listed twice/);
    expect(() => checkCatalog([])).toThrow(/must be an object/);
    // Names and prose the generated declaration could not carry.
    const digitName = raw() as { events: Record<string, unknown>[] };
    digitName.events[0].name = "1st_tower";
    expect(() => checkCatalog(digitName)).toThrow(/snake_case/);
    const emptySet = raw() as { enums: Record<string, string[]> };
    emptySet.enums[""] = ["x"];
    expect(() => checkCatalog(emptySet)).toThrow(/camelCase/);
    expect(() => checkCatalog(withField("tower-name", { type: "enum", enum: "mode" }))).toThrow(/camelCase/);
    const comment = raw() as { events: Record<string, unknown>[] };
    comment.events[0].semantics = "ends the doc */ early";
    expect(() => checkCatalog(comment)).toThrow(/without \*\//);
    const noVersion = raw();
    delete noVersion.catalogVersion;
    expect(() => checkCatalog(noVersion)).toThrow(/catalogVersion/);
    const reserved = raw() as { enums: Record<string, string[]> };
    reserved.enums.event = ["x"];
    expect(() => checkCatalog(reserved)).toThrow(/reserved/);
    const huge = raw();
    huge.catalogVersion = 1e20;
    expect(() => checkCatalog(huge)).toThrow(/catalogVersion/);
    expect(() => checkCatalog(withField("deep", { type: "integer", min: -9223372036854775808, max: 0 }))).toThrow(/within 100000/);
  });

  it("names the engine's own closed sets", () => {
    expect(catalog.enums.facilityKind).toEqual(Object.keys(FACILITIES));
    expect(catalog.enums.milestoneId).toEqual(MILESTONES.map((m) => m.id));
    expect(catalog.enums.mode).toEqual(["classic", "modern"]);
    const floor = catalog.events.find((e) => e.name === "facility_placed")!.payload.floor;
    expect(floor).toEqual({ type: "integer", min: GRID.minFloor, max: GRID.maxFloor });
  });

  it("checks a drained event against its entry", () => {
    expect(() => checkEvent(catalog, { name: "star_reached", payload: { star: 3 } })).not.toThrow();
    expect(() => checkEvent(catalog, { name: "fire_started", payload: {} })).not.toThrow();
    expect(() => checkEvent(catalog, { name: "star_reached", payload: { star: 1 } })).toThrow(/outside the catalog/);
    expect(() => checkEvent(catalog, { name: "star_reached", payload: { star: 2.5 } })).toThrow(/outside the catalog/);
    expect(() => checkEvent(catalog, { name: "star_reached", payload: { star: 3, towerName: "x" } })).toThrow(/towerName/);
    expect(() => checkEvent(catalog, { name: "star_reached", payload: {} })).toThrow(/missing/);
    expect(() => checkEvent(catalog, { name: "facility_placed", payload: { kind: "penthouse", floor: 2, count: 1 } })).toThrow(/outside the catalog/);
    expect(() => checkEvent(catalog, { name: "tower_renamed", payload: {} })).toThrow(/not in the catalog/);
    expect(() => checkEvent(catalog, { name: "fire_started", payload: {}, minute: 3 })).toThrow(/exactly/);
  });

  it("generates the committed gameplayEvents.d.ts (run npm run gen:events when this fails)", () => {
    const committed = readFileSync(resolve(root, "src/engine/gameplayEvents.d.ts"), "utf8");
    expect(committed).toBe(renderGameplayEventsDts(catalog));
  });
});
