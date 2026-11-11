import type { UnitState } from "./types";

/**
 * The four questions the web asks of a unit's state. The rule belongs to the
 * engine (`Unit::is_operational`, `is_present`, `is_tenanted`, `is_dormant` in
 * `engine-rs/src/tower_query_state.rs`); these are the same checks over the
 * state a frame carries, so drawing code does not import the TypeScript
 * engine at runtime for them (the `UnitState` type below is the only link, and
 * it is erased at build time). `unitState.test.ts` and the Rust test hold one table.
 */

/** A unit that is live: not under construction, ablaze, or a burned-out shell.
 *  Every "is this room working?" check routes through here so a new inert state
 *  is honored everywhere at once. */
export function isOperational(u: { state: UnitState }): boolean {
  return u.state !== "construction" && u.state !== "fire" && u.state !== "gutted";
}

/** People are physically present: a settled or working tenant, a sleeping
 *  guest, or a lease on notice (`vacating`), who keeps counting until the
 *  departure resolves. `moving_in` is reserved and counts if a move-in phase is
 *  ever assigned. */
export function isPresent(u: { state: UnitState }): boolean {
  return (
    u.state === "occupied" ||
    u.state === "asleep" ||
    u.state === "moving_in" ||
    u.state === "vacating"
  );
}

/** A unit that is settled (`occupied`) or on notice (`vacating`): still in
 *  residence, not yet gone. Purely a `state` check, so it applies to any unit
 *  the caller iterates. A vacating tenant still pays rent and counts toward
 *  population; a timely fix can rescind the notice. */
export function isTenanted(u: { state: UnitState }): boolean {
  return u.state === "occupied" || u.state === "vacating";
}

/** Nobody home and nothing to simulate. Not the inverse of {@link isOperational}:
 *  an operational `empty` unit is dormant. `infested` is here so a roach-ruined
 *  room is skipped by the satisfaction loop and keeps its bulldoze or
 *  exterminator recovery. */
export function isDormant(u: { state: UnitState }): boolean {
  const s = u.state;
  return s === "empty" || s === "construction" || s === "fire" || s === "gutted" || s === "infested";
}
