import type { FacilityKind, Unit } from "../../shared/types";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";
import { draftTower, type Draft } from "./portSim";

/**
 * The tower fixtures (`src/tests/fixtures/towerFixtures.ts`) for a port kit
 * {@link Draft}: the same lobby and floor runs and asserted placements, on a
 * tooling tower over the Rust engine (#1875).
 */

/** The parts of the engine's catalog the fixtures and suites read. */
export interface CatalogFacts {
  readonly world: { readonly lotWidth: number; readonly maxFloor: number; readonly minFloor: number; readonly lobbyInterval: number };
  readonly economy: Readonly<Record<string, unknown>> & { readonly calendars: readonly { readonly key: string; readonly maintenancePeriodDays: number }[] };
}

/** The engine's catalog for `mode`. */
export function catalogFacts(mode: "classic" | "modern" = "classic"): CatalogFacts {
  const read = wasm().catalog;
  if (!read) throw new Error("the engine package has no catalog; run npm run wasm:build");
  return JSON.parse(read(mode)) as CatalogFacts;
}

/** The lot's width in tiles, from the engine's catalog. Without an engine
 *  package it reads 0: the kit's suites skip then (or fail first under
 *  VC_REQUIRE_WASM), so no test runs on it, and the import still loads. */
export const LOT_WIDTH = hasWasmPackage() ? catalogFacts().world.lotWidth : 0;
export const MID = Math.floor(LOT_WIDTH / 2);

export function layTile(draft: Draft, kind: "floor" | "lobby", floor: number, x: number): void {
  draft.tower.place(kind, floor, x);
  const built = draft.tower.structureKindAt(floor, x);
  if (built !== kind) throw new Error(`lay ${kind} at ${floor},${x} did not build (got ${built ?? "empty"})`);
}

/** A full-width floor or lobby, laid from the middle out. */
export function lay(draft: Draft, kind: "floor" | "lobby", floor: number): void {
  for (let x = MID; x < LOT_WIDTH; x++) layTile(draft, kind, floor, x);
  for (let x = MID - 1; x >= 0; x--) layTile(draft, kind, floor, x);
}

/** Build a transport and assert it placed. */
export function mustBuild(draft: Draft, kind: FacilityKind, x: number, bottom: number, top: number): void {
  const r = draft.buildTransport(kind, x, bottom, top);
  if (!r.ok) throw new Error(`buildTransport ${kind} at ${x} (${bottom}-${top}) failed: ${r.reason ?? "no reason"}`);
}

/** Place a room and assert it seated, returning its record view. */
export function placeUnit(draft: Draft, kind: FacilityKind, floor: number, x: number): Unit {
  const r = draft.tower.place(kind, floor, x);
  if (!r.ok || r.unitId === undefined) throw new Error(`place ${kind} at ${floor},${x} failed: ${r.reason ?? "no reason"}`);
  const u = draft.tower.getUnit(r.unitId);
  if (!u) throw new Error(`place ${kind} at ${floor},${x}: unit ${r.unitId} not found`);
  return u as unknown as Unit;
}

/** The 40-tile starter lobby a new game gets in play. */
export function ensureStarterLobby(draft: Draft): void {
  const startX = MID - 20;
  for (let x = startX; x < startX + 40; x++) layTile(draft, "lobby", 1, x);
}

/** A new draft with the starter lobby, as `newSeededGame` makes one. */
export function newSeededDraft(seed = 12345, mode: "classic" | "modern" = "classic"): Draft {
  const draft = draftTower(seed, mode);
  ensureStarterLobby(draft);
  return draft;
}
