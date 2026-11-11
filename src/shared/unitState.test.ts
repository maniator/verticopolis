import { describe, expect, it } from "vitest";
import type { UnitState } from "./types";
import { isDormant, isOperational, isPresent, isTenanted } from "./unitState";

/**
 * One row per unit state and what each predicate says of it. The Rust test in
 * `engine-rs/src/tower_query_state.rs` (`UNIT_STATE_ROWS`) holds the same
 * table against `Unit::is_operational`, `is_present`, `is_tenanted` and
 * `is_dormant`, so the web's copy cannot drift from the engine's rule. Keep the
 * two tables identical.
 */
interface Expected {
  readonly operational: boolean;
  readonly present: boolean;
  readonly tenanted: boolean;
  readonly dormant: boolean;
}

// Keyed by state, so adding a `UnitState` variant fails type-checking here
// until its row is written.
const UNIT_STATE_ROWS: Record<UnitState, Expected> = {
  construction: { operational: false, present: false, tenanted: false, dormant: true },
  empty: { operational: true, present: false, tenanted: false, dormant: true },
  occupied: { operational: true, present: true, tenanted: true, dormant: false },
  moving_in: { operational: true, present: true, tenanted: false, dormant: false },
  vacating: { operational: true, present: true, tenanted: true, dormant: false },
  asleep: { operational: true, present: true, tenanted: false, dormant: false },
  dirty: { operational: true, present: false, tenanted: false, dormant: false },
  infested: { operational: true, present: false, tenanted: false, dormant: true },
  fire: { operational: false, present: false, tenanted: false, dormant: true },
  gutted: { operational: false, present: false, tenanted: false, dormant: true },
};

describe("unit state predicates match the engine's", () => {
  it.each(Object.entries(UNIT_STATE_ROWS) as [UnitState, Expected][])("%s", (state, row) => {
    const u = { state };
    expect(isOperational(u), "operational").toBe(row.operational);
    expect(isPresent(u), "present").toBe(row.present);
    expect(isTenanted(u), "tenanted").toBe(row.tenanted);
    expect(isDormant(u), "dormant").toBe(row.dormant);
  });
});
