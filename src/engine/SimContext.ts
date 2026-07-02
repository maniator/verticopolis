import type { Clock } from "./Clock";
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
  /** True if the tower contains at least one unit of this kind. */
  hasAny(kind: FacilityKind): boolean;
  /** True if at least one operational (finished, not-on-fire) unit of this kind
   * exists. */
  hasOperational(kind: FacilityKind): boolean;
  /** Human floor label: "floor 5" above ground, "B1"/"B2"… below. */
  floorLabel(floor: number): string;
  /** Dispatch a staff member (housekeeper) from `from` to `to` over the staff
   * network, walking to `destX` to service unit `cleanUnitId`. Returns false
   * when no staff route exists (job stays queued). Optional so hand-rolled
   * test contexts without a crowd can omit it. */
  spawnStaffTrip?(from: number, to: number, destX: number, cleanUnitId: number): boolean;
}
