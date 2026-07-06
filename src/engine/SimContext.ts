import type { Clock } from "./Clock";
import type { LedgerCat } from "./Ledger";
import type { RNG } from "./rng";
import type { Tower } from "./Tower";
import type { FacilityKind, WeatherKind } from "./types";

/** Severity tag for a log/headline entry. */
export type LogKind = "info" | "good" | "bad" | "money";

/**
 * The slice of {@link Simulation} that extracted subsystems (events, economy)
 * read and mutate. Depending on this narrow interface — rather than the whole
 * Simulation — keeps each subsystem independently testable: a test can drive
 * one with a tiny hand-rolled context instead of standing up the entire game.
 */
export interface SimContext {
  readonly tower: Tower;
  readonly clock: Clock;
  readonly rng: RNG;
  /** Mutable cash balance; subsystems add income / subtract costs directly. */
  money: number;
  readonly star: number;
  /** Simulation model selector (Phase 2). Absent/`v1` = shipped behavior;
   * `v2` enables the spatial models (e.g. service coverage radius). */
  readonly simModel?: "v1" | "v2";
  /** Current cosmetic sky weather; rain depresses commercial foot traffic. */
  readonly weather?: WeatherKind;
  emit(text: string, kind?: LogKind): void;
  /** Tag money to a stats-breakdown category (positive income, negative
   *  expense). Optional so a hand-rolled test context can omit it. */
  recordMoney?(cat: LedgerCat, amount: number): void;
  /** True when a floor draws visitors: reachable from the lobby within the
   *  two-ride rule (≤1 transfer). Stricter than {@link Tower.isFloorServed}
   *  (mere connectivity). Optional so a minimal hand-rolled test context can
   *  omit it — callers fall back to `tower.isFloorServed` when it's absent. */
  floorReachable?(floor: number): boolean;
  /** True if the tower contains at least one unit of this kind. */
  hasAny(kind: FacilityKind): boolean;
  /** True if at least one operational (finished, not-on-fire) unit of this kind
   * exists. */
  hasOperational(kind: FacilityKind): boolean;
  /** Human floor label: "floor 5" above ground, "B1"/"B2"… below. */
  floorLabel(floor: number): string;
  /** Cosmetic-only hooks the events fire so the renderer can animate them; the
   * engine core stays DOM-free and headless test contexts simply omit them
   * (the visuals never touch gameplay state, RNG, or the save). */
  triggerSanta?(): void;
  triggerExplosion?(floor: number, xTile: number): void;
  triggerThief?(caught: boolean, floor: number): void;
  triggerTreasure?(floor: number, xTile: number): void;
  triggerVip?(): void;
  /** Dispatch a staff member (housekeeper) from `from` to `to` over the staff
   * network, walking to `destX` to service unit `cleanUnitId`. "full" means
   * the staff pool is at cap (retry later); "no-route" means the staff
   * network can't get there (surface it — don't retry silently). Optional so
   * hand-rolled test contexts without a crowd can omit it. */
  spawnStaffTrip?(from: number, to: number, destX: number, cleanUnitId: number): "sent" | "full" | "no-route";
}
